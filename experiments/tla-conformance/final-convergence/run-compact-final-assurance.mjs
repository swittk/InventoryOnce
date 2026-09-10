import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CURRENT_REVIEW_ASSURANCE_RECEIPT,
  verifyCurrentReviewAssurance,
} from "./current-review-assurance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "compact-support-manifest.json"), "utf8"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
/** Require proof input bytes to be an ordinary file so hashing never follows a symbolic link. */
function assertRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  assert.equal(stat.isFile(), true, `${label} is not a regular file.`);
  return stat;
}
/** Resolve one manifest path and reject any attempt to escape the repository root. */
function repositoryPath(file) {
  const target = path.resolve(root, file);
  const relative = path.relative(root, target);
  assert(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Compact assurance path escapes repository root: ${file}`);
  return target;
}
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
  // Cleanup must be armed before tar can leave any partially extracted member behind.
  materialized = true;
  execFileSync("tar", ["-xzf", archiveFile, "-C", root], { stdio: "inherit" });
  for (const row of manifest.archive.files) {
    const target = path.join(root, row.file);
    const targetStat = assertRegularFile(target, `Archived support member '${row.file}'`);
    assert.equal(targetStat.size, row.bytes, `Archived support size mismatch: ${row.file}`);
    assert.equal(sha256(target), row.sha256, `Archived support hash mismatch: ${row.file}`);
  }
  const liveClosure = JSON.parse(fs.readFileSync(path.join(here, "authority-reference-manifest.json"), "utf8"));
  assert.equal(liveClosure.rows.length, liveClosure.inputs, "Live-input closure row count is stale.");
  let liveBytes = 0;
  for (const row of liveClosure.rows) {
    const target = repositoryPath(row.file);
    const targetStat = assertRegularFile(target, `Live-input closure member '${row.file}'`);
    assert.equal(targetStat.size, row.sizeBytes, `Live-input closure size mismatch: ${row.file}`);
    assert.equal(sha256(target), row.sha256, `Live-input closure hash mismatch: ${row.file}`);
    liveBytes += row.sizeBytes;
  }
  assert.equal(liveBytes, liveClosure.totalBytes, "Live-input closure byte count is stale.");
  verifyCurrentReviewAssurance(root);
  if (mode === "selftest") {
    const selftestDir = path.join(root, ".chatgpt", "compact-file-kind-selftest");
    fs.rmSync(selftestDir, { recursive: true, force: true });
    fs.mkdirSync(selftestDir, { recursive: true });
    const ordinary = path.join(selftestDir, "ordinary");
    const symbolic = path.join(selftestDir, "symbolic");
    fs.writeFileSync(ordinary, "proof-input");
    fs.symlinkSync(ordinary, symbolic);
    assert.throws(() => assertRegularFile(symbolic, "Synthetic proof input"), /not a regular file/u);
    fs.rmSync(selftestDir, { recursive: true, force: true });

    // A self-consistent forged surface digest must still fail against independently derived source evidence.
    const reviewReceiptPath = path.join(root, CURRENT_REVIEW_ASSURANCE_RECEIPT);
    const reviewReceiptBytes = fs.readFileSync(reviewReceiptPath);
    const reviewReceipt = JSON.parse(reviewReceiptBytes.toString("utf8"));
    const reviewReportPath = path.join(root, reviewReceipt.report.file);
    const reviewReportBytes = fs.readFileSync(reviewReportPath);
    try {
      const forgedDigest = "0".repeat(64);
      const forgedReport = JSON.parse(reviewReportBytes.toString("utf8"));
      forgedReport.surfaceSha256 = forgedDigest;
      const forgedReportBytes = Buffer.from(`${JSON.stringify(forgedReport, null, 2)}\n`);
      fs.writeFileSync(reviewReportPath, forgedReportBytes);
      reviewReceipt.surfaceSha256 = forgedDigest;
      reviewReceipt.report.sha256 = crypto.createHash("sha256").update(forgedReportBytes).digest("hex");
      fs.writeFileSync(reviewReceiptPath, `${JSON.stringify(reviewReceipt, null, 2)}\n`);
      assert.throws(
        () => verifyCurrentReviewAssurance(root),
        /surface digest is not independently source-derived/u,
      );
    } finally {
      fs.writeFileSync(reviewReportPath, reviewReportBytes);
      fs.writeFileSync(reviewReceiptPath, reviewReceiptBytes);
    }
  }
  execFileSync(process.execPath, [bundleFile, ...process.argv.slice(3)], { cwd: root, stdio: "inherit" });
} finally {
  if (materialized) for (const row of [...manifest.archive.files].reverse()) fs.rmSync(path.join(root, row.file), { force: true });
}
