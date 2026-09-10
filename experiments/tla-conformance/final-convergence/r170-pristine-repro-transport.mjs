import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";

const PRIOR_HEAD = "2ac31f795ad4d7a8ad38ab7fd0cea4c784a5e8fe";
const CURRENT_HEAD = "7046246c88b32487def30e96fffa4b2a740e0005";
const SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
const IMPLEMENTATION_SURFACE_DIGEST = "119914a0dd1c1e02907669aef93b2ba7305e2f66cb614d4dfa75330732268aba";
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
  return JSON.parse(fs.readFileSync(path.resolve(repositoryRoot, file), "utf8"));
}
function ref(file, repositoryRoot) {
  return { file, sha256: sha256(fs.readFileSync(path.resolve(repositoryRoot, file))) };
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
    .filter((proof) => JSON.stringify(proof).includes(file))
    .map((proof) => ({ surfaceKey: proof.surfaceKey, mode: proof.mode ?? "V" }))
    .sort((left, right) => left.surfaceKey.localeCompare(right.surfaceKey));
}

export function buildR170PristineReproTransport({ repositoryRoot = process.cwd() } = {}) {
  const root = path.resolve(repositoryRoot);
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
  const postRepairAuthoritative = git([
    "diff", "--name-only", CURRENT_HEAD, integrationHead, "--",
    "src", "formal", "scripts", "test", "package.json", "tsconfig.json", "tsconfig.test.json",
  ], root).split(/\r?\n/u).filter(Boolean).sort();
  if (integrationHead === CURRENT_HEAD) {
    assert.deepEqual(postRepairAuthoritative, []);
    assert.deepEqual(
      git(["diff", "--name-only", "HEAD", "--", REPORT_FILE], root).split(/\r?\n/u).filter(Boolean),
      [REPORT_FILE],
      "R170 pristine-repro repair head must carry a freshly generated exact-head executable assurance report before proof integration.",
    );
  } else {
    assert.deepEqual(postRepairAuthoritative, [REPORT_FILE], "Post-repair proof integration changed authoritative bytes beyond the exact generated assurance report.");
  }

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
  assert.deepEqual(uniqueValue, [], "R170 pristine-repro repair unexpectedly invalidated a strict V row.");
  assert.deepEqual(uniqueProducer, EXPECTED_AFFECTED, "R170 pristine-repro strict-row dependency closure changed.");
  assert.deepEqual(rowsWith(BASE_PRODUCER, REPORT_FILE, root), EXPECTED_AFFECTED);

  const report = readJson(REPORT_FILE, root);
  assert.equal(report.repositoryHead, CURRENT_HEAD);
  assert.equal(report.surfaceSha256, IMPLEMENTATION_SURFACE_DIGEST);
  assert.equal(report.fullFormal, true);
  assert.equal(report.compilerCallGraphWitnessedApis, 510);
  assert.equal(report.compilerCallGraphUnresolvedApis, 0);
  assert.match(report.repositoryStateSha256, /^[a-f0-9]{64}$/u);
  assert.match(report.fullLogSha256, /^[a-f0-9]{64}$/u);

  const fields = readJson(FIELD_FILE, root);
  assert.equal(fields.surfaceSha256, IMPLEMENTATION_SURFACE_DIGEST);
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
    implementationSurfaceDigest: IMPLEMENTATION_SURFACE_DIGEST,
    exactRepairFiles: EXPECTED_REPAIR_DELTA,
    postRepairAuthoritativeFiles: [REPORT_FILE],
    productSourceChanged: false,
    affectedStrictRows: uniqueProducer,
    affectedValueRows: uniqueValue,
    assurance: {
      report: ref(REPORT_FILE, root),
      repositoryStateSha256: report.repositoryStateSha256,
      fullLogSha256: report.fullLogSha256,
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

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = buildR170PristineReproTransport();
  const target = "experiments/tla-conformance/final-convergence/r170-pristine-repro-transport.json";
  const text = `${JSON.stringify(artifact, null, 2)}\n`;
  if (process.argv.includes("--check")) assert.equal(fs.readFileSync(target, "utf8"), text, "R170 pristine-repro transport receipt is stale.");
  else fs.writeFileSync(target, text);
  console.log(JSON.stringify({ status: artifact.status, contentSha256: artifact.contentSha256, affectedStrictRows: artifact.affectedStrictRows, affectedValueRows: artifact.affectedValueRows }, null, 2));
}
