import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  formalMutationProcessProvesInvariantRejection,
  formalProofCacheKey,
  formalProofDescriptor,
  readFormalProofCache,
  transitiveLocalTlaFiles,
  writeFormalProofCache,
} from "./formal-proof-cache.mjs";

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
  });
  writeFileSync(join(root, "formal", "Child.tla"), "---- MODULE Child ----\nX == 1\n====\n");
  const second = formalProofDescriptor({
    repositoryRoot: root,
    model: "Model",
    config: "Model",
    outcome: "model-passed",
    tlaToolsSha256: "a".repeat(64),
  });
  assert.notEqual(formalProofCacheKey(first), formalProofCacheKey(second));
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
