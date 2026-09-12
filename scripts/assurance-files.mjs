import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

/** Resolve a proof input/output inside one repository, rejecting links at every existing path component. */
export function assuranceRepositoryPath(repositoryRoot, relativePath) {
  const root = path.resolve(repositoryRoot);
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0") || relativePath.includes("\\") || path.isAbsolute(relativePath)) throw new Error(`Invalid repository-relative assurance path: ${String(relativePath)}.`);
  const components = relativePath.split("/");
  if (components.some(part => part === "" || part === "." || part === "..")) throw new Error(`Assurance path escapes repository root: ${relativePath}.`);
  let current = root;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Assurance repository root is not an ordinary directory.");
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Assurance path crosses a symbolic link: ${relativePath}.`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`Assurance path ancestor is not a directory: ${relativePath}.`);
  }
  return current;
}

/** Open proof bytes without following a replaced leaf link, then require an ordinary file. */
function readOrdinaryAssuranceFile(repositoryRoot, relativePath) {
  const target = assuranceRepositoryPath(repositoryRoot, relativePath);
  if (!fs.lstatSync(target).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath}.`);
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Assurance input is not a regular file: ${relativePath}.`);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

/** Derive one content hash from the exact bytes being admitted. */
export function assuranceBytesSha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** Parse one zero-padded octal tar integer without accepting alternate encodings or unsafe sizes. */
function tarInteger(field, label) {
  const text = field.toString("ascii").replace(/\0.*$/su, "").trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error(`Unsupported compact tar ${label}.`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid compact tar ${label}.`);
  return value;
}

/** Decode one UTF-8 tar name without loss or a non-padding suffix after its first terminator. */
function tarText(field) {
  const end = field.indexOf(0);
  const bytes = end < 0 ? field : field.subarray(0, end);
  if (end >= 0 && field.subarray(end).some(byte => byte !== 0)) throw new Error("Invalid compact tar text padding.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.length === 0) throw new Error("Empty compact tar member name.");
  return text;
}

/** Validate the entire supported ordinary-file tar closure before any destination is created. */
export function readCompactArchive(bytes, declaredFiles) {
  if (!Array.isArray(declaredFiles) || declaredFiles.length === 0) throw new Error("Compact archive has no declared file closure.");
  const declared = new Map(); let total = 0;
  for (const row of declaredFiles) {
    if (row === null || typeof row !== "object" || typeof row.file !== "string" || !row.file.startsWith("experiments/tla-conformance/") || row.file.split("/").some(part => part === "" || part === "." || part === "..") || row.file.includes("\\") || row.file.includes("\0") || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256) || declared.has(row.file)) throw new Error("Malformed or duplicate compact archive member declaration.");
    declared.set(row.file, row); total += row.bytes;
  }
  if (!Number.isSafeInteger(total) || total > 128 * 1024 * 1024) throw new Error("Compact archive exceeds its supported byte closure.");
  // Bound expansion before decompression; header/name/padding overhead is also bounded per declared member.
  const content = gunzipSync(bytes, { maxOutputLength: Math.min(160 * 1024 * 1024, total + declared.size * 4096 + 20480) });
  const files = new Map(); let offset = 0, longName;
  while (offset + 512 <= content.length) {
    const header = content.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (longName !== undefined || content.length < offset + 512 || content.subarray(offset).some(byte => byte !== 0)) throw new Error("Malformed compact tar terminator.");
      if (files.size !== declared.size) throw new Error("Compact archive members differ from its manifest.");
      return files;
    }
    let checksum = 0;
    for (let index = 0; index < 512; index += 1) checksum += index >= 148 && index < 156 ? 32 : header[index];
    if (checksum !== tarInteger(header.subarray(148, 156), "checksum")) throw new Error("Compact tar header checksum mismatch.");
    const size = tarInteger(header.subarray(124, 136), "size");
    if (offset + size > content.length) throw new Error("Truncated compact tar member.");
    const payload = content.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    if (offset > content.length) throw new Error("Truncated compact tar member padding.");
    const kind = header[156];
    // GNU tar uses one long-name header for paths longer than the standard name field.
    if (kind === 76) {
      if (longName !== undefined || size > 4096) throw new Error("Invalid compact tar long-name header.");
      longName = tarText(payload); continue;
    }
    if (kind !== 0 && kind !== 48) throw new Error("Compact tar member is not an ordinary file; links and special entries are forbidden.");
    const shortName = tarText(header.subarray(0, 100));
    const prefixBytes = header.subarray(345, 500);
    const prefix = prefixBytes.every(byte => byte === 0) ? "" : tarText(prefixBytes);
    const name = longName ?? (prefix ? `${prefix}/${shortName}` : shortName); longName = undefined;
    const row = declared.get(name);
    if (row === undefined || files.has(name)) throw new Error(`Unexpected or duplicate compact archive member: ${name}.`);
    if (payload.length !== row.bytes || assuranceBytesSha256(payload) !== row.sha256) throw new Error(`Compact archive member content mismatch: ${name}.`);
    if (header.subarray(157, 257).some(byte => byte !== 0)) throw new Error("Ordinary compact member has a link target.");
    files.set(name, payload);
  }
  throw new Error("Compact archive lacks its terminal zero blocks.");
}

/** Materialize only validated absent ordinary files; return cleanup that owns exactly those creations. */
export function materializeAssuranceFiles(repositoryRoot, files) {
  const createdFiles = [], createdDirectories = [];
  const cleanup = () => {
    for (const file of createdFiles.reverse()) fs.rmSync(file, { force: true });
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch (error) { if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error; }
    }
  };
  for (const [name] of files) {
    const target = assuranceRepositoryPath(repositoryRoot, name);
    try { fs.lstatSync(target); throw new Error(`Archived support path unexpectedly exists before materialization: ${name}`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  try {
    for (const [name, bytes] of files) {
      const target = assuranceRepositoryPath(repositoryRoot, name);
      let parent = path.resolve(repositoryRoot);
      for (const part of name.split("/").slice(0, -1)) {
        parent = path.join(parent, part);
        try { fs.mkdirSync(parent); createdDirectories.push(parent); } catch (error) { if (error?.code !== "EEXIST" || !fs.lstatSync(parent).isDirectory()) throw error; }
      }
      // Recheck the path after mkdir and exclusively create; existing work never belongs to this cleanup.
      assuranceRepositoryPath(repositoryRoot, name);
      const descriptor = fs.openSync(target, "wx"); createdFiles.push(target);
      try { fs.writeFileSync(descriptor, bytes); } finally { fs.closeSync(descriptor); }
    }
  } catch (error) { cleanup(); throw error; }
  return cleanup;
}

/** Claim one worktree-local assurance session; live or stale competing ownership fails closed. */
export function claimAssuranceWorkspace(repositoryRoot) {
  const directory = assuranceRepositoryPath(repositoryRoot, ".chatgpt/compact-assurance-owner");
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  try { fs.mkdirSync(directory); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Compact assurance workspace is already owned; verify the existing process before recovering a stale owner.");
    throw error;
  }
  const owner = crypto.randomUUID(), ownerFile = path.join(directory, "owner.json");
  fs.writeFileSync(ownerFile, JSON.stringify({ owner, pid: process.pid }), { flag: "wx" });
  return () => {
    assert.equal(JSON.parse(fs.readFileSync(ownerFile, "utf8")).owner, owner, "Compact assurance workspace ownership changed.");
    fs.unlinkSync(ownerFile); fs.rmdirSync(directory);
  };
}

/** One active synchronous/async proof transaction, isolated from every other worktree and caller. */
const proofReadSessions = new Map();

/** Read one contained ordinary input, sharing immutable bytes only inside an explicit proof transaction. */
export function readAssuranceFile(repositoryRoot, relativePath) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === undefined ? readOrdinaryAssuranceFile(repositoryRoot, relativePath) : session.read(relativePath);
}

/** Hash an input once per immutable transaction, rather than once per public callable. */
export function assuranceFileSha256(repositoryRoot, relativePath) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === undefined ? assuranceBytesSha256(readOrdinaryAssuranceFile(repositoryRoot, relativePath)) : session.hash(relativePath);
}

/** Bind an explicit transaction's checked reader without changing ordinary verifier behavior outside the transaction. */
export async function withAssuranceReadSession(repositoryRoot, session, run) {
  const root = path.resolve(repositoryRoot);
  assert(!proofReadSessions.has(root), "An assurance read transaction is already active for this root.");
  proofReadSessions.set(root, session);
  try { return await run(); } finally { proofReadSessions.delete(root); }
}

/** Bind the compiler's immutable source string to the same exact bytes without rehashing it for every callable. */
export function assuranceCompilerSourceSha256(repositoryRoot, file, text) {
  const session = proofReadSessions.get(path.resolve(repositoryRoot));
  return session === undefined ? assuranceBytesSha256(text) : session.compilerHash(file, text);
}


/** Unwrapped filesystem calls keep observing a read from recursively observing its own snapshot load. */
const ordinaryFileCalls = Object.fromEntries(["openSync", "closeSync", "readFileSync", "readSync", "writeFileSync", "writeSync", "existsSync"].map(name => [name, fs[name]]));
/** Explicit depth for the pipeline's own already-accounted immutable snapshot reads. */
let assuranceFileObservationSuppressionDepth = 0;

/** Run one synchronous internal snapshot read without recursively treating its native descriptor as verifier input. */
export function runWithoutAssuranceFileObservation(run) {
  assuranceFileObservationSuppressionDepth += 1;
  try { return run(); }
  finally { assuranceFileObservationSuppressionDepth -= 1; }
}

/** Observe actual path and descriptor I/O, including bundled copies of the safe reader, without hiding mutation bytes. */
export async function withAssuranceFileObservation({
  /** Explicit root which every observed path must remain inside. */
  repositoryRoot,
  /** Register the read; an optional immutable buffer replaces only path-based reads. */
  onRead,
  /** Record an existence observation independently of file contents. */
  onExists,
  /** Register pre-write bytes or ownership of newly created mutation probes. */
  onWrite,
}, run) {
  const root = path.resolve(repositoryRoot);
  // Descriptor ownership is scoped to this observer; unknown pre-opened descriptors cannot hide inputs.
  const descriptors = new Map();
  let observing = false;
  const invoke = (callback, file) => {
    if (observing || callback === undefined) return undefined;
    observing = true;
    try { return callback(file); } finally { observing = false; }
  };
  const relativeFile = file => {
    if (typeof file === "number") {
      const known = descriptors.get(file);
      assert.notEqual(known, undefined, "Unbound assurance file descriptor.");
      return known;
    }
    const absolute = file instanceof URL ? fileURLToPath(file) : path.resolve(Buffer.isBuffer(file) ? file.toString() : file);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    assert(relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative), "Assurance I/O escaped its repository.");
    return relative;
  };
  const previous = Object.fromEntries(Object.keys(ordinaryFileCalls).map(name => [name, fs[name]]));
  fs.openSync = (file, flags, ...rest) => {
    if (observing || assuranceFileObservationSuppressionDepth > 0) return ordinaryFileCalls.openSync(file, flags, ...rest);
    const relative = relativeFile(file);
    const writable = typeof flags === "string" ? /[wa+]/u.test(flags) : (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC)) !== 0;
    if (writable) invoke(onWrite, relative);
    const descriptor = ordinaryFileCalls.openSync(file, flags, ...rest);
    descriptors.set(descriptor, relative);
    return descriptor;
  };
  fs.closeSync = descriptor => {
    if (!observing && assuranceFileObservationSuppressionDepth === 0) descriptors.delete(descriptor);
    return ordinaryFileCalls.closeSync(descriptor);
  };
  fs.readFileSync = (file, options) => {
    if (observing || assuranceFileObservationSuppressionDepth > 0) return ordinaryFileCalls.readFileSync(file, options);
    const bytes = invoke(onRead, relativeFile(file));
    // A descriptor read must retain its native cursor semantics; it is observed but never replayed from byte zero.
    if (bytes !== undefined && typeof file !== "number") {
      const encoding = typeof options === "string" ? options : options?.encoding;
      return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
    }
    return ordinaryFileCalls.readFileSync(file, options);
  };
  fs.readSync = (descriptor, ...args) => {
    if (!observing && assuranceFileObservationSuppressionDepth === 0) invoke(onRead, relativeFile(descriptor));
    return ordinaryFileCalls.readSync(descriptor, ...args);
  };
  fs.writeFileSync = (file, ...args) => {
    if (!observing && assuranceFileObservationSuppressionDepth === 0) invoke(onWrite, relativeFile(file));
    return ordinaryFileCalls.writeFileSync(file, ...args);
  };
  fs.writeSync = (descriptor, ...args) => {
    if (!observing && assuranceFileObservationSuppressionDepth === 0) invoke(onWrite, relativeFile(descriptor));
    return ordinaryFileCalls.writeSync(descriptor, ...args);
  };
  fs.existsSync = file => {
    if (observing || assuranceFileObservationSuppressionDepth > 0 || onExists === undefined) return ordinaryFileCalls.existsSync(file);
    return invoke(onExists, relativeFile(file));
  };
  syncBuiltinESMExports();
  try { return await run(); }
  finally { Object.assign(fs, previous); syncBuiltinESMExports(); }
}
