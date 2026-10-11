import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryAmountKind,
  InventoryDeficitPolicy,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryReservationFeasibilityStatus,
  InventoryTrackingRequirement,
  InventoryReservationStatus,
  defineInventoryCatalog,
  inventoryStockSelector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  stockAmount,
  unitCode,
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
const laterExpiry = 1811808000000;
/** Future expiry earlier than `laterExpiry`. */
const earlierExpiry = 1798761600000;
/** Expiry between time0 and time1. */
const alreadyExpiredAtTime1 = 1787560200000;

/** Return current scalar stock by lot for one location. */
async function quantityByLot(
  inventory: ReturnType<typeof createTestInventory>,
  placementNodeId: string
): Promise<Readonly<Record<string, number>>> {
  const positions = await inventory.read.positions({
    itemId: "item-a",
    itemRevisionIds: ["item-a-v2"],
    placementNodeIds: [placementNodeId],
  });
  const result: Record<string, number> = {};
  for (const position of positions) {
    const lotId = position.key.lotId ?? "no-lot";
    result[lotId] =
      (result[lotId] ?? 0) + position.measurements.primary.quantity.amountMinor;
  }
  return result;
}

describe("native FIFO/FEFO movement policy", () => {
  it("previews and atomically issues FEFO across exact lots", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-late-expiry",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-LATE" }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAtEpochMs: laterExpiry },
    });
    await inventory.stock.receive({
      operationId: "receive-early-expiry",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "LOT-EARLY" }),
      amount: stockAmount("2", "piece"),
      lot: { expiresAtEpochMs: earlierExpiry },
    });

    const request = {
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
      }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fefo,
      atEpochMs: time2,
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
      occurredAtEpochMs: time2,
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
      occurredAtEpochMs: time0,
      from: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-positive-lot-after-deficit",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "POSITIVE-LOT" }),
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-other-location",
      occurredAtEpochMs: time1,
      to: loosePosition("room", { lotId: "ROOM-LOT" }),
      amount: stockAmount("7", "piece"),
    });

    const storePlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        placementNodeIds: ["store"],
        lotIds: ["POSITIVE-LOT"],
      }),
      amount: stockAmount("10", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
    });
    expect(storePlan.recordedDeficit.amountMinor).toBe(5);
    expect(storePlan.uncoveredDeficit.amountMinor).toBe(0);
    expect(storePlan.lines).toHaveLength(1);
    expect(storePlan.lines[0]?.allocatedPrimary.amountMinor).toBe(5);
    expect(storePlan.shortfall.amountMinor).toBe(5);
    expect(storePlan.shortfallAmount).toEqual(stockAmount("5", "piece"));

    const roomPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        placementNodeIds: ["room"],
      }),
      amount: stockAmount("7", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "ONLY-THREE" }),
      amount: stockAmount("3", "piece"),
    });
    const command = {
      operationId: "record-policy-shortfall",
      occurredAtEpochMs: time1,
      selector: inventoryStockSelector("item-a", {
        placementNodeIds: ["store"],
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
      occurredAtEpochMs: time2,
      to: loosePosition("store", { lotId: "LATER-RECEIPT" }),
      amount: stockAmount("4", "piece"),
    });
    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        placementNodeIds: ["store"],
        lotIds: ["LATER-RECEIPT"],
      }),
      amount: stockAmount("4", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time3,
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
      placementNodeIds: ["store"],
    });
    await inventory.stock.issueByPolicy({
      operationId: "record-five-piece-location-deficit",
      occurredAtEpochMs: time0,
      selector: broadSelector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.receive({
      operationId: "receive-four-piece-first-lot",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "LOT-FIRST" }),
      amount: stockAmount("4", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-six-piece-second-lot",
      occurredAtEpochMs: time2,
      to: loosePosition("store", { lotId: "LOT-SECOND" }),
      amount: stockAmount("6", "piece"),
    });

    const firstLotPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
        lotIds: ["LOT-FIRST"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time3,
    });
    expect(firstLotPlan.lines).toHaveLength(0);
    expect(firstLotPlan.shortfall.amountMinor).toBe(1);

    const secondLotPlan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
        lotIds: ["LOT-SECOND"],
      }),
      amount: stockAmount("6", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time3,
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "INTACT-PACKAGE" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
    });
    await expect(
      inventory.stock.issueByPolicy({
        operationId: "do-not-record-package-split-as-deficit",
        occurredAtEpochMs: time1,
        selector: inventoryStockSelector("item-a", {
          placementNodeIds: ["store"],
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-OLD" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-new-layer",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "LOT-NEW" }),
      amount: stockAmount("1", "piece"),
    });
    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"] }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
    });
    expect(preview.lines[0]?.position.lotId).toBe("LOT-OLD");
    expect(preview.lines[0]?.layerStartedAtEpochMs).toBe(time0);
  });

  it("fails closed on expired-only stock unless the caller explicitly opts in", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-expired-lot",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-EXPIRED" }),
      amount: stockAmount("1", "piece"),
      lot: { expiresAtEpochMs: alreadyExpiredAtTime1 },
    });
    const selector = inventoryStockSelector("item-a", {
      placementNodeIds: ["store"],
    });
    const preview = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      atEpochMs: time1,
    });
    expect(preview.expiredStockWasExcluded).toBe(true);
    expect(preview.shortfall.amountMinor).toBe(1);
    await expect(
      inventory.stock.issueByPolicy({
        operationId: "reject-expired-policy",
        occurredAtEpochMs: time1,
        selector,
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fefo,
      })
    ).rejects.toThrow("excluding expired stock");

    await inventory.stock.issueByPolicy({
      operationId: "allow-expired-policy",
      occurredAtEpochMs: time1,
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BOX-LOT" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
    });
    const selector = inventoryStockSelector("item-a", {
      placementNodeIds: ["store"],
    });
    const blocked = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time1,
    });
    expect(blocked.incrementBlockedStock).toBe(true);
    expect(blocked.shortfall.amountMinor).toBe(5);

    const whole = await inventory.read.planAllocation({
      selector,
      amount: stockAmount("24", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time1,
    });
    expect(whole.lines[0]?.amount).toMatchObject({
      kind: InventoryAmountKind.Package,
      count: 1,
      packagingRevisionId: "item-a-box-24-v1",
    });
  });

  it("does not split a packaged position with unfixed independent measurement", async () => {
    const catalog = defineInventoryCatalog({
      itemRevisions: [{
        itemId: "measured-package-item",
        revisionId: "measured-package-item-v1",
        primaryAxis: {
          axisId: "pieces",
          role: InventoryMeasurementAxisRole.Primary,
          unit: unitCode("piece"),
          requirement: InventoryMeasurementRequirement.Required,
        },
        independentAxes: [{
          axisId: "weight",
          role: InventoryMeasurementAxisRole.Independent,
          unit: unitCode("kg"),
          requirement: InventoryMeasurementRequirement.Optional,
        }],
        reservationAxisId: "pieces",
        tracking: {
          lot: InventoryTrackingRequirement.Optional,
          serial: InventoryTrackingRequirement.Optional,
        },
        qualifiedDimensions: [],
      }],
      activeItemRevisionIds: {
        "measured-package-item": "measured-package-item-v1",
      },
      packagingRevisions: [{
        revisionId: "measured-package-box-v1",
        itemId: "measured-package-item",
        itemRevisionId: "measured-package-item-v1",
        packageUnit: unitCode("box"),
        fixedContents: {
          primary: {
            axisId: "pieces",
            quantity: parseQuantity("24", "piece"),
          },
          independent: [],
        },
      }],
    });
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({
      operationId: "receive-two-measured-packages",
      occurredAtEpochMs: time0,
      to: { itemId: "measured-package-item", placementNodeId: "store" },
      amount: packageAmount(2, "measured-package-box-v1", [
        { axisId: "weight", value: "3", unit: "kg" },
      ]),
    });

    const blocked = await inventory.read.planAllocation({
      selector: inventoryStockSelector("measured-package-item", {
        placementNodeIds: ["store"],
      }),
      amount: packageAmount(1, "measured-package-box-v1"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time1,
    });

    expect(blocked.lines).toEqual([]);
    expect(blocked.incrementBlockedStock).toBe(true);
    expect(blocked.shortfall.amountMinor).toBe(24);

    const looseInventory = createTestInventory(undefined, catalog);
    await looseInventory.stock.receive({
      operationId: "receive-loose-measured-position",
      occurredAtEpochMs: time0,
      to: { itemId: "measured-package-item", placementNodeId: "store" },
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "3", unit: "kg" },
      ]),
    });
    const looseBlocked = await looseInventory.read.planAllocation({
      selector: inventoryStockSelector("measured-package-item", {
        placementNodeIds: ["store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time1,
    });
    expect(looseBlocked.lines).toEqual([]);
    expect(looseBlocked.incrementBlockedStock).toBe(true);
    expect(looseBlocked.shortfall.amountMinor).toBe(1);
  });

  it("keeps repeated intact-package allocations packaged in one batch event", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-two-batch-packages",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BATCH-PACKAGES" }),
      amount: packageAmount(2, "item-a-box-24-v1"),
    });
    const command = {
      operationId: "issue-two-batch-packages",
      occurredAtEpochMs: time1,
      requests: [
        {
          requestId: "first-package",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
          }),
          amount: stockAmount("24", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "second-package",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BATCH-THREE" }),
      amount: stockAmount("3", "piece"),
    });
    const command = {
      operationId: "record-batch-shortfall",
      occurredAtEpochMs: time1,
      requests: [
        {
          requestId: "first-five",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
          }),
          amount: stockAmount("5", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "then-one",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BATCH-ATOMIC" }),
      amount: stockAmount("5", "piece"),
    });

    await expect(
      inventory.stock.issueManyByPolicy({
        operationId: "issue-batch-too-large",
        occurredAtEpochMs: time1,
        requests: [
          {
            requestId: "first",
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
          {
            requestId: "second",
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
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
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "BATCH-REPLAY" }),
      amount: stockAmount("5", "piece"),
    });
    const command = {
      operationId: "issue-batch-replay",
      occurredAtEpochMs: time1,
      requests: [
        {
          requestId: "line-a",
          groupId: "prescription-line",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
          }),
          amount: stockAmount("2", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "line-b",
          groupId: "prescription-line",
          selector: inventoryStockSelector("item-a", {
            placementNodeIds: ["store"],
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
        allocation.lines[0]?.position.placementNodeId,
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
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "T1" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAtEpochMs: earlierExpiry },
        },
        {
          to: loosePosition("store", { lotId: "T2" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAtEpochMs: laterExpiry },
        },
      ],
    });
    const moved = await inventory.stock.transferByPolicy({
      operationId: "transfer-fefo-three",
      occurredAtEpochMs: time1,
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"] }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fefo,
      toPlacementNodeId: "room",
    });
    expect(moved.event.stockEffects).toHaveLength(4);
    expect(await quantityByLot(inventory, "store")).toEqual({ T2: 1 });
    expect(await quantityByLot(inventory, "room")).toEqual({ T1: 2, T2: 1 });
    await expect(
      inventory.stock.transferByPolicy({
        operationId: "bad-broad-transfer",
        occurredAtEpochMs: time2,
        selector: inventoryStockSelector("item-a"),
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
        toPlacementNodeId: "elsewhere",
      })
    ).rejects.toThrow("exactly one source direct placement");
  });
});

describe("native policy and reservation safety", () => {
  it("keeps exact allocated stock out of normal policy picks", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-reserved-lot",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "RESERVED" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-free-lot",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "FREE" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-one",
      operationId: "reserve-one",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["RESERVED"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
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
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: reservedPosition.key,
          quantity: parseQuantity("1", "piece"),
        },
      ],
    });

    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"] }),
      amount: stockAmount("3", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
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
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "CLAIM-EARLY" }),
          amount: stockAmount("1", "piece"),
          lot: { expiresAtEpochMs: earlierExpiry },
        },
        {
          to: loosePosition("store", { lotId: "CLAIM-LATE" }),
          amount: stockAmount("2", "piece"),
          lot: { expiresAtEpochMs: laterExpiry },
        },
      ],
    });
    await inventory.reservations.reserve({
      reservationId: "claim-policy-two",
      operationId: "reserve-policy-two",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });

    const allocationCommand = {
      operationId: "allocate-policy-two",
      reservationId: "claim-policy-two",
      occurredAtEpochMs: time1,
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
      occurredAtEpochMs: time2,
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
          occurredAtEpochMs: time2,
          reason: "The allocated stock was dispensed.",
        })
      ).replayed
    ).toBe(true);
  });

  it("treats stock use-by as reservation eligibility unless the claim explicitly permits expiry", async () => {
    let recordedAtEpochMs = time1;
    const inventory = createTestInventory(undefined, undefined, {
      /** Let the test cross container use-by while preserving event-versus-record-time checks. */
      nowEpochMs: () => recordedAtEpochMs,
    });
    await inventory.stock.receive({
      operationId: "receive-use-by-reservation-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("USE-BY-CONTAINER", {
        lotId: "USE-BY-LOT",
      }),
      amount: stockAmount("1", "piece"),
      placementNode: {
        category: "opened-vial",
        openedAtEpochMs: time0,
        useByEpochMs: time2,
      },
    });
    await inventory.reservations.reserve({
      reservationId: "ordinary-use-by-claim",
      operationId: "reserve-before-use-by",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["USE-BY-CONTAINER"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-before-use-by",
      reservationId: "ordinary-use-by-claim",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fefo,
    });

    recordedAtEpochMs = time3;
    expect((await inventory.read.reservationFeasibility(time3)).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
    await expect(
      inventory.reservations.consumeAllocated({
        operationId: "consume-after-use-by",
        reservationId: "ordinary-use-by-claim",
        occurredAtEpochMs: time3,
      })
    ).rejects.toThrow("past its lot/placement-ancestor use-by");
    await inventory.reservations.release({
      operationId: "release-expired-backing-claim",
      reservationId: "ordinary-use-by-claim",
      occurredAtEpochMs: time3,
    });

    await inventory.reservations.reserve({
      reservationId: "explicit-expired-claim",
      operationId: "reserve-expired-explicitly",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["USE-BY-CONTAINER"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time3,
      allowExpiredStock: true,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-expired-explicitly",
      reservationId: "explicit-expired-claim",
      occurredAtEpochMs: time3,
      method: InventoryAllocationMethod.Fefo,
    });
    await inventory.reservations.consumeAllocated({
      operationId: "consume-expired-explicitly",
      reservationId: "explicit-expired-claim",
      occurredAtEpochMs: time3,
      reason: "Expired stock use was explicitly approved for this claim.",
    });
    expect(await quantityByLot(inventory, "store")).toEqual({});
  });

  it("allows physical-truth policy planning across exact independent-axis allocations", async () => {
    const catalog = defineInventoryCatalog({
      itemRevisions: [{
        itemId: "weight-policy-item",
        revisionId: "weight-policy-item-v1",
        primaryAxis: {
          axisId: "pieces",
          role: InventoryMeasurementAxisRole.Primary,
          unit: unitCode("piece"),
          requirement: InventoryMeasurementRequirement.Required,
        },
        independentAxes: [{
          axisId: "weight",
          role: InventoryMeasurementAxisRole.Independent,
          unit: unitCode("kg"),
          requirement: InventoryMeasurementRequirement.Required,
        }],
        reservationAxisId: "weight",
        tracking: {
          lot: InventoryTrackingRequirement.Forbidden,
          serial: InventoryTrackingRequirement.Forbidden,
        },
        qualifiedDimensions: [],
      }],
      activeItemRevisionIds: { "weight-policy-item": "weight-policy-item-v1" },
      packagingRevisions: [],
    });
    const inventory = createTestInventory(undefined, catalog);
    const position = { itemId: "weight-policy-item", placementNodeId: "store" };
    await inventory.stock.receive({
      operationId: "weight-policy-receive",
      occurredAtEpochMs: time0,
      to: position,
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "10", unit: "kg" },
      ]),
    });
    await inventory.reservations.reserve({
      reservationId: "weight-policy-claim",
      operationId: "weight-policy-reserve",
      itemRevisionId: "weight-policy-item-v1",
      selector: { itemId: "weight-policy-item", placementNodeIds: ["store"] },
      requested: parseQuantity("4", "kg"),
      createdAtEpochMs: time1,
    });
    const [stockPosition] = await inventory.read.positions({
      itemId: "weight-policy-item",
      placementNodeIds: ["store"],
    });
    if (stockPosition === undefined) throw new Error("Weight-policy fixture lost stock.");
    await inventory.reservations.allocate({
      reservationId: "weight-policy-claim",
      operationId: "weight-policy-allocate",
      occurredAtEpochMs: time1,
      allocations: [{ position: stockPosition.key, quantity: parseQuantity("4", "kg") }],
    });
    const request = {
      selector: inventoryStockSelector("weight-policy-item", { placementNodeIds: ["store"] }),
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "10", unit: "kg" },
      ]),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
    };
    await expect(inventory.read.planAllocation(request)).rejects.toThrow(
      "independent axis"
    );
    const physicalTruth = await inventory.read.planAllocation({
      ...request,
      allowAllocatedStock: true,
    });
    expect(physicalTruth.shortfall.amountMinor).toBe(0);
    expect(physicalTruth.lines).toHaveLength(1);
    expect(physicalTruth.lines[0]?.allocatedPrimary.amountMinor).toBe(2);
  });

  it("lets explicit physical scrap reveal a shortage without pretending promises still fit", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-allocated-scrap",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "DAMAGED" }),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-damaged",
      operationId: "reserve-damaged",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["DAMAGED"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
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
      occurredAtEpochMs: time1,
      allocations: [
        { position: damaged.key, quantity: parseQuantity("1", "piece") },
      ],
    });

    await expect(
      inventory.stock.scrapByPolicy({
        operationId: "scrap-protected-shortfall",
        occurredAtEpochMs: time2,
        selector: inventoryStockSelector("item-a", { lotIds: ["DAMAGED"] }),
        amount: stockAmount("2", "piece"),
        method: InventoryAllocationMethod.Fifo,
        reason: "Both pieces were physically destroyed.",
      })
    ).rejects.toThrow("shortfall");

    await inventory.stock.scrapByPolicy({
      operationId: "scrap-allocated-physical-truth",
      occurredAtEpochMs: time2,
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
