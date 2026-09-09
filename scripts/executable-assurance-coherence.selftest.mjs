import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExecutableAssuranceMatchesManifests,
  executableAssuranceSummary,
} from "./executable-assurance-coherence.mjs";

function fixtures() {
  const api = {
    surfaceSha256: "surface-a",
    entries: { one: {}, two: {} },
    counts: {
      callAndConstructSignatures: 2,
      directExecutableApis: 1,
      indirectCallChainApis: 1,
      explicitGapApis: 0,
      unreferencedPublicApis: 0,
    },
  };
  const fields = {
    entries: { a: {}, b: {}, c: {} },
    counts: { inputFields: 2, outputFields: 2, recursiveTypeReferences: 1, truncatedTypes: 0 },
  };
  const callChains = {
    counts: { callables: 4, edges: 5, testRoots: 2, publicEntriesWithWitnesses: 2, unresolvedPublicEntries: 0 },
  };
  const traces = {
    entries: {
      a: { apiEntries: ["one"], refinementMode: "state-result-refinement" },
      b: { apiEntries: ["one", "two"], refinementMode: "bounded-property" },
      c: { apiEntries: ["two"], refinementMode: "direct-property" },
    },
  };
  const gaps = { gaps: { external: {} } };
  return { api, fields, callChains, traces, gaps };
}

test("same-run executable summary matches every manifest-derived field", () => {
  const input = fixtures();
  const executable = executableAssuranceSummary(input);
  assert.deepEqual(assertExecutableAssuranceMatchesManifests({ ...input, executable }), executable);
});

test("one stale manifest-derived field rejects the executable report", () => {
  const input = fixtures();
  const executable = { ...executableAssuranceSummary(input), compilerCallGraphEdges: 4 };
  assert.throws(
    () => assertExecutableAssuranceMatchesManifests({ ...input, executable }),
    /compilerCallGraphEdges/u,
  );
});
