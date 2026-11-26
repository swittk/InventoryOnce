import { describe, expect, it } from "vitest";
import {
  InventoryEventKind,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  inventoryStockSelector,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
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
  "TRACE-DIMENSION-RECLASSIFICATION-CONSERVATION",
] as const;

/** Read scalar current positions for one store in deterministic projection order. */
async function storePositions(
  inventory: ReturnType<typeof createTestInventory>
) {
  return inventory.read.positions(
    inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      placementNodeIds: ["store"],
    })
  );
}

describe("atomic conserved split/merge/reclassification", () => {
  it("conserves multiple individually storable postings above the running storage range", async () => {
    const inventory = createTestInventory();
    const amount = stockAmount(String(Number.MAX_SAFE_INTEGER), "piece");
    const first = loosePosition("a-first-source");
    const second = loosePosition("b-second-source");
    const firstDestination = loosePosition("y-first-destination");
    const secondDestination = loosePosition("z-second-destination");
    await inventory.stock.receive({ operationId: "receive-first-large-row", occurredAtEpochMs: time0, to: first, amount });
    await inventory.stock.receive({ operationId: "receive-second-large-row", occurredAtEpochMs: time0, to: second, amount });
    const moved = await inventory.stock.reclassifyMany({
      operationId: "reclassify-large-rows", occurredAtEpochMs: time1,
      consume: [{ from: first, amount }, { from: second, amount }],
      produce: [{ to: firstDestination, amount }, { to: secondDestination, amount }],
    });
    const balance = parseQuantity(String(Number.MAX_SAFE_INTEGER), "piece");
    const debit = parseQuantity(String(-Number.MAX_SAFE_INTEGER), "piece");
    expect(moved.event.stockEffects.map((effect) => effect.measurementsDelta.primary.quantity))
      .toEqual([debit, debit, balance, balance]);
    expect(await inventory.read.positions({ itemId: "item-a" })).toMatchObject([
      { key: firstDestination, measurements: { primary: { quantity: balance } } },
      { key: secondDestination, measurements: { primary: { quantity: balance } } },
    ]);
  });

  it("splits one stock position into explicit usable and quarantine positions atomically", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-splittable-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "SPLIT-LOT" }),
      amount: stockAmount("10", "piece"),
    });

    const splitCommand = {
      operationId: "split-status-buckets",
      occurredAtEpochMs: time1,
      consume: [
        {
          from: loosePosition("store", { lotId: "SPLIT-LOT" }),
          amount: stockAmount("10", "piece"),
        },
      ],
      produce: [
        {
          to: loosePosition("store", {
            lotId: "SPLIT-LOT",
            statusId: "usable",
          }),
          amount: stockAmount("6", "piece"),
        },
        {
          to: loosePosition("store", {
            lotId: "SPLIT-LOT",
            statusId: "quarantine",
          }),
          amount: stockAmount("4", "piece"),
        },
      ],
      reason: "Four pieces need inspection.",
    } as const;
    const split = await inventory.stock.reclassifyMany(splitCommand);
    expect(split.event.kind).toBe(InventoryEventKind.Reclassification);
    expect(split.event.stockEffects).toHaveLength(3);
    const summary = await inventory.read.summary({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v2"],
      placementNodeIds: ["store"],
    });
    expect(
      summary.revisions[0]?.byStatus.map(
        /** Show each explicit stock-status bucket and its exact quantity. */
        (bucket) => [
          bucket.valueId,
          bucket.measurements.primary.quantity.amountMinor,
        ]
      )
    ).toEqual([
      ["quarantine", 4],
      ["usable", 6],
    ]);
    expect(
      (
        await inventory.stock.reclassifyMany(splitCommand)
      ).replayed
    ).toBe(true);
  });

  it("merges several physical containers into one explicitly defined handling unit", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-merge-containers",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("C-1", {
            lotId: "MERGE-LOT",
          }),
          amount: stockAmount("3", "piece"),
          placementNode: { category: "tray" },
        },
        {
          to: loosePosition("C-2", {
            lotId: "MERGE-LOT",
          }),
          amount: stockAmount("2", "piece"),
          placementNode: { category: "tray" },
        },
      ],
    });
    await inventory.stock.reclassifyMany({
      operationId: "merge-containers",
      occurredAtEpochMs: time1,
      consume: [
        {
          from: loosePosition("C-1", {
            lotId: "MERGE-LOT",
          }),
          amount: stockAmount("3", "piece"),
        },
        {
          from: loosePosition("C-2", {
            lotId: "MERGE-LOT",
          }),
          amount: stockAmount("2", "piece"),
        },
      ],
      produce: [
        {
          to: loosePosition("C-3", {
            lotId: "MERGE-LOT",
          }),
          amount: stockAmount("5", "piece"),
          placementNode: {
            category: "procedure-kit",
            identifiers: { barcode: "KIT-003" },
          },
        },
      ],
      reason: "Two trays were consolidated into one kit.",
    });
    const positions = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["C-3"],
    });
    expect(positions).toHaveLength(1);
    expect(positions[0]?.key.placementNodeId).toBe("C-3");
    expect(positions[0]?.measurements.primary.quantity.amountMinor).toBe(5);
    expect((await inventory.read.placementNode("C-3"))?.definition).toMatchObject({
      category: "procedure-kit",
      identifiers: { barcode: "KIT-003" },
    });
  });

  it("relots stock explicitly and preserves both old and new lot masters", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-relot-source",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "OLD-LOT" }),
      amount: stockAmount("2", "piece"),
      lot: { expiresAtEpochMs: 1798761600000 },
    });
    await inventory.stock.reclassifyMany({
      operationId: "relot-after-supplier-confirmation",
      occurredAtEpochMs: time1,
      consume: [
        {
          from: loosePosition("store", { lotId: "OLD-LOT" }),
          amount: stockAmount("2", "piece"),
        },
      ],
      produce: [
        {
          to: loosePosition("store", { lotId: "CORRECT-LOT" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAtEpochMs: 1830297600000 },
        },
      ],
      reason: "Supplier confirmed the physical batch was relabelled.",
    });
    expect((await storePositions(inventory))[0]?.key.lotId).toBe("CORRECT-LOT");
    expect(await inventory.read.lot("item-a", "OLD-LOT")).toBeDefined();
    expect(
      (await inventory.read.lot("item-a", "CORRECT-LOT"))?.definition.expiresAtEpochMs
    ).toBe(1830297600000);
  });

  it("rejects non-conserved output before writing any durable operation", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog, clockAt(time3));
    await inventory.stock.receive({
      operationId: "receive-before-bad-reclassification",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BAD-LOT" }),
      amount: stockAmount("2", "piece"),
    });
    const revisionBefore = (await inventory.read.world()).revision;
    await expect(
      inventory.stock.reclassifyMany({
        operationId: "non-conserved-reclassification",
        occurredAtEpochMs: time1,
        consume: [
          {
            from: loosePosition("store", { lotId: "BAD-LOT" }),
            amount: stockAmount("2", "piece"),
          },
        ],
        produce: [
          {
            to: loosePosition("store", {
              lotId: "BAD-LOT",
              statusId: "quarantine",
            }),
            amount: stockAmount("3", "piece"),
          },
        ],
      })
    ).rejects.toThrow("does not conserve item revision");
    expect((await inventory.read.world()).revision).toBe(revisionBefore);
    expect(
      await storage.readOperation("non-conserved-reclassification")
    ).toBeUndefined();
  });

  it("cannot bypass explicit pack/unpack semantics through generic reclassification", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-packaged-before-bypass",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "PACK-LOT" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
    });
    await expect(
      inventory.stock.reclassifyMany({
        operationId: "attempt-package-bypass",
        occurredAtEpochMs: time1,
        consume: [
          {
            from: loosePosition("store", {
              lotId: "PACK-LOT",
              packagingRevisionId: "item-a-box-24-v1",
            }),
            amount: packageAmount(1, "item-a-box-24-v1"),
          },
        ],
        produce: [
          {
            to: loosePosition("store", { lotId: "PACK-LOT" }),
            amount: stockAmount("24", "piece"),
          },
        ],
      })
    ).rejects.toThrow("use pack/unpack instead");
  });

  it("records ordinary reclassification and retains exact reservations", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-reservation-reclassification",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "RESERVED-LOT" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "reclassification-claim",
      operationId: "reserve-before-reclassification",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["RESERVED-LOT"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const position = (await storePositions(inventory))[0];
    if (position === undefined) {
      throw new Error("Reservation reclassification position disappeared.");
    }
    await inventory.reservations.allocate({
      operationId: "allocate-before-reclassification",
      reservationId: "reclassification-claim",
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: position.key,
          quantity: parseQuantity("1", "piece"),
        },
      ],
    });
    await inventory.stock.reclassifyMany({
      operationId: "move-reserved-position",
      occurredAtEpochMs: time2,
      consume: [{
        from: loosePosition("store", { lotId: "RESERVED-LOT" }),
        amount: stockAmount("2", "piece"),
      }],
      produce: [{
        to: loosePosition("store", { lotId: "RESERVED-LOT", statusId: "quarantine" }),
        amount: stockAmount("2", "piece"),
      }],
    });
    expect(await storePositions(inventory)).toMatchObject([{
      key: { statusId: "quarantine" },
      measurements: { primary: { quantity: parseQuantity("2", "piece") } },
    }]);
    const reservation = await inventory.read.reservation("reclassification-claim");
    expect(reservation?.status).toBe(InventoryReservationStatus.Active);
    expect(reservation?.allocations).toEqual([{ position: position.key, quantity: parseQuantity("1", "piece") }]);
    expect(await inventory.read.reservationFeasibility(time2)).toMatchObject({
      status: InventoryReservationFeasibilityStatus.Shortage,
      groups: [{ reservationIds: ["reclassification-claim"], shortage: parseQuantity("1", "piece") }],
    });
  });
});
