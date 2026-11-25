import { formalCodeText } from "./formal-syntax.mjs";

/** Registered InventoryOnce TLC models in deterministic execution order. */
export const formalModels = Object.freeze(
  ["AuthorityWriterFence", "PublishedHeadCAS", "CompositionRevision", "CollectionView", "FungibilityPool", "CatalogPublication", "ReclassificationConservation", "RevisionTransition", "UseByReservation", "ResourceDimensions", "ReservationScope", "ReservationScopeAllocationReplacement", "PlacementGraph", "TraceabilityAssociation", "TraceabilityGraph", "PhysicalCount", "DualMeasure", "DistributedRights", "CorrectionHistory", "HistoricalRepair", "DurableTransferRefinement", "TransferLifecycle", "RepairLiveness", "RecordedDeficit", "SnapshotSupersededWorkflow", "InventoryOperation", "ImplementationConformance", "ReservationSafety", "PackagingIdentity"]
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
  "revision-transition",
  "packaging-reclassification",
  "transformation",
  "scrap",
  "correction",
  "historical-repair",
  "placement-command",
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
  for (const rawLine of formalCodeText(config).split(/\r?\n/u)) {
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
  ["UseByReservation", "UseByReservationEpochZeroMutation", "AllocationEvidenceIsPaired"],
  ["PublishedHeadCAS", "PublishedHeadCASNativeStaleMutation", "HeadFollowsPublishedAttempts"],
  ["RecordedDeficit", "RecordedDeficitFabricatedTransferMutation", "TransferArrivalsMatchSeparateWitnesses"],
  ["PlacementGraph", "PlacementGraphDirectContentsSplitMutation", "EmbodiedResourceTracksNodeParent"],
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
    "HistoricalRepair",
    "HistoricalRepairPartialPublishMutation",
    "HistoricalRepairIsAtomic",
  ],
  [
    "HistoricalRepair",
    "HistoricalRepairReverseBundleOrderMutation",
    "SameTimeBundleOrderIsPreserved",
  ],
  [
    "DurableTransferRefinement",
    "DurableTransferRefinementSplitProjectionMutation",
    "ProjectionWriteIsAtomic",
  ],
  [
    "UseByReservation",
    "UseByReservationStaleReportMutation",
    "ReportMatchesCurrentTruth",
  ],
  [
    "UseByReservation",
    "UseByReservationExpiredAllocationMutation",
    "OrdinaryAllocationWasUsable",
  ],
  [
    "UseByReservation",
    "UseByReservationExpiredConsumptionMutation",
    "OrdinaryConsumptionWasUsable",
  ],
  [
    "ReservationScope",
    "ReservationScopeDetachAvailabilityMutation",
    "ReportMatchesCurrentPhysicalTruth",
  ],
  [
    "ReservationScope",
    "ReservationScopeDoubleAllocationMutation",
    "ActiveExactAllocationsAreDisjoint",
  ],
  [
    "ResourceDimensions",
    "ResourceDimensionsDetachIssueMutation",
    "UnresolvedStockStillExists",
  ],
  [
    "ResourceDimensions",
    "ResourceDimensionsWhereaboutsIdentityMutation",
    "UnresolvedWhereaboutsIdentityIsStable",
  ],
  [
    "PlacementGraph",
    "PlacementGraphCycleMutation",
    "PlacementIsAcyclic",
  ],
  [
    "PlacementGraph",
    "PlacementGraphRejectingTargetMutation",
    "PlacementTargetsAcceptContents",
  ],
  [
    "PlacementGraph",
    "PlacementGraphDescendantRewriteMutation",
    "AncestorMovePreservesDirectStockAnchors",
  ],
  [
    "PlacementGraph",
    "PlacementGraphEmbodiedMoveDesyncMutation",
    "EmbodiedResourceTracksNodeParent",
  ],
  [
    "PlacementGraph",
    "PlacementGraphUnsafeEmbodimentTerminationMutation",
    "EmbodimentTerminationRequiresEmptyNode",
  ],
  [
    "TraceabilityGraph",
    "TraceabilityGraphDuplicateProductionMutation",
    "ProducedIdentityWasCreatedOnce",
  ],
  [
    "ImplementationConformance",
    "ImplementationConformanceReplaceDeltaMutation",
    "ResultDeltasMatchStateTransition",
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

/** Require every mutation tuple to target a registered model and an invariant declared by its config. */
export function assertFormalMutationRegistrationConsistency(
  readConfig,
  mutationChecks = formalInvariantMutationChecks,
  models = formalModels,
) {
  const registeredModels = new Set(models);
  for (const [model, config, invariant] of mutationChecks) {
    if (!registeredModels.has(model)) {
      throw new Error(
        `Formal mutation '${config}' targets unregistered model '${model}'.`,
      );
    }
    const declaredChecks = formalConfigCheckNames(readConfig(config));
    if (!declaredChecks.includes(invariant)) {
      throw new Error(
        `Formal mutation '${config}' expects undeclared invariant '${invariant}'.`,
      );
    }
    const parentChecks = formalConfigCheckNames(readConfig(model));
    if (!parentChecks.includes(invariant)) {
      throw new Error(
        `Formal mutation '${config}' targets invariant '${invariant}' that the parent model '${model}' does not check.`,
      );
    }
  }
}


/** Named false absence claims that ordinary positive models must refute with concrete reachable states. */
export const formalPositiveReachabilityChecks = Object.freeze([
  ["ReservationScope", "ReservationScopeDetachedHoldWitness", "ExactHoldAlwaysAvailable"],
  ["FungibilityPool", "FungibilityPoolStrandedHoldWitness", "AllocatedClaimNeverStrandedByTransfer"],
  ["RecordedDeficit", "RecordedDeficitMixedTransferWitness", "MixedTransferIsUnreachable"],
  ["RecordedDeficit", "RecordedDeficitPositiveUnlabelledWitness", "PositiveUnlabelledSettlementIsUnreachable"],
  ["RecordedDeficit", "RecordedDeficitUnlabelledAllocationWitness", "PositiveUnlabelledAllocationIsUnreachable"],
  ["SnapshotSupersededWorkflow", "SnapshotSupersededWorkflowNonzeroWitness", "NonzeroSnapshotIsUnreachable"],
]);

/** Prevent missing, duplicate, or unregistered positive reachability witnesses from silently dropping coverage. */
export function assertFormalPositiveReachabilityRegistration(
  configFileNames,
  readConfig,
) {
  if (typeof readConfig !== "function") {
    throw new Error("Positive formal witness registration requires config access.");
  }
  const expected = configFileNames.filter(file => file.endsWith("Witness.cfg")).sort();
  const registered = formalPositiveReachabilityChecks.map(([model, config, invariant]) => {
    if (!formalModels.includes(model) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(invariant)) {
      throw new Error("Invalid positive formal witness registration.");
    }
    if (!formalConfigCheckNames(readConfig(config)).includes(invariant)) {
      throw new Error(
        `Positive formal witness '${config}' does not declare registered invariant '${invariant}'.`
      );
    }
    return `${config}.cfg`;
  }).sort();
  if (
    new Set(registered).size !== registered.length ||
    expected.length !== registered.length ||
    expected.some((file, index) => file !== registered[index])
  ) throw new Error("Positive formal witness registration is incomplete or duplicated.");
}
