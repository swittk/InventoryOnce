import assert from "node:assert/strict";
import { assuranceRepositoryPath, readAssuranceFile, readCompactArchive, materializeAssuranceFiles, claimAssuranceWorkspace } from "../../../scripts/assurance-files.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  CURRENT_REVIEW_ASSURANCE_RECEIPT,
  assertCurrentReviewAssuranceContent,
  currentReviewSurfaceSha256,
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
  return assuranceRepositoryPath(root, file);
}
const mode = process.argv[2] ?? "verify";
const bundle = manifest.bundles.entries.find((row) => row.mode === mode);
assert(bundle !== undefined, `Unknown compact final-assurance mode: ${mode}`);
const bundleFile = repositoryPath(bundle.file);
assertRegularFile(bundleFile, `Compact ${mode} bundle`);
assert.equal(sha256(bundleFile), bundle.sha256, `Compact ${mode} bundle bytes changed.`);
const archiveFile = repositoryPath(manifest.archive.file);
assertRegularFile(archiveFile, "Compact support archive");
assert.equal(sha256(archiveFile), manifest.archive.sha256, "Compact support archive bytes changed.");
// Validate every archive member/type/hash before any repository path can be written.
const archiveFiles = readCompactArchive(readAssuranceFile(root, manifest.archive.file), manifest.archive.files);
const releaseWorkspace = claimAssuranceWorkspace(root);
let cleanupSupport;
try {
  cleanupSupport = materializeAssuranceFiles(root, archiveFiles);
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
    const foreignCwd = fs.mkdtempSync(path.join(tmpdir(), "inventoryonce-final-cwd-"));
    try {
      const authorityRoot = execFileSync(
        process.execPath,
        [repositoryPath("experiments/tla-conformance/final-convergence/build-base-authority-index.mjs"), "--check-root"],
        { cwd: foreignCwd, encoding: "utf8" },
      ).trim();
      assert.equal(authorityRoot, root, "Base authority generator used the caller working directory.");
      execFileSync(
        process.execPath,
        [repositoryPath("experiments/tla-conformance/final-convergence/compact-final-registry.mjs"), "--check"],
        { cwd: foreignCwd, stdio: "pipe" },
      );
    } finally {
      fs.rmSync(foreignCwd, { recursive: true, force: true });
    }
    const selftestDir = path.join(root, ".chatgpt", "compact-file-kind-selftest");
    fs.rmSync(selftestDir, { recursive: true, force: true });
    fs.mkdirSync(selftestDir, { recursive: true });
    const ordinary = path.join(selftestDir, "ordinary");
    const symbolic = path.join(selftestDir, "symbolic");
    fs.writeFileSync(ordinary, "proof-input");
    fs.symlinkSync(ordinary, symbolic);
    assert.throws(() => assertRegularFile(symbolic, "Synthetic proof input"), /not a regular file/u);
    assert.throws(() => repositoryPath("../outside-inventoryonce"), /escapes repository root/u);
    fs.rmSync(selftestDir, { recursive: true, force: true });

    // A self-consistent forged surface digest must reach the source-derived semantic check, not an earlier immutable-byte guard.
    const reviewReceiptPath = path.join(root, CURRENT_REVIEW_ASSURANCE_RECEIPT);
    const reviewReceipt = JSON.parse(fs.readFileSync(reviewReceiptPath, "utf8"));
    const reviewReportPath = path.join(root, reviewReceipt.report.file);
    const reviewReport = JSON.parse(fs.readFileSync(reviewReportPath, "utf8"));
    const reviewLogPath = path.join(root, reviewReceipt.fullLog.file);
    const forgedDigest = "0".repeat(64);
    const forgedReport = { ...reviewReport, surfaceSha256: forgedDigest };
    const forgedReportBytes = Buffer.from(`${JSON.stringify(forgedReport, null, 2)}\n`);
    const forgedReceipt = {
      ...reviewReceipt,
      surfaceSha256: forgedDigest,
      report: {
        ...reviewReceipt.report,
        sha256: crypto.createHash("sha256").update(forgedReportBytes).digest("hex"),
      },
    };
    assert.throws(
      () => assertCurrentReviewAssuranceContent({
        receipt: forgedReceipt,
        report: forgedReport,
        reportSha256: forgedReceipt.report.sha256,
        fullLogSha256: sha256(reviewLogPath),
        independentlyDerivedSurfaceSha256: currentReviewSurfaceSha256(root),
        independentlyDerivedRepositoryStateSha256: reviewReceipt.repositoryStateSha256,
      }),
      /surface digest is not independently source-derived/u,
    );

    // Mutating only the tracked full log must reach the exact immutable-log byte guard.
    const immutableLogBytes = fs.readFileSync(reviewLogPath);
    try {
      fs.writeFileSync(reviewLogPath, "synthetic full assurance log with no executed run\n");
      assert.throws(
        () => verifyCurrentReviewAssurance(root),
        /full log differs from its immutable evidence commit/u,
      );
    } finally {
      fs.writeFileSync(reviewLogPath, immutableLogBytes);
    }

    // Uncommitted authoritative bytes must never inherit certification from a committed receipt.
    const dirtyFormalPath = path.join(root, "formal", ".compact-dirty-authoritative-selftest");
    try {
      fs.writeFileSync(dirtyFormalPath, "synthetic-uncommitted-formal-byte\n");
      assert.throws(
        () => verifyCurrentReviewAssurance(root),
        /requires a clean authoritative worktree/u,
      );
    } finally {
      fs.rmSync(dirtyFormalPath, { force: true });
    }
  }
  execFileSync(process.execPath, [bundleFile, ...process.argv.slice(3)], { cwd: root, stdio: "inherit" });
} finally {
  try { cleanupSupport?.(); } finally { releaseWorkspace(); }
}
