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
  /** A stock-only canonical publication must not reread unchanged archived claim/count books. */
  it("does not rescan retained claim and count books for canonical stock-only publication", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "scope-archive-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("3", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "scope-archive-reservation",
      operationId: "scope-archive-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.release({
      operationId: "scope-archive-release",
      reservationId: "scope-archive-reservation",
      occurredAtEpochMs: time2,
    });
    await inventory.counts.start({
      operationId: "scope-archive-count-start",
      countId: "scope-archive-count",
      selector: { itemId: "item-a" },
      startedAtEpochMs: time1,
    });
    await inventory.counts.abandon({
      operationId: "scope-archive-count-abandon",
      countId: "scope-archive-count",
      occurredAtEpochMs: time2,
      reason: "Physical count discontinued.",
    });

    const before = await storage.readWorld();
    const reservationRows = before.reservations.reservations;
    const countRows = before.counts.counts;
    let reservationScans = 0;
    let countScans = 0;
    const originalValues = Object.values;
    const spy = vi.spyOn(Object, "values").mockImplementation((record) => {
      if (record === reservationRows) reservationScans += 1;
      if (record === countRows) countScans += 1;
      return originalValues(record);
    });
    try {
      // Scrap is a canonical command, but it changes no reservation/count row.
      await inventory.stock.scrap({
        operationId: "scope-archive-canonical-scrap",
        occurredAtEpochMs: time3,
        from: loosePosition("store"),
        amount: stockAmount("1", "piece"),
        reason: "Damaged item.",
      });
    } finally {
      spy.mockRestore();
    }
    expect({ reservationScans, countScans }).toEqual({
      reservationScans: 0,
      countScans: 0,
    });
    expect((await inventory.read.positions({ itemId: "item-a" }))[0]
      ?.measurements.primary.quantity.amountMinor).toBe(2);
  });

  it("keeps the second reservation protected when the first of two closes", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "paired-reserve-receive", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: stockAmount("4", "piece"),
    });
    for (const reservationId of ["paired-first", "paired-second"]) {
      await inventory.reservations.reserve({
        reservationId, operationId: reservationId + "-create",
        itemRevisionId: "item-a-v2", selector: { itemId: "item-a" },
        requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
      });
    }
    await inventory.reservations.release({
      operationId: "paired-first-close", reservationId: "paired-first",
      occurredAtEpochMs: time2,
    });
    const spy = vi.spyOn(storage, "readWorld").mockRejectedValue(
      new Error("Remaining claim requires canonical evaluation.")
    );
    try {
      await expect(inventory.stock.transfer({
        operationId: "paired-move-blocked", occurredAtEpochMs: time3,
        from: loosePosition("store"), toPlacementNodeId: "room",
        amount: stockAmount("1", "piece"),
      })).rejects.toThrow("Remaining claim requires canonical evaluation.");
    } finally {
      spy.mockRestore();
    }
    await inventory.reservations.release({
      operationId: "paired-second-close", reservationId: "paired-second",
      occurredAtEpochMs: time3,
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(
      new Error("Terminal claim forced canonical fallback.")
    );
    try {
      await inventory.stock.transfer({
        operationId: "paired-move-after-close", occurredAtEpochMs: time3,
        from: loosePosition("store"), toPlacementNodeId: "room",
        amount: stockAmount("1", "piece"),
      });
      expect(readWorld).not.toHaveBeenCalled();
    } finally {
      readWorld.mockRestore();
    }
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
