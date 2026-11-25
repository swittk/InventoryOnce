import { summarizeInventoryPhysicalAvailability } from "./availability.js";
import type { InventoryPhysicalAvailabilityRevisionSummary } from "./availability.js";
import { inventoryCatalogFromSnapshot, type InventoryCatalog } from "./catalog.js";
import { inventoryRecordedDeficitPoolSelector } from "./deficits.js";
import { assertInventoryEpochMilliseconds } from "./events.js";
import { normalizeInventoryStockSelector, type InventoryStockSelector } from "./selectors.js";
import type { InventorySegmentedStockPlanningCapability } from "./storage.js";

/** Input to a physical availability read over one revision and its affected pools. */
export interface ReadInventoryScopedStockAvailabilityInput {
  /** Existing native storage publication and indexed stock read capability. */
  readonly storage: InventorySegmentedStockPlanningCapability;
  /** Configured catalogue, used at genesis before a catalogue is published. */
  readonly catalog: InventoryCatalog;
  /** Physical selection, including direct placement, subtree, lot, or package constraints. */
  readonly selector: InventoryStockSelector;
  /** Exact item revision whose quantities and reservation axis are reported. */
  readonly itemRevisionId: string;
  /** Authority time for lot/ancestor expiry and exact holds. */
  readonly atEpochMs: number;
}

/** Report physical availability and exact holds without enumerating the global claim book. */
export async function readInventoryScopedStockAvailability({
  storage,
  catalog: configuredCatalog,
  selector: rawSelector,
  itemRevisionId,
  atEpochMs,
}: ReadInventoryScopedStockAvailabilityInput): Promise<InventoryPhysicalAvailabilityRevisionSummary> {
  assertInventoryEpochMilliseconds(atEpochMs, "inventory availability authority time");
  const selector = normalizeInventoryStockSelector(rawSelector);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await storage.readSegmentedStockHead();
    const catalog = head.worldRevision === 0 ? configuredCatalog : inventoryCatalogFromSnapshot(head.catalog);
    const item = catalog.itemRevision(itemRevisionId);
    if (item.itemId !== selector.itemId || (selector.itemRevisionIds !== undefined &&
        !selector.itemRevisionIds.includes(itemRevisionId))) {
      throw new Error("Inventory availability item revision is outside the selector.");
    }
    const pool = await storage.readSegmentedStockPool({
      selector: inventoryRecordedDeficitPoolSelector(selector, itemRevisionId, selector.placementNodeIds ?? []),
      itemRevisionId,
      reservationAtEpochMs: atEpochMs,
      exactHoldsOnly: true,
    });
    if ((await storage.readSegmentedStockHead()).worldRevision !== head.worldRevision) continue;
    return summarizeInventoryPhysicalAvailability({ catalog, selector, item, pool, atEpochMs });
  }
  throw new Error("Inventory availability could not read a current stock revision.");
}
