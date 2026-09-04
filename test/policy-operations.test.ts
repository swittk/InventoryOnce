import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryAmountKind,
  InventoryDeficitPolicy,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  inventoryStockSelector,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Future expiry later than every test occurrence time. */
const laterExpiry = "2027-06-01T00:00:00.000Z";
/** Future expiry earlier than `laterExpiry`. */
const earlierExpiry = "2027-01-01T00:00:00.000Z";
/** Expiry between time0 and time1. */
const alreadyExpiredAtTime1 = "2026-08-24T08:30:00.000Z";

/** Return current scalar stock by lot for one location. */
async function quantityByLot(
  inventory: ReturnType<typeof createTestInventory>,
  locationId: string
): Promise<Readonly<Record<string, number>>> {
  const positions = await inventory.read.positions({
    itemId: "item-a",
    itemRevisionIds: ["item-a-v2"],
    locationIds: [locationId],
  });
  const result: Record<string, number> = {};
  for (const position of positions) {
    result[position.key.lotId ?? "no-lot"] =
      position.measurements.primary.quantity.amountMinor;
  }
  return result;
}

describe("native FIFO/FEFO movement policy", () => {
  it("previews and atomically issues FEFO across exact lots", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-late-expiry",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "LOT-LATE" }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAt: laterExpiry },
    });
    await inventory.stock.receive({
      operationId: "receive-early-expiry",
      occurredAt: time1,
      to: loosePosition("store", { lotId: "LOT-EARLY" }),
      amount: stockAmount("2", "piece"),
      lot: { expiresAt: earlierExpiry },
    });

    const request = {
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        locationIds: ["store"],
      }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fefo,
      at: time2,
    };
    const preview = await inventory.read.planAllocation(request);
    expect(preview.shortfall.amountMinor).toBe(0);
    expect(
      preview.lines.map(
        /** Preserve FEFO selection order from the read planner. */
        (line) => [line.position.lotId, line.allocatedPrimary.amountMinor]
      )
    ).toEqual([
      ["LOT-EARLY", 2],
      ["LOT-LATE", 1],
    ]);

    const command = {
      operationId: "issue-fefo-three",
      occurredAt: time2,
      selector: request.selector,
      amount: request.amount,
      method: request.method,
      reason: "Dispensed under normal FEFO policy.",
    };
    const issued = await inventory.stock.issueByPolicy(command);
    const replayed = await inventory.stock.issueByPolicy(command);
    expect(issued.event.stockEffects).toHaveLength(2);
    expect(replayed.replayed).toBe(true);
    expect(await quantityByLot(inventory, "store")).toEqual({ "LOT-LATE": 4 });
    await expect(
      inventory.stock.issueByPolicy({
        ...command,
        amount: stockAmount("2", "piece"),
      })
    ).rejects.toThrow("changed intent");
  });

  it("burdens positive lots with recorded location deficit before allocation", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "record-missing-receipt-deficit",
      occurredAt: time0,
      from: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-positive-lot-after-deficit",
      occurredAt: time1,
      to: loosePosition("store", { lotId: "POSITIVE-LOT" }),
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-other-location",
      occurredAt: time1,
      to: loosePosition("room", { lotId: "ROOM-LOT" }),
      amount: stockAmount("7", "piece"),
    });

    const storePlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["store"],
        lotIds: ["POSITIVE-LOT"],
      }),
      amount: stockAmount("10", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    });
    expect(storePlan.recordedDeficit.amountMinor).toBe(5);
    expect(storePlan.uncoveredDeficit.amountMinor).toBe(0);
    expect(storePlan.lines).toHaveLength(1);
    expect(storePlan.lines[0]?.allocatedPrimary.amountMinor).toBe(5);
    expect(storePlan.shortfall.amountMinor).toBe(5);
    expect(storePlan.shortfallAmount).toEqual(stockAmount("5", "piece"));

    const roomPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["room"],
      }),
      amount: stockAmount("7", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    });
    expect(roomPlan.recordedDeficit.amountMinor).toBe(0);
    expect(roomPlan.shortfall.amountMinor).toBe(0);
    expect(roomPlan.lines[0]?.allocatedPrimary.amountMinor).toBe(7);
  });

  it("records policy Issue shortfall durably without making deficit allocatable", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.receive({
      operationId: "receive-before-recorded-policy-shortfall",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "ONLY-THREE" }),
      amount: stockAmount("3", "piece"),
    });
    const command = {
      operationId: "record-policy-shortfall",
      occurredAt: time1,
      selector: inventoryStockSelector("item-a", {
        locationIds: ["store"],
      }),
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
    };

    const issued = await inventory.stock.issueByPolicy(command);
    const replayed = await inventory.stock.issueByPolicy(command);

    expect(issued.event.stockEffects).toHaveLength(2);
    expect(issued.event.metadata?.inventoryOncePolicyDeficit).toMatchObject({
      version: 1,
    });
    expect(replayed.replayed).toBe(true);
    expect(await quantityByLot(inventory, "store")).toEqual({
      __inventory_deficit__: -2,
    });

    await inventory.stock.receive({
      operationId: "receive-after-recorded-policy-shortfall",
      occurredAt: time2,
      to: loosePosition("store", { lotId: "LATER-RECEIPT" }),
      amount: stockAmount("4", "piece"),
    });
    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["store"],
        lotIds: ["LATER-RECEIPT"],
      }),
      amount: stockAmount("4", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time3,
    });
    expect(preview.recordedDeficit.amountMinor).toBe(2);
    expect(preview.lines[0]?.allocatedPrimary.amountMinor).toBe(2);
    expect(preview.shortfall.amountMinor).toBe(2);
  });

  it("assigns one recorded deficit across the whole location pool before exact-lot selection", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    const broadSelector = inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      locationIds: ["store"],
    });
    await inventory.stock.issueByPolicy({
      operationId: "record-five-piece-location-deficit",
      occurredAt: time0,
      selector: broadSelector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.receive({
      operationId: "receive-four-piece-first-lot",
      occurredAt: time1,
      to: loosePosition("store", { lotId: "LOT-FIRST" }),
      amount: stockAmount("4", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-six-piece-second-lot",
      occurredAt: time2,
      to: loosePosition("store", { lotId: "LOT-SECOND" }),
      amount: stockAmount("6", "piece"),
    });

    const firstLotPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        locationIds: ["store"],
        lotIds: ["LOT-FIRST"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time3,
    });
    expect(firstLotPlan.lines).toHaveLength(0);
    expect(firstLotPlan.shortfall.amountMinor).toBe(1);

    const secondLotPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        locationIds: ["store"],
        lotIds: ["LOT-SECOND"],
      }),
      amount: stockAmount("6", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time3,
    });
    expect(
      secondLotPlan.lines.map(
        /** The first lot pays four deficit pieces; the second pays only the remaining one. */
        (line) => [line.position.lotId, line.allocatedPrimary.amountMinor]
      )
    ).toEqual([["LOT-SECOND", 5]]);
    expect(secondLotPlan.shortfall.amountMinor).toBe(1);
    expect(secondLotPlan.recordedDeficit.amountMinor).toBe(5);
    expect(secondLotPlan.uncoveredDeficit.amountMinor).toBe(0);
  });

  it("keeps non-stock policy ambiguity blocked under Record mode", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.receive({
      operationId: "receive-package-before-record-mode",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "INTACT-PACKAGE" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
    });
    await expect(
      inventory.stock.issueByPolicy({
        operationId: "do-not-record-package-split-as-deficit",
        occurredAt: time1,
        selector: inventoryStockSelector("item-a", {
          locationIds: ["store"],
        }),
        amount: stockAmount("5", "piece"),
        method: InventoryAllocationMethod.Fifo,
      })
    ).rejects.toThrow("intact package/serial increments");
    expect(await quantityByLot(inventory, "store")).toEqual({
      "INTACT-PACKAGE": 24,
    });
  });

  it("orders equal-expiry/unknown lots by current positive-layer FIFO time", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-old-layer",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "LOT-OLD" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-new-layer",
      occurredAt: time1,
      to: loosePosition("store", { lotId: "LOT-NEW" }),
      amount: stockAmount("1", "piece"),
    });
    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", { locationIds: ["store"] }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    });
    expect(preview.lines[0]?.position.lotId).toBe("LOT-OLD");
    expect(preview.lines[0]?.layerStartedAt).toBe(time0);
  });

  it("fails closed on expired-only stock unless the caller explicitly opts in", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-expired-lot",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "LOT-EXPIRED" }),
      amount: stockAmount("1", "piece"),
      lot: { expiresAt: alreadyExpiredAtTime1 },
    });
    const selector = inventoryStockSelector("item-a", {
      locationIds: ["store"],
    });
    const preview = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      at: time1,
    });
    expect(preview.expiredStockWasExcluded).toBe(true);
    expect(preview.shortfall.amountMinor).toBe(1);
    await expect(
      inventory.stock.issueByPolicy({
        operationId: "reject-expired-policy",
        occurredAt: time1,
        selector,
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fefo,
      })
    ).rejects.toThrow("excluding expired stock");

    await inventory.stock.issueByPolicy({
      operationId: "allow-expired-policy",
      occurredAt: time1,
      selector,
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      allowExpiredLots: true,
      reason: "Emergency use explicitly approved.",
    });
    expect(await quantityByLot(inventory, "store")).toEqual({});
  });

  it("preserves intact package increments instead of silently unpacking", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-box-24",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "BOX-LOT" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
    });
    const selector = inventoryStockSelector("item-a", {
      locationIds: ["store"],
    });
    const blocked = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time1,
    });
    expect(blocked.incrementBlockedStock).toBe(true);
    expect(blocked.shortfall.amountMinor).toBe(5);

    const whole = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("24", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time1,
    });
    expect(whole.lines[0]?.amount).toMatchObject({
      kind: InventoryAmountKind.Package,
      count: 1,
      packagingRevisionId: "item-a-box-24-v1",
    });
  });

  it("keeps repeated intact-package allocations packaged in one batch event", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-two-batch-packages",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "BATCH-PACKAGES" }),
      amount: packageAmount(2, "item-a-box-24-v1"),
    });
    const command = {
      operationId: "issue-two-batch-packages",
      occurredAt: time1,
      requests: [
        {
          requestId: "first-package",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("24", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "second-package",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("24", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
      ],
    };

    const issued = await inventory.stock.issueManyByPolicy(command);
    const replayed = await inventory.stock.issueManyByPolicy(command);

    expect(issued.event.stockEffects).toHaveLength(1);
    expect(issued.event.stockEffects[0]?.position.packagingRevisionId).toBe(
      "item-a-box-24-v1"
    );
    expect(
      issued.allocations.map((allocation) => allocation.lines[0]?.amount)
    ).toEqual([
      expect.objectContaining({
        kind: InventoryAmountKind.Package,
        count: 1,
        packagingRevisionId: "item-a-box-24-v1",
      }),
      expect.objectContaining({
        kind: InventoryAmountKind.Package,
        count: 1,
        packagingRevisionId: "item-a-box-24-v1",
      }),
    ]);
    expect(replayed.replayed).toBe(true);
    expect(replayed.allocations).toEqual(issued.allocations);
    expect(await quantityByLot(inventory, "store")).toEqual({});
  });

  it("records per-request batch shortfall and replays its exact deficit evidence", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.receive({
      operationId: "receive-before-record-batch",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "BATCH-THREE" }),
      amount: stockAmount("3", "piece"),
    });
    const command = {
      operationId: "record-batch-shortfall",
      occurredAt: time1,
      requests: [
        {
          requestId: "first-five",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("5", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "then-one",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("1", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
      ],
    };

    const issued = await inventory.stock.issueManyByPolicy(command);
    const replayed = await inventory.stock.issueManyByPolicy(command);

    expect(issued.event.stockEffects).toHaveLength(2);
    expect(issued.allocations).toMatchObject([
      {
        requestId: "first-five",
        lines: [{ allocatedPrimary: { amountMinor: 3 } }],
        deficit: {
          primary: { amountMinor: 2 },
          position: { lotId: "__inventory_deficit__" },
        },
      },
      {
        requestId: "then-one",
        lines: [],
        deficit: {
          primary: { amountMinor: 1 },
          position: { lotId: "__inventory_deficit__" },
        },
      },
    ]);
    expect(replayed.replayed).toBe(true);
    expect(replayed.allocations).toEqual(issued.allocations);
    expect(await quantityByLot(inventory, "store")).toEqual({
      __inventory_deficit__: -3,
    });
  });

  it("rejects a later batch shortfall without publishing earlier request effects", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-batch-atomicity",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "BATCH-ATOMIC" }),
      amount: stockAmount("5", "piece"),
    });

    await expect(
      inventory.stock.issueManyByPolicy({
        operationId: "issue-batch-too-large",
        occurredAt: time1,
        requests: [
          {
            requestId: "first",
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
          {
            requestId: "second",
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount("4", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
        ],
      })
    ).rejects.toThrow("shortfall");

    expect(await quantityByLot(inventory, "store")).toEqual({
      "BATCH-ATOMIC": 5,
    });
  });

  it("groups repeated positions while replaying exact per-request allocations", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-batch-replay",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "BATCH-REPLAY" }),
      amount: stockAmount("5", "piece"),
    });
    const command = {
      operationId: "issue-batch-replay",
      occurredAt: time1,
      requests: [
        {
          requestId: "line-a",
          groupId: "prescription-line",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("2", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "line-b",
          groupId: "prescription-line",
          selector: inventoryStockSelector("item-a", {
            locationIds: ["store"],
          }),
          amount: stockAmount("2", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
      ],
    };

    const issued = await inventory.stock.issueManyByPolicy(command);
    const replayed = await inventory.stock.issueManyByPolicy(command);

    expect(issued.event.stockEffects).toHaveLength(1);
    expect(
      issued.allocations.map((allocation) => [
        allocation.requestId,
        allocation.lines[0]?.position.locationId,
        allocation.lines[0]?.position.lotId,
        allocation.lines[0]?.allocatedPrimary.amountMinor,
      ])
    ).toEqual([
      ["line-a", "store", "BATCH-REPLAY", 2],
      ["line-b", "store", "BATCH-REPLAY", 2],
    ]);
    expect(issued.allocationGroups).toEqual([
      {
        groupId: "prescription-line",
        requestIds: ["line-a", "line-b"],
        lines: [
          issued.allocations[0]?.lines[0],
          issued.allocations[1]?.lines[0],
        ],
      },
    ]);
    expect(replayed.replayed).toBe(true);
    expect(replayed.allocations).toEqual(issued.allocations);
    expect(replayed.allocationGroups).toEqual(issued.allocationGroups);
    expect(await quantityByLot(inventory, "store")).toEqual({
      "BATCH-REPLAY": 1,
    });
    await expect(
      inventory.stock.issueManyByPolicy({
        ...command,
        requests: command.requests.map(
          /** Change only the second request so retry-intent comparison must reject it. */
          (request, index) =>
            index === 1
              ? { ...request, amount: stockAmount("1", "piece") }
              : request
        ),
      })
    ).rejects.toThrow("changed intent");
    await expect(
      inventory.stock.issueManyByPolicy({
        ...command,
        requests: command.requests.map(
          /** A changed result group is changed durable replay intent too. */
          (request, index) =>
            index === 1 ? { ...request, groupId: "another-line" } : request
        ),
      })
    ).rejects.toThrow("changed intent");
  });

  it("transfers one-location policy selections as one conserved event", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-transfer-lots",
      occurredAt: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "T1" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAt: earlierExpiry },
        },
        {
          to: loosePosition("store", { lotId: "T2" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAt: laterExpiry },
        },
      ],
    });
    const moved = await inventory.stock.transferByPolicy({
      operationId: "transfer-fefo-three",
      occurredAt: time1,
      selector: inventoryStockSelector("item-a", { locationIds: ["store"] }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fefo,
      toLocationId: "room",
    });
    expect(moved.event.stockEffects).toHaveLength(4);
    expect(await quantityByLot(inventory, "store")).toEqual({ T2: 1 });
    expect(await quantityByLot(inventory, "room")).toEqual({ T1: 2, T2: 1 });
    await expect(
      inventory.stock.transferByPolicy({
        operationId: "bad-broad-transfer",
        occurredAt: time2,
        selector: inventoryStockSelector("item-a"),
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
        toLocationId: "elsewhere",
      })
    ).rejects.toThrow("exactly one source location");
  });
});

describe("native policy and reservation safety", () => {
  it("keeps exact allocated stock out of normal policy picks", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-reserved-lot",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "RESERVED" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-free-lot",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "FREE" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-one",
      operationId: "reserve-one",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["RESERVED"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    const reservedPosition = (
      await inventory.read.positions({
        itemId: "item-a",
        lotIds: ["RESERVED"],
      })
    )[0];
    if (reservedPosition === undefined) {
      throw new Error("Reserved test position disappeared.");
    }
    await inventory.reservations.allocate({
      operationId: "allocate-one",
      reservationId: "claim-one",
      occurredAt: time1,
      allocations: [
        {
          position: reservedPosition.key,
          quantity: parseQuantity("1", "piece"),
        },
      ],
    });

    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", { locationIds: ["store"] }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    });
    expect(preview.shortfall.amountMinor).toBe(0);
    expect(
      preview.lines.map(
        /** Show that only one of the two reserved-lot pieces remained eligible. */
        (line) => [line.position.lotId, line.allocatedPrimary.amountMinor]
      )
    ).toEqual([
      ["FREE", 2],
      ["RESERVED", 1],
    ]);
  });

  it("allocates a broad claim by FEFO and consumes its exact allocation without UI-built lines", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-reservation-policy-lots",
      occurredAt: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "CLAIM-EARLY" }),
          amount: stockAmount("1", "piece"),
          lot: { expiresAt: earlierExpiry },
        },
        {
          to: loosePosition("store", { lotId: "CLAIM-LATE" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAt: laterExpiry },
        },
      ],
    });
    await inventory.reservations.reserve({
      reservationId: "claim-policy-two",
      operationId: "reserve-policy-two",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", locationIds: ["store"] },
      requested: parseQuantity("2", "piece"),
      createdAt: time1,
    });

    const allocationCommand = {
      operationId: "allocate-policy-two",
      reservationId: "claim-policy-two",
      occurredAt: time1,
      method: InventoryAllocationMethod.Fefo,
    };
    const allocated = await inventory.reservations.allocateByPolicy(
      allocationCommand
    );
    expect(
      allocated.reservation.allocations.map(
        /** Expose native FEFO lot selection without asking UI code to search positions. */
        (allocation) => [
          allocation.position.lotId,
          allocation.quantity.amountMinor,
        ]
      )
    ).toEqual([
      ["CLAIM-EARLY", 1],
      ["CLAIM-LATE", 1],
    ]);
    expect(
      (await inventory.reservations.allocateByPolicy(allocationCommand))
        .replayed
    ).toBe(true);

    const consumed = await inventory.reservations.consumeAllocated({
      operationId: "consume-policy-two",
      reservationId: "claim-policy-two",
      occurredAt: time2,
      reason: "The allocated stock was dispensed.",
    });
    expect(consumed.reservation.status).toBe(
      InventoryReservationStatus.Consumed
    );
    expect(consumed.event?.stockEffects).toHaveLength(2);
    expect(await quantityByLot(inventory, "store")).toEqual({
      "CLAIM-LATE": 1,
    });
    expect(
      (
        await inventory.reservations.consumeAllocated({
          operationId: "consume-policy-two",
          reservationId: "claim-policy-two",
          occurredAt: time2,
          reason: "The allocated stock was dispensed.",
        })
      ).replayed
    ).toBe(true);
  });

  it("treats stock use-by as reservation eligibility unless the claim explicitly permits expiry", async () => {
    let recordedAt = time1;
    const inventory = createTestInventory(undefined, undefined, {
      /** Let the test cross container use-by while preserving event-versus-record-time checks. */
      now: () => recordedAt,
    });
    await inventory.stock.receive({
      operationId: "receive-use-by-reservation-stock",
      occurredAt: time0,
      to: loosePosition("store", {
        lotId: "USE-BY-LOT",
        containerId: "USE-BY-CONTAINER",
      }),
      amount: stockAmount("1", "piece"),
      container: {
        containerType: "opened-vial",
        openedAt: time0,
        useBy: time2,
      },
    });
    await inventory.reservations.reserve({
      reservationId: "ordinary-use-by-claim",
      operationId: "reserve-before-use-by",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", containerIds: ["USE-BY-CONTAINER"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-before-use-by",
      reservationId: "ordinary-use-by-claim",
      occurredAt: time1,
      method: InventoryAllocationMethod.Fefo,
    });

    recordedAt = time3;
    expect((await inventory.read.reservationFeasibility(time3)).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
    await expect(
      inventory.reservations.consumeAllocated({
        operationId: "consume-after-use-by",
        reservationId: "ordinary-use-by-claim",
        occurredAt: time3,
      })
    ).rejects.toThrow("past its lot/container use-by");
    await inventory.reservations.release({
      operationId: "release-expired-backing-claim",
      reservationId: "ordinary-use-by-claim",
      occurredAt: time3,
    });

    await inventory.reservations.reserve({
      reservationId: "explicit-expired-claim",
      operationId: "reserve-expired-explicitly",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", containerIds: ["USE-BY-CONTAINER"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time3,
      allowExpiredStock: true,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-expired-explicitly",
      reservationId: "explicit-expired-claim",
      occurredAt: time3,
      method: InventoryAllocationMethod.Fefo,
    });
    await inventory.reservations.consumeAllocated({
      operationId: "consume-expired-explicitly",
      reservationId: "explicit-expired-claim",
      occurredAt: time3,
      reason: "Expired stock use was explicitly approved for this claim.",
    });
    expect(await quantityByLot(inventory, "store")).toEqual({});
  });

  it("lets explicit physical scrap reveal a shortage without pretending promises still fit", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-allocated-scrap",
      occurredAt: time0,
      to: loosePosition("store", { lotId: "DAMAGED" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-damaged",
      operationId: "reserve-damaged",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["DAMAGED"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    const damaged = (
      await inventory.read.positions({
        itemId: "item-a",
        lotIds: ["DAMAGED"],
      })
    )[0];
    if (damaged === undefined)
      throw new Error("Damaged test position disappeared.");
    await inventory.reservations.allocate({
      operationId: "allocate-damaged",
      reservationId: "claim-damaged",
      occurredAt: time1,
      allocations: [
        { position: damaged.key, quantity: parseQuantity("1", "piece") },
      ],
    });

    await expect(
      inventory.stock.scrapByPolicy({
        operationId: "scrap-protected-shortfall",
        occurredAt: time2,
        selector: inventoryStockSelector("item-a", { lotIds: ["DAMAGED"] }),
        amount: stockAmount("2", "piece"),
        method: InventoryAllocationMethod.Fifo,
        reason: "Both pieces were physically destroyed.",
      })
    ).rejects.toThrow("shortfall");

    await inventory.stock.scrapByPolicy({
      operationId: "scrap-allocated-physical-truth",
      occurredAt: time2,
      selector: inventoryStockSelector("item-a", { lotIds: ["DAMAGED"] }),
      amount: stockAmount("2", "piece"),
      method: InventoryAllocationMethod.Fifo,
      allowAllocatedStock: true,
      reason: "Both pieces were physically destroyed.",
    });
    const report = await inventory.read.reservationFeasibility(time2);
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Shortage);
    expect(report.groups[0]?.shortage.amountMinor).toBe(1);
  });
});
