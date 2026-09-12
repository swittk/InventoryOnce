import assert from "node:assert/strict";
import { repositoryAssuranceStateSha256, repositoryAssuranceCommittedStateSha256 } from "./repository-assurance-state.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createImmutableAssuranceReader, assertAssuranceCommitChain, assuranceProofReferencesExactPath, checkFrozenAssuranceTransport } from "./immutable-assurance-inputs.mjs";
import { readAssuranceFile, readCompactArchive, materializeAssuranceFiles, claimAssuranceWorkspace, assuranceBytesSha256 } from "./assurance-files.mjs";
import { formalProofDescriptor, formalProofCacheKey, readFormalProofCache, writeFormalProofCache } from "./formal-proof-cache.mjs";
import { executableAssuranceSummary, assertExecutableAssuranceMatchesManifests } from "./executable-assurance-coherence.mjs";
import { finalConvergenceRepositoryPath } from "../experiments/tla-conformance/final-convergence/repository-root.mjs";
import { assertFormalPositiveReachabilityRegistration } from "./formal-models.mjs";
import { assertTrustedCompactCertificateManifest, compactCompilerSourceSetIdentity, compactCompilerSourceSetKey, runCompactCommand } from "./compact-assurance-pipeline.mjs";
import { assertCurrentReviewCompactCertificateProcesses, assertCurrentReviewTrackedDriftAllowed, currentReviewProofIntegrationPaths, currentReviewWorktreeDriftPaths } from "../experiments/tla-conformance/final-convergence/current-review-assurance.mjs";

/** Repository inputs are rooted at this test module, never the invoking shell. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Installed compiler and exact shared Vitest interpreter under test. */
const require = createRequire(import.meta.url), ts = require("typescript"), semantics = require("./formal-implementation-vitest-semantics.cjs");

/** Give one control a disposable directory and always remove its own files. */
function temporaryDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inventoryonce-systemic-"));
  try { return run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("current-review full-assurance drift gate default-denies tracked inputs outside proof outputs", () => {
  const allowed = currentReviewProofIntegrationPaths(root);
  for (const file of [".gitignore", "package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.test.json", "src/events.ts"]) {
    assert.equal(allowed.has(file), false, file);
    assert.throws(
      () => assertCurrentReviewTrackedDriftAllowed([file], allowed),
      /tracked drift escaped the proof-integration closure/u,
      file,
    );
  }
  assert.doesNotThrow(() =>
    assertCurrentReviewTrackedDriftAllowed(
      ["experiments/tla-conformance/final-convergence/compact-support-manifest.json"],
      allowed,
    ),
  );
});

test("current-review drift enumeration includes untracked authoritative inputs but not local coordination files", () => temporaryDirectory(directory => {
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "assurance@example.invalid"], { cwd: directory });
  execFileSync("git", ["config", "user.name", "InventoryOnce assurance"], { cwd: directory });
  fs.writeFileSync(path.join(directory, "package.json"), "{}\n");
  execFileSync("git", ["add", "package.json"], { cwd: directory });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd: directory });
  fs.mkdirSync(path.join(directory, "test"));
  fs.mkdirSync(path.join(directory, ".chatgpt"));
  const supportRelative = "experiments/tla-conformance/final-convergence/materialized-support.mjs";
  fs.mkdirSync(path.dirname(path.join(directory, supportRelative)), { recursive: true });
  const supportBytes = Buffer.from("export {};\n");
  fs.writeFileSync(path.join(directory, supportRelative), supportBytes);
  fs.writeFileSync(path.join(directory, "test", "untracked-proof-input.test.ts"), "throw new Error('probe');\n");
  fs.writeFileSync(path.join(directory, ".chatgpt", "local.json"), "{}\n");
  const authenticatedSupport = new Map([[supportRelative, {
    sha256: assuranceBytesSha256(supportBytes), bytes: supportBytes.length,
  }]]);
  assert.deepEqual(currentReviewWorktreeDriftPaths(directory, authenticatedSupport), ["test/untracked-proof-input.test.ts"]);
  fs.writeFileSync(path.join(directory, supportRelative), "export const forged = true;\n");
  assert.throws(
    () => currentReviewWorktreeDriftPaths(directory, authenticatedSupport),
    /Authenticated temporary compact support (?:size|hash) changed/u,
  );
}));

test("mutable current-review receipt cannot choose proof-integration authority", () => {
  const receiptPath = path.join(
    root,
    "experiments/tla-conformance/final-convergence/current-pr-review-assurance-receipt.json"
  );
  const original = fs.readFileSync(receiptPath);
  try {
    const receipt = JSON.parse(original.toString("utf8"));
    receipt.certifiedHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.throws(
      () => currentReviewProofIntegrationPaths(root),
      /receipt differs from its immutable evidence commit/u,
    );
  } finally {
    fs.writeFileSync(receiptPath, original);
  }
});

test("mutable compact manifest cannot expand the current-review proof-output allowlist", () => {
  const manifestPath = path.join(root, "experiments/tla-conformance/final-convergence/compact-support-manifest.json");
  const original = fs.readFileSync(manifestPath);
  const before = [...currentReviewProofIntegrationPaths(root)].sort();
  try {
    const manifest = JSON.parse(original.toString("utf8"));
    manifest.graph ??= [{ id: "synthetic", outputs: [] }];
    manifest.graph[0].outputs ??= [];
    manifest.graph[0].outputs.push({ file: ".gitignore", sha256: "0".repeat(64), sizeBytes: 0 });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const after = [...currentReviewProofIntegrationPaths(root)].sort();
    assert.deepEqual(after, before);
    assert.equal(after.includes(".gitignore"), false);
  } finally {
    fs.writeFileSync(manifestPath, original);
  }
});

test("current-review compact authority requires the exact certified process mode set", () => {
  const directory = "experiments/tla-conformance/final-convergence";
  const manifest = JSON.parse(fs.readFileSync(path.join(root, directory, "compact-support-manifest.json"), "utf8"));
  const wrapper = fs.readFileSync(path.join(root, directory, "run-compact-final-assurance.mjs"), "utf8");
  const certificateEvidenceHead = wrapper.match(/COMPACT_CERTIFICATE_COMMIT = "([0-9a-f]{40})"/u)?.[1];
  assert.notEqual(certificateEvidenceHead, undefined, "Compact certificate anchor is missing.");
  const compactCertifiedHead = execFileSync(
    "git",
    ["rev-parse", `${certificateEvidenceHead}^`],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.doesNotThrow(() =>
    assertCurrentReviewCompactCertificateProcesses(manifest.certification, compactCertifiedHead)
  );

  const forgedHead = structuredClone(manifest.certification);
  const selfCorrelatedHead = "1".repeat(40);
  forgedHead.certifiedHead = selfCorrelatedHead;
  forgedHead.processes = forgedHead.processes.map((row) => ({ ...row, head: selfCorrelatedHead }));
  assert.throws(
    () => assertCurrentReviewCompactCertificateProcesses(forgedHead, compactCertifiedHead),
    /tested the wrong head/u
  );

  const duplicateVerify = structuredClone(manifest.certification);
  duplicateVerify.processes = duplicateVerify.processes.map((row) => ({
    ...row,
    mode: "verify",
    report: { ...row.report, mode: "verify", status: "FINAL_BINDER_GREEN" },
  }));
  assert.throws(
    () => assertCurrentReviewCompactCertificateProcesses(duplicateVerify, compactCertifiedHead),
    /exactly one registry, selftest, and verify process/u
  );

  const unknownMode = structuredClone(manifest.certification);
  unknownMode.processes[0] = { ...unknownMode.processes[0], mode: "unknown-mode" };
  delete unknownMode.processes[0].report;
  assert.throws(
    () => assertCurrentReviewCompactCertificateProcesses(unknownMode, compactCertifiedHead),
    /exactly one registry, selftest, and verify process/u
  );
});

test("assurance evidence admission rejects directories rather than treating existence as evidence", () => {
  assert.throws(
    () => readAssuranceFile(root, "test"),
    /ordinary file|regular file|directory/u
  );
});

test("ordinary compact validation authenticates manifest and closure against its pinned certificate", async () => {
  const directory = "experiments/tla-conformance/final-convergence";
  const manifestPath = path.join(root, directory, "compact-support-manifest.json");
  const closurePath = path.join(root, directory, "authority-reference-manifest.json");
  const manifestOriginal = fs.readFileSync(manifestPath);
  const closureOriginal = fs.readFileSync(closurePath);
  try {
    const manifest = JSON.parse(manifestOriginal.toString("utf8"));
    manifest.certification.processes[0].exitCode = 99;
    manifest.certification.processes[0].report.status = "FORGED_CERTIFICATE_FAILURE";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(
      () => runCompactCommand({ mode: "verify" }),
      /Current compact manifest differs from its pinned immutable certificate/u,
    );
    fs.writeFileSync(manifestPath, manifestOriginal);

    // A moving candidate may legitimately have a newly captured manifest before its next certificate.
    // Put the immutable pinned manifest back for the closure-specific control so manifest drift cannot
    // mask the independent certified-tree comparison we intend to falsify here.
    const wrapper = fs.readFileSync(path.join(root, directory, "run-compact-final-assurance.mjs"), "utf8");
    const anchor = wrapper.match(/COMPACT_CERTIFICATE_COMMIT = "([0-9a-f]{40})"/u)?.[1];
    assert.notEqual(anchor, undefined, "Compact certificate anchor is missing.");
    const pinnedManifest = execFileSync(
      "git",
      ["show", `${anchor}:${directory}/compact-support-manifest.json`],
      { cwd: root },
    );
    fs.writeFileSync(manifestPath, pinnedManifest);

    const closure = JSON.parse(closureOriginal.toString("utf8"));
    closure.forgedCertificateNote = true;
    fs.writeFileSync(closurePath, `${JSON.stringify(closure, null, 2)}\n`);
    await assert.rejects(
      () => runCompactCommand({ mode: "verify" }),
      /Current compact closure differs from its pinned immutable certified tree/u,
    );
  } finally {
    fs.writeFileSync(manifestPath, manifestOriginal);
    fs.writeFileSync(closurePath, closureOriginal);
  }
});

test("pinned compact certificate rejects re-signed semantic report forgeries", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "experiments/tla-conformance/final-convergence/compact-support-manifest.json"), "utf8"));
  const resign = (row) => {
    row.stdout = `${JSON.stringify(row.report)}\n`;
    row.stdoutSha256 = assuranceBytesSha256(Buffer.from(row.stdout));
  };

  const forgedStatus = structuredClone(manifest);
  const registry = forgedStatus.certification.processes.find((row) => row.mode === "registry");
  registry.report.status = "FORGED_CERTIFICATE_FAILURE";
  resign(registry);
  assert.throws(() => assertTrustedCompactCertificateManifest(forgedStatus), /registry status is invalid/u);

  const forgedBinder = structuredClone(manifest);
  const verify = forgedBinder.certification.processes.find((row) => row.mode === "verify");
  verify.report.callables = 534;
  resign(verify);
  assert.throws(() => assertTrustedCompactCertificateManifest(forgedBinder), /Expected values to be strictly equal/u);

  const forgedControl = structuredClone(manifest);
  const selftest = forgedControl.certification.processes.find((row) => row.mode === "selftest");
  selftest.report.controls.sameMtimeEvidenceDriftRejected = false;
  resign(selftest);
  assert.throws(() => assertTrustedCompactCertificateManifest(forgedControl), /adversarial controls are incomplete/u);
});

test("compact source-set identity detects compiler roots before cache reuse", () => {
  const identity = compactCompilerSourceSetIdentity(root);
  assert(identity.rows.some(row => row.file === "src/events.ts"));
  assert(identity.rows.some(row => row.file === "test/review-hardening.test.ts"));
  const syntheticRows = [...identity.rows, {
    file: "src/synthetic-tracked-compiler-root.ts",
    sha256: "0".repeat(64),
    sizeBytes: 1,
  }];
  assert.notEqual(compactCompilerSourceSetKey(identity.rows), compactCompilerSourceSetKey(syntheticRows));

  const ambient = path.join(root, "src", "compact-source-set-ambient-selftest.ts");
  assert(!fs.existsSync(ambient));
  try {
    fs.writeFileSync(ambient, "/** Synthetic ambient compiler root; proof admission must fail closed. */\nexport const compactSourceSetAmbientSelftest = true;\n");
    assert.throws(
      () => compactCompilerSourceSetIdentity(root),
      /Compiler source set contains ambient\/untracked file/u,
    );
  } finally {
    fs.rmSync(ambient, { force: true });
  }
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
      "experiments/tla-conformance/final-convergence/repository-root.mjs",
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
    assert.equal(semantics.vitestRegistrationMode(ts, call(`${expression}("empty", () => {});`), 1), "empty");
  }
  assert.equal(semantics.vitestRegistrationMode(ts, call('test[modifier]("unknown", () => {});'), 1), "unknown");
  assert.notEqual(semantics.vitestFocusedRegistrationNode(ts, call('test[modifier]("unknown", () => {});')), undefined);
  assert.equal(semantics.vitestRegistrationMode(ts, call('test("removed overload", () => {}, {skip:true});'), 1), "unknown");
  assert.equal(semantics.vitestRegistrationMode(ts, call('test.each([1])("one", () => {});'), 1), "run");
});


test("proof dependency matching requires an exact structured path token rather than a substring occurrence", () => {
  const file = "formal/ImplementationConformance.tla";
  assert.equal(assuranceProofReferencesExactPath({ semantics: { formal: { source: file } } }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ dependencies: [file] }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ sourceFile: file }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ inputs: [{ file }] }, file), true);
  assert.equal(assuranceProofReferencesExactPath({ profile: file }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ sourceProfile: file }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ fileSha256: file }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ note: file }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ note: `diagnostic mentions ${file} but is not a dependency` }, file), false);
  assert.equal(assuranceProofReferencesExactPath({ evidence: { file: `${file}.bak` } }, file), false);
});

test("frozen transport admission requires the caller's exact proved status", () => {
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const file = "experiments/tla-conformance/final-convergence/r165-assurance-transport.json";
  const exactStatus = "R165_PLUS_R167_ASSURANCE_TRANSPORT_PROVED";
  assert.equal(checkFrozenAssuranceTransport(root, file, exactStatus, currentHead).status, exactStatus);
  assert.throws(
    () => checkFrozenAssuranceTransport(root, file, "NOT_PROVED", currentHead),
    /Malformed historical assurance transport/u,
  );
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


test("current-review admission and full state share the same domain despite ambient Git excludes", () => temporaryDirectory(directory => {
  const git = args => execFileSync("git", ["-c", "user.name=InventoryOnce", "-c", "user.email=inventoryonce@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args], { cwd: directory, encoding: "utf8", stdio: "pipe" });
  git(["init", "-q"]); fs.writeFileSync(path.join(directory, "package.json"), "{}\n");
  git(["add", "package.json"]); git(["commit", "-qm", "baseline"]);
  fs.mkdirSync(path.join(directory, "test"));
  const globalExcludes = path.join(directory, ".git", "global-excludes");
  fs.writeFileSync(globalExcludes, "test/global-hidden.test.ts\n");
  git(["config", "core.excludesFile", globalExcludes]);
  fs.writeFileSync(path.join(directory, ".git", "info", "exclude"), "test/info-hidden.test.ts\n");
  const files = ["test/global-hidden.test.ts", "test/info-hidden.test.ts", "vitest.config.mjs"];
  const committed = repositoryAssuranceCommittedStateSha256(directory, "HEAD");
  for (const file of files) fs.writeFileSync(path.join(directory, file), "export {};\n");
  assert.notEqual(repositoryAssuranceStateSha256(directory), committed);
  assert.deepEqual(currentReviewWorktreeDriftPaths(directory), files);
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


test("strict source references reuse the exact compiler execution gate used by the public call graph", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "experiments/tla-conformance/final-convergence/compact-support-manifest.json"), "utf8"));
  const archive = readCompactArchive(
    fs.readFileSync(path.join(root, manifest.archive.file)),
    manifest.archive.files,
  );
  const checkerPath = "experiments/tla-conformance/surface-bindings/lib/binding-checker.mjs";
  const checker = archive.get(checkerPath)?.toString("utf8");
  assert.equal(typeof checker, "string", `${checkerPath} is missing from compact support.`);
  assert.match(checker, /formal-implementation-vitest-semantics\.cjs/u);
  assert.match(checker, /!compilerCallCanExecute\(ts, node\)/u);
  assert.doesNotMatch(checker, /function isStaticallyUnreachable/u);
  assert.match(JSON.stringify(manifest.bundles), /scripts\/formal-implementation-vitest-semantics\.cjs/u);
});
