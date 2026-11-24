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
/** Transitive historical replay for adapters that page retained dependency postings. */
export {
  loadInventoryHistoricalDependencyComponent,
  type InventoryHistoricalDependencyReader,
  type LoadInventoryHistoricalDependencyComponentInput,
} from "./historical-dependencies.js";
/** Prepare ordinary stock movements on a scoped read and decode saved batch picks. */
export {
  inventoryPolicyBatchAllocationsFromEvent,
  prepareInventoryPolicyIssueBatch,
  prepareInventoryPolicyScrap,
  prepareInventoryPolicyTransferBatch,
  readInventoryPolicyBatchResult,
  type InventoryPolicyBatchPlanningScope,
  type PrepareInventoryPolicyIssueBatchInput,
  type PrepareInventoryPolicyScrapInput,
  type PrepareInventoryPolicyTransferBatchInput,
  type PreparedInventoryPolicyIssueBatch,
} from "./facade.js";
/** Plan the existing direct-contents command from the adapter's fenced stock and topology facts. */
export {
  createInventoryDirectContentsMoveEvent,
  type CreateInventoryDirectContentsMoveEventInput,
} from "./facade.js";
/** Finish a physical count using the adapter's observation-time exact bucket. */
export {
  createInventoryExactCountReconciliationPlan,
  exactCountSelectorForPosition,
  type CreateInventoryExactCountReconciliationPlanInput,
} from "./counts.js";
