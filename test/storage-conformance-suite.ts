import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryCountStatus,
  InventoryReservationStatus,
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
  type InventoryOnce,
  type InventoryWorldState,
} from "../src/index.js";
import {
  InventoryDeficitPolicy,
  inventoryContainerIdentity,
  inventoryLotIdentity,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
} from "../src/kernel.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
  inventoryMigrationSnapshotSupersededDisposition,
  repairInventoryMigrationManifests,
  resumeInventoryMigrationManifest,
} from "../src/migrations-api.js";
import {
  commitInventoryOperation,
  repairInventoryDurableOperations,
  resumeInventoryDurableOperation,
} from "../src/storage-api.js";
import {
  InventoryDurableOperationState,
  InventoryMigrationManifestState,
  InventoryStorageWriteStage,
  inventoryWorldContentRoots,
  type InventoryDurableStorage,
  type InventoryStorageFailpoint,
  type InventoryStorageWriteTiming,
} from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time3,
} from "./test-fixtures.js";

/** Input accepted by one reusable durable-adapter conformance factory. */
export interface InventoryDurableStorageConformanceFactoryInput {
  /** Optional one-shot/multi-shot failure callback wired to physical boundaries. */
  readonly failpoint?: InventoryStorageFailpoint;
}

/** Factory used to run the same crash/publication contract against any durable adapter. */
export type InventoryDurableStorageConformanceFactory = (
  input: InventoryDurableStorageConformanceFactoryInput
) => InventoryDurableStorage;

/** One before/after physical boundary tested by the reusable failpoint matrix. */
interface StorageFailureCase {
  /** Physical write boundary. */
  readonly stage: InventoryStorageWriteStage;
  /** Side of the write where the simulated crash happens. */
  readonly timing: InventoryStorageWriteTiming;
}

/** Every required physical boundary and both crash sides. */
const storageFailureCases: readonly StorageFailureCase[] = Object.freeze([
  { stage: InventoryStorageWriteStage.Begin, timing: "before" },
  { stage: InventoryStorageWriteStage.Begin, timing: "after" },
  { stage: InventoryStorageWriteStage.Event, timing: "before" },
  { stage: InventoryStorageWriteStage.Event, timing: "after" },
  { stage: InventoryStorageWriteStage.Projection, timing: "before" },
  { stage: InventoryStorageWriteStage.Projection, timing: "after" },
  { stage: InventoryStorageWriteStage.Reservations, timing: "before" },
  { stage: InventoryStorageWriteStage.Reservations, timing: "after" },
  { stage: InventoryStorageWriteStage.Counts, timing: "before" },
  { stage: InventoryStorageWriteStage.Counts, timing: "after" },
  { stage: InventoryStorageWriteStage.Receipt, timing: "before" },
  { stage: InventoryStorageWriteStage.Receipt, timing: "after" },
  { stage: InventoryStorageWriteStage.Complete, timing: "before" },
  { stage: InventoryStorageWriteStage.PublishWorld, timing: "before" },
  { stage: InventoryStorageWriteStage.PublishWorld, timing: "after" },
  { stage: InventoryStorageWriteStage.CompactOperation, timing: "before" },
  { stage: InventoryStorageWriteStage.CompactOperation, timing: "after" },
  { stage: InventoryStorageWriteStage.Complete, timing: "after" },
]);

/** Return whether this crash side happens after the complete next world became visible. */
function inventoryStorageFailurePublishesWorld(
  failureCase: StorageFailureCase
): boolean {
  if (failureCase.stage === InventoryStorageWriteStage.PublishWorld) {
    return failureCase.timing === "after";
  }
  if (failureCase.stage === InventoryStorageWriteStage.CompactOperation)
    return true;
  return (
    failureCase.stage === InventoryStorageWriteStage.Complete &&
    failureCase.timing === "after"
  );
}

/** Eventless plans skip Event/Projection because begin already marks both components present. */
const eventlessStorageFailureCases = storageFailureCases.filter(
  /** Keep only physical writes that eventless reservation/count plans actually perform. */
  (failureCase) =>
    failureCase.stage !== InventoryStorageWriteStage.Event &&
    failureCase.stage !== InventoryStorageWriteStage.Projection
);

/** One real operation shape used to prove every changed world component survives repair. */
interface StoragePlanShape {
  /** Short test label. */
  readonly name: string;
  /** Operation whose writes receive the failpoint. */
  readonly operationId: string;
  /** Whether the plan contains an event/projection write. */
  readonly eventful: boolean;
  /** Publish any prerequisite world rows before arming the target operation. */
  readonly setup: (inventory: InventoryOnce) => Promise<void>;
  /** Run or exactly retry the one target operation. */
  readonly run: (inventory: InventoryOnce) => Promise<void>;
  /** Check the exact published component values after repair. */
  readonly assertPublished: (world: InventoryWorldState) => void;
  /** Check the same changed rows through the normal public read surface. */
  readonly assertPublicReads?: (inventory: InventoryOnce) => Promise<void>;
}

/** Real stock/reservation/count combinations covered by every applicable write failpoint. */
const storagePlanShapes: readonly StoragePlanShape[] = Object.freeze([
  {
    name: "catalog-only",
    operationId: "shape-catalog",
    eventful: true,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.catalog.publish({
        operationId: "shape-catalog",
        occurredAtEpochMs: time0,
      });
    },
    assertPublished: (world) => {
      expect(world.catalog.itemRevisions).toHaveLength(2);
      expect(world.catalog.packagingRevisions).toHaveLength(2);
      expect(world.projection.lastRecordSequence).toBe(1);
      expect(
        world.projection.events["inventory:event:shape-catalog"]?.catalogDigest
      ).toBe(world.catalog.digest);
    },
    assertPublicReads: async (inventory) => {
      expect(
        await inventory.read.packagingRevisions({ itemId: "item-a" })
      ).toHaveLength(2);
      expect((await inventory.read.world()).catalog.itemRevisions).toHaveLength(
        2
      );
    },
  },
  {
    name: "stock-only",
    operationId: "shape-stock",
    eventful: true,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.stock.receive({
        operationId: "shape-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("stock-store", {
          serialId: "SHAPE-SERIAL",
          containerId: "SHAPE-STOCK-CONTAINER",
        }),
        amount: stockAmount("1", "piece"),
      });
    },
    assertPublished: (world) => {
      const position = loosePosition("stock-store", {
        serialId: "SHAPE-SERIAL",
        containerId: "SHAPE-STOCK-CONTAINER",
      });
      const positionId = inventoryStockPositionIdentity({
        ...position,
        itemRevisionId: "item-a-v2",
      });
      expect(world.projection.lastRecordSequence).toBe(1);
      expect(
        world.projection.positions[positionId]?.measurements.primary.quantity
          .amountMinor
      ).toBe(1);
      expect(world.projection.positionIdsByItemId["item-a"]).toEqual([
        positionId,
      ]);
      expect(world.projection.positionIdsByItemRevisionId["item-a-v2"]).toEqual(
        [positionId]
      );
      expect(
        world.projection.positionIdsByContainerIdentity[
          inventoryContainerIdentity("SHAPE-STOCK-CONTAINER")
        ]
      ).toEqual([positionId]);
      expect(
        world.projection.positiveLayerStartedAtEpochMsByPositionId[positionId]
      ).toBe(time0);
      expect(
        world.projection.positivePositionIdBySerialIdentity[
          inventorySerialIdentity("item-a", "SHAPE-SERIAL")
        ]
      ).toBe(positionId);
      expect(Object.keys(world.reservations.reservations)).toHaveLength(0);
      expect(Object.keys(world.counts.counts)).toHaveLength(0);
    },
  },
  {
    name: "lot-master-only",
    operationId: "shape-lot-master",
    eventful: true,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.lots.define({
        operationId: "shape-lot-master",
        occurredAtEpochMs: time0,
        itemId: "item-a",
        lotId: "SHAPE-LOT",
        lot: {
          manufacturedAtEpochMs: time0,
          expiresAtEpochMs: time3,
          metadata: { source: "conformance" },
        },
      });
    },
    assertPublished: (world) => {
      expect(Object.values(world.projection.lots)).toEqual([
        expect.objectContaining({
          definition: expect.objectContaining({
            itemId: "item-a",
            lotId: "SHAPE-LOT",
            expiresAtEpochMs: time3,
          }),
          rootEventId: "inventory:event:shape-lot-master",
        }),
      ]);
      expect(world.projection.lotIdentitiesByItemId["item-a"]).toEqual([
        inventoryLotIdentity("item-a", "SHAPE-LOT"),
      ]);
      expect(Object.values(world.projection.lotRootEventIdByIdentity)).toEqual([
        "inventory:event:shape-lot-master",
      ]);
    },
    assertPublicReads: async (inventory) => {
      expect(await inventory.read.lot("item-a", "SHAPE-LOT")).toMatchObject({
        definition: { itemId: "item-a", lotId: "SHAPE-LOT", expiresAtEpochMs: time3 },
        rootEventId: "inventory:event:shape-lot-master",
      });
    },
  },
  {
    name: "container-master-only",
    operationId: "shape-container-master",
    eventful: true,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.containers.define({
        operationId: "shape-container-master",
        occurredAtEpochMs: time0,
        containerId: "SHAPE-CONTAINER",
        container: {
          containerType: "carton",
          identifiers: { barcode: "SHAPE-001" },
        },
      });
    },
    assertPublished: (world) => {
      expect(Object.values(world.projection.containers)).toEqual([
        expect.objectContaining({
          definition: expect.objectContaining({
            containerId: "SHAPE-CONTAINER",
            containerType: "carton",
          }),
          rootEventId: "inventory:event:shape-container-master",
        }),
      ]);
      expect(
        Object.values(world.projection.containerRootEventIdByIdentity)
      ).toEqual(["inventory:event:shape-container-master"]);
    },
    assertPublicReads: async (inventory) => {
      expect(await inventory.read.container("SHAPE-CONTAINER")).toMatchObject({
        definition: { containerId: "SHAPE-CONTAINER", containerType: "carton" },
        rootEventId: "inventory:event:shape-container-master",
      });
    },
  },
  {
    name: "traceability-only",
    operationId: "shape-traceability",
    eventful: true,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.traceability.aggregate({
        operationId: "shape-traceability",
        occurredAtEpochMs: time0,
        from: {
          kind: InventoryTraceabilityNodeKind.Container,
          id: "SHAPE-CHILD",
        },
        to: {
          kind: InventoryTraceabilityNodeKind.Container,
          id: "SHAPE-PARENT",
        },
      });
    },
    assertPublished: (world) => {
      expect(
        world.projection.events["inventory:event:shape-traceability"]
      ).toMatchObject({ kind: "traceability" });
      expect(Object.values(world.projection.traceability.relations)).toEqual([
        expect.objectContaining({
          kind: InventoryTraceabilityRelationKind.Containment,
          from: {
            kind: InventoryTraceabilityNodeKind.Container,
            id: "SHAPE-CHILD",
          },
          to: {
            kind: InventoryTraceabilityNodeKind.Container,
            id: "SHAPE-PARENT",
          },
          createdByEventId: "inventory:event:shape-traceability",
        }),
      ]);
      expect(world.projection.eventIdsBySequence["1"]).toBe(
        "inventory:event:shape-traceability"
      );
      expect(world.projection.eventIdByOperationId["shape-traceability"]).toBe(
        "inventory:event:shape-traceability"
      );
      expect(
        world.projection.traceability
          .containmentChildContainerIdsByParentNodeIdentity[
          inventoryTraceabilityNodeIdentity({
            kind: InventoryTraceabilityNodeKind.Container,
            id: "SHAPE-PARENT",
          })
        ]
      ).toEqual(["SHAPE-CHILD"]);
    },
    assertPublicReads: async (inventory) => {
      const world = await inventory.read.world();
      expect(
        Object.values(world.projection.traceability.relations)
      ).toHaveLength(1);
      expect(
        await inventory.read.event("inventory:event:shape-traceability")
      ).toMatchObject({ kind: "traceability" });
    },
  },
  {
    name: "reservation-only",
    operationId: "shape-reserve",
    eventful: false,
    setup: async (inventory) => {
      await inventory.stock.receive({
        operationId: "shape-reserve-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("reserve-store"),
        amount: stockAmount("2", "piece"),
      });
    },
    run: async (inventory) => {
      await inventory.reservations.reserve({
        reservationId: "shape-claim",
        operationId: "shape-reserve",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", locationIds: ["reserve-store"] },
        requested: parseQuantity("1", "piece"),
        createdAtEpochMs: time0,
      });
    },
    assertPublished: (world) => {
      expect(world.projection.lastRecordSequence).toBe(1);
      expect(world.reservations.reservations["shape-claim"]?.status).toBe(
        InventoryReservationStatus.Active
      );
      expect(Object.keys(world.counts.counts)).toHaveLength(0);
    },
  },
  {
    name: "count-only",
    operationId: "shape-count-start",
    eventful: false,
    setup: () => Promise.resolve(),
    run: async (inventory) => {
      await inventory.counts.start({
        countId: "shape-count",
        operationId: "shape-count-start",
        selector: { itemId: "item-a" },
        startedAtEpochMs: time0,
      });
    },
    assertPublished: (world) => {
      expect(world.projection.lastRecordSequence).toBe(0);
      expect(world.counts.counts["shape-count"]?.status).toBe(
        InventoryCountStatus.Started
      );
      expect(Object.keys(world.reservations.reservations)).toHaveLength(0);
    },
  },
  {
    name: "issue-plus-reservation-consume",
    operationId: "shape-consume",
    eventful: true,
    setup: async (inventory) => {
      await inventory.stock.receive({
        operationId: "shape-consume-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("consume-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.reservations.reserve({
        reservationId: "shape-consume-claim",
        operationId: "shape-consume-reserve",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", locationIds: ["consume-store"] },
        requested: parseQuantity("1", "piece"),
        createdAtEpochMs: time0,
      });
      const position = (
        await inventory.read.positions({
          itemId: "item-a",
          locationIds: ["consume-store"],
        })
      )[0];
      if (position === undefined)
        throw new Error("Consume conformance stock disappeared.");
      await inventory.reservations.allocate({
        operationId: "shape-consume-allocate",
        reservationId: "shape-consume-claim",
        occurredAtEpochMs: time0,
        allocations: [
          { position: position.key, quantity: parseQuantity("1", "piece") },
        ],
      });
    },
    run: async (inventory) => {
      const position = (
        await inventory.read.positions({
          itemId: "item-a",
          locationIds: ["consume-store"],
        })
      )[0];
      if (position === undefined)
        throw new Error("Consume conformance stock disappeared.");
      await inventory.reservations.consume({
        operationId: "shape-consume",
        reservationId: "shape-consume-claim",
        occurredAtEpochMs: time0,
        fulfillment: [
          { from: position.key, amount: stockAmount("1", "piece") },
        ],
      });
    },
    assertPublished: (world) => {
      expect(world.projection.lastRecordSequence).toBe(2);
      expect(
        Object.values(world.projection.positions)[0]?.measurements.primary
          .quantity.amountMinor
      ).toBe(1);
      expect(
        world.reservations.reservations["shape-consume-claim"]?.status
      ).toBe(InventoryReservationStatus.Consumed);
    },
  },
  {
    name: "adjustment-plus-count-complete",
    operationId: "shape-reconcile",
    eventful: true,
    setup: async (inventory) => {
      await inventory.stock.receive({
        operationId: "shape-count-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("count-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.counts.start({
        countId: "shape-reconcile-count",
        operationId: "shape-reconcile-start",
        selector: { itemId: "item-a", locationIds: ["count-store"] },
        startedAtEpochMs: time0,
      });
      const position = (
        await inventory.read.positions({
          itemId: "item-a",
          locationIds: ["count-store"],
        })
      )[0];
      if (position === undefined)
        throw new Error("Count conformance stock disappeared.");
      await inventory.counts.observe({
        operationId: "shape-reconcile-observe",
        countId: "shape-reconcile-count",
        observedAtEpochMs: time0,
        observations: [
          {
            position: position.key,
            measurements: {
              primary: {
                axisId: "pieces",
                quantity: parseQuantity("1", "piece"),
              },
              independent: [],
            },
          },
        ],
      });
    },
    run: async (inventory) => {
      await inventory.counts.reconcile({
        operationId: "shape-reconcile",
        countId: "shape-reconcile-count",
        completedAtEpochMs: time0,
        reason: "One piece was missing.",
      });
    },
    assertPublished: (world) => {
      expect(world.projection.lastRecordSequence).toBe(2);
      expect(
        Object.values(world.projection.positions)[0]?.measurements.primary
          .quantity.amountMinor
      ).toBe(1);
      expect(world.counts.counts["shape-reconcile-count"]?.status).toBe(
        InventoryCountStatus.Completed
      );
    },
  },
]);

/** Run the same exact component assertion used by the crash matrix for one named plan shape. */
export function assertInventoryStoragePlanShapePublished(
  shapeName: string,
  world: InventoryWorldState
): void {
  for (const shape of storagePlanShapes) {
    if (shape.name !== shapeName) continue;
    shape.assertPublished(world);
    return;
  }
  throw new Error(`Unknown storage conformance plan shape '${shapeName}'.`);
}

/** Every operation abort boundary and both crash sides. */
const abortFailureCases: readonly StorageFailureCase[] = Object.freeze([
  { stage: InventoryStorageWriteStage.ClaimAbort, timing: "before" },
  { stage: InventoryStorageWriteStage.ClaimAbort, timing: "after" },
  { stage: InventoryStorageWriteStage.Abort, timing: "before" },
  { stage: InventoryStorageWriteStage.Abort, timing: "after" },
]);

/** Every migration abort boundary and both crash sides. */
const migrationAbortFailureCases: readonly StorageFailureCase[] = Object.freeze([
  { stage: InventoryStorageWriteStage.MigrationClaimAbort, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationClaimAbort, timing: "after" },
  { stage: InventoryStorageWriteStage.MigrationAbort, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationAbort, timing: "after" },
]);

/** Operation states allowed after failure at one abort boundary. */
function allowedOperationAbortStatesAfterFailure(
  failureCase: StorageFailureCase
): readonly InventoryDurableOperationState[] {
  return failureCase.stage === InventoryStorageWriteStage.ClaimAbort &&
    failureCase.timing === "before"
    ? [InventoryDurableOperationState.Applying]
    : [InventoryDurableOperationState.Aborted];
}

/** Migration-manifest states allowed after failure at one abort boundary. */
function allowedMigrationAbortStatesAfterFailure(
  failureCase: StorageFailureCase
): readonly InventoryMigrationManifestState[] {
  return failureCase.stage === InventoryStorageWriteStage.MigrationClaimAbort &&
    failureCase.timing === "before"
    ? [InventoryMigrationManifestState.Applying]
    : [InventoryMigrationManifestState.Aborted];
}

/** Every whole-migration write boundary except abort, which has its own terminal matrix. */
const migrationStorageFailureCases: readonly StorageFailureCase[] = Object.freeze([
  { stage: InventoryStorageWriteStage.MigrationBegin, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationBegin, timing: "after" },
  { stage: InventoryStorageWriteStage.MigrationWorld, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationWorld, timing: "after" },
  { stage: InventoryStorageWriteStage.MigrationComplete, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationPublishWorld, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationPublishWorld, timing: "after" },
  {
    stage: InventoryStorageWriteStage.MigrationCompactManifest,
    timing: "before",
  },
  {
    stage: InventoryStorageWriteStage.MigrationCompactManifest,
    timing: "after",
  },
  { stage: InventoryStorageWriteStage.MigrationComplete, timing: "after" },
]);

/** Return whether this migration crash side happens after the reviewed batch became visible. */
function inventoryMigrationStorageFailurePublishesWorld(
  failureCase: StorageFailureCase
): boolean {
  if (failureCase.stage === InventoryStorageWriteStage.MigrationPublishWorld) {
    return failureCase.timing === "after";
  }
  if (failureCase.stage === InventoryStorageWriteStage.MigrationCompactManifest)
    return true;
  return (
    failureCase.stage === InventoryStorageWriteStage.MigrationComplete &&
    failureCase.timing === "after"
  );
}

/** Build one reviewed migration that changes stock, catalogue, lot, container, and traceability roots. */
function createStorageConformanceMigration() {
  const catalog = createTabletCatalog();
  const plan = defineInventoryMigration({
    catalog,
    declaration: {
      migrationId: "storage-conformance-migration",
      sourceSystem: "storage-conformance-source",
      cutoverAtEpochMs: time0,
      openingStock: [
        {
          openingId: "migration-container-stock",
          position: loosePosition("migration-store", {
            lotId: "MIGRATION-LOT",
            containerId: "MIGRATION-CHILD",
          }),
          amount: stockAmount("7", "piece"),
          itemRevisionId: "item-a-v2",
          lot: { manufacturedAtEpochMs: time0, expiresAtEpochMs: time3 },
          container: {
            containerType: "carton",
            identifiers: { barcode: "MIGRATION-001" },
          },
          source: { sourceType: "legacy-stock", sourceId: "migration-row-1" },
        },
      ],
      sourceDispositions: [
        inventoryMigrationSnapshotSupersededDisposition({
          dispositionId: "storage-conformance-snapshot-superseded",
          source: {
            sourceType: "InventoryStockPendingOp",
            sourceId: "migration-pending-row",
          },
          snapshotAtEpochMs: time0,
          reason: "Opening snapshot supersedes this unresolved workflow row.",
          evidence: {
            workflowState: "pending",
            amount: -1,
            amountUnit: "piece",
          },
        }),
      ],
      traceabilityChanges: [
        {
          changeId: "migration-child-in-parent",
          change: {
            action: InventoryTraceabilityRelationAction.Add,
            kind: InventoryTraceabilityRelationKind.Containment,
            from: {
              kind: InventoryTraceabilityNodeKind.Container,
              id: "MIGRATION-CHILD",
            },
            to: {
              kind: InventoryTraceabilityNodeKind.Container,
              id: "MIGRATION-PARENT",
            },
          },
          source: {
            sourceType: "legacy-relation",
            sourceId: "migration-edge-1",
          },
        },
      ],
    },
  });
  return { catalog, plan };
}

/** Register the complete durable-plan/publication/repair contract for one adapter factory. */
export function runInventoryDurableStorageConformanceSuite(
  name: string,
  createStorage: InventoryDurableStorageConformanceFactory
): void {
  describe(`durable storage conformance: ${name}`, () => {
    it("durably records policy shortfall as non-allocatable deficit while Reject writes nothing", async () => {
      const recordStorage = createStorage({});
      const recordInventory = createTestInventory(
        recordStorage,
        createTabletCatalog(),
        clockAt(),
        InventoryDeficitPolicy.Record
      );
      const selector = inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        locationIds: ["deficit-store"],
      });
      const recorded = await recordInventory.stock.issueByPolicy({
        operationId: "conformance-record-deficit",
        occurredAtEpochMs: time0,
        selector,
        amount: stockAmount("5", "piece"),
        method: InventoryAllocationMethod.Fifo,
      });
      expect(recorded.deficit?.primary.amountMinor).toBe(5);
      expect((await recordStorage.readWorld()).revision).toBe(1);

      const restartedWithDeficit = createTestInventory(
        recordStorage,
        createTabletCatalog(),
        clockAt(),
        InventoryDeficitPolicy.Record
      );
      let availability = await restartedWithDeficit.read.availability(
        selector,
        time3
      );
      let revision = availability.revisions[0];
      expect(revision?.onHand.primary.quantity.amountMinor).toBe(-5);
      expect(revision?.physicalOnHand.primary.quantity.amountMinor).toBe(0);
      expect(revision?.deficit.primary.quantity.amountMinor).toBe(5);
      expect(revision?.unallocatedUsablePhysical.amountMinor).toBe(0);

      await restartedWithDeficit.stock.receive({
        operationId: "conformance-late-receipt",
        occurredAtEpochMs: time3,
        to: loosePosition("deficit-store", { lotId: "LATE-RECEIPT" }),
        amount: stockAmount("10", "piece"),
      });
      const restartedAfterReceipt = createTestInventory(
        recordStorage,
        createTabletCatalog(),
        clockAt(),
        InventoryDeficitPolicy.Record
      );
      availability = await restartedAfterReceipt.read.availability(
        selector,
        time3
      );
      revision = availability.revisions[0];
      expect(revision?.onHand.primary.quantity.amountMinor).toBe(5);
      expect(revision?.physicalOnHand.primary.quantity.amountMinor).toBe(10);
      expect(revision?.deficit.primary.quantity.amountMinor).toBe(5);
      expect(revision?.unallocatedUsablePhysical.amountMinor).toBe(5);

      const secondIssue = await restartedAfterReceipt.stock.issueByPolicy({
        operationId: "conformance-record-covered-shortfall",
        occurredAtEpochMs: time3,
        selector: inventoryStockSelector("item-a", {
          itemRevisionIds: ["item-a-v2"],
          locationIds: ["deficit-store"],
          lotIds: ["LATE-RECEIPT"],
        }),
        amount: stockAmount("6", "piece"),
        method: InventoryAllocationMethod.Fifo,
      });
      expect(secondIssue.deficit?.primary.amountMinor).toBe(1);
      const revisionAfterSecondIssue = (
        await restartedAfterReceipt.read.availability(selector, time3)
      ).revisions[0];
      expect(
        revisionAfterSecondIssue?.physicalOnHand.primary.quantity.amountMinor
      ).toBe(5);
      expect(
        revisionAfterSecondIssue?.deficit.primary.quantity.amountMinor
      ).toBe(6);
      expect(
        revisionAfterSecondIssue?.onHand.primary.quantity.amountMinor
      ).toBe(-1);
      expect(
        revisionAfterSecondIssue?.unallocatedUsablePhysical.amountMinor
      ).toBe(0);
      const replayed = await restartedAfterReceipt.stock.issueByPolicy({
        operationId: "conformance-record-covered-shortfall",
        occurredAtEpochMs: time3,
        selector: inventoryStockSelector("item-a", {
          itemRevisionIds: ["item-a-v2"],
          locationIds: ["deficit-store"],
          lotIds: ["LATE-RECEIPT"],
        }),
        amount: stockAmount("6", "piece"),
        method: InventoryAllocationMethod.Fifo,
      });
      expect(replayed.replayed).toBe(true);
      expect(replayed.deficit).toEqual(secondIssue.deficit);
      expect((await recordStorage.readWorld()).revision).toBe(3);

      const rejectStorage = createStorage({});
      const rejectInventory = createTestInventory(
        rejectStorage,
        createTabletCatalog(),
        clockAt(),
        InventoryDeficitPolicy.Reject
      );
      await expect(
        rejectInventory.stock.issueByPolicy({
          operationId: "conformance-reject-deficit",
          occurredAtEpochMs: time0,
          selector,
          amount: stockAmount("1", "piece"),
          method: InventoryAllocationMethod.Fifo,
        })
      ).rejects.toThrow("shortfall");
      expect((await rejectStorage.readWorld()).revision).toBe(0);
      expect(
        await rejectStorage.readOperation("conformance-reject-deficit")
      ).toBeUndefined();
    });

    describe.each(storagePlanShapes)(
      "changed component plan: $name",
      (shape) => {
        const failureCases = shape.eventful
          ? storageFailureCases
          : eventlessStorageFailureCases;
        it.each(failureCases)(
          "publishes exact components after $timing $stage failure",
          async ({ stage, timing }) => {
            let failed = false;
            const storage = createStorage({
              /** Fail only the target plan so prerequisite setup operations commit normally. */
              failpoint: (context) => {
                if (
                  !failed &&
                  context.operationId === shape.operationId &&
                  context.stage === stage &&
                  context.timing === timing
                ) {
                  failed = true;
                  throw new Error(`Injected shape ${timing} ${stage} failure.`);
                }
              },
            });
            const inventory = createTestInventory(storage);
            await shape.setup(inventory);
            const worldBeforeTarget = await storage.readWorld();
            await expect(shape.run(inventory)).rejects.toThrow(
              "Injected shape"
            );
            const worldAfterFailure = await storage.readWorld();
            if (inventoryStorageFailurePublishesWorld({ stage, timing })) {
              expect(worldAfterFailure.revision).toBe(
                worldBeforeTarget.revision + 1
              );
            } else {
              expect(worldAfterFailure).toEqual(worldBeforeTarget);
            }
            const operation = await storage.readOperation(shape.operationId);
            /** Frozen roots retained by every applying plan and checked after generic repair. */
            const frozenNextRoots = operation?.plan?.nextRoots;
            if (operation?.state === InventoryDurableOperationState.Applying) {
              expect(
                await repairInventoryDurableOperations({ storage })
              ).toHaveLength(1);
            } else {
              await shape.run(inventory);
            }
            const published = await storage.readWorld();
            expect(published.revision).toBe(worldBeforeTarget.revision + 1);
            shape.assertPublished(published);
            if (frozenNextRoots !== undefined) {
              expect(inventoryWorldContentRoots(published)).toEqual(
                frozenNextRoots
              );
            }
            await shape.assertPublicReads?.(inventory);
            const completedOperation = await storage.readOperation(
              shape.operationId
            );
            const receipt = completedOperation?.receipt;
            expect(receipt).toMatchObject({
              operationId: shape.operationId,
              worldRevision: worldBeforeTarget.revision + 1,
            });
            expect(completedOperation?.plan).toBeUndefined();
            await shape.run(inventory);
            expect((await storage.readWorld()).revision).toBe(
              worldBeforeTarget.revision + 1
            );
            shape.assertPublished(await storage.readWorld());
            await shape.assertPublicReads?.(inventory);
          }
        );
      }
    );

    it.each(storageFailureCases)(
      "repairs or safely replans after $timing $stage failure",
      async ({ stage, timing }) => {
        let failed = false;
        const failpoint: InventoryStorageFailpoint = (context) => {
          if (!failed && context.stage === stage && context.timing === timing) {
            failed = true;
            throw new Error(`Injected ${timing} ${stage} failure.`);
          }
        };
        const storage = createStorage({ failpoint });
        const inventory = createTestInventory(storage);
        const command = {
          operationId: "failpoint-receipt",
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("4", "piece"),
        };
        await expect(inventory.stock.receive(command)).rejects.toThrow(
          "Injected"
        );

        const operationAfterFailure = await storage.readOperation(
          command.operationId
        );
        const worldAfterFailure = await storage.readWorld();
        if (stage === InventoryStorageWriteStage.Begin && timing === "before") {
          expect(operationAfterFailure).toBeUndefined();
          expect(worldAfterFailure.revision).toBe(0);
          expect(await repairInventoryDurableOperations({ storage })).toEqual(
            []
          );
          await inventory.stock.receive(command);
        } else if (inventoryStorageFailurePublishesWorld({ stage, timing })) {
          expect(worldAfterFailure.revision).toBe(1);
          expect(operationAfterFailure?.worldPublished).toBe(true);
          await resumeInventoryDurableOperation(storage, command.operationId);
        } else {
          expect(operationAfterFailure?.state).toBe(
            InventoryDurableOperationState.Applying
          );
          const applyingPlan = operationAfterFailure?.plan;
          if (applyingPlan === undefined) {
            throw new Error(
              "Applying conformance row lost its complete repair plan."
            );
          }
          expect(applyingPlan.event?.operationId).toBe(command.operationId);
          expect(applyingPlan.nextRoots.projection).toMatch(/^[0-9a-f]{64}$/);
          expect(applyingPlan.receipt.worldRevision).toBe(1);
          expect(worldAfterFailure.revision).toBe(0);
          expect(
            Object.keys(worldAfterFailure.projection.positions)
          ).toHaveLength(0);
          const repaired = await repairInventoryDurableOperations({ storage });
          expect(repaired).toHaveLength(1);
        }

        const published = await storage.readWorld();
        expect(published.revision).toBe(1);
        expect(published.projection.lastRecordSequence).toBe(1);
        expect(
          Object.values(published.projection.positions)[0]?.measurements.primary
            .quantity.amountMinor
        ).toBe(4);
        const exactReplay = await inventory.stock.receive(command);
        expect(exactReplay.replayed).toBe(true);
        expect((await storage.readWorld()).revision).toBe(1);
        await expect(
          inventory.stock.receive({
            ...command,
            amount: stockAmount("5", "piece"),
          })
        ).rejects.toThrow("changed intent");
      }
    );

    it.each(migrationStorageFailureCases)(
      "repairs atomic reviewed migration after $timing $stage failure",
      async ({ stage, timing }) => {
        let failed = false;
        const storage = createStorage({
          /** Fail once at the requested migration boundary and leave every other write alone. */
          failpoint: (context) => {
            if (
              !failed &&
              context.stage === stage &&
              context.timing === timing
            ) {
              failed = true;
              throw new Error(`Injected migration ${timing} ${stage} failure.`);
            }
          },
        });
        const { catalog, plan } = createStorageConformanceMigration();
        const baseWorld = await storage.readWorld();
        const dryRun = dryRunInventoryMigration({
          catalog,
          plan,
          targetWorld: baseWorld,
        });
        await expect(
          applyInventoryMigrationPlan({
            catalog,
            storage,
            plan,
            dryRun,
            clock: clockAt(time3),
          })
        ).rejects.toThrow("Injected migration");
        const worldAfterFailure = await storage.readWorld();
        const manifestAfterFailure = await storage.readMigrationManifest(
          plan.migrationId
        );
        /** Exact frozen roots survive every applying failure after migration Begin. */
        const frozenNextRoots = manifestAfterFailure?.plan?.nextRoots;
        if (manifestAfterFailure !== undefined) {
          expect(manifestAfterFailure.sourceDispositions).toEqual(
            plan.sourceDispositions
          );
        }
        if (
          stage === InventoryStorageWriteStage.MigrationBegin &&
          timing === "before"
        ) {
          expect(manifestAfterFailure).toBeUndefined();
          expect(worldAfterFailure).toEqual(baseWorld);
          await applyInventoryMigrationPlan({
            catalog,
            storage,
            plan,
            dryRun,
            clock: clockAt(time3),
          });
        } else if (
          inventoryMigrationStorageFailurePublishesWorld({ stage, timing })
        ) {
          expect(worldAfterFailure.revision).toBe(baseWorld.revision + 1);
          if (
            manifestAfterFailure?.state ===
            InventoryMigrationManifestState.Applying
          ) {
            await resumeInventoryMigrationManifest(storage, plan.migrationId);
          }
        } else {
          expect(worldAfterFailure).toEqual(baseWorld);
          expect(manifestAfterFailure?.state).toBe(
            InventoryMigrationManifestState.Applying
          );
          expect(
            await repairInventoryMigrationManifests({ storage })
          ).toHaveLength(1);
        }

        const published = await storage.readWorld();
        expect(published.revision).toBe(baseWorld.revision + 1);
        if (frozenNextRoots !== undefined) {
          expect(inventoryWorldContentRoots(published)).toEqual(
            frozenNextRoots
          );
        }
        expect(published.catalog.digest).toBe(catalog.digest);
        expect(
          Object.values(published.projection.positions)[0]?.measurements.primary
            .quantity.amountMinor
        ).toBe(7);
        expect(
          Object.values(published.projection.lotRootEventIdByIdentity)
        ).toHaveLength(1);
        expect(
          Object.values(published.projection.containerRootEventIdByIdentity)
        ).toHaveLength(1);
        expect(
          Object.values(published.projection.traceability.relations)
        ).toHaveLength(1);
        const inventory = createTestInventory(storage, catalog);
        expect(
          await inventory.read.lot("item-a", "MIGRATION-LOT")
        ).toMatchObject({
          definition: { lotId: "MIGRATION-LOT", expiresAtEpochMs: time3 },
        });
        expect(await inventory.read.container("MIGRATION-CHILD")).toMatchObject(
          {
            definition: {
              containerId: "MIGRATION-CHILD",
              containerType: "carton",
            },
          }
        );
        expect(
          Object.values(
            (await inventory.read.world()).projection.traceability.relations
          )
        ).toHaveLength(1);
        const completedManifest = await storage.readMigrationManifest(
          plan.migrationId
        );
        expect(completedManifest?.state).toBe(
          InventoryMigrationManifestState.Completed
        );
        expect(completedManifest?.plan).toBeUndefined();
        expect(completedManifest?.sourceDispositions).toEqual(
          plan.sourceDispositions
        );
        expect(completedManifest?.targetWorldRoot).toBe(
          inventoryWorldContentRoots(published).world
        );
        expect(completedManifest?.targetWorldRevision).toBe(published.revision);
        expect(JSON.stringify(published.projection.events)).not.toContain(
          "migration-pending-row"
        );
      }
    );

    it("creates no durable operation when pure planning fails", async () => {
      const storage = createStorage({});
      const catalog = createTabletCatalog();
      await expect(
        commitInventoryOperation({
          catalog,
          storage,
          operationId: "planning-fails",
          intentFingerprint: "planning-fails-v1",
          clock: clockAt(time3),
          deficitPolicy: InventoryDeficitPolicy.Reject,
          /** Fail before a complete next-world plan reaches begin. */
          plan: () => {
            throw new Error("Planner rejected the command.");
          },
        })
      ).rejects.toThrow("Planner rejected");
      expect(await storage.readOperation("planning-fails")).toBeUndefined();
      expect((await storage.readWorld()).revision).toBe(0);
    });

    it("returns one first commit and one replay for concurrent exact callers", async () => {
      const storage = createStorage({});
      const inventory = createTestInventory(storage);
      const command = {
        operationId: "concurrent-exact",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      };
      const results = await Promise.all([
        inventory.stock.receive(command),
        inventory.stock.receive(command),
      ]);
      expect(
        results
          .map(
            /** Read only the atomic create/replay signal from each concurrent result. */
            (result) => result.replayed
          )
          .sort()
      ).toEqual([false, true]);
      expect((await storage.readWorld()).revision).toBe(1);
    });

    it("fails one concurrent changed intent and never publishes both", async () => {
      const storage = createStorage({});
      const inventory = createTestInventory(storage);
      const results = await Promise.allSettled([
        inventory.stock.receive({
          operationId: "concurrent-changed",
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        }),
        inventory.stock.receive({
          operationId: "concurrent-changed",
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("2", "piece"),
        }),
      ]);
      expect(
        results.filter(
          /** Keep the one command that won and published. */
          (result) => result.status === "fulfilled"
        )
      ).toHaveLength(1);
      const rejected = results.find(
        /** Find the one changed-intent caller rejected by atomic begin. */
        (result) => result.status === "rejected"
      );
      expect(rejected).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({
          message: expect.stringContaining("changed intent"),
        }),
      });
      expect((await storage.readWorld()).revision).toBe(1);
    });

    it("repairs a pending exact retry but rejects changed intent against that pending plan", async () => {
      let failedAfterBegin = false;
      const storage = createStorage({
        /** Leave the exact command pending once, immediately after its complete plan is frozen. */
        failpoint: ({ stage, timing }) => {
          if (
            !failedAfterBegin &&
            stage === InventoryStorageWriteStage.Begin &&
            timing === "after"
          ) {
            failedAfterBegin = true;
            throw new Error("Stop exact command after begin.");
          }
        },
      });
      const inventory = createTestInventory(storage);
      const command = {
        operationId: "pending-exact",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      };
      await expect(inventory.stock.receive(command)).rejects.toThrow(
        "Stop exact command"
      );
      await expect(
        inventory.stock.receive({
          ...command,
          amount: stockAmount("2", "piece"),
        })
      ).rejects.toThrow("changed intent");
      const replayed = await inventory.stock.receive(command);
      expect(replayed.replayed).toBe(true);
      expect((await storage.readWorld()).revision).toBe(1);
    });

    it("repairs one pending operation before freezing a new world revision", async () => {
      let failed = false;
      const storage = createStorage({
        /** Interrupt only the first operation after its complete plan is frozen. */
        failpoint: (context) => {
          if (
            !failed &&
            context.stage === InventoryStorageWriteStage.Begin &&
            context.timing === "after"
          ) {
            failed = true;
            throw new Error("Stop after begin.");
          }
        },
      });
      const inventory = createTestInventory(storage);
      await expect(
        inventory.stock.receive({
          operationId: "pending-first",
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        })
      ).rejects.toThrow("Stop after begin");
      await inventory.stock.receive({
        operationId: "second-after-repair",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("2", "piece"),
      });
      const world = await storage.readWorld();
      expect(world.revision).toBe(2);
      expect(world.projection.lastRecordSequence).toBe(2);
      expect(
        Object.values(world.projection.positions)[0]?.measurements.primary
          .quantity.amountMinor
      ).toBe(3);
    });

    it("keeps abort terminal and never publishes its staged plan", async () => {
      let failed = false;
      const storage = createStorage({
        /** Leave one complete plan pending immediately after begin. */
        failpoint: (context) => {
          if (
            !failed &&
            context.stage === InventoryStorageWriteStage.Begin &&
            context.timing === "after"
          ) {
            failed = true;
            throw new Error("Leave pending for abort.");
          }
        },
      });
      const inventory = createTestInventory(storage);
      const command = {
        operationId: "abort-me",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      };
      await expect(inventory.stock.receive(command)).rejects.toThrow(
        "Leave pending"
      );
      const aborted = await storage.abort(command.operationId);
      expect(aborted.state).toBe(InventoryDurableOperationState.Aborted);
      expect((await storage.readWorld()).revision).toBe(0);
      await expect(
        resumeInventoryDurableOperation(storage, command.operationId)
      ).rejects.toThrow("Aborted inventory operation");
      await expect(inventory.stock.receive(command)).rejects.toThrow(
        "Aborted inventory operation"
      );
      expect(await repairInventoryDurableOperations({ storage })).toEqual([]);
    });

    it.each(abortFailureCases)(
      "keeps abort hidden and retryable after $timing $stage failure",
      async (failureCase) => {
        const { stage, timing } = failureCase;
        let beginFailed = false;
        let abortFailed = false;
        const storage = createStorage({
          /** Leave one real compact plan applying, then fail once on the chosen abort side. */
          failpoint: (context) => {
            if (
              !beginFailed &&
              context.stage === InventoryStorageWriteStage.Begin &&
              context.timing === "after"
            ) {
              beginFailed = true;
              throw new Error("Stop after begin for abort test.");
            }
            if (
              !abortFailed &&
              context.stage === stage &&
              context.timing === timing
            ) {
              abortFailed = true;
              throw new Error(`Stop ${timing} ${stage}.`);
            }
          },
        });
        const inventory = createTestInventory(storage);
        const publishedWorld = await storage.readWorld();
        const frozenOperationId = `abort-failpoint-${stage}-${timing}`;
        await expect(
          inventory.stock.receive({
            operationId: frozenOperationId,
            occurredAtEpochMs: time0,
            to: loosePosition("abort-store"),
            amount: stockAmount("1", "piece"),
          })
        ).rejects.toThrow("Stop after begin for abort test");

        await expect(storage.abort(frozenOperationId)).rejects.toThrow(
          `Stop ${timing} ${stage}.`
        );
        expect((await storage.readWorld()).revision).toBe(
          publishedWorld.revision
        );
        const rowAfterFailure = await storage.readOperation(frozenOperationId);
        expect(allowedOperationAbortStatesAfterFailure(failureCase)).toContain(
          rowAfterFailure?.state
        );
        const aborted = await storage.abort(frozenOperationId);
        expect(aborted.state).toBe(InventoryDurableOperationState.Aborted);
        expect((await storage.readWorld()).revision).toBe(
          publishedWorld.revision
        );
      }
    );

    it.each(migrationAbortFailureCases)(
      "keeps reviewed migration abort hidden and retryable after $timing $stage failure",
      async (failureCase) => {
        const { stage, timing } = failureCase;
        let beginFailed = false;
        let abortFailed = false;
        const storage = createStorage({
          /** Freeze one full migration plan, then fail once on the chosen terminal abort side. */
          failpoint: (context) => {
            if (
              !beginFailed &&
              context.stage === InventoryStorageWriteStage.MigrationBegin &&
              context.timing === "after"
            ) {
              beginFailed = true;
              throw new Error("Stop reviewed migration after begin.");
            }
            if (
              !abortFailed &&
              context.stage === stage &&
              context.timing === timing
            ) {
              abortFailed = true;
              throw new Error(`Stop ${timing} ${stage}.`);
            }
          },
        });
        const { catalog, plan } = createStorageConformanceMigration();
        const baseWorld = await storage.readWorld();
        const dryRun = dryRunInventoryMigration({
          catalog,
          plan,
          targetWorld: baseWorld,
        });
        await expect(
          applyInventoryMigrationPlan({
            catalog,
            storage,
            plan,
            dryRun,
            clock: clockAt(time3),
          })
        ).rejects.toThrow("Stop reviewed migration after begin");
        await expect(
          storage.abortMigrationManifest(plan.migrationId)
        ).rejects.toThrow(`Stop ${timing} ${stage}.`);
        expect(await storage.readWorld()).toEqual(baseWorld);
        const manifestAfterFailure = await storage.readMigrationManifest(
          plan.migrationId
        );
        expect(allowedMigrationAbortStatesAfterFailure(failureCase)).toContain(
          manifestAfterFailure?.state
        );
        const aborted = await storage.abortMigrationManifest(plan.migrationId);
        expect(aborted.state).toBe(InventoryMigrationManifestState.Aborted);
        expect(aborted.plan).toBeUndefined();
        expect(await storage.readWorld()).toEqual(baseWorld);
        await expect(
          resumeInventoryMigrationManifest(storage, plan.migrationId)
        ).rejects.toThrow("Aborted inventory migration");
      }
    );
  });
}
