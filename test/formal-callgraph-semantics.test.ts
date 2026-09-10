import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const typescript = require("typescript") as typeof import("typescript");
const vitestSemantics = require(
  "../scripts/formal-implementation-vitest-semantics.cjs",
) as {
  readonly vitestCallbackExecutes: (metadata: VitestExecutionMetadata) => boolean;
  readonly vitestConditionalMetadata: (
    ts: typeof import("typescript"),
    expression: import("typescript").Expression,
  ) => { readonly conditionKind?: "skipIf" | "runIf"; readonly conditionValue?: boolean };
  readonly vitestSuiteChildrenExecute: (metadata: VitestExecutionMetadata) => boolean;
  readonly vitestFocusedRegistrationNode: (
    ts: typeof import("typescript"),
    node: import("typescript").CallExpression,
  ) => unknown;
};

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
  const decoded = vitestSemantics[helperName](metadata);
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
  const decisions: boolean[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const text = sources[index];
    if (text === undefined) continue;
    const source = typescript.createSourceFile(
      `focus-${index}.ts`,
      text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    let focused = false;
    const visit = (node: import("typescript").Node): void => {
      if (focused) return;
      if (
        typescript.isCallExpression(node) &&
        vitestSemantics.vitestFocusedRegistrationNode(typescript, node) !== undefined
      ) {
        focused = true;
        return;
      }
      typescript.forEachChild(node, visit);
    };
    typescript.forEachChild(source, visit);
    decisions.push(focused);
  }
  return decisions;
}

/** Ask whether tests/hooks registered inside one suite can execute after collection. */
function suiteChildrenExecute(metadata: VitestExecutionMetadata): boolean {
  return semanticsDecision("vitestSuiteChildrenExecute", metadata);
}

describe("formal call-graph Vitest callback semantics", () => {
  it("fails closed when conditional Vitest modifiers are chained", () => {
    const source = typescript.createSourceFile(
      "conditional-chain.ts",
      'test.skipIf(true).runIf(true)("chained", () => {});',
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const statement = source.statements[0];
    if (
      statement === undefined ||
      !typescript.isExpressionStatement(statement) ||
      !typescript.isCallExpression(statement.expression)
    ) {
      throw new Error("Conditional Vitest regression fixture did not parse as expected.");
    }
    const metadata = vitestSemantics.vitestConditionalMetadata(
      typescript,
      statement.expression.expression,
    );
    expect(metadata.conditionKind).toBe("runIf");
    expect(metadata.conditionValue).toBeUndefined();
    expect(callbackExecutes({ registration: "test", mode: "run", ...metadata })).toBe(false);
  });
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
