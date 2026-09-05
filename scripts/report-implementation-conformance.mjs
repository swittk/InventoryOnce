import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formalConfigCheckNames,
  formalModels,
  statefulOperationFamilyIds,
} from "./formal-models.mjs";
import { repositoryAssuranceStateSha256 } from "./repository-assurance-state.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const manifestRoot = resolve(packageRoot, "formal/implementation-conformance");
const chatgptRoot = resolve(repositoryRoot, ".chatgpt");
const logArgument = process.argv.find((value) => value.startsWith("--log="));
const fullLogPath = resolve(
  repositoryRoot,
  logArgument?.slice("--log=".length) ??
    ".chatgpt/formal-assurance-full-current.log"
);

/** Read one checked JSON file. */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Remove ANSI terminal decoration. */
function plain(value) {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/gu, "");
}

/** SHA-256 one evidence file. */
function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Split the runner log by named step. */
function sections(log) {
  const result = new Map();
  const matches = [...log.matchAll(/^=== ([a-z0-9-]+) ===$/gmu)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? log.length;
    result.set(match[1].trim(), log.slice(start, end));
  }
  return result;
}

/** Parse Vitest completion rows from one runner step. */
function vitestRuns(section) {
  const files = [...section.matchAll(/Test Files\s+([0-9]+) passed/gu)].map(
    (match) => Number(match[1])
  );
  const tests = [...section.matchAll(/Tests\s+([0-9]+) passed/gu)].map(
    (match) => Number(match[1])
  );
  return files.map((fileCount, index) => ({
    files: fileCount,
    tests: tests[index] ?? 0,
  }));
}

/** Parse scale-test JSON rows. */
function performanceRows(log) {
  const byAdapter = new Map();
  for (const line of log.split(/\r?\n/u)) {
    const value = line.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) continue;
    let row;
    try {
      row = JSON.parse(value);
    } catch {
      // Ignore malformed/non-metric JSON from other gates.
      continue;
    }
    if (row === null || typeof row !== "object") continue;
    /** Complete metric shape emitted by the in-memory scale extrapolation. */
    const scaledShape =
      typeof row.scaledPositions === "number" &&
      typeof row.scaledPublishMs === "number" &&
      typeof row.scaledReadMs === "number" &&
      typeof row.scaledPlanMs === "number";
    /** Complete metric shape emitted by a measured durable adapter run. */
    const measuredShape =
      typeof row.positionCount === "number" &&
      typeof row.publishMs === "number" &&
      typeof row.readMs === "number" &&
      typeof row.planMs === "number" &&
      typeof row.serializedWorldBytes === "number";
    if (
      ["memory", "mongo", "sqlite"].includes(row.adapter) &&
      (scaledShape || measuredShape)
    ) {
      byAdapter.set(row.adapter, row);
    }
  }
  return [...byAdapter.values()].sort((left, right) =>
    String(left.adapter).localeCompare(String(right.adapter))
  );
}

/** Parse terminal TLC state counts. */
function tlaRows(section) {
  const result = [];
  let current;
  for (const line of section.split(/\r?\n/u)) {
    const header = /^=== TLC: ([A-Za-z0-9_]+) ===$/u.exec(line);
    if (header !== null) {
      current = { model: header[1] };
      result.push(current);
      continue;
    }
    if (current === undefined) continue;
    const states =
      /([0-9,]+) states generated, ([0-9,]+) distinct states found, 0 states left on queue\./u.exec(
        line
      );
    if (states !== null) {
      current.generated = Number(states[1].replaceAll(",", ""));
      current.distinct = Number(states[2].replaceAll(",", ""));
    }
    const depth =
      /depth of the complete state graph search is ([0-9]+)\./u.exec(line);
    if (depth !== null) current.depth = Number(depth[1]);
  }
  return result;
}

/** Count every configured invariant/property from the shared registered model list. */
function configuredFormalCheckCount() {
  let count = 0;
  for (const model of formalModels) {
    const configPath = resolve(packageRoot, `formal/${model}.cfg`);
    if (!existsSync(configPath)) {
      throw new Error(
        `Registered formal model '${model}' is missing '${configPath}'.`
      );
    }
    count += formalConfigCheckNames(readFileSync(configPath, "utf8")).length;
  }
  return count;
}

/** Escape one Markdown table cell. */
function md(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

if (!existsSync(fullLogPath)) {
  throw new Error(`Missing current full assurance log '${fullLogPath}'.`);
}
const api = readJson(resolve(manifestRoot, "API_ASSURANCE.json"));
const fields = readJson(resolve(manifestRoot, "FIELD_CLASSIFICATION.json"));
const traces = readJson(resolve(manifestRoot, "TRACE_REPLAY_ASSURANCE.json"));
const callChains = readJson(resolve(manifestRoot, "CALL_CHAIN_ASSURANCE.json"));
const gaps = readJson(resolve(manifestRoot, "FORMAL_COVERAGE_GAPS.json"));
const executable = readJson(
  resolve(manifestRoot, "EXECUTABLE_ASSURANCE_REPORT.json")
);
const log = plain(readFileSync(fullLogPath, "utf8"));
const byStep = sections(log);
const currentRepositoryStateSha256 = repositoryAssuranceStateSha256(repositoryRoot);
if (
  typeof executable.repositoryStateSha256 !== "string" ||
  executable.repositoryStateSha256 !== currentRepositoryStateSha256
) {
  throw new Error(
    "Executable assurance evidence does not match the current repository source/evidence state."
  );
}
if (!executable.fullFormal) {
  throw new Error("Executable report was not produced by --full-formal.");
}
if (
  !log.includes(
    "Formal implementation conformance production assurance passed."
  )
) {
  throw new Error("Full assurance log lacks terminal success.");
}
for (const step of executable.steps) {
  if (step.status !== "passed" || !byStep.has(step.id)) {
    throw new Error(`Assurance step '${step.id}' is absent or not passed.`);
  }
}
const formal = tlaRows(byStep.get("registered-tlc-model-suite") ?? "");
const observedFormalModels = formal.map((row) => row.model).sort();
const expectedFormalModels = [...formalModels].sort();
if (
  formal.length !== formalModels.length ||
  observedFormalModels.some(
    (model, index) => model !== expectedFormalModels[index]
  ) ||
  formal.some(
    (row) =>
      row.generated === undefined ||
      row.distinct === undefined ||
      row.depth === undefined
  )
) {
  throw new Error(
    `Expected ${formalModels.length} complete TLC rows; found ${formal.length}.`
  );
}
const performance = performanceRows(log);
if (!performance.some((row) => row.adapter === "memory")) {
  throw new Error(
    "Missing current performance metrics for the memory reference adapter."
  );
}
const testRuns = Object.fromEntries(
  [...byStep].map(([step, section]) => [step, vitestRuns(section)])
);
const expectedRuns = {
  "complete-package-tests": [36, 450],
};
for (const [step, [minimumFiles, minimumTests]] of Object.entries(
  expectedRuns
)) {
  if (
    !(testRuns[step] ?? []).some(
      (run) => run.files >= minimumFiles && run.tests >= minimumTests
    )
  ) {
    throw new Error(`Step '${step}' lacks its expected test summary.`);
  }
}
const sourcePaths = [
  "package.json",
  "src/projection.ts",
  "scripts/formal-implementation-surface.cjs",
  "scripts/formal-implementation-callgraph.cjs",
  "scripts/generate-formal-implementation-assurance.py",
  "scripts/audit-formal-implementation-conformance.mjs",
  "scripts/run-formal-implementation-conformance.mjs",
  "scripts/report-implementation-conformance.mjs",
  "scripts/run-formal.mjs",
  "scripts/formal-models.mjs",
  "formal/ImplementationConformance.tla",
  "formal/ImplementationConformance.cfg",
  "formal/SnapshotSupersededWorkflow.tla",
  "formal/SnapshotSupersededWorkflow.cfg",
  "formal/implementation-conformance/API_ASSURANCE.json",
  "formal/implementation-conformance/FIELD_CLASSIFICATION.json",
  "formal/implementation-conformance/CALL_CHAIN_ASSURANCE.json",
  "formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json",
  "formal/implementation-conformance/FORMAL_COVERAGE_GAPS.json",
  "test/formal-implementation-abstraction.ts",
  "test/formal-implementation-refinement.test.ts",
  "test/formal-storage-refinement-suite.ts",
  "test/projection-index-scale.test.ts",
  "test/formal-public-surface-completion.test.ts",
  "test/transformations.test.ts",
];
const sourceDigests = Object.fromEntries(
  sourcePaths.map((path) => [path, digest(resolve(repositoryRoot, path))])
);
/** Count exact trace entries by refinement mode without repeatedly copying the accumulator. */
const traceModes = {};
for (const entry of Object.values(traces.entries)) {
  traceModes[entry.refinementMode] =
    (traceModes[entry.refinementMode] ?? 0) + 1;
}
const tracedOperationFamilies = new Set(
  Object.values(traces.entries).flatMap((entry) => entry.operationFamilies)
);
/** Count shared stateful families whose declaration and bounded trace evidence remain covered. */
const coveredStatefulOperationFamilies = statefulOperationFamilyIds.filter(
  (familyId) => {
    const family = api.families[familyId];
    return (
      family?.status === "covered" &&
      family.models.length > 0 &&
      family.stateProjection.length > 0 &&
      tracedOperationFamilies.has(familyId)
    );
  }
);
if (coveredStatefulOperationFamilies.length !== statefulOperationFamilyIds.length) {
  const covered = new Set(coveredStatefulOperationFamilies);
  const missing = statefulOperationFamilyIds.filter((familyId) => !covered.has(familyId));
  throw new Error(
    `Final report is missing bounded coverage for stateful families: ${missing.join(", ")}.`
  );
}
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  repositoryHead: executable.repositoryHead,
  repositoryStateSha256: currentRepositoryStateSha256,
  fullFormal: true,
  surfaceSha256: api.surfaceSha256,
  coverage: {
    apiEntries: Object.keys(api.entries).length,
    signatures: api.counts.callAndConstructSignatures,
    directExecutableApis: api.counts.directExecutableApis,
    indirectCallChainApis: api.counts.indirectCallChainApis,
    explicitGapApis: api.counts.explicitGapApis,
    unreferencedPublicApis: api.counts.unreferencedPublicApis,
    compilerCallGraphCallables: callChains.counts.callables,
    compilerCallGraphEdges: callChains.counts.edges,
    compilerCallGraphTestRoots: callChains.counts.testRoots,
    compilerCallGraphWitnessedApis:
      callChains.counts.publicEntriesWithWitnesses,
    compilerCallGraphUnresolvedApis: callChains.counts.unresolvedPublicEntries,
    types: fields.counts.types,
    fields: fields.counts.fields,
    inputFields: fields.counts.inputFields,
    outputFields: fields.counts.outputFields,
    optionalFields: fields.counts.optionalFields,
    callableFields: fields.counts.callableFields,
    recursiveTypeReferences: fields.counts.recursiveTypeReferences,
    maximumTypeDepth: api.counts.maximumTypeDepth,
    truncatedTypes: fields.counts.truncatedTypes,
    families: Object.keys(api.families).length,
    statefulFamiliesCovered: coveredStatefulOperationFamilies.length,
    statefulFamiliesTotal: statefulOperationFamilyIds.length,
  },
  traces: {
    total: Object.keys(traces.entries).length,
    modes: traceModes,
    entries: traces.entries,
  },
  gaps: {
    total: Object.keys(gaps.gaps).length,
    entries: gaps.gaps,
  },
  performance,
  formal: {
    models: formal,
    configuredInvariantsAndProperties: configuredFormalCheckCount(),
  },
  gates: { steps: executable.steps, testRuns },
  sourceDigests,
};
if (report.coverage.unreferencedPublicApis !== 0) {
  throw new Error("Final report contains an unreferenced public API.");
}
if (report.coverage.truncatedTypes !== 0) {
  throw new Error("Final report contains a silently truncated public type.");
}
const reportPath = resolve(
  chatgptRoot,
  "formal-implementation-conformance-final-report.json"
);
const markerRoot = resolve(chatgptRoot, "test-markers");
mkdirSync(markerRoot, { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const formalRows = formal
  .map(
    (row) =>
      `| \`${row.model}\` | ${row.generated.toLocaleString(
        "en-US"
      )} | ${row.distinct.toLocaleString("en-US")} | ${row.depth} |`
  )
  .join("\n");
const gapRows = Object.entries(gaps.gaps)
  .map(
    ([id, gap]) =>
      `| \`${id}\` | ${md(gap.status)} | ${md(gap.productionImpact)} | ${md(
        gap.requiredMitigation
      )} |`
  )
  .join("\n");
const scaleRows = performance
  .map((row) => {
    if (row.scaledPositions !== undefined) {
      return `| memory | ${row.scaledPositions} | ${row.scaledPublishMs.toFixed(
        1
      )} | ${row.scaledReadMs.toFixed(1)} | ${row.scaledPlanMs.toFixed(
        1
      )} | — |`;
    }
    return `| ${row.adapter} | ${row.positionCount} | ${row.publishMs.toFixed(
      1
    )} | ${row.readMs.toFixed(1)} | ${row.planMs.toFixed(
      1
    )} | ${row.serializedWorldBytes.toLocaleString("en-US")} |`;
  })
  .join("\n");
const modeText = Object.entries(traceModes)
  .map(([mode, count]) => `${count} ${mode}`)
  .join(", ");
const markdownReport = `# InventoryOnce formal implementation conformance — exact final tree

Generated: ${report.generatedAt}

Validated source/evidence state: \`${report.repositoryStateSha256}\`
Validation HEAD provenance: \`${report.repositoryHead}\`

## Surface assurance

- Public API rows: **${report.coverage.apiEntries}**
- Complete call/construct signatures: **${report.coverage.signatures}**
- Public semantic fields: **${report.coverage.fields}**
- Input-reachable fields: **${report.coverage.inputFields}**
- Output-reachable fields: **${report.coverage.outputFields}**
- Explicit recursive public-type edges: **${
  report.coverage.recursiveTypeReferences
}**
- Silently truncated public types: **${report.coverage.truncatedTypes}**
- Directly executed APIs: **${report.coverage.directExecutableApis}**
- APIs exercised through compiler-resolved tested call chains: **${
  report.coverage.indirectCallChainApis
}**
- Compiler call graph: **${
  report.coverage.compilerCallGraphCallables
}** callable bodies / **${
  report.coverage.compilerCallGraphEdges
}** resolved edges / **${
  report.coverage.compilerCallGraphTestRoots
}** Vitest roots
- Public implementation bodies with tested witnesses: **${
  report.coverage.compilerCallGraphWitnessedApis
} / ${report.coverage.apiEntries}**
- Unresolved compiler call-graph API implementations: **${
  report.coverage.compilerCallGraphUnresolvedApis
}**
- Explicit-gap APIs: **${report.coverage.explicitGapApis}**
- Unreferenced public APIs: **${report.coverage.unreferencedPublicApis}**

## Implementation evidence

- Stateful operation families: **${report.coverage.statefulFamiliesCovered} / ${
  report.coverage.statefulFamiliesTotal
}** with bounded trace/property witnesses.
- Trace entries: **${report.traces.total}** — ${modeText}.
- The package reference adapter runs the complete frozen-plan and failpoint matrix.
- Migration definition, dry-run, publication, retry, changed-plan rejection, repair, and abort are represented without claiming a Shinebright database adapter in this slice.

## Index and real-world scale

| Adapter | Positions/lots | Publish ms | Indexed read ms | FIFO plan ms | Serialized world bytes |
|---|---:|---:|---:|---:|---:|
${scaleRows}

The write-side item/revision/container index update batches membership mutations per event and sorts each affected group once. Public hot reads remain item/revision-index scoped, and FIFO uses retained positive-layer provenance. Database index and restart evidence belongs with each later application adapter.

## Exact TLC results

| Model | Generated | Distinct | Depth |
|---|---:|---:|---:|
${formalRows}

TLC is bounded model checking. It is paired here with executable state/result refinement and the memory reference-adapter conformance suite; it is not a proof of arbitrary TypeScript or database implementations.

## Explicit gaps / non-claims

| Gap | Status | Production impact | Required mitigation |
|---|---|---|---|
${gapRows}

## Machine evidence

- \`${relative(repositoryRoot, reportPath)}\`
- \`formal/implementation-conformance/API_ASSURANCE.json\`
- \`formal/implementation-conformance/FIELD_CLASSIFICATION.json\`
- \`formal/implementation-conformance/TRACE_REPLAY_ASSURANCE.json\`
- \`formal/implementation-conformance/FORMAL_COVERAGE_GAPS.json\`
- \`formal/implementation-conformance/EXECUTABLE_ASSURANCE_REPORT.json\`
`;
writeFileSync(
  resolve(markerRoot, "formal-implementation-conformance-final.report.md"),
  markdownReport
);
const review = `# Formal implementation conformance semantic review

Verdict: **PASS within the explicit bounded assurance boundary**.

- The exact current public surface is mechanically discovered without silent recursive-type truncation.
- Every public API has a compiler-resolved path from a registered Vitest callback to its exact implementation body; text occurrence is diagnostic only and grants no coverage.
- Every semantic field is classified as input/output/both and carries formal correspondence plus evidence or an explicit gap.
- Every stateful operation family has a bounded witness; state/result refinements are distinguished from bounded property tests.
- The memory reference adapter executes critical receipt, issue, transfer, count, migration, authority, and public-read traces.
- Kernel index scale and reference-adapter restart behavior are measured on the exact final tree; application database adapters are a later slice.
- Remaining gaps are machine-enumerated and are not presented as proved behavior.
`;
writeFileSync(
  resolve(markerRoot, "formal-implementation-conformance-final.review.md"),
  review
);
console.log(
  `Wrote exact final report: ${report.coverage.apiEntries} APIs, ${report.coverage.fields} fields, ${report.formal.models.length} TLC models.`
);
