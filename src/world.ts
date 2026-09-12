import {
  emptyInventoryCatalogSnapshot,
  type InventoryCatalogSnapshot,
} from "./catalog.js";
import {
  emptyInventoryCountBook,
  type InventoryCountBook,
} from "./counts.js";
import {
  emptyInventoryProjectionState,
  type InventoryProjectionState,
} from "./projection.js";
import {
  emptyInventoryReservationBook,
  type InventoryReservationBook,
} from "./reservations.js";

/** One fully published InventoryOnce world revision. */
export interface InventoryWorldState {
  /** Monotonic completed-operation revision; pending writes never advance it. */
  readonly revision: number;
  /** Durable item/package definitions that give every retained revision id its original meaning. */
  readonly catalog: InventoryCatalogSnapshot;
  /** Rebuildable physical stock/event/traceability projection. */
  readonly projection: InventoryProjectionState;
  /** Current claims/reservations plus their lifecycle operation evidence. */
  readonly reservations: InventoryReservationBook;
  /** Current physical-count rows plus their lifecycle operation evidence. */
  readonly counts: InventoryCountBook;
}

/** Create the empty revision-zero inventory world. */
export function emptyInventoryWorldState(): InventoryWorldState {
  return {
    revision: 0,
    catalog: emptyInventoryCatalogSnapshot(),
    projection: emptyInventoryProjectionState(),
    reservations: emptyInventoryReservationBook(),
    counts: emptyInventoryCountBook(),
  };
}
