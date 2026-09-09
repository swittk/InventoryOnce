import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Bump only when the semantic proof invocation contract itself changes. */
export const FORMAL_PROOF_CACHE_SCHEMA_VERSION = 2;
/** Pinned TLC 1.7.4 process exit for a completed safety-invariant violation. */
export const TLC_INVARIANT_VIOLATION_EXIT_CODE = 12;
/** Bump when mutation-child completion/witness acceptance becomes stricter. */
export const FORMAL_MUTATION_PROCESS_CONTRACT_VERSION = 2;

/** Compare paths deterministically without locale-sensitive ordering. */
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Return one lowercase SHA-256 digest. */
export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Return one path relative to the repository with stable separators. */
function repositoryPath(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
}

/** Discover local TLA modules imported by EXTENDS or INSTANCE. */
function localModuleNames(repositoryRoot, sourceText) {
  const names = new Set();
  const extendsPattern = /\bEXTENDS\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/gu;
  for (const match of sourceText.matchAll(extendsPattern)) {
    const list = match[1];
    if (list === undefined) continue;
    for (const candidate of list.split(",").map((value) => value.trim())) {
      if (candidate.length > 0 && existsSync(join(repositoryRoot, "formal", `${candidate}.tla`))) {
        names.add(candidate);
      }
    }
  }
  const instancePattern = /\bINSTANCE\s+([A-Za-z_][A-Za-z0-9_]*)/gu;
  for (const match of sourceText.matchAll(instancePattern)) {
    const candidate = match[1];
    if (candidate !== undefined && existsSync(join(repositoryRoot, "formal", `${candidate}.tla`))) {
      names.add(candidate);
    }
  }
  return [...names].sort(compareCodeUnits);
}

/** Return the exact transitive package-local TLA source closure for one model. */
export function transitiveLocalTlaFiles(repositoryRoot, model) {
  const absoluteRoot = resolve(repositoryRoot);
  const visited = new Set();
  const pending = [model];
  while (pending.length > 0) {
    const moduleName = pending.pop();
    if (moduleName === undefined || visited.has(moduleName)) continue;
    const file = join(absoluteRoot, "formal", `${moduleName}.tla`);
    if (!existsSync(file)) {
      throw new Error(`Formal module '${moduleName}' is missing at ${file}.`);
    }
    visited.add(moduleName);
    const sourceText = readFileSync(file, "utf8");
    for (const dependency of localModuleNames(absoluteRoot, sourceText)) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited]
    .map((moduleName) => join(absoluteRoot, "formal", `${moduleName}.tla`))
    .sort((left, right) => compareCodeUnits(repositoryPath(absoluteRoot, left), repositoryPath(absoluteRoot, right)));
}

/** Build a complete semantic descriptor for one cached model or mutation proof. */
export function formalProofDescriptor({
  repositoryRoot,
  model,
  config,
  outcome,
  invariant = null,
  tlaToolsSha256,
  tlcWorkers,
}) {
  const absoluteRoot = resolve(repositoryRoot);
  if (outcome !== "model-passed" && outcome !== "mutation-rejected") {
    throw new Error(`Unsupported formal proof outcome '${outcome}'.`);
  }
  if (outcome === "mutation-rejected" && (typeof invariant !== "string" || invariant.length === 0)) {
    throw new Error("Mutation proof cache entries require an invariant identity.");
  }
  if (typeof tlcWorkers !== "string" || !/^(?:auto|[1-9][0-9]*)$/u.test(tlcWorkers)) {
    throw new Error("Formal proof cache entries require the exact TLC worker setting.");
  }
  const files = [
    ...transitiveLocalTlaFiles(absoluteRoot, model),
    join(absoluteRoot, "formal", `${config}.cfg`),
  ];
  const unique = [...new Set(files)].sort((left, right) =>
    compareCodeUnits(repositoryPath(absoluteRoot, left), repositoryPath(absoluteRoot, right))
  );
  const inputs = unique.map((file) => {
    if (!existsSync(file)) throw new Error(`Formal proof input '${file}' is missing.`);
    return {
      path: repositoryPath(absoluteRoot, file),
      sha256: sha256Bytes(readFileSync(file)),
    };
  });
  return {
    schemaVersion: FORMAL_PROOF_CACHE_SCHEMA_VERSION,
    model,
    config,
    outcome,
    invariant,
    ...(outcome === "mutation-rejected"
      ? { mutationProcessContractVersion: FORMAL_MUTATION_PROCESS_CONTRACT_VERSION }
      : {}),
    tlaToolsSha256,
    tlcWorkers,
    inputs,
  };
}

/** Return whether one completed TLC child proves the named mutation invariant was violated. */
export function formalMutationProcessProvesInvariantRejection({
  status,
  signal,
  output,
  invariant,
}) {
  return (
    signal === null &&
    status === TLC_INVARIANT_VIOLATION_EXIT_CODE &&
    output.includes(`Invariant ${invariant} is violated.`)
  );
}

/** Return the stable content address of one exact proof descriptor. */
export function formalProofCacheKey(descriptor) {
  return sha256Bytes(JSON.stringify(descriptor));
}

/** Return the cache file path for one content-addressed proof. */
export function formalProofCachePath(cacheDirectory, cacheKey) {
  return join(cacheDirectory, `${cacheKey}.json`);
}

/** Validate and return a cached proof only when every descriptor field is exact. */
export function readFormalProofCache(cacheDirectory, descriptor) {
  const key = formalProofCacheKey(descriptor);
  const path = formalProofCachePath(cacheDirectory, key);
  if (!existsSync(path)) return undefined;
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value.schemaVersion !== FORMAL_PROOF_CACHE_SCHEMA_VERSION ||
    value.cacheKey !== key ||
    JSON.stringify(value.descriptor) !== JSON.stringify(descriptor) ||
    value.status !== "verified"
  ) {
    return undefined;
  }
  return { key, path };
}

/** Atomically publish a successful proof cache entry after TLC has exited as required. */
export function writeFormalProofCache(cacheDirectory, descriptor) {
  mkdirSync(cacheDirectory, { recursive: true });
  const key = formalProofCacheKey(descriptor);
  const path = formalProofCachePath(cacheDirectory, key);
  const temporaryPath = join(
    dirname(path),
    `.${key}.${process.pid}.${randomUUID()}.tmp`
  );
  const record = {
    schemaVersion: FORMAL_PROOF_CACHE_SCHEMA_VERSION,
    cacheKey: key,
    status: "verified",
    descriptor,
  };
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record, undefined, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return { key, path };
}
