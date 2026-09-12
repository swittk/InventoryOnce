import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { repositoryAssuranceStateSha256 } from "./repository-assurance-state.mjs";
import { executableAssuranceStepIds, executableAssuranceSummary } from "./executable-assurance-coherence.mjs";

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
let fullLogError;
fullLog?.on("error", (error) => {
  fullLogError ??= error;
});

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
    const settle = () => {
      if (fullLogError !== undefined) rejectLog(fullLogError);
      else resolveLog();
    };
    if (fullLog.closed) {
      settle();
      return;
    }
    fullLog.once("close", settle);
    fullLog.end();
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
    id: executableAssuranceStepIds.generateCurrentSurface,
    command: "pnpm",
    args: ["--dir", packageRoot, "assurance:generate"],
  },
  {
    id: executableAssuranceStepIds.auditCorrespondence,
    command: "pnpm",
    args: ["--dir", packageRoot, "assurance", "--write-report"],
  },
  {
    id: executableAssuranceStepIds.packageStrictTypes,
    command: "pnpm",
    args: ["--dir", packageRoot, "check"],
  },
  {
    id: executableAssuranceStepIds.memoryEvidence,
    command: "pnpm",
    args: undefined,
  },
];

if (fullFormal) {
  steps.push(
    {
      id: executableAssuranceStepIds.completePackageTests,
      command: "pnpm",
      args: ["--dir", packageRoot, "test"],
    },
    {
      id: executableAssuranceStepIds.packageProductionBuild,
      command: "pnpm",
      args: ["--dir", packageRoot, "build"],
    },
    {
      id: executableAssuranceStepIds.registeredTlcModelSuite,
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
  if (step.id === executableAssuranceStepIds.memoryEvidence) {
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
const currentSummary = executableAssuranceSummary({ api, fields, callChains, traces, gaps });
const successMessage = "\nFormal implementation conformance production assurance passed.\n";
writeAssuranceOutput(process.stdout, successMessage);
await closeFullLog();

const report = {
  version: 5,
  repositoryHead: head.stdout.trim(),
  repositoryStateSha256: repositoryAssuranceStateSha256(repositoryRoot),
  fullFormal,
  ...(fullFormal ? { fullLogSha256: fullLogSha256() } : {}),
  ...currentSummary,
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
