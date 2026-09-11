import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExecutableAssuranceMatchesManifests,
  assertNoManifestImplementationModelClaim,
  executableAssuranceSummary,
  executableAssuranceCounterKeys,
} from "./executable-assurance-coherence.mjs";

/** Build same-run fixture manifests using the exact production summary input shape. */
function fixtures() {
  const api = {
    schemaVersion: 2,
    surfaceSha256: "surface-a",
    entries: { one: {}, two: {} },
    counts: {
      callAndConstructSignatures: 2,
      directExecutableApis: 1,
      indirectCallChainApis: 1,
      explicitGapApis: 0,
      unreferencedPublicApis: 0,
      maximumTypeDepth: 4,
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
    counts: { callables: 4, edges: 5, testRoots: 2, publicEntriesWithWitnesses: 2, unresolvedPublicEntries: 0 },
  };
  const traces = {
    schemaVersion: 1,
    entries: {
      a: { apiEntries: ["one"], refinementMode: "state-result-refinement" },
      b: { apiEntries: ["one", "two"], refinementMode: "bounded-property" },
      c: { apiEntries: ["two"], refinementMode: "direct-property" },
    },
  };
  const gaps = { schemaVersion: 1, gaps: { external: {} } };
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

test("one stale manifest-derived field rejects the executable report", () => {
  const input = fixtures();
  const executable = { ...executableAssuranceSummary(input), compilerCallGraphEdges: 4 };
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable }),
    /compilerCallGraphEdges/u,
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
    /trace apiEntries must be a present array of strings/u,
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
