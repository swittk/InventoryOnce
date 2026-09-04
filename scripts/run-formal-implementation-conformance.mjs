import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const fullFormal = process.argv.includes("--full-formal");
const manifestRoot = join(packageRoot, "formal/implementation-conformance");

/** Read one checked implementation-conformance manifest. */
function readManifest(name) {
  return JSON.parse(readFileSync(join(manifestRoot, name), "utf8"));
}

/** Return every executable evidence path selected for one adapter scope. */
function traceEvidenceTests(traces, adapter) {
  const paths = new Set();
  for (const entry of Object.values(traces.entries)) {
    if (adapter !== undefined && !entry.adapters.includes(adapter)) continue;
    for (const evidence of entry.evidence) {
      if (!/\.(?:test|spec)\.tsx?$/u.test(evidence)) continue;
      paths.add(evidence);
    }
  }
  return [...paths].sort();
}

/** Convert repository-relative evidence to one package working-directory path. */
function relativeEvidence(path, workingRoot) {
  return relative(workingRoot, resolve(repositoryRoot, path)).replaceAll(
    "\\",
    "/"
  );
}

/** Ordered deterministic assurance commands. */
const steps = [
  {
    id: "generate-current-surface",
    command: "pnpm",
    args: ["--dir", packageRoot, "assurance:generate"],
  },
  {
    id: "audit-api-field-trace-gap-correspondence",
    command: "pnpm",
    args: ["--dir", packageRoot, "assurance", "--write-report"],
  },
  {
    id: "package-strict-types",
    command: "pnpm",
    args: ["--dir", packageRoot, "check"],
  },
  {
    id: "memory-trace-property-and-authority-evidence",
    command: "pnpm",
    args: undefined,
  },
];

if (fullFormal) {
  steps.push(
    {
      id: "complete-package-tests",
      command: "pnpm",
      args: ["--dir", packageRoot, "test"],
    },
    {
      id: "package-production-build",
      command: "pnpm",
      args: ["--dir", packageRoot, "build"],
    },
    {
      id: "registered-tlc-model-suite",
      command: "pnpm",
      args: ["--dir", packageRoot, "formal"],
    }
  );
}

let traces;
let packageTraceTests = [];
/** Child validation commands must not inherit CI=true because repository pnpm behavior is defined outside CI mode. */
const childProcessEnvironment = { ...process.env };
delete childProcessEnvironment.CI;
for (const step of steps) {
  if (step.id === "memory-trace-property-and-authority-evidence") {
    traces = readManifest("TRACE_REPLAY_ASSURANCE.json");
    packageTraceTests = [
      ...new Set([
        "test/formal-implementation-conformance.test.ts",
        ...traceEvidenceTests(traces, "memory")
          .filter((path) => path.startsWith("test/"))
          .map((path) => relativeEvidence(path, packageRoot)),
      ]),
    ].sort();
    step.args = [
      "--dir",
      packageRoot,
      "exec",
      "vitest",
      "run",
      ...packageTraceTests,
    ];
  }
  console.log(`\n=== ${step.id} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: { ...childProcessEnvironment, ...(step.env ?? {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Formal implementation conformance step '${
        step.id
      }' failed with status ${String(result.status)}.`
    );
  }
}

traces ??= readManifest("TRACE_REPLAY_ASSURANCE.json");
const api = readManifest("API_ASSURANCE.json");
const fields = readManifest("FIELD_CLASSIFICATION.json");
const callChains = readManifest("CALL_CHAIN_ASSURANCE.json");
const gaps = readManifest("FORMAL_COVERAGE_GAPS.json");
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
if (head.status !== 0) {
  throw new Error("Unable to record the certified repository HEAD.");
}
const report = {
  version: 3,
  repositoryHead: head.stdout.trim(),
  fullFormal,
  surfaceSha256: api.surfaceSha256,
  apiEntries: Object.keys(api.entries).length,
  callAndConstructSignatures: api.counts.callAndConstructSignatures,
  directExecutableApis: api.counts.directExecutableApis,
  indirectCallChainApis: api.counts.indirectCallChainApis,
  explicitGapApis: api.counts.explicitGapApis,
  unreferencedPublicApis: api.counts.unreferencedPublicApis,
  compilerCallGraphCallables: callChains.counts.callables,
  compilerCallGraphEdges: callChains.counts.edges,
  compilerCallGraphTestRoots: callChains.counts.testRoots,
  compilerCallGraphWitnessedApis: callChains.counts.publicEntriesWithWitnesses,
  compilerCallGraphUnresolvedApis: callChains.counts.unresolvedPublicEntries,
  fieldEntries: Object.keys(fields.entries).length,
  inputFields: fields.counts.inputFields,
  outputFields: fields.counts.outputFields,
  recursiveTypeReferences: fields.counts.recursiveTypeReferences,
  truncatedTypes: fields.counts.truncatedTypes,
  boundedTraceEntries: Object.keys(traces.entries).length,
  tracedPublicApis: new Set(
    Object.values(traces.entries).flatMap((entry) => entry.apiEntries)
  ).size,
  stateResultTraceEntries: Object.values(traces.entries).filter(
    (entry) => entry.refinementMode === "state-result-refinement"
  ).length,
  boundedPropertyTraceEntries: Object.values(traces.entries).filter(
    (entry) => entry.refinementMode === "bounded-property"
  ).length,
  directPropertyTraceEntries: Object.values(traces.entries).filter(
    (entry) => entry.refinementMode === "direct-property"
  ).length,
  explicitGapEntries: Object.keys(gaps.gaps).length,
  packageTraceTests,
  steps: steps.map((step) => ({ id: step.id, status: "passed" })),
};
writeFileSync(
  join(manifestRoot, "EXECUTABLE_ASSURANCE_REPORT.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log("\nFormal implementation conformance production assurance passed.");
