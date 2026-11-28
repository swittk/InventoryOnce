import { compareInventoryIdentityText } from "./ordering.js";
import {
  cloneInventoryRetainedData,
  cloneInventorySparseRecord,
  setInventorySparseRecordValue,
  createInventorySparseRecord,
  inventorySparseRecordValue,
} from "./sparse-record.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
} from "./canonical.js";
import type { InventoryCatalog } from "./catalog.js";
import {
  applyInventoryRecordedDeficitBurden,
  inventorySelectedDeficitPlacementNodeIds,
} from "./deficits.js";
import { assertInventoryEpochMilliseconds } from "./events.js";
import { inventoryMeasurementAt } from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  type InventoryMetadata,
  type InventoryStockPositionKey,
  type ItemId,
  type PartyId,
} from "./model.js";
import type { InventoryProjectionState } from "./projection.js";
import { InventoryReservationFeasibilityLimitError } from "./reservation-feasibility-limit.js";
import {
  materializeInventoryWorkingQuantity,
  quantityGreatestCommonDivisor,
  workingQuantityAtDecimals,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
  assertPositionInsideSelector,
  inventoryStockPositionMatchesSelector,
  inventoryStockSelectorIdentity,
  inventoryStockSelectorIsSubset,
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import { inventoryPositionIsExpiredAt } from "./usability.js";
import {
  addQuantity,
  compareQuantity,
  positiveQuantity,
  quantityEq,
  quantityIsWholeMultipleOf,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";

/** Durable lifecycle of one claim against eligible inventory. */
export enum InventoryReservationStatus {
  /** Claim still reduces global available stock and may be refined/allocated/released/consumed. */
  Active = "active",
  /** Caller explicitly released the claim without consuming stock. */
  Released = "released",
  /** Claim was converted into one committed issue event. */
  Consumed = "consumed",
  /** Claim passed its explicit expiry and was closed without consumption. */
  Expired = "expired",
}

/** Whether current physical stock can still satisfy every active claim together. */
export enum InventoryReservationFeasibilityStatus {
  /** A simultaneous non-overlapping assignment exists for every active claim. */
  Feasible = "feasible",
  /** Physical stock cannot currently cover at least one competing claim group. */
  Shortage = "shortage",
}

/** Exact feasibility result for claims competing on one item measurement axis. */
export interface InventoryReservationFeasibilityGroup {
  /** Stable item whose positions back this claim group. */
  readonly itemId: ItemId;
  /** Item measurement axis used by every claim in this group. */
  readonly axisId: string;
  /** Active reservations competing in this group, sorted by identity. */
  readonly reservationIds: readonly string[];
  /** Exact total quantity requested by the active claims. */
  readonly requested: Quantity;
  /** Exact maximum quantity current eligible stock can assign simultaneously. */
  readonly fulfillable: Quantity;
  /** Exact requested minus fulfillable quantity; zero means this group is feasible. */
  readonly shortage: Quantity;
}

/** Read-side explanation of active-claim feasibility after ordinary or physical-truth changes. */
export interface InventoryReservationFeasibilityReport {
  /** Time used to decide which active reservations have expired logically. */
  readonly atEpochMs: number;
  /** Feasible only when every competing group has zero shortage. */
  readonly status: InventoryReservationFeasibilityStatus;
  /** Exact results for every active competing claim group. */
  readonly groups: readonly InventoryReservationFeasibilityGroup[];
}

/** One exact position/quantity binding for an otherwise broad reservation. */
export interface InventoryReservationAllocation {
  /** Exact stock position assigned to this claim. */
  readonly position: InventoryStockPositionKey;
  /** Positive amount on the reservation axis assigned at this position. */
  readonly quantity: Quantity;
}

/** Creation facts for one broad or exact reservation. */
export interface NewInventoryReservation {
  /** Stable identity for this claim. */
  readonly reservationId: string;
  /** Stable creation retry identity. */
  readonly operationId: string;
  /** Frozen item definition used for selector/axis validation. */
  readonly itemRevisionId: string;
  /** Eligible-stock scope; omitted dimensions remain broad. */
  readonly selector: InventoryStockSelector;
  /** Positive requested quantity on the item's configured reservation axis. */
  readonly requested: Quantity;
  /** Time the claim was created. */
  readonly createdAtEpochMs: number;
  /** Optional time after which the claim stops reducing availability. */
  readonly expiresAtEpochMs?: number;
  /** Explicitly permit stock past its lot/placement-ancestry use-by to back this claim. */
  readonly allowExpiredStock?: boolean;
  /** Application/source row that requested this claim. */
  readonly sourceReference?: string;
  /** Actor who requested this claim when known. */
  readonly actorId?: PartyId;
  /** Extra application facts that do not change claim math. */
  readonly metadata?: InventoryMetadata;
}

/** Current reservation row including optional exact allocation and terminal lifecycle facts. */
export interface InventoryReservation extends NewInventoryReservation {
  /** Current lifecycle status. */
  readonly status: InventoryReservationStatus;
  /** Exact position bindings when picking/allocation has happened. */
  readonly allocations: readonly InventoryReservationAllocation[];
  /** Time the current terminal status was set. */
  readonly statusAtEpochMs?: number;
  /** Latest causally ordered lifecycle change, including refinement/allocation. */
  readonly lastChangedAtEpochMs: number;
  /** Committed issue event that consumed this reservation. */
  readonly consumptionEventId?: string;
}

/** Kind of durable reservation operation retained for exact retry comparison. */
export enum InventoryReservationOperationKind {
  /** Create one new claim. */
  Create = "create",
  /** Narrow one claim's eligible selector. */
  Refine = "refine",
  /** Bind one claim to exact positions. */
  Allocate = "allocate",
  /** Release one active claim. */
  Release = "release",
  /** Expire one active claim. */
  Expire = "expire",
  /** Mark one claim consumed by a committed issue event. */
  Consume = "consume",
}

/** Immutable reservation-operation evidence used for idempotent lifecycle retries. */
export interface InventoryReservationOperation {
  /** Stable retry identity. */
  readonly operationId: string;
  /** Reservation affected. */
  readonly reservationId: string;
  /** Lifecycle action performed. */
  readonly kind: InventoryReservationOperationKind;
  /** Stable normalized intent fingerprint. */
  readonly intentFingerprint: string;
  /** Monotonic order of this lifecycle change inside the reservation book. */
  readonly lifecycleSequence: number;
  /** Exact reservation row after this lifecycle change, used for honest `at` reconstruction. */
  readonly reservationAfter: InventoryReservation;
}

/** New lifecycle evidence before the book assigns order and freezes the resulting row. */
type NewInventoryReservationOperation = Pick<
  InventoryReservationOperation,
  "operationId" | "reservationId" | "kind" | "intentFingerprint"
>;

/** Current reservation rows plus append-only operation/idempotency evidence. */
export interface InventoryReservationBook {
  /** Reservations keyed by stable claim identity. */
  readonly reservations: Readonly<Record<string, InventoryReservation>>;
  /** Lifecycle operations keyed by operation id. */
  readonly operations: Readonly<Record<string, InventoryReservationOperation>>;
}

/** Result after applying/replaying one reservation lifecycle operation. */
export interface InventoryReservationBookResult {
  /** Next book; unchanged on exact replay. */
  readonly book: InventoryReservationBook;
  /** Current reservation after the operation. */
  readonly reservation: InventoryReservation;
  /** True when this exact operation was already recorded. */
  readonly replayed: boolean;
}

/** Inputs for creating one globally feasible claim. */
export interface CreateInventoryReservationInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current on-hand projection. */
  readonly projection: InventoryProjectionState;
  /** Existing active/terminal claims. */
  readonly book: InventoryReservationBook;
  /** New claim intent. */
  readonly reservation: NewInventoryReservation;
  /** Current time used for expiry and feasibility. */
  readonly nowEpochMs: number;
}

/** Create an empty reservation book. */
export function emptyInventoryReservationBook(): InventoryReservationBook {
  return {
    reservations: createInventorySparseRecord(),
    operations: createInventorySparseRecord(),
  };
}

/** Create one broad/exact claim only when every active claim remains globally feasible. */
export function createInventoryReservation({
  catalog,
  projection,
  book,
  reservation,
  nowEpochMs,
}: CreateInventoryReservationInput): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(nowEpochMs, "reservation now");
  assertInventoryEpochMilliseconds(reservation.createdAtEpochMs, "reservation createdAtEpochMs");
  if (reservation.createdAtEpochMs > nowEpochMs) {
    throw new Error(
      "Reservation createdAtEpochMs cannot be after its durable record time."
    );
  }
  if (reservation.expiresAtEpochMs !== undefined) {
    assertInventoryEpochMilliseconds(
      reservation.expiresAtEpochMs,
      "reservation expiresAtEpochMs"
    );
    if (
      reservation.expiresAtEpochMs <= reservation.createdAtEpochMs ||
      reservation.expiresAtEpochMs <= nowEpochMs
    ) {
      throw new Error(
        "Cannot create an already-expired inventory reservation."
      );
    }
  }
  const item = catalog.itemRevision(reservation.itemRevisionId);
  const selector = freezeReservationEligibleItemRevisions(
    catalog,
    item.revisionId,
    reservation.selector
  );
  if (selector.itemId !== item.itemId) {
    throw new Error(
      "Reservation selector item differs from frozen item revision."
    );
  }
  const reservationAxis = catalog.measurementAxis(item, item.reservationAxisId);
  positiveQuantity(reservation.requested, "Reservation requested quantity");
  if (reservation.requested.unit !== reservationAxis.unit) {
    throw new Error(
      `Reservation quantity must use '${reservationAxis.unit}', not '${reservation.requested.unit}'.`
    );
  }
  const normalizedCreation: NewInventoryReservation = cloneInventoryRetainedData({
    ...reservation,
    selector,
  });
  const fingerprint = newReservationFingerprint(normalizedCreation);
  const replay = findReservationOperationReplay(
    book,
    reservation.operationId,
    InventoryReservationOperationKind.Create,
    reservation.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  if (inventorySparseRecordValue(book.reservations, reservation.reservationId) !== undefined) {
    throw new Error(
      `Inventory reservation '${reservation.reservationId}' already exists.`
    );
  }
  const value: InventoryReservation = {
    ...normalizedCreation,
    status: InventoryReservationStatus.Active,
    allocations: [],
    lastChangedAtEpochMs: reservation.createdAtEpochMs,
  };
  const reservations = cloneInventorySparseRecord(book.reservations);
  setInventorySparseRecordValue(reservations, value.reservationId, value);
  const nextBook = addReservationOperation(
    { reservations, operations: book.operations },
    value,
    {
      operationId: value.operationId,
      reservationId: value.reservationId,
      kind: InventoryReservationOperationKind.Create,
      intentFingerprint: fingerprint,
    }
  );
  assertInventoryReservationsFeasible({
    catalog,
    projection,
    book: nextBook,
    atEpochMs: nowEpochMs,
  });
  return { book: nextBook, reservation: value, replayed: false };
}

/** Inputs for checking the global non-overlapping assignment invariant. */
export interface AssertInventoryReservationsFeasibleInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current on-hand projection. */
  readonly projection: InventoryProjectionState;
  /** Reservation book to test. */
  readonly book: InventoryReservationBook;
  /** Time determining which active claims have expired logically. */
  readonly atEpochMs: number;
}

/** Throw unless all active claims have one simultaneous non-overlapping stock assignment. */
export function assertInventoryReservationsFeasible({
  catalog,
  projection,
  book,
  atEpochMs,
}: AssertInventoryReservationsFeasibleInput): void {
  const report = inspectInventoryReservationFeasibility({
    catalog,
    projection,
    book,
    atEpochMs,
  });
  if (report.status === InventoryReservationFeasibilityStatus.Feasible) return;
  const shortReservationIds: string[] = [];
  for (const group of report.groups) {
    if (group.shortage.amountMinor === 0) continue;
    for (const reservationId of group.reservationIds) shortReservationIds.push(reservationId);
  }
  shortReservationIds.sort();
  throw new Error(
    `Inventory reservations cannot all be fulfilled simultaneously: ${shortReservationIds.join(
      ", "
    )}.`
  );
}

/** Return exact group shortages instead of hiding physical loss behind a thrown feasibility check. */
export function inspectInventoryReservationFeasibility({
  catalog,
  projection,
  book,
  atEpochMs,
}: AssertInventoryReservationsFeasibleInput): InventoryReservationFeasibilityReport {
  assertInventoryEpochMilliseconds(atEpochMs, "reservation feasibility time");
  const activeReservations: InventoryReservation[] = [];
  for (const reservation of inventoryReservationsAt(book, atEpochMs)) {
    if (inventoryReservationIsActiveAt(reservation, atEpochMs)) {
      activeReservations.push(reservation);
    }
  }
  const groups = groupReservationsByCompetingAxis(catalog, activeReservations);
  const results: InventoryReservationFeasibilityGroup[] = [];
  let status = InventoryReservationFeasibilityStatus.Feasible;
  for (const reservations of groups.values()) {
    const first = reservations[0];
    if (first === undefined) continue;
    const item = catalog.itemRevision(first.itemRevisionId);
    const axis = catalog.measurementAxis(item, item.reservationAxisId);
    const feasibility = reservationGroupFeasibility(
      catalog,
      projection,
      reservations,
      atEpochMs
    );
    const shortage = materializeInventoryWorkingQuantity({
      amountMinor: feasibility.requestedMinor - feasibility.fulfillableMinor,
      decimals: feasibility.decimals,
      unit: axis.unit,
    }, "Reservation feasibility shortage");
    if (shortage.amountMinor > 0) {
      status = InventoryReservationFeasibilityStatus.Shortage;
    }
    const reservationIds: string[] = [];
    for (const reservation of reservations) {
      reservationIds.push(reservation.reservationId);
    }
    results.push({
      itemId: item.itemId,
      axisId: axis.axisId,
      reservationIds,
      requested: materializeInventoryWorkingQuantity({
        amountMinor: feasibility.requestedMinor,
        decimals: feasibility.decimals,
        unit: axis.unit,
      }, "Reservation feasibility requested quantity"),
      fulfillable: materializeInventoryWorkingQuantity({
        amountMinor: feasibility.fulfillableMinor,
        decimals: feasibility.decimals,
        unit: axis.unit,
      }, "Reservation feasibility fulfillable quantity"),
      shortage,
    });
  }
  results.sort(compareReservationFeasibilityGroup);
  return { atEpochMs, status, groups: results };
}

/** Rebuild every reservation row as it existed at one lifecycle occurrence time. */
export function inventoryReservationsAt(
  book: InventoryReservationBook,
  atEpochMs: number
): readonly InventoryReservation[] {
  assertInventoryEpochMilliseconds(atEpochMs, "reservation query atEpochMs");
  const current = currentInventoryReservationsAt(book, atEpochMs);
  if (current !== undefined) return current;
  const latestByReservationId = new Map<
    string,
    InventoryReservationOperation
  >();
  for (const operation of Object.values(book.operations)) {
    if (operation.reservationAfter.lastChangedAtEpochMs > atEpochMs) continue;
    const earlier = latestByReservationId.get(operation.reservationId);
    if (
      earlier === undefined ||
      operation.lifecycleSequence > earlier.lifecycleSequence
    ) {
      latestByReservationId.set(operation.reservationId, operation);
    }
  }
  const reservations: InventoryReservation[] = [];
  for (const operation of latestByReservationId.values()) {
    reservations.push(operation.reservationAfter);
  }
  reservations.sort(compareReservationIdentity);
  return reservations;
}

/**
 * Return the current claim rows when the requested authority time is at or after every
 * retained current lifecycle fact. Current availability/allocation reads therefore scale
 * with current claims rather than replaying an ever-growing operation history.
 */
function currentInventoryReservationsAt(
  book: InventoryReservationBook,
  atEpochMs: number
): readonly InventoryReservation[] | undefined {
  const reservations = Object.values(book.reservations);
  for (const reservation of reservations) {
    if (reservation.lastChangedAtEpochMs > atEpochMs) return undefined;
  }
  reservations.sort(compareReservationIdentity);
  return reservations;
}

/** Return whether this retained reservation row reduced availability at this authority time. */
export function inventoryReservationIsActiveAt(
  reservation: InventoryReservation,
  atEpochMs: number
): boolean {
  assertInventoryEpochMilliseconds(atEpochMs, "reservation query atEpochMs");
  assertInventoryEpochMilliseconds(reservation.createdAtEpochMs, "reservation createdAtEpochMs");
  if (reservation.expiresAtEpochMs !== undefined) assertInventoryEpochMilliseconds(reservation.expiresAtEpochMs, "reservation expiresAtEpochMs");
  if (reservation.statusAtEpochMs !== undefined) assertInventoryEpochMilliseconds(reservation.statusAtEpochMs, "reservation statusAtEpochMs");
  if (atEpochMs < reservation.createdAtEpochMs) return false;
  if (reservation.expiresAtEpochMs !== undefined && atEpochMs >= reservation.expiresAtEpochMs)
    return false;
  if (reservation.status === InventoryReservationStatus.Active) return true;
  // A released, expired, or consumed row still protected stock before that terminal fact happened.
  return reservation.statusAtEpochMs !== undefined && atEpochMs < reservation.statusAtEpochMs;
}

/** Inputs for narrowing one active reservation selector. */
export interface RefineInventoryReservationInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current on-hand projection. */
  readonly projection: InventoryProjectionState;
  /** Current reservation book. */
  readonly book: InventoryReservationBook;
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being narrowed. */
  readonly reservationId: string;
  /** New selector that must be a structural subset of the existing selector. */
  readonly selector: InventoryStockSelector;
  /** Lifecycle operation occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Narrow one claim without making the global set of claims infeasible. */
export function refineInventoryReservation(
  input: RefineInventoryReservationInput
): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(
    input.occurredAtEpochMs,
    "reservation refine occurredAtEpochMs"
  );
  const reservation = requireActiveReservation(
    input.book,
    input.reservationId,
    input.occurredAtEpochMs
  );
  const selector = freezeReservationEligibleItemRevisions(
    input.catalog,
    reservation.itemRevisionId,
    input.selector
  );
  if (
    !inventoryStockSelectorIsSubset(
      selector,
      reservation.selector,
      input.projection.placement
    )
  ) {
    throw new Error(
      "Reservation refinement must narrow, not broaden, the eligible stock scope."
    );
  }
  for (const allocation of reservation.allocations) {
    assertPositionInsideSelector(
      allocation.position,
      selector,
      input.projection.placement
    );
  }
  const fingerprint = inventoryIntentFingerprint([
    input.reservationId,
    input.occurredAtEpochMs,
    inventoryStockSelectorIdentity(selector),
  ]);
  const replay = findReservationOperationReplay(
    input.book,
    input.operationId,
    InventoryReservationOperationKind.Refine,
    input.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const value: InventoryReservation = {
    ...reservation,
    selector,
    lastChangedAtEpochMs: input.occurredAtEpochMs,
  };
  const nextBook = replaceReservationWithOperation(input.book, value, {
    operationId: input.operationId,
    reservationId: input.reservationId,
    kind: InventoryReservationOperationKind.Refine,
    intentFingerprint: fingerprint,
  });
  assertInventoryReservationsFeasible({
    catalog: input.catalog,
    projection: input.projection,
    book: nextBook,
    atEpochMs: input.occurredAtEpochMs,
  });
  return { book: nextBook, reservation: value, replayed: false };
}

/** Inputs for binding one active claim to exact stock positions. */
export interface AllocateInventoryReservationInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current on-hand projection. */
  readonly projection: InventoryProjectionState;
  /** Current reservation book. */
  readonly book: InventoryReservationBook;
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being allocated/reallocated. */
  readonly reservationId: string;
  /** Exact position quantities whose total must equal the request. */
  readonly allocations: readonly InventoryReservationAllocation[];
  /** Lifecycle operation occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Bind one broad claim to exact positions while preserving global feasibility. */
export function allocateInventoryReservation(
  input: AllocateInventoryReservationInput
): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(
    input.occurredAtEpochMs,
    "reservation allocation occurredAtEpochMs"
  );
  const reservation = requireActiveReservation(
    input.book,
    input.reservationId,
    input.occurredAtEpochMs
  );
  const item = input.catalog.itemRevision(reservation.itemRevisionId);
  const axis = input.catalog.measurementAxis(item, item.reservationAxisId);
  const allocations = normalizeReservationAllocations(
    input.catalog,
    input.projection,
    input.allocations,
    reservation,
    axis.axisId,
    axis.unit,
    input.occurredAtEpochMs
  );
  const fingerprint = inventoryIntentFingerprint([
    input.reservationId,
    input.occurredAtEpochMs,
    allocations.map(allocationFingerprint),
  ]);
  const replay = findReservationOperationReplay(
    input.book,
    input.operationId,
    InventoryReservationOperationKind.Allocate,
    input.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const value: InventoryReservation = {
    ...reservation,
    allocations,
    lastChangedAtEpochMs: input.occurredAtEpochMs,
  };
  const nextBook = replaceReservationWithOperation(input.book, value, {
    operationId: input.operationId,
    reservationId: input.reservationId,
    kind: InventoryReservationOperationKind.Allocate,
    intentFingerprint: fingerprint,
  });
  assertInventoryReservationsFeasible({
    catalog: input.catalog,
    projection: input.projection,
    book: nextBook,
    atEpochMs: input.occurredAtEpochMs,
  });
  return { book: nextBook, reservation: value, replayed: false };
}

/** Inputs shared by release/expiry lifecycle commands. */
export interface CloseInventoryReservationInput {
  /** Current reservation book. */
  readonly book: InventoryReservationBook;
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Reservation being closed. */
  readonly reservationId: string;
  /** Lifecycle operation occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Release one active claim without changing physical stock. */
export function releaseInventoryReservation(
  input: CloseInventoryReservationInput
): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(
    input.occurredAtEpochMs,
    "reservation release occurredAtEpochMs"
  );
  const fingerprint = inventoryIntentFingerprint([
    input.reservationId,
    input.occurredAtEpochMs,
  ]);
  const replay = findReservationOperationReplay(
    input.book,
    input.operationId,
    InventoryReservationOperationKind.Release,
    input.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const reservation = requireActiveReservation(
    input.book,
    input.reservationId,
    input.occurredAtEpochMs
  );
  const value: InventoryReservation = {
    ...reservation,
    status: InventoryReservationStatus.Released,
    statusAtEpochMs: input.occurredAtEpochMs,
    lastChangedAtEpochMs: input.occurredAtEpochMs,
  };
  const book = replaceReservationWithOperation(input.book, value, {
    operationId: input.operationId,
    reservationId: input.reservationId,
    kind: InventoryReservationOperationKind.Release,
    intentFingerprint: fingerprint,
  });
  return { book, reservation: value, replayed: false };
}

/** Mark one active claim durably expired after its configured expiry time. */
export function expireInventoryReservation(
  input: CloseInventoryReservationInput
): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(
    input.occurredAtEpochMs,
    "reservation expiry occurredAtEpochMs"
  );
  const fingerprint = inventoryIntentFingerprint([
    input.reservationId,
    input.occurredAtEpochMs,
  ]);
  const replay = findReservationOperationReplay(
    input.book,
    input.operationId,
    InventoryReservationOperationKind.Expire,
    input.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const reservation = inventorySparseRecordValue(input.book.reservations, input.reservationId);
  if (reservation === undefined)
    throw new Error("Unknown inventory reservation.");
  if (reservation.status !== InventoryReservationStatus.Active) {
    throw new Error("Only an active inventory reservation can expire.");
  }
  assertReservationLifecycleTime(reservation, input.occurredAtEpochMs);
  if (
    reservation.expiresAtEpochMs === undefined ||
    reservation.expiresAtEpochMs > input.occurredAtEpochMs
  ) {
    throw new Error("Inventory reservation has not reached its expiry time.");
  }
  const value: InventoryReservation = {
    ...reservation,
    status: InventoryReservationStatus.Expired,
    statusAtEpochMs: input.occurredAtEpochMs,
    lastChangedAtEpochMs: input.occurredAtEpochMs,
  };
  const book = replaceReservationWithOperation(input.book, value, {
    operationId: input.operationId,
    reservationId: input.reservationId,
    kind: InventoryReservationOperationKind.Expire,
    intentFingerprint: fingerprint,
  });
  return { book, reservation: value, replayed: false };
}

/** Inputs for marking a claim consumed after its issue event committed atomically. */
export interface MarkInventoryReservationConsumedInput {
  /** Current reservation book. */
  readonly book: InventoryReservationBook;
  /** Stable lifecycle retry identity (normally the consuming inventory operation id). */
  readonly operationId: string;
  /** Reservation being consumed. */
  readonly reservationId: string;
  /** Committed issue event that consumed the exact allocation. */
  readonly consumptionEventId: string;
  /** Physical issue occurrence time. */
  readonly occurredAtEpochMs: number;
}

/** Close one active allocated claim against one committed issue event exactly once. */
export function markInventoryReservationConsumed(
  input: MarkInventoryReservationConsumedInput
): InventoryReservationBookResult {
  assertInventoryEpochMilliseconds(
    input.occurredAtEpochMs,
    "reservation consume occurredAtEpochMs"
  );
  const fingerprint = inventoryIntentFingerprint([
    input.reservationId,
    input.consumptionEventId,
    input.occurredAtEpochMs,
  ]);
  const replay = findReservationOperationReplay(
    input.book,
    input.operationId,
    InventoryReservationOperationKind.Consume,
    input.reservationId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const reservation = requireActiveReservation(
    input.book,
    input.reservationId,
    input.occurredAtEpochMs
  );
  if (reservation.allocations.length === 0) {
    throw new Error("Reservation must be allocated before it can be consumed.");
  }
  const value: InventoryReservation = {
    ...reservation,
    status: InventoryReservationStatus.Consumed,
    statusAtEpochMs: input.occurredAtEpochMs,
    lastChangedAtEpochMs: input.occurredAtEpochMs,
    consumptionEventId: input.consumptionEventId,
  };
  const book = replaceReservationWithOperation(input.book, value, {
    operationId: input.operationId,
    reservationId: input.reservationId,
    kind: InventoryReservationOperationKind.Consume,
    intentFingerprint: fingerprint,
  });
  return { book, reservation: value, replayed: false };
}

/** Normalize allocation lines, merge duplicate positions, and require exact requested total. */
function normalizeReservationAllocations(
  catalog: InventoryCatalog,
  projection: InventoryProjectionState,
  allocations: readonly InventoryReservationAllocation[],
  reservation: InventoryReservation,
  axisId: string,
  unit: Quantity["unit"],
  atEpochMs: number
): readonly InventoryReservationAllocation[] {
  if (allocations.length === 0) {
    throw new Error(
      "Reservation allocation needs at least one exact position."
    );
  }
  const grouped = new Map<string, InventoryReservationAllocation>();
  for (const allocation of allocations) {
    positiveQuantity(allocation.quantity, "Reservation allocation quantity");
    if (allocation.quantity.unit !== unit) {
      throw new Error(`Reservation allocation must use '${unit}'.`);
    }
    assertPositionInsideSelector(
      allocation.position,
      reservation.selector,
      projection.placement
    );
    const identity = inventoryStockPositionIdentity(allocation.position);
    const earlier = grouped.get(identity);
    grouped.set(
      identity,
      earlier === undefined
        ? cloneInventoryRetainedData(allocation)
        : {
            position: earlier.position,
            quantity: addQuantity(earlier.quantity, allocation.quantity),
          }
    );
  }
  const normalized = [...grouped.values()];
  normalized.sort(compareReservationAllocation);
  let total = zeroQuantity(unit);
  for (const allocation of normalized)
    total = addQuantity(total, allocation.quantity);
  if (!quantityEq(total, reservation.requested)) {
    throw new Error(
      "Reservation allocation total must exactly equal requested quantity."
    );
  }
  for (const allocation of normalized) {
    assertReservationAllocationCanBecomeLegalIssue(
      catalog,
      projection,
      allocation,
      reservation,
      axisId,
      unit,
      atEpochMs
    );
  }
  return normalized;
}

/** Reject an exact allocation that no legal issue amount can consume from that stock row. */
function assertReservationAllocationCanBecomeLegalIssue(
  catalog: InventoryCatalog,
  projection: InventoryProjectionState,
  allocation: InventoryReservationAllocation,
  reservation: InventoryReservation,
  axisId: string,
  unit: Quantity["unit"],
  atEpochMs: number
): void {
  if (allocation.position.transferId !== undefined) {
    throw new Error("Reservation allocation cannot bind prepared or in-transit transfer stock.");
  }
  if (allocation.position.placementNodeId === undefined) {
    throw new Error(
      "Reservation allocation cannot bind detached or missing stock; place it explicitly first."
    );
  }
  const identity = inventoryStockPositionIdentity(allocation.position);
  const projected = projection.positions[identity];
  if (projected === undefined) {
    throw new Error(
      `Reservation allocation position ${identity} has no positive stock.`
    );
  }
  if (
    reservation.allowExpiredStock !== true &&
    inventoryPositionIsExpiredAt(projection, projected.key, atEpochMs)
  ) {
    throw new Error(
      "Reservation allocation cannot use stock past its lot/placement-ancestry use-by unless the claim explicitly permits it."
    );
  }
  const capacity = inventoryMeasurementAt(projected.measurements, axisId, unit);
  if (compareQuantity(allocation.quantity, capacity) > 0) {
    throw new Error(
      "Reservation allocation exceeds current stock at its exact position."
    );
  }
  if (
    allocation.position.serialId !== undefined &&
    !quantityEq(allocation.quantity, capacity)
  ) {
    throw new Error(
      "A serial allocation must reserve the complete one-serial stock row."
    );
  }
  const packagingRevisionId = allocation.position.packagingRevisionId;
  if (packagingRevisionId === undefined) return;
  const item = catalog.itemRevision(allocation.position.itemRevisionId);
  const packaging = catalog.packagingRevision(packagingRevisionId);
  const onePackage = inventoryMeasurementAt(
    packaging.fixedContents,
    axisId,
    unit
  );
  if (axisId !== item.primaryAxis.axisId && onePackage.amountMinor <= 0) {
    if (!quantityEq(allocation.quantity, capacity)) {
      throw new Error(
        "A package allocation on an independently measured reservation axis must reserve the whole stock row."
      );
    }
    return;
  }
  if (!quantityIsWholeMultipleOf(allocation.quantity, onePackage)) {
    throw new Error(
      "Intact package allocation must equal a whole number of exact packages."
    );
  }
}

/** Keep lifecycle writes in causal order even when callers submit backdated commands. */
function assertReservationLifecycleTime(
  reservation: InventoryReservation,
  occurredAtEpochMs: number
): void {
  if (occurredAtEpochMs < reservation.createdAtEpochMs) {
    throw new Error(
      "Reservation lifecycle change cannot happen before creation."
    );
  }
  if (occurredAtEpochMs < reservation.lastChangedAtEpochMs) {
    throw new Error(
      "Reservation lifecycle change cannot predate the latest change."
    );
  }
}

/** Group claims that compete for the same item/axis/unit resource pool. */
function groupReservationsByCompetingAxis(
  catalog: InventoryCatalog,
  reservations: readonly InventoryReservation[]
): ReadonlyMap<string, InventoryReservation[]> {
  const groups = new Map<string, InventoryReservation[]>();
  for (const reservation of reservations) {
    const item = catalog.itemRevision(reservation.itemRevisionId);
    const axis = catalog.measurementAxis(item, item.reservationAxisId);
    // Separate revision pools unless their exact frozen eligible revision set is identical.
    const key = JSON.stringify([
      item.itemId,
      reservation.selector.itemRevisionIds ?? [],
      axis.axisId,
      axis.unit,
    ]);
    const group = groups.get(key) ?? [];
    group.push(reservation);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort(compareReservationIdentity);
  }
  return groups;
}

/** One positive on-hand position exposed to the reservation max-flow check. */
interface ReservationFeasibilityPosition {
  /** Exact position identity. */
  readonly identity: string;
  /** Exact position key. */
  readonly position: InventoryStockPositionKey;
  /** Exact positive capacity on the competing axis after any deficit burden. */
  readonly capacity: InventoryWorkingQuantity;
  /** Smallest legal issue from this row; omitted means the row is divisible on this axis. */
  readonly indivisibleIncrement?: Quantity;
}

/** One positive position participating in deterministic deficit burden before feasibility. */
interface ReservationDeficitBurdenPosition
  extends ReservationFeasibilityPosition {
  /** True when at least one real reservation can use this exact position. */
  readonly reservationCandidate: boolean;
  /** Number of real reservations eligible for this position; lower means more constrained. */
  readonly eligibleReservationCount: number;
}

/** Equal package/serial pieces from one merged stock row, kept as integer capacity. */
interface ReservationIndivisibleGroup {
  /** Position index these equal legal issue pieces come from. */
  readonly positionIndex: number;
  /** Exact shared-scale size of one legal issue piece. */
  readonly capacityMinor: bigint;
  /** Number of equal pieces in this projected position. */
  readonly count: bigint;
  /** Claims that can take at least one whole piece from this position. */
  readonly eligibleReservationCount: number;
}

/** Exact scaled max-flow result for one competing claim group. */
interface ReservationGroupFeasibility {
  /** Shared decimal scale used by every flow edge. */
  readonly decimals: number;
  /** Total active claim demand at the shared scale. */
  readonly requestedMinor: bigint;
  /** Maximum assignable demand at the shared scale. */
  readonly fulfillableMinor: bigint;
}

/** Maximum claims accepted in one competing feasibility group. */
export const MAXIMUM_RESERVATION_FEASIBILITY_RESERVATIONS = 128;
/** Maximum positive stock rows accepted in one competing feasibility group. */
export const MAXIMUM_RESERVATION_FEASIBILITY_POSITIONS = 512;
/** Maximum claim-to-position eligibility edges accepted before failing closed. */
export const MAXIMUM_RESERVATION_FEASIBILITY_EDGES = 8_192;
/** Maximum real integer-assignment states explored before asking the caller to narrow scope. */
export const MAXIMUM_RESERVATION_FEASIBILITY_STATES = 100_000;

/** Return whether one current position may back this claim at the supplied authority time. */
function reservationPositionEligible(
  reservation: InventoryReservation,
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
  atEpochMs: number
): boolean {
  // Detached/missing stock remains conserved truth but cannot back an ordinary claim.
  if (position.transferId !== undefined || position.placementNodeId === undefined) {
    return false;
  }
  if (
    !inventoryStockPositionMatchesSelector(
      position,
      reservation.selector,
      projection.placement
    )
  ) {
    return false;
  }
  return (
    reservation.allowExpiredStock === true ||
    !inventoryPositionIsExpiredAt(projection, position, atEpochMs)
  );
}

/** Return the exact maximum simultaneous assignment for one competing group. */
function reservationGroupFeasibility(
  catalog: InventoryCatalog,
  projection: InventoryProjectionState,
  reservations: readonly InventoryReservation[],
  atEpochMs: number
): ReservationGroupFeasibility {
  const first = reservations[0];
  if (first === undefined) {
    return { decimals: 0, requestedMinor: 0n, fulfillableMinor: 0n };
  }
  const item = catalog.itemRevision(first.itemRevisionId);
  const axis = catalog.measurementAxis(item, item.reservationAxisId);
  if (reservations.length > MAXIMUM_RESERVATION_FEASIBILITY_RESERVATIONS) {
    throw new InventoryReservationFeasibilityLimitError(
      "Reservation feasibility group has too many claims; narrow or partition the scope."
    );
  }
  // Freeze each allocation list once. Exact claims do not need broad selector × position scans.
  const allocationsByReservation = reservations.map(
    /** Freeze one reservation's exact allocation list before graph construction. */
    (reservation) => reservation.allocations
  );
  const broadReservations: InventoryReservation[] = [];
  const candidatePositionIdentities = new Set<string>();
  for (
    let reservationIndex = 0;
    reservationIndex < reservations.length;
    reservationIndex += 1
  ) {
    const reservation = reservations[reservationIndex];
    const allocations = allocationsByReservation[reservationIndex];
    if (reservation === undefined || allocations === undefined) continue;
    if (allocations.length === 0) {
      broadReservations.push(reservation);
      continue;
    }
    for (const allocation of allocations) {
      const identity = inventoryStockPositionIdentity(allocation.position);
      const position = projection.positions[identity];
      if (
        position !== undefined &&
        reservationPositionEligible(reservation, projection, position.key, atEpochMs)
      ) {
        candidatePositionIdentities.add(identity);
      }
    }
  }
  if (broadReservations.length > 0) {
    for (const identity of inventorySparseRecordValue(
      projection.positionIdsByItemRevisionId,
      first.itemRevisionId
    ) ?? []) {
      const position = projection.positions[identity];
      if (position === undefined) {
        throw new Error(
          `Reservation item-revision index references missing position ${identity}.`
        );
      }
      for (const reservation of broadReservations) {
        if (
          reservationPositionEligible(reservation, projection, position.key, atEpochMs)
        ) {
          candidatePositionIdentities.add(identity);
          break;
        }
      }
    }
  }
  const placementNodeIds = reservationFeasibilityPlacementNodeIds(
    projection,
    reservations,
    allocationsByReservation,
    first.itemRevisionId
  );
  const selectedLocations = new Set(placementNodeIds);
  const burdenPositions: ReservationDeficitBurdenPosition[] = [];
  for (const identity of projection.positionIdsByItemRevisionId[
    first.itemRevisionId
  ] ?? []) {
    const position = projection.positions[identity];
    if (position === undefined) {
      throw new Error(
        `Reservation item-revision index references missing position ${identity}.`
      );
    }
    if (
      position.key.transferId !== undefined ||
      position.key.placementNodeId === undefined ||
      !selectedLocations.has(position.key.placementNodeId)
    ) continue;
    const capacity = inventoryMeasurementAt(
      position.measurements,
      axis.axisId,
      axis.unit
    );
    if (capacity.amountMinor <= 0n) {
      continue;
    }
    let eligibleReservationCount = 0;
    for (
      let reservationIndex = 0;
      reservationIndex < reservations.length;
      reservationIndex += 1
    ) {
      const reservation = reservations[reservationIndex];
      const allocations = allocationsByReservation[reservationIndex];
      if (reservation === undefined || allocations === undefined) continue;
      if (
        allocations.length === 0
          ? reservationPositionEligible(
              reservation,
              projection,
              position.key,
              atEpochMs
            )
          : allocations.some(
              /** Exact claims can use only their retained allocation positions. */
              (allocation) =>
                inventoryStockPositionIdentity(allocation.position) ===
                  identity &&
                reservationPositionEligible(
                  reservation,
                  projection,
                  position.key,
                  atEpochMs
                )
            )
      ) {
        eligibleReservationCount += 1;
      }
    }
    burdenPositions.push({
      identity,
      position: position.key,
      capacity,
      reservationCandidate: candidatePositionIdentities.has(identity),
      eligibleReservationCount,
      ...createIndivisibleReservationIncrement(
        catalog,
        position.key,
        axis.axisId,
        capacity
      ),
    });
  }
  burdenPositions.sort(compareReservationDeficitBurdenPosition);
  // An empty resolved placement set has no candidate capacity or deficit to attribute.
  const burden = placementNodeIds.length === 0 ? undefined : applyInventoryRecordedDeficitBurden({
    projection,
    itemRevisionId: first.itemRevisionId,
    axisId: axis.axisId,
    unit: axis.unit,
    placementNodeIds,
    lines: burdenPositions.map(
      /** Non-candidate rows back deficit first; candidate order remains deterministic. */
      (position) => ({
        position: position.position,
        capacity: position.capacity,
        ...(position.indivisibleIncrement === undefined
          ? {}
          : { allocationIncrement: position.indivisibleIncrement }),
      })
    ),
  });
  const positions: ReservationFeasibilityPosition[] = [];
  for (const position of burdenPositions) {
    if (!position.reservationCandidate) continue;
    const capacity = burden?.capacityByPositionIdentity.get(position.identity);
    if (capacity === undefined) {
      throw new Error(
        `Reservation deficit burden lost position '${position.identity}'.`
      );
    }
    if (capacity.amountMinor <= 0n) {
      continue;
    }
    positions.push({
      identity: position.identity,
      position: position.position,
      capacity,
      ...(position.indivisibleIncrement === undefined
        ? {}
        : { indivisibleIncrement: position.indivisibleIncrement }),
    });
  }
  positions.sort(compareFeasibilityPosition);
  if (positions.length > MAXIMUM_RESERVATION_FEASIBILITY_POSITIONS) {
    throw new InventoryReservationFeasibilityLimitError(
      "Reservation feasibility group has too many stock rows; narrow or partition the scope."
    );
  }

  let decimals = 0;
  for (
    let reservationIndex = 0;
    reservationIndex < reservations.length;
    reservationIndex += 1
  ) {
    const reservation = reservations[reservationIndex];
    const allocations = allocationsByReservation[reservationIndex];
    if (reservation === undefined || allocations === undefined) continue;
    decimals = Math.max(decimals, reservation.requested.decimals);
    for (const allocation of allocations) {
      decimals = Math.max(decimals, allocation.quantity.decimals);
    }
  }
  /** Track whether the broad solver will need a whole-stock bound. */
  let hasWholeStock = false;
  // A fixed package increment can have more decimals than the materialized balance.
  for (const position of positions) {
    decimals = Math.max(decimals, position.capacity.decimals, position.indivisibleIncrement?.decimals ?? 0);
    hasWholeStock ||= position.indivisibleIncrement !== undefined;
  }

  if (broadReservations.length === 0) {
    return exactReservationGroupFeasibility({
      reservations,
      allocationsByReservation,
      positions,
      projection,
      atEpochMs,
      decimals,
    });
  }

  let totalRequested = 0n;
  const requestedByReservation: bigint[] = [];
  const edgeCapacityByReservation: bigint[][] = [];
  /** Reuse scaled divisible capacities across eligible edges and the total capacity bound. */
  const divisibleCapacityByPosition: bigint[] = [];
  /** Upper limit on divisible stock each claim can draw through its own edges. */
  const divisibleCapacityByReservation: bigint[] = [];
  let edgeCount = 0;
  for (
    let reservationIndex = 0;
    reservationIndex < reservations.length;
    reservationIndex += 1
  ) {
    const reservation = reservations[reservationIndex];
    const allocations = allocationsByReservation[reservationIndex];
    if (reservation === undefined || allocations === undefined) continue;
    const requested = quantityAtDecimals(reservation.requested, decimals);
    totalRequested += requested;
    requestedByReservation.push(requested);
    const allocatedByPosition = new Map<string, bigint>();
    for (const allocation of allocations) {
      allocatedByPosition.set(
        inventoryStockPositionIdentity(allocation.position),
        quantityAtDecimals(allocation.quantity, decimals)
      );
    }
    const edgeCapacities: bigint[] = [];
    let divisibleDemand = 0n;
    for (
      let positionIndex = 0;
      positionIndex < positions.length;
      positionIndex += 1
    ) {
      const candidate = positions[positionIndex];
      if (candidate === undefined) continue;
      const edgeCapacity =
        allocations.length === 0
          ? reservationPositionEligible(
              reservation,
              projection,
              candidate.position,
              atEpochMs
            )
            ? requested
            : 0n
          : reservationPositionEligible(
              reservation,
              projection,
              candidate.position,
              atEpochMs
            )
          ? allocatedByPosition.get(candidate.identity) ?? 0n
          : 0n;
      edgeCapacities.push(edgeCapacity);
      if (edgeCapacity > 0n) {
        edgeCount += 1;
        if (hasWholeStock && candidate.indivisibleIncrement === undefined) {
          const capacity = divisibleCapacityByPosition[positionIndex] ??= quantityAtDecimals(candidate.capacity, decimals);
          divisibleDemand += edgeCapacity < capacity ? edgeCapacity : capacity;
        }
      }
    }
    edgeCapacityByReservation.push(edgeCapacities);
    divisibleCapacityByReservation.push(divisibleDemand);
  }
  if (edgeCount > MAXIMUM_RESERVATION_FEASIBILITY_EDGES) {
    throw new InventoryReservationFeasibilityLimitError(
      "Reservation feasibility graph has too many eligible claim/stock pairs; narrow the selectors."
    );
  }

  /** Merged package/serial capacities; ordinary package count does not create search nodes. */
  const indivisibleGroups: ReservationIndivisibleGroup[] = [];
  /** Total candidate capacity bounds any legal assignment after recorded deficits. */
  let totalCapacity = 0n;
  /** Capacity that can fill a remainder below a whole increment. */
  let divisibleCapacity = 0n;
  /** Sum of per-row indivisible capacities capped by exact legal claim-edge demand ceilings. */
  let sharedIndivisibleCapacityBound = 0n;
  /** Total stock across eligible indivisible rows and minimum unused increment when a pack must be left whole. */
  let eligibleIndivisibleCapacity = 0n;
  let smallestEligiblePack = 0n;
  /** Every eligible whole assignment uses a multiple of this increment. */
  let stockIncrement = 0n;
  /** Whole picks on each claim use a multiple of its eligible stock increments. */
  const wholeIncrementByReservation = new Array<bigint>(requestedByReservation.length).fill(0n);
  for (
    let positionIndex = 0;
    positionIndex < positions.length;
    positionIndex += 1
  ) {
    const candidate = positions[positionIndex];
    if (candidate === undefined) continue;
    const capacityMinor = divisibleCapacityByPosition[positionIndex] ?? quantityAtDecimals(candidate.capacity, decimals);
    totalCapacity += capacityMinor;
    const increment = candidate.indivisibleIncrement;
    if (increment === undefined) {
      divisibleCapacity += capacityMinor;
      continue;
    }
    const incrementMinor = quantityAtDecimals(increment, decimals);
    const slotCount = capacityMinor / incrementMinor;
    if (capacityMinor % incrementMinor !== 0n) {
      throw new Error(
        "Indivisible reservation stock is not a whole number of legal issue increments."
      );
    }
    let eligibleReservationCount = 0;
    let rowEligibleDemand = 0n;
    for (let reservationIndex = 0; reservationIndex < edgeCapacityByReservation.length; reservationIndex += 1) {
      const edgeCapacity = edgeCapacityByReservation[reservationIndex]?.[positionIndex] ?? 0n;
      if (edgeCapacity < incrementMinor) continue;
      const requested = requestedByReservation[reservationIndex] ?? 0n;
      const claimEdgeCeiling = edgeCapacity < requested ? edgeCapacity : requested;
      if (claimEdgeCeiling < incrementMinor) continue;
      eligibleReservationCount += 1;
      rowEligibleDemand += claimEdgeCeiling - claimEdgeCeiling % incrementMinor;
      const previous = wholeIncrementByReservation[reservationIndex] ?? 0n;
      if (previous !== 1n && previous !== incrementMinor) {
        wholeIncrementByReservation[reservationIndex] = quantityGreatestCommonDivisor(previous, incrementMinor);
      }
    }
    if (eligibleReservationCount === 0) continue;
    eligibleIndivisibleCapacity += capacityMinor;
    if (smallestEligiblePack === 0n || incrementMinor < smallestEligiblePack) {
      smallestEligiblePack = incrementMinor;
    }
    sharedIndivisibleCapacityBound += rowEligibleDemand < capacityMinor ? rowEligibleDemand : capacityMinor;
    if (stockIncrement !== 1n) stockIncrement = quantityGreatestCommonDivisor(stockIncrement, incrementMinor);
    indivisibleGroups.push({
      positionIndex,
      capacityMinor: incrementMinor,
      count: slotCount,
      eligibleReservationCount,
    });
    if (indivisibleGroups.length > MAXIMUM_RESERVATION_FEASIBILITY_POSITIONS) {
      throw new InventoryReservationFeasibilityLimitError(
        "Reservation feasibility has too many indivisible stock groups; narrow the selectors."
      );
    }
  }
  indivisibleGroups.sort(compareReservationIndivisibleGroup);
  /** No assignment can exceed either total demand or available stock. */
  let fulfillableBound = totalRequested < totalCapacity ? totalRequested : totalCapacity;
  if (indivisibleGroups.length > 0) {
    // Only a claim's eligible loose stock can cover its remainder below the
    // next whole pick. Shared loose capacity still caps all claims together.
    let totalWholeDemand = 0n;
    let scopedDemandBound = 0n;
    for (let index = 0; index < requestedByReservation.length; index += 1) {
      const increment = wholeIncrementByReservation[index] ?? 0n;
      const requested = requestedByReservation[index] ?? 0n;
      const wholeDemand = increment === 0n ? 0n : requested - requested % increment;
      const scopedDemand = wholeDemand + (divisibleCapacityByReservation[index] ?? 0n);
      totalWholeDemand += wholeDemand;
      scopedDemandBound += scopedDemand < requested ? scopedDemand : requested;
    }
    const sharedDemandBound = totalWholeDemand + divisibleCapacity;
    const sharedRowBound = sharedIndivisibleCapacityBound + divisibleCapacity;
    if (scopedDemandBound < fulfillableBound) fulfillableBound = scopedDemandBound;
    if (sharedDemandBound < fulfillableBound) fulfillableBound = sharedDemandBound;
    if (sharedRowBound < fulfillableBound) fulfillableBound = sharedRowBound;
    if (fulfillableBound > 0n) {
      const flowBound = maximumBoundedReservationFulfillmentFlow(
        positions,
        requestedByReservation,
        edgeCapacityByReservation,
        wholeIncrementByReservation,
        decimals,
        fulfillableBound
      );
      if (flowBound < fulfillableBound) fulfillableBound = flowBound;
    }
    if (divisibleCapacity === 0n && stockIncrement > 1n) fulfillableBound -= fulfillableBound % stockIncrement;
    if (divisibleCapacity === 0n && eligibleIndivisibleCapacity > fulfillableBound) {
      const minimumUnused = eligibleIndivisibleCapacity - fulfillableBound;
      const tightenedUnused = minimumReachableIndivisibleSlack({
        indivisibleGroups,
        eligibleIndivisibleCapacity,
        minimumUnused,
        stockIncrement,
        smallestEligiblePack,
      });
      if (
        tightenedUnused > minimumUnused &&
        eligibleIndivisibleCapacity - tightenedUnused < fulfillableBound
      ) {
        fulfillableBound = eligibleIndivisibleCapacity - tightenedUnused;
      }
    }
  }
  return {
    decimals,
    requestedMinor: totalRequested,
    fulfillableMinor: maximumReservationAssignmentWithIndivisibleGroups(
      positions,
      indivisibleGroups,
      requestedByReservation,
      edgeCapacityByReservation,
      decimals,
      divisibleCapacity,
      fulfillableBound
    ),
  };
}

/** Maximum increment units checked for exact indivisible slack reachability before keeping coarse bounds. */
const MAXIMUM_INDIVISIBLE_SLACK_DP_UNITS = 8_192n;

/** Inputs for tightening the whole-pack bound when the required unused gap is unreachable. */
interface MinimumReachableIndivisibleSlackInput {
  /** Eligible whole-pack and serial groups available on this reservation axis. */
  readonly indivisibleGroups: readonly ReservationIndivisibleGroup[];
  /** Total stock capacity across eligible indivisible groups. */
  readonly eligibleIndivisibleCapacity: bigint;
  /** Minimum capacity that any bound-achieving whole assignment must leave unused. */
  readonly minimumUnused: bigint;
  /** Greatest common divisor of eligible indivisible increments. */
  readonly stockIncrement: bigint;
  /** Smallest single indivisible pack size among eligible groups. */
  readonly smallestEligiblePack: bigint;
}

/** Return the smallest slack >= minimumUnused formable from eligible whole packs, or a safe lower bound. */
function minimumReachableIndivisibleSlack({
  indivisibleGroups,
  eligibleIndivisibleCapacity,
  minimumUnused,
  stockIncrement,
  smallestEligiblePack,
}: MinimumReachableIndivisibleSlackInput): bigint {
  if (minimumUnused <= 0n || stockIncrement <= 0n) return minimumUnused;
  const minimumUnits = (minimumUnused + stockIncrement - 1n) / stockIncrement;
  if (minimumUnits > MAXIMUM_INDIVISIBLE_SLACK_DP_UNITS) {
    return smallestEligiblePack > minimumUnused ? smallestEligiblePack : minimumUnused;
  }
  const minimumUnitsNumber = Number(minimumUnits);
  /** Best reachable unused unit count >= minimumUnits found so far. */
  let bestUnits = eligibleIndivisibleCapacity / stockIncrement;
  /** Aggregate bounded pack counts by increment multiple below minimumUnits. */
  const countsBySmallWeight = new Map<number, number>();
  for (const group of indivisibleGroups) {
    if (group.count <= 0n) continue;
    const weight = group.capacityMinor / stockIncrement;
    if (weight >= minimumUnits) {
      if (weight < bestUnits) bestUnits = weight;
      continue;
    }
    const weightNumber = Number(weight);
    const prior = countsBySmallWeight.get(weightNumber) ?? 0;
    const add = group.count > minimumUnits ? minimumUnitsNumber : Number(group.count);
    const combined = prior + add;
    countsBySmallWeight.set(
      weightNumber,
      combined > minimumUnitsNumber ? minimumUnitsNumber : combined
    );
  }
  if (countsBySmallWeight.size === 0) return bestUnits * stockIncrement;
  const reachable = new Uint8Array(minimumUnitsNumber);
  reachable[0] = 1;
  const used = new Int32Array(minimumUnitsNumber);
  for (const [weightNumber, availableCount] of countsBySmallWeight) {
    used.fill(0);
    for (let sum = 0; sum < minimumUnitsNumber; sum += 1) {
      if (reachable[sum] === 1) {
        used[sum] = 0;
      } else if (
        sum >= weightNumber &&
        reachable[sum - weightNumber] === 1 &&
        used[sum - weightNumber]! < availableCount
      ) {
        reachable[sum] = 1;
        used[sum] = used[sum - weightNumber]! + 1;
      }
      if (reachable[sum] === 1 && used[sum]! < availableCount) {
        const nextSum = BigInt(sum + weightNumber);
        if (nextSum >= minimumUnits && nextSum < bestUnits) bestUnits = nextSum;
      }
    }
  }
  return bestUnits * stockIncrement;
}

/** Inputs for the sparse exact-allocation feasibility fast path. */
interface ExactReservationGroupFeasibilityInput {
  /** Exact claims competing on one revision/axis. */
  readonly reservations: readonly InventoryReservation[];
  /** Allocation lists frozen once by reservation index. */
  readonly allocationsByReservation: readonly (readonly InventoryReservationAllocation[])[];
  /** Positive eligible positions retained by at least one exact claim. */
  readonly positions: readonly ReservationFeasibilityPosition[];
  /** Current published projection used for expiry/selector checks. */
  readonly projection: InventoryProjectionState;
  /** Authority time for eligibility. */
  readonly atEpochMs: number;
  /** Shared exact decimal scale. */
  readonly decimals: number;
}

/**
 * Solve an exact-only claim group without materializing a dense claim × position graph.
 * Each claim freezes its position ceilings. On each position, sum the legal
 * quantity under each ceiling and cap the result by the current capacity.
 */
function exactReservationGroupFeasibility({
  reservations,
  allocationsByReservation,
  positions,
  projection,
  atEpochMs,
  decimals,
}: ExactReservationGroupFeasibilityInput): ReservationGroupFeasibility {
  const stockByIdentity = new Map<string, {
    /** Available shared-scale quantity after deficit burden. */
    readonly capacity: bigint;
    /** Shared-scale size of one current whole pick, when the position is indivisible. */
    readonly increment: bigint | undefined;
  }>();
  for (const position of positions) {
    stockByIdentity.set(position.identity, {
      capacity: quantityAtDecimals(position.capacity, decimals),
      increment: position.indivisibleIncrement === undefined
        ? undefined
        : quantityAtDecimals(position.indivisibleIncrement, decimals),
    });
  }
  /** Sum only legal portions of the frozen claims competing for each row. */
  const allocatedByPositionIdentity = new Map<string, bigint>();
  let totalRequested = 0n;
  for (
    let reservationIndex = 0;
    reservationIndex < reservations.length;
    reservationIndex += 1
  ) {
    const reservation = reservations[reservationIndex];
    const allocations = allocationsByReservation[reservationIndex];
    if (reservation === undefined || allocations === undefined) continue;
    const requested = quantityAtDecimals(reservation.requested, decimals);
    totalRequested += requested;
    let allocationTotal = 0n;
    for (const allocation of allocations) {
      const allocationMinor = quantityAtDecimals(allocation.quantity, decimals);
      allocationTotal += allocationMinor;
      const identity = inventoryStockPositionIdentity(allocation.position);
      const stock = stockByIdentity.get(identity);
      if (
        stock === undefined ||
        !reservationPositionEligible(
          reservation,
          projection,
          allocation.position,
          atEpochMs
        )
      ) {
        continue;
      }
      // Round each claim before summing so two partial claims cannot share a whole unit.
      const legalAllocation = stock.increment === undefined
        ? allocationMinor
        : allocationMinor - allocationMinor % stock.increment;
      allocatedByPositionIdentity.set(
        identity,
        (allocatedByPositionIdentity.get(identity) ?? 0n) + legalAllocation
      );
    }
    if (allocationTotal !== requested) {
      throw new Error(
        `Exact reservation '${reservation.reservationId}' allocations no longer equal its requested quantity.`
      );
    }
  }

  let fulfillable = 0n;
  for (const [identity, { capacity }] of stockByIdentity) {
    const allocated = allocatedByPositionIdentity.get(identity) ?? 0n;
    fulfillable += allocated < capacity ? allocated : capacity;
  }
  return {
    decimals,
    requestedMinor: totalRequested,
    fulfillableMinor:
      fulfillable < totalRequested ? fulfillable : totalRequested,
  };
}

/** Freeze one reservation to the exact item revision that defines its requested axis. */
function freezeReservationEligibleItemRevisions(
  catalog: InventoryCatalog,
  itemRevisionId: string,
  rawSelector: InventoryStockSelector
): InventoryStockSelector {
  const item = catalog.itemRevision(itemRevisionId);
  const selector = normalizeInventoryStockSelector(rawSelector);
  if (selector.itemId !== item.itemId) {
    throw new Error(
      "Reservation selector item differs from frozen item revision."
    );
  }
  for (const eligibleRevisionId of selector.itemRevisionIds ?? [
    itemRevisionId,
  ]) {
    const eligible = catalog.itemRevision(eligibleRevisionId);
    if (eligible.itemId !== item.itemId) {
      throw new Error(
        "Reservation selector item revision belongs to a different item."
      );
    }
    // The catalogue has no immutable cross-revision interchangeability declaration, so fail closed.
    if (eligible.revisionId !== itemRevisionId) {
      throw new Error(
        "Reservation selector cannot span item revisions without a declared compatibility relation."
      );
    }
  }
  return normalizeInventoryStockSelector({
    ...selector,
    itemRevisionIds: [itemRevisionId],
  });
}

/** Resolve direct-placement pools whose positive stock can back this competing claim group. */
function reservationFeasibilityPlacementNodeIds(
  projection: InventoryProjectionState,
  reservations: readonly InventoryReservation[],
  allocationsByReservation: readonly (readonly InventoryReservationAllocation[])[],
  revisionId: string
): readonly string[] {
  const placementNodeIds = new Set<string>();
  let includeEveryPlacementNode = false;
  for (
    let reservationIndex = 0;
    reservationIndex < reservations.length;
    reservationIndex += 1
  ) {
    const reservation = reservations[reservationIndex];
    const allocations = allocationsByReservation[reservationIndex];
    if (reservation === undefined || allocations === undefined) continue;
    if (allocations.length > 0) {
      for (const allocation of allocations) {
        if (allocation.position.placementNodeId !== undefined) {
          placementNodeIds.add(allocation.position.placementNodeId);
        }
      }
      continue;
    }
    const exactPlacementNodeIds = reservation.selector.placementNodeIds;
    const subtreeRootNodeIds = reservation.selector.withinPlacementNodeIds;
    if (
      exactPlacementNodeIds === undefined &&
      subtreeRootNodeIds === undefined
    ) {
      includeEveryPlacementNode = true;
      continue;
    }
    // Resolve only relevant direct deficit pools; large empty subtrees do not
    // contribute capacity and must not trigger a descendant graph walk.
    for (const placementNodeId of inventorySelectedDeficitPlacementNodeIds(
      projection,
      reservation.selector,
      revisionId
    )) {
      placementNodeIds.add(placementNodeId);
    }
  }
  if (includeEveryPlacementNode) {
    for (const positionIdentity of inventorySparseRecordValue(
      projection.positionIdsByItemRevisionId,
      revisionId
    ) ?? []) {
      const position = projection.positions[positionIdentity];
      if (position === undefined) {
        throw new Error(
          `Reservation item-revision index references missing position ${positionIdentity}.`
        );
      }
      if (position.key.placementNodeId !== undefined) {
        placementNodeIds.add(position.key.placementNodeId);
      }
    }
  }
  const ordered = [...placementNodeIds];
  ordered.sort();
  return ordered;
}

/** Mark package/serial rows with the smallest amount one legal issue can take. */
function createIndivisibleReservationIncrement(
  catalog: InventoryCatalog,
  position: InventoryStockPositionKey,
  axisId: string,
  capacity: Quantity
): Pick<ReservationFeasibilityPosition, "indivisibleIncrement"> {
  if (position.serialId !== undefined) {
    return { indivisibleIncrement: capacity };
  }
  const packagingRevisionId = position.packagingRevisionId;
  if (packagingRevisionId === undefined) return {};
  const packaging = catalog.packagingRevision(packagingRevisionId);
  const fixed = inventoryMeasurementAt(packaging.fixedContents, axisId, capacity.unit);
  return {
    // An unfixed independent measure is only known for the intact row.
    indivisibleIncrement: fixed.amountMinor > 0 ? fixed : capacity,
  };
}

/** Bound the whole stock still available after earlier groups have been assigned. */
interface ReservationWholeStockBound {
  /** Total shared-scale quantity in the remaining whole groups. */
  readonly capacityMinor: bigint;
  /** Greatest common divisor of those groups' shared-scale increments. */
  readonly incrementMinor: bigint;
}

/** Bound how much of the remaining claims this branch could still fill. */
function remainingReservationAssignmentCeiling(
  remainingDemand: readonly bigint[],
  wholeStock: ReservationWholeStockBound | undefined,
  divisibleCapacity: bigint
): bigint {
  const increment = wholeStock?.incrementMinor ?? 0n;
  let totalDemand = 0n;
  let wholeDemand = 0n;
  // A claim's whole assignment is a multiple of the remaining increments' GCD.
  for (const demand of remainingDemand) {
    totalDemand += demand;
    if (increment > 1n) wholeDemand += demand - demand % increment;
  }
  if (increment === 1n) wholeDemand = totalDemand;
  const wholeCapacity = wholeStock?.capacityMinor ?? 0n;
  const boundedWhole = wholeDemand < wholeCapacity ? wholeDemand : wholeCapacity;
  const remainingCapacity = boundedWhole + divisibleCapacity;
  return totalDemand < remainingCapacity ? totalDemand : remainingCapacity;
}

/** Stock and claim capacities after assigning one prefix of the stock groups. */
interface ReservationAssignmentBranch {
  /** First unassigned stock group. */
  readonly groupIndex: number;
  /** Exact unfilled demand by claim. */
  readonly remainingDemand: readonly bigint[];
  /** Original legal capacity between each claim and each stock position; child branches never modify it because each group owns one distinct position column and the leaf flow skips indivisible columns. */
  readonly edgeCapacityByReservation: readonly (readonly bigint[])[];
  /** Exact quantity assigned by the prefix. */
  readonly assignedMinor: bigint;
}

/** Assign whole packages and serials exactly, pruning branches that cannot improve the witness. */
function maximumReservationAssignmentWithIndivisibleGroups(
  positions: readonly ReservationFeasibilityPosition[],
  groups: readonly ReservationIndivisibleGroup[],
  requestedByReservation: readonly bigint[],
  edgeCapacityByReservation: readonly bigint[][],
  decimals: number,
  divisibleCapacity: bigint,
  fulfillableUpperBound: bigint
): bigint {
  /** Precompute stock and increments for each suffix of the existing search order. */
  const wholeStockByGroup: ReservationWholeStockBound[] = [];
  let suffixCapacity = 0n;
  let suffixIncrement = 0n;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === undefined) continue;
    suffixCapacity += group.count * group.capacityMinor;
    if (suffixIncrement !== 1n) {
      suffixIncrement = quantityGreatestCommonDivisor(suffixIncrement, group.capacityMinor);
    }
    wholeStockByGroup[index] = { capacityMinor: suffixCapacity, incrementMinor: suffixIncrement };
  }
  let best = 0n;
  let exploredStates = 0;
  const seen = new Set<string>();
  /** Yield one branch at a time in the original large-assignment-first order. */
  function* assignGroup({
    groupIndex, remainingDemand, edgeCapacityByReservation: edgeMatrix, assignedMinor,
  }: ReservationAssignmentBranch): Generator<ReservationAssignmentBranch> {
    if (best === fulfillableUpperBound) return;
    exploredStates += 1;
    if (exploredStates > MAXIMUM_RESERVATION_FEASIBILITY_STATES) {
      throw new InventoryReservationFeasibilityLimitError(
        "Reservation indivisible assignment exceeded its safe search bound; narrow the selectors."
      );
    }
    // Count even pruned visits so enumerating distributions remains bounded.
    const branchCeiling = groupIndex === 0
      ? fulfillableUpperBound
      : assignedMinor + remainingReservationAssignmentCeiling(
          remainingDemand, wholeStockByGroup[groupIndex], divisibleCapacity
        );
    if (best >= branchCeiling) return;
    // Each group consumes its own position column, so the edge matrix is constant for this search.
    const stateIdentity = inventoryIntentFingerprint([
      groupIndex,
      remainingDemand.map(String),
    ]);
    if (seen.has(stateIdentity)) return;
    seen.add(stateIdentity);
    if (groupIndex === groups.length) {
      const continuous = maximumContinuousReservationFlow(
        positions,
        remainingDemand,
        edgeMatrix,
        decimals
      );
      const fulfillable = assignedMinor + continuous;
      if (fulfillable > best) best = fulfillable;
      return;
    }
    const group = groups[groupIndex];
    if (group === undefined) return;
    const laterCapacity = (wholeStockByGroup[groupIndex + 1]?.capacityMinor ?? 0n) + divisibleCapacity;
    for (const assignedCounts of assignIndivisibleGroupCounts(
      group,
      remainingDemand,
      edgeMatrix,
      assignedMinor + laterCapacity,
      /** Read the best total found so far so deeper group recursion can prune against it. */
      () => best
    )) {
      if (best === fulfillableUpperBound) return;
      const nextDemand = [...remainingDemand];
      let groupAssignedMinor = 0n;
      for (
        let reservationIndex = 0;
        reservationIndex < assignedCounts.length;
        reservationIndex += 1
      ) {
        const assignedCount = assignedCounts[reservationIndex] ?? 0n;
        if (assignedCount === 0n) continue;
        const assignedForReservation = assignedCount * group.capacityMinor;
        const demand = nextDemand[reservationIndex];
        const edgeCapacity = edgeMatrix[reservationIndex]?.[group.positionIndex];
        if (demand === undefined || edgeCapacity === undefined) {
          throw new Error(
            "Reservation grouped assignment lost one claim/position capacity."
          );
        }
        nextDemand[reservationIndex] = demand - assignedForReservation;
        groupAssignedMinor += assignedForReservation;
      }
      if (assignedMinor + groupAssignedMinor + laterCapacity <= best) return;
      yield {
        groupIndex: groupIndex + 1,
        remainingDemand: nextDemand,
        edgeCapacityByReservation: edgeMatrix,
        assignedMinor: assignedMinor + groupAssignedMinor,
      };
      if (best >= branchCeiling || best === fulfillableUpperBound) return;
    }
  }
  /** Suspend each group distribution while its child runs without nesting the runtime stack. */
  const branches = [assignGroup({
    groupIndex: 0, remainingDemand: requestedByReservation,
    edgeCapacityByReservation, assignedMinor: 0n,
  })];
  for (let branch = branches.at(-1); branch !== undefined; branch = branches.at(-1)) {
    const next = branch.next();
    if (next.done) branches.pop();
    else branches.push(assignGroup(next.value));
  }
  return best;
}

/** Enumerate the real integer distributions for one merged package/serial stock group. */
function assignIndivisibleGroupCounts(
  group: ReservationIndivisibleGroup,
  remainingDemand: readonly bigint[],
  edgeCapacityByReservation: readonly (readonly bigint[])[],
  basePlusLater: bigint,
  currentBest: () => bigint
): Generator<readonly bigint[]> {
  const assignedCounts = remainingDemand.map(
    /** Start every claim at zero pieces from this one stock group. */
    () => 0n
  );
  const maxPiecesByReservation = remainingDemand.map(
    /** Maximum pieces each claim can legally draw from this one stock group. */
    (demand, reservationIndex) => {
      const edgeCapacity = edgeCapacityByReservation[reservationIndex]?.[group.positionIndex] ?? 0n;
      const limit = demand < edgeCapacity ? demand : edgeCapacity;
      return limit / group.capacityMinor;
    }
  );
  /** Suffix sums of remaining claims' maximum pieces so monotonic pruning runs in O(1). */
  const maxFuturePieces = new Array<bigint>(remainingDemand.length).fill(0n);
  let suffix = 0n;
  for (let reservationIndex = remainingDemand.length - 1; reservationIndex >= 0; reservationIndex -= 1) {
    maxFuturePieces[reservationIndex] = suffix;
    suffix += maxPiecesByReservation[reservationIndex] ?? 0n;
  }
  /** Yield distributions over this group's bounded set of claims without recursing into other groups. */
  function* assignReservation(
    reservationIndex: number,
    remainingPieces: bigint,
    assignedPiecesSoFar: bigint
  ): Generator<readonly bigint[]> {
    if (reservationIndex === remainingDemand.length) {
      yield assignedCounts;
      return;
    }
    const maxForReservation = maxPiecesByReservation[reservationIndex] ?? 0n;
    const suffixMax = maxFuturePieces[reservationIndex] ?? 0n;
    let assignedPieces = remainingPieces < maxForReservation ? remainingPieces : maxForReservation;
    while (assignedPieces >= 0n) {
      const future = remainingPieces - assignedPieces;
      const maxRemaining = assignedPieces + (future < suffixMax ? future : suffixMax);
      if (basePlusLater + (assignedPiecesSoFar + maxRemaining) * group.capacityMinor <= currentBest()) {
        break;
      }
      assignedCounts[reservationIndex] = assignedPieces;
      yield* assignReservation(
        reservationIndex + 1,
        future,
        assignedPiecesSoFar + assignedPieces
      );
      if (assignedPieces === 0n) break;
      assignedPieces -= 1n;
    }
    assignedCounts[reservationIndex] = 0n;
  }
  return assignReservation(0, group.count, 0n);
}

/** Tight admissible fulfillment ceiling across all claims, whole increments, and capacities together. */
function maximumBoundedReservationFulfillmentFlow(
  positions: readonly ReservationFeasibilityPosition[],
  requestedByReservation: readonly bigint[],
  edgeCapacityByReservation: readonly (readonly bigint[])[],
  wholeIncrementByReservation: readonly bigint[],
  decimals: number,
  target: bigint
): bigint {
  const source = 0;
  const reservationCount = requestedByReservation.length;
  const firstReservationNode = 1;
  const firstWholeNode = firstReservationNode + reservationCount;
  const firstPositionNode = firstWholeNode + reservationCount;
  const sink = firstPositionNode + positions.length;
  const network = new BigIntFlowNetwork();
  const wholeCapacityByReservation = new Array<bigint>(reservationCount).fill(0n);
  const wholeDemandByReservation = new Array<bigint>(reservationCount).fill(0n);
  for (let reservationIndex = 0; reservationIndex < reservationCount; reservationIndex += 1) {
    const requested = requestedByReservation[reservationIndex] ?? 0n;
    const increment = wholeIncrementByReservation[reservationIndex] ?? 0n;
    wholeDemandByReservation[reservationIndex] =
      increment === 0n ? 0n : requested - (requested % increment);
    network.addEdge(source, firstReservationNode + reservationIndex, requested);
  }
  for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
    const candidate = positions[positionIndex];
    if (candidate === undefined) continue;
    const capacityMinor = quantityAtDecimals(candidate.capacity, decimals);
    const increment = candidate.indivisibleIncrement;
    const incrementMinor =
      increment === undefined ? undefined : quantityAtDecimals(increment, decimals);
    for (let reservationIndex = 0; reservationIndex < reservationCount; reservationIndex += 1) {
      const edgeCapacity = edgeCapacityByReservation[reservationIndex]?.[positionIndex] ?? 0n;
      if (edgeCapacity <= 0n) continue;
      const requested = requestedByReservation[reservationIndex] ?? 0n;
      const capped = edgeCapacity < requested ? edgeCapacity : requested;
      if (incrementMinor === undefined) {
        network.addEdge(
          firstReservationNode + reservationIndex,
          firstPositionNode + positionIndex,
          capped
        );
        continue;
      }
      const wholeEdge = capped - (capped % incrementMinor);
      if (wholeEdge <= 0n) continue;
      wholeCapacityByReservation[reservationIndex] =
        (wholeCapacityByReservation[reservationIndex] ?? 0n) + wholeEdge;
      network.addEdge(
        firstWholeNode + reservationIndex,
        firstPositionNode + positionIndex,
        wholeEdge
      );
    }
    network.addEdge(firstPositionNode + positionIndex, sink, capacityMinor);
  }
  for (let reservationIndex = 0; reservationIndex < reservationCount; reservationIndex += 1) {
    const wholeDemand = wholeDemandByReservation[reservationIndex] ?? 0n;
    const wholeAvailable = wholeCapacityByReservation[reservationIndex] ?? 0n;
    const wholeCap = wholeDemand < wholeAvailable ? wholeDemand : wholeAvailable;
    if (wholeCap > 0n) {
      network.addEdge(
        firstReservationNode + reservationIndex,
        firstWholeNode + reservationIndex,
        wholeCap
      );
    }
  }
  return network.maximumFlow(source, sink, target);
}

/** Run ordinary exact max-flow only across stock rows legal to divide on the reservation axis. */
function maximumContinuousReservationFlow(
  positions: readonly ReservationFeasibilityPosition[],
  remainingDemand: readonly bigint[],
  edgeCapacityByReservation: readonly (readonly bigint[])[],
  decimals: number
): bigint {
  const source = 0;
  const firstReservationNode = 1;
  const firstPositionNode = firstReservationNode + remainingDemand.length;
  const sink = firstPositionNode + positions.length;
  const network = new BigIntFlowNetwork();
  let target = 0n;
  for (
    let reservationIndex = 0;
    reservationIndex < remainingDemand.length;
    reservationIndex += 1
  ) {
    const demand = remainingDemand[reservationIndex] ?? 0n;
    target += demand;
    network.addEdge(source, firstReservationNode + reservationIndex, demand);
    for (
      let positionIndex = 0;
      positionIndex < positions.length;
      positionIndex += 1
    ) {
      const position = positions[positionIndex];
      if (position === undefined || position.indivisibleIncrement !== undefined)
        continue;
      const edgeCapacity =
        edgeCapacityByReservation[reservationIndex]?.[positionIndex] ?? 0n;
      if (edgeCapacity > 0n) {
        network.addEdge(
          firstReservationNode + reservationIndex,
          firstPositionNode + positionIndex,
          edgeCapacity
        );
      }
    }
  }
  for (
    let positionIndex = 0;
    positionIndex < positions.length;
    positionIndex += 1
  ) {
    const position = positions[positionIndex];
    if (position === undefined || position.indivisibleIncrement !== undefined)
      continue;
    network.addEdge(
      firstPositionNode + positionIndex,
      sink,
      quantityAtDecimals(position.capacity, decimals)
    );
  }
  return network.maximumFlow(source, sink, target);
}

/** Put constrained groups first, then larger pieces, so exact searches finish sooner. */
function compareReservationIndivisibleGroup(
  left: ReservationIndivisibleGroup,
  right: ReservationIndivisibleGroup
): number {
  if (left.eligibleReservationCount !== right.eligibleReservationCount) {
    return left.eligibleReservationCount - right.eligibleReservationCount;
  }
  if (left.capacityMinor > right.capacityMinor) return -1;
  if (left.capacityMinor < right.capacityMinor) return 1;
  return left.positionIndex - right.positionIndex;
}

/** Small exact-capacity residual network used to prove all claims can coexist. */
class BigIntFlowNetwork {
  /** Directed residual capacities keyed by from/to node. */
  private readonly residual = new Map<string, bigint>();
  /** Bidirectional adjacency used by breadth-first augmenting-path search. */
  private readonly adjacency = new Map<number, number[]>();

  /** Add one directed capacity and its zero-capacity reverse edge. */
  addEdge(from: number, to: number, capacity: bigint): void {
    if (capacity < 0n)
      throw new Error("Flow edge capacity must not be negative.");
    this.setResidual(from, to, this.readResidual(from, to) + capacity);
    if (!this.residual.has(flowEdgeIdentity(to, from)))
      this.setResidual(to, from, 0n);
    this.addNeighbor(from, to);
    this.addNeighbor(to, from);
  }

  /** Return maximum source/sink flow, stopping early once the target demand is met. */
  maximumFlow(source: number, sink: number, target: bigint): bigint {
    let total = 0n;
    while (total < target) {
      const parents = this.findAugmentingPath(source, sink);
      if (parents === undefined) break;
      let pathCapacity = target - total;
      let current = sink;
      while (current !== source) {
        const parent = parents.get(current);
        if (parent === undefined)
          throw new Error("Flow path lost one parent node.");
        const residual = this.readResidual(parent, current);
        if (residual < pathCapacity) pathCapacity = residual;
        current = parent;
      }
      current = sink;
      while (current !== source) {
        const parent = parents.get(current);
        if (parent === undefined)
          throw new Error("Flow path lost one parent node.");
        this.setResidual(
          parent,
          current,
          this.readResidual(parent, current) - pathCapacity
        );
        this.setResidual(
          current,
          parent,
          this.readResidual(current, parent) + pathCapacity
        );
        current = parent;
      }
      total += pathCapacity;
    }
    return total;
  }

  /** Find one positive-residual path using deterministic breadth-first traversal. */
  private findAugmentingPath(
    source: number,
    sink: number
  ): ReadonlyMap<number, number> | undefined {
    const parents = new Map<number, number>();
    parents.set(source, source);
    const queue = [source];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex];
      queueIndex += 1;
      if (current === undefined) continue;
      for (const next of this.adjacency.get(current) ?? []) {
        if (parents.has(next) || this.readResidual(current, next) <= 0n)
          continue;
        parents.set(next, current);
        if (next === sink) return parents;
        queue.push(next);
      }
    }
    return undefined;
  }

  /** Add one neighbor once while preserving deterministic insertion order. */
  private addNeighbor(node: number, neighbor: number): void {
    const neighbors = this.adjacency.get(node) ?? [];
    if (!neighbors.includes(neighbor)) neighbors.push(neighbor);
    this.adjacency.set(node, neighbors);
  }

  /** Read one directed residual capacity, defaulting missing edges to zero. */
  private readResidual(from: number, to: number): bigint {
    return this.residual.get(flowEdgeIdentity(from, to)) ?? 0n;
  }

  /** Write one directed residual capacity. */
  private setResidual(from: number, to: number, value: bigint): void {
    this.residual.set(flowEdgeIdentity(from, to), value);
  }
}

/** Stable map key for one directed flow edge. */
function flowEdgeIdentity(from: number, to: number): string {
  return `${from}:${to}`;
}

/** Convert one exact quantity into a bigint at a shared decimal scale. */
function quantityAtDecimals(value: InventoryWorkingQuantity, decimals: number): bigint {
  if (decimals < value.decimals) {
    throw new Error("Reservation flow scale cannot discard exact digits.");
  }
  return workingQuantityAtDecimals(value, decimals);
}

/** Stable normalized creation fingerprint including selector, quantity, provenance, and metadata. */
function newReservationFingerprint(
  reservation: NewInventoryReservation
): string {
  return inventoryIntentFingerprint([
    reservation.reservationId,
    reservation.operationId,
    reservation.itemRevisionId,
    inventoryStockSelectorIdentity(reservation.selector),
    quantityFingerprint(reservation.requested),
    reservation.createdAtEpochMs,
    reservation.expiresAtEpochMs ?? null,
    reservation.allowExpiredStock ?? false,
    reservation.sourceReference ?? null,
    reservation.actorId ?? null,
    inventoryMetadataFingerprint(reservation.metadata),
  ]);
}

/** Return an exact operation replay or throw when the same operation id changed intent. */
function findReservationOperationReplay(
  book: InventoryReservationBook,
  operationId: string,
  kind: InventoryReservationOperationKind,
  reservationId: string,
  fingerprint: string
): InventoryReservationBookResult | undefined {
  const earlier = inventorySparseRecordValue(book.operations, operationId);
  if (earlier === undefined) return undefined;
  if (
    earlier.kind !== kind ||
    earlier.reservationId !== reservationId ||
    earlier.intentFingerprint !== fingerprint
  ) {
    throw new Error("Reservation operationId was retried with changed intent.");
  }
  if (inventorySparseRecordValue(book.reservations, reservationId) === undefined) {
    throw new Error("Reservation operation references a missing reservation.");
  }
  return { book, reservation: earlier.reservationAfter, replayed: true };
}

/** Add one immutable lifecycle operation, rejecting accidental operation-id replacement. */
function addReservationOperation(
  book: InventoryReservationBook,
  reservation: InventoryReservation,
  operation: NewInventoryReservationOperation
): InventoryReservationBook {
  if (inventorySparseRecordValue(book.operations, operation.operationId) !== undefined) {
    throw new Error(
      `Reservation operation '${operation.operationId}' already exists.`
    );
  }
  let lifecycleSequence = 1;
  for (const earlier of Object.values(book.operations)) {
    lifecycleSequence = Math.max(
      lifecycleSequence,
      earlier.lifecycleSequence + 1
    );
  }
  const retainedOperation: InventoryReservationOperation = {
    ...operation,
    lifecycleSequence,
    reservationAfter: reservation,
  };
  const operations = cloneInventorySparseRecord(book.operations);
  setInventorySparseRecordValue(operations, operation.operationId, retainedOperation);
  return { reservations: book.reservations, operations };
}

/** Replace one current reservation row and append its immutable lifecycle operation together. */
function replaceReservationWithOperation(
  book: InventoryReservationBook,
  reservation: InventoryReservation,
  operation: NewInventoryReservationOperation
): InventoryReservationBook {
  const reservations = cloneInventorySparseRecord(book.reservations);
  setInventorySparseRecordValue(reservations, reservation.reservationId, reservation);
  return addReservationOperation(
    { reservations, operations: book.operations },
    reservation,
    operation
  );
}

/** Load one reservation and require it still counts as active at this exact time. */
function requireActiveReservation(
  book: InventoryReservationBook,
  reservationId: string,
  atEpochMs: number
): InventoryReservation {
  const reservation = inventorySparseRecordValue(book.reservations, reservationId);
  if (reservation === undefined)
    throw new Error("Unknown inventory reservation.");
  if (reservation.status !== InventoryReservationStatus.Active) {
    throw new Error("Inventory reservation is no longer active.");
  }
  assertReservationLifecycleTime(reservation, atEpochMs);
  if (!inventoryReservationIsActiveAt(reservation, atEpochMs)) {
    throw new Error("Inventory reservation is no longer active.");
  }
  return reservation;
}

/** Stable exact quantity fingerprint. */
function quantityFingerprint(value: Quantity): string {
  return inventoryIntentFingerprint([
    value.amountMinor,
    value.decimals,
    value.unit,
  ]);
}

/** Stable allocation-line fingerprint. */
function allocationFingerprint(
  allocation: InventoryReservationAllocation
): string {
  return inventoryIntentFingerprint([
    inventoryStockPositionIdentity(allocation.position),
    quantityFingerprint(allocation.quantity),
  ]);
}

/** Sort reservation allocations by exact position identity. */
function compareReservationAllocation(
  left: InventoryReservationAllocation,
  right: InventoryReservationAllocation
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Sort reservations by stable claim identity. */
function compareReservationIdentity(
  left: InventoryReservation,
  right: InventoryReservation
): number {
  return compareInventoryIdentityText(left.reservationId, right.reservationId);
}

/** Burden non-claimable stock first, then less-flexible reservation positions. */
function compareReservationDeficitBurdenPosition(
  left: ReservationDeficitBurdenPosition,
  right: ReservationDeficitBurdenPosition
): number {
  if (left.reservationCandidate !== right.reservationCandidate) {
    return left.reservationCandidate ? 1 : -1;
  }
  if (left.eligibleReservationCount !== right.eligibleReservationCount) {
    return left.eligibleReservationCount - right.eligibleReservationCount;
  }
  return compareInventoryIdentityText(left.identity, right.identity);
}

/** Sort feasibility positions by exact position identity. */
function compareFeasibilityPosition(
  left: ReservationFeasibilityPosition,
  right: ReservationFeasibilityPosition
): number {
  return compareInventoryIdentityText(left.identity, right.identity);
}

/** Sort read-side feasibility groups by stable item/axis/unit identity. */
function compareReservationFeasibilityGroup(
  left: InventoryReservationFeasibilityGroup,
  right: InventoryReservationFeasibilityGroup
): number {
  return compareInventoryIdentityText([left.itemId, left.axisId, left.requested.unit]
    .join("|"), [right.itemId, right.axisId, right.requested.unit].join("|"));
}
