import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";

const PRIOR_HEAD = "6fb8465f29d1929a13c7d948f85d2c8bce2d5d84";
const CURRENT_HEAD = "5584d6e84fd5737a3a24f73daa57115602c3460d";
const SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
const BASE_VALUE = "experiments/tla-conformance/final-convergence/baseline-v309-before-r169-transport.json";
const BASE_PRODUCER = "experiments/tla-conformance/final-convergence/baseline-a121-b58-before-r169-transport.json";
const REPORT_FILE = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const PACKAGING_MODEL = "formal/PackagingIdentity.tla";
const EXPECTED_REPAIR_DELTA = Object.freeze([
  "formal/PackagingIdentity.tla",
  "formal/README.md",
  "formal/RecordedDeficit.tla",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
  "formal/implementation-conformance/FIELD_CLASSIFICATION.json",
  "formal/implementation-conformance/IMPLEMENTATION_CONFORMANCE.md",
  "scripts/audit-formal-implementation-conformance.mjs",
  "scripts/executable-assurance-coherence.mjs",
  "scripts/executable-assurance-coherence.selftest.mjs",
  "scripts/formal-implementation-surface.cjs",
  "test/formal-implementation-conformance.test.ts",
  "test/r47-concurrent-completion-peer.test.ts",
]);
const EXPECTED_AFFECTED = Object.freeze([
  Object.freeze({ surfaceKey: "export:.#cutoverInventoryAuthority::call[0]", mode: "A" }),
  Object.freeze({ surfaceKey: "type:src/facade.ts#InventoryOnceStockApi.reclassifyMany::call[0]", mode: "A" }),
]);
/** Run one Git query inside the explicitly supplied repository root. */
function git(args, repositoryRoot){ return execFileSync("git", args, { cwd:repositoryRoot, encoding:"utf8", maxBuffer:64*1024*1024 }).trim(); }
/** Read one repository-relative JSON artifact from the same evidence tree. */
function readJson(file, repositoryRoot){ return JSON.parse(fs.readFileSync(path.resolve(repositoryRoot,file),"utf8")); }
/** Capture one repository-relative artifact hash without consulting process cwd. */
function ref(file, repositoryRoot){ const bytes=fs.readFileSync(path.resolve(repositoryRoot,file)); return { file, sha256:sha256(bytes) }; }
/** Produce deterministic JSON text for transport content hashing. */
function canonical(value){ if(Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if(value!==null&&typeof value==="object") return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; return JSON.stringify(value); }
/** Hash one canonical transport payload. */
function contentSha(value){ return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
/** Find strict rows whose frozen semantics reference one exact repair file. */
function rowsWith(artifactFile, file, repositoryRoot){ return readJson(artifactFile,repositoryRoot).proofs.filter(p=>JSON.stringify(p).includes(file)).map(p=>({surfaceKey:p.surfaceKey,mode:p.mode??"V"})).sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey)); }
/** Build the R169 assurance transport entirely from one explicitly selected repository tree. */
export function buildR169AssuranceTransport({ repositoryRoot=process.cwd() }={}) {
  const root=path.resolve(repositoryRoot);
  const integrationHead=git(["rev-parse","HEAD"],root);
  // Fail closed if the inspected tree does not descend from the reviewed R169 repair.
  try { git(["merge-base","--is-ancestor",CURRENT_HEAD,integrationHead],root); } catch { throw new Error("Integrated proof head no longer descends from the R169 repair commit."); }
  const repairDelta=git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"],root).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(repairDelta,[...EXPECTED_REPAIR_DELTA].sort(),"R169 reviewed repair delta widened.");
  assert.deepEqual(git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD,"--","src"],root).split(/\r?\n/u).filter(Boolean),[],"R169 unexpectedly changed product runtime source.");
  const afterRepair=git(["diff","--name-only",CURRENT_HEAD,integrationHead,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"],root).split(/\r?\n/u).filter(Boolean).sort();
  // The repair commit itself has one generated report pending; descendants may only integrate that report.
  if(integrationHead===CURRENT_HEAD){ assert.deepEqual(afterRepair,[]); assert.deepEqual(git(["diff","--name-only","HEAD","--",REPORT_FILE],root).split(/\r?\n/u).filter(Boolean),[REPORT_FILE],"R169 current-head assurance report must be freshly generated before proof integration."); } else { assert.deepEqual(afterRepair,[REPORT_FILE],"Post-R169 proof integration changed authoritative bytes beyond the exact generated assurance report."); }
  const surface=discoverCompilerSurface(root);
  assert.equal(surface.digest,SURFACE_DIGEST); assert.equal(surface.callables.length,535);
  const valueAffected=[]; const producerAffected=[];
  for(const file of EXPECTED_REPAIR_DELTA){ valueAffected.push(...rowsWith(BASE_VALUE,file,root)); producerAffected.push(...rowsWith(BASE_PRODUCER,file,root)); }
  const uniqueValue=[...new Map(valueAffected.map(r=>[r.surfaceKey,r])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  const uniqueProducer=[...new Map(producerAffected.map(r=>[r.surfaceKey,r])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  assert.deepEqual(uniqueValue,[]); assert.deepEqual(uniqueProducer,[...EXPECTED_AFFECTED].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey)));
  assert.deepEqual(rowsWith(BASE_PRODUCER,REPORT_FILE,root),[EXPECTED_AFFECTED[0]]);
  assert.deepEqual(rowsWith(BASE_PRODUCER,PACKAGING_MODEL,root),[EXPECTED_AFFECTED[1]]);
  const report=readJson(REPORT_FILE,root);
  assert.equal(report.repositoryHead,CURRENT_HEAD); assert.equal(report.fullFormal,true); assert.equal(report.compilerCallGraphWitnessedApis,510); assert.equal(report.compilerCallGraphUnresolvedApis,0);
  assert.match(report.repositoryStateSha256,/^[a-f0-9]{64}$/u,"R169 assurance report lacks a repository-state hash.");
  assert.match(report.fullLogSha256,/^[a-f0-9]{64}$/u,"R169 assurance report lacks a full-formal log hash.");
  const packaging=fs.readFileSync(path.resolve(root,PACKAGING_MODEL),"utf8");
  for(const token of ["a20v1","a20v2","b20v1","b20v2"]) assert(packaging.includes(token),`PackagingIdentity missing distinct equal-count revision token ${token}`);
  const core={schemaVersion:1,status:"R169_CURRENT_HEAD_ASSURANCE_TRANSPORT_PROVED",priorHead:PRIOR_HEAD,currentHead:CURRENT_HEAD,surfaceDigest:SURFACE_DIGEST,exactRepairFiles:EXPECTED_REPAIR_DELTA,postRepairAuthoritativeFiles:[REPORT_FILE],productSourceChanged:false,affectedStrictRows:uniqueProducer,affectedValueRows:uniqueValue,assurance:{report:ref(REPORT_FILE,root),repositoryStateSha256:report.repositoryStateSha256,fullLogSha256:report.fullLogSha256,fullFormal:true,apiEntries:510,unresolvedPublicApis:0},packagingIdentity:{file:PACKAGING_MODEL,evidence:ref(PACKAGING_MODEL,root),distinctEqualCountRevisions:true},baselineArtifacts:[ref(BASE_VALUE,root),ref(BASE_PRODUCER,root)],producerGraphRuns:0,producerReplayRuns:0,reverseReruns:0,creditExpansion:false};
  return {...core,contentSha256:contentSha(core)};
}
if(process.argv[1]!==undefined && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){ const artifact=buildR169AssuranceTransport(); const target="experiments/tla-conformance/final-convergence/r169-assurance-transport.json"; const text=`${JSON.stringify(artifact,null,2)}\n`; if(process.argv.includes("--check")) assert.equal(fs.readFileSync(target,"utf8"),text,"R169 assurance transport is stale."); else fs.writeFileSync(target,text); console.log(JSON.stringify({status:artifact.status,contentSha256:artifact.contentSha256,affectedStrictRows:artifact.affectedStrictRows,affectedValueRows:artifact.affectedValueRows},null,2)); }
