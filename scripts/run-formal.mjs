import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  formalInvariantMutationChecks,
  formalModels,
} from "./formal-models.mjs";
import {
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
function cacheVerifiedProof(descriptor) {
  // Cold mode bypasses reads but still refreshes exact verified proof entries for the next run.
  return writeFormalProofCache(formalProofCacheDirectory, descriptor);
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
function runJava(args, { capture = false, maxBytes = 64 * 1024 * 1024 } = {}) {
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
      resolvePromise({ status: code ?? 1, signal, stdout, stderr });
    });
  });
}

/** Run independent proof units through a deterministic bounded worker pool. */
async function runBoundedPool(items, runItem) {
  let nextIndex = 0;
  let firstFailure = 0;
  async function worker() {
    while (firstFailure === 0) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const status = await runItem(items[index]);
      if (status !== 0 && firstFailure === 0) firstFailure = status;
    }
  }
  const workers = Array.from(
    { length: Math.min(requestedJobs, Math.max(1, items.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return firstFailure;
}

/** Run one model in its own collision-safe TLC metadata folder. */
async function runModel(model) {
  const descriptor = formalProofDescriptor({
    repositoryRoot: process.cwd(),
    model,
    config: model,
    outcome: "model-passed",
    tlaToolsSha256: TLA_SHA256,
  });
  const hit = cachedProof(descriptor);
  if (hit !== undefined) {
    console.log(`TLC proof cache hit for '${model}' (${hit.key.slice(0, 12)}).`);
    return 0;
  }

  // TLC's default metadata folder only has second-level time precision, so concurrent gates collide.
  const modelMetadataDirectory = join(
    "states",
    `${process.pid}-${randomUUID()}`
  );
  let modelPassed = false;
  try {
    const result = await runJava([
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
    ]);
    if (result.status !== 0) {
      console.error(
        `TLC failure metadata remains at ${modelMetadataDirectory}.`
      );
      return result.status ?? 1;
    }
    modelPassed = true;
    const written = cacheVerifiedProof(descriptor);
    if (written !== undefined) {
      console.log(`Cached verified TLC proof for '${model}' (${written.key.slice(0, 12)}).`);
    }
    return 0;
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
  });
  const hit = cachedProof(descriptor);
  if (hit !== undefined) {
    console.log(
      `TLC mutation proof cache hit for '${config}'/'${invariant}' (${hit.key.slice(0, 12)}).`
    );
    return 0;
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
    const expectedViolation = `Invariant ${invariant} is violated.`;
    if (result.status === 0 || !output.includes(expectedViolation)) {
      process.stderr.write(output);
      console.error(
        `TLC mutation '${config}' did not reject '${invariant}'. Metadata remains at ${modelMetadataDirectory}.`
      );
      return result.status === 0 ? 1 : result.status ?? 1;
    }
    mutationRejected = true;
    console.log(`TLC rejected '${config}' through '${invariant}'.`);
    const written = cacheVerifiedProof(descriptor);
    if (written !== undefined) {
      console.log(
        `Cached verified TLC mutation proof for '${config}' (${written.key.slice(0, 12)}).`
      );
    }
    return 0;
  } finally {
    if (mutationRejected) {
      rmSync(modelMetadataDirectory, { recursive: true, force: true });
    }
  }
}

await ensureTlaTools();
console.log(
  `InventoryOnce formal mode: ${coldFormalRun ? "cold/full (cache bypassed)" : "content-addressed proof cache enabled"}; TLC jobs=${requestedJobs}; workers/job=${requestedWorkers}.`
);
const modelStatus = await runBoundedPool(formalModels, async (model) => {
  console.log(`\n=== TLC: ${model} ===`);
  return runModel(model);
});
if (modelStatus !== 0) process.exit(modelStatus);

const mutationStatus = await runBoundedPool(
  formalInvariantMutationChecks,
  async ([model, config, invariant]) => {
    console.log(`\n=== TLC expected rejection: ${config} ===`);
    return runInvariantMutationCheck(model, config, invariant);
  }
);
if (mutationStatus !== 0) process.exit(mutationStatus);

console.log(
  "\nAll InventoryOnce TLA+ models passed, and every registered forbidden transition was rejected by its safety invariant."
);
