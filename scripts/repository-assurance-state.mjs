import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

const excludedPaths = new Set([
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
]);

/** Return whether one repository path contributes to the assurance state digest. */
function includedPath(path) {
  return path.length > 0 && !path.startsWith(".chatgpt/") && !excludedPaths.has(path);
}

/** Hash path/kind/payload tuples with explicit lengths so entry boundaries cannot collide. */
function hashAssuranceEntries(entries) {
  const hash = createHash("sha256");
  const writeLength = (length) => {
    const encoded = Buffer.allocUnsafe(8);
    encoded.writeBigUInt64BE(BigInt(length));
    hash.update(encoded);
  };
  for (const entry of [...entries].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    const pathBytes = Buffer.from(entry.path);
    writeLength(pathBytes.length);
    hash.update(pathBytes);
    hash.update(Buffer.from([entry.kind]));
    const modeBytes = Buffer.from(entry.mode);
    writeLength(modeBytes.length);
    hash.update(modeBytes);
    writeLength(entry.payload.length);
    hash.update(entry.payload);
  }
  return hash.digest("hex");
}

/** Enumerate one authoritative repository domain without ambient global/info excludes or local coordination. */
export function repositoryAssuranceInputPaths(repositoryRoot, untrackedOnly = false) {
  const listed = spawnSync(
    "git",
    ["-c", "core.excludesFile=/dev/null", "ls-files", ...(untrackedOnly ? [] : ["--cached"]), "--others", "--exclude-per-directory=.gitignore", "-z"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error("Unable to enumerate the repository assurance state.");
  }
  return [...new Set(listed.stdout.split("\0").filter(includedPath))].sort();
}

/** Hash actual bytes/modes, optionally omitting only outputs independently authorized by a pinned certificate. */
export function repositoryAssuranceStateSha256(repositoryRoot, omittedPaths = new Set()) {
  const paths = repositoryAssuranceInputPaths(repositoryRoot).filter(file => !omittedPaths.has(file));
  const indexed = spawnSync(
    "git",
    ["ls-files", "--stage", "-z"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (indexed.error !== undefined || indexed.status !== 0) {
    throw new Error("Unable to enumerate tracked repository assurance modes.");
  }
  const trackedModeByPath = new Map();
  for (const record of indexed.stdout.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    const header = tab < 0 ? [] : record.slice(0, tab).split(" ");
    if (tab < 0 || header.length !== 3 || header[2] !== "0") {
      throw new Error("Malformed tracked assurance mode record.");
    }
    trackedModeByPath.set(record.slice(tab + 1), header[0]);
  }
  const fileMode = spawnSync("git", ["config", "--bool", "core.fileMode"], { cwd: repositoryRoot, encoding: "utf8" });
  if (fileMode.error !== undefined || (fileMode.status !== 0 && fileMode.status !== 1)) throw new Error("Unable to read Git file-mode semantics.");
  const ignoresExecutableBit = fileMode.status === 0 && fileMode.stdout.trim() === "false";
  const entries = [];
  for (const path of paths) {
    const absolute = resolve(repositoryRoot, path);
    let stat;
    let kind;
    let mode;
    let payload;
    try {
      stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        kind = 1;
        mode = "120000";
        payload = Buffer.from(readlinkSync(absolute));
      } else if (stat.isFile()) {
        kind = 0;
        const trackedMode = trackedModeByPath.get(path);
        mode = ignoresExecutableBit && (trackedMode === "100644" || trackedMode === "100755")
          ? trackedMode
          : (stat.mode & 0o100) === 0 ? "100644" : "100755";
        payload = readFileSync(absolute);
      }
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") {
        kind = 2;
        mode = trackedModeByPath.get(path);
        if (mode === undefined) {
          throw new Error(`Deleted assurance path '${path}' has no tracked Git mode.`);
        }
        payload = Buffer.alloc(0);
      } else {
        throw error;
      }
    }
    if (stat !== undefined && !stat.isSymbolicLink() && !stat.isFile()) {
      throw new Error(
        `Repository assurance path '${path}' is not a regular file or symbolic link.`
      );
    }
    if (kind === undefined || mode === undefined || payload === undefined) {
      throw new Error(`Unable to frame repository assurance path '${path}'.`);
    }
    entries.push({ path, kind, mode, payload });
  }
  return hashAssuranceEntries(entries);
}

/** Hash one committed repository tree with exactly the same framing as a clean assurance run. */
export function repositoryAssuranceCommittedStateSha256(repositoryRoot, commit, omittedPaths = new Set()) {
  const listed = spawnSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", commit],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error(`Unable to enumerate committed repository assurance state '${commit}'.`);
  }
  const rows = [];
  for (const record of listed.stdout.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Malformed git ls-tree assurance record.");
    const header = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (!includedPath(path) || omittedPaths.has(path)) continue;
    if (header.length !== 3 || header[1] !== "blob" || !/^[a-f0-9]{40,64}$/u.test(header[2])) throw new Error(`Unsupported committed assurance entry '${path}'.`);
    const kind = header[0] === "120000" ? 1 : header[0] === "100644" || header[0] === "100755" ? 0 : undefined;
    if (kind === undefined) throw new Error(`Unsupported committed assurance mode for '${path}'.`);
    rows.push({ path, kind, mode: header[0], objectId: header[2] });
  }
  const batch = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repositoryRoot, input: rows.map(row => row.objectId + "\n").join(""), maxBuffer: 256 * 1024 * 1024,
  });
  if (batch.error !== undefined || batch.status !== 0) throw new Error("Unable to read committed assurance object batch.");
  let offset = 0;
  const entries = [];
  for (const row of rows) {
    const end = batch.stdout.indexOf(10, offset);
    if (end < 0) throw new Error("Truncated committed assurance batch header.");
    const fields = batch.stdout.subarray(offset, end).toString("ascii").split(" ");
    if (fields.length !== 3 || fields[0] !== row.objectId || fields[1] !== "blob" || !/^(0|[1-9][0-9]*)$/u.test(fields[2])) throw new Error("Committed assurance batch identity mismatch.");
    const size = Number(fields[2]); offset = end + 1;
    if (!Number.isSafeInteger(size) || offset + size >= batch.stdout.length || batch.stdout[offset + size] !== 10) throw new Error("Truncated committed assurance batch payload.");
    entries.push({ path: row.path, kind: row.kind, mode: row.mode, payload: batch.stdout.subarray(offset, offset + size) });
    offset += size + 1;
  }
  if (offset !== batch.stdout.length) throw new Error("Unexpected trailing committed assurance batch output.");
  return hashAssuranceEntries(entries);
}
