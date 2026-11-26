import { InventoryStockClaimIndex } from "./stock-claim-index.js";
import { inventoryReportedTransferReplayMetadataKey } from "./reported-transfer-replay.js";
import { inventoryStockPoolRowReader, type InventoryScopedStockPool, type InventoryScopedStockPosition } from "./stock-scope.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  assertInventoryEpochMilliseconds,
  commitInventoryEvent,
  defineInventoryEvent,
  InventoryEventKind,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
} from "./events.js";
import {
  assertInventoryCatalogRetainsSnapshot,
  inventoryCatalogFromSnapshot,
  inventoryCatalogSnapshot,
  type InventoryCatalogSnapshot,
} from "./catalog.js";
import {
  applyInventoryCountBookDelta,
  applyInventoryReservationBookDelta,
  inventoryDurableMigrationPlanDigest,
  inventoryDurablePlanDigest,
  inventoryWorldContentRoots,
  type InventoryCountBookDelta,
  type InventoryReservationBookDelta,
  type InventoryWorldContentRoots,
} from "./integrity.js";
import {
  applyInventoryCommittedEvent,
  applyInventoryCommittedEvents,
  InventoryDeficitPolicy,
} from "./projection.js";
import { inventoryIntentFingerprint } from "./canonical.js";
import {
  inventoryMigrationSourceDispositionFingerprint,
  type InventoryMigrationSourceDisposition,
} from "./migration-evidence.js";
import { emptyInventoryWorldState, type InventoryWorldState } from "./world.js";
import {
  createInMemoryInventorySegmentedEventJournal,
  type InMemoryInventorySegmentedEventJournal,
  type InventorySegmentedEventResourceQuery,
  type InventorySegmentedResourceEventPage,
} from "./segmented-journal.js";
import {
  createInMemoryInventorySegmentedPositionStore,
  type CommitInventorySegmentedStockEventInput,
  type CommitInventorySegmentedStockEventResult,
  type InMemoryInventorySegmentedPositionStore,
  type InventorySegmentedPositionStorageCapability,
  type InventorySegmentedStockEventCommitCapability,
  type InventorySegmentedResult,
} from "./segmented-state.js";
import {
  createInMemoryInventorySegmentedPlacementStore,
  type InMemoryInventorySegmentedPlacementStore,
  type InventorySegmentedPlacementReader,
  type InventorySegmentedPlacementResult,
} from "./segmented-placement.js";
import { inventoryPlacementDestinationWithinSource } from "./segmented-placement-admission.js";
import { createInventoryPlacementEvent, type InventoryCommandHeader } from "./commands.js";
import { inventorySerialIdentity, inventoryStockPositionIdentity, type InventoryStockPosition } from "./model.js";
import type { InventoryPlacementChange } from "./placement.js";
import type { InventoryStockSelector } from "./selectors.js";
import { InventoryCountStatus } from "./counts.js";
import type { InventoryEventPage, InventoryEventQuery } from "./event-query.js";
import {
  cloneInventorySparseRecord,
  inventoryObjectIsKnownDeeplyImmutable,
  inventorySparseRecordValue,
  markInventoryObjectDeeplyImmutable,
} from "./sparse-record.js";

/** Synchronous reference-adapter read capability with no segment mutation methods. */
type InMemoryInventoryPublishedPositionReader = Pick<
  InMemoryInventorySegmentedPositionStore,
  | "revision"
  | "contentRoot"
  | "position"
  | "positivePositionBySerial"
  | "positionsByItem"
  | "positionsByItemRevision"
  | "positionsByPlacement"
  | "queryPositions"
  | "materialize"
>;

/** Clone one published world while restoring own-only semantics for application-id dictionaries. */
function cloneInventoryPublishedWorld(world: InventoryWorldState): InventoryWorldState {
  const cloned = structuredClone(world);
  const result: InventoryWorldState = {
    ...cloned,
    catalog: {
      ...cloned.catalog,
      activeItemRevisionIds: cloneInventorySparseRecord(cloned.catalog.activeItemRevisionIds),
      activeCompositionRevisionIds: cloneInventorySparseRecord(cloned.catalog.activeCompositionRevisionIds),
      activeTransformationRevisionIds: cloneInventorySparseRecord(cloned.catalog.activeTransformationRevisionIds),
      activeCollectionRevisionIds: cloneInventorySparseRecord(cloned.catalog.activeCollectionRevisionIds),
      activeFungibilityRevisionIds: cloneInventorySparseRecord(cloned.catalog.activeFungibilityRevisionIds),
    },
    projection: {
      ...cloned.projection,
      positionIdsByItemId: cloneInventorySparseRecord(cloned.projection.positionIdsByItemId),
      positionIdsByItemRevisionId: cloneInventorySparseRecord(cloned.projection.positionIdsByItemRevisionId),
      positionIdsByPlacementNodeId: cloneInventorySparseRecord(
        cloned.projection.positionIdsByPlacementNodeId
      ),
      positionIdsByWhereaboutsId: cloneInventorySparseRecord(cloned.projection.positionIdsByWhereaboutsId),
      placementNodes: cloneInventorySparseRecord(cloned.projection.placementNodes),
      placementNodeRootEventIdByNodeId: cloneInventorySparseRecord(
        cloned.projection.placementNodeRootEventIdByNodeId
      ),
      placement: {
        ...cloned.projection.placement,
        relationByNodeId: cloneInventorySparseRecord(
          cloned.projection.placement.relationByNodeId
        ),
        childNodeIdsByParentNodeId: cloneInventorySparseRecord(
          cloned.projection.placement.childNodeIdsByParentNodeId
        ),
      },
      lotIdentitiesByItemId: cloneInventorySparseRecord(cloned.projection.lotIdentitiesByItemId),
      placementNodeIdByEmbodiedSerialIdentity: cloneInventorySparseRecord(
        cloned.projection.placementNodeIdByEmbodiedSerialIdentity
      ),
      transfers: cloneInventorySparseRecord(cloned.projection.transfers),
      events: cloneInventorySparseRecord(cloned.projection.events),
      eventSequencesByWhereaboutsId: cloneInventorySparseRecord(
        cloned.projection.eventSequencesByWhereaboutsId
      ),
      eventIdByOperationId: cloneInventorySparseRecord(cloned.projection.eventIdByOperationId),
      correctionEventIdByCorrectedEventId: cloneInventorySparseRecord(
        cloned.projection.correctionEventIdByCorrectedEventId
      ),
    },
    reservations: {
      reservations: cloneInventorySparseRecord(cloned.reservations.reservations),
      operations: cloneInventorySparseRecord(cloned.reservations.operations),
    },
    counts: {
      counts: cloneInventorySparseRecord(cloned.counts.counts),
      operations: cloneInventorySparseRecord(cloned.counts.operations),
    },
  };
  return result;
}

/** Deep-freeze one published world while skipping already-frozen shared subgraphs. */
function freezeInventoryPublishedWorld(
  world: InventoryWorldState
): InventoryWorldState {
  /** Pending newly-created objects whose children and own properties still need freezing. */
  const pending: object[] = [world];
  /** Shared/cyclic object identities are visited once during this publication. */
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    if (inventoryObjectIsKnownDeeplyImmutable(current)) continue;
    for (const value of Object.values(current)) {
      if (value !== null && typeof value === "object") pending.push(value);
    }
    if (!Object.isFrozen(current)) Object.freeze(current);
    markInventoryObjectDeeplyImmutable(current);
  }
  return world;
}

/** Async execution context used only to reject same-adapter mutation re-entry from failpoints. */
const inventoryStorageFailpointExecution = new AsyncLocalStorage<object>();

/** Storage guarantee advertised by one durable adapter. */
export enum InventoryStorageGuarantee {
  /** Adapter commits the complete world plan in one real storage transaction. */
  Atomic = "atomic",
  /** Adapter may write pieces separately but hides them until operation completion. */
  OptimisticRepairable = "optimistic-repairable",
}

/** Durable lifecycle of one frozen inventory operation plan. */
export enum InventoryDurableOperationState {
  /** Complete next-world plan is frozen and may be partially persisted. */
  Applying = "applying",
  /** Every required piece is published as one logical world revision. */
  Completed = "completed",
  /** Explicitly abandoned before publication; no staged value became visible. */
  Aborted = "aborted",
}

/** Physical persistence boundaries available to deterministic failpoint tests. */
export enum InventoryStorageWriteStage {
  /** Freeze the complete next-world plan under one operation identity. */
  Begin = "begin",
  /** Persist the immutable committed event when the plan has one. */
  Event = "event",
  /** Persist the event-derived current projection. */
  Projection = "projection",
  /** Persist reservation lifecycle updates. */
  Reservations = "reservations",
  /** Persist physical-count lifecycle updates. */
  Counts = "counts",
  /** Persist the replay receipt. */
  Receipt = "receipt",
  /** Publish every staged value together. */
  Complete = "complete",
  /** Atomically claim abort so a concurrent world-publication CAS cannot also win. */
  ClaimAbort = "claim-abort",
  /** Persist terminal abort evidence after the abort claim owns the operation. */
  Abort = "abort",
  /** Publish the already-staged compact plan as the next visible world head. */
  PublishWorld = "publish-world",
  /** Remove the applying plan after its world head is already visible. */
  CompactOperation = "compact-operation",
  /** Freeze one migration manifest and its exact target base. */
  MigrationBegin = "migration-begin",
  /** Persist the frozen migration batch as staged but still invisible. */
  MigrationWorld = "migration-world",
  /** Publish the whole staged migration batch and mark its manifest terminal. */
  MigrationComplete = "migration-complete",
  /** Publish the staged migration world before compacting its applying manifest. */
  MigrationPublishWorld = "migration-publish-world",
  /** Remove the migration plan after its world is already visible. */
  MigrationCompactManifest = "migration-compact-manifest",
  /** Atomically claim migration abort so its publication CAS cannot also win. */
  MigrationClaimAbort = "migration-claim-abort",
  /** Persist terminal migration-abort evidence after the abort claim wins. */
  MigrationAbort = "migration-abort",
}

/** Whether a failpoint fires immediately before or after one physical write. */
export type InventoryStorageWriteTiming = "before" | "after";

/** Context passed to one optional storage failpoint. */
export interface InventoryStorageFailpointContext {
  /** Physical boundary being entered/exited. */
  readonly stage: InventoryStorageWriteStage;
  /** Before or after the adapter mutation. */
  readonly timing: InventoryStorageWriteTiming;
  /** Stable inventory operation identity. */
  readonly operationId: string;
}

/** Optional callback used only by tests/adapters to inject deterministic failures; it must not invoke storage mutations. */
export type InventoryStorageFailpoint = (
  context: InventoryStorageFailpointContext
) => void | Promise<void>;

/** Small immutable replay result returned by every completed operation. */
export interface InventoryOperationReceipt {
  /** Stable operation/idempotency identity. */
  readonly operationId: string;
  /** Durable record time frozen with the operation plan. */
  readonly recordedAtEpochMs: number;
  /** Published world revision after completion. */
  readonly worldRevision: number;
  /** Committed event identity when this operation wrote stock/traceability truth. */
  readonly eventId?: string;
  /** Reservation identity changed by this operation when applicable. */
  readonly reservationId?: string;
  /** Count identity changed by this operation when applicable. */
  readonly countId?: string;
}

/** Compact semantically validated next-world manifest frozen before any component write. */
export interface InventoryDurableOperationPlan {
  /** Versioned compact plan shape adapters must reject when unsupported. */
  readonly format: "inventoryonce-compact-plan-v1";
  /** Exact content root of the published base world. */
  readonly baseWorldRoot: string;
  /** Complete durable catalogue definitions needed to interpret the next world after restart. */
  readonly catalog: InventoryCatalogSnapshot;
  /** Exact catalogue content root repeated for cheap adapter checks. */
  readonly catalogRoot: string;
  /** Deficit rule needed to replay the event during planner-free repair. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Immutable committed event when this operation changes stock/traceability truth. */
  readonly event?: InventoryCommittedEvent;
  /** One validated append-only reservation lifecycle delta when claims change. */
  readonly reservationDelta?: InventoryReservationBookDelta;
  /** One validated append-only count lifecycle delta when count work changes. */
  readonly countDelta?: InventoryCountBookDelta;
  /** Frozen final receipt; adapter publishes it only with completion. */
  readonly receipt: InventoryOperationReceipt;
  /** Exact component roots expected after applying this compact plan. */
  readonly nextRoots: InventoryWorldContentRoots;
  /** Exact digest covering the base, catalogue, deltas, receipt, and next roots. */
  readonly planDigest: string;
}

/** Durable operation row visible to generic repair code. */
export interface InventoryDurableOperation {
  /** Stable operation/idempotency identity. */
  readonly operationId: string;
  /** Frozen command-intent fingerprint. */
  readonly intentFingerprint: string;
  /** Published world revision this plan was calculated from. */
  readonly baseRevision: number;
  /** Durable record time frozen before event commit. */
  readonly recordedAtEpochMs: number;
  /** Current durable lifecycle. */
  readonly state: InventoryDurableOperationState;
  /** Complete next-world plan retained only while Applying so repair needs no caller code. */
  readonly plan?: InventoryDurableOperationPlan;
  /** Small frozen receipt retained after completed-plan compaction for exact replay. */
  readonly receipt: InventoryOperationReceipt;
  /** One committed event retained for command replay; absent for eventless operations. */
  readonly event?: InventoryCommittedEvent;
  /** Whether the optional event row has been physically staged. */
  readonly eventWritten: boolean;
  /** Whether the next projection has been physically staged. */
  readonly projectionWritten: boolean;
  /** Whether the next reservation book has been physically staged. */
  readonly reservationsWritten: boolean;
  /** Whether the next count book has been physically staged. */
  readonly countsWritten: boolean;
  /** Whether the replay receipt has been physically staged. */
  readonly receiptWritten: boolean;
  /** Whether the next world is visible even if applying-plan compaction still needs repair. */
  readonly worldPublished: boolean;
}

/** Inputs for atomically freezing one complete operation plan. */
export interface BeginInventoryDurableOperationInput {
  /** Stable operation/idempotency identity. */
  readonly operationId: string;
  /** Frozen command-intent fingerprint. */
  readonly intentFingerprint: string;
  /** Published world revision used to calculate the plan. */
  readonly baseRevision: number;
  /** Durable record time used by the committed event/receipt. */
  readonly recordedAtEpochMs: number;
  /** Complete semantically validated next-world plan. */
  readonly plan: InventoryDurableOperationPlan;
}

/** Atomic result of freezing a new plan or finding the existing exact operation. */
export interface BeginInventoryDurableOperationResult {
  /** Durable operation row created or found under this identity. */
  readonly operation: InventoryDurableOperation;
  /** True only for the caller whose begin created the operation row. */
  readonly created: boolean;
}

/** Durable lifecycle of one whole migration plan manifest. */
export enum InventoryMigrationManifestState {
  /** Exact batch plan is frozen and still needs staging/publication. */
  Applying = "applying",
  /** The complete frozen batch became visible in one world revision. */
  Completed = "completed",
  /** The frozen batch was abandoned before any part became visible. */
  Aborted = "aborted",
}

/** Complete compact migration batch frozen before any migration write after begin. */
export interface InventoryDurableMigrationPlan {
  /** Versioned batch shape adapters must reject when unsupported. */
  readonly format: "inventoryonce-migration-plan-v1";
  /** Exact content root of the published target world used for validation. */
  readonly baseWorldRoot: string;
  /** Complete retained catalogue definitions needed for restart repair. */
  readonly catalog: InventoryCatalogSnapshot;
  /** Exact catalogue content root repeated for cheap adapter checks. */
  readonly catalogRoot: string;
  /** Explicit deficit rule used while replaying legacy physical truth. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** All committed migration events in final durable sequence order. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Non-physical legacy workflow rows frozen as do-not-replay evidence. */
  readonly sourceDispositions: readonly InventoryMigrationSourceDisposition[];
  /** Exact component roots expected after publishing the whole batch. */
  readonly nextRoots: InventoryWorldContentRoots;
  /** Digest covering the base, catalogue, events, policy, and next roots. */
  readonly durablePlanDigest: string;
}

/** Durable whole-plan identity and progress for one migration. */
export interface InventoryMigrationManifest {
  /** Stable migration identity supplied by the plugin declaration. */
  readonly migrationId: string;
  /** Fingerprint of the full normalized ordered migration plan. */
  readonly planDigest: string;
  /** Target world revision reviewed and fenced before the first migration event. */
  readonly baseRevision: number;
  /** Exact target world content root reviewed before the first migration event. */
  readonly baseWorldRoot: string;
  /** Exact ordered event operation identities in this batch. */
  readonly operationIds: readonly string[];
  /** Immutable source rows explicitly superseded by opening-snapshot truth. */
  readonly sourceDispositions: readonly InventoryMigrationSourceDisposition[];
  /** Full batch plan retained only while Applying so repair needs no plugin/planner. */
  readonly plan?: InventoryDurableMigrationPlan;
  /** Whether the full batch has been physically staged but remains invisible. */
  readonly worldWritten: boolean;
  /** Whether the batch world is visible even if manifest compaction still needs repair. */
  readonly worldPublished: boolean;
  /** Exact published target-world content root, present once `worldPublished` is true. */
  readonly targetWorldRoot?: string;
  /** Exact published target-world revision, present once `worldPublished` is true. */
  readonly targetWorldRevision?: number;
  /** Applying, completed, or explicitly aborted. */
  readonly state: InventoryMigrationManifestState;
}

/** Inputs for atomically freezing one whole migration plan identity. */
export interface BeginInventoryMigrationManifestInput {
  /** Stable migration identity. */
  readonly migrationId: string;
  /** Fingerprint of the full normalized plan. */
  readonly planDigest: string;
  /** Target world revision used by the reviewed dry-run. */
  readonly baseRevision: number;
  /** Exact target world root used by the reviewed dry-run. */
  readonly baseWorldRoot: string;
  /** Exact ordered event operation identities. */
  readonly operationIds: readonly string[];
  /** Exact source dispositions retained through terminal compaction. */
  readonly sourceDispositions: readonly InventoryMigrationSourceDisposition[];
  /** Complete validated next-world batch frozen for planner-free repair. */
  readonly plan: InventoryDurableMigrationPlan;
}

/** Atomic result of creating or exactly replaying one migration manifest. */
export interface BeginInventoryMigrationManifestResult {
  /** Durable manifest created or found. */
  readonly manifest: InventoryMigrationManifest;
  /** True only for the caller that froze this migration identity first. */
  readonly created: boolean;
}

/** Bounded query for generic repair workers. */
export interface ListApplyingInventoryOperationsInput {
  /** Maximum applying rows to return. */
  readonly limit: number;
}

/** Generic durable adapter contract; inventory semantics stay outside the adapter. */
export interface InventoryDurableStorage {
  /** Adapter's real transaction/publication guarantee. */
  readonly guarantee: InventoryStorageGuarantee;
  /** Read the latest fully published world; staged plans are invisible. */
  readWorld(): Promise<InventoryWorldState>;
  /** Read one durable operation row for replay/repair. */
  readOperation(
    operationId: string
  ): Promise<InventoryDurableOperation | undefined>;
  /** List applying plans so a generic worker can finish them. */
  listApplyingOperations(
    input: ListApplyingInventoryOperationsInput
  ): Promise<readonly InventoryDurableOperation[]>;
  /** List applying migration batches so a generic worker can finish them. */
  listApplyingMigrationManifests(
    input: ListApplyingInventoryOperationsInput
  ): Promise<readonly InventoryMigrationManifest[]>;
  /** Freeze one complete plan or return the existing exact replay row. */
  begin(
    input: BeginInventoryDurableOperationInput
  ): Promise<BeginInventoryDurableOperationResult>;
  /** Read one durable whole-migration manifest. */
  readMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest | undefined>;
  /** Freeze one whole migration plan or return its exact existing manifest. */
  beginMigrationManifest(
    input: BeginInventoryMigrationManifestInput
  ): Promise<BeginInventoryMigrationManifestResult>;
  /** Stage the complete frozen migration batch without changing the visible world. */
  writeMigrationWorld(migrationId: string): Promise<InventoryMigrationManifest>;
  /** Publish the staged batch as one visible world revision and mark it completed. */
  completeMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest>;
  /** Abort one unpublished migration batch without publishing staged values. */
  abortMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest>;
  /** Stage the plan's optional immutable event. */
  writeEvent(operationId: string): Promise<InventoryDurableOperation>;
  /** Stage the plan's complete next projection. */
  writeProjection(operationId: string): Promise<InventoryDurableOperation>;
  /** Stage the plan's complete next reservation book. */
  writeReservations(operationId: string): Promise<InventoryDurableOperation>;
  /** Stage the plan's complete next count book. */
  writeCounts(operationId: string): Promise<InventoryDurableOperation>;
  /** Stage the plan's final replay receipt. */
  writeReceipt(operationId: string): Promise<InventoryDurableOperation>;
  /** Publish every staged component together or return completed replay receipt. */
  complete(operationId: string): Promise<InventoryOperationReceipt>;
  /** Abort one applying plan without publishing staged values. */
  abort(operationId: string): Promise<InventoryDurableOperation>;
}

/** Thrown when a new plan was calculated from a stale published revision. */
export class InventoryWorldRevisionConflictError extends Error {
  /** Revision the caller planned against. */
  readonly expectedRevision: number;
  /** Revision currently published by storage. */
  readonly actualRevision: number;

  /** Build one retryable stale-plan error. */
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Inventory world changed from revision ${expectedRevision} to ${actualRevision} before operation begin.`
    );
    this.name = "InventoryWorldRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Thrown when another operation owns the one unpublished reference stream. */
export class InventoryApplyingOperationConflictError extends Error {
  /** Applying operation that must be repaired/completed first. */
  readonly applyingOperationId: string;

  /** Build one retryable pending-operation conflict. */
  constructor(applyingOperationId: string) {
    super(
      `Inventory operation '${applyingOperationId}' is still applying and must finish before another reference-world commit.`
    );
    this.name = "InventoryApplyingOperationConflictError";
    this.applyingOperationId = applyingOperationId;
  }
}

/** Private reference-adapter row with physically staged but unpublished values. */
interface StoredInventoryOperation {
  /** Public durable row fields. */
  readonly value: InventoryDurableOperation;
  /** Ephemeral already-validated next world reused only by this live reference adapter. */
  readonly validatedNextWorld?: InventoryWorldState;
}

/** Exact standalone topology command accepted by an optional native placement adapter. */
export interface CommitInventorySegmentedPlacementInput extends InventoryCommandHeader {
  /** Stable semantic intent fingerprint generated by the façade before current-world resolution. */
  readonly intentFingerprint: string;
  /** Exact catalogue snapshot used to validate the topology event. */
  readonly catalog: InventoryCatalogSnapshot;
  /** Wall-clock commit time selected by the façade clock. */
  readonly recordedAtEpochMs: number;
  /** Existing independent placement node moving between known direct parents. */
  readonly nodeId: string;
  /** New direct parent; omission unplaces this node. */
  readonly toParentNodeId?: string;
  /** Optional client optimistic expectation: null asserts the source is currently root. */
  readonly expectedParent?: string | null;
}

/** Adapter-native coherent placement reads and atomic standalone topology publication. */
export interface InventorySegmentedPlacementStorageCapability {
  /** Read one current indexed placement segment without materializing canonical stock. */
  readPlacementSegment(): InventorySegmentedPlacementResult<InventorySegmentedPlacementReader>;
  /** Publish one eligible standalone topology command or decline to the canonical coordinator. */
  commitSegmentedPlacementChange(
    input: CommitInventorySegmentedPlacementInput
  ): Promise<CommitInventorySegmentedStockEventResult | undefined>;
}

/** Discover the optional placement-store capability without changing the normal application API. */
export function inventoryStorageSupportsSegmentedPlacement(
  value: unknown
): value is InventorySegmentedPlacementStorageCapability {
  if (value === null || typeof value !== "object") return false;
  return (
    typeof Reflect.get(value, "readPlacementSegment") === "function" &&
    typeof Reflect.get(value, "commitSegmentedPlacementChange") === "function"
  );
}

/** Published stock-planning fence, shared with the native position and journal transaction. */
export interface InventorySegmentedStockHead {
  /** The same monotonic publication revision used by stock and claims. */
  readonly worldRevision: number;
  /** Last published journal sequence at this revision. */
  readonly recordSequence: number;
  /** Published retained catalogue, with an empty snapshot at genesis. */
  readonly catalog: InventoryCatalogSnapshot;
}

/** An indexed read of one exact revision's complete requested physical pools. */
export interface ReadInventorySegmentedStockPoolInput {
  /** Broadened selector covering every signed row in the requested pools. */
  readonly selector: InventoryStockSelector;
  /** Exact retained item revision addressed by the pool selector. */
  readonly itemRevisionId: string;
  /** Set for physical availability, which needs holds only on the returned positions. */
  readonly exactHoldsOnly?: boolean;
  /** Authority time at which claim evidence is resolved. */
  readonly reservationAtEpochMs: number;
}

/** Indexed facts needed to plan the existing direct-contents move. */
export interface InventorySegmentedDirectContents {
  /** Exact signed positions anchored immediately at the source. */
  readonly positions: readonly InventoryStockPosition[];
  /** Immediate source children and their live stock embodiments. */
  readonly children: readonly InventorySegmentedDirectChild[];
  /** Destination followed by its current ancestors. */
  readonly destinationAncestry: readonly string[];
}

/** Endpoints for reading the current facts of a direct-contents move. */
export interface ReadInventorySegmentedDirectContentsInput {
  /** Placement whose direct stock and child edges are moving. */
  readonly sourceNodeId: string;
  /** New placement whose current ancestry determines whether the move is legal. */
  readonly destinationNodeId: string;
}

/** One direct child and its exact positive serial, when stock embodies the node. */
export interface InventorySegmentedDirectChild {
  /** Child identity in the current forest. */
  readonly nodeId: string;
  /** Live exact position driving the child's parent edge, when embodied. */
  readonly embodiedPosition?: InventoryStockPosition;
}

/** Indexed stock planning reads behind the existing native stock publication fence. */
export interface InventorySegmentedStockPlanningCapability
  extends InventorySegmentedStockEventCommitCapability,
    InventorySegmentedPositionStorageCapability,
    Pick<InventorySegmentedPlacementStorageCapability, "readPlacementSegment"> {
  /** Read the latest published fence. Callers confirm it after multi-read planning. */
  readSegmentedStockHead(): InventorySegmentedResult<InventorySegmentedStockHead>;
  /**
   * Read signed rows matching the pool selector and their claim, ancestry, age and expiry evidence.
   * Include all exact holds on these rows and enough broad evidence to exclude one own claim.
   */
  readSegmentedStockPool(input: ReadInventorySegmentedStockPoolInput): InventorySegmentedResult<InventoryScopedStockPool>;
  /** Read exact source rows, direct children and destination ancestry under the same fence. */
  readSegmentedDirectContents(input: ReadInventorySegmentedDirectContentsInput): InventorySegmentedResult<InventorySegmentedDirectContents>;
}

/** Discover optional indexed planning on the existing durable storage adapter. */
export function inventoryStorageSupportsSegmentedStockPlanning(
  storage: InventoryDurableStorage
): storage is InventoryDurableStorage & InventorySegmentedStockPlanningCapability {
  return typeof Reflect.get(storage, "readSegmentedStockPool") === "function";
}

/** Optional adapter-native retained-event query acceleration. */
export interface InventoryEventQueryStorageCapability {
  /** Query one stable durable-order event page through adapter-native indexes. */
  queryInventoryEvents(input: InventoryEventQuery): Promise<InventoryEventPage>;
  /** Query internal resource-index rows for scoped historical replay. */
  queryInventoryEventsByResourceKeys(
    input: InventorySegmentedEventResourceQuery
  ): Promise<InventorySegmentedResourceEventPage>;
}

/** Detect optional indexed event-query support without changing the base adapter contract. */
export function inventoryStorageSupportsEventQuery(
  value: unknown
): value is InventoryEventQueryStorageCapability {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "queryInventoryEvents") === "function" &&
    typeof Reflect.get(value, "queryInventoryEventsByResourceKeys") ===
      "function"
  );
}

/** Inputs for the deterministic reference in-memory durable adapter. */
export interface InMemoryInventoryDurableStorageInput {
  /** Atomic or optimistic-repairable behavior advertised to tests/callers. */
  readonly guarantee?: InventoryStorageGuarantee;
  /** Optional initial fully published world. */
  readonly initialWorld?: InventoryWorldState;
  /** Optional before/after physical-write failure injector. */
  readonly failpoint?: InventoryStorageFailpoint;
}

/** Keep only read operations on a frozen view of the adapter-owned mutable placement forest. */
function inventoryReadonlyPlacementReader(
  segment: InventorySegmentedPlacementReader
): InventorySegmentedPlacementReader {
  return Object.freeze({
    /** Report this captured placement generation's optimistic revision. */
    revision: () => segment.revision(),
    /** Read its authenticated placement edge root. */
    contentRoot: () => segment.contentRoot(),
    /** Read one exact direct-parent edge. */
    parentNodeId: (nodeId: string) => segment.parentNodeId(nodeId),
    /** Read children without exposing the mutable inverse-parent index. */
    childNodeIds: (nodeId: string) => segment.childNodeIds(nodeId),
    /** Walk exact direct ancestors inside this segment generation. */
    ancestry: (nodeId: string) => segment.ancestry(nodeId),
    /** Walk one descendant subtree inside this segment generation. */
    subtreeNodeIds: (nodeId: string) => segment.subtreeNodeIds(nodeId),
    /** Materialize a defensive canonical topology snapshot only when requested. */
    materialize: () => segment.materialize(),
  });
}

/** Deterministic reference adapter proving staged values stay hidden until completion. */
export class InMemoryInventoryDurableStorage
  implements
    InventoryDurableStorage,
    InventorySegmentedPositionStorageCapability,
    InventorySegmentedStockPlanningCapability,
    InventoryEventQueryStorageCapability
{
  /** Advertised publication guarantee. */
  readonly guarantee: InventoryStorageGuarantee;
  /** Latest fully published world. */
  private world: InventoryWorldState;
  /** Indexed hot position segment mirroring the same published world revision. */
  private positionSegment: InMemoryInventorySegmentedPositionStore;
  /** Immutable read-only stock capability delegating to the current segment. */
  private readonly publishedPositionReader: InMemoryInventoryPublishedPositionReader;
  /** Indexed placement forest, independent of total stock-position count. */
  private placementSegment: InMemoryInventorySegmentedPlacementStore;
  /** Frozen read-only placement view captured from the current mutable segment. */
  private placementReader: InventorySegmentedPlacementReader;
  /** Append-only event authority independent of canonical flat projection materialization. */
  private eventJournal: InMemoryInventorySegmentedEventJournal;
  /** Catalogue first established by deferred segmented publication before canonical materialization. */
  private pendingSegmentedCatalog: InventoryCatalogSnapshot | undefined;
  /** Durable operation rows including unpublished staged values. */
  private readonly operations = new Map<string, StoredInventoryOperation>();
  /** Applying rows only, sharing the archived row objects for constant-time fence checks. */
  private readonly applyingOperations = new Map<string, StoredInventoryOperation>();
  /** Applying migration batches only; completed history is never scanned for a fence. */
  private readonly applyingMigrationManifests = new Map<
    string,
    InventoryMigrationManifest
  >();
  /** Durable whole-migration manifests kept separately from event operation rows. */
  private readonly migrationManifests = new Map<
    string,
    InventoryMigrationManifest
  >();
  /** Current exact claim postings and revision-local lifecycle lookup for policy reads. */
  private stockClaims: InventoryStockClaimIndex;
  /** Number of started or observed physical counts per item, independent of terminal history. */
  private openCountCountsByItemId = new Map<string, number>();
  /** Optional deterministic failure injector. */
  private readonly failpoint: InventoryStorageFailpoint | undefined;
  /** Serializes reference-adapter mutations so concurrent callers cannot overwrite stale state. */
  private storageMutationBarrier: Promise<void> = Promise.resolve();

  /** Create one isolated reference adapter. */
  constructor(input: InMemoryInventoryDurableStorageInput = {}) {
    this.guarantee =
      input.guarantee ?? InventoryStorageGuarantee.OptimisticRepairable;
    this.world = freezeInventoryPublishedWorld(
      cloneInventoryPublishedWorld(
        input.initialWorld ?? emptyInventoryWorldState()
      )
    );
    validatePublishedInventoryWorld(this.world);
    this.positionSegment = createInMemoryInventorySegmentedPositionStore({
      positions: Object.values(this.world.projection.positions),
      positiveLayerStarts: this.world.projection.positiveLayerStartedAtEpochMsByPositionId,
      revision: this.world.revision,
    });
    // Do not expose the writable store through the optional read capability.
    // Cache a frozen façade whose methods look up the CURRENT backing stock
    // segment even when canonical or migration publication replaces it.
    this.publishedPositionReader = Object.freeze({
      /** Read the current published segment revision. */
      revision: () => this.positionSegment.revision(),
      /** Read the authenticated root of current exact positions. */
      contentRoot: () => this.positionSegment.contentRoot(),
      /** Read one defensive copy by exact identity. */
      position: (positionId: string) =>
        this.positionSegment.position(positionId),
      /** Read one positive serialized row through the exact serial index. */
      positivePositionBySerial: (itemId: string, serialId: string) =>
        this.positionSegment.positivePositionBySerial(itemId, serialId),
      /** Read all current rows for one item identity. */
      positionsByItem: (itemId: string) =>
        this.positionSegment.positionsByItem(itemId),
      /** Read all current rows for one item revision. */
      positionsByItemRevision: (itemRevisionId: string) =>
        this.positionSegment.positionsByItemRevision(itemRevisionId),
      /** Read current direct-stock rows for one exact placement. */
      positionsByPlacement: (placementNodeId: string) =>
        this.positionSegment.positionsByPlacement(placementNodeId),
      /** Query one indexed direct-position selector. */
      queryPositions: (selector: InventoryStockSelector) =>
        this.positionSegment.queryPositions(selector, this.placementSegment),
      /** Explicitly clone the complete canonical position/index view. */
      materialize: () => this.positionSegment.materialize(),
    });
    this.placementSegment = createInMemoryInventorySegmentedPlacementStore({
      placement: this.world.projection.placement,
      revision: this.world.revision,
    });
    this.placementReader = inventoryReadonlyPlacementReader(this.placementSegment);
    this.eventJournal = createInMemoryInventorySegmentedEventJournal({
      events: Object.values(this.world.projection.events),
    });
    this.stockClaims = new InventoryStockClaimIndex(this.world.reservations);
    this.refreshOpenCountScopes(this.world);
    this.failpoint = input.failpoint;
  }

  /** Read the published indexed segment without exposing its mutable store. */
  readPositionSegment(): InMemoryInventoryPublishedPositionReader {
    return this.publishedPositionReader;
  }

  /** Read indexed direct-parent topology without exposing private mutable state. */
  readPlacementSegment(): InventorySegmentedPlacementReader {
    return this.placementReader;
  }

  /** Return the live published revision, journal sequence and retained catalogue without catch-up. */
  readSegmentedStockHead(): InventorySegmentedStockHead {
    return {
      worldRevision: this.positionSegment.revision(),
      recordSequence: this.eventJournal.lastRecordSequence(),
      catalog: this.pendingSegmentedCatalog ?? this.world.catalog,
    };
  }

  /** Gather only the rows and immediate edges participating in one composite move. */
  readSegmentedDirectContents({
    sourceNodeId,
    destinationNodeId,
  }: ReadInventorySegmentedDirectContentsInput): InventorySegmentedDirectContents {
    const children: InventorySegmentedDirectChild[] = [];
    for (const childId of this.placementSegment.childNodeIds(sourceNodeId)) {
      const projected = inventorySparseRecordValue(this.world.projection.placementNodes, childId);
      const embodiment = projected?.definition.embodiedBy;
      if (embodiment === undefined || projected?.retiredByEventId !== undefined) {
        children.push({ nodeId: childId });
      } else {
        const position = this.positionSegment.positivePositionBySerial(embodiment.itemId, embodiment.serialId);
        if (position === undefined) throw new Error(`Embodied placement node '${childId}' has no live serialized stock instance.`);
        children.push({ nodeId: childId, embodiedPosition: position });
      }
    }
    return {
      positions: this.positionSegment.positionsByPlacement(sourceNodeId),
      children,
      destinationAncestry: this.placementSegment.ancestry(destinationNodeId),
    };
  }

  /** Read only matching stock postings and their indexed claim and expiry evidence. */
  readSegmentedStockPool(input: ReadInventorySegmentedStockPoolInput): InventoryScopedStockPool {
    const positions = this.positionSegment.queryPositions(input.selector, this.placementSegment) ?? [];
    const rows: InventoryScopedStockPosition[] = [];
    // Metadata-only changes publish canonically, so these retained facts are already current.
    const readRow = inventoryStockPoolRowReader(
      this.world.projection,
      /** Capture the direct links at the same published fence as the rows. */
      (nodeId) => this.placementSegment.parentNodeId(nodeId),
    );
    for (const position of positions) {
      const layerStartedAtEpochMs = this.positionSegment.positiveLayerStart(inventoryStockPositionIdentity(position.key));
      rows.push(readRow(position, layerStartedAtEpochMs));
    }
    return {
      positions: rows,
      reservations: this.stockClaims.forPool({
        revisionId: input.itemRevisionId,
        positions,
        atEpochMs: input.reservationAtEpochMs,
        exactHoldsOnly: input.exactHoldsOnly ?? false,
      }),
    };
  }

  /** Atomically commit one simple non-embodied topology change or decline to the canonical coordinator. */
  async commitSegmentedPlacementChange(
    input: CommitInventorySegmentedPlacementInput
  ): Promise<CommitInventorySegmentedStockEventResult | undefined> {
    const run =
      /** Serialize one topology publication with stock, journal and canonical adapter mutations. */
      (): Promise<CommitInventorySegmentedStockEventResult | undefined> =>
        this.commitSegmentedPlacementChangeUnlocked(input);
    return this.runStorageMutationAtomically(run);
  }

  /** Atomically commit one eligible exact transfer without materializing the whole world. */
  async commitSegmentedStockEvent(
    input: CommitInventorySegmentedStockEventInput
  ): Promise<CommitInventorySegmentedStockEventResult | undefined> {
    const commitOperation =
      /** Serialize one atomic segmented stock-event commit behind the adapter mutation fence. */
      (): Promise<CommitInventorySegmentedStockEventResult | undefined> =>
        this.commitSegmentedStockEventUnlocked(input);
    return this.runStorageMutationAtomically(commitOperation);
  }

  /** Query retained event history without materializing deferred canonical position state. */
  async queryInventoryEvents(
    input: InventoryEventQuery
  ): Promise<InventoryEventPage> {
    return this.eventJournal.queryEvents(input);
  }

  /** Query exact internal resource rows without materializing canonical current state. */
  async queryInventoryEventsByResourceKeys(
    input: InventorySegmentedEventResourceQuery
  ): Promise<InventorySegmentedResourceEventPage> {
    return this.eventJournal.queryEventsByResourceKeys(input);
  }

  /** Read the latest deeply immutable published world, materializing deferred segmented commits on demand. */
  async readWorld(): Promise<InventoryWorldState> {
    this.materializePendingSegmentedEvents();
    return this.world;
  }

  /** Read one public operation row without exposing private staged snapshots. */
  async readOperation(
    operationId: string
  ): Promise<InventoryDurableOperation | undefined> {
    const stored = this.operations.get(operationId);
    if (stored?.value.event !== undefined) return structuredClone(stored.value);
    const event = this.eventJournal.eventByOperation(operationId);
    if (stored === undefined) return retainedInventoryReportedTransferOperation(event);
    return event === undefined
      ? structuredClone(stored.value)
      : structuredClone({ ...stored.value, event });
  }

  /** Read one whole-migration manifest without exposing the stored object alias. */
  async readMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest | undefined> {
    const manifest = this.migrationManifests.get(migrationId);
    return manifest === undefined ? undefined : structuredClone(manifest);
  }

  /** Atomically freeze one complete migration batch or reject changed intent/base. */
  async beginMigrationManifest(
    input: BeginInventoryMigrationManifestInput
  ): Promise<BeginInventoryMigrationManifestResult> {
    /** Run this migration begin only after every earlier begin attempt has left the critical section. */
    const beginOperation = (): Promise<BeginInventoryMigrationManifestResult> =>
      this.beginMigrationManifestUnlocked(input);
    return this.runStorageMutationAtomically(beginOperation);
  }

  /** Perform one migration begin while the reference adapter's begin lock is held. */
  private async beginMigrationManifestUnlocked(
    input: BeginInventoryMigrationManifestInput
  ): Promise<BeginInventoryMigrationManifestResult> {
    this.materializePendingSegmentedEvents();
    validateBeginInventoryMigrationManifest(input);
    await this.fire(
      InventoryStorageWriteStage.MigrationBegin,
      "before",
      input.migrationId
    );
    const existing = this.migrationManifests.get(input.migrationId);
    if (existing !== undefined) {
      assertSameInventoryMigrationManifest(existing, input);
      await this.fire(
        InventoryStorageWriteStage.MigrationBegin,
        "after",
        input.migrationId
      );
      return { manifest: structuredClone(existing), created: false };
    }
    for (const manifest of this.applyingMigrationManifests.values()) {
      if (manifest.state === InventoryMigrationManifestState.Applying) {
        throw new Error(
          `Inventory migration '${manifest.migrationId}' already fences this target.`
        );
      }
    }
    for (const stored of this.applyingOperations.values()) {
      if (stored.value.state === InventoryDurableOperationState.Applying) {
        throw new InventoryApplyingOperationConflictError(
          stored.value.operationId
        );
      }
    }
    const currentRoot = inventoryWorldContentRoots(this.world).world;
    if (
      input.baseRevision !== this.world.revision ||
      input.baseWorldRoot !== currentRoot
    ) {
      throw new InventoryWorldRevisionConflictError(
        input.baseRevision,
        this.world.revision
      );
    }
    validateInventoryDurableMigrationPlanAgainstBase(this.world, input.plan);
    const manifest: InventoryMigrationManifest = {
      migrationId: input.migrationId,
      planDigest: input.planDigest,
      baseRevision: input.baseRevision,
      baseWorldRoot: input.baseWorldRoot,
      operationIds: [...input.operationIds],
      sourceDispositions: structuredClone(input.sourceDispositions),
      plan: structuredClone(input.plan),
      worldWritten: false,
      worldPublished: false,
      state: InventoryMigrationManifestState.Applying,
    };
    this.storeMigrationManifest(input.migrationId, manifest);
    await this.fire(
      InventoryStorageWriteStage.MigrationBegin,
      "after",
      input.migrationId
    );
    return { manifest: structuredClone(manifest), created: true };
  }

  /** Stage one frozen migration batch while keeping the public world unchanged. */
  async writeMigrationWorld(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    /** Serialize migration staging so concurrent retries cannot lose progress. */
    const storageMutation = (): Promise<InventoryMigrationManifest> =>
      this.writeMigrationWorldUnlocked(migrationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeMigrationWorld` while the reference adapter mutation lock is held. */
  private async writeMigrationWorldUnlocked(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    const manifest = this.requireMigrationManifest(migrationId);
    if (manifest.state === InventoryMigrationManifestState.Completed)
      return structuredClone(manifest);
    if (manifest.state === InventoryMigrationManifestState.Aborted) {
      throw new Error("Aborted inventory migration cannot be staged.");
    }
    if (manifest.worldWritten) return structuredClone(manifest);
    if (manifest.plan === undefined) {
      throw new Error(
        "Applying inventory migration lost its complete repair plan."
      );
    }
    await this.fire(
      InventoryStorageWriteStage.MigrationWorld,
      "before",
      migrationId
    );
    const staged: InventoryMigrationManifest = {
      ...manifest,
      worldWritten: true,
    };
    this.storeMigrationManifest(migrationId, staged);
    await this.fire(
      InventoryStorageWriteStage.MigrationWorld,
      "after",
      migrationId
    );
    return structuredClone(staged);
  }

  /** Publish one staged migration batch, then compact its manifest as a repairable write. */
  async completeMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    /** Serialize migration publication/compaction under one adapter mutation. */
    const storageMutation = (): Promise<InventoryMigrationManifest> =>
      this.completeMigrationManifestUnlocked(migrationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `completeMigrationManifest` while the reference adapter mutation lock is held. */
  private async completeMigrationManifestUnlocked(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    const manifest = this.requireMigrationManifest(migrationId);
    if (manifest.state === InventoryMigrationManifestState.Completed) {
      assertPublishedInventoryMigrationTarget(manifest);
      return structuredClone(manifest);
    }
    if (manifest.state === InventoryMigrationManifestState.Aborted) {
      throw new Error("Aborted inventory migration cannot complete.");
    }
    if (!manifest.worldWritten || manifest.plan === undefined) {
      throw new Error(
        "Migration manifest cannot complete before its full batch is staged."
      );
    }
    await this.fire(
      InventoryStorageWriteStage.MigrationComplete,
      "before",
      migrationId
    );
    if (!manifest.worldPublished) {
      await this.fire(
        InventoryStorageWriteStage.MigrationPublishWorld,
        "before",
        migrationId
      );
      const nextWorld = validateInventoryDurableMigrationPlanAgainstBase(
        this.world,
        manifest.plan
      );
      const published: InventoryMigrationManifest = {
        ...manifest,
        worldPublished: true,
        targetWorldRoot: inventoryWorldContentRoots(nextWorld).world,
        targetWorldRevision: nextWorld.revision,
      };
      const publishedWorld = freezeInventoryPublishedWorld(nextWorld);
      this.world = publishedWorld;
      this.positionSegment = createInMemoryInventorySegmentedPositionStore({
        positions: Object.values(publishedWorld.projection.positions),
        positiveLayerStarts: publishedWorld.projection.positiveLayerStartedAtEpochMsByPositionId,
        revision: publishedWorld.revision,
      });
      this.eventJournal = createInMemoryInventorySegmentedEventJournal({
        events: Object.values(publishedWorld.projection.events),
      });
      this.placementSegment = createInMemoryInventorySegmentedPlacementStore({
        placement: publishedWorld.projection.placement,
        revision: publishedWorld.revision,
      });
      this.placementReader = inventoryReadonlyPlacementReader(this.placementSegment);
      this.stockClaims = new InventoryStockClaimIndex(publishedWorld.reservations);
      this.refreshOpenCountScopes(publishedWorld);
      this.storeMigrationManifest(migrationId, published);
      await this.fire(
        InventoryStorageWriteStage.MigrationPublishWorld,
        "after",
        migrationId
      );
    } else {
      const publishedWorldRoot = inventoryWorldContentRoots(this.world).world;
      if (
        publishedWorldRoot !== manifest.plan.nextRoots.world ||
        manifest.targetWorldRoot !== publishedWorldRoot ||
        manifest.targetWorldRevision !== this.world.revision
      ) {
        throw new Error(
          "Published migration world no longer matches its applying batch plan."
        );
      }
    }
    await this.fire(
      InventoryStorageWriteStage.MigrationCompactManifest,
      "before",
      migrationId
    );
    const latestManifest = this.requireMigrationManifest(migrationId);
    assertPublishedInventoryMigrationTarget(latestManifest);
    const { plan: completedPlan, ...manifestWithoutPlan } = latestManifest;
    if (completedPlan === undefined) {
      throw new Error(
        "Applying inventory migration lost its complete repair plan."
      );
    }
    const completed: InventoryMigrationManifest = {
      ...manifestWithoutPlan,
      state: InventoryMigrationManifestState.Completed,
    };
    this.storeMigrationManifest(migrationId, completed);
    await this.fire(
      InventoryStorageWriteStage.MigrationCompactManifest,
      "after",
      migrationId
    );
    await this.fire(
      InventoryStorageWriteStage.MigrationComplete,
      "after",
      migrationId
    );
    return structuredClone(completed);
  }

  /** Abort one unpublished migration batch and discard its full repair plan. */
  async abortMigrationManifest(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    /** Serialize migration abort against concurrent publish/repair. */
    const storageMutation = (): Promise<InventoryMigrationManifest> =>
      this.abortMigrationManifestUnlocked(migrationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `abortMigrationManifest` while the reference adapter mutation lock is held. */
  private async abortMigrationManifestUnlocked(
    migrationId: string
  ): Promise<InventoryMigrationManifest> {
    const manifest = this.requireMigrationManifest(migrationId);
    if (manifest.state === InventoryMigrationManifestState.Completed) {
      throw new Error("Completed inventory migration cannot be aborted.");
    }
    if (manifest.state === InventoryMigrationManifestState.Aborted)
      return structuredClone(manifest);
    if (manifest.worldPublished) {
      throw new Error(
        "Published inventory migration cannot be aborted; finish manifest compaction."
      );
    }
    const { plan: abortedPlan, ...manifestWithoutPlan } = manifest;
    if (abortedPlan === undefined) {
      throw new Error(
        "Applying inventory migration lost its complete repair plan."
      );
    }
    await this.fire(
      InventoryStorageWriteStage.MigrationClaimAbort,
      "before",
      migrationId
    );
    const aborted: InventoryMigrationManifest = {
      ...manifestWithoutPlan,
      state: InventoryMigrationManifestState.Aborted,
    };
    this.storeMigrationManifest(migrationId, aborted);
    await this.fire(
      InventoryStorageWriteStage.MigrationClaimAbort,
      "after",
      migrationId
    );
    await this.fire(
      InventoryStorageWriteStage.MigrationAbort,
      "before",
      migrationId
    );
    await this.fire(
      InventoryStorageWriteStage.MigrationAbort,
      "after",
      migrationId
    );
    return structuredClone(aborted);
  }

  /** List applying rows in stable operation-id order for a generic repair worker. */
  async listApplyingOperations({
    limit,
  }: ListApplyingInventoryOperationsInput): Promise<
    readonly InventoryDurableOperation[]
  > {
    assertPositiveSafeInteger(limit, "applying operation list limit");
    const rows: InventoryDurableOperation[] = [];
    for (const stored of this.applyingOperations.values()) {
      if (stored.value.state === InventoryDurableOperationState.Applying) {
        rows.push(structuredClone(stored.value));
      }
    }
    rows.sort(compareDurableOperationId);
    return rows.slice(0, limit);
  }

  /** List applying migration batches in stable migration-id order. */
  async listApplyingMigrationManifests({
    limit,
  }: ListApplyingInventoryOperationsInput): Promise<
    readonly InventoryMigrationManifest[]
  > {
    assertPositiveSafeInteger(limit, "applying migration list limit");
    const manifests: InventoryMigrationManifest[] = [];
    for (const manifest of this.applyingMigrationManifests.values()) {
      if (manifest.state === InventoryMigrationManifestState.Applying) {
        manifests.push(structuredClone(manifest));
      }
    }
    manifests.sort(compareMigrationManifestId);
    return manifests.slice(0, limit);
  }

  /** Freeze one compact next-world manifest before any component write. */
  async begin(
    input: BeginInventoryDurableOperationInput
  ): Promise<BeginInventoryDurableOperationResult> {
    /** Run this operation begin only after every earlier begin attempt has left the critical section. */
    const beginOperation = (): Promise<BeginInventoryDurableOperationResult> =>
      this.beginUnlocked(input);
    return this.runStorageMutationAtomically(beginOperation);
  }

  /** Perform one normal operation begin while the reference adapter's begin lock is held. */
  private async beginUnlocked(
    input: BeginInventoryDurableOperationInput
  ): Promise<BeginInventoryDurableOperationResult> {
    this.materializePendingSegmentedEvents();
    validateBeginInventoryOperation(input);
    await this.fire(
      InventoryStorageWriteStage.Begin,
      "before",
      input.operationId
    );
    const existing = this.operations.get(input.operationId);
    const existingOperation = existing?.value ??
      retainedInventoryReportedTransferOperation(this.eventJournal.eventByOperation(input.operationId));
    if (existingOperation !== undefined) {
      assertSameInventoryOperationIntent(
        existingOperation,
        input.intentFingerprint
      );
      await this.fire(
        InventoryStorageWriteStage.Begin,
        "after",
        input.operationId
      );
      return { operation: structuredClone(existingOperation), created: false };
    }
    for (const stored of this.applyingOperations.values()) {
      if (stored.value.state === InventoryDurableOperationState.Applying) {
        throw new InventoryApplyingOperationConflictError(
          stored.value.operationId
        );
      }
    }
    if (input.baseRevision !== this.world.revision) {
      throw new InventoryWorldRevisionConflictError(
        input.baseRevision,
        this.world.revision
      );
    }
    this.assertNoApplyingMigrationFence();
    const validatedNextWorld = freezeInventoryPublishedWorld(
      validateInventoryDurablePlanAgainstBase(this.world, input.plan)
    );
    const validatedRoots = inventoryWorldContentRoots(validatedNextWorld);
    if (!inventoryWorldContentRootsEqual(validatedRoots, input.plan.nextRoots)) {
      throw new Error(
        "Frozen validated inventory world roots changed during cache admission."
      );
    }
    const value: InventoryDurableOperation = {
      operationId: input.operationId,
      intentFingerprint: input.intentFingerprint,
      baseRevision: input.baseRevision,
      recordedAtEpochMs: input.recordedAtEpochMs,
      state: InventoryDurableOperationState.Applying,
      plan: structuredClone(input.plan),
      receipt: structuredClone(input.plan.receipt),
      ...(input.plan.event === undefined
        ? {}
        : { event: structuredClone(input.plan.event) }),
      eventWritten: input.plan.event === undefined,
      projectionWritten: input.plan.event === undefined,
      reservationsWritten: false,
      countsWritten: false,
      receiptWritten: false,
      worldPublished: false,
    };
    this.storeOperation(input.operationId, { value, validatedNextWorld });
    await this.fire(
      InventoryStorageWriteStage.Begin,
      "after",
      input.operationId
    );
    return { operation: structuredClone(value), created: true };
  }

  /** Stage the optional immutable event from the frozen plan exactly once. */
  async writeEvent(operationId: string): Promise<InventoryDurableOperation> {
    /** Serialize event-stage progress so flags cannot overwrite each other. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.writeEventUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeEvent` while the reference adapter mutation lock is held. */
  private async writeEventUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireWritableOperation(operationId);
    if (stored.value.eventWritten) return structuredClone(stored.value);
    const plan = requireApplyingInventoryOperationPlan(stored.value);
    if (plan.event === undefined) {
      throw new Error("Inventory operation plan has no event to write.");
    }
    await this.fire(InventoryStorageWriteStage.Event, "before", operationId);
    const value = { ...stored.value, eventWritten: true };
    this.storeOperation(operationId, { ...stored, value });
    await this.fire(InventoryStorageWriteStage.Event, "after", operationId);
    return structuredClone(value);
  }

  /** Stage the optional event-derived projection delta from the frozen plan. */
  async writeProjection(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    /** Serialize projection-stage progress so flags cannot overwrite each other. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.writeProjectionUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeProjection` while the reference adapter mutation lock is held. */
  private async writeProjectionUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireWritableOperation(operationId);
    if (stored.value.projectionWritten) return structuredClone(stored.value);
    const plan = requireApplyingInventoryOperationPlan(stored.value);
    if (plan.event === undefined) {
      throw new Error(
        "Inventory operation without an event has no projection write."
      );
    }
    await this.fire(
      InventoryStorageWriteStage.Projection,
      "before",
      operationId
    );
    const value = { ...stored.value, projectionWritten: true };
    this.storeOperation(operationId, { ...stored, value });
    await this.fire(
      InventoryStorageWriteStage.Projection,
      "after",
      operationId
    );
    return structuredClone(value);
  }

  /** Stage the compact reservation lifecycle delta from the frozen plan. */
  async writeReservations(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    /** Serialize reservation-stage progress so flags cannot overwrite each other. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.writeReservationsUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeReservations` while the reference adapter mutation lock is held. */
  private async writeReservationsUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireWritableOperation(operationId);
    if (stored.value.reservationsWritten) return structuredClone(stored.value);
    requireApplyingInventoryOperationPlan(stored.value);
    await this.fire(
      InventoryStorageWriteStage.Reservations,
      "before",
      operationId
    );
    const value = { ...stored.value, reservationsWritten: true };
    this.storeOperation(operationId, { ...stored, value });
    await this.fire(
      InventoryStorageWriteStage.Reservations,
      "after",
      operationId
    );
    return structuredClone(value);
  }

  /** Stage the compact count lifecycle delta from the frozen plan. */
  async writeCounts(operationId: string): Promise<InventoryDurableOperation> {
    /** Serialize count-stage progress so flags cannot overwrite each other. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.writeCountsUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeCounts` while the reference adapter mutation lock is held. */
  private async writeCountsUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireWritableOperation(operationId);
    if (stored.value.countsWritten) return structuredClone(stored.value);
    requireApplyingInventoryOperationPlan(stored.value);
    await this.fire(InventoryStorageWriteStage.Counts, "before", operationId);
    const value = { ...stored.value, countsWritten: true };
    this.storeOperation(operationId, { ...stored, value });
    await this.fire(InventoryStorageWriteStage.Counts, "after", operationId);
    return structuredClone(value);
  }

  /** Stage the final replay receipt from the frozen plan. */
  async writeReceipt(operationId: string): Promise<InventoryDurableOperation> {
    /** Serialize receipt-stage progress so flags cannot overwrite each other. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.writeReceiptUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `writeReceipt` while the reference adapter mutation lock is held. */
  private async writeReceiptUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireWritableOperation(operationId);
    if (stored.value.receiptWritten) return structuredClone(stored.value);
    requireApplyingInventoryOperationPlan(stored.value);
    await this.fire(InventoryStorageWriteStage.Receipt, "before", operationId);
    const value = { ...stored.value, receiptWritten: true };
    this.storeOperation(operationId, { ...stored, value });
    await this.fire(InventoryStorageWriteStage.Receipt, "after", operationId);
    return structuredClone(value);
  }

  /** Publish the staged compact plan, then compact its applying row as two repairable writes. */
  async complete(operationId: string): Promise<InventoryOperationReceipt> {
    /** Serialize world publication/compaction so exact concurrent retries converge. */
    const storageMutation = (): Promise<InventoryOperationReceipt> =>
      this.completeUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `complete` while the reference adapter mutation lock is held. */
  private async completeUnlocked(
    operationId: string
  ): Promise<InventoryOperationReceipt> {
    const stored = this.operations.get(operationId);
    if (stored === undefined) {
      // A reopened world can retain the completed operation only in its event journal.
      const completed = retainedInventoryReportedTransferOperation(this.eventJournal.eventByOperation(operationId));
      if (completed === undefined) throw new Error("Unknown inventory durable operation.");
      return completed.receipt;
    }
    if (stored.value.state === InventoryDurableOperationState.Completed) {
      return structuredClone(stored.value.receipt);
    }
    if (stored.value.state === InventoryDurableOperationState.Aborted) {
      throw new Error("Aborted inventory operation cannot complete.");
    }
    assertInventoryOperationReadyToComplete(stored);
    const plan = requireApplyingInventoryOperationPlan(stored.value);
    await this.fire(InventoryStorageWriteStage.Complete, "before", operationId);
    if (!stored.value.worldPublished) {
      await this.fire(
        InventoryStorageWriteStage.PublishWorld,
        "before",
        operationId
      );
      const nextWorld =
        stored.validatedNextWorld ??
        validateInventoryDurablePlanAgainstBase(this.world, plan);
      const publishedValue: InventoryDurableOperation = {
        ...stored.value,
        worldPublished: true,
      };
      const appendEvent =
        plan.event !== undefined &&
        this.eventJournal.eventByOperation(plan.event.operationId) === undefined
          ? plan.event
          : undefined;
      if (appendEvent !== undefined) {
        this.eventJournal.validateAppend(appendEvent);
      }
      const publishedWorld = freezeInventoryPublishedWorld(nextWorld);
      const baseWorld = this.world;
      this.publishPositionSegment(publishedWorld, plan.event);
      if (
        publishedWorld.projection.placement !== this.world.projection.placement
      ) {
        this.placementSegment = createInMemoryInventorySegmentedPlacementStore({
          placement: publishedWorld.projection.placement,
          revision: publishedWorld.revision,
        });
        this.placementReader = inventoryReadonlyPlacementReader(this.placementSegment);
      }
      if (appendEvent !== undefined) {
        this.eventJournal.append(appendEvent);
      }
      this.world = publishedWorld;
      const publishedReservation = plan.reservationDelta === undefined ? undefined :
        inventorySparseRecordValue(publishedWorld.reservations.operations, plan.reservationDelta.operation.operationId);
      if (publishedReservation !== undefined) {
        // Retain the published immutable evidence, not the applying plan's staged copy.
        this.stockClaims.publish(
          publishedReservation,
          inventorySparseRecordValue(baseWorld.reservations.reservations, publishedReservation.reservationId)
        );
      }
      // Only a changed count row affects the open-count index.
      if (plan.countDelta !== undefined) {
        this.updateOpenCountScopeFromPlan(plan, baseWorld);
      }
      this.storeOperation(operationId, { value: publishedValue });
      await this.fire(
        InventoryStorageWriteStage.PublishWorld,
        "after",
        operationId
      );
    } else if (
      inventoryWorldContentRoots(this.world).world !== plan.nextRoots.world
    ) {
      throw new Error(
        "Published inventory world no longer matches its applying compact plan."
      );
    }
    await this.fire(
      InventoryStorageWriteStage.CompactOperation,
      "before",
      operationId
    );
    const latestStored = this.requireStored(operationId);
    const { plan: completedPlan, ...operationWithoutFullPlan } =
      latestStored.value;
    if (completedPlan === undefined) {
      throw new Error("Applying inventory operation lost its complete plan.");
    }
    const value: InventoryDurableOperation = {
      ...operationWithoutFullPlan,
      state: InventoryDurableOperationState.Completed,
    };
    // Completed retry evidence stays small; the published world now owns the only full snapshots.
    this.storeOperation(operationId, { value });
    await this.fire(
      InventoryStorageWriteStage.CompactOperation,
      "after",
      operationId
    );
    await this.fire(InventoryStorageWriteStage.Complete, "after", operationId);
    return structuredClone(plan.receipt);
  }

  /** Publish only event-touched stock rows into the indexed hot-state position segment. */
  private publishPositionSegment(
    nextWorld: InventoryWorldState,
    event: InventoryCommittedEvent | undefined
  ): void {
    const touchedPositionIds = new Set<string>();
    for (const effect of event?.stockEffects ?? []) {
      touchedPositionIds.add(inventoryStockPositionIdentity(effect.position));
    }
    for (const override of event?.positiveLayerProvenanceOverrides ?? []) {
      touchedPositionIds.add(inventoryStockPositionIdentity(override.position));
    }
    const positiveLayerStarts = new Map<string, number>();
    const removePositionIds: string[] = [];
    const upsertPositions = [];
    for (const positionId of touchedPositionIds) {
      const start = nextWorld.projection.positiveLayerStartedAtEpochMsByPositionId[positionId];
      if (start !== undefined) positiveLayerStarts.set(positionId, start);
      const position = nextWorld.projection.positions[positionId];
      if (position === undefined) {
        if (this.positionSegment.position(positionId) !== undefined) {
          removePositionIds.push(positionId);
        }
      } else {
        upsertPositions.push(position);
      }
    }
    this.positionSegment.applyDelta({
      expectedRevision: this.positionSegment.revision(),
      nextRevision: nextWorld.revision,
      positiveLayerStarts,
      ...(removePositionIds.length === 0 ? {} : { removePositionIds }),
      ...(upsertPositions.length === 0 ? {} : { upsertPositions }),
    });
  }

  /** Commit an existing, non-embodied placement-node parent change as one indexed event. */
  private async commitSegmentedPlacementChangeUnlocked(
    input: CommitInventorySegmentedPlacementInput
  ): Promise<CommitInventorySegmentedStockEventResult | undefined> {
    if (
      input.operationId.trim().length === 0 ||
      input.intentFingerprint.trim().length === 0
    ) {
      throw new Error("Segmented placement operation identity and intent are required.");
    }
    assertInventoryEpochMilliseconds(
      input.recordedAtEpochMs,
      "segmented placement recordedAtEpochMs"
    );
    assertInventoryEpochMilliseconds(
      input.occurredAtEpochMs,
      "segmented placement occurredAtEpochMs"
    );
    const existing = this.operations.get(input.operationId);
    if (existing !== undefined) {
      assertSameInventoryOperationIntent(existing.value, input.intentFingerprint);
      if (existing.value.state === InventoryDurableOperationState.Completed) {
        const event =
          existing.value.event === undefined
            ? this.eventJournal.eventByOperation(input.operationId)
            : structuredClone(existing.value.event);
        if (event !== undefined) {
          return {
            worldRevision: existing.value.receipt.worldRevision,
            recordedAtEpochMs: existing.value.recordedAtEpochMs,
            event,
            replayed: true,
          };
        }
      }
      return undefined;
    }
    if (this.eventJournal.eventByOperation(input.operationId) !== undefined) {
      // Restored snapshots retain journal facts but not their original receipt
      // revision. The canonical coordinator must resolve that replay instead.
      return undefined;
    }
    // The occurrence time is checked against the clock only for a new publication.
    if (input.occurredAtEpochMs > input.recordedAtEpochMs) {
      throw new Error(
        "placement topology change cannot occur after its durable record time."
      );
    }
    if (
      this.failpoint !== undefined ||
      this.applyingOperations.size !== 0 ||
      this.applyingMigrationManifests.size !== 0 ||
      this.openCountCountsByItemId.size !== 0
    ) {
      return undefined;
    }

    const sourceNode = inventorySparseRecordValue(
      this.world.projection.placementNodes,
      input.nodeId
    );
    if (
      sourceNode === undefined ||
      sourceNode.retiredByEventId !== undefined ||
      sourceNode.definition.embodiedBy !== undefined
    ) {
      return undefined;
    }
    const destinationNode =
      input.toParentNodeId === undefined
        ? undefined
        : inventorySparseRecordValue(
            this.world.projection.placementNodes,
            input.toParentNodeId
          );
    if (
      input.toParentNodeId !== undefined &&
      (destinationNode === undefined ||
        destinationNode.retiredByEventId !== undefined ||
        destinationNode.definition.acceptsPlacement !== true)
    ) {
      return undefined;
    }

    const suppliedCatalog = inventoryCatalogFromSnapshot(input.catalog);
    const effectiveCatalog =
      this.pendingSegmentedCatalog ?? this.world.catalog;
    if (effectiveCatalog.digest !== suppliedCatalog.digest) {
      throw new Error(
        "Inventory command uses unpublished catalogue revisions; publish the retained inventory catalogue first."
      );
    }

    const originalParent = this.placementSegment.parentNodeId(input.nodeId);
    if (input.expectedParent !== undefined) {
      const expectedParentNodeId =
        input.expectedParent === null ? undefined : input.expectedParent;
      if (originalParent !== expectedParentNodeId) {
        throw new Error(
          `Placement node '${input.nodeId}' expected parent '${expectedParentNodeId ?? "<unplaced>"}', not '${originalParent ?? "<unplaced>"}'.`
        );
      }
    }
    if (originalParent === input.toParentNodeId) {
      throw new Error(
        input.toParentNodeId === undefined
          ? `Placement node '${input.nodeId}' is already unplaced.`
          : `Placement node '${input.nodeId}' is already directly in '${input.toParentNodeId}'.`
      );
    }

    const normalizedEvent = createInventoryPlacementEvent({
      catalog: suppliedCatalog,
      operationId: input.operationId,
      occurredAtEpochMs: input.occurredAtEpochMs,
      nodeId: input.nodeId,
      ...(originalParent === undefined
        ? {}
        : { fromParentNodeId: originalParent }),
      ...(input.toParentNodeId === undefined
        ? {}
        : { toParentNodeId: input.toParentNodeId }),
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
    });
    const event = commitInventoryEvent(
      normalizedEvent,
      input.recordedAtEpochMs,
      this.eventJournal.lastRecordSequence() + 1
    );
    const earlierEvent = this.eventJournal.event(event.eventId);
    if (earlierEvent !== undefined) {
      throw new Error(
        "Inventory eventId already exists under another operationId."
      );
    }

    this.eventJournal.validateAppend(event);
    const baseRevision = this.positionSegment.revision();
    const placementRevision = this.placementSegment.revision();
    await this.fire(
      InventoryStorageWriteStage.PublishWorld,
      "before",
      input.operationId
    );
    this.placementSegment.applyChange({
      expectedRevision: placementRevision,
      nextRevision: placementRevision + 1,
      eventId: event.eventId,
      nodeId: input.nodeId,
      ...(originalParent === undefined
        ? {}
        : { fromParentNodeId: originalParent }),
      ...(input.toParentNodeId === undefined
        ? {}
        : { toParentNodeId: input.toParentNodeId, targetAcceptsPlacement: true }),
    });
    // The world revision advances even though no exact stock rows changed.
    this.positionSegment.applyDelta({
      expectedRevision: baseRevision,
      nextRevision: baseRevision + 1,
    });
    this.eventJournal.append(event);
    const receipt: InventoryOperationReceipt = {
      operationId: input.operationId,
      recordedAtEpochMs: input.recordedAtEpochMs,
      worldRevision: baseRevision + 1,
      eventId: event.eventId,
    };
    const value: InventoryDurableOperation = {
      operationId: input.operationId,
      intentFingerprint: input.intentFingerprint,
      baseRevision,
      recordedAtEpochMs: input.recordedAtEpochMs,
      state: InventoryDurableOperationState.Completed,
      receipt,
      eventWritten: true,
      projectionWritten: true,
      reservationsWritten: true,
      countsWritten: true,
      receiptWritten: true,
      worldPublished: true,
    };
    this.storeOperation(input.operationId, { value });
    await this.fire(
      InventoryStorageWriteStage.PublishWorld,
      "after",
      input.operationId
    );
    return {
      worldRevision: receipt.worldRevision,
      recordedAtEpochMs: input.recordedAtEpochMs,
      event: structuredClone(event),
      replayed: false,
    };
  }

  /** Perform one atomic segmented stock write while the reference adapter mutation lock is held. */
  private async commitSegmentedStockEventUnlocked(
    input: CommitInventorySegmentedStockEventInput
  ): Promise<CommitInventorySegmentedStockEventResult | undefined> {
    if (input.operationId.trim().length === 0) {
      throw new Error("Inventory operationId must not be empty.");
    }
    if (input.intentFingerprint.trim().length === 0) {
      throw new Error("Inventory operation intent fingerprint must not be empty.");
    }
    assertInventoryEpochMilliseconds(
      input.recordedAtEpochMs,
      "inventory segmented stock event recordedAtEpochMs"
    );
    if (
      input.expectedWorldRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedWorldRevision) ||
        input.expectedWorldRevision < 0)
    ) {
      throw new Error(
        "Segmented stock event expectedWorldRevision must be a non-negative safe integer."
      );
    }
    if (
      input.expectedRecordSequence !== undefined &&
      (!Number.isSafeInteger(input.expectedRecordSequence) ||
        input.expectedRecordSequence < 0)
    ) {
      throw new Error(
        "Segmented stock event expectedRecordSequence must be a non-negative safe integer."
      );
    }

    const existing = this.operations.get(input.operationId);
    if (existing !== undefined) {
      assertSameInventoryOperationIntent(existing.value, input.intentFingerprint);
      if (existing.value.state === InventoryDurableOperationState.Completed) {
        // Canonical coordinator receipts may retain an event alias; journal reads
        // already return defensive copies. Never expose either archive alias.
        const event =
          existing.value.event === undefined
            ? this.eventJournal.eventByOperation(input.operationId)
            : structuredClone(existing.value.event);
        if (event !== undefined) {
          return {
            worldRevision: existing.value.receipt.worldRevision,
            recordedAtEpochMs: existing.value.recordedAtEpochMs,
            event,
            replayed: true,
          };
        }
      }
      return undefined;
    }
    // A restored canonical snapshot includes event idempotency, but does not
    // include durable receipts. Let the canonical coordinator validate/replay
    // that retained fact before any hot-row update; its receipt revision cannot
    // be inferred from an event sequence because claim-only revisions also exist.
    if (this.eventJournal.eventByOperation(input.operationId) !== undefined) {
      return undefined;
    }
    for (const stored of this.applyingOperations.values()) {
      if (stored.value.state === InventoryDurableOperationState.Applying) {
        return undefined;
      }
    }
    for (const manifest of this.applyingMigrationManifests.values()) {
      if (manifest.state === InventoryMigrationManifestState.Applying) {
        return undefined;
      }
    }
    if (
      input.expectedWorldRevision !== undefined &&
      input.expectedWorldRevision !== this.positionSegment.revision()
    ) {
      return undefined;
    }
    if (
      input.expectedRecordSequence !== undefined &&
      input.expectedRecordSequence !== this.eventJournal.lastRecordSequence()
    ) {
      return undefined;
    }
    if (!this.segmentedStockEventIsEligible(input)) return undefined;

    const suppliedCatalog = inventoryCatalogFromSnapshot(input.catalog);
    const effectiveCatalog =
      this.pendingSegmentedCatalog ?? this.world.catalog;
    const currentRevision = this.positionSegment.revision();
    const mayEstablishCatalog =
      currentRevision === 0 &&
      this.world.revision === 0 &&
      this.eventJournal.lastRecordSequence() === 0;
    if (!mayEstablishCatalog && effectiveCatalog.digest !== suppliedCatalog.digest) {
      throw new Error(
        "Inventory command uses unpublished catalogue revisions; publish the retained inventory catalogue first."
      );
    }
    const catalogForEvent = mayEstablishCatalog ? input.catalog : effectiveCatalog;
    const normalizedEvent = defineInventoryEvent({
      catalog: inventoryCatalogFromSnapshot(catalogForEvent),
      event: input.event,
    });

    const baseRevision = currentRevision;
    const event = commitInventoryEvent(
      normalizedEvent,
      input.recordedAtEpochMs,
      this.eventJournal.lastRecordSequence() + 1
    );
    const existingEvent = this.eventJournal.event(event.eventId);
    if (
      existingEvent !== undefined &&
      existingEvent.operationId !== input.operationId
    ) {
      throw new Error(
        "Inventory eventId already exists under another operationId."
      );
    }

    for (const effect of event.stockEffects) {
      const placementNodeId = effect.position.placementNodeId;
      if (placementNodeId === undefined) continue;
      const placementNode = inventorySparseRecordValue(
        this.world.projection.placementNodes,
        placementNodeId
      );
      if (placementNode?.retiredByEventId !== undefined) {
        throw new Error(
          `Retired placement node '${placementNodeId}' cannot receive stock.`
        );
      }
      if (placementNode?.definition.acceptsPlacement === false) {
        throw new Error(
          `Placement node '${placementNodeId}' does not accept stock.`
        );
      }
    }

    this.eventJournal.validateAppend(event);
    /** Prepared edge updates to publish with the stock effects. */
    let publishContentsEdges: (() => void) | undefined;
    if (event.kind === InventoryEventKind.Placement) {
      try {
        publishContentsEdges = this.prepareSegmentedDirectContentsEdges(event);
      } catch (error) {
        // An exact placement into a sibling can belong to the ordinary placement path.
        if (error instanceof Error && error.cause === inventoryPlacementDestinationWithinSource) return undefined;
        throw error;
      }
    }
    await this.fire(
      InventoryStorageWriteStage.PublishWorld,
      "before",
      input.operationId
    );
    this.positionSegment.applyStockEffects({
      expectedRevision: baseRevision,
      nextRevision: baseRevision + 1,
      event,
      deficitPolicy: input.deficitPolicy,
    });
    // Every edge is prepared before stock can change. Readers see both or neither.
    publishContentsEdges?.();
    const receipt: InventoryOperationReceipt = {
      operationId: input.operationId,
      recordedAtEpochMs: input.recordedAtEpochMs,
      worldRevision: baseRevision + 1,
      eventId: event.eventId,
    };
    const value: InventoryDurableOperation = {
      operationId: input.operationId,
      intentFingerprint: input.intentFingerprint,
      baseRevision,
      recordedAtEpochMs: input.recordedAtEpochMs,
      state: InventoryDurableOperationState.Completed,
      receipt,
      eventWritten: true,
      projectionWritten: true,
      reservationsWritten: true,
      countsWritten: true,
      receiptWritten: true,
      worldPublished: true,
    };
    this.eventJournal.append(event);
    this.storeOperation(input.operationId, { value });
    if (mayEstablishCatalog) {
      this.pendingSegmentedCatalog = inventoryCatalogSnapshot(suppliedCatalog);
    }
    await this.fire(
      InventoryStorageWriteStage.PublishWorld,
      "after",
      input.operationId
    );
    return {
      worldRevision: receipt.worldRevision,
      recordedAtEpochMs: input.recordedAtEpochMs,
      event: structuredClone(event),
      replayed: false,
    };
  }

  /** Prepare explicit sibling moves and the same edges implied by embodied serial transfers. */
  private prepareSegmentedDirectContentsEdges(event: InventoryCommittedEvent): (() => void) | undefined {
    const changes: InventoryPlacementChange[] = [...(event.placementChanges ?? [])];
    for (const route of event.positiveLayerProvenanceTransfers ?? []) {
      const serialId = route.from.serialId;
      if (serialId === undefined) continue;
      const nodeId = inventorySparseRecordValue(
        this.world.projection.placementNodeIdByEmbodiedSerialIdentity,
        inventorySerialIdentity(route.from.itemId, serialId)
      );
      if (nodeId === undefined) continue;
      const fromParentNodeId = route.from.placementNodeId;
      const toParentNodeId = route.to.placementNodeId;
      if (fromParentNodeId === undefined || toParentNodeId === undefined) {
        throw new Error("An embodied direct contents move requires exact source and destination placements.");
      }
      changes.push({ nodeId, fromParentNodeId, toParentNodeId });
    }
    for (const change of changes) {
      const source = inventorySparseRecordValue(this.world.projection.placementNodes, change.nodeId);
      const destination = change.toParentNodeId === undefined ? undefined :
        inventorySparseRecordValue(this.world.projection.placementNodes, change.toParentNodeId);
      if (source?.retiredByEventId !== undefined || destination?.retiredByEventId !== undefined ||
          destination?.definition.acceptsPlacement === false) {
        throw new Error(`Placement node '${change.toParentNodeId}' cannot accept moved direct contents.`);
      }
    }
    return changes.length === 0 ? undefined : this.placementSegment.prepareDirectContentsEdges(event.eventId, changes);
  }

  /** Return whether one event can publish through the existing segmented write fence. */
  private segmentedStockEventIsEligible(
    input: CommitInventorySegmentedStockEventInput
  ): boolean {
    // The staged coordinator failpoint harness certifies the repair protocol. Keep those
    // deterministic stage tests on that path; segmented commit models one atomic DB transaction.
    if (this.failpoint !== undefined) return false;
    const event = input.event;
    const compositeContents = event.kind === InventoryEventKind.Placement &&
      input.expectedWorldRevision !== undefined && input.expectedRecordSequence !== undefined &&
      inventorySegmentedEventMovesDirectContents(event);
    const historicalEnvelope =
      event.kind === InventoryEventKind.Correction ||
      event.kind === InventoryEventKind.HistoricalRepair;
    if (
      event.kind !== InventoryEventKind.Transfer &&
      event.kind !== InventoryEventKind.Receipt &&
      event.kind !== InventoryEventKind.Issue &&
      event.kind !== InventoryEventKind.Reclassification &&
      event.kind !== InventoryEventKind.Scrap &&
      !historicalEnvelope && !compositeContents
    ) {
      return false;
    }
    if (event.operationId !== input.operationId) return false;
    if (
      historicalEnvelope &&
      (input.expectedWorldRevision === undefined ||
        input.expectedRecordSequence === undefined)
    ) {
      return false;
    }
    if (!historicalEnvelope && !compositeContents && event.stockEffects.length === 0) return false;
    if (
      !compositeContents && event.stockEffects.some(
        /** Other serialized writes retain their canonical lifetime and metadata checks. */
        (effect) => effect.position.serialId !== undefined
      )
    ) {
      return false;
    }
    if ((event.lotDefinitions?.length ?? 0) !== 0) return false;
    if ((event.placementNodeDefinitions?.length ?? 0) !== 0) return false;
    if (!compositeContents && (event.placementChanges?.length ?? 0) !== 0) return false;
    if (event.traceabilityChanges.length !== 0) return false;
    if (
      (event.positiveLayerProvenanceOverrides?.length ?? 0) !== 0
    ) return false;
    if (event.transferLifecycle !== undefined) return false;
    if (event.correction !== undefined) {
      // An omitted metadata/topology root has no explicit stock or placement delta.
      // Publication must update the canonical placement/lot masters before native reads.
      const correctedRoot = inventorySparseRecordValue(
        this.world.projection.events,
        event.correction.correctsEventId
      );
      const supersededCorrection =
        event.correction.supersedesCorrectionEventId === undefined
          ? undefined
          : inventorySparseRecordValue(
              this.world.projection.events,
              event.correction.supersedesCorrectionEventId
            );
      for (const source of [correctedRoot, supersededCorrection]) {
        if (
          (source?.lotDefinitions?.length ?? 0) !== 0 ||
          (source?.placementNodeDefinitions?.length ?? 0) !== 0 ||
          (source?.placementChanges?.length ?? 0) !== 0
        ) {
          return false;
        }
      }
    }
    if (!historicalEnvelope && event.correction !== undefined) return false;
    if (
      event.kind === InventoryEventKind.Correction &&
      event.correction === undefined
    ) return false;
    if (
      event.kind === InventoryEventKind.HistoricalRepair &&
      event.historicalRepair === undefined
    ) return false;
    if (event.catalogDigest !== undefined || event.catalogSnapshot !== undefined) {
      return false;
    }
    // Keep the existing canonical path for stock that intersects an open count.
    // Ordinary effects do not change claims or require claim feasibility.
    for (const effect of event.stockEffects) {
      if (this.openCountCountsByItemId.has(effect.position.itemId)) {
        return false;
      }
    }
    if (historicalEnvelope) {
      // Historical plans may legitimately improve an existing recorded deficit.
      // Route those rare signed rows through the canonical correction publisher.
      for (const effect of event.stockEffects) {
        const current = this.positionSegment.position(
          inventoryStockPositionIdentity(effect.position)
        );
        if (
          current !== undefined &&
          current.measurements.primary.quantity.amountMinor < 0
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /** Index open counts on initialization and whole-world migration. */
  private refreshOpenCountScopes(world: InventoryWorldState): void {
    const counts = new Map<string, number>();
    for (const count of Object.values(world.counts.counts)) {
      if (
        count.status !== InventoryCountStatus.Started &&
        count.status !== InventoryCountStatus.Observed
      ) continue;
      const itemId = count.selector.itemId;
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
    this.openCountCountsByItemId = counts;
  }

  /** Apply one validated count lifecycle change without traversing count history. */
  private updateOpenCountScopeFromPlan(
    plan: InventoryDurableOperationPlan,
    base: InventoryWorldState
  ): void {
    const nextCount = plan.countDelta?.count;
    if (nextCount !== undefined) {
      const previous = inventorySparseRecordValue(
        base.counts.counts,
        nextCount.countId
      );
      this.updateActiveItemCount(
        this.openCountCountsByItemId,
        previous?.status === InventoryCountStatus.Started ||
          previous?.status === InventoryCountStatus.Observed
          ? previous.selector.itemId
          : undefined,
        nextCount.status === InventoryCountStatus.Started ||
          nextCount.status === InventoryCountStatus.Observed
          ? nextCount.selector.itemId
          : undefined
      );
    }
  }

  /** Replace one active-row item membership without confusing siblings sharing an item. */
  private updateActiveItemCount(
    countsByItemId: Map<string, number>,
    previousItemId: string | undefined,
    currentItemId: string | undefined
  ): void {
    if (previousItemId === currentItemId) return;
    if (previousItemId !== undefined) {
      const previousCount = countsByItemId.get(previousItemId);
      if (previousCount === undefined || previousCount < 1) {
        throw new Error("Inventory protected item scope counter disagrees with its published lifecycle.");
      }
      if (previousCount === 1) countsByItemId.delete(previousItemId);
      else countsByItemId.set(previousItemId, previousCount - 1);
    }
    if (currentItemId !== undefined) {
      countsByItemId.set(
        currentItemId,
        (countsByItemId.get(currentItemId) ?? 0) + 1
      );
    }
  }

  /** Catch the canonical proof/export world up to already-published segmented events. */
  private materializePendingSegmentedEvents(): void {
    const firstPendingSequence =
      this.world.projection.lastRecordSequence + 1;
    const lastSequence = this.eventJournal.lastRecordSequence();
    if (firstPendingSequence > lastSequence) return;

    const events: InventoryCommittedEvent[] = [];
    for (
      let sequence = firstPendingSequence;
      sequence <= lastSequence;
      sequence += 1
    ) {
      const event = this.eventJournal.eventBySequence(sequence);
      if (event === undefined) {
        throw new Error(
          `Segmented journal lost committed recordSequence ${sequence}.`
        );
      }
      events.push(event);
    }
    const catalogSnapshot =
      this.pendingSegmentedCatalog ?? this.world.catalog;
    const catalog = inventoryCatalogFromSnapshot(catalogSnapshot);
    const projection = applyInventoryCommittedEvents({
      catalog,
      state: this.world.projection,
      events,
      // The published journal can contain signed effects accepted under Record.
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    this.world = freezeInventoryPublishedWorld({
      revision: this.positionSegment.revision(),
      catalog: catalogSnapshot,
      projection,
      reservations: this.world.reservations,
      counts: this.world.counts,
    });
    this.pendingSegmentedCatalog = undefined;
  }

  /** Abort one applying plan without publishing any staged component. */
  async abort(operationId: string): Promise<InventoryDurableOperation> {
    /** Serialize abort against concurrent publication/repair. */
    const storageMutation = (): Promise<InventoryDurableOperation> =>
      this.abortUnlocked(operationId);
    return this.runStorageMutationAtomically(storageMutation);
  }

  /** Perform `abort` while the reference adapter mutation lock is held. */
  private async abortUnlocked(
    operationId: string
  ): Promise<InventoryDurableOperation> {
    const stored = this.requireStored(operationId);
    if (stored.value.state === InventoryDurableOperationState.Completed) {
      throw new Error("Completed inventory operation cannot be aborted.");
    }
    if (stored.value.state === InventoryDurableOperationState.Aborted) {
      return structuredClone(stored.value);
    }
    if (stored.value.worldPublished) {
      throw new Error(
        "Published inventory operation cannot be aborted; finish plan compaction instead."
      );
    }
    const { plan: abortedPlan, ...operationWithoutFullPlan } = stored.value;
    if (abortedPlan === undefined) {
      throw new Error("Applying inventory operation lost its complete plan.");
    }
    await this.fire(
      InventoryStorageWriteStage.ClaimAbort,
      "before",
      operationId
    );
    const value: InventoryDurableOperation = {
      ...operationWithoutFullPlan,
      state: InventoryDurableOperationState.Aborted,
    };
    this.storeOperation(operationId, { value });
    await this.fire(
      InventoryStorageWriteStage.ClaimAbort,
      "after",
      operationId
    );
    await this.fire(InventoryStorageWriteStage.Abort, "before", operationId);
    await this.fire(InventoryStorageWriteStage.Abort, "after", operationId);
    return structuredClone(value);
  }

  /** Serialize one reference-adapter mutation and release the chain after success or failure. */
  private async runStorageMutationAtomically<Result>(
    operation: () => Promise<Result>
  ): Promise<Result> {
    if (inventoryStorageFailpointExecution.getStore() === this) {
      throw new Error(
        "Inventory storage failpoint callbacks must not invoke storage mutations."
      );
    }
    const result = this.storageMutationBarrier.then(operation);
    this.storageMutationBarrier = result.then(
      finishInventoryStorageMutationSection,
      finishInventoryStorageMutationSection
    );
    return result;
  }

  /** Publish one operation row and maintain the exact Applying-only repair/fence index. */
  private storeOperation(
    operationId: string,
    stored: StoredInventoryOperation
  ): void {
    this.operations.set(operationId, stored);
    if (stored.value.state === InventoryDurableOperationState.Applying) {
      this.applyingOperations.set(operationId, stored);
    } else {
      this.applyingOperations.delete(operationId);
    }
  }

  /** Publish one migration row and maintain the exact Applying-only repair/fence index. */
  private storeMigrationManifest(
    migrationId: string,
    manifest: InventoryMigrationManifest
  ): void {
    this.migrationManifests.set(migrationId, manifest);
    if (manifest.state === InventoryMigrationManifestState.Applying) {
      this.applyingMigrationManifests.set(migrationId, manifest);
    } else {
      this.applyingMigrationManifests.delete(migrationId);
    }
  }

  /** Load one operation row or fail rather than inventing repair state. */
  private requireStored(operationId: string): StoredInventoryOperation {
    const stored = this.operations.get(operationId);
    if (stored === undefined)
      throw new Error("Unknown inventory durable operation.");
    return stored;
  }

  /** Load one migration manifest or fail rather than inventing progress. */
  private requireMigrationManifest(
    migrationId: string
  ): InventoryMigrationManifest {
    const manifest = this.migrationManifests.get(migrationId);
    if (manifest === undefined)
      throw new Error("Unknown inventory migration manifest.");
    return manifest;
  }

  /** Reject every normal operation while an unpublished migration batch fences this target. */
  private assertNoApplyingMigrationFence(): void {
    for (const manifest of this.applyingMigrationManifests.values()) {
      if (manifest.state !== InventoryMigrationManifestState.Applying) continue;
      throw new Error(
        `Inventory migration '${manifest.migrationId}' fences unrelated operations.`
      );
    }
  }

  /** Load one operation writable by staged-write calls; completed rows are returned for idempotent no-ops. */
  private requireWritableOperation(operationId: string): StoredInventoryOperation {
    const stored = this.operations.get(operationId);
    if (stored === undefined) {
      // A reopened journal can prove completion even when the staged row is absent.
      const completed = retainedInventoryReportedTransferOperation(this.eventJournal.eventByOperation(operationId));
      if (completed === undefined) throw new Error("Unknown inventory durable operation.");
      return { value: completed };
    }
    if (stored.value.state === InventoryDurableOperationState.Aborted) {
      throw new Error("Aborted inventory operation cannot be written.");
    }
    return stored;
  }

  /** Fire one optional deterministic failpoint around a physical boundary. */
  private async fire(
    stage: InventoryStorageWriteStage,
    timing: InventoryStorageWriteTiming,
    operationId: string
  ): Promise<void> {
    if (this.failpoint === undefined) return;
    await inventoryStorageFailpointExecution.run(
      this,
      /** Execute only the deterministic failure injector inside the marked async context. */
      () => this.failpoint?.({ stage, timing, operationId })
    );
  }
}

/** Read the replay evidence stored only on a plain reported transfer. */
function inventoryReportedTransferReplayEvidence(event: InventoryEventDraft | undefined) {
  if (event?.kind !== InventoryEventKind.Transfer || event.transferLifecycle !== undefined) return undefined;
  const replay = event.metadata?.[inventoryReportedTransferReplayMetadataKey];
  if (typeof replay !== "object" || replay === null || !("intentFingerprint" in replay) || !("worldRevision" in replay)) {
    return undefined;
  }
  const { intentFingerprint, worldRevision } = replay;
  if (typeof intentFingerprint !== "string" || typeof worldRevision !== "number") return undefined;
  return { intentFingerprint, worldRevision };
}

/** Restore the exact original receipt from the journal when reopening a published world. */
function retainedInventoryReportedTransferOperation(
  event: InventoryCommittedEvent | undefined
): InventoryDurableOperation | undefined {
  const replay = inventoryReportedTransferReplayEvidence(event);
  if (event === undefined || replay === undefined) return undefined;
  const { intentFingerprint, worldRevision } = replay;
  const { operationId, eventId, recordedAtEpochMs } = event;
  return {
    operationId,
    intentFingerprint,
    baseRevision: worldRevision - 1,
    recordedAtEpochMs,
    state: InventoryDurableOperationState.Completed,
    receipt: { operationId, eventId, recordedAtEpochMs, worldRevision },
    event,
    eventWritten: true,
    projectionWritten: true,
    reservationsWritten: true,
    countsWritten: true,
    receiptWritten: true,
    worldPublished: true,
  };
}

/** Resolve the serialized mutation barrier after either a successful or failed adapter mutation. */
function finishInventoryStorageMutationSection(): void {}

/** Check which normalized placement events fit the native sibling-relocation transaction. */
function inventorySegmentedEventMovesDirectContents(event: InventoryEventDraft): boolean {
  const changes = event.placementChanges ?? [];
  const routes = event.positiveLayerProvenanceTransfers ?? [];
  const source = changes[0]?.fromParentNodeId ?? routes[0]?.from.placementNodeId;
  const destination = changes[0]?.toParentNodeId ?? routes[0]?.to.placementNodeId;
  if (source === undefined || destination === undefined || event.stockEffects.length !== routes.length * 2) {
    return false;
  }
  for (const change of changes) {
    if (change.fromParentNodeId !== source || change.toParentNodeId !== destination) return false;
  }
  for (const route of routes) {
    if (route.from.placementNodeId !== source || route.to.placementNodeId !== destination ||
        route.from.serialId !== route.to.serialId) return false;
  }
  return true;
}

/** Create one isolated reference adapter with staged-publication semantics. */
export function createInMemoryInventoryDurableStorage(
  input: InMemoryInventoryDurableStorageInput = {}
): InMemoryInventoryDurableStorage {
  return new InMemoryInventoryDurableStorage(input);
}

/** Validate one adapter begin request before any durable claim becomes visible. */
export function validateInventoryDurableOperationBeginInput(
  input: BeginInventoryDurableOperationInput
): void {
  validateBeginInventoryOperation(input);
}

/** Rebuild and verify the exact next world frozen by one durable operation plan. */
export function materializeInventoryDurableOperationWorld(
  base: InventoryWorldState,
  plan: InventoryDurableOperationPlan
): InventoryWorldState {
  return validateInventoryDurablePlanAgainstBase(base, plan);
}

/** Validate one whole migration begin request before its publication fence is claimed. */
export function validateInventoryMigrationManifestBeginInput(
  input: BeginInventoryMigrationManifestInput
): void {
  validateBeginInventoryMigrationManifest(input);
}

/** Rebuild and verify the exact next world frozen by one migration batch. */
export function materializeInventoryDurableMigrationWorld(
  base: InventoryWorldState,
  plan: InventoryDurableMigrationPlan
): InventoryWorldState {
  return validateInventoryDurableMigrationPlanAgainstBase(base, plan);
}

/** Load the complete frozen plan required while one operation is still repairable. */
function requireApplyingInventoryOperationPlan(
  operation: InventoryDurableOperation
): InventoryDurableOperationPlan {
  if (
    operation.state !== InventoryDurableOperationState.Applying ||
    operation.plan === undefined
  ) {
    throw new Error(
      "Only an applying inventory operation retains a repair plan."
    );
  }
  return operation.plan;
}

/** Validate the frozen plan/receipt identities before any durable row is created. */
function validateBeginInventoryOperation(
  input: BeginInventoryDurableOperationInput
): void {
  if (input.operationId.trim().length === 0) {
    throw new Error("Inventory durable operationId must not be empty.");
  }
  if (input.intentFingerprint.trim().length === 0) {
    throw new Error("Inventory durable intent fingerprint must not be empty.");
  }
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error(
      "Inventory durable baseRevision must be a non-negative safe integer."
    );
  }
  assertInventoryEpochMilliseconds(
    input.recordedAtEpochMs,
    "inventory operation recordedAtEpochMs"
  );
  if (input.plan.format !== "inventoryonce-compact-plan-v1") {
    throw new Error(
      "Inventory durable adapter does not support this compact plan format."
    );
  }
  const planCatalog = inventoryCatalogFromSnapshot(input.plan.catalog);
  if (planCatalog.digest !== input.plan.catalogRoot) {
    throw new Error(
      "Inventory durable plan catalogue root does not match its definitions."
    );
  }
  const receipt = input.plan.receipt;
  if (receipt.operationId !== input.operationId) {
    throw new Error(
      "Inventory operation receipt must use the frozen operationId."
    );
  }
  if (receipt.recordedAtEpochMs !== input.recordedAtEpochMs) {
    throw new Error(
      "Inventory operation receipt must use the frozen recordedAtEpochMs."
    );
  }
  if (receipt.worldRevision !== input.baseRevision + 1) {
    throw new Error(
      "Inventory operation receipt worldRevision must be baseRevision + 1."
    );
  }
  const event = input.plan.event;
  if (event !== undefined) {
    if (event.operationId !== input.operationId) {
      throw new Error(
        "Inventory committed event must use the frozen operationId."
      );
    }
    if (event.recordedAtEpochMs !== input.recordedAtEpochMs) {
      throw new Error(
        "Inventory committed event must use the frozen recordedAtEpochMs."
      );
    }
    if (receipt.eventId !== event.eventId) {
      throw new Error(
        "Inventory receipt eventId must match the frozen committed event."
      );
    }
  } else if (receipt.eventId !== undefined) {
    throw new Error(
      "Inventory receipt cannot name an event when the plan has none."
    );
  }
  if (
    input.plan.reservationDelta?.reservation.reservationId !==
    receipt.reservationId
  ) {
    throw new Error(
      "Inventory receipt reservationId must match the compact reservation delta."
    );
  }
  if (input.plan.countDelta?.count.countId !== receipt.countId) {
    throw new Error(
      "Inventory receipt countId must match the compact count delta."
    );
  }
}

/** Re-derive one complete next world from compact immutable deltas and verify every content root. */
function validateInventoryDurablePlanAgainstBase(
  base: InventoryWorldState,
  plan: InventoryDurableOperationPlan
): InventoryWorldState {
  const baseRoots = inventoryWorldContentRoots(base);
  if (baseRoots.world !== plan.baseWorldRoot) {
    throw new Error(
      "Inventory durable plan is not bound to this exact base world."
    );
  }
  const catalog = inventoryCatalogFromSnapshot(plan.catalog);
  if (base.revision > 0)
    assertInventoryCatalogRetainsSnapshot(catalog, base.catalog);
  if (catalog.digest !== plan.catalogRoot) {
    throw new Error(
      "Inventory durable plan catalogue root does not match its definitions."
    );
  }
  const projection =
    plan.event === undefined
      ? base.projection
      : applyInventoryCommittedEvent({
          catalog,
          state: base.projection,
          event: plan.event,
          deficitPolicy: plan.deficitPolicy,
        }).state;
  const reservations = applyInventoryReservationBookDelta(
    base.reservations,
    plan.reservationDelta,
    base.projection.placement
  );
  const counts = applyInventoryCountBookDelta(base.counts, plan.countDelta);
  const next: InventoryWorldState = {
    revision: base.revision + 1,
    catalog: plan.catalog,
    projection,
    reservations,
    counts,
  };
  const nextRoots = inventoryWorldContentRoots(next);
  if (!inventoryWorldContentRootsEqual(nextRoots, plan.nextRoots)) {
    throw new Error(
      "Inventory durable plan next-world roots do not match its compact deltas."
    );
  }
  const digest = inventoryDurablePlanDigest({
    baseWorldRoot: plan.baseWorldRoot,
    catalogRoot: plan.catalogRoot,
    deficitPolicy: plan.deficitPolicy,
    ...(plan.event === undefined ? {} : { event: plan.event }),
    ...(plan.reservationDelta === undefined
      ? {}
      : { reservationDelta: plan.reservationDelta }),
    ...(plan.countDelta === undefined ? {} : { countDelta: plan.countDelta }),
    receipt: plan.receipt,
    nextRoots: plan.nextRoots,
  });
  if (digest !== plan.planDigest) {
    throw new Error(
      "Inventory durable plan digest does not match its frozen compact manifest."
    );
  }
  return next;
}

/** Compare fixed world roots field-by-field so object key insertion order is irrelevant. */
function inventoryWorldContentRootsEqual(
  left: InventoryWorldContentRoots,
  right: InventoryWorldContentRoots
): boolean {
  return (
    left.world === right.world &&
    left.catalog === right.catalog &&
    left.projection === right.projection &&
    left.reservations === right.reservations &&
    left.counts === right.counts
  );
}

/** Validate one loaded world before a restarted adapter lets it interpret retained revision ids. */
function validatePublishedInventoryWorld(world: InventoryWorldState): void {
  if (!Number.isSafeInteger(world.revision) || world.revision < 0) {
    throw new Error(
      "Published inventory world revision must be a non-negative safe integer."
    );
  }
  const catalog = inventoryCatalogFromSnapshot(world.catalog);
  if (world.revision === 0 && world.projection.lastRecordSequence === 0) return;
  for (const position of Object.values(world.projection.positions)) {
    const item = catalog.itemRevision(position.key.itemRevisionId);
    if (item.itemId !== position.key.itemId) {
      throw new Error(
        "Published inventory position item differs from its retained revision."
      );
    }
  }
}

/** Validate one whole migration identity before storing its first manifest. */
function validateBeginInventoryMigrationManifest(
  input: BeginInventoryMigrationManifestInput
): void {
  if (input.migrationId.trim().length === 0) {
    throw new Error("Inventory migration manifest id must not be empty.");
  }
  if (input.planDigest.trim().length === 0) {
    throw new Error("Inventory migration manifest digest must not be empty.");
  }
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new Error(
      "Inventory migration baseRevision must be a non-negative safe integer."
    );
  }
  if (input.baseWorldRoot.trim().length === 0) {
    throw new Error("Inventory migration base world root must not be empty.");
  }
  if (
    input.plan.format !== "inventoryonce-migration-plan-v1" ||
    input.plan.baseWorldRoot !== input.baseWorldRoot
  ) {
    throw new Error(
      "Inventory migration manifest and frozen batch base disagree."
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < input.operationIds.length; index += 1) {
    const operationId = input.operationIds[index];
    if (operationId === undefined) {
      throw new Error(
        "Inventory migration manifest operation id must not be empty."
      );
    }
    if (operationId.trim().length === 0) {
      throw new Error(
        "Inventory migration manifest operation id must not be empty."
      );
    }
    if (seen.has(operationId)) {
      throw new Error(
        `Inventory migration manifest repeats operation '${operationId}'.`
      );
    }
    seen.add(operationId);
    if (input.plan.events[index]?.operationId !== operationId) {
      throw new Error(
        "Inventory migration manifest operation order differs from its frozen batch."
      );
    }
  }
  if (input.plan.events.length !== input.operationIds.length) {
    throw new Error(
      "Inventory migration manifest event count differs from its operation list."
    );
  }
  if (
    !migrationSourceDispositionsEqual(
      input.sourceDispositions,
      input.plan.sourceDispositions
    )
  ) {
    throw new Error(
      "Inventory migration manifest source dispositions differ from its frozen batch."
    );
  }
}

/** Require exact target evidence after a migration batch becomes visible. */
function assertPublishedInventoryMigrationTarget(
  manifest: InventoryMigrationManifest
): void {
  if (
    !manifest.worldPublished ||
    typeof manifest.targetWorldRoot !== "string" ||
    manifest.targetWorldRoot.length === 0 ||
    manifest.targetWorldRoot.trim() !== manifest.targetWorldRoot ||
    !Number.isSafeInteger(manifest.targetWorldRevision) ||
    manifest.targetWorldRevision !== manifest.baseRevision + 1
  ) {
    throw new Error(
      "Published inventory migration manifest is missing exact target-world evidence."
    );
  }
}

/** Reject reuse of one migration identity with a changed digest or ordered operation list. */
function assertSameInventoryMigrationManifest(
  existing: InventoryMigrationManifest,
  input: BeginInventoryMigrationManifestInput
): void {
  if (existing.planDigest !== input.planDigest) {
    throw new Error(
      "Inventory migrationId was retried with a changed whole plan."
    );
  }
  if (existing.state === InventoryMigrationManifestState.Aborted) {
    throw new Error("Aborted inventory migration identity cannot be reused.");
  }
  if (
    existing.baseRevision !== input.baseRevision ||
    existing.baseWorldRoot !== input.baseWorldRoot
  ) {
    throw new Error(
      "Inventory migrationId was retried against a changed target base."
    );
  }
  if (existing.operationIds.length !== input.operationIds.length) {
    throw new Error(
      "Inventory migrationId was retried with a changed whole plan."
    );
  }
  for (let index = 0; index < existing.operationIds.length; index += 1) {
    if (existing.operationIds[index] !== input.operationIds[index]) {
      throw new Error(
        "Inventory migrationId was retried with a changed whole plan."
      );
    }
  }
  if (
    !migrationSourceDispositionsEqual(
      existing.sourceDispositions,
      input.sourceDispositions
    )
  ) {
    throw new Error(
      "Inventory migrationId was retried with changed source dispositions."
    );
  }
}

/** Re-derive one complete migration world from frozen events and verify every content root. */
function validateInventoryDurableMigrationPlanAgainstBase(
  base: InventoryWorldState,
  plan: InventoryDurableMigrationPlan
): InventoryWorldState {
  const baseRoots = inventoryWorldContentRoots(base);
  if (baseRoots.world !== plan.baseWorldRoot) {
    throw new Error(
      "Inventory migration batch is not bound to this exact target world."
    );
  }
  const catalog = inventoryCatalogFromSnapshot(plan.catalog);
  if (base.revision > 0)
    assertInventoryCatalogRetainsSnapshot(catalog, base.catalog);
  if (catalog.digest !== plan.catalogRoot) {
    throw new Error(
      "Inventory migration batch catalogue root does not match its definitions."
    );
  }
  let projection = base.projection;
  for (const event of plan.events) {
    projection = applyInventoryCommittedEvent({
      catalog,
      state: projection,
      event,
      deficitPolicy: plan.deficitPolicy,
    }).state;
  }
  const next: InventoryWorldState = {
    revision: base.revision + 1,
    catalog: plan.catalog,
    projection,
    reservations: base.reservations,
    counts: base.counts,
  };
  const nextRoots = inventoryWorldContentRoots(next);
  if (!inventoryWorldContentRootsEqual(nextRoots, plan.nextRoots)) {
    throw new Error(
      "Inventory migration batch roots do not match its frozen events."
    );
  }
  const durablePlanDigest = inventoryDurableMigrationPlanDigest({
    baseWorldRoot: plan.baseWorldRoot,
    catalogRoot: plan.catalogRoot,
    deficitPolicy: plan.deficitPolicy,
    events: plan.events,
    sourceDispositions: plan.sourceDispositions,
    nextRoots: plan.nextRoots,
  });
  if (durablePlanDigest !== plan.durablePlanDigest) {
    throw new Error(
      "Inventory migration batch digest does not match its frozen plan."
    );
  }
  return next;
}

/** Compare canonical source-disposition rows without sorting away reviewed order. */
function migrationSourceDispositionsEqual(
  left: readonly InventoryMigrationSourceDisposition[],
  right: readonly InventoryMigrationSourceDisposition[]
): boolean {
  return (
    inventoryIntentFingerprint(
      left.map(inventoryMigrationSourceDispositionFingerprint)
    ) ===
    inventoryIntentFingerprint(
      right.map(inventoryMigrationSourceDispositionFingerprint)
    )
  );
}

/** Reject changed intent under an existing durable operation identity. */
function assertSameInventoryOperationIntent(
  existing: InventoryDurableOperation,
  intentFingerprint: string
): void {
  if (existing.intentFingerprint !== intentFingerprint) {
    throw new Error("Inventory operationId was retried with changed intent.");
  }
  if (existing.state === InventoryDurableOperationState.Aborted) {
    throw new Error("Aborted inventory operation identity cannot be reused.");
  }
}

/** Require every plan component before logical publication. */
function assertInventoryOperationReadyToComplete(
  stored: StoredInventoryOperation
): void {
  const operation = stored.value;
  if (!operation.eventWritten) {
    throw new Error("Inventory operation event has not been staged.");
  }
  if (!operation.projectionWritten) {
    throw new Error("Inventory operation projection has not been staged.");
  }
  if (!operation.reservationsWritten) {
    throw new Error("Inventory operation reservations have not been staged.");
  }
  if (!operation.countsWritten) {
    throw new Error("Inventory operation counts have not been staged.");
  }
  if (!operation.receiptWritten) {
    throw new Error("Inventory operation receipt has not been staged.");
  }
}

/** Sort applying operations deterministically for bounded repair workers. */
function compareDurableOperationId(
  left: InventoryDurableOperation,
  right: InventoryDurableOperation
): number {
  return compareInventoryIdentityText(left.operationId, right.operationId);
}

/** Sort applying migration manifests deterministically for bounded repair workers. */
function compareMigrationManifestId(
  left: InventoryMigrationManifest,
  right: InventoryMigrationManifest
): number {
  return compareInventoryIdentityText(left.migrationId, right.migrationId);
}

/** Reject unsafe bounded list/query values. */
function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Inventory ${label} must be a positive safe integer.`);
  }
}
