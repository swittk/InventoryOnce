import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Package root derived without import.meta so both test compilation modes agree. */
const packageRoot = path.resolve(__dirname, "..");

/** Exact assurance-audit counters checked by this child-process test. */
interface FormalImplementationConformanceSummary {
  /** Public callable rows found on the current package surface. */
  readonly apiEntries: number;
  /** Public input/output fields reached from the current package surface. */
  readonly fieldEntries: number;
  /** Public fields reachable from at least one input. */
  readonly inputFields: number;
  /** Public fields reachable from at least one output. */
  readonly outputFields: number;
  /** Public fields reachable through callback arguments. */
  readonly callbackArgumentFields: number;
  /** Public fields reachable through callback results. */
  readonly callbackResultFields: number;
  /** Public callable-field overload signatures. */
  readonly callableFieldSignatures: number;
  /** Public optional fields kept in the assurance surface. */
  readonly optionalFields: number;
  /** Public fields whose type explicitly includes undefined. */
  readonly undefinedFields: number;
  /** Public fields whose type explicitly includes null. */
  readonly nullableFields: number;
  /** Complete public call and constructor signature count. */
  readonly callAndConstructSignatures: number;
  /** Explicit recursive edges found while walking public types. */
  readonly recursiveTypeReferences: number;
  /** Public types the generator had to truncate. */
  readonly truncatedTypes: number;
  /** Representative kernel calls required to pass the memory refinement suite. */
  readonly criticalKernelCalls: number;
  /** Bounded executable trace rows in the checked manifest. */
  readonly boundedTraceEntries: number;
  /** Covered public APIs assigned to at least one bounded trace. */
  readonly tracedPublicApis: number;
  /** Public APIs deliberately kept as an explicit gap. */
  readonly explicitGapApis: number;
  /** Named non-claims retained by the checked assurance report. */
  readonly explicitGaps: number;
}

describe("formal implementation conformance manifest", () => {
  it("does not count TLC section keywords as configured checks", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import { formalConfigCheckNames } from "./scripts/formal-models.mjs"; process.stdout.write(JSON.stringify(formalConfigCheckNames("INVARIANTS\\nTypeOK\\nSPECIFICATION\\nSpec\\n")));',
      ],
      { cwd: packageRoot, encoding: "utf8" }
    );
    expect(JSON.parse(output) as unknown).toEqual(["TypeOK"]);
  });

  it("matches every public callable and reachable field to checked formal obligations", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/audit-formal-implementation-conformance.mjs"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 25_000,
      }
    );
    const summary = JSON.parse(
      output
    ) as FormalImplementationConformanceSummary;
    expect(summary.apiEntries).toBeGreaterThanOrEqual(461);
    expect(summary.fieldEntries).toBeGreaterThanOrEqual(2090);
    expect(summary.inputFields).toBeGreaterThanOrEqual(1792);
    expect(summary.outputFields).toBeGreaterThanOrEqual(764);
    expect(summary.callbackArgumentFields).toBeGreaterThanOrEqual(285);
    expect(summary.callbackResultFields).toBeGreaterThanOrEqual(361);
    expect(summary.callableFieldSignatures).toBeGreaterThanOrEqual(10);
    expect(summary.optionalFields).toBeGreaterThanOrEqual(821);
    expect(summary.undefinedFields).toBeGreaterThanOrEqual(2);
    expect(summary.nullableFields).toBe(0);
    expect(summary.callAndConstructSignatures).toBeGreaterThanOrEqual(461);
    expect(summary.recursiveTypeReferences).toBeGreaterThanOrEqual(3);
    expect(summary.truncatedTypes).toBe(0);
    expect(summary.criticalKernelCalls).toBe(4);
    expect(summary.boundedTraceEntries).toBe(26);
    expect(summary.tracedPublicApis).toBeGreaterThanOrEqual(457);
    expect(summary.explicitGaps).toBeGreaterThanOrEqual(13);
    expect(summary.apiEntries - summary.tracedPublicApis).toBe(
      summary.explicitGapApis
    );
  }, 30_000);
});
