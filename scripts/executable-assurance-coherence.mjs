/**
 * @typedef {object} ApiAssuranceManifest
 * @property {string} surfaceSha256 Exact current public-surface digest shared by all same-run artifacts.
 * @property {Record<string, unknown>} entries Public API entries whose key cardinality is summarized.
 * @property {{callAndConstructSignatures:number,directExecutableApis:number,indirectCallChainApis:number,explicitGapApis:number,unreferencedPublicApis:number,maximumTypeDepth:number}} counts API execution/gap/type-depth counters consumed by assurance/reporting.
 */
/**
 * @typedef {object} FieldClassificationManifest
 * @property {Record<string, unknown>} entries Classified reachable public fields whose key cardinality is summarized.
 * @property {{types:number,fields:number,inputFields:number,outputFields:number,optionalFields:number,callableFields:number,recursiveTypeReferences:number,truncatedTypes:number}} counts Reachability/cardinality/truncation counters consumed by assurance/reporting.
 */
/**
 * @typedef {object} CallChainManifest
 * @property {{callables:number,edges:number,testRoots:number,publicEntriesWithWitnesses:number,unresolvedPublicEntries:number}} counts Compiler call-graph counters consumed by the executable report.
 */
/**
 * @typedef {object} TraceEntry
 * @property {string[]} apiEntries Public API identities witnessed by this executable trace/property row.
 * @property {"state-result-refinement"|"bounded-property"|"direct-property"|string} refinementMode Executable evidence mode used for summary partitioning.
 */
/**
 * @typedef {object} TraceReplayManifest
 * @property {Record<string, TraceEntry>} entries Executable trace/property entries consumed by the report.
 */
/**
 * @typedef {object} CoverageGapManifest
 * @property {Record<string, unknown>} gaps Explicit named non-claims retained by the current assurance generation.
 */
/**
 * @typedef {object} ExecutableAssuranceManifests
 * @property {ApiAssuranceManifest} api Current API assurance manifest.
 * @property {FieldClassificationManifest} fields Current field-classification manifest.
 * @property {CallChainManifest} callChains Current compiler call-chain manifest.
 * @property {TraceReplayManifest} traces Current executable trace/property manifest.
 * @property {CoverageGapManifest} gaps Current explicit-gap manifest.
 */
/**
 * @typedef {object} ExecutableAssuranceSummary
 * @property {string} surfaceSha256 Exact public-surface digest copied from the API manifest.
 * @property {number} apiEntries Number of public API entries.
 * @property {number} callAndConstructSignatures Number of public call/construct signatures.
 * @property {number} directExecutableApis Public APIs with direct executable evidence.
 * @property {number} indirectCallChainApis Public APIs witnessed through tested internal call chains.
 * @property {number} explicitGapApis Public APIs retained as explicit gaps.
 * @property {number} unreferencedPublicApis Public APIs with no executable or gap disposition.
 * @property {number} compilerCallGraphCallables Compiler-resolved callables in the test call graph.
 * @property {number} compilerCallGraphEdges Compiler-resolved call edges.
 * @property {number} compilerCallGraphTestRoots Executable test roots.
 * @property {number} compilerCallGraphWitnessedApis Public APIs with at least one compiler-resolved witness.
 * @property {number} compilerCallGraphUnresolvedApis Public APIs with no compiler-resolved witness.
 * @property {number} fieldEntries Number of classified reachable public fields.
 * @property {number} inputFields Input-reachable public fields.
 * @property {number} outputFields Output-reachable public fields.
 * @property {number} recursiveTypeReferences Explicit recursive type edges retained by the generator.
 * @property {number} truncatedTypes Public types silently truncated by the generator; release evidence requires zero.
 * @property {number} boundedTraceEntries Number of executable trace/property entries.
 * @property {number} tracedPublicApis Distinct public APIs named by executable trace/property entries.
 * @property {number} stateResultTraceEntries Trace rows using state-result refinement.
 * @property {number} boundedPropertyTraceEntries Trace rows using bounded-property evidence.
 * @property {number} directPropertyTraceEntries Trace rows using direct-property evidence.
 * @property {number} explicitGapEntries Number of explicit named coverage gaps.
 */
/**
 * @typedef {ExecutableAssuranceManifests & {executable: ExecutableAssuranceSummary}} ExecutableAssuranceInput
 * `executable` is the persisted generated report that must equal a fresh same-run summary field for field.
 */

/** Executable trace modes accepted by the current assurance schema. */
const executableTraceModes = new Set([
  "state-result-refinement",
  "bounded-property",
  "direct-property",
]);

/** Reject unknown trace modes before partition counters can silently omit them. */
function assertKnownTraceModes(traceEntries) {
  for (const entry of traceEntries) {
    if (!executableTraceModes.has(entry.refinementMode)) {
      throw new Error(
        `Unknown executable assurance refinement mode '${String(entry.refinementMode)}'.`,
      );
    }
  }
}

/** Reject implementation-model claims from any registered API, field, or trace manifest. */
export function assertNoManifestImplementationModelClaim(
  { apiEntries, fieldEntries, traceEntries },
  model,
) {
  const claimed =
    Object.values(apiEntries).some((entry) => Array.isArray(entry.models) && entry.models.includes(model)) ||
    Object.values(fieldEntries).some((entry) => Array.isArray(entry.formalModels) && entry.formalModels.includes(model)) ||
    Object.values(traceEntries).some((entry) => Array.isArray(entry.models) && entry.models.includes(model));
  if (claimed) {
    throw new Error(
      `Current manifests must not claim ${model} implementation refinement before code exists.`,
    );
  }
}

/** Build the complete executable-assurance summary that is derived from current manifests. */
export function executableAssuranceSummary(
  /** @type {ExecutableAssuranceManifests} */ { api, fields, callChains, traces, gaps },
) {
  const traceEntries = Object.values(traces.entries);
  assertKnownTraceModes(traceEntries);
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

/** Require every named manifest counter to exist as a non-negative safe integer. */
function assertManifestCounters(label, counts, keys) {
  if (typeof counts !== "object" || counts === null) {
    throw new Error(`${label} assurance manifest is missing its counts object.`);
  }
  for (const key of keys) {
    if (
      !Object.hasOwn(counts, key) ||
      !Number.isSafeInteger(counts[key]) ||
      counts[key] < 0
    ) {
      throw new Error(
        `${label} assurance manifest counter '${key}' must be a present non-negative safe integer.`,
      );
    }
  }
}

/** Reject a report assembled from a different manifest generation than the current inputs. */
export function assertExecutableAssuranceMatchesManifests(
  /** @type {ExecutableAssuranceInput} */ input,
) {
  if (typeof input.api.surfaceSha256 !== "string" || input.api.surfaceSha256.length === 0) {
    throw new Error("API assurance manifest surfaceSha256 must be a present non-empty string.");
  }
  assertManifestCounters("API", input.api.counts, [
    "callAndConstructSignatures",
    "directExecutableApis",
    "indirectCallChainApis",
    "explicitGapApis",
    "unreferencedPublicApis",
    "maximumTypeDepth",
  ]);
  assertManifestCounters("Field classification", input.fields.counts, [
    "types",
    "fields",
    "inputFields",
    "outputFields",
    "optionalFields",
    "callableFields",
    "recursiveTypeReferences",
    "truncatedTypes",
  ]);
  assertManifestCounters("Call-chain", input.callChains.counts, [
    "callables",
    "edges",
    "testRoots",
    "publicEntriesWithWitnesses",
    "unresolvedPublicEntries",
  ]);
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
