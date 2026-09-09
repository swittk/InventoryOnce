import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("fails closed on unsupported entries inside TLC check blocks", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { formalConfigCheckNames } from "./scripts/formal-models.mjs"; formalConfigCheckNames("INVARIANTS\\nTypeOK, ReportMatchesCurrentTruth\\nAnotherInvariant\\n");',
        ],
        { cwd: packageRoot, encoding: "utf8" }
      )
    ).toThrow();
  });

  it("frames repository assurance entries without path/content or deleted-marker collisions", () => {
    const collisionSingle = mkdtempSync(path.join(tmpdir(), "inventoryonce-assurance-state-"));
    const collisionSplit = mkdtempSync(path.join(tmpdir(), "inventoryonce-assurance-state-"));
    const presentDeletedMarker = mkdtempSync(path.join(tmpdir(), "inventoryonce-assurance-state-"));
    const missingTracked = mkdtempSync(path.join(tmpdir(), "inventoryonce-assurance-state-"));
    const roots = [collisionSingle, collisionSplit, presentDeletedMarker, missingTracked] as const;
    try {
      for (const root of roots) {
        execFileSync("git", ["init", "-q"], { cwd: root });
      }
      writeFileSync(path.join(collisionSingle, "a"), Buffer.from([0, 98, 0, 120]));
      writeFileSync(path.join(collisionSplit, "a"), Buffer.alloc(0));
      writeFileSync(path.join(collisionSplit, "b"), "x");
      writeFileSync(path.join(presentDeletedMarker, "a"), "<deleted>");
      writeFileSync(path.join(missingTracked, "a"), "<deleted>");
      execFileSync("git", ["add", "a"], { cwd: missingTracked });
      unlinkSync(path.join(missingTracked, "a"));

      const script = [
        'import { repositoryAssuranceStateSha256 } from "./scripts/repository-assurance-state.mjs";',
        "process.stdout.write(JSON.stringify(process.argv.slice(1).map(repositoryAssuranceStateSha256)));",
      ].join("\n");
      const output = execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", script, ...roots],
        { cwd: packageRoot, encoding: "utf8" }
      );
      const hashes = JSON.parse(output) as readonly string[];
      expect(hashes[0]).not.toBe(hashes[1]);
      expect(hashes[2]).not.toBe(hashes[3]);
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches every public callable and reachable field to checked formal obligations", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/audit-formal-implementation-conformance.mjs"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        // Full compiler/formal audit is ~15–17s alone and can exceed 25s under parallel Vitest load.
        // This changes only the subprocess budget; every audit obligation remains identical.
        timeout: 90_000,
      }
    );
    // JSON.parse returns any; this assertion narrows the audit output to the
    // exact counter shape asserted below, whose fields are then checked directly.
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
  }, 90_000);
});
