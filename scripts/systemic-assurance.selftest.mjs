import assert from "node:assert/strict";
import { repositoryAssuranceStateSha256, repositoryAssuranceCommittedStateSha256 } from "./repository-assurance-state.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assuranceRepositoryPath, readAssuranceFile } from "./assurance-files.mjs";
import { formalProofDescriptor, formalProofCacheKey, readFormalProofCache, writeFormalProofCache } from "./formal-proof-cache.mjs";
import { executableAssuranceSummary, assertExecutableAssuranceMatchesManifests } from "./executable-assurance-coherence.mjs";
import { assertFormalPositiveReachabilityRegistration } from "./formal-models.mjs";

/** Repository inputs are rooted at this test module, never the invoking shell. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Installed compiler and exact shared Vitest interpreter under test. */
const require = createRequire(import.meta.url), ts = require("typescript"), semantics = require("./formal-implementation-vitest-semantics.cjs");

/** Give one control a disposable directory and always remove its own files. */
async function temporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventoryonce-systemic-"));
  try { return await run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("assurance evidence admission rejects directories rather than treating existence as evidence", () => {
  assert.throws(
    () => readAssuranceFile(root, "test"),
    /ordinary file|regular file|directory/u
  );
});

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
  const output = "2 states generated, 1 distinct states found, 0 states left on queue.\nThe depth of the complete state graph search is 1.\n";
  const cache = path.join(directory, "cache"), evidence = {
    status: 0, signal: null, output, summary: { generated: 2, distinct: 1, depth: 1 },
  };
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

test("positive reachability registration binds each invariant to its witness config", () => {
  const files = ["SnapshotSupersededWorkflowNonzeroWitness.cfg"];
  assert.doesNotThrow(() =>
    assertFormalPositiveReachabilityRegistration(
      files,
      () => "SPECIFICATION FairSpec\nINVARIANT NonzeroSnapshotIsUnreachable\n",
    ),
  );
  assert.throws(
    () => assertFormalPositiveReachabilityRegistration(files, () => "SPECIFICATION FairSpec\nINVARIANT RenamedWitness\n"),
    /does not declare registered invariant/u,
  );
});

test("published tarball contains every tracked input domain required by advertised assurance commands", () => {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  assert.equal(packed.length, 1);
  const packedFiles = new Set(packed[0].files.map((entry) => entry.path));
  const required = execFileSync(
    "git",
    [
      "ls-files",
      "scripts",
      "src",
      "test",
      "formal",
      "tsconfig.json",
      "tsconfig.test.json",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim().split(/\r?\n/u).filter(Boolean);
  for (const file of required) {
    assert(packedFiles.has(file), `Published package omits assurance input '${file}'.`);
  }
  for (const entrypoint of [
    "scripts/run-formal.mjs",
    "scripts/audit-formal-implementation-conformance.mjs",
    "scripts/run-formal-implementation-conformance.mjs",
    "scripts/generate-formal-implementation-assurance.py",
    "scripts/report-implementation-conformance.mjs",
  ]) {
    assert(packedFiles.has(entrypoint), `Published package omits advertised command entrypoint '${entrypoint}'.`);
  }
});

test("repository containment rejects symlink ancestors before reading or writing leaves", () => temporaryDirectory(directory => {
  const repository = path.join(directory, "repository"), outside = path.join(directory, "outside");
  fs.mkdirSync(repository); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "evidence"), "outside");
  fs.symlinkSync(outside, path.join(repository, "alias"));
  assert.throws(() => assuranceRepositoryPath(repository, "alias/evidence"), /symbolic|symlink|escape/i);
  assert.throws(() => assuranceRepositoryPath(repository, "alias/new-file"), /symbolic|symlink|escape/i);
  assert.equal(assuranceRepositoryPath(repository, "new-file"), path.join(repository, "new-file"));
}));

test("empty parameter tables and dynamic modifiers never manufacture executable callback credit", () => {
  for (const expression of ['test.each([])', 'test["each"]([])', '(test.for)([])']) {
    assert.equal(semantics.vitestRegistrationMode(ts, call(`${expression}("empty", () => {});`), 1), "empty");
  }
  assert.equal(semantics.vitestRegistrationMode(ts, call('test[modifier]("unknown", () => {});'), 1), "unknown");
  assert.notEqual(semantics.vitestFocusedRegistrationNode(ts, call('test[modifier]("unknown", () => {});')), undefined);
  assert.equal(semantics.vitestRegistrationMode(ts, call('test("removed overload", () => {}, {skip:true});'), 1), "unknown");
  assert.equal(semantics.vitestRegistrationMode(ts, call('test.each([1])("one", () => {});'), 1), "run");
});

test("shared registration interpreter agrees with actual installed Vitest execution", () => temporaryDirectory(directory => {
  const cases = [
    ["test", true], ['test["skip"]', false], ['(test.skip)', false], ['test["todo"]', false],
    ['test["skipIf"](true)', false], ['test["skipIf"](false)', true],
    ['(test.runIf)(true)', true], ['test["runIf"](false)', false],
    ['test.each([])', false], ['test.for([])', false], ['test.each([1])', true],
    ['describe', true, true], ['describe.skip', true, false], ['describe.todo', true, false],
    ['describe.each([])', false, false], ['describe.for([])', false, false],
    ['describe.skip.each([])', false, false], ['describe.skip.for([])', false, false],
    ['describe.todo.each([])', false, false], ['describe.todo.for([])', false, false],
    ['describe.each([1])', true, true], ['describe.for([1])', true, true],
    ['describe.skipIf(true)', true, false], ['describe.skipIf(false)', true, true],
    ['describe.runIf(true)', true, true], ['describe.runIf(false)', true, false],
  ];
  const testFile = path.join(directory, "execution.test.mjs"), evidence = path.join(directory, "executed.jsonl");
  fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  const lines = ['import {test,describe} from "vitest";', 'import fs from "node:fs";'];
  const expected = [];
  for (const [index, [expression, executes, childrenExecute]] of cases.entries()) {
    const registration = expression.startsWith("describe") ? "describe" : "test";
    const parsed = call(`${expression}("case-${index}", () => {});`);
    const metadata = { registration, mode: semantics.vitestRegistrationMode(ts, parsed, 1), ...semantics.vitestConditionalMetadata(ts, parsed.expression) };
    assert.equal(semantics.vitestCallbackExecutes(metadata), executes, expression);
    if (registration === "describe") assert.equal(semantics.vitestSuiteChildrenExecute(metadata), childrenExecute, expression);
    const mark = value => `fs.appendFileSync(${JSON.stringify(evidence)}, ${JSON.stringify(String(value) + "\n")});`;
    const children = registration === "describe" ? `describe("nested", () => { ${mark(index + 100)} test("leaf", () => { ${mark(index + 200)} }); });` : "";
    lines.push(`${expression}("case-${index}", () => { ${mark(index)} ${children} });`);
    if (executes) expected.push(index);
    if (registration === "describe" && executes) expected.push(index + 100);
    if (childrenExecute) expected.push(index + 200);
  }
  fs.writeFileSync(testFile, lines.join("\n"));
  execFileSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", directory, "--maxWorkers", "1", "--no-file-parallelism"], { cwd: directory, timeout: 20000, stdio: "pipe", env: { ...process.env, CI: "" } });
  const executed = fs.readFileSync(evidence, "utf8").trim().split("\n").map(Number).sort((a,b)=>a-b);
  assert.deepEqual(executed, expected.sort((a,b)=>a-b));
}));


test("empty parameterized suite factories never earn execution credit even through skip modifiers", () => {
  for (const expression of ['describe.each([])', 'describe.for([])', 'describe.skip.each([])', 'describe.skip.for([])', 'describe["skip"]["each"]([])']) {
    const mode = semantics.vitestRegistrationMode(ts, call(`${expression}("empty", () => {});`), 1);
    assert.equal(semantics.vitestCallbackExecutes({ registration: "describe", mode }), false, expression);
  }
  assert.equal(semantics.vitestCallbackExecutes({ registration: "describe", mode: semantics.vitestRegistrationMode(ts, call('describe.skip.each([1])("one", () => {});'), 1) }), true);
});

test("live repository modes agree with Git including owner-only execution and disabled fileMode", () => temporaryDirectory(directory => {
  const git = args => execFileSync("git", ["-c", "user.name=InventoryOnce", "-c", "user.email=inventoryonce@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], { cwd: directory, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "-q"]);
  const file = path.join(directory, "tracked.txt"); fs.writeFileSync(file, "same bytes"); fs.chmodSync(file, 0o644);
  git(["add", "tracked.txt"]); git(["commit", "-qm", "baseline"]);
  const committed = repositoryAssuranceCommittedStateSha256(directory, "HEAD");
  assert.equal(repositoryAssuranceStateSha256(directory), committed);
  for (const mode of [0o654, 0o645]) {
    fs.chmodSync(file, mode);
    assert.equal(git(["diff", "--name-only"]), "");
    assert.equal(repositoryAssuranceStateSha256(directory), committed, `non-owner execute ${mode.toString(8)}`);
  }
  fs.chmodSync(file, 0o744);
  assert.notEqual(repositoryAssuranceStateSha256(directory), committed);
  git(["config", "core.fileMode", "false"]);
  assert.equal(repositoryAssuranceStateSha256(directory), committed);
  fs.writeFileSync(file, "changed bytes");
  assert.notEqual(repositoryAssuranceStateSha256(directory), committed);
}));


test("literal array callback dispatch agrees with the real runtime including empty, sparse, and singleton cases", () => {
  const methods = ["map", "flatMap", "filter", "forEach", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "reduce", "reduceRight", "sort", "toSorted"];
  for (const method of methods) {
    for (const array of ["[]", "[1]", "[1,2]", "[,]", "[,,]", "[,1]", "[void 0,1]", "[void 0,void 0]"]) {
      for (const hasInitial of method === "reduce" || method === "reduceRight" ? [false, true] : [false]) {
        const expression = `${array}.${method}(() => { mark(); return 0; }${hasInitial ? ", 0" : ""})`;
        let calls = 0;
        try { Function("mark", expression)(() => { calls += 1; }); }
        catch (error) { assert(error instanceof TypeError && calls === 0 && (method === "reduce" || method === "reduceRight")); }
        assert.equal(semantics.standardLibraryCallbackCanExecute(ts, call(expression + ";"), method), calls > 0, expression);
      }
    }
  }
  for (const array of ["[]", "[1]", "[,]", "[,,]"]) {
    const expression = `Array.from(${array}, () => { mark(); return 0; })`;
    let calls = 0; Function("mark", expression)(() => { calls += 1; });
    assert.equal(semantics.standardLibraryCallbackCanExecute(ts, call(expression + ";"), "from"), calls > 0, expression);
  }
});


test("actual source comparison ignores index hiding flags but only omits independently selected generated outputs", () => temporaryDirectory(directory => {
  const git = args => execFileSync("git", ["-c", "user.name=InventoryOnce", "-c", "user.email=inventoryonce@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], { cwd: directory, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  fs.writeFileSync(path.join(directory, "model.tla"), "Safety == x = 1\n");
  fs.writeFileSync(path.join(directory, "derived.json"), "{}\n");
  git(["add", "."]); git(["commit", "-qm", "exact source"]);
  const omitted = new Set(["derived.json"]);
  const expected = repositoryAssuranceCommittedStateSha256(directory, "HEAD", omitted);
  assert.equal(repositoryAssuranceStateSha256(directory, omitted), expected);
  fs.writeFileSync(path.join(directory, "derived.json"), "{\"updatedOutput\":true}\n");
  assert.equal(repositoryAssuranceStateSha256(directory, omitted), expected);
  git(["checkout", "--", "derived.json"]);
  for (const flag of ["assume-unchanged", "skip-worktree"]) {
    git(["update-index", `--${flag}`, "model.tla"]);
    try {
      fs.writeFileSync(path.join(directory, "model.tla"), "Safety == TRUE\n");
      assert.equal(git(["status", "--porcelain"]), "");
      assert.notEqual(repositoryAssuranceStateSha256(directory, omitted), expected);
    } finally {
      fs.writeFileSync(path.join(directory, "model.tla"), "Safety == x = 1\n");
      git(["update-index", `--no-${flag}`, "model.tla"]);
    }
    assert.equal(repositoryAssuranceStateSha256(directory, omitted), expected);
  }
}));
