/**
 * @typedef {object} ApiAssuranceManifest
 * @property {string} surfaceSha256 Exact current public-surface digest shared by all same-run artifacts.
 * @property {Record<string, {signature: Record<string, unknown>}>} entries Public API entries whose key cardinality and signature cardinality are summarized.
 * @property {{callAndConstructSignatures:number,directExecutableApis:number,indirectCallChainApis:number,explicitGapApis:number,unreferencedPublicApis:number,maximumTypeDepth:number}} counts API execution/gap/type-depth counters consumed by assurance/reporting.
 */
/**
 * @typedef {object} FieldClassificationManifest
 * @property {Record<string, unknown>} entries Classified reachable public fields whose key cardinality is summarized.
 * @property {{types:number,fields:number,inputFields:number,outputFields:number,optionalFields:number,callableFields:number,recursiveTypeReferences:number,truncatedTypes:number}} counts Reachability/cardinality/truncation counters consumed by assurance/reporting.
 */
/**
 * @typedef {object} CallChainManifest
 * @property {{callables:number,edges:number,testRoots:number,publicEntries:number,publicEntriesWithTargets:number,publicEntriesWithWitnesses:number,unresolvedPublicEntries:number}} counts Compiler call-graph counters consumed by the executable report.
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

/** Exact checked schema versions admitted for the five executable-assurance manifests. */
export const executableAssuranceSchemaVersions = Object.freeze({
  api: 2,
  fields: 2,
  callChains: 1,
  traces: 1,
  gaps: 1,
});

/** Stable assurance step identities shared by the runner and persisted-report validator. */
export const executableAssuranceStepIds = Object.freeze({
  generateCurrentSurface: "generate-current-surface",
  auditCorrespondence: "audit-api-field-trace-gap-correspondence",
  packageStrictTypes: "package-strict-types",
  memoryEvidence: "memory-trace-property-and-authority-evidence",
  completePackageTests: "complete-package-tests",
  packageProductionBuild: "package-production-build",
  registeredTlcModelSuite: "registered-tlc-model-suite",
});

/** Exact ordered assurance step set required by one partial or full report. */
export function executableAssuranceRequiredStepIds(fullFormal) {
  const common = [
    executableAssuranceStepIds.generateCurrentSurface,
    executableAssuranceStepIds.auditCorrespondence,
    executableAssuranceStepIds.packageStrictTypes,
    executableAssuranceStepIds.memoryEvidence,
  ];
  return fullFormal
    ? [
        ...common,
        executableAssuranceStepIds.completePackageTests,
        executableAssuranceStepIds.packageProductionBuild,
        executableAssuranceStepIds.registeredTlcModelSuite,
      ]
    : common;
}

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

/** Require nonempty, unique trace members from the actual API domain. */
function assertTraceApiEntries(traceEntries, apiEntries) {
  for (const entry of traceEntries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !Object.hasOwn(entry, "apiEntries") || !Array.isArray(entry.apiEntries) || entry.apiEntries.length === 0 || entry.apiEntries.some(apiEntry => typeof apiEntry !== "string" || apiEntry.trim() !== apiEntry || apiEntry.length === 0)) {
      throw new Error("Executable assurance trace apiEntries must be a present array of strings with nonempty membership.");
    }
    const seen = new Set();
    for (const apiEntry of entry.apiEntries) {
      if (!Object.hasOwn(apiEntries, apiEntry) || seen.has(apiEntry)) throw new Error(`Executable assurance trace apiEntries contains duplicate or unknown API '${apiEntry}'.`);
      seen.add(apiEntry);
    }
  }
}

/** Counter fields belonging to the current manifest schema, independent of supplied counter values. */
export const executableAssuranceCounterKeys = Object.freeze({
  api: Object.freeze(["authorityMethods", "callAndConstructSignatures", "classMethods", "compilerCallGraphCallables", "compilerCallGraphEdges", "compilerCallGraphTestRoots", "compilerCallGraphUnresolvedApis", "compilerCallGraphWitnessedApis", "directExecutableApis", "explicitGapApis", "facadeMethods", "indirectCallChainApis", "kernelCallables", "maximumTypeDepth", "migrationCallables", "reachableFields", "reachableTypes", "recursiveTypeReferences", "rootCallables", "storageCallables", "storageMethods", "truncatedTypes", "unreferencedPublicApis"]),
  fields: Object.freeze(["callableFieldSignatures", "callableFields", "callbackArgumentFields", "callbackResultFields", "fields", "inputFields", "nullableFields", "optionalFields", "outputFields", "recursiveTypeReferences", "truncatedTypes", "types", "undefinedFields"]),
  callChains: Object.freeze(["callables", "edges", "publicEntries", "publicEntriesWithTargets", "publicEntriesWithWitnesses", "testRoots", "unresolvedPublicEntries"]),
});

/** Reject arrays/null/missing maps before Object.keys could manufacture an empty domain. */
function assertEntryMap(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Malformed ${label} assurance entry map.`);
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Malformed ${label} assurance entry '${key}'.`);
  }
}

/** Count exact call/construct signatures from the API rows using the producer's row semantics. */
function apiSignatureCount(entries) {
  let total = 0;
  for (const [key, entry] of Object.entries(entries)) {
    const signature = entry.signature;
    if (signature === null || typeof signature !== "object" || Array.isArray(signature)) {
      throw new Error(`API assurance entry '${key}' requires a signature object.`);
    }
    let count;
    if (Object.hasOwn(signature, "signatures")) {
      if (!Array.isArray(signature.signatures)) {
        throw new Error(`API assurance entry '${key}' signatures must be an array.`);
      }
      count = signature.signatures.length;
    } else {
      for (const field of ["callSignatures", "constructSignatures"]) {
        if (Object.hasOwn(signature, field) && !Array.isArray(signature[field])) {
          throw new Error(`API assurance entry '${key}' ${field} must be an array.`);
        }
      }
      count = (signature.callSignatures ?? []).length + (signature.constructSignatures ?? []).length;
    }
    if (count === 0) {
      throw new Error(`API assurance entry '${key}' has no call or construct signature.`);
    }
    total += count;
  }
  return total;
}

/** Require every explicit formal gap to carry complete human-auditable release-impact text. */
function assertGapEntries(gaps) {
  for (const [id, gap] of Object.entries(gaps)) {
    for (const field of ["status", "productionImpact", "requiredMitigation"]) {
      const value = gap[field];
      if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
        throw new Error(`Explicit assurance gap '${id}' requires nonempty trimmed ${field} text.`);
      }
    }
  }
}

/** Validate shape and domains before either producing or comparing a summary. */
function assertExecutableManifests(input) {
  for (const section of ["api", "fields", "callChains", "traces", "gaps"]) {
    const manifest = input[section];
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Missing ${section} assurance manifest.`);
    if (manifest.schemaVersion !== executableAssuranceSchemaVersions[section]) {
      throw new Error(
        `${section} assurance manifest schemaVersion must be ${executableAssuranceSchemaVersions[section]}.`
      );
    }
    if (section === "api" || section === "fields" || section === "callChains") assertManifestCounters(section, manifest.counts, executableAssuranceCounterKeys[section]);
  }
  assertEntryMap(input.api.entries, "API"); assertEntryMap(input.fields.entries, "field"); assertEntryMap(input.gaps.gaps, "gap");
  assertGapEntries(input.gaps.gaps);
  // Trace rows require the same non-empty identity boundary as every other manifest entry map.
  assertEntryMap(input.traces.entries, "trace");
  assertTraceApiEntries(Object.values(input.traces.entries), input.api.entries);
  if (typeof input.api.surfaceSha256 !== "string" || input.api.surfaceSha256.length === 0) throw new Error("API assurance manifest surfaceSha256 must be a present non-empty string.");
  const apiCount = Object.keys(input.api.entries).length;
  const signatureCount = apiSignatureCount(input.api.entries);
  if (apiCount === 0 || input.api.counts.callAndConstructSignatures !== signatureCount) {
    throw new Error("API assurance signature counter differs from the actual call/construct signature domain.");
  }
  if (input.api.counts.directExecutableApis + input.api.counts.indirectCallChainApis + input.api.counts.explicitGapApis + input.api.counts.unreferencedPublicApis !== apiCount) {
    throw new Error("API assurance disposition counters do not partition the actual nonempty API domain.");
  }
  if (input.fields.counts.fields !== Object.keys(input.fields.entries).length) throw new Error("Field assurance counter differs from actual field domain.");
  const duplicatedCounters = [
    ["compilerCallGraphCallables", input.api.counts.compilerCallGraphCallables, input.callChains.counts.callables],
    ["compilerCallGraphEdges", input.api.counts.compilerCallGraphEdges, input.callChains.counts.edges],
    ["compilerCallGraphTestRoots", input.api.counts.compilerCallGraphTestRoots, input.callChains.counts.testRoots],
    ["compilerCallGraphWitnessedApis", input.api.counts.compilerCallGraphWitnessedApis, input.callChains.counts.publicEntriesWithWitnesses],
    ["compilerCallGraphUnresolvedApis", input.api.counts.compilerCallGraphUnresolvedApis, input.callChains.counts.unresolvedPublicEntries],
    ["reachableFields", input.api.counts.reachableFields, input.fields.counts.fields],
    ["reachableTypes", input.api.counts.reachableTypes, input.fields.counts.types],
    ["recursiveTypeReferences", input.api.counts.recursiveTypeReferences, input.fields.counts.recursiveTypeReferences],
    ["truncatedTypes", input.api.counts.truncatedTypes, input.fields.counts.truncatedTypes],
  ];
  for (const [label, apiValue, sourceValue] of duplicatedCounters) {
    if (apiValue !== sourceValue) {
      throw new Error(`Executable assurance duplicated counter '${label}' disagrees across manifests.`);
    }
  }
  if (input.callChains.counts.publicEntries !== apiCount) {
    throw new Error("Call-chain public entry counter differs from the actual API domain.");
  }
  if (
    input.callChains.counts.publicEntriesWithWitnesses >
      input.callChains.counts.publicEntriesWithTargets ||
    input.callChains.counts.publicEntriesWithTargets > apiCount
  ) {
    throw new Error("Call-chain target counters do not fit the witnessed/API domains.");
  }
  if (
    input.callChains.counts.publicEntriesWithWitnesses +
      input.callChains.counts.unresolvedPublicEntries !==
    apiCount
  ) {
    throw new Error("Call-chain witnessed and unresolved counters do not partition the API domain.");
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
  assertExecutableManifests({ api, fields, callChains, traces, gaps });
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
  const expected = executableAssuranceSummary(input);
  const executable = input.executable;
  if (
    typeof executable !== "object" ||
    executable === null ||
    Array.isArray(executable) ||
    (Object.getPrototypeOf(executable) !== Object.prototype &&
      Object.getPrototypeOf(executable) !== null)
  ) {
    throw new Error("Executable assurance report must be a plain object.");
  }
  const mismatches = [];
  const metadataKeys = new Set([
    "version",
    "repositoryHead",
    "repositoryStateSha256",
    "fullFormal",
    "fullLogSha256",
    "packageTraceTests",
    "steps",
  ]);
  const metadataPresent = Object.keys(executable).some((key) => metadataKeys.has(key));
  if (metadataPresent) {
    if (executable.version !== 5) mismatches.push("version: executable assurance report version must be 5");
    if (typeof executable.repositoryHead !== "string" || !/^[0-9a-f]{40,64}$/u.test(executable.repositoryHead)) mismatches.push("repositoryHead: invalid executable assurance repository head");
    if (typeof executable.repositoryStateSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(executable.repositoryStateSha256)) mismatches.push("repositoryStateSha256: invalid executable assurance repository state digest");
    if (typeof executable.fullFormal !== "boolean") mismatches.push("fullFormal: executable assurance full-formal marker must be boolean");
    if (executable.fullFormal === true) {
      if (typeof executable.fullLogSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(executable.fullLogSha256)) mismatches.push("fullLogSha256: full-formal executable assurance needs the exact full-log digest");
    } else if (Object.hasOwn(executable, "fullLogSha256")) {
      mismatches.push("fullLogSha256: partial executable assurance must not claim a full-log digest");
    }
    if (!Array.isArray(executable.packageTraceTests) || executable.packageTraceTests.some((file) => typeof file !== "string" || file.length === 0) || new Set(executable.packageTraceTests).size !== executable.packageTraceTests.length) {
      mismatches.push("packageTraceTests: executable assurance trace-test list must contain unique nonempty paths");
    }
    if (!Array.isArray(executable.steps) || executable.steps.length === 0) {
      mismatches.push("steps: executable assurance report must contain passed step evidence");
    } else {
      const stepIds = new Set();
      let rowsValid = true;
      for (const step of executable.steps) {
        if (step === null || typeof step !== "object" || Array.isArray(step) || Object.keys(step).sort().join(",") !== "id,status" || typeof step.id !== "string" || step.id.length === 0 || step.status !== "passed" || stepIds.has(step.id)) {
          mismatches.push("steps: executable assurance steps must be unique exact {id,status:passed} rows");
          rowsValid = false;
          break;
        }
        stepIds.add(step.id);
      }
      if (rowsValid) {
        const expectedStepIds = executableAssuranceRequiredStepIds(executable.fullFormal);
        if (executable.steps.length !== expectedStepIds.length || executable.steps.some((step, index) => step.id !== expectedStepIds[index])) {
          mismatches.push("steps: executable assurance report does not contain the exact authoritative ordered step set");
        }
      }
    }
  }
  for (const key of Object.keys(executable)) {
    if (!Object.hasOwn(expected, key) && !(metadataPresent && metadataKeys.has(key))) {
      mismatches.push(`${key}: unexpected executable assurance field`);
    }
  }
  for (const [key, value] of Object.entries(expected)) {
    if (executable[key] !== value) {
      mismatches.push(`${key}: executable=${JSON.stringify(executable[key])}, current=${JSON.stringify(value)}`);
    }
  }
  if (mismatches.length !== 0) {
    throw new Error(
      `Executable assurance report does not match the current same-run manifests: ${mismatches.join("; ")}.`,
    );
  }
  return expected;
}
