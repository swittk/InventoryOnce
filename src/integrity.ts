import {
  inventoryCatalogFromSnapshot,
  type InventoryCatalogSnapshot,
} from "./catalog.js";
import {
  InventoryCountOperationKind,
  InventoryCountStatus,
  type InventoryCount,
  type InventoryCountBook,
  type InventoryCountOperation,
} from "./counts.js";
import { inventorySha256 } from "./digest.js";
import type { InventoryCommittedEvent } from "./events.js";
import type {
  InventoryDeficitPolicy,
  InventoryProjectionState,
} from "./projection.js";
import {
  InventoryReservationOperationKind,
  InventoryReservationStatus,
  type InventoryReservation,
  type InventoryReservationBook,
  type InventoryReservationOperation,
} from "./reservations.js";
import { inventoryStockSelectorIsSubset } from "./selectors.js";
import type { InventoryWorldState } from "./world.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** One append-only reservation row/operation change frozen in a compact durable plan. */
export interface InventoryReservationBookDelta {
  /** Current reservation row after the one allowed lifecycle action. */
  readonly reservation: InventoryReservation;
  /** New immutable lifecycle operation appended by this command. */
  readonly operation: InventoryReservationOperation;
}

/** One append-only count row/operation change frozen in a compact durable plan. */
export interface InventoryCountBookDelta {
  /** Current count row after the one allowed lifecycle action. */
  readonly count: InventoryCount;
  /** New immutable lifecycle operation appended by this command. */
  readonly operation: InventoryCountOperation;
}

/** Small content roots proving exactly which base components one plan advances. */
export interface InventoryWorldContentRoots {
  /** Full published world root, including its revision and component roots. */
  readonly world: string;
  /** Durable catalogue-definition root. */
  readonly catalog: string;
  /** Committed event/current-stock/traceability projection root. */
  readonly projection: string;
  /** Current reservation rows plus append-only lifecycle evidence root. */
  readonly reservations: string;
  /** Current count rows plus append-only lifecycle evidence root. */
  readonly counts: string;
}

/** Calculate deterministic SHA-256 roots for one published world snapshot. */
export function inventoryWorldContentRoots(
  world: InventoryWorldState
): InventoryWorldContentRoots {
  const catalog = inventoryCatalogSnapshotDigest(world.catalog);
  const projection = inventoryProjectionDigest(world.projection);
  const reservations = inventoryReservationBookDigest(world.reservations);
  const counts = inventoryCountBookDigest(world.counts);
  return {
    catalog,
    projection,
    reservations,
    counts,
    world: inventorySha256(
      canonicalNormalizedJson([
        world.revision,
        catalog,
        projection,
        reservations,
        counts,
      ])
    ),
  };
}

/** Verify and hash one persisted catalogue snapshot without trusting its digest field. */
export function inventoryCatalogSnapshotDigest(
  snapshot: InventoryCatalogSnapshot
): string {
  return inventoryCatalogFromSnapshot(snapshot).digest;
}

/** Hash one event/current-stock/traceability projection in key-sorted row order. */
export function inventoryProjectionDigest(
  projection: InventoryProjectionState
): string {
  const digestParts: unknown[] = [
    projection.lastRecordSequence,
    sortedRecordRows(projection.positions),
    sortedRecordRows(projection.positionIdsByItemId),
    sortedRecordRows(projection.positionIdsByItemRevisionId),
    sortedRecordRows(projection.positionIdsByContainerIdentity),
    sortedRecordRows(projection.positiveLayerStartedAtByPositionId),
    sortedRecordRows(projection.positivePositionIdBySerialIdentity),
    sortedRecordRows(projection.containers),
    sortedRecordRows(projection.containerRootEventIdByIdentity),
    sortedRecordRows(projection.lots),
    sortedRecordRows(projection.lotIdentitiesByItemId),
    sortedRecordRows(projection.lotRootEventIdByIdentity),
    sortedRecordRows(projection.transfers),
    sortedRecordRows(projection.events),
    sortedRecordRows(projection.eventIdsBySequence),
    sortedRecordRows(projection.eventIdByOperationId),
    sortedRecordRows(projection.correctionEventIdByCorrectedEventId),
    sortedRecordRows(projection.traceability.relations),
    sortedRecordRows(
      projection.traceability.containmentChildContainerIdsByParentNodeIdentity
    ),
  ];
  return inventorySha256(canonicalNormalizedJson(digestParts));
}

/** Hash the complete reservation book in stable identity order. */
export function inventoryReservationBookDigest(
  book: InventoryReservationBook
): string {
  return inventorySha256(
    canonicalNormalizedJson([
      sortedRecordRows(book.reservations),
      sortedRecordRows(book.operations),
    ])
  );
}

/** Hash the complete count book in stable identity order. */
export function inventoryCountBookDigest(book: InventoryCountBook): string {
  return inventorySha256(
    canonicalNormalizedJson([
      sortedRecordRows(book.counts),
      sortedRecordRows(book.operations),
    ])
  );
}

/** Extract and validate the one legal append-only reservation change in a planner result. */
export function createInventoryReservationBookDelta(
  base: InventoryReservationBook,
  next: InventoryReservationBook,
  operationId: string,
  reservationId: string | undefined
): InventoryReservationBookDelta | undefined {
  retainEveryReservationOperation(base, next);
  const addedOperationIds = addedRecordKeys(base.operations, next.operations);
  if (addedOperationIds.length === 0) {
    if (!sameJson(base, next) || reservationId !== undefined) {
      throw new Error(
        "Inventory reservation planner changed rows without one new lifecycle operation."
      );
    }
    return undefined;
  }
  if (addedOperationIds.length !== 1 || addedOperationIds[0] !== operationId) {
    throw new Error(
      "Inventory reservation planner must append exactly its own lifecycle operation."
    );
  }
  const operation = inventorySparseRecordValue(next.operations, operationId);
  if (operation === undefined || operation.reservationId !== reservationId) {
    throw new Error(
      "Inventory reservation receipt must name the row changed by its lifecycle operation."
    );
  }
  const reservation = inventorySparseRecordValue(next.reservations, operation.reservationId);
  if (reservation === undefined) {
    throw new Error(
      "Inventory reservation lifecycle operation references a missing row."
    );
  }
  retainUnchangedReservationRows(base, next, operation.reservationId);
  assertAllowedReservationTransition(
    inventorySparseRecordValue(base.reservations, operation.reservationId),
    reservation,
    operation
  );
  return { reservation, operation };
}

/** Apply one already-validated reservation delta and recheck it against this exact base book. */
export function applyInventoryReservationBookDelta(
  base: InventoryReservationBook,
  delta: InventoryReservationBookDelta | undefined
): InventoryReservationBook {
  if (delta === undefined) return base;
  const next: InventoryReservationBook = {
    reservations: {
      ...base.reservations,
      [delta.reservation.reservationId]: delta.reservation,
    },
    operations: {
      ...base.operations,
      [delta.operation.operationId]: delta.operation,
    },
  };
  createInventoryReservationBookDelta(
    base,
    next,
    delta.operation.operationId,
    delta.reservation.reservationId
  );
  return next;
}

/** Extract and validate the one legal append-only count change in a planner result. */
export function createInventoryCountBookDelta(
  base: InventoryCountBook,
  next: InventoryCountBook,
  operationId: string,
  countId: string | undefined
): InventoryCountBookDelta | undefined {
  retainEveryCountOperation(base, next);
  const addedOperationIds = addedRecordKeys(base.operations, next.operations);
  if (addedOperationIds.length === 0) {
    if (!sameJson(base, next) || countId !== undefined) {
      throw new Error(
        "Inventory count planner changed rows without one new lifecycle operation."
      );
    }
    return undefined;
  }
  if (addedOperationIds.length !== 1 || addedOperationIds[0] !== operationId) {
    throw new Error(
      "Inventory count planner must append exactly its own lifecycle operation."
    );
  }
  const operation = inventorySparseRecordValue(next.operations, operationId);
  if (operation === undefined || operation.countId !== countId) {
    throw new Error(
      "Inventory count receipt must name the row changed by its lifecycle operation."
    );
  }
  const count = inventorySparseRecordValue(next.counts, operation.countId);
  if (count === undefined)
    throw new Error(
      "Inventory count lifecycle operation references a missing row."
    );
  retainUnchangedCountRows(base, next, operation.countId);
  assertAllowedCountTransition(
    inventorySparseRecordValue(base.counts, operation.countId),
    count,
    operation
  );
  return { count, operation };
}

/** Apply one already-validated count delta and recheck it against this exact base book. */
export function applyInventoryCountBookDelta(
  base: InventoryCountBook,
  delta: InventoryCountBookDelta | undefined
): InventoryCountBook {
  if (delta === undefined) return base;
  const next: InventoryCountBook = {
    counts: { ...base.counts, [delta.count.countId]: delta.count },
    operations: {
      ...base.operations,
      [delta.operation.operationId]: delta.operation,
    },
  };
  createInventoryCountBookDelta(
    base,
    next,
    delta.operation.operationId,
    delta.count.countId
  );
  return next;
}

/** Return the exact plan digest covering its base, catalogue, deltas, event, receipt, and next roots. */
export function inventoryDurablePlanDigest(parts: {
  /** Exact base-world content root. */
  readonly baseWorldRoot: string;
  /** Exact retained catalogue root used to validate and replay the plan. */
  readonly catalogRoot: string;
  /** Explicit negative-stock replay policy frozen with the plan. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Optional immutable committed event delta. */
  readonly event?: InventoryCommittedEvent;
  /** Optional single reservation lifecycle delta. */
  readonly reservationDelta?: InventoryReservationBookDelta;
  /** Optional single count lifecycle delta. */
  readonly countDelta?: InventoryCountBookDelta;
  /** Frozen replay receipt. */
  readonly receipt: {
    /** Stable operation identity. */
    readonly operationId: string;
    /** Frozen durable record time. */
    readonly recordedAt: string;
    /** Published world revision after this plan. */
    readonly worldRevision: number;
    /** Optional committed event identity. */
    readonly eventId?: string;
    /** Optional changed reservation identity. */
    readonly reservationId?: string;
    /** Optional changed count identity. */
    readonly countId?: string;
  };
  /** Exact roots expected after applying this compact plan. */
  readonly nextRoots: InventoryWorldContentRoots;
}): string {
  return inventorySha256(
    canonicalNormalizedJson([
      parts.baseWorldRoot,
      parts.catalogRoot,
      parts.deficitPolicy,
      parts.event ?? null,
      parts.reservationDelta ?? null,
      parts.countDelta ?? null,
      parts.receipt,
      parts.nextRoots,
    ])
  );
}

/** Hash one complete migration batch plan without storing a duplicate next-world snapshot. */
export function inventoryDurableMigrationPlanDigest(parts: {
  /** Exact target-world content root used for validation. */
  readonly baseWorldRoot: string;
  /** Exact retained catalogue root used to interpret every event. */
  readonly catalogRoot: string;
  /** Explicit negative-stock policy for legacy physical truth. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Complete committed migration event batch in final durable order. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Canonical non-physical source dispositions retained through completion. */
  // Keep the digest primitive structural rather than coupling integrity to migration types.
  readonly sourceDispositions: readonly unknown[];
  /** Exact roots expected after the one visible migration cut. */
  readonly nextRoots: InventoryWorldContentRoots;
}): string {
  return inventorySha256(
    canonicalNormalizedJson([
      parts.baseWorldRoot,
      parts.catalogRoot,
      parts.deficitPolicy,
      parts.events,
      parts.sourceDispositions,
      parts.nextRoots,
    ])
  );
}

/** Keep all earlier immutable reservation operation evidence byte-for-byte equal. */
function retainEveryReservationOperation(
  base: InventoryReservationBook,
  next: InventoryReservationBook
): void {
  for (const [operationId, operation] of Object.entries(base.operations)) {
    if (!sameJson(operation, inventorySparseRecordValue(next.operations, operationId))) {
      throw new Error(
        "Inventory reservation planner deleted or changed append-only operation evidence."
      );
    }
  }
}

/** Keep every reservation row except the row named by the new operation unchanged. */
function retainUnchangedReservationRows(
  base: InventoryReservationBook,
  next: InventoryReservationBook,
  changedReservationId: string
): void {
  for (const [reservationId, reservation] of Object.entries(
    base.reservations
  )) {
    if (reservationId === changedReservationId) continue;
    if (!sameJson(reservation, inventorySparseRecordValue(next.reservations, reservationId))) {
      throw new Error(
        "Inventory reservation planner changed or deleted an unrelated row."
      );
    }
  }
  for (const reservationId of Object.keys(next.reservations)) {
    if (
      reservationId !== changedReservationId &&
      inventorySparseRecordValue(base.reservations, reservationId) === undefined
    ) {
      throw new Error(
        "Inventory reservation planner added a row not named by its lifecycle operation."
      );
    }
  }
}

/** Check the exact status/field shape allowed by each reservation lifecycle operation. */
function assertAllowedReservationTransition(
  base: InventoryReservation | undefined,
  next: InventoryReservation,
  operation: InventoryReservationOperation
): void {
  if (
    operation.kind !== InventoryReservationOperationKind.Consume &&
    next.consumptionEventId !== undefined
  ) {
    throw new Error(
      "Only reservation consumption may attach a consumption event."
    );
  }
  if (operation.kind === InventoryReservationOperationKind.Create) {
    if (
      base !== undefined ||
      next.status !== InventoryReservationStatus.Active
    ) {
      throw new Error("Reservation create must add one new active row.");
    }
    return;
  }
  if (base === undefined || base.status !== InventoryReservationStatus.Active) {
    throw new Error(
      "Only an existing active reservation can receive another lifecycle operation."
    );
  }
  if (base.consumptionEventId !== undefined) {
    throw new Error(
      "Non-consumed reservation state cannot retain a consumption event."
    );
  }
  if (!sameReservationCreationFacts(base, next)) {
    throw new Error(
      "Reservation lifecycle operation changed frozen creation facts."
    );
  }
  if (operation.kind === InventoryReservationOperationKind.Refine) {
    if (
      next.status !== InventoryReservationStatus.Active ||
      !sameJson(base.allocations, next.allocations) ||
      !inventoryStockSelectorIsSubset(next.selector, base.selector)
    )
      throw new Error(
        "Reservation refine may only narrow its selector and change time."
      );
    return;
  }
  if (operation.kind === InventoryReservationOperationKind.Allocate) {
    if (
      next.status !== InventoryReservationStatus.Active ||
      !sameJson(base.selector, next.selector)
    ) {
      throw new Error(
        "Reservation allocation may only replace exact bindings and change time."
      );
    }
    return;
  }
  if (
    !sameJson(base.selector, next.selector) ||
    !sameJson(base.allocations, next.allocations)
  ) {
    throw new Error(
      "Closing a reservation cannot change its selector or exact bindings."
    );
  }
  const expectedStatus =
    operation.kind === InventoryReservationOperationKind.Release
      ? InventoryReservationStatus.Released
      : operation.kind === InventoryReservationOperationKind.Expire
      ? InventoryReservationStatus.Expired
      : InventoryReservationStatus.Consumed;
  if (next.status !== expectedStatus) {
    throw new Error(
      "Reservation terminal operation and resulting status disagree."
    );
  }
  if (
    operation.kind === InventoryReservationOperationKind.Consume &&
    next.consumptionEventId === undefined
  ) {
    throw new Error("Consumed reservation must attach a consumption event.");
  }
}

/** Compare every reservation creation fact that later lifecycle actions must retain. */
function sameReservationCreationFacts(
  left: InventoryReservation,
  right: InventoryReservation
): boolean {
  return sameJson(
    [
      left.reservationId,
      left.operationId,
      left.itemRevisionId,
      left.requested,
      left.createdAt,
      left.expiresAt ?? null,
      left.allowExpiredStock ?? false,
      left.sourceReference ?? null,
      left.actorId ?? null,
      left.metadata ?? null,
    ],
    [
      right.reservationId,
      right.operationId,
      right.itemRevisionId,
      right.requested,
      right.createdAt,
      right.expiresAt ?? null,
      right.allowExpiredStock ?? false,
      right.sourceReference ?? null,
      right.actorId ?? null,
      right.metadata ?? null,
    ]
  );
}

/** Keep all earlier immutable count operation evidence byte-for-byte equal. */
function retainEveryCountOperation(
  base: InventoryCountBook,
  next: InventoryCountBook
): void {
  for (const [operationId, operation] of Object.entries(base.operations)) {
    if (!sameJson(operation, inventorySparseRecordValue(next.operations, operationId))) {
      throw new Error(
        "Inventory count planner deleted or changed append-only operation evidence."
      );
    }
  }
}

/** Keep every count row except the row named by the new operation unchanged. */
function retainUnchangedCountRows(
  base: InventoryCountBook,
  next: InventoryCountBook,
  changedCountId: string
): void {
  for (const [countId, count] of Object.entries(base.counts)) {
    if (countId === changedCountId) continue;
    if (!sameJson(count, inventorySparseRecordValue(next.counts, countId))) {
      throw new Error(
        "Inventory count planner changed or deleted an unrelated row."
      );
    }
  }
  for (const countId of Object.keys(next.counts)) {
    if (countId !== changedCountId && inventorySparseRecordValue(base.counts, countId) === undefined) {
      throw new Error(
        "Inventory count planner added a row not named by its lifecycle operation."
      );
    }
  }
}

/** Check the exact status order and retained fields allowed by each count lifecycle operation. */
function assertAllowedCountTransition(
  base: InventoryCount | undefined,
  next: InventoryCount,
  operation: InventoryCountOperation
): void {
  if (
    operation.kind !== InventoryCountOperationKind.Complete &&
    next.reconciliationEventId !== undefined
  ) {
    throw new Error("Only count completion may attach a reconciliation event.");
  }
  if (
    base !== undefined &&
    base.status !== InventoryCountStatus.Completed &&
    base.reconciliationEventId !== undefined
  ) {
    throw new Error("Non-completed count state cannot retain a reconciliation event.");
  }
  if (operation.kind === InventoryCountOperationKind.Start) {
    if (base !== undefined || next.status !== InventoryCountStatus.Started) {
      throw new Error("Count start must add one new started row.");
    }
    return;
  }
  if (base === undefined || !sameCountStartFacts(base, next)) {
    throw new Error("Count lifecycle operation changed frozen start facts.");
  }
  if (operation.kind === InventoryCountOperationKind.Observe) {
    if (
      base.status !== InventoryCountStatus.Started ||
      next.status !== InventoryCountStatus.Observed
    ) {
      throw new Error(
        "Count observation must move one started row to observed."
      );
    }
    return;
  }
  if (operation.kind === InventoryCountOperationKind.Complete) {
    if (
      base.status !== InventoryCountStatus.Observed ||
      next.status !== InventoryCountStatus.Completed
    ) {
      throw new Error(
        "Count completion must move one observed row to completed."
      );
    }
    if (
      !sameJson(base.observations, next.observations) ||
      base.observedAt !== next.observedAt ||
      base.observedThroughRecordSequence !== next.observedThroughRecordSequence
    ) {
      throw new Error(
        "Count completion cannot replace the physical observation."
      );
    }
    return;
  }
  if (
    (base.status !== InventoryCountStatus.Started &&
      base.status !== InventoryCountStatus.Observed) ||
    next.status !== InventoryCountStatus.Abandoned
  )
    throw new Error("Count abandon must make one non-terminal row abandoned.");
  if (
    !sameJson(base.observations, next.observations) ||
    base.observedAt !== next.observedAt ||
    base.observedThroughRecordSequence !== next.observedThroughRecordSequence
  ) {
    throw new Error(
      "Count abandonment cannot replace the physical observation."
    );
  }
}

/** Compare the count fields frozen when the count was opened. */
function sameCountStartFacts(
  left: InventoryCount,
  right: InventoryCount
): boolean {
  return sameJson(
    [
      left.countId,
      left.operationId,
      left.itemRevisionId,
      left.selector,
      left.startedAt,
      left.snapshotRecordSequence,
      left.actorId ?? null,
      left.sourceReference ?? null,
    ],
    [
      right.countId,
      right.operationId,
      right.itemRevisionId,
      right.selector,
      right.startedAt,
      right.snapshotRecordSequence,
      right.actorId ?? null,
      right.sourceReference ?? null,
    ]
  );
}

/** Return keys present only in the next record in stable identity order. */
function addedRecordKeys<T>(
  base: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>
): string[] {
  const added: string[] = [];
  for (const key of Object.keys(next)) {
    if (inventorySparseRecordValue(base, key) === undefined) added.push(key);
  }
  added.sort();
  return added;
}

/** JSON-safe normalized value compared without relying on object insertion order. */
type NormalizedJsonComparable = object | string | number | boolean | null | undefined;

/** Compare already-normalized typed values exactly without accepting coercion or object-key order. */
function sameJson(left: object, right: object | undefined): boolean {
  return right !== undefined && sameNormalizedJsonValue(left, right);
}

/** Compare one normalized JSON value recursively while preserving array order and ignoring omitted undefined fields. */
function sameNormalizedJsonValue(
  left: NormalizedJsonComparable,
  right: NormalizedJsonComparable
): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameNormalizedJsonValue(left[index], right[index])) return false;
    }
    return true;
  }
  const leftKeys = normalizedJsonObjectKeys(left);
  const rightKeys = normalizedJsonObjectKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftValue = Object.getOwnPropertyDescriptor(left, key)?.value;
    const rightValue = Object.getOwnPropertyDescriptor(right, key)?.value;
    if (!sameNormalizedJsonValue(leftValue, rightValue)) return false;
  }
  return true;
}

/** Return own JSON object keys whose values survive ordinary JSON serialization. */
function normalizedJsonObjectKeys(value: object): string[] {
  const result: string[] = [];
  for (const key of Object.keys(value)) {
    if (Object.getOwnPropertyDescriptor(value, key)?.value !== undefined) result.push(key);
  }
  return result;
}

/** Serialize one normalized JSON value with recursively sorted object keys and ordinary JSON omission semantics. */
function canonicalNormalizedJson(value: NormalizedJsonComparable): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Normalized durable JSON contains an unsupported primitive.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(
      /** Canonicalize one array child without changing its position. */
      (child) => canonicalNormalizedJson(child)
    ).join(",")}]`;
  }
  const keys = normalizedJsonObjectKeys(value);
  keys.sort();
  const fields: string[] = [];
  for (const key of keys) {
    const child = Object.getOwnPropertyDescriptor(value, key)?.value;
    fields.push(`${JSON.stringify(key)}:${canonicalNormalizedJson(child)}`);
  }
  return `{${fields.join(",")}}`;
}

/** Turn one normalized typed record into stable key-sorted rows independent of nested object insertion order. */
function sortedRecordRows<T>(
  values: Readonly<Record<string, T>>
): readonly string[] {
  const keys = Object.keys(values);
  keys.sort();
  const rows: string[] = [];
  for (const key of keys) rows.push(canonicalNormalizedJson([key, values[key]]));
  return rows;
}
