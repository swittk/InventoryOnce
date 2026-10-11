import { expect, it } from "vitest";
import {
  InventoryDeficitPolicy,
  InventoryTraceabilityNodeKind,
  emptyInventoryCatalogSnapshot,
  parseQuantity,
  stockAmount,
  type InventoryWorldState,
} from "../src/index.js";
import { inventoryDurableMigrationPlanDigest, inventoryDurablePlanDigest } from "../src/integrity.js";
import {
  InMemoryInventoryDurableStorage,
  createInMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
import {
  assertInventoryStoragePlanShapePublished,
  runInventoryDurableStorageConformanceSuite,
} from "./storage-conformance-suite.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time3,
} from "./test-fixtures.js";

it("canonicalizes nested compact and migration plan values independently of object insertion order", () => {
  const forwardRoots = {
    world: "world-root",
    catalog: "catalog-root",
    projection: "projection-root",
    reservations: "reservation-root",
    counts: "count-root",
  };
  const reverseRoots = {
    counts: "count-root",
    reservations: "reservation-root",
    projection: "projection-root",
    catalog: "catalog-root",
    world: "world-root",
  };
  const forwardReceipt = {
    operationId: "canonical-plan",
    recordedAtEpochMs: time0,
    worldRevision: 1,
    eventId: "event-1",
  };
  const reverseReceipt = {
    eventId: "event-1",
    worldRevision: 1,
    recordedAtEpochMs: time0,
    operationId: "canonical-plan",
  };
  expect(
    inventoryDurablePlanDigest({
      baseWorldRoot: "base-root",
      catalogRoot: "catalog-root",
      deficitPolicy: InventoryDeficitPolicy.Record,
      receipt: forwardReceipt,
      nextRoots: forwardRoots,
    })
  ).toBe(
    inventoryDurablePlanDigest({
      baseWorldRoot: "base-root",
      catalogRoot: "catalog-root",
      deficitPolicy: InventoryDeficitPolicy.Record,
      receipt: reverseReceipt,
      nextRoots: reverseRoots,
    })
  );
  expect(
    inventoryDurableMigrationPlanDigest({
      baseWorldRoot: "base-root",
      catalogRoot: "catalog-root",
      deficitPolicy: InventoryDeficitPolicy.Record,
      events: [],
      sourceDispositions: [{ sourceId: "source-a", state: { accepted: true, reason: "same" } }],
      nextRoots: forwardRoots,
    })
  ).toBe(
    inventoryDurableMigrationPlanDigest({
      baseWorldRoot: "base-root",
      catalogRoot: "catalog-root",
      deficitPolicy: InventoryDeficitPolicy.Record,
      events: [],
      sourceDispositions: [{ state: { reason: "same", accepted: true }, sourceId: "source-a" }],
      nextRoots: reverseRoots,
    })
  );
});

it("keeps reference-adapter published worlds deeply immutable and identity-stable", async () => {
  const storage = createInMemoryInventoryDurableStorage();
  const inventory = createTestInventory(storage);
  await inventory.stock.receive({
    operationId: "freeze-reference-world",
    occurredAtEpochMs: time0,
    to: loosePosition("freeze-store"),
    amount: stockAmount("2", "piece"),
  });
  const published = await storage.readWorld();
  const firstPosition = Object.values(published.projection.positions)[0];
  expect(Object.isFrozen(published)).toBe(true);
  expect(Object.isFrozen(published.projection)).toBe(true);
  expect(Object.isFrozen(published.projection.positions)).toBe(true);
  expect(Object.isFrozen(firstPosition)).toBe(true);
  expect(
    Reflect.set(published.projection.positions, "forged-position", firstPosition)
  ).toBe(false);
  expect(await storage.readWorld()).toBe(published);
});

it("binds deficit policy into the durable compact-plan digest", () => {
  const common = {
    baseWorldRoot: "base-root",
    catalogRoot: "catalog-root",
    receipt: {
      operationId: "digest-policy",
      recordedAtEpochMs: time0,
      worldRevision: 1,
    },
    nextRoots: {
      world: "world-root",
      catalog: "catalog-root",
      projection: "projection-root",
      reservations: "reservation-root",
      counts: "count-root",
    },
  };
  expect(
    inventoryDurablePlanDigest({
      ...common,
      deficitPolicy: InventoryDeficitPolicy.Record,
    })
  ).not.toBe(
    inventoryDurablePlanDigest({
      ...common,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })
  );
});

/** Which published root/row/index this deliberately broken read adapter hides. */
type HiddenInventoryPart =
  | "none"
  | "catalog"
  | "positions"
  | "item-position-index"
  | "revision-position-index"
  | "placement-position-index"
  | "positive-layer-index"
  | "serial-position-index"
  | "events"
  | "event-sequence-index"
  | "event-operation-index"
  | "lots"
  | "lot-item-index"
  | "lot-root-index"
  | "placement-nodes"
  | "placement-node-root-index"
  | "placement-relations"
  | "placement-child-index"
  | "traceability"
  | "reservations"
  | "counts";
/** Every part the broken adapter may actually hide. */
type HidableInventoryPart = Exclude<HiddenInventoryPart, "none">;
/** Stock rows and every performance/correctness index required by conformance. */
const droppedStockParts: readonly HidableInventoryPart[] = [
  "positions",
  "item-position-index",
  "revision-position-index",
  "placement-position-index",
  "positive-layer-index",
  "serial-position-index",
];
/** Lot projection row and its retained-root index, each required by conformance. */
const droppedLotParts: readonly HidableInventoryPart[] = [
  "lots",
  "lot-item-index",
  "lot-root-index",
];
/** Placement-node metadata row and its retained-root index, each required by conformance. */
const droppedPlacementNodeParts: readonly HidableInventoryPart[] = [
  "placement-nodes",
  "placement-node-root-index",
];
/** Placement topology plus event indexes required to read/rebuild its creating fact. */
const droppedPlacementTopologyParts: readonly HidableInventoryPart[] = [
  "placement-relations",
  "placement-child-index",
  "events",
  "event-sequence-index",
  "event-operation-index",
];
/** Association/genealogy row plus event indexes required to read/rebuild its creating fact. */
const droppedTraceabilityParts: readonly HidableInventoryPart[] = [
  "traceability",
  "events",
  "event-sequence-index",
  "event-operation-index",
];

/** Deliberately violates readWorld so tests prove conformance notices each lost published part. */
class HidingPublishedInventoryPartStorage extends InMemoryInventoryDurableStorage {
  /** Root, projected row set, or required index omitted after the real inner commit. */
  private hiddenPart: HiddenInventoryPart = "none";

  /** Start hiding one completed root/row/index from public reads. */
  hide(part: HidableInventoryPart): void {
    this.hiddenPart = part;
  }

  /** Return a deliberately broken world when one component is selected. */
  override async readWorld(): Promise<InventoryWorldState> {
    const world = await super.readWorld();
    if (this.hiddenPart === "catalog") {
      return { ...world, catalog: emptyInventoryCatalogSnapshot() };
    }
    if (this.hiddenPart === "reservations") {
      return { ...world, reservations: { reservations: {}, operations: {} } };
    }
    if (this.hiddenPart === "counts") {
      return { ...world, counts: { counts: {}, operations: {} } };
    }
    if (this.hiddenPart === "none") return world;
    const projection = world.projection;
    if (this.hiddenPart === "positions") {
      return { ...world, projection: { ...projection, positions: {} } };
    }
    if (this.hiddenPart === "item-position-index") {
      return {
        ...world,
        projection: { ...projection, positionIdsByItemId: {} },
      };
    }
    if (this.hiddenPart === "revision-position-index") {
      return {
        ...world,
        projection: { ...projection, positionIdsByItemRevisionId: {} },
      };
    }
    if (this.hiddenPart === "placement-position-index") {
      return {
        ...world,
        projection: { ...projection, positionIdsByPlacementNodeId: {} },
      };
    }
    if (this.hiddenPart === "positive-layer-index") {
      return {
        ...world,
        projection: { ...projection, positiveLayerStartedAtEpochMsByPositionId: {} },
      };
    }
    if (this.hiddenPart === "serial-position-index") {
      return {
        ...world,
        projection: { ...projection, positivePositionIdBySerialIdentity: {} },
      };
    }
    if (this.hiddenPart === "events") {
      return { ...world, projection: { ...projection, events: {} } };
    }
    if (this.hiddenPart === "event-sequence-index") {
      return {
        ...world,
        projection: { ...projection, eventIdsBySequence: {} },
      };
    }
    if (this.hiddenPart === "event-operation-index") {
      return {
        ...world,
        projection: { ...projection, eventIdByOperationId: {} },
      };
    }
    if (this.hiddenPart === "lots") {
      return { ...world, projection: { ...projection, lots: {} } };
    }
    if (this.hiddenPart === "lot-item-index") {
      return {
        ...world,
        projection: { ...projection, lotIdentitiesByItemId: {} },
      };
    }
    if (this.hiddenPart === "lot-root-index") {
      return {
        ...world,
        projection: { ...projection, lotRootEventIdByIdentity: {} },
      };
    }
    if (this.hiddenPart === "placement-nodes") {
      return { ...world, projection: { ...projection, placementNodes: {} } };
    }
    if (this.hiddenPart === "placement-node-root-index") {
      return {
        ...world,
        projection: { ...projection, placementNodeRootEventIdByNodeId: {} },
      };
    }
    if (this.hiddenPart === "placement-relations") {
      return {
        ...world,
        projection: {
          ...projection,
          placement: {
            ...projection.placement,
            relationByNodeId: {},
          },
        },
      };
    }
    if (this.hiddenPart === "placement-child-index") {
      return {
        ...world,
        projection: {
          ...projection,
          placement: {
            ...projection.placement,
            childNodeIdsByParentNodeId: {},
          },
        },
      };
    }
    if (this.hiddenPart === "traceability") {
      return {
        ...world,
        projection: {
          ...projection,
          traceability: {
            ...projection.traceability,
            relations: {},
          },
        },
      };
    }
    const unsupported: never = this.hiddenPart;
    throw new Error(
      `Unsupported hidden inventory part '${String(unsupported)}'.`
    );
  }
}

runInventoryDurableStorageConformanceSuite(
  "reference in-memory adapter",
  (input) => createInMemoryInventoryDurableStorage(input)
);

/** Prove one named plan shape is valid before a deliberate hidden-part read breaks it. */
function expectHiddenPublishedPartDetected(
  shapeName: string,
  visibleWorld: InventoryWorldState,
  hiddenWorld: InventoryWorldState,
  hiddenPart: HidableInventoryPart
): void {
  expect(
    () => assertInventoryStoragePlanShapePublished(shapeName, visibleWorld),
    `baseline shape '${shapeName}' must be valid before hiding '${hiddenPart}'`
  ).not.toThrow();
  expect(
    () => assertInventoryStoragePlanShapePublished(shapeName, hiddenWorld),
    `hidden part '${hiddenPart}' must break valid shape '${shapeName}'`
  ).toThrow();
}

it("the reusable component assertions reject adapters that lose reservation or count books", async () => {
  const reservationStorage = new HidingPublishedInventoryPartStorage();
  const reservationInventory = createTestInventory(reservationStorage);
  await reservationInventory.stock.receive({
    operationId: "broken-reservation-stock",
    occurredAtEpochMs: time0,
    to: loosePosition("reserve-store"),
    amount: stockAmount("2", "piece"),
  });
  await reservationInventory.reservations.reserve({
    reservationId: "shape-claim",
    operationId: "broken-reservation",
    itemRevisionId: "item-a-v2",
    selector: { itemId: "item-a", placementNodeIds: ["reserve-store"] },
    requested: parseQuantity("1", "piece"),
    createdAtEpochMs: time0,
  });
  const visibleReservationWorld = await reservationStorage.readWorld();
  reservationStorage.hide("reservations");
  const reservationWorld = await reservationStorage.readWorld();
  expectHiddenPublishedPartDetected(
    "reservation-only",
    visibleReservationWorld,
    reservationWorld,
    "reservations"
  );

  const countStorage = new HidingPublishedInventoryPartStorage();
  const countInventory = createTestInventory(countStorage);
  await countInventory.counts.start({
    countId: "shape-count",
    operationId: "broken-count",
    selector: { itemId: "item-a" },
    startedAtEpochMs: time0,
  });
  const visibleCountWorld = await countStorage.readWorld();
  countStorage.hide("counts");
  const countWorld = await countStorage.readWorld();
  expectHiddenPublishedPartDetected(
    "count-only",
    visibleCountWorld,
    countWorld,
    "counts"
  );
});

it("the reusable shapes reject dropped catalogue, stock, lot, placement, traceability, and event indexes", async () => {
  const catalogStorage = new HidingPublishedInventoryPartStorage();
  const catalogInventory = createTestInventory(catalogStorage);
  await catalogInventory.catalog.publish({
    operationId: "shape-catalog",
    occurredAtEpochMs: time0,
  });
  const visibleCatalogWorld = await catalogStorage.readWorld();
  catalogStorage.hide("catalog");
  const hiddenCatalogWorld = await catalogStorage.readWorld();
  expectHiddenPublishedPartDetected(
    "catalog-only",
    visibleCatalogWorld,
    hiddenCatalogWorld,
    "catalog"
  );

  for (const hiddenPart of droppedStockParts) {
    const stockStorage = new HidingPublishedInventoryPartStorage();
    const stockInventory = createTestInventory(stockStorage);
    await stockInventory.stock.receive({
      operationId: "shape-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("SHAPE-STOCK-CONTAINER", {
        serialId: "SHAPE-SERIAL",
      }),
      amount: stockAmount("1", "piece"),
    });
    const visiblePositionWorld = await stockStorage.readWorld();
    stockStorage.hide(hiddenPart);
    const hiddenPositionWorld = await stockStorage.readWorld();
    expectHiddenPublishedPartDetected(
      "stock-only",
      visiblePositionWorld,
      hiddenPositionWorld,
      hiddenPart
    );
  }

  for (const hiddenPart of droppedLotParts) {
    const lotStorage = new HidingPublishedInventoryPartStorage();
    const lotInventory = createTestInventory(lotStorage);
    await lotInventory.lots.define({
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
    const visibleLotWorld = await lotStorage.readWorld();
    lotStorage.hide(hiddenPart);
    const hiddenLotWorld = await lotStorage.readWorld();
    expectHiddenPublishedPartDetected(
      "lot-master-only",
      visibleLotWorld,
      hiddenLotWorld,
      hiddenPart
    );
  }

  for (const hiddenPart of droppedPlacementNodeParts) {
    const nodeStorage = new HidingPublishedInventoryPartStorage();
    const nodeInventory = createTestInventory(nodeStorage);
    await nodeInventory.placement.define({
      operationId: "shape-placement-node-master",
      occurredAtEpochMs: time0,
      nodeId: "SHAPE-NODE",
      placementNode: {
        category: "carton",
        identifiers: { barcode: "SHAPE-001" },
      },
    });
    const visibleNodeWorld = await nodeStorage.readWorld();
    nodeStorage.hide(hiddenPart);
    const hiddenNodeWorld = await nodeStorage.readWorld();
    expectHiddenPublishedPartDetected(
      "placement-node-master-only",
      visibleNodeWorld,
      hiddenNodeWorld,
      hiddenPart
    );
  }

  for (const hiddenPart of droppedPlacementTopologyParts) {
    const placementStorage = new HidingPublishedInventoryPartStorage();
    const placementInventory = createTestInventory(placementStorage);
    await placementInventory.placement.move({
      operationId: "shape-placement",
      occurredAtEpochMs: time0,
      nodeId: "SHAPE-CHILD",
      into: "SHAPE-PARENT",
    });
    const visiblePlacementWorld = await placementStorage.readWorld();
    placementStorage.hide(hiddenPart);
    const hiddenPlacementWorld = await placementStorage.readWorld();
    expectHiddenPublishedPartDetected(
      "placement-only",
      visiblePlacementWorld,
      hiddenPlacementWorld,
      hiddenPart
    );
  }

  for (const hiddenPart of droppedTraceabilityParts) {
    const traceStorage = new HidingPublishedInventoryPartStorage();
    const traceInventory = createTestInventory(traceStorage);
    await traceInventory.traceability.associate({
      operationId: "shape-traceability",
      occurredAtEpochMs: time0,
      from: {
        kind: InventoryTraceabilityNodeKind.PlacementNode,
        id: "SHAPE-CHILD",
      },
      to: { kind: InventoryTraceabilityNodeKind.PlacementNode, id: "SHAPE-PARENT" },
    });
    const visibleTraceabilityWorld = await traceStorage.readWorld();
    traceStorage.hide(hiddenPart);
    const hiddenTraceabilityWorld = await traceStorage.readWorld();
    expectHiddenPublishedPartDetected(
      "traceability-only",
      visibleTraceabilityWorld,
      hiddenTraceabilityWorld,
      hiddenPart
    );
  }
});
