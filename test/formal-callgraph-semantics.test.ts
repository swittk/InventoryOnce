import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Static facts used to decide whether one Vitest registration callback executes. */
interface VitestExecutionMetadata {
  /** Vitest primitive that registered the callback. */
  readonly registration?: string;
  /** Statically resolved run/skip/todo state. */
  readonly mode: "run" | "skip" | "todo" | "unknown";
  /** Conditional registration form when present. */
  readonly conditionKind?: "skipIf" | "runIf";
  /** Statically resolved conditional value when known. */
  readonly conditionValue?: boolean;
  /** Whether an enclosing skipped/non-running suite prevents test/hook execution. */
  readonly insideNonExecutingSuite?: boolean;
  /** Whether an enclosing todo suite prevents even nested suite collection. */
  readonly insideTodoSuite?: boolean;
  /** Whether the enclosing suite/file contains at least one runnable test. */
  readonly suiteHasRunnableTest?: boolean;
}

/** Run one named call-graph semantics helper and require one boolean decision. */
function semanticsDecision(
  helperName: "vitestCallbackExecutes" | "vitestSuiteChildrenExecute",
  metadata: VitestExecutionMetadata,
): boolean {
  const script = [
    `const { ${helperName} } = require("./scripts/formal-implementation-vitest-semantics.cjs");`,
    `process.stdout.write(JSON.stringify(${helperName}(JSON.parse(process.argv[1]))));`,
  ].join("\n");
  const decoded: unknown = JSON.parse(
    execFileSync(process.execPath, ["-e", script, JSON.stringify(metadata)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  if (typeof decoded !== "boolean") {
    throw new Error(`${helperName} returned a non-boolean decision.`);
  }
  return decoded;
}

/** Ask the exact call-graph helper whether Vitest executes one registration callback. */
function callbackExecutes(metadata: VitestExecutionMetadata): boolean {
  return semanticsDecision("vitestCallbackExecutes", metadata);
}

/** Ask the exact call-graph detector whether each source contains a focused Vitest registration. */
function focusedRegistrationDecisions(sources: readonly string[]): readonly boolean[] {
  const script = [
    'const ts = require("typescript");',
    'const { vitestFocusedRegistrationNode } = require("./scripts/formal-implementation-vitest-semantics.cjs");',
    'const sources = JSON.parse(process.argv[1]);',
    'const decisions = sources.map((text, index) => {',
    '  const source = ts.createSourceFile(`focus-${index}.ts`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);',
    '  let focused = false;',
    '  const visit = (node) => {',
    '    if (focused) return;',
    '    if (ts.isCallExpression(node) && vitestFocusedRegistrationNode(ts, node) !== undefined) focused = true;',
    '    ts.forEachChild(node, visit);',
    '  };',
    '  ts.forEachChild(source, visit);',
    '  return focused;',
    '});',
    'process.stdout.write(JSON.stringify(decisions));',
  ].join("\n");
  const decoded: unknown = JSON.parse(
    execFileSync(process.execPath, ["-e", script, JSON.stringify(sources)], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  if (!Array.isArray(decoded) || decoded.some((value) => typeof value !== "boolean")) {
    throw new Error("Focused-registration detector returned a non-boolean decision list.");
  }
  return decoded as boolean[];
}

/** Ask whether tests/hooks registered inside one suite can execute after collection. */
function suiteChildrenExecute(metadata: VitestExecutionMetadata): boolean {
  return semanticsDecision("vitestSuiteChildrenExecute", metadata);
}

describe("formal call-graph Vitest callback semantics", () => {
  it("rejects every focused Vitest registration spelling used by the call graph", () => {
    expect(focusedRegistrationDecisions([
      'it.only("focused", () => {});',
      'test.only("focused", () => {});',
      'describe.only("focused", () => {});',
      'test("focused", { only: true }, () => {});',
      'test("ordinary", { only: false }, () => {});',
      'test("ordinary", () => {});',
    ])).toEqual([true, true, true, true, false, false]);
  });
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

  it("executes hooks only when their suite has a runnable test", () => {
    for (const registration of [
      "beforeAll",
      "beforeEach",
      "afterAll",
      "afterEach",
    ] as const) {
      expect(callbackExecutes({
        registration,
        mode: "run",
        suiteHasRunnableTest: false,
      })).toBe(false);
      expect(callbackExecutes({
        registration,
        mode: "run",
        suiteHasRunnableTest: true,
      })).toBe(true);
    }
  });

  it("preserves skipped-suite collection while excluding its test and hook callbacks", () => {
    const skippedSuite: VitestExecutionMetadata = {
      registration: "describe",
      mode: "skip",
    };
    expect(callbackExecutes(skippedSuite)).toBe(true);
    expect(callbackExecutes({ registration: "describe", mode: "todo" })).toBe(
      false
    );
    expect(suiteChildrenExecute(skippedSuite)).toBe(false);
    expect(suiteChildrenExecute({ registration: "describe", mode: "run" })).toBe(true);
    expect(callbackExecutes({
      registration: "describe",
      mode: "run",
      insideNonExecutingSuite: true,
    })).toBe(true);
    expect(callbackExecutes({
      registration: "describe",
      mode: "run",
      insideTodoSuite: true,
    })).toBe(false);
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
