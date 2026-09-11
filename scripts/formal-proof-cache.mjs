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
import { formalCodeText } from "./formal-syntax.mjs";
import { readAssuranceFile } from "./assurance-files.mjs";

/** Bump only when the semantic proof invocation contract itself changes. */
export const FORMAL_PROOF_CACHE_SCHEMA_VERSION = 3;
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
  sourceText = formalCodeText(sourceText);
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
  assertFormalIdentity(model, "model");
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
    const sourceText = readAssuranceFile(absoluteRoot, repositoryPath(absoluteRoot, file)).toString("utf8");
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
  assertFormalIdentity(model, "model");
  assertFormalIdentity(config, "config");
  const absoluteRoot = resolve(repositoryRoot);
  if (outcome !== "model-passed" && outcome !== "mutation-rejected") {
    throw new Error(`Unsupported formal proof outcome '${outcome}'.`);
  }
  if (outcome === "mutation-rejected" && (typeof invariant !== "string" || invariant.length === 0)) {
    throw new Error("Mutation proof cache entries require an invariant identity.");
  }
  if (typeof tlaToolsSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(tlaToolsSha256)) {
    throw new Error("Formal proof cache entries require the exact lowercase SHA-256 identity of tla2tools.jar.");
  }
  if (typeof tlcWorkers !== "string" || !/^[1-9][0-9]*$/u.test(tlcWorkers)) {
    throw new Error("Formal proof cache entries require an explicit positive-integer TLC worker count.");
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
      sha256: sha256Bytes(readAssuranceFile(absoluteRoot, repositoryPath(absoluteRoot, file))),
    };
  });
  const descriptor = {
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
  assertFormalProofDescriptor(descriptor);
  return descriptor;
}

/** Parse the exact terminal state/depth summary from one completed positive TLC run. */
export function formalModelProofSummary(output) {
  const states = [...output.matchAll(
    /^([0-9,]+) states generated, ([0-9,]+) distinct states found, 0 states left on queue\.$/gmu
  )];
  const depths = [...output.matchAll(
    /^The depth of the complete state graph search is ([0-9]+)\.$/gmu
  )];
  if (states.length !== 1 || depths.length !== 1) return undefined;
  const generated = Number(states[0][1].replaceAll(",", ""));
  const distinct = Number(states[0][2].replaceAll(",", ""));
  const depth = Number(depths[0][1]);
  const summary = { generated, distinct, depth };
  return validFormalModelProofSummary(summary) ? summary : undefined;
}

/** Return whether one cached positive proof carries complete terminal TLC evidence. */
function validFormalModelProofSummary(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isSafeInteger(value.generated) &&
    value.generated >= 0 &&
    Number.isSafeInteger(value.distinct) &&
    value.distinct > 0 &&
    value.distinct <= value.generated &&
    Number.isSafeInteger(value.depth) &&
    value.depth > 0
  );
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
    typeof output === "string" &&
    typeof invariant === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(invariant) &&
    output.split(/\r?\n/u).filter(line => line === `Error: Invariant ${invariant} is violated.`).length === 1
  );
}

/** Return whether persisted mutation-process evidence proves this exact invariant rejection. */
function validFormalMutationProcessEvidence(value, invariant) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.output === "string" &&
    formalMutationProcessProvesInvariantRejection({
      status: value.status,
      signal: value.signal,
      output: value.output,
      invariant,
    })
  );
}

/** Require a TLA identifier rather than allowing filenames to escape the formal directory. */
function assertFormalIdentity(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid formal proof ${label} identity.`);
  }
}

/** Validate the descriptor at every publication/read/key boundary, not just at construction. */
function assertFormalProofDescriptor(descriptor) {
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) throw new Error("Invalid formal proof descriptor.");
  const keys = ["schemaVersion", "model", "config", "outcome", "invariant", "tlaToolsSha256", "tlcWorkers", "inputs"];
  if (descriptor.outcome === "mutation-rejected") keys.push("mutationProcessContractVersion");
  if (Object.keys(descriptor).length !== keys.length || keys.some(key => !Object.hasOwn(descriptor, key))) throw new Error("Incomplete or unknown formal proof descriptor fields.");
  if (descriptor.schemaVersion !== FORMAL_PROOF_CACHE_SCHEMA_VERSION) throw new Error("Invalid formal proof descriptor schema.");
  assertFormalIdentity(descriptor.model, "model"); assertFormalIdentity(descriptor.config, "config");
  if (descriptor.outcome === "mutation-rejected") {
    assertFormalIdentity(descriptor.invariant, "invariant");
    if (descriptor.mutationProcessContractVersion !== FORMAL_MUTATION_PROCESS_CONTRACT_VERSION) throw new Error("Invalid mutation proof process contract.");
  } else if (descriptor.outcome !== "model-passed" || descriptor.invariant !== null) throw new Error("Invalid formal proof outcome or invariant.");
  if (typeof descriptor.tlaToolsSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(descriptor.tlaToolsSha256)) throw new Error("Invalid formal proof tool identity.");
  if (typeof descriptor.tlcWorkers !== "string" || !/^[1-9][0-9]*$/u.test(descriptor.tlcWorkers)) throw new Error("Invalid formal proof worker identity; expected a positive integer.");
  if (!Array.isArray(descriptor.inputs) || descriptor.inputs.length < 2) throw new Error("Formal proof descriptor requires nonempty model/config input closure.");
  const paths = new Set(); let previous = "";
  for (const input of descriptor.inputs) {
    if (input === null || typeof input !== "object" || Object.keys(input).length !== 2 || !Object.hasOwn(input, "path") || !Object.hasOwn(input, "sha256") || typeof input.path !== "string" || !/^formal\/[A-Za-z_][A-Za-z0-9_]*\.(?:tla|cfg)$/u.test(input.path) || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.sha256)) throw new Error("Malformed formal proof input identity.");
    if (input.path <= previous || paths.has(input.path)) throw new Error("Formal proof inputs must be unique and canonically ordered.");
    previous = input.path; paths.add(input.path);
  }
  if (!paths.has(`formal/${descriptor.model}.tla`) || !paths.has(`formal/${descriptor.config}.cfg`)) throw new Error("Formal proof descriptor omits its model/config input.");
}

/** Return the stable content address of one exact proof descriptor. */
export function formalProofCacheKey(descriptor) {
  assertFormalProofDescriptor(descriptor);
  return sha256Bytes(JSON.stringify(descriptor));
}

/** Return the cache file path for one content-addressed proof. */
export function formalProofCachePath(cacheDirectory, cacheKey) {
  if (typeof cacheKey !== "string" || !/^[a-f0-9]{64}$/u.test(cacheKey)) throw new Error("Invalid formal proof cache key identity.");
  return join(cacheDirectory, `${cacheKey}.json`);
}

/** Validate and return a cached proof only when every descriptor field is exact. */
export function readFormalProofCache(cacheDirectory, descriptor) {
  try { assertFormalProofDescriptor(descriptor); } catch { return undefined; }
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
  if (
    descriptor.outcome === "model-passed" &&
    !validFormalModelProofSummary(value.evidence)
  ) {
    return undefined;
  }
  if (
    descriptor.outcome === "mutation-rejected" &&
    !validFormalMutationProcessEvidence(value.evidence, descriptor.invariant)
  ) {
    return undefined;
  }
  return { key, path, evidence: value.evidence };
}

/** Atomically publish a successful proof cache entry after TLC has exited as required. */
export function writeFormalProofCache(cacheDirectory, descriptor, evidence = undefined) {
  assertFormalProofDescriptor(descriptor);
  if (
    descriptor.outcome === "model-passed" &&
    !validFormalModelProofSummary(evidence)
  ) {
    throw new Error("Positive formal proof cache entries require exact terminal TLC state/depth evidence.");
  }
  if (
    descriptor.outcome === "mutation-rejected" &&
    !validFormalMutationProcessEvidence(evidence, descriptor.invariant)
  ) {
    throw new Error("Mutation formal proof cache entries require exact completed TLC invariant-violation evidence.");
  }
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
    evidence,
  };
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record, undefined, 2)}\n`, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return { key, path };
}
