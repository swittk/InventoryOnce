/** Build the complete executable-assurance summary that is derived from current manifests. */
export function executableAssuranceSummary({ api, fields, callChains, traces, gaps }) {
  const traceEntries = Object.values(traces.entries);
  return {
    surfaceSha256: api.surfaceSha256,
    apiEntries: Object.keys(api.entries).length,
    callAndConstructSignatures: api.counts.callAndConstructSignatures,
    directExecutableApis: api.counts.directExecutableApis,
    indirectCallChainApis: api.counts.indirectCallChainApis,
    explicitGapApis: api.counts.explicitGapApis,
    unreferencedPublicApis: api.counts.unreferencedPublicApis,
    compilerCallGraphCallables: callChains.counts.callables,
    compilerCallGraphEdges: callChains.counts.edges,
    compilerCallGraphTestRoots: callChains.counts.testRoots,
    compilerCallGraphWitnessedApis: callChains.counts.publicEntriesWithWitnesses,
    compilerCallGraphUnresolvedApis: callChains.counts.unresolvedPublicEntries,
    fieldEntries: Object.keys(fields.entries).length,
    inputFields: fields.counts.inputFields,
    outputFields: fields.counts.outputFields,
    recursiveTypeReferences: fields.counts.recursiveTypeReferences,
    truncatedTypes: fields.counts.truncatedTypes,
    boundedTraceEntries: Object.keys(traces.entries).length,
    tracedPublicApis: new Set(traceEntries.flatMap((entry) => entry.apiEntries)).size,
    stateResultTraceEntries: traceEntries.filter(
      (entry) => entry.refinementMode === "state-result-refinement",
    ).length,
    boundedPropertyTraceEntries: traceEntries.filter(
      (entry) => entry.refinementMode === "bounded-property",
    ).length,
    directPropertyTraceEntries: traceEntries.filter(
      (entry) => entry.refinementMode === "direct-property",
    ).length,
    explicitGapEntries: Object.keys(gaps.gaps).length,
  };
}

/** Reject a report assembled from a different manifest generation than the current inputs. */
export function assertExecutableAssuranceMatchesManifests(input) {
  const expected = executableAssuranceSummary(input);
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (input.executable[key] !== value) {
      mismatches.push(`${key}: executable=${JSON.stringify(input.executable[key])}, current=${JSON.stringify(value)}`);
    }
  }
  if (mismatches.length !== 0) {
    throw new Error(
      `Executable assurance report does not match the current same-run manifests: ${mismatches.join("; ")}.`,
    );
  }
  return expected;
}
