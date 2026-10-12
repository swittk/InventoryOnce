import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryEventKind,
  InventoryReservationFeasibilityStatus,
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

    await expect(
      inventory.placement.changeContentsStatus({
        operationId: "blocked-subtree-status",
        occurredAtEpochMs: time2,
        nodeId: "PALLET-1",
        toStatusId: "quarantine",
      })
    ).rejects.toThrow("exact reservation bindings");
    await inventory.reservations.release({
      operationId: "release-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time2,
    });
    await inventory.placement.changeContentsStatus({
      operationId: "quarantine-subtree",
      occurredAtEpochMs: time2,
      nodeId: "PALLET-1",
      toStatusId: "quarantine",
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
