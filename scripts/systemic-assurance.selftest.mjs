import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createImmutableAssuranceReader, assertAssuranceCommitChain, assuranceProofReferencesExactPath } from "./immutable-assurance-inputs.mjs";
import { readCompactArchive, materializeAssuranceFiles, claimAssuranceWorkspace, assuranceBytesSha256 } from "./assurance-files.mjs";
import { formalProofDescriptor, formalProofCacheKey, readFormalProofCache, writeFormalProofCache } from "./formal-proof-cache.mjs";
import { executableAssuranceSummary, assertExecutableAssuranceMatchesManifests } from "./executable-assurance-coherence.mjs";
import { finalConvergenceRepositoryPath } from "../experiments/tla-conformance/final-convergence/repository-root.mjs";

/** Repository inputs are rooted at this test module, never the invoking shell. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Installed compiler and exact shared Vitest interpreter under test. */
const require = createRequire(import.meta.url), ts = require("typescript"), semantics = require("./formal-implementation-vitest-semantics.cjs");

/** Give one control a disposable directory and always remove its own files. */
function temporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventoryonce-systemic-"));
  try { return run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

/** Parse one call without installing synthetic test files into the production test graph. */
function call(text) {
  const source = ts.createSourceFile("control.ts", text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const statement = source.statements[0];
  assert(ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression));
  return statement.expression;
}

/** Read the real manifest shapes so controls discriminate independent production admission. */
function manifests() {
  const load = name => JSON.parse(fs.readFileSync(path.join(root, "formal/implementation-conformance", name), "utf8"));
  return { api: load("API_ASSURANCE.json"), fields: load("FIELD_CLASSIFICATION.json"), callChains: load("CALL_CHAIN_ASSURANCE.json"), traces: load("TRACE_REPLAY_ASSURANCE.json"), gaps: load("FORMAL_COVERAGE_GAPS.json") };
}

test("every supported Vitest access spelling preserves skip/todo/only semantics", () => {
  for (const modifier of ["skip", "todo", "only"]) {
    for (const expression of [`test.${modifier}`, `test["${modifier}"]`, `(test.${modifier})`, `(test["${modifier}"] as typeof test)`, `test["${modifier}"]!`]) {
      const node = call(`${expression}("case", () => {});`);
      assert.equal(semantics.expressionHasProperty(ts, node.expression, modifier), true, expression);
      if (modifier === "only") assert.notEqual(semantics.vitestFocusedRegistrationNode(ts, node), undefined, expression);
    }
  }
  for (const modifier of ["skipIf", "runIf"]) {
    for (const expression of [`test.${modifier}`, `test["${modifier}"]`, `(test.${modifier})`]) {
      assert.deepEqual(semantics.vitestConditionalMetadata(ts, call(`${expression}(true)("case", () => {});`).expression), { conditionKind: modifier, conditionValue: true });
    }
  }
});

test("unknown Vitest suite mode never earns callback execution credit", () => {
  assert.equal(semantics.vitestCallbackExecutes({ registration: "describe", mode: "unknown" }), false);
  assert.equal(semantics.vitestCallbackExecutes({ registration: "describe", mode: "run" }), true);
  assert.equal(semantics.vitestCallbackExecutes({ registration: "describe", mode: "skip" }), true);
});

test("all proof cache boundaries reject incomplete or unrecognized descriptors", () => temporaryDirectory(directory => {
  fs.mkdirSync(path.join(directory, "formal"));
  fs.writeFileSync(path.join(directory, "formal/Model.tla"), "---- MODULE Model ----\n====\n");
  fs.writeFileSync(path.join(directory, "formal/Model.cfg"), "SPECIFICATION Spec\n");
  const valid = formalProofDescriptor({ repositoryRoot: directory, model: "Model", config: "Model", outcome: "model-passed", tlaToolsSha256: "a".repeat(64), tlcWorkers: "1" });
  const cache = path.join(directory, "cache"), evidence = { generated: 2, distinct: 1, depth: 1 };
  const written = writeFormalProofCache(cache, valid, evidence);
  assert.deepEqual(readFormalProofCache(cache, valid)?.evidence, evidence);
  for (const mutate of [
    value => { value.outcome = "unrecognized"; },
    value => { delete value.outcome; },
    value => { delete value.tlaToolsSha256; },
    value => { value.inputs = []; },
    value => { value.inputs.push(value.inputs[0]); },
    value => { value.model = "../outside"; },
    value => { value.invariant = "unjustified"; },
    value => { value.inputs[0].sha256 = "bad"; },
  ]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => writeFormalProofCache(cache, invalid, evidence), /descriptor|proof|identity|input|invariant|outcome/i);
    assert.equal(readFormalProofCache(cache, invalid), undefined);
  }
  assert(fs.existsSync(written.path));
}));

test("TLA import closure handles line comments nested block comments and strings", () => temporaryDirectory(directory => {
  fs.mkdirSync(path.join(directory, "formal"));
  fs.writeFileSync(path.join(directory, "formal/Child.tla"), "---- MODULE Child ----\nValue == 1\n====\n");
  fs.writeFileSync(path.join(directory, "formal/Other.tla"), "---- MODULE Other ----\n====\n");
  fs.writeFileSync(path.join(directory, "formal/Model.cfg"), "SPECIFICATION Spec\n");
  const input = { repositoryRoot: directory, model: "Model", config: "Model", outcome: "model-passed", tlaToolsSha256: "a".repeat(64), tlcWorkers: "1" };
  for (const imports of [
    "EXTENDS Naturals, \\* comment\nChild",
    "EXTENDS Naturals, (* nested (* comment *) *) Child",
    "C == INSTANCE (* comment *) Child",
  ]) {
    fs.writeFileSync(path.join(directory, "formal/Model.tla"), `---- MODULE Model ----\n${imports}\nText == "INSTANCE Other"\n\\* EXTENDS Other\n====\n`);
    const before = formalProofDescriptor(input);
    assert.deepEqual(before.inputs.map(row => row.path), ["formal/Child.tla", "formal/Model.cfg", "formal/Model.tla"]);
    fs.appendFileSync(path.join(directory, "formal/Child.tla"), "\n\\* dependency changed\n");
    assert.notEqual(formalProofCacheKey(before), formalProofCacheKey(formalProofDescriptor(input)));
  }
}));

test("report construction and report comparison share mandatory counter admission", () => {
  const valid = manifests(); assert.doesNotThrow(() => executableAssuranceSummary(valid));
  for (const section of ["api", "fields", "callChains"]) {
    for (const counter of Object.keys(valid[section].counts)) {
      if (typeof valid[section].counts[counter] !== "number") continue;
      const previous = valid[section].counts[counter]; delete valid[section].counts[counter];
      try { assert.throws(() => executableAssuranceSummary(valid), /counter|counts/i, `${section}.${counter}`); } finally { valid[section].counts[counter] = previous; }
    }
  }
});

test("trace credit requires nonempty unique identities from the actual public API domain", () => {
  for (const invalidApis of [[], ["not-a-public-api"], [" "]]) {
    const input = manifests(), key = Object.keys(input.traces.entries)[0];
    input.traces.entries[key].apiEntries = invalidApis;
    assert.throws(() => executableAssuranceSummary(input), /trace|API|apiEntries/i);
  }
  const input = manifests(), key = Object.keys(input.traces.entries)[0];
  input.traces.entries[key].apiEntries.push(input.traces.entries[key].apiEntries[0]);
  assert.throws(() => assertExecutableAssuranceMatchesManifests({ ...input, executable: {} }), /trace|API|apiEntries/i);
});

test("all executable manifest schema versions fail closed independently", () => {
  const expected = { api: 2, fields: 2, callChains: 1, traces: 1, gaps: 1 };
  for (const [section, version] of Object.entries(expected)) {
    const input = manifests();
    input[section].schemaVersion = version + 1;
    assert.throws(() => executableAssuranceSummary(input), /schemaVersion/u, section);
  }
});

test("repository containment rejects symlink ancestors before reading or writing leaves", () => temporaryDirectory(directory => {
  const repository = path.join(directory, "repository"), outside = path.join(directory, "outside");
  fs.mkdirSync(repository); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "evidence"), "outside");
  fs.symlinkSync(outside, path.join(repository, "alias"));
  assert.throws(() => finalConvergenceRepositoryPath(repository, "alias/evidence"), /symbolic|symlink|escape/i);
  assert.throws(() => finalConvergenceRepositoryPath(repository, "alias/new-file"), /symbolic|symlink|escape/i);
  assert.equal(finalConvergenceRepositoryPath(repository, "new-file"), path.join(repository, "new-file"));
}));


/** Construct one small ordinary tar member independently of the reader under test. */
function archiveFixture({ kind = "0", name = "experiments/tla-conformance/control.txt", payload = Buffer.from("proof"), repeats = 1 } = {}) {
  const chunks = [];
  for (let copy = 0; copy < repeats; copy += 1) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8"); header.write("0000644\0", 100, "ascii");
    header.write(`${payload.length.toString(8).padStart(11, "0")}\0`, 124, "ascii"); header.write("        ", 148, "ascii"); header.write(kind, 156, "ascii");
    if (kind === "1" || kind === "2") header.write("/tmp/outside-proof", 157, "ascii");
    let checksum = 0; for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    chunks.push(header, payload, Buffer.alloc((512 - payload.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return { bytes: gzipSync(Buffer.concat(chunks)), manifest: [{ file: name, bytes: payload.length, sha256: assuranceBytesSha256(payload) }] };
}

test("compact archive admission rejects links special files duplicate members and forged closure before extraction", () => {
  const valid = archiveFixture();
  assert.equal(readCompactArchive(valid.bytes, valid.manifest).size, 1);
  for (const kind of ["1", "2", "3", "4", "5", "6", "x", "g"]) {
    const forged = archiveFixture({ kind });
    assert.throws(() => readCompactArchive(forged.bytes, forged.manifest), /not an ordinary file/u, kind);
  }
  const duplicate = archiveFixture({ repeats: 2 });
  assert.throws(() => readCompactArchive(duplicate.bytes, duplicate.manifest), /duplicate/u);
  assert.throws(() => readCompactArchive(valid.bytes, [...valid.manifest, valid.manifest[0]]), /duplicate/u);
  assert.throws(() => readCompactArchive(valid.bytes, [{ ...valid.manifest[0], sha256: "0".repeat(64) }]), /content mismatch/u);
  assert.throws(() => readCompactArchive(valid.bytes, [{ ...valid.manifest[0], file: "experiments/tla-conformance/../../../outside" }]), /member declaration/u);
});

test("materialization owns only newly created files and leaves preexisting and foreign files untouched", () => temporaryDirectory(directory => {
  const name = "experiments/tla-conformance/control.txt", payload = Buffer.from("proof");
  const files = new Map([[name, payload]]);
  const release = claimAssuranceWorkspace(directory);
  assert.throws(() => claimAssuranceWorkspace(directory), /already owned/u);
  const cleanup = materializeAssuranceFiles(directory, files);
  assert.deepEqual(fs.readFileSync(path.join(directory, name)), payload);
  assert.throws(() => materializeAssuranceFiles(directory, files), /unexpectedly exists/u);
  assert.deepEqual(fs.readFileSync(path.join(directory, name)), payload);
  cleanup(); release();
  assert.equal(fs.existsSync(path.join(directory, name)), false);
  const nextRelease = claimAssuranceWorkspace(directory); nextRelease();
}));

test("empty parameter tables and dynamic modifiers never manufacture executable callback credit", () => {
  for (const expression of ['test.each([])', 'test["each"]([])', '(test.for)([])']) {
    assert.equal(semantics.vitestRegistrationMode(ts, call(`${expression}("empty", () => {});`), 1), "skip");
  }
  assert.equal(semantics.vitestRegistrationMode(ts, call('test[modifier]("unknown", () => {});'), 1), "unknown");
  assert.notEqual(semantics.vitestFocusedRegistrationNode(ts, call('test[modifier]("unknown", () => {});')), undefined);
  assert.equal(semantics.vitestRegistrationMode(ts, call('test("removed overload", () => {}, {skip:true});'), 1), "unknown");
  assert.equal(semantics.vitestRegistrationMode(ts, call('test.each([1])("one", () => {});'), 1), "run");
});


test("proof dependency matching requires an exact structured path rather than a substring occurrence", () => {
  const file = "formal/ImplementationConformance.tla";
  assert.equal(assuranceProofReferencesExactPath({ semantics: { formal: { source: file } } }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ dependencies: [file] }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ note: file }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ note: `diagnostic mentions ${file} but is not a dependency` }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ evidence: { file: `${file}.bak` } }, file), false);
});

test("frozen evidence cannot be re-signed or hidden behind unchanged mtime after a cached read", () => temporaryDirectory(directory => {
  const git = args => execFileSync("git", ["-c", "user.name=InventoryOnce", "-c", "user.email=inventoryonce@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], { cwd: directory, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(["init", "-q"]);
  fs.writeFileSync(path.join(directory, "proof.json"), '{"proved":true}'); git(["add", "proof.json"]); git(["commit", "-qm", "independent evidence"]);
  const anchor = git(["rev-parse", "HEAD"]);
  const reader = createImmutableAssuranceReader(directory, anchor);
  assert.deepEqual(reader.json("proof.json"), { proved: true });
  assert.throws(() => { reader.json("proof.json").proved = false; }, TypeError);
  const originalTime = fs.statSync(path.join(directory, "proof.json"));
  fs.writeFileSync(path.join(directory, "proof.json"), '{"proved":false}');
  fs.utimesSync(path.join(directory, "proof.json"), originalTime.atime, originalTime.mtime);
  assert.throws(() => reader.json("proof.json"), /differs from immutable proof input/u);
  git(["add", "proof.json"]); git(["commit", "-qm", "re-signed evidence"]);
  assert.throws(() => createImmutableAssuranceReader(directory, anchor).json("proof.json"), /differs from immutable proof input/u);
  const left = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "--detach", anchor]);
  fs.writeFileSync(path.join(directory, "other.json"), "{}"); git(["add", "other.json"]); git(["commit", "-qm", "sibling certified branch"]);
  const right = git(["rev-parse", "HEAD"]);
  assertAssuranceCommitChain(directory, [anchor, right]);
  assert.throws(() => assertAssuranceCommitChain(directory, [anchor, left, right]), /does not descend through every required repair/u);
}));

test("shared registration interpreter agrees with actual installed Vitest execution", () => temporaryDirectory(directory => {
  const cases = [
    ["test", true], ['test["skip"]', false], ['(test.skip)', false], ['test["todo"]', false],
    ['test["skipIf"](true)', false], ['test["skipIf"](false)', true],
    ['(test.runIf)(true)', true], ['test["runIf"](false)', false],
    ['test.each([])', false], ['test.for([])', false], ['test.each([1])', true],
  ];
  const testFile = path.join(directory, "execution.test.mjs"), evidence = path.join(directory, "executed.jsonl");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  const lines = ['import {test} from "vitest";', 'import fs from "node:fs";'];
  for (const [index, [expression, executes]] of cases.entries()) {
    const metadata = { registration: "test", mode: semantics.vitestRegistrationMode(ts, call(`${expression}("case-${index}", () => {});`), 1), ...semantics.vitestConditionalMetadata(ts, call(`${expression}("case-${index}", () => {});`).expression) };
    assert.equal(semantics.vitestRegistrationRuns(metadata), executes, expression);
    lines.push(`${expression}("case-${index}", () => { fs.appendFileSync(${JSON.stringify(evidence)}, ${JSON.stringify(String(index) + "\n")}); });`);
  }
  fs.writeFileSync(testFile, lines.join("\n"));
  execFileSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", directory, "--maxWorkers", "1", "--no-file-parallelism"], { cwd: directory, timeout: 20000, stdio: "pipe", env: { ...process.env, CI: "" } });
  const executed = fs.readFileSync(evidence, "utf8").trim().split("\n").map(Number).sort((a,b)=>a-b);
  assert.deepEqual(executed, cases.flatMap(([, executes], index) => executes ? [index] : []));
}));
