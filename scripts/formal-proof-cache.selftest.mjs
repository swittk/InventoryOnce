import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formalModelProofSummary,
  formalMutationProcessProvesInvariantRejection,
  formalProofCacheKey,
  formalProofDescriptor,
  readFormalProofCache,
  transitiveLocalTlaFiles,
  writeFormalProofCache,
} from "./formal-proof-cache.mjs";
import {
  assertFormalMutationRegistrationCompleteness,
  assertFormalMutationRegistrationConsistency,
} from "./formal-models.mjs";

test("transitive local module bytes participate in the proof key", () => {
  const root = mkdtempSync(join(tmpdir(), "inventoryonce-formal-cache-"));
  mkdirSync(join(root, "formal"));
  writeFileSync(join(root, "formal", "Child.tla"), "---- MODULE Child ----\n====\n");
  writeFileSync(
    join(root, "formal", "Model.tla"),
    "---- MODULE Model ----\nEXTENDS Naturals\nC == INSTANCE Child\n====\n"
  );
  writeFileSync(join(root, "formal", "Model.cfg"), "SPECIFICATION Spec\n");
  assert.deepEqual(
    transitiveLocalTlaFiles(root, "Model").map((file) => file.slice(root.length + 1).replaceAll("\\", "/")),
    ["formal/Child.tla", "formal/Model.tla"]
  );
  const first = formalProofDescriptor({
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "model-passed",
    tlaToolsSha256: "a".repeat(64),
    tlcWorkers: "4",
  });
  writeFileSync(join(root, "formal", "Child.tla"), "---- MODULE Child ----\nX == 1\n====\n");
  const second = formalProofDescriptor({
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "model-passed",
    tlaToolsSha256: "a".repeat(64),
    tlcWorkers: "4",
  });
  assert.notEqual(formalProofCacheKey(first), formalProofCacheKey(second));
});

test("exact TLC worker setting participates in the proof key", () => {
  const root = mkdtempSync(join(tmpdir(), "inventoryonce-formal-cache-"));
  mkdirSync(join(root, "formal"));
  writeFileSync(join(root, "formal", "Model.tla"), "---- MODULE Model ----\n====\n");
  writeFileSync(join(root, "formal", "Model.cfg"), "SPECIFICATION Spec\n");
  const common = {
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "model-passed",
    tlaToolsSha256: "c".repeat(64),
  };
  const one = formalProofDescriptor({ ...common, tlcWorkers: "1" });
  const sixteen = formalProofDescriptor({ ...common, tlcWorkers: "16" });
  const automatic = formalProofDescriptor({ ...common, tlcWorkers: "auto" });
  assert.equal(one.tlcWorkers, "1");
  assert.notEqual(formalProofCacheKey(one), formalProofCacheKey(sixteen));
  assert.notEqual(formalProofCacheKey(sixteen), formalProofCacheKey(automatic));
  assert.throws(
    () => formalProofDescriptor({ ...common, tlcWorkers: "0" }),
    /exact TLC worker setting/u,
  );
  assert.throws(
    () => formalProofDescriptor({ ...common, tlaToolsSha256: "not-a-sha", tlcWorkers: "4" }),
    /exact lowercase SHA-256 identity/u,
  );
  assert.throws(
    () => formalProofDescriptor({ ...common, tlaToolsSha256: undefined, tlcWorkers: "4" }),
    /exact lowercase SHA-256 identity/u,
  );
});

test("positive cache records persist exact terminal TLC state/depth evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "inventoryonce-formal-cache-"));
  mkdirSync(join(root, "formal"));
  writeFileSync(join(root, "formal", "Model.tla"), "---- MODULE Model ----\n====\n");
  writeFileSync(join(root, "formal", "Model.cfg"), "SPECIFICATION Spec\n");
  const descriptor = formalProofDescriptor({
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "model-passed",
    tlaToolsSha256: "d".repeat(64),
    tlcWorkers: "4",
  });
  const output = [
    "Progress(9) at 2026-09-09 15:00:00: 12,345 states generated, 678 distinct states found, 0 states left on queue.",
    "12345 states generated, 678 distinct states found, 0 states left on queue.",
    "The depth of the complete state graph search is 9.",
  ].join("\n");
  const evidence = formalModelProofSummary(output);
  assert.deepEqual(evidence, { generated: 12345, distinct: 678, depth: 9 });
  assert.equal(formalModelProofSummary("TLC finished without state totals."), undefined);
  const cache = join(root, "cache");
  assert.throws(
    () => writeFormalProofCache(cache, descriptor),
    /exact terminal TLC state\/depth evidence/u,
  );
  const written = writeFormalProofCache(cache, descriptor, evidence);
  assert.deepEqual(readFormalProofCache(cache, descriptor)?.evidence, evidence);
  const record = JSON.parse(readFileSync(written.path, "utf8"));
  delete record.evidence;
  writeFileSync(written.path, JSON.stringify(record));
  assert.equal(readFormalProofCache(cache, descriptor), undefined);
});

test("cache records require exact descriptor identity and verified status", () => {
  const root = mkdtempSync(join(tmpdir(), "inventoryonce-formal-cache-"));
  mkdirSync(join(root, "formal"));
  writeFileSync(join(root, "formal", "Model.tla"), "---- MODULE Model ----\n====\n");
  writeFileSync(join(root, "formal", "Model.cfg"), "SPECIFICATION Spec\n");
  const descriptor = formalProofDescriptor({
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "mutation-rejected",
    invariant: "Forbidden",
    tlaToolsSha256: "b".repeat(64),
    tlcWorkers: "4",
  });
  assert.equal(descriptor.mutationProcessContractVersion, 2);
  const cache = join(root, "cache");
  assert.equal(readFormalProofCache(cache, descriptor), undefined);
  const written = writeFormalProofCache(cache, descriptor);
  assert.equal(readFormalProofCache(cache, descriptor)?.key, written.key);
  const record = JSON.parse(readFileSync(written.path, "utf8"));
  record.status = "partial";
  writeFileSync(written.path, JSON.stringify(record));
  assert.equal(readFormalProofCache(cache, descriptor), undefined);
});


test("mutation proof acceptance requires one completed TLC safety-violation process", () => {
  const invariant = "Expected";
  const output = `Error: Invariant ${invariant} is violated.\n`;
  assert.equal(formalMutationProcessProvesInvariantRejection({
    status: 12, signal: null, output, invariant,
  }), true);
  for (const candidate of [
    { status: null, signal: "SIGKILL", output, invariant },
    { status: 1, signal: "SIGKILL", output, invariant },
    { status: 1, signal: null, output, invariant },
    { status: 12, signal: "SIGTERM", output, invariant },
    { status: 0, signal: null, output, invariant },
    { status: 12, signal: null, output: "Invariant Other is violated.", invariant },
  ]) {
    assert.equal(formalMutationProcessProvesInvariantRejection(candidate), false);
  }
});


test("mutation registry rejects invalid model and invariant tuple content before TLC", () => {
  const configs = new Map([
    ["AlphaMutation", "INVARIANT AlphaInvariant\n"],
    ["BetaMutation", "INVARIANT BetaInvariant\n"],
  ]);
  const readConfig = (config) => {
    const value = configs.get(config);
    if (value === undefined) throw new Error(`Missing synthetic config '${config}'.`);
    return value;
  };
  const complete = [
    ["Alpha", "AlphaMutation", "AlphaInvariant"],
    ["Beta", "BetaMutation", "BetaInvariant"],
  ];
  assert.doesNotThrow(() =>
    assertFormalMutationRegistrationConsistency(readConfig, complete, ["Alpha", "Beta"]),
  );
  assert.throws(
    () => assertFormalMutationRegistrationConsistency(
      readConfig,
      [["Gamma", "AlphaMutation", "AlphaInvariant"]],
      ["Alpha", "Beta"],
    ),
    /targets unregistered model 'Gamma'/u,
  );
  assert.throws(
    () => assertFormalMutationRegistrationConsistency(
      readConfig,
      [["Alpha", "AlphaMutation", "WrongInvariant"]],
      ["Alpha", "Beta"],
    ),
    /expects undeclared invariant 'WrongInvariant'/u,
  );
});

test("mutation registry rejects missing, duplicate, and extra configs", () => {
  const files = ["AlphaMutation.cfg", "BetaMutation.cfg", "Ordinary.cfg"];
  const complete = [
    ["Alpha", "AlphaMutation", "AlphaInvariant"],
    ["Beta", "BetaMutation", "BetaInvariant"],
  ];
  assert.deepEqual(
    assertFormalMutationRegistrationCompleteness(files, complete),
    ["AlphaMutation.cfg", "BetaMutation.cfg"],
  );
  assert.throws(
    () => assertFormalMutationRegistrationCompleteness(files, complete.slice(0, 1)),
    /missing=\[BetaMutation\.cfg\]/u,
  );
  assert.throws(
    () => assertFormalMutationRegistrationCompleteness(files, [...complete, complete[0]]),
    /registered more than once/u,
  );
  assert.throws(
    () => assertFormalMutationRegistrationCompleteness(files, [...complete, ["Gamma", "GammaMutation", "GammaInvariant"]]),
    /extra=\[GammaMutation\.cfg\]/u,
  );
});
