import { assertCompactAssuranceCertificate, assertExecutableAssuranceMatchesManifests } from "../../../scripts/executable-assurance-coherence.mjs";
import implementationSurface from "../../../scripts/formal-implementation-surface.cjs";
import assert from "node:assert/strict";
import { assuranceRepositoryPath, readCompactArchive } from "../../../scripts/assurance-files.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repositoryAssuranceCommittedStateSha256, repositoryAssuranceInputPaths, repositoryAssuranceStateSha256 } from "../../../scripts/repository-assurance-state.mjs";

export const CURRENT_REVIEW_ASSURANCE_RECEIPT = "experiments/tla-conformance/final-convergence/current-pr-review-assurance-receipt.json";
const CURRENT_REVIEW_ASSURANCE_REPORT = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const CURRENT_REVIEW_ASSURANCE_FULL_LOG = "experiments/tla-conformance/final-convergence/current-pr-review-full.log";
const CURRENT_REVIEW_ASSURANCE_MANIFESTS = Object.freeze({
  api: "formal/implementation-conformance/API_ASSURANCE.json",
  fields: "formal/implementation-conformance/FIELD_CLASSIFICATION.json",
  callChains: "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  traces: "formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json",
  gaps: "formal/implementation-conformance/FORMAL_COVERAGE_GAPS.json",
});
const CURRENT_REVIEW_ASSURANCE_EVIDENCE_HEAD = "811bb040def82d0f2c61997f98178d23e7921b84";
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

/** Read one repository file's exact bytes from an immutable Git commit. */
function committedFileBytes(repositoryRoot, commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Hash one repository file exactly as stored in an immutable Git commit. */
function committedFileSha256(repositoryRoot, commit, file) {
  return crypto.createHash("sha256").update(
    committedFileBytes(repositoryRoot, commit, file)
  ).digest("hex");
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

/** Require exactly one successful registry, selftest, and verifier process from the pinned compact certificate. */
export function assertCurrentReviewCompactCertificateProcesses(certification, compactCertifiedHead, independentlyDerivedClosure) {
  assertCompactAssuranceCertificate(certification, {
    head: compactCertifiedHead,
    inputKey: independentlyDerivedClosure.inputKey,
    surfaceDigest: independentlyDerivedClosure.surfaceDigest,
  });
}

/** Derive exact proof-output and temporary-support authority from the immutable compact certificate. */
function currentReviewProofIntegrationAuthority(repositoryRoot, certifiedHead) {
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
  const closure = JSON.parse(committedFileText(root, compactCertifiedHead, COMPACT_CLOSURE));
  assertCurrentReviewCompactCertificateProcesses(manifest.certification, compactCertifiedHead, closure);

  assert.equal(typeof manifest.archive?.file, "string", "Pinned compact archive path is invalid.");
  assert.match(manifest.archive?.sha256, /^[a-f0-9]{64}$/u, "Pinned compact archive digest is invalid.");
  assert(Array.isArray(manifest.archive?.files), "Pinned compact archive file manifest is invalid.");

  // Currentization may legitimately replace archived proof support after a fresh full-assurance
  // source certificate. Authenticate temporary materialization against that immutable full-certified
  // tree, not against the older compact certificate whose support is precisely what is being replaced.
  const fullManifest = JSON.parse(committedFileText(root, effectiveCertifiedHead, COMPACT_MANIFEST));
  assert.equal(fullManifest.archive?.file, manifest.archive.file, "Full-certified compact archive path changed unexpectedly.");
  assert.match(fullManifest.archive?.sha256, /^[a-f0-9]{64}$/u, "Full-certified compact archive digest is invalid.");
  assert(Array.isArray(fullManifest.archive?.files), "Full-certified compact archive file manifest is invalid.");
  const fullArchiveBytes = committedFileBytes(root, effectiveCertifiedHead, fullManifest.archive.file);
  assert.equal(
    crypto.createHash("sha256").update(fullArchiveBytes).digest("hex"),
    fullManifest.archive.sha256,
    "Full-certified compact archive bytes differ from its manifest.",
  );
  const fullSupport = readCompactArchive(fullArchiveBytes, fullManifest.archive.files);
  const temporarySupportRows = new Map();
  for (const [file, bytes] of fullSupport) {
    temporarySupportRows.set(file, {
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  }


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
  return { paths, temporarySupportRows };
}

/** Derive compact outputs from the immutable compact certificate pinned by the full-assurance certified head. */
export function currentReviewProofIntegrationPaths(repositoryRoot, certifiedHead) {
  return currentReviewProofIntegrationAuthority(repositoryRoot, certifiedHead).paths;
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

/** Return current tracked drift plus unauthenticated untracked authoritative inputs; local coordination stays ambient. */
export function currentReviewWorktreeDriftPaths(repositoryRoot, authenticatedTemporarySupportRows = new Map()) {
  const modified = gitPathList(repositoryRoot, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const untracked = [];
  for (const file of repositoryAssuranceInputPaths(repositoryRoot, true)) {
    const expected = authenticatedTemporarySupportRows.get(file);
    if (expected === undefined) {
      untracked.push(file);
      continue;
    }
    const target = regularFile(repositoryRoot, file, `Authenticated temporary compact support '${file}'`);
    assert.equal(fs.statSync(target).size, expected.bytes, `Authenticated temporary compact support size changed: ${file}`);
    assert.equal(sha256(target), expected.sha256, `Authenticated temporary compact support hash changed: ${file}`);
  }
  return [...new Set([...modified, ...untracked])].sort();
}

/** Compare every full-assurance source byte/mode, not Git's potentially hidden diff, outside pinned generated outputs. */
function assertCurrentReviewLiveSourceBytes(root, certifiedHead, authority) {
  // Temporary support is excluded only after its complete path/size/hash has been authenticated by the same gate.
  const dirtyPaths = currentReviewWorktreeDriftPaths(root, authority.temporarySupportRows);
  assertCurrentReviewTrackedDriftAllowed(dirtyPaths, authority.paths);
  const omitted = new Set([...authority.paths, ...authority.temporarySupportRows.keys()]);
  const current = repositoryAssuranceStateSha256(root, omitted);
  const expected = repositoryAssuranceCommittedStateSha256(root, certifiedHead, omitted);
  assert.equal(current, expected, "Live full-assurance source bytes or modes differ from the independently certified tree.");
  return current;
}

/** Cheap source admission for certificate reuse; it deliberately constructs no TypeScript compiler context. */
export function verifyCurrentReviewLiveSource(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const certifiedHead = immutableCurrentReviewCertifiedHead(root);
  const authority = currentReviewProofIntegrationAuthority(root, certifiedHead);
  return assertCurrentReviewLiveSourceBytes(root, certifiedHead, authority);
}

/** Validate report/receipt semantic bindings independently of immutable Git-byte anchoring. */
export function assertCurrentReviewAssuranceContent({
  receipt,
  report,
  reportSha256,
  fullLogSha256,
  independentlyDerivedSurfaceSha256,
  independentlyDerivedRepositoryStateSha256,
  manifests,
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
  assertExecutableAssuranceMatchesManifests({
    executable: report,
    ...manifests,
  });
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
  const manifests = Object.fromEntries(
    Object.entries(CURRENT_REVIEW_ASSURANCE_MANIFESTS).map(([name, file]) => [
      name,
      JSON.parse(committedFileText(root, receipt.certifiedHead, file)),
    ]),
  );
  assertCurrentReviewAssuranceContent({
    receipt,
    report,
    reportSha256,
    fullLogSha256,
    independentlyDerivedSurfaceSha256: currentReviewSurfaceSha256(root, context),
    independentlyDerivedRepositoryStateSha256: repositoryAssuranceCommittedStateSha256(root, receipt.certifiedHead),
    manifests,
  });
  const proofIntegrationAuthority = currentReviewProofIntegrationAuthority(root, receipt.certifiedHead);
  const allowedProofIntegrationPaths = proofIntegrationAuthority.paths;
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
  assertCurrentReviewLiveSourceBytes(root, receipt.certifiedHead, proofIntegrationAuthority);
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
