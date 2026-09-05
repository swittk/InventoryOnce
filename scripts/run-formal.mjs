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
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  formalInvariantMutationChecks,
  formalModels,
} from "./formal-models.mjs";

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

/** Return the SHA-256 of one local file without trusting its name. */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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


/** Run one model in its own collision-safe TLC metadata folder. */
function runModel(model) {
  // TLC's default metadata folder only has second-level time precision, so concurrent gates collide.
  const modelMetadataDirectory = join(
    "states",
    `${process.pid}-${randomUUID()}`
  );
  let modelPassed = false;
  try {
    const result = spawnSync(
      "java",
      [
        "-XX:+UseParallelGC",
        "-jar",
        jarPath,
        "-workers",
        "auto",
        "-metadir",
        modelMetadataDirectory,
        "-config",
        `formal/${model}.cfg`,
        `formal/${model}.tla`,
      ],
      { stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(
        `TLC failure metadata remains at ${modelMetadataDirectory}.`
      );
      return result.status ?? 1;
    }
    modelPassed = true;
    return 0;
  } finally {
    if (modelPassed) {
      rmSync(modelMetadataDirectory, { recursive: true, force: true });
    }
  }
}

/** Run one forbidden transition and require TLC to reject its named invariant. */
function runInvariantMutationCheck(model, config, invariant) {
  // Keep each expected counterexample separate so one invariant cannot hide another.
  const modelMetadataDirectory = join(
    "states",
    `${process.pid}-${randomUUID()}`
  );
  let mutationRejected = false;
  try {
    const result = spawnSync(
      "java",
      [
        "-XX:+UseParallelGC",
        "-jar",
        jarPath,
        "-workers",
        "auto",
        "-metadir",
        modelMetadataDirectory,
        "-config",
        `formal/${config}.cfg`,
        `formal/${model}.tla`,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    if (result.error) throw result.error;
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
    return 0;
  } finally {
    if (mutationRejected) {
      rmSync(modelMetadataDirectory, { recursive: true, force: true });
    }
  }
}

await ensureTlaTools();
for (const model of formalModels) {
  console.log(`\n=== TLC: ${model} ===`);
  const status = runModel(model);
  if (status !== 0) process.exit(status);
}

for (const [model, config, invariant] of formalInvariantMutationChecks) {
  console.log(`\n=== TLC expected rejection: ${config} ===`);
  const status = runInvariantMutationCheck(model, config, invariant);
  if (status !== 0) process.exit(status);
}

console.log(
  "\nAll InventoryOnce TLA+ models passed, and every registered forbidden transition was rejected by its safety invariant."
);
