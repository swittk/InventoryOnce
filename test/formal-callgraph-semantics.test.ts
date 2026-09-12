import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const typescript = require("typescript") as typeof import("typescript");
const vitestSemantics = require(
  "../scripts/formal-implementation-vitest-semantics.cjs",
) as {
  readonly vitestCallbackExecutes: (metadata: VitestExecutionMetadata) => boolean;
  /** Return whether one Promise callback position can prove ordinary execution. */
  readonly standardLibraryPromiseCallbackCanExecute: (methodName: string, argumentIndex: number) => boolean;
  /** Return true only when TypeScript's bound control flow proves that one call can execute. */
  readonly compilerCallCanExecute: (
    ts: typeof import("typescript"),
    node: import("typescript").CallExpression | import("typescript").NewExpression,
  ) => boolean;
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

/** Ask the exact compiler-flow gate whether named call sites can execute. */
function compilerFlowCallDecisions(sourceText: string): Readonly<Record<string, boolean>> {
  const directory = mkdtempSync(join(tmpdir(), "inventoryonce-flow-"));
  try {
    const file = join(directory, "control-flow.ts");
    writeFileSync(file, sourceText);
    const program = typescript.createProgram([file], {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.ESNext,
      noEmit: true,
      skipLibCheck: true,
    });
    program.getTypeChecker();
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error("Compiler-flow regression fixture was not loaded.");
    const decisions: Record<string, boolean> = {};
    const visit = (node: import("typescript").Node): void => {
      if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name.startsWith("flow")) {
          decisions[name] = vitestSemantics.compilerCallCanExecute(typescript, node);
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(source);
    return decisions;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("formal call-graph Promise callback semantics", () => {
  it("does not grant execution credit to rejection-only handlers", () => {
    expect(vitestSemantics.standardLibraryPromiseCallbackCanExecute("then", 0)).toBe(true);
    expect(vitestSemantics.standardLibraryPromiseCallbackCanExecute("then", 1)).toBe(false);
    expect(vitestSemantics.standardLibraryPromiseCallbackCanExecute("catch", 0)).toBe(false);
    expect(vitestSemantics.standardLibraryPromiseCallbackCanExecute("finally", 0)).toBe(true);
  });
});

describe("formal call-graph Vitest callback semantics", () => {
  it("uses compiler flow without losing hoisting or targeted continue semantics", () => {
    const decisions = compilerFlowCallDecisions(`
      declare function flowDeadIf(): void;
      declare function flowDeadElse(): void;
      declare function flowDeadTernary(): void;
      declare function flowDeadAnd(): void;
      declare function flowDeadOr(): void;
      declare function flowDeadWhile(): void;
      declare function flowDeadForOf(): void;
      declare function flowDeadForIn(): void;
      declare function flowDeadSwitch(): void;
      declare function flowDeadAfterReturn(): void;
      declare function flowDeadLabeledFor(): void;
      declare function flowDeadLabeledDo(): void;
      declare function flowLiveElse(): void;
      declare function flowLiveIf(): void;
      declare function flowLiveTernary(): void;
      declare function flowLiveSwitch(): void;
      declare function flowLiveBeforeReturn(): void;
      declare function flowLiveHoisted(): void;
      declare function flowLiveForContinue(): void;
      declare function flowLiveDoContinue(): void;
      declare function flowLiveConditionalContinue(): void;
      function probe(flag: boolean): void {
        if (false) flowDeadIf(); else flowLiveElse();
        if (true) flowLiveIf(); else flowDeadElse();
        false ? flowDeadTernary() : flowLiveTernary();
        false && flowDeadAnd();
        true || flowDeadOr();
        while (false) flowDeadWhile();
        for (const value of []) flowDeadForOf();
        for (const key in {}) flowDeadForIn();
        switch (0) { case 1: flowDeadSwitch(); break; case 0: flowLiveSwitch(); break; }
        outerFor: for (let turns = 0; turns < 1; turns += 1) {
          for (; true; flowDeadLabeledFor()) { continue outerFor; }
        }
        outerDo: for (let turns = 0; turns < 1; turns += 1) {
          do { continue outerDo; } while (flowDeadLabeledDo());
        }
        let forTurns = 0;
        for (; forTurns < 1; flowLiveForContinue(), forTurns += 1) { continue; }
        let doTurns = 0;
        do { continue; } while (flowLiveDoContinue(), ++doTurns < 1);
        let conditionalTurns = 0;
        for (; conditionalTurns < 1; flowLiveConditionalContinue(), conditionalTurns += 1) {
          if (flag) continue;
          return;
        }
        hoisted();
        flowLiveBeforeReturn();
        return;
        flowDeadAfterReturn();
        function hoisted(): void { flowLiveHoisted(); }
      }
    `);
    expect(decisions).toMatchObject({
      flowDeadIf: false,
      flowDeadElse: false,
      flowDeadTernary: false,
      flowDeadAnd: false,
      flowDeadOr: false,
      flowDeadWhile: false,
      flowDeadForOf: false,
      flowDeadForIn: false,
      flowDeadSwitch: false,
      flowDeadAfterReturn: false,
      flowDeadLabeledFor: false,
      flowDeadLabeledDo: false,
      flowLiveElse: true,
      flowLiveIf: true,
      flowLiveTernary: true,
      flowLiveSwitch: true,
      flowLiveBeforeReturn: true,
      flowLiveHoisted: true,
      flowLiveForContinue: true,
      flowLiveDoContinue: true,
      flowLiveConditionalContinue: true,
    });
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
