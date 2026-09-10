import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

const excludedPaths = new Set([
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
]);

function includedPath(path) {
  return path.length > 0 && !path.startsWith(".chatgpt/") && !excludedPaths.has(path);
}

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
    writeLength(entry.payload.length);
    hash.update(entry.payload);
  }
  return hash.digest("hex");
}

/** Hash the current tracked/unignored repository state without self-hashing the stored report. */
export function repositoryAssuranceStateSha256(repositoryRoot) {
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error("Unable to enumerate the repository assurance state.");
  }
  const entries = [];
  for (const path of listed.stdout.split("\0").filter(includedPath)) {
    const absolute = resolve(repositoryRoot, path);
    let stat;
    let kind;
    let payload;
    try {
      stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        kind = 1;
        payload = Buffer.from(readlinkSync(absolute));
      } else if (stat.isFile()) {
        kind = 0;
        payload = readFileSync(absolute);
      }
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") {
        kind = 2;
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
    if (kind === undefined || payload === undefined) {
      throw new Error(`Unable to frame repository assurance path '${path}'.`);
    }
    entries.push({ path, kind, payload });
  }
  return hashAssuranceEntries(entries);
}

/** Hash one committed repository tree with exactly the same framing as a clean assurance run. */
export function repositoryAssuranceCommittedStateSha256(repositoryRoot, commit) {
  const listed = spawnSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", commit],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (listed.error !== undefined || listed.status !== 0) {
    throw new Error(`Unable to enumerate committed repository assurance state '${commit}'.`);
  }
  const entries = [];
  for (const record of listed.stdout.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("Malformed git ls-tree assurance record.");
    const header = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (!includedPath(path)) continue;
    if (header.length !== 3 || header[1] !== "blob") {
      throw new Error(`Repository assurance commit contains unsupported entry '${path}'.`);
    }
    const [mode, , objectId] = header;
    const blob = spawnSync("git", ["cat-file", "blob", objectId], {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (blob.error !== undefined || blob.status !== 0) {
      throw new Error(`Unable to read committed repository assurance path '${path}'.`);
    }
    const kind = mode === "120000" ? 1 : mode === "100644" || mode === "100755" ? 0 : undefined;
    if (kind === undefined) {
      throw new Error(`Repository assurance commit has unsupported mode '${mode}' for '${path}'.`);
    }
    entries.push({ path, kind, payload: blob.stdout });
  }
  return hashAssuranceEntries(entries);
}
