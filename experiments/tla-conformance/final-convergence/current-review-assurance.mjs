import implementationSurface from "../../../scripts/formal-implementation-surface.cjs";
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
const CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD = "eb40a3b00c580499dd83ad38c02ae96a6375494a";
const CURRENT_REVIEW_ASSURANCE_SELF = "experiments/tla-conformance/final-convergence/current-review-assurance.mjs";
const COMPACT_MANIFEST = "experiments/tla-conformance/final-convergence/compact-support-manifest.json";
const COMPACT_CLOSURE = "experiments/tla-conformance/final-convergence/authority-reference-manifest.json";
const COMPACT_WRAPPER = "experiments/tla-conformance/final-convergence/run-compact-final-assurance.mjs";
const POST_FULL_RUNTIME_TRANSPORT = "scripts/inventory-epoch-contract.mjs";
const AGENT_DIARY = "AGENT_DIARY.md";
const CURRENT_REVIEW_EVIDENCE_PATHS = Object.freeze([
  CURRENT_REVIEW_ASSURANCE_RECEIPT,
  CURRENT_REVIEW_ASSURANCE_REPORT,
  CURRENT_REVIEW_ASSURANCE_FULL_LOG,
]);

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
export function currentReviewSurfaceSha256(repositoryRoot, context) {
  const surface = implementationSurface.discoverImplementationSurface({ repositoryRoot, program: context?.program });
  return crypto.createHash("sha256").update(canonicalJson(surface)).digest("hex");
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

/** Return sorted nonempty NUL-delimited Git paths without interpreting file names as shell text. */
function gitPathList(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0").filter(Boolean).sort();
}

/** Derive tracked outputs owned by compact currentization/certification from the current manifest. */
export function currentReviewProofIntegrationPaths(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const manifest = JSON.parse(fs.readFileSync(regularFile(root, COMPACT_MANIFEST, "Compact support manifest"), "utf8"));
  const paths = new Set([
    ...CURRENT_REVIEW_EVIDENCE_PATHS,
    CURRENT_REVIEW_ASSURANCE_SELF,
    POST_FULL_RUNTIME_TRANSPORT,
    COMPACT_MANIFEST,
    COMPACT_CLOSURE,
    COMPACT_WRAPPER,
    AGENT_DIARY,
  ]);
  for (const row of manifest.bundles?.entries ?? []) {
    assert.equal(typeof row?.file, "string", "Compact bundle output path is invalid.");
    paths.add(row.file);
  }
  if (typeof manifest.archive?.file === "string") paths.add(manifest.archive.file);
  for (const node of manifest.graph ?? []) {
    for (const row of node.outputs ?? []) {
      assert.equal(typeof row?.file, "string", "Compact graph output path is invalid.");
      paths.add(row.file);
    }
  }
  return paths;
}

/** Default-deny any tracked drift that is not one of the exact proof-integration outputs. */
export function assertCurrentReviewTrackedDriftAllowed(changedPaths, allowedPaths) {
  const unexpected = [...new Set(changedPaths)].filter(file => !allowedPaths.has(file)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `Post-certification tracked drift escaped the proof-integration closure: ${unexpected.join(", ")}`,
  );
}

/** Return current tracked/untracked dirt while excluding local ChatGPT audit state from the product proof domain. */
function currentReviewDirtyPaths(repositoryRoot) {
  const tracked = gitPathList(repositoryRoot, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const untracked = gitPathList(repositoryRoot, [
    "-c", "core.excludesFile=/dev/null",
    "ls-files", "--others", "--exclude-per-directory=.gitignore", "-z",
  ]).filter(file => !file.startsWith(".chatgpt/"));
  return [...new Set([...tracked, ...untracked])].sort();
}

/** Validate report/receipt semantic bindings independently of immutable Git-byte anchoring. */
export function assertCurrentReviewAssuranceContent({
  receipt,
  report,
  reportSha256,
  fullLogSha256,
  independentlyDerivedSurfaceSha256,
  independentlyDerivedRepositoryStateSha256,
}) {
  assert.equal(receipt.schemaVersion, 1, "Current review assurance receipt schema is unsupported.");
  assert.equal(receipt.status, "CURRENT_PR_REVIEW_FULL_ASSURANCE_VERIFIED", "Current review assurance receipt status is invalid.");
  assert.match(receipt.certifiedHead, /^[a-f0-9]{40}$/u, "Current review assurance certified head is invalid.");
  assert.equal(receipt.report.file, CURRENT_REVIEW_ASSURANCE_REPORT, "Current review assurance report path is not package-owned.");
  assert.equal(receipt.fullLog.file, CURRENT_REVIEW_ASSURANCE_FULL_LOG, "Current review assurance full-log path is not package-owned.");
  assert.equal(reportSha256, receipt.report.sha256, "Current review assurance report bytes changed.");
  assert.equal(fullLogSha256, receipt.fullLog.sha256, "Current review assurance full-log bytes changed.");
  assert.equal(report.repositoryHead, receipt.certifiedHead, "Current review assurance report certifies the wrong commit.");
  assert.equal(report.fullFormal, true, "Current review assurance report is not a full-formal run.");
  assert.match(report.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance report surface digest is invalid.");
  assert.match(receipt.surfaceSha256, /^[a-f0-9]{64}$/u, "Current review assurance receipt surface digest is invalid.");
  assert.equal(report.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance report surface digest is not independently source-derived.");
  assert.equal(receipt.surfaceSha256, independentlyDerivedSurfaceSha256, "Current review assurance receipt surface digest is not independently source-derived.");
  assert.equal(report.apiEntries, 510, "Current review assurance API census changed.");
  assert.equal(report.compilerCallGraphUnresolvedApis, 0, "Current review assurance has unresolved public APIs.");
  assert.equal(report.repositoryStateSha256, receipt.repositoryStateSha256, "Current review assurance state receipt disagrees with the report.");
  assert.equal(independentlyDerivedRepositoryStateSha256, receipt.repositoryStateSha256, "Current review assurance was not produced from the exact clean committed evidence state.");
  assert.equal(report.fullLogSha256, receipt.fullLog.sha256, "Current review assurance report is not bound to the tracked full log.");
}

/** Verify the exact reviewed commit against independently recomputed committed state and tracked full-run log bytes. */
export function verifyCurrentReviewAssurance(repositoryRoot, context) {
  const root = path.resolve(repositoryRoot);
  const receiptPath = regularFile(root, CURRENT_REVIEW_ASSURANCE_RECEIPT, "Current review assurance receipt");
  execFileSync("git", ["merge-base", "--is-ancestor", CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, "HEAD"], { cwd: root, stdio: "ignore" });
  assert.equal(
    sha256(receiptPath),
    committedFileSha256(root, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, CURRENT_REVIEW_ASSURANCE_RECEIPT),
    "Current review assurance receipt differs from its immutable evidence commit.",
  );
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
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
  const reportSha256 = sha256(reportPath);
  const fullLogSha256 = sha256(logPath);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assertCurrentReviewAssuranceContent({
    receipt,
    report,
    reportSha256,
    fullLogSha256,
    independentlyDerivedSurfaceSha256: currentReviewSurfaceSha256(root, context),
    independentlyDerivedRepositoryStateSha256: repositoryAssuranceCommittedStateSha256(root, receipt.certifiedHead),
  });
  const allowedProofIntegrationPaths = currentReviewProofIntegrationPaths(root);
  const evidenceDelta = gitPathList(root, [
    "diff", "--name-only", "-z", receipt.certifiedHead, CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, "--",
  ]);
  assert.deepEqual(
    evidenceDelta,
    [...CURRENT_REVIEW_EVIDENCE_PATHS].sort(),
    "Immutable current-review evidence commit changed bytes outside its exact receipt/report/log payload.",
  );
  const trackedPostCertificationDelta = gitPathList(root, [
    "diff", "--name-only", "-z", receipt.certifiedHead, "HEAD", "--",
  ]);
  assertCurrentReviewTrackedDriftAllowed(trackedPostCertificationDelta, allowedProofIntegrationPaths);
  const dirtyPaths = currentReviewDirtyPaths(root);
  assertCurrentReviewTrackedDriftAllowed(dirtyPaths, allowedProofIntegrationPaths);
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
