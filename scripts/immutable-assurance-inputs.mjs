import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assuranceBytesSha256, readAssuranceFile } from "./assurance-files.mjs";

/** Independently certified frozen proof inputs before this systemic repair, never supplied by an artifact being checked. */
export const FROZEN_FINAL_EVIDENCE_HEAD = "0141b46c18c60b03983081175bbfb5cd074eb8b1";

/** Run Git in the explicit worktree without ambient repository/index redirection. */
function git(repositoryRoot, arguments_, encoding = "utf8") {
  const environment = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete environment[key];
  return execFileSync("git", arguments_, { cwd: path.resolve(repositoryRoot), env: environment, encoding, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

/** Require a linear proof lineage, not two unrelated ancestors of an integration merge. */
export function assertAssuranceCommitChain(repositoryRoot, commits) {
  if (!Array.isArray(commits) || commits.length < 2 || commits.some(commit => typeof commit !== "string" || !/^[a-f0-9]{40}$/u.test(commit))) throw new Error("Malformed assurance ancestry chain.");
  for (let index = 1; index < commits.length; index += 1) {
    try { git(repositoryRoot, ["merge-base", "--is-ancestor", commits[index - 1], commits[index]]); }
    catch { throw new Error(`Assurance certified head does not descend through every required repair: ${commits[index - 1]} -> ${commits[index]}.`); }
  }
}

/** Freeze parsed historical evidence so a caller cannot alter a cached authority in memory. */
function freezeEvidence(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeEvidence(child);
    Object.freeze(value);
  }
  return value;
}

/** Read frozen tracked or archived evidence against one independently pinned Git tree. */
export function createImmutableAssuranceReader(repositoryRoot, anchorHead = FROZEN_FINAL_EVIDENCE_HEAD) {
  const root = path.resolve(repositoryRoot);
  assertAssuranceCommitChain(root, [anchorHead, git(root, ["rev-parse", "HEAD"]).trim()]);
  const tree = new Map();
  for (const entry of git(root, ["ls-tree", "-r", "-z", anchorHead]).split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("\t"), header = entry.slice(0, separator).split(" ");
    tree.set(entry.slice(separator + 1), { mode: header[0], type: header[1], object: header[2] });
  }
  const expectedHashes = new Map(), parsed = new Map();
  let archived;
  const committedBytes = file => {
    const entry = tree.get(file);
    if (entry === undefined || entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) throw new Error(`Frozen assurance evidence is not an ordinary committed file: ${file}.`);
    return git(root, ["cat-file", "blob", entry.object], null);
  };
  const expectedHash = file => {
    if (expectedHashes.has(file)) return expectedHashes.get(file);
    let hash;
    if (tree.has(file)) hash = assuranceBytesSha256(committedBytes(file));
    else {
      if (archived === undefined) {
        const manifest = JSON.parse(committedBytes("experiments/tla-conformance/final-convergence/compact-support-manifest.json"));
        archived = new Map(manifest.archive.files.map(row => [row.file, row.sha256]));
        assert.equal(archived.size, manifest.archive.files.length, "Frozen archive contains duplicate evidence paths.");
      }
      hash = archived.get(file);
      if (hash === undefined) throw new Error(`Evidence is absent from the immutable proof closure: ${file}.`);
    }
    expectedHashes.set(file, hash); return hash;
  };
  const read = file => {
    const bytes = readAssuranceFile(root, file);
    assert.equal(assuranceBytesSha256(bytes), expectedHash(file), `Frozen assurance evidence differs from immutable proof input: ${file}.`);
    return bytes;
  };
  const json = file => {
    // Hash the current bytes even on a parse-cache hit: equal mtimes or re-signed metadata cannot retain credit.
    const bytes = read(file);
    if (!parsed.has(file)) parsed.set(file, freezeEvidence(JSON.parse(bytes.toString("utf8"))));
    return parsed.get(file);
  };
  const transport = (file, expectedStatus, expectedHead, certifiedHead) => {
    const value = json(file);
    assert.equal(value.status, expectedStatus); assert.equal(value.currentHead, expectedHead);
    assertAssuranceCommitChain(root, [value.priorHead, value.currentHead, certifiedHead]);
    return value;
  };
  return Object.freeze({ read, json, transport });
}


/** Return whether one parsed proof names a repository path in a structured path/source/dependency field. */
export function assuranceProofReferencesExactPath(proof, file) {
  if (typeof file !== "string" || file.length === 0) {
    throw new Error("Assurance dependency path must be a nonempty string.");
  }
  const pathBearingKey = key =>
    typeof key === "string" && /(?:file|path|source|dependenc|input)/iu.test(key);
  const visit = (value, key) => {
    if (typeof value === "string") return pathBearingKey(key) && value === file;
    if (Array.isArray(value)) return value.some(child => visit(child, key));
    if (value !== null && typeof value === "object") {
      return Object.entries(value).some(([childKey, child]) => visit(child, childKey));
    }
    return false;
  };
  return visit(proof, undefined);
}

/** Verify a historical receipt against immutable bytes and the current independently certified descendant. */
export function checkFrozenAssuranceTransport(repositoryRoot, file, certifiedHead) {
  const reader = createImmutableAssuranceReader(repositoryRoot);
  const artifact = reader.json(file);
  if (artifact.schemaVersion !== 1 || typeof artifact.status !== "string" || !artifact.status.endsWith("_PROVED")) throw new Error("Malformed historical assurance transport.");
  assertAssuranceCommitChain(repositoryRoot, [artifact.priorHead, artifact.currentHead, certifiedHead]);
  return artifact;
}
