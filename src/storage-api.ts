/** Segmented append-only journal contracts for database/native storage adapters. */
export * from "./segmented-journal.js";
/** Segmented indexed hot-state contracts for database/native storage adapters. */
export * from "./segmented-state.js";
/** Segmented generic placement-forest contracts for native/database adapters. */
export * from "./segmented-placement.js";
/** Durable storage contracts, guarantees, failpoints, and reference memory adapter. */
export * from "./storage.js";
/** Generic durable operation coordinator used by storage adapters/conformance tests. */
export * from "./coordinator.js";
/** Compact-plan deltas and exact content roots adapters/conformance tests must preserve. */
export * from "./integrity.js";
/** Published world shape persisted by a durable adapter. */
export * from "./world.js";

/** Exact signed stock and claim evidence returned by indexed planning adapters. */
export type { InventoryScopedStockPool, InventoryScopedStockPosition } from "./stock-scope.js";

/** Scoped physical availability for indexed stock/lot readers. */
export { readInventoryScopedStockAvailability, type ReadInventoryScopedStockAvailabilityInput } from "./scoped-availability.js";
export type { InventoryPhysicalAvailabilityRevisionSummary } from "./availability.js";
