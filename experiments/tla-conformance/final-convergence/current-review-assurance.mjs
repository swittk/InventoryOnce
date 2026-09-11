import assert from "node:assert/strict";
import { assuranceRepositoryPath } from "../../../scripts/assurance-files.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repositoryAssuranceCommittedStateSha256 } from "../../../scripts/repository-assurance-state.mjs";

export const CURRENT_REVIEW_ASSURANCE_RECEIPT = "experiments/tla-conformance/final-convergence/current-pr-review-assurance-receipt.json";
const CURRENT_REVIEW_ASSURANCE_REPORT = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const CURRENT_REVIEW_ASSURANCE_FULL_LOG = "experiments/tla-conformance/final-convergence/current-pr-review-full.log";
const CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD = "a27b15f90854112a94f75c418d744122e8eb7363";
const AUTHORITATIVE_PATHS = Object.freeze(["src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json"]);

/** Hash one ordinary file's exact bytes with lowercase SHA-256. */
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Serialize JSON with recursively sorted object keys exactly like the assurance generator. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Independently derive the current canonical compiler surface digest from source. */
function currentSurfaceSha256(repositoryRoot) {
  const output = execFileSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts/formal-implementation-surface.cjs")],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return crypto.createHash("sha256").update(canonicalJson(JSON.parse(output))).digest("hex");
}

/** Resolve one repository-relative path and fail closed on root escape. */
function repositoryPath(repositoryRoot, file) {
  return assuranceRepositoryPath(repositoryRoot, file);
}

/** Require one referenced proof artifact to be an ordinary file rather than a symlink or directory. */
function regularFile(repositoryRoot, file, label) {
  const target = repositoryPath(repositoryRoot, file);
  const stat = fs.lstatSync(target);
  assert.equal(stat.isFile(), true, `${label} is not a regular file.`);
  return target;
}

/** Hash one repository file exactly as stored in an immutable Git commit. */
function committedFileSha256(repositoryRoot, commit, file) {
  const bytes = execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** Verify the exact reviewed commit against independently recomputed committed state and tracked full-run log bytes. */
export function verifyCurrentReviewAssurance(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const receiptPath = regularFile(root, CURRENT_REVIEW_ASSURANCE_RECEIPT, "Current review assurance receipt");
  execFileSync("git", ["merge-base", "--is-ancestor", CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  assert.equal(
    sha256(receiptPath),
    committedFileSha256(root, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_RECEIPT),
    "Current review assurance receipt differs from its immutable evidence commit.",
  );
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.schemaVersion, 1, "Current review assurance receipt schema is unsupported.");
  assert.equal(receipt.status, "CURRENT_PR_REVIEW_FULL_ASSURANCE_VERIFIED", "Current review assurance receipt status is invalid.");
  assert.match(receipt.certifiedHead, /^[a-f0-9]{40}$/u, "Current review assurance certified head is invalid.");
  assert.equal(
    execFileSync("git", ["rev-parse", `${CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD}^`], { cwd: root, encoding: "utf8" }).trim(),
    receipt.certifiedHead,
    "Immutable current-review evidence commit is not the direct child of the certified repair head.",
  );
  execFileSync("git", ["merge-base", "--is-ancestor", receipt.certifiedHead, "HEAD"], { cwd: root, stdio: "ignore" });
  assert.equal(receipt.report.file, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report path is not package-owned.");
  assert.equal(receipt.fullLog.file, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full-log path is not package-owned.");
  const reportPath = regularFile(root, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report");
  const logPath = regularFile(root, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full log");
  assert.equal(
    sha256(reportPath),
    committedFileSha256(root, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_REPORT),
    "Current review assurance report differs from its immutable evidence commit.",
  );
  assert.equal(
    sha256(logPath),
    committedFileSha256(root, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_FULL_LOG),
    "Current review assurance full log differs from its immutable evidence commit.",
  );
  assert.equal(sha256(reportPath), receipt.report.sha256, "Current review assurance report bytes changed.");
  assert.equal(sha256(logPath), receipt.fullLog.sha256, "Current review assurance full-log bytes changed.");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.repositoryHead, receipt.certifiedHead, "Current review assurance report certifies the wrong commit.");
  assert.equal(report.fullFormal, true, "Current review assurance report is not a full-formal run.");
  assert.match(report.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance report surface digest is invalid.");
  assert.match(receipt.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance receipt surface digest is invalid.");
  const independentlyDerivedSurfaceSha256 = currentSurfaceSha256(root);
  assert.equal(report.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance report surface digest is not independently source-derived.");
  assert.equal(receipt.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance receipt surface digest is not independently source-derived.");
  assert.equal(report.apiEntries, 510, "Current review assurance API census changed.");
  assert.equal(report.compilerCallGraphUnresolvedApis, 0, "Current review assurance has unresolved public APIs.");
  assert.equal(report.repositoryStateSha256, receipt.repositoryStateSha256, "Current review assurance state receipt disagrees with the report.");
  assert.equal(
    repositoryAssuranceCommittedStateSha256(root, receipt.certifiedHead),
    receipt.repositoryStateSha256,
    "Current review assurance was not produced from the exact clean committed evidence state.",
  );
  assert.equal(report.fullLogSha256, receipt.fullLog.sha256, "Current review assurance report is not bound to the tracked full log.");
  const dirtyAuthoritativePaths = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--", ...AUTHORITATIVE_PATHS],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(
    dirtyAuthoritativePaths,
    "",
    "Current review assurance requires a clean authoritative worktree.",
  );
  const authoritativeDelta = execFileSync(
    "git",
    ["diff", "--name-only", receipt.certifiedHead, "HEAD", "--", ...AUTHORITATIVE_PATHS],
    { cwd: root, encoding: "utf8" },
  ).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(
    authoritativeDelta,
    [CURRENT_REVIEW_ASSURANCE_REPORT],
    "Proof integration changed authoritative product/assurance bytes after the certified full run.",
  );
  return {
    receipt,
    reference: {
      file: CURRENT_REVIEW_ASSURANCE_RECEIPT,
      sha256: sha256(receiptPath),
      evidenceHead: CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD,
      certifiedHead: receipt.certifiedHead,
      repositoryStateSha256: receipt.repositoryStateSha256,
      fullLogSha256: receipt.fullLog.sha256,
      surfaceSha256: receipt.surfaceSha256,
    },
  };
}
