import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createInventoryTransferManyEvent } from "../src/commands.js";
import { inventoryEventIntentFingerprint } from "../src/events.js";
import { stockAmount } from "../src/amounts.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
} from "./test-fixtures.js";

/** One deterministic route set with disjoint source/destination positions. */
function transferRoutes(size: number) {
  const amount = stockAmount("1", "piece");
  return Array.from({ length: size }, (_, index) => ({
    from: loosePosition("bulk-from", {
      lotId: "BULK-LOT-" + String(index).padStart(6, "0"),
    }),
    toPlacementNodeId: "bulk-to",
    amount,
  }));
}

describe("bulk transfer builder canonical-performance boundary", () => {
  it("constructs 1,000 and 10,000 atomic routes with one event and complete FIFO provenance", () => {
    const catalog = createTabletCatalog();
    for (const size of [1_000, 10_000]) {
      const lines = transferRoutes(size);
      const started = performance.now();
      const event = createInventoryTransferManyEvent({
        catalog,
        operationId: "bulk-builder-" + size,
        occurredAtEpochMs: time0,
        lines,
      });
      const elapsedMs = performance.now() - started;
      expect(event.stockEffects).toHaveLength(size * 2);
      expect(event.positiveLayerProvenanceTransfers).toHaveLength(size);
      expect(event.traceabilityChanges).toEqual([]);
      expect(event.placementChanges).toEqual([]);
      expect(event.eventId).toBe(
        "inventory:event:bulk-builder-" + size
      );
      console.log(JSON.stringify({
        benchmark: "canonical-transfer-many-builder",
        routes: size,
        effectCount: event.stockEffects.length,
        elapsedMs,
      }));
    }
  }, 60_000);

  it("commits 1,000 and 10,000 routes publicly as one atomic revision without per-route commits", async () => {
    for (const size of [1_000, 10_000]) {
      const inventory = createTestInventory();
      const lines = transferRoutes(size);
      await inventory.stock.receiveMany({
        operationId: "public-builder-seed-" + size,
        occurredAtEpochMs: time0,
        lines: lines.map(
          /** Use the exact same source-position quantity as the following transfer. */
          (line) => ({ to: line.from, amount: line.amount })
        ),
      });
      const command = {
        operationId: "public-builder-transfer-" + size,
        occurredAtEpochMs: time0,
        lines,
      };
      const started = performance.now();
      const result = await inventory.stock.transferMany(command);
      const elapsedMs = performance.now() - started;
      expect(result.replayed).toBe(false);
      expect(result.receipt.worldRevision).toBe(2);
      expect(result.event.stockEffects).toHaveLength(size * 2);
      expect(result.event.positiveLayerProvenanceTransfers).toHaveLength(size);
      const repeat = await inventory.stock.transferMany(command);
      expect(repeat.replayed).toBe(true);
      expect(repeat.receipt).toEqual(result.receipt);
      const after = await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["bulk-to"],
      });
      expect(after).toHaveLength(size);
      expect((await inventory.read.world()).revision).toBe(2);
      console.log(JSON.stringify({
        benchmark: "public-segmented-transfer-many",
        routeCount: size,
        effectCount: result.event.stockEffects.length,
        elapsedMs,
        worldRevisions: 2,
      }));
    }
  }, 90_000);

  it("sorts mixed-destination FIFO transfers canonically without caller aliases", () => {
    const catalog = createTabletCatalog();
    const lines = transferRoutes(2_000).map(
      /** Spread one direct source across multiple warehouse receiving zones. */
      (line, index) => ({
        ...line,
        toPlacementNodeId:
          "rack-" + String((index * 7919) % 503).padStart(4, "0"),
      })
    );
    const event = createInventoryTransferManyEvent({
      catalog,
      operationId: "mixed-destination-canonical",
      occurredAtEpochMs: time0,
      lines,
    });
    const reversed = createInventoryTransferManyEvent({
      catalog,
      operationId: "mixed-destination-canonical",
      occurredAtEpochMs: time0,
      lines: [...lines].reverse(),
    });
    expect(event).toEqual(reversed);
    const originalFingerprint = inventoryEventIntentFingerprint(event);
    expect(originalFingerprint).toBe(inventoryEventIntentFingerprint(reversed));
    expect(event.positiveLayerProvenanceTransfers).toHaveLength(lines.length);
    // A returned kernel event must never retain mutable caller-position aliases.
    const first = lines[0];
    if (first === undefined) throw new Error("Missing mixed transfer source.");
    (first.from as { lotId?: string }).lotId = "caller-mutated-after-build";
    expect(inventoryEventIntentFingerprint(event)).toBe(originalFingerprint);
    expect(inventoryEventIntentFingerprint(reversed)).toBe(originalFingerprint);
  });

  it("benchmarks 10,000 mixed-destination transfers with complete canonical FIFO proof", () => {
    const catalog = createTabletCatalog();
    const lines = transferRoutes(10_000).map(
      /** Deliberately interleave destinations so sorting cannot be a preordered fast path. */
      (line, index) => ({
        ...line,
        toPlacementNodeId:
          "rack-" + String((index * 7919) % 503).padStart(4, "0"),
      })
    );
    const started = performance.now();
    const event = createInventoryTransferManyEvent({
      catalog,
      operationId: "mixed-destination-benchmark",
      occurredAtEpochMs: time0,
      lines,
    });
    const elapsedMs = performance.now() - started;
    expect(event.stockEffects).toHaveLength(lines.length * 2);
    expect(event.positiveLayerProvenanceTransfers).toHaveLength(lines.length);
    console.log(JSON.stringify({
      benchmark: "canonical-mixed-destination-transfer-many-builder",
      routes: lines.length,
      elapsedMs,
    }));
  }, 30_000);

  it("retains canonical fingerprints under reordered and duplicate identical routes", () => {
    const catalog = createTabletCatalog();
    const routes = transferRoutes(30);
    const forward = createInventoryTransferManyEvent({
      catalog,
      operationId: "order-conservation",
      occurredAtEpochMs: time0,
      lines: routes,
    });
    const reverse = createInventoryTransferManyEvent({
      catalog,
      operationId: "order-conservation",
      occurredAtEpochMs: time0,
      lines: [...routes].reverse(),
    });
    expect(forward).toEqual(reverse);
    expect(inventoryEventIntentFingerprint(forward)).toBe(
      inventoryEventIntentFingerprint(reverse)
    );

    const duplicate = routes[0];
    if (duplicate === undefined) throw new Error("Missing test route.");
    const expanded = createInventoryTransferManyEvent({
      catalog,
      operationId: "duplicates-conservation",
      occurredAtEpochMs: time0,
      lines: [duplicate, duplicate],
    });
    expect(expanded.stockEffects).toHaveLength(2);
    expect(expanded.positiveLayerProvenanceTransfers).toHaveLength(1);

    expect(() => createInventoryTransferManyEvent({
      catalog,
      operationId: "collision-rejection",
      occurredAtEpochMs: time0,
      lines: [
        duplicate,
        { ...duplicate, toPlacementNodeId: "other-endpoint" },
      ],
    })).toThrow("disjoint one-to-one");
  });
});
