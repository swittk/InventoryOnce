import { performance } from "node:perf_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryInventorySegmentedPositionStore,
  InventorySegmentRevisionConflictError,
} from "../src/segmented-state.js";
import { createInMemoryInventorySegmentedPlacementStore } from "../src/segmented-placement.js";
import {
  createInMemoryInventoryDurableStorage,
  InventoryDurableOperationState,
  InventoryStorageWriteStage,
} from "../src/storage.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";
import { stockAmount } from "../src/amounts.js";
import {
  inventoryStockPositionIdentity,
  InventoryStockWhereaboutsState,
  type InventoryStockPosition,
} from "../src/model.js";
import { parseQuantity } from "../src/quantity.js";
import { InventoryDeficitPolicy } from "../src/projection.js";

/** Build one exact positive stock row for segmented-store tests. */
function segmentedPosition(input: {
  readonly lotId?: string;
  readonly placementNodeId: string;
  readonly serialId?: string;
}): InventoryStockPosition {
  return {
    key: {
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      placementNodeId: input.placementNodeId,
      ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
      ...(input.serialId === undefined ? {} : { serialId: input.serialId }),
    },
    measurements: {
      primary: {
        axisId: "pieces",
        quantity: parseQuantity("1", "piece"),
      },
      independent: [],
    },
  };
}

/** Build one warehouse-scale segment with one movable unique carrier. */
function warehouseSegment(positionCount: number) {
  const positions: InventoryStockPosition[] = [];
  for (let index = 0; index < positionCount; index += 1) {
    positions.push(
      segmentedPosition({
        placementNodeId: "warehouse-bin",
        lotId: "LOT-" + String(index).padStart(8, "0"),
      })
    );
  }
  positions.push(
    segmentedPosition({
      placementNodeId: "zone-a",
      serialId: "WAREHOUSE-CARRIER",
    })
  );
  return createInMemoryInventorySegmentedPositionStore({
    positions,
    revision: 1,
  });
}

/** Repeatedly move one exact unique row so timer noise is averaged across many commits. */
function benchmarkCarrierMoves(
  positionCount: number,
  iterations: number
): number {
  const store = warehouseSegment(positionCount);
  let current = store.positivePositionBySerial(
    "item-a",
    "WAREHOUSE-CARRIER"
  );
  if (current === undefined) throw new Error("Missing benchmark carrier.");
  let currentId = inventoryStockPositionIdentity(current.key);
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const toPlacementNodeId = index % 2 === 0 ? "zone-b" : "zone-a";
    const next: InventoryStockPosition = {
      ...current,
      key: {
        ...current.key,
        placementNodeId: toPlacementNodeId,
      },
    };
    const result = store.replaceExactPosition({
      expectedRevision: store.revision(),
      fromPositionId: currentId,
      to: next,
    });
    currentId = result.toPositionId;
    current = next;
  }
  return (performance.now() - started) / iterations;
}

/** Assert the reference adapter's segmented mirror equals canonical published position truth. */
async function expectSegmentMatchesPublishedWorld(
  storage: ReturnType<typeof createInMemoryInventoryDurableStorage>
): Promise<void> {
  const world = await storage.readWorld();
  const segment = storage.readPositionSegment().materialize();
  expect(segment.positions).toEqual(world.projection.positions);
  expect(segment.positionIdsByItemId).toEqual(
    world.projection.positionIdsByItemId
  );
  expect(segment.positionIdsByItemRevisionId).toEqual(
    world.projection.positionIdsByItemRevisionId
  );
  expect(segment.positionIdsByPlacementNodeId).toEqual(
    world.projection.positionIdsByPlacementNodeId
  );
  expect(segment.positivePositionIdBySerialIdentity).toEqual(
    world.projection.positivePositionIdBySerialIdentity
  );
  expect(storage.readPositionSegment().revision()).toBe(world.revision);
}

describe("segmented inventory position store", () => {
  it("publishes a validated age-only correction with its exact segment revision", async () => {
    const inventory = createTestInventory();
    const to = loosePosition("age-only", { lotId: "age-only-lot" });
    const amount = stockAmount("1", "piece");
    const receipt = await inventory.stock.receive({ operationId: "age-only-open", occurredAtEpochMs: time1, to, amount });
    const position = (await inventory.read.positions({ itemId: "item-a" }))[0];
    if (position === undefined) throw new Error("Expected the opened position.");
    const id = inventoryStockPositionIdentity(position.key);
    const segment = createInMemoryInventorySegmentedPositionStore({
      revision: 1, positions: [position], positiveLayerStarts: { [id]: time1 },
    });
    const correction = await inventory.stock.correct({
      operationId: "age-only-correction", occurredAtEpochMs: time2,
      correctsEventId: receipt.event.eventId, reason: "The receipt occurred earlier.",
      replaceWith: (plans) => plans.receive({ occurredAtEpochMs: time0, to, amount }),
    });
    expect(correction.event.stockEffects).toEqual([]);
    expect(correction.event.positiveLayerProvenanceOverrides).toEqual([{ position: position.key, startedAtEpochMs: time0 }]);
    segment.applyStockEffects({
      expectedRevision: 1, nextRevision: 2, event: correction.event, deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(segment.revision()).toBe(2);
    expect(segment.position(id)).toEqual(position);
    expect(segment.positiveLayerStart(id)).toBe(time0);
  });

  it("returns a frozen reader capability without writable segment methods or stock aliases", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "reader-capability-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("2", "piece"),
    });
    const reader = storage.readPositionSegment();
    expect(Object.isFrozen(reader)).toBe(true);
    for (const mutationName of [
      "applyDelta",
      "applyStockEffects",
      "replaceExactPosition",
    ]) {
      expect(Reflect.get(reader, mutationName)).toBeUndefined();
    }

    const result = reader.positionsByPlacement("a")[0];
    if (result === undefined) throw new Error("Missing reader test row.");
    Reflect.set(result.key, "placementNodeId", "caller-mutated");
    expect(reader.positionsByPlacement("a")[0]?.key.placementNodeId).toBe("a");

    const initialRevision = reader.revision();
    await inventory.stock.transfer({
      operationId: "reader-capability-move",
      occurredAtEpochMs: time1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    });
    // The reader tracks the currently published segment, not a frozen snapshot.
    expect(reader.revision()).toBe(initialRevision + 1);
    expect(reader.positionsByPlacement("a")).toHaveLength(1);
    expect(reader.positionsByPlacement("b")).toHaveLength(1);
    expect((await inventory.read.world()).revision).toBe(initialRevision + 1);
  });

  it("keeps a previously issued reader bound to the current backing segment", () => {
    const storage = createInMemoryInventoryDurableStorage();
    const reader = storage.readPositionSegment();
    const replacement = createInMemoryInventorySegmentedPositionStore({
      revision: 17,
      positions: [segmentedPosition({
        lotId: "REBUILT-LOT",
        placementNodeId: "rebuilt-room",
      })],
    });
    // Migration publication replaces this private store. Simulate only that
    // backing-store swap to verify the read capability doesn't retain an old
    // store reference; publication/repair semantics have separate tests.
    Reflect.set(storage, "positionSegment", replacement);
    expect(reader.revision()).toBe(17);
    expect(reader.contentRoot()).toBe(replacement.contentRoot());
    expect(reader.positionsByPlacement("rebuilt-room")).toEqual(
      replacement.positionsByPlacement("rebuilt-room")
    );
    expect(reader.positionsByPlacement("unplaced")).toEqual([]);
    expect(Reflect.get(reader, "applyStockEffects")).toBeUndefined();
  });

  it("does not expose archived event aliases when replay switches from the canonical path", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    // Serialized receipt uses canonical validation; its exact retry reaches the
    // common idempotency lookup before the segmented eligibility filter.
    const command = {
      operationId: "replay-canonical-alias",
      occurredAtEpochMs: time0,
      to: loosePosition("a", { serialId: "SERIAL-REPLAY" }),
      amount: stockAmount("1", "piece"),
    } as const;
    const first = await inventory.stock.receive(command);
    const replay = await inventory.stock.receive(command);
    const position = replay.event.stockEffects[0]?.position;
    if (position === undefined) throw new Error("Expected serialized receipt effect.");
    // JavaScript callers may mutate a defensive result even though the TS view
    // is readonly; the archived event must remain the original fact either way.
    Reflect.set(position, "placementNodeId", "caller-mutated");
    expect((await storage.readOperation(command.operationId))?.event)
      .toEqual(first.event);
    expect((await inventory.stock.receive(command)).event).toEqual(first.event);
  });

  it("never enumerates completed operation history when committing or listing work to repair", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    for (let index = 0; index < 2_000; index += 1) {
      await inventory.stock.receive({
        operationId: "history-seed-" + index,
        occurredAtEpochMs: time0,
        to: loosePosition("a"),
        amount: stockAmount("1", "piece"),
      });
    }
    // Observe traversal only. All records are produced by public commands and
    // retain their real values; the spy does not replace or forge adapter state.
    const archive = Reflect.get(storage, "operations");
    const migrationArchive = Reflect.get(storage, "migrationManifests");
    const values = vi.spyOn(Map.prototype, "values");
    try {
      for (let index = 0; index < 10; index += 1) {
        await inventory.stock.transfer({
          operationId: "history-tail-" + index,
          occurredAtEpochMs: time1,
          from: loosePosition(index % 2 === 0 ? "a" : "b"),
          toPlacementNodeId: index % 2 === 0 ? "b" : "a",
          amount: stockAmount("1", "piece"),
        });
      }
      expect(await storage.listApplyingOperations({ limit: 10 })).toEqual([]);
      expect(await storage.listApplyingMigrationManifests({ limit: 10 })).toEqual([]);
      expect(values.mock.contexts.filter((context) =>
        context === archive || context === migrationArchive
      )).toHaveLength(0);
    } finally {
      values.mockRestore();
    }
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]
      ?.measurements.primary.quantity.amountMinor).toBe(2_000);
  }, 20_000);

  it("rejects a changed receipt retry after snapshot restore without changing stock or revision", async () => {
    const original = createTestInventory();
    const command = {
      operationId: "restored-receipt-retry",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("3", "piece"),
    } as const;
    await original.stock.receive(command);
    const exported = await original.read.world();
    const storage = createInMemoryInventoryDurableStorage({ initialWorld: exported });
    const restored = createTestInventory(storage);
    const before = storage.readPositionSegment().materialize();
    const beforeRevision = storage.readPositionSegment().revision();
    await expect(restored.stock.receive({
      ...command,
      amount: stockAmount("4", "piece"),
    })).rejects.toThrow();
    expect(storage.readPositionSegment().revision()).toBe(beforeRevision);
    expect(storage.readPositionSegment().materialize()).toEqual(before);
    expect(await storage.readWorld()).toEqual(exported);
  });

  it("allows exact event replay after snapshot restore without applying stock twice", async () => {
    const original = createTestInventory();
    const command = {
      operationId: "restored-exact-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("3", "piece"),
    } as const;
    await original.stock.receive(command);
    const exported = await original.read.world();
    const storage = createInMemoryInventoryDurableStorage({ initialWorld: exported });
    const restored = createTestInventory(storage);
    const before = storage.readPositionSegment().materialize();
    await restored.stock.receive(command);
    expect(storage.readPositionSegment().materialize()).toEqual(before);
    await expectSegmentMatchesPublishedWorld(storage);
  });

  it("keeps the adapter segmented mirror exact across normal stock lifecycle publication", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receiveMany({
      operationId: "segmented-mirror-receive",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "SEG-A" }),
          amount: stockAmount("2", "piece"),
        },
        {
          to: loosePosition("store", { lotId: "SEG-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    await expectSegmentMatchesPublishedWorld(storage);

    await inventory.stock.transfer({
      operationId: "segmented-mirror-transfer",
      occurredAtEpochMs: time1,
      from: loosePosition("store", { lotId: "SEG-A" }),
      toPlacementNodeId: "room",
      amount: stockAmount("1", "piece"),
    });
    await expectSegmentMatchesPublishedWorld(storage);

    const roomRow = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["room"],
        lotIds: ["SEG-A"],
      })
    )[0];
    if (roomRow === undefined) throw new Error("Expected transferred row.");
    await inventory.stock.detach({
      operationId: "segmented-mirror-detach",
      occurredAtEpochMs: time2,
      from: roomRow.key,
      amount: stockAmount("1", "piece"),
    });
    await expectSegmentMatchesPublishedWorld(storage);

    const detached = (await inventory.read.whereabouts())[0]?.currentPositions[0];
    if (detached === undefined) throw new Error("Expected detached row.");
    await inventory.stock.markMissing({
      operationId: "segmented-mirror-missing",
      occurredAtEpochMs: time2,
      from: detached.key,
      amount: stockAmount("1", "piece"),
    });
    await expectSegmentMatchesPublishedWorld(storage);

    const missing = (await inventory.read.whereabouts())[0]?.currentPositions[0];
    if (missing === undefined) throw new Error("Expected missing row.");
    await inventory.stock.place({
      operationId: "segmented-mirror-place",
      occurredAtEpochMs: time3,
      from: missing.key,
      into: "room",
      amount: stockAmount("1", "piece"),
    });
    await expectSegmentMatchesPublishedWorld(storage);

    await inventory.stock.issue({
      operationId: "segmented-mirror-issue",
      occurredAtEpochMs: time3,
      from: {
        itemId: "item-a",
        placementNodeId: "room",
        lotId: "SEG-A",
      },
      amount: stockAmount("1", "piece"),
    });
    await expectSegmentMatchesPublishedWorld(storage);
  });

  it("serves exact and subtree positions without materializing the world", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receiveMany({
      operationId: "segmented-read-receive",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "READ-A" }),
          amount: stockAmount("1", "piece"),
        },
        {
          to: loosePosition("room", { lotId: "READ-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });

    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: async () => {
        throw new Error("canonical whole-world fallback was touched");
      },
    });

    const direct = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["store"],
    });
    expect(direct).toHaveLength(1);
    expect(direct[0]?.key.lotId).toBe("READ-A");

    const byRevision = await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v2"],
      lotIds: ["READ-B"],
    });
    expect(byRevision).toHaveLength(1);
    expect(byRevision[0]?.key.placementNodeId).toBe("room");

    const subtree = await inventory.read.positions({
      itemId: "item-a",
      withinPlacementNodeIds: ["store"],
    });
    expect(subtree).toMatchObject([{ key: { lotId: "READ-A", placementNodeId: "store" } }]);
  });


  it("publishes a prototype-free current catalog after its first segmented event", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const segmentedCommit = vi.spyOn(storage, "commitSegmentedStockEvent");
    await inventory.stock.receive({
      operationId: "segmented-first-catalog",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    expect(segmentedCommit).toHaveBeenCalledOnce();
    const world = await storage.readWorld();
    for (const activeByIdentity of [
      world.catalog.activeItemRevisionIds,
      world.catalog.activeCompositionRevisionIds,
      world.catalog.activeTransformationRevisionIds,
      world.catalog.activeCollectionRevisionIds,
      world.catalog.activeFungibilityRevisionIds,
    ]) {
      expect(Object.getPrototypeOf(activeByIdentity)).toBe(null);
      expect(Object.hasOwn(activeByIdentity, "constructor")).toBe(false);
    }
  });

  it("commits exact transfer without whole-world planning and lazily catches canonical world up", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segmented-fast-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("3", "piece"),
    });

    const realReadWorld = storage.readWorld.bind(storage);
    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: async () => {
        throw new Error("whole-world fallback touched during segmented transfer");
      },
    });

    const move = {
      operationId: "segmented-fast-transfer",
      occurredAtEpochMs: time1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    } as const;
    const first = await inventory.stock.transfer(move);
    expect(first.replayed).toBe(false);
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements.primary.quantity.amountMinor).toBe(2);
    expect(storage.readPositionSegment().positionsByPlacement("b")[0]?.measurements.primary.quantity.amountMinor).toBe(1);

    const replay = await inventory.stock.transfer(move);
    expect(replay.replayed).toBe(true);
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements.primary.quantity.amountMinor).toBe(2);
    expect(storage.readPositionSegment().positionsByPlacement("b")[0]?.measurements.primary.quantity.amountMinor).toBe(1);

    await expect(
      inventory.stock.transfer({
        ...move,
        toPlacementNodeId: "c",
      })
    ).rejects.toThrow("changed intent");

    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: realReadWorld,
    });
    await expectSegmentMatchesPublishedWorld(storage);
    const operation = await storage.readOperation(move.operationId);
    expect(operation?.state).toBe(InventoryDurableOperationState.Completed);
    expect(operation?.event?.eventId).toBe(first.event.eventId);
  });

  it("replays exactly once when the caller loses the result after one atomic segmented commit", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segmented-fast-uncertain-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("2", "piece"),
    });
    const realCommit = storage.commitSegmentedStockEvent.bind(storage);
    let loseFirstResult = true;
    storage.commitSegmentedStockEvent = async (input) => {
      const result = await realCommit(input);
      if (loseFirstResult && input.operationId === "segmented-fast-uncertain") {
        loseFirstResult = false;
        throw new Error("segmented publication uncertainty");
      }
      return result;
    };
    const move = {
      operationId: "segmented-fast-uncertain",
      occurredAtEpochMs: time1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    } as const;

    await expect(inventory.stock.transfer(move)).rejects.toThrow(
      "segmented publication uncertainty"
    );
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements.primary.quantity.amountMinor).toBe(1);
    expect(storage.readPositionSegment().positionsByPlacement("b")[0]?.measurements.primary.quantity.amountMinor).toBe(1);

    const replay = await inventory.stock.transfer(move);
    expect(replay.replayed).toBe(true);
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements.primary.quantity.amountMinor).toBe(1);
    expect(storage.readPositionSegment().positionsByPlacement("b")[0]?.measurements.primary.quantity.amountMinor).toBe(1);
    await expectSegmentMatchesPublishedWorld(storage);
  });

  it("falls back to the full coordinator when reservation truth exists", async () => {
    const stages: string[] = [];
    const storage = createInMemoryInventoryDurableStorage({
      failpoint: ({ operationId, stage, timing }) => {
        if (operationId === "segmented-reservation-transfer") {
          stages.push(stage + ":" + timing);
        }
      },
    });
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segmented-reservation-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "segmented-reservation",
      operationId: "segmented-reservation-create",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });

    await inventory.stock.transfer({
      operationId: "segmented-reservation-transfer",
      occurredAtEpochMs: time2,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    });
    expect(stages).toContain(InventoryStorageWriteStage.Begin + ":before");
    await expectSegmentMatchesPublishedWorld(storage);
  });

  it("keeps ordinary issue and whereabouts reclassification on segmented state", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segmented-lifecycle-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("3", "piece"),
    });

    const realReadWorld = storage.readWorld.bind(storage);
    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: async () => {
        throw new Error("ordinary stock lifecycle touched canonical whole-world fallback");
      },
    });

    const issued = await inventory.stock.issue({
      operationId: "segmented-lifecycle-issue",
      occurredAtEpochMs: time1,
      from: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    expect(issued.replayed).toBe(false);
    expect(
      storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(2);

    await inventory.stock.detach({
      operationId: "segmented-lifecycle-detach",
      occurredAtEpochMs: time2,
      from: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    const detached = await inventory.read.positions({
      itemId: "item-a",
      whereaboutsStates: [InventoryStockWhereaboutsState.Detached],
    });
    expect(detached).toHaveLength(1);
    expect(
      storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(1);

    await inventory.stock.markMissing({
      operationId: "segmented-lifecycle-missing",
      occurredAtEpochMs: time3,
      from: detached[0]?.key ?? (() => {
        throw new Error("Expected one detached position.");
      })(),
      amount: stockAmount("1", "piece"),
    });
    const missing = await inventory.read.positions({
      itemId: "item-a",
      whereaboutsStates: [InventoryStockWhereaboutsState.Missing],
    });
    expect(missing).toHaveLength(1);

    await inventory.stock.place({
      operationId: "segmented-lifecycle-place",
      occurredAtEpochMs: time3,
      from: missing[0]?.key ?? (() => {
        throw new Error("Expected one missing position.");
      })(),
      into: "b",
      amount: stockAmount("1", "piece"),
    });
    const placed = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["b"],
    });
    expect(placed).toHaveLength(1);

    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: realReadWorld,
    });
    await expectSegmentMatchesPublishedWorld(storage);
  });

  it("commits transferMany as one segmented event without whole-world fallback", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const routeCount = 1_000;
    const totalPositions = routeCount + 1;
    await inventory.stock.receiveMany({
      operationId: "segmented-transfer-many-receive",
      occurredAtEpochMs: time0,
      lines: Array.from({ length: totalPositions }, (_, index) => ({
        to: loosePosition("warehouse", {
          lotId: "BULK-" + String(index).padStart(5, "0"),
        }),
        amount: stockAmount("1", "piece"),
      })),
    });

    const lines = Array.from({ length: routeCount }, (_, index) => ({
      from: loosePosition("warehouse", {
        lotId: "BULK-" + String(index).padStart(5, "0"),
      }),
      toPlacementNodeId: "moved",
      amount: stockAmount("1", "piece"),
    }));
    const beforeRevision = storage.readPositionSegment().revision();
    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: async () => {
        throw new Error("transferMany touched canonical whole-world fallback");
      },
    });

    const input = {
      operationId: "segmented-transfer-many",
      occurredAtEpochMs: time1,
      lines,
    } as const;
    const first = await inventory.stock.transferMany(input);
    expect(first.replayed).toBe(false);
    expect(first.event.stockEffects).toHaveLength(routeCount * 2);
    expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 1);

    const moved = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["moved"],
    });
    expect(moved).toHaveLength(routeCount);
    const untouched = await inventory.read.positions({
      itemId: "item-a",
      lotIds: ["BULK-" + String(routeCount).padStart(5, "0")],
    });
    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.key.placementNodeId).toBe("warehouse");

    const replay = await inventory.stock.transferMany(input);
    expect(replay.replayed).toBe(true);
    expect(replay.event.eventId).toBe(first.event.eventId);
    expect(storage.readPositionSegment().revision()).toBe(beforeRevision + 1);
  });

  it("resolves a shared bin's subtree membership once across all stock rows", () => {
    const placement = createInMemoryInventorySegmentedPlacementStore();
    placement.applyChange({
      expectedRevision: 0, nextRevision: 1, eventId: "bin-placed",
      nodeId: "bin", toParentNodeId: "root", targetAcceptsPlacement: true,
    });
    const positions = Array.from({ length: 200 }, (_, index) =>
      segmentedPosition({ placementNodeId: "bin", lotId: `LOT-${index}` })
    );
    const store = createInMemoryInventorySegmentedPositionStore({ positions });
    const parent = vi.spyOn(placement, "parentNodeId");
    expect(store.queryPositions({ itemId: "item-a", withinPlacementNodeIds: ["root"] }, placement)).toHaveLength(200);
    expect(parent).toHaveBeenCalledExactlyOnceWith("bin");
  });

  it("shares fallback subtree membership across a deep chain of distinct stock nodes", () => {
    const placement = createInMemoryInventorySegmentedPlacementStore();
    const positions: InventoryStockPosition[] = [];
    const depth = 180;
    for (let index = 0; index < depth; index += 1) {
      const nodeId = `chain-${index}`;
      placement.applyChange({
        expectedRevision: index, nextRevision: index + 1, eventId: `place-${nodeId}`,
        nodeId, toParentNodeId: index === 0 ? "root" : `chain-${index - 1}`, targetAcceptsPlacement: true,
      });
      positions.push(segmentedPosition({ placementNodeId: nodeId, lotId: "stock" }));
    }
    positions.push(segmentedPosition({ placementNodeId: "outside", lotId: "stock" }));
    const store = createInMemoryInventorySegmentedPositionStore({ positions });
    const parent = vi.spyOn(placement, "parentNodeId");
    const selected = store.queryPositions({
      itemId: "item-a", withinPlacementNodeIds: ["root", "chain-40"], lotIds: ["stock"],
    }, placement);
    const chainNodes = Array.from({ length: depth }, (_, index) => `chain-${index}`);
    expect(selected?.map((row) => row.key.placementNodeId).sort()).toEqual([...chainNodes].sort());
    expect(parent.mock.calls.map(([node]) => node).sort())
      .toEqual([...chainNodes.filter((node) => node !== "chain-40"), "outside"].sort());
  });

  it("trusts indexed subtree membership and still applies direct stock filters", () => {
    const placement = createInMemoryInventorySegmentedPlacementStore();
    const positions: InventoryStockPosition[] = [];
    for (let index = 0; index < 20; index += 1) {
      const nodeId = `child-${index}`;
      const parentId = index === 0 ? "root" : `child-${index - 1}`;
      placement.applyChange({
        expectedRevision: index, nextRevision: index + 1, eventId: `place-${nodeId}`,
        nodeId, toParentNodeId: parentId, targetAcceptsPlacement: true,
      });
      positions.push(segmentedPosition({ placementNodeId: nodeId, lotId: "selected" }));
      positions.push(segmentedPosition({ placementNodeId: nodeId, lotId: "other" }));
    }
    for (let index = 0; index < 200; index += 1) {
      positions.push(segmentedPosition({ placementNodeId: `outside-${index}`, lotId: "selected" }));
    }
    const store = createInMemoryInventorySegmentedPositionStore({ positions });
    const parent = vi.spyOn(placement, "parentNodeId");
    const selected = store.queryPositions({
      itemId: "item-a", withinPlacementNodeIds: ["root", "child-4"], lotIds: ["selected"],
    }, placement);
    expect(selected?.map((row) => row.key.lotId)).toEqual(Array(20).fill("selected"));
    expect(selected?.map((row) => row.key.placementNodeId).sort())
      .toEqual(Array.from({ length: 20 }, (_, index) => `child-${index}`).sort());
    expect(parent).not.toHaveBeenCalled();
  });

  it("preserves the FIFO origin of a same-position positive replacement", () => {
    const stock = segmentedPosition({ placementNodeId: "store", lotId: "aged" });
    const id = inventoryStockPositionIdentity(stock.key);
    const store = createInMemoryInventorySegmentedPositionStore({
      positions: [stock], positiveLayerStarts: { [id]: time0 }, revision: 1,
    });
    store.replaceExactPosition({
      expectedRevision: 1,
      fromPositionId: id,
      to: {
        ...stock,
        measurements: {
          ...stock.measurements,
          primary: { ...stock.measurements.primary, quantity: parseQuantity("2", "piece") },
        },
      },
    });
    expect(store.positiveLayerStart(id)).toBe(time0);
    expect(store.position(id)?.measurements.primary.quantity).toEqual(parseQuantity("2", "piece"));
    store.applyDelta({ expectedRevision: 2, nextRevision: 3, removePositionIds: [id] });
    expect(store.positiveLayerStart(id)).toBeUndefined();
  });

  it("updates one exact row and all indexes without materializing a whole world", () => {
    const stock = segmentedPosition({
      placementNodeId: "store",
      lotId: "LOT-1",
    });
    const carrier = segmentedPosition({
      placementNodeId: "store",
      serialId: "CARRIER-1",
    });
    const store = createInMemoryInventorySegmentedPositionStore({
      positions: [stock, carrier],
      revision: 7,
    });
    const carrierId = inventoryStockPositionIdentity(carrier.key);
    const rootBeforeMove = store.contentRoot();

    const movedCarrier: InventoryStockPosition = {
      ...carrier,
      key: { ...carrier.key, placementNodeId: "room" },
    };
    const result = store.replaceExactPosition({
      expectedRevision: 7,
      fromPositionId: carrierId,
      to: movedCarrier,
    });

    expect(result.revision).toBe(8);
    expect(store.revision()).toBe(8);
    expect(store.position(carrierId)).toBeUndefined();
    expect(
      store.positivePositionBySerial("item-a", "CARRIER-1")?.key
        .placementNodeId
    ).toBe("room");
    expect(store.positionsByPlacement("store")).toHaveLength(1);
    expect(store.positionsByPlacement("room")).toHaveLength(1);
    expect(store.positionsByItem("item-a")).toHaveLength(2);
    expect(store.positionsByItemRevision("item-a-v2")).toHaveLength(2);

    const rootAfterMove = store.contentRoot();
    expect(rootAfterMove).not.toBe(rootBeforeMove);

    const materialized = store.materialize();
    expect(Object.keys(materialized.positions)).toHaveLength(2);
    expect(materialized.positionIdsByPlacementNodeId.store).toHaveLength(1);
    expect(materialized.positionIdsByPlacementNodeId.room).toHaveLength(1);
    expect(materialized.positionIdsByWhereaboutsId).toEqual({});
    const rebuilt = createInMemoryInventorySegmentedPositionStore({
      positions: Object.values(materialized.positions),
      revision: store.revision(),
    });
    expect(rebuilt.contentRoot()).toBe(rootAfterMove);

    expect(() =>
      store.replaceExactPosition({
        expectedRevision: 7,
        fromPositionId: result.toPositionId,
        to: carrier,
      })
    ).toThrow(InventorySegmentRevisionConflictError);
  });

  it(
    "keeps one exact carrier move effectively independent of 10k vs 100k unrelated positions",
    () => {
      const baselineMs = benchmarkCarrierMoves(10_000, 200);
      const warehouseMs = benchmarkCarrierMoves(100_000, 200);
      expect(warehouseMs).toBeLessThan(baselineMs * 5 + 0.5);
      console.log(
        JSON.stringify({
          adapter: "segmented-position-store",
          baselinePositions: 10_000,
          warehousePositions: 100_000,
          baselineAverageMoveMs: baselineMs,
          warehouseAverageMoveMs: warehouseMs,
        })
      );
    },
    30_000
  );
});
