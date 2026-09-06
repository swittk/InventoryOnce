import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repositoryAssuranceStateSha256 } from "./repository-assurance-state.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const fullFormal = process.argv.includes("--full-formal");
const manifestRoot = join(packageRoot, "formal/implementation-conformance");
const fullLogPath = join(
  repositoryRoot,
  ".chatgpt",
  "formal-assurance-full-current.log"
);
if (fullFormal) mkdirSync(dirname(fullLogPath), { recursive: true });
const fullLog = fullFormal ? createWriteStream(fullLogPath, { flags: "w" }) : undefined;

/** Mirror runner output to the terminal and, for full assurance, its canonical evidence log. */
function writeAssuranceOutput(stream, chunk) {
  stream.write(chunk);
  fullLog?.write(chunk);
}

/** Execute one assurance step while streaming bounded-memory output into canonical evidence. */
function runAssuranceStep(step, environment) {
  return new Promise((resolveStep, rejectStep) => {
    if (!Array.isArray(step.args) || step.args.length === 0) {
      rejectStep(
        new Error(
          `Formal implementation conformance step '${step.id}' has no resolved command arguments.`
        )
      );
      return;
    }
    const child = spawn(step.command, step.args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...environment, ...(step.env ?? {}) },
    });
    child.stdout.on("data", (chunk) => writeAssuranceOutput(process.stdout, chunk));
    child.stderr.on("data", (chunk) => writeAssuranceOutput(process.stderr, chunk));
    child.once("error", rejectStep);
    child.once("close", (status) => {
      if (status === 0) resolveStep();
      else {
        rejectStep(
          new Error(
            `Formal implementation conformance step '${step.id}' failed with status ${String(status)}.`
          )
        );
      }
    });
  });
}

/** Finish the canonical full-run log before hashing it into executable evidence. */
function closeFullLog() {
  if (fullLog === undefined) return Promise.resolve();
  return new Promise((resolveLog, rejectLog) => {
    fullLog.once("error", rejectLog);
    fullLog.end(resolveLog);
  });
}

/** SHA-256 the exact bytes emitted by the full assurance runner. */
function fullLogSha256() {
  return createHash("sha256").update(readFileSync(fullLogPath)).digest("hex");
}

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
  writeAssuranceOutput(process.stdout, `\n=== ${step.id} ===\n`);
  await runAssuranceStep(step, childProcessEnvironment);
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
const successMessage = "\nFormal implementation conformance production assurance passed.\n";
writeAssuranceOutput(process.stdout, successMessage);
await closeFullLog();

const report = {
  version: 5,
  repositoryHead: head.stdout.trim(),
  repositoryStateSha256: repositoryAssuranceStateSha256(repositoryRoot),
  fullFormal,
  ...(fullFormal ? { fullLogSha256: fullLogSha256() } : {}),
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
const reportPath = fullFormal
  ? join(manifestRoot, "EXECUTABLE_ASSURANCE_REPORT.json")
  : join(
      repositoryRoot,
      ".chatgpt",
      "executable-assurance-report-partial.json"
    );
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
