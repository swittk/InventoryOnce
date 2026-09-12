import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExecutableAssuranceMatchesManifests,
  executableAssuranceRequiredStepIds,
  executableAssuranceTraceTests,
  assertNoManifestImplementationModelClaim,
  executableAssuranceSummary,
  executableAssuranceCounterKeys,
} from "./executable-assurance-coherence.mjs";

/** Build same-run fixture manifests using the exact production summary input shape. */
function fixtures() {
  const api = {
    schemaVersion: 2,
    surfaceSha256: "surface-a",
    entries: {
      one: { signature: { signatures: [{}] } },
      two: { signature: { signatures: [{}] } },
    },
    counts: {
      callAndConstructSignatures: 2,
      directExecutableApis: 1,
      indirectCallChainApis: 1,
      explicitGapApis: 0,
      unreferencedPublicApis: 0,
      maximumTypeDepth: 4,
      compilerCallGraphCallables: 4,
      compilerCallGraphEdges: 5,
      compilerCallGraphTestRoots: 2,
      compilerCallGraphWitnessedApis: 2,
      compilerCallGraphUnresolvedApis: 0,
      reachableFields: 3,
      reachableTypes: 2,
      recursiveTypeReferences: 1,
      truncatedTypes: 0,
    },
  };
  const fields = {
    schemaVersion: 2,
    entries: { a: {}, b: {}, c: {} },
    counts: {
      types: 2,
      fields: 3,
      inputFields: 2,
      outputFields: 2,
      optionalFields: 1,
      callableFields: 0,
      recursiveTypeReferences: 1,
      truncatedTypes: 0,
    },
  };
  const callChains = {
    schemaVersion: 1,
    counts: { callables: 4, edges: 5, testRoots: 2, publicEntries: 2, publicEntriesWithTargets: 2, publicEntriesWithWitnesses: 2, unresolvedPublicEntries: 0 },
  };
  const traces = {
    schemaVersion: 1,
    entries: {
      a: { apiEntries: ["one"], refinementMode: "state-result-refinement", adapters: ["memory"], evidence: ["test/example.test.ts"] },
      b: { apiEntries: ["one", "two"], refinementMode: "bounded-property", adapters: ["memory"], evidence: ["test/example.test.ts"] },
      c: { apiEntries: ["two"], refinementMode: "direct-property", adapters: ["memory"], evidence: ["test/example.test.ts"] },
    },
  };
  const gaps = {
    schemaVersion: 1,
    gaps: {
      external: {
        status: "application-boundary",
        productionImpact: "External behavior is outside this fixture's modeled physical authority.",
        requiredMitigation: "Keep external behavior separate from the modeled state and test its boundary independently.",
      },
    },
  };
  /** @type {Parameters<typeof executableAssuranceSummary>[0]} */
  const manifests = { api, fields, callChains, traces, gaps };
  for (const section of ["api", "fields", "callChains"]) {
    for (const key of executableAssuranceCounterKeys[section]) if (!Object.hasOwn(manifests[section].counts, key)) manifests[section].counts[key] = 0;
  }
  return manifests;
}

test("same-run executable summary matches every manifest-derived field", () => {
  const input = fixtures();
  const executable = executableAssuranceSummary(input);
  assert.deepEqual(assertExecutableAssuranceMatchesManifests({ ...input, executable }), executable);
});

test("missing or empty API surface digests fail closed", () => {
  for (const invalid of [undefined, ""]) {
    const input = fixtures();
    if (invalid === undefined) delete input.api.surfaceSha256;
    else input.api.surfaceSha256 = invalid;
    assert.throws(
      () => executableAssuranceSummary(input),
      /surfaceSha256 must be a present non-empty string/u,
    );
  }
});

test("every executable assurance manifest requires its exact schema version", () => {
  const expected = { api: 2, fields: 2, callChains: 1, traces: 1, gaps: 1 };
  for (const [section, version] of Object.entries(expected)) {
    const input = fixtures();
    input[section].schemaVersion = version + 1;
    assert.throws(
      () => executableAssuranceSummary(input),
      new RegExp(`${section} assurance manifest schemaVersion must be ${version}`),
    );
  }
});

test("explicit formal gap rows require status impact and mitigation text", () => {
  for (const field of ["status", "productionImpact", "requiredMitigation"]) {
    const missing = fixtures();
    delete missing.gaps.gaps.external[field];
    assert.throws(
      () => executableAssuranceSummary(missing),
      new RegExp(`Explicit assurance gap 'external' requires nonempty trimmed ${field} text`),
    );

    const empty = fixtures();
    empty.gaps.gaps.external[field] = "";
    assert.throws(
      () => executableAssuranceSummary(empty),
      new RegExp(`Explicit assurance gap 'external' requires nonempty trimmed ${field} text`),
    );
  }
});

test("one stale manifest-derived field rejects the executable report", () => {
  const input = fixtures();
  const executable = { ...executableAssuranceSummary(input), compilerCallGraphEdges: 4 };
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable }),
    /compilerCallGraphEdges/u,
  );
});

test("unexpected executable report fields fail closed", () => {
  const input = fixtures();
  const executable = {
    ...executableAssuranceSummary(input),
    staleExtraField: 1,
  };
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable }),
    /staleExtraField.*unexpected executable assurance field/u,
  );
});

test("exact full-report metadata is admitted but malformed wrapper fields fail closed", () => {
  const input = fixtures();
  const summary = executableAssuranceSummary(input);
  const executable = {
    version: 5,
    repositoryHead: "a".repeat(40),
    repositoryStateSha256: "b".repeat(64),
    fullFormal: true,
    fullLogSha256: "c".repeat(64),
    ...summary,
    packageTraceTests: executableAssuranceTraceTests(input.traces),
    steps: executableAssuranceRequiredStepIds(true).map((id) => ({ id, status: "passed" })),
  };
  assert.deepEqual(
    assertExecutableAssuranceMatchesManifests({ ...input, executable }),
    summary,
  );
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable: { ...executable, steps: [{ id: executable.steps[0].id, status: "failed" }] } }),
    /steps.*unique exact/u,
  );
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable: { ...executable, steps: executable.steps.slice(0, 1) } }),
    /steps.*exact authoritative ordered step set/u,
  );
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable: { ...executable, steps: [...executable.steps.slice(0, -1), { id: "unknown-step", status: "passed" }] } }),
    /steps.*exact authoritative ordered step set/u,
  );
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable: { ...executable, wrapperDrift: true } }),
    /wrapperDrift.*unexpected executable assurance field/u,
  );
});

test("API signature counter follows per-row signature cardinality rather than row count", () => {
  const overloaded = fixtures();
  overloaded.api.entries.one.signature.signatures.push({});
  overloaded.api.counts.callAndConstructSignatures = 3;
  assert.equal(executableAssuranceSummary(overloaded).callAndConstructSignatures, 3);

  const staleCounter = structuredClone(overloaded);
  staleCounter.api.counts.callAndConstructSignatures = 2;
  assert.throws(
    () => executableAssuranceSummary(staleCounter),
    /signature counter differs/u,
  );
});

test("duplicated manifest counters and call-chain domain partitions must agree", () => {
  const staleGraph = fixtures();
  staleGraph.api.counts.compilerCallGraphEdges += 1;
  assert.throws(
    () => executableAssuranceSummary(staleGraph),
    /compilerCallGraphEdges.*disagrees/u,
  );

  const staleFields = fixtures();
  staleFields.api.counts.reachableFields += 1;
  assert.throws(
    () => executableAssuranceSummary(staleFields),
    /reachableFields.*disagrees/u,
  );

  const wrongDomain = fixtures();
  wrongDomain.callChains.counts.publicEntries += 1;
  assert.throws(
    () => executableAssuranceSummary(wrongDomain),
    /public entry counter differs/u,
  );

  const incompletePartition = fixtures();
  incompletePartition.callChains.counts.publicEntriesWithWitnesses = 1;
  incompletePartition.api.counts.compilerCallGraphWitnessedApis = 1;
  assert.throws(
    () => executableAssuranceSummary(incompletePartition),
    /do not partition the API domain/u,
  );

  const targetsBelowWitnesses = fixtures();
  targetsBelowWitnesses.callChains.counts.publicEntriesWithTargets = 1;
  assert.throws(
    () => executableAssuranceSummary(targetsBelowWitnesses),
    /target counters do not fit/u,
  );

  const targetsOutsideApiDomain = fixtures();
  targetsOutsideApiDomain.callChains.counts.publicEntriesWithTargets = 3;
  assert.throws(
    () => executableAssuranceSummary(targetsOutsideApiDomain),
    /target counters do not fit/u,
  );
});
test("report-only manifest counters fail closed when missing or invalid", () => {
  const input = fixtures();
  const executable = executableAssuranceSummary(input);
  const missingTypes = structuredClone(input);
  delete missingTypes.fields.counts.types;
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...missingTypes, executable }),
    /counter 'types'/u,
  );
  const invalidDepth = structuredClone(input);
  invalidDepth.api.counts.maximumTypeDepth = -1;
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...invalidDepth, executable }),
    /counter 'maximumTypeDepth'/u,
  );
});


test("trace entry identities must be nonempty before summary credit", () => {
  const input = fixtures();
  input.traces.entries[""] = input.traces.entries.a;
  delete input.traces.entries.a;
  assert.throws(
    () => executableAssuranceSummary(input),
    /Malformed trace assurance entry ''/u,
  );
});

test("missing or malformed trace apiEntries fail closed", () => {
  for (const invalid of [undefined, "one", ["one", 2]]) {
    const input = fixtures();
    if (invalid === undefined) delete input.traces.entries.a.apiEntries;
    else input.traces.entries.a.apiEntries = invalid;
    assert.throws(
      () => executableAssuranceSummary(input),
      /trace apiEntries must be a present array of strings/u,
    );
  }
  const nullEntry = fixtures();
  nullEntry.traces.entries.a = null;
  assert.throws(
    () => executableAssuranceSummary(nullEntry),
    /Malformed trace assurance entry 'a'/u,
  );
});

test("unknown executable trace refinement modes fail closed", () => {
  const input = fixtures();
  input.traces.entries.a.refinementMode = "future-mode";
  assert.throws(
    () => executableAssuranceSummary(input),
    /Unknown executable assurance refinement mode 'future-mode'/u,
  );
});

test("implementation model non-claims cover API, field, and trace manifests", () => {
  const clean = {
    apiEntries: { api: { models: ["InventoryOperation"] } },
    fieldEntries: { field: { formalModels: ["InventoryOperation"] } },
    traceEntries: { trace: { models: ["InventoryOperation"] } },
  };
  assert.doesNotThrow(() =>
    assertNoManifestImplementationModelClaim(clean, "DistributedRights"),
  );
  for (const [bucket, entry] of [
    ["apiEntries", { models: ["DistributedRights"] }],
    ["fieldEntries", { formalModels: ["DistributedRights"] }],
    ["traceEntries", { models: ["DistributedRights"] }],
  ]) {
    const candidate = structuredClone(clean);
    candidate[bucket].bad = entry;
    assert.throws(
      () => assertNoManifestImplementationModelClaim(candidate, "DistributedRights"),
      /must not claim DistributedRights/u,
    );
  }
});


test("persisted reports cannot omit substitute duplicate or reorder the runner-selected trace tests", () => {
  const input = fixtures();
  input.traces.entries.b.evidence.push("test/second.spec.ts");
  const selected = executableAssuranceTraceTests(input.traces);
  assert.deepEqual(selected, ["test/example.test.ts", "test/formal-implementation-conformance.test.ts", "test/second.spec.ts"]);
  for (const fullFormal of [false, true]) {
    const honest = { ...executableAssuranceSummary(input), version: 5, repositoryHead: "a".repeat(40), repositoryStateSha256: "b".repeat(64), fullFormal,
      ...(fullFormal ? { fullLogSha256: "c".repeat(64) } : {}), packageTraceTests: selected,
      steps: executableAssuranceRequiredStepIds(fullFormal).map(id => ({ id, status: "passed" })) };
    assert.doesNotThrow(() => assertExecutableAssuranceMatchesManifests({ ...input, executable: honest }));
    for (const packageTraceTests of [[], selected.slice(1), ["test/never-run.test.ts"], [...selected].reverse(), [...selected, selected[0]]]) {
      assert.throws(() => assertExecutableAssuranceMatchesManifests({ ...input, executable: { ...honest, packageTraceTests } }), /exact authoritative trace-test selection/u);
    }
  }
});
