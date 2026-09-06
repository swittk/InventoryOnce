import { describe, expect, it } from "vitest";
import {
  findInventoryEventByOperationId,
  InventoryDeficitPolicy,
  inventoryStockSelector,
  packageAmount,
  stockAmount,
} from "../src/index.js";
import {
  createTabletCatalog,
  createTestInventory,
  time0,
  time1,
  time2,
} from "./test-fixtures.js";

/** Read one scalar primary amount from a summary vector used by these tablet fixtures. */
function primaryMinor(measurements: {
  /** Primary scalar quantity carried by the test summary. */
  readonly primary: {
    /** Exact scaled integer amount. */
    readonly quantity: { readonly amountMinor: number };
  };
}): number {
  return measurements.primary.quantity.amountMinor;
}

describe("generic InventoryOnce read model", () => {
  it("rejects padded selector identities before they can broaden or miss stock", () => {
    expect(() => inventoryStockSelector(" item-a ")).toThrow(
      "surrounding whitespace"
    );
    expect(() =>
      inventoryStockSelector("item-a", { locationIds: [" store "] })
    ).toThrow("surrounding whitespace");
    expect(() =>
      inventoryStockSelector("item-a", { lotIds: [" LOT-A "] })
    ).toThrow("surrounding whitespace");
  });

  it("keeps old/new package revisions and item revisions separate while aggregating common UI dimensions", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog);

    await inventory.stock.receive({
      operationId: "receive-old-boxes",
      occurredAt: time0,
      to: { itemId: "item-a", locationId: "store", lotId: "old-lot" },
      amount: packageAmount(2, "item-a-box-20-v1"),
      itemRevisionId: "item-a-v1",
    });
    await inventory.stock.receive({
      operationId: "receive-new-box",
      occurredAt: time1,
      to: {
        itemId: "item-a",
        locationId: "store",
        lotId: "new-lot",
        statusId: "usable",
      },
      amount: packageAmount(1, "item-a-box-24-v1"),
      itemRevisionId: "item-a-v2",
    });
    await inventory.stock.receive({
      operationId: "receive-new-loose",
      occurredAt: time2,
      to: {
        itemId: "item-a",
        locationId: "store",
        lotId: "new-lot",
        statusId: "usable",
      },
      amount: stockAmount("3", "piece"),
      itemRevisionId: "item-a-v2",
    });

    const summary = await inventory.read.summary(
      inventoryStockSelector("item-a", { locationIds: ["store"] })
    );
    expect(
      summary.revisions.map((revision) => revision.itemRevisionId)
    ).toEqual(["item-a-v1", "item-a-v2"]);
    expect(
      summary.revisions.map((revision) => primaryMinor(revision.total))
    ).toEqual([40, 27]);

    const current = summary.revisions[1];
    if (current === undefined)
      throw new Error("Current item revision summary disappeared.");
    expect(
      current.byLot.map((bucket) => [
        bucket.valueId,
        primaryMinor(bucket.measurements),
      ])
    ).toEqual([["new-lot", 27]]);
    expect(
      current.byPackagingRevision.map((bucket) => [
        bucket.valueId ?? "loose",
        primaryMinor(bucket.measurements),
      ])
    ).toEqual([
      ["item-a-box-24-v1", 24],
      ["loose", 3],
    ]);
    expect(
      current.byStatus.map((bucket) => [
        bucket.valueId,
        primaryMinor(bucket.measurements),
      ])
    ).toEqual([["usable", 27]]);
    expect(
      current.byLocation.map((bucket) => [
        bucket.valueId,
        primaryMinor(bucket.measurements),
      ])
    ).toEqual([["store", 27]]);
  });

  it("reports signed net, positive physical stock, and deficit separately", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "read-model-record-deficit",
      occurredAt: time0,
      from: {
        itemId: "item-a",
        locationId: "store",
        lotId: "__untracked__",
      },
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receive({
      operationId: "read-model-positive-lot",
      occurredAt: time1,
      to: { itemId: "item-a", locationId: "store", lotId: "POSITIVE" },
      amount: stockAmount("10", "piece"),
    });

    const summary = await inventory.read.summary(
      inventoryStockSelector("item-a", { locationIds: ["store"] })
    );
    const revision = summary.revisions[0];
    if (revision === undefined) throw new Error("Missing deficit revision.");
    expect(primaryMinor(revision.total)).toBe(5);
    expect(primaryMinor(revision.physicalOnHand)).toBe(10);
    expect(primaryMinor(revision.deficit)).toBe(5);
    expect(
      revision.byLot.map((bucket) => [
        bucket.valueId,
        primaryMinor(bucket.measurements),
      ])
    ).toEqual([
      // Read-model output uses locale-independent UTF-16 code-unit identity ordering.
      ["POSITIVE", 10],
      ["__untracked__", -5],
    ]);
  });

  it("finds committed events by operation identity without application-side index traversal", async () => {
    const inventory = createTestInventory();
    const received = await inventory.stock.receive({
      operationId: "read-event-by-operation",
      occurredAt: time0,
      to: { itemId: "item-a", locationId: "store" },
      amount: stockAmount("1", "piece"),
    });
    const world = await inventory.read.world();
    expect(
      findInventoryEventByOperationId(
        world.projection,
        "read-event-by-operation"
      )
    ).toEqual(received.event);
    expect(
      findInventoryEventByOperationId(world.projection, "missing-operation")
    ).toBeUndefined();
    expect(() =>
      findInventoryEventByOperationId(
        {
          ...world.projection,
          eventIdByOperationId: {
            ...world.projection.eventIdByOperationId,
            broken: "missing-event",
          },
        },
        "broken"
      )
    ).toThrow("references missing event");
    expect(() =>
      findInventoryEventByOperationId(
        {
          ...world.projection,
          eventIdByOperationId: {
            ...world.projection.eventIdByOperationId,
            mismatched: received.event.eventId,
          },
        },
        "mismatched"
      )
    ).toThrow("points to event for");
  });

  it("lists exact retained package revisions instead of treating a human unit word as identity", async () => {
    const inventory = createTestInventory();
    const all = await inventory.read.packagingRevisions({ itemId: "item-a" });
    expect(
      all.map((packaging) => [packaging.packageUnit, packaging.revisionId])
    ).toEqual([
      ["box", "item-a-box-20-v1"],
      ["box", "item-a-box-24-v1"],
    ]);

    const current = await inventory.read.packagingRevisions({
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
    });
    expect(current.map((packaging) => packaging.revisionId)).toEqual([
      "item-a-box-24-v1",
    ]);
  });

  it("returns a schema-correct zero summary for an active revision with no matching physical stock", async () => {
    const inventory = createTestInventory();
    const summary = await inventory.read.summary(
      inventoryStockSelector("item-a", { locationIds: ["empty-store"] })
    );
    expect(summary.revisions).toHaveLength(1);
    const revision = summary.revisions[0];
    if (revision === undefined) throw new Error("Missing zero-stock revision.");
    expect(revision.itemRevisionId).toBe("item-a-v2");
    expect(primaryMinor(revision.total)).toBe(0);
    expect(revision.positions).toEqual([]);
  });
});
