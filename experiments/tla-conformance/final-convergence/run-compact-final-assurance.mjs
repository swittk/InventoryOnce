import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "compact-support-manifest.json"), "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const mode = process.argv[2] ?? "verify";
const bundle = manifest.bundles.entries.find((row) => row.mode === mode);
assert(bundle !== undefined, `Unknown compact final-assurance mode: ${mode}`);
const bundleFile = path.join(root, bundle.file);
assert.equal(sha256(bundleFile), bundle.sha256, `Compact ${mode} bundle bytes changed.`);
const archiveFile = path.join(root, manifest.archive.file);
assert.equal(sha256(archiveFile), manifest.archive.sha256, "Compact support archive bytes changed.");
const archiveMembers = execFileSync("tar", ["-tzf", archiveFile], { encoding: "utf8" })
  .split("\n")
  .map((member) => member.trim())
  .filter((member) => member !== "");
const declaredMembers = manifest.archive.files.map((row) => row.file);
assert.deepEqual([...archiveMembers].sort(), [...declaredMembers].sort(), "Compact support archive members differ from the manifest.");
for (const member of archiveMembers) {
  assert(!path.isAbsolute(member) && !member.split("/").includes("..") && !member.endsWith("/"), `Unsafe compact support archive member: ${member}`);
}
for (const row of manifest.archive.files) {
  assert.equal(fs.existsSync(path.join(root, row.file)), false, `Archived support path unexpectedly exists before materialization: ${row.file}`);
}
let materialized = false;
try {
  execFileSync("tar", ["-xzf", archiveFile, "-C", root], { stdio: "inherit" });
  materialized = true;
  for (const row of manifest.archive.files) {
    const target = path.join(root, row.file);
    assert.equal(fs.statSync(target).size, row.bytes, `Archived support size mismatch: ${row.file}`);
    assert.equal(sha256(target), row.sha256, `Archived support hash mismatch: ${row.file}`);
  }
  const liveClosure = JSON.parse(fs.readFileSync(path.join(here, "authority-reference-manifest.json"), "utf8"));
  assert.equal(liveClosure.rows.length, liveClosure.inputs, "Live-input closure row count is stale.");
  let liveBytes = 0;
  for (const row of liveClosure.rows) {
    const target = path.join(root, row.file);
    assert.equal(fs.statSync(target).size, row.sizeBytes, `Live-input closure size mismatch: ${row.file}`);
    assert.equal(sha256(target), row.sha256, `Live-input closure hash mismatch: ${row.file}`);
    liveBytes += row.sizeBytes;
  }
  assert.equal(liveBytes, liveClosure.totalBytes, "Live-input closure byte count is stale.");
  execFileSync(process.execPath, [bundleFile, ...process.argv.slice(3)], { cwd: root, stdio: "inherit" });
} finally {
  if (materialized) for (const row of [...manifest.archive.files].reverse()) fs.rmSync(path.join(root, row.file), { force: true });
}
