import { describe, expect, it } from "vitest";
import { InventoryDeficitPolicy, stockAmount } from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { createTestInventory, loosePosition, time0, time1, time3 } from "./test-fixtures.js";

describe("segmented historical correction of a retained recorded deficit", () => {
  it("keeps Reject's ordinary-stock prohibition on a still-negative result", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const recorded = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    await recorded.stock.issue({
      operationId: "deficit-normal-issue",
      occurredAtEpochMs: time0,
      from: loosePosition("a"),
      amount: stockAmount("5", "piece"),
    });

    const strict = createTestInventory(storage);
    await expect(strict.stock.receive({
      operationId: "deficit-normal-partial",
      occurredAtEpochMs: time1,
      to: loosePosition("a"),
      amount: stockAmount("3", "piece"),
    })).rejects.toThrow(/primary quantity must not be negative/);
    const rows = await strict.read.positions({ itemId: "item-a" });
    expect(rows[0]?.measurements.primary.quantity.amountMinor).toBe(-5);
  });

  for (const useSegmented of [true, false]) {
    it("commits a planner-approved improvement with segmented capability " + String(useSegmented), async () => {
      const storage = createInMemoryInventoryDurableStorage();
      const recorded = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      await recorded.stock.issue({
        operationId: "recorded-historical-issue",
        occurredAtEpochMs: time0,
        from: loosePosition("a"),
        amount: stockAmount("5", "piece"),
      });
      const original = await recorded.stock.receive({
        operationId: "recorded-historical-receipt",
        occurredAtEpochMs: time1,
        to: loosePosition("a"),
        amount: stockAmount("3", "piece"),
      });
      expect(storage.readPositionSegment().positionsByPlacement("a")[0]
        ?.measurements.primary.quantity.amountMinor).toBe(-2);
      if (!useSegmented) {
        // Segmented commit is optional on an otherwise conforming durable adapter.
        Object.defineProperty(storage, "commitSegmentedStockEvent", {
          configurable: true,
          value: undefined,
        });
      }
      const strict = createTestInventory(storage);
      const correction: Parameters<typeof strict.stock.correct>[0] = {
        operationId: "recorded-historical-improvement",
        occurredAtEpochMs: time3,
        correctsEventId: original.event.eventId,
        reason: "One more piece was received; the old deficit decreases.",
        replaceWith: plans => plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("a"),
          amount: stockAmount("4", "piece"),
        }),
      };
      const planned = await strict.stock.planCorrection(correction);
      expect(planned.valid).toBe(true);
      if (!planned.valid) throw new Error(planned.conflict.code);
      expect(planned.impact.deficits).toEqual([]);
      const committed = await strict.stock.correct(correction);
      expect(committed.replayed).toBe(false);
      const rows = await strict.read.positions({ itemId: "item-a" });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.measurements.primary.quantity.amountMinor).toBe(-1);
      expect((await strict.stock.correct(correction)).replayed).toBe(true);
      const world = await strict.read.world();
      expect(storage.readPositionSegment().revision()).toBe(world.revision);
      expect(storage.readPositionSegment().materialize().positions)
        .toEqual(world.projection.positions);
    });
  }
});
