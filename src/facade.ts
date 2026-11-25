import { createInventoryRecordedMovement, type InventoryUnwitnessedMovementLine } from "./recorded-movement.js";
import {
  inventoryScopedStockMatches,
  type InventoryScopedStockPool,
  type InventoryScopedStockPosition,
} from "./stock-scope.js";
import { assertInventoryAmountKind } from "./stock-amount-rules.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  summarizeInventoryAvailability,
  type InventoryAvailabilitySummary,
} from "./availability.js";
import {
  InventoryAmountKind,
  measuredStockAmount,
  packageAmount,
  resolveInventoryAmount,
  stockAmount,
  assertInventoryAmountSum,
  type InventoryAmount,
} from "./amounts.js";
import {
  assertInventoryCatalogRetainsSnapshot,
  assertPositionMatchesItem,
  inventoryCatalogFromSnapshot,
  inventoryCatalogSnapshot,
  extendInventoryCatalog,
  type ExtendInventoryCatalogInput,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
  type InventoryCollectionDefinitionRevision,
  type InventoryCollectionId,
  type InventoryCollectionRevisionId,
  type InventoryCompositionDefinitionRevision,
  type InventoryCompositionId,
  type InventoryCompositionRevisionId,
  type InventoryTransformationDefinitionRevision,
  type InventoryTransformationId,
  type InventoryTransformationRevisionId,
  type InventoryFungibilityPoolDefinitionRevision,
  type InventoryFungibilityPoolId,
  type InventoryFungibilityRevisionId,
} from "./catalog.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
} from "./canonical.js";
import {
  createInventoryCompositionOpenEvent,
  inventoryCompositionOpenIntentFingerprint,
  type CreateInventoryCompositionOpenEventInput,
} from "./composition.js";
import {
  summarizeInventoryCollection,
  type InventoryCollectionStockScope,
  type InventoryCollectionSummary,
} from "./collections.js";
import {
  type CommitInventoryOperationResult,
  InventoryReservationProtection,
  commitInventoryOperation,
  resumeInventoryDurableOperation,
  type InventoryClock,
} from "./coordinator.js";
import {
  abandonInventoryCount,
  completeInventoryCount,
  createInventoryCountReconciliationPlan,
  observeInventoryCount,
  startInventoryCount,
  type AbandonInventoryCountInput,
  type InventoryCount,
  type InventoryCountObservationLine,
} from "./counts.js";
import {
  createInventoryCatalogPublicationEvent,
  createInventoryDeindividualizeEvent,
  createInventoryDetachEvent,
  createInventoryIndividualizeEvent,
  createInventoryIssueEvent,
  createInventoryIssueManyEvent,
  createInventoryPlacementNodeMetadataEvent,
  createInventoryPlacementEvent,
  createInventoryLotMetadataEvent,
  createInventoryMarkMissingEvent,
  createInventoryOpeningEvent,
  createInventoryPackEvent,
  createInventoryPlaceEvent,
  createInventoryReceiptEvent,
  createInventoryReceiptManyEvent,
  createInventoryReclassificationEvent,
  createInventoryReclassificationManyEvent,
  createInventoryRevisionTransitionEvent,
  createInventoryScrapEvent,
  createInventoryScrapManyEvent,
  createInventoryTraceabilityEvent,
  createInventoryTransferEvent,
  createInventoryTransferManyEvent,
  createInventoryTransformationEvent,
  createInventoryUnpackEvent,
  inventoryEventIdForOperation,
  type CreateInventoryCatalogPublicationInput,
  type CreateInventoryDeindividualizeInput,
  type CreateInventoryIndividualizeInput,
  type CreateInventoryIssueInput,
  type CreateInventoryIssueManyInput,
  type CreateInventoryPlacementNodeMetadataInput,
  type CreateInventoryPlacementInput,
  type CreateInventoryLotMetadataInput,
  type CreateInventoryOpeningInput,
  type CreateInventoryPackInput,
  type CreateInventoryReceiptInput,
  type CreateInventoryReceiptManyInput,
  type CreateInventoryReclassificationInput,
  type CreateInventoryReclassificationManyInput,
  type CreateInventoryScrapInput,
  type CreateInventoryScrapManyInput,
  type CreateInventoryTraceabilityInput,
  type CreateInventoryTransferInput,
  type CreateInventoryTransferManyInput,
  type CreateInventoryTransformationInput,
  type CreateInventoryUnpackInput,
  type InventoryCommandHeader,
  type InventoryTransferLine,
  type InventoryPlacementNodeMetadataInput,
  type InventoryLotMetadataInput,
  type InventoryTransformationLine,
} from "./commands.js";
import {
  assertInventoryRevisionTransitionPlanIntent,
  inventoryRevisionTransitionPlansEqual,
  planInventoryRevisionTransition,
  type InventoryRevisionTransitionPlan,
  type InventoryRevisionTransitionRequest,
} from "./revision-transitions.js";
import { createInventoryCorrectionEvent } from "./corrections.js";
import {
  InventoryHistoricalReplayConflictError,
  type InventoryHistoricalReplayConflict,
} from "./historical-replay.js";
import {
  createInventoryHistoricalRepairEvent,
  InventoryHistoricalRepairMetadataError,
} from "./historical-repair.js";
import { loadInventoryHistoricalDependencies } from "./historical-dependencies.js";
import {
  queryInventoryProjectionEvents,
  type InventoryEventPage,
  type InventoryEventQuery,
} from "./event-query.js";
import {
  INVENTORY_RECORDED_DEFICIT_LOT_ID,
  inventoryRecordedDeficitPoolSelector,
  inventoryPositionIsDeficit,
} from "./deficits.js";
import {
  assertInventoryEpochMilliseconds,
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  defineInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryHistoricalAssertion,
  type InventoryHistoricalImpact,
  type InventoryStockEffect,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
  InventoryFungibilityReservationEffectKind,
  inventoryFungibilityScopeIdentity,
  normalizeInventoryFungibilityScope,
  planInventoryFungibilityAllocation,
  planInventoryFungibilityRecordingAllocation,
  summarizeInventoryFungibility,
  type InventoryFungibilityAllocationLine,
  type InventoryFungibilityAllocationPlan,
  type InventoryFungibilityReservationEffect,
  type InventoryFungibilityScope,
  type InventoryFungibilitySummary,
  type PlanInventoryFungibilityAllocationInput,
} from "./fungibility.js";
import {
  addInventoryMeasurementTotals,
  materializeInventoryMeasurementTotals,
  type InventoryMeasurementTotals,
} from "./measurement-totals.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementAt,
  inventoryMeasurementsEqual,
  inventoryMeasurementsAreZero,
  inventoryMeasurementsFingerprint,
  negateInventoryMeasurements,
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  assertInventoryIdentity,
  inventoryPlacementNodeIdentity,
  inventoryLotIdentity,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
  normalizeInventoryStockPositionKey,
  InventoryStockWhereaboutsState,
  InventoryTraceabilityNodeKind,
  type InventoryPlacementNodeDefinition,
  type InventoryLotDefinition,
  type InventoryMetadata,
  type InventoryMetadataValue,
  type InventoryQualifiedDimension,
  type InventoryStockPosition,
  type InventoryStockPositionInput,
  type InventoryStockPositionKey,
  type InventoryTraceabilityNodeRef,
  type PartyId,
} from "./model.js";
import {
  inventoryPlacementAncestry,
  inventoryPlacementNodeIsWithin,
  inventoryPlacementParentNodeId,
  inventoryPlacementSubtreeNodeIds,
  type InventoryPlacementChange,
} from "./placement.js";
import {
  findInventoryPositions,
  InventoryDeficitPolicy,
  type InventoryProjectedPlacementNodeDefinition,
  type InventoryProjectedLotDefinition,
  type InventoryProjectionState,
} from "./projection.js";
import {
  addQuantity,
  compareQuantity,
  quantity,
  quantityEq,
  quantityToDecimalString,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  listInventoryPackagingRevisions,
  summarizeInventoryStock,
  summarizeInventoryStockPositions,
  type InventoryStockSummary,
  type ListInventoryPackagingRevisionsInput,
} from "./read-model.js";
import {
  inventorySparseRecordValue,
} from "./sparse-record.js";
import {
  inventoryAmountForPrimaryAllocation,
  planInventoryAllocation,
  inventoryAllocationPoolFromWorld,
  inventoryAllocationPoolSelector,
  inventoryPolicyMovementRemainder,
  planInventoryAllocationInPool,
  resolveAllocationItemAndSelector,
  type ResolvedAllocationSelection,
  type PlanInventoryAllocationInPoolInput,
  type InventoryAllocationPolicyRequest,
  type InventoryPolicyAllocationLine,
  type InventoryPolicyAllocationPlan,
} from "./picking.js";
import {
  allocateInventoryReservation,
  createInventoryReservation,
  expireInventoryReservation,
  markInventoryReservationConsumed,
  refineInventoryReservation,
  releaseInventoryReservation,
  type InventoryReservation,
  type InventoryReservationAllocation,
  type NewInventoryReservation,
  inspectInventoryReservationFeasibility,
  inventoryReservationIsActiveAt,
  inventoryReservationsAt,
  type InventoryReservationFeasibilityReport,
} from "./reservations.js";
import {
  assertPositionInsideSelector,
  InventoryOptionalIdentityConstraintKind,
  inventoryStockPositionMatchesNormalizedSelector,
  inventoryStockSelectorIdentity,
  normalizeInventoryStockSelector,
  type InventoryOptionalIdentityConstraint,
  type InventoryQualifiedDimensionConstraint,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  inventoryStorageSupportsEventQuery,
  inventoryStorageSupportsSegmentedPlacement,
  inventoryStorageSupportsSegmentedStockPlanning,
  InventoryDurableOperationState,
  type InventorySegmentedDirectContents,
  type InventorySegmentedStockPlanningCapability,
  type InventoryDurableStorage,
  type InventoryOperationReceipt,
  type InventorySegmentedPlacementStorageCapability,
} from "./storage.js";
import type { InventorySegmentedPlacementReader } from "./segmented-placement.js";
import {
  inventoryStorageSupportsSegmentedPositions,
  inventoryStorageSupportsSegmentedStockEventCommit,
  readInventorySegmentedPositionSnapshot,
  type InventorySegmentedPositionReader,
  type InventorySegmentedResult,
} from "./segmented-state.js";
import {
  findInventoryWhereaboutsHistory,
  inventoryWhereaboutsLifecycles,
  type InventoryWhereaboutsHistoryQuery,
  type InventoryWhereaboutsLifecycle,
} from "./whereabouts.js";
import {
  createInventoryTransferDispatchEvent,
  createInventoryTransferPrepareEvent,
  createInventoryTransferReceiveEvent,
  createInventoryTransferReleaseEvent,
  inventoryTransferDispatchIntentFingerprint,
  inventoryTransferReceiveIntentFingerprint,
  inventoryTransferReleaseIntentFingerprint,
  type CreateInventoryTransferPrepareEventInput,
  type InventoryTransfer,
  type InventoryTransferReceiveLineInput,
} from "./transfers.js";
import { inventoryPositionIsExpiredAt } from "./usability.js";
import type { InventoryWorldState } from "./world.js";

/** Default wall clock used when applications do not inject one. */
const systemInventoryClock: InventoryClock = {
  /** Return canonical current UTC time. */
  nowEpochMs: (): number => Date.now(),
};
/** Reserved count metadata retaining one complete absolute-count intent. */
const inventoryAbsoluteCountMetadataKey = "inventoryOnceAbsoluteCount";
/** Version of the reserved absolute-count replay-evidence payload. */
const inventoryAbsoluteCountMetadataVersion = 4;

/** Private runtime configuration retained for one InventoryOnce façade. */
interface InventoryOnceInternals {
  /** Frozen retained catalogue. */
  readonly catalog: InventoryCatalog;
  /** Durable staged storage. */
  readonly storage: InventoryDurableStorage;
  /** Record-time clock. */
  readonly clock: InventoryClock;
  /** Explicit negative-stock policy. */
  readonly deficitPolicy: InventoryDeficitPolicy;
}

/** Private internal configuration by public façade instance. */
const inventoryOnceInternals = new WeakMap<
  InventoryOnce,
  InventoryOnceInternals
>();

/** One published-world catalogue read kept on the same durable snapshot. */
export interface PublishedInventoryCatalogRead {
  /** Exact durable world supplying this catalogue. */
  readonly world: InventoryWorldState;
  /** Catalogue reconstructed only from that world's retained snapshot. */
  readonly catalog: InventoryCatalog;
}

/** Read one durable world and reconstruct its exact retained catalogue without application snapshot plumbing. */
export async function readPublishedInventoryCatalog(
  storage: InventoryDurableStorage
): Promise<PublishedInventoryCatalogRead> {
  const world = await storage.readWorld();
  return {
    world,
    catalog: inventoryCatalogFromSnapshot(world.catalog),
  };
}

/** Read one coherent public snapshot directly from fully published durable truth. */
export async function readPublishedInventorySnapshot(
  storage: InventoryDurableStorage,
  atEpochMs = systemInventoryClock.nowEpochMs()
): Promise<InventoryOnceReadSnapshotApi> {
  const world = await storage.readWorld();
  return new InventoryOnceReadSnapshotImplementation(
    world,
    inventoryCatalogFromSnapshot(world.catalog),
    atEpochMs
  );
}

/** Inputs for publishing one already-prepared append-only catalogue only when durable truth differs. */
export interface PublishInventoryCatalogIfChangedInput
  extends Pick<InventoryCommandHeader, "reason" | "metadata"> {
  /** Durable InventoryOnce storage owning the published catalogue snapshot. */
  readonly storage: InventoryDurableStorage;
  /** Complete proposed catalogue retaining every current durable revision. */
  readonly catalog: InventoryCatalog;
  /** Stable publication retry identity. */
  readonly operationId: string;
  /** Physical/approval time of this catalogue declaration. */
  readonly occurredAtEpochMs: number;
  /** Optional deterministic record-time clock. */
  readonly clock?: InventoryClock;
}

/** Result of one append-only catalogue publication/no-op decision. */
export interface PublishInventoryCatalogIfChangedResult {
  /** Exact durable world after publication or the unchanged current world. */
  readonly world: InventoryWorldState;
  /** Catalogue reconstructed from that same durable world. */
  readonly catalog: InventoryCatalog;
  /** True only when this call published or replayed a durable catalogue event. */
  readonly published: boolean;
  /** True when the exact publication operation already existed. */
  readonly replayed: boolean;
}

/** Publish one complete append-only catalogue only when its digest differs from durable truth. */
export async function publishInventoryCatalogIfChanged({
  storage,
  catalog,
  operationId,
  occurredAtEpochMs,
  clock,
  reason,
  metadata,
}: PublishInventoryCatalogIfChangedInput): Promise<PublishInventoryCatalogIfChangedResult> {
  const currentWorld = await storage.readWorld();
  assertInventoryCatalogRetainsSnapshot(catalog, currentWorld.catalog);
  const currentCatalog = inventoryCatalogFromSnapshot(currentWorld.catalog);
  if (currentCatalog.digest === catalog.digest) {
    return {
      world: currentWorld,
      catalog: currentCatalog,
      published: false,
      replayed: false,
    };
  }
  const inventory = createInventoryOnce({
    catalog,
    storage,
    ...(clock === undefined ? {} : { clock }),
  });
  const publication = await inventory.catalog.publish({
    operationId,
    occurredAtEpochMs,
    ...(reason === undefined ? {} : { reason }),
    ...(metadata === undefined ? {} : { metadata }),
  });
  const publishedWorld = await storage.readWorld();
  return {
    world: publishedWorld,
    catalog: inventoryCatalogFromSnapshot(publishedWorld.catalog),
    published: true,
    replayed: publication.replayed,
  };
}

/** Append-only catalogue changes without the current catalogue repeated by callers. */
export type InventoryCatalogExtension = Omit<
  ExtendInventoryCatalogInput,
  "catalog"
>;

/** Inputs for rebasing one append-only catalogue extension onto current durable truth. */
export interface PublishInventoryCatalogExtensionInput
  extends Omit<PublishInventoryCatalogIfChangedInput, "catalog"> {
  /** New immutable revisions and active-pointer updates. */
  readonly extension: InventoryCatalogExtension;
  /** Bounded retry count when another catalogue publisher wins first. */
  readonly maxRevisionRetries?: number;
}

/** Rebase an append-only extension on current durable truth and publish it only when changed. */
export async function publishInventoryCatalogExtension({
  storage,
  operationId,
  occurredAtEpochMs,
  clock,
  reason,
  metadata,
  extension,
  maxRevisionRetries = 8,
}: PublishInventoryCatalogExtensionInput): Promise<PublishInventoryCatalogIfChangedResult> {
  if (!Number.isSafeInteger(maxRevisionRetries) || maxRevisionRetries <= 0) {
    throw new Error("Catalogue extension maxRevisionRetries must be positive.");
  }
  for (let attempt = 0; attempt < maxRevisionRetries; attempt += 1) {
    const currentWorld = await storage.readWorld();
    const currentCatalog = inventoryCatalogFromSnapshot(currentWorld.catalog);
    const extended = extendInventoryCatalog({
      catalog: currentCatalog,
      ...extension,
    });
    if (extended.digest === currentCatalog.digest) {
      return {
        world: currentWorld,
        catalog: currentCatalog,
        published: false,
        replayed: false,
      };
    }
    try {
      return await publishInventoryCatalogIfChanged({
        storage,
        catalog: extended,
        operationId,
        occurredAtEpochMs,
        ...(clock === undefined ? {} : { clock }),
        ...(reason === undefined ? {} : { reason }),
        ...(metadata === undefined ? {} : { metadata }),
      });
    } catch (error) {
      const latestWorld = await storage.readWorld();
      const latestCatalog = inventoryCatalogFromSnapshot(latestWorld.catalog);
      if (latestCatalog.digest !== currentCatalog.digest) continue;
      throw error;
    }
  }
  throw new Error(
    `Inventory catalogue extension '${operationId}' could not rebase after ${maxRevisionRetries} attempts.`
  );
}

/** Inputs for creating one application-facing InventoryOnce authority. */
export interface CreateInventoryOnceInput {
  /** Frozen retained item/package catalogue. */
  readonly catalog: InventoryCatalog;
  /** Durable staged storage adapter. */
  readonly storage: InventoryDurableStorage;
  /** Optional record-time clock. */
  readonly clock?: InventoryClock;
  /** Explicit negative-stock rule, defaulting to reject. */
  readonly deficitPolicy?: InventoryDeficitPolicy;
}

/** Common durable operation result fields. */
export interface InventoryOnceOperationResult {
  /** Frozen durable receipt. */
  readonly receipt: InventoryOperationReceipt;
  /** True when this operation already existed before this call. */
  readonly replayed: boolean;
}

/** Result for one resource/traceability/correction event command. */
export interface InventoryOnceEventResult extends InventoryOnceOperationResult {
  /** Committed immutable event. */
  readonly event: InventoryCommittedEvent;
  /** Exact durable shortfall when a policy command records a physical report. */
  readonly deficit?: InventoryOnceRecordedDeficit;
}

/** Result for one first-class physical transfer lifecycle mutation. */
export interface InventoryOnceTransferResult extends InventoryOnceEventResult {
  /** Current transfer truth after the committed/replayed transition. */
  readonly transfer: InventoryTransfer;
}

/** Prepare exact source stock under one durable physical transfer identity. */
export type InventoryOncePrepareTransferInput = Omit<
  CreateInventoryTransferPrepareEventInput,
  "catalog"
>;

/** Dispatch one prepared transfer into its configured transit placement. */
export interface InventoryOnceDispatchTransferInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
  /** Transfer-lifecycle carrierCustodianId value retained or supplied by this record. */ readonly carrierCustodianId?: PartyId;
}

/** Receive some/all remaining stock belonging only to one dispatched transfer. */
export interface InventoryOnceReceiveTransferInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
  /** Omit to receive every remaining line in full. */
  readonly lines?: readonly InventoryTransferReceiveLineInput[];
}

/** Release a prepared transfer before dispatch, restoring ordinary source availability. */
export interface InventoryOnceReleaseTransferInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
}

/** Exact first-class transfer lookup. */
export interface InventoryOnceFindTransferInput {
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
}

/** Result for one reservation lifecycle command. */
export interface InventoryOnceReservationResult
  extends InventoryOnceOperationResult {
  /** Current reservation after the operation. */
  readonly reservation: InventoryReservation;
  /** Committed issue event when reservation consumption changed stock. */
  readonly event?: InventoryCommittedEvent;
}

/** Result for one physical-count lifecycle command. */
export interface InventoryOnceCountResult extends InventoryOnceOperationResult {
  /** Current count after the operation. */
  readonly count: InventoryCount;
  /** Committed discrepancy event when reconciliation changed stock. */
  readonly event?: InventoryCommittedEvent;
}

/** Catalogue publication command without repeated catalogue plumbing. */
export type InventoryOncePublishCatalogInput = Omit<
  CreateInventoryCatalogPublicationInput,
  "catalog"
>;

/** Normal receipt command without repeated catalogue plumbing. */
export type InventoryOnceReceiveInput = Omit<
  CreateInventoryReceiptInput,
  "catalog"
>;
/** Normal issue command without repeated catalogue plumbing. */
export type InventoryOnceIssueInput = Omit<
  CreateInventoryIssueInput,
  "catalog"
>;
/** Atomic multi-line receipt without repeated catalogue plumbing. */
export type InventoryOnceReceiveManyInput = Omit<
  CreateInventoryReceiptManyInput,
  "catalog"
>;
/** Atomic multi-position issue without repeated catalogue plumbing. */
export type InventoryOnceIssueManyInput = Omit<
  CreateInventoryIssueManyInput,
  "catalog"
>;
/** Normal direct-placement transfer command without repeated catalogue plumbing. */
export type InventoryOnceTransferInput = Omit<
  CreateInventoryTransferInput,
  "catalog"
>;
/** Atomic multi-position transfer without repeated catalogue plumbing. */
export type InventoryOnceTransferManyInput = Omit<
  CreateInventoryTransferManyInput,
  "catalog"
>;
/** Atomic conserved split/merge/reclassification without repeated catalogue plumbing. */
export type InventoryOnceReclassifyManyInput = Omit<
  CreateInventoryReclassificationManyInput,
  "catalog"
>;
/** Commit a frozen preview against exactly the world that was reviewed. */
export interface InventoryOnceTransitionRevisionInput extends InventoryCommandHeader {
  /** Complete preview whose source rows and mapping were reviewed before commit. */
  readonly plan: InventoryRevisionTransitionPlan;
}

/** Split one exact fungible unit into a new current serial identity. */
export type InventoryOnceIndividualizeInput = Omit<
  CreateInventoryIndividualizeInput,
  "catalog"
>;
/** Merge one exact serial identity back into otherwise identical fungible stock. */
export type InventoryOnceDeindividualizeInput = Omit<
  CreateInventoryDeindividualizeInput,
  "catalog"
>;

/** Normal pack command without repeated catalogue plumbing. */
export type InventoryOncePackInput = Omit<CreateInventoryPackInput, "catalog">;
/** Normal unpack command without repeated catalogue plumbing. */
export type InventoryOnceUnpackInput = Omit<
  CreateInventoryUnpackInput,
  "catalog"
>;
/** Normal transformation command without repeated catalogue plumbing. */
export type InventoryOnceTransformationInput = Omit<
  CreateInventoryTransformationInput,
  "catalog"
>;
/** Normal scrap command without repeated catalogue plumbing. */
export type InventoryOnceScrapInput = Omit<
  CreateInventoryScrapInput,
  "catalog"
>;
/** Atomic multi-position scrap without repeated catalogue plumbing. */
export type InventoryOnceScrapManyInput = Omit<
  CreateInventoryScrapManyInput,
  "catalog"
>;
/** Normal lot-metadata assertion without repeated catalogue plumbing. */
export type InventoryOnceDefineLotInput = Omit<
  CreateInventoryLotMetadataInput,
  "catalog"
>;

/** Inputs for append-only correction of current lot metadata without reconstructing its root event. */
export interface InventoryOnceCorrectLotInput extends InventoryCommandHeader {
  /** Stable item owning the item-scoped lot. */
  readonly itemId: string;
  /** Stable lot/batch identity. */
  readonly lotId: string;
  /** Correct current lot metadata, or omit it when the retained assertion was entirely wrong. */
  readonly lot?: InventoryLotMetadataInput;
}

/** Normal placement-node metadata assertion without repeated catalogue plumbing. */
export type InventoryOnceDefinePlacementNodeInput = Omit<
  CreateInventoryPlacementNodeMetadataInput,
  "catalog"
>;

/** Inputs for append-only correction of current placement-node metadata/policy. */
export interface InventoryOnceCorrectPlacementNodeInput
  extends InventoryCommandHeader {
  /** Stable generic placement-node identity. */
  readonly nodeId: string;
  /** Correct current metadata, or omission when the retained assertion was entirely wrong. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
}

/** Optional optimistic direct-parent expectation for one topology move. */
export type InventoryExpectedPlacementParent = string | null;

/** Inputs for moving one node beneath another without rewriting descendant stock. */
export interface InventoryOnceMovePlacementInput extends InventoryCommandHeader {
  /** Node whose direct placement changes. */
  readonly nodeId: string;
  /** Destination node accepting this node. */
  readonly into: string;
  /** Optional optimistic parent expectation; null means currently unplaced. */
  readonly expectedParent?: InventoryExpectedPlacementParent;
  /** Optional metadata/policy assertion for the moved node. */
  readonly node?: InventoryPlacementNodeMetadataInput;
  /** Optional metadata/policy assertion for the destination node. */
  readonly destination?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for removing one node from its current parent without changing descendants. */
export interface InventoryOnceUnplaceInput extends InventoryCommandHeader {
  /** Node becoming an unplaced/root node. */
  readonly nodeId: string;
  /** Optional optimistic parent expectation; null means currently unplaced. */
  readonly expectedParent?: InventoryExpectedPlacementParent;
  /** Optional metadata/policy assertion for the moved node. */
  readonly node?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for emptying one node's direct stock and child nodes into another node. */
export interface InventoryOnceMovePlacementContentsInput
  extends InventoryCommandHeader {
  /** Node whose direct contents are moved out. */
  readonly nodeId: string;
  /** Destination receiving every direct stock row and direct child node. */
  readonly into: string;
}

/** Inputs for issuing every current stock row in one placement subtree. */
export interface InventoryOnceIssuePlacementContentsInput
  extends InventoryCommandHeader {
  /** Root node whose current direct and nested stock leaves inventory together. */
  readonly nodeId: string;
}

/** Inputs for destroying every current stock row in one placement subtree. */
export interface InventoryOnceScrapPlacementContentsInput
  extends InventoryCommandHeader {
  /** Root node whose current direct and nested stock is destroyed together. */
  readonly nodeId: string;
}

/** Inputs for applying one stock status to every current row in a placement subtree. */
export interface InventoryOnceChangePlacementContentsStatusInput
  extends InventoryCommandHeader {
  /** Root node whose current direct and nested stock changes status together. */
  readonly nodeId: string;
  /** New explicit status applied to every direct and nested stock row. */
  readonly toStatusId: string;
}

/** Inputs for clearing stock status from every current row in a placement subtree. */
export interface InventoryOnceClearPlacementContentsStatusInput
  extends InventoryCommandHeader {
  /** Root node whose current direct and nested stock loses its status together. */
  readonly nodeId: string;
}

/** Read-side native allocation preview with optional authority-time override. */
export interface InventoryOncePlanAllocationInput
  extends InventoryAllocationPolicyRequest {
  /** Physical authority time for lot/placement-ancestry expiry; defaults to the façade clock. */
  readonly atEpochMs?: number;
  /** Claim-book authority time; defaults to the physical authority time. */
  readonly reservationAtEpochMs?: number;
}

/** Common header plus native FIFO/FEFO allocation policy for one physical movement. */
export interface InventoryOncePolicyMovementInput
  extends InventoryCommandHeader,
    InventoryAllocationPolicyRequest {
  /** Explicit unallocated position used only when Record mode must persist policy shortfall. */
  readonly deficitPosition?: InventoryStockPositionInput;
}

/** Native FIFO/FEFO issue/dispense request. */
export type InventoryOnceIssueByPolicyInput = InventoryOncePolicyMovementInput;

/** One independently identified request inside an atomic multi-request policy command. */
export type InventoryOncePolicyBatchRequest = Omit<
  InventoryAllocationPolicyRequest,
  "reservationId" | "allowAllocatedStock"
> & {
  /** Stable caller identity used to recover this request's exact frozen allocation. */
  readonly requestId: string;
  /** Optional stable result group joining several exact subrequests for one caller line. */
  readonly groupId?: string;
  /** Explicit unallocated position used only when Record mode must persist this request shortfall. */
  readonly deficitPosition?: InventoryStockPositionInput;
};

/** Common header for one atomic group of independently identified policy requests. */
export interface InventoryOncePolicyBatchInput extends InventoryCommandHeader {
  /** Non-empty requests planned in this exact order against one evolving frozen world. */
  readonly requests: readonly InventoryOncePolicyBatchRequest[];
}

/** Native atomic FIFO/FEFO issue across multiple requests/items. */
export type InventoryOnceIssueManyByPolicyInput = InventoryOncePolicyBatchInput;

/** Native FIFO/FEFO transfer request from one source direct placement to one destination. */
export interface InventoryOnceTransferByPolicyInput
  extends InventoryOncePolicyMovementInput {
  /** Destination direct placement; the selector must resolve one source direct placement. */
  readonly toPlacementNodeId: string;
}

/** Native atomic FIFO/FEFO transfer across multiple requests/items. */
export interface InventoryOnceTransferManyByPolicyInput
  extends InventoryOncePolicyBatchInput {
  /** One destination shared by every exact selected source line. */
  readonly toPlacementNodeId: string;
}

/** One exact source allocation retained for an identified policy-batch request. */
export interface InventoryOncePolicyBatchAllocationLine {
  /** Exact validated source position present in the committed event. */
  readonly position: InventoryStockPositionKey;
  /** Canonical identity of that exact source position. */
  readonly positionIdentity: string;
  /** Exact measured/package amount assigned to this request and source position. */
  readonly amount: InventoryAmount;
  /** Exact positive primary quantity assigned to this request. */
  readonly allocatedPrimary: Quantity;
  /** FIFO layer age frozen while planning the durable operation. */
  readonly layerStartedAtEpochMs: number;
  /** Effective expiry used by FEFO when known. */
  readonly expiresAtEpochMs?: number;
}

/** Exact durable shortfall posted as a signed debit at its source. */
export interface InventoryOnceRecordedDeficit {
  /** Exact position receiving the negative shortfall effect, which can settle against an existing balance. */
  readonly position: InventoryStockPositionKey;
  /** Positive reported amount that the negative posting represents. */
  readonly amount: InventoryAmount;
  /** Exact positive primary shortfall represented by this deficit. */
  readonly primary: Quantity;
}

/** Exact frozen allocation for one caller request inside a policy batch. */
export interface InventoryOncePolicyBatchAllocation {
  /** Stable request identity supplied by the caller. */
  readonly requestId: string;
  /** Stable result group, defaulting to requestId when the caller omitted one. */
  readonly groupId: string;
  /** Exact source lines assigned to only this request. */
  readonly lines: readonly InventoryOncePolicyBatchAllocationLine[];
  /** Durable unallocated shortfall recorded under Record mode. */
  readonly deficit?: InventoryOnceRecordedDeficit;
}

/** Replay-safe aggregate of several exact policy subrequests for one caller result line. */
export interface InventoryOncePolicyBatchAllocationGroup {
  /** Stable caller result-group identity. */
  readonly groupId: string;
  /** Ordered request identities contributing to this group. */
  readonly requestIds: readonly string[];
  /** Exact validated source lines attributed to the complete group. */
  readonly lines: readonly InventoryOncePolicyBatchAllocationLine[];
}

/** One atomic event plus replay-safe per-request allocation evidence. */
export interface InventoryOncePolicyBatchResult
  extends InventoryOnceEventResult {
  /** Frozen exact allocations recovered from immutable event metadata on first call or replay. */
  readonly allocations: readonly InventoryOncePolicyBatchAllocation[];
  /** Frozen allocations regrouped by caller-supplied group identity. */
  readonly allocationGroups: readonly InventoryOncePolicyBatchAllocationGroup[];
}

/** Native FIFO/FEFO physical scrap request; may explicitly include allocated stock. */
export type InventoryOnceScrapByPolicyInput = InventoryOncePolicyMovementInput;

/** Native heterogeneous package opening without repeated catalogue/projection plumbing. */
export type InventoryOnceOpenCompositionInput = Omit<
  CreateInventoryCompositionOpenEventInput,
  "catalog" | "projection"
>;

/** Read-side exact collection summary request. */
export interface InventoryOnceCollectionSummaryInput {
  /** Exact immutable collection revision to summarize. */
  readonly collectionRevisionId: InventoryCollectionRevisionId;
  /** Optional common stock dimensions such as placement/status/owner. */
  readonly scope?: InventoryCollectionStockScope;
}

/** Read-side exact fungibility summary request. */
export interface InventoryOnceFungibilitySummaryInput {
  /** Exact immutable pool revision to summarize. */
  readonly fungibilityRevisionId: InventoryFungibilityRevisionId;
  /** Optional common stock dimensions such as placement/status/owner. */
  readonly scope?: InventoryFungibilityScope;
}

/** Read-side common-basis allocation preview with optional authority-time override. */
export interface InventoryOncePlanFungibilityInput {
  /** Exact immutable pool revision used for all conversions. */
  readonly fungibilityRevisionId: InventoryFungibilityRevisionId;
  /** Exact requested quantity in the pool basis unit. */
  readonly requested: Quantity;
  /** FIFO or FEFO ordering across all member positions. */
  readonly method: InventoryAllocationPolicyRequest["method"];
  /** Optional common stock dimensions such as one source direct placement. */
  readonly scope?: InventoryFungibilityScope;
  /** Physical authority time for use-by; defaults to the façade clock. */
  readonly atEpochMs?: number;
  /** Claim-book authority time; defaults to the physical authority time. */
  readonly reservationAtEpochMs?: number;
  /** Preview depletion or one exact direct-placement transfer. */
  readonly reservationEffect?: InventoryFungibilityReservationEffect;
  /** Explicit override permitting expired member stock. */
  readonly allowExpiredLots?: boolean;
  /** Physical-truth override permitting exactly allocated positions. */
  readonly allowAllocatedStock?: boolean;
}

/** Common immutable header plus exact revision-frozen pool allocation request. */
export interface InventoryOnceFungibilityMovementInput
  extends InventoryCommandHeader {
  /** Exact immutable pool revision; active pointers are never resolved during retry. */
  readonly fungibilityRevisionId: InventoryFungibilityRevisionId;
  /** Exact requested quantity in the pool basis unit. */
  readonly requested: Quantity;
  /** FIFO or FEFO ordering across all member positions. */
  readonly method: InventoryAllocationPolicyRequest["method"];
  /** Optional common stock dimensions such as one source direct placement. */
  readonly scope?: InventoryFungibilityScope;
  /** Explicit override permitting expired member stock. */
  readonly allowExpiredLots?: boolean;
  /** Physical-truth override permitting exactly allocated positions. */
  readonly allowAllocatedStock?: boolean;
}

/** Revision-frozen mutual-fungibility issue/dispense request. */
export type InventoryOnceIssueFungibleInput =
  InventoryOnceFungibilityMovementInput;

/** Revision-frozen mutual-fungibility transfer request. */
export interface InventoryOnceTransferFungibleInput
  extends InventoryOnceFungibilityMovementInput {
  /** Destination direct placement; scope must name exactly one source direct placement. */
  readonly toPlacementNodeId: string;
}

/** Revision-frozen physical scrap request over mutually fungible members. */
export type InventoryOnceScrapFungibleInput =
  InventoryOnceFungibilityMovementInput;

/** Opening assertion available only while correcting/importing retained migration facts. */
export type InventoryOnceOpeningReplacementInput = Omit<
  CreateInventoryOpeningInput,
  "catalog" | "operationId"
>;

/** Shared fields for one named dimension-only stock change. */
export interface InventoryOnceDimensionChangeInput
  extends InventoryCommandHeader {
  /** Exact source position before the named dimension changes. */
  readonly from: InventoryStockPositionInput;
  /** Exact amount changing classification. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for intentionally removing stock from a known placement without issuing it. */
export type InventoryOnceDetachInput = InventoryOnceDimensionChangeInput;

/** Inputs for placing currently detached/missing stock at one known node. */
export interface InventoryOncePlaceInput
  extends InventoryOnceDimensionChangeInput {
  /** New exact direct placement node. */
  readonly into: string;
}

/** Inputs for classifying stock as genuinely missing while it remains accounted-for inventory. */
export type InventoryOnceMarkMissingInput = InventoryOnceDimensionChangeInput;

/** Inputs for changing only stock status/disposition. */
export interface InventoryOnceChangeStatusInput
  extends InventoryOnceDimensionChangeInput {
  /** New explicit stock status. */
  readonly toStatusId: string;
}

/** Inputs for removing the current stock status while preserving every other dimension. */
export type InventoryOnceClearStatusInput = InventoryOnceDimensionChangeInput;

/** Inputs for changing only legal/economic ownership. */
export interface InventoryOnceChangeOwnerInput
  extends InventoryOnceDimensionChangeInput {
  /** New owner party. */
  readonly toOwnerId: PartyId;
}

/** Inputs for removing the current owner while preserving every other dimension. */
export type InventoryOnceClearOwnerInput = InventoryOnceDimensionChangeInput;

/** Inputs for changing only physical custody/possession. */
export interface InventoryOnceChangeCustodianInput
  extends InventoryOnceDimensionChangeInput {
  /** New custodian/possessor party. */
  readonly toCustodianId: PartyId;
}

/** Inputs for removing the current custodian while preserving every other dimension. */
export type InventoryOnceClearCustodianInput =
  InventoryOnceDimensionChangeInput;

/** Inputs for changing only disposition authority. */
export interface InventoryOnceChangeDispositionAuthorityInput
  extends InventoryOnceDimensionChangeInput {
  /** New party entitled to decide use/disposal. */
  readonly toDispositionAuthorityId: PartyId;
}

/** Inputs for removing the current disposition authority while preserving every other dimension. */
export type InventoryOnceClearDispositionAuthorityInput =
  InventoryOnceDimensionChangeInput;

/** Inputs for setting one item-defined qualified stock dimension. */
export interface InventoryOnceChangeQualifiedDimensionInput
  extends InventoryOnceDimensionChangeInput {
  /** Item-defined extra dimension. */
  readonly dimensionId: string;
  /** New value in that dimension. */
  readonly toValueId: string;
}

/** Inputs for removing one currently present item-defined qualified dimension. */
export interface InventoryOnceClearQualifiedDimensionInput
  extends InventoryOnceDimensionChangeInput {
  /** Item-defined extra dimension to remove. */
  readonly dimensionId: string;
}

/** Shared fields for one explicit traceability relation change. */
export interface InventoryOnceRelationInput extends InventoryCommandHeader {
  /** Child/subject/transformation-input node. */
  readonly from: InventoryTraceabilityNodeRef;
  /** Parent/object/transformation-output node. */
  readonly to: InventoryTraceabilityNodeRef;
}

/** One corrected physical-count statement used to derive a count-adjustment replacement. */
export interface InventoryOnceCountAdjustmentReplacementLine {
  /** Exact stock row whose observation was wrong. */
  readonly position: InventoryStockPositionKey;
  /** Stock expected from committed movements through the corrected observation time. */
  readonly expectedAtObservation: InventoryMeasurementVector;
  /** Correct physical measurements that should have been observed. */
  readonly observed: InventoryMeasurementVector;
}

/** Declarative replacement for one retained count discrepancy event. */
export interface InventoryOnceCountAdjustmentReplacementInput
  extends Omit<InventoryCommandHeader, "operationId"> {
  /** Correct expected/observed rows; InventoryOnce derives signed discrepancy effects. */
  readonly lines: readonly InventoryOnceCountAdjustmentReplacementLine[];
}

/** Opaque replacement assertion returned by the declarative correction planner. */
export interface InventoryOnceReplacementPlan {
  /** Human-readable event kind or omit marker without exposing journal internals. */
  readonly kind: InventoryEventKind | "omit";
}

/** Planner passed into a correction callback so replacements use the same normal verbs. */
export interface InventoryOnceReplacementPlans {
  /** Say the retained root assertion never happened; correction derives its exact inverse. */
  omit(): InventoryOnceReplacementPlan;
  /** Plan a replacement opening/migration assertion. */
  opening(
    input: InventoryOnceOpeningReplacementInput
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement receipt assertion. */
  receive(
    input: Omit<InventoryOnceReceiveInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement issue assertion. */
  issue(
    input: Omit<InventoryOnceIssueInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement direct-placement transfer assertion. */
  transfer(
    input: Omit<InventoryOnceTransferInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement intentional detach without issuing stock. */
  detach(
    input: Omit<InventoryOnceDetachInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement placement/recovery of detached or missing stock. */
  place(
    input: Omit<InventoryOncePlaceInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement missing-stock classification. */
  markMissing(
    input: Omit<InventoryOnceMarkMissingInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement status-only reclassification. */
  changeStatus(
    input: Omit<InventoryOnceChangeStatusInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that clears stock status. */
  clearStatus(
    input: Omit<InventoryOnceClearStatusInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement owner-only reclassification. */
  changeOwner(
    input: Omit<InventoryOnceChangeOwnerInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that clears legal/economic owner. */
  clearOwner(
    input: Omit<InventoryOnceClearOwnerInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement custodian-only reclassification. */
  changeCustodian(
    input: Omit<InventoryOnceChangeCustodianInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that clears custodian/possessor. */
  clearCustodian(
    input: Omit<InventoryOnceClearCustodianInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement disposition-authority-only reclassification. */
  changeDispositionAuthority(
    input: Omit<InventoryOnceChangeDispositionAuthorityInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that clears disposition authority. */
  clearDispositionAuthority(
    input: Omit<InventoryOnceClearDispositionAuthorityInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement item-defined qualified-dimension change. */
  changeQualifiedDimension(
    input: Omit<InventoryOnceChangeQualifiedDimensionInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that removes one qualified dimension. */
  clearQualifiedDimension(
    input: Omit<InventoryOnceClearQualifiedDimensionInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that gives one fungible unit a new serial/embodied-node identity. */
  individualize(
    input: Omit<InventoryOnceIndividualizeInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement that merges one exact serial back into fungible stock. */
  deindividualize(
    input: Omit<InventoryOnceDeindividualizeInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement atomic conserved split/merge/reclassification. */
  reclassifyMany(
    input: Omit<InventoryOnceReclassifyManyInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Replace an earlier prospective definition transition using one previously reviewed exact plan. */
  revisionTransition(
    input: Omit<InventoryOnceTransitionRevisionInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement pack assertion. */
  pack(
    input: Omit<InventoryOncePackInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement unpack assertion. */
  unpack(
    input: Omit<InventoryOnceUnpackInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement transformation assertion. */
  transform(
    input: Omit<InventoryOnceTransformationInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement scrap assertion. */
  scrap(
    input: Omit<InventoryOnceScrapInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement standalone placement-node metadata assertion. */
  placementNodeMetadata(
    input: Omit<InventoryOnceDefinePlacementNodeInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement standalone lot-metadata assertion. */
  lotMetadata(
    input: Omit<InventoryOnceDefineLotInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement physical-count discrepancy from corrected expected/observed rows. */
  countAdjustment(
    input: InventoryOnceCountAdjustmentReplacementInput
  ): InventoryOnceReplacementPlan;
  /** Plan one exact replacement direct-parent transition. */
  placement(
    input: Omit<CreateInventoryPlacementInput, "catalog" | "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement association add. */
  associate(
    input: Omit<InventoryOnceRelationInput, "operationId">
  ): InventoryOnceReplacementPlan;
  /** Plan a replacement association removal. */
  disassociate(
    input: Omit<InventoryOnceRelationInput, "operationId">
  ): InventoryOnceReplacementPlan;
}

/** Inputs for append-only correction/supersession of one retained root event. */
export interface InventoryOnceCorrectInput extends InventoryCommandHeader {
  /** Root event whose current assertion is wrong/incomplete. */
  readonly correctsEventId: string;
  /** Declarative replacement built from normal stock verbs. */
  readonly replaceWith: (
    plans: InventoryOnceReplacementPlans
  ) => InventoryOnceReplacementPlan;
}

/** Valid side-effect-free correction preview against one exact published revision. */
export interface InventoryOnceValidCorrectionPlan {
  /** Discriminator proving this plan reached one coherent corrected history. */
  readonly valid: true;
  /** Published world revision from which the plan was derived. */
  readonly basedOnWorldRevision: number;
  /** Exact uncommitted correction event that normal `stock.correct` would publish. */
  readonly event: InventoryEventDraft;
  /** Typed replay consequences retained on the correction event. */
  readonly impact: InventoryHistoricalImpact;
}

/** Side-effect-free correction preview whose historical replay is not coherent. */
export interface InventoryOnceInvalidCorrectionPlan {
  /** Discriminator proving nothing can be committed from this result. */
  readonly valid: false;
  /** Published world revision from which the conflict was derived. */
  readonly basedOnWorldRevision: number;
  /** Structured exact replay failure. */
  readonly conflict: InventoryHistoricalReplayConflict;
}

/** Side-effect-free correction planning result. */
export type InventoryOnceCorrectionPlan =
  | InventoryOnceValidCorrectionPlan
  | InventoryOnceInvalidCorrectionPlan;

/** Historical physical-verb planner plus safe references to prior bundle assertions.
 * Prospective item-revision transitions are intentionally excluded from late-history assertions.
 */
export type InventoryOnceHistoricalAssertionPlans = Omit<
  InventoryOnceReplacementPlans,
  "revisionTransition"
> & {
  /** Read one prior assertion's exact consumed/source position by negative-effect order. */
  inputOf(assertionId: string, index?: number): InventoryStockPositionInput;
  /** Read one prior assertion's exact produced/destination position by positive-effect order. */
  outputOf(assertionId: string, index?: number): InventoryStockPositionInput;
};

/** One stable ordinary assertion to insert into effective physical history. */
export interface InventoryOnceHistoricalAssertionInput {
  /** Stable identity used for audit and later append-only omission/replacement. */
  readonly assertionId: string;
  /** Optional retained/effective event after which this assertion must replay. */
  readonly afterEventId?: string;
  /** Build one ordinary assertion from the existing correction-plan verbs. */
  readonly assert: (
    plans: InventoryOnceHistoricalAssertionPlans
  ) => InventoryOnceReplacementPlan;
}

/** Inputs for one atomic append-only late-history repair bundle. */
export interface InventoryOnceHistoricalRepairInput extends InventoryCommandHeader {
  /** Late assertions that must become coherent together. */
  readonly assertions: readonly InventoryOnceHistoricalAssertionInput[];
  /** Earlier embedded assertion identities removed from latest effective history. */
  readonly omittedAssertionIds?: readonly string[];
}

/** Coherent side-effect-free late-history repair plan. */
export interface InventoryOnceValidHistoricalRepairPlan {
  /** Discriminator proving this bundle replays coherently. */
  readonly valid: true;
  /** Published world revision against which the bundle was planned. */
  readonly basedOnWorldRevision: number;
  /** Exact uncommitted repair envelope. */
  readonly event: InventoryEventDraft;
  /** Typed affected-event and historical-deficit consequences. */
  readonly impact: InventoryHistoricalImpact;
}

/** Late-history repair plan that cannot be coherently replayed. */
export interface InventoryOnceInvalidHistoricalRepairPlan {
  /** Discriminator proving this bundle cannot be committed. */
  readonly valid: false;
  /** Published world revision against which the conflict was derived. */
  readonly basedOnWorldRevision: number;
  /** Structured deterministic replay failure. */
  readonly conflict: InventoryHistoricalReplayConflict;
}

/** Side-effect-free atomic late-history repair result. */
export type InventoryOnceHistoricalRepairPlan =
  | InventoryOnceValidHistoricalRepairPlan
  | InventoryOnceInvalidHistoricalRepairPlan;

/** Inputs for creating one broad/exact inventory reservation. */
export type InventoryOnceReserveInput = NewInventoryReservation;

/** Inputs for narrowing one active reservation scope. */
export interface InventoryOnceRefineReservationInput {
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being narrowed. */
  readonly reservationId: string;
  /** New no-broader eligible-stock scope. */
  readonly selector: InventoryStockSelector;
  /** Lifecycle occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Inputs for binding one reservation to exact positions. */
export interface InventoryOnceAllocateReservationInput {
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being allocated. */
  readonly reservationId: string;
  /** Exact position quantities totaling the request. */
  readonly allocations: readonly InventoryReservationAllocation[];
  /** Lifecycle occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Inputs for binding one claim by native FIFO/FEFO selection. */
export interface InventoryOnceAllocateReservationByPolicyInput {
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being allocated/reallocated. */
  readonly reservationId: string;
  /** Lifecycle operation occurrence/selection time. */
  readonly occurredAtEpochMs: number;
  /** FIFO or FEFO ordering used to choose exact positions. */
  readonly method: InventoryAllocationPolicyRequest["method"];
  /** Explicit override permitting expired lots in the allocation. */
  readonly allowExpiredLots?: boolean;
}

/** Inputs for releasing/expiring one reservation. */
export interface InventoryOnceCloseReservationInput {
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being closed. */
  readonly reservationId: string;
  /** Lifecycle occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** One exact measured fulfillment line for consuming an allocated reservation. */
export interface InventoryReservationFulfillmentLine {
  /** Exact allocated source position. */
  readonly from: InventoryStockPositionKey;
  /** Exact amount actually issued, including required independent measurements. */
  readonly amount: InventoryAmount;
}

/** Inputs for atomically issuing stock and consuming one allocated reservation. */
export interface InventoryOnceConsumeReservationInput
  extends InventoryCommandHeader {
  /** Reservation being fulfilled. */
  readonly reservationId: string;
  /** Exact measured issue lines; reservation-axis totals must match allocations exactly. */
  readonly fulfillment: readonly InventoryReservationFulfillmentLine[];
}

/** Inputs for consuming the current exact reservation allocation directly. */
export interface InventoryOnceConsumeAllocatedReservationInput
  extends InventoryCommandHeader {
  /** Active allocated reservation being fulfilled exactly. */
  readonly reservationId: string;
}

/** Inputs for one complete movement-safe absolute count of one exact physical bucket. */
export interface InventoryOnceReplaceAbsoluteCountInput {
  /** Stable identity of the retained physical-count row. */
  readonly countId: string;
  /** Stable identity for the complete start/observe/reconcile command. */
  readonly operationId: string;
  /** Optional exact item revision; omitted means freeze the active revision on first use. */
  readonly itemRevisionId?: string;
  /** Candidate scope that must currently resolve to at most one non-zero exact position. */
  readonly selector: InventoryStockSelector;
  /** Exact observed measurements; omission means the selected bucket was observed as zero. */
  readonly observedMeasurements?: InventoryMeasurementVector;
  /** Exact bucket used when the candidate scope currently contains no non-zero position. */
  readonly positionWhenEmpty?: InventoryStockPositionKey;
  /** Time the immediate count, observation, and approval physically occurred. */
  readonly occurredAtEpochMs: number;
  /** Actor responsible for and approving the count. */
  readonly actorId?: PartyId;
  /** Application/source row requesting this replacement. */
  readonly sourceReference?: string;
  /** Human reason for the discrepancy reconciliation. */
  readonly reason?: string;
  /** Extra application facts that do not change count math. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for opening one movement-safe physical count. */
export interface InventoryOnceStartCountInput {
  /** Stable count identity. */
  readonly countId: string;
  /** Stable creation retry identity. */
  readonly operationId: string;
  /** Optional exact item revision; defaults to selector item's active revision. */
  readonly itemRevisionId?: string;
  /** Complete stock scope staff promise to observe. */
  readonly selector: InventoryStockSelector;
  /** Time count work started. */
  readonly startedAtEpochMs: number;
  /** Actor responsible for the count. */
  readonly actorId?: PartyId;
  /** Application/source row requesting this count. */
  readonly sourceReference?: string;
  /** Extra application metadata. */
  readonly metadata?: NewInventoryReservation["metadata"];
}

/** Inputs for recording one complete physical-count observation. */
export interface InventoryOnceObserveCountInput {
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Started count being observed. */
  readonly countId: string;
  /** Time physical observation completed. */
  readonly observedAtEpochMs: number;
  /** Complete non-zero observed rows; omitted eligible rows mean observed zero. */
  readonly observations: readonly InventoryCountObservationLine[];
}

/** Inputs for reconciling one observed count without erasing later movements. */
export interface InventoryOnceReconcileCountInput {
  /** Stable completion/reconciliation retry identity. */
  readonly operationId: string;
  /** Observed count being completed. */
  readonly countId: string;
  /** Time reconciliation was approved/recorded. */
  readonly completedAtEpochMs: number;
  /** Optional actor approving reconciliation. */
  readonly actorId?: PartyId;
  /** Optional human reason for discrepancy adjustment. */
  readonly reason?: string;
}

/** Inputs for abandoning one non-terminal count. */
export type InventoryOnceAbandonCountInput = Omit<
  AbandonInventoryCountInput,
  "book"
>;

/** Retained item/form/package definition read and publication surface. */
export interface InventoryOnceCatalogApi {
  /** Read one exact retained item/form revision. */
  itemRevision(revisionId: string): Promise<InventoryItemDefinitionRevision>;
  /** Read the current active item/form revision for one stable item identity. */
  activeItem(itemId: string): Promise<InventoryItemDefinitionRevision>;
  /** List every retained item/form revision for one stable item identity. */
  itemRevisionsForItem(
    itemId: string
  ): Promise<readonly InventoryItemDefinitionRevision[]>;
  /** Publish this façade's complete retained catalogue as append-only durable definition truth. */
  publish(
    input: InventoryOncePublishCatalogInput
  ): Promise<InventoryOnceEventResult>;
}

/** Revision-frozen heterogeneous composition read/open surface. */
export interface InventoryOnceCompositionsApi {
  /** Read one exact retained composition revision. */
  definition(
    revisionId: InventoryCompositionRevisionId
  ): Promise<InventoryCompositionDefinitionRevision>;
  /** Read the current active revision for one stable composition identity. */
  activeDefinition(
    compositionId: InventoryCompositionId
  ): Promise<InventoryCompositionDefinitionRevision>;
  /** Read the exact composition attached to one immutable source package revision. */
  forSourcePackagingRevision(
    packagingRevisionId: string
  ): Promise<InventoryCompositionDefinitionRevision>;
  /** Atomically consume whole exact source packages and produce their frozen output vectors. */
  open(
    input: InventoryOnceOpenCompositionInput
  ): Promise<InventoryOnceEventResult>;
}

/** One exact transformation input line checked against current physical stock. */
export interface InventoryOnceTransformationInputPlan {
  /** Stable line identity from the frozen transformation definition. */
  readonly lineId: string;
  /** Exact item/form revision required by this line. */
  readonly itemRevisionId: string;
  /** Exact selector used to inspect current physical stock for this line. */
  readonly selector: InventoryStockSelector;
  /** Exact required amount from the transformation definition. */
  readonly required: InventoryMeasurementVector;
  /** Exact positive physical stock currently available under the selector. */
  readonly available: InventoryMeasurementVector;
  /** Current exact positions contributing to `available`. */
  readonly positions: readonly InventoryStockPosition[];
  /** True when every required measurement axis is currently available. */
  readonly sufficient: boolean;
}

/** Read-only plan proving whether one frozen transformation definition can run from current stock. */
export interface InventoryOnceTransformationPlan {
  /** Exact immutable definition revision being previewed. */
  readonly definition: InventoryTransformationDefinitionRevision;
  /** Current world revision used for every input check. */
  readonly worldRevision: number;
  /** Exact checked input lines. */
  readonly inputs: readonly InventoryOnceTransformationInputPlan[];
  /** Frozen outputs the definition says one execution produces. */
  readonly outputs: InventoryTransformationDefinitionRevision["outputs"];
  /** True only when every input line has enough current physical stock. */
  readonly applicable: boolean;
}

/** Inputs for previewing a transformation against current stock without writing. */
export interface InventoryOncePlanTransformationDefinitionInput {
  /** Exact immutable transformation definition revision to preview. */
  readonly transformationRevisionId: InventoryTransformationRevisionId;
  /** Optional exact selector override for each input line, keyed by line id. */
  readonly selectorsByInputLine?: Readonly<
    Record<string, InventoryStockSelector>
  >;
}

/** Revision-frozen reusable physical transformation definition/query surface. */
export interface InventoryOnceTransformationsApi {
  /** Read one exact historical/current transformation definition revision. */
  definition(
    revisionId: InventoryTransformationRevisionId
  ): Promise<InventoryTransformationDefinitionRevision>;
  /** Read the current active revision for one stable transformation identity. */
  activeDefinition(
    transformationId: InventoryTransformationId
  ): Promise<InventoryTransformationDefinitionRevision>;
  /** List every retained definition revision touching one stable item identity. */
  definitionsForItem(
    itemId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]>;
  /** List current active definitions consuming one exact item/form revision. */
  fromRevision(
    itemRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]>;
  /** List current active definitions producing one exact item/form revision. */
  toRevision(
    itemRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]>;
  /** List current active definitions connecting one exact input/output revision pair. */
  betweenRevisions(
    fromRevisionId: string,
    toRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]>;
  /** Preview current applicability and exact source quantities without writing inventory. */
  plan(
    input: InventoryOncePlanTransformationDefinitionInput
  ): Promise<InventoryOnceTransformationPlan>;
}

/** Revision-frozen read-only collection/taxonomy surface. */
export interface InventoryOnceCollectionsApi {
  /** Read one exact retained collection revision. */
  definition(
    revisionId: InventoryCollectionRevisionId
  ): Promise<InventoryCollectionDefinitionRevision>;
  /** Read the current active revision for one stable collection identity. */
  activeDefinition(
    collectionId: InventoryCollectionId
  ): Promise<InventoryCollectionDefinitionRevision>;
  /** Summarize exact member identities and only explicitly declared scalar roll-ups. */
  summary(
    input: InventoryOnceCollectionSummaryInput
  ): Promise<InventoryCollectionSummary>;
}

/** Revision-frozen mutual-fungibility read and movement surface. */
export interface InventoryOnceFungibilityApi {
  /** Read one exact retained pool revision. */
  definition(
    revisionId: InventoryFungibilityRevisionId
  ): Promise<InventoryFungibilityPoolDefinitionRevision>;
  /** Read the current active revision for one stable pool identity. */
  activeDefinition(
    poolId: InventoryFungibilityPoolId
  ): Promise<InventoryFungibilityPoolDefinitionRevision>;
  /** Summarize exact member stock in one common basis without merging item identity. */
  summary(
    input: InventoryOnceFungibilitySummaryInput
  ): Promise<InventoryFungibilitySummary>;
  /** Preview exact member lines selected for one common-basis request. */
  plan(
    input: InventoryOncePlanFungibilityInput
  ): Promise<InventoryFungibilityAllocationPlan>;
  /** Issue/dispense exact selected members while retaining their real item identities. */
  issue(
    input: InventoryOnceIssueFungibleInput
  ): Promise<InventoryOnceEventResult>;
  /** Transfer exact selected members while retaining package/lot/item identity. */
  transfer(
    input: InventoryOnceTransferFungibleInput
  ): Promise<InventoryOnceEventResult>;
  /** Scrap exact selected members under one explicit physical-truth reason. */
  scrap(
    input: InventoryOnceScrapFungibleInput
  ): Promise<InventoryOnceEventResult>;
}

/** Declarative resource/physical-stock command surface. */
export interface InventoryOnceStockApi {
  /** Receive stock from outside this inventory world. */
  receive(input: InventoryOnceReceiveInput): Promise<InventoryOnceEventResult>;
  /** Receive several exact item/lot/package lines as one immutable physical fact. */
  receiveMany(
    input: InventoryOnceReceiveManyInput
  ): Promise<InventoryOnceEventResult>;
  /** Issue/dispense stock out of this inventory world. */
  issue(input: InventoryOnceIssueInput): Promise<InventoryOnceEventResult>;
  /** Issue several exact positions as one immutable physical fact. */
  issueMany(
    input: InventoryOnceIssueManyInput
  ): Promise<InventoryOnceEventResult>;
  /** Select FIFO/FEFO positions and issue them atomically, failing on shortfall. */
  issueByPolicy(
    input: InventoryOnceIssueByPolicyInput
  ): Promise<InventoryOnceEventResult>;
  /** Plan several identified FIFO/FEFO requests against one world and issue one atomic event. */
  issueManyByPolicy(
    input: InventoryOnceIssueManyByPolicyInput
  ): Promise<InventoryOncePolicyBatchResult>;
  /** Intentionally detach stock from a known placement while keeping it conserved inventory. */
  detach(input: InventoryOnceDetachInput): Promise<InventoryOnceEventResult>;
  /** Place or recover detached/missing stock at one known direct placement node. */
  place(input: InventoryOncePlaceInput): Promise<InventoryOnceEventResult>;
  /** Mark placed or detached stock genuinely missing without destroying quantity. */
  markMissing(
    input: InventoryOnceMarkMissingInput
  ): Promise<InventoryOnceEventResult>;
  /** Move unchanged stock to another direct placement while preserving every other dimension. */
  transfer(
    input: InventoryOnceTransferInput
  ): Promise<InventoryOnceEventResult>;
  /** Move several exact positions as one conserved immutable transfer fact. */
  transferMany(
    input: InventoryOnceTransferManyInput
  ): Promise<InventoryOnceEventResult>;
  /** Select FIFO/FEFO positions from one source placement and transfer them atomically. */
  transferByPolicy(
    input: InventoryOnceTransferByPolicyInput
  ): Promise<InventoryOnceEventResult>;
  /** Plan several identified FIFO/FEFO requests and publish one conserved transfer event. */
  transferManyByPolicy(
    input: InventoryOnceTransferManyByPolicyInput
  ): Promise<InventoryOncePolicyBatchResult>;
  /** Change only status/disposition. */
  changeStatus(
    input: InventoryOnceChangeStatusInput
  ): Promise<InventoryOnceEventResult>;
  /** Clear only status/disposition. */
  clearStatus(
    input: InventoryOnceClearStatusInput
  ): Promise<InventoryOnceEventResult>;
  /** Change only legal/economic ownership. */
  changeOwner(
    input: InventoryOnceChangeOwnerInput
  ): Promise<InventoryOnceEventResult>;
  /** Clear only legal/economic ownership. */
  clearOwner(
    input: InventoryOnceClearOwnerInput
  ): Promise<InventoryOnceEventResult>;
  /** Change only physical custody/possession. */
  changeCustodian(
    input: InventoryOnceChangeCustodianInput
  ): Promise<InventoryOnceEventResult>;
  /** Clear only physical custody/possession. */
  clearCustodian(
    input: InventoryOnceClearCustodianInput
  ): Promise<InventoryOnceEventResult>;
  /** Change only disposition authority. */
  changeDispositionAuthority(
    input: InventoryOnceChangeDispositionAuthorityInput
  ): Promise<InventoryOnceEventResult>;
  /** Clear only disposition authority. */
  clearDispositionAuthority(
    input: InventoryOnceClearDispositionAuthorityInput
  ): Promise<InventoryOnceEventResult>;
  /** Set one explicitly item-defined extra dimension. */
  changeQualifiedDimension(
    input: InventoryOnceChangeQualifiedDimensionInput
  ): Promise<InventoryOnceEventResult>;
  /** Remove one item-defined extra dimension. */
  clearQualifiedDimension(
    input: InventoryOnceClearQualifiedDimensionInput
  ): Promise<InventoryOnceEventResult>;
  /** Split one exact fungible unit into a serial identity and optional embodied node. */
  individualize(
    input: InventoryOnceIndividualizeInput
  ): Promise<InventoryOnceEventResult>;
  /** Merge one exact serialized unit back into fungible stock after dependencies are empty. */
  deindividualize(
    input: InventoryOnceDeindividualizeInput
  ): Promise<InventoryOnceEventResult>;
  /** Atomically split, merge, relot, replace direct placement, or otherwise reclassify conserved stock. */
  reclassifyMany(
    input: InventoryOnceReclassifyManyInput
  ): Promise<InventoryOnceEventResult>;
  /** Preview a prospective stock-definition transition without modifying stock or definitions. */
  planRevisionTransition(
    request: InventoryRevisionTransitionRequest
  ): Promise<InventoryRevisionTransitionPlan>;
  /** Atomically apply a reviewed exact world-fenced definition transition as a distinct accounting fact. */
  transitionRevision(
    input: InventoryOnceTransitionRevisionInput
  ): Promise<InventoryOnceEventResult>;
  /** Convert loose/inner stock into exact intact package stock. */
  pack(input: InventoryOncePackInput): Promise<InventoryOnceEventResult>;
  /** Convert intact package stock into loose/inner stock. */
  unpack(input: InventoryOnceUnpackInput): Promise<InventoryOnceEventResult>;
  /** Atomically consume inputs, produce outputs, and preserve optional complete genealogy. */
  transform(
    input: InventoryOnceTransformationInput
  ): Promise<InventoryOnceEventResult>;
  /** Explicitly destroy/discard stock with a reason. */
  scrap(input: InventoryOnceScrapInput): Promise<InventoryOnceEventResult>;
  /** Explicitly destroy several exact positions under one reason/fact. */
  scrapMany(
    input: InventoryOnceScrapManyInput
  ): Promise<InventoryOnceEventResult>;
  /** Select FIFO/FEFO positions and record their physical destruction atomically. */
  scrapByPolicy(
    input: InventoryOnceScrapByPolicyInput
  ): Promise<InventoryOnceEventResult>;
  /** Plan one atomic late-history assertion bundle without writing inventory truth. */
  planHistorical(
    input: InventoryOnceHistoricalRepairInput
  ): Promise<InventoryOnceHistoricalRepairPlan>;
  /** Append one atomic late-history assertion bundle after replanning current truth. */
  recordHistorical(
    input: InventoryOnceHistoricalRepairInput
  ): Promise<InventoryOnceEventResult>;
  /** Plan one correction against the current world without writing inventory truth. */
  planCorrection(
    input: InventoryOnceCorrectInput
  ): Promise<InventoryOnceCorrectionPlan>;
  /** Append/supersede one correction using a normal declarative replacement plan. */
  correct(input: InventoryOnceCorrectInput): Promise<InventoryOnceEventResult>;
}

/** Generic placement topology plus explicit subtree-content command surface. */
export interface InventoryOncePlacementApi {
  /** Move one node beneath another; descendants resolve through the new ancestry automatically. */
  move(input: InventoryOnceMovePlacementInput): Promise<InventoryOnceEventResult>;
  /** Remove one node from its direct parent without rewriting descendants. */
  unplace(input: InventoryOnceUnplaceInput): Promise<InventoryOnceEventResult>;
  /** Move every direct stock row and direct child node into one destination atomically. */
  moveContents(
    input: InventoryOnceMovePlacementContentsInput
  ): Promise<InventoryOnceEventResult>;
  /** Issue every current direct/nested stock row as one immutable physical fact. */
  issueContents(
    input: InventoryOnceIssuePlacementContentsInput
  ): Promise<InventoryOnceEventResult>;
  /** Destroy every current direct/nested stock row under one explicit reason. */
  scrapContents(
    input: InventoryOnceScrapPlacementContentsInput
  ): Promise<InventoryOnceEventResult>;
  /** Apply one status to every direct/nested stock row while preserving other fields. */
  changeContentsStatus(
    input: InventoryOnceChangePlacementContentsStatusInput
  ): Promise<InventoryOnceEventResult>;
  /** Clear status from every direct/nested stock row while preserving other fields. */
  clearContentsStatus(
    input: InventoryOnceClearPlacementContentsStatusInput
  ): Promise<InventoryOnceEventResult>;
  /** Assert exact generic node category/policy/identifier/use-by metadata. */
  define(
    input: InventoryOnceDefinePlacementNodeInput
  ): Promise<InventoryOnceEventResult>;
  /** Correct/omit/restore current placement-node metadata append-only. */
  correct(
    input: InventoryOnceCorrectPlacementNodeInput
  ): Promise<InventoryOnceEventResult>;
}

/** Lot/batch metadata command surface; quantity changes remain stock/count commands. */
export interface InventoryOnceLotsApi {
  /** Assert lot metadata without changing physical quantity. Conflicting assertions require correction. */
  define(input: InventoryOnceDefineLotInput): Promise<InventoryOnceEventResult>;
  /** Correct current lot metadata append-only while retaining the root assertion/history. */
  correct(
    input: InventoryOnceCorrectLotInput
  ): Promise<InventoryOnceEventResult>;
}

/** First-class time-separated physical transfer lifecycle. */
export interface InventoryOnceTransfersApi {
  /** Commit exact source stock to one transfer identity without moving it yet. */
  prepare(
    input: InventoryOncePrepareTransferInput
  ): Promise<InventoryOnceTransferResult>;
  /** Move the complete prepared transfer into real conserved transit stock. */
  dispatch(
    input: InventoryOnceDispatchTransferInput
  ): Promise<InventoryOnceTransferResult>;
  /** Receive only this transfer's dispatched stock, partially or completely. */
  receive(
    input: InventoryOnceReceiveTransferInput
  ): Promise<InventoryOnceTransferResult>;
  /** Release a prepared-but-not-dispatched commitment. */
  release(
    input: InventoryOnceReleaseTransferInput
  ): Promise<InventoryOnceTransferResult>;
  /** Read current lifecycle truth by exact transfer identity. */
  find(
    input: InventoryOnceFindTransferInput
  ): Promise<InventoryTransfer | undefined>;
}

/** Declarative reservation/claim command surface. */
export interface InventoryOnceReservationsApi {
  /** Create one broad/exact globally feasible claim. */
  reserve(
    input: InventoryOnceReserveInput
  ): Promise<InventoryOnceReservationResult>;
  /** Narrow one active claim's eligible scope. */
  refine(
    input: InventoryOnceRefineReservationInput
  ): Promise<InventoryOnceReservationResult>;
  /** Bind one claim to exact stock positions. */
  allocate(
    input: InventoryOnceAllocateReservationInput
  ): Promise<InventoryOnceReservationResult>;
  /** Bind one claim using native FIFO/FEFO selection. */
  allocateByPolicy(
    input: InventoryOnceAllocateReservationByPolicyInput
  ): Promise<InventoryOnceReservationResult>;
  /** Release one active claim without changing physical stock. */
  release(
    input: InventoryOnceCloseReservationInput
  ): Promise<InventoryOnceReservationResult>;
  /** Durably expire one active claim after its configured time. */
  expire(
    input: InventoryOnceCloseReservationInput
  ): Promise<InventoryOnceReservationResult>;
  /** Atomically issue exact measured stock and consume one allocated claim. */
  consume(
    input: InventoryOnceConsumeReservationInput
  ): Promise<InventoryOnceReservationResult>;
  /** Atomically issue the current exact allocation and consume its claim. */
  consumeAllocated(
    input: InventoryOnceConsumeAllocatedReservationInput
  ): Promise<InventoryOnceReservationResult>;
}

/** Movement-safe physical-count command surface. */
export interface InventoryOnceCountsApi {
  /** Replace one exact bucket through the normal movement-safe count lifecycle. */
  replaceAbsolute(
    input: InventoryOnceReplaceAbsoluteCountInput
  ): Promise<InventoryOnceCountResult>;
  /** Open one count snapshot at the current durable event sequence. */
  start(input: InventoryOnceStartCountInput): Promise<InventoryOnceCountResult>;
  /** Record one complete physical observation without changing stock. */
  observe(
    input: InventoryOnceObserveCountInput
  ): Promise<InventoryOnceCountResult>;
  /** Reconcile only the discrepancy that existed at observation time. */
  reconcile(
    input: InventoryOnceReconcileCountInput
  ): Promise<InventoryOnceCountResult>;
  /** Abandon one non-terminal count without changing stock. */
  abandon(
    input: InventoryOnceAbandonCountInput
  ): Promise<InventoryOnceCountResult>;
}

/** Explicit association graph command surface; genealogy comes from transformations. */
export interface InventoryOnceTraceabilityApi {
  /** Add one durable association/installation relationship. */
  associate(
    input: InventoryOnceRelationInput
  ): Promise<InventoryOnceEventResult>;
  /** Remove one reversible association/installation relationship. */
  disassociate(
    input: InventoryOnceRelationInput
  ): Promise<InventoryOnceEventResult>;
}

/** Cross-item query for current stock whose physical placement is unresolved. */
export interface InventoryOnceWhereaboutsQuery {
  /** Optional item identities; omission searches every current item. */
  readonly itemIds?: readonly string[];
  /** Optional detached/missing states; omission searches both unresolved states. */
  readonly states?: readonly InventoryStockWhereaboutsState[];
  /** Optional exact lifecycle/cohort identities. */
  readonly whereaboutsIds?: readonly string[];
  /** Optional last-known direct placement nodes. */
  readonly lastPlacementNodeIds?: readonly string[];
  /** Return only stock detached at or before this time. */
  readonly detachedBeforeEpochMs?: number;
  /** Return only missing stock marked missing at or before this time. */
  readonly missingBeforeEpochMs?: number;
}

/** Immutable public read surface bound to one fully published InventoryOnce world. */
export interface InventoryOnceReadSnapshotApi {
  /** Exact published world revision backing every method on this snapshot. */
  readonly worldRevision: number;
  /** Read current positions matching one broad selector. */
  positions(
    selector: InventoryStockSelector
  ): ReturnType<typeof findInventoryPositions>;
  /** Read current detached/missing lifecycles with originating event provenance. */
  whereabouts(
    input?: InventoryOnceWhereaboutsQuery
  ): readonly InventoryWhereaboutsLifecycle[];
  /** Read current and resolved whereabouts lifecycles with append-only event history. */
  whereaboutsHistory(
    input?: InventoryWhereaboutsHistoryQuery
  ): readonly InventoryWhereaboutsLifecycle[];
  /** Query retained events from this exact published snapshot in durable order. */
  events(input?: InventoryEventQuery): InventoryEventPage;
  /** Read one revision-safe physical summary from this exact snapshot. */
  summary(selector: InventoryStockSelector): InventoryStockSummary;
  /** Read claim-aware physical and expiry availability from this exact snapshot. */
  availability(
    selector: InventoryStockSelector,
    atEpochMs?: number
  ): InventoryAvailabilitySummary;
  /** Preview native FIFO/FEFO lines against this exact snapshot. */
  planAllocation(
    input: InventoryOncePlanAllocationInput
  ): InventoryPolicyAllocationPlan;
  /** List exact retained package revisions for one item/revision. */
  packagingRevisions(
    input: Omit<ListInventoryPackagingRevisionsInput, "catalog">
  ): ReturnType<typeof listInventoryPackagingRevisions>;
  /** Read one current placement-node metadata master by exact identity. */
  placementNode(
    nodeId: string
  ): InventoryProjectedPlacementNodeDefinition | undefined;
  /** List current placement-node metadata masters in deterministic identity order. */
  placementNodes(): readonly InventoryProjectedPlacementNodeDefinition[];
  /** Read one node's direct parent, or undefined when it is unplaced/root. */
  placementParent(nodeId: string): string | undefined;
  /** Read direct children in deterministic identity order. */
  placementChildren(nodeId: string): readonly string[];
  /** Read a node followed by every current direct ancestor. */
  placementAncestry(nodeId: string): readonly string[];
  /** Read one current item-scoped lot/batch master by exact identity. */
  lot(
    itemId: string,
    lotId: string
  ): InventoryProjectedLotDefinition | undefined;
  /** List current lot/batch masters, optionally for one item only. */
  lots(itemId?: string): readonly InventoryProjectedLotDefinition[];
  /** List frozen composition revisions whose source package belongs to one item. */
  compositionRevisionsForItem(
    itemId: string
  ): readonly InventoryCompositionDefinitionRevision[];
  /** Summarize one exact read-only collection revision on this snapshot. */
  collectionSummary(
    input: InventoryOnceCollectionSummaryInput
  ): InventoryCollectionSummary;
  /** Summarize one exact fungibility revision on this snapshot. */
  fungibilitySummary(
    input: InventoryOnceFungibilitySummaryInput
  ): InventoryFungibilitySummary;
  /** Read one committed event by identity. */
  event(eventId: string): InventoryCommittedEvent | undefined;
  /** Read one current reservation by identity. */
  reservation(reservationId: string): InventoryReservation | undefined;
  /** Read one current physical count by identity. */
  count(countId: string): InventoryCount | undefined;
  /** Check current physical stock against claims at one lifecycle time. */
  reservationFeasibility(atEpochMs?: number): InventoryReservationFeasibilityReport;
}

/** Read-only current/history query surface. */
export interface InventoryOnceReadApi {
  /** Freeze one coherent public read surface from exactly one published world. */
  snapshot(): Promise<InventoryOnceReadSnapshotApi>;
  /** Read the latest fully published world revision. */
  world(): Promise<InventoryWorldState>;
  /** Read current positions matching one broad selector. */
  positions(
    selector: InventoryStockSelector
  ): Promise<ReturnType<typeof findInventoryPositions>>;
  /** Read current detached/missing lifecycles with originating event provenance. */
  whereabouts(
    input?: InventoryOnceWhereaboutsQuery
  ): Promise<readonly InventoryWhereaboutsLifecycle[]>;
  /** Read current and resolved whereabouts lifecycles with append-only event history. */
  whereaboutsHistory(
    input?: InventoryWhereaboutsHistoryQuery
  ): Promise<readonly InventoryWhereaboutsLifecycle[]>;
  /** Query retained events through adapter-native indexes when available. */
  events(input?: InventoryEventQuery): Promise<InventoryEventPage>;
  /** Read one revision-safe physical summary with package/lot/direct-placement/status/party breakdowns. */
  summary(selector: InventoryStockSelector): Promise<InventoryStockSummary>;
  /** Read the full published world to report physical availability and global claim feasibility. */
  availability(
    selector: InventoryStockSelector,
    atEpochMs?: number
  ): Promise<InventoryAvailabilitySummary>;
  /** Preview exact native FIFO/FEFO source lines without writing inventory truth. */
  planAllocation(
    input: InventoryOncePlanAllocationInput
  ): Promise<InventoryPolicyAllocationPlan>;
  /** List exact retained package revisions for one item, optionally constrained to one item revision. */
  packagingRevisions(
    input: Omit<ListInventoryPackagingRevisionsInput, "catalog">
  ): Promise<ReturnType<typeof listInventoryPackagingRevisions>>;
  /** Read one current placement-node metadata master by exact identity. */
  placementNode(
    nodeId: string
  ): Promise<InventoryProjectedPlacementNodeDefinition | undefined>;
  /** List current placement-node metadata masters in deterministic identity order. */
  placementNodes(): Promise<readonly InventoryProjectedPlacementNodeDefinition[]>;
  /** Read one node's direct parent, or undefined when it is unplaced/root. */
  placementParent(nodeId: string): Promise<string | undefined>;
  /** Read direct children in deterministic identity order. */
  placementChildren(nodeId: string): Promise<readonly string[]>;
  /** Read a node followed by every current direct ancestor. */
  placementAncestry(nodeId: string): Promise<readonly string[]>;
  /** Read one current item-scoped lot/batch master by exact identity. */
  lot(
    itemId: string,
    lotId: string
  ): Promise<InventoryProjectedLotDefinition | undefined>;
  /** List current lot/batch masters, optionally for one item only. */
  lots(itemId?: string): Promise<readonly InventoryProjectedLotDefinition[]>;
  /** Read one committed event by identity. */
  event(eventId: string): Promise<InventoryCommittedEvent | undefined>;
  /** Read one current reservation by identity. */
  reservation(reservationId: string): Promise<InventoryReservation | undefined>;
  /** Read one current physical count by identity. */
  count(countId: string): Promise<InventoryCount | undefined>;
  /** Check current physical stock against claims active now or at one supplied lifecycle time. */
  reservationFeasibility(
    atEpochMs?: number
  ): Promise<InventoryReservationFeasibilityReport>;
}

/** Application-facing InventoryOnce authority with small verb-grouped APIs. */
export class InventoryOnce {
  /** Retained item/package definition publication commands. */
  readonly catalog: InventoryOnceCatalogApi;
  /** Revision-frozen heterogeneous composition reads and openings. */
  readonly compositions: InventoryOnceCompositionsApi;
  /** Revision-frozen reusable physical transformation definitions and previews. */
  readonly transformations: InventoryOnceTransformationsApi;
  /** Revision-frozen read-only collection/taxonomy views. */
  readonly collections: InventoryOnceCollectionsApi;
  /** Revision-frozen mutual-fungibility reads and movements. */
  readonly fungibility: InventoryOnceFungibilityApi;
  /** Physical resource commands. */
  readonly stock: InventoryOnceStockApi;
  /** Generic physical placement topology and subtree-content commands. */
  readonly placement: InventoryOncePlacementApi;
  /** Lot/batch metadata commands. */
  readonly lots: InventoryOnceLotsApi;
  /** First-class time-separated physical transfer lifecycle. */
  readonly transfers: InventoryOnceTransfersApi;
  /** Reservation/claim commands. */
  readonly reservations: InventoryOnceReservationsApi;
  /** Physical-count commands. */
  readonly counts: InventoryOnceCountsApi;
  /** Association traceability commands. */
  readonly traceability: InventoryOnceTraceabilityApi;
  /** Read-only current/history queries. */
  readonly read: InventoryOnceReadApi;

  /** Build one façade and bind its safe grouped command implementations. */
  constructor(input: CreateInventoryOnceInput) {
    inventoryOnceInternals.set(this, {
      catalog: input.catalog,
      storage: input.storage,
      clock: input.clock ?? systemInventoryClock,
      deficitPolicy: input.deficitPolicy ?? InventoryDeficitPolicy.Reject,
    });
    this.catalog = new InventoryOnceCatalogImplementation(this);
    this.compositions = new InventoryOnceCompositionsImplementation(this);
    this.transformations = new InventoryOnceTransformationsImplementation(this);
    this.collections = new InventoryOnceCollectionsImplementation(this);
    this.fungibility = new InventoryOnceFungibilityImplementation(this);
    this.stock = new InventoryOnceStockImplementation(this);
    this.placement = new InventoryOncePlacementImplementation(this);
    this.lots = new InventoryOnceLotsImplementation(this);
    this.transfers = new InventoryOnceTransfersImplementation(this);
    this.reservations = new InventoryOnceReservationsImplementation(this);
    this.counts = new InventoryOnceCountsImplementation(this);
    this.traceability = new InventoryOnceTraceabilityImplementation(this);
    this.read = new InventoryOnceReadImplementation(this);
  }
}

/** Create one application-facing InventoryOnce authority. */
export function createInventoryOnce(
  input: CreateInventoryOnceInput
): InventoryOnce {
  return new InventoryOnce(input);
}

/** Return private façade configuration or fail when an API object was forged. */
function requireInventoryOnceInternals(
  owner: InventoryOnce
): InventoryOnceInternals {
  const internals = inventoryOnceInternals.get(owner);
  if (internals === undefined)
    throw new Error("Unknown InventoryOnce façade instance.");
  return internals;
}

/** Commit one already-normalized event draft through the durable staged coordinator. */
async function commitInventoryEventDraft(
  owner: InventoryOnce,
  event: InventoryEventDraft,
  validateWorld?: (world: InventoryWorldState) => void
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  if (validateWorld === undefined) {
    const segmented = await commitInventorySegmentedStockEventIfEligible(
      owner,
      event
    );
    if (segmented !== undefined) return segmented;
  }
  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId: event.operationId,
    intentFingerprint: inventoryEventIntentFingerprint(event),
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Freeze this already-built event against the current published world. */
    plan: ({ world }) => {
      validateWorld?.(world);
      return { event };
    },
  });
  return createInventoryOnceEventResult(result);
}

/** Try one simple stock-only event through adapter-native segmented state before whole-world fallback. */
async function commitInventorySegmentedStockEventIfEligible(
  owner: InventoryOnce,
  event: InventoryEventDraft
): Promise<InventoryOnceEventResult | undefined> {
  const internals = requireInventoryOnceInternals(owner);
  if (!inventoryStorageSupportsSegmentedStockEventCommit(internals.storage)) {
    return undefined;
  }
  const recordedAtEpochMs = internals.clock.nowEpochMs();
  const committed = await internals.storage.commitSegmentedStockEvent({
    catalog: inventoryCatalogSnapshot(internals.catalog),
    operationId: event.operationId,
    intentFingerprint: inventoryEventIntentFingerprint(event),
    recordedAtEpochMs,
    deficitPolicy: internals.deficitPolicy,
    event,
  });
  if (committed === undefined) return undefined;
  return {
    receipt: {
      operationId: event.operationId,
      recordedAtEpochMs: committed.recordedAtEpochMs,
      worldRevision: committed.worldRevision,
      eventId: committed.event.eventId,
    },
    event: committed.event,
    replayed: committed.replayed,
  };
}

/**
 * Try one state-dependent correction/repair envelope through adapter-native stock/journal state.
 * Exact world and journal fences make a stale plan decline cleanly to normal coordinator replanning.
 */
async function commitInventorySegmentedHistoricalEventIfEligible(
  owner: InventoryOnce,
  operationId: string,
  intentFingerprint: string,
  planEvent: (
    world: InventoryWorldState,
    recordedAtEpochMs: number
  ) => Promise<InventoryEventDraft>
): Promise<InventoryOnceEventResult | undefined> {
  const internals = requireInventoryOnceInternals(owner);
  if (
    internals.deficitPolicy !== InventoryDeficitPolicy.Reject ||
    !inventoryStorageSupportsSegmentedStockEventCommit(internals.storage)
  ) {
    return undefined;
  }
  // Exact replay/applying recovery remains the generic coordinator's authority.
  if (await internals.storage.readOperation(operationId) !== undefined) {
    return undefined;
  }
  const world = await internals.storage.readWorld();
  assertInventoryCatalogRetainsSnapshot(internals.catalog, world.catalog);
  const recordedAtEpochMs = internals.clock.nowEpochMs();
  const event = await planEvent(world, recordedAtEpochMs);
  const committed = await internals.storage.commitSegmentedStockEvent({
    catalog: inventoryCatalogSnapshot(internals.catalog),
    operationId,
    intentFingerprint,
    recordedAtEpochMs,
    expectedWorldRevision: world.revision,
    expectedRecordSequence: world.projection.lastRecordSequence,
    deficitPolicy: internals.deficitPolicy,
    event,
  });
  if (committed === undefined) return undefined;
  return {
    receipt: {
      operationId,
      recordedAtEpochMs: committed.recordedAtEpochMs,
      worldRevision: committed.worldRevision,
      eventId: committed.event.eventId,
    },
    event: committed.event,
    replayed: committed.replayed,
  };
}

/** Resolve one committed event result from the coordinator's published world/receipt. */
function createInventoryOnceEventResult(
  result: CommitInventoryOperationResult
): InventoryOnceEventResult {
  const eventId = result.receipt.eventId;
  if (eventId === undefined)
    throw new Error("Inventory event command completed without eventId.");
  const event = inventorySparseRecordValue(result.world.projection.events, eventId);
  if (event === undefined)
    throw new Error("Inventory event receipt references missing event.");
  return { receipt: result.receipt, event, replayed: result.replayed };
}

/** Reject transforming one placement node while it remains in a physical parent/child topology. */
function assertTransformationInputsAreDetached(
  world: InventoryWorldState,
  event: InventoryEventDraft
): void {
  const consumedPlacementNodeIds = new Set<string>();
  for (const change of event.traceabilityChanges) {
    if (
      change.action === InventoryTraceabilityRelationAction.Add &&
      change.kind === InventoryTraceabilityRelationKind.Genealogy &&
      change.from.kind === InventoryTraceabilityNodeKind.PlacementNode
    ) {
      consumedPlacementNodeIds.add(change.from.id);
    }
  }
  for (const nodeId of consumedPlacementNodeIds) {
    const parentNodeId = inventoryPlacementParentNodeId(
      world.projection.placement,
      nodeId
    );
    const childNodeIds =
      inventorySparseRecordValue(
        world.projection.placement.childNodeIdsByParentNodeId,
        nodeId
      ) ?? [];
    if (parentNodeId !== undefined || childNodeIds.length > 0) {
      throw new Error(
        "Transformation placement-node input must be unplaced and have no child nodes before it can be consumed."
      );
    }
  }
}

/** Commit one state-dependent transfer lifecycle transition through normal durable publication. */
async function commitInventoryTransferOperation(
  owner: InventoryOnce,
  operationId: string,
  intentFingerprint: string,
  transferId: string,
  planEvent: (world: InventoryWorldState) => InventoryEventDraft
): Promise<InventoryOnceTransferResult> {
  const internals = requireInventoryOnceInternals(owner);
  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId,
    intentFingerprint,
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Retain the claim rules for the explicit prepare/dispatch/receive workflow. */
    plan: ({
      world,
    }) => ({
      event: planEvent(world),
      reservationProtection: InventoryReservationProtection.ProtectClaims,
    }),
  });
  const event = result.event;
  if (event === undefined)
    throw new Error("Inventory transfer operation completed without an event.");
  const transfer = inventorySparseRecordValue(result.world.projection.transfers, transferId);
  if (transfer === undefined)
    throw new Error(
      `Inventory transfer '${transferId}' is missing after publication.`
    );
  return {
    receipt: result.receipt,
    event,
    transfer,
    replayed: result.replayed,
  };
}

/** Resolve one transfer from a published world or fail closed for an unknown identity. */
function requirePublishedInventoryTransfer(
  world: InventoryWorldState,
  transferId: string
): InventoryTransfer {
  const transfer = inventorySparseRecordValue(world.projection.transfers, transferId);
  if (transfer === undefined)
    throw new Error(`Unknown inventory transfer '${transferId}'.`);
  return transfer;
}

/** Resolve one reservation result from the coordinator's published world/receipt. */
function createInventoryOnceReservationResult(
  result: CommitInventoryOperationResult
): InventoryOnceReservationResult {
  const reservationId = result.receipt.reservationId;
  if (reservationId === undefined) {
    throw new Error(
      "Inventory reservation command completed without reservationId."
    );
  }
  const reservation = inventorySparseRecordValue(result.world.reservations.reservations, reservationId);
  if (reservation === undefined) {
    throw new Error(
      "Inventory reservation receipt references missing reservation."
    );
  }
  const event =
    result.receipt.eventId === undefined
      ? undefined
      : inventorySparseRecordValue(
          result.world.projection.events,
          result.receipt.eventId
        );
  return {
    receipt: result.receipt,
    reservation,
    ...(event === undefined ? {} : { event }),
    replayed: result.replayed,
  };
}

/** Resolve one physical-count result from the coordinator's published world/receipt. */
function createInventoryOnceCountResult(
  result: CommitInventoryOperationResult
): InventoryOnceCountResult {
  const countId = result.receipt.countId;
  if (countId === undefined) {
    throw new Error("Inventory count command completed without countId.");
  }
  const count = inventorySparseRecordValue(result.world.counts.counts, countId);
  if (count === undefined)
    throw new Error("Inventory count receipt references missing count.");
  const event =
    result.receipt.eventId === undefined
      ? undefined
      : inventorySparseRecordValue(
          result.world.projection.events,
          result.receipt.eventId
        );
  return {
    receipt: result.receipt,
    count,
    ...(event === undefined ? {} : { event }),
    replayed: result.replayed,
  };
}

/** Private implementation of append-only retained catalogue publication. */
class InventoryOnceCatalogImplementation implements InventoryOnceCatalogApi {
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind catalogue publication to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Read one exact retained item/form revision from the published catalogue. */
  async itemRevision(
    revisionId: string
  ): Promise<InventoryItemDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).itemRevision(revisionId);
  }

  /** Read the current active item/form revision for one stable item identity. */
  async activeItem(itemId: string): Promise<InventoryItemDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).activeItem(itemId);
  }

  /** List all retained immutable item/form revisions for one stable item identity. */
  async itemRevisionsForItem(
    itemId: string
  ): Promise<readonly InventoryItemDefinitionRevision[]> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).itemRevisionsForItem(itemId);
  }

  /** Publish the complete supplied catalogue only when it advances durable definition truth. */
  async publish(
    input: InventoryOncePublishCatalogInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const event = createInventoryCatalogPublicationEvent({
      ...input,
      catalog: internals.catalog,
    });
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: inventoryEventIntentFingerprint(event),
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Refuse redundant new publication rows while exact retries still replay before planning. */
      plan: ({ world }) => {
        if (world.catalog.digest === internals.catalog.digest) {
          throw new Error(
            "This inventory catalogue is already the current durable catalogue."
          );
        }
        return { event };
      },
    });
    return createInventoryOnceEventResult(result);
  }
}

/** Private implementation of revision-frozen heterogeneous composition reads/opening. */
class InventoryOnceCompositionsImplementation
  implements InventoryOnceCompositionsApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind composition operations to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Read one exact composition revision already present in durable catalogue truth. */
  async definition(
    revisionId: InventoryCompositionRevisionId
  ): Promise<InventoryCompositionDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).compositionRevision(revisionId);
  }

  /** Read the current durable active revision for one stable composition identity. */
  async activeDefinition(
    compositionId: InventoryCompositionId
  ): Promise<InventoryCompositionDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).activeComposition(compositionId);
  }

  /** Read the exact composition attached to one immutable source package revision. */
  async forSourcePackagingRevision(
    packagingRevisionId: string
  ): Promise<InventoryCompositionDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).compositionForSourcePackagingRevision(packagingRevisionId);
  }

  /** Open whole exact packages using their immutable composition rather than the active pointer. */
  async open(
    input: InventoryOnceOpenCompositionInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const intentFingerprint = inventoryCompositionOpenIntentFingerprint({
      ...input,
      catalog: internals.catalog,
    });
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Build exact outputs from the same published world/catalog revision being committed. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "composition opening"
        );
        const catalog = inventoryCatalogForPublishedWorld(
          world,
          internals.catalog
        );
        return {
          event: createInventoryCompositionOpenEvent({
            ...input,
            catalog,
            projection: world.projection,
          }),
        };
      },
    });
    return createInventoryOnceEventResult(result);
  }
}

/** Private implementation of reusable physical transformation-definition reads and previews. */
class InventoryOnceTransformationsImplementation
  implements InventoryOnceTransformationsApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;
  /** Bind transformation discovery and planning to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }
  /** Read one exact transformation definition from the published catalogue. */
  async definition(
    revisionId: InventoryTransformationRevisionId
  ): Promise<InventoryTransformationDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).transformationRevision(revisionId);
  }
  /** Read the active immutable definition for one stable transformation identity. */
  async activeDefinition(
    transformationId: InventoryTransformationId
  ): Promise<InventoryTransformationDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).activeTransformation(transformationId);
  }
  /** List every retained definition revision that touches one stable item identity. */
  async definitionsForItem(
    itemId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).transformationsForItem(itemId);
  }
  /** List current definitions that consume one exact item/form revision. */
  async fromRevision(
    itemRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).transformationsFromRevision(itemRevisionId);
  }
  /** List current definitions that produce one exact item/form revision. */
  async toRevision(
    itemRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).transformationsToRevision(itemRevisionId);
  }
  /** List current definitions that connect one exact input/output form pair. */
  async betweenRevisions(
    fromRevisionId: string,
    toRevisionId: string
  ): Promise<readonly InventoryTransformationDefinitionRevision[]> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).transformationsBetweenRevisions(fromRevisionId, toRevisionId);
  }
  /** Preview whether current physical stock can satisfy every exact transformation input line. */
  async plan(
    input: InventoryOncePlanTransformationDefinitionInput
  ): Promise<InventoryOnceTransformationPlan> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    const catalog = inventoryCatalogForPublishedWorld(world, internals.catalog);
    const definition = catalog.transformationRevision(
      input.transformationRevisionId
    );
    const plannedInputs: InventoryOnceTransformationInputPlan[] = [];
    let applicable = true;
    for (const line of definition.inputs) {
      const item = catalog.itemRevision(line.itemRevisionId);
      const requested = input.selectorsByInputLine === undefined
        ? undefined
        : inventorySparseRecordValue(input.selectorsByInputLine, line.lineId);
      if (requested !== undefined && requested.itemId !== item.itemId)
        throw new Error(
          `Transformation input '${line.lineId}' selector belongs to another item.`
        );
      if (
        requested?.itemRevisionIds !== undefined &&
        !requested.itemRevisionIds.includes(line.itemRevisionId)
      )
        throw new Error(
          `Transformation input '${line.lineId}' selector excludes required form revision '${line.itemRevisionId}'.`
        );
      const selector = normalizeInventoryStockSelector({
        ...(requested ?? { itemId: item.itemId }),
        itemId: item.itemId,
        itemRevisionIds: [line.itemRevisionId],
      });
      const positions = findInventoryPositions(
        world.projection,
        selector
      ).filter(
        /** Deficit rows are debt evidence, never allocatable transformation input. */
        (position) => !inventoryPositionIsDeficit(position)
      );
      let available = zeroInventoryMeasurements(line.amount);
      for (const position of positions)
        available = addInventoryMeasurements(available, position.measurements);
      const sufficient = inventoryMeasurementsCoverRequired(
        available,
        line.amount
      );
      if (!sufficient) applicable = false;
      plannedInputs.push({
        lineId: line.lineId,
        itemRevisionId: line.itemRevisionId,
        selector,
        required: line.amount,
        available,
        positions,
        sufficient,
      });
    }
    return {
      definition,
      worldRevision: world.revision,
      inputs: Object.freeze(plannedInputs),
      outputs: definition.outputs,
      applicable,
    };
  }
}

/** True when every required measurement axis is covered by current stock. */
function inventoryMeasurementsCoverRequired(
  available: InventoryMeasurementVector,
  required: InventoryMeasurementVector
): boolean {
  if (
    available.primary.axisId !== required.primary.axisId ||
    compareQuantity(available.primary.quantity, required.primary.quantity) < 0
  )
    return false;
  for (const needed of required.independent) {
    const current = available.independent.find(
      /** Match the same independently measured axis before comparing exact quantity. */
      (candidate) => candidate.axisId === needed.axisId
    );
    if (
      current === undefined ||
      compareQuantity(current.quantity, needed.quantity) < 0
    )
      return false;
  }
  return true;
}

/** Private implementation of revision-frozen read-only collection/taxonomy views. */
class InventoryOnceCollectionsImplementation
  implements InventoryOnceCollectionsApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind collection reads to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Read one exact collection revision already present in durable catalogue truth. */
  async definition(
    revisionId: InventoryCollectionRevisionId
  ): Promise<InventoryCollectionDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).collectionRevision(revisionId);
  }

  /** Read the current durable active revision for one stable collection identity. */
  async activeDefinition(
    collectionId: InventoryCollectionId
  ): Promise<InventoryCollectionDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).activeCollection(collectionId);
  }

  /** Summarize exact member identities plus only explicitly compatible roll-ups. */
  async summary(
    input: InventoryOnceCollectionSummaryInput
  ): Promise<InventoryCollectionSummary> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return summarizeInventoryCollection({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      projection: world.projection,
      collectionRevisionId: input.collectionRevisionId,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    });
  }
}

/** Private implementation of revision-frozen mutual-fungibility reads and movements. */
class InventoryOnceFungibilityImplementation
  implements InventoryOnceFungibilityApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind mutual-fungibility operations to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Read one exact pool revision already present in durable catalogue truth. */
  async definition(
    revisionId: InventoryFungibilityRevisionId
  ): Promise<InventoryFungibilityPoolDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).fungibilityRevision(revisionId);
  }

  /** Read the current durable active revision for one stable pool identity. */
  async activeDefinition(
    poolId: InventoryFungibilityPoolId
  ): Promise<InventoryFungibilityPoolDefinitionRevision> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventoryCatalogForPublishedWorld(
      world,
      internals.catalog
    ).activeFungibilityPool(poolId);
  }

  /** Summarize exact member stock in one immutable common-basis revision. */
  async summary(
    input: InventoryOnceFungibilitySummaryInput
  ): Promise<InventoryFungibilitySummary> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return summarizeInventoryFungibility({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      projection: world.projection,
      fungibilityRevisionId: input.fungibilityRevisionId,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    });
  }

  /** Preview exact FIFO/FEFO member lines without writing inventory truth. */
  async plan(
    input: InventoryOncePlanFungibilityInput
  ): Promise<InventoryFungibilityAllocationPlan> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return planInventoryFungibilityAllocation({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      world,
      fungibilityRevisionId: input.fungibilityRevisionId,
      requested: input.requested,
      method: input.method,
      atEpochMs: input.atEpochMs ?? internals.clock.nowEpochMs(),
      ...(input.reservationAtEpochMs === undefined
        ? {}
        : { reservationAtEpochMs: input.reservationAtEpochMs }),
      ...(input.reservationEffect === undefined
        ? {}
        : { reservationEffect: input.reservationEffect }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.allowExpiredLots === undefined
        ? {}
        : { allowExpiredLots: input.allowExpiredLots }),
      ...(input.allowAllocatedStock === undefined
        ? {}
        : { allowAllocatedStock: input.allowAllocatedStock }),
    });
  }

  /** Issue exact selected member items while retaining their real identities. */
  async issue(
    input: InventoryOnceIssueFungibleInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryFungibilityMovement(
      this.owner,
      InventoryFungibilityMovementKind.Issue,
      input
    );
  }

  /** Transfer exact selected member items while retaining every non-placement dimension. */
  async transfer(
    input: InventoryOnceTransferFungibleInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryFungibilityMovement(
      this.owner,
      InventoryFungibilityMovementKind.Transfer,
      input,
      input.toPlacementNodeId
    );
  }

  /** Scrap exact selected member items under one explicit physical-truth reason. */
  async scrap(
    input: InventoryOnceScrapFungibleInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryFungibilityMovement(
      this.owner,
      InventoryFungibilityMovementKind.Scrap,
      input
    );
  }
}

/** Private implementation of the safe physical-stock command surface. */
class InventoryOnceStockImplementation implements InventoryOnceStockApi {
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind stock commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Receive stock from outside this inventory world. */
  async receive(
    input: InventoryOnceReceiveInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryReceiptEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Receive several exact item/lot/package lines atomically. */
  async receiveMany(
    input: InventoryOnceReceiveManyInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryReceiptManyEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Issue/dispense stock out of this inventory world. */
  async issue(
    input: InventoryOnceIssueInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryIssueEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Issue several exact stock positions atomically. */
  async issueMany(
    input: InventoryOnceIssueManyInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryIssueManyEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Select FIFO/FEFO sources and issue them atomically. */
  async issueByPolicy(
    input: InventoryOnceIssueByPolicyInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPolicyMovement(
      this.owner,
      InventoryPolicyMovementKind.Issue,
      input
    );
  }

  /** Plan several identified FIFO/FEFO requests and issue one atomic event. */
  async issueManyByPolicy(
    input: InventoryOnceIssueManyByPolicyInput
  ): Promise<InventoryOncePolicyBatchResult> {
    return commitInventoryPolicyBatch(
      this.owner,
      InventoryPolicyMovementKind.Issue,
      input
    );
  }

  /** Intentionally detach stock from a known placement while preserving every other dimension. */
  async detach(
    input: InventoryOnceDetachInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryDetachEvent({ ...input, catalog })
    );
  }

  /** Place or recover detached/missing stock at one known direct placement node. */
  async place(
    input: InventoryOncePlaceInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryPlaceEvent({ ...input, catalog })
    );
  }

  /** Mark placed or detached stock as genuinely missing while keeping quantity conserved. */
  async markMissing(
    input: InventoryOnceMarkMissingInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryMarkMissingEvent({ ...input, catalog })
    );
  }

  /** Move unchanged stock to another direct placement while preserving every other dimension. */
  async transfer(
    input: InventoryOnceTransferInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryReportedExactTransfer(
      this.owner,
      createInventoryTransferEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Move several exact stock positions atomically while preserving every non-placement dimension. */
  async transferMany(
    input: InventoryOnceTransferManyInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryReportedExactTransfer(
      this.owner,
      createInventoryTransferManyEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Select FIFO/FEFO sources from one direct placement and transfer them atomically. */
  async transferByPolicy(
    input: InventoryOnceTransferByPolicyInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPolicyMovement(
      this.owner,
      InventoryPolicyMovementKind.Transfer,
      input,
      input.toPlacementNodeId
    );
  }

  /** Plan several identified FIFO/FEFO requests and publish one conserved transfer event. */
  async transferManyByPolicy(
    input: InventoryOnceTransferManyByPolicyInput
  ): Promise<InventoryOncePolicyBatchResult> {
    return commitInventoryPolicyBatch(
      this.owner,
      InventoryPolicyMovementKind.Transfer,
      input,
      input.toPlacementNodeId
    );
  }

  /** Change only status/disposition. */
  async changeStatus(
    input: InventoryOnceChangeStatusInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "change status");
    return this.commitReclassification(input, {
      ...from,
      statusId: requireChangedIdentity(from.statusId, input.toStatusId, "status"),
    });
  }

  /** Remove stock status without changing any other position field. */
  async clearStatus(
    input: InventoryOnceClearStatusInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "clear status");
    const { statusId, ...withoutStatus } = from;
    requirePresentIdentity(statusId, "status");
    return this.commitReclassification(input, withoutStatus);
  }

  /** Change only legal/economic ownership. */
  async changeOwner(
    input: InventoryOnceChangeOwnerInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "change owner");
    return this.commitReclassification(input, {
      ...from,
      ownerId: requireChangedIdentity(from.ownerId, input.toOwnerId, "owner"),
    });
  }

  /** Remove legal/economic owner without changing any other position field. */
  async clearOwner(
    input: InventoryOnceClearOwnerInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "clear owner");
    const { ownerId, ...withoutOwner } = from;
    requirePresentIdentity(ownerId, "owner");
    return this.commitReclassification(input, withoutOwner);
  }

  /** Change only physical custody/possession. */
  async changeCustodian(
    input: InventoryOnceChangeCustodianInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "change custodian");
    return this.commitReclassification(input, {
      ...from,
      custodianId: requireChangedIdentity(
        from.custodianId,
        input.toCustodianId,
        "custodian"
      ),
    });
  }

  /** Remove custodian/possessor without changing any other position field. */
  async clearCustodian(
    input: InventoryOnceClearCustodianInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(input.from, "clear custodian");
    const { custodianId, ...withoutCustodian } = from;
    requirePresentIdentity(custodianId, "custodian");
    return this.commitReclassification(input, withoutCustodian);
  }

  /** Change only disposition authority. */
  async changeDispositionAuthority(
    input: InventoryOnceChangeDispositionAuthorityInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(
      input.from,
      "change disposition authority"
    );
    return this.commitReclassification(input, {
      ...from,
      dispositionAuthorityId: requireChangedIdentity(
        from.dispositionAuthorityId,
        input.toDispositionAuthorityId,
        "disposition authority"
      ),
    });
  }

  /** Remove disposition authority without changing any other position field. */
  async clearDispositionAuthority(
    input: InventoryOnceClearDispositionAuthorityInput
  ): Promise<InventoryOnceEventResult> {
    const from = requireStockPositionInput(
      input.from,
      "clear disposition authority"
    );
    const { dispositionAuthorityId, ...withoutAuthority } = from;
    requirePresentIdentity(dispositionAuthorityId, "disposition authority");
    return this.commitReclassification(input, withoutAuthority);
  }

  /** Set one item-defined extra dimension while preserving every other dimension. */
  async changeQualifiedDimension(
    input: InventoryOnceChangeQualifiedDimensionInput
  ): Promise<InventoryOnceEventResult> {
    return this.commitReclassification(
      input,
      createPositionWithChangedQualifiedDimension(input)
    );
  }

  /** Remove one configured extra dimension while preserving every other field. */
  async clearQualifiedDimension(
    input: InventoryOnceClearQualifiedDimensionInput
  ): Promise<InventoryOnceEventResult> {
    return this.commitReclassification(
      input,
      createPositionWithoutQualifiedDimension(input)
    );
  }

  /** Split one exact fungible unit into a serial identity and optional embodied node. */
  async individualize(
    input: InventoryOnceIndividualizeInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryIndividualizeEvent({ ...input, catalog })
    );
  }

  /** Merge one exact serialized unit back into fungible stock. */
  async deindividualize(
    input: InventoryOnceDeindividualizeInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryDeindividualizeEvent({ ...input, catalog })
    );
  }

  /** Atomically split, merge, relot, replace direct placement, or otherwise reclassify conserved stock. */
  async reclassifyMany(
    input: InventoryOnceReclassifyManyInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryReclassificationManyEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Preview the current complete old-revision rows and dependent blockers. */
  async planRevisionTransition(
    request: InventoryRevisionTransitionRequest
  ): Promise<InventoryRevisionTransitionPlan> {
    const { storage } = requireInventoryOnceInternals(this.owner);
    return planInventoryRevisionTransition(await storage.readWorld(), request);
  }

  /** Apply one exact, reviewed revision transition with normal atomic/idempotent durability. */
  async transitionRevision(
    input: InventoryOnceTransitionRevisionInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    if (!input.plan.applicable) {
      throw new Error("Revision-transition preview is blocked; resolve its reported dependencies first.");
    }
    // Retained operation replay bypasses the world-planning callback. Validate
    // the plan's own untrusted request/evidence relationship even on retries.
    assertInventoryRevisionTransitionPlanIntent(input.plan, internals.catalog);
    const event = createInventoryRevisionTransitionEvent({
      ...input,
      catalog: internals.catalog,
      transition: input.plan.evidence,
      lines: input.plan.lines,
    });
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: inventoryEventIntentFingerprint(event),
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Only newly committed intents replan under the current world lock.
       * An already completed exact retry is recognized before this callback.
       */
      plan: ({ world }) => {
        if (world.revision !== input.plan.worldRevision) {
          throw new Error(
            "Revision-transition preview is stale; re-preview after the current inventory world changed."
          );
        }
        const fresh = planInventoryRevisionTransition(
          world,
          input.plan.request
        );
        if (!inventoryRevisionTransitionPlansEqual(input.plan, fresh)) {
          throw new Error(
            "Revision-transition preview no longer matches exact current stock and dependencies."
          );
        }
        return {
          event,
          reservationProtection: InventoryReservationProtection.ProtectClaims,
        };
      },
    });
    return createInventoryOnceEventResult(result);
  }

  /** Convert loose/inner stock into exact intact package stock. */
  async pack(input: InventoryOncePackInput): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryPackEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Convert intact package stock into loose/inner stock. */
  async unpack(
    input: InventoryOnceUnpackInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryUnpackEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Atomically consume inputs, produce outputs, and preserve complete optional lineage. */
  async transform(
    input: InventoryOnceTransformationInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    const event = createInventoryTransformationEvent({
      ...input,
      catalog,
    });
    return commitInventoryEventDraft(
      this.owner,
      event,
      /** Check the frozen world before consuming a traceability identity. */
      (world) => assertTransformationInputsAreDetached(world, event)
    );
  }

  /** Explicitly destroy/discard stock with a reason. */
  async scrap(
    input: InventoryOnceScrapInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryScrapEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Destroy several exact stock positions atomically under one explicit reason. */
  async scrapMany(
    input: InventoryOnceScrapManyInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryScrapManyEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Select FIFO/FEFO sources and record their physical destruction atomically. */
  async scrapByPolicy(
    input: InventoryOnceScrapByPolicyInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPolicyMovement(
      this.owner,
      InventoryPolicyMovementKind.Scrap,
      input
    );
  }

  /** Plan one late-history bundle through the exact commit-time replay engine. */
  async planHistorical(
    input: InventoryOnceHistoricalRepairInput
  ): Promise<InventoryOnceHistoricalRepairPlan> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(internals.catalog, world.catalog);
    const assertions = buildInventoryHistoricalAssertions(
      internals.catalog,
      input
    );
    const omittedAssertionIds = normalizeHistoricalAssertionIds(
      input.omittedAssertionIds ?? [],
      "omitted historical assertionId"
    );
    const historyEvents = await loadInventoryHistoricalDependencies({
      storage: internals.storage,
      projection: world.projection,
      seedEvents: assertions.map(
        /** Select one embedded assertion event as a dependency seed. */
        (assertion) => assertion.event
      ),
      assertionIds: omittedAssertionIds,
    });
    try {
      const planned = createInventoryHistoricalRepairEvent(
        {
          operationId: input.operationId,
          occurredAtEpochMs: input.occurredAtEpochMs,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourcePartyId === undefined
            ? {}
            : { sourcePartyId: input.sourcePartyId }),
          ...(input.destinationPartyId === undefined
            ? {}
            : { destinationPartyId: input.destinationPartyId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          catalog: internals.catalog,
          projection: world.projection,
          recordedAtEpochMs: internals.clock.nowEpochMs(),
          assertions,
          omittedAssertionIds,
          ...(historyEvents === undefined ? {} : { historyEvents }),
        },
        internals.deficitPolicy
      );
      if (planned.event.historicalImpact === undefined) {
        throw new Error("Historical repair planner did not retain impact.");
      }
      return {
        valid: true,
        basedOnWorldRevision: world.revision,
        event: planned.event,
        impact: planned.event.historicalImpact,
      };
    } catch (error) {
      if (error instanceof InventoryHistoricalReplayConflictError) {
        return {
          valid: false,
          basedOnWorldRevision: world.revision,
          conflict: error.conflict,
        };
      }
      if (error instanceof InventoryHistoricalRepairMetadataError) {
        return {
          valid: false,
          basedOnWorldRevision: world.revision,
          conflict: { code: "invalid-history", message: error.message },
        };
      }
      throw error;
    }
  }

  /** Append one late-history bundle as one normal atomically published repair envelope. */
  async recordHistorical(
    input: InventoryOnceHistoricalRepairInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const assertions = buildInventoryHistoricalAssertions(
      internals.catalog,
      input
    );
    const omittedAssertionIds = normalizeHistoricalAssertionIds(
      input.omittedAssertionIds ?? [],
      "omitted historical assertionId"
    );
    const intentFingerprint = inventoryIntentFingerprint([
      "historical-repair-v1",
      input.operationId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      input.reason ?? null,
      assertions.map(
        /** Freeze one embedded assertion into the historical-repair retry identity. */
        (assertion) => [
          assertion.assertionId,
          assertion.afterEventId ?? null,
          inventoryEventIntentFingerprint(assertion.event),
        ]
      ),
      omittedAssertionIds,
      inventoryMetadataFingerprint(input.metadata),
    ]);
    /** Rebuild one exact repair envelope against a supplied published head. */
    const planEvent = async (
      world: InventoryWorldState,
      recordedAtEpochMs: number
    ): Promise<InventoryEventDraft> => {
      const historyEvents = await loadInventoryHistoricalDependencies({
        storage: internals.storage,
        projection: world.projection,
        seedEvents: assertions.map(
          /** Select one embedded assertion event as a dependency seed. */
          (assertion) => assertion.event
        ),
        assertionIds: omittedAssertionIds,
      });
      return createInventoryHistoricalRepairEvent(
        {
          operationId: input.operationId,
          occurredAtEpochMs: input.occurredAtEpochMs,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourcePartyId === undefined
            ? {}
            : { sourcePartyId: input.sourcePartyId }),
          ...(input.destinationPartyId === undefined
            ? {}
            : { destinationPartyId: input.destinationPartyId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          catalog: internals.catalog,
          projection: world.projection,
          recordedAtEpochMs,
          assertions,
          omittedAssertionIds,
          ...(historyEvents === undefined ? {} : { historyEvents }),
        },
        internals.deficitPolicy
      ).event;
    };
    const segmented =
      await commitInventorySegmentedHistoricalEventIfEligible(
        this.owner,
        input.operationId,
        intentFingerprint,
        planEvent
      );
    if (segmented !== undefined) return segmented;
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Replan the exact dependency cone against the won published revision. */
      plan: async ({ world, recordedAtEpochMs }) => ({
        event: await planEvent(world, recordedAtEpochMs),
      }),
    });
    return createInventoryOnceEventResult(result);
  }

  /** Plan one exact correction through the same replay engine without durable writes. */
  async planCorrection(
    input: InventoryOnceCorrectInput
  ): Promise<InventoryOnceCorrectionPlan> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(internals.catalog, world.catalog);
    const replacementPlans = new InventoryOnceReplacementPlansImplementation(
      internals.catalog,
      `${input.operationId}:replacement`
    );
    const opaqueReplacement = input.replaceWith(replacementPlans);
    const replacement = readReplacementEventDraft(opaqueReplacement);
    const root = inventorySparseRecordValue(
      world.projection.events,
      input.correctsEventId
    );
    const historyEvents = await loadInventoryHistoricalDependencies({
      storage: internals.storage,
      projection: world.projection,
      seedEvents: [
        ...(root === undefined ? [] : [root]),
        ...(replacement === undefined ? [] : [replacement]),
      ],
    });
    try {
      const event = createInventoryCorrectionEvent(
        {
          catalog: internals.catalog,
          projection: world.projection,
          correctsEventId: input.correctsEventId,
          ...(replacement === undefined ? {} : { replacement }),
          ...(historyEvents === undefined ? {} : { historyEvents }),
          operationId: input.operationId,
          occurredAtEpochMs: input.occurredAtEpochMs,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourcePartyId === undefined
            ? {}
            : { sourcePartyId: input.sourcePartyId }),
          ...(input.destinationPartyId === undefined
            ? {}
            : { destinationPartyId: input.destinationPartyId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
        internals.deficitPolicy
      );
      if (event.historicalImpact === undefined) {
        throw new Error("Correction planner did not retain historical impact.");
      }
      return {
        valid: true,
        basedOnWorldRevision: world.revision,
        event,
        impact: event.historicalImpact,
      };
    } catch (error) {
      if (error instanceof InventoryHistoricalReplayConflictError) {
        return {
          valid: false,
          basedOnWorldRevision: world.revision,
          conflict: error.conflict,
        };
      }
      throw error;
    }
  }

  /** Append/supersede one correction using a normal declarative replacement plan. */
  async correct(
    input: InventoryOnceCorrectInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const replacementPlans = new InventoryOnceReplacementPlansImplementation(
      internals.catalog,
      `${input.operationId}:replacement`
    );
    const opaqueReplacement = input.replaceWith(replacementPlans);
    const replacement = readReplacementEventDraft(opaqueReplacement);
    const intentFingerprint = inventoryIntentFingerprint([
      "correction",
      input.operationId,
      input.correctsEventId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      input.reason ?? null,
      inventoryMetadataFingerprint(input.metadata),
      replacement === undefined
        ? "omit"
        : inventoryEventIntentFingerprint(replacement),
    ]);
    /** Rebuild one exact correction envelope against a supplied published head. */
    const planEvent = async (
      world: InventoryWorldState,
      _recordedAtEpochMs: number
    ): Promise<InventoryEventDraft> => {
      const root = inventorySparseRecordValue(
        world.projection.events,
        input.correctsEventId
      );
      const historyEvents = await loadInventoryHistoricalDependencies({
        storage: internals.storage,
        projection: world.projection,
        seedEvents: [
          ...(root === undefined ? [] : [root]),
          ...(replacement === undefined ? [] : [replacement]),
        ],
      });
      return createInventoryCorrectionEvent(
        {
          catalog: internals.catalog,
          projection: world.projection,
          correctsEventId: input.correctsEventId,
          ...(replacement === undefined ? {} : { replacement }),
          ...(historyEvents === undefined ? {} : { historyEvents }),
          operationId: input.operationId,
          occurredAtEpochMs: input.occurredAtEpochMs,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourcePartyId === undefined
            ? {}
            : { sourcePartyId: input.sourcePartyId }),
          ...(input.destinationPartyId === undefined
            ? {}
            : { destinationPartyId: input.destinationPartyId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
        internals.deficitPolicy
      );
    };
    const segmented =
      await commitInventorySegmentedHistoricalEventIfEligible(
        this.owner,
        input.operationId,
        intentFingerprint,
        planEvent
      );
    if (segmented !== undefined) return segmented;
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Recalculate the exact dependency cone against the won published revision. */
      plan: async ({ world, recordedAtEpochMs }) => ({
        event: await planEvent(world, recordedAtEpochMs),
      }),
    });
    return createInventoryOnceEventResult(result);
  }

  /** Commit one explicitly constructed one-dimension reclassification. */
  private async commitReclassification(
    input: InventoryOnceDimensionChangeInput,
    to: InventoryStockPositionInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryReclassificationEvent({
        ...input,
        catalog,
        to,
      })
    );
  }
}

/** Physical movement selected through one exact mutual-fungibility pool revision. */
enum InventoryFungibilityMovementKind {
  /** Selected member stock leaves inventory for use/dispense. */
  Issue = "issue",
  /** Selected member stock moves unchanged between direct placements. */
  Transfer = "transfer",
  /** Selected member stock is explicitly destroyed/discarded. */
  Scrap = "scrap",
}

/** Plan and commit one cross-item pool movement against the same published world revision. */
async function commitInventoryFungibilityMovement(
  owner: InventoryOnce,
  kind: InventoryFungibilityMovementKind,
  input: InventoryOnceFungibilityMovementInput,
  toPlacementNodeId?: string
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  const scope = normalizeInventoryFungibilityScope(input.scope ?? {});
  assertFungibilityMovementRequest(kind, input, scope, toPlacementNodeId);
  const reservationEffect = fungibilityReservationEffectForMovement(
    kind,
    toPlacementNodeId
  );
  const intentFingerprint = inventoryIntentFingerprint([
    `inventory-fungibility-${kind}`,
    input.operationId,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
    input.fungibilityRevisionId,
    inventoryFungibilityScopeIdentity(scope),
    quantityToDecimalString(input.requested),
    input.requested.unit,
    input.method,
    input.allowExpiredLots ?? false,
    input.allowAllocatedStock ?? false,
    toPlacementNodeId ?? null,
  ]);
  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId: input.operationId,
    intentFingerprint,
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Freeze exact real member lines selected from the same world used by durable begin. */
    plan: ({ world, recordedAtEpochMs }) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        `${kind} fungibility movement`
      );
      /** Prefer the existing claim-preserving assignment when one is available. */
      const planning: PlanInventoryFungibilityAllocationInput = {
        catalog: internals.catalog,
        world,
        fungibilityRevisionId: input.fungibilityRevisionId,
        requested: input.requested,
        method: input.method,
        atEpochMs: input.occurredAtEpochMs,
        reservationAtEpochMs: recordedAtEpochMs,
        reservationEffect,
        scope,
        ...(input.allowExpiredLots === undefined
          ? {}
          : { allowExpiredLots: input.allowExpiredLots }),
        ...(input.allowAllocatedStock === undefined
          ? {}
          : { allowAllocatedStock: input.allowAllocatedStock }),
      };
      const preferred = planInventoryFungibilityRecordingAllocation(planning);
      // A physical report may use held stock when a claim-preserving pick cannot fill it.
      const allocation = preferred.shortfall.amountMinor === 0 || planning.allowAllocatedStock
        ? preferred
        : planInventoryFungibilityRecordingAllocation({ ...planning, allowAllocatedStock: true });
      assertFungibilityAllocationComplete(allocation);
      return {
        event: createFungibilityMovementEvent(
          internals.catalog,
          kind,
          input,
          allocation,
          toPlacementNodeId
        ),
      };
    },
  });
  return createInventoryOnceEventResult(result);
}

/** Return the exact claim-feasibility effect for one validated movement kind. */
function fungibilityReservationEffectForMovement(
  kind: InventoryFungibilityMovementKind,
  toPlacementNodeId: string | undefined
): InventoryFungibilityReservationEffect {
  if (kind !== InventoryFungibilityMovementKind.Transfer) {
    return { kind: InventoryFungibilityReservationEffectKind.Deplete };
  }
  if (toPlacementNodeId === undefined) {
    throw new Error("Fungibility transfer lost destination direct placement.");
  }
  return {
    kind: InventoryFungibilityReservationEffectKind.Transfer,
    toPlacementNodeId,
  };
}

/** Reject ambiguous/unsafe pool movement combinations before planning. */
function assertFungibilityMovementRequest(
  kind: InventoryFungibilityMovementKind,
  input: InventoryOnceFungibilityMovementInput,
  scope: InventoryFungibilityScope,
  toPlacementNodeId: string | undefined
): void {
  if (
    kind !== InventoryFungibilityMovementKind.Scrap &&
    input.allowAllocatedStock === true
  ) {
    throw new Error(
      "Only explicit fungibility scrap may select allocated stock."
    );
  }
  if (kind === InventoryFungibilityMovementKind.Transfer) {
    if (toPlacementNodeId === undefined || toPlacementNodeId.trim().length === 0) {
      throw new Error("Fungibility transfer needs toPlacementNodeId.");
    }
    if (scope.placementNodeIds?.length !== 1) {
      throw new Error(
        "Fungibility transfer scope must name exactly one source direct placement."
      );
    }
    if (scope.placementNodeIds[0] === toPlacementNodeId) {
      throw new Error(
        "Fungibility transfer source/destination direct placements must differ."
      );
    }
  }
  if (
    kind === InventoryFungibilityMovementKind.Scrap &&
    (input.reason ?? "").trim().length === 0
  ) {
    throw new Error("Fungibility scrap needs an explicit reason.");
  }
  if (input.metadata?.inventoryOnceFungibility !== undefined) {
    throw new Error(
      "Metadata key 'inventoryOnceFungibility' is reserved for core pool evidence."
    );
  }
}

/** Fail closed instead of inventing pooled deficit when exact member candidates are insufficient. */
function assertFungibilityAllocationComplete(
  plan: InventoryFungibilityAllocationPlan
): void {
  if (plan.shortfall.amountMinor === 0) return;
  const shortfall = `${quantityToDecimalString(plan.shortfall)} ${
    plan.shortfall.unit
  }`;
  if (plan.expiredStockWasExcluded) {
    throw new Error(
      `Inventory fungibility pool has ${shortfall} shortfall after excluding expired stock; explicitly allow expired lots to use them.`
    );
  }
  if (plan.allocationConstraintBlockedStock) {
    throw new Error(
      `Inventory fungibility pool has ${shortfall} shortfall because every exact member assignment would violate current reservation claims.`
    );
  }
  if (plan.incrementBlockedStock) {
    throw new Error(
      `Inventory fungibility pool has ${shortfall} shortfall because intact package/serial increments cannot be split.`
    );
  }
  throw new Error(
    `Inventory fungibility pool has insufficient eligible stock (${shortfall} shortfall).`
  );
}

/** Build one normal multi-line stock event whose lines retain actual pool member identities. */
function createFungibilityMovementEvent(
  catalog: InventoryCatalog,
  kind: InventoryFungibilityMovementKind,
  input: InventoryOnceFungibilityMovementInput,
  plan: InventoryFungibilityAllocationPlan,
  toPlacementNodeId: string | undefined
): InventoryEventDraft {
  const header = inventoryCommandHeaderFromFungibilityInput(input, plan);
  if (kind === InventoryFungibilityMovementKind.Issue) {
    return createInventoryIssueManyEvent({
      catalog,
      ...header,
      lines: plan.lines.map(
        /** Preserve each selected member's exact item revision and physical position. */
        (line) => fungibilityIssueLine(line, plan.definition)
      ),
    });
  }
  if (kind === InventoryFungibilityMovementKind.Transfer) {
    if (toPlacementNodeId === undefined) {
      throw new Error("Fungibility transfer lost destination direct placement.");
    }
    return createInventoryTransferManyEvent({
      catalog,
      ...header,
      lines: plan.lines.map(
        /** Add only the destination direct placement to each exact selected member line. */
        (line) => ({
          ...fungibilityIssueLine(line, plan.definition),
          toPlacementNodeId,
        })
      ),
    });
  }
  return createInventoryScrapManyEvent({
    catalog,
    ...header,
    lines: plan.lines.map(
      /** Preserve each destroyed member identity and common-basis evidence. */
      (line) => fungibilityIssueLine(line, plan.definition)
    ),
  });
}

/** Retain normal provenance plus one reserved common-basis audit record. */
function inventoryCommandHeaderFromFungibilityInput(
  input: InventoryOnceFungibilityMovementInput,
  plan: InventoryFungibilityAllocationPlan
): InventoryCommandHeader {
  return {
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    metadata: {
      ...(input.metadata ?? {}),
      inventoryOnceFungibility: {
        poolId: plan.definition.poolId,
        revisionId: plan.definition.revisionId,
        basisAxisId: plan.definition.basisAxisId,
        basisUnit: plan.definition.basisUnit,
        requested: quantityToDecimalString(plan.requested),
        method: input.method,
      },
    },
  };
}

/** Convert one selected pool member to a normal exact issue/scrap/transfer source line. */
function fungibilityIssueLine(
  line: InventoryFungibilityAllocationLine,
  definition: InventoryFungibilityPoolDefinitionRevision
): CreateInventoryIssueManyInput["lines"][number] {
  const { itemRevisionId, ...from } = line.position;
  if (itemRevisionId !== line.itemRevisionId) {
    throw new Error(
      "Fungibility allocation line item revision does not match its position."
    );
  }
  return {
    from,
    amount: line.amount,
    itemRevisionId,
    metadata: {
      fungibilityRevisionId: definition.revisionId,
      fungibilityPoolId: definition.poolId,
      selectedPoolQuantity: quantityToDecimalString(line.poolQuantity),
      selectedPoolUnit: line.poolQuantity.unit,
      selectedMemberQuantity: quantityToDecimalString(line.memberQuantity),
      selectedMemberUnit: line.memberQuantity.unit,
      allocationLayerStartedAtEpochMs: line.layerStartedAtEpochMs,
      ...(line.expiresAtEpochMs === undefined
        ? {}
        : { allocationEffectiveUseByEpochMs: line.expiresAtEpochMs }),
    },
  };
}

/** Native policy movement selected by the shared planner. */
enum InventoryPolicyMovementKind {
  /** Stock leaves inventory for dispense/use. */
  Issue = "issue",
  /** Stock moves unchanged between direct placements. */
  Transfer = "transfer",
  /** Physical stock is explicitly destroyed/discarded. */
  Scrap = "scrap",
}

/** Reserved immutable event-metadata key retaining per-request batch allocations. */
const inventoryPolicyBatchMetadataKey = "inventoryOncePolicyBatch";
/** Version of the compact replay evidence encoded under the reserved metadata key. */
const inventoryPolicyBatchMetadataVersion = 2;
/** Reserved event-metadata key identifying one recorded policy shortfall. */
const inventoryPolicyDeficitMetadataKey = "inventoryOncePolicyDeficit";
/** Version of single-request recorded-deficit evidence. */
const inventoryPolicyDeficitMetadataVersion = 1;

/** Compact immutable allocation line encoded in event metadata before position enrichment. */
type InventoryPolicyBatchAllocationEvidenceLine = Omit<
  InventoryOncePolicyBatchAllocationLine,
  "position"
>;

/** Compact recorded-deficit evidence decoded before position enrichment. */
type InventoryPolicyBatchDeficitEvidence = Omit<
  InventoryOnceRecordedDeficit,
  "position"
> & {
  /** Exact signed stock-effect position retained in the event. */
  readonly positionIdentity: string;
};

/** Compact request allocation decoded from immutable event metadata. */
interface InventoryPolicyBatchAllocationEvidence {
  /** Stable caller request identity. */
  readonly requestId: string;
  /** Stable caller result-group identity retained for replay. */
  readonly groupId: string;
  /** Exact encoded source evidence for this request. */
  readonly lines: readonly InventoryPolicyBatchAllocationEvidenceLine[];
  /** Optional durable shortfall recorded by this request under Record mode. */
  readonly deficit?: InventoryPolicyBatchDeficitEvidence;
}

/** One policy shortfall frozen as an exact signed posting and public replay evidence. */
interface InventoryPolicyRecordedDeficit {
  /** Positive exact reported quantity at the source position that takes the deficit. */
  readonly line: CreateInventoryIssueManyInput["lines"][number];
  /** Public exact evidence retained in immutable event metadata. */
  readonly evidence: InventoryOnceRecordedDeficit;
}

/** The signed pools and exact lookups needed by one policy or batch planner. */
interface InventoryPolicyStockSource {
  /** Complete signed pool plus current exact holds for this request. */
  pool(selection: ResolvedAllocationSelection): InventorySegmentedResult<InventoryScopedStockPool>;
  /** Exact current signed row for a reported source or deficit. */
  position(positionId: string): InventorySegmentedResult<InventoryStockPosition | undefined>;
  /** Current ancestry for an explicit deficit position that a later request may need. */
  ancestry(nodeId: string): InventorySegmentedResult<readonly string[]>;
  /** Exact facts for a direct contents move without visiting any descendants. */
  directContents(nodeId: string, into: string): InventorySegmentedResult<InventorySegmentedDirectContents>;
}

/** Preserve fully witnessed transfers and partition Record shortfalls at the same publication fence. */
async function commitInventoryReportedExactTransfer(
  owner: InventoryOnce,
  event: InventoryEventDraft
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  if (internals.deficitPolicy !== InventoryDeficitPolicy.Record) {
    return commitInventoryEventDraft(owner, event);
  }
  return commitInventoryScopedMovement({
    internals,
    operationId: event.operationId,
    intentFingerprint: inventoryEventIntentFingerprint(event),
    /** Split only the exact positive witnesses from the signed report. */
    plan: (source) => planRecordedExactTransfer({ catalog: internals.catalog, event, readPosition: source.position }),
  });
}

/** One exact reported transfer and the source facts at its publication fence. */
interface PlanRecordedExactTransferInput {
  /** Retained definitions used to interpret exact amounts. */
  readonly catalog: InventoryCatalog;
  /** Normalized caller intent before partitioning witnessed and unknown stock. */
  readonly event: InventoryEventDraft;
  /** Read exact positions at the revision used for publication. */
  readonly readPosition: InventoryPolicyStockSource["position"];
}

/** Partition normalized one-to-one transfer routes using exact current source quantities. */
async function planRecordedExactTransfer({
  catalog, event, readPosition,
}: PlanRecordedExactTransferInput): Promise<InventoryEventDraft> {
  const sourceEffects = new Map<string, InventoryStockEffect>();
  for (const effect of event.stockEffects) {
    if (effect.measurementsDelta.primary.quantity.amountMinor < 0) {
      sourceEffects.set(inventoryStockPositionIdentity(effect.position), effect);
    }
  }
  const witnessed: InventoryTransferLine[] = [];
  const unknown: InventoryUnwitnessedMovementLine[] = [];
  for (const route of event.positiveLayerProvenanceTransfers ?? []) {
    const sourceId = inventoryStockPositionIdentity(route.from);
    const effect = sourceEffects.get(sourceId);
    const toPlacementNodeId = route.to.placementNodeId;
    if (effect === undefined || toPlacementNodeId === undefined) {
      throw new Error("Exact transfer lost its signed source or direct destination.");
    }
    const requested = negateInventoryMeasurements(effect.measurementsDelta);
    const current = await readPosition(sourceId);
    const backed = current !== undefined && current.measurements.primary.quantity.amountMinor > 0;
    const fullyWitnessed = backed && inventoryMeasurementsCoverRequired(current.measurements, requested);
    // Independently measured axes cannot be apportioned from the primary
    // count. A partial witness must be the whole source, with a valid remainder.
    if (backed && !fullyWitnessed && (
      compareQuantity(requested.primary.quantity, current.measurements.primary.quantity) <= 0 ||
      !inventoryMeasurementsCoverRequired(requested, current.measurements)
    )) {
      throw new Error("Reported transfer cannot partition independent measurements into an exact witness and remainder.");
    }
    const { itemRevisionId, ...from } = route.from;
    const witnessedMeasurements = fullyWitnessed ? requested : backed ? current.measurements : undefined;
    if (witnessedMeasurements !== undefined) {
      witnessed.push({
        from, toPlacementNodeId, itemRevisionId,
        amount: transferAmountForVector(catalog, route.from, witnessedMeasurements),
        ...(effect.metadata === undefined ? {} : { metadata: effect.metadata }),
      });
    }
    if (fullyWitnessed) continue;
    if (from.serialId !== undefined) {
      throw new Error("Unwitnessed transfer cannot claim a serial identity.");
    }
    // The ledger nets signed postings at the real unlabelled key. The typed
    // portion preserves the exact report even when the row stays positive.
    const { lotId: _witnessedLot, ...unlabelledSource } = from;
    const unknownSource = { ...unlabelledSource, itemRevisionId };
    const remainder = witnessedMeasurements === undefined ? requested :
      subtractInventoryMeasurements(requested, witnessedMeasurements);
    unknown.push({
      from: unlabelledSource, toPlacementNodeId, itemRevisionId,
      amount: transferAmountForVector(catalog, unknownSource, remainder),
    });
  }
  if (unknown.length === 0) return event;
  return createInventoryRecordedMovement({
    catalog, header: inventoryCommandHeaderFromPlacementInput(event), kind: InventoryEventKind.Transfer,
    witnessed: witnessed.length === 0 ? undefined : createInventoryTransferManyEvent({
      ...event, catalog, lines: witnessed,
    }),
    unknown,
  });
}

/** Convert a complete exact witness or remainder to the existing measured/package amount. */
function transferAmountForVector(
  catalog: InventoryCatalog,
  key: InventoryStockPositionKey,
  measurements: InventoryMeasurementVector
): InventoryAmount {
  return inventoryAmountForPrimaryAllocation({
    catalog, itemRevisionId: key.itemRevisionId,
    position: { key, measurements }, allocatedPrimary: measurements.primary.quantity,
  });
}

/** Read policy facts from the canonical snapshot held by the staged coordinator. */
function canonicalPolicyStockSource(
  world: InventoryWorldState,
  recordedAtEpochMs: number
): InventoryPolicyStockSource {
  return {
    /** Read only this exact signed pool from the canonical position index. */
    pool: (selection) => inventoryAllocationPoolFromWorld(world, selection, recordedAtEpochMs),
    /** Look up one optional explicit deficit position from the same snapshot. */
    position: (positionId) => world.projection.positions[positionId],
    /** Resolve the direct placement against the same published forest. */
    ancestry: (nodeId) => inventoryPlacementAncestry(world.projection.placement, nodeId),
    /** Read the same immediate facts from the coordinator's complete snapshot. */
    directContents: (nodeId, into) => {
      const childNodeIds = inventorySparseRecordValue(world.projection.placement.childNodeIdsByParentNodeId, nodeId) ?? [];
      const children = childNodeIds.map(
        /** Pair each immediate child with its live serial row when physically embodied. */
        (childId) => {
        const embodiedPosition = inventoryEmbodiedPlacementNodePosition(world, childId);
        return { nodeId: childId, ...(embodiedPosition === undefined ? {} : { embodiedPosition }) };
        }
      );
      return {
        positions: inventoryDirectPositivePositionsAtNode(world, nodeId),
        children,
        destinationAncestry: inventoryPlacementAncestry(world.projection.placement, into),
      };
    },
  };
}

/** Read policy facts through published segmented indexes. */
function segmentedPolicyStockSource(
  storage: InventorySegmentedStockPlanningCapability,
  recordedAtEpochMs: number
): InventoryPolicyStockSource {
  return {
    /** Read the complete affected pool with the claim and FIFO evidence it needs. */
    pool: (selection) => storage.readSegmentedStockPool({
      selector: inventoryAllocationPoolSelector(selection),
      itemRevisionId: selection.item.revisionId,
      reservationAtEpochMs: recordedAtEpochMs,
    }),
    /** Read one exact signed row for an optional explicit deficit identity. */
    position: async (positionId) => (await storage.readPositionSegment()).position(positionId),
    /** Read live ancestry through the same published topology index. */
    ancestry: async (nodeId) => (await storage.readPlacementSegment()).ancestry(nodeId),
    /** Read direct rows and child bindings from the adapter's current indexes. */
    directContents: (sourceNodeId, destinationNodeId) =>
      storage.readSegmentedDirectContents({ sourceNodeId, destinationNodeId }),
  };
}

/** A physical command's frozen input and its shared scoped event planner. */
interface CommitInventoryScopedMovementInput {
  /** Configuration of the application façade running this command. */
  readonly internals: InventoryOnceInternals;
  /** Stable operation id. */
  readonly operationId: string;
  /** Frozen command intent before any adapter await. */
  readonly intentFingerprint: string;
  /** Plan one event from one signed stock and claim view. */
  plan(source: InventoryPolicyStockSource, recordedAtEpochMs: number): Promise<InventoryEventDraft>;
}

/** Commit a scoped event through the existing segmented fence or canonical coordinator. */
async function commitInventoryScopedMovement({
  internals,
  operationId,
  intentFingerprint,
  plan,
}: CommitInventoryScopedMovementInput): Promise<InventoryOnceEventResult> {
  const { storage, catalog, clock, deficitPolicy } = internals;
  const catalogSnapshot = inventoryCatalogSnapshot(catalog);
  if (inventoryStorageSupportsSegmentedStockPlanning(storage)) {
    /** Replay from the scoped receipt, or use the canonical path when it holds the event. */
    const readScopedReplay = async (): Promise<InventoryOnceEventResult | null | undefined> => {
      const existing = await storage.readOperation(operationId);
      if (existing === undefined) return undefined;
      if (existing.intentFingerprint !== intentFingerprint) {
        throw new Error("Inventory operationId was retried with changed intent.");
      }
      const alreadyCompleted = existing.state === InventoryDurableOperationState.Completed;
      const receipt = alreadyCompleted ? existing.receipt : await resumeInventoryDurableOperation(storage, operationId);
      const completed = alreadyCompleted ? existing : await storage.readOperation(operationId);
      return completed?.event === undefined ? null : { receipt, event: completed.event, replayed: true };
    };
    let attempt = 0;
    for (; attempt < 8; attempt += 1) {
      const replay = await readScopedReplay();
      if (replay === null) break;
      if (replay !== undefined) return replay;
      const head = await storage.readSegmentedStockHead();
      const recordedAtEpochMs = clock.nowEpochMs();
      const source = segmentedPolicyStockSource(storage, recordedAtEpochMs);
      let event: InventoryEventDraft;
      try {
        if (head.worldRevision !== 0 && head.catalog.digest !== catalog.digest) {
          throw new Error(
            "Inventory command uses unpublished catalogue revisions; publish the retained inventory catalogue first."
          );
        }
        event = await plan(source, recordedAtEpochMs);
      } catch (error) {
        // The matching operation can publish before this head read, including before a catalogue update.
        const concurrent = await readScopedReplay();
        if (concurrent === null) break;
        if (concurrent !== undefined) return concurrent;
        // A shortfall or other domain error from mixed generations is not authoritative.
        if ((await storage.readSegmentedStockHead()).worldRevision !== head.worldRevision) {
          continue;
        }
        throw error;
      }
      const committed = await storage.commitSegmentedStockEvent({
        catalog: catalogSnapshot,
        operationId,
        intentFingerprint,
        recordedAtEpochMs,
        deficitPolicy,
        expectedWorldRevision: head.worldRevision,
        expectedRecordSequence: head.recordSequence,
        event,
      });
      if (committed !== undefined) {
        return {
          receipt: {
            operationId,
            eventId: committed.event.eventId,
            recordedAtEpochMs: committed.recordedAtEpochMs,
            worldRevision: committed.worldRevision,
          },
          event: committed.event,
          replayed: committed.replayed,
        };
      }
      // A competing publish invalidates the scoped plan. A stable decline requests canonical publication.
      if ((await storage.readSegmentedStockHead()).worldRevision === head.worldRevision) break;
    }
    if (attempt === 8) {
      // The winning publish can occur between the final decline and head read.
      const concurrent = await readScopedReplay();
      if (concurrent === undefined) {
        throw new Error(`Inventory operation '${operationId}' could not freeze a current stock revision.`);
      }
      if (concurrent !== null) return concurrent;
    }
  }
  return createInventoryOnceEventResult(await commitInventoryOperation({
    catalog,
    storage,
    operationId,
    intentFingerprint,
    clock,
    deficitPolicy,
    /** Plan against the coordinator's own coherent canonical snapshot. */
    plan: async ({ world, recordedAtEpochMs }) => ({
      event: await plan(canonicalPolicyStockSource(world, recordedAtEpochMs), recordedAtEpochMs),
    }),
  }));
}

/** Overlay facts from earlier requests onto one distinct original batch pool. */
interface PolicyPoolAfterPriorRequestsInput {
  /** Original published stock and claim facts for this pool. */
  readonly pool: InventoryScopedStockPool;
  /** All exact rows changed by earlier requests in the batch. */
  readonly changed: ReadonlyMap<string, InventoryScopedStockPosition>;
  /** Newly introduced deficit rows for this pool's revision. */
  readonly addedDeficits: ReadonlyMap<string, InventoryScopedStockPosition> | undefined;
  /** Signed pool selector used to admit new rows. */
  readonly selector: InventoryStockSelector;
}

/** Apply shared ordered-request changes to one pool without copying unrelated positions. */
function policyPoolAfterPriorRequests({
  pool, changed, addedDeficits, selector,
}: PolicyPoolAfterPriorRequestsInput): InventoryScopedStockPool {
  if (changed.size === 0) return pool;
  const positions: InventoryScopedStockPosition[] = [];
  for (const row of pool.positions) {
    const next = changed.get(inventoryStockPositionIdentity(row.position.key));
    if (next === undefined) {
      positions.push(row);
      continue;
    }
    // Prior requests change balances. The published pool still owns age and expiry.
    const { layerStartedAtEpochMs, ...published } = row;
    positions.push({
      ...published,
      position: next.position,
      ...(next.position.measurements.primary.quantity.amountMinor > 0 && layerStartedAtEpochMs !== undefined
        ? { layerStartedAtEpochMs } : {}),
    });
  }
  for (const row of addedDeficits?.values() ?? []) {
    if (inventoryScopedStockMatches(row.position.key, selector, row.ancestry)) positions.push(row);
  }
  return { positions, reservations: pool.reservations };
}

/** Plan every request against one evolving world and publish one durable event. */
async function commitInventoryPolicyBatch(
  owner: InventoryOnce,
  kind: InventoryPolicyMovementKind,
  original: InventoryOncePolicyBatchInput,
  toPlacementNodeId?: string
): Promise<InventoryOncePolicyBatchResult> {
  const input: InventoryOncePolicyBatchInput = {
    ...snapshotInventoryScopedMovementHeader(original),
    requests: original.requests.map(snapshotInventoryPolicyBatchRequest),
  };
  if (
    kind !== InventoryPolicyMovementKind.Issue &&
    kind !== InventoryPolicyMovementKind.Transfer
  ) {
    throw new Error("Inventory policy batch supports only issue or transfer.");
  }
  const internals = requireInventoryOnceInternals(owner);
  assertInventoryPolicyBatchInput(
    kind,
    input,
    toPlacementNodeId,
    internals.deficitPolicy
  );
  const intentFingerprint = inventoryIntentFingerprint([
    `inventory-policy-batch-${kind}`,
    input.operationId,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
    input.requests.map(policyBatchRequestFingerprint),
    toPlacementNodeId ?? null,
  ]);
  const eventResult = await commitInventoryScopedMovement({
    internals,
    operationId: input.operationId,
    intentFingerprint,
    /** Freeze ordered requests over one published fence and their private signed overlay. */
    plan: async (source, recordedAtEpochMs) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        `${kind} policy batch`
      );
      /** Keep each original pool once even when several requests share a bin and revision. */
      const pools = new Map<string, InventoryScopedStockPool>();
      /** Exact rows changed by earlier requests in this same logical event. */
      const changed = new Map<string, InventoryScopedStockPosition>();
      /** Newly negative rows not present in the original pool, grouped by item revision. */
      const addedDeficits = new Map<string, Map<string, InventoryScopedStockPosition>>();
      const allocations: InventoryOncePolicyBatchAllocation[] = [];
      const selectedLines: InventoryPolicyAllocationLine[] = [];
      const deficitLines: CreateInventoryIssueManyInput["lines"][number][] = [];
      for (const request of input.requests) {
        const selection = resolveAllocationItemAndSelector(
          internals.catalog, request.selector, request.amount, request.itemRevisionId
        );
        const poolSelector = inventoryAllocationPoolSelector(selection);
        const poolId = inventoryStockSelectorIdentity(poolSelector);
        let initialPool = pools.get(poolId);
        if (initialPool === undefined) {
          initialPool = await source.pool(selection);
          pools.set(poolId, initialPool);
        }
        const revisionId = selection.item.revisionId;
        const pool = policyPoolAfterPriorRequests({
          pool: initialPool, changed, addedDeficits: addedDeficits.get(revisionId), selector: poolSelector,
        });
        const allocation = planInventoryAllocationForRecording({
          catalog: internals.catalog,
          selection, pool, amount: request.amount, method: request.method,
          allowMeasuredShortfall: internals.deficitPolicy === InventoryDeficitPolicy.Record,
          atEpochMs: input.occurredAtEpochMs,
          reservationAtEpochMs: recordedAtEpochMs,
          ...(request.allowExpiredLots === undefined ? {} : { allowExpiredLots: request.allowExpiredLots }),
        });
        const currentRows = new Map<string, InventoryScopedStockPosition>();
        for (const row of pool.positions) currentRows.set(inventoryStockPositionIdentity(row.position.key), row);
        const deficit = await policyRecordedDeficit({
          catalog: internals.catalog,
          kind,
          deficitPolicy: internals.deficitPolicy,
          input: policyMovementInputFromBatchRequest(input, request),
          allocation,
          /** A prior pick/deficit takes precedence over the originally published stock row. */
          position: (id) => changed.get(id)?.position ?? currentRows.get(id)?.position ?? source.position(id),
          ancestry: source.ancestry,
        });
        allocations.push(
          policyBatchAllocation(request, allocation.lines, deficit?.evidence)
        );
        for (const line of allocation.lines) selectedLines.push(line);
        for (const line of allocation.lines) {
          const id = inventoryStockPositionIdentity(line.position);
          const row = currentRows.get(id);
          if (row === undefined) throw new Error(`Inventory policy allocation lost position '${id}'.`);
          changed.set(id, {
            ...row,
            position: {
              key: row.position.key,
              measurements: subtractInventoryMeasurements(
                row.position.measurements,
                resolveInventoryAmount(internals.catalog, selection.item, line.amount).measurements
              ),
            },
          });
        }
        if (deficit !== undefined) {
          deficitLines.push(deficit.line);
          const position = deficit.evidence.position;
          const id = inventoryStockPositionIdentity(position);
          const prior = changed.get(id) ?? currentRows.get(id);
          const published = prior?.position ?? await source.position(id);
          const measurements = resolveInventoryAmount(internals.catalog, selection.item, deficit.evidence.amount).measurements;
          const balance = published === undefined
            ? negateInventoryMeasurements(measurements)
            : subtractInventoryMeasurements(published.measurements, measurements);
          // An unwitnessed debit can leave a positive remainder in the
          // existing row. Its original FIFO and expiry facts still apply.
          const deficitRow: InventoryScopedStockPosition = {
            position: { key: position, measurements: balance },
            ancestry: prior?.ancestry ?? (position.placementNodeId === undefined
              ? []
              : await source.ancestry(position.placementNodeId)),
            ...(balance.primary.quantity.amountMinor > 0 && prior?.layerStartedAtEpochMs !== undefined
              ? { layerStartedAtEpochMs: prior.layerStartedAtEpochMs } : {}),
            ...(prior?.effectiveUseByEpochMs === undefined ? {} : { effectiveUseByEpochMs: prior.effectiveUseByEpochMs }),
          };
          changed.set(id, deficitRow);
          if (published === undefined || addedDeficits.get(revisionId)?.has(id)) {
            let revisionDeficits = addedDeficits.get(revisionId);
            if (revisionDeficits === undefined) {
              revisionDeficits = new Map();
              addedDeficits.set(revisionId, revisionDeficits);
            }
            revisionDeficits.set(id, deficitRow);
          }
        }
      }
      return createPolicyBatchMovementEvent(
        internals.catalog, kind, input, allocations, selectedLines, deficitLines, toPlacementNodeId
      );
    },
  });
  const allocations = inventoryPolicyBatchAllocationsFromEvent(
    internals.catalog,
    eventResult.event
  );
  return {
    ...eventResult,
    allocations,
    allocationGroups: inventoryPolicyBatchAllocationGroups(allocations),
  };
}

/** Reject ambiguous request identities and unsafe transfer scopes before writing. */
function assertInventoryPolicyBatchInput(
  kind: InventoryPolicyMovementKind,
  input: InventoryOncePolicyBatchInput,
  toPlacementNodeId: string | undefined,
  deficitPolicy: InventoryDeficitPolicy
): void {
  if (input.requests.length === 0) {
    throw new Error("Inventory policy batch needs at least one request.");
  }
  if (input.metadata?.[inventoryPolicyBatchMetadataKey] !== undefined) {
    throw new Error(
      `Inventory metadata key '${inventoryPolicyBatchMetadataKey}' is reserved for core allocation evidence.`
    );
  }
  const requestIds = new Set<string>();
  for (const request of input.requests) {
    const requestId = request.requestId.trim();
    if (requestId.length === 0 || requestId !== request.requestId) {
      throw new Error(
        "Inventory policy batch requestId must be non-empty and trimmed."
      );
    }
    if (requestIds.has(requestId)) {
      throw new Error(
        `Inventory policy batch repeats requestId '${requestId}'.`
      );
    }
    requestIds.add(requestId);
    const groupId = request.groupId ?? requestId;
    if (groupId.trim().length === 0 || groupId !== groupId.trim()) {
      throw new Error(
        "Inventory policy batch groupId must be non-empty and trimmed."
      );
    }
    assertPolicyMovementRequest(
      kind,
      {
        operationId: input.operationId,
        occurredAtEpochMs: input.occurredAtEpochMs,
        selector: request.selector,
        amount: request.amount,
        method: request.method,
        ...(request.itemRevisionId === undefined
          ? {}
          : { itemRevisionId: request.itemRevisionId }),
        ...(request.allowExpiredLots === undefined
          ? {}
          : { allowExpiredLots: request.allowExpiredLots }),
        ...(request.deficitPosition === undefined
          ? {}
          : { deficitPosition: request.deficitPosition }),
      },
      toPlacementNodeId,
      deficitPolicy
    );
  }
}

/** Stable caller-intent identity for one ordered policy-batch request. */
function policyBatchRequestFingerprint(
  request: InventoryOncePolicyBatchRequest
): string {
  return inventoryIntentFingerprint([
    request.requestId,
    request.groupId ?? request.requestId,
    inventoryStockSelectorIdentity(request.selector),
    inventoryAmountFingerprint(request.amount),
    request.itemRevisionId ?? null,
    request.method,
    request.allowExpiredLots ?? false,
    policyDeficitPositionFingerprint(request.deficitPosition),
  ]);
}

/** Bind one batch request to the shared single-policy shortfall semantics. */
function policyMovementInputFromBatchRequest(
  input: InventoryOncePolicyBatchInput,
  request: InventoryOncePolicyBatchRequest
): InventoryOncePolicyMovementInput {
  return {
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    selector: request.selector,
    amount: request.amount,
    method: request.method,
    ...(request.itemRevisionId === undefined
      ? {}
      : { itemRevisionId: request.itemRevisionId }),
    ...(request.allowExpiredLots === undefined
      ? {}
      : { allowExpiredLots: request.allowExpiredLots }),
    ...(request.deficitPosition === undefined
      ? {}
      : { deficitPosition: request.deficitPosition }),
  };
}

/** Stable intent identity for an optional unallocated deficit position. */
function policyDeficitPositionFingerprint(
  position: InventoryStockPositionInput | undefined
): string | null {
  if (position === undefined) return null;
  const dimensions = [...(position.qualifiedDimensions ?? [])];
  dimensions.sort(
    /** Qualified dimension order is not physical intent. */
    (left, right) => {
      const dimensionOrder = compareInventoryIdentityText(left.dimensionId, right.dimensionId);
      return dimensionOrder === 0
        ? compareInventoryIdentityText(left.valueId, right.valueId)
        : dimensionOrder;
    }
  );
  return inventoryIntentFingerprint([
    position.itemId,
    position.placementNodeId ?? null,
    position.whereaboutsId ?? null,
    position.whereaboutsState ?? null,
    position.lastPlacementNodeId ?? null,
    position.detachedAtEpochMs ?? null,
    position.missingAtEpochMs ?? null,
    position.lotId ?? null,
    position.serialId ?? null,
    position.packagingRevisionId ?? null,
    position.statusId ?? null,
    position.ownerId ?? null,
    position.custodianId ?? null,
    position.dispositionAuthorityId ?? null,
    dimensions.map(
      /** Freeze one exact application-defined physical dimension. */
      (dimension) => [dimension.dimensionId, dimension.valueId]
    ),
  ]);
}

/** Copy planner output into the small public replay-evidence shape. */
function policyBatchAllocation(
  request: InventoryOncePolicyBatchRequest,
  lines: readonly InventoryPolicyAllocationLine[],
  deficit: InventoryOnceRecordedDeficit | undefined
): InventoryOncePolicyBatchAllocation {
  return {
    requestId: request.requestId,
    groupId: request.groupId ?? request.requestId,
    lines: lines.map(
      /** Retain exact amount and source identity without duplicating the full position. */
      (line) => ({
        position: line.position,
        positionIdentity: inventoryStockPositionIdentity(line.position),
        amount: line.amount,
        allocatedPrimary: line.allocatedPrimary,
        layerStartedAtEpochMs: line.layerStartedAtEpochMs,
        ...(line.expiresAtEpochMs === undefined ? {} : { expiresAtEpochMs: line.expiresAtEpochMs }),
      })
    ),
    ...(deficit === undefined ? {} : { deficit }),
  };
}

/** Build one issue/transfer event after combining repeated exact source positions. */
function createPolicyBatchMovementEvent(
  catalog: InventoryCatalog,
  kind: InventoryPolicyMovementKind,
  input: InventoryOncePolicyBatchInput,
  allocations: readonly InventoryOncePolicyBatchAllocation[],
  selectedLines: readonly InventoryPolicyAllocationLine[],
  deficitLines: readonly CreateInventoryIssueManyInput["lines"][number][],
  toPlacementNodeId: string | undefined
): InventoryEventDraft {
  const exactLines = selectedLines.map(policyIssueLine);
  const header: InventoryCommandHeader = {
    ...inventoryCommandHeaderFromPolicyInput(input),
    metadata: {
      ...(input.metadata ?? {}),
      [inventoryPolicyBatchMetadataKey]: policyBatchMetadataValue(allocations),
    },
  };
  if (kind === InventoryPolicyMovementKind.Issue) {
    return createInventoryIssueManyEvent({
      catalog,
      ...header,
      lines: [...exactLines, ...deficitLines],
    });
  }
  if (kind === InventoryPolicyMovementKind.Transfer) {
    if (toPlacementNodeId === undefined) {
      throw new Error("Policy transfer batch lost destination direct placement.");
    }
    const witnessed = exactLines.length === 0 ? undefined : createInventoryTransferManyEvent({
      catalog,
      ...header,
      lines: exactLines.map(
        /** Apply the shared destination after every source allocation is frozen. */
        (line) => ({ ...line, toPlacementNodeId })
      ),
    });
    if (deficitLines.length !== 0) {
      return createInventoryRecordedMovement({
        catalog, header, kind: InventoryEventKind.Transfer, witnessed,
        unknown: deficitLines.map(
          /** Retain each request shortage with the same observed destination. */
          (line) => ({ ...line, toPlacementNodeId })
        ),
      });
    }
    if (witnessed === undefined) throw new Error("Inventory policy transfer batch has no stock effects.");
    return witnessed;
  }
  throw new Error("Inventory policy batch cannot create a scrap event.");
}

/** Encode exact per-request allocations as JSON-safe immutable event metadata. */
function policyBatchMetadataValue(
  allocations: readonly InventoryOncePolicyBatchAllocation[]
): InventoryMetadataValue {
  return {
    version: inventoryPolicyBatchMetadataVersion,
    allocations: allocations.map(
      /** Preserve request order because it determines sequential allocation. */
      (allocation) => ({
        requestId: allocation.requestId,
        groupId: allocation.groupId,
        lines: allocation.lines.map(
          /** Store exact allocation facts needed to recover and verify a replay. */
          (line) => ({
            positionIdentity: line.positionIdentity,
            amount: policyBatchAmountMetadataValue(line.amount),
            allocatedPrimary: policyBatchQuantityMetadataValue(
              line.allocatedPrimary
            ),
            layerStartedAtEpochMs: line.layerStartedAtEpochMs,
            ...(line.expiresAtEpochMs === undefined
              ? {}
              : { expiresAtEpochMs: line.expiresAtEpochMs }),
          })
        ),
        ...(allocation.deficit === undefined
          ? {}
          : { deficit: policyDeficitMetadataValue(allocation.deficit) }),
      })
    ),
  };
}

/** Encode one measured/package amount without undefined metadata values. */
function policyBatchAmountMetadataValue(
  amount: InventoryAmount
): InventoryMetadataValue {
  const independent = amount.independent.map(
    /** Retain one independently measured axis exactly. */
    (measured) => ({
      axisId: measured.axisId,
      value: measured.value,
      unit: measured.unit,
    })
  );
  return amount.kind === InventoryAmountKind.Measured
    ? {
        kind: amount.kind,
        primaryValue: amount.primaryValue,
        primaryUnit: amount.primaryUnit,
        independent,
      }
    : {
        kind: amount.kind,
        count: amount.count,
        packagingRevisionId: amount.packagingRevisionId,
        independent,
      };
}

/** Encode one exact quantity as a JSON-safe object. */
function policyBatchQuantityMetadataValue(
  value: Quantity
): InventoryMetadataValue {
  return {
    amountMinor: value.amountMinor,
    decimals: value.decimals,
    unit: value.unit,
  };
}

/** Recover and verify exact policy allocations from a committed/replayed event. */
function inventoryPolicyBatchAllocationsFromEvent(
  catalog: InventoryCatalog,
  event: InventoryCommittedEvent
): readonly InventoryOncePolicyBatchAllocation[] {
  if (
    event.kind !== InventoryEventKind.Issue &&
    event.kind !== InventoryEventKind.Transfer
  ) {
    throw new Error(
      "Inventory policy batch evidence belongs only to issue/transfer events."
    );
  }
  const root = requirePolicyBatchMetadataRecord(
    event.metadata?.[inventoryPolicyBatchMetadataKey],
    inventoryPolicyBatchMetadataKey
  );
  const version = requirePolicyBatchMetadataNumber(
    root.version,
    "policy batch version"
  );
  if (version !== inventoryPolicyBatchMetadataVersion) {
    throw new Error(
      `Unsupported inventory policy batch metadata version '${version}'.`
    );
  }
  const values = requirePolicyBatchMetadataArray(
    root.allocations,
    "policy batch allocations"
  );
  const allocations: InventoryPolicyBatchAllocationEvidence[] = [];
  const requestIds = new Set<string>();
  for (const value of values) {
    const record = requirePolicyBatchMetadataRecord(
      value,
      "policy batch allocation"
    );
    const requestId = requirePolicyBatchMetadataString(
      record.requestId,
      "policy batch requestId"
    );
    if (requestIds.has(requestId)) {
      throw new Error(
        `Inventory policy batch evidence repeats requestId '${requestId}'.`
      );
    }
    requestIds.add(requestId);
    const groupId = requirePolicyBatchMetadataString(
      record.groupId,
      "policy batch groupId"
    );
    const lineValues = requirePolicyBatchMetadataArray(
      record.lines,
      `policy batch '${requestId}' lines`
    );
    const lines: InventoryPolicyBatchAllocationEvidenceLine[] = [];
    for (const lineValue of lineValues) {
      const line = requirePolicyBatchMetadataRecord(
        lineValue,
        `policy batch '${requestId}' line`
      );
      lines.push({
        positionIdentity: requirePolicyBatchMetadataString(
          line.positionIdentity,
          "policy batch positionIdentity"
        ),
        amount: policyBatchAmountFromMetadata(line.amount),
        allocatedPrimary: policyBatchQuantityFromMetadata(
          line.allocatedPrimary
        ),
        layerStartedAtEpochMs: requirePolicyBatchEpochMilliseconds(
          line.layerStartedAtEpochMs,
          "policy batch layerStartedAtEpochMs"
        ),
        ...(line.expiresAtEpochMs === undefined
          ? {}
          : {
              expiresAtEpochMs: requirePolicyBatchEpochMilliseconds(
                line.expiresAtEpochMs,
                "policy batch expiresAtEpochMs"
              ),
            }),
      });
    }
    const deficit =
      record.deficit === undefined
        ? undefined
        : policyBatchDeficitFromMetadata(record.deficit);
    if (lines.length === 0 && deficit === undefined) {
      throw new Error(
        `Inventory policy batch '${requestId}' has no allocation or deficit evidence.`
      );
    }
    allocations.push({
      requestId,
      groupId,
      lines,
      ...(deficit === undefined ? {} : { deficit }),
    });
  }
  if (allocations.length === 0) {
    throw new Error("Inventory policy batch evidence has no requests.");
  }
  assertPolicyBatchEvidenceMatchesEvent(catalog, event, allocations);
  return enrichPolicyBatchAllocationPositions(event, allocations);
}

/** Decode one exact recorded-deficit evidence object from immutable metadata. */
function policyBatchDeficitFromMetadata(
  value: InventoryMetadataValue
): InventoryPolicyBatchDeficitEvidence {
  const record = requirePolicyBatchMetadataRecord(
    value,
    "policy batch deficit"
  );
  const version = requirePolicyBatchMetadataNumber(
    record.version,
    "policy batch deficit version"
  );
  if (version !== inventoryPolicyDeficitMetadataVersion) {
    throw new Error(
      `Unsupported inventory policy deficit metadata version '${version}'.`
    );
  }
  return {
    positionIdentity: requirePolicyBatchMetadataString(
      record.positionIdentity,
      "policy batch deficit positionIdentity"
    ),
    amount: policyBatchAmountFromMetadata(record.amount),
    primary: policyBatchQuantityFromMetadata(record.primary),
  };
}

/** Recover and verify one single-request policy deficit from immutable event evidence. */
function inventoryPolicyDeficitFromEvent(
  catalog: InventoryCatalog,
  event: InventoryCommittedEvent
): InventoryOnceRecordedDeficit | undefined {
  const encoded = event.metadata?.[inventoryPolicyDeficitMetadataKey];
  if (encoded === undefined) return undefined;
  if (event.kind !== InventoryEventKind.Issue && event.unwitnessedStockMovements === undefined) {
    throw new Error("Inventory policy deficit needs an Issue or an unwitnessed movement.");
  }
  const evidence = policyBatchDeficitFromMetadata(encoded);
  const effect = event.stockEffects.find(
    /** Find the exact signed source effect named by durable deficit evidence. */
    (candidate) =>
      candidate.measurementsDelta.primary.quantity.amountMinor < 0 &&
      inventoryStockPositionIdentity(candidate.position) ===
        evidence.positionIdentity
  );
  if (effect === undefined) {
    throw new Error(
      `Inventory policy deficit references non-source position '${evidence.positionIdentity}'.`
    );
  }
  const item = catalog.itemRevision(effect.itemRevisionId);
  const resolved = resolveInventoryAmount(
    catalog,
    item,
    evidence.amount
  ).measurements;
  if (!quantityEq(resolved.primary.quantity, evidence.primary)) {
    throw new Error(
      `Inventory policy deficit primary evidence disagrees at '${evidence.positionIdentity}'.`
    );
  }
  const unwitnessed = event.unwitnessedStockMovements?.[0];
  if (unwitnessed !== undefined &&
      inventoryStockPositionIdentity(unwitnessed.from) !== evidence.positionIdentity) {
    throw new Error("Inventory policy shortfall disagrees with its unwitnessed source.");
  }
  if (
    !inventoryMeasurementsEqual(
      resolved,
      unwitnessed?.measurements ?? negateInventoryMeasurements(effect.measurementsDelta)
    )
  ) {
    throw new Error(
      `Inventory policy deficit evidence does not match source effect '${evidence.positionIdentity}'.`
    );
  }
  return {
    position: effect.position,
    amount: evidence.amount,
    primary: evidence.primary,
  };
}

/** Attach exact event source positions after compact allocation evidence is verified. */
function enrichPolicyBatchAllocationPositions(
  event: InventoryCommittedEvent,
  allocations: readonly InventoryPolicyBatchAllocationEvidence[]
): readonly InventoryOncePolicyBatchAllocation[] {
  const sourcePositions = new Map<string, InventoryStockPositionKey>();
  for (const effect of event.stockEffects) {
    if (effect.measurementsDelta.primary.quantity.amountMinor >= 0) continue;
    sourcePositions.set(
      inventoryStockPositionIdentity(effect.position),
      effect.position
    );
  }
  return allocations.map(
    /** Enrich one request with the exact validated event source positions. */
    (allocation) => ({
      requestId: allocation.requestId,
      groupId: allocation.groupId,
      lines: allocation.lines.map(
        /** Recover one exact source position already proven by the partition check. */
        (line) => {
          const position = sourcePositions.get(line.positionIdentity);
          if (position === undefined) {
            throw new Error(
              `Inventory policy batch lost source position '${line.positionIdentity}' after validation.`
            );
          }
          return { ...line, position };
        }
      ),
      ...(allocation.deficit === undefined
        ? {}
        : {
            deficit: {
              amount: allocation.deficit.amount,
              primary: allocation.deficit.primary,
              position: requirePolicyBatchSourcePosition(
                sourcePositions,
                allocation.deficit.positionIdentity
              ),
            },
          }),
    })
  );
}

/** Require one exact negative source position retained by batch evidence. */
function requirePolicyBatchSourcePosition(
  sourcePositions: ReadonlyMap<string, InventoryStockPositionKey>,
  positionIdentity: string
): InventoryStockPositionKey {
  const position = sourcePositions.get(positionIdentity);
  if (position === undefined) {
    throw new Error(
      `Inventory policy batch lost source position '${positionIdentity}' after validation.`
    );
  }
  return position;
}

/** Regroup exact request allocations by stable caller result identity. */
function inventoryPolicyBatchAllocationGroups(
  allocations: readonly InventoryOncePolicyBatchAllocation[]
): readonly InventoryOncePolicyBatchAllocationGroup[] {
  const groups = new Map<string, InventoryOncePolicyBatchAllocationGroup>();
  for (const allocation of allocations) {
    const current = groups.get(allocation.groupId);
    groups.set(
      allocation.groupId,
      current === undefined
        ? {
            groupId: allocation.groupId,
            requestIds: [allocation.requestId],
            lines: allocation.lines,
          }
        : {
            groupId: current.groupId,
            requestIds: [...current.requestIds, allocation.requestId],
            lines: [...current.lines, ...allocation.lines],
          }
    );
  }
  return [...groups.values()];
}

/** Decode one exact measured/package amount from immutable metadata. */
function policyBatchAmountFromMetadata(
  value: InventoryMetadataValue | undefined
): InventoryAmount {
  const record = requirePolicyBatchMetadataRecord(value, "policy batch amount");
  const kind = requirePolicyBatchMetadataString(
    record.kind,
    "policy batch amount kind"
  );
  const independentValues = requirePolicyBatchMetadataArray(
    record.independent,
    "policy batch independent amounts"
  );
  const independent = independentValues.map(
    /** Decode and validate one independent amount axis. */
    (independentValue) => {
      const measured = requirePolicyBatchMetadataRecord(
        independentValue,
        "policy batch independent amount"
      );
      return {
        axisId: requirePolicyBatchMetadataString(
          measured.axisId,
          "policy batch independent axisId"
        ),
        value: requirePolicyBatchMetadataString(
          measured.value,
          "policy batch independent value"
        ),
        unit: requirePolicyBatchMetadataString(
          measured.unit,
          "policy batch independent unit"
        ),
      };
    }
  );
  if (kind === InventoryAmountKind.Measured) {
    return measuredStockAmount(
      requirePolicyBatchMetadataString(
        record.primaryValue,
        "policy batch primaryValue"
      ),
      requirePolicyBatchMetadataString(
        record.primaryUnit,
        "policy batch primaryUnit"
      ),
      independent
    );
  }
  if (kind === InventoryAmountKind.Package) {
    return packageAmount(
      requirePolicyBatchMetadataNumber(
        record.count,
        "policy batch package count"
      ),
      requirePolicyBatchMetadataString(
        record.packagingRevisionId,
        "policy batch packagingRevisionId"
      ),
      independent
    );
  }
  throw new Error(`Unknown inventory policy batch amount kind '${kind}'.`);
}

/** Decode one exact positive quantity from immutable metadata. */
function policyBatchQuantityFromMetadata(
  value: InventoryMetadataValue | undefined
): Quantity {
  const record = requirePolicyBatchMetadataRecord(
    value,
    "policy batch quantity"
  );
  const result = quantity({
    amountMinor: requirePolicyBatchMetadataNumber(
      record.amountMinor,
      "policy batch quantity amountMinor"
    ),
    decimals: requirePolicyBatchMetadataNumber(
      record.decimals,
      "policy batch quantity decimals"
    ),
    unit: requirePolicyBatchMetadataString(
      record.unit,
      "policy batch quantity unit"
    ),
  });
  if (result.amountMinor <= 0) {
    throw new Error(
      "Inventory policy batch allocated quantity must be positive."
    );
  }
  return result;
}

/** Prove retained request evidence partitions every exact negative source effect. */
function assertPolicyBatchEvidenceMatchesEvent(
  catalog: InventoryCatalog,
  event: InventoryCommittedEvent,
  allocations: readonly InventoryPolicyBatchAllocationEvidence[]
): void {
  const sourceEffects = new Map<string, InventoryStockEffect>();
  for (const effect of event.stockEffects) {
    if (effect.measurementsDelta.primary.quantity.amountMinor >= 0) continue;
    sourceEffects.set(inventoryStockPositionIdentity(effect.position), effect);
  }
  const allocatedByPosition = new Map<string, InventoryMeasurementTotals>();
  /** Preserve each exact source partition until the complete evidence has been read. */
  const addPart = (positionIdentity: string, part: InventoryMeasurementVector): void => {
    let totals = allocatedByPosition.get(positionIdentity);
    if (totals === undefined) {
      totals = new Map();
      allocatedByPosition.set(positionIdentity, totals);
    }
    addInventoryMeasurementTotals(totals, part);
  };
  for (const allocation of allocations) {
    for (const line of allocation.lines) {
      const effect = sourceEffects.get(line.positionIdentity);
      if (effect === undefined) {
        throw new Error(
          `Inventory policy batch evidence references non-source position '${line.positionIdentity}'.`
        );
      }
      const item = catalog.itemRevision(effect.itemRevisionId);
      const resolved = resolveInventoryAmount(
        catalog,
        item,
        line.amount
      ).measurements;
      if (!quantityEq(resolved.primary.quantity, line.allocatedPrimary)) {
        throw new Error(
          `Inventory policy batch primary evidence disagrees at '${line.positionIdentity}'.`
        );
      }
      addPart(line.positionIdentity, resolved);
    }
    if (allocation.deficit !== undefined) {
      const effect = sourceEffects.get(allocation.deficit.positionIdentity);
      if (effect === undefined) {
        throw new Error(
          `Inventory policy batch deficit references non-source position '${allocation.deficit.positionIdentity}'.`
        );
      }
      const item = catalog.itemRevision(effect.itemRevisionId);
      const resolved = resolveInventoryAmount(
        catalog,
        item,
        allocation.deficit.amount
      ).measurements;
      if (!quantityEq(resolved.primary.quantity, allocation.deficit.primary)) {
        throw new Error(
          `Inventory policy batch deficit primary evidence disagrees at '${allocation.deficit.positionIdentity}'.`
        );
      }
      addPart(allocation.deficit.positionIdentity, resolved);
    }
  }
  for (const [positionIdentity, effect] of sourceEffects) {
    const allocated = allocatedByPosition.get(positionIdentity);
    if (
      allocated === undefined ||
      !inventoryMeasurementsEqual(
        materializeInventoryMeasurementTotals(allocated, effect.measurementsDelta.primary.axisId),
        negateInventoryMeasurements(effect.measurementsDelta)
      )
    ) {
      throw new Error(
        `Inventory policy batch evidence does not exactly partition source '${positionIdentity}'.`
      );
    }
  }
  if (allocatedByPosition.size !== sourceEffects.size) {
    throw new Error(
      "Inventory policy batch evidence contains unmatched source positions."
    );
  }
}

/** Narrow one recursive metadata value to a plain record. */
function requirePolicyBatchMetadataRecord(
  value: InventoryMetadataValue | undefined,
  field: string
): InventoryMetadata {
  if (!isPolicyBatchMetadataRecord(value)) {
    throw new Error(`Inventory ${field} must be an object.`);
  }
  return value;
}

/** Recognize the object branch of recursive JSON-safe metadata. */
function isPolicyBatchMetadataRecord(
  value: InventoryMetadataValue | undefined
): value is InventoryMetadata {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

/** Narrow one recursive metadata value to an array. */
function requirePolicyBatchMetadataArray(
  value: InventoryMetadataValue | undefined,
  field: string
): readonly InventoryMetadataValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`Inventory ${field} must be an array.`);
  }
  return value;
}

/** Narrow one recursive metadata value to a finite number. */
function requirePolicyBatchMetadataNumber(
  value: InventoryMetadataValue | undefined,
  field: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Inventory ${field} must be a finite number.`);
  }
  return value;
}

/** Narrow one recursive metadata value to a non-empty string. */
function requirePolicyBatchMetadataString(
  value: InventoryMetadataValue | undefined,
  field: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Inventory ${field} must be a non-empty string.`);
  }
  return value;
}

/** Plan and commit one policy movement against the same world revision it selects from. */
async function commitInventoryPolicyMovement(
  owner: InventoryOnce,
  kind: InventoryPolicyMovementKind,
  original: InventoryOncePolicyMovementInput,
  toPlacementNodeId?: string
): Promise<InventoryOnceEventResult> {
  const input = snapshotInventoryPolicyMovement(original);
  const internals = requireInventoryOnceInternals(owner);
  assertPolicyMovementRequest(
    kind,
    input,
    toPlacementNodeId,
    internals.deficitPolicy
  );
  const intentFingerprint = inventoryIntentFingerprint([
    `inventory-policy-${kind}`,
    input.operationId,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
    inventoryStockSelectorIdentity(input.selector),
    inventoryAmountFingerprint(input.amount),
    input.itemRevisionId ?? null,
    input.method,
    input.allowExpiredLots ?? false,
    input.allowAllocatedStock ?? false,
    policyDeficitPositionFingerprint(input.deficitPosition),
    toPlacementNodeId ?? null,
  ]);
  const eventResult = await commitInventoryScopedMovement({
    internals,
    operationId: input.operationId,
    intentFingerprint,
    /** Derive the exact movement legs from one published signed pool. */
    plan: async (source, recordedAtEpochMs) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        `${kind} policy movement`
      );
      const selection = resolveAllocationItemAndSelector(
        internals.catalog, input.selector, input.amount, input.itemRevisionId
      );
      const pool = await source.pool(selection);
      const allocation = planInventoryAllocationForRecording({
        catalog: internals.catalog,
        selection, pool, amount: input.amount, method: input.method,
        allowMeasuredShortfall: internals.deficitPolicy === InventoryDeficitPolicy.Record,
        atEpochMs: input.occurredAtEpochMs,
        reservationAtEpochMs: recordedAtEpochMs,
        ...(input.allowExpiredLots === undefined
          ? {}
          : { allowExpiredLots: input.allowExpiredLots }),
        ...(input.allowAllocatedStock === undefined
          ? {}
          : { allowAllocatedStock: input.allowAllocatedStock }),
      });
      const deficit = await policyRecordedDeficit({
        catalog: internals.catalog,
        kind,
        deficitPolicy: internals.deficitPolicy,
        input,
        allocation,
        position: source.position,
        ancestry: source.ancestry,
      });
      return createPolicyMovementEvent(
        internals.catalog, kind, input, allocation.lines, toPlacementNodeId, deficit
      );
    },
  });
  const deficit = inventoryPolicyDeficitFromEvent(
    internals.catalog,
    eventResult.event
  );
  return {
    ...eventResult,
    ...(deficit === undefined ? {} : { deficit }),
  };
}

/** Prefer stock free of exact holds, then use actual held stock if it covers more of the physical report. */
function planInventoryAllocationForRecording(
  input: PlanInventoryAllocationInPoolInput
): InventoryPolicyAllocationPlan {
  const preferred = planInventoryAllocationInPool({
    ...input,
    recordingAttempt: input.allowAllocatedStock ? "all-physical" : "prefer-unheld",
  });
  const measured = input.amount.independent.length !== 0;
  const item = input.selection.item;
  /** Calculate the remaining reported axes for one measured witness plan. */
  const remainderOf = (plan: InventoryPolicyAllocationPlan): InventoryMeasurementVector | undefined =>
    inventoryPolicyMovementRemainder({
      catalog: input.catalog, item, report: plan.requestedMeasurements, lines: plan.lines,
    });
  let selected = preferred;
  let residual = measured ? remainderOf(preferred) : undefined;
  if (!input.allowAllocatedStock && (preferred.shortfall.amountMinor !== 0 ||
    (measured && residual === undefined))) {
    const physical = planInventoryAllocationInPool({
      ...input, allowAllocatedStock: true, recordingAttempt: "all-physical",
    });
    const physicalResidual = measured ? remainderOf(physical) : undefined;
    // A coherent partial witness is better than a fuller count that contradicts the report.
    if ((!measured || physicalResidual !== undefined) &&
        ((measured && residual === undefined) ||
          compareQuantity(physical.shortfall, preferred.shortfall) < 0)) {
      selected = physical;
      residual = physicalResidual;
    }
  }
  if (!measured) return selected;
  if (residual === undefined) {
    throw new Error("Reported physical movement remainder cannot exactly match its witnessed axes.");
  }
  if (inventoryMeasurementsAreZero(residual)) return selected;
  const position = {
    itemId: item.itemId,
    itemRevisionId: item.revisionId,
    ...(input.amount.kind === InventoryAmountKind.Package
      ? { packagingRevisionId: input.amount.packagingRevisionId }
      : {}),
  };
  return { ...selected, shortfallAmount: transferAmountForVector(input.catalog, position, residual) };
}

/** Reject unsafe policy combinations before planning or writing. */
function assertPolicyMovementRequest(
  kind: InventoryPolicyMovementKind,
  input: InventoryOncePolicyMovementInput,
  toPlacementNodeId: string | undefined,
  deficitPolicy: InventoryDeficitPolicy
): void {
  if (input.reservationId !== undefined) {
    throw new Error(
      "Policy stock movement cannot consume a reservation implicitly; allocate/consume it explicitly."
    );
  }
  if (
    input.metadata?.[inventoryPolicyBatchMetadataKey] !== undefined ||
    input.metadata?.[inventoryPolicyDeficitMetadataKey] !== undefined
  ) {
    throw new Error(
      "Inventory policy metadata cannot replace core allocation/deficit evidence."
    );
  }
  if (
    input.deficitPosition !== undefined &&
    deficitPolicy !== InventoryDeficitPolicy.Record
  ) {
    throw new Error(
      "Inventory deficitPosition is accepted only under Record mode."
    );
  }
  if (kind !== InventoryPolicyMovementKind.Issue && input.deficitPosition?.lotId !== undefined) {
    throw new Error("Unwitnessed stock cannot name a source lot.");
  }
  if (input.deficitPosition?.serialId !== undefined) {
    throw new Error(
      "Recorded inventory deficit cannot claim a physical serial."
    );
  }
  if (
    kind !== InventoryPolicyMovementKind.Scrap &&
    input.allowAllocatedStock === true
  ) {
    throw new Error(
      "Only explicit physical scrap may select already-allocated stock."
    );
  }
  if (kind === InventoryPolicyMovementKind.Transfer) {
    if (toPlacementNodeId === undefined || toPlacementNodeId.trim().length === 0) {
      throw new Error("Policy transfer needs toPlacementNodeId.");
    }
    const selector = normalizeInventoryStockSelector(input.selector);
    if (selector.placementNodeIds?.length !== 1) {
      throw new Error(
        "Policy transfer selector must name exactly one source direct placement."
      );
    }
    if (selector.placementNodeIds[0] === toPlacementNodeId) {
      throw new Error(
        "Policy transfer source/destination direct placements must differ."
      );
    }
  }
  if (
    kind === InventoryPolicyMovementKind.Scrap &&
    (input.reason ?? "").trim().length === 0
  ) {
    throw new Error("Policy scrap needs an explicit reason.");
  }
}

/** Fail closed instead of inventing negative/untracked stock on policy shortfall. */
function assertPolicyAllocationComplete(
  plan: InventoryPolicyAllocationPlan
): void {
  if (plan.shortfall.amountMinor === 0) return;
  const shortfall = `${quantityToDecimalString(plan.shortfall)} ${
    plan.shortfall.unit
  }`;
  if (plan.expiredStockWasExcluded) {
    throw new Error(
      `Inventory policy has ${shortfall} shortfall after excluding expired stock; explicitly allow expired lots to use them.`
    );
  }
  if (plan.allocationConstraintBlockedStock) {
    throw new Error(
      `Inventory policy has ${shortfall} shortfall because every exact assignment violates current operation constraints.`
    );
  }
  if (plan.incrementBlockedStock) {
    throw new Error(
      `Inventory policy has ${shortfall} shortfall because intact package/serial increments cannot be split; unpack or select exact lines.`
    );
  }
  throw new Error(
    `Inventory policy has insufficient eligible stock (${shortfall} shortfall).`
  );
}

/** Inputs for deciding whether one policy shortfall becomes durable deficit. */
interface PolicyRecordedDeficitInput {
  /** Frozen catalogue used to resolve amount/package/position identity. */
  readonly catalog: InventoryCatalog;
  /** Physical policy verb. */
  readonly kind: InventoryPolicyMovementKind;
  /** Configured ordinary negative-stock rule. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Caller command including optional explicit deficit position. */
  readonly input: InventoryOncePolicyMovementInput;
  /** Exact native allocation/shortfall result. */
  readonly allocation: InventoryPolicyAllocationPlan;
  /** Look up the dedicated Issue deficit position before assigning a signed liability. */
  readonly position: InventoryPolicyStockSource["position"];
  /** Resolve exact placement ancestry from the signed planning view. */
  readonly ancestry: InventoryPolicyStockSource["ancestry"];
}

/** Resolve the exact signed source for a recordable physical shortfall. */
async function policyRecordedDeficit({
  catalog,
  kind,
  deficitPolicy,
  input,
  allocation,
  position: readPosition,
  ancestry: readAncestry,
}: PolicyRecordedDeficitInput): Promise<InventoryPolicyRecordedDeficit | undefined> {
  if (allocation.shortfall.amountMinor === 0) return undefined;
  if (deficitPolicy !== InventoryDeficitPolicy.Record) {
    assertPolicyAllocationComplete(allocation);
    return undefined;
  }
  const unwitnessed = kind !== InventoryPolicyMovementKind.Issue;
  const serial = allocation.selector.serial;
  if (unwitnessed && serial !== undefined && serial.kind !== InventoryOptionalIdentityConstraintKind.Absent) {
    throw new Error("Unwitnessed stock cannot claim a serial identity.");
  }
  assertPolicyShortfallIsRecordable(allocation);
  const amount = allocation.shortfallAmount;
  if (amount === undefined) {
    throw new Error(
      "Inventory policy shortfall lost its exact deficit amount."
    );
  }
  const item = catalog.itemRevision(allocation.itemRevisionId);
  const from = resolvePolicyDeficitPosition(
    input.deficitPosition,
    allocation.selector,
    item,
    unwitnessed
  );
  const resolved = resolveInventoryAmount(catalog, item, amount);
  const packagingRevisionId = resolved.packaging?.revisionId;
  if (from.packagingRevisionId !== undefined && from.packagingRevisionId !== packagingRevisionId) {
    throw new Error("Inventory policy deficit position packaging revision differs from its amount.");
  }
  const position = normalizeInventoryStockPositionKey({
    ...from,
    itemRevisionId: item.revisionId,
    ...(packagingRevisionId === undefined ? {} : { packagingRevisionId }),
  });
  assertPositionMatchesItem(item, position);
  const placementScope = inventoryRecordedDeficitPoolSelector(allocation.selector, item.revisionId);
  const ancestry = placementScope.withinPlacementNodeIds === undefined || position.placementNodeId === undefined
    ? []
    : await readAncestry(position.placementNodeId);
  if (!inventoryScopedStockMatches(position, placementScope, ancestry)) {
    throw new Error("Inventory policy deficit position is outside the selected placement scope or whereabouts.");
  }
  // Policy Issue uses a dedicated deficit bucket. Transfer and scrap use
  // the unlabelled stock key itself, so their signed posting may settle there.
  if (!unwitnessed) {
    const existing = await readPosition(inventoryStockPositionIdentity(position));
    if (existing !== undefined && existing.measurements.primary.quantity.amountMinor > 0) {
      throw new Error("Inventory policy deficit position currently contains allocatable physical stock.");
    }
  }
  const { itemRevisionId, ...exactFrom } = position;
  return {
    line: {
      from: exactFrom,
      itemRevisionId,
      amount,
    },
    evidence: {
      position,
      amount,
      primary: allocation.shortfall,
    },
  };
}

/** Resolve one unallocated deficit position without pretending it is a selected lot/serial identity. */
function resolvePolicyDeficitPosition(
  explicit: InventoryStockPositionInput | undefined,
  selector: InventoryStockSelector,
  item: InventoryItemDefinitionRevision,
  unwitnessed: boolean
): InventoryStockPositionInput {
  const normalizedSelector = normalizeInventoryStockSelector(selector);
  if (explicit !== undefined) {
    if (explicit.itemId !== item.itemId) {
      throw new Error(
        "Inventory policy deficit position belongs to another item."
      );
    }
    if (explicit.serialId !== undefined) {
      throw new Error(
        "Recorded inventory deficit cannot claim a physical serial."
      );
    }
    return explicit;
  }
  if (normalizedSelector.placementNodeIds?.length !== 1) {
    throw new Error(
      "Record policy shortfall needs exactly one selected direct placement or an explicit deficitPosition."
    );
  }
  const placementNodeId = normalizedSelector.placementNodeIds[0];
  if (placementNodeId === undefined) {
    throw new Error("Inventory policy deficit lost its selected direct placement.");
  }
  return {
    itemId: item.itemId,
    placementNodeId,
    ...(unwitnessed ? {} : { lotId: INVENTORY_RECORDED_DEFICIT_LOT_ID }),
  };
}

/** Encode one recorded shortfall as immutable JSON-safe event evidence. */
function policyDeficitMetadataValue(
  deficit: InventoryOnceRecordedDeficit
): InventoryMetadataValue {
  return {
    version: inventoryPolicyDeficitMetadataVersion,
    positionIdentity: inventoryStockPositionIdentity(deficit.position),
    amount: policyBatchAmountMetadataValue(deficit.amount),
    primary: policyBatchQuantityMetadataValue(deficit.primary),
  };
}

/** Preserve ambiguity errors while allowing only genuine lack of stock to become deficit. */
function assertPolicyShortfallIsRecordable(
  allocation: InventoryPolicyAllocationPlan
): void {
  if (allocation.expiredStockWasExcluded) {
    assertPolicyAllocationComplete(allocation);
  }
  if (allocation.allocationConstraintBlockedStock) {
    assertPolicyAllocationComplete(allocation);
  }
  if (allocation.incrementBlockedStock) {
    assertPolicyAllocationComplete(allocation);
  }
}

/** Build one normal multi-line event from native policy output. */
function createPolicyMovementEvent(
  catalog: InventoryCatalog,
  kind: InventoryPolicyMovementKind,
  input: InventoryOncePolicyMovementInput,
  lines: readonly InventoryPolicyAllocationLine[],
  toPlacementNodeId: string | undefined,
  deficit: InventoryPolicyRecordedDeficit | undefined
): InventoryEventDraft {
  const header = inventoryCommandHeaderFromPolicyInput(input);
  if (kind === InventoryPolicyMovementKind.Issue) {
    return createInventoryIssueManyEvent({
      catalog,
      ...header,
      metadata: {
        ...(header.metadata ?? {}),
        ...(deficit === undefined
          ? {}
          : {
              [inventoryPolicyDeficitMetadataKey]: policyDeficitMetadataValue(
                deficit.evidence
              ),
            }),
      },
      lines: [...lines.map(policyIssueLine), ...(deficit === undefined ? [] : [deficit.line])],
    });
  }
  const eventKind = kind === InventoryPolicyMovementKind.Transfer
    ? InventoryEventKind.Transfer
    : InventoryEventKind.Scrap;
  const witnessed = lines.length === 0 ? undefined : createWitnessedPolicyMovement(
    catalog, header, kind, lines, toPlacementNodeId
  );
  if (deficit !== undefined) {
    return createInventoryRecordedMovement({
      catalog,
      header: {
        ...header,
        metadata: {
          ...(header.metadata ?? {}),
          [inventoryPolicyDeficitMetadataKey]: policyDeficitMetadataValue(deficit.evidence),
        },
      },
      kind: eventKind,
      witnessed,
      unknown: [{
        ...deficit.line,
        ...(toPlacementNodeId === undefined ? {} : { toPlacementNodeId }),
      }],
    });
  }
  if (witnessed === undefined) throw new Error("Inventory policy movement has no stock effects.");
  return witnessed;
}

/** Build the witnessed portion with the checked ordinary physical builders. */
function createWitnessedPolicyMovement(
  catalog: InventoryCatalog,
  header: InventoryCommandHeader,
  kind: InventoryPolicyMovementKind,
  lines: readonly InventoryPolicyAllocationLine[],
  toPlacementNodeId: string | undefined
): InventoryEventDraft {
  if (kind === InventoryPolicyMovementKind.Transfer) {
    if (toPlacementNodeId === undefined) {
      throw new Error("Policy transfer lost destination direct placement.");
    }
    return createInventoryTransferManyEvent({
      catalog,
      ...header,
      lines: lines.map(
        /** Apply one destination while keeping the exact witnessed identity and FIFO evidence. */
        (line) => ({ ...policyIssueLine(line), toPlacementNodeId })
      ),
    });
  }
  return createInventoryScrapManyEvent({ catalog, ...header, lines: lines.map(policyIssueLine) });
}

/** Strip allocation-only fields while retaining the normal immutable command header. */
function inventoryCommandHeaderFromPolicyInput(
  input: InventoryCommandHeader
): InventoryCommandHeader {
  return {
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

/** Freeze the documented header fields before awaiting native planning reads. */
function snapshotInventoryScopedMovementHeader(input: InventoryCommandHeader): InventoryCommandHeader {
  const { metadata, ...header } = inventoryCommandHeaderFromPolicyInput(input);
  return metadata === undefined ? header : { ...header, metadata: structuredClone(metadata) };
}

/** Capture the typed policy command without copying application-owned extensions. */
function snapshotInventoryPolicyMovement(input: InventoryOncePolicyMovementInput): InventoryOncePolicyMovementInput {
  return {
    ...snapshotInventoryScopedMovementHeader(input),
    ...snapshotInventoryAllocationRequest(input),
    ...(input.deficitPosition === undefined ? {} : { deficitPosition: snapshotInventoryPolicyDeficitPosition(input.deficitPosition) }),
  };
}

/** Freeze public selection, amount, and options without forwarding internal planner options. */
function snapshotInventoryAllocationRequest(input: InventoryAllocationPolicyRequest): InventoryAllocationPolicyRequest {
  return {
    selector: normalizeInventoryStockSelector(input.selector),
    amount: snapshotInventoryPolicyAmount(input.amount),
    method: input.method,
    ...(input.itemRevisionId === undefined ? {} : { itemRevisionId: input.itemRevisionId }),
    ...(input.allowExpiredLots === undefined ? {} : { allowExpiredLots: input.allowExpiredLots }),
    ...(input.allowAllocatedStock === undefined ? {} : { allowAllocatedStock: input.allowAllocatedStock }),
    ...(input.reservationId === undefined ? {} : { reservationId: input.reservationId }),
  };
}

/** Convert one policy selection to a normal exact issue/scrap/transfer source line. */
function policyIssueLine(
  line: InventoryPolicyAllocationLine
): CreateInventoryIssueManyInput["lines"][number] {
  const { itemRevisionId, ...from } = line.position;
  return {
    from,
    amount: line.amount,
    itemRevisionId,
    metadata: {
      allocationLayerStartedAtEpochMs: line.layerStartedAtEpochMs,
      ...(line.expiresAtEpochMs === undefined
        ? {}
        : { allocationLotExpiresAtEpochMs: line.expiresAtEpochMs }),
    },
  };
}

/** Return the exact destination after changing one configured extra dimension and nothing else. */
function createPositionWithChangedQualifiedDimension(
  input: Omit<InventoryOnceChangeQualifiedDimensionInput, "operationId">
): InventoryStockPositionInput {
  const from = requireStockPositionInput(input.from, "change qualified dimension");
  const dimensions = [...(from.qualifiedDimensions ?? [])];
  let replaced = false;
  for (let index = 0; index < dimensions.length; index += 1) {
    const dimension = dimensions[index];
    if (dimension?.dimensionId !== input.dimensionId) continue;
    if (dimension.valueId === input.toValueId) {
      throw new Error(
        `Qualified dimension '${input.dimensionId}' already has that value.`
      );
    }
    dimensions[index] = {
      dimensionId: input.dimensionId,
      valueId: input.toValueId,
    };
    replaced = true;
    break;
  }
  if (!replaced) {
    dimensions.push({
      dimensionId: input.dimensionId,
      valueId: input.toValueId,
    });
  }
  return {
    ...from,
    qualifiedDimensions: dimensions,
  };
}

/** Return the exact destination after removing one currently present extra dimension. */
function createPositionWithoutQualifiedDimension(
  input: Omit<InventoryOnceClearQualifiedDimensionInput, "operationId">
): InventoryStockPositionInput {
  const from = requireStockPositionInput(input.from, "clear qualified dimension");
  const { qualifiedDimensions, ...withoutQualifiedDimensions } = from;
  const dimensions = qualifiedDimensions ?? [];
  const kept = dimensions.filter(
    /** Keep every configured value except the one this verb explicitly removes. */
    (dimension) => dimension.dimensionId !== input.dimensionId
  );
  if (kept.length === dimensions.length) {
    throw new Error(
      `Stock has no qualified dimension '${input.dimensionId}' to remove.`
    );
  }
  return kept.length === 0
    ? withoutQualifiedDimensions
    : { ...withoutQualifiedDimensions, qualifiedDimensions: kept };
}

/** Require one position-shaped source before a reclassification helper reads its fields. */
function requireStockPositionInput(
  value: InventoryStockPositionInput | null | undefined,
  label: string
): InventoryStockPositionInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Inventory ${label} needs a source position.`);
  }
  return value;
}

/** Require a target dimension identity to differ and be non-empty. */
function requireChangedIdentity(
  earlier: string | undefined,
  next: string,
  label: string
): string {
  if (typeof next !== "string" || next.trim().length === 0)
    throw new Error(`New ${label} identity must not be empty.`);
  if (earlier === next) throw new Error(`Stock already has that ${label}.`);
  return next;
}

/** Require one optional position identity to exist before a clear verb removes it. */
function requirePresentIdentity(
  value: string | undefined,
  label: string
): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Stock has no ${label} to clear.`);
  return value;
}

/** Private event draft by opaque replacement-plan object. */
const replacementEventDrafts = new WeakMap<
  InventoryOnceReplacementPlan,
  InventoryEventDraft | null
>();

/** Opaque replacement-plan implementation; users can inspect kind but not journal/effect fields. */
class InventoryOnceReplacementPlanImplementation
  implements InventoryOnceReplacementPlan
{
  /** Human-readable event kind or omit marker. */
  readonly kind: InventoryEventKind | "omit";

  /** Create one opaque plan and retain its event draft or explicit omit marker privately. */
  constructor(draft?: InventoryEventDraft) {
    this.kind = draft?.kind ?? "omit";
    replacementEventDrafts.set(this, draft ?? null);
  }
}

/** Read an opaque replacement or reject a plan forged outside this module. */
function readReplacementEventDraft(
  plan: InventoryOnceReplacementPlan
): InventoryEventDraft | undefined {
  if (!replacementEventDrafts.has(plan)) {
    throw new Error(
      "Correction replacement plan was not created by InventoryOnce."
    );
  }
  const draft = replacementEventDrafts.get(plan);
  return draft ?? undefined;
}

/** Private correction-planner implementation backed by the same normal event constructors. */
class InventoryOnceReplacementPlansImplementation
  implements InventoryOnceReplacementPlans
{
  /** Frozen catalogue. */
  private readonly catalog: InventoryCatalog;
  /** Synthetic stable operation identity used only inside the replacement assertion. */
  private readonly operationId: string;

  /** Bind correction replacement plans to one catalogue/correction operation. */
  constructor(catalog: InventoryCatalog, operationId: string) {
    this.catalog = catalog;
    this.operationId = operationId;
  }

  /** Plan an append-only correction that removes the retained root from current truth. */
  omit(): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation();
  }

  /** Plan a replacement opening assertion for one retained migration/adoption event. */
  opening(
    input: InventoryOnceOpeningReplacementInput
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryOpeningEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement receipt assertion. */
  receive(
    input: Omit<InventoryOnceReceiveInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryReceiptEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement issue assertion. */
  issue(
    input: Omit<InventoryOnceIssueInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryIssueEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement direct-placement transfer assertion. */
  transfer(
    input: Omit<InventoryOnceTransferInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryTransferEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement intentional detach without issuing stock. */
  detach(
    input: Omit<InventoryOnceDetachInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryDetachEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement placement/recovery of detached or missing stock. */
  place(
    input: Omit<InventoryOncePlaceInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryPlaceEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement missing-stock classification. */
  markMissing(
    input: Omit<InventoryOnceMarkMissingInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryMarkMissingEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement status-only reclassification. */
  changeStatus(
    input: Omit<InventoryOnceChangeStatusInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(input, {
      ...input.from,
      statusId: requireChangedIdentity(
        input.from.statusId,
        input.toStatusId,
        "status"
      ),
    });
  }

  /** Plan a replacement that removes stock status only. */
  clearStatus(
    input: Omit<InventoryOnceClearStatusInput, "operationId">
  ): InventoryOnceReplacementPlan {
    const { statusId, ...withoutStatus } = input.from;
    requirePresentIdentity(statusId, "status");
    return this.reclassification(input, withoutStatus);
  }

  /** Plan a replacement owner-only reclassification. */
  changeOwner(
    input: Omit<InventoryOnceChangeOwnerInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(input, {
      ...input.from,
      ownerId: requireChangedIdentity(
        input.from.ownerId,
        input.toOwnerId,
        "owner"
      ),
    });
  }

  /** Plan a replacement that removes legal/economic owner only. */
  clearOwner(
    input: Omit<InventoryOnceClearOwnerInput, "operationId">
  ): InventoryOnceReplacementPlan {
    const { ownerId, ...withoutOwner } = input.from;
    requirePresentIdentity(ownerId, "owner");
    return this.reclassification(input, withoutOwner);
  }

  /** Plan a replacement custodian-only reclassification. */
  changeCustodian(
    input: Omit<InventoryOnceChangeCustodianInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(input, {
      ...input.from,
      custodianId: requireChangedIdentity(
        input.from.custodianId,
        input.toCustodianId,
        "custodian"
      ),
    });
  }

  /** Plan a replacement that removes custodian/possessor only. */
  clearCustodian(
    input: Omit<InventoryOnceClearCustodianInput, "operationId">
  ): InventoryOnceReplacementPlan {
    const { custodianId, ...withoutCustodian } = input.from;
    requirePresentIdentity(custodianId, "custodian");
    return this.reclassification(input, withoutCustodian);
  }

  /** Plan a replacement disposition-authority-only reclassification. */
  changeDispositionAuthority(
    input: Omit<InventoryOnceChangeDispositionAuthorityInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(input, {
      ...input.from,
      dispositionAuthorityId: requireChangedIdentity(
        input.from.dispositionAuthorityId,
        input.toDispositionAuthorityId,
        "disposition authority"
      ),
    });
  }

  /** Plan a replacement that removes disposition authority only. */
  clearDispositionAuthority(
    input: Omit<InventoryOnceClearDispositionAuthorityInput, "operationId">
  ): InventoryOnceReplacementPlan {
    const { dispositionAuthorityId, ...withoutAuthority } = input.from;
    requirePresentIdentity(dispositionAuthorityId, "disposition authority");
    return this.reclassification(input, withoutAuthority);
  }

  /** Plan a replacement item-defined qualified-dimension reclassification. */
  changeQualifiedDimension(
    input: Omit<InventoryOnceChangeQualifiedDimensionInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(
      input,
      createPositionWithChangedQualifiedDimension(input)
    );
  }

  /** Plan a replacement that removes one configured extra dimension. */
  clearQualifiedDimension(
    input: Omit<InventoryOnceClearQualifiedDimensionInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.reclassification(
      input,
      createPositionWithoutQualifiedDimension(input)
    );
  }

  /** Plan a replacement that gives one fungible unit a new serial/embodied-node identity. */
  individualize(
    input: Omit<InventoryOnceIndividualizeInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryIndividualizeEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement that merges one exact serial back into fungible stock. */
  deindividualize(
    input: Omit<InventoryOnceDeindividualizeInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryDeindividualizeEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement atomic conserved split/merge/reclassification. */
  reclassifyMany(
    input: Omit<InventoryOnceReclassifyManyInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryReclassificationManyEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Replace one recorded accounting conversion, retaining source-revision audit identity. */
  revisionTransition(
    input: Omit<InventoryOnceTransitionRevisionInput, "operationId">
  ): InventoryOnceReplacementPlan {
    if (!input.plan.applicable) {
      throw new Error("Revision-transition preview is blocked; resolve its reported dependencies first.");
    }
    // Replacement builders accept caller-owned plans too. Validate their
    // approved request against frozen ratio/selector evidence before replay.
    assertInventoryRevisionTransitionPlanIntent(input.plan, this.catalog);
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryRevisionTransitionEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
        transition: input.plan.evidence,
        lines: input.plan.lines,
      })
    );
  }

  /** Plan a replacement pack assertion. */
  pack(
    input: Omit<InventoryOncePackInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryPackEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement unpack assertion. */
  unpack(
    input: Omit<InventoryOnceUnpackInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryUnpackEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement transformation assertion. */
  transform(
    input: Omit<InventoryOnceTransformationInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryTransformationEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement scrap assertion. */
  scrap(
    input: Omit<InventoryOnceScrapInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryScrapEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement standalone placement-node metadata assertion. */
  placementNodeMetadata(
    input: Omit<InventoryOnceDefinePlacementNodeInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryPlacementNodeMetadataEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement standalone lot-metadata assertion. */
  lotMetadata(
    input: Omit<InventoryOnceDefineLotInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryLotMetadataEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement count discrepancy without asking callers to construct signed effects. */
  countAdjustment(
    input: InventoryOnceCountAdjustmentReplacementInput
  ): InventoryOnceReplacementPlan {
    const stockEffects: InventoryStockEffect[] = [];
    for (const line of input.lines) {
      const measurementsDelta = subtractInventoryMeasurements(
        line.observed,
        line.expectedAtObservation
      );
      if (inventoryMeasurementsAreZero(measurementsDelta)) continue;
      stockEffects.push({
        itemRevisionId: line.position.itemRevisionId,
        position: line.position,
        measurementsDelta,
        metadata: {
          expectedAtObservation: inventoryMeasurementsFingerprint(
            line.expectedAtObservation
          ),
          observed: inventoryMeasurementsFingerprint(line.observed),
        },
      });
    }
    return new InventoryOnceReplacementPlanImplementation(
      defineInventoryEvent({
        catalog: this.catalog,
        event: {
          eventId: inventoryEventIdForOperation(this.operationId),
          operationId: this.operationId,
          kind: InventoryEventKind.CountAdjustment,
          occurredAtEpochMs: input.occurredAtEpochMs,
          stockEffects,
          traceabilityChanges: [],
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourcePartyId === undefined
            ? {}
            : { sourcePartyId: input.sourcePartyId }),
          ...(input.destinationPartyId === undefined
            ? {}
            : { destinationPartyId: input.destinationPartyId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      })
    );
  }

  /** Plan one exact replacement direct-parent transition. */
  placement(
    input: Omit<CreateInventoryPlacementInput, "catalog" | "operationId">
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryPlacementEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Plan a replacement association add. */
  associate(
    input: Omit<InventoryOnceRelationInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.relation(
      input,
      InventoryTraceabilityRelationAction.Add,
      InventoryTraceabilityRelationKind.Association
    );
  }

  /** Plan a replacement association removal. */
  disassociate(
    input: Omit<InventoryOnceRelationInput, "operationId">
  ): InventoryOnceReplacementPlan {
    return this.relation(
      input,
      InventoryTraceabilityRelationAction.Remove,
      InventoryTraceabilityRelationKind.Association
    );
  }

  /** Create one opaque replacement from the same exact reclassification builder as normal stock verbs. */
  private reclassification(
    input: Omit<InventoryOnceDimensionChangeInput, "operationId">,
    to: InventoryStockPositionInput
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryReclassificationEvent({
        ...input,
        to,
        catalog: this.catalog,
        operationId: this.operationId,
      })
    );
  }

  /** Create one opaque replacement traceability assertion from a normal public relation verb. */
  private relation(
    input: Omit<InventoryOnceRelationInput, "operationId">,
    action: InventoryTraceabilityRelationAction,
    kind: InventoryTraceabilityRelationKind
  ): InventoryOnceReplacementPlan {
    return new InventoryOnceReplacementPlanImplementation(
      createInventoryTraceabilityEvent({
        ...input,
        catalog: this.catalog,
        operationId: this.operationId,
        changes: [{ action, kind, from: input.from, to: input.to }],
      })
    );
  }
}

/** Historical assertion planner that safely exposes prior assertion positions. */
class InventoryOnceHistoricalAssertionPlansImplementation
  extends InventoryOnceReplacementPlansImplementation
  implements InventoryOnceHistoricalAssertionPlans
{
  /** Earlier assertions in this same ordered atomic bundle. */
  private readonly earlierAssertions: ReadonlyMap<string, InventoryEventDraft>;

  /** Bind ordinary verbs and stable prior-output references to one assertion. */
  constructor(
    catalog: InventoryCatalog,
    operationId: string,
    earlierAssertions: ReadonlyMap<string, InventoryEventDraft>
  ) {
    super(catalog, operationId);
    this.earlierAssertions = earlierAssertions;
  }

  /** Read one prior assertion's exact negative-effect position. */
  inputOf(assertionId: string, index = 0): InventoryStockPositionInput {
    return this.positionOf(assertionId, index, -1, "input");
  }

  /** Read one prior assertion's exact positive-effect position. */
  outputOf(assertionId: string, index = 0): InventoryStockPositionInput {
    return this.positionOf(assertionId, index, 1, "output");
  }

  /** Resolve one signed stock-effect position without exposing kernel-owned construction. */
  private positionOf(
    assertionId: string,
    index: number,
    sign: -1 | 1,
    label: string
  ): InventoryStockPositionInput {
    assertInventoryIdentity(assertionId, `historical ${label} assertionId`);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error(`Historical ${label} index must be a non-negative safe integer.`);
    }
    const event = this.earlierAssertions.get(assertionId);
    if (event === undefined) {
      throw new Error(
        `Historical ${label} references unknown or later assertion '${assertionId}'.`
      );
    }
    const effects = event.stockEffects.filter(
      /** Select signed stock effects matching the requested source/output direction. */
      (effect) =>
        Math.sign(effect.measurementsDelta.primary.quantity.amountMinor) === sign
    );
    const effect = effects[index];
    if (effect === undefined) {
      throw new Error(
        `Historical assertion '${assertionId}' has no ${label} stock effect at index ${index}.`
      );
    }
    const { itemRevisionId: _itemRevisionId, transferId: _transferId, ...position } =
      effect.position;
    return position;
  }
}

/** Build stable ordinary assertion drafts from existing correction-plan verbs. */
function buildInventoryHistoricalAssertions(
  catalog: InventoryCatalog,
  input: InventoryOnceHistoricalRepairInput
): readonly InventoryHistoricalAssertion[] {
  if (
    input.assertions.length === 0 &&
    (input.omittedAssertionIds?.length ?? 0) === 0
  ) {
    throw new Error("Historical repair must add or omit at least one assertion.");
  }
  const assertionIds = new Set<string>();
  const result: InventoryHistoricalAssertion[] = [];
  const earlierAssertions = new Map<string, InventoryEventDraft>();
  for (const assertion of input.assertions) {
    assertInventoryIdentity(assertion.assertionId, "historical assertionId");
    if (assertionIds.has(assertion.assertionId)) {
      throw new Error(
        `Historical repair repeats assertionId '${assertion.assertionId}'.`
      );
    }
    assertionIds.add(assertion.assertionId);
    if (assertion.afterEventId !== undefined) {
      assertInventoryIdentity(
        assertion.afterEventId,
        "historical assertion afterEventId"
      );
    }
    const plans = new InventoryOnceHistoricalAssertionPlansImplementation(
      catalog,
      `${input.operationId}:historical:${assertion.assertionId}`,
      earlierAssertions
    );
    const event = readReplacementEventDraft(assertion.assert(plans));
    if (event === undefined) {
      throw new Error(
        "Historical assertion cannot use omit(); omit an earlier assertionId instead."
      );
    }
    result.push({
      assertionId: assertion.assertionId,
      ...(assertion.afterEventId === undefined
        ? {}
        : { afterEventId: assertion.afterEventId }),
      event,
    });
    earlierAssertions.set(assertion.assertionId, event);
  }
  const omitted = normalizeHistoricalAssertionIds(
    input.omittedAssertionIds ?? [],
    "omitted historical assertionId"
  );
  for (const assertionId of omitted) {
    if (assertionIds.has(assertionId)) {
      throw new Error(
        `Historical repair cannot add and omit assertion '${assertionId}' together.`
      );
    }
  }
  return result;
}

/** Normalize one stable unique assertion-id set. */
function normalizeHistoricalAssertionIds(
  values: readonly string[],
  label: string
): readonly string[] {
  const result = new Set<string>();
  for (const value of values) {
    assertInventoryIdentity(value, label);
    if (result.has(value)) {
      throw new Error(`Historical repair repeats ${label} '${value}'.`);
    }
    result.add(value);
  }
  return [...result].sort(compareInventoryIdentityText);
}

/** Physical action that genuinely touches every positive stock row in one placement subtree. */
enum InventoryPlacementContentsOperationKind {
  /** Issue every physical stock row out of inventory. */
  Issue = "issue",
  /** Destroy every physical stock row. */
  Scrap = "scrap",
  /** Set one status on every physical stock row. */
  ChangeStatus = "change-status",
  /** Remove status from every physical stock row. */
  ClearStatus = "clear-status",
}

/** Kind-correlated command accepted by the shared placement-subtree planner. */
type InventoryPlacementContentsOperation =
  | {
      /** Subtree issue. */
      readonly kind: InventoryPlacementContentsOperationKind.Issue;
      /** Issue command. */
      readonly input: InventoryOnceIssuePlacementContentsInput;
    }
  | {
      /** Subtree physical destruction. */
      readonly kind: InventoryPlacementContentsOperationKind.Scrap;
      /** Scrap command. */
      readonly input: InventoryOnceScrapPlacementContentsInput;
    }
  | {
      /** Subtree status set. */
      readonly kind: InventoryPlacementContentsOperationKind.ChangeStatus;
      /** Status-set command. */
      readonly input: InventoryOnceChangePlacementContentsStatusInput;
    }
  | {
      /** Subtree status removal. */
      readonly kind: InventoryPlacementContentsOperationKind.ClearStatus;
      /** Status-clear command. */
      readonly input: InventoryOnceClearPlacementContentsStatusInput;
    };

/** Exact positive stock rows loaded from one fenced placement subtree. */
interface InventoryPlacementSubtreeContents {
  /** Every positive physical stock row anchored directly at one node in the subtree. */
  readonly positions: readonly InventoryStockPosition[];
}

/** Exact full-position source line created inside a fenced subtree-content plan. */
interface InventoryPlacementContentsSourceLine {
  /** Current position without its separately supplied frozen item revision. */
  readonly from: InventoryStockPositionInput;
  /** Frozen item revision already present on the projected position. */
  readonly itemRevisionId: string;
  /** Exact whole current row amount, including package and independent axes. */
  readonly amount: InventoryAmount;
}

/** Private implementation of generic placement topology, metadata, and subtree-content commands. */
class InventoryOncePlacementImplementation
  implements InventoryOncePlacementApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind placement commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Move one node beneath another without rewriting any descendant stock position. */
  async move(
    input: InventoryOnceMovePlacementInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementTopologyChange(this.owner, input, input.into);
  }

  /** Remove one node from its current parent without rewriting descendants. */
  async unplace(
    input: InventoryOnceUnplaceInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementTopologyChange(this.owner, input, undefined);
  }

  /** Move every direct stock row and direct child node into one destination atomically. */
  async moveContents(
    input: InventoryOnceMovePlacementContentsInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementDirectContentsMove(this.owner, input);
  }

  /** Issue every positive stock row anchored in one current placement subtree. */
  async issueContents(
    input: InventoryOnceIssuePlacementContentsInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementContentsOperation(this.owner, {
      kind: InventoryPlacementContentsOperationKind.Issue,
      input,
    });
  }

  /** Destroy every positive stock row anchored in one current placement subtree. */
  async scrapContents(
    input: InventoryOnceScrapPlacementContentsInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementContentsOperation(this.owner, {
      kind: InventoryPlacementContentsOperationKind.Scrap,
      input,
    });
  }

  /** Apply one status to every positive stock row that does not already have it. */
  async changeContentsStatus(
    input: InventoryOnceChangePlacementContentsStatusInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementContentsOperation(this.owner, {
      kind: InventoryPlacementContentsOperationKind.ChangeStatus,
      input,
    });
  }

  /** Clear status from every positive stock row that currently has one. */
  async clearContentsStatus(
    input: InventoryOnceClearPlacementContentsStatusInput
  ): Promise<InventoryOnceEventResult> {
    return commitInventoryPlacementContentsOperation(this.owner, {
      kind: InventoryPlacementContentsOperationKind.ClearStatus,
      input,
    });
  }

  /** Assert current generic node metadata/policy without changing stock or topology. */
  async define(
    input: InventoryOnceDefinePlacementNodeInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryPlacementNodeMetadataEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Correct/omit/restore current placement-node metadata while retaining its root event. */
  async correct(
    input: InventoryOnceCorrectPlacementNodeInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const correctionReason = input.reason;
    if (
      correctionReason === undefined ||
      correctionReason.trim().length === 0
    ) {
      throw new Error(
        "Inventory placement-node correction needs an explicit reason."
      );
    }
    inventoryPlacementNodeIdentity(input.nodeId);
    const nextDefinition: InventoryPlacementNodeDefinition | undefined =
      input.placementNode === undefined
        ? undefined
        : {
            nodeId: input.nodeId,
            ...input.placementNode,
          };
    const intentFingerprint = inventoryIntentFingerprint([
      "placement-node-correction",
      input.operationId,
      input.nodeId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      correctionReason,
      input.placementNode?.category ?? null,
      input.placementNode?.acceptsPlacement ?? null,
      input.placementNode?.embodiedBy?.itemId ?? null,
      input.placementNode?.embodiedBy?.serialId ?? null,
      inventoryMetadataFingerprint(input.placementNode?.identifiers),
      input.placementNode?.openedAtEpochMs ?? null,
      input.placementNode?.useByEpochMs ?? null,
      inventoryMetadataFingerprint(input.placementNode?.metadata),
      inventoryMetadataFingerprint(input.metadata),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Rebuild the retained root with only this node definition changed. */
      plan: ({ world }) => {
        const rootEventId = inventorySparseRecordValue(
          world.projection.placementNodeRootEventIdByNodeId,
          input.nodeId
        );
        if (rootEventId === undefined) {
          throw new Error(
            `Inventory placement node '${input.nodeId}' has no retained metadata assertion to correct.`
          );
        }
        const root = inventorySparseRecordValue(
          world.projection.events,
          rootEventId
        );
        if (root === undefined) {
          throw new Error(
            "Inventory placement-node metadata points to a missing retained root event."
          );
        }
        const nextDefinitions = replacePlacementNodeDefinition(
          root.placementNodeDefinitions ?? [],
          input.nodeId,
          nextDefinition
        );
        const replacement: InventoryEventDraft | undefined =
          root.kind === InventoryEventKind.PlacementNodeMetadata &&
          nextDefinitions.length === 0
            ? undefined
            : { ...root, placementNodeDefinitions: nextDefinitions };
        return {
          event: createInventoryCorrectionEvent({
            catalog: internals.catalog,
            projection: world.projection,
            operationId: input.operationId,
            occurredAtEpochMs: input.occurredAtEpochMs,
            correctsEventId: rootEventId,
            ...(replacement === undefined ? {} : { replacement }),
            ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
            ...(input.sourcePartyId === undefined
              ? {}
              : { sourcePartyId: input.sourcePartyId }),
            ...(input.destinationPartyId === undefined
              ? {}
              : { destinationPartyId: input.destinationPartyId }),
            ...(input.sourceReference === undefined
              ? {}
              : { sourceReference: input.sourceReference }),
            reason: correctionReason,
            ...(input.metadata === undefined
              ? {}
              : { metadata: input.metadata }),
          }),
        };
      },
    });
    return createInventoryOnceEventResult(result);
  }
}

/** Commit one state-dependent direct-parent transition through normal durable publication. */
async function commitInventoryPlacementTopologyChange(
  owner: InventoryOnce,
  input: InventoryOnceMovePlacementInput | InventoryOnceUnplaceInput,
  toParentNodeId: string | undefined
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  inventoryPlacementNodeIdentity(input.nodeId);
  if (toParentNodeId !== undefined) inventoryPlacementNodeIdentity(toParentNodeId);
  const expectedParentIntent =
    input.expectedParent === undefined
      ? "<unspecified>"
      : input.expectedParent === null
        ? "<unplaced>"
        : input.expectedParent;
  const destinationMetadata =
    "destination" in input ? input.destination : undefined;
  const intentFingerprint = inventoryIntentFingerprint([
    "placement-topology",
    input.operationId,
    input.nodeId,
    toParentNodeId ?? null,
    expectedParentIntent,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    input.node?.category ?? null,
    input.node?.acceptsPlacement ?? null,
    input.node?.embodiedBy?.itemId ?? null,
    input.node?.embodiedBy?.serialId ?? null,
    inventoryMetadataFingerprint(input.node?.identifiers),
    input.node?.openedAtEpochMs ?? null,
    input.node?.useByEpochMs ?? null,
    inventoryMetadataFingerprint(input.node?.metadata),
    destinationMetadata?.category ?? null,
    destinationMetadata?.acceptsPlacement ?? null,
    destinationMetadata?.embodiedBy?.itemId ?? null,
    destinationMetadata?.embodiedBy?.serialId ?? null,
    inventoryMetadataFingerprint(destinationMetadata?.identifiers),
    destinationMetadata?.openedAtEpochMs ?? null,
    destinationMetadata?.useByEpochMs ?? null,
    inventoryMetadataFingerprint(destinationMetadata?.metadata),
    inventoryMetadataFingerprint(input.metadata),
  ]);
  if (
    input.node === undefined &&
    destinationMetadata === undefined &&
    inventoryStorageSupportsSegmentedPlacement(internals.storage)
  ) {
    const committed = await internals.storage.commitSegmentedPlacementChange({
      catalog: inventoryCatalogSnapshot(internals.catalog),
      ...inventoryCommandHeaderFromPlacementInput(input),
      nodeId: input.nodeId,
      intentFingerprint,
      recordedAtEpochMs: internals.clock.nowEpochMs(),
      ...(input.expectedParent === undefined
        ? {}
        : { expectedParent: input.expectedParent }),
      ...(toParentNodeId === undefined
        ? {}
        : { toParentNodeId }),
    });
    if (committed !== undefined) {
      return {
        receipt: {
          operationId: input.operationId,
          recordedAtEpochMs: committed.recordedAtEpochMs,
          worldRevision: committed.worldRevision,
          eventId: committed.event.eventId,
        },
        event: committed.event,
        replayed: committed.replayed,
      };
    }
  }

  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId: input.operationId,
    intentFingerprint,
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Resolve the exact current parent inside the same fenced published world. */
    plan: ({ world, recordedAtEpochMs }) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        "placement topology change"
      );
      const fromParentNodeId = inventoryPlacementParentNodeId(
        world.projection.placement,
        input.nodeId
      );
      if (input.expectedParent !== undefined) {
        const expectedParentNodeId =
          input.expectedParent === null ? undefined : input.expectedParent;
        if (fromParentNodeId !== expectedParentNodeId) {
          throw new Error(
            `Placement node '${input.nodeId}' expected parent '${
              expectedParentNodeId ?? "<unplaced>"
            }', not '${fromParentNodeId ?? "<unplaced>"}'.`
          );
        }
      }
      if (fromParentNodeId === toParentNodeId) {
        throw new Error(
          toParentNodeId === undefined
            ? `Placement node '${input.nodeId}' is already unplaced.`
            : `Placement node '${input.nodeId}' is already directly in '${toParentNodeId}'.`
        );
      }
      const embodiedPosition = inventoryEmbodiedPlacementNodePosition(
        world,
        input.nodeId
      );
      if (embodiedPosition !== undefined) {
        const source = placementContentsSourceLine(
          internals.catalog,
          embodiedPosition
        );
        const header = inventoryCommandHeaderFromPlacementInput(input);
        const stockEvent =
          toParentNodeId === undefined
            ? createInventoryDetachEvent({
                catalog: internals.catalog,
                ...header,
                from: source.from,
                amount: source.amount,
                itemRevisionId: source.itemRevisionId,
              })
            : embodiedPosition.key.placementNodeId === undefined
              ? createInventoryPlaceEvent({
                  catalog: internals.catalog,
                  ...header,
                  from: source.from,
                  into: toParentNodeId,
                  amount: source.amount,
                  itemRevisionId: source.itemRevisionId,
                })
              : createInventoryTransferEvent({
                  catalog: internals.catalog,
                  ...header,
                  from: source.from,
                  toPlacementNodeId: toParentNodeId,
                  amount: source.amount,
                  itemRevisionId: source.itemRevisionId,
                });
        const placementNodeDefinitions: InventoryPlacementNodeDefinition[] = [
          ...(stockEvent.placementNodeDefinitions ?? []),
        ];
        if (input.node !== undefined) {
          const projected = inventorySparseRecordValue(
            world.projection.placementNodes,
            input.nodeId
          );
          const embodiedBy = projected?.definition.embodiedBy;
          if (embodiedBy === undefined) {
            throw new Error(
              "Embodied placement move lost its projected embodiment definition."
            );
          }
          if (
            input.node.embodiedBy !== undefined &&
            (input.node.embodiedBy.itemId !== embodiedBy.itemId ||
              input.node.embodiedBy.serialId !== embodiedBy.serialId)
          ) {
            throw new Error(
              "Placement move cannot change the node's embodied resource."
            );
          }
          placementNodeDefinitions.push({
            nodeId: input.nodeId,
            ...input.node,
            embodiedBy,
          });
        }
        if (destinationMetadata !== undefined && toParentNodeId !== undefined) {
          placementNodeDefinitions.push({
            nodeId: toParentNodeId,
            ...destinationMetadata,
          });
        }
        return {
          event:
            placementNodeDefinitions.length === 0
              ? stockEvent
              : defineInventoryEvent({
                  catalog: internals.catalog,
                  event: { ...stockEvent, placementNodeDefinitions },
                }),
        };
      }
      return {
        event: createInventoryPlacementEvent({
          catalog: internals.catalog,
          ...inventoryCommandHeaderFromPlacementInput(input),
          nodeId: input.nodeId,
          ...(fromParentNodeId === undefined ? {} : { fromParentNodeId }),
          ...(toParentNodeId === undefined ? {} : { toParentNodeId }),
          ...(input.node === undefined ? {} : { node: input.node }),
          ...(destinationMetadata === undefined
            ? {}
            : { parent: destinationMetadata }),
        }),
      };
    },
  });
  return createInventoryOnceEventResult(result);
}

/** Empty one node into another as one stock-plus-topology fact. */
async function commitInventoryPlacementDirectContentsMove(
  owner: InventoryOnce,
  original: InventoryOnceMovePlacementContentsInput
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  const input: InventoryOnceMovePlacementContentsInput = {
    ...snapshotInventoryScopedMovementHeader(original),
    nodeId: original.nodeId,
    into: original.into,
  };
  inventoryPlacementNodeIdentity(input.nodeId);
  inventoryPlacementNodeIdentity(input.into);
  if (input.nodeId === input.into) {
    throw new Error("Placement contents destination must differ from its source node.");
  }
  const intentFingerprint = inventoryIntentFingerprint([
    "placement-move-contents",
    input.operationId,
    input.nodeId,
    input.into,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
  ]);
  return commitInventoryScopedMovement({
    internals,
    operationId: input.operationId,
    intentFingerprint,
    /** Plan one composite event from direct rows and edges at the publication fence. */
    plan: async (source, recordedAtEpochMs) => {
      assertInventoryLifecycleTimeWasRecorded(input.occurredAtEpochMs, recordedAtEpochMs, "placement contents move");
      const facts = await source.directContents(input.nodeId, input.into);
      return planInventoryDirectContentsMove(internals.catalog, input, facts);
    },
  });
}

/** Build the same atomic placement event from canonical or segmented direct facts. */
function planInventoryDirectContentsMove(
  catalog: InventoryCatalog,
  input: InventoryOnceMovePlacementContentsInput,
  facts: InventorySegmentedDirectContents
): InventoryEventDraft {
  if (facts.destinationAncestry.includes(input.nodeId)) {
    throw new Error("Placement contents destination cannot be the source node or one of its descendants.");
  }
  const placementChanges: InventoryPlacementChange[] = [];
  for (const { nodeId, embodiedPosition } of facts.children) {
    if (embodiedPosition !== undefined) {
      // The serial stock effect drives the embodied node's parent.
      if (embodiedPosition.key.placementNodeId !== input.nodeId) {
        throw new Error(`Embodied child node '${nodeId}' disagrees with its unique stock placement.`);
      }
      continue;
    }
    placementChanges.push({ nodeId, fromParentNodeId: input.nodeId, toParentNodeId: input.into });
  }
  const positions: InventoryStockPosition[] = [];
  for (const row of facts.positions) {
    if (row.measurements.primary.quantity.amountMinor > 0) positions.push(row);
  }
  positions.sort(comparePlacementContentsPosition);
  if (positions.length === 0 && placementChanges.length === 0) {
    throw new Error(`Inventory placement node '${input.nodeId}' has no direct contents to move.`);
  }
  const header = inventoryCommandHeaderFromPlacementInput(input);
  const stockEvent = positions.length === 0 ? undefined : createInventoryTransferManyEvent({
    catalog,
    ...header,
    lines: positions.map(
      /** Move each whole direct row using its exact measured or package amount. */
      (position) => ({ ...placementContentsSourceLine(catalog, position), toPlacementNodeId: input.into })
    ),
  });
  return defineInventoryEvent({
    catalog,
    event: {
      ...header,
      eventId: stockEvent?.eventId ?? inventoryEventIdForOperation(input.operationId),
      kind: InventoryEventKind.Placement,
      stockEffects: stockEvent?.stockEffects ?? [],
      traceabilityChanges: [],
      ...(stockEvent === undefined ? {} : { positiveLayerProvenanceTransfers: stockEvent.positiveLayerProvenanceTransfers ?? [] }),
      placementChanges,
    },
  });
}

/** Return every positive stock row anchored directly at one exact node. */
function inventoryDirectPositivePositionsAtNode(
  world: InventoryWorldState,
  nodeId: string
): readonly InventoryStockPosition[] {
  const result: InventoryStockPosition[] = [];
  const positionIds =
    inventorySparseRecordValue(
      world.projection.positionIdsByPlacementNodeId,
      nodeId
    ) ?? [];
  for (const positionId of positionIds) {
    const position = inventorySparseRecordValue(
      world.projection.positions,
      positionId
    );
    if (position === undefined) {
      throw new Error(
        `Inventory direct-placement index references missing position ${positionId}.`
      );
    }
    if (position.measurements.primary.quantity.amountMinor <= 0) continue;
    result.push(position);
  }
  result.sort(comparePlacementContentsPosition);
  return result;
}

/** Resolve the one live stock row that physically embodies a current node. */
function inventoryEmbodiedPlacementNodePosition(
  world: InventoryWorldState,
  nodeId: string
): InventoryStockPosition | undefined {
  const projected = inventorySparseRecordValue(
    world.projection.placementNodes,
    nodeId
  );
  const embodiment = projected?.definition.embodiedBy;
  if (embodiment === undefined || projected?.retiredByEventId !== undefined) {
    return undefined;
  }
  const serialIdentity = inventorySerialIdentity(
    embodiment.itemId,
    embodiment.serialId
  );
  const positionId = inventorySparseRecordValue(
    world.projection.positivePositionIdBySerialIdentity,
    serialIdentity
  );
  if (positionId === undefined) {
    throw new Error(
      `Embodied placement node '${nodeId}' has no live serialized stock instance.`
    );
  }
  const position = inventorySparseRecordValue(
    world.projection.positions,
    positionId
  );
  if (position === undefined) {
    throw new Error(
      `Embodied placement node '${nodeId}' references missing stock position '${positionId}'.`
    );
  }
  return position;
}

/** Copy the normal immutable command header from one placement command. */
function inventoryCommandHeaderFromPlacementInput(
  input: InventoryCommandHeader
): InventoryCommandHeader {
  return {
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

/** Plan one subtree-content fact from exact rows inside the same fenced world revision. */
async function commitInventoryPlacementContentsOperation(
  owner: InventoryOnce,
  operation: InventoryPlacementContentsOperation
): Promise<InventoryOnceEventResult> {
  const internals = requireInventoryOnceInternals(owner);
  const { kind, input } = operation;
  const targetStatusId =
    operation.kind === InventoryPlacementContentsOperationKind.ChangeStatus
      ? operation.input.toStatusId
      : null;
  const intentFingerprint = inventoryIntentFingerprint([
    "placement-subtree-contents",
    kind,
    input.operationId,
    input.nodeId,
    targetStatusId,
    input.occurredAtEpochMs,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
  ]);
  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId: input.operationId,
    intentFingerprint,
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Read subtree contents and freeze every exact line before the durable Begin write. */
    plan: ({ world, recordedAtEpochMs }) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        `placement subtree ${kind}`
      );
      const contents = findInventoryPlacementSubtreeContents(
        world,
        input.nodeId
      );
      const affectedPositions = findPositionsChangedByPlacementContentsOperation(
        operation,
        contents
      );
      assertNoExactReservationBindsPlacementContents(
        world,
        affectedPositions,
        input.occurredAtEpochMs
      );
      const event = createInventoryPlacementContentsEvent(
        internals.catalog,
        operation,
        affectedPositions
      );
      return {
        event,
      };
    },
  });
  return createInventoryOnceEventResult(result);
}

/** Find every positive stock row anchored at the root node or one current descendant. */
function findInventoryPlacementSubtreeContents(
  world: InventoryWorldState,
  nodeId: string
): InventoryPlacementSubtreeContents {
  inventoryPlacementNodeIdentity(nodeId);
  const positions: InventoryStockPosition[] = [];
  const seenPositionIds = new Set<string>();
  for (const includedNodeId of inventoryPlacementSubtreeNodeIds(
    world.projection.placement,
    nodeId
  )) {
    const positionIds =
      inventorySparseRecordValue(
        world.projection.positionIdsByPlacementNodeId,
        includedNodeId
      ) ?? [];
    for (const positionId of positionIds) {
      if (seenPositionIds.has(positionId)) continue;
      seenPositionIds.add(positionId);
      const position = inventorySparseRecordValue(
        world.projection.positions,
        positionId
      );
      if (position === undefined) {
        throw new Error(
          `Inventory direct-placement index references missing position ${positionId}.`
        );
      }
      // Deficits and zero rows are bookkeeping truth, not physical subtree contents.
      if (position.measurements.primary.quantity.amountMinor <= 0) continue;
      positions.push(position);
    }
  }
  if (positions.length === 0) {
    throw new Error(
      `Inventory placement node '${nodeId}' has no current positive physical contents.`
    );
  }
  positions.sort(comparePlacementContentsPosition);
  return { positions };
}

/** Keep only rows that really change for a subtree status verb; issue/scrap use all contents. */
function findPositionsChangedByPlacementContentsOperation(
  operation: InventoryPlacementContentsOperation,
  contents: InventoryPlacementSubtreeContents
): readonly InventoryStockPosition[] {
  if (
    operation.kind === InventoryPlacementContentsOperationKind.ChangeStatus
  ) {
    if (operation.input.toStatusId.trim().length === 0) {
      throw new Error(
        "Placement subtree status change needs a non-empty status."
      );
    }
    const changed = contents.positions.filter(
      /** Rows already carrying the requested status remain untouched. */
      (position) => position.key.statusId !== operation.input.toStatusId
    );
    if (changed.length === 0) {
      throw new Error(
        "Every placement-subtree content row already has that status."
      );
    }
    return changed;
  }
  if (
    operation.kind === InventoryPlacementContentsOperationKind.ClearStatus
  ) {
    const changed = contents.positions.filter(
      /** Only rows with a current status need a conserved reclassification line. */
      (position) => position.key.statusId !== undefined
    );
    if (changed.length === 0) {
      throw new Error("Placement-subtree contents have no status to clear.");
    }
    return changed;
  }
  return contents.positions;
}

/** Reject a content operation before it could strand an exact claim on an old position key. */
function assertNoExactReservationBindsPlacementContents(
  world: InventoryWorldState,
  positions: readonly InventoryStockPosition[],
  atEpochMs: number
): void {
  const affectedPositionIds = new Set<string>();
  for (const position of positions) {
    affectedPositionIds.add(inventoryStockPositionIdentity(position.key));
  }
  const blockingReservationIds: string[] = [];
  for (const reservation of inventoryReservationsAt(world.reservations, atEpochMs)) {
    if (!inventoryReservationIsActiveAt(reservation, atEpochMs)) continue;
    for (const allocation of reservation.allocations) {
      if (
        !affectedPositionIds.has(
          inventoryStockPositionIdentity(allocation.position)
        )
      ) {
        continue;
      }
      blockingReservationIds.push(reservation.reservationId);
      break;
    }
  }
  blockingReservationIds.sort(compareInventoryIdentityText);
  if (blockingReservationIds.length > 0) {
    throw new Error(
      "Placement-subtree content operation would move or remove exact reservation bindings; " +
        `release, consume, or reallocate these claims first: ${blockingReservationIds.join(
          ", "
        )}.`
    );
  }
}

/** Build one immutable event carrying every exact subtree-content stock line. */
function createInventoryPlacementContentsEvent(
  catalog: InventoryCatalog,
  operation: InventoryPlacementContentsOperation,
  positions: readonly InventoryStockPosition[]
): InventoryEventDraft {
  const { input } = operation;
  const header = inventoryCommandHeaderFromPlacementContentsInput(input);
  if (operation.kind === InventoryPlacementContentsOperationKind.Issue) {
    return createInventoryIssueManyEvent({
      catalog,
      ...header,
      lines: positions.map(
        /** Issue one complete current row from this fenced subtree snapshot. */
        (position) => placementContentsSourceLine(catalog, position)
      ),
    });
  }
  if (operation.kind === InventoryPlacementContentsOperationKind.Scrap) {
    return createInventoryScrapManyEvent({
      catalog,
      ...header,
      lines: positions.map(
        /** Destroy one complete current row from this fenced subtree snapshot. */
        (position) => placementContentsSourceLine(catalog, position)
      ),
    });
  }
  return createInventoryReclassificationManyEvent({
    catalog,
    ...header,
    consume: positions.map(
      /** Remove one full old-status row. */
      (position) => placementContentsSourceLine(catalog, position)
    ),
    produce: positions.map(
      /** Recreate the same full row with only status changed. */
      (position) => {
        const source = placementContentsSourceLine(catalog, position);
        const to =
          operation.kind ===
          InventoryPlacementContentsOperationKind.ChangeStatus
            ? { ...source.from, statusId: operation.input.toStatusId }
            : positionWithoutStatus(source.from);
        return {
          to,
          amount: source.amount,
          itemRevisionId: source.itemRevisionId,
        };
      }
    ),
  });
}

/** Build one exact full-position source line without asking the application to rebuild package math. */
function placementContentsSourceLine(
  catalog: InventoryCatalog,
  position: InventoryStockPosition
): InventoryPlacementContentsSourceLine {
  const { itemRevisionId, ...from } = position.key;
  return {
    from,
    itemRevisionId,
    amount: inventoryAmountForPrimaryAllocation({
      catalog,
      itemRevisionId,
      position,
      allocatedPrimary: position.measurements.primary.quantity,
    }),
  };
}

/** Strip subtree selector fields while keeping the normal immutable command header. */
function inventoryCommandHeaderFromPlacementContentsInput(
  input: InventoryPlacementContentsOperation["input"]
): InventoryCommandHeader {
  return {
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

/** Remove status while preserving every other exact stock-position field. */
function positionWithoutStatus(
  position: InventoryStockPositionInput
): InventoryStockPositionInput {
  const { statusId, ...withoutStatus } = position;
  if (statusId === undefined) {
    throw new Error(
      "Placement-subtree clear-status selected a row without status."
    );
  }
  return withoutStatus;
}

/** Sort subtree rows by their full revision-qualified position identity. */
function comparePlacementContentsPosition(
  left: InventoryStockPosition,
  right: InventoryStockPosition
): number {
  return compareInventoryIdentityText(
    inventoryStockPositionIdentity(left.key),
    inventoryStockPositionIdentity(right.key)
  );
}

/** Replace, append, or omit one exact placement-node definition in a retained root assertion. */
function replacePlacementNodeDefinition(
  definitions: readonly InventoryPlacementNodeDefinition[],
  nodeId: string,
  replacement: InventoryPlacementNodeDefinition | undefined
): readonly InventoryPlacementNodeDefinition[] {
  inventoryPlacementNodeIdentity(nodeId);
  const next: InventoryPlacementNodeDefinition[] = [];
  let found = false;
  for (const definition of definitions) {
    if (definition.nodeId === nodeId) {
      found = true;
      if (replacement !== undefined) next.push(replacement);
    } else {
      next.push(definition);
    }
  }
  if (!found && replacement !== undefined) next.push(replacement);
  next.sort(
    /** Keep replacement intent independent of retained array order. */
    (left, right) =>
      compareInventoryIdentityText(left.nodeId, right.nodeId)
  );
  return next;
}

/** Private implementation of item-scoped lot/batch metadata commands. */
class InventoryOnceLotsImplementation implements InventoryOnceLotsApi {
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind lot metadata commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Assert one current lot metadata value without changing physical quantity. */
  async define(
    input: InventoryOnceDefineLotInput
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryLotMetadataEvent({
        ...input,
        catalog,
      })
    );
  }

  /** Correct current lot metadata while retaining stock effects and the original root event. */
  async correct(
    input: InventoryOnceCorrectLotInput
  ): Promise<InventoryOnceEventResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const correctionReason = input.reason;
    if (
      correctionReason === undefined ||
      correctionReason.trim().length === 0
    ) {
      throw new Error("Inventory lot correction needs an explicit reason.");
    }
    const nextDefinition: InventoryLotDefinition | undefined =
      input.lot === undefined
        ? undefined
        : {
            itemId: input.itemId,
            lotId: input.lotId,
            ...input.lot,
          };
    const intentFingerprint = inventoryIntentFingerprint([
      "lot-correction",
      input.operationId,
      input.itemId,
      input.lotId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      correctionReason,
      input.lot?.manufacturedAtEpochMs ?? null,
      input.lot?.expiresAtEpochMs ?? null,
      inventoryMetadataFingerprint(input.lot?.metadata),
      inventoryMetadataFingerprint(input.metadata),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Rebuild the retained root with only this lot master changed, then derive an append-only correction. */
      plan: ({ world }) => {
        const identity = inventoryLotIdentity(input.itemId, input.lotId);
        const rootEventId = world.projection.lotRootEventIdByIdentity[identity];
        if (rootEventId === undefined) {
          throw new Error(
            `Inventory lot ${identity} has no retained metadata assertion to correct.`
          );
        }
        const root = inventorySparseRecordValue(
          world.projection.events,
          rootEventId
        );
        if (root === undefined) {
          throw new Error(
            "Inventory lot metadata points to a missing retained root event."
          );
        }
        const replacementLotDefinitions = replaceLotDefinition(
          root.lotDefinitions ?? [],
          input.itemId,
          input.lotId,
          nextDefinition
        );
        const replacement: InventoryEventDraft = {
          ...root,
          lotDefinitions: replacementLotDefinitions,
        };
        return {
          event: createInventoryCorrectionEvent({
            catalog: internals.catalog,
            projection: world.projection,
            operationId: input.operationId,
            occurredAtEpochMs: input.occurredAtEpochMs,
            correctsEventId: rootEventId,
            ...(replacement === undefined ? {} : { replacement }),
            ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
            ...(input.sourcePartyId === undefined
              ? {}
              : { sourcePartyId: input.sourcePartyId }),
            ...(input.destinationPartyId === undefined
              ? {}
              : { destinationPartyId: input.destinationPartyId }),
            ...(input.sourceReference === undefined
              ? {}
              : { sourceReference: input.sourceReference }),
            reason: correctionReason,
            ...(input.metadata === undefined
              ? {}
              : { metadata: input.metadata }),
          }, internals.deficitPolicy),
        };
      },
    });
    return createInventoryOnceEventResult(result);
  }
}

/** Replace or append one exact item-scoped lot definition inside a retained root assertion. */
function replaceLotDefinition(
  definitions: readonly InventoryLotDefinition[],
  itemId: string,
  lotId: string,
  replacement: InventoryLotDefinition | undefined
): readonly InventoryLotDefinition[] {
  const targetIdentity = inventoryLotIdentity(itemId, lotId);
  const next: InventoryLotDefinition[] = [];
  let found = false;
  for (const definition of definitions) {
    if (
      inventoryLotIdentity(definition.itemId, definition.lotId) ===
      targetIdentity
    ) {
      found = true;
      if (replacement !== undefined) next.push(replacement);
    } else {
      next.push(definition);
    }
  }
  if (!found && replacement !== undefined) next.push(replacement);
  return next;
}

/** Private implementation of the first-class physical transfer lifecycle. */
class InventoryOnceTransfersImplementation
  implements InventoryOnceTransfersApi
{
  /** Transfer-lifecycle owner value retained or supplied by this record. */ private readonly owner: InventoryOnce;
  /** Bind one transfer-lifecycle implementation to its owning façade. */ constructor(
    owner: InventoryOnce
  ) {
    this.owner = owner;
  }

  /** Execute the prepare transfer-lifecycle operation. */ async prepare(
    input: InventoryOncePrepareTransferInput
  ): Promise<InventoryOnceTransferResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const event = createInventoryTransferPrepareEvent({
      ...input,
      catalog: internals.catalog,
    });
    return commitInventoryTransferOperation(
      this.owner,
      input.operationId,
      inventoryEventIntentFingerprint(event),
      input.transferId,
      /** Process one transfer-lifecycle collection entry deterministically. */ () =>
        event
    );
  }

  /** Execute the dispatch transfer-lifecycle operation. */ async dispatch(
    input: InventoryOnceDispatchTransferInput
  ): Promise<InventoryOnceTransferResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    return commitInventoryTransferOperation(
      this.owner,
      input.operationId,
      inventoryTransferDispatchIntentFingerprint(
        input,
        input.transferId,
        input.carrierCustodianId
      ),
      input.transferId,
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        world
      ) =>
        createInventoryTransferDispatchEvent({
          ...input,
          catalog: internals.catalog,
          transfer: requirePublishedInventoryTransfer(world, input.transferId),
        })
    );
  }

  /** Execute the receive transfer-lifecycle operation. */ async receive(
    input: InventoryOnceReceiveTransferInput
  ): Promise<InventoryOnceTransferResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    return commitInventoryTransferOperation(
      this.owner,
      input.operationId,
      inventoryTransferReceiveIntentFingerprint(
        input,
        input.transferId,
        input.lines
      ),
      input.transferId,
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        world
      ) =>
        createInventoryTransferReceiveEvent({
          ...input,
          catalog: internals.catalog,
          transfer: requirePublishedInventoryTransfer(world, input.transferId),
        })
    );
  }

  /** Execute the release transfer-lifecycle operation. */ async release(
    input: InventoryOnceReleaseTransferInput
  ): Promise<InventoryOnceTransferResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    return commitInventoryTransferOperation(
      this.owner,
      input.operationId,
      inventoryTransferReleaseIntentFingerprint(input, input.transferId),
      input.transferId,
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        world
      ) =>
        createInventoryTransferReleaseEvent({
          ...input,
          catalog: internals.catalog,
          transfer: requirePublishedInventoryTransfer(world, input.transferId),
        })
    );
  }

  /** Execute the find transfer-lifecycle operation. */ async find(
    input: InventoryOnceFindTransferInput
  ): Promise<InventoryTransfer | undefined> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    return inventorySparseRecordValue(world.projection.transfers, input.transferId);
  }
}

/** Private implementation of the globally feasible reservation command surface. */
class InventoryOnceReservationsImplementation
  implements InventoryOnceReservationsApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind reservation commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Create one broad/exact claim only when every active claim remains assignable. */
  async reserve(
    input: InventoryOnceReserveInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const selector = normalizeInventoryStockSelector(input.selector);
    const reservation: NewInventoryReservation = { ...input, selector };
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: newReservationFacadeFingerprint(reservation),
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Add the claim only after testing it against the current published stock/claims. */
      plan: ({ world, recordedAtEpochMs }) => {
        const created = createInventoryReservation({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.reservations,
          reservation,
          nowEpochMs: recordedAtEpochMs,
        });
        return {
          reservationResult: created,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Narrow one active claim's scope without losing global feasibility. */
  async refine(
    input: InventoryOnceRefineReservationInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const selector = normalizeInventoryStockSelector(input.selector);
    const fingerprint = inventoryIntentFingerprint([
      "reservation-refine",
      input.reservationId,
      input.occurredAtEpochMs,
      inventoryStockSelectorIdentity(selector),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Narrow the claim against the current published allocation and competing claims. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "reservation refinement"
        );
        const refined = refineInventoryReservation({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.reservations,
          operationId: input.operationId,
          reservationId: input.reservationId,
          selector,
          occurredAtEpochMs: input.occurredAtEpochMs,
        });
        return {
          reservationResult: refined,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Bind one claim to exact stock positions while preserving all claims together. */
  async allocate(
    input: InventoryOnceAllocateReservationInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const allocations = normalizeFacadeReservationAllocations(
      input.allocations
    );
    const fingerprint = inventoryIntentFingerprint([
      "reservation-allocate",
      input.reservationId,
      input.occurredAtEpochMs,
      allocations.map(reservationAllocationFingerprint),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Bind exact positions against the current published stock and competing claims. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "reservation allocation"
        );
        const allocated = allocateInventoryReservation({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.reservations,
          operationId: input.operationId,
          reservationId: input.reservationId,
          allocations,
          occurredAtEpochMs: input.occurredAtEpochMs,
        });
        return {
          reservationResult: allocated,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Bind one claim using native FIFO/FEFO selection against the same committed world. */
  async allocateByPolicy(
    input: InventoryOnceAllocateReservationByPolicyInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const fingerprint = inventoryIntentFingerprint([
      "reservation-allocate-by-policy",
      input.reservationId,
      input.occurredAtEpochMs,
      input.method,
      input.allowExpiredLots ?? false,
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Select exact positions and freeze the resulting allocation in one durable operation. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "reservation policy allocation"
        );
        const reservation =
          inventorySparseRecordValue(
          world.reservations.reservations,
          input.reservationId
        );
        if (reservation === undefined)
          throw new Error("Unknown inventory reservation.");
        const item = internals.catalog.itemRevision(reservation.itemRevisionId);
        if (
          input.allowExpiredLots === true &&
          reservation.allowExpiredStock !== true
        ) {
          throw new Error(
            "Reservation policy allocation cannot opt into expired stock unless the claim itself explicitly permits it."
          );
        }
        if (item.reservationAxisId !== item.primaryAxis.axisId) {
          throw new Error(
            "Native FIFO/FEFO allocation currently requires the reservation axis to be the primary stock axis; allocate exact independent measurements explicitly."
          );
        }
        const selected = planInventoryAllocation({
          catalog: internals.catalog,
          world,
          selector: reservation.selector,
          amount: stockAmount(
            quantityToDecimalString(reservation.requested),
            reservation.requested.unit
          ),
          itemRevisionId: reservation.itemRevisionId,
          method: input.method,
          atEpochMs: input.occurredAtEpochMs,
          reservationAtEpochMs: recordedAtEpochMs,
          reservationId: input.reservationId,
          allowExpiredLots:
            input.allowExpiredLots ?? reservation.allowExpiredStock ?? false,
        });
        assertPolicyAllocationComplete(selected);
        const allocations: InventoryReservationAllocation[] = [];
        for (const line of selected.lines) {
          allocations.push({
            position: line.position,
            quantity: line.allocatedPrimary,
          });
        }
        const allocated = allocateInventoryReservation({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.reservations,
          operationId: input.operationId,
          reservationId: input.reservationId,
          allocations,
          occurredAtEpochMs: input.occurredAtEpochMs,
        });
        return {
          reservationResult: allocated,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Release one active claim without changing physical stock. */
  async release(
    input: InventoryOnceCloseReservationInput
  ): Promise<InventoryOnceReservationResult> {
    return this.closeReservation(input, "release");
  }

  /** Durably expire one active claim after its configured expiry time. */
  async expire(
    input: InventoryOnceCloseReservationInput
  ): Promise<InventoryOnceReservationResult> {
    return this.closeReservation(input, "expire");
  }

  /** Atomically issue measured stock and close one allocated claim exactly once. */
  async consume(
    input: InventoryOnceConsumeReservationInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const fulfillment = normalizeReservationFulfillment(input.fulfillment);
    const intentFingerprint = inventoryIntentFingerprint([
      "reservation-consume",
      input.reservationId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      input.reason ?? null,
      inventoryMetadataFingerprint(input.metadata),
      fulfillment.map(reservationFulfillmentFingerprint),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Build the issue and reservation close from the same published world revision. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "reservation consumption"
        );
        const reservation =
          inventorySparseRecordValue(
          world.reservations.reservations,
          input.reservationId
        );
        if (reservation === undefined)
          throw new Error("Unknown inventory reservation.");
        const event = createReservationConsumptionEvent(
          internals.catalog,
          world.projection,
          reservation,
          { ...input, fulfillment }
        );
        const consumed = markInventoryReservationConsumed({
          book: world.reservations,
          operationId: input.operationId,
          reservationId: input.reservationId,
          consumptionEventId: event.eventId,
          occurredAtEpochMs: input.occurredAtEpochMs,
        });
        return {
          event,
          reservationResult: consumed,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Issue the current exact allocation and close its claim without caller-built fulfillment lines. */
  async consumeAllocated(
    input: InventoryOnceConsumeAllocatedReservationInput
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const intentFingerprint = inventoryIntentFingerprint([
      "reservation-consume-allocated",
      input.reservationId,
      input.occurredAtEpochMs,
      input.actorId ?? null,
      input.sourcePartyId ?? null,
      input.destinationPartyId ?? null,
      input.sourceReference ?? null,
      input.reason ?? null,
      inventoryMetadataFingerprint(input.metadata),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Materialize exact legal issue amounts from the current frozen allocation. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "reservation allocated consumption"
        );
        const reservation =
          inventorySparseRecordValue(
          world.reservations.reservations,
          input.reservationId
        );
        if (reservation === undefined)
          throw new Error("Unknown inventory reservation.");
        const fulfillment = createAllocatedReservationFulfillment(
          internals.catalog,
          world,
          reservation
        );
        const event = createReservationConsumptionEvent(
          internals.catalog,
          world.projection,
          reservation,
          { ...input, fulfillment }
        );
        const consumed = markInventoryReservationConsumed({
          book: world.reservations,
          operationId: input.operationId,
          reservationId: input.reservationId,
          consumptionEventId: event.eventId,
          occurredAtEpochMs: input.occurredAtEpochMs,
        });
        return {
          event,
          reservationResult: consumed,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }

  /** Apply one release/expiry lifecycle command through the same durable coordinator. */
  private async closeReservation(
    input: InventoryOnceCloseReservationInput,
    kind: "release" | "expire"
  ): Promise<InventoryOnceReservationResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const fingerprint = inventoryIntentFingerprint([
      `reservation-${kind}`,
      input.reservationId,
      input.occurredAtEpochMs,
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Close the current claim row without changing physical stock. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          `reservation ${kind}`
        );
        const closed =
          kind === "release"
            ? releaseInventoryReservation({
                book: world.reservations,
                operationId: input.operationId,
                reservationId: input.reservationId,
                occurredAtEpochMs: input.occurredAtEpochMs,
              })
            : expireInventoryReservation({
                book: world.reservations,
                operationId: input.operationId,
                reservationId: input.reservationId,
                occurredAtEpochMs: input.occurredAtEpochMs,
              });
        return {
          reservationResult: closed,
          reservationId: input.reservationId,
        };
      },
    });
    return createInventoryOnceReservationResult(result);
  }
}

/** Build exact public issue amounts from one primary-axis reservation allocation. */
function createAllocatedReservationFulfillment(
  catalog: InventoryCatalog,
  world: InventoryWorldState,
  reservation: InventoryReservation
): readonly InventoryReservationFulfillmentLine[] {
  if (reservation.allocations.length === 0) {
    throw new Error("Reservation must be allocated before it can be consumed.");
  }
  const item = catalog.itemRevision(reservation.itemRevisionId);
  if (item.reservationAxisId !== item.primaryAxis.axisId) {
    throw new Error(
      "Automatic allocated consumption requires the reservation axis to be primary; provide exact measured fulfillment for independent-axis claims."
    );
  }
  const fulfillment: InventoryReservationFulfillmentLine[] = [];
  for (const allocation of reservation.allocations) {
    const identity = inventoryStockPositionIdentity(allocation.position);
    const position = world.projection.positions[identity];
    if (position === undefined) {
      throw new Error(
        `Allocated inventory position ${identity} has no current stock.`
      );
    }
    fulfillment.push({
      from: allocation.position,
      amount: inventoryAmountForPrimaryAllocation({
        catalog,
        itemRevisionId: reservation.itemRevisionId,
        position,
        allocatedPrimary: allocation.quantity,
      }),
    });
  }
  fulfillment.sort(compareReservationFulfillmentLine);
  return fulfillment;
}

/** Stable normalized fingerprint for one reservation creation request. */
function newReservationFacadeFingerprint(
  reservation: NewInventoryReservation
): string {
  return inventoryIntentFingerprint([
    "reservation-create",
    reservation.reservationId,
    reservation.operationId,
    reservation.itemRevisionId,
    inventoryStockSelectorIdentity(reservation.selector),
    quantityFingerprint(reservation.requested),
    reservation.createdAtEpochMs,
    reservation.expiresAtEpochMs ?? null,
    reservation.allowExpiredStock ?? false,
    reservation.actorId ?? null,
    reservation.sourceReference ?? null,
    inventoryMetadataFingerprint(reservation.metadata),
  ]);
}

/** Merge duplicate exact allocation positions and return stable ordering for retries. */
function normalizeFacadeReservationAllocations(
  allocations: readonly InventoryReservationAllocation[]
): readonly InventoryReservationAllocation[] {
  if (allocations.length === 0) {
    throw new Error(
      "Reservation allocation needs at least one exact position."
    );
  }
  const grouped = new Map<string, InventoryReservationAllocation>();
  for (const allocation of allocations) {
    if (allocation.quantity.amountMinor <= 0) {
      throw new Error("Reservation allocation quantity must be positive.");
    }
    const identity = inventoryStockPositionIdentity(allocation.position);
    const earlier = grouped.get(identity);
    grouped.set(
      identity,
      earlier === undefined
        ? allocation
        : {
            position: earlier.position,
            quantity: addQuantity(earlier.quantity, allocation.quantity),
          }
    );
  }
  const normalized = [...grouped.values()];
  normalized.sort(compareReservationAllocationLine);
  return normalized;
}

/** Stable exact allocation fingerprint. */
function reservationAllocationFingerprint(
  allocation: InventoryReservationAllocation
): string {
  return inventoryIntentFingerprint([
    inventoryStockPositionIdentity(allocation.position),
    quantityFingerprint(allocation.quantity),
  ]);
}

/** Sort reservation allocations by exact position identity. */
function compareReservationAllocationLine(
  left: InventoryReservationAllocation,
  right: InventoryReservationAllocation
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Stable exact quantity fingerprint. */
function quantityFingerprint(value: Quantity): string {
  return inventoryIntentFingerprint([
    value.amountMinor,
    value.decimals,
    value.unit,
  ]);
}

/** Normalize fulfillment amount axes and exact position ordering for retry identity. */
function normalizeReservationFulfillment(
  fulfillment: readonly InventoryReservationFulfillmentLine[]
): readonly InventoryReservationFulfillmentLine[] {
  if (fulfillment.length === 0) {
    throw new Error(
      "Reservation consumption needs at least one fulfillment line."
    );
  }
  const normalized: InventoryReservationFulfillmentLine[] = [];
  const seenPositions = new Set<string>();
  for (const line of fulfillment) {
    const identity = inventoryStockPositionIdentity(line.from);
    if (seenPositions.has(identity)) {
      throw new Error(`Reservation fulfillment repeats position ${identity}.`);
    }
    seenPositions.add(identity);
    normalized.push({
      from: line.from,
      amount: normalizeFacadeAmount(line.amount),
    });
  }
  normalized.sort(compareReservationFulfillmentLine);
  return normalized;
}

/** Stable normalized fulfillment fingerprint. */
function reservationFulfillmentFingerprint(
  line: InventoryReservationFulfillmentLine
): string {
  return inventoryIntentFingerprint([
    inventoryStockPositionIdentity(line.from),
    inventoryAmountFingerprint(line.amount),
  ]);
}

/** Sort fulfillment lines by exact source position. */
function compareReservationFulfillmentLine(
  left: InventoryReservationFulfillmentLine,
  right: InventoryReservationFulfillmentLine
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.from), inventoryStockPositionIdentity(right.from));
}

/** Return a stable amount copy with independently measured axes sorted/rejected if duplicated. */
function normalizeFacadeAmount(amount: InventoryAmount): InventoryAmount {
  assertInventoryAmountKind(amount);
  const independent = [...amount.independent];
  independent.sort(compareIndependentAmountAxis);
  let previousAxisId: string | undefined;
  for (const measured of independent) {
    if (measured.axisId === previousAxisId) {
      throw new Error(
        `Inventory amount repeats independent axis '${measured.axisId}'.`
      );
    }
    previousAxisId = measured.axisId;
  }
  return amount.kind === InventoryAmountKind.Measured
    ? { ...amount, independent }
    : { ...amount, independent };
}

/** Stable normalized amount fingerprint. */
function inventoryAmountFingerprint(amount: InventoryAmount): string {
  const normalized = normalizeFacadeAmount(amount);
  return inventoryIntentFingerprint([
    normalized.kind,
    normalized.kind === InventoryAmountKind.Measured
      ? [normalized.primaryValue, normalized.primaryUnit]
      : [normalized.count, normalized.packagingRevisionId],
    normalized.independent.map(
      /** Turn one independent amount into collision-free fingerprint parts. */
      (measured) => [measured.axisId, measured.value, measured.unit]
    ),
  ]);
}

/** Sort independently measured amount inputs by axis identity. */
function compareIndependentAmountAxis(
  left: InventoryAmount["independent"][number],
  right: InventoryAmount["independent"][number]
): number {
  return compareInventoryIdentityText(left.axisId, right.axisId);
}

/** Build one exact multi-position issue event and prove it matches the frozen allocation. */
function createReservationConsumptionEvent(
  catalog: InventoryCatalog,
  projection: InventoryWorldState["projection"],
  reservation: InventoryReservation,
  input: InventoryOnceConsumeReservationInput
): InventoryEventDraft {
  if (reservation.allocations.length === 0) {
    throw new Error("Reservation must be allocated before consumption.");
  }
  const reservationItem = catalog.itemRevision(reservation.itemRevisionId);
  const reservationAxisId = reservationItem.reservationAxisId;
  const expectedByPosition = new Map<string, Quantity>();
  for (const allocation of reservation.allocations) {
    expectedByPosition.set(
      inventoryStockPositionIdentity(allocation.position),
      allocation.quantity
    );
  }
  const actualByPosition = new Map<string, Quantity>();
  const stockEffects: InventoryStockEffect[] = [];
  for (const line of input.fulfillment) {
    const identity = inventoryStockPositionIdentity(line.from);
    const expected = expectedByPosition.get(identity);
    if (expected === undefined) {
      throw new Error(
        `Fulfillment position ${identity} was not allocated to this reservation.`
      );
    }
    if (
      reservation.allowExpiredStock !== true &&
      inventoryPositionIsExpiredAt(projection, line.from, input.occurredAtEpochMs)
    ) {
      throw new Error(
        "Reservation fulfillment cannot use stock past its lot/placement-ancestor use-by unless the claim explicitly permits it."
      );
    }
    const item = catalog.itemRevision(line.from.itemRevisionId);
    if (item.itemId !== line.from.itemId) {
      throw new Error("Fulfillment position item/revision do not match.");
    }
    const resolved = resolveInventoryAmount(catalog, item, line.amount);
    if (resolved.packaging === undefined) {
      if (line.from.packagingRevisionId !== undefined) {
        throw new Error("Intact packaged fulfillment must use packageAmount.");
      }
    } else if (
      line.from.packagingRevisionId !== resolved.packaging.revisionId
    ) {
      throw new Error(
        "Fulfillment package amount differs from exact allocated package revision."
      );
    }
    const reservationAxis = catalog.measurementAxis(item, reservationAxisId);
    if (reservationAxis.unit !== reservation.requested.unit) {
      throw new Error(
        "Allocated item revision uses an incompatible reservation-axis unit."
      );
    }
    const actual = inventoryMeasurementAt(
      resolved.measurements,
      reservationAxisId,
      reservationAxis.unit
    );
    actualByPosition.set(identity, actual);
    stockEffects.push({
      itemRevisionId: item.revisionId,
      position: line.from,
      measurementsDelta: negateInventoryMeasurements(resolved.measurements),
      evidence: {
        transactedMeasurements: resolved.measurements,
        ...(resolved.packaging === undefined
          ? {}
          : { packagingRevisionId: resolved.packaging.revisionId }),
        ...(resolved.packageCount === undefined
          ? {}
          : { packageCount: String(resolved.packageCount) }),
      },
      metadata: { reservationId: reservation.reservationId },
    });
  }
  for (const [identity, expected] of expectedByPosition) {
    const actual = actualByPosition.get(identity);
    if (actual === undefined || !quantityEq(actual, expected)) {
      throw new Error(
        `Fulfillment does not exactly match reservation allocation at ${identity}.`
      );
    }
  }
  return defineInventoryEvent({
    catalog,
    event: {
      eventId: inventoryEventIdForOperation(input.operationId),
      operationId: input.operationId,
      kind: InventoryEventKind.Issue,
      occurredAtEpochMs: input.occurredAtEpochMs,
      stockEffects,
      traceabilityChanges: [],
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.sourcePartyId === undefined
        ? {}
        : { sourcePartyId: input.sourcePartyId }),
      ...(input.destinationPartyId === undefined
        ? {}
        : { destinationPartyId: input.destinationPartyId }),
      ...(input.sourceReference === undefined
        ? {}
        : { sourceReference: input.sourceReference }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      metadata: {
        ...(input.metadata ?? {}),
        reservationId: reservation.reservationId,
      },
    },
  });
}

/** Structural amount line accepted by a validated parent/child group. */
export interface InventoryAmountLineRead {
  /** Exact measured or package amount represented by this line. */
  readonly amount: InventoryAmount;
  /** Frozen revision interpreting the amount. */
  readonly itemRevisionId: string;
}

/** Inputs for validating one non-empty group of amount-bearing command lines. */
export interface DefineInventoryAmountLineGroupInput<
  TLine extends InventoryAmountLineRead
> {
  /** Retained catalogue resolving every line. */
  readonly catalog: InventoryCatalog;
  /** Stable item shared by the parent and every line. */
  readonly itemId: string;
  /** Frozen revision governing the parent amount. */
  readonly expectedItemRevisionId: string;
  /** Exact parent amount represented by all child lines. */
  readonly expectedAmount: InventoryAmount;
  /** Non-empty exact child command lines. */
  readonly lines: readonly TLine[];
  /** Optional diagnostic context for conservation failures. */
  readonly label?: string;
}

/** Validate one exact parent/child amount-line group while preserving the caller's generic line subtype. */
export function defineInventoryAmountLineGroup<
  TLine extends InventoryAmountLineRead
>({
  catalog,
  itemId,
  expectedItemRevisionId,
  expectedAmount,
  lines,
  label = "Inventory amount line group",
}: DefineInventoryAmountLineGroupInput<TLine>): readonly TLine[] {
  assertInventoryAmountSum({
    catalog,
    itemId,
    expectedItemRevisionId,
    expectedAmount,
    lines,
    label,
  });
  // This helper groups application-owned generic lines; copying the array must not erase subtype behavior.
  return [...lines];
}

/** Flatten already-validated generic amount-line groups while preserving each application-owned line. */
export function combineInventoryAmountLineGroups<
  TLine extends InventoryAmountLineRead
>(groups: readonly (readonly TLine[])[]): readonly TLine[] {
  const lines: TLine[] = [];
  for (const group of groups) {
    for (const line of group) lines.push(line);
  }
  return lines;
}

/** Snapshot one policy request's documented kernel fields without traversing opaque structural extensions. */
function snapshotInventoryPolicyBatchRequest(
  request: InventoryOncePolicyBatchRequest
): InventoryOncePolicyBatchRequest {
  return {
    requestId: request.requestId,
    selector: normalizeInventoryStockSelector(request.selector),
    amount: snapshotInventoryPolicyAmount(request.amount),
    method: request.method,
    ...(request.groupId === undefined ? {} : { groupId: request.groupId }),
    ...(request.itemRevisionId === undefined
      ? {}
      : { itemRevisionId: request.itemRevisionId }),
    ...(request.allowExpiredLots === undefined
      ? {}
      : { allowExpiredLots: request.allowExpiredLots }),
    ...(request.deficitPosition === undefined
      ? {}
      : { deficitPosition: snapshotInventoryPolicyDeficitPosition(request.deficitPosition) }),
  };
}

/** Snapshot one exact policy amount using only the public amount contract. */
function snapshotInventoryPolicyAmount(amount: InventoryAmount): InventoryAmount {
  const independent = amount.independent.map(
    /** Copy one independently measured axis into kernel-owned request state. */
    (entry) => ({ axisId: entry.axisId, value: entry.value, unit: entry.unit })
  );
  return amount.kind === InventoryAmountKind.Measured
    ? {
        kind: amount.kind,
        primaryValue: amount.primaryValue,
        primaryUnit: amount.primaryUnit,
        independent,
      }
    : {
        kind: amount.kind,
        count: amount.count,
        packagingRevisionId: amount.packagingRevisionId,
        independent,
      };
}

/** Snapshot one optional deficit position using only the public position-input contract. */
function snapshotInventoryPolicyDeficitPosition(
  position: InventoryStockPositionInput
): InventoryStockPositionInput {
  return {
    itemId: position.itemId,
    ...(position.placementNodeId === undefined ? {} : { placementNodeId: position.placementNodeId }),
    ...(position.whereaboutsId === undefined ? {} : { whereaboutsId: position.whereaboutsId }),
    ...(position.whereaboutsState === undefined ? {} : { whereaboutsState: position.whereaboutsState }),
    ...(position.lastPlacementNodeId === undefined ? {} : { lastPlacementNodeId: position.lastPlacementNodeId }),
    ...(position.detachedAtEpochMs === undefined ? {} : { detachedAtEpochMs: position.detachedAtEpochMs }),
    ...(position.missingAtEpochMs === undefined ? {} : { missingAtEpochMs: position.missingAtEpochMs }),
    ...(position.lotId === undefined ? {} : { lotId: position.lotId }),
    ...(position.serialId === undefined ? {} : { serialId: position.serialId }),
    ...(position.packagingRevisionId === undefined
      ? {}
      : { packagingRevisionId: position.packagingRevisionId }),
    ...(position.statusId === undefined ? {} : { statusId: position.statusId }),
    ...(position.ownerId === undefined ? {} : { ownerId: position.ownerId }),
    ...(position.custodianId === undefined ? {} : { custodianId: position.custodianId }),
    ...(position.dispositionAuthorityId === undefined
      ? {}
      : { dispositionAuthorityId: position.dispositionAuthorityId }),
    ...(position.qualifiedDimensions === undefined
      ? {}
      : {
          qualifiedDimensions: position.qualifiedDimensions.map(
            /** Copy one caller-owned qualified dimension into request-owned position state. */
            (dimension) => ({
              dimensionId: dimension.dimensionId,
              valueId: dimension.valueId,
            })
          ),
        }),
  };
}

/** One validated policy-request group belonging to a single application reference. */
export interface InventoryPolicyBatchRequestGroup {
  /** Stable application reference echoed only for allocation partitioning. */
  readonly reference: string;
  /** Non-empty exact native requests whose amounts conserve the parent declaration. */
  readonly requests: readonly InventoryOncePolicyBatchRequest[];
  /** Frozen request-to-reference lookup used by generic allocation reads. */
  readonly referenceByRequestId: ReadonlyMap<string, string>;
}

/** Combined validated policy requests plus their generic allocation references. */
export interface InventoryPolicyBatchRequestSet {
  /** Ordered requests ready for one native policy batch. */
  readonly requests: readonly InventoryOncePolicyBatchRequest[];
  /** Exact request-to-application reference lookup. */
  readonly referenceByRequestId: ReadonlyMap<string, string>;
}

/** Inputs for proving one application request group conserves its parent amount. */
export interface DefineInventoryPolicyBatchRequestGroupInput {
  /** Retained catalogue resolving every request amount. */
  readonly catalog: InventoryCatalog;
  /** Stable item identity shared by the parent and every request. */
  readonly itemId: string;
  /** Frozen revision governing the parent amount. */
  readonly expectedItemRevisionId: string;
  /** Exact parent amount represented by all requests together. */
  readonly expectedAmount: InventoryAmount;
  /** Stable application reference used only to partition returned allocation evidence. */
  readonly reference: string;
  /** Non-empty exact native requests. */
  readonly requests: readonly InventoryOncePolicyBatchRequest[];
  /** Optional diagnostic context for conservation failures. */
  readonly label?: string;
}

/** Define one exact policy-request group and freeze its allocation-read reference. */
export function defineInventoryPolicyBatchRequestGroup({
  catalog,
  itemId,
  expectedItemRevisionId,
  expectedAmount,
  reference,
  requests,
  label = "Inventory policy request group",
}: DefineInventoryPolicyBatchRequestGroupInput): InventoryPolicyBatchRequestGroup {
  if (reference.trim().length === 0) {
    throw new Error("Inventory policy allocation reference must not be empty.");
  }
  if (requests.length === 0) {
    throw new Error(`${label} needs at least one request.`);
  }
  const requestIds = new Set<string>();
  for (const request of requests) {
    if (request.requestId.trim().length === 0) {
      throw new Error("Inventory policy batch requestId must not be empty.");
    }
    if (requestIds.has(request.requestId)) {
      throw new Error(
        `Inventory policy request group repeats requestId '${request.requestId}'.`
      );
    }
    requestIds.add(request.requestId);
    const selector = normalizeInventoryStockSelector(request.selector);
    if (selector.itemId !== itemId) {
      throw new Error(
        `Inventory policy request '${request.requestId}' belongs to another item.`
      );
    }
    const itemRevisionId = request.itemRevisionId ?? expectedItemRevisionId;
    const item = catalog.itemRevision(itemRevisionId);
    if (item.itemId !== itemId) {
      throw new Error(
        `Inventory policy request '${request.requestId}' uses a revision from another item.`
      );
    }
    if (
      selector.itemRevisionIds !== undefined &&
      !selector.itemRevisionIds.includes(itemRevisionId)
    ) {
      throw new Error(
        `Inventory policy request '${request.requestId}' selector excludes its frozen item revision.`
      );
    }
  }
  assertInventoryAmountSum({
    catalog,
    itemId,
    expectedItemRevisionId,
    expectedAmount,
    lines: requests.map(
      /** Retain only the exact amount and frozen revision needed for conservation. */
      (request) => ({
        itemRevisionId: request.itemRevisionId ?? expectedItemRevisionId,
        amount: request.amount,
      })
    ),
    label,
  });
  /** Owned request snapshots whose documented kernel fields cannot be rewritten by the caller. */
  const retainedRequests: InventoryOncePolicyBatchRequest[] = [];
  for (const request of requests) {
    retainedRequests.push(snapshotInventoryPolicyBatchRequest(request));
  }
  return {
    reference,
    requests: retainedRequests,
    referenceByRequestId: new Map(
      retainedRequests.map(
        /** Freeze one native request identity to its application result reference. */
        (request) => [request.requestId, reference]
      )
    ),
  };
}

/** Combine validated request groups while rejecting request identities shared across groups. */
export function combineInventoryPolicyBatchRequestGroups(
  groups: readonly InventoryPolicyBatchRequestGroup[]
): InventoryPolicyBatchRequestSet {
  const requests: InventoryOncePolicyBatchRequest[] = [];
  const referenceByRequestId = new Map<string, string>();
  for (const group of groups) {
    for (const request of group.requests) {
      if (referenceByRequestId.has(request.requestId)) {
        throw new Error(
          `Inventory policy batch repeats requestId '${request.requestId}'.`
        );
      }
      /** Own the documented request fields without imposing cloneability on structural application extensions. */
      const retainedRequest = snapshotInventoryPolicyBatchRequest(request);
      requests.push(retainedRequest);
      const reference = group.referenceByRequestId.get(request.requestId);
      if (reference === undefined) {
        throw new Error(
          `Inventory policy request group lost request '${request.requestId}'.`
        );
      }
      referenceByRequestId.set(request.requestId, reference);
    }
  }
  return { requests, referenceByRequestId };
}

/** Minimal policy allocation shape accepted by the generic application-reference index. */
export interface InventoryPolicyBatchAllocationRead {
  /** Stable native request identity returned by the policy batch. */
  readonly requestId: string;
  /** Exact selected positions and amounts for this request. */
  readonly lines: readonly InventoryOncePolicyBatchAllocationLine[];
}

/** Index native policy allocations by an application-supplied reference without rebuilding allocation truth. */
export function inventoryPolicyBatchAllocationLinesByReference(
  allocations: readonly InventoryPolicyBatchAllocationRead[],
  referenceByRequestId: ReadonlyMap<string, string>
): ReadonlyMap<string, readonly InventoryOncePolicyBatchAllocationLine[]> {
  const result = new Map<string, InventoryOncePolicyBatchAllocationLine[]>();
  for (const allocation of allocations) {
    const reference = referenceByRequestId.get(allocation.requestId);
    if (reference === undefined) {
      throw new Error(
        `Inventory policy batch returned unknown request '${allocation.requestId}'.`
      );
    }
    const lines = result.get(reference) ?? [];
    for (const line of allocation.lines) lines.push(line);
    result.set(reference, lines);
  }
  return result;
}

/** Private implementation of movement-safe physical-count commands. */
class InventoryOnceCountsImplementation implements InventoryOnceCountsApi {
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind count commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Replace one exact bucket by resuming the existing start/observe/reconcile lifecycle. */
  async replaceAbsolute(
    input: InventoryOnceReplaceAbsoluteCountInput
  ): Promise<InventoryOnceCountResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    if (input.metadata?.[inventoryAbsoluteCountMetadataKey] !== undefined) {
      throw new Error(
        `Inventory metadata key '${inventoryAbsoluteCountMetadataKey}' is reserved for absolute-count replay evidence.`
      );
    }
    const requestedSelector = normalizeInventoryStockSelector(input.selector);
    const fallbackPosition =
      input.positionWhenEmpty === undefined
        ? undefined
        : normalizeInventoryStockPositionKey(input.positionWhenEmpty);
    const intentFingerprint = absoluteCountIntentFingerprint(
      input,
      requestedSelector,
      fallbackPosition
    );
    const started = await commitAbsoluteCountStart({
      internals,
      input,
      requestedSelector,
      ...(fallbackPosition === undefined ? {} : { fallbackPosition }),
      intentFingerprint,
    });
    const observedPosition = readAbsoluteCountPosition(
      started.count,
      intentFingerprint
    );
    const observeOperationId = absoluteCountLifecycleOperationId(
      input.operationId,
      "observe"
    );
    const reconcileOperationId = absoluteCountLifecycleOperationId(
      input.operationId,
      "reconcile"
    );
    const observed = await this.observe({
      operationId: observeOperationId,
      countId: input.countId,
      observedAtEpochMs: input.occurredAtEpochMs,
      observations:
        input.observedMeasurements === undefined
          ? []
          : [
              {
                position: observedPosition,
                measurements: input.observedMeasurements,
              },
            ],
    });
    const reconciled = await this.reconcile({
      operationId: reconcileOperationId,
      countId: input.countId,
      completedAtEpochMs: input.occurredAtEpochMs,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    return {
      ...reconciled,
      replayed: started.replayed && observed.replayed && reconciled.replayed,
    };
  }

  /** Open one count snapshot at the current durable event sequence. */
  async start(
    input: InventoryOnceStartCountInput
  ): Promise<InventoryOnceCountResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const selector = normalizeInventoryStockSelector(input.selector);
    const fingerprint = inventoryIntentFingerprint([
      "count-start",
      input.countId,
      input.operationId,
      input.itemRevisionId ?? null,
      inventoryStockSelectorIdentity(selector),
      input.startedAtEpochMs,
      input.actorId ?? null,
      input.sourceReference ?? null,
      inventoryMetadataFingerprint(input.metadata),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Freeze the count's snapshot sequence from the current published event stream. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.startedAtEpochMs,
          recordedAtEpochMs,
          "count start"
        );
        const started = startInventoryCount({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.counts,
          countId: input.countId,
          operationId: input.operationId,
          selector,
          startedAtEpochMs: input.startedAtEpochMs,
          ...(input.itemRevisionId === undefined
            ? {}
            : { itemRevisionId: input.itemRevisionId }),
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.sourceReference === undefined
            ? {}
            : { sourceReference: input.sourceReference }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        });
        return {
          countResult: started,
          countId: input.countId,
        };
      },
    });
    return createInventoryOnceCountResult(result);
  }

  /** Record one complete observation without changing physical stock. */
  async observe(
    input: InventoryOnceObserveCountInput
  ): Promise<InventoryOnceCountResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const observations = normalizeFacadeCountObservations(input.observations);
    const fingerprint = inventoryIntentFingerprint([
      "count-observe",
      input.countId,
      input.observedAtEpochMs,
      observations.map(countObservationFingerprint),
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Record the observation against the current count row and bounded event sequence. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.observedAtEpochMs,
          recordedAtEpochMs,
          "count observation"
        );
        const observed = observeInventoryCount({
          catalog: internals.catalog,
          projection: world.projection,
          book: world.counts,
          operationId: input.operationId,
          countId: input.countId,
          observedAtEpochMs: input.observedAtEpochMs,
          observations,
        });
        return {
          countResult: observed,
          countId: input.countId,
        };
      },
    });
    return createInventoryOnceCountResult(result);
  }

  /** Reconcile only the discrepancy that existed at physical observation time. */
  async reconcile(
    input: InventoryOnceReconcileCountInput
  ): Promise<InventoryOnceCountResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const fingerprint = inventoryIntentFingerprint([
      "count-reconcile",
      input.countId,
      input.completedAtEpochMs,
      input.actorId ?? null,
      input.reason ?? null,
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Derive and freeze the observation-time discrepancy plus terminal count row together. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.completedAtEpochMs,
          recordedAtEpochMs,
          "count reconciliation"
        );
        const plan = createInventoryCountReconciliationPlan({
          catalog: internals.catalog,
          events: inventoryCommittedEventsInSequence(world.projection),
          deficitPolicy: internals.deficitPolicy,
          book: world.counts,
          operationId: input.operationId,
          countId: input.countId,
          completedAtEpochMs: input.completedAtEpochMs,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        });
        const completed = completeInventoryCount({
          book: world.counts,
          operationId: input.operationId,
          countId: input.countId,
          intentFingerprint: plan.intentFingerprint,
          completedAtEpochMs: input.completedAtEpochMs,
          ...(plan.event === undefined
            ? {}
            : { reconciliationEventId: plan.event.eventId }),
        });
        return {
          ...(plan.event === undefined ? {} : { event: plan.event }),
          countResult: completed,
          countId: input.countId,
        };
      },
    });
    return createInventoryOnceCountResult(result);
  }

  /** Abandon one non-terminal count without changing physical stock. */
  async abandon(
    input: InventoryOnceAbandonCountInput
  ): Promise<InventoryOnceCountResult> {
    const internals = requireInventoryOnceInternals(this.owner);
    const fingerprint = inventoryIntentFingerprint([
      "count-abandon",
      input.countId,
      input.occurredAtEpochMs,
      input.reason,
    ]);
    const result = await commitInventoryOperation({
      catalog: internals.catalog,
      storage: internals.storage,
      operationId: input.operationId,
      intentFingerprint: fingerprint,
      clock: internals.clock,
      deficitPolicy: internals.deficitPolicy,
      /** Mark the current non-terminal count abandoned without touching stock. */
      plan: ({ world, recordedAtEpochMs }) => {
        assertInventoryLifecycleTimeWasRecorded(
          input.occurredAtEpochMs,
          recordedAtEpochMs,
          "count abandonment"
        );
        const abandoned = abandonInventoryCount({
          ...input,
          book: world.counts,
        });
        return {
          countResult: abandoned,
          countId: input.countId,
        };
      },
    });
    return createInventoryOnceCountResult(result);
  }
}

/** Inputs for atomically freezing one exact bucket into the count-start stage. */
interface CommitAbsoluteCountStartInput {
  /** Private façade dependencies used by the normal lifecycle planners. */
  readonly internals: InventoryOnceInternals;
  /** Complete public one-call command. */
  readonly input: InventoryOnceReplaceAbsoluteCountInput;
  /** Normalized candidate scope supplied by the caller. */
  readonly requestedSelector: InventoryStockSelector;
  /** Exact fallback bucket used only when the candidate scope is currently empty. */
  readonly fallbackPosition?: InventoryStockPositionKey;
  /** Stable complete caller-intent fingerprint. */
  readonly intentFingerprint: string;
}

/** Freeze exact bucket selection and preflight the later lifecycle stages in the durable start planner. */
async function commitAbsoluteCountStart({
  internals,
  input,
  requestedSelector,
  fallbackPosition,
  intentFingerprint,
}: CommitAbsoluteCountStartInput): Promise<InventoryOnceCountResult> {
  const startOperationId = input.operationId;
  const result = await commitInventoryOperation({
    catalog: internals.catalog,
    storage: internals.storage,
    operationId: startOperationId,
    intentFingerprint: inventoryIntentFingerprint([
      "absolute-count-start-v2",
      input.countId,
      intentFingerprint,
    ]),
    clock: internals.clock,
    deficitPolicy: internals.deficitPolicy,
    /** Resolve the exact bucket against the same world revision the count start publishes from. */
    plan: ({ world, recordedAtEpochMs }) => {
      assertInventoryLifecycleTimeWasRecorded(
        input.occurredAtEpochMs,
        recordedAtEpochMs,
        "absolute count start"
      );
      const item =
        input.itemRevisionId === undefined
          ? internals.catalog.activeItem(requestedSelector.itemId)
          : internals.catalog.itemRevision(input.itemRevisionId);
      if (item.itemId !== requestedSelector.itemId) {
        throw new Error(
          "Absolute count selector item differs from the requested item revision."
        );
      }
      if (
        requestedSelector.itemRevisionIds !== undefined &&
        !requestedSelector.itemRevisionIds.includes(item.revisionId)
      ) {
        throw new Error(
          "Absolute count selector excludes the requested item revision."
        );
      }
      const revisionSelector = normalizeInventoryStockSelector({
        ...requestedSelector,
        itemRevisionIds: [item.revisionId],
      });
      const currentPosition = findSingleNonzeroCountPosition(
        world.projection,
        revisionSelector
      );
      const observedPosition = currentPosition ?? fallbackPosition;
      if (observedPosition === undefined) {
        throw new Error(
          "Absolute count replacement needs positionWhenEmpty when its selector has no current stock position."
        );
      }
      assertPositionInsideSelector(
        observedPosition,
        revisionSelector,
        world.projection.placement
      );
      assertAbsoluteCountPositionMatchesItem(
        internals.catalog,
        item,
        observedPosition
      );
      const exactSelector = exactCountSelectorForPosition(
        item,
        observedPosition
      );
      const metadata: InventoryMetadata = {
        ...(input.metadata ?? {}),
        [inventoryAbsoluteCountMetadataKey]: {
          version: inventoryAbsoluteCountMetadataVersion,
          intentFingerprint,
          position: absoluteCountPositionMetadataValue(observedPosition),
        },
      };
      const started = startInventoryCount({
        catalog: internals.catalog,
        projection: world.projection,
        book: world.counts,
        countId: input.countId,
        operationId: startOperationId,
        itemRevisionId: item.revisionId,
        selector: exactSelector,
        startedAtEpochMs: input.occurredAtEpochMs,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.sourceReference === undefined
          ? {}
          : { sourceReference: input.sourceReference }),
        metadata,
      });
      const observeOperationId = absoluteCountLifecycleOperationId(
        input.operationId,
        "observe"
      );
      const observed = observeInventoryCount({
        catalog: internals.catalog,
        projection: world.projection,
        book: started.book,
        operationId: observeOperationId,
        countId: input.countId,
        observedAtEpochMs: input.occurredAtEpochMs,
        observations:
          input.observedMeasurements === undefined
            ? []
            : [
                {
                  position: observedPosition,
                  measurements: input.observedMeasurements,
                },
              ],
      });
      const reconcileOperationId = absoluteCountLifecycleOperationId(
        input.operationId,
        "reconcile"
      );
      const reconciliation = createInventoryCountReconciliationPlan({
        catalog: internals.catalog,
        events: inventoryCommittedEventsInSequence(world.projection),
        deficitPolicy: internals.deficitPolicy,
        book: observed.book,
        operationId: reconcileOperationId,
        countId: input.countId,
        completedAtEpochMs: input.occurredAtEpochMs,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      });
      completeInventoryCount({
        book: observed.book,
        operationId: reconcileOperationId,
        countId: input.countId,
        intentFingerprint: reconciliation.intentFingerprint,
        completedAtEpochMs: input.occurredAtEpochMs,
        ...(reconciliation.event === undefined
          ? {}
          : { reconciliationEventId: reconciliation.event.eventId }),
      });
      return {
        countResult: started,
        countId: input.countId,
      };
    },
  });
  return createInventoryOnceCountResult(result);
}

/** Read retained event history through the rebuildable durable-sequence index. */
function inventoryCommittedEventsInSequence(
  projection: InventoryProjectionState
): readonly InventoryCommittedEvent[] {
  const events: InventoryCommittedEvent[] = [];
  for (
    let sequence = 1;
    sequence <= projection.lastRecordSequence;
    sequence += 1
  ) {
    const eventId = projection.eventIdsBySequence[String(sequence)];
    if (eventId === undefined) {
      throw new Error(
        `Inventory event sequence index is missing recordSequence ${sequence}.`
      );
    }
    const event = inventorySparseRecordValue(projection.events, eventId);
    if (event === undefined || event.recordSequence !== sequence) {
      throw new Error(
        `Inventory event sequence index disagrees at recordSequence ${sequence}.`
      );
    }
    events.push(event);
  }
  return events;
}

/** One stable lifecycle operation identity derived from an absolute-count command. */
function absoluteCountLifecycleOperationId(
  operationId: string,
  stage: "start" | "observe" | "reconcile"
): string {
  if (operationId.trim().length === 0) {
    throw new Error("Absolute count operationId must not be empty.");
  }
  return `${operationId}:${stage}`;
}

/** Return the only current non-zero bucket in a count scope, or fail if it is ambiguous. */
function findSingleNonzeroCountPosition(
  projection: InventoryWorldState["projection"],
  selector: InventoryStockSelector
): InventoryStockPositionKey | undefined {
  const positions = findInventoryPositions(projection, selector);
  let found: InventoryStockPositionKey | undefined;
  for (const position of positions) {
    if (inventoryMeasurementsAreZero(position.measurements)) continue;
    if (found !== undefined) {
      throw new Error(
        "Absolute count replacement selector resolves to more than one current stock position."
      );
    }
    found = position.key;
  }
  return found;
}

/** Validate one selected exact bucket against its frozen item/package definitions. */
function assertAbsoluteCountPositionMatchesItem(
  catalog: InventoryCatalog,
  item: InventoryItemDefinitionRevision,
  position: InventoryStockPositionKey
): void {
  if (
    position.itemId !== item.itemId ||
    position.itemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Absolute count position differs from its frozen item revision."
    );
  }
  assertPositionMatchesItem(item, position);
  const packagingRevisionId = position.packagingRevisionId;
  if (packagingRevisionId === undefined) return;
  const packaging = catalog.packagingRevision(packagingRevisionId);
  if (
    packaging.itemId !== item.itemId ||
    packaging.itemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Absolute count position package differs from its frozen item revision."
    );
  }
}

/** Build one selector that matches only the supplied exact stock-position identity. */
function exactCountSelectorForPosition(
  item: InventoryItemDefinitionRevision,
  rawPosition: InventoryStockPositionKey
): InventoryStockSelector {
  const position = normalizeInventoryStockPositionKey(rawPosition);
  const valueByDimensionId = new Map<string, string>();
  for (const dimension of position.qualifiedDimensions ?? []) {
    valueByDimensionId.set(dimension.dimensionId, dimension.valueId);
  }
  const qualifiedDimensions: InventoryQualifiedDimensionConstraint[] = [];
  for (const definition of item.qualifiedDimensions) {
    const valueId = valueByDimensionId.get(definition.dimensionId);
    qualifiedDimensions.push(
      valueId === undefined
        ? {
            dimensionId: definition.dimensionId,
            kind: InventoryOptionalIdentityConstraintKind.Absent,
          }
        : {
            dimensionId: definition.dimensionId,
            kind: InventoryOptionalIdentityConstraintKind.Allowed,
            valueIds: [valueId],
          }
    );
  }
  return normalizeInventoryStockSelector({
    itemId: position.itemId,
    itemRevisionIds: [position.itemRevisionId],
    placement: exactOptionalIdentityConstraint(position.placementNodeId),
    whereabouts: exactOptionalIdentityConstraint(position.whereaboutsId),
    ...(position.whereaboutsState === undefined
      ? {}
      : { whereaboutsStates: [position.whereaboutsState] }),
    lot: exactOptionalIdentityConstraint(position.lotId),
    serial: exactOptionalIdentityConstraint(position.serialId),
    packagingRevision: exactOptionalIdentityConstraint(
      position.packagingRevisionId
    ),
    status: exactOptionalIdentityConstraint(position.statusId),
    owner: exactOptionalIdentityConstraint(position.ownerId),
    custodian: exactOptionalIdentityConstraint(position.custodianId),
    dispositionAuthority: exactOptionalIdentityConstraint(
      position.dispositionAuthorityId
    ),
    ...(qualifiedDimensions.length === 0 ? {} : { qualifiedDimensions }),
  });
}

/** Build one exact allowed-value or explicit-absence selector rule. */
function exactOptionalIdentityConstraint(
  value: string | undefined
): InventoryOptionalIdentityConstraint {
  return value === undefined
    ? { kind: InventoryOptionalIdentityConstraintKind.Absent }
    : {
        kind: InventoryOptionalIdentityConstraintKind.Allowed,
        valueIds: [value],
      };
}

/** Encode one exact position as JSON-safe count metadata without losing empty-vs-omitted dimensions. */
function absoluteCountPositionMetadataValue(
  rawPosition: InventoryStockPositionKey
): InventoryMetadataValue {
  const position = normalizeInventoryStockPositionKey(rawPosition);
  return [
    position.itemId,
    position.itemRevisionId,
    position.placementNodeId ?? null,
    position.whereaboutsId ?? null,
    position.whereaboutsState ?? null,
    position.lastPlacementNodeId ?? null,
    position.detachedAtEpochMs ?? null,
    position.missingAtEpochMs ?? null,
    position.lotId ?? null,
    position.serialId ?? null,
    position.packagingRevisionId ?? null,
    position.statusId ?? null,
    position.ownerId ?? null,
    position.custodianId ?? null,
    position.dispositionAuthorityId ?? null,
    position.qualifiedDimensions === undefined
      ? null
      : position.qualifiedDimensions.map(
          /** Retain one exact configured dimension/value pair in canonical order. */
          (dimension) => [dimension.dimensionId, dimension.valueId]
        ),
  ];
}

/** Recover the exact bucket frozen into the durable absolute-count start metadata. */
function readAbsoluteCountPosition(
  count: InventoryCount,
  expectedIntentFingerprint: string
): InventoryStockPositionKey {
  const evidence = requireAbsoluteCountMetadataRecord(
    count.metadata?.[inventoryAbsoluteCountMetadataKey],
    `Inventory count '${count.countId}' absolute-count evidence`
  );
  if (
    evidence.version !== inventoryAbsoluteCountMetadataVersion ||
    evidence.intentFingerprint !== expectedIntentFingerprint
  ) {
    throw new Error(
      `Inventory count '${count.countId}' has changed absolute-count replay evidence.`
    );
  }
  const encoded = evidence.position;
  if (!isAbsoluteCountMetadataArray(encoded) || encoded.length !== 16) {
    throw new Error(
      `Inventory count '${count.countId}' has invalid absolute-count position evidence.`
    );
  }
  const placementNodeId = readAbsoluteCountOptionalMetadataString(
    encoded[2],
    "placementNodeId"
  );
  const whereaboutsId = readAbsoluteCountOptionalMetadataString(
    encoded[3],
    "whereaboutsId"
  );
  const whereaboutsState = readAbsoluteCountOptionalWhereaboutsState(
    encoded[4]
  );
  const lastPlacementNodeId = readAbsoluteCountOptionalMetadataString(
    encoded[5],
    "lastPlacementNodeId"
  );
  const detachedAtEpochMs = readAbsoluteCountOptionalMetadataEpoch(
    encoded[6],
    "detachedAtEpochMs"
  );
  const missingAtEpochMs = readAbsoluteCountOptionalMetadataEpoch(
    encoded[7],
    "missingAtEpochMs"
  );
  const lotId = readAbsoluteCountOptionalMetadataString(encoded[8], "lotId");
  const serialId = readAbsoluteCountOptionalMetadataString(
    encoded[9],
    "serialId"
  );
  const packagingRevisionId = readAbsoluteCountOptionalMetadataString(
    encoded[10],
    "packagingRevisionId"
  );
  const statusId = readAbsoluteCountOptionalMetadataString(
    encoded[11],
    "statusId"
  );
  const ownerId = readAbsoluteCountOptionalMetadataString(
    encoded[12],
    "ownerId"
  );
  const custodianId = readAbsoluteCountOptionalMetadataString(
    encoded[13],
    "custodianId"
  );
  const dispositionAuthorityId = readAbsoluteCountOptionalMetadataString(
    encoded[14],
    "dispositionAuthorityId"
  );
  const qualifiedDimensions = readAbsoluteCountQualifiedDimensions(
    encoded[15],
    count.countId
  );
  const position = normalizeInventoryStockPositionKey({
    itemId: requireAbsoluteCountMetadataString(encoded[0], "itemId"),
    itemRevisionId: requireAbsoluteCountMetadataString(
      encoded[1],
      "itemRevisionId"
    ),
    ...(placementNodeId === undefined ? {} : { placementNodeId }),
    ...(whereaboutsId === undefined ? {} : { whereaboutsId }),
    ...(whereaboutsState === undefined ? {} : { whereaboutsState }),
    ...(lastPlacementNodeId === undefined ? {} : { lastPlacementNodeId }),
    ...(detachedAtEpochMs === undefined ? {} : { detachedAtEpochMs }),
    ...(missingAtEpochMs === undefined ? {} : { missingAtEpochMs }),
    ...(lotId === undefined ? {} : { lotId }),
    ...(serialId === undefined ? {} : { serialId }),
    ...(packagingRevisionId === undefined ? {} : { packagingRevisionId }),
    ...(statusId === undefined ? {} : { statusId }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(custodianId === undefined ? {} : { custodianId }),
    ...(dispositionAuthorityId === undefined ? {} : { dispositionAuthorityId }),
    ...(qualifiedDimensions === undefined ? {} : { qualifiedDimensions }),
  });
  assertPositionInsideSelector(position, count.selector);
  if (position.itemRevisionId !== count.itemRevisionId) {
    throw new Error(
      `Inventory count '${count.countId}' position evidence differs from its frozen item revision.`
    );
  }
  return position;
}

/** Narrow one recursive metadata value to its object-record form. */
function requireAbsoluteCountMetadataRecord(
  value: InventoryMetadataValue | undefined,
  label: string
): Readonly<Record<string, InventoryMetadataValue>> {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    isAbsoluteCountMetadataArray(value)
  ) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

/** Narrow one recursive JSON-safe metadata value to its array form. */
function isAbsoluteCountMetadataArray(
  value: InventoryMetadataValue | undefined
): value is readonly InventoryMetadataValue[] {
  return Array.isArray(value);
}

/** Read one required non-empty string from absolute-count position evidence. */
function requireAbsoluteCountMetadataString(
  value: InventoryMetadataValue | undefined,
  label: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Absolute-count ${label} must be a non-empty string.`);
  }
  return value;
}

/** Read one optional non-empty string or explicit null from position evidence. */
function readAbsoluteCountOptionalMetadataString(
  value: InventoryMetadataValue | undefined,
  label: string
): string | undefined {
  if (value === null) return undefined;
  return requireAbsoluteCountMetadataString(value, label);
}

/** Read one optional detached/missing state or explicit null from position evidence. */
function readAbsoluteCountOptionalWhereaboutsState(
  value: InventoryMetadataValue | undefined
): InventoryStockWhereaboutsState | undefined {
  if (value === null) return undefined;
  if (value === InventoryStockWhereaboutsState.Detached) {
    return InventoryStockWhereaboutsState.Detached;
  }
  if (value === InventoryStockWhereaboutsState.Missing) {
    return InventoryStockWhereaboutsState.Missing;
  }
  throw new Error("Absolute-count whereaboutsState must be detached, missing, or null.");
}

/** Read one optional safe-integer epoch millisecond or explicit null from position evidence. */
function readAbsoluteCountOptionalMetadataEpoch(
  value: InventoryMetadataValue | undefined,
  label: string
): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== "number") {
    throw new Error(`Absolute-count ${label} must be a number or null.`);
  }
  assertInventoryEpochMilliseconds(value, `absolute-count ${label}`);
  return value;
}

/** Decode exact qualified dimensions while preserving omitted versus empty position shape. */
function readAbsoluteCountQualifiedDimensions(
  value: InventoryMetadataValue | undefined,
  countId: string
): InventoryQualifiedDimension[] | undefined {
  if (value === null) return undefined;
  if (!isAbsoluteCountMetadataArray(value)) {
    throw new Error(
      `Inventory count '${countId}' has invalid qualified-dimension evidence.`
    );
  }
  const dimensions: InventoryQualifiedDimension[] = [];
  for (const encoded of value) {
    if (!isAbsoluteCountMetadataArray(encoded) || encoded.length !== 2) {
      throw new Error(
        `Inventory count '${countId}' has invalid qualified-dimension evidence.`
      );
    }
    dimensions.push({
      dimensionId: requireAbsoluteCountMetadataString(
        encoded[0],
        "qualified dimension id"
      ),
      valueId: requireAbsoluteCountMetadataString(
        encoded[1],
        "qualified dimension value"
      ),
    });
  }
  return dimensions;
}

/** Freeze every caller-visible absolute-count field into the durable start identity. */
function absoluteCountIntentFingerprint(
  input: InventoryOnceReplaceAbsoluteCountInput,
  requestedSelector: InventoryStockSelector,
  fallbackPosition: InventoryStockPositionKey | undefined
): string {
  return inventoryIntentFingerprint([
    "absolute-count-replacement-v3",
    input.operationId,
    input.countId,
    input.itemRevisionId ?? null,
    inventoryStockSelectorIdentity(requestedSelector),
    fallbackPosition === undefined
      ? null
      : inventoryStockPositionIdentity(fallbackPosition),
    input.occurredAtEpochMs,
    input.observedMeasurements === undefined
      ? null
      : inventoryMeasurementsFingerprint(input.observedMeasurements),
    input.actorId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
  ]);
}

/** Normalize physical-count observations for stable retries before durable begin. */
function normalizeFacadeCountObservations(
  observations: readonly InventoryCountObservationLine[]
): readonly InventoryCountObservationLine[] {
  const normalized = [...observations];
  normalized.sort(compareCountObservationLine);
  let previousPositionId: string | undefined;
  for (const observation of normalized) {
    const positionId = inventoryStockPositionIdentity(observation.position);
    if (positionId === previousPositionId) {
      throw new Error(`Count observation repeats position ${positionId}.`);
    }
    previousPositionId = positionId;
  }
  return normalized;
}

/** Stable count-observation fingerprint. */
function countObservationFingerprint(
  observation: InventoryCountObservationLine
): string {
  return inventoryIntentFingerprint([
    inventoryStockPositionIdentity(observation.position),
    inventoryMeasurementsFingerprint(observation.measurements),
  ]);
}

/** Sort count observations by exact stock-position identity. */
function compareCountObservationLine(
  left: InventoryCountObservationLine,
  right: InventoryCountObservationLine
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Private implementation of explicit association traceability verbs. */
class InventoryOnceTraceabilityImplementation
  implements InventoryOnceTraceabilityApi
{
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind graph commands to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Add one durable association/installation relationship. */
  async associate(
    input: InventoryOnceRelationInput
  ): Promise<InventoryOnceEventResult> {
    return this.commitRelation(
      input,
      InventoryTraceabilityRelationAction.Add,
      InventoryTraceabilityRelationKind.Association
    );
  }

  /** Remove one reversible association/installation relationship. */
  async disassociate(
    input: InventoryOnceRelationInput
  ): Promise<InventoryOnceEventResult> {
    return this.commitRelation(
      input,
      InventoryTraceabilityRelationAction.Remove,
      InventoryTraceabilityRelationKind.Association
    );
  }

  /** Commit one explicit relation action through the same event/storage boundary. */
  private async commitRelation(
    input: InventoryOnceRelationInput,
    action: InventoryTraceabilityRelationAction,
    kind: InventoryTraceabilityRelationKind
  ): Promise<InventoryOnceEventResult> {
    const { catalog } = requireInventoryOnceInternals(this.owner);
    return commitInventoryEventDraft(
      this.owner,
      createInventoryTraceabilityEvent({
        catalog,
        operationId: input.operationId,
        occurredAtEpochMs: input.occurredAtEpochMs,
        changes: [{ action, kind, from: input.from, to: input.to }],
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.sourcePartyId === undefined
          ? {}
          : { sourcePartyId: input.sourcePartyId }),
        ...(input.destinationPartyId === undefined
          ? {}
          : { destinationPartyId: input.destinationPartyId }),
        ...(input.sourceReference === undefined
          ? {}
          : { sourceReference: input.sourceReference }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      })
    );
  }
}


/** Filter current unresolved whereabouts truth without requiring one item-scoped selector. */
function findInventoryWhereaboutsPositions(
  projection: InventoryProjectionState,
  input: InventoryOnceWhereaboutsQuery
): readonly InventoryStockPosition[] {
  const itemIds = normalizeOptionalInventoryWhereaboutsIdentitySet(
    input.itemIds,
    "whereabouts itemIds"
  );
  const whereaboutsIds = normalizeOptionalInventoryWhereaboutsIdentitySet(
    input.whereaboutsIds,
    "whereabouts whereaboutsIds"
  );
  const lastPlacementNodeIds = normalizeOptionalInventoryWhereaboutsIdentitySet(
    input.lastPlacementNodeIds,
    "whereabouts lastPlacementNodeIds"
  );
  if (input.detachedBeforeEpochMs !== undefined) {
    assertInventoryEpochMilliseconds(
      input.detachedBeforeEpochMs,
      "whereabouts detachedBeforeEpochMs"
    );
  }
  if (input.missingBeforeEpochMs !== undefined) {
    assertInventoryEpochMilliseconds(
      input.missingBeforeEpochMs,
      "whereabouts missingBeforeEpochMs"
    );
  }
  const states = input.states === undefined ? undefined : new Set(input.states);
  if (states !== undefined) {
    if (states.size === 0) {
      throw new Error("Whereabouts states must be omitted instead of empty.");
    }
    for (const state of states) {
      if (
        state !== InventoryStockWhereaboutsState.Detached &&
        state !== InventoryStockWhereaboutsState.Missing
      ) {
        throw new Error("Whereabouts query contains an unknown state.");
      }
    }
  }
  // Exact cohorts and item filters are already backed by private indexes:
  // avoid scanning unrelated warehouse stock just to answer a narrow query.
  let candidates: readonly InventoryStockPosition[];
  if (whereaboutsIds !== undefined) {
    const selected: InventoryStockPosition[] = [];
    for (const whereaboutsId of whereaboutsIds) {
      const positionIds =
        inventorySparseRecordValue(
          projection.positionIdsByWhereaboutsId,
          whereaboutsId
        ) ?? [];
      for (const positionId of positionIds) {
        const position = inventorySparseRecordValue(
          projection.positions,
          positionId
        );
        if (
          position === undefined ||
          position.key.whereaboutsId !== whereaboutsId
        ) {
          throw new Error(
            "Whereabouts cohort-position index references invalid stock."
          );
        }
        selected.push(position);
      }
    }
    candidates = selected;
  } else if (itemIds !== undefined) {
    const selected: InventoryStockPosition[] = [];
    for (const itemId of itemIds) {
      const positionIds =
        inventorySparseRecordValue(projection.positionIdsByItemId, itemId) ?? [];
      for (const positionId of positionIds) {
        const position = inventorySparseRecordValue(
          projection.positions,
          positionId
        );
        if (position === undefined) {
          throw new Error(
            "Whereabouts item-position index references missing stock."
          );
        }
        selected.push(position);
      }
    }
    candidates = selected;
  } else {
    candidates = Object.values(projection.positions);
  }
  const result: InventoryStockPosition[] = [];
  for (const position of candidates) {
    const key = position.key;
    if (
      key.whereaboutsId === undefined ||
      key.whereaboutsState === undefined ||
      key.lastPlacementNodeId === undefined ||
      key.detachedAtEpochMs === undefined
    ) {
      continue;
    }
    if (itemIds !== undefined && !itemIds.has(key.itemId)) continue;
    if (states !== undefined && !states.has(key.whereaboutsState)) continue;
    if (whereaboutsIds !== undefined && !whereaboutsIds.has(key.whereaboutsId))
      continue;
    if (
      lastPlacementNodeIds !== undefined &&
      !lastPlacementNodeIds.has(key.lastPlacementNodeId)
    ) {
      continue;
    }
    if (
      input.detachedBeforeEpochMs !== undefined &&
      key.detachedAtEpochMs > input.detachedBeforeEpochMs
    ) {
      continue;
    }
    if (input.missingBeforeEpochMs !== undefined) {
      if (
        key.whereaboutsState !== InventoryStockWhereaboutsState.Missing ||
        key.missingAtEpochMs === undefined ||
        key.missingAtEpochMs > input.missingBeforeEpochMs
      ) {
        continue;
      }
    }
    result.push(position);
  }
  result.sort(
    /** Sort unresolved rows by canonical full position identity. */
    (left, right) =>
    compareInventoryIdentityText(
      inventoryStockPositionIdentity(left.key),
      inventoryStockPositionIdentity(right.key)
    )
  );
  return result;
}

/** Attach current filtered unresolved rows to their complete retained lifecycle provenance. */
function findCurrentInventoryWhereaboutsLifecycles(
  projection: InventoryProjectionState,
  input: InventoryOnceWhereaboutsQuery
): readonly InventoryWhereaboutsLifecycle[] {
  const filteredPositions = findInventoryWhereaboutsPositions(projection, input);
  /** Exact current filtered rows grouped by stable lifecycle identity. */
  const positionsByWhereaboutsId = new Map<string, InventoryStockPosition[]>();
  for (const position of filteredPositions) {
    const whereaboutsId = position.key.whereaboutsId;
    if (whereaboutsId === undefined) {
      throw new Error("Filtered unresolved stock lost its whereabouts identity.");
    }
    const positions = positionsByWhereaboutsId.get(whereaboutsId) ?? [];
    positions.push(position);
    positionsByWhereaboutsId.set(whereaboutsId, positions);
  }
  const result: InventoryWhereaboutsLifecycle[] = [];
  const selectedWhereaboutsIds = new Set(positionsByWhereaboutsId.keys());
  for (const lifecycle of inventoryWhereaboutsLifecycles(
    projection,
    selectedWhereaboutsIds
  )) {
    const currentPositions = positionsByWhereaboutsId.get(
      lifecycle.whereaboutsId
    );
    if (currentPositions === undefined) continue;
    result.push({
      ...lifecycle,
      currentPositions,
      resolved: false,
    });
  }
  return result;
}

/** Normalize one optional whereabouts query identity set. */
function normalizeOptionalInventoryWhereaboutsIdentitySet(
  values: readonly string[] | undefined,
  label: string
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0) {
    throw new Error(label + " must be omitted instead of empty.");
  }
  const result = new Set<string>();
  for (const value of values) {
    assertInventoryIdentity(value, label + " identity");
    result.add(value);
  }
  return result;
}

/** Private immutable implementation of one snapshot-bound public read surface. */
class InventoryOnceReadSnapshotImplementation
  implements InventoryOnceReadSnapshotApi
{
  /** Exact published world revision backing this object. */
  readonly worldRevision: number;
  /** Fully published world frozen for every method. */
  private readonly world: InventoryWorldState;
  /** Exact retained catalogue from the same published world. */
  private readonly catalog: InventoryCatalog;
  /** Default lifecycle time frozen when the snapshot was created. */
  private readonly defaultAtEpochMs: number;

  /** Bind every public read helper to one coherent world/catalogue pair. */
  constructor(
    world: InventoryWorldState,
    catalog: InventoryCatalog,
    defaultAtEpochMs: number
  ) {
    this.world = world;
    this.catalog = catalog;
    this.defaultAtEpochMs = defaultAtEpochMs;
    this.worldRevision = world.revision;
  }

  /** Read current positions matching one broad selector. */
  positions(
    selector: InventoryStockSelector
  ): ReturnType<typeof findInventoryPositions> {
    return findInventoryPositions(this.world.projection, selector);
  }

  /** Read current detached/missing lifecycles from the frozen world. */
  whereabouts(
    input: InventoryOnceWhereaboutsQuery = {}
  ): readonly InventoryWhereaboutsLifecycle[] {
    return findCurrentInventoryWhereaboutsLifecycles(
      this.world.projection,
      input
    );
  }

  /** Read complete current/resolved whereabouts history from the frozen world. */
  whereaboutsHistory(
    input: InventoryWhereaboutsHistoryQuery = {}
  ): readonly InventoryWhereaboutsLifecycle[] {
    return findInventoryWhereaboutsHistory(this.world.projection, input);
  }

  /** Query retained events from this exact frozen world. */
  events(input: InventoryEventQuery = {}): InventoryEventPage {
    return queryInventoryProjectionEvents(this.world.projection, input);
  }

  /** Read one revision-safe physical summary from the frozen world. */
  summary(selector: InventoryStockSelector): InventoryStockSummary {
    return summarizeInventoryStock({
      catalog: this.catalog,
      projection: this.world.projection,
      selector,
    });
  }

  /** Read truthful availability from the frozen world and claim book. */
  availability(
    selector: InventoryStockSelector,
    atEpochMs = this.defaultAtEpochMs
  ): InventoryAvailabilitySummary {
    return summarizeInventoryAvailability({
      catalog: this.catalog,
      projection: this.world.projection,
      reservations: this.world.reservations,
      selector,
      atEpochMs,
    });
  }

  /** Preview FIFO/FEFO allocation without consulting a newer world. */
  planAllocation(
    input: InventoryOncePlanAllocationInput
  ): InventoryPolicyAllocationPlan {
    return planInventoryAllocation({
      catalog: this.catalog,
      world: this.world,
      selector: input.selector,
      amount: input.amount,
      method: input.method,
      atEpochMs: input.atEpochMs ?? this.defaultAtEpochMs,
      ...(input.reservationAtEpochMs === undefined
        ? {}
        : { reservationAtEpochMs: input.reservationAtEpochMs }),
      ...(input.itemRevisionId === undefined
        ? {}
        : { itemRevisionId: input.itemRevisionId }),
      ...(input.allowExpiredLots === undefined
        ? {}
        : { allowExpiredLots: input.allowExpiredLots }),
      ...(input.reservationId === undefined
        ? {}
        : { reservationId: input.reservationId }),
      ...(input.allowAllocatedStock === undefined
        ? {}
        : { allowAllocatedStock: input.allowAllocatedStock }),
    });
  }

  /** List exact retained package revisions without reading storage again. */
  packagingRevisions(
    input: Omit<ListInventoryPackagingRevisionsInput, "catalog">
  ): ReturnType<typeof listInventoryPackagingRevisions> {
    return listInventoryPackagingRevisions({
      catalog: this.catalog,
      ...input,
    });
  }

  /** Read one current placement-node metadata master by exact identity. */
  placementNode(
    nodeId: string
  ): InventoryProjectedPlacementNodeDefinition | undefined {
    inventoryPlacementNodeIdentity(nodeId);
    return inventorySparseRecordValue(
      this.world.projection.placementNodes,
      nodeId
    );
  }

  /** List current placement-node metadata masters in stable identity order. */
  placementNodes(): readonly InventoryProjectedPlacementNodeDefinition[] {
    const result = Object.values(this.world.projection.placementNodes);
    result.sort(compareProjectedPlacementNodeDefinition);
    return result;
  }

  /** Read one node's current direct parent. */
  placementParent(nodeId: string): string | undefined {
    return inventoryPlacementParentNodeId(
      this.world.projection.placement,
      nodeId
    );
  }

  /** Read one node's current direct children in stable identity order. */
  placementChildren(nodeId: string): readonly string[] {
    inventoryPlacementNodeIdentity(nodeId);
    return (
      inventorySparseRecordValue(
        this.world.projection.placement.childNodeIdsByParentNodeId,
        nodeId
      ) ?? []
    );
  }

  /** Read one node followed by every current direct ancestor. */
  placementAncestry(nodeId: string): readonly string[] {
    return inventoryPlacementAncestry(
      this.world.projection.placement,
      nodeId
    );
  }

  /** Read one current item-scoped lot master by exact identity. */
  lot(
    itemId: string,
    lotId: string
  ): InventoryProjectedLotDefinition | undefined {
    return this.world.projection.lots[inventoryLotIdentity(itemId, lotId)];
  }

  /** List current lot masters in stable item/lot order. */
  lots(itemId?: string): readonly InventoryProjectedLotDefinition[] {
    return inventoryProjectedLots(this.world.projection, itemId);
  }

  /** List frozen compositions whose exact source package belongs to one item. */
  compositionRevisionsForItem(
    itemId: string
  ): readonly InventoryCompositionDefinitionRevision[] {
    const result: InventoryCompositionDefinitionRevision[] = [];
    for (const composition of this.catalog.compositionRevisions) {
      const packaging = this.catalog.packagingRevision(
        composition.sourcePackagingRevisionId
      );
      if (packaging.itemId === itemId) result.push(composition);
    }
    result.sort(compareInventoryCompositionRevision);
    return result;
  }

  /** Summarize one exact read-only collection revision from the frozen world. */
  collectionSummary(
    input: InventoryOnceCollectionSummaryInput
  ): InventoryCollectionSummary {
    return summarizeInventoryCollection({
      catalog: this.catalog,
      projection: this.world.projection,
      collectionRevisionId: input.collectionRevisionId,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    });
  }

  /** Summarize one exact fungibility revision from the frozen world. */
  fungibilitySummary(
    input: InventoryOnceFungibilitySummaryInput
  ): InventoryFungibilitySummary {
    return summarizeInventoryFungibility({
      catalog: this.catalog,
      projection: this.world.projection,
      fungibilityRevisionId: input.fungibilityRevisionId,
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    });
  }

  /** Read one committed event by identity. */
  event(eventId: string): InventoryCommittedEvent | undefined {
    return inventorySparseRecordValue(this.world.projection.events, eventId);
  }

  /** Read one current reservation by identity. */
  reservation(reservationId: string): InventoryReservation | undefined {
    return inventorySparseRecordValue(this.world.reservations.reservations, reservationId);
  }

  /** Read one current physical count by identity. */
  count(countId: string): InventoryCount | undefined {
    return inventorySparseRecordValue(this.world.counts.counts, countId);
  }

  /** Check current physical stock against claims at one lifecycle time. */
  reservationFeasibility(
    atEpochMs = this.defaultAtEpochMs
  ): InventoryReservationFeasibilityReport {
    return inspectInventoryReservationFeasibility({
      catalog: this.catalog,
      projection: this.world.projection,
      book: this.world.reservations,
      atEpochMs,
    });
  }
}

/** Read one selector through the adapter-native direct-position query surface. */
async function findInventoryPositionsFromSegment(
  segment: InventorySegmentedPositionReader,
  selector: InventoryStockSelector
): Promise<ReturnType<typeof findInventoryPositions> | undefined> {
  return await segment.queryPositions(selector);
}

/** One placement-index result bounded by the same adapter publication revision. */
interface InventorySegmentedPlacementSnapshotRead<Result> {
  /** True when the complete read observed one stable latest segment revision. */
  readonly coherent: boolean;
  /** Resolved read value; undefined may itself be a valid unplaced parent. */
  readonly value?: Result;
}

/** One coherent current placement read, retried when async adapter publication interleaves. */
async function readInventorySegmentedPlacementSnapshot<Result>(
  storage: InventorySegmentedPlacementStorageCapability,
  read: (
    segment: InventorySegmentedPlacementReader
  ) => Result | Promise<Result>
): Promise<InventorySegmentedPlacementSnapshotRead<Result>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const segment = await storage.readPlacementSegment();
    const before = await segment.revision();
    const value = await read(segment);
    const after = await segment.revision();
    // Canonical publication can replace the entire reference segment. Recheck the
    // adapter's current generation, not only a now-detached reader object.
    const latest = await storage.readPlacementSegment();
    const latestRevision = await latest.revision();
    if (before === after && after === latestRevision) {
      return { coherent: true, value };
    }
  }
  return { coherent: false };
}

/** Private implementation of current/history reads. */
class InventoryOnceReadImplementation implements InventoryOnceReadApi {
  /** Owning façade. */
  private readonly owner: InventoryOnce;

  /** Bind reads to one façade. */
  constructor(owner: InventoryOnce) {
    this.owner = owner;
  }

  /** Freeze one coherent public read surface from exactly one published world. */
  async snapshot(): Promise<InventoryOnceReadSnapshotApi> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(internals.catalog, world.catalog);
    return new InventoryOnceReadSnapshotImplementation(
      world,
      inventoryCatalogForPublishedWorld(world, internals.catalog),
      internals.clock.nowEpochMs()
    );
  }

  /** Read the latest fully published world revision. */
  async world(): Promise<InventoryWorldState> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await internals.storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(internals.catalog, world.catalog);
    return world;
  }

  /** Read current positions matching one broad selector. */
  async positions(
    selector: InventoryStockSelector
  ): Promise<ReturnType<typeof findInventoryPositions>> {
    const internals = requireInventoryOnceInternals(this.owner);
    if (inventoryStorageSupportsSegmentedPositions(internals.storage)) {
      const segmented = await readInventorySegmentedPositionSnapshot(
        internals.storage,
        /** Resolve every index read against one stable segmented revision. */
        (segment) => findInventoryPositionsFromSegment(segment, selector)
      );
      if (segmented.coherent && segmented.value !== undefined) {
        return segmented.value;
      }
    }
    const world = await this.world();
    return findInventoryPositions(world.projection, selector);
  }

  /** Read current detached/missing lifecycles from one published world. */
  async whereabouts(
    input: InventoryOnceWhereaboutsQuery = {}
  ): Promise<readonly InventoryWhereaboutsLifecycle[]> {
    return findCurrentInventoryWhereaboutsLifecycles(
      (await this.world()).projection,
      input
    );
  }

  /** Read current and resolved whereabouts history from one published world. */
  async whereaboutsHistory(
    input: InventoryWhereaboutsHistoryQuery = {}
  ): Promise<readonly InventoryWhereaboutsLifecycle[]> {
    return findInventoryWhereaboutsHistory((await this.world()).projection, input);
  }

  /** Query retained history through an optional adapter-native index or canonical fallback. */
  async events(input: InventoryEventQuery = {}): Promise<InventoryEventPage> {
    const internals = requireInventoryOnceInternals(this.owner);
    if (inventoryStorageSupportsEventQuery(internals.storage)) {
      return internals.storage.queryInventoryEvents(input);
    }
    return queryInventoryProjectionEvents((await this.world()).projection, input);
  }

  /** Read one revision-safe physical summary without leaking projection mechanics to callers. */
  async summary(
    selector: InventoryStockSelector
  ): Promise<InventoryStockSummary> {
    const internals = requireInventoryOnceInternals(this.owner);
    const storage = internals.storage;
    if (inventoryStorageSupportsSegmentedStockPlanning(storage)) {
      const normalized = normalizeInventoryStockSelector(selector);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const head = await storage.readSegmentedStockHead();
        const positions = await (await storage.readPositionSegment()).queryPositions(normalized);
        if (positions === undefined) break;
        if ((await storage.readSegmentedStockHead()).worldRevision !== head.worldRevision) continue;
        assertInventoryCatalogRetainsSnapshot(internals.catalog, head.catalog);
        const catalog = head.worldRevision === 0 ? internals.catalog : inventoryCatalogFromSnapshot(head.catalog);
        return summarizeInventoryStockPositions({ catalog, selector: normalized, positions });
      }
    }
    const world = await this.world();
    return summarizeInventoryStock({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      projection: world.projection,
      selector,
    });
  }

  /** Read truthful availability without collapsing broad claims into one misleading scalar. */
  async availability(
    selector: InventoryStockSelector,
    atEpochMs?: number
  ): Promise<InventoryAvailabilitySummary> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await this.world();
    return summarizeInventoryAvailability({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      projection: world.projection,
      reservations: world.reservations,
      selector,
      atEpochMs: atEpochMs ?? internals.clock.nowEpochMs(),
    });
  }

  /** Preview native FIFO/FEFO lines against the current fully published world. */
  async planAllocation(
    input: InventoryOncePlanAllocationInput
  ): Promise<InventoryPolicyAllocationPlan> {
    const internals = requireInventoryOnceInternals(this.owner);
    const storage = internals.storage;
    const { selector, itemRevisionId, ...request } = snapshotInventoryAllocationRequest(input);
    const requestedAt = input.atEpochMs;
    const requestedReservationAt = input.reservationAtEpochMs;
    if (inventoryStorageSupportsSegmentedStockPlanning(storage)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const head = await storage.readSegmentedStockHead();
        // Default time must include claims already visible in this revision.
        const atEpochMs = requestedAt ?? internals.clock.nowEpochMs();
        const reservationAtEpochMs = requestedReservationAt ?? atEpochMs;
        const catalog = head.worldRevision === 0
          ? internals.catalog
          : inventoryCatalogFromSnapshot(head.catalog);
        assertInventoryCatalogRetainsSnapshot(internals.catalog, head.catalog);
        const selection = resolveAllocationItemAndSelector(
          catalog, selector, request.amount, itemRevisionId
        );
        const source = segmentedPolicyStockSource(storage, reservationAtEpochMs);
        const pool = await source.pool(selection);
        if ((await storage.readSegmentedStockHead()).worldRevision !== head.worldRevision) continue;
        return planInventoryAllocationInPool({ ...request, catalog, selection, pool, atEpochMs, reservationAtEpochMs });
      }
      throw new Error("Inventory allocation could not read a current stock revision.");
    }
    const world = await this.world();
    return planInventoryAllocation({
      ...request,
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      world,
      selector,
      atEpochMs: requestedAt ?? internals.clock.nowEpochMs(),
      ...(requestedReservationAt === undefined
        ? {}
        : { reservationAtEpochMs: requestedReservationAt }),
      ...(itemRevisionId === undefined
        ? {}
        : { itemRevisionId }),
    });
  }

  /** List exact retained package revisions for one item/revision. */
  async packagingRevisions(
    input: Omit<ListInventoryPackagingRevisionsInput, "catalog">
  ): Promise<ReturnType<typeof listInventoryPackagingRevisions>> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await this.world();
    return listInventoryPackagingRevisions({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      ...input,
    });
  }

  /** Read one current placement-node metadata master by exact identity. */
  async placementNode(
    nodeId: string
  ): Promise<InventoryProjectedPlacementNodeDefinition | undefined> {
    inventoryPlacementNodeIdentity(nodeId);
    return inventorySparseRecordValue(
      (await this.world()).projection.placementNodes,
      nodeId
    );
  }

  /** List current placement-node metadata masters in deterministic identity order. */
  async placementNodes(): Promise<
    readonly InventoryProjectedPlacementNodeDefinition[]
  > {
    const world = await this.world();
    const result = Object.values(world.projection.placementNodes);
    result.sort(compareProjectedPlacementNodeDefinition);
    return result;
  }

  /** Read one node's current direct parent. */
  async placementParent(nodeId: string): Promise<string | undefined> {
    inventoryPlacementNodeIdentity(nodeId);
    const internals = requireInventoryOnceInternals(this.owner);
    if (inventoryStorageSupportsSegmentedPlacement(internals.storage)) {
      const result = await readInventorySegmentedPlacementSnapshot(
        internals.storage,
        /** Read one current direct parent under the segment revision fence. */
        (segment) => segment.parentNodeId(nodeId)
      );
      if (result.coherent) return result.value;
    }
    return inventoryPlacementParentNodeId(
      (await this.world()).projection.placement,
      nodeId
    );
  }

  /** Read one node's current direct children in stable identity order. */
  async placementChildren(nodeId: string): Promise<readonly string[]> {
    inventoryPlacementNodeIdentity(nodeId);
    const internals = requireInventoryOnceInternals(this.owner);
    if (inventoryStorageSupportsSegmentedPlacement(internals.storage)) {
      const result = await readInventorySegmentedPlacementSnapshot(
        internals.storage,
        /** Read every current direct child under the segment revision fence. */
        (segment) => segment.childNodeIds(nodeId)
      );
      if (result.coherent) {
        if (result.value === undefined) {
          throw new Error("Segmented placement children reader returned no result.");
        }
        return result.value;
      }
    }
    const world = await this.world();
    return (
      inventorySparseRecordValue(
        world.projection.placement.childNodeIdsByParentNodeId,
        nodeId
      ) ?? []
    );
  }

  /** Read one node followed by every current direct ancestor. */
  async placementAncestry(nodeId: string): Promise<readonly string[]> {
    inventoryPlacementNodeIdentity(nodeId);
    const internals = requireInventoryOnceInternals(this.owner);
    if (inventoryStorageSupportsSegmentedPlacement(internals.storage)) {
      const result = await readInventorySegmentedPlacementSnapshot(
        internals.storage,
        /** Read this node and its current ancestry under one segment revision. */
        (segment) => segment.ancestry(nodeId)
      );
      if (result.coherent) {
        if (result.value === undefined) {
          throw new Error("Segmented placement ancestry reader returned no result.");
        }
        return result.value;
      }
    }
    return inventoryPlacementAncestry(
      (await this.world()).projection.placement,
      nodeId
    );
  }

  /** Read one current item-scoped lot/batch master by exact identity. */
  async lot(
    itemId: string,
    lotId: string
  ): Promise<InventoryProjectedLotDefinition | undefined> {
    const world = await this.world();
    return world.projection.lots[inventoryLotIdentity(itemId, lotId)];
  }

  /** List current lot/batch masters in deterministic item/lot order. */
  async lots(
    itemId?: string
  ): Promise<readonly InventoryProjectedLotDefinition[]> {
    return inventoryProjectedLots((await this.world()).projection, itemId);
  }

  /** Read one committed event by identity. */
  async event(eventId: string): Promise<InventoryCommittedEvent | undefined> {
    const world = await this.world();
    return inventorySparseRecordValue(world.projection.events, eventId);
  }

  /** Read one current reservation by identity. */
  async reservation(
    reservationId: string
  ): Promise<InventoryReservation | undefined> {
    const world = await this.world();
    return inventorySparseRecordValue(world.reservations.reservations, reservationId);
  }

  /** Read one current physical count by identity. */
  async count(countId: string): Promise<InventoryCount | undefined> {
    const world = await this.world();
    return inventorySparseRecordValue(world.counts.counts, countId);
  }
  /** Check current physical stock against claims active now or at one supplied lifecycle time. */
  async reservationFeasibility(
    atEpochMs?: number
  ): Promise<InventoryReservationFeasibilityReport> {
    const internals = requireInventoryOnceInternals(this.owner);
    const world = await this.world();
    return inspectInventoryReservationFeasibility({
      catalog: inventoryCatalogForPublishedWorld(world, internals.catalog),
      projection: world.projection,
      book: world.reservations,
      atEpochMs: atEpochMs ?? internals.clock.nowEpochMs(),
    });
  }
}

/** Use configured definitions only for a brand-new world; later reads obey durable publication truth. */
function inventoryCatalogForPublishedWorld(
  world: InventoryWorldState,
  configuredCatalog: InventoryCatalog
): InventoryCatalog {
  return world.revision === 0
    ? configuredCatalog
    : inventoryCatalogFromSnapshot(world.catalog);
}

/** Sort frozen composition revisions by immutable revision identity. */
function compareInventoryCompositionRevision(
  left: InventoryCompositionDefinitionRevision,
  right: InventoryCompositionDefinitionRevision
): number {
  return compareInventoryIdentityText(left.revisionId, right.revisionId);
}

/** Sort current placement-node masters by exact node identity. */
function compareProjectedPlacementNodeDefinition(
  left: InventoryProjectedPlacementNodeDefinition,
  right: InventoryProjectedPlacementNodeDefinition
): number {
  return compareInventoryIdentityText(
    left.definition.nodeId,
    right.definition.nodeId
  );
}

/** Read item-filtered lot masters from the rebuildable index and fail closed on index drift. */
function inventoryProjectedLots(
  projection: InventoryProjectionState,
  itemId?: string
): readonly InventoryProjectedLotDefinition[] {
  const identities =
    itemId === undefined
      ? Object.keys(projection.lots)
      : inventorySparseRecordValue(projection.lotIdentitiesByItemId, itemId) ?? [];
  const result: InventoryProjectedLotDefinition[] = [];
  for (const identity of identities) {
    const projected = projection.lots[identity];
    if (projected === undefined) {
      throw new Error(
        `Inventory lot index references missing lot '${identity}'.`
      );
    }
    if (itemId !== undefined && projected.definition.itemId !== itemId) {
      throw new Error(
        `Inventory lot index '${itemId}' contains foreign lot '${identity}'.`
      );
    }
    result.push(projected);
  }
  result.sort(compareProjectedLotDefinition);
  return result;
}

/** Sort current lot masters by collision-free item-scoped identity. */
function compareProjectedLotDefinition(
  left: InventoryProjectedLotDefinition,
  right: InventoryProjectedLotDefinition
): number {
  return compareInventoryIdentityText(inventoryLotIdentity(
    left.definition.itemId,
    left.definition.lotId
  ), inventoryLotIdentity(right.definition.itemId, right.definition.lotId));
}

/** Reject future lifecycle facts because current claim authority is frozen at durable record time. */
function assertInventoryLifecycleTimeWasRecorded(
  occurredAtEpochMs: number,
  recordedAtEpochMs: number,
  label: string
): void {
  if (occurredAtEpochMs > recordedAtEpochMs) {
    throw new Error(`${label} cannot occur after its durable record time.`);
  }
}

/** Decode an exact instant retained in policy allocation metadata. */
function requirePolicyBatchEpochMilliseconds(value: InventoryMetadataValue | undefined, label: string): number {
  const epochMs = requirePolicyBatchMetadataNumber(value, label);
  assertInventoryEpochMilliseconds(epochMs, label);
  return epochMs;
}
