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
const CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD = "44f8500f87e4f8410484ab6f8bab18c010e9029b";
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

/** Read one repository file exactly as stored in an immutable Git commit. */
function committedFileText(repositoryRoot, commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Authenticate the current-review receipt before using its certified head outside the full verifier. */
function immutableCurrentReviewCertifiedHead(repositoryRoot) {
  const receiptPath = regularFile(
    repositoryRoot,
    CURRENT_REVIEW_ASSURANCE_RECEIPT,
    "Current review assurance receipt"
  );
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD, "HEAD"],
    { cwd: repositoryRoot, stdio: "ignore" }
  );
  assert.equal(
    sha256(receiptPath),
    committedFileSha256(
      repositoryRoot,
      CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD,
      CURRENT_REVIEW_ASSURANCE_RECEIPT
    ),
    "Current review assurance receipt differs from its immutable evidence commit."
  );
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.match(
    receipt.certifiedHead,
    /^[a-f0-9]{40}$/u,
    "Current review certified head is invalid for proof-output derivation."
  );
  assert.equal(
    execFileSync(
      "git",
      ["rev-parse", `${CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD}^`],
      { cwd: repositoryRoot, encoding: "utf8" }
    ).trim(),
    receipt.certifiedHead,
    "Immutable current-review evidence commit is not the direct child of the certified repair head."
  );
  return receipt.certifiedHead;
}

/** Derive compact outputs from the immutable compact certificate pinned by the full-assurance certified head. */
export function currentReviewProofIntegrationPaths(repositoryRoot, certifiedHead) {
  const root = path.resolve(repositoryRoot);
  const effectiveCertifiedHead =
    certifiedHead ?? immutableCurrentReviewCertifiedHead(root);
  assert.match(effectiveCertifiedHead, /^[a-f0-9]{40}$/u, "Current review certified head is invalid for proof-output derivation.");

  const wrapper = committedFileText(root, effectiveCertifiedHead, COMPACT_WRAPPER);
  const anchorMatches = [...wrapper.matchAll(/const COMPACT_CERTIFICATE_COMMIT = "([a-f0-9]{40})";/gu)];
  assert.equal(anchorMatches.length, 1, "Full-assurance certified head has an invalid compact certificate anchor count.");
  const certificateEvidenceHead = anchorMatches[0][1];
  const expectedWrapper = `import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";
// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.
const COMPACT_CERTIFICATE_COMMIT = "${certificateEvidenceHead}";
await runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });
`;
  assert.equal(wrapper, expectedWrapper, "Full-assurance certified head does not contain the exact compact certificate wrapper.");
  execFileSync("git", ["merge-base", "--is-ancestor", certificateEvidenceHead, effectiveCertifiedHead], { cwd: root, stdio: "ignore" });

  const manifest = JSON.parse(committedFileText(root, certificateEvidenceHead, COMPACT_MANIFEST));
  assert.equal(manifest.certification?.schemaVersion, 1, "Pinned compact certificate schema is unsupported.");
  const compactCertifiedHead = manifest.certification?.certifiedHead;
  assert.match(compactCertifiedHead, /^[a-f0-9]{40}$/u, "Pinned compact certificate names an invalid tested head.");
  assert.equal(
    execFileSync("git", ["rev-parse", `${certificateEvidenceHead}^`], { cwd: root, encoding: "utf8" }).trim(),
    compactCertifiedHead,
    "Pinned compact certificate evidence is not the direct child of its tested head.",
  );
  const expectedModes = new Map([
    ["registry", "FINAL_535_REGISTRY_BUILT"],
    ["selftest", "FINAL_CONVERGENCE_ADVERSARIAL_PASS"],
    ["verify", "FINAL_BINDER_GREEN"],
  ]);
  assert.equal(manifest.certification.processes?.length, expectedModes.size, "Pinned compact certificate has the wrong process count.");
  for (const row of manifest.certification.processes) {
    assert.equal(row.exitCode, 0, `Pinned compact ${row.mode} process failed.`);
    assert.equal(row.signal, null, `Pinned compact ${row.mode} process was signalled.`);
    assert.equal(row.inputKey, manifest.certification.inputKey, `Pinned compact ${row.mode} input key differs.`);
    assert.equal(row.head, compactCertifiedHead, `Pinned compact ${row.mode} tested the wrong head.`);
    assert.equal(row.report?.status, expectedModes.get(row.mode), `Pinned compact ${row.mode} status is invalid.`);
  }

  const closure = JSON.parse(committedFileText(root, compactCertifiedHead, COMPACT_CLOSURE));
  assert.equal(closure.schemaVersion, 2, "Pinned compact closure schema is unsupported.");
  assert.equal(closure.status, "FINAL_LIVE_INPUT_CLOSURE", "Pinned compact closure status is invalid.");
  assert.equal(closure.inputKey, manifest.certification.inputKey, "Pinned compact closure and certificate input keys differ.");

  const paths = new Set([
    ...CURRENT_REVIEW_EVIDENCE_PATHS,
    CURRENT_REVIEW_ASSURANCE_SELF,
    POST_FULL_RUNTIME_TRANSPORT,
    COMPACT_MANIFEST,
    COMPACT_CLOSURE,
    COMPACT_WRAPPER,
    AGENT_DIARY,
  ]);
  for (const row of closure.outputs ?? []) {
    assert.equal(typeof row?.file, "string", "Pinned compact output path is invalid.");
    paths.add(row.file);
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

/** Return current tracked worktree drift; ambient/untracked bytes receive no post-certification proof credit. */
function currentReviewDirtyPaths(repositoryRoot) {
  return gitPathList(repositoryRoot, ["diff", "--name-only", "-z", "HEAD", "--"]);
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
  const allowedProofIntegrationPaths = currentReviewProofIntegrationPaths(root, receipt.certifiedHead);
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
