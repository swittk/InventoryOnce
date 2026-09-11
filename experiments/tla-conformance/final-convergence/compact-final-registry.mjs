// experiments/tla-conformance/final-convergence/build-final-registry.mjs
import assert from "node:assert/strict";
import fs2 from "node:fs";
import path3 from "node:path";

// experiments/tla-conformance/surface-bindings/lib/compiler-surface.mjs
import crypto from "node:crypto";
import ts from "typescript";
var TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
function sha256(value2) {
  return crypto.createHash("sha256").update(value2).digest("hex");
}

// experiments/tla-conformance/final-convergence/repository-root.mjs
import path2 from "node:path";

// scripts/assurance-files.mjs
import fs from "node:fs";
import path from "node:path";
function assuranceRepositoryPath(repositoryRoot, relativePath) {
  const root = path.resolve(repositoryRoot);
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0") || relativePath.includes("\\") || path.isAbsolute(relativePath)) throw new Error(`Invalid repository-relative assurance path: ${String(relativePath)}.`);
  const components = relativePath.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) throw new Error(`Assurance path escapes repository root: ${relativePath}.`);
  let current = root;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Assurance repository root is not an ordinary directory.");
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Assurance path crosses a symbolic link: ${relativePath}.`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`Assurance path ancestor is not a directory: ${relativePath}.`);
  }
  return current;
}

// experiments/tla-conformance/final-convergence/repository-root.mjs
import { fileURLToPath } from "node:url";
function finalConvergenceRepositoryRoot(moduleUrl) {
  return path2.resolve(path2.dirname(fileURLToPath(moduleUrl)), "../../..");
}
function finalConvergenceRepositoryPath(repositoryRoot, repositoryRelativePath) {
  return assuranceRepositoryPath(repositoryRoot, repositoryRelativePath);
}

// experiments/tla-conformance/final-convergence/build-final-registry.mjs
var ROOT = finalConvergenceRepositoryRoot(import.meta.url);
var OFFICIAL = "experiments/tla-conformance/r105-layered-6dfc-currentization/surface-bindings-6dfc.json";
var VALUE = "experiments/tla-conformance/final-convergence/final-v309.json";
var PRODUCER = "experiments/tla-conformance/final-convergence/final-a121-b58.json";
var OUTPUT = "experiments/tla-conformance/final-convergence/final-surface-bindings.json";
function read(file) {
  return fs2.readFileSync(path3.resolve(ROOT, file));
}
function json(file) {
  return JSON.parse(read(file).toString("utf8"));
}
function ref(file) {
  const bytes = read(file);
  return { file, sha256: sha256(bytes) };
}
var official = json(OFFICIAL);
var value = json(VALUE);
var producer = json(PRODUCER);
assert.equal(value.proofKind, "final-convergence-value-v309-v1");
assert.equal(value.proofs.length, 309);
assert.equal(producer.proofKind, "final-convergence-producer-a121-b58-v1");
assert.equal(producer.proofs.length, 179);
assert.equal(value.surfaceDigest, producer.surfaceDigest);
var valueKeys = new Set(value.proofs.map((p) => p.surfaceKey));
var producerByKey = new Map(producer.proofs.map((p) => [p.surfaceKey, p.mode]));
assert.equal(valueKeys.size, 309);
assert.equal(producerByKey.size, 179);
var valueRef = ref(VALUE);
var producerRef = ref(PRODUCER);
var bindings = official.bindings.map((binding) => {
  if (binding.mode === "HARD_RED") return structuredClone(binding);
  if (binding.mode === "V") {
    assert(valueKeys.has(binding.surfaceKey));
    return { surfaceKey: binding.surfaceKey, mode: "V", evidence: valueRef };
  }
  assert(binding.mode === "A" || binding.mode === "B");
  assert.equal(producerByKey.get(binding.surfaceKey), binding.mode);
  return { surfaceKey: binding.surfaceKey, mode: binding.mode, evidence: producerRef };
});
assert.equal(bindings.length, 535);
assert.equal(new Set(bindings.map((b) => b.surfaceKey)).size, 535);
var counts = bindings.reduce((m, b) => (m[b.mode] = (m[b.mode] ?? 0) + 1, m), {});
assert.deepEqual(counts, { A: 121, B: 58, V: 309, HARD_RED: 47 });
var external = bindings.filter((b) => b.mode === "HARD_RED");
var oldExternal = official.bindings.filter((b) => b.mode === "HARD_RED");
assert.deepEqual(external, oldExternal, "Final registry changed honest external HARD_RED membership/reasons.");
var output = { schemaVersion: 1, owner: "final-convergence-0c94ee9", bindings };
var text = `${JSON.stringify(output, null, 2)}
`;
var outputPath = finalConvergenceRepositoryPath(ROOT, OUTPUT);
if (process.argv.includes("--check")) assert.equal(fs2.readFileSync(outputPath, "utf8"), text, "Final 535 registry is stale.");
else fs2.writeFileSync(outputPath, text);
console.log(JSON.stringify({ status: "FINAL_535_REGISTRY_BUILT", counts, valueEvidence: valueRef, producerEvidence: producerRef, externalRows: external.length }, null, 2));
