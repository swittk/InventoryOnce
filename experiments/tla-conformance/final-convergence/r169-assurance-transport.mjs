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
function git(args){ return execFileSync("git", args, { encoding:"utf8", maxBuffer:64*1024*1024 }).trim(); }
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8")); }
function ref(file){ const bytes=fs.readFileSync(file); return { file, sha256:sha256(bytes) }; }
function canonical(value){ if(Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if(value!==null&&typeof value==="object") return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; return JSON.stringify(value); }
function contentSha(value){ return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
function rowsWith(artifactFile, file){ return readJson(artifactFile).proofs.filter(p=>JSON.stringify(p).includes(file)).map(p=>({surfaceKey:p.surfaceKey,mode:p.mode??"V"})).sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey)); }
export function buildR169AssuranceTransport({ repositoryRoot=process.cwd() }={}) {
  const integrationHead=git(["rev-parse","HEAD"]);
  try { git(["merge-base","--is-ancestor",CURRENT_HEAD,integrationHead]); } catch { throw new Error("Integrated proof head no longer descends from the R169 repair commit."); }
  const repairDelta=git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"]).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(repairDelta,[...EXPECTED_REPAIR_DELTA].sort(),"R169 reviewed repair delta widened.");
  assert.deepEqual(git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD,"--","src"]).split(/\r?\n/u).filter(Boolean),[],"R169 unexpectedly changed product runtime source.");
  const afterRepair=git(["diff","--name-only",CURRENT_HEAD,integrationHead,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"]).split(/\r?\n/u).filter(Boolean).sort();
  if(integrationHead===CURRENT_HEAD){ assert.deepEqual(afterRepair,[]); assert.deepEqual(git(["diff","--name-only","HEAD","--",REPORT_FILE]).split(/\r?\n/u).filter(Boolean),[REPORT_FILE],"R169 current-head assurance report must be freshly generated before proof integration."); } else { assert.deepEqual(afterRepair,[REPORT_FILE],"Post-R169 proof integration changed authoritative bytes beyond the exact generated assurance report."); }
  const surface=discoverCompilerSurface(repositoryRoot);
  assert.equal(surface.digest,SURFACE_DIGEST); assert.equal(surface.callables.length,535);
  const valueAffected=[]; const producerAffected=[];
  for(const file of EXPECTED_REPAIR_DELTA){ valueAffected.push(...rowsWith(BASE_VALUE,file)); producerAffected.push(...rowsWith(BASE_PRODUCER,file)); }
  const uniqueValue=[...new Map(valueAffected.map(r=>[r.surfaceKey,r])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  const uniqueProducer=[...new Map(producerAffected.map(r=>[r.surfaceKey,r])).values()].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  assert.deepEqual(uniqueValue,[]); assert.deepEqual(uniqueProducer,[...EXPECTED_AFFECTED].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey)));
  assert.deepEqual(rowsWith(BASE_PRODUCER,REPORT_FILE),[EXPECTED_AFFECTED[0]]);
  assert.deepEqual(rowsWith(BASE_PRODUCER,PACKAGING_MODEL),[EXPECTED_AFFECTED[1]]);
  const report=readJson(REPORT_FILE);
  assert.equal(report.repositoryHead,CURRENT_HEAD); assert.equal(report.fullFormal,true); assert.equal(report.compilerCallGraphWitnessedApis,510); assert.equal(report.compilerCallGraphUnresolvedApis,0);
  const packaging=fs.readFileSync(PACKAGING_MODEL,"utf8");
  for(const token of ["a20v1","a20v2","b20v1","b20v2"]) assert(packaging.includes(token),`PackagingIdentity missing distinct equal-count revision token ${token}`);
  const core={schemaVersion:1,status:"R169_CURRENT_HEAD_ASSURANCE_TRANSPORT_PROVED",priorHead:PRIOR_HEAD,currentHead:CURRENT_HEAD,surfaceDigest:SURFACE_DIGEST,exactRepairFiles:EXPECTED_REPAIR_DELTA,postRepairAuthoritativeFiles:[REPORT_FILE],productSourceChanged:false,affectedStrictRows:uniqueProducer,affectedValueRows:uniqueValue,assurance:{report:ref(REPORT_FILE),repositoryStateSha256:report.repositoryStateSha256,fullLogSha256:report.fullLogSha256,fullFormal:true,apiEntries:510,unresolvedPublicApis:0},packagingIdentity:{file:PACKAGING_MODEL,evidence:ref(PACKAGING_MODEL),distinctEqualCountRevisions:true},baselineArtifacts:[ref(BASE_VALUE),ref(BASE_PRODUCER)],producerGraphRuns:0,producerReplayRuns:0,reverseReruns:0,creditExpansion:false};
  return {...core,contentSha256:contentSha(core)};
}
if(process.argv[1]!==undefined && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){ const artifact=buildR169AssuranceTransport(); const target="experiments/tla-conformance/final-convergence/r169-assurance-transport.json"; const text=`${JSON.stringify(artifact,null,2)}\n`; if(process.argv.includes("--check")) assert.equal(fs.readFileSync(target,"utf8"),text,"R169 assurance transport is stale."); else fs.writeFileSync(target,text); console.log(JSON.stringify({status:artifact.status,contentSha256:artifact.contentSha256,affectedStrictRows:artifact.affectedStrictRows,affectedValueRows:artifact.affectedValueRows},null,2)); }
