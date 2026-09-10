import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalJson, discoverCompilerSurface, sha256 } from "../surface-bindings/lib/compiler-surface.mjs";
import * as before from "./formal-models-428f50a.mjs";
import * as current from "../../../scripts/formal-models.mjs";

export const PRIOR_HEAD = "428f50a0abdf1dec0d96d36419d51df106247044";
export const CURRENT_HEAD = "0c94ee9925a0785a883241b2e6ed843e50aeb5ac";
export const SURFACE_DIGEST = "ec078013972d9ee2b4ba84d28cfa7449a18dc29679d81766e314db6a6139b81e";
const PRIOR_FORMAL = "experiments/tla-conformance/final-convergence/formal-models-428f50a.mjs";
const CURRENT_FORMAL = "scripts/formal-models.mjs";
const BASE_VALUE = "experiments/tla-conformance/final-convergence/baseline-v309-before-r165-transport.json";
const BASE_PRODUCER = "experiments/tla-conformance/final-convergence/baseline-a121-b58-before-r165-transport.json";
const EXPECTED_DELTA = Object.freeze([
  "AGENT_DIARY.md",
  "scripts/formal-models.mjs",
  "scripts/formal-proof-cache.selftest.mjs",
  "scripts/run-formal.mjs",
  "test/transfer-lifecycle.test.ts",
]);
const OTHER_CHANGED = Object.freeze(EXPECTED_DELTA.filter((file) => file !== CURRENT_FORMAL));
const POST_R165_REVIEW_HEAD = "d947e47af2502f2ed2f8ae6971ee639a91ff0867";
const POST_R165_TRACKED_DELTA = Object.freeze([
  "formal/FOUNDATIONS.md",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json",
  "scripts/formal-proof-cache.mjs",
  "scripts/formal-proof-cache.selftest.mjs",
  "scripts/run-formal.mjs",
  "src/deficits.ts",
  "test/review-hardening.test.ts",
]);
const REPORT_FILE = "formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json";
const R167_ASSURANCE_RECEIPT = "experiments/tla-conformance/final-convergence/r167-product-assurance-receipt.json";
const R167_ASSURANCE_LOG = "experiments/tla-conformance/final-convergence/product-assurance-full-d947.log";
const POST_R165_ASSURANCE_ONLY = Object.freeze(POST_R165_TRACKED_DELTA.filter((file) => file !== "src/deficits.ts" && file !== REPORT_FILE));
const AFFECTED_ROW = "type:src/facade.ts#InventoryOnceStockApi.reclassifyMany::call[0]";
const REPORT_AFFECTED_ROW = "export:.#cutoverInventoryAuthority::call[0]";
function git(args){return execFileSync("git",args,{cwd:process.cwd(),encoding:"utf8",maxBuffer:16*1024*1024}).trim();}
function ref(file){const bytes=fs.readFileSync(path.resolve(file));return{file,sha256:sha256(bytes)};}
function readJson(file){return JSON.parse(fs.readFileSync(path.resolve(file),"utf8"));}
function rowsWith(file,needle){const a=JSON.parse(fs.readFileSync(file,"utf8"));return a.proofs.filter((proof)=>JSON.stringify(proof).includes(needle)).map((proof)=>({surfaceKey:proof.surfaceKey,mode:proof.mode??"V"})).sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));}
function cfgSemantics(module){const files=fs.readdirSync("formal").filter((file)=>file.endsWith(".cfg")).sort();return files.map((file)=>({file,checks:module.formalConfigCheckNames(fs.readFileSync(path.join("formal",file),"utf8"))}));}
export function buildR165AssuranceTransport(){
  const integrationHead=git(["rev-parse","HEAD"]);
  try { git(["merge-base","--is-ancestor",CURRENT_HEAD,integrationHead]); } catch { throw new Error("Integrated proof commit no longer descends from the R165 PR head."); }
  const laterTracked=git(["diff","--name-only",CURRENT_HEAD,integrationHead,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"]).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(laterTracked,[...POST_R165_TRACKED_DELTA].sort(),"Post-R165 authoritative reviewed product/assurance delta widened.");
  const exactReviewedDelta=git(["diff","--name-only",CURRENT_HEAD,POST_R165_REVIEW_HEAD,"--","src","formal","scripts","test","package.json","tsconfig.json","tsconfig.test.json"]).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(exactReviewedDelta,laterTracked,"Integrated proof tree no longer matches exact d947 reviewed bytes.");
  const changed=git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD]).split(/\r?\n/u).filter(Boolean).sort();
  assert.deepEqual(changed,EXPECTED_DELTA,"R165 current-head delta widened.");
  const srcChanged=git(["diff","--name-only",PRIOR_HEAD,CURRENT_HEAD,"--","src"]).split(/\r?\n/u).filter(Boolean);
  assert.deepEqual(srcChanged,[],"R165 unexpectedly changed product source.");
  assert.equal(discoverCompilerSurface(process.cwd()).digest,SURFACE_DIGEST,"R165 changed the 535-callable semantic surface.");
  const priorBytes=fs.readFileSync(PRIOR_FORMAL,"utf8"),currentBytes=fs.readFileSync(CURRENT_FORMAL,"utf8");
  assert(currentBytes.startsWith(priorBytes),"R165 formal registry is not an exact prior-byte prefix plus maintenance validation.");
  assert(currentBytes.slice(priorBytes.length).includes("assertFormalMutationRegistrationConsistency"));
  assert.deepEqual(current.formalModels,before.formalModels);
  assert.deepEqual(current.formalInvariantMutationChecks,before.formalInvariantMutationChecks);
  assert.deepEqual(current.statefulOperationFamilyIds,before.statefulOperationFamilyIds);
  assert.deepEqual(cfgSemantics(current),cfgSemantics(before));
  current.assertFormalMutationRegistrationConsistency((config)=>fs.readFileSync(path.join("formal",`${config}.cfg`),"utf8"));
  const valueAffected=rowsWith(BASE_VALUE,CURRENT_FORMAL);
  const producerAffected=rowsWith(BASE_PRODUCER,CURRENT_FORMAL);
  assert.deepEqual(valueAffected,[]);
  assert.deepEqual(producerAffected,[{surfaceKey:AFFECTED_ROW,mode:"A"}]);
  for(const file of OTHER_CHANGED){
    assert.deepEqual(rowsWith(BASE_VALUE,file),[],`V309 unexpectedly consumes ${file}`);
    assert.deepEqual(rowsWith(BASE_PRODUCER,file),[],`A/B unexpectedly consumes ${file}`);
  }
  for(const file of POST_R165_ASSURANCE_ONLY){
    assert.deepEqual(rowsWith(BASE_VALUE,file),[],`V309 unexpectedly consumes post-R165 assurance file ${file}`);
    assert.deepEqual(rowsWith(BASE_PRODUCER,file),[],`A/B unexpectedly consumes post-R165 assurance file ${file}`);
  }
  assert.deepEqual(rowsWith(BASE_VALUE,"src/deficits.ts"),[]);
  assert.deepEqual(rowsWith(BASE_PRODUCER,"src/deficits.ts"),[{surfaceKey:AFFECTED_ROW,mode:"A"}]);
  const reportAffectedValue=rowsWith(BASE_VALUE,REPORT_FILE);
  const reportAffectedProducer=rowsWith(BASE_PRODUCER,REPORT_FILE);
  assert.deepEqual(reportAffectedValue,[]);
  assert.deepEqual(reportAffectedProducer,[{surfaceKey:REPORT_AFFECTED_ROW,mode:"A"}]);
  const assuranceReceipt=readJson(R167_ASSURANCE_RECEIPT);
  const currentReport=readJson(REPORT_FILE);
  assert.equal(assuranceReceipt.status,"D947_EXACT_PRODUCT_ASSURANCE_VERIFIED");
  assert.equal(assuranceReceipt.reviewedHead,POST_R165_REVIEW_HEAD);
  assert.equal(assuranceReceipt.parentHead,CURRENT_HEAD);
  assert.deepEqual(assuranceReceipt.report.file,REPORT_FILE);
  assert.equal(assuranceReceipt.report.sha256,ref(REPORT_FILE).sha256);
  assert.equal(assuranceReceipt.fullLog.sha256,ref(R167_ASSURANCE_LOG).sha256);
  assert.equal(currentReport.repositoryHead,CURRENT_HEAD);
  assert.equal(currentReport.repositoryStateSha256,assuranceReceipt.observedRepositoryStateSha256);
  assert.equal(currentReport.fullLogSha256,assuranceReceipt.fullLog.sha256);
  assert.equal(currentReport.fullFormal,true);
  assert.equal(currentReport.compilerCallGraphWitnessedApis,510);
  assert.equal(currentReport.compilerCallGraphUnresolvedApis,0);
  const affectedStrictRows=[...producerAffected,...reportAffectedProducer].sort((a,b)=>a.surfaceKey.localeCompare(b.surfaceKey));
  const core={schemaVersion:1,status:"R165_PLUS_R167_ASSURANCE_TRANSPORT_PROVED",priorHead:PRIOR_HEAD,currentHead:CURRENT_HEAD,surfaceDigest:SURFACE_DIGEST,exactChangedFiles:EXPECTED_DELTA,productSourceChanged:false,formalRegistry:{before:ref(PRIOR_FORMAL),after:ref(CURRENT_FORMAL),priorBytesAreExactPrefix:true,formalModels:structuredClone(current.formalModels),formalInvariantMutationChecks:structuredClone(current.formalInvariantMutationChecks),statefulOperationFamilyIds:structuredClone(current.statefulOperationFamilyIds),formalConfigCheckNamesAcrossCfgs:cfgSemantics(current),rule:"R165 appends only fail-fast mutation tuple consistency validation; registered models, mutation tuples, stateful families, and cfg check parsing remain identical."},affectedStrictRows,affectedValueRows:valueAffected,otherR165ProofInputs:[],postR165ReviewedDelta:{head:POST_R165_REVIEW_HEAD,trackedFiles:POST_R165_TRACKED_DELTA,assuranceFilesWithStrictProofInputs:[{file:REPORT_FILE,rows:reportAffectedProducer,evidence:ref(R167_ASSURANCE_RECEIPT),fullLog:ref(R167_ASSURANCE_LOG)}],productSourceFileHandledByFinalHeadTransport:"src/deficits.ts"},producerGraphRuns:0,producerReplayRuns:0,reverseReruns:0,tlcRuns:0,creditExpansion:false,baselineArtifacts:[ref(BASE_VALUE),ref(BASE_PRODUCER),ref(R167_ASSURANCE_RECEIPT),ref(R167_ASSURANCE_LOG)]};
  return{...core,contentSha256:sha256(canonicalJson(core))};
}
if(process.argv[1]!==undefined&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=buildR165AssuranceTransport(),file="experiments/tla-conformance/final-convergence/r165-assurance-transport.json",text=`${JSON.stringify(a,null,2)}\n`;
  if(process.argv.includes("--check"))assert.equal(fs.readFileSync(file,"utf8"),text,"R165 assurance transport is stale.");else fs.writeFileSync(file,text);
  console.log(JSON.stringify({status:a.status,contentSha256:a.contentSha256,affectedStrictRows:a.affectedStrictRows,affectedValueRows:a.affectedValueRows},null,2));
}
