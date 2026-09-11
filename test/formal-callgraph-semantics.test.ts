import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const typescript = require("typescript") as typeof import("typescript");
const vitestSemantics = require(
  "../scripts/formal-implementation-vitest-semantics.cjs",
) as {
  readonly vitestCallbackExecutes: (metadata: VitestExecutionMetadata) => boolean;
  /** Visit only children that can execute under statically decidable control flow. */
  readonly forEachStaticallyReachableChild: (
    ts: typeof import("typescript"),
    node: import("typescript").Node,
    visit: (node: import("typescript").Node) => void,
  ) => void;
  readonly vitestConditionalMetadata: (
    ts: typeof import("typescript"),
    expression: import("typescript").Expression,
  ) => { readonly conditionKind?: "skipIf" | "runIf"; readonly conditionValue?: boolean };
  readonly vitestSuiteChildrenExecute: (metadata: VitestExecutionMetadata) => boolean;
  readonly vitestFocusedRegistrationNode: (
    ts: typeof import("typescript"),
    node: import("typescript").CallExpression,
  ) => unknown;
  /** Resolve static skip/todo options without executing computed object keys. */
  readonly vitestObjectBooleanOptions: (
    ts: typeof import("typescript"),
    object: import("typescript").ObjectLiteralExpression,
  ) => {
    /** Statically known skip flag, or undefined when an unreadable key could supply it. */
    readonly skip?: boolean;
    /** Statically known todo flag, or undefined when an unreadable key could supply it. */
    readonly todo?: boolean;
  };
};

/** Static facts used to decide whether one Vitest registration callback executes. */
interface VitestExecutionMetadata {
  /** Vitest primitive that registered the callback. */
  readonly registration?: string;
  /** Statically resolved run/skip/todo or absent/unknown registration state. */
  readonly mode: "run" | "skip" | "todo" | "empty" | "unknown";
  /** Conditional registration form when present. */
  readonly conditionKind?: "skipIf" | "runIf";
  /** Statically resolved conditional value when known. */
  readonly conditionValue?: boolean;
  /** Whether an enclosing skipped/non-running suite prevents test/hook execution. */
  readonly insideNonExecutingSuite?: boolean;
  /** Whether an enclosing empty or unknown suite prevents proving nested collection. */
  readonly insideUncollectedSuite?: boolean;
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

/** Collect calls reached by the exact static-control-flow traversal used for callgraph execution credit. */
function staticallyReachableCalls(sourceText: string): readonly string[] {
  const source = typescript.createSourceFile("control-flow.ts", sourceText, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
  const calls: string[] = [];
  const visit = (node: import("typescript").Node): void => {
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression)) calls.push(node.expression.text);
    vitestSemantics.forEachStaticallyReachableChild(typescript, node, visit);
  };
  visit(source);
  return calls;
}

describe("formal call-graph Vitest callback semantics", () => {
  it("excludes statically unreachable branches, short circuits, loops, and post-abrupt calls", () => {
    expect(staticallyReachableCalls(`
      function callbackDead(cb: () => void) { return; cb(); }
      function callbackLive(cb: () => void) { cb(); return; }
      function probe() {
        if (false) deadIf(); else liveElse();
        if (true) liveIf(); else deadElse();
        false ? deadTernary() : liveTernary();
        false && deadAnd();
        true || deadOr();
        while (false) deadWhile();
        for (const value of []) deadForOf();
        for (const key in {}) deadForIn();
        switch (0) { case 1: deadSwitch(); break; case 0: liveSwitch(); break; }
        for (const value of [1]) liveForOf();
        for (const key in { one: 1 }) liveForIn();
        liveBeforeReturn();
        return;
        deadAfterReturn();
      }
    `)).toEqual(["cb", "liveElse", "liveIf", "liveTernary", "liveSwitch", "liveForOf", "liveForIn", "liveBeforeReturn"]);
  });
  it("fails closed on computed Vitest option keys", () => {
    const source = typescript.createSourceFile(
      "computed-options.ts",
      'const flagName = "skip"; test("computed", { [flagName]: true }, () => {});',
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const statement = source.statements[1];
    if (
      statement === undefined ||
      !typescript.isExpressionStatement(statement) ||
      !typescript.isCallExpression(statement.expression) ||
      statement.expression.arguments[1] === undefined ||
      !typescript.isObjectLiteralExpression(statement.expression.arguments[1])
    ) {
      throw new Error("Computed Vitest option regression fixture did not parse as expected.");
    }
    expect(
      vitestSemantics.vitestObjectBooleanOptions(
        typescript,
        statement.expression.arguments[1],
      ),
    ).toEqual({ skip: undefined, todo: undefined });
    expect(
      vitestSemantics.vitestFocusedRegistrationNode(typescript, statement.expression),
    ).not.toBeUndefined();
  });
  it("decodes escaped static Vitest option keys before skip and focus decisions", () => {
    const source = typescript.createSourceFile(
      "escaped-options.ts",
      'test("skip", { "sk\\u0069p": true }, () => {}); test("todo", { "to\\u0064o": true }, () => {}); test("focus", { "on\\u006cy": true }, () => {}); test("not-focus", { "on\\u006cy": false }, () => {});',
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const calls: import("typescript").CallExpression[] = [];
    for (const statement of source.statements) {
      if (typescript.isExpressionStatement(statement) && typescript.isCallExpression(statement.expression)) {
        calls.push(statement.expression);
      }
    }
    const skipOptions = calls[0]?.arguments[1];
    const todoOptions = calls[1]?.arguments[1];
    if (
      skipOptions === undefined || !typescript.isObjectLiteralExpression(skipOptions) ||
      todoOptions === undefined || !typescript.isObjectLiteralExpression(todoOptions) ||
      calls[2] === undefined ||
      calls[3] === undefined
    ) {
      throw new Error("Escaped Vitest option regression fixture did not parse as expected.");
    }
    expect(vitestSemantics.vitestObjectBooleanOptions(typescript, skipOptions)).toEqual({ skip: true, todo: false });
    expect(vitestSemantics.vitestObjectBooleanOptions(typescript, todoOptions)).toEqual({ skip: false, todo: true });
    expect(vitestSemantics.vitestFocusedRegistrationNode(typescript, calls[2])).not.toBeUndefined();
    expect(vitestSemantics.vitestFocusedRegistrationNode(typescript, calls[3])).toBeUndefined();
  });

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
      true
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
      insideUncollectedSuite: true,
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
