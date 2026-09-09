/** Registered InventoryOnce TLC models in deterministic execution order. */
export const formalModels = Object.freeze(
  ["AuthorityWriterFence", "PublishedHeadCAS", "CompositionRevision", "CollectionView", "FungibilityPool", "CatalogPublication", "ReclassificationConservation", "UseByReservation", "ResourceDimensions", "ReservationScope", "ReservationScopeAllocationReplacement", "TraceabilityContainment", "TraceabilityAssociation", "TraceabilityGraph", "PhysicalCount", "DualMeasure", "DistributedRights", "CorrectionHistory", "DurableTransferRefinement", "TransferLifecycle", "RepairLiveness", "RecordedDeficit", "SnapshotSupersededWorkflow", "InventoryOperation", "ImplementationConformance", "ReservationSafety", "PackagingIdentity"]
);

/** Stateful API families that must retain bounded executable trace/property evidence. */
export const statefulOperationFamilyIds = Object.freeze([
  "authority-control",
  "authority-cutover",
  "catalog-publication",
  "composition-open",
  "fungibility-movement",
  "stock-receipt",
  "stock-issue",
  "stock-policy-issue",
  "stock-transfer",
  "stock-policy-transfer",
  "transfer-lifecycle",
  "dimension-reclassification",
  "packaging-reclassification",
  "transformation",
  "scrap",
  "correction",
  "container-command",
  "lot-command",
  "reservation",
  "count",
  "traceability",
  "durable-protocol",
  "migration-publication",
]);


/** TLC cfg sections that terminate an INVARIANT/PROPERTY block. */
const formalConfigSectionKeyword = /^(?:CONSTANTS?|SPECIFICATION|INIT|NEXT|SYMMETRY|VIEW|CONSTRAINTS?|ACTION_CONSTRAINTS?|CHECK_DEADLOCK|ALIAS|POSTCONDITION)(?:\s|$)/u;

/** Parse invariant/property names from one TLC config using the supported config grammar. */
export function formalConfigCheckNames(config) {
  const names = [];
  let block = false;
  for (const rawLine of config.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const inline = /^(?:INVARIANT|PROPERTY)\s+([A-Za-z][A-Za-z0-9_]*)$/u.exec(line);
    if (inline !== null) {
      names.push(inline[1]);
      block = false;
      continue;
    }
    if (/^(?:INVARIANTS?|PROPERT(?:Y|IES))$/u.test(line)) {
      block = true;
      continue;
    }
    if (/^(?:INVARIANTS?|PROPERT(?:Y|IES))\s+\S/u.test(line)) {
      throw new Error(`Unsupported TLC check declaration '${line}'.`);
    }
    if (block && formalConfigSectionKeyword.test(line)) {
      block = false;
      continue;
    }
    if (block && /^[A-Za-z][A-Za-z0-9_]*$/u.test(line)) {
      names.push(line);
      continue;
    }
    if (block && line !== "" && !line.startsWith("\\*")) {
      throw new Error(`Unsupported TLC check list entry '${line}'.`);
    }
    if (line !== "" && !line.startsWith("\\*")) block = false;
  }
  return names;
}

/** Expected counterexamples as module, config, and the exact invariant TLC must reject. */
export const formalInvariantMutationChecks = Object.freeze([
  [
    "SnapshotSupersededWorkflow",
    "SnapshotSupersededWorkflowResumeMutation",
    "SupersededRowsNeverResume",
  ],
  [
    "SnapshotSupersededWorkflow",
    "SnapshotSupersededWorkflowDispositionEventMutation",
    "DispositionGeneratesNoPhysicalEvent",
  ],
  [
    "SnapshotSupersededWorkflow",
    "SnapshotSupersededWorkflowOutcomeMutation",
    "UnknownOutcomeNeverGuessed",
  ],
  [
    "SnapshotSupersededWorkflow",
    "SnapshotSupersededWorkflowSourceAdvanceMutation",
    "ResumeAttemptCannotChangeSourceTruth",
  ],
  [
    "TransferLifecycle",
    "TransferLifecycleIsolationMutation",
    "TransferIsolation",
  ],
  [
    "CorrectionHistory",
    "CorrectionHistoryErasureMutation",
    "OriginalHistoryIsNeverErased",
  ],
  [
    "DurableTransferRefinement",
    "DurableTransferRefinementSplitProjectionMutation",
    "ProjectionWriteIsAtomic",
  ],
]);

/** Require every *Mutation.cfg file to have exactly one registered expected rejection. */
export function assertFormalMutationRegistrationCompleteness(
  configFileNames,
  mutationChecks = formalInvariantMutationChecks,
) {
  const expected = configFileNames
    .filter((file) => file.endsWith("Mutation.cfg"))
    .slice()
    .sort();
  const registered = mutationChecks
    .map((entry) => `${entry[1]}.cfg`)
    .slice()
    .sort();
  const seen = new Set();
  for (const file of registered) {
    if (seen.has(file)) {
      throw new Error(`Formal mutation config '${file}' is registered more than once.`);
    }
    seen.add(file);
  }
  const missing = expected.filter((file) => !seen.has(file));
  const expectedSet = new Set(expected);
  const extra = registered.filter((file) => !expectedSet.has(file));
  if (missing.length !== 0 || extra.length !== 0) {
    throw new Error(
      `Formal mutation registry mismatch: missing=[${missing.join(", ")}], extra=[${extra.join(", ")}].`,
    );
  }
  return expected;
}
