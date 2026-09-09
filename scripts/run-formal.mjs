import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  assertFormalMutationRegistrationCompleteness,
  formalInvariantMutationChecks,
  formalModels,
} from "./formal-models.mjs";
import {
  formalModelProofSummary,
  formalMutationProcessProvesInvariantRejection,
  formalProofDescriptor,
  readFormalProofCache,
  writeFormalProofCache,
} from "./formal-proof-cache.mjs";

const TLA_VERSION = "1.7.4";
const TLA_SHA256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";
const TLA_URL = `https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar`;
const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
const inventoryOnceCache = join(cacheRoot, "inventoryonce", "tla");
const inventoryOnceJar = join(
  inventoryOnceCache,
  `tla2tools-${TLA_VERSION}.jar`
);
const jarPath = process.env.TLA2TOOLS_JAR ?? inventoryOnceJar;
const formalProofCacheDirectory =
  process.env.INVENTORYONCE_TLA_PROOF_CACHE ?? join(inventoryOnceCache, "proofs-v1");
const coldFormalRun = process.env.INVENTORYONCE_FORMAL_COLD === "1";
const availableCpus = availableParallelism();
const requestedJobsText = process.env.INVENTORYONCE_TLC_JOBS ?? String(Math.min(2, availableCpus));
if (!/^[1-9][0-9]*$/u.test(requestedJobsText)) {
  throw new Error("INVENTORYONCE_TLC_JOBS must be a positive integer.");
}
const requestedJobs = Number(requestedJobsText);
const defaultWorkers = Math.max(1, Math.min(16, Math.floor(availableCpus / requestedJobs)));
const requestedWorkers = process.env.INVENTORYONCE_TLC_WORKERS ?? String(defaultWorkers);
if (requestedWorkers !== "auto" && !/^[1-9][0-9]*$/u.test(requestedWorkers)) {
  throw new Error("INVENTORYONCE_TLC_WORKERS must be 'auto' or a positive integer.");
}

/** Return the SHA-256 of one local file without trusting its name. */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Return a verified cache hit unless this invocation explicitly requests a cold proof. */
function cachedProof(descriptor) {
  if (coldFormalRun) return undefined;
  return readFormalProofCache(formalProofCacheDirectory, descriptor);
}

/** Publish one proof only after TLC has produced the required terminal outcome. */
function cacheVerifiedProof(descriptor, evidence = undefined) {
  // Cold mode bypasses reads but still refreshes exact verified proof entries for the next run.
  return writeFormalProofCache(formalProofCacheDirectory, descriptor, evidence);
}

/** Make sure the exact pinned official TLA+ tools jar exists before running TLC. */
async function ensureTlaTools() {
  if (existsSync(jarPath) && sha256(jarPath) === TLA_SHA256) return;
  if (process.env.TLA2TOOLS_JAR !== undefined) {
    throw new Error(
      `TLA2TOOLS_JAR does not match pinned TLA+ tools v${TLA_VERSION} SHA-256 ${TLA_SHA256}.`
    );
  }
  mkdirSync(inventoryOnceCache, { recursive: true });
  const temporaryJar = join(
    inventoryOnceCache,
    `.tla2tools-${TLA_VERSION}-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    const response = await fetch(TLA_URL, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      throw new Error(
        `Unable to download pinned TLA+ tools v${TLA_VERSION}: ${response.status} ${response.statusText}`
      );
    }
    writeFileSync(temporaryJar, Buffer.from(await response.arrayBuffer()), {
      flag: "wx",
    });
    const actual = sha256(temporaryJar);
    if (actual !== TLA_SHA256) {
      throw new Error(
        `Downloaded TLA+ tools checksum ${actual} did not match ${TLA_SHA256}.`
      );
    }
    renameSync(temporaryJar, inventoryOnceJar);
  } finally {
    if (existsSync(temporaryJar)) unlinkSync(temporaryJar);
  }
}


/** Run one Java child to completion without blocking the scheduler. */
function runJava(args, { capture = true, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("java", args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let overflowed = false;
    const retain = (which, chunk) => {
      if (overflowed) return;
      capturedBytes += chunk.length;
      if (capturedBytes > maxBytes) {
        overflowed = true;
        child.kill("SIGTERM");
        return;
      }
      if (which === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    if (capture) {
      child.stdout.on("data", (chunk) => retain("stdout", chunk));
      child.stderr.on("data", (chunk) => retain("stderr", chunk));
    }
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (overflowed) {
        rejectPromise(new Error(`TLC captured output exceeded ${maxBytes} bytes.`));
        return;
      }
      resolvePromise({ status: code, signal, stdout, stderr });
    });
  });
}

/** Run independent proof units through a deterministic bounded worker pool. */
async function runBoundedPool(items, runItem) {
  let nextIndex = 0;
  let firstFailure = 0;
  const results = new Array(items.length);
  async function worker() {
    while (firstFailure === 0) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const result = await runItem(items[index]);
      results[index] = result;
      if (result.status !== 0 && firstFailure === 0) firstFailure = result.status;
    }
  }
  const workers = Array.from(
    { length: Math.min(requestedJobs, Math.max(1, items.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return { status: firstFailure, results };
}

/** Emit one completed proof section with no output interleaving from parallel TLC children. */
function emitProofSection(header, result) {
  console.log(`\n${header}`);
  if (result.output.length !== 0) {
    process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
  }
}

/** Run one model in its own collision-safe TLC metadata folder. */
async function runModel(model) {
  const descriptor = formalProofDescriptor({
    repositoryRoot: process.cwd(),
    model,
    config: model,
    outcome: "model-passed",
    tlaToolsSha256: TLA_SHA256,
    tlcWorkers: requestedWorkers,
  });
  const hit = cachedProof(descriptor);
  if (hit !== undefined) {
    const evidence = hit.evidence;
    return {
      status: 0,
      output:
        `TLC proof cache hit for '${model}' (${hit.key.slice(0, 12)}).\n` +
        `${evidence.generated} states generated, ${evidence.distinct} distinct states found, 0 states left on queue.\n` +
        `The depth of the complete state graph search is ${evidence.depth}.\n`,
    };
  }

  // TLC's default metadata folder only has second-level time precision, so concurrent gates collide.
  const modelMetadataDirectory = join(
    "states",
    `${process.pid}-${randomUUID()}`
  );
  let modelPassed = false;
  try {
    const result = await runJava(
      [
        "-XX:+UseParallelGC",
        "-jar",
        jarPath,
        "-workers",
        requestedWorkers,
        "-metadir",
        modelMetadataDirectory,
        "-config",
        `formal/${model}.cfg`,
        `formal/${model}.tla`,
      ],
      { capture: true }
    );
    let output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.signal !== null || result.status !== 0) {
      output += `TLC failure metadata remains at ${modelMetadataDirectory}.\n`;
      return {
        status: typeof result.status === "number" && result.status !== 0 ? result.status : 1,
        output,
      };
    }
    const evidence = formalModelProofSummary(output);
    if (evidence === undefined) {
      output += `TLC completed without one exact terminal state/depth summary; metadata remains at ${modelMetadataDirectory}.\n`;
      return { status: 1, output };
    }
    modelPassed = true;
    const written = cacheVerifiedProof(descriptor, evidence);
    if (written !== undefined) {
      output += `Cached verified TLC proof for '${model}' (${written.key.slice(0, 12)}).\n`;
    }
    return { status: 0, output };
  } finally {
    if (modelPassed) {
      rmSync(modelMetadataDirectory, { recursive: true, force: true });
    }
  }
}

/** Run one forbidden transition and require TLC to reject its named invariant. */
async function runInvariantMutationCheck(model, config, invariant) {
  const descriptor = formalProofDescriptor({
    repositoryRoot: process.cwd(),
    model,
    config,
    outcome: "mutation-rejected",
    invariant,
    tlaToolsSha256: TLA_SHA256,
    tlcWorkers: requestedWorkers,
  });
  const hit = cachedProof(descriptor);
  if (hit !== undefined) {
    return {
      status: 0,
      output: `TLC mutation proof cache hit for '${config}'/'${invariant}' (${hit.key.slice(0, 12)}).\n`,
    };
  }

  // Keep each expected counterexample separate so one invariant cannot hide another.
  const modelMetadataDirectory = join(
    "states",
    `${process.pid}-${randomUUID()}`
  );
  let mutationRejected = false;
  try {
    const result = await runJava(
      [
        "-XX:+UseParallelGC",
        "-jar",
        jarPath,
        "-workers",
        requestedWorkers,
        "-metadir",
        modelMetadataDirectory,
        "-config",
        `formal/${config}.cfg`,
        `formal/${model}.tla`,
      ],
      { capture: true }
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (
      !formalMutationProcessProvesInvariantRejection({
        status: result.status,
        signal: result.signal,
        output,
        invariant,
      })
    ) {
      const failureOutput =
        `${output}TLC mutation '${config}' did not complete with the expected ` +
        `'${invariant}' safety violation. Metadata remains at ${modelMetadataDirectory}.\n`;
      return {
        status: typeof result.status === "number" && result.status !== 0
          ? result.status
          : 1,
        output: failureOutput,
      };
    }
    mutationRejected = true;
    let successOutput = `${output}TLC rejected '${config}' through '${invariant}'.\n`;
    const written = cacheVerifiedProof(descriptor);
    if (written !== undefined) {
      successOutput +=
        `Cached verified TLC mutation proof for '${config}' (${written.key.slice(0, 12)}).\n`;
    }
    return { status: 0, output: successOutput };
  } finally {
    if (mutationRejected) {
      rmSync(modelMetadataDirectory, { recursive: true, force: true });
    }
  }
}

assertFormalMutationRegistrationCompleteness(
  readdirSync(join(process.cwd(), "formal")),
);
await ensureTlaTools();
console.log(
  `InventoryOnce formal mode: ${coldFormalRun ? "cold/full (cache bypassed)" : "content-addressed proof cache enabled"}; TLC jobs=${requestedJobs}; workers/job=${requestedWorkers}.`
);
const modelRun = await runBoundedPool(formalModels, (model) => runModel(model));
for (let index = 0; index < modelRun.results.length; index += 1) {
  const result = modelRun.results[index];
  const model = formalModels[index];
  if (result !== undefined && model !== undefined) {
    emitProofSection(`=== TLC: ${model} ===`, result);
  }
}
if (modelRun.status !== 0) process.exit(modelRun.status);

const mutationRun = await runBoundedPool(
  formalInvariantMutationChecks,
  ([model, config, invariant]) => runInvariantMutationCheck(model, config, invariant)
);
for (let index = 0; index < mutationRun.results.length; index += 1) {
  const result = mutationRun.results[index];
  const row = formalInvariantMutationChecks[index];
  if (result !== undefined && row !== undefined) {
    emitProofSection(`=== TLC expected rejection: ${row[1]} ===`, result);
  }
}
if (mutationRun.status !== 0) process.exit(mutationRun.status);

console.log(
  "\nAll InventoryOnce TLA+ models passed, and every registered forbidden transition was rejected by its safety invariant."
);
