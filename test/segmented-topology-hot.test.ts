import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { InventoryEventKind, parseQuantity, stockAmount } from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
} from "./test-fixtures.js";

/** Define an existing standalone node with explicit placement capability. */
async function defineStandaloneNode(
  inventory: ReturnType<typeof createTestInventory>,
  nodeId: string
): Promise<void> {
  await inventory.placement.define({
    operationId: "topology-hot-define-" + nodeId,
    occurredAtEpochMs: time0,
    nodeId,
    placementNode: {
      category: "warehouse-location",
      acceptsPlacement: true,
    },
  });
}

describe("adapter-native standalone topology events", () => {
  it("moves and unplaces a standalone node without materializing the canonical world", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await defineStandaloneNode(inventory, "ROOM");
    await defineStandaloneNode(inventory, "TRAY");

    const beforeRevision = storage.readPositionSegment().revision();
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Standalone topology command touched whole-world path.");
    });
    const move = {
      operationId: "topology-hot-move-tray",
      occurredAtEpochMs: time1,
      nodeId: "TRAY",
      into: "ROOM",
      expectedParent: null,
    } as const;
    try {
      const first = await inventory.placement.move(move);
      expect(first.event.kind).toBe(InventoryEventKind.Placement);
      expect(first.event.stockEffects).toEqual([]);
      expect(first.event.placementChanges).toEqual([
        { nodeId: "TRAY", toParentNodeId: "ROOM" },
      ]);
      expect(first.replayed).toBe(false);
      expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 1);
      expect(await inventory.read.placementParent("TRAY")).toBe("ROOM");
      expect(await inventory.read.placementChildren("ROOM")).toEqual(["TRAY"]);
      expect(await inventory.read.placementAncestry("TRAY")).toEqual([
        "TRAY", "ROOM",
      ]);
      const replay = await inventory.placement.move(move);
      expect(replay.replayed).toBe(true);
      expect(replay.event).toEqual(first.event);

      await expect(
        inventory.placement.move({
          ...move,
          into: "OTHER",
        })
      ).rejects.toThrow("changed intent");
      expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 1);

      const unplaced = await inventory.placement.unplace({
        operationId: "topology-hot-unplace-tray",
        occurredAtEpochMs: time2,
        nodeId: "TRAY",
        expectedParent: "ROOM",
      });
      expect(unplaced.event.kind).toBe(InventoryEventKind.Placement);
      expect(unplaced.event.placementChanges).toEqual([
        { nodeId: "TRAY", fromParentNodeId: "ROOM" },
      ]);
      expect(await inventory.read.placementParent("TRAY")).toBeUndefined();
      expect(await inventory.read.placementChildren("ROOM")).toEqual([]);
      expect(await inventory.read.placementAncestry("TRAY")).toEqual(["TRAY"]);
      expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 2);
      expect(readWorld).not.toHaveBeenCalled();
    } finally {
      readWorld.mockRestore();
    }

    const world = await inventory.read.world();
    expect(world.revision).toBe(beforeRevision + 2);
    expect(world.projection.placement).toEqual(
      storage.readPlacementSegment().materialize()
    );
    expect(world.projection.lastRecordSequence).toBe(
      storage.readPositionSegment().revision()
    );
  });

  it("does not expose a mutable placement-store authority through its read capability", () => {
    const storage = createInMemoryInventoryDurableStorage();
    const segment = storage.readPlacementSegment();
    expect(Object.isFrozen(segment)).toBe(true);
    expect(Reflect.get(segment, "applyChange")).toBeUndefined();
    expect(segment.parentNodeId("unknown-node")).toBeUndefined();
  });

  /** A metadata-root correction must be committed through the canonical world. */
  it("publishes a metadata-root correction through canonical storage", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.placement.define({
      operationId: "corrected-placement-destination",
      occurredAtEpochMs: time0,
      nodeId: "KEPT-ROOM",
      placementNode: { category: "room", acceptsPlacement: true },
    });
    const defined = await inventory.placement.define({
      operationId: "corrected-placement-source",
      occurredAtEpochMs: time0,
      nodeId: "REMOVED-SHELF",
      placementNode: { category: "shelf", acceptsPlacement: true },
    });
    const canonical = vi.spyOn(storage, "begin");
    const native = vi.spyOn(storage, "commitSegmentedStockEvent");
    const correction = await inventory.stock.correct({
      operationId: "corrected-placement-omit-root",
      occurredAtEpochMs: time1,
      correctsEventId: defined.event.eventId,
      reason: "This shelf definition referred to a nonexistent shelf.",
      replaceWith: (plans) => plans.omit(),
    });
    expect(correction.event.stockEffects).toEqual([]);
    expect(correction.event.placementChanges).toEqual([]);
    expect(correction.event.placementNodeDefinitions).toEqual([]);
    expect(native).toHaveBeenCalledTimes(1);
    const attempted = native.mock.results[0];
    if (attempted === undefined || attempted.type !== "return") {
      throw new Error("Native correction admission was not attempted.");
    }
    expect(await attempted.value).toBeUndefined();
    expect(canonical).toHaveBeenCalled();
    native.mockRestore();
    canonical.mockRestore();
    const world = await inventory.read.world();
    expect(world.projection.placementNodes["REMOVED-SHELF"]).toBeUndefined();
    expect(world.projection.lastRecordSequence).toBe(correction.event.recordSequence);
  });

  /** A lot-master omission has no stock delta but still requires canonical publication. */
  it("declines segmented stock publication when a correction removes a lot metadata root", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const defined = await inventory.lots.define({
      operationId: "corrected-lot-source",
      occurredAtEpochMs: time0,
      itemId: "item-a",
      lotId: "REMOVED-LOT",
      lot: { manufacturedAtEpochMs: time0 },
    });
    expect(defined.event.lotDefinitions).toHaveLength(1);
    const canonical = vi.spyOn(storage, "begin");
    const native = vi.spyOn(storage, "commitSegmentedStockEvent");
    const correction = await inventory.stock.correct({
      operationId: "corrected-lot-omit-root",
      occurredAtEpochMs: time1,
      correctsEventId: defined.event.eventId,
      reason: "The lot was entered against the wrong item.",
      replaceWith: (plans) => plans.omit(),
    });
    expect(correction.event.stockEffects).toEqual([]);
    expect(correction.event.lotDefinitions).toEqual([]);
    const attempted = native.mock.results[0];
    if (attempted === undefined || attempted.type !== "return") {
      throw new Error("Expected native stock publication admission to be attempted.");
    }
    expect(await attempted.value).toBeUndefined();
    expect(canonical).toHaveBeenCalled();
    native.mockRestore();
    canonical.mockRestore();
    const world = await inventory.read.world();
    expect(Object.values(world.projection.lots)).toEqual([]);
    expect(world.projection.lastRecordSequence).toBe(correction.event.recordSequence);
  });

  it("preserves one journal sequence and canonical snapshot across interleaved stock and topology commits", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await defineStandaloneNode(inventory, "A");
    await defineStandaloneNode(inventory, "B");
    await defineStandaloneNode(inventory, "CART");

    const before = storage.readPositionSegment().revision();
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Mixed segmented commits unexpectedly materialized the warehouse.");
    });
    const receipt = await inventory.stock.receive({
      operationId: "topology-mixed-stock-in",
      occurredAtEpochMs: time1,
      to: loosePosition("CART"),
      amount: stockAmount("3", "piece"),
    });
    const moved = await inventory.placement.move({
      operationId: "topology-mixed-parent",
      occurredAtEpochMs: time1,
      nodeId: "CART",
      into: "A",
      expectedParent: null,
    });
    const transferred = await inventory.stock.transfer({
      operationId: "topology-mixed-stock-out",
      occurredAtEpochMs: time2,
      from: loosePosition("CART"),
      toPlacementNodeId: "B",
      amount: stockAmount("1", "piece"),
    });
    try {
      expect(receipt.event.recordSequence + 1).toBe(moved.event.recordSequence);
      expect(moved.event.recordSequence + 1).toBe(transferred.event.recordSequence);
      expect(storage.readPositionSegment().revision()).toBe(before + 3);
      expect(storage.readPlacementSegment().parentNodeId("CART")).toBe("A");
      expect((await inventory.placement.move({
        operationId: "topology-mixed-parent",
        occurredAtEpochMs: time1,
        nodeId: "CART",
        into: "A",
        expectedParent: null,
      })).replayed).toBe(true);
      expect(storage.readPositionSegment().revision()).toBe(before + 3);
      expect(readWorld).not.toHaveBeenCalled();
    } finally {
      readWorld.mockRestore();
    }

    const world = await inventory.read.world();
    expect(world.revision).toBe(before + 3);
    expect(world.projection.lastRecordSequence).toBe(transferred.event.recordSequence);
    expect(world.projection.placement).toEqual(
      storage.readPlacementSegment().materialize()
    );
    expect((await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["CART"],
    }))[0]?.measurements.primary.quantity.amountMinor).toBe(2);
    expect((await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["B"],
    }))[0]?.measurements.primary.quantity.amountMinor).toBe(1);
  });

  it("rejects a topology cycle without publishing a partial edge or changing roots", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await defineStandaloneNode(inventory, "A");
    await defineStandaloneNode(inventory, "B");
    await inventory.placement.move({
      operationId: "topology-hot-acyclic",
      occurredAtEpochMs: time1,
      nodeId: "A",
      into: "B",
    });
    const segment = storage.readPlacementSegment();
    const positionRevision = storage.readPositionSegment().revision();
    const placementRevision = segment.revision();
    const root = segment.contentRoot();
    await expect(
      inventory.placement.move({
        operationId: "topology-hot-cycle",
        occurredAtEpochMs: time2,
        nodeId: "B",
        into: "A",
      })
    ).rejects.toThrow("cycle");
    expect(segment.contentRoot()).toBe(root);
    expect(segment.revision()).toBe(placementRevision);
    expect(storage.readPositionSegment().revision()).toBe(positionRevision);
    expect(await storage.readOperation("topology-hot-cycle")).toBeUndefined();
    expect(await inventory.read.placementParent("A")).toBe("B");
    expect(await inventory.read.placementParent("B")).toBeUndefined();
    expect((await inventory.read.world()).projection.placement).toEqual(
      segment.materialize()
    );
  });

  it("uses the canonical coordinator when an embodied node owns the movement", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "topology-hot-embodied-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("STORE"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "topology-hot-embody-cabinet",
      occurredAtEpochMs: time1,
      from: loosePosition("STORE"),
      amount: stockAmount("1", "piece"),
      serialId: "TOP-CAB",
      asPlacementNode: {
        category: "cabinet",
        acceptsPlacement: true,
      },
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Embodied topology must use coupled canonical planning.");
    });
    try {
      await expect(
        inventory.placement.move({
          operationId: "topology-hot-embodied-move",
          occurredAtEpochMs: time2,
          nodeId: "TOP-CAB",
          into: "ROOM",
        })
      ).rejects.toThrow("Embodied topology must use coupled canonical planning.");
    } finally {
      readWorld.mockRestore();
    }
    await inventory.placement.move({
      operationId: "topology-hot-embodied-move",
      occurredAtEpochMs: time2,
      nodeId: "TOP-CAB",
      into: "ROOM",
    });
    expect(await inventory.read.placementParent("TOP-CAB")).toBe("ROOM");
    expect(storage.readPlacementSegment().parentNodeId("TOP-CAB")).toBe("ROOM");
  });

  it("retries an async ancestry read when legacy publication replaces the segment reader", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await defineStandaloneNode(inventory, "A");
    await defineStandaloneNode(inventory, "B");
    await defineStandaloneNode(inventory, "TRAY");
    await inventory.placement.move({
      operationId: "topology-hot-reader-before",
      occurredAtEpochMs: time1,
      nodeId: "TRAY",
      into: "A",
    });

    const retiredReader = storage.readPlacementSegment();
    let injected = false;
    const fakeReader: typeof retiredReader = {
      revision: () => retiredReader.revision(),
      contentRoot: () => retiredReader.contentRoot(),
      parentNodeId: (nodeId) => retiredReader.parentNodeId(nodeId),
      childNodeIds: (nodeId) => retiredReader.childNodeIds(nodeId),
      subtreeNodeIds: (nodeId) => retiredReader.subtreeNodeIds(nodeId),
      materialize: () => retiredReader.materialize(),
      ancestry: async (nodeId) => {
        const before = await retiredReader.ancestry(nodeId);
        if (!injected) {
          injected = true;
          await inventory.placement.move({
            operationId: "topology-hot-reader-interleaved",
            occurredAtEpochMs: time2,
            nodeId: "TRAY",
            into: "B",
            expectedParent: "A",
            // Metadata forces the canonical publication path, replacing the
            // reference adapter's placement-segment generation.
            node: {
              category: "warehouse-location",
              acceptsPlacement: true,
            },
          });
        }
        return before;
      },
    };
    const realRead = storage.readPlacementSegment.bind(storage);
    const intercepted = vi
      .spyOn(storage, "readPlacementSegment")
      .mockImplementation(() => (injected ? realRead() : fakeReader));
    try {
      expect(await inventory.read.placementAncestry("TRAY")).toEqual([
        "TRAY",
        "B",
      ]);
      expect(injected).toBe(true);
      expect(storage.readPlacementSegment()).not.toBe(retiredReader);
    } finally {
      intercepted.mockRestore();
    }
    expect((await inventory.read.world()).projection.placement).toEqual(
      storage.readPlacementSegment().materialize()
    );
  });

  it("keeps a public standalone-carrier move independent of indirectly anchored stock cardinality", async () => {
    /** Benchmark one public move after loading actual stock beneath the same child node. */
    async function moveWithStock(descendantRows: number): Promise<number> {
      const storage = createInMemoryInventoryDurableStorage();
      const inventory = createTestInventory(storage);
      for (const nodeId of ["A", "B", "CART", "INNER"]) {
        await defineStandaloneNode(inventory, nodeId);
      }
      await inventory.placement.move({
        operationId: "topology-scale-cart-under-a",
        occurredAtEpochMs: time0,
        nodeId: "CART",
        into: "A",
      });
      await inventory.placement.move({
        operationId: "topology-scale-inner-under-cart",
        occurredAtEpochMs: time0,
        nodeId: "INNER",
        into: "CART",
      });
      await inventory.stock.receiveMany({
        operationId: "topology-scale-stock-" + descendantRows,
        occurredAtEpochMs: time0,
        lines: Array.from({ length: descendantRows }, (_, index) => ({
          to: loosePosition("INNER", {
            lotId: "CART-LOT-" + String(index).padStart(7, "0"),
          }),
          amount: stockAmount("1", "piece"),
        })),
      });
      const beforeRevision = storage.readPositionSegment().revision();
      const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
        throw new Error("Warehouse ancestor move materialized unrelated positions.");
      });
      let elapsedMs = 0;
      try {
        const started = performance.now();
        const moved = await inventory.placement.move({
          operationId: "topology-scale-cart-under-b-" + descendantRows,
          occurredAtEpochMs: time1,
          nodeId: "CART",
          into: "B",
          expectedParent: "A",
        });
        elapsedMs = performance.now() - started;
        expect(moved.event.kind).toBe(InventoryEventKind.Placement);
        expect(moved.event.stockEffects).toHaveLength(0);
        expect(moved.event.placementChanges).toHaveLength(1);
        expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 1);
        expect(await inventory.read.placementAncestry("INNER")).toEqual([
          "INNER", "CART", "B",
        ]);
        expect(readWorld).not.toHaveBeenCalled();
      } finally {
        readWorld.mockRestore();
      }
      const world = await inventory.read.world();
      expect(world.revision).toBe(beforeRevision + 1);
      expect(world.projection.placement).toEqual(
        storage.readPlacementSegment().materialize()
      );
      return elapsedMs;
    }

    const baselineMs = await moveWithStock(1_000);
    const scaledMs = await moveWithStock(10_000);
    // Structural assertions above prove one-edge/zero-stock work. Timings are
    // retained only as diagnostic output because single runs are CI-noisy.
    console.log(JSON.stringify({
      operation: "native-standalone-carrier-move",
      baselineIndirectPositions: 1_000,
      scaledIndirectPositions: 10_000,
      baselineMs,
      scaledMs,
      changedStockEffects: 0,
      changedPlacementEdges: 1,
    }));
  }, 30_000);

  it("preserves canonical claim feasibility when moving a location with reserved stock", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await defineStandaloneNode(inventory, "ROOM");
    await defineStandaloneNode(inventory, "CART");
    await inventory.stock.receive({
      operationId: "topology-hot-claim-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("CART"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "topology-hot-claim",
      operationId: "topology-hot-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockImplementation(async () => {
      throw new Error("Claim-sensitive topology must use canonical validation.");
    });
    try {
      await expect(
        inventory.placement.move({
          operationId: "topology-hot-reserved-move",
          occurredAtEpochMs: time2,
          nodeId: "CART",
          into: "ROOM",
        })
      ).rejects.toThrow("Claim-sensitive topology must use canonical validation.");
    } finally {
      readWorld.mockRestore();
    }
    await inventory.placement.move({
      operationId: "topology-hot-reserved-move",
      occurredAtEpochMs: time2,
      nodeId: "CART",
      into: "ROOM",
    });
    expect(await inventory.read.placementParent("CART")).toBe("ROOM");
  });
});
