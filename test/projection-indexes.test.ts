import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryTraceabilityNodeKind,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  planInventoryAllocation,
  stockAmount,
} from "../src/index.js";
import {
  InventoryDeficitPolicy,
  findInventoryPositions,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  projectInventoryEvents,
} from "../src/kernel.js";
import {
  createTabletCatalog,
  createTestInventory,
  clockAt,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Build fixed occurrence times for deterministic projection-index stress coverage. */
function indexedStressTime(minute: number): string {
  return `2026-08-24T12:${String(minute).padStart(2, "0")}:00.000Z`;
}

/** Build two unrelated items so index-local reads can prove they avoid global scans. */
function twoItemCatalog(): ReturnType<typeof createTabletCatalog> {
  const base = createTabletCatalog();
  const itemB = defineScalarInventoryItem({
    itemId: "item-b",
    revisionId: "item-b-v1",
    unit: "piece",
    axisId: "pieces",
  });
  return extendInventoryCatalog({
    catalog: base,
    itemRevisions: [itemB],
    activeItemRevisionIds: { "item-b": itemB.revisionId },
  });
}

/** Build a record that permits exact-key lookup but rejects whole-record enumeration. */
function nonEnumerableRecord<Value extends object>(value: Value): Value {
  return new Proxy(value, {
    /** Item-local reads must use their exact position identities, not Object.values/keys. */
    ownKeys: () => {
      throw new Error("Performance regression: backing record was enumerated.");
    },
  });
}

/** Build a proxy that fails if an algorithm enumerates or reads the event-history record. */
function unreadableHistory<Value extends object>(value: Value): Value {
  return new Proxy(value, {
    /** FIFO/read algorithms must use projected indexes instead of history lookup. */
    get: () => {
      throw new Error("Performance regression: event history was read.");
    },
    /** Item-local reads must not enumerate the entire backing record. */
    ownKeys: () => {
      throw new Error("Performance regression: backing record was enumerated.");
    },
  });
}

describe("rebuildable stock performance indexes", () => {
  it("reads one item without enumerating unrelated position rows", async () => {
    const catalog = twoItemCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({
      operationId: "index-receive-a",
      occurredAt: time0,
      to: loosePosition("store-a"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "index-receive-b",
      occurredAt: time0,
      to: { itemId: "item-b", locationId: "store-b" },
      amount: stockAmount("3", "piece"),
    });
    const world = await inventory.read.world();
    const projection = {
      ...world.projection,
      positions: nonEnumerableRecord(world.projection.positions),
    };
    const selected = findInventoryPositions(projection, { itemId: "item-a" });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.key.itemId).toBe("item-a");
    expect(world.projection.positionIdsByItemId["item-b"]).toHaveLength(1);
  });

  it("uses the immutable revision index when the selector names exact revisions", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "revision-index-receive",
      occurredAt: time0,
      to: loosePosition("revision-store"),
      amount: stockAmount("2", "piece"),
    });
    const world = await inventory.read.world();
    const projection = {
      ...world.projection,
      positionIdsByItemId: unreadableHistory(
        world.projection.positionIdsByItemId
      ),
      positions: nonEnumerableRecord(world.projection.positions),
    };
    const selected = findInventoryPositions(projection, {
      itemId: "item-a",
      itemRevisionIds: ["item-a-v2"],
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.key.itemRevisionId).toBe("item-a-v2");
  });

  it("projects FIFO positive-layer provenance once and resets it only after depletion", async () => {
    const inventory = createTestInventory();
    const position = loosePosition("fifo-store", { lotId: "FIFO-LOT" });
    await inventory.stock.receive({
      operationId: "fifo-layer-first",
      occurredAt: time0,
      to: position,
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "fifo-layer-top-up",
      occurredAt: time1,
      to: position,
      amount: stockAmount("1", "piece"),
    });
    let world = await inventory.read.world();
    const exact = world.projection.positionIdsByItemId["item-a"]?.[0];
    if (exact === undefined)
      throw new Error("FIFO position index disappeared.");
    expect(world.projection.positiveLayerStartedAtByPositionId[exact]).toBe(
      time0
    );

    await inventory.stock.issue({
      operationId: "fifo-layer-deplete",
      occurredAt: time2,
      from: position,
      amount: stockAmount("3", "piece"),
    });
    world = await inventory.read.world();
    expect(
      world.projection.positiveLayerStartedAtByPositionId[exact]
    ).toBeUndefined();

    await inventory.stock.receive({
      operationId: "fifo-layer-restart",
      occurredAt: time3,
      to: position,
      amount: stockAmount("1", "piece"),
    });
    world = await inventory.read.world();
    expect(world.projection.positiveLayerStartedAtByPositionId[exact]).toBe(
      time3
    );
  });

  it("moves one serial atomically while retaining exactly one positive serial index row", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "serial-index-receive",
      occurredAt: time0,
      to: loosePosition("serial-a", { serialId: "SERIAL-1" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "serial-index-transfer",
      occurredAt: time1,
      from: loosePosition("serial-a", { serialId: "SERIAL-1" }),
      toLocationId: "serial-b",
      amount: stockAmount("1", "piece"),
    });
    const world = await inventory.read.world();
    const destination = loosePosition("serial-b", { serialId: "SERIAL-1" });
    const destinationId = inventoryStockPositionIdentity({
      ...destination,
      itemRevisionId: "item-a-v2",
    });
    expect(
      world.projection.positivePositionIdBySerialIdentity[
        inventorySerialIdentity("item-a", "SERIAL-1")
      ]
    ).toBe(destinationId);
    expect(
      world.projection.positions[destinationId]?.measurements.primary.quantity
        .amountMinor
    ).toBe(1);
  });

  it("rebuilds every performance index deterministically from retained events", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "rebuild-index-a",
      occurredAt: time0,
      to: loosePosition("rebuild-store", { lotId: "R1" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "rebuild-index-b",
      occurredAt: time1,
      to: loosePosition("rebuild-store", {
        lotId: "R2",
        serialId: "R2-SERIAL",
        containerId: "R2-CONTAINER",
      }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.traceability.aggregate({
      operationId: "rebuild-container-nesting",
      occurredAt: time2,
      from: {
        kind: InventoryTraceabilityNodeKind.Container,
        id: "R2-CONTAINER",
      },
      to: {
        kind: InventoryTraceabilityNodeKind.Container,
        id: "R2-OUTER",
      },
    });
    const world = await inventory.read.world();
    const rebuilt = projectInventoryEvents({
      catalog: createTabletCatalog(),
      events: Object.values(world.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt.positionIdsByItemId).toEqual(
      world.projection.positionIdsByItemId
    );
    expect(rebuilt.positionIdsByItemRevisionId).toEqual(
      world.projection.positionIdsByItemRevisionId
    );
    expect(rebuilt.positionIdsByContainerIdentity).toEqual(
      world.projection.positionIdsByContainerIdentity
    );
    expect(rebuilt.positiveLayerStartedAtByPositionId).toEqual(
      world.projection.positiveLayerStartedAtByPositionId
    );
    expect(rebuilt.positivePositionIdBySerialIdentity).toEqual(
      world.projection.positivePositionIdBySerialIdentity
    );
    expect(
      rebuilt.traceability.containmentChildContainerIdsByParentNodeIdentity
    ).toEqual(
      world.projection.traceability
        .containmentChildContainerIdsByParentNodeIdentity
    );
  });

  it("plans FIFO without touching retained event history", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({
      operationId: "indexed-fifo-first",
      occurredAt: time0,
      to: loosePosition("indexed-fifo", { lotId: "OLD" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "indexed-fifo-second",
      occurredAt: time1,
      to: loosePosition("indexed-fifo", { lotId: "NEW" }),
      amount: stockAmount("1", "piece"),
    });
    const world = await inventory.read.world();
    const historyFreeWorld = {
      ...world,
      projection: {
        ...world.projection,
        events: unreadableHistory(world.projection.events),
        eventIdsBySequence: unreadableHistory(
          world.projection.eventIdsBySequence
        ),
      },
    };
    const plan = planInventoryAllocation({
      catalog,
      world: historyFreeWorld,
      selector: { itemId: "item-a", locationIds: ["indexed-fifo"] },
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    });
    expect(plan.lines[0]?.position.lotId).toBe("OLD");
    expect(plan.lines[0]?.layerStartedAt).toBe(time0);
  });

  it("keeps reset, transfer, backdated correction, and rebuild provenance exact at a fixed candidate count", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(
      undefined,
      catalog,
      clockAt("2026-08-24T18:00:00.000Z")
    );
    await inventory.stock.receive({
      operationId: "stress-reset-root",
      occurredAt: indexedStressTime(0),
      to: loosePosition("stress-store", { lotId: "RESET" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.issue({
      operationId: "stress-reset-deplete",
      occurredAt: indexedStressTime(1),
      from: loosePosition("stress-store", { lotId: "RESET" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "stress-reset-restart",
      occurredAt: indexedStressTime(2),
      to: loosePosition("stress-store", { lotId: "RESET" }),
      amount: stockAmount("1", "piece"),
    });
    const correctedRoot = await inventory.stock.receive({
      operationId: "stress-correction-root",
      occurredAt: indexedStressTime(3),
      to: loosePosition("stress-store", { lotId: "CORRECTED" }),
      amount: stockAmount("1", "piece"),
    });
    /** Fixed candidate lots make the no-history-read check a repeatable complexity guard. */
    const candidateLotIds = Array.from(
      { length: 32 },
      (_, index) => `STRESS-${String(index).padStart(2, "0")}`
    );
    for (const [index, lotId] of candidateLotIds.entries()) {
      await inventory.stock.receive({
        operationId: `stress-receive-${lotId}`,
        occurredAt: indexedStressTime(index + 4),
        to: loosePosition("stress-store", { lotId }),
        amount: stockAmount("1", "piece"),
      });
    }
    await inventory.stock.transfer({
      operationId: "stress-transfer-candidate",
      occurredAt: "2026-08-24T13:00:00.000Z",
      from: loosePosition("stress-store", { lotId: "STRESS-15" }),
      toLocationId: "stress-room",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.correct({
      operationId: "stress-backdated-correction",
      occurredAt: "2026-08-24T14:00:00.000Z",
      correctsEventId: correctedRoot.event.eventId,
      reason: "The receipt was recorded after the physical arrival time.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAt: time0,
          to: loosePosition("stress-store", { lotId: "CORRECTED" }),
          amount: stockAmount("1", "piece"),
        }),
    });

    const world = await inventory.read.world();
    expect(Object.keys(world.projection.events)).toHaveLength(38);
    const resetPositionId = inventoryStockPositionIdentity({
      ...loosePosition("stress-store", { lotId: "RESET" }),
      itemRevisionId: "item-a-v2",
    });
    const correctedPositionId = inventoryStockPositionIdentity({
      ...loosePosition("stress-store", { lotId: "CORRECTED" }),
      itemRevisionId: "item-a-v2",
    });
    const movedPositionId = inventoryStockPositionIdentity({
      ...loosePosition("stress-room", { lotId: "STRESS-15" }),
      itemRevisionId: "item-a-v2",
    });
    expect(world.projection.positiveLayerStartedAtByPositionId).toMatchObject({
      [resetPositionId]: indexedStressTime(2),
      [correctedPositionId]: time0,
      [movedPositionId]: indexedStressTime(19),
    });

    const rebuilt = projectInventoryEvents({
      catalog,
      events: Object.values(world.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt.positionIdsByItemRevisionId).toEqual(
      world.projection.positionIdsByItemRevisionId
    );
    expect(rebuilt.positiveLayerStartedAtByPositionId).toEqual(
      world.projection.positiveLayerStartedAtByPositionId
    );

    const historyFreeWorld = {
      ...world,
      projection: {
        ...world.projection,
        events: unreadableHistory(world.projection.events),
        eventIdsBySequence: unreadableHistory(
          world.projection.eventIdsBySequence
        ),
      },
    };
    const plan = planInventoryAllocation({
      catalog,
      world: historyFreeWorld,
      selector: { itemId: "item-a", locationIds: ["stress-room"] },
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: "2026-08-24T15:00:00.000Z",
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.position.lotId).toBe("STRESS-15");
    expect(plan.lines[0]?.layerStartedAt).toBe(indexedStressTime(19));
  });

  it("keeps the oldest FIFO layer when conserved stock joins an existing destination", async () => {
    const inventory = createTestInventory();
    const source = loosePosition("merge-source", { lotId: "MERGE-FIFO" });
    const destination = loosePosition("merge-destination", {
      lotId: "MERGE-FIFO",
    });
    await inventory.stock.receive({
      operationId: "fifo-merge-source-old",
      occurredAt: time0,
      to: source,
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "fifo-merge-destination-new",
      occurredAt: time1,
      to: destination,
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "fifo-merge-transfer",
      occurredAt: time2,
      from: source,
      toLocationId: "merge-destination",
      amount: stockAmount("2", "piece"),
    });
    const world = await inventory.read.world();
    const destinationId = inventoryStockPositionIdentity({
      ...destination,
      itemRevisionId: "item-a-v2",
    });
    expect(world.projection.positiveLayerStartedAtByPositionId[destinationId])
      .toBe(time0);
  });

  it("preserves FIFO age through pack, unpack, and one-to-one status reclassification", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "fifo-package-receive",
      occurredAt: time0,
      to: loosePosition("package-provenance"),
      itemRevisionId: "item-a-v1",
      amount: stockAmount("20", "piece"),
    });
    await inventory.stock.pack({
      operationId: "fifo-package-pack",
      occurredAt: time1,
      from: loosePosition("package-provenance"),
      packagingRevisionId: "item-a-box-20-v1",
      packageCount: 1,
    });
    let world = await inventory.read.world();
    const packaged = (await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
      packagingRevisionIds: ["item-a-box-20-v1"],
    }))[0];
    if (packaged === undefined) throw new Error("Pack provenance row disappeared.");
    expect(
      world.projection.positiveLayerStartedAtByPositionId[
        inventoryStockPositionIdentity(packaged.key)
      ]
    ).toBe(time0);

    await inventory.stock.unpack({
      operationId: "fifo-package-unpack",
      occurredAt: time2,
      from: packaged.key,
      packageCount: 1,
    });
    const loose = (await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
      locationIds: ["package-provenance"],
    }))[0];
    if (loose === undefined) throw new Error("Unpack provenance row disappeared.");
    await inventory.stock.changeStatus({
      operationId: "fifo-package-status",
      occurredAt: time3,
      from: loose.key,
      toStatusId: "quarantine",
      amount: stockAmount("20", "piece"),
      itemRevisionId: "item-a-v1",
    });
    world = await inventory.read.world();
    const quarantined = (await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
      statusIds: ["quarantine"],
    }))[0];
    if (quarantined === undefined) {
      throw new Error("Reclassified provenance row disappeared.");
    }
    expect(
      world.projection.positiveLayerStartedAtByPositionId[
        inventoryStockPositionIdentity(quarantined.key)
      ]
    ).toBe(time0);
  });


  it("does not guess FIFO lineage from multi-line reclassification array order", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "multi-provenance-source-a",
      occurredAt: time0,
      to: loosePosition("multi-provenance", { lotId: "MULTI-A" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "multi-provenance-source-b",
      occurredAt: time1,
      to: loosePosition("multi-provenance", { lotId: "MULTI-B" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.reclassifyMany({
      operationId: "multi-provenance-reclassify",
      occurredAt: time2,
      consume: [
        {
          from: loosePosition("multi-provenance", { lotId: "MULTI-A" }),
          amount: stockAmount("1", "piece"),
        },
        {
          from: loosePosition("multi-provenance", { lotId: "MULTI-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
      produce: [
        {
          to: loosePosition("multi-provenance", {
            lotId: "MULTI-A",
            statusId: "quarantine",
          }),
          amount: stockAmount("1", "piece"),
        },
        {
          to: loosePosition("multi-provenance", {
            lotId: "MULTI-B",
            statusId: "inspection",
          }),
          amount: stockAmount("1", "piece"),
        },
      ],
      reason: "The batch has no declared source-to-destination lineage pairs.",
    });
    const world = await inventory.read.world();
    for (const [lotId, statusId] of [
      ["MULTI-A", "quarantine"],
      ["MULTI-B", "inspection"],
    ] as const) {
      const identity = inventoryStockPositionIdentity({
        ...loosePosition("multi-provenance", { lotId, statusId }),
        itemRevisionId: "item-a-v2",
      });
      expect(world.projection.positiveLayerStartedAtByPositionId[identity])
        .toBe(time2);
    }
  });

});
