import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  finalConvergenceRepositoryPath,
  finalConvergenceRepositoryRoot,
} from "./repository-root.mjs";

const ROOT = finalConvergenceRepositoryRoot(import.meta.url);
const LAB = "experiments/tla-conformance";
const OFFICIAL = `${LAB}/r105-layered-6dfc-currentization/surface-bindings-6dfc.json`;
const MATRIX = `${LAB}/r131-current-source-family-rederive/builder-matrix.json`;
const OUTPUT = `${LAB}/final-convergence/base-authority-index.json`;

if (process.argv.includes("--check-root")) {
  process.stdout.write(`${ROOT}\n`);
  process.exit(0);
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function read(file) { return fs.readFileSync(path.resolve(ROOT, file)); }
function json(file) { return JSON.parse(read(file).toString("utf8")); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const official = json(OFFICIAL);
const strict = new Map(official.bindings.filter((row) => row.mode !== "HARD_RED").map((row) => [row.surfaceKey, row.mode]));

const roots = Object.freeze([
  `${LAB}/r163-r147-whole-trace-peer`,
  `${LAB}/r162-r152-storage-value7-peer`,
  `${LAB}/r161-r149-full7-peer`,
  `${LAB}/r160-r147-fungibility-movement3-peer`,
  `${LAB}/r158-direct35-clean-handoff`,
  `${LAB}/r157-singleton4-currentization`,
  `${LAB}/r148-pure-value-residual-currentization`,
  `${LAB}/r147-event-result30-currentization`,
  `${LAB}/r142-physical-count-currentization`,
  `${LAB}/r141-b25-currentization`,
  `${LAB}/r139-storage-environment-no-builder-currentization/downstream43-current`,
  `${LAB}/r138-sparse-empty-value-currentization`,
  `${LAB}/r134-sparse-record-shared-currentization`,
  `${LAB}/r131-current-source-family-rederive/current-artifacts`,
]);
const matrix = json(MATRIX);
const matrixFiles = [
  ...matrix.rows.filter((row) => row.status === "BUILT_CURRENT").map((row) => row.artifactFile),
  `${LAB}/final-convergence/migration-frontier-v2-current.json`,
];

const candidates = new Map();
const candidatePriority = new WeakMap();
function add(surfaceKey, candidate, rootPriority) {
  if (!strict.has(surfaceKey)) return;
  const rows = candidates.get(surfaceKey) ?? [];
  rows.push(candidate);
  candidatePriority.set(candidate, rootPriority);
  candidates.set(surfaceKey, rows);
}
function inspect(file, rootPriority) {
  let document;
  const bytes = read(file);
  try { document = JSON.parse(bytes.toString("utf8")); } catch { return; }
  const evidence = { file, sha256: sha256(bytes) };
  if (document && typeof document.proofKind === "string" && Array.isArray(document.proofs)) {
    for (let index = 0; index < document.proofs.length; index += 1) {
      const proof = document.proofs[index];
      if (typeof proof?.surfaceKey !== "string") continue;
      add(proof.surfaceKey, {
        kind: "PROOF_ARTIFACT",
        proofKind: document.proofKind,
        surfaceDigest: document.surfaceDigest ?? document.sourceHub?.surfaceDigest ?? null,
        evidence,
        proofIndex: index,
        proofSemanticSha256: sha256(Buffer.from(canonical(proof.semantics ?? proof.semantic ?? proof))),
      }, rootPriority);
    }
  }
  if (document && Array.isArray(document.bindings)) {
    for (let index = 0; index < document.bindings.length; index += 1) {
      const binding = document.bindings[index];
      if (typeof binding?.surfaceKey !== "string" || binding.mode === "HARD_RED") continue;
      add(binding.surfaceKey, {
        kind: "BINDING_REGISTRY",
        mode: binding.mode,
        evidence,
        bindingIndex: index,
        bindingSha256: sha256(Buffer.from(canonical(binding))),
      }, rootPriority);
    }
  }
  if (document && Array.isArray(document.rows)) {
    for (let index = 0; index < document.rows.length; index += 1) {
      const binding = document.rows[index]?.binding;
      if (typeof binding?.surfaceKey !== "string" || binding.mode === "HARD_RED") continue;
      add(binding.surfaceKey, {
        kind: "ROW_BINDING_REGISTRY",
        mode: binding.mode,
        evidence,
        rowIndex: index,
        bindingSha256: sha256(Buffer.from(canonical(binding))),
      }, rootPriority);
    }
  }
}
function walk(directory, rootPriority) {
  if (!fs.existsSync(path.resolve(ROOT, directory))) return;
  for (const entry of fs.readdirSync(path.resolve(ROOT, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, rootPriority);
    else if (entry.name.endsWith(".json")) inspect(file, rootPriority);
  }
}
for (let index = 0; index < roots.length; index += 1) walk(roots[index], index);
for (const file of matrixFiles) inspect(file, roots.length);

const selected = [];
const missing = [];
for (const [surfaceKey, mode] of strict) {
  const rows = candidates.get(surfaceKey) ?? [];
  // Prefer a proof artifact over a binding-only registry; root traversal order is priority.
  rows.sort((left, right) => {
    const kindRank = { PROOF_ARTIFACT: 0, BINDING_REGISTRY: 1, ROW_BINDING_REGISTRY: 2 };
    const rank = kindRank[left.kind] - kindRank[right.kind];
    if (rank !== 0) return rank;
    const priority = candidatePriority.get(left) - candidatePriority.get(right);
    if (priority !== 0) return priority;
    if (left.evidence.file === right.evidence.file) return 0;
    return left.evidence.file < right.evidence.file ? -1 : 1;
  });
  const candidate = rows[0];
  if (candidate === undefined) missing.push({ surfaceKey, mode });
  else selected.push({ surfaceKey, mode, authority: candidate, alternatives: rows.length });
}
const surfaceCounts = {};
for (const row of selected) {
  const surface = row.authority.surfaceDigest ?? "BINDING_ONLY";
  surfaceCounts[surface] = (surfaceCounts[surface] ?? 0) + 1;
}
const output = {
  schemaVersion: 1,
  official: { file: OFFICIAL, sha256: sha256(read(OFFICIAL)), strictRows: strict.size },
  selectedRows: selected.length,
  missingRows: missing.length,
  surfaceCounts,
  selected,
  missing,
};
const outputText = `${JSON.stringify(output, null, 2)}\n`;
const outputPath = finalConvergenceRepositoryPath(ROOT, OUTPUT);
if (process.argv.includes("--check")) {
  if (fs.readFileSync(outputPath, "utf8") !== outputText) {
    throw new Error("Base authority index is stale.");
  }
} else {
  fs.writeFileSync(outputPath, outputText);
}
console.log(JSON.stringify({ selected: selected.length, missing: missing.length, surfaceCounts, missingRows: missing }, null, 2));
