/** Registered InventoryOnce TLC models in deterministic execution order. */
export const formalModels = Object.freeze(
  ["AuthorityWriterFence", "PublishedHeadCAS", "CompositionRevision", "CollectionView", "FungibilityPool", "CatalogPublication", "ReclassificationConservation", "UseByReservation", "ResourceDimensions", "ReservationScope", "TraceabilityGraph", "PhysicalCount", "DualMeasure", "DistributedRights", "CorrectionHistory", "DurableTransferRefinement", "TransferLifecycle", "RepairLiveness", "RecordedDeficit", "SnapshotSupersededWorkflow", "InventoryOperation", "ImplementationConformance", "ReservationSafety", "PackagingIdentity"]
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
    if (block && /^[A-Za-z][A-Za-z0-9_]*$/u.test(line)) {
      names.push(line);
      continue;
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
]);
