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
} from "./integrity.js";
import {
  assertCanonicalInventoryTime,
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
  type InventoryReservationBookResult,
} from "./reservations.js";
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
  /** Return one canonical UTC timestamp for durable recording. */
  now(): string;
}

/** Inputs passed to one pure operation planner before anything is frozen. */
export interface InventoryOperationPlanningContext {
  /** Current fully published world snapshot. */
  readonly world: InventoryWorldState;
  /** Durable record time chosen for this planning attempt. */
  readonly recordedAt: string;
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

  const initialWorld = await storage.readWorld();
  assertInventoryCatalogRetainsSnapshot(catalog, initialWorld.catalog);
  const existing = await storage.readOperation(operationId);
  if (existing !== undefined) {
    assertSameIntent(existing, intentFingerprint);
    const receipt = await resumeInventoryDurableOperation(storage, operationId);
    return {
      receipt,
      world: await storage.readWorld(),
      ...(existing.event === undefined ? {} : { event: existing.event }),
      replayed: true,
    };
  }

  for (let attempt = 0; attempt < maxRevisionRetries; attempt += 1) {
    const world = await storage.readWorld();
    assertInventoryCatalogRetainsSnapshot(catalog, world.catalog);
    const recordedAt = clock.now();
    assertCanonicalInventoryTime(recordedAt, "inventory durable record time");
    const logicalPlan = await plan({ world, recordedAt });
    const durablePlan = createDurableOperationPlan({
      catalog,
      world,
      recordedAt,
      operationId,
      deficitPolicy,
      logicalPlan,
    });
    try {
      const beginResult = await storage.begin({
        operationId,
        intentFingerprint,
        baseRevision: world.revision,
        recordedAt,
        plan: durablePlan,
      });
      const begun = beginResult.operation;
      assertSameIntent(begun, intentFingerprint);
      const receipt = await resumeInventoryDurableOperation(
        storage,
        operationId
      );
      return {
        receipt,
        world: await storage.readWorld(),
        ...(begun.event === undefined ? {} : { event: begun.event }),
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

/** Inputs for converting one logical plan into a complete semantically checked durable plan. */
interface CreateDurableOperationPlanInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Published base world. */
  readonly world: InventoryWorldState;
  /** Frozen durable record time. */
  readonly recordedAt: string;
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
  recordedAt,
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
          recordedAt,
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
  if (
    (logicalPlan.reservationProtection ??
      InventoryReservationProtection.ProtectClaims) ===
    InventoryReservationProtection.ProtectClaims
  ) {
    // Ordinary commands protect the claim book that exists when durable truth is recorded.
    // Backdating occurredAt must not bypass a reservation created before this commit.
    assertInventoryReservationsFeasible({
      catalog,
      projection,
      book: reservations,
      at: recordedAt,
    });
  }
  const receipt: InventoryOperationReceipt = {
    operationId,
    recordedAt,
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
    planDigest: inventoryDurablePlanDigest({
      baseWorldRoot,
      catalogRoot: catalog.digest,
      deficitPolicy,
      ...(committedEvent === undefined ? {} : { event: committedEvent }),
      ...(reservationDelta === undefined ? {} : { reservationDelta }),
      ...(countDelta === undefined ? {} : { countDelta }),
      receipt,
      nextRoots,
    }),
  };
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
