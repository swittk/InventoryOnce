import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { assertCompactAssuranceCertificate } from "./executable-assurance-coherence.mjs";
import { verifyCurrentReviewLiveSource } from "../experiments/tla-conformance/final-convergence/current-review-assurance.mjs";
import { assuranceRepositoryPath, readAssuranceFile, readCompactArchive, materializeAssuranceFiles, claimAssuranceWorkspace, withAssuranceReadSession, withAssuranceFileObservation } from "./assurance-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "experiments/tla-conformance/final-convergence/";
const MANIFEST = DIRECTORY + "compact-support-manifest.json";
const CLOSURE = DIRECTORY + "authority-reference-manifest.json";
const WRAPPER = DIRECTORY + "run-compact-final-assurance.mjs";
const BUNDLE = DIRECTORY + "compact-final-verify.mjs";
const SOURCE_ENTRY = DIRECTORY + "run-final-verifier.mjs";
const PIPELINE_SELF = "scripts/compact-assurance-pipeline.mjs";
const DERIVED = new Set([MANIFEST, CLOSURE, WRAPPER, BUNDLE, DIRECTORY + "compact-final-selftest.mjs", DIRECTORY + "compact-final-registry.mjs", ...["final-head-transport.json", "final-v309.json", "final-a121-b58.json", "final-surface-bindings.json", "final-binder-report.json"].map(file => DIRECTORY + file)]);
const NO_CERTIFICATE = "0".repeat(40);
const native = Object.fromEntries(["readFileSync", "existsSync", "readdirSync", "openSync", "closeSync", "lstatSync", "statSync", "writeFileSync"].map(name => [name, fs[name]]));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const keyOf = value => sha(JSON.stringify(value));
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const git = (root, args, encoding = "utf8") => execFileSync("git", args, { cwd: root, encoding, maxBuffer: 256 * 1024 * 1024 });
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

/** This sole generated literal selects an independently immutable certificate commit; its surrounding verifier code is exact. */
function wrapperSource(anchor) {
  assert.match(anchor, /^[a-f0-9]{40}$/u);
  return `import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";\n// Updated only after successful independent pristine certification; this is verifier authority, not evidence data.\nconst COMPACT_CERTIFICATE_COMMIT = "${anchor}";\nawait runCompactCommand({ moduleUrl: import.meta.url, mode: process.argv[2] ?? "verify", certificateCommit: COMPACT_CERTIFICATE_COMMIT });\n`;
}
function certificateAnchor(root) {
  const text = native.readFileSync(assuranceRepositoryPath(root, WRAPPER), "utf8");
  const match = /const COMPACT_CERTIFICATE_COMMIT = "([a-f0-9]{40})";/u.exec(text);
  if (match === null) return NO_CERTIFICATE;
  assert.equal(text, wrapperSource(match[1]), "Compact certificate authority wrapper changed unexpectedly.");
  return match[1];
}
/** Fail closed unless one pinned compact certificate contains the exact three semantic verdicts. */
export function assertTrustedCompactCertificateManifest(manifest, expected) {
  assertCompactAssuranceCertificate(manifest?.certification, expected);
  return manifest;
}
function trustedManifest(root, anchor) {
  if (anchor === NO_CERTIFICATE) return undefined;
  git(root, ["merge-base", "--is-ancestor", anchor, "HEAD"]);
  const head = git(root, ["rev-parse", `${anchor}^`]).trim();
  const closure = JSON.parse(git(root, ["show", `${head}:${CLOSURE}`]));
  const manifest = assertTrustedCompactCertificateManifest(JSON.parse(git(root, ["show", `${anchor}:${MANIFEST}`])), { head, inputKey: closure.inputKey, surfaceDigest: closure.surfaceDigest });
  return manifest;
}

function commandWrapper(mode) {
  return `import { runCompactCommand } from "../../../scripts/compact-assurance-pipeline.mjs";\nawait runCompactCommand({ moduleUrl: import.meta.url, mode: "${mode}" });\n`;
}
function codeClosureKey(manifest, rootFiles) {
  const graph = manifest.bundles.moduleGraph;
  assert(graph !== undefined, "Missing compiler-resolved executable import closure.");
  const byFile = new Map(manifest.bundles.sources.map(row => [row.file, row]));
  const reached = new Set();
  const visit = file => { if(reached.has(file)) return; reached.add(file); assert(byFile.has(file), `Unbound executable input: ${file}`); for(const child of graph[file] ?? []) visit(child); };
  for(const root of rootFiles) visit(root);
  return keyOf([...reached].sort(compare).map(file => byFile.get(file)));
}

/** A Git-index census defines which ordinary files can be authoritative; ambient files are never inputs. */
function trackedFiles(root) {
  const files = new Map();
  for(const record of git(root, ["ls-files", "--stage", "-z"]).split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t"), header = record.slice(0,tab).split(" "), file = record.slice(tab+1);
    assert.equal(header[2], "0", "Unmerged assurance input.");
    assert(header[0] === "100644" || header[0] === "100755", `Non-ordinary tracked assurance input: ${file}`);
    files.set(file, header[1]);
  }
  return files;
}
function ordinaryBytes(root, file) {
  const target = assuranceRepositoryPath(root, file);
  assert(native.lstatSync(target).isFile(), `Assurance input is not an ordinary file: ${file}`);
  const fd = native.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return native.readFileSync(fd); } finally { native.closeSync(fd); }
}

/** Hash the exact compiler root file set selected by tsconfig.test.json before any cache reuse. */
export function compactCompilerSourceSetIdentity(repositoryRoot = ROOT) {
  const root = path.resolve(repositoryRoot);
  const tracked = trackedFiles(root);
  const require = createRequire(path.join(root, "package.json"));
  const ts = require("typescript");
  const configPath = path.join(root, "tsconfig.test.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined, "Compact compiler source-set config is invalid.");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors, [], "Compact compiler source-set config parse failed.");
  const rows = parsed.fileNames.map(fileName => {
    const file = relative(root, fileName);
    assert(tracked.has(file), `Compiler source set contains ambient/untracked file: ${file}`);
    const bytes = ordinaryBytes(root, file);
    return { file, sha256: sha(bytes), sizeBytes: bytes.length };
  }).sort((left, right) => compare(left.file, right.file));
  assert.equal(new Set(rows.map(row => row.file)).size, rows.length, "Compiler source set contains duplicate roots.");
  return { key: compactCompilerSourceSetKey(rows), rows };
}

/** Content-address one compiler root set so membership changes invalidate every dependent cache. */
export function compactCompilerSourceSetKey(rows) {
  return keyOf(rows);
}
function writeChanged(root, file, bytes) {
  const target = assuranceRepositoryPath(root, file);
  if (native.existsSync(target) && ordinaryBytes(root, file).equals(bytes)) return false;
  native.writeFileSync(target, bytes);
  return true;
}

/** One content-addressed snapshot supplies every compiler/producer/binder read and checks freshness atomically at exit. */
function snapshot(root, manifest) {
  const tracked = trackedFiles(root), archived = new Map(manifest.archive.files.map(row => [row.file,row]));
  const records = new Map(), compilerStrings = new Map(), probes = new Map();
  const tasks = new Map(); let activeTask;
  const outputs = new Set(DERIVED);
  const directories = new Set([""]);
  for(const file of [...tracked.keys(), ...archived.keys()]) for(let parent=path.posix.dirname(file); parent!==".";parent=path.posix.dirname(parent)) directories.add(parent);
  const touch = file => { if(activeTask !== undefined) tasks.get(activeTask).add(file); };
  function load(file) {
    touch(file);
    if (records.has(file)) return records.get(file);
    let bytes, kind;
    if (file.startsWith("node_modules/")) {
      const target = path.resolve(root, file);
      assert(native.statSync(target).isFile(), `Invalid toolchain input ${file}`);
      bytes = native.readFileSync(target); kind = "toolchain";
    } else {
      assert(tracked.has(file) || archived.has(file) || outputs.has(file), `Ambient/untracked proof input is forbidden: ${file}`);
      bytes = ordinaryBytes(root, file); kind = archived.has(file) && !tracked.has(file) ? "archived" : "tracked";
      if (kind === "archived") assert.equal(sha(bytes), archived.get(file).sha256, `Materialized support changed without a tracked archive update: ${file}`);
    }
    const entry = { file, kind, bytes, sha256: sha(bytes), sizeBytes: bytes.length };
    records.set(file, entry); return entry;
  }
  function read(file) { return Buffer.from(load(file).bytes); }
  function hash(file) { return load(file).sha256; }
  function compilerHash(file,text) {
    touch(file);
    const previous = compilerStrings.get(file);
    if (previous?.text === text) return previous.sha256;
    const digest = sha(text); assert.equal(digest, hash(file), `Compiler snapshot differs from authoritative input ${file}`);
    compilerStrings.set(file,{text,sha256:digest}); return digest;
  }
  function invalidate(file) { assert(outputs.has(file), "Only derived outputs may change during a proof transaction."); records.delete(file); }
  function inputRows(files = records.keys()) {
    return [...files].sort(compare).map(file => { const row=load(file); return { file, kind: row.kind, sha256: row.sha256, sizeBytes: row.sizeBytes }; });
  }
  function probe(file) {
    const absolute = path.resolve(root,file), exists = native.existsSync(absolute);
    if (exists && !file.startsWith("node_modules/")) assert(tracked.has(file) || archived.has(file) || outputs.has(file) || directories.has(file), `Ambient existence cannot confer proof credit: ${file}`);
    probes.set(file, exists); return exists;
  }
  function finish() {
    for (const row of records.values()) {
      const current = row.kind === "toolchain" ? native.readFileSync(path.resolve(root,row.file)) : ordinaryBytes(root,row.file);
      assert.equal(sha(current),row.sha256,`Assurance inputs moved during their atomic proof pass: ${row.file}`);
    }
    for(const [file,exists] of probes) assert.equal(native.existsSync(path.resolve(root,file)),exists,`An assurance path probe changed during validation: ${file}`);
  }
  /** Bind only the executable roots that the current proof actually consumes.
   * Bundler imports, compiler sources, traced runtime reads and these compiler/config roots
   * form the authoritative live closure; unrelated historical executables cannot invalidate it. */
  function bindExecutableDomain() {
    load(PIPELINE_SELF);
    for(const row of manifest.bundles.sources) if(!DERIVED.has(row.file)) load(row.file);
    for(const file of ["package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.test.json"]) load(file);
    const require = createRequire(path.join(root,"package.json"));
    for(const name of ["typescript", "typescript/package.json", "esbuild", "esbuild/package.json"]) load(relative(root,require.resolve(name)));
    load(manifest.archive.file);
    for(const row of manifest.bundles.entries) load(row.file);
  }
  async function trace(run, mutating = false) {
    // Only files created by this exact adversarial run may be read without becoming baseline inputs.
    const temporaryFiles = new Set();
    const known = file => tracked.has(file) || archived.has(file) || outputs.has(file) || file.startsWith("node_modules/");
    const onRead = file => {
      if (temporaryFiles.has(file)) return undefined;
      if (!native.existsSync(path.resolve(root, file))) { probes.set(file, false); return undefined; }
      const bytes = read(file);
      return mutating ? undefined : bytes;
    };
    const onWrite = file => {
      if (!mutating) { assert(outputs.has(file), `Proof attempted to mutate an input: ${file}`); return; }
      if (temporaryFiles.has(file)) return;
      if (known(file)) { load(file); return; }
      assert(!native.existsSync(path.resolve(root, file)), `Mutation probe cannot overwrite an ambient input: ${file}`);
      assuranceRepositoryPath(root, file);
      temporaryFiles.add(file);
    };
    const observed = () => withAssuranceFileObservation({
      repositoryRoot: root,
      onRead,
      onExists: file => temporaryFiles.has(file) ? native.existsSync(path.resolve(root, file)) : probe(file),
      onWrite,
    }, run);
    const result = mutating ? await observed() : await withAssuranceReadSession(root, { read, hash, compilerHash }, observed);
    for (const file of temporaryFiles) assert(!native.existsSync(path.resolve(root, file)), `Adversarial probe was not removed: ${file}`);
    return result;
  }
  return { read, hash, compilerHash, invalidate, inputRows, records, probes, tracked, bindExecutableDomain, trace, finish,
    task(id, run) { tasks.set(id,new Set()); assert.equal(activeTask,undefined); activeTask=id; try{return run();}finally{activeTask=undefined;} },
    taskRows(id) { return inputRows(tasks.get(id)); } };
}

/** Import closure is discovered from actual bundler resolution, including local CJS compiler entrypoints. */
async function rebuildBundle(root, manifest) {
  const require = createRequire(path.join(root,"package.json"));
  const esbuild = require("esbuild");
  const version = esbuild.version;
  const existing = manifest.bundles;
  const sourcesUnchanged = existing.esbuildVersion === version && existing.sources.length > 0 && existing.sources.every(row => native.existsSync(path.resolve(root,row.file)) && sha(ordinaryBytes(root,row.file)) === row.sha256);
  const unified = existing.entries.length === 1 && existing.entries[0].file === BUNDLE && existing.moduleGraph !== undefined;
  if (sourcesUnchanged && unified && sha(ordinaryBytes(root,BUNDLE)) === existing.entries[0].sha256) return false;
  const build = esbuild.buildSync({ absWorkingDir:root, entryPoints:[SOURCE_ENTRY], bundle:true, write:false, metafile:true, platform:"node", format:"esm", target:"node22", packages:"external", logLevel:"silent", banner:{js:'import { createRequire as __compactCreateRequire } from "node:module"; const require = __compactCreateRequire(import.meta.url);'} });
  assert.equal(build.outputFiles.length,1);
  const bytes = Buffer.from(build.outputFiles[0].contents);
  writeChanged(root,BUNDLE,bytes);
  const sources = Object.keys(build.metafile.inputs).sort(compare).map(file=>({file,sha256:sha(ordinaryBytes(root,file)),bytes:ordinaryBytes(root,file).length}));
  const moduleGraph = {};
  for(const [file, input] of Object.entries(build.metafile.inputs)) moduleGraph[file] = input.imports.filter(row=>!row.external).map(row=>row.path).sort(compare);
  manifest.bundles = { esbuildVersion:version, entries:[{mode:"unified",file:BUNDLE,sha256:sha(bytes),bytes:bytes.length}], sources, moduleGraph };
  for(const mode of ["selftest", "registry"]) writeChanged(root,DIRECTORY+`compact-final-${mode}.mjs`,Buffer.from(commandWrapper(mode)));
  return true;
}

/** Repack only a changed source closure, with deterministic member metadata and no ambient extra files. */
function captureSupport(root, manifest) {
  const files = new Set(manifest.archive.files.map(row=>row.file));
  for(const kind of ["value", "producer", "registry"]) {
    const file = DIRECTORY+`epoch-prior-${kind}.json`;
    const original = DIRECTORY+(kind==="value"?"final-v309.json":kind==="producer"?"final-a121-b58.json":"final-surface-bindings.json");
    const bytes = git(root,["show",`6983219e13295b8f6b073daefc3cbcd90b32ac35:${original}`],null);
    if (!native.existsSync(path.resolve(root,file))) native.writeFileSync(assuranceRepositoryPath(root,file),bytes);
    else assert(ordinaryBytes(root,file).equals(bytes), "Proposed prior epoch authority is not the immutable predecessor.");
    files.add(file);
  }
  const rows = [...files].sort(compare).map(file => { const bytes=ordinaryBytes(root,file); return {file,sha256:sha(bytes),bytes:bytes.length}; });
  if (JSON.stringify(rows) === JSON.stringify(manifest.archive.files)) return false;
  const tar = spawnSync("tar",["--format=gnu","--sort=name","--mtime=@0","--owner=0","--group=0","--numeric-owner","--null","-T","-","-cf","-"],{cwd:root,input:Buffer.from(rows.map(row=>row.file).join("\0")+"\0"),maxBuffer:128*1024*1024});
  assert.equal(tar.status,0,tar.stderr?.toString());
  const bytes = gzipSync(tar.stdout,{level:6});
  readCompactArchive(bytes,rows);
  writeChanged(root,manifest.archive.file,bytes);
  manifest.archive = { file:manifest.archive.file,sha256:sha(bytes),bytes:bytes.length,files:rows };
  return true;
}
function outputRows(root, files) { return files.map(file => {const bytes=ordinaryBytes(root,file);return {file,sha256:sha(bytes),sizeBytes:bytes.length};}); }
function manifestSemanticCore(manifest) { const {certification, ...core}=manifest; return core; }

/** One exact closure is the key for artifacts and pristine certificates; HEAD/diary/time measurements are not semantic inputs. */
function closureDocument(pass, manifest, graph, surfaceDigest, compilerRootSet, compilerSourceSet) {
  const rows = pass.inputRows().filter(row=>!DERIVED.has(row.file));
  const outputs = outputRows(ROOT,[BUNDLE,DIRECTORY+"compact-final-selftest.mjs",DIRECTORY+"compact-final-registry.mjs",...graph.flatMap(node=>node.outputs.map(row=>row.file))]);
  const environment = {node:process.versions.node,platform:process.platform,arch:process.arch};
  const key = keyOf({rows,outputs,environment,archive:manifest.archive,code:manifest.bundles,compilerRootSet,compilerSourceSet});
  return {schemaVersion:2,status:"FINAL_LIVE_INPUT_CLOSURE",inputKey:key,surfaceDigest,inputs:rows.length,totalBytes:rows.reduce((sum,row)=>sum+row.sizeBytes,0),untrackedProofInputs:0,compilerRootSet,compilerSourceSet,rows,outputs,environment};
}
function assertClosure(root, closure, manifest) {
  assert.equal(closure.schemaVersion,2);
  assert.equal(closure.untrackedProofInputs,0);
  assert.equal(closure.inputs,closure.rows.length);
  const seen = new Set();
  for(const row of [...closure.rows,...closure.outputs]) {
    assert(!seen.has(row.file),`Repeated closure member ${row.file}`);seen.add(row.file);
    const bytes = row.kind === "toolchain" ? native.readFileSync(path.resolve(root,row.file)) : ordinaryBytes(root,row.file);
    assert.equal(bytes.length,row.sizeBytes,`Stale compact input size: ${row.file}`);
    assert.equal(sha(bytes),row.sha256,`Stale compact input hash: ${row.file}`);
  }
  for(const row of manifest.bundles.sources) assert(seen.has(row.file), `Unbound bundled executable input: ${row.file}`);
  for(const file of [PIPELINE_SELF, "package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.test.json", manifest.archive.file]) assert(seen.has(file), `Unbound compact root input: ${file}`);
  const currentCompilerRootSet = compactCompilerSourceSetIdentity(root);
  assert.deepEqual(closure.compilerRootSet, currentCompilerRootSet, "Compact compiler root set is stale.");
  for(const row of currentCompilerRootSet.rows) assert(seen.has(row.file), `Unbound compiler source root: ${row.file}`);
  assert(closure.compilerSourceSet !== null && typeof closure.compilerSourceSet === "object" && Array.isArray(closure.compilerSourceSet.rows), "Missing exact compiler source set.");
  for(const row of closure.compilerSourceSet.rows) assert(seen.has(row.file), `Unbound exact compiler source: ${row.file}`);
  assert.deepEqual(closure.environment,{node:process.versions.node,platform:process.platform,arch:process.arch});
  assert.equal(keyOf({rows:closure.rows,outputs:closure.outputs,environment:closure.environment,archive:manifest.archive,code:manifest.bundles,compilerRootSet:closure.compilerRootSet,compilerSourceSet:closure.compilerSourceSet}),closure.inputKey,"Compact closure identity is stale.");
}

async function withSupport(root, manifest, run) {
  const release = claimAssuranceWorkspace(root);
  let cleanup;
  try {
    const bytes = ordinaryBytes(root,manifest.archive.file);
    assert.equal(sha(bytes),manifest.archive.sha256,"Compact archive changed.");
    cleanup = materializeAssuranceFiles(root,readCompactArchive(bytes,manifest.archive.files));
    return await run();
  } finally { try{cleanup?.();}finally{release();} }
}

async function currentize(root, manifest, anchor) {
  const started=performance.now(), prior=trustedManifest(root,anchor);
  // A currentization is an explicit source-generation operation. Certification below is always on a committed pristine tree.
  const bundleChanged=await rebuildBundle(root,manifest);
  writeChanged(root,MANIFEST,encode(manifest));
  const pass=snapshot(root,manifest), graph=[];
  const compilerRootSet = compactCompilerSourceSetIdentity(root);
  let compilerPasses=0, context, compilerSourceSet, library;
  const result=await pass.trace(async()=>{
    library=await import(pathToFileURL(path.resolve(root,BUNDLE)).href+`?inputs=${manifest.bundles.entries[0].sha256}`);
    pass.bindExecutableDomain();
    context=library.createFinalCompilerContext(root);compilerPasses++;
    // Bind the exact Program source graph once; node caches key this complete set, not only tsconfig roots.
    const compilerFiles = context.program.getSourceFiles().map(source => {
      const file = relative(root, source.fileName);
      pass.compilerHash(file, source.text);
      return file;
    });
    const compilerRows = pass.inputRows(compilerFiles);
    compilerSourceSet = { key: compactCompilerSourceSetKey(compilerRows), rows: compilerRows };
    library.verifyFinalCurrentReview(root,context);
    const nodes=[
      ["transport","final-head-transport.json",()=>library.buildFinalTransport(root,context)],
      ["values","final-v309.json",()=>library.buildFinalValues(root,context)],
      ["producers","final-a121-b58.json",()=>library.buildFinalProducers(root,context)],
      ["registry","final-surface-bindings.json",()=>library.buildFinalRegistryArtifact(root)],
      ["binder","final-binder-report.json",()=>library.verifyFinalBindings(root,context)],
    ];
    for(const [id,name,build] of nodes){
      const nodeStarted=performance.now(),file=DIRECTORY+name;
      const cached=prior?.graph?.find(row=>row.id===id);
      const codeRoots = id === "transport" ? [DIRECTORY+"final-head-transport.mjs"] : id === "values" || id === "producers" ? [DIRECTORY+"final-families.mjs"] : id === "registry" ? [DIRECTORY+"build-final-registry.mjs"] : [DIRECTORY+"run-final-verifier.mjs"];
      const codeSha256 = keyOf({ bundleCode: codeClosureKey(manifest, codeRoots), pipeline: pass.hash(PIPELINE_SELF) });
      let reused=false,record;
      if(cached!==undefined && cached.codeSha256===codeSha256 && cached.compilerSourceSetKey===compilerSourceSet.key && cached.inputs.every(row=>pass.hash(row.file)===row.sha256) && cached.outputs.every(row=>native.existsSync(path.resolve(root,row.file))&&sha(ordinaryBytes(root,row.file))===row.sha256)){
        record=cached;reused=true;
      }else{
        const artifact=pass.task(id,build),bytes=encode(artifact);
        writeChanged(root,file,bytes);pass.invalidate(file);
        const inputs=pass.taskRows(id);
        record={id,codeSha256,compilerSourceSetKey:compilerSourceSet.key,inputs,outputs:outputRows(root,[file])};
      }
      graph.push(record);
      console.log(JSON.stringify({node:id,reused,elapsedMs:Math.round(performance.now()-nodeStarted)}));
    }
    // Independent central admission remains mandatory when there is no authenticated node cache.
    return {surfaceDigest:context.surface.digest};
  });
  // Discover every real adversarial read (including descriptor-only reads) while preserving post-write visibility.
  await pass.trace(() => library.verifyFinalAdversarial(root, context), true);
  pass.finish();
  manifest.graph=graph;delete manifest.certification;
  const closure=closureDocument(pass,manifest,graph,result.surfaceDigest,compilerRootSet,compilerSourceSet);
  writeChanged(root,CLOSURE,encode(closure));writeChanged(root,MANIFEST,encode(manifest));
  const report={status:"COMPACT_CURRENTIZED",inputKey:closure.inputKey,bundleChanged,compilerPasses,elapsedMs:Math.round(performance.now()-started),surfaceDigest:result.surfaceDigest};
  console.log(JSON.stringify(report));return report;
}

async function validateMode(root,manifest,mode) {
  const closure=JSON.parse(ordinaryBytes(root,CLOSURE));assertClosure(root,closure,manifest);
  const pass=snapshot(root,manifest),start=performance.now();let context,library,result;
  await pass.trace(async()=>{
    library=await import(pathToFileURL(path.resolve(root,BUNDLE)).href);
    pass.bindExecutableDomain();
    context=library.createFinalCompilerContext(root);
    for(const source of context.program.getSourceFiles())pass.compilerHash(relative(root,source.fileName),source.text);
    library.verifyFinalCurrentReview(root,context);
    result=mode==="registry"?library.verifyFinalRegistry(root):library.verifyFinalBindings(root,context);
  });
  if(mode==="selftest") result=await pass.trace(() => library.verifyFinalAdversarial(root,context), true);
  pass.finish();
  const bound = new Map([...closure.rows,...closure.outputs].map(row=>[row.file,row]));
  for(const row of pass.inputRows()) {
    assert(bound.has(row.file), `Unbound executed proof input: ${row.file}`);
    assert.equal(row.sha256,bound.get(row.file).sha256,`Executed proof input differs from the closure: ${row.file}`);
  }
  assertClosure(root,closure,manifest);
  return {...result,mode,inputKey:closure.inputKey,head:git(root,["rev-parse","HEAD"]).trim(),compilerPasses:1,elapsedMs:Math.round(performance.now()-start)};
}

function cleanTree(root) {
  assert.equal(git(root,["status","--porcelain=v1","--untracked-files=no"]).trim(),"","Pristine certification requires a tracked-clean source tree.");
}
function commitPaths(root,files,message) { git(root,["add","--",...files]);git(root,["diff","--cached","--check"]);git(root,["commit","-m",message]);return git(root,["rev-parse","HEAD"]).trim(); }
function child(root,command,args,logPath) {
  return new Promise((resolve,reject)=>{
    const chunks=[],errors=[],start=performance.now();
    const processHandle=spawn(command,args,{cwd:root,env:{...process.env,CI:""},stdio:["ignore","pipe","pipe"]});
    processHandle.stdout.on("data",chunk=>chunks.push(chunk));processHandle.stderr.on("data",chunk=>errors.push(chunk));
    processHandle.once("error",reject);
    processHandle.once("close",(exitCode,signal)=>{
      const stdout=Buffer.concat(chunks),stderr=Buffer.concat(errors);if(logPath)native.writeFileSync(logPath,Buffer.concat([stdout,stderr]));
      resolve({exitCode,signal,stdout,stderr,elapsedMs:Math.round(performance.now()-start)});
    });
  });
}

/** Run all independent modes concurrently against one immutable Git tree, then pin their actual process evidence. */
async function certify(root,manifest,anchor) {
  cleanTree(root);
  const prior=trustedManifest(root,anchor),closure=JSON.parse(ordinaryBytes(root,CLOSURE));
  if(prior!==undefined && prior.certification.inputKey===closure.inputKey && JSON.stringify(manifestSemanticCore(prior))===JSON.stringify(manifestSemanticCore(manifest))){
    await withSupport(root,manifest,async()=>{ assertClosure(root,closure,manifest); verifyCurrentReviewLiveSource(root); });
    console.log(JSON.stringify({status:"COMPACT_CERTIFICATE_REUSED",inputKey:closure.inputKey,evidenceCommit:anchor,compilerPasses:0}));return;
  }
  const head=git(root,["rev-parse","HEAD"]).trim(),start=performance.now(),parent=fs.mkdtempSync(path.join(os.tmpdir(),"inventoryonce-compact-cert-"));
  const processes=[];
  try{
    const jobs=["verify","selftest","registry"].map(async mode=>{
      const directory=path.join(parent,mode);git(root,["worktree","add","--detach",directory,head]);
      const install=await child(directory,"pnpm",["install","--offline","--frozen-lockfile","--ignore-scripts"],path.join(parent,mode+"-install.log"));
      assert.equal(install.exitCode,0,install.stderr.toString());
      cleanTree(directory);
      const ran=await child(directory,process.execPath,["scripts/compact-assurance-pipeline.mjs","validate-"+mode],path.join(parent,mode+".log"));
      assert.equal(ran.exitCode,0,ran.stdout.toString()+ran.stderr.toString());assert.equal(ran.signal,null);
      cleanTree(directory);
      const lines=ran.stdout.toString().trim().split("\n"),report=JSON.parse(lines[lines.length-1]);
      assert.equal(report.inputKey,closure.inputKey);assert.equal(report.head,head);assert.equal(report.compilerPasses,1);
      assert.equal(report.status, mode==="verify" ? "FINAL_BINDER_GREEN" : mode==="selftest" ? "FINAL_CONVERGENCE_ADVERSARIAL_PASS" : "FINAL_535_REGISTRY_BUILT");
      assert(ran.stdout.length < 65536 && ran.stderr.length < 65536, "Unexpected unbounded compact certificate output.");
      processes.push({mode,head,inputKey:report.inputKey,exitCode:ran.exitCode,signal:ran.signal,stdout:ran.stdout.toString(),stderr:ran.stderr.toString(),stdoutSha256:sha(ran.stdout),stderrSha256:sha(ran.stderr),elapsedMs:ran.elapsedMs,report});
    });
    const settled=await Promise.allSettled(jobs);
    const failure=settled.find(row=>row.status==="rejected");if(failure)throw failure.reason;
    assert.equal(git(root,["rev-parse","HEAD"]).trim(),head,"Candidate moved during pristine certification.");cleanTree(root);
    processes.sort((a,b)=>compare(a.mode,b.mode));
    manifest.certification={schemaVersion:1,certifiedHead:head,inputKey:closure.inputKey,processes,elapsedMs:Math.round(performance.now()-start)};
    writeChanged(root,MANIFEST,encode(manifest));
    const evidence=commitPaths(root,[MANIFEST],"assurance: record exact compact certificate");
    writeChanged(root,WRAPPER,Buffer.from(wrapperSource(evidence)));
    commitPaths(root,[WRAPPER],"assurance: pin exact compact certificate");
    console.log(JSON.stringify({status:"COMPACT_PRISTINE_CERTIFIED",inputKey:closure.inputKey,evidenceCommit:evidence,head:git(root,["rev-parse","HEAD"]).trim(),elapsedMs:Math.round(performance.now()-start),processes}));
  }finally{
    for(const mode of ["verify","selftest","registry"]){const directory=path.join(parent,mode);if(native.existsSync(directory))git(root,["worktree","remove","--force",directory]);}
    // Keep failure/success logs as local diagnostics. They are never a certificate authority.
  }
}

/** Explicit generator capture accepts only the declared support closure; normal validation materializes nothing ambient. */
export async function runCompactCommand({moduleUrl,mode,certificateCommit}={}) {
  const root=moduleUrl?path.resolve(path.dirname(fileURLToPath(moduleUrl)),"../../.."):ROOT;
  assert.equal(root,ROOT,"Compact driver and package roots differ.");
  const anchor=certificateCommit??certificateAnchor(root),manifest=JSON.parse(ordinaryBytes(root,MANIFEST));
  const started=performance.now();
  if(mode==="capture"){
    captureSupport(root,manifest);await rebuildBundle(root,manifest);
    writeChanged(root,MANIFEST,encode(manifest));
    if(anchor===NO_CERTIFICATE)writeChanged(root,WRAPPER,Buffer.from(wrapperSource(anchor)));
    // Remove only precisely archived files; these bytes are now owned by the tracked archive.
    const tracked=trackedFiles(root);
    for(const row of manifest.archive.files){assert(!tracked.has(row.file),"A support member unexpectedly became tracked.");assert.equal(sha(ordinaryBytes(root,row.file)),row.sha256);fs.unlinkSync(assuranceRepositoryPath(root,row.file));}
    console.log(JSON.stringify({status:"COMPACT_SOURCES_CAPTURED",files:manifest.archive.files.length,elapsedMs:Math.round(performance.now()-started)}));return;
  }
  if(mode==="certify")return certify(root,manifest,anchor);
  if(mode==="currentize") {
    const prior=trustedManifest(root,anchor);
    if(prior!==undefined && native.existsSync(path.resolve(root,CLOSURE))){
      try{
        const closure=JSON.parse(ordinaryBytes(root,CLOSURE));
        const compilerRootSet = compactCompilerSourceSetIdentity(root);
        if(prior.certification.inputKey===closure.inputKey && closure.compilerRootSet?.key===compilerRootSet.key && JSON.stringify(manifestSemanticCore(prior))===JSON.stringify(manifestSemanticCore(manifest))){
          await withSupport(root,manifest,async()=>{ assertClosure(root,closure,manifest); verifyCurrentReviewLiveSource(root); });
          console.log(JSON.stringify({status:"COMPACT_CURRENTIZATION_REUSED",inputKey:closure.inputKey,compilerPasses:0,elapsedMs:Math.round(performance.now()-started)}));return;
        }
      }catch(error){if(!/Stale compact input (hash|size)|closure identity is stale|Unbound executable input/u.test(error.message))throw error;}
    }
    return withSupport(root,manifest,()=>currentize(root,manifest,anchor));
  }
  const certificationProbe=mode?.startsWith("validate-")??false;
  const selected=certificationProbe?mode.slice(9):mode;
  assert(["verify","selftest","registry"].includes(selected),`Unknown compact assurance command: ${mode}`);
  if(!certificationProbe){
    assert.notEqual(anchor,NO_CERTIFICATE,"Ordinary compact validation requires a pinned certificate.");
    if(certificateCommit!==undefined) assert.equal(certificateAnchor(root),certificateCommit,"Compact wrapper certificate anchor differs from the invoked certificate.");
    const pinnedManifest=trustedManifest(root,anchor);
    assert(pinnedManifest!==undefined,"Ordinary compact validation lost its pinned certificate manifest.");
    const pinnedManifestBytes=git(root,["show",`${anchor}:${MANIFEST}`],null);
    assert(ordinaryBytes(root,MANIFEST).equals(pinnedManifestBytes),"Current compact manifest differs from its pinned immutable certificate.");
    const certifiedHead=pinnedManifest.certification.certifiedHead;
    const pinnedClosureBytes=git(root,["show",`${certifiedHead}:${CLOSURE}`],null);
    assert(ordinaryBytes(root,CLOSURE).equals(pinnedClosureBytes),"Current compact closure differs from its pinned immutable certified tree.");
  }
  const report=await withSupport(root,manifest,()=>validateMode(root,manifest,selected));
  console.log(JSON.stringify(report));return report;
}

if(process.argv[1]!==undefined && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await runCompactCommand({mode:process.argv[2]??"verify"});
