import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";
import { verifyCurrentReviewAssurance } from "./current-review-assurance.mjs";

const PRIOR_HEAD = "e2c1ccb3be53809b8b935cf4882137a08fa08576";
const CURRENT_HEAD = "f430b5141b0afc0b2796e38bc90ef45df4c0dcd9";
const SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
const REPORT_FILE = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const BASE_VALUE = "experiments/tla-conformance/final-convergence/baseline-v309-before-r170-transport.json";
const BASE_PRODUCER = "experiments/tla-conformance/final-convergence/baseline-a121-b58-before-r170-transport.json";
const TRACEABILITY_MODEL = "formal/TraceabilityGraph.tla";
const EXPECTED_REPAIR_DELTA = Object.freeze([
  "AGENT_DIARY.md",
  "experiments/tla-conformance/final-convergence/build-base-authority-index.mjs",
  "experiments/tla-conformance/final-convergence/r169-assurance-transport.mjs",
  "experiments/tla-conformance/final-convergence/run-compact-final-assurance.mjs",
  "formal/TraceabilityGraph.tla",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/IMPLEMENTATION_CONFORMANCE.md",
  "formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json",
  "scripts/generate-formal-implementation-assurance.py",
  "test/r47-concurrent-completion-peer.test.ts",
]);
const EXPECTED_AFFECTED = Object.freeze([
  Object.freeze({ surfaceKey: "export:.#cutoverInventoryAuthority::call[0]", mode: "A" }),
  Object.freeze({ surfaceKey: "type:src/facade.ts#InventoryOnceTraceabilityApi.disaggregate::call[0]", mode: "A" }),
  Object.freeze({ surfaceKey: "type:src/facade.ts#InventoryOnceTraceabilityApi.disassociate::call[0]", mode: "A" }),
]);

/** Run Git inside the explicitly selected evidence repository. */
function git(args, repositoryRoot) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
/** Read one repository-relative JSON artifact. */
function readJson(file, repositoryRoot) {
  return JSON.parse(fs.readFileSync(path.resolve(repositoryRoot, file), "utf8"));
}
/** Hash one repository-relative artifact. */
function ref(file, repositoryRoot) {
  const bytes = fs.readFileSync(path.resolve(repositoryRoot, file));
  return { file, sha256: sha256(bytes) };
}
/** Canonicalize a transport payload before content hashing. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
/** Hash a canonical transport payload. */
function contentSha(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}
/** Find strict baseline rows whose frozen proof semantics consume one changed file. */
function rowsWith(artifactFile, file, repositoryRoot) {
  return readJson(artifactFile, repositoryRoot).proofs
    .filter((proof) => JSON.stringify(proof).includes(file))
    .map((proof) => ({ surfaceKey: proof.surfaceKey, mode: proof.mode ?? "V" }))
    .sort((left, right) => left.surfaceKey.localeCompare(right.surfaceKey));
}

/** Prove the exact R170 review repair and the narrow strict-row dependency closure it invalidated. */
export function buildR170AssuranceTransport({ repositoryRoot = process.cwd() } = {}) {
  const root = path.resolve(repositoryRoot);
  const integrationHead = git(["rev-parse", "HEAD"], root);
  try {
    git(["merge-base", "--is-ancestor", CURRENT_HEAD, integrationHead], root);
  } catch {
    throw new Error("Integrated proof head no longer descends from the R170 assurance repair commit.");
  }

  const exactRepairDelta = git(["diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD], root).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(exactRepairDelta, [...EXPECTED_REPAIR_DELTA].sort(), "R170 reviewed repair delta widened or narrowed.");
  assert.deepEqual(
    git(["diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD, "--", "src"], root).split(/\r?\n/u).filter(Boolean),
    [],
    "R170 unexpectedly changed product runtime source.",
  );

  const currentReviewAssurance = verifyCurrentReviewAssurance(root);
  const certifiedHead = currentReviewAssurance.receipt.certifiedHead;
  const afterRepair = git([
    "diff", "--name-only", CURRENT_HEAD, certifiedHead, "--",
    "src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json",
  ], root).split(/\r?\n/u).filter(Boolean).sort();
  assert(afterRepair.length > 0, "Current review assurance must explicitly transport authoritative bytes after the historical R170 repair.");

  const surface = discoverCompilerSurface(root);
  assert.equal(surface.digest, SURFACE_DIGEST);
  assert.equal(surface.callables.length, 535);

  const valueAffected = [];
  const producerAffected = [];
  for (const file of [...EXPECTED_REPAIR_DELTA, REPORT_FILE]) {
    valueAffected.push(...rowsWith(BASE_VALUE, file, root));
    producerAffected.push(...rowsWith(BASE_PRODUCER, file, root));
  }
  const uniqueValue = [...new Map(valueAffected.map((row) => [row.surfaceKey, row])).values()].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
  const uniqueProducer = [...new Map(producerAffected.map((row) => [row.surfaceKey, row])).values()].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
  assert.deepEqual(uniqueValue, [], "R170 unexpectedly invalidated a strict V row.");
  assert.deepEqual(uniqueProducer, [...EXPECTED_AFFECTED].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey)), "R170 strict-row dependency closure changed.");
  assert.deepEqual(rowsWith(BASE_PRODUCER, REPORT_FILE, root), [EXPECTED_AFFECTED[0]]);
  assert.deepEqual(
    rowsWith(BASE_PRODUCER, TRACEABILITY_MODEL, root),
    [EXPECTED_AFFECTED[1], EXPECTED_AFFECTED[2]].sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey)),
  );

  // Full-run validity is supplied by the current review receipt above; historical report hashes are not proof credit.

  const traceabilityModel = fs.readFileSync(path.resolve(root, TRACEABILITY_MODEL), "utf8");
  assert(traceabilityModel.includes("productionCount \\in 0..2"), "TraceabilityGraph lost the independent duplicate-production state.");

  const core = {
    schemaVersion: 1,
    status: "R170_CURRENT_HEAD_ASSURANCE_TRANSPORT_PROVED",
    priorHead: PRIOR_HEAD,
    currentHead: CURRENT_HEAD,
    surfaceDigest: SURFACE_DIGEST,
    exactRepairFiles: EXPECTED_REPAIR_DELTA,
    postRepairAuthoritativeFiles: afterRepair,
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
    traceabilityUniqueness: {
      file: TRACEABILITY_MODEL,
      evidence: ref(TRACEABILITY_MODEL, root),
      duplicateStateReachableUnderTypeOK: true,
    },
    baselineArtifacts: [ref(BASE_VALUE, root), ref(BASE_PRODUCER, root)],
    producerGraphRuns: 0,
    producerReplayRuns: 0,
    reverseReruns: 0,
    creditExpansion: false,
  };
  return { ...core, contentSha256: contentSha(core) };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const artifact = buildR170AssuranceTransport({ repositoryRoot: root });
  const target = path.resolve(root, "experiments/tla-conformance/final-convergence/r170-assurance-transport.json");
  const text = `${JSON.stringify(artifact, null, 2)}\n`;
  if (process.argv.includes("--check")) assert.equal(fs.readFileSync(target, "utf8"), text, "R170 assurance transport is stale.");
  else fs.writeFileSync(target, text);
  console.log(JSON.stringify({ status: artifact.status, contentSha256: artifact.contentSha256, affectedStrictRows: artifact.affectedStrictRows, affectedValueRows: artifact.affectedValueRows }, null, 2));
}
