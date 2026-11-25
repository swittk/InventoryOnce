import { inventoryStockPositionIdentity, type InventoryStockPosition } from "./model.js";
import {
  InventoryReservationStatus,
  type InventoryReservation,
  type InventoryReservationBook,
  type InventoryReservationOperation,
} from "./reservations.js";

/** Claim evidence requested for one signed stock pool. */
interface InventoryStockClaimsForPoolInput {
  /** Exact item revision whose lifecycle evidence is relevant. */
  readonly revisionId: string;
  /** Current signed positions whose exact holds are needed. */
  readonly positions: readonly InventoryStockPosition[];
  /** Authority time used to select the applicable lifecycle state. */
  readonly atEpochMs: number;
  /** Exclude broad claims when only position-bound hold evidence is needed. */
  readonly exactHoldsOnly: boolean;
}

/** Index current exact bindings for stock picking while retaining scoped historical claim lookup. */
export class InventoryStockClaimIndex {
  /** Current active exact claims grouped by the positions they bind. */
  private readonly exact = new Map<string, Map<string, InventoryReservation>>();
  /** Current broad claims grouped by their frozen revision. */
  private readonly broad = new Map<string, Map<string, InventoryReservation>>();
  /** Two longest-lived current broad claims per revision, enough to exclude one own claim. */
  private readonly broadLeaders = new Map<string, readonly InventoryReservation[]>();
  /** Newest lifecycle occurrence in each revision, used only for time-travel reads. */
  private readonly latestByRevision = new Map<string, number>();
  /** Retained lifecycle history indexed by revision for an explicitly earlier claim time. */
  private readonly historyByRevision = new Map<string, InventoryReservationOperation[]>();

  /** Seed the index when opening a canonical snapshot or publishing an explicit migration. */
  constructor(book: InventoryReservationBook) {
    for (const reservation of Object.values(book.reservations)) this.indexCurrent(reservation, true);
    for (const revisionId of this.broad.keys()) this.refreshBroadLeaders(revisionId);
    for (const operation of Object.values(book.operations)) this.retainHistory(operation);
  }

  /** Change only the affected claim postings at the published world revision. */
  publish(operation: InventoryReservationOperation, previous: InventoryReservation | undefined): void {
    if (previous !== undefined) this.indexCurrent(previous, false);
    this.indexCurrent(operation.reservationAfter, true);
    this.retainHistory(operation);
    const next = operation.reservationAfter;
    if (previous?.allocations.length === 0 || next.allocations.length === 0) {
      // Only an explicit claim action changes these representatives. Stock writes never scan this book.
      this.refreshBroadLeaders(next.itemRevisionId);
    }
  }

  /** Resolve the relevant exact holds and revision-wide broad indicator at the queried time. */
  forPool({
    revisionId, positions, atEpochMs, exactHoldsOnly,
  }: InventoryStockClaimsForPoolInput): readonly InventoryReservation[] {
    if (atEpochMs < (this.latestByRevision.get(revisionId) ?? 0)) {
      // Historical replay is confined to the requested revision and uses the retained lifecycle order.
      const latest = new Map<string, InventoryReservationOperation>();
      for (const operation of this.historyByRevision.get(revisionId) ?? []) {
        if (operation.reservationAfter.lastChangedAtEpochMs > atEpochMs) continue;
        const prior = latest.get(operation.reservationId);
        if (prior === undefined || prior.lifecycleSequence < operation.lifecycleSequence) {
          latest.set(operation.reservationId, operation);
        }
      }
      const positionIds = new Set<string>();
      for (const position of positions) {
        positionIds.add(inventoryStockPositionIdentity(position.key));
      }
      const reservations: InventoryReservation[] = [];
      for (const { reservationAfter: reservation } of latest.values()) {
        if (reservation.status !== InventoryReservationStatus.Active) continue;
        if (reservation.allocations.length === 0) {
          if (!exactHoldsOnly) reservations.push(reservation);
          continue;
        }
        for (const allocation of reservation.allocations) {
          if (!positionIds.has(inventoryStockPositionIdentity(allocation.position))) continue;
          reservations.push(reservation);
          break;
        }
      }
      return reservations;
    }
    const reservations = new Map<string, InventoryReservation>();
    if (!exactHoldsOnly) {
      for (const reservation of this.broadLeaders.get(revisionId) ?? []) {
        reservations.set(reservation.reservationId, reservation);
      }
    }
    for (const position of positions) {
      for (const [id, reservation] of this.exact.get(inventoryStockPositionIdentity(position.key)) ?? []) {
        reservations.set(id, reservation);
      }
    }
    return [...reservations.values()];
  }

  /** Retain the two furthest expiries to answer a broad-presence query without unrelated claim reads. */
  private refreshBroadLeaders(revisionId: string): void {
    const leaders: InventoryReservation[] = [];
    for (const reservation of this.broad.get(revisionId)?.values() ?? []) {
      const expiry = reservation.expiresAtEpochMs ?? Infinity;
      const first = leaders[0];
      if (first === undefined || expiry > (first.expiresAtEpochMs ?? Infinity)) {
        leaders.unshift(reservation);
        if (leaders.length > 2) leaders.pop();
      } else {
        const second = leaders[1];
        if (second === undefined || expiry > (second.expiresAtEpochMs ?? Infinity)) leaders[1] = reservation;
      }
    }
    if (leaders.length > 0) this.broadLeaders.set(revisionId, leaders);
    else this.broadLeaders.delete(revisionId);
  }

  /** Keep the exact historical operation, without constructing a second claim book. */
  private retainHistory(operation: InventoryReservationOperation): void {
    const { itemRevisionId, lastChangedAtEpochMs } = operation.reservationAfter;
    let operations = this.historyByRevision.get(itemRevisionId);
    if (operations === undefined) {
      operations = [];
      this.historyByRevision.set(itemRevisionId, operations);
    }
    operations.push(operation);
    if (lastChangedAtEpochMs > (this.latestByRevision.get(itemRevisionId) ?? 0)) {
      this.latestByRevision.set(itemRevisionId, lastChangedAtEpochMs);
    }
  }

  /** Add or remove one active row from exactly its current postings. */
  private indexCurrent(reservation: InventoryReservation, add: boolean): void {
    if (reservation.status !== InventoryReservationStatus.Active) return;
    if (reservation.allocations.length === 0) {
      updateStockClaimMembership(this.broad, reservation.itemRevisionId, reservation, add);
      return;
    }
    for (const allocation of reservation.allocations) {
      updateStockClaimMembership(this.exact, inventoryStockPositionIdentity(allocation.position), reservation, add);
    }
  }
}

/** Update one exact posting and retire the empty index key on claim closure. */
function updateStockClaimMembership(
  index: Map<string, Map<string, InventoryReservation>>,
  key: string,
  reservation: InventoryReservation,
  add: boolean
): void {
  const existing = index.get(key);
  if (add) {
    if (existing === undefined) index.set(key, new Map([[reservation.reservationId, reservation]]));
    else existing.set(reservation.reservationId, reservation);
  } else if (existing !== undefined) {
    existing.delete(reservation.reservationId);
    if (existing.size === 0) index.delete(key);
  }
}
