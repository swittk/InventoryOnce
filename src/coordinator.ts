import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
} from "./canonical.js";
import {
  assertInventoryCatalogRetainsSnapshot,
  inventoryCatalogSnapshot,
  type InventoryCatalog,
} from "./catalog.js";
import type { InventoryCountBookResult } from "./counts.js";
import {
  createInventoryCountBookDelta,
  createInventoryReservationBookDelta,
  inventoryDurablePlanDigest,
  inventoryWorldContentRoots,
  type InventoryReservationBookDelta,
} from "./integrity.js";
import {
  assertInventoryEpochMilliseconds,
  commitInventoryEvent,
  InventoryEventKind,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
} from "./events.js";
import {
  InventoryDeficitPolicy,
  applyInventoryCommittedEvent,
} from "./projection.js";
import {
  assertInventoryReservationsFeasible,
  inspectInventoryReservationFeasibility,
  InventoryReservationFeasibilityStatus,
  InventoryReservationOperationKind,
  InventoryReservationStatus,
  type InventoryReservation,
  type InventoryReservationBook,
  type InventoryReservationFeasibilityGroup,
  type InventoryReservationBookResult,
} from "./reservations.js";
import { inventoryMeasurementAt } from "./measurements.js";
import { inventoryStockPositionIdentity } from "./model.js";
import { compareQuantity, negateQuantity, quantityEq } from "./quantity.js";
import { inventoryStockSelectorIdentity } from "./selectors.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import {
  InventoryApplyingOperationConflictError,
  InventoryDurableOperationState,
  InventoryWorldRevisionConflictError,
  type InventoryDurableOperation,
  type InventoryDurableOperationPlan,
  type InventoryDurableStorage,
  type InventoryOperationReceipt,
} from "./storage.js";
import type { InventoryWorldState } from "./world.js";

/** Clock used only for durable record time; real event time comes from command input. */
export interface InventoryClock {
  /** Return one safe-integer epoch millisecond instant for durable recording. */
  nowEpochMs(): number;
}

/** Inputs passed to one pure operation planner before anything is frozen. */
export interface InventoryOperationPlanningContext {
  /** Current fully published world snapshot. */
  readonly world: InventoryWorldState;
  /** Durable record time chosen for this planning attempt. */
  readonly recordedAtEpochMs: number;
}

/** How one operation treats active claims after physical stock changes. */
export enum InventoryReservationProtection {
  /** Reject unless every active claim remains simultaneously fulfillable. */
  ProtectClaims = "protect-claims",
  /** Record explicit physical truth even when outstanding claims become short. */
  RecordPhysicalTruth = "record-physical-truth",
}

/** Pure next-world plan produced from one published revision. */
export interface InventoryOperationPlan {
  /** Optional immutable event draft changing stock/traceability truth. */
  readonly event?: InventoryEventDraft;
  /** Result returned by one reservation state-machine action. */
  readonly reservationResult?: InventoryReservationBookResult;
  /** Result returned by one count state-machine action. */
  readonly countResult?: InventoryCountBookResult;
  /** Reservation identity changed by this operation. */
  readonly reservationId?: string;
  /** Count identity changed by this operation. */
  readonly countId?: string;
  /** Default protects claims; counts/corrections/scrap may record shortage truth. */
  readonly reservationProtection?: InventoryReservationProtection;
}

/** Result returned by one committed or exactly replayed operation. */
export interface CommitInventoryOperationResult {
  /** Frozen replay receipt. */
  readonly receipt: InventoryOperationReceipt;
  /**
   * Latest published world observed after this operation completed.
   * Use `receipt.worldRevision` for this operation's exact published revision.
   */
  readonly world: InventoryWorldState;
  /** Committed event when the operation has one. */
  readonly event?: InventoryCommittedEvent;
  /** True when this operation identity already existed before this call completed. */
  readonly replayed: boolean;
}

/** Inputs for planning/freezing/publishing one inventory operation. */
export interface CommitInventoryOperationInput {
  /** Frozen catalogue used by event/claim validation. */
  readonly catalog: InventoryCatalog;
  /** Durable adapter. */
  readonly storage: InventoryDurableStorage;
  /** Stable operation/idempotency identity. */
  readonly operationId: string;
  /** Stable command-intent fingerprint. */
  readonly intentFingerprint: string;
  /** Durable record-time clock. */
  readonly clock: InventoryClock;
  /** Whether explicit negative physical stock is permitted. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Pure planner converting the current world into one complete logical operation. */
  readonly plan: (
    context: InventoryOperationPlanningContext
  ) => InventoryOperationPlan | Promise<InventoryOperationPlan>;
  /** Bounded retries for races with another completed world revision. */
  readonly maxRevisionRetries?: number;
}

/**
 * Plan against one published snapshot, freeze the complete next world, then publish/repair it.
 * A crash after begin no longer needs the original planner because the durable plan is complete.
 */
export async function commitInventoryOperation({
  catalog,
  storage,
  operationId,
  intentFingerprint,
  clock,
  deficitPolicy,
  plan,
  maxRevisionRetries = 8,
}: CommitInventoryOperationInput): Promise<CommitInventoryOperationResult> {
  assertOperationIdentity(operationId, intentFingerprint);
  assertPositiveSafeInteger(maxRevisionRetries, "maxRevisionRetries");

  const existing = await storage.readOperation(operationId);
  if (existing !== undefined) {
    assertSameIntent(existing, intentFingerprint);
    const receipt = await resumeInventoryDurableOperation(storage, operationId);
    const completedWorld = await storage.readWorld();
    const event = completedInventoryOperationEvent(receipt, completedWorld);
    return {
      receipt,
      world: completedWorld,
      ...(event === undefined ? {} : { event }),
      replayed: true,
    };
  }

  const initialWorld = await storage.readWorld();
  assertInventoryCatalogRetainsSnapshot(catalog, initialWorld.catalog);
  for (let attempt = 0; attempt < maxRevisionRetries; attempt += 1) {
    const world = await storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(catalog, world.catalog);
    const recordedAtEpochMs = clock.nowEpochMs();
    assertInventoryEpochMilliseconds(recordedAtEpochMs, "inventory durable record time");
    const logicalPlan = await plan({ world, recordedAtEpochMs });
    const durablePlan = createDurableOperationPlan({
      catalog,
      world,
      recordedAtEpochMs,
      operationId,
      deficitPolicy,
      logicalPlan,
    });
    try {
      const beginResult = await storage.begin({
        operationId,
        intentFingerprint,
        baseRevision: world.revision,
        recordedAtEpochMs,
        plan: durablePlan,
      });
      const begun = beginResult.operation;
      assertSameIntent(begun, intentFingerprint);
      const receipt = await resumeInventoryDurableOperation(
        storage,
        operationId
      );
      const completedWorld = await storage.readWorld();
      const event = completedInventoryOperationEvent(receipt, completedWorld);
      return {
        receipt,
        world: completedWorld,
        ...(event === undefined ? {} : { event }),
        replayed: !beginResult.created,
      };
    } catch (error) {
      if (error instanceof InventoryWorldRevisionConflictError) continue;
      if (error instanceof InventoryApplyingOperationConflictError) {
        await resumeInventoryDurableOperation(
          storage,
          error.applyingOperationId
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `Inventory operation '${operationId}' could not freeze a current world revision after ${maxRevisionRetries} attempts.`
  );
}

/** Resolve the committed event named by a completed receipt from the freshly published world. */
function completedInventoryOperationEvent(
  receipt: InventoryOperationReceipt,
  world: InventoryWorldState
): InventoryCommittedEvent | undefined {
  if (receipt.eventId === undefined) return undefined;
  const event = inventorySparseRecordValue(
    world.projection.events,
    receipt.eventId
  );
  if (event === undefined) {
    throw new Error(
      `Completed inventory operation receipt references missing event '${receipt.eventId}'.`
    );
  }
  return event;
}

/** Inputs for converting one logical plan into a complete semantically checked durable plan. */
interface CreateDurableOperationPlanInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Published base world. */
  readonly world: InventoryWorldState;
  /** Frozen durable record time. */
  readonly recordedAtEpochMs: number;
  /** Stable operation identity. */
  readonly operationId: string;
  /** Negative physical stock rule. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Pure logical plan. */
  readonly logicalPlan: InventoryOperationPlan;
}

/** Build one compact checked next-world manifest before the durable begin boundary. */
function createDurableOperationPlan({
  catalog,
  world,
  recordedAtEpochMs,
  operationId,
  deficitPolicy,
  logicalPlan,
}: CreateDurableOperationPlanInput): InventoryDurableOperationPlan {
  // Once a catalogue exists in durable truth, normal commands cannot smuggle newer definitions
  // into the next world. Publish that complete retained catalogue as its own event first.
  if (
    world.revision > 0 &&
    world.catalog.digest !== catalog.digest &&
    logicalPlan.event?.kind !== InventoryEventKind.CatalogPublication
  ) {
    throw new Error(
      "Inventory command uses unpublished catalogue revisions; publish the retained inventory catalogue first."
    );
  }
  if (
    logicalPlan.event?.kind === InventoryEventKind.CatalogPublication &&
    logicalPlan.event.catalogDigest !== catalog.digest
  ) {
    throw new Error(
      "Inventory catalogue-publication event must publish the complete catalogue used by this operation."
    );
  }
  const firstCommittedEvent =
    logicalPlan.event === undefined
      ? undefined
      : commitInventoryEvent(
          logicalPlan.event,
          recordedAtEpochMs,
          world.projection.lastRecordSequence + 1
        );
  const appliedEvent =
    firstCommittedEvent === undefined
      ? undefined
      : applyInventoryCommittedEvent({
          catalog,
          state: world.projection,
          event: firstCommittedEvent,
          deficitPolicy,
        });
  const committedEvent = appliedEvent?.event;
  const projection = appliedEvent?.state ?? world.projection;
  const reservations =
    logicalPlan.reservationResult?.book ?? world.reservations;
  const counts = logicalPlan.countResult?.book ?? world.counts;
  const reservationDelta = createInventoryReservationBookDelta(
    world.reservations,
    reservations,
    operationId,
    logicalPlan.reservationId
  );
  const countDelta = createInventoryCountBookDelta(
    world.counts,
    counts,
    operationId,
    logicalPlan.countId
  );
  // A validated release or expiry only removes one active claim. With no event,
  // it cannot reduce the stock available to any reservation that remains active.
  const closesReservationWithoutPhysicalEvent =
    committedEvent === undefined &&
    reservationDelta !== undefined &&
    ((reservationDelta.operation.kind ===
      InventoryReservationOperationKind.Release &&
      reservationDelta.reservation.status ===
        InventoryReservationStatus.Released) ||
      (reservationDelta.operation.kind ===
        InventoryReservationOperationKind.Expire &&
        reservationDelta.reservation.status ===
          InventoryReservationStatus.Expired));
  let consumptionDoesNotIncreaseShortage = false;
  if (
    reservationDelta?.operation.kind ===
    InventoryReservationOperationKind.Consume
  ) {
    assertReservationConsumptionMatchesIssue({
      catalog,
      baseBook: world.reservations,
      reservationDelta,
      committedEvent,
      operationId,
    });
    consumptionDoesNotIncreaseShortage =
      countDelta === undefined &&
      inventoryReservationConsumptionDoesNotIncreaseShortage({
        catalog,
        baseWorld: world,
        projection,
        reservations,
        recordedAtEpochMs,
        consumedReservationId: reservationDelta.reservation.reservationId,
      });
  }
  if (
    (logicalPlan.reservationProtection ??
      InventoryReservationProtection.ProtectClaims) ===
      InventoryReservationProtection.ProtectClaims &&
    !closesReservationWithoutPhysicalEvent &&
    !consumptionDoesNotIncreaseShortage
  ) {
    // Ordinary commands protect the claim book that exists when durable truth is recorded.
    // Backdating occurredAtEpochMs must not bypass a reservation created before this commit.
    assertInventoryReservationsFeasible({
      catalog,
      projection,
      book: reservations,
      atEpochMs: recordedAtEpochMs,
    });
  }
  const receipt: InventoryOperationReceipt = {
    operationId,
    recordedAtEpochMs,
    worldRevision: world.revision + 1,
    ...(committedEvent === undefined
      ? {}
      : { eventId: committedEvent.eventId }),
    ...(logicalPlan.reservationId === undefined
      ? {}
      : { reservationId: logicalPlan.reservationId }),
    ...(logicalPlan.countId === undefined
      ? {}
      : { countId: logicalPlan.countId }),
  };
  const catalogSnapshot = inventoryCatalogSnapshot(catalog);
  const nextWorld: InventoryWorldState = {
    revision: world.revision + 1,
    catalog: catalogSnapshot,
    projection,
    reservations,
    counts,
  };
  const baseWorldRoot = inventoryWorldContentRoots(world).world;
  const nextRoots = inventoryWorldContentRoots(nextWorld);
  const planWithoutDigest: Omit<InventoryDurableOperationPlan, "planDigest"> = {
    format: "inventoryonce-compact-plan-v1",
    baseWorldRoot,
    catalog: catalogSnapshot,
    catalogRoot: catalog.digest,
    deficitPolicy,
    ...(committedEvent === undefined ? {} : { event: committedEvent }),
    ...(reservationDelta === undefined ? {} : { reservationDelta }),
    ...(countDelta === undefined ? {} : { countDelta }),
    receipt,
    nextRoots,
  };
  return {
    ...planWithoutDigest,
    planDigest: inventoryDurablePlanDigest(planWithoutDigest),
  };
}

/** Inputs for checking that one Consume delta is exactly the Issue fact it claims. */
interface AssertReservationConsumptionMatchesIssueInput {
  /** Frozen catalogue used to resolve the reservation measurement axis. */
  readonly catalog: InventoryCatalog;
  /** Published reservation book before the Consume transition. */
  readonly baseBook: InventoryReservationBook;
  /** Validated one-row Consume transition produced by the planner. */
  readonly reservationDelta: InventoryReservationBookDelta;
  /** Committed physical event paired with the Consume transition. */
  readonly committedEvent: InventoryCommittedEvent | undefined;
  /** Stable outer durable operation identity. */
  readonly operationId: string;
}

/** Stable field-complete fingerprint for one normalized reservation lifecycle snapshot. */
function reservationLifecycleEvidenceFingerprint(
  reservation: InventoryReservation
): string {
  return inventoryIntentFingerprint([
    reservation.reservationId,
    reservation.operationId,
    reservation.itemRevisionId,
    inventoryStockSelectorIdentity(reservation.selector),
    inventoryIntentFingerprint([
      reservation.requested.amountMinor,
      reservation.requested.decimals,
      reservation.requested.unit,
    ]),
    reservation.createdAtEpochMs,
    reservation.expiresAtEpochMs ?? null,
    reservation.allowExpiredStock ?? false,
    reservation.sourceReference ?? null,
    reservation.actorId ?? null,
    inventoryMetadataFingerprint(reservation.metadata),
    reservation.status,
    reservation.allocations.map(
      /** Fingerprint one exact retained allocation without changing allocation order. */
      (allocation) => inventoryIntentFingerprint([
        inventoryStockPositionIdentity(allocation.position),
        inventoryIntentFingerprint([
          allocation.quantity.amountMinor,
          allocation.quantity.decimals,
          allocation.quantity.unit,
        ]),
      ])
    ),
    reservation.statusAtEpochMs ?? null,
    reservation.lastChangedAtEpochMs,
    reservation.consumptionEventId ?? null,
  ]);
}

/** Reject a Consume transition unless one exact Issue removes every frozen allocation. */
function assertReservationConsumptionMatchesIssue({
  catalog,
  baseBook,
  reservationDelta,
  committedEvent,
  operationId,
}: AssertReservationConsumptionMatchesIssueInput): void {
  const consumed = reservationDelta.reservation;
  const baseReservation = inventorySparseRecordValue(
    baseBook.reservations,
    consumed.reservationId
  );
  if (
    baseReservation === undefined ||
    baseReservation.allocations.length === 0 ||
    reservationLifecycleEvidenceFingerprint(
      reservationDelta.operation.reservationAfter
    ) !== reservationLifecycleEvidenceFingerprint(consumed)
  ) {
    throw new Error(
      "Reservation consumption must issue one previously allocated claim with exact lifecycle evidence."
    );
  }
  if (
    committedEvent === undefined ||
    committedEvent.kind !== InventoryEventKind.Issue ||
    committedEvent.operationId !== operationId ||
    committedEvent.eventId !== consumed.consumptionEventId ||
    committedEvent.occurredAtEpochMs !== consumed.statusAtEpochMs ||
    committedEvent.metadata?.reservationId !== consumed.reservationId
  ) {
    throw new Error(
      "Reservation consumption must name its exact same-operation Issue event."
    );
  }
  if (
    committedEvent.traceabilityChanges.length !== 0 ||
    (committedEvent.positiveLayerProvenanceTransfers?.length ?? 0) !== 0 ||
    (committedEvent.positiveLayerProvenanceOverrides?.length ?? 0) !== 0 ||
    (committedEvent.lotDefinitions?.length ?? 0) !== 0 ||
    (committedEvent.placementNodeDefinitions?.length ?? 0) !== 0 ||
    (committedEvent.placementChanges?.length ?? 0) !== 0 ||
    committedEvent.transferLifecycle !== undefined ||
    committedEvent.catalogDigest !== undefined ||
    committedEvent.catalogSnapshot !== undefined ||
    committedEvent.correction !== undefined
  ) {
    throw new Error(
      "Reservation consumption Issue cannot carry unrelated inventory changes."
    );
  }
  if (committedEvent.stockEffects.length !== baseReservation.allocations.length) {
    throw new Error(
      "Reservation consumption Issue must have exactly one stock effect per allocation."
    );
  }
  const item = catalog.itemRevision(baseReservation.itemRevisionId);
  const axis = catalog.measurementAxis(item, item.reservationAxisId);
  const allocationByPosition = new Map<
    string,
    (typeof baseReservation.allocations)[number]
  >();
  for (const allocation of baseReservation.allocations) {
    allocationByPosition.set(
      inventoryStockPositionIdentity(allocation.position),
      allocation
    );
  }
  for (const effect of committedEvent.stockEffects) {
    const positionIdentity = inventoryStockPositionIdentity(effect.position);
    const allocation = allocationByPosition.get(positionIdentity);
    if (
      allocation === undefined ||
      effect.itemRevisionId !== baseReservation.itemRevisionId ||
      effect.metadata?.reservationId !== consumed.reservationId
    ) {
      throw new Error(
        "Reservation consumption Issue stock effects must name only exact allocated positions."
      );
    }
    const issued = inventoryMeasurementAt(
      effect.measurementsDelta,
      axis.axisId,
      axis.unit
    );
    if (!quantityEq(issued, negateQuantity(allocation.quantity))) {
      throw new Error(
        "Reservation consumption Issue must remove each exact allocated quantity."
      );
    }
    allocationByPosition.delete(positionIdentity);
  }
  if (allocationByPosition.size !== 0) {
    throw new Error(
      "Reservation consumption Issue did not remove every exact allocation."
    );
  }
}

/** Inputs for proving a Consume transition does not worsen any surviving claim group. */
interface InventoryReservationConsumptionShortageInput {
  /** Frozen catalogue used by both exact feasibility calculations. */
  readonly catalog: InventoryCatalog;
  /** Published world before the atomic Issue and Consume transition. */
  readonly baseWorld: InventoryWorldState;
  /** Projection after applying the paired Issue event. */
  readonly projection: InventoryWorldState["projection"];
  /** Reservation book after closing the consumed reservation. */
  readonly reservations: InventoryReservationBook;
  /** Same durable time used to interpret both reservation books. */
  readonly recordedAtEpochMs: number;
  /** Only reservation identity removed from active competition. */
  readonly consumedReservationId: string;
}

/** Return true only when every surviving exact claim group keeps or reduces its shortage. */
function inventoryReservationConsumptionDoesNotIncreaseShortage({
  catalog,
  baseWorld,
  projection,
  reservations,
  recordedAtEpochMs,
  consumedReservationId,
}: InventoryReservationConsumptionShortageInput): boolean {
  // Most consumes leave every group feasible; calculate the prior max-flow only
  // when an existing shortage actually needs the non-worsening exception.
  const after = inspectInventoryReservationFeasibility({
    catalog,
    projection,
    book: reservations,
    atEpochMs: recordedAtEpochMs,
  });
  if (after.status === InventoryReservationFeasibilityStatus.Feasible) return true;
  const before = inspectInventoryReservationFeasibility({
    catalog,
    projection: baseWorld.projection,
    book: baseWorld.reservations,
    atEpochMs: recordedAtEpochMs,
  });
  // Revision-scoped groups may share item/axis/unit. A surviving reservation
  // identity locates its one prior group without a quadratic cross-group scan.
  const beforeByReservationId = new Map<
    string,
    InventoryReservationFeasibilityGroup
  >();
  for (const group of before.groups) {
    for (const reservationId of group.reservationIds) {
      beforeByReservationId.set(reservationId, group);
    }
  }
  for (const afterGroup of after.groups) {
    if (afterGroup.shortage.amountMinor === 0) continue;
    const survivor = afterGroup.reservationIds[0];
    const beforeGroup = survivor === undefined
      ? undefined
      : beforeByReservationId.get(survivor);
    if (
      beforeGroup === undefined ||
      !reservationFeasibilityGroupsMatchAfterConsumption(
        beforeGroup,
        afterGroup,
        consumedReservationId
      ) ||
      compareQuantity(afterGroup.shortage, beforeGroup.shortage) > 0
    ) {
      return false;
    }
  }
  return true;
}

/** Match one surviving group to its unique pre-Consume membership and measurement identity. */
function reservationFeasibilityGroupsMatchAfterConsumption(
  before: InventoryReservationFeasibilityGroup,
  after: InventoryReservationFeasibilityGroup,
  consumedReservationId: string
): boolean {
  if (
    before.itemId !== after.itemId ||
    before.axisId !== after.axisId ||
    before.shortage.unit !== after.shortage.unit
  ) {
    return false;
  }
  // Feasibility reports sort membership by reservation identity. Removing the
  // consumed identity must leave the exact same order, with no extra members.
  let survivorIndex = 0;
  for (const reservationId of before.reservationIds) {
    if (reservationId === consumedReservationId) continue;
    if (after.reservationIds[survivorIndex] !== reservationId) return false;
    survivorIndex += 1;
  }
  return survivorIndex === after.reservationIds.length;
}

/**
 * Finish one frozen plan without the original command/planner.
 * Every method is idempotent, so before/after failpoint retries converge exactly once.
 */
export async function resumeInventoryDurableOperation(
  storage: InventoryDurableStorage,
  operationId: string
): Promise<InventoryOperationReceipt> {
  const operation = await requireDurableOperation(storage, operationId);
  if (operation.state === InventoryDurableOperationState.Completed) {
    return operation.receipt;
  }
  if (operation.state === InventoryDurableOperationState.Aborted) {
    throw new Error("Aborted inventory operation cannot be resumed.");
  }
  if (operation.plan === undefined) {
    throw new Error("Applying inventory operation has no frozen repair plan.");
  }
  if (operation.plan.event !== undefined) {
    await storage.writeEvent(operationId);
    await storage.writeProjection(operationId);
  }
  await storage.writeReservations(operationId);
  await storage.writeCounts(operationId);
  await storage.writeReceipt(operationId);
  return storage.complete(operationId);
}

/** Inputs for one bounded generic repair pass. */
export interface RepairInventoryDurableOperationsInput {
  /** Durable adapter containing applying plans. */
  readonly storage: InventoryDurableStorage;
  /** Maximum applying operations to finish in this pass. */
  readonly limit?: number;
}

/** Finish every listed applying plan without any application-specific planner registry. */
export async function repairInventoryDurableOperations({
  storage,
  limit = 100,
}: RepairInventoryDurableOperationsInput): Promise<
  readonly InventoryOperationReceipt[]
> {
  assertPositiveSafeInteger(limit, "repair limit");
  const applying = await storage.listApplyingOperations({ limit });
  const receipts: InventoryOperationReceipt[] = [];
  for (const operation of applying) {
    receipts.push(
      await resumeInventoryDurableOperation(storage, operation.operationId)
    );
  }
  return receipts;
}

/** Load one durable row or fail because generic repair cannot invent a plan. */
async function requireDurableOperation(
  storage: InventoryDurableStorage,
  operationId: string
): Promise<InventoryDurableOperation> {
  const operation = await storage.readOperation(operationId);
  if (operation === undefined) {
    throw new Error(`Unknown inventory durable operation '${operationId}'.`);
  }
  return operation;
}

/** Reject empty operation/fingerprint identities before planning. */
function assertOperationIdentity(
  operationId: string,
  intentFingerprint: string
): void {
  if (operationId.trim().length === 0) {
    throw new Error("Inventory operationId must not be empty.");
  }
  if (intentFingerprint.trim().length === 0) {
    throw new Error(
      "Inventory operation intent fingerprint must not be empty."
    );
  }
}

/** Reject changed command intent under an existing operation identity. */
function assertSameIntent(
  operation: InventoryDurableOperation,
  intentFingerprint: string
): void {
  if (operation.intentFingerprint !== intentFingerprint) {
    throw new Error("Inventory operationId was retried with changed intent.");
  }
  if (operation.state === InventoryDurableOperationState.Aborted) {
    throw new Error("Aborted inventory operation identity cannot be reused.");
  }
}

/** Reject unsafe bounded retry/repair values. */
function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Inventory ${label} must be a positive safe integer.`);
  }
}
