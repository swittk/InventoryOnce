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
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  if (listed.status !== 0) {
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
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    const absolute = resolve(repositoryRoot, path);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(absolute));
      else if (stat.isFile()) hash.update(readFileSync(absolute));
      else throw new Error(`Repository assurance path '${path}' is not a regular file or symbolic link.`);
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") hash.update("<deleted>");
      else throw error;
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}
