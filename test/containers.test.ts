import { describe, expect, it, vi } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryEventKind,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
} from "../src/migrations-api.js";
import {
  createInventoryPlacementEvent,
  defineInventoryEvent,
  inventoryCatalogSnapshot,
  inventoryEventIntentFingerprint,
} from "../src/kernel.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-PLACEMENT-COMMAND-ATOMIC",
] as const;

it("declines standalone unplacement and independent routes through the stock commit hook", async () => {
  const storage = createInMemoryInventoryDurableStorage();
  const catalog = createTabletCatalog();
  const inventory = createTestInventory(storage, catalog);
  await inventory.placement.move({
    operationId: "place-before-unplace", occurredAtEpochMs: time0,
    nodeId: "child", into: "parent",
  });
  await inventory.placement.move({
    operationId: "place-independent-child", occurredAtEpochMs: time0,
    nodeId: "other-child", into: "other-parent",
  });
  const before = storage.readSegmentedStockHead();
  const event = createInventoryPlacementEvent({
    catalog, operationId: "unplace-child", occurredAtEpochMs: time1,
    nodeId: "child", fromParentNodeId: "parent",
  });
  const independent = defineInventoryEvent({
    catalog,
    event: {
      ...event, eventId: "independent-moves", operationId: "independent-moves",
      placementChanges: [
        { nodeId: "child", fromParentNodeId: "parent", toParentNodeId: "next-parent" },
        { nodeId: "other-child", fromParentNodeId: "other-parent", toParentNodeId: "next-other-parent" },
      ],
    },
  });
  for (const draft of [event, independent]) {
    expect(await storage.commitSegmentedStockEvent({
      catalog: inventoryCatalogSnapshot(catalog), operationId: draft.operationId,
      intentFingerprint: inventoryEventIntentFingerprint(draft), recordedAtEpochMs: time2,
      expectedWorldRevision: before.worldRevision, expectedRecordSequence: before.recordSequence,
      deficitPolicy: InventoryDeficitPolicy.Reject, event: draft,
    })).toBeUndefined();
  }
  expect(storage.readSegmentedStockHead()).toEqual(before);
  await inventory.placement.unplace({
    operationId: event.operationId, occurredAtEpochMs: time1,
    nodeId: "child", expectedParent: "parent",
  });
  expect(storage.readPlacementSegment().parentNodeId("child")).toBeUndefined();
});

it("declines a single-node move into its sibling through the contents commit hook", async () => {
  const storage = createInMemoryInventoryDurableStorage();
  const catalog = createTabletCatalog();
  const inventory = createTestInventory(storage, catalog);
  for (const nodeId of ["child", "sibling"]) {
    await inventory.placement.move({
      operationId: `place-${nodeId}`, occurredAtEpochMs: time0, nodeId, into: "parent",
    });
  }
  const before = storage.readSegmentedStockHead();
  const event = createInventoryPlacementEvent({
    catalog, operationId: "nest-child", occurredAtEpochMs: time1,
    nodeId: "child", fromParentNodeId: "parent", toParentNodeId: "sibling",
  });
  await expect(storage.commitSegmentedStockEvent({
    catalog: inventoryCatalogSnapshot(catalog), operationId: event.operationId,
    intentFingerprint: inventoryEventIntentFingerprint(event), recordedAtEpochMs: time2,
    expectedWorldRevision: before.worldRevision, expectedRecordSequence: before.recordSequence,
    deficitPolicy: InventoryDeficitPolicy.Reject, event,
  })).resolves.toBeUndefined();
  expect(storage.readSegmentedStockHead()).toEqual(before);
  expect(await storage.readOperation(event.operationId)).toBeUndefined();
  expect(await inventory.read.placementAncestry("child")).toEqual(["child", "parent"]);

  const moved = await inventory.placement.move({
    operationId: event.operationId, occurredAtEpochMs: time1, nodeId: "child", into: "sibling",
  });
  expect(moved.event.placementChanges).toEqual(event.placementChanges);
  expect(await inventory.read.placementAncestry("child")).toEqual(["child", "sibling", "parent"]);
  expect(storage.readSegmentedStockHead().worldRevision).toBe(before.worldRevision + 1);
});

it("replays a contents move published between the operation lookup and head read", async () => {
  const storage = createInMemoryInventoryDurableStorage();
  const inventory = createTestInventory(storage);
  await inventory.stock.receive({
    operationId: "receive-contents-race", occurredAtEpochMs: time0,
    to: loosePosition("source"), amount: stockAmount("1", "piece"),
  });
  const command = {
    operationId: "contents-race", occurredAtEpochMs: time1, nodeId: "source", into: "destination",
  };
  const baseline = storage.readSegmentedStockHead();
  const readOperation = storage.readOperation.bind(storage);
  vi.spyOn(storage, "readOperation").mockImplementationOnce(async (operationId) => {
    const prior = await readOperation(operationId);
    await inventory.placement.moveContents(command);
    return prior;
  });
  const readWorld = vi.spyOn(storage, "readWorld");
  const replay = await inventory.placement.moveContents(command);
  expect(replay.replayed).toBe(true);
  expect(replay.receipt.worldRevision).toBe(baseline.worldRevision + 1);
  expect(storage.readSegmentedStockHead().worldRevision).toBe(baseline.worldRevision + 1);
  expect(readWorld).not.toHaveBeenCalled();
});

it("publishes direct stock, standalone children, and embodied children at one native fence", async () => {
  const storage = createInMemoryInventoryDurableStorage();
  // A failpoint routes reference writes through the canonical staged coordinator.
  const canonicalStorage = createInMemoryInventoryDurableStorage({ failpoint: () => undefined });
  const catalog = createHeterogeneousPlacementCatalog();
  const native = createTestInventory(storage, catalog);
  const canonical = createTestInventory(canonicalStorage, catalog);
  for (const inventory of [native, canonical]) {
    await inventory.stock.receive({
      operationId: "receive-composite", occurredAtEpochMs: time0,
      to: loosePosition("source"), amount: stockAmount("3", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "individualize-composite", occurredAtEpochMs: time1,
      from: loosePosition("source"), amount: stockAmount("1", "piece"),
      serialId: "case", asPlacementNode: { acceptsPlacement: true },
    });
    await inventory.stock.receive({
      operationId: "stock-below-composite", occurredAtEpochMs: time1,
      to: { itemId: "item-b", placementNodeId: "case" }, amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "independent-composite-child", occurredAtEpochMs: time1, nodeId: "standalone", into: "source",
    });
  }
  const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
  const before = storage.readSegmentedStockHead();
  const direct = storage.readSegmentedDirectContents({
    sourceNodeId: "source", destinationNodeId: "destination",
  });
  expect(direct.positions).toHaveLength(2);
  expect(direct.children).toMatchObject([{ nodeId: "case", embodiedPosition: { key: { serialId: "case" } } }, { nodeId: "standalone" }]);
  const metadata = { inventoryOnceReportedTransferReplay: "placement audit reference" };
  const input = {
    operationId: "empty-composite", occurredAtEpochMs: time2, nodeId: "source", into: "destination", metadata,
  };
  await expect(native.placement.moveContents({ ...input, into: "case" })).rejects.toThrow("descendants");
  const publish = storage.commitSegmentedStockEvent.bind(storage);
  const write = vi.spyOn(storage, "commitSegmentedStockEvent");
  write.mockRejectedValueOnce(new Error("before composite publish"));
  await expect(native.placement.moveContents(input)).rejects.toThrow("before composite publish");
  expect(storage.readSegmentedStockHead()).toEqual(before);
  expect(await native.read.placementAncestry("case")).toEqual(["case", "source"]);
  expect(await native.read.placementAncestry("standalone")).toEqual(["standalone", "source"]);
  expect(await native.read.positions({ itemId: "item-a", placementNodeIds: ["source"] }))
    .toEqual(direct.positions);
  expect(await native.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual([]);
  write.mockImplementationOnce(async (plan) => {
    await publish(plan);
    throw new Error("after composite publish");
  });
  await expect(native.placement.moveContents(input)).rejects.toThrow("after composite publish");
  const result = await createTestInventory(storage, catalog).placement.moveContents(input);
  expect(result).toEqual({ ...await canonical.placement.moveContents(input), replayed: true });
  expect(result.event.metadata).toEqual(metadata);
  expect(result.receipt.worldRevision).toBe(before.worldRevision + 1);
  expect(await native.read.placementAncestry("case")).toEqual(["case", "destination"]);
  expect(await native.read.placementAncestry("standalone")).toEqual(["standalone", "destination"]);
  const nativePlacement = storage.readPlacementSegment();
  const canonicalPlacement = canonicalStorage.readPlacementSegment();
  expect(await nativePlacement.childNodeIds("source")).toEqual(await canonicalPlacement.childNodeIds("source"));
  expect(await nativePlacement.childNodeIds("destination")).toEqual(await canonicalPlacement.childNodeIds("destination"));
  expect(await nativePlacement.contentRoot()).toEqual(await canonicalPlacement.contentRoot());
  expect(await native.read.positions({ itemId: "item-b", placementNodeIds: ["case"] })).toHaveLength(1);
  expect(await native.read.positions({ itemId: "item-a", placementNodeIds: ["source"] })).toEqual([]);
  const destinationRows = await native.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] });
  expect(destinationRows).toHaveLength(2);
  expect(destinationRows.find((row) => row.key.serialId === undefined)?.measurements.primary.quantity)
    .toEqual(parseQuantity("2", "piece"));
  expect(destinationRows.find((row) => row.key.serialId === "case")?.measurements.primary.quantity)
    .toEqual(parseQuantity("1", "piece"));
  expect(readWorld).not.toHaveBeenCalled();
  readWorld.mockRestore();
  expect(await native.read.world()).toEqual(await canonical.read.world());
});

it("reconciles a subtree count after an edge-only contents move on both storage paths", async () => {
  const catalog = createTabletCatalog();
  const storage = createInMemoryInventoryDurableStorage();
  const canonicalStorage = createInMemoryInventoryDurableStorage({ failpoint: () => undefined });
  const native = createTestInventory(storage, catalog);
  const canonical = createTestInventory(canonicalStorage, catalog);
  for (const inventory of [native, canonical]) {
    await inventory.stock.receive({
      operationId: "receive-beneath-count-cart", occurredAtEpochMs: time0,
      to: loosePosition("child"), amount: stockAmount("2", "piece"),
    });
    await inventory.placement.move({
      operationId: "park-count-cart-child", occurredAtEpochMs: time0, nodeId: "child", into: "source",
    });
    await inventory.counts.start({
      operationId: "start-source-subtree-count", countId: "source-count", startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["source"] },
    });
  }

  const command = { operationId: "move-after-count-start", occurredAtEpochMs: time2, nodeId: "source", into: "destination" };
  const readWorld = vi.spyOn(storage, "readWorld");
  const moved = await native.placement.moveContents(command);
  expect(moved).toEqual(await canonical.placement.moveContents(command));
  expect(moved.event.stockEffects).toEqual([]);
  expect(readWorld).not.toHaveBeenCalled();
  readWorld.mockRestore();

  for (const inventory of [native, canonical]) {
    await inventory.counts.observe({
      operationId: "observe-empty-source-subtree", countId: "source-count", observedAtEpochMs: time2,
      observations: [],
    });
    const reconciled = await inventory.counts.reconcile({
      operationId: "reconcile-empty-source-subtree", countId: "source-count", completedAtEpochMs: time3,
    });
    expect(reconciled.event).toBeUndefined();
    expect(await inventory.read.placementAncestry("child")).toEqual(["child", "destination"]);
    const childPositions = await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["child"] });
    expect(childPositions.map((position) => position.measurements.primary.quantity)).toEqual([parseQuantity("2", "piece")]);
  }
  expect(await native.read.world()).toEqual(await canonical.read.world());
});

it.each([
  { move: "node", deficit: "1", error: "is not positive after its event" },
  { move: "contents", deficit: "1", error: "is not positive after its event" },
  { move: "node", deficit: "0.5", error: "must represent exactly one primary resource" },
  { move: "contents", deficit: "0.5", error: "must represent exactly one primary resource" },
])("keeps an embodied edge and serial unchanged after a $move move into a $deficit deficit", async ({ move, deficit, error }) => {
  const catalog = createTabletCatalog();
  for (const storage of [
    createInMemoryInventoryDurableStorage(),
    createInMemoryInventoryDurableStorage({ failpoint: () => undefined }),
  ]) {
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const amount = stockAmount("1", "piece");
    await inventory.stock.issue({
      operationId: "serial-destination-deficit", occurredAtEpochMs: time0,
      from: loosePosition("destination", { serialId: "deficit-case" }), amount: stockAmount(deficit, "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-deficit-case", occurredAtEpochMs: time0,
      to: loosePosition("source"), amount,
    });
    await inventory.stock.individualize({
      operationId: "embody-deficit-case", occurredAtEpochMs: time1,
      from: loosePosition("source"), amount, serialId: "deficit-case",
      asPlacementNode: { acceptsPlacement: true },
    });
    const before = await inventory.read.world();
    const beforeStock = storage.readSegmentedStockHead();
    const beforeRows = storage.readPositionSegment().materialize();
    const command = {
      operationId: "move-into-serial-deficit", occurredAtEpochMs: time2,
      nodeId: move === "node" ? "deficit-case" : "source", into: "destination",
    };
    await expect(move === "node" ? inventory.placement.move(command) : inventory.placement.moveContents(command))
      .rejects.toThrow(error);
    expect(await inventory.read.placementAncestry("deficit-case")).toEqual(["deficit-case", "source"]);
    expect(await inventory.read.world()).toEqual(before);
    expect(storage.readSegmentedStockHead()).toEqual(beforeStock);
    expect(storage.readPositionSegment().materialize()).toEqual(beforeRows);
  }
});

/** Node use-by after opening but before the later test authority time. */
const shortUseBy = 1787563800000;
/** Corrected node use-by later than all test authority times. */
const longUseBy = 1798761600000;
/** Source lot expiry later than the short placement-specific use-by. */
const lotExpiryEpochMs = 1830297600000;

/** Add a second item so subtree tests prove heterogeneous stock remains exact. */
function createHeterogeneousPlacementCatalog() {
  const catalog = createTabletCatalog();
  const instrument = defineScalarInventoryItem({
    itemId: "item-b",
    revisionId: "item-b-v1",
    unit: "piece",
    axisId: "pieces",
  });
  return extendInventoryCatalog({
    catalog,
    itemRevisions: [instrument],
    activeItemRevisionIds: { "item-b": instrument.revisionId },
  });
}

/** Return current scalar item-a stock anchored directly at one exact node. */
async function quantityAtNode(
  inventory: ReturnType<typeof createTestInventory>,
  nodeId: string
): Promise<number> {
  const positions = await inventory.read.positions({
    itemId: "item-a",
    placementNodeIds: [nodeId],
  });
  let total = 0;
  for (const position of positions) {
    total += position.measurements.primary.quantity.amountMinor;
  }
  return total;
}

describe("generic placement topology", () => {
  it("keeps stock-bearing placement moveContents during correction history replay", async () => {
    const inventory = createTestInventory();
    const receipt = await inventory.stock.receive({
      operationId: "correction-move-contents-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("CART"),
      amount: stockAmount("2", "piece"),
      placementNode: { category: "cart", acceptsPlacement: true },
    });
    const moved = await inventory.placement.moveContents({
      operationId: "correction-move-contents-empty-cart",
      occurredAtEpochMs: time1,
      nodeId: "CART",
      into: "ROOM",
    });
    expect(moved.event.kind).toBe(InventoryEventKind.Placement);
    expect(moved.event.stockEffects).toHaveLength(2);
    expect(moved.event.placementChanges).toEqual([]);

    const corrected = await inventory.stock.correct({
      operationId: "correction-move-contents-recount",
      occurredAtEpochMs: time2,
      correctsEventId: receipt.event.eventId,
      reason: "The initial cart receipt had three pieces, not two.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("CART"),
          amount: stockAmount("3", "piece"),
        }),
    });
    expect(corrected.event.kind).toBe(InventoryEventKind.Correction);
    expect(await quantityAtNode(inventory, "CART")).toBe(1);
    expect(await quantityAtNode(inventory, "ROOM")).toBe(2);
    expect((await inventory.read.world()).projection.lastRecordSequence).toBe(3);
  });

  it("corrects an embodied serial transfer using its stock-derived placement parent", async () => {
    const inventory = createTestInventory(undefined, createHeterogeneousPlacementCatalog());
    await inventory.stock.receive({
      operationId: "embodied-correction-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("origin"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "embodied-correction-individualize",
      occurredAtEpochMs: time1,
      from: loosePosition("origin"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-CORRECT",
      asPlacementNode: { category: "cabinet", acceptsPlacement: true },
    });
    const source = {
      itemId: "item-a",
      serialId: "CAB-CORRECT",
      placementNodeId: "origin",
    };
    const root = await inventory.stock.transfer({
      operationId: "embodied-correction-wrong-room",
      occurredAtEpochMs: time2,
      from: source,
      toPlacementNodeId: "wrong-room",
      amount: stockAmount("1", "piece"),
    });
    expect(await inventory.read.placementAncestry("CAB-CORRECT")).toEqual([
      "CAB-CORRECT",
      "wrong-room",
    ]);

    // Later contents must remain anchored directly inside the cabinet even
    // when the cabinet's earlier movement is corrected.
    await inventory.stock.receive({
      operationId: "embodied-correction-receive-content",
      occurredAtEpochMs: time3,
      to: { itemId: "item-b", placementNodeId: "CAB-CORRECT" },
      amount: stockAmount("1", "piece"),
    });

    const correction = await inventory.stock.correct({
      operationId: "embodied-correction-actual-room",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "The recorded room was not where the cabinet was moved.",
      replaceWith: (plans) =>
        plans.transfer({
          occurredAtEpochMs: time2,
          from: source,
          toPlacementNodeId: "actual-room",
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(correction.event.kind).toBe(InventoryEventKind.Correction);
    expect(correction.event.placementChanges).toEqual([]);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          serialIds: ["CAB-CORRECT"],
        })
      )[0]?.key.placementNodeId
    ).toBe("actual-room");
    expect(await inventory.read.placementAncestry("CAB-CORRECT")).toEqual([
      "CAB-CORRECT",
      "actual-room",
    ]);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-b",
          placementNodeIds: ["CAB-CORRECT"],
        })
      )[0]?.measurements.primary.quantity.amountMinor
    ).toBe(1);
    expect((await inventory.read.world()).projection.lastRecordSequence).toBe(5);
  });

  it("individualizes, embodies, moves, empties, retires, and re-individualizes a physical cabinet", async () => {
    const catalog = createHeterogeneousPlacementCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receiveMany({
      operationId: "receive-generic-cabinets-and-content",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store"),
          amount: stockAmount("20", "piece"),
        },
        {
          to: { itemId: "item-b", placementNodeId: "store" },
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    await inventory.stock.individualize({
      operationId: "individualize-cabinet-17",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-17",
      asPlacementNode: {
        category: "cabinet",
        acceptsPlacement: true,
      },
    });
    expect(await quantityAtNode(inventory, "store")).toBe(20);
    const cabinet = (
      await inventory.read.positions({
        itemId: "item-a",
        serialIds: ["CAB-17"],
      })
    )[0];
    expect(cabinet?.key.placementNodeId).toBe("store");
    expect(await inventory.read.placementAncestry("CAB-17")).toEqual([
      "CAB-17",
      "store",
    ]);
    expect(
      (await inventory.read.placementNode("CAB-17"))?.definition.embodiedBy
    ).toEqual({ itemId: "item-a", serialId: "CAB-17" });

    await inventory.stock.transfer({
      operationId: "put-content-in-cabinet-17",
      occurredAtEpochMs: time1,
      from: { itemId: "item-b", placementNodeId: "store" },
      toPlacementNodeId: "CAB-17",
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "put-shelf-in-cabinet-17",
      occurredAtEpochMs: time1,
      nodeId: "INNER-SHELF",
      into: "CAB-17",
    });
    await inventory.placement.move({
      operationId: "move-cabinet-17-to-room",
      occurredAtEpochMs: time2,
      nodeId: "CAB-17",
      into: "room",
      expectedParent: "store",
    });
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          serialIds: ["CAB-17"],
        })
      )[0]?.key.placementNodeId
    ).toBe("room");
    expect(
      (
        await inventory.read.positions({
          itemId: "item-b",
          placementNodeIds: ["CAB-17"],
        })
      )[0]?.key.placementNodeId
    ).toBe("CAB-17");
    expect(await inventory.read.placementAncestry("CAB-17")).toEqual([
      "CAB-17",
      "room",
    ]);

    await expect(
      inventory.stock.scrap({
        operationId: "reject-scrap-nonempty-cabinet-17",
        occurredAtEpochMs: time2,
        from: {
          itemId: "item-a",
          placementNodeId: "room",
          serialId: "CAB-17",
        },
        amount: stockAmount("1", "piece"),
        reason: "Broken cabinet",
      })
    ).rejects.toThrow("must be empty");
    const emptied = await inventory.placement.moveContents({
      operationId: "empty-cabinet-17",
      occurredAtEpochMs: time2,
      nodeId: "CAB-17",
      into: "room",
    });
    expect(emptied.event.kind).toBe(InventoryEventKind.Placement);
    expect(emptied.event.stockEffects).toHaveLength(2);
    expect(emptied.event.placementChanges).toEqual([
      {
        nodeId: "INNER-SHELF",
        fromParentNodeId: "CAB-17",
        toParentNodeId: "room",
      },
    ]);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-b",
          placementNodeIds: ["room"],
        })
      )[0]?.key.placementNodeId
    ).toBe("room");
    expect(await inventory.read.placementAncestry("INNER-SHELF")).toEqual([
      "INNER-SHELF",
      "room",
    ]);
    await inventory.stock.scrap({
      operationId: "scrap-empty-cabinet-17",
      occurredAtEpochMs: time2,
      from: {
        itemId: "item-a",
        placementNodeId: "room",
        serialId: "CAB-17",
      },
      amount: stockAmount("1", "piece"),
      reason: "Broken cabinet",
    });
    expect(
      (await inventory.read.placementNode("CAB-17"))?.retiredByEventId
    ).toBeDefined();
    await expect(
      inventory.stock.transfer({
        operationId: "reject-stock-into-retired-cabinet-17",
        occurredAtEpochMs: time3,
        from: { itemId: "item-b", placementNodeId: "room" },
        toPlacementNodeId: "CAB-17",
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("Retired placement node");

    await inventory.stock.individualize({
      operationId: "individualize-cabinet-18",
      occurredAtEpochMs: time2,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-18",
      asPlacementNode: { category: "cabinet" },
    });
    await inventory.stock.deindividualize({
      operationId: "deindividualize-cabinet-18",
      occurredAtEpochMs: time3,
      from: {
        itemId: "item-a",
        placementNodeId: "store",
        serialId: "CAB-18",
      },
      amount: stockAmount("1", "piece"),
    });
    expect(
      (await inventory.read.placementNode("CAB-18"))?.retiredByEventId
    ).toBeDefined();
    await inventory.stock.individualize({
      operationId: "reindividualize-cabinet-19",
      occurredAtEpochMs: time3,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-19",
      asPlacementNode: { category: "cabinet" },
    });
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          serialIds: ["CAB-19"],
        })
      )[0]?.key.placementNodeId
    ).toBe("store");
  });

  /** Keep a Record-policy deficit repairable while the embodied container exists. */
  it("blocks retirement of an embodied container with recorded direct deficit", async () => {
    const inventory = createTestInventory(
      undefined, createHeterogeneousPlacementCatalog(), undefined, InventoryDeficitPolicy.Record
    );
    await inventory.stock.receive({
      operationId: "deficit-cabinet-receive", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "deficit-cabinet-individualize", occurredAtEpochMs: time1,
      from: loosePosition("store"), amount: stockAmount("1", "piece"),
      serialId: "CAB-DEFICIT",
      asPlacementNode: { category: "cabinet", acceptsPlacement: true },
    });
    await inventory.stock.issue({
      operationId: "deficit-cabinet-overissue", occurredAtEpochMs: time2,
      from: { itemId: "item-b", placementNodeId: "CAB-DEFICIT" },
      amount: stockAmount("3", "piece"),
    });
    const before = await inventory.read.positions({
      itemId: "item-b", placementNodeIds: ["CAB-DEFICIT"],
    });
    expect(before).toHaveLength(1);
    expect(before[0]?.measurements.primary.quantity.amountMinor).toBe(-3);

    await expect(inventory.stock.scrap({
      operationId: "deficit-cabinet-premature-scrap", occurredAtEpochMs: time2,
      from: loosePosition("store", { serialId: "CAB-DEFICIT" }),
      amount: stockAmount("1", "piece"), reason: "Remove occupied container",
    })).rejects.toThrow("must be empty");
    expect((await inventory.read.placementNode("CAB-DEFICIT"))?.retiredByEventId).toBeUndefined();

    await inventory.stock.receive({
      operationId: "deficit-cabinet-settle", occurredAtEpochMs: time3,
      to: { itemId: "item-b", placementNodeId: "CAB-DEFICIT" },
      amount: stockAmount("3", "piece"),
    });
    expect(await inventory.read.positions({
      itemId: "item-b", placementNodeIds: ["CAB-DEFICIT"],
    })).toEqual([]);
    await inventory.stock.scrap({
      operationId: "deficit-cabinet-retire-after-settlement",
      occurredAtEpochMs: time3,
      from: loosePosition("store", { serialId: "CAB-DEFICIT" }),
      amount: stockAmount("1", "piece"),
      reason: "Container emptied",
    });
    expect((await inventory.read.placementNode("CAB-DEFICIT"))?.retiredByEventId).toBeDefined();
  });

  it("revives one retired embodiment only by correcting its exact retirement event", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-correction-cabinet",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "individualize-correction-cabinet",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-CORRECT",
      asPlacementNode: { category: "cabinet" },
    });
    const mistaken = await inventory.stock.scrap({
      operationId: "mistaken-scrap-correction-cabinet",
      occurredAtEpochMs: time2,
      from: {
        itemId: "item-a",
        placementNodeId: "store",
        serialId: "CAB-CORRECT",
      },
      amount: stockAmount("1", "piece"),
      reason: "Mistaken destruction assertion.",
    });
    expect(
      (await inventory.read.placementNode("CAB-CORRECT"))?.retiredByEventId
    ).toBe(mistaken.event.eventId);

    await inventory.stock.correct({
      operationId: "correct-mistaken-cabinet-scrap",
      occurredAtEpochMs: time3,
      correctsEventId: mistaken.event.eventId,
      reason: "Inspection proved the cabinet still exists.",
      replaceWith: (plans) => plans.omit(),
    });
    expect(
      (await inventory.read.placementNode("CAB-CORRECT"))?.retiredByEventId
    ).toBeUndefined();
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          serialIds: ["CAB-CORRECT"],
        })
      )[0]?.key.placementNodeId
    ).toBe("store");
    expect(await inventory.read.placementAncestry("CAB-CORRECT")).toEqual([
      "CAB-CORRECT",
      "store",
    ]);
  });

  /** A later stock correction can supersede one that retired an existing embodied node. */
  it("restores an embodied node when the stock correction that retired it is superseded", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "superseded-retirement-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { serialId: "SUPERSEDED-CAB" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.define({
      operationId: "superseded-retirement-embody",
      occurredAtEpochMs: time1,
      nodeId: "SUPERSEDED-CAB-NODE",
      placementNode: {
        category: "cabinet",
        embodiedBy: { itemId: "item-a", serialId: "SUPERSEDED-CAB" },
      },
    });
    const root = await inventory.stock.transfer({
      operationId: "superseded-retirement-original-movement",
      occurredAtEpochMs: time2,
      from: loosePosition("store", { serialId: "SUPERSEDED-CAB" }),
      toPlacementNodeId: "original-room",
      amount: stockAmount("1", "piece"),
    });
    const first = await inventory.stock.correct({
      operationId: "superseded-retirement-incorrect-issue",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "An earlier audit mistakenly said the moved cabinet was issued.",
      replaceWith: (plans) => plans.issue({
        occurredAtEpochMs: time2,
        from: loosePosition("store", { serialId: "SUPERSEDED-CAB" }),
        amount: stockAmount("1", "piece"),
      }),
    });
    expect((await inventory.read.placementNode("SUPERSEDED-CAB-NODE"))?.retiredByEventId)
      .toBe(first.event.eventId);
    const correctionInput = {
      operationId: "superseded-retirement-confirmed-transfer",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "Subsequent evidence confirmed the cabinet was moved, not issued.",
      replaceWith: (plans: Parameters<typeof inventory.stock.correct>[0]["replaceWith"] extends
        (plans: infer Plans) => unknown ? Plans : never) => plans.transfer({
          occurredAtEpochMs: time2,
          from: loosePosition("store", { serialId: "SUPERSEDED-CAB" }),
          toPlacementNodeId: "original-room",
          amount: stockAmount("1", "piece"),
        }),
    };
    const second = await inventory.stock.correct(correctionInput);
    expect(second.event.correction?.supersedesCorrectionEventId).toBe(first.event.eventId);
    expect((await inventory.read.placementNode("SUPERSEDED-CAB-NODE"))?.retiredByEventId)
      .toBeUndefined();
    expect((await inventory.read.positions({
      itemId: "item-a", serialIds: ["SUPERSEDED-CAB"],
    }))).toHaveLength(1);
    expect(await inventory.read.placementAncestry("SUPERSEDED-CAB-NODE"))
      .toEqual(["SUPERSEDED-CAB-NODE", "original-room"]);
    expect((await inventory.stock.correct(correctionInput)).replayed).toBe(true);
  });

  it("can embody an already-unique resource but rejects missing or duplicate embodiments", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-existing-unique-cabinet",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { serialId: "CAB-EXISTING" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.define({
      operationId: "embody-existing-unique-cabinet",
      occurredAtEpochMs: time1,
      nodeId: "CAB-EXISTING-NODE",
      placementNode: {
        category: "cabinet",
        embodiedBy: {
          itemId: "item-a",
          serialId: "CAB-EXISTING",
        },
      },
    });
    expect(await inventory.read.placementAncestry("CAB-EXISTING-NODE")).toEqual([
      "CAB-EXISTING-NODE",
      "store",
    ]);

    await expect(
      inventory.placement.define({
        operationId: "reject-missing-embodied-resource",
        occurredAtEpochMs: time1,
        nodeId: "MISSING-CABINET-NODE",
        placementNode: {
          embodiedBy: { itemId: "item-a", serialId: "MISSING-CABINET" },
        },
      })
    ).rejects.toThrow("without one live serialized resource");
    await expect(
      inventory.placement.define({
        operationId: "reject-duplicate-embodied-resource",
        occurredAtEpochMs: time1,
        nodeId: "CAB-EXISTING-ALIAS",
        placementNode: {
          embodiedBy: {
            itemId: "item-a",
            serialId: "CAB-EXISTING",
          },
        },
      })
    ).rejects.toThrow("already bound to placement node");
  });

  it("moves one ancestor without rewriting heterogeneous descendant stock rows", async () => {
    const catalog = createHeterogeneousPlacementCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receiveMany({
      operationId: "receive-placement-subtree",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("PALLET-1", {
            lotId: "OUTER-LOT",
            ownerId: "clinic",
          }),
          amount: stockAmount("3", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          placementNode: { category: "pallet" },
        },
        {
          to: loosePosition("CARTON-1", {
            lotId: "INNER-LOT",
            ownerId: "clinic",
          }),
          amount: packageAmount(30, "item-a-box-20-v1"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          placementNode: { category: "carton" },
        },
        {
          to: {
            itemId: "item-b",
            placementNodeId: "CARTON-1",
            lotId: "INSTRUMENT-LOT",
            serialId: "INSTRUMENT-001",
            ownerId: "clinic",
          },
          amount: stockAmount("1", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
        },
      ],
    });
    await inventory.placement.move({
      operationId: "place-pallet-in-store",
      occurredAtEpochMs: time1,
      nodeId: "PALLET-1",
      into: "store",
    });
    await inventory.placement.move({
      operationId: "place-carton-on-pallet",
      occurredAtEpochMs: time1,
      nodeId: "CARTON-1",
      into: "PALLET-1",
    });

    const packagedPosition = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      })
    )[0];
    if (packagedPosition === undefined) {
      throw new Error("Expected nested package stock.");
    }
    await inventory.reservations.reserve({
      reservationId: "exact-carton-packages",
      operationId: "reserve-carton-packages",
      itemRevisionId: "item-a-v1",
      selector: {
        itemId: "item-a",
        placementNodeIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      },
      requested: parseQuantity("600", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocate({
      operationId: "allocate-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: packagedPosition.key,
          quantity: parseQuantity("600", "piece"),
        },
      ],
    });

    const beforeKeys = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ].map((position) => position.key);
    const moved = await inventory.placement.move({
      operationId: "move-pallet-to-room",
      occurredAtEpochMs: time2,
      nodeId: "PALLET-1",
      into: "room",
      expectedParent: "store",
    });
    expect(moved.event.kind).toBe(InventoryEventKind.Placement);
    expect(moved.event.stockEffects).toEqual([]);
    expect(moved.event.placementChanges).toEqual([
      {
        nodeId: "PALLET-1",
        fromParentNodeId: "store",
        toParentNodeId: "room",
      },
    ]);
    const afterPositions = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ];
    expect(afterPositions.map((position) => position.key)).toEqual(beforeKeys);
    expect(await inventory.read.placementAncestry("CARTON-1")).toEqual([
      "CARTON-1",
      "PALLET-1",
      "room",
    ]);
    expect(
      await inventory.read.positions({
        itemId: "item-a",
        withinPlacementNodeIds: ["room"],
      })
    ).toHaveLength(2);
    expect(
      await inventory.read.positions({
        itemId: "item-b",
        withinPlacementNodeIds: ["room"],
      })
    ).toHaveLength(1);

    const claim = await inventory.read.reservation("exact-carton-packages");
    const quarantined = await inventory.placement.changeContentsStatus({
      operationId: "quarantine-subtree",
      occurredAtEpochMs: time2,
      nodeId: "PALLET-1",
      toStatusId: "quarantine",
    });
    expect(quarantined.event.kind).toBe(InventoryEventKind.Reclassification);
    expect(await inventory.read.reservation("exact-carton-packages")).toEqual(claim);
    expect(await inventory.read.reservationFeasibility()).toMatchObject({
      status: InventoryReservationFeasibilityStatus.Shortage,
      groups: [{ reservationIds: ["exact-carton-packages"], shortage: parseQuantity("600", "piece") }],
    });
    expect(
      [
        ...(await inventory.read.positions({ itemId: "item-a" })),
        ...(await inventory.read.positions({ itemId: "item-b" })),
      ].every((position) => position.key.statusId === "quarantine")
    ).toBe(true);
    await inventory.placement.clearContentsStatus({
      operationId: "clear-subtree-status",
      occurredAtEpochMs: time3,
      nodeId: "PALLET-1",
    });
    expect(
      [
        ...(await inventory.read.positions({ itemId: "item-a" })),
        ...(await inventory.read.positions({ itemId: "item-b" })),
      ].every((position) => position.key.statusId === undefined)
    ).toBe(true);
    expect(await inventory.read.reservation("exact-carton-packages")).toEqual(claim);
    expect((await inventory.read.reservationFeasibility()).status).toBe(InventoryReservationFeasibilityStatus.Feasible);
  });

  it("enforces optimistic parents, one parent, target policy, and acyclic topology", async () => {
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "place-a-in-b",
      occurredAtEpochMs: time0,
      nodeId: "A",
      into: "B",
      expectedParent: null,
    });
    await inventory.placement.move({
      operationId: "place-b-in-c",
      occurredAtEpochMs: time0,
      nodeId: "B",
      into: "C",
    });
    await expect(
      inventory.placement.move({
        operationId: "cycle-c-in-a",
        occurredAtEpochMs: time1,
        nodeId: "C",
        into: "A",
      })
    ).rejects.toThrow("cycle");
    await expect(
      inventory.placement.move({
        operationId: "wrong-parent-a",
        occurredAtEpochMs: time1,
        nodeId: "A",
        into: "D",
        expectedParent: "C",
      })
    ).rejects.toThrow("expected parent");
    await inventory.placement.define({
      operationId: "define-closed-node",
      occurredAtEpochMs: time1,
      nodeId: "CLOSED",
      placementNode: { category: "sealed", acceptsPlacement: false },
    });
    await expect(
      inventory.placement.move({
        operationId: "place-into-closed",
        occurredAtEpochMs: time1,
        nodeId: "A",
        into: "CLOSED",
      })
    ).rejects.toThrow("does not accept direct placement");
    await inventory.placement.unplace({
      operationId: "unplace-a",
      occurredAtEpochMs: time2,
      nodeId: "A",
      expectedParent: "B",
    });
    expect(await inventory.read.placementParent("A")).toBeUndefined();
    expect(await inventory.read.placementChildren("B")).toEqual([]);
  });

  it("issues and scraps all positive stock in one placement subtree", async () => {
    const issuedInventory = createTestInventory();
    await issuedInventory.stock.receiveMany({
      operationId: "receive-subtree-to-issue",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("TRAY", { lotId: "ISSUE-A" }),
          amount: stockAmount("2", "piece"),
        },
        {
          to: loosePosition("CHILD", { lotId: "ISSUE-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    await issuedInventory.placement.move({
      operationId: "child-in-tray",
      occurredAtEpochMs: time0,
      nodeId: "CHILD",
      into: "TRAY",
    });
    const issued = await issuedInventory.placement.issueContents({
      operationId: "issue-tray-contents",
      occurredAtEpochMs: time1,
      nodeId: "TRAY",
      destinationPartyId: "patient",
    });
    expect(issued.event.kind).toBe(InventoryEventKind.Issue);
    expect(await issuedInventory.read.positions({ itemId: "item-a" })).toEqual(
      []
    );

    const scrappedInventory = createTestInventory();
    await scrappedInventory.stock.receive({
      operationId: "receive-subtree-to-scrap",
      occurredAtEpochMs: time0,
      to: loosePosition("SCRAP-NODE"),
      amount: stockAmount("2", "piece"),
    });
    await scrappedInventory.reservations.reserve({
      reservationId: "broad-scrap-claim",
      operationId: "reserve-before-subtree-scrap",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const scrapped = await scrappedInventory.placement.scrapContents({
      operationId: "scrap-node-contents",
      occurredAtEpochMs: time2,
      nodeId: "SCRAP-NODE",
      reason: "The physical contents were destroyed.",
    });
    expect(scrapped.event.kind).toBe(InventoryEventKind.Scrap);
    expect((await scrappedInventory.read.reservationFeasibility()).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
  });

  it.each([
    [InventoryDeficitPolicy.Record, false],
    [InventoryDeficitPolicy.Record, true],
    [InventoryDeficitPolicy.Reject, false],
    [InventoryDeficitPolicy.Reject, true],
  ] as const)("records reserved subtree contents like exact stock (policy: %s, canonical: %s)", async (policy, canonical) => {
    for (const [verb, kind] of [
      ["issue", InventoryEventKind.Issue],
      ["scrap", InventoryEventKind.Scrap],
      ["changeStatus", InventoryEventKind.Reclassification],
      ["clearStatus", InventoryEventKind.Reclassification],
    ] as const) {
      /** Run an equivalent physical action with either an exact position or its ancestor. */
      async function recordContents(subtree: boolean) {
        // A failpoint routes reference writes through the canonical staged coordinator.
        const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
        const inventory = createTestInventory(storage, undefined, clockAt(time3), policy);
        const amount = stockAmount("2", "piece");
        const quantity = parseQuantity("2", "piece");
        const selector = { itemId: "item-a", placementNodeIds: ["child"] };
        const to = loosePosition("child", verb === "clearStatus" ? { statusId: "quarantine" } : {});
        await inventory.stock.receive({ operationId: "receive-contents", occurredAtEpochMs: time0, to, amount });
        await inventory.placement.move({ operationId: "place-child", occurredAtEpochMs: time0, nodeId: "child", into: "tray" });
        const [position] = await inventory.read.positions(selector);
        if (position === undefined) throw new Error("Expected nested stock to allocate.");
        const allocations = [{ position: position.key, quantity }];
        const reservationId = "exact-child-claim";
        await inventory.reservations.reserve({
          operationId: "reserve-contents", reservationId, itemRevisionId: position.key.itemRevisionId,
          selector, requested: quantity, createdAtEpochMs: time1,
        });
        await inventory.reservations.allocate({
          operationId: "allocate-contents", reservationId, allocations, occurredAtEpochMs: time1,
        });
        expect((await inventory.read.reservationFeasibility()).status).toBe(InventoryReservationFeasibilityStatus.Feasible);
        const header = { operationId: "record-contents", occurredAtEpochMs: time2, reason: "Physical stock disposition." };
        const contents = { ...header, nodeId: "tray" };
        const exact = { ...header, from: position.key, amount };
        /** Use the same physical verb for either form of the stock target. */
        function record() {
          switch (verb) {
            case "issue": return subtree ? inventory.placement.issueContents(contents) : inventory.stock.issue(exact);
            case "scrap": return subtree ? inventory.placement.scrapContents(contents) : inventory.stock.scrap(exact);
            case "changeStatus": return subtree
              ? inventory.placement.changeContentsStatus({ ...contents, toStatusId: "quarantine" })
              : inventory.stock.changeStatus({ ...exact, toStatusId: "quarantine" });
            case "clearStatus": return subtree ? inventory.placement.clearContentsStatus(contents) : inventory.stock.clearStatus(exact);
          }
        }
        const committed = await record();
        expect(committed.event.kind).toBe(kind);
        expect(await record()).toEqual({ ...committed, replayed: true });
        expect(await inventory.read.reservation(reservationId)).toMatchObject({ status: InventoryReservationStatus.Active, allocations });
        expect(await inventory.read.reservationFeasibility()).toMatchObject({
          status: InventoryReservationFeasibilityStatus.Shortage,
          groups: [{ reservationIds: [reservationId], requested: quantity, fulfillable: parseQuantity("0", "piece"), shortage: quantity }],
        });
        expect(await inventory.read.placementAncestry("child")).toEqual(["child", "tray"]);
        return { effects: committed.event.stockEffects, positions: await inventory.read.positions(selector) };
      }
      const exact = await recordContents(false);
      expect(await recordContents(true)).toEqual(exact);
    }
  });

  it("inherits the earliest use-by from placement ancestry", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-in-child-node",
      occurredAtEpochMs: time0,
      to: loosePosition("OPEN-VIAL", { lotId: "LOT-ANCESTRY" }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
      placementNode: { category: "opened-vial" },
    });
    await inventory.placement.define({
      operationId: "define-short-fridge",
      occurredAtEpochMs: time0,
      nodeId: "FRIDGE",
      placementNode: { category: "cold-storage", useByEpochMs: shortUseBy },
    });
    await inventory.placement.move({
      operationId: "vial-in-fridge",
      occurredAtEpochMs: time0,
      nodeId: "OPEN-VIAL",
      into: "FRIDGE",
    });
    const preview = await inventory.read.planAllocation({
      selector: {
        itemId: "item-a",
        withinPlacementNodeIds: ["FRIDGE"],
      },
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      atEpochMs: time2,
    });
    expect(preview.expiredStockWasExcluded).toBe(true);
    expect(preview.lines).toEqual([]);
    expect(preview.shortfall.amountMinor).toBe(1);
  });

  it("corrects, omits, restores, and orders generic node metadata append-only", async () => {
    const inventory = createTestInventory();
    const identifiers = JSON.parse(
      '{"__proto__":"NODE-PROTO","barcode":"NODE-001"}'
    ) as Record<string, string>;
    const defined = await inventory.placement.define({
      operationId: "define-node-z",
      occurredAtEpochMs: time0,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        identifiers,
        openedAtEpochMs: time0,
        useByEpochMs: shortUseBy,
      },
    });
    await inventory.placement.define({
      operationId: "define-node-a",
      occurredAtEpochMs: time0,
      nodeId: "A-NODE",
      placementNode: { category: "ordinary" },
    });
    const projectedIdentifiers = (
      await inventory.read.placementNode("Z-NODE")
    )?.definition.identifiers;
    expect(Object.prototype.hasOwnProperty.call(projectedIdentifiers, "__proto__"))
      .toBe(true);
    expect(projectedIdentifiers?.["__proto__"]).toBe("NODE-PROTO");
    await inventory.placement.correct({
      operationId: "correct-node-z-use-by",
      occurredAtEpochMs: time1,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        identifiers,
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The protocol supplied the wrong use-by.",
    });
    expect(
      (await inventory.read.placementNode("Z-NODE"))?.definition.useByEpochMs
    ).toBe(longUseBy);
    await inventory.placement.correct({
      operationId: "omit-node-z-metadata",
      occurredAtEpochMs: time2,
      nodeId: "Z-NODE",
      reason: "The node metadata assertion was wrong.",
    });
    expect(await inventory.read.placementNode("Z-NODE")).toBeUndefined();
    await expect(
      inventory.placement.define({
        operationId: "cannot-redefine-removed-node",
        occurredAtEpochMs: time2,
        nodeId: "Z-NODE",
        placementNode: { useByEpochMs: longUseBy },
      })
    ).rejects.toThrow("removed by correction");
    await inventory.placement.correct({
      operationId: "restore-node-z-metadata",
      occurredAtEpochMs: time3,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The physical node was confirmed.",
    });
    expect(
      (await inventory.read.placementNodes()).map(
        (projected) => projected.definition.nodeId
      )
    ).toEqual(["A-NODE", "Z-NODE"]);
    expect(defined.event.kind).toBe(InventoryEventKind.PlacementNodeMetadata);
  });

  it("carries placement-node masters through reviewed migration opening facts", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "legacy-placement-opening",
        sourceSystem: "legacy-inventory",
        cutoverAtEpochMs: time0,
        openingStock: [
          {
            openingId: "legacy-opened-vial",
            position: loosePosition("LEGACY-VIAL", {
              lotId: "LEGACY-LOT",
            }),
            amount: stockAmount("4", "piece"),
            itemRevisionId: "item-a-v2",
            lot: { expiresAtEpochMs: lotExpiryEpochMs },
            placementNode: {
              category: "opened-vial",
              openedAtEpochMs: time0,
              useByEpochMs: longUseBy,
            },
            source: {
              sourceType: "InventoryStockSubstock",
              sourceId: "legacy-child-1",
            },
          },
        ],
      },
    });
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: await storage.readWorld(),
    });
    await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    const inventory = createTestInventory(storage, catalog);
    expect(
      (await inventory.read.placementNode("LEGACY-VIAL"))?.definition
    ).toMatchObject({
      category: "opened-vial",
      openedAtEpochMs: time0,
      useByEpochMs: longUseBy,
    });
    expect(await quantityAtNode(inventory, "LEGACY-VIAL")).toBe(4);
  });
});
