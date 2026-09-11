import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  inventoryStockSelector,
  stockAmount,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  type InventoryDurableStorage,
} from "../src/storage-api.js";
import { createTabletCatalog, time0, time1, time2 } from "./test-fixtures.js";

/** Machine-declared bounded trace for one frozen snapshot across a later publication. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-READ-SNAPSHOT-COHERENCE",
] as const;

/** Wrap one durable adapter and count only published-world reads. */
function countingStorage(storage: InventoryDurableStorage): {
  /** Wrapped durable adapter whose published-world reads are counted. */
  readonly storage: InventoryDurableStorage;
  /** Return the number of published-world reads observed so far. */
  readonly reads: () => number;
  /** Reset the published-world read counter. */
  readonly reset: () => void;
} {
  let worldReads = 0;
  return {
    storage: new Proxy(storage, {
      /** Bind adapter methods and intercept only readWorld. */
      get(target, property, receiver) {
        if (property === "readWorld") {
          return async () => {
            worldReads += 1;
            return target.readWorld();
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    reads: () => worldReads,
    reset: () => {
      worldReads = 0;
    },
  };
}

describe("published InventoryOnce read snapshots", () => {
  it("binds every public read to one world even after newer truth publishes", async () => {
    const counted = countingStorage(createInMemoryInventoryDurableStorage());
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage: counted.storage,
      clock: { nowEpochMs: (): number => time2 },
    });
    await inventory.catalog.publish({
      operationId: "publish-snapshot-catalog",
      occurredAtEpochMs: time0,
    });
    await inventory.stock.receive({
      operationId: "receive-snapshot-first",
      occurredAtEpochMs: time0,
      to: {
        itemId: "item-a",
        locationId: "store",
        lotId: "LOT-A",
        containerId: "CONTAINER-A",
      },
      amount: stockAmount("1", "piece"),
      lot: { expiresAtEpochMs: 1798761600000 },
      container: { containerType: "tray" },
    });

    counted.reset();
    const snapshot = await inventory.read.snapshot();
    expect(counted.reads()).toBe(1);
    expect(snapshot.worldRevision).toBe(2);
    expect(
      snapshot.summary(
        inventoryStockSelector("item-a", { locationIds: ["store"] })
      ).revisions[0]?.total.primary.quantity.amountMinor
    ).toBe(1);
    expect(snapshot.lots("item-a")[0]?.definition.lotId).toBe("LOT-A");
    expect(snapshot.containers()[0]?.definition.containerId).toBe(
      "CONTAINER-A"
    );
    expect(snapshot.packagingRevisions({ itemId: "item-a" })).toHaveLength(2);
    expect(counted.reads()).toBe(1);

    await inventory.stock.receive({
      operationId: "receive-snapshot-second",
      occurredAtEpochMs: time1,
      to: { itemId: "item-a", locationId: "store", lotId: "LOT-B" },
      amount: stockAmount("1", "piece"),
      lot: {},
    });
    counted.reset();
    expect(
      snapshot.summary(
        inventoryStockSelector("item-a", { locationIds: ["store"] })
      ).revisions[0]?.total.primary.quantity.amountMinor
    ).toBe(1);
    expect(snapshot.lots("item-a").map((lot) => lot.definition.lotId)).toEqual([
      "LOT-A",
    ]);
    expect(counted.reads()).toBe(0);

    const latest = await inventory.read.snapshot();
    expect(counted.reads()).toBe(1);
    expect(latest.worldRevision).toBe(3);
    expect(
      latest.summary(
        inventoryStockSelector("item-a", { locationIds: ["store"] })
      ).revisions[0]?.total.primary.quantity.amountMinor
    ).toBe(2);
    expect(latest.lots("item-a").map((lot) => lot.definition.lotId)).toEqual([
      "LOT-A",
      "LOT-B",
    ]);
  });
});
