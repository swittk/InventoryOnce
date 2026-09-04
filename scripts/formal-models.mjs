/** Registered InventoryOnce TLC models in deterministic execution order. */
export const formalModels = Object.freeze(
  ["AuthorityWriterFence", "PublishedHeadCAS", "CompositionRevision", "CollectionView", "FungibilityPool", "CatalogPublication", "ReclassificationConservation", "UseByReservation", "ResourceDimensions", "ReservationScope", "TraceabilityGraph", "PhysicalCount", "DualMeasure", "DistributedRights", "CorrectionHistory", "DurableTransferRefinement", "TransferLifecycle", "RepairLiveness", "RecordedDeficit", "SnapshotSupersededWorkflow", "InventoryOperation", "ImplementationConformance", "ReservationSafety", "PackagingIdentity"]
);

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
