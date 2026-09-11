import { describe, expect, it } from "vitest";
import {
  InventoryEventKind,
  inventoryStockSelector,
  stockAmount,
} from "../src/index.js";
import { inventoryLotIdentity } from "../src/kernel.js";
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
  "TRACE-LOT-METADATA-CORRECTION",
] as const;

/** Stable first expiry used by lot-master tests. */
const expiry1 = 1798761600000;
/** Stable corrected expiry used by lot-master tests. */
const expiry2 = 1801440000000;

/** Read the primary tablet total from one current revision summary. */
async function currentStoreQuantity(
  inventory: ReturnType<typeof createTestInventory>
): Promise<number> {
  const summary = await inventory.read.summary(
    inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      locationIds: ["store"],
    })
  );
  return summary.revisions[0]?.total.primary.quantity.amountMinor ?? 0;
}

describe("native item-scoped lot masters", () => {
  it("lets receipts establish/confirm metadata but rejects silent conflicting redefinition", async () => {
    const inventory = createTestInventory();
    const first = await inventory.stock.receive({
      operationId: "receive-lot-first",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-A" }),
      amount: stockAmount("2", "piece"),
      lot: { expiresAtEpochMs: expiry1, metadata: { supplierBatch: "A-1" } },
    });
    await inventory.stock.receive({
      operationId: "receive-lot-confirmation",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "LOT-A" }),
      amount: stockAmount("1", "piece"),
      lot: { expiresAtEpochMs: expiry1, metadata: { supplierBatch: "A-1" } },
    });

    expect(await inventory.read.lot("item-a", "LOT-A")).toMatchObject({
      definition: {
        itemId: "item-a",
        lotId: "LOT-A",
        expiresAtEpochMs: expiry1,
        metadata: { supplierBatch: "A-1" },
      },
      rootEventId: first.event.eventId,
      assertedByEventId: first.event.eventId,
    });
    expect(await currentStoreQuantity(inventory)).toBe(3);
    expect(
      (await inventory.read.world()).projection.lotIdentitiesByItemId["item-a"]
    ).toEqual([inventoryLotIdentity("item-a", "LOT-A")]);

    await expect(
      inventory.stock.receive({
        operationId: "receive-lot-conflict",
        occurredAtEpochMs: time2,
        to: loosePosition("store", { lotId: "LOT-A" }),
        amount: stockAmount("1", "piece"),
        lot: { expiresAtEpochMs: expiry2 },
      })
    ).rejects.toThrow("already has different metadata");
    expect(await currentStoreQuantity(inventory)).toBe(3);
  });

  it("corrects, omits, and restores lot metadata append-only without changing physical stock", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "receive-correctable-lot",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-B" }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAtEpochMs: expiry1 },
    });

    const corrected = await inventory.lots.correct({
      operationId: "correct-lot-expiry",
      occurredAtEpochMs: time1,
      itemId: "item-a",
      lotId: "LOT-B",
      lot: { expiresAtEpochMs: expiry2 },
      reason: "The supplier label was rechecked.",
    });
    expect(corrected.event.kind).toBe(InventoryEventKind.Correction);
    expect(corrected.event.correction?.correctsEventId).toBe(
      root.event.eventId
    );
    expect(
      (await inventory.read.lot("item-a", "LOT-B"))?.definition.expiresAtEpochMs
    ).toBe(expiry2);
    expect(await currentStoreQuantity(inventory)).toBe(5);

    const replay = await inventory.lots.correct({
      operationId: "correct-lot-expiry",
      occurredAtEpochMs: time1,
      itemId: "item-a",
      lotId: "LOT-B",
      lot: { expiresAtEpochMs: expiry2 },
      reason: "The supplier label was rechecked.",
    });
    expect(replay.replayed).toBe(true);

    await inventory.lots.correct({
      operationId: "omit-wrong-lot-master",
      occurredAtEpochMs: time2,
      itemId: "item-a",
      lotId: "LOT-B",
      reason: "This shipment never supplied lot metadata.",
    });
    expect(await inventory.read.lot("item-a", "LOT-B")).toBeUndefined();
    expect(
      (await inventory.read.world()).projection.lotIdentitiesByItemId["item-a"]
    ).toBeUndefined();
    expect(await currentStoreQuantity(inventory)).toBe(5);

    await expect(
      inventory.lots.define({
        operationId: "cannot-redefine-omitted-lot",
        occurredAtEpochMs: time2,
        itemId: "item-a",
        lotId: "LOT-B",
        lot: { expiresAtEpochMs: expiry1 },
      })
    ).rejects.toThrow("removed by correction");

    await inventory.lots.correct({
      operationId: "restore-lot-master",
      occurredAtEpochMs: time3,
      itemId: "item-a",
      lotId: "LOT-B",
      lot: { expiresAtEpochMs: expiry1 },
      reason: "The original supplier document was found.",
    });
    expect(
      (await inventory.read.lot("item-a", "LOT-B"))?.definition.expiresAtEpochMs
    ).toBe(expiry1);
    expect(await currentStoreQuantity(inventory)).toBe(5);
    const restoredWorld = await inventory.read.world();
    expect(restoredWorld.projection.lotIdentitiesByItemId["item-a"]).toEqual([
      inventoryLotIdentity("item-a", "LOT-B"),
    ]);
    expect(Object.values(restoredWorld.projection.events)).toHaveLength(4);
  });

  it("supports a standalone lot master and deterministic item-filtered lot reads", async () => {
    const inventory = createTestInventory();
    const defined = await inventory.lots.define({
      operationId: "define-lot-c",
      occurredAtEpochMs: time0,
      itemId: "item-a",
      lotId: "LOT-C",
      lot: { manufacturedAtEpochMs: time0, expiresAtEpochMs: expiry1 },
    });
    expect(defined.event.kind).toBe(InventoryEventKind.LotMetadata);

    await inventory.stock.receive({
      operationId: "receive-lot-c",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "LOT-C" }),
      amount: stockAmount("1", "piece"),
      lot: { manufacturedAtEpochMs: time0, expiresAtEpochMs: expiry1 },
    });
    expect(
      (await inventory.read.lots("item-a")).map(
        /** Return deterministic lot identities from the public current-lot read. */
        (projected) => projected.definition.lotId
      )
    ).toEqual(["LOT-C"]);
    expect(
      (await inventory.read.world()).projection.lotIdentitiesByItemId["item-a"]
    ).toEqual([inventoryLotIdentity("item-a", "LOT-C")]);
  });

  it("carries legacy lot metadata through reviewed whole-plan migration", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "legacy-lot-opening",
        sourceSystem: "legacy-stock",
        cutoverAtEpochMs: time0,
        openingStock: [
          {
            openingId: "legacy-lot-row",
            position: loosePosition("store", { lotId: "LEGACY-LOT" }),
            amount: stockAmount("4", "piece"),
            itemRevisionId: "item-a-v2",
            lot: { expiresAtEpochMs: expiry1 },
            source: { sourceType: "InventoryLotBalance", sourceId: "row-1" },
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
      (await inventory.read.lot("item-a", "LEGACY-LOT"))?.definition.expiresAtEpochMs
    ).toBe(expiry1);
    expect(await currentStoreQuantity(inventory)).toBe(4);
  });
});
