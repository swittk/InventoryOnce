import { describe, expect, it, vi } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  readInventoryScopedStockAvailability,
} from "../src/storage-api.js";
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

/** Executable refinement for a single indexed read/plan/publication fence and exact replay. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = ["TRACE-SCOPED-STOCK-PLANNING"] as const;

/** Receive known lots of different ages at one direct location. */
async function receiveKnownLots(inventory: ReturnType<typeof createTestInventory>) {
  await inventory.stock.receive({
    operationId: "receive-old", occurredAtEpochMs: time0,
    to: loosePosition("store", { lotId: "old" }), amount: stockAmount("2", "piece"),
  });
  await inventory.stock.receive({
    operationId: "receive-young", occurredAtEpochMs: time1,
    to: loosePosition("store", { lotId: "young" }), amount: stockAmount("2", "piece"),
    lot: { expiresAtEpochMs: time3 + 1 },
  });
}

/** Exact revision and direct placement used by the batch scenarios. */
const selector = inventoryStockSelector("item-a", {
  itemRevisionIds: ["item-a-v2"],
  placementNodeIds: ["store"],
});

/** One FIFO batch that consumes three pieces in two ordered requests. */
function issueCommand() {
  return {
    operationId: "scoped-batch", occurredAtEpochMs: time2,
    requests: [
      { requestId: "first", selector, amount: stockAmount("2", "piece"), method: InventoryAllocationMethod.Fifo },
      { requestId: "second", selector, amount: stockAmount("1", "piece"), method: InventoryAllocationMethod.Fifo },
    ],
  };
}

describe("indexed stock planning and availability", () => {
  it("records an exact transfer shortage without copying the known lot, age or line cost", async () => {
    for (const storage of [createInMemoryInventoryDurableStorage(), createInMemoryInventoryDurableStorage({ failpoint: () => undefined })]) {
      const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      await receiveKnownLots(inventory);
      const command = {
        operationId: "record-exact-transfer", occurredAtEpochMs: time2,
        lines: [{
          from: loosePosition("store", { lotId: "old" }), toPlacementNodeId: "destination",
          amount: stockAmount("4", "piece"), metadata: { unitCostMinor: 175 },
        }],
      };
      const result = await inventory.stock.transferMany(command);
      const known = result.event.stockEffects.find((effect) => effect.position.lotId === "old" && effect.position.placementNodeId === "destination");
      const unlabelled = result.event.stockEffects.find((effect) => effect.position.lotId === undefined && effect.position.placementNodeId === "destination");
      expect(known).toMatchObject({ metadata: { unitCostMinor: 175 }, measurementsDelta: { primary: { quantity: { amountMinor: 2 } } } });
      expect(unlabelled?.measurementsDelta.primary.quantity.amountMinor).toBe(2);
      expect(unlabelled?.metadata).toBeUndefined();
      expect(result.event.unwitnessedStockMovements).toMatchObject([{
        from: { placementNodeId: "store" }, to: { placementNodeId: "destination" },
        measurements: { primary: { quantity: { amountMinor: 2 } } },
      }]);
      expect(result.event.unwitnessedStockMovements?.[0]?.from.lotId).toBeUndefined();
      const arrival = await inventory.read.planAllocation({
        selector: inventoryStockSelector("item-a", { placementNodeIds: ["destination"] }),
        amount: stockAmount("4", "piece"), method: InventoryAllocationMethod.Fifo, atEpochMs: time3,
      });
      expect(arrival.lines.map((line) => [line.position.lotId, line.allocatedPrimary.amountMinor, line.layerStartedAtEpochMs])).toEqual([
        ["old", 2, time0], [undefined, 2, time2],
      ]);
      const reopened = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      expect(await reopened.stock.transferMany(command)).toEqual({ ...result, replayed: true });
      await expect(reopened.stock.transferMany({ ...command, reason: "changed" })).rejects.toThrow("changed intent");
      const world = await inventory.read.world();
      const cold = createTestInventory(createInMemoryInventoryDurableStorage({ initialWorld: world }), undefined, undefined, InventoryDeficitPolicy.Record);
      expect(await cold.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual(
        await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })
      );
      await reopened.stock.correct({
        operationId: "omit-unwitnessed-transfer", occurredAtEpochMs: time3,
        correctsEventId: result.event.eventId, reason: "Report withdrawn",
        replaceWith: (plans) => plans.omit(),
      });
      expect(await reopened.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual([]);
      expect((await storage.readOperation(command.operationId))?.state).toBe("completed");
    }
  });

  it("records a policy transfer and scrap shortfall through the native fence", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    await receiveKnownLots(inventory);
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const command = {
      operationId: "record-policy-transfer", occurredAtEpochMs: time2, selector,
      amount: stockAmount("5", "piece"), method: InventoryAllocationMethod.Fifo,
      toPlacementNodeId: "destination",
    };
    const transferred = await inventory.stock.transferByPolicy(command);
    expect(transferred.event.positiveLayerProvenanceTransfers).toHaveLength(2);
    expect(transferred.deficit?.primary.amountMinor).toBe(1);
    expect(await inventory.stock.transferByPolicy(command)).toEqual({ ...transferred, replayed: true });
    const scrapped = await inventory.stock.scrapByPolicy({
      ...command, operationId: "record-policy-scrap", reason: "damaged beyond recovery",
      amount: stockAmount("2", "piece"),
    });
    expect(scrapped.event.reason).toBe("damaged beyond recovery");
    expect(scrapped.event.unwitnessedStockMovements).toMatchObject([{
      from: { placementNodeId: "store" }, measurements: { primary: { quantity: { amountMinor: 2 } } },
    }]);
    expect(scrapped.event.unwitnessedStockMovements?.[0]?.to).toBeUndefined();
    expect(scrapped.deficit?.position.lotId).toBeUndefined();
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("preserves carried FIFO age and plans a whole batch without a world read", async () => {
    const nativeStorage = createInMemoryInventoryDurableStorage();
    const canonicalStorage = createInMemoryInventoryDurableStorage({ failpoint: () => undefined });
    const native = createTestInventory(nativeStorage);
    const canonical = createTestInventory(canonicalStorage);
    for (const inventory of [native, canonical]) {
      await receiveKnownLots(inventory);
      await inventory.stock.transfer({
        operationId: "remove-old", occurredAtEpochMs: time1,
        from: loosePosition("store", { lotId: "old" }),
        toPlacementNodeId: "cart", amount: stockAmount("2", "piece"),
      });
      await inventory.stock.transfer({
        operationId: "return-old", occurredAtEpochMs: time2,
        from: loosePosition("cart", { lotId: "old" }),
        toPlacementNodeId: "store", amount: stockAmount("2", "piece"),
      });
    }
    const readWorld = vi.spyOn(nativeStorage, "readWorld").mockRejectedValue(new Error("whole world"));
    const issue = issueCommand();
    const first = issue.requests[0];
    if (first === undefined) throw new Error("Expected initial FIFO request.");
    const preview = await native.read.planAllocation({ ...first, atEpochMs: time2 });
    expect(preview.lines[0]).toMatchObject({ position: { lotId: "old" }, layerStartedAtEpochMs: time0 });
    const nativeResult = await native.stock.issueManyByPolicy(issue);
    expect(nativeResult.allocations).toMatchObject([
      { requestId: "first", lines: [{ position: { lotId: "old" } }] },
      { requestId: "second", lines: [{ position: { lotId: "young" } }] },
    ]);
    expect(nativeResult).toEqual(await canonical.stock.issueManyByPolicy(issue));
    expect(await native.stock.issueManyByPolicy(issue)).toEqual({ ...nativeResult, replayed: true });
    expect(await native.read.summary(selector)).toEqual(await canonical.read.summary(selector));
    expect(readWorld).not.toHaveBeenCalled();
    readWorld.mockRestore();
    expect(await native.read.world()).toEqual(await canonical.read.world());
  });

  it("replans a stale batch, and freezes nested intent before asynchronous reads", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await receiveKnownLots(inventory);
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const commit = storage.commitSegmentedStockEvent.bind(storage);
    const write = vi.spyOn(storage, "commitSegmentedStockEvent").mockImplementationOnce(async (plan) => {
      await inventory.stock.issue({
        operationId: "race-old", occurredAtEpochMs: time2,
        from: loosePosition("store", { lotId: "old" }), amount: stockAmount("2", "piece"),
      });
      return commit(plan);
    });
    const input = issueCommand();
    input.requests.pop();
    const executing = inventory.stock.issueManyByPolicy(input);
    input.requests.push(...issueCommand().requests.slice(1));
    const result = await executing;
    expect(result.allocations).toMatchObject([{ requestId: "first", lines: [{ position: { lotId: "young" } }] }]);
    expect(write).toHaveBeenCalledTimes(3);
    await expect(inventory.stock.issueManyByPolicy(input)).rejects.toThrow("changed intent");
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("reopens an interrupted native transfer before publish and replays the committed pick after a lost reply", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await receiveKnownLots(inventory);
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const commit = storage.commitSegmentedStockEvent.bind(storage);
    const write = vi.spyOn(storage, "commitSegmentedStockEvent");
    const command = {
      ...issueCommand(), operationId: "interrupted-transfer", toPlacementNodeId: "destination",
    };
    const before = storage.readSegmentedStockHead();
    write.mockRejectedValueOnce(new Error("interrupted before transaction"));
    await expect(inventory.stock.transferManyByPolicy(command)).rejects.toThrow("interrupted before");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await storage.readOperation(command.operationId)).toBeUndefined();
    expect(await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual([]);
    write.mockImplementationOnce(async (plan) => {
      await commit(plan);
      throw new Error("reply lost after transaction");
    });
    await expect(inventory.stock.transferManyByPolicy(command)).rejects.toThrow("reply lost");
    const reopened = createTestInventory(storage);
    const replay = await reopened.stock.transferManyByPolicy(command);
    expect(replay.replayed).toBe(true);
    expect(replay.event.recordSequence).toBe(before.recordSequence + 1);
    expect(replay.receipt.worldRevision).toBe(before.worldRevision + 1);
    expect(replay.allocations).toMatchObject([
      { requestId: "first", lines: [{ position: { lotId: "old" } }] },
      { requestId: "second", lines: [{ position: { lotId: "young" } }] },
    ]);
    expect(await reopened.stock.transferManyByPolicy(command)).toEqual(replay);
    expect(write).toHaveBeenCalledTimes(2);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("matches canonical physical availability for holds, signed deficits and ancestor expiry", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog, clockAt(time3), InventoryDeficitPolicy.Record);
    await receiveKnownLots(inventory);
    await inventory.stock.receive({
      operationId: "expired-cart", occurredAtEpochMs: time0,
      to: loosePosition("cart", { lotId: "cart-lot" }), amount: stockAmount("3", "piece"),
      placementNode: { category: "opened-cart", useByEpochMs: time2 },
    });
    await inventory.placement.move({
      operationId: "place-cart", occurredAtEpochMs: time1, nodeId: "cart", into: "store",
    });
    await inventory.reservations.reserve({
      operationId: "reserve-scoped", reservationId: "hold", itemRevisionId: "item-a-v2",
      selector, requested: parseQuantity("2", "piece"), createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-scoped", reservationId: "hold",
      occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.issue({
      operationId: "record-negative", occurredAtEpochMs: time2,
      from: loosePosition("store", { lotId: "unwitnessed" }), amount: stockAmount("1", "piece"),
    });
    const tree = inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"], withinPlacementNodeIds: ["store"],
    });
    const full = (await inventory.read.availability(tree, time2)).revisions[0];
    if (full === undefined) throw new Error("Expected canonical availability revision.");
    const { broadRequested, broadReservationIds, unbackedExactlyAllocated, unbackedReservationIds, ...physical } = full;
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const scoped = await readInventoryScopedStockAvailability({
      storage, catalog, selector: tree, itemRevisionId: "item-a-v2", atEpochMs: time2,
    });
    expect(scoped).toEqual(physical);
    expect(scoped.physicalOnHand.primary.quantity.amountMinor).toBe(7);
    expect(scoped.expiredOnHand.primary.quantity.amountMinor).toBe(3);
    expect(scoped.exactlyAllocatedUsable.amountMinor).toBe(2);
    expect(scoped.unallocatedUsablePhysical.amountMinor).toBe(1);
    expect(scoped.deficit.primary.quantity.amountMinor).toBe(1);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("keeps current and earlier exact holds distinct after a claim closes", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await receiveKnownLots(inventory);
    await inventory.reservations.reserve({
      operationId: "reserve-old", reservationId: "old-only", itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["old"] },
      requested: parseQuantity("2", "piece"), createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-old", reservationId: "old-only",
      occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
    });
    await inventory.reservations.release({
      operationId: "close-old", reservationId: "old-only", occurredAtEpochMs: time2,
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const request = { selector, amount: stockAmount("1", "piece"), method: InventoryAllocationMethod.Fifo };
    const before = await inventory.read.planAllocation({ ...request, atEpochMs: time1 });
    const after = await inventory.read.planAllocation({ ...request, atEpochMs: time3 });
    expect(before.lines[0]?.position.lotId).toBe("young");
    expect(after.lines[0]?.position.lotId).toBe("old");
    expect(readWorld).not.toHaveBeenCalled();
  });
});
