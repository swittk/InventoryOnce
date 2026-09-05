import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface VitestExecutionMetadata {
  readonly registration?: string;
  readonly mode: "run" | "skip" | "todo" | "unknown";
  readonly conditionKind?: "skipIf" | "runIf";
  readonly conditionValue?: boolean;
  readonly insideNonExecutingSuite?: boolean;
}

/** Ask the exact call-graph helper whether Vitest executes one registration callback. */
function callbackExecutes(metadata: VitestExecutionMetadata): boolean {
  const script = [
    'const { vitestCallbackExecutes } = require("./scripts/formal-implementation-vitest-semantics.cjs");',
    'process.stdout.write(JSON.stringify(vitestCallbackExecutes(JSON.parse(process.argv[1]))));',
  ].join("\n");
  return JSON.parse(
    execFileSync(process.execPath, ["-e", script, JSON.stringify(metadata)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
  );
}

/** Ask whether tests/hooks registered inside one suite can execute after collection. */
function suiteChildrenExecute(metadata: VitestExecutionMetadata): boolean {
  const script = [
    'const { vitestSuiteChildrenExecute } = require("./scripts/formal-implementation-vitest-semantics.cjs");',
    'process.stdout.write(JSON.stringify(vitestSuiteChildrenExecute(JSON.parse(process.argv[1]))));',
  ].join("\n");
  return JSON.parse(
    execFileSync(process.execPath, ["-e", script, JSON.stringify(metadata)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
  );
}

describe("formal call-graph Vitest callback semantics", () => {
  it("excludes skipped, todo, option-skipped, and non-running conditional tests", () => {
    expect(callbackExecutes({ registration: "test", mode: "skip" })).toBe(false);
    expect(callbackExecutes({ registration: "it", mode: "todo" })).toBe(false);
    expect(callbackExecutes({ registration: "test", mode: "unknown" })).toBe(false);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      conditionKind: "skipIf",
      conditionValue: true,
    })).toBe(false);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      conditionKind: "runIf",
      conditionValue: false,
    })).toBe(false);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      conditionKind: "runIf",
    })).toBe(false);
  });

  it("keeps statically runnable conditional tests and ordinary tests executable", () => {
    expect(callbackExecutes({ registration: "it", mode: "run" })).toBe(true);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      conditionKind: "skipIf",
      conditionValue: false,
    })).toBe(true);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      conditionKind: "runIf",
      conditionValue: true,
    })).toBe(true);
  });

  it("preserves skipped-suite collection while excluding its test and hook callbacks", () => {
    const skippedSuite = { registration: "describe", mode: "skip" } as const;
    expect(callbackExecutes(skippedSuite)).toBe(true);
    expect(suiteChildrenExecute(skippedSuite)).toBe(false);
    expect(callbackExecutes({
      registration: "describe",
      mode: "run",
      insideNonExecutingSuite: true,
    })).toBe(true);
    expect(callbackExecutes({
      registration: "test",
      mode: "run",
      insideNonExecutingSuite: true,
    })).toBe(false);
    expect(callbackExecutes({
      registration: "beforeEach",
      mode: "run",
      insideNonExecutingSuite: true,
    })).toBe(false);
  });
});
