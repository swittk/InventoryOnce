/** Normal application-facing InventoryOnce grouped APIs. */
export * from "./facade.js";
/** Portable executable legacy-to-InventoryOnce authority transition state machine. */
export * from "./authority.js";
/** Portable fence/drain/stable-source/migration/activation cutover orchestration. */
export * from "./authority-cutover.js";
/** Exact direct/package amount constructors accepted by public commands. */
export * from "./amounts.js";
/** Immutable item/package revision catalogue definitions and safe constructors. */
export * from "./catalog.js";
/** Native scalar unit/package revision selection, append, and activation lifecycle. */
export * from "./catalog-lifecycle.js";
/** Exact primary plus independently measured quantity-vector values/helpers. */
export * from "./measurements.js";
/** Exact finite-decimal quantity values/helpers. */
export * from "./quantity.js";
/** Generic revision-safe physical summaries and exact package-revision listing helpers. */
export * from "./read-model.js";
/** Truthful physical/use-by/reservation availability summaries. */
export * from "./availability.js";
/** Native revision-safe FIFO/FEFO planning values and pure preview helper. */
export * from "./picking.js";
/** Safe heterogeneous-composition placement/source values; event builders stay on `/kernel`. */
export type {
  InventoryCompositionOutputPlacement,
  InventoryCompositionSourcePositionInput,
} from "./composition.js";
/** Safe read-only collection scope/result values; raw projection helpers stay on `/kernel`. */
export type {
  InventoryCollectionMemberSummary,
  InventoryCollectionRollupContribution,
  InventoryCollectionRollupSummary,
  InventoryCollectionStockScope,
  InventoryCollectionSummary,
} from "./collections.js";
/** Revision-frozen mutual-fungibility summaries and exact allocation planning. */
export * from "./fungibility.js";
/** Shared lot/container expiry and effective-use-by helpers. */
export * from "./usability.js";
/** Safe FIFO/FEFO method vocabulary used by native policy helpers. */
export { InventoryAllocationMethod } from "./allocation.js";

/** Public deficit rule configured at the façade boundary. */
export { InventoryDeficitPolicy } from "./projection.js";
/** Current projected lot-master read shape. */
export type {
  InventoryProjectedContainerDefinition,
  InventoryProjectedLotDefinition,
} from "./projection.js";

/** Safe selector constructors for broad reads/reservations/count scopes. */
export {
  everythingInInventoryStockSelector,
  InventoryOptionalIdentityConstraintKind,
  inventoryStockSelector,
} from "./selectors.js";
/** Public selector shapes used by reads/reservations/counts. */
export type {
  InventoryQualifiedDimensionConstraint,
  InventoryOptionalIdentityConstraint,
  InventoryStockSelector,
} from "./selectors.js";

/** Public event/traceability enums and immutable read-result types. */
export {
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
} from "./events.js";
export type {
  InventoryCommittedEvent,
  InventoryMeasurementEvidence,
  InventoryTraceabilityRelationChange,
} from "./events.js";

/** Public first-class physical transfer lifecycle/read types. */
export { InventoryTransferStatus } from "./transfers.js";
export type {
  InventoryTransfer,
  InventoryTransferLine,
  InventoryTransferPrepareLineInput,
  InventoryTransferReceiveLineInput,
} from "./transfers.js";

/** Public reservation lifecycle/read types. */
export {
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
} from "./reservations.js";
export type {
  InventoryReservation,
  InventoryReservationAllocation,
  InventoryReservationBook,
  InventoryReservationFeasibilityGroup,
  InventoryReservationFeasibilityReport,
} from "./reservations.js";

/** Public physical-count lifecycle/read types. */
export { InventoryCountStatus } from "./counts.js";
export type {
  InventoryCount,
  InventoryCountBook,
  InventoryCountObservationLine,
} from "./counts.js";

/** Public current-world and identity/configuration value shapes. */
export type { InventoryWorldState } from "./world.js";
export {
  InventoryTraceabilityNodeKind,
  inventoryContainerIdentity,
  inventoryLotIdentity,
} from "./model.js";
export type {
  ContainerId,
  InventoryContainerDefinition,
  InventoryLotDefinition,
  InventoryMetadata,
  InventoryMetadataValue,
  InventoryQualifiedDimension,
  InventoryTraceabilityNodeRef,
  InventoryStockPosition,
  InventoryStockPositionInput,
  InventoryStockPositionKey,
  ItemId,
  ItemRevisionId,
  LocationId,
  LotId,
  PartyId,
  SerialId,
  StockStatusId,
  TransferId,
} from "./model.js";
