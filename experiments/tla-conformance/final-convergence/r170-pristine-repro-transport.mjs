import { assuranceProofReferencesExactPath, assertAssuranceCommitChain, checkFrozenAssuranceTransport } from "../../../scripts/immutable-assurance-inputs.mjs";
import { readAssuranceFile } from "../../../scripts/assurance-files.mjs";
import { assertFinalConvergenceRepositoryRoot, finalConvergenceRepositoryPath, finalConvergenceRepositoryRoot } from "./repository-root.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";
import { verifyCurrentReviewAssurance } from "./current-review-assurance.mjs";

const ROOT = finalConvergenceRepositoryRoot(import.meta.url);

const PRIOR_HEAD = "2ac31f795ad4d7a8ad38ab7fd0cea4c784a5e8fe";
const CURRENT_HEAD = "7046246c88b32487def30e96fffa4b2a740e0005";
const SURFACE_DIGEST = "ef19f57e568927046de8ae5560321ded947c70e0d921b09cd6fc72e0f5a069c0";
const CURRENT_PRODUCT_HEAD = "0e9214af91ecf326e94ec77b1e9727087be78eb9";
const CURRENT_INTEGRATED_SURFACE_DIGEST = "9cdd7329e0fcd9b0683315c8813c82e41f5ba3373dca8ef0f6e6b6c2a286cdcb";
const REPORT_FILE = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const FIELD_FILE = "formal/implementation-conformance/FIELD_CLASSIFICATION.json";
const BASE_VALUE = "experiments/tla-conformance/final-convergence/baseline-v309-before-r170-pristine-repro.json";
const BASE_PRODUCER = "experiments/tla-conformance/final-convergence/baseline-a121-b58-before-r170-pristine-repro.json";
const EXPECTED_REPAIR_DELTA = Object.freeze([
  "AGENT_DIARY.md",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  "formal/implementation-conformance/FIELD_CLASSIFICATION.json",
  "formal/implementation-conformance/IMPLEMENTATION_CONFORMANCE.md",
  "scripts/formal-implementation-surface.cjs",
]);
const EXPECTED_AFFECTED = Object.freeze([
  Object.freeze({ surfaceKey: "export:.#cutoverInventoryAuthority::call[0]", mode: "A" }),
]);

function git(args, repositoryRoot) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
function readJson(file, repositoryRoot) {
  return JSON.parse(readAssuranceFile(repositoryRoot, file).toString("utf8"));
}
function ref(file, repositoryRoot) {
  return { file, sha256: sha256(readAssuranceFile(repositoryRoot, file)) };
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function contentSha(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}
function rowsWith(artifactFile, file, repositoryRoot) {
  return readJson(artifactFile, repositoryRoot).proofs
    .filter((proof) => assuranceProofReferencesExactPath(proof, file))
    .map((proof) => ({ surfaceKey: proof.surfaceKey, mode: proof.mode ?? "V" }))
    .sort((left, right) => left.surfaceKey.localeCompare(right.surfaceKey));
}

export function buildR170PristineReproTransport({ repositoryRoot = ROOT } = {}) {
  const root = assertFinalConvergenceRepositoryRoot(repositoryRoot, import.meta.url);
  const integrationHead = git(["rev-parse", "HEAD"], root);
  try {
    git(["merge-base", "--is-ancestor", CURRENT_HEAD, integrationHead], root);
  } catch {
    throw new Error("Integrated proof head no longer descends from the R170 pristine-repro repair commit.");
  }
  const exactRepairDelta = git(["diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD], root).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(exactRepairDelta, [...EXPECTED_REPAIR_DELTA].sort(), "R170 pristine-repro repair delta widened or narrowed.");
  assert.deepEqual(
    git(["diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD, "--", "src"], root).split(/\r?\n/u).filter(Boolean),
    [],
    "R170 pristine-repro repair unexpectedly changed product runtime source.",
  );
  const currentReviewAssurance = verifyCurrentReviewAssurance(root);
  const certifiedHead = currentReviewAssurance.receipt.certifiedHead;
  assertAssuranceCommitChain(root, [PRIOR_HEAD, CURRENT_HEAD, certifiedHead]);
  try {
    git(["merge-base", "--is-ancestor", CURRENT_PRODUCT_HEAD, certifiedHead], root);
  } catch {
    throw new Error("Current review assurance no longer descends from the reviewed product repair head.");
  }
  assert.deepEqual(
    git(["diff", "--name-only", CURRENT_PRODUCT_HEAD, certifiedHead, "--", "src"], root).split(/\r?\n/u).filter(Boolean),
    [],
    "Current review assurance certified product runtime bytes beyond the reviewed product repair head.",
  );
  const postRepairAuthoritative = git([
    "diff", "--name-only", CURRENT_HEAD, certifiedHead, "--",
    "src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json",
  ], root).split(/\r?\n/u).filter(Boolean).sort();
  assert(postRepairAuthoritative.length > 0, "Current review assurance must explicitly transport authoritative bytes after the historical pristine-repro repair.");

  const surface = discoverCompilerSurface(root);
  assert.equal(surface.digest, CURRENT_INTEGRATED_SURFACE_DIGEST, "Integrated 535-callable surface no longer matches the current reviewed product head.");
  assert.equal(surface.callables.length, 535);

  const valueAffected = [];
  const producerAffected = [];
  for (const file of [...EXPECTED_REPAIR_DELTA, REPORT_FILE]) {
    valueAffected.push(...rowsWith(BASE_VALUE, file, root));
    producerAffected.push(...rowsWith(BASE_PRODUCER, file, root));
  }
  const uniqueValue = [...new Map(valueAffected.map((row) => [row.surfaceKey, row])).values()].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
  const uniqueProducer = [...new Map(producerAffected.map((row) => [row.surfaceKey, row])).values()].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
  assert.deepEqual(uniqueValue, [], "R170 pristine-repro repair unexpectedly invalidated a strict V row.");
  assert.deepEqual(uniqueProducer, EXPECTED_AFFECTED, "R170 pristine-repro strict-row dependency closure changed.");
  assert.deepEqual(rowsWith(BASE_PRODUCER, REPORT_FILE, root), EXPECTED_AFFECTED);

  const fields = readJson(FIELD_FILE, root);
  assert.equal(fields.surfaceSha256, currentReviewAssurance.receipt.surfaceSha256);
  const declarations = [...new Set(Object.values(fields.entries).map((entry) => entry.declaration))].sort();
  const external = declarations.filter((declaration) => declaration.startsWith("external:"));
  assert.deepEqual(external, [
    "external:typescript/lib/lib.es2022.error.d.ts#0a3d63ef2b85",
    "external:typescript/lib/lib.es5.d.ts#c430d4466628",
  ]);
  assert.equal(declarations.some((declaration) => declaration.includes("../InventoryOnce")), false);
  assert.equal(declarations.some((declaration) => declaration.includes("node_modules/.pnpm")), false);

  const core = {
    schemaVersion: 1,
    status: "R170_PRISTINE_REPRO_ASSURANCE_TRANSPORT_PROVED",
    priorHead: PRIOR_HEAD,
    currentHead: CURRENT_HEAD,
    surfaceDigest: SURFACE_DIGEST,
    currentSurfaceDigest: surface.digest,
    implementationSurfaceDigest: currentReviewAssurance.receipt.surfaceSha256,
    exactRepairFiles: EXPECTED_REPAIR_DELTA,
    postRepairAuthoritativeFiles: postRepairAuthoritative,
    productSourceChanged: false,
    affectedStrictRows: uniqueProducer,
    affectedValueRows: uniqueValue,
    assurance: {
      currentReview: currentReviewAssurance.reference,
      historicalReportDependency: REPORT_FILE,
      fullFormal: true,
      apiEntries: 510,
      unresolvedPublicApis: 0,
    },
    externalDeclarationProvenance: {
      fieldManifest: ref(FIELD_FILE, root),
      declarations: external,
      worktreeIndependent: true,
      externalBytesBound: true,
    },
    baselineArtifacts: [ref(BASE_VALUE, root), ref(BASE_PRODUCER, root)],
    producerGraphRuns: 0,
    producerReplayRuns: 0,
    reverseReruns: 0,
    creditExpansion: false,
  };
  return { ...core, contentSha256: contentSha(core) };
}

const directInvocation =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) {
  if (!process.argv.includes("--check")) {
    throw new Error(
      "R170 pristine-repro historical assurance transport is immutable; direct execution requires --check."
    );
  }
  const root = ROOT;
  const current = verifyCurrentReviewAssurance(root);
  const artifact = checkFrozenAssuranceTransport(
    root,
    "experiments/tla-conformance/final-convergence/r170-pristine-repro-transport.json",
    current.receipt.certifiedHead
  );
  console.log(
    JSON.stringify(
      {
        status: artifact.status,
        contentSha256: artifact.contentSha256,
        historicalReceiptVerified: true,
      },
      null,
      2
    )
  );
}
