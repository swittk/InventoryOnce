import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

const excludedPaths = new Set([
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
]);

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
  const paths = listed.stdout
    .split("\0")
    .filter(
      (path) =>
        path.length > 0 &&
        !path.startsWith(".chatgpt/") &&
        !excludedPaths.has(path)
    )
    .sort();
  const hash = createHash("sha256");
  /** Write one unsigned 64-bit big-endian byte length for unambiguous record framing. */
  const writeLength = (length) => {
    const encoded = Buffer.allocUnsafe(8);
    encoded.writeBigUInt64BE(BigInt(length));
    hash.update(encoded);
  };
  for (const path of paths) {
    const pathBytes = Buffer.from(path);
    writeLength(pathBytes.length);
    hash.update(pathBytes);
    const absolute = resolve(repositoryRoot, path);
    let stat;
    // Record kind bytes: 0 = regular file, 1 = symbolic link target, 2 = tracked-but-deleted path.
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
    if (
      stat !== undefined &&
      !stat.isSymbolicLink() &&
      !stat.isFile()
    ) {
      throw new Error(
        `Repository assurance path '${path}' is not a regular file or symbolic link.`
      );
    }
    if (kind === undefined || payload === undefined) {
      throw new Error(`Unable to frame repository assurance path '${path}'.`);
    }
    hash.update(Buffer.from([kind]));
    writeLength(payload.length);
    hash.update(payload);
  }
  return hash.digest("hex");
}
