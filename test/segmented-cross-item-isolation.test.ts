import { describe, expect, it, vi } from "vitest";
import {
  defineScalarInventoryItem,
  extendInventoryCatalog,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Build two disjoint physical item families under the same warehouse catalogue. */
function twoItemCatalog() {
  return extendInventoryCatalog({
    catalog: createTabletCatalog(),
    itemRevisions: [
      defineScalarInventoryItem({
        itemId: "item-b",
        revisionId: "item-b-v1",
        unit: "piece",
        axisId: "pieces",
      }),
    ],
    activeItemRevisionIds: { "item-b": "item-b-v1" },
  });
}

/** Separate item B from normal item A commands without aliasing catalogue revisions. */
const itemBPosition = {
  itemId: "item-b",
  placementNodeId: "b-source",
} as const;

describe("segmented writes with unrelated reservation/count scopes", () => {
  it("does not let one item B reservation force unrelated item A stock onto whole-world publication", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, twoItemCatalog());
    await inventory.stock.receive({
      operationId: "unrelated-claim-a-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a-source"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "unrelated-claim-b-receive",
      occurredAtEpochMs: time0,
      to: itemBPosition,
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "item-b-placement-bound-claim",
      operationId: "item-b-claim-create",
      itemRevisionId: "item-b-v1",
      selector: { itemId: "item-b", placementNodeIds: ["b-source"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    const before = storage.readPositionSegment().revision();
    const originalReadWorld = storage.readWorld.bind(storage);
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Unrelated item A transfer invoked whole-world fallback.");
    });
    try {
      const moved = await inventory.stock.transfer({
        operationId: "unrelated-claim-a-move",
        occurredAtEpochMs: time2,
        from: loosePosition("a-source"),
        toPlacementNodeId: "a-destination",
        amount: stockAmount("1", "piece"),
      });
      expect(moved.replayed).toBe(false);
      expect(readWorld).not.toHaveBeenCalled();
      expect(storage.readPositionSegment().revision()).toBe(before + 1);
    } finally {
      readWorld.mockRestore();
    }

    await expect(
      inventory.stock.transfer({
        operationId: "item-b-bound-claim-must-block",
        occurredAtEpochMs: time2,
        from: itemBPosition,
        toPlacementNodeId: "b-destination",
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");

    // One atomic batch touching both items must use the canonical claim check.
    // It must not commit the unrelated A leg if the protected B leg is invalid.
    await expect(
      inventory.stock.transferMany({
        operationId: "mixed-item-bound-claim-must-block",
        occurredAtEpochMs: time2,
        lines: [
          {
            from: loosePosition("a-source"),
            toPlacementNodeId: "a-destination",
            amount: stockAmount("1", "piece"),
          },
          {
            from: itemBPosition,
            toPlacementNodeId: "b-destination",
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");
    expect(
      storage.readPositionSegment().positionsByPlacement("a-source")[0]
        ?.measurements.primary.quantity.amountMinor
    ).toBe(1);

    const world = await originalReadWorld();
    expect(world.revision).toBe(before + 1);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-b",
          placementNodeIds: ["b-source"],
        })
      )[0]?.measurements.primary.quantity.amountMinor
    ).toBe(2);
  });

  it("keeps an unrelated item B count snapshot from forcing item A through whole-world publication", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, twoItemCatalog());
    await inventory.stock.receive({
      operationId: "unrelated-count-a-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a-source"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "unrelated-count-b-receive",
      occurredAtEpochMs: time0,
      to: itemBPosition,
      amount: stockAmount("2", "piece"),
    });
    await inventory.counts.start({
      countId: "item-b-cycle-count",
      operationId: "item-b-cycle-count-start",
      selector: { itemId: "item-b" },
      startedAtEpochMs: time1,
    });
    const before = storage.readPositionSegment().revision();
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Unrelated item A transfer invoked whole-world count fallback.");
    });
    try {
      const moved = await inventory.stock.transfer({
        operationId: "unrelated-count-a-move",
        occurredAtEpochMs: time2,
        from: loosePosition("a-source"),
        toPlacementNodeId: "a-destination",
        amount: stockAmount("1", "piece"),
      });
      expect(moved.replayed).toBe(false);
      expect(readWorld).not.toHaveBeenCalled();
      expect(storage.readPositionSegment().revision()).toBe(before + 1);
    } finally {
      readWorld.mockRestore();
    }
    const canonical = await storage.readWorld();
    expect(canonical.revision).toBe(before + 1);
  });
  it("does not let a released historical reservation permanently disable the item fast path", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "released-claim-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "released-claim",
      operationId: "released-claim-create",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.release({
      operationId: "released-claim-close",
      reservationId: "released-claim",
      occurredAtEpochMs: time2,
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Released historical claim forced whole-world publication.");
    });
    try {
      const moved = await inventory.stock.transfer({
        operationId: "released-claim-post-close-move",
        occurredAtEpochMs: time3,
        from: loosePosition("store"),
        toPlacementNodeId: "room",
        amount: stockAmount("1", "piece"),
      });
      expect(moved.replayed).toBe(false);
      expect(readWorld).not.toHaveBeenCalled();
    } finally {
      readWorld.mockRestore();
    }
    expect(
      (await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["room"] }))[0]
        ?.measurements.primary.quantity.amountMinor
    ).toBe(1);
  });

  it("does not let an abandoned historical count permanently disable the item fast path", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "abandoned-count-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.counts.start({
      operationId: "abandoned-count-create",
      countId: "abandoned-count",
      selector: { itemId: "item-a" },
      startedAtEpochMs: time1,
    });
    await inventory.counts.abandon({
      operationId: "abandoned-count-close",
      countId: "abandoned-count",
      occurredAtEpochMs: time2,
      reason: "The physical count was abandoned.",
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Abandoned historical count forced whole-world publication.");
    });
    try {
      const moved = await inventory.stock.transfer({
        operationId: "abandoned-count-post-close-move",
        occurredAtEpochMs: time3,
        from: loosePosition("store"),
        toPlacementNodeId: "room",
        amount: stockAmount("1", "piece"),
      });
      expect(moved.replayed).toBe(false);
      expect(readWorld).not.toHaveBeenCalled();
    } finally {
      readWorld.mockRestore();
    }
  });

});
