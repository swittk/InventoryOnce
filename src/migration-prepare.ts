import {
  assertInventoryCatalogRetainsSnapshot,
  inventoryCatalogSnapshot,
  type InventoryCatalog,
} from "./catalog.js";
import { inventoryIntentFingerprint, inventoryMetadataFingerprint } from "./canonical.js";
import { inventorySha256 } from "./digest.js";
import {
  assertInventoryEpochMilliseconds,
  commitInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
} from "./events.js";
import { inventoryDurableMigrationPlanDigest, inventoryWorldContentRoots } from "./integrity.js";
import { inventoryMigrationSourceDispositionFingerprint } from "./migration-evidence.js";
import type { InventoryMigrationPlan } from "./migrations.js";
import { applyInventoryCommittedEvent, InventoryDeficitPolicy } from "./projection.js";
import type { BeginInventoryMigrationManifestInput, InventoryDurableMigrationPlan } from "./storage.js";
import type { InventoryWorldState } from "./world.js";

/** Build the exact begin request shared by world-backed migration and indexed cutover. */
export function createInventoryMigrationManifestBeginInput(
  catalog: InventoryCatalog,
  baseWorld: InventoryWorldState,
  plan: InventoryMigrationPlan,
  recordedAtEpochMs: number,
): BeginInventoryMigrationManifestInput {
  assertInventoryEpochMilliseconds(recordedAtEpochMs, "inventory migration durable record time");
  const frozen = createDurableInventoryMigrationPlan(catalog, baseWorld, plan, recordedAtEpochMs);
  return {
    migrationId: plan.migrationId,
    planDigest: plan.planDigest,
    baseRevision: baseWorld.revision,
    baseWorldRoot: frozen.baseWorldRoot,
    operationIds: frozen.events.map(
      /** Keep the accepted journal operations in the frozen batch order. */
      ({ operationId }) => operationId,
    ),
    sourceDispositions: plan.sourceDispositions,
    plan: frozen,
  };
}

/** Hash the exact plan fingerprint so cutover can bind it without storing the source rows again. */
export function inventoryMigrationPlanDigest(
  plan: Omit<InventoryMigrationPlan, "planDigest"> | InventoryMigrationPlan
): string {
  return inventorySha256(inventoryIntentFingerprint([
    plan.migrationId,
    plan.sourceSystem,
    plan.sourceVersion ?? null,
    plan.cutoverAtEpochMs,
    plan.status,
    plan.events.map(inventoryEventIntentFingerprint),
    plan.sourceDispositions.map(inventoryMigrationSourceDispositionFingerprint),
    plan.diagnostics.map(
      /** Keep every reviewed warning/error/source row inside the compiled-plan identity. */
      (diagnostic) => [
        diagnostic.severity,
        diagnostic.code,
        diagnostic.message,
        diagnostic.source === undefined
          ? null
          : [
              diagnostic.source.sourceType,
              diagnostic.source.sourceId,
              diagnostic.source.note ?? null,
            ],
        diagnostic.resolution ?? null,
      ]
    ),
    inventoryMetadataFingerprint(plan.metadata),
  ]));
}

/** Build the complete committed event batch and exact next roots before durable begin. */
function createDurableInventoryMigrationPlan(
  catalog: InventoryCatalog,
  baseWorld: InventoryWorldState,
  plan: InventoryMigrationPlan,
  recordedAtEpochMs: number
): InventoryDurableMigrationPlan {
  let world = baseWorld;
  assertInventoryCatalogRetainsSnapshot(catalog, world.catalog);
  const catalogSnapshot = inventoryCatalogSnapshot(catalog);
  /** Complete committed event batch retained for restart repair. */
  const committedEvents: InventoryCommittedEvent[] = [];
  for (const event of plan.events) {
    try {
      const committed = commitInventoryEvent(
        event,
        recordedAtEpochMs,
        world.projection.lastRecordSequence + 1
      );
      committedEvents.push(committed);
      const projection = applyInventoryCommittedEvent({
        catalog,
        state: world.projection,
        event: committed,
        deficitPolicy: InventoryDeficitPolicy.Record,
      }).state;
      world = {
        // The event stream advances inside one unpublished batch; the world revision advances once.
        revision: baseWorld.revision + 1,
        catalog: catalogSnapshot,
        projection,
        reservations: world.reservations,
        counts: world.counts,
      };
    } catch (error) {
      throw new Error(
        `Migration '${plan.migrationId}' cannot start because '${event.operationId}' fails against current target truth: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const baseWorldRoot = inventoryWorldContentRoots(baseWorld).world;
  const nextWorld: InventoryWorldState = {
    ...world,
    revision: baseWorld.revision + 1,
    catalog: catalogSnapshot,
  };
  const nextRoots = inventoryWorldContentRoots(nextWorld);
  const durablePlanWithoutDigest: Omit<
    InventoryDurableMigrationPlan,
    "durablePlanDigest"
  > = {
    format: "inventoryonce-migration-plan-v1",
    baseWorldRoot,
    catalog: catalogSnapshot,
    catalogRoot: catalogSnapshot.digest,
    deficitPolicy: InventoryDeficitPolicy.Record,
    events: committedEvents,
    sourceDispositions: structuredClone(plan.sourceDispositions),
    nextRoots,
  };
  return {
    ...durablePlanWithoutDigest,
    durablePlanDigest: inventoryDurableMigrationPlanDigest(
      durablePlanWithoutDigest
    ),
  };
}
