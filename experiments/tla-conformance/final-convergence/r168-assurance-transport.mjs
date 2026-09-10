import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { canonicalJson, discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";

export const PRIOR_HEAD = "d947e47af2502f2ed2f8ae6971ee639a91ff0867";
export const CURRENT_HEAD = "e1759f756a9e7de5d67e7c03d563f6f574892e26";
export const SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
const PRIOR_TRANSPORT = "experiments/tla-conformance/final-convergence/r165-assurance-transport.json";
const BASE_VALUE = "experiments/tla-conformance/final-convergence/baseline-v309-before-r168-transport.json";
const BASE_PRODUCER = "experiments/tla-conformance/final-convergence/baseline-a121-b58-before-r168-transport.json";
const ASSURANCE_RECEIPT = "experiments/tla-conformance/final-convergence/r168-product-assurance-receipt.json";
const ASSURANCE_LOG = "experiments/tla-conformance/final-convergence/product-assurance-full-e175.log";
const REPORT_FILE = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const RESOURCE_DIMENSIONS = "formal/ResourceDimensions.tla";
const AUTHORITY_CENSUS = "test/authority-durable-shape.test.ts";
const EXPECTED_DELTA = Object.freeze([
  "formal/ResourceDimensions.tla",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
  "formal/implementation-conformance/IMPLEMENTATION_CONFORMANCE.md",
  "formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json",
  "scripts/audit-formal-implementation-conformance.mjs",
  "scripts/executable-assurance-coherence.mjs",
  "scripts/executable-assurance-coherence.selftest.mjs",
  "scripts/generate-formal-implementation-assurance.py",
  "test/authority-durable-shape.test.ts",
  "test/formal-implementation-conformance.test.ts",
  "test/r47-concurrent-completion-peer.test.ts",
]);
const EXPECTED_AFFECTED = Object.freeze([
  Object.freeze({ surfaceKey: "export:.#cutoverInventoryAuthority::call[0]", mode: "A" }),
  Object.freeze({ surfaceKey: "type:src/authority.ts#InventoryAuthorityControl.read::call[0]", mode: "B" }),
]);

function git(args, repositoryRoot) { return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim(); }
function readJson(file, repositoryRoot) { return JSON.parse(fs.readFileSync(path.resolve(repositoryRoot, file), "utf8")); }
function ref(file, repositoryRoot) { const bytes = fs.readFileSync(path.resolve(repositoryRoot, file)); return { file, sha256: sha256(bytes) }; }
function rowsWith(artifactFile, file, repositoryRoot) {
  const artifact = readJson(artifactFile, repositoryRoot);
  return artifact.proofs
    .filter((proof) => JSON.stringify(proof).includes(file))
    .map((proof) => ({ surfaceKey: proof.surfaceKey, mode: proof.mode ?? "V" }))
    .sort((a, b) => a.surfaceKey.localeCompare(b.surfaceKey));
}
function stripTlaLineComments(text) {
  return text.split(/\r?\n/u).filter((line) => !line.trimStart().startsWith("\\*")).join("\n");
}

export function buildR168AssuranceTransport({ repositoryRoot = process.cwd() } = {}) {
  const root = path.resolve(repositoryRoot);
  const integrationHead = git(["rev-parse", "HEAD"], root);
  const reviewedDelta = git([
    "diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD, "--",
    "src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json",
  ], root).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(reviewedDelta, [...EXPECTED_DELTA].sort(), "R168 reviewed product/assurance delta widened.");
  try {
    git(["merge-base", "--is-ancestor", CURRENT_HEAD, integrationHead], root);
  } catch {
    throw new Error("Integrated proof head no longer descends from the R168 reviewed commit.");
  }
  const integratedDelta = git([
    "diff", "--name-only", CURRENT_HEAD, integrationHead, "--",
    "src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json",
  ], root).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(integratedDelta, [], "Integrated proof tree changed reviewed product/assurance bytes after R168.");
  assert.deepEqual(
    git(["diff", "--name-only", PRIOR_HEAD, CURRENT_HEAD, "--", "src"], root).split(/\r?\n/u).filter(Boolean),
    [],
    "R168 unexpectedly changed product runtime source.",
  );
  const surface = discoverCompilerSurface(root);
  assert.equal(surface.digest, SURFACE_DIGEST);
  assert.equal(surface.callables.length, 535);

  const priorTransport = readJson(PRIOR_TRANSPORT, root);
  assert.equal(priorTransport.status, "R165_PLUS_R167_ASSURANCE_TRANSPORT_PROVED");
  assert.equal(priorTransport.postR165ReviewedDelta.head, PRIOR_HEAD);
  const priorProducer = readJson(BASE_PRODUCER, root);
  for (const row of priorTransport.affectedStrictRows) {
    const proof = priorProducer.proofs.find((candidate) => candidate.surfaceKey === row.surfaceKey && candidate.mode === row.mode);
    assert(proof !== undefined, `Prior d947 strict row missing ${row.surfaceKey}`);
    assert.deepEqual(
      proof.semantics.currentHeadAssuranceTransport,
      {
        ...ref(PRIOR_TRANSPORT, root),
        contentSha256: priorTransport.contentSha256,
        affectedStrictRows: priorTransport.affectedStrictRows,
        affectedValueRows: priorTransport.affectedValueRows,
      },
      `Prior d947 strict row lost frozen maintenance transport: ${row.surfaceKey}`,
    );
  }

  const valueAffected = [];
  const producerAffected = [];
  for (const file of EXPECTED_DELTA) {
    valueAffected.push(...rowsWith(BASE_VALUE, file, root));
    producerAffected.push(...rowsWith(BASE_PRODUCER, file, root));
  }
  const uniqueValue = [...new Map(valueAffected.map((row) => [row.surfaceKey, row])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  const uniqueProducer = [...new Map(producerAffected.map((row) => [row.surfaceKey, row])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  assert.deepEqual(uniqueValue, []);
  assert.deepEqual(uniqueProducer, EXPECTED_AFFECTED);
  assert.deepEqual(rowsWith(BASE_PRODUCER, REPORT_FILE, root), [EXPECTED_AFFECTED[0]]);
  assert.deepEqual(rowsWith(BASE_PRODUCER, AUTHORITY_CENSUS, root), [EXPECTED_AFFECTED[1]]);
  for (const file of EXPECTED_DELTA.filter((file) => ![REPORT_FILE, AUTHORITY_CENSUS].includes(file))) {
    assert.deepEqual(rowsWith(BASE_PRODUCER, file, root), [], `A/B unexpectedly consumes R168 file ${file}`);
  }

  const beforeResource = execFileSync("git", ["show", `${PRIOR_HEAD}:${RESOURCE_DIMENSIONS}`], { cwd: root, encoding: "utf8" });
  const afterResource = fs.readFileSync(path.resolve(root, RESOURCE_DIMENSIONS), "utf8");
  assert.equal(
    stripTlaLineComments(beforeResource),
    stripTlaLineComments(afterResource),
    "ResourceDimensions R168 delta exceeded line-comment documentation.",
  );

  const receipt = readJson(ASSURANCE_RECEIPT, root);
  const report = readJson(REPORT_FILE, root);
  assert.equal(receipt.status, "E175_EXACT_PRODUCT_ASSURANCE_VERIFIED");
  assert.equal(receipt.reviewedHead, CURRENT_HEAD);
  assert.equal(receipt.parentHead, PRIOR_HEAD);
  assert.equal(receipt.report.sha256, ref(REPORT_FILE, root).sha256);
  assert.equal(receipt.fullLog.sha256, ref(ASSURANCE_LOG, root).sha256);
  assert.equal(report.repositoryHead, PRIOR_HEAD);
  assert.equal(report.repositoryStateSha256, receipt.observedRepositoryStateSha256);
  assert.equal(report.fullLogSha256, receipt.fullLog.sha256);
  assert.equal(report.fullFormal, true);
  assert.equal(report.compilerCallGraphWitnessedApis, 510);
  assert.equal(report.compilerCallGraphUnresolvedApis, 0);

  const core = {
    schemaVersion: 1,
    status: "R168_ASSURANCE_MAINTENANCE_TRANSPORT_PROVED",
    priorHead: PRIOR_HEAD,
    currentHead: CURRENT_HEAD,
    surfaceDigest: SURFACE_DIGEST,
    exactChangedFiles: EXPECTED_DELTA,
    productSourceChanged: false,
    affectedStrictRows: uniqueProducer,
    affectedValueRows: uniqueValue,
    resourceDimensions: {
      file: RESOURCE_DIMENSIONS,
      beforeSha256: sha256(Buffer.from(beforeResource)),
      after: ref(RESOURCE_DIMENSIONS, root),
      semanticDelta: "LINE_COMMENTS_ONLY",
    },
    assurance: {
      receipt: ref(ASSURANCE_RECEIPT, root),
      fullLog: ref(ASSURANCE_LOG, root),
      report: ref(REPORT_FILE, root),
      repositoryStateSha256: receipt.observedRepositoryStateSha256,
      fullFormal: true,
      apiEntries: 510,
      unresolvedPublicApis: 0,
    },
    priorMaintenanceTransport: ref(PRIOR_TRANSPORT, root),
    producerGraphRuns: 0,
    producerReplayRuns: 0,
    reverseReruns: 0,
    creditExpansion: false,
    baselineArtifacts: [ref(BASE_VALUE, root), ref(BASE_PRODUCER, root)],
  };
  return { ...core, contentSha256: sha256(canonicalJson(core)) };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const artifact = buildR168AssuranceTransport({ repositoryRoot: root });
  const target = path.resolve(root, "experiments/tla-conformance/final-convergence/r168-assurance-transport.json");
  const text = `${JSON.stringify(artifact, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    assert.equal(fs.readFileSync(target, "utf8"), text, "R168 assurance transport is stale.");
  } else {
    fs.writeFileSync(target, text);
  }
  console.log(JSON.stringify({ status: artifact.status, contentSha256: artifact.contentSha256, affectedStrictRows: artifact.affectedStrictRows }, null, 2));
}
