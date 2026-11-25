import { describe, expect, it, vi } from "vitest";
import {
  defineInventoryCatalog,
  defineInventoryItem,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryOptionalIdentityConstraintKind,
  InventoryStockWhereaboutsState,
  InventoryTrackingRequirement,
  inventoryStockSelector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  stockAmount,
  unitCode,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  readInventoryScopedStockAvailability,
  type InventorySegmentedStockPlanningCapability,
} from "../src/storage-api.js";
import { planInventoryAllocation } from "../src/kernel.js";
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

/** One item with exact piece and weight evidence and a chosen claim axis. */
function measuredItemCatalog(reservationAxisId: "pieces" | "weight") {
  const item = defineInventoryItem({
    itemId: "measured", revisionId: "measured-v1",
    primaryAxis: {
      axisId: "pieces", role: InventoryMeasurementAxisRole.Primary,
      unit: unitCode("piece"), requirement: InventoryMeasurementRequirement.Required,
    },
    independentAxes: [{
      axisId: "weight", role: InventoryMeasurementAxisRole.Independent,
      unit: unitCode("kg"), requirement: InventoryMeasurementRequirement.Required,
    }],
    reservationAxisId,
    tracking: { lot: InventoryTrackingRequirement.Optional, serial: InventoryTrackingRequirement.Optional },
    qualifiedDimensions: [],
  });
  return defineInventoryCatalog({
    itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId },
  });
}

describe("indexed stock planning and availability", () => {
  it("witnesses a positive unlabelled row alongside labelled stock in one policy move", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({ operationId: "receive-labelled-piece", occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "labelled" }), amount: stockAmount("1", "piece") });
    await inventory.stock.receive({ operationId: "receive-unlabelled-pieces", occurredAtEpochMs: time1,
      to: loosePosition("store"), amount: stockAmount("2", "piece") });
    const result = await inventory.stock.transferByPolicy({
      operationId: "transfer-labelled-and-unlabelled", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector, method: InventoryAllocationMethod.Fifo, amount: stockAmount("2", "piece"),
    });
    expect(result.event.unwitnessedStockMovements).toBeUndefined();
    expect(result.event.positiveLayerProvenanceTransfers?.map((route) => route.from.lotId)).toEqual(["labelled", undefined]);
    expect(await inventory.read.positions(selector)).toMatchObject([
      { key: { placementNodeId: "store" }, measurements: { primary: { quantity: { amountMinor: 1 } } } },
    ]);
  });

  it("conserves separate unwitnessed routes whose intermediate sum cannot be stored", async () => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const result = await inventory.stock.transferMany({
      operationId: "combine-unwitnessed-scales", occurredAtEpochMs: time1,
      lines: ["9007199254740990", "0.1", "0.9"].map((value, index) => ({
        from: { itemId: item.itemId, placementNodeId: "store", lotId: `reported-lot-${index}` },
        toPlacementNodeId: "destination", amount: stockAmount(value, "kg"),
      })),
    });
    expect(result.event.unwitnessedStockMovements?.map((part) => part.measurements.primary.quantity)).toEqual(
      ["9007199254740990", "0.1", "0.9"].map((value) => parseQuantity(value, "kg")),
    );
    expect(result.event.stockEffects.map((effect) => effect.measurementsDelta.primary.quantity.amountMinor))
      .toEqual([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);
  });

  it("records a compatible measured shortage even when unused rows have larger increments", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const { lotId, count, weight } of [
      { lotId: "a", count: "4", weight: "4" },
      { lotId: "b", count: "2", weight: "4" },
      { lotId: "c", count: "4", weight: "10" },
    ]) {
      await inventory.stock.receive({
        operationId: `receive-measured-${lotId}`, occurredAtEpochMs: time0,
        to: { itemId: "measured", lotId, placementNodeId: "store" },
        amount: measuredStockAmount(count, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "transfer-six-weighed-pieces", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("6", "piece", [{ axisId: "weight", value: "5", unit: "kg" }]),
    });
    expect(result.event.positiveLayerProvenanceTransfers).toMatchObject([{ from: { lotId: "a" } }]);
    expect(result.event.unwitnessedStockMovements?.map((portion) => portion.measurements)).toEqual([{
      primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
      independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
    }]);
  });

  it.each([
    { pieces: "10", weight: "5", accepted: false },
    { pieces: "4", weight: "8", accepted: false },
    { pieces: "4", weight: "5", accepted: true },
  ])("preserves exact witnesses from $pieces pieces and $weight kg", async ({ pieces, weight, accepted }) => {
    const catalog = measuredItemCatalog("pieces");
    const item = catalog.activeItem("measured");
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = { itemId: item.itemId, placementNodeId: "store", lotId: "weighed" };
    await inventory.stock.receive({
      operationId: "receive-measured-source", occurredAtEpochMs: time0, to: from,
      amount: measuredStockAmount(pieces, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
    });
    const before = storage.readSegmentedStockHead();
    const report = inventory.stock.transfer({
      operationId: "report-measured-move", occurredAtEpochMs: time1,
      from, toPlacementNodeId: "destination",
      amount: measuredStockAmount("6", "piece", [{ axisId: "weight", value: "7", unit: "kg" }]),
    });
    if (!accepted) {
      await expect(report).rejects.toThrow("cannot partition independent measurements");
      expect(storage.readSegmentedStockHead()).toEqual(before);
      expect(await storage.readOperation("report-measured-move")).toBeUndefined();
      return;
    }
    const result = await report;
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("2", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("2", "kg") }],
      },
    }]);
    const rows = await inventory.read.positions({ itemId: item.itemId, placementNodeIds: ["destination"] });
    expect(rows.map((row) => [
      row.key.lotId, row.measurements.primary.quantity,
      row.measurements.independent[0]?.quantity,
    ])).toEqual([
      ["weighed", parseQuantity("4", "piece"), parseQuantity("5", "kg")],
      [undefined, parseQuantity("2", "piece"), parseQuantity("2", "kg")],
    ]);
  });

  it.each([
    { verb: "transfer", together: false },
    { verb: "scrap", together: false },
    { verb: "transfer", together: true },
    { verb: "scrap", together: true },
  ])(
    "records measured $verb with independent-axis holds (combined request: $together)",
    async ({ verb, together }) => {
      const storage = createInMemoryInventoryDurableStorage();
      const inventory = createTestInventory(storage, measuredItemCatalog("weight"));
      const selection = { itemId: "measured", placementNodeIds: ["store"] };
      const amount = measuredStockAmount("2", "piece", [{ axisId: "weight", value: "4", unit: "kg" }]);
      for (const { lotId, occurredAtEpochMs } of [{ lotId: "held", occurredAtEpochMs: time0 }, { lotId: "free", occurredAtEpochMs: time1 }]) {
        await inventory.stock.receive({
          operationId: `receive-${lotId}`, occurredAtEpochMs,
          to: { itemId: selection.itemId, placementNodeId: "store", lotId }, amount,
        });
      }
      const holdScope = { ...selection, lotIds: ["held"] };
      const heldRow = (await inventory.read.positions(holdScope))[0];
      if (heldRow === undefined) throw new Error("Missing measured hold source.");
      const quantity = parseQuantity("4", "kg");
      await inventory.reservations.reserve({
        operationId: "reserve-weight", reservationId: "weight", itemRevisionId: "measured-v1",
        selector: holdScope, requested: quantity, createdAtEpochMs: time1,
      });
      await inventory.reservations.allocate({
        operationId: "allocate-weight", reservationId: "weight", occurredAtEpochMs: time1,
        allocations: [{ position: heldRow.key, quantity }],
      });
      const movements = together
        ? [{ lots: ["free", "held"], amount: measuredStockAmount("4", "piece", [{ axisId: "weight", value: "8", unit: "kg" }]) }]
        : [{ lots: ["free"], amount }, { lots: ["held"], amount }];
      for (const [sequence, movement] of movements.entries()) {
        const command = {
          operationId: `record-measured-${sequence}`, occurredAtEpochMs: time2,
          selector: selection, amount: movement.amount, method: InventoryAllocationMethod.Fifo,
        };
        const result = verb === "transfer"
          ? await inventory.stock.transferByPolicy({ ...command, toPlacementNodeId: "destination" })
          : await inventory.stock.scrapByPolicy({ ...command, reason: "Broken goods" });
        const debits = result.event.stockEffects.filter((effect) => effect.measurementsDelta.primary.quantity.amountMinor < 0);
        expect(debits.map((debit) => debit.position.lotId).sort()).toEqual(movement.lots);
        for (const debit of debits) {
          expect(debit.measurementsDelta).toEqual({
            primary: { axisId: "pieces", quantity: parseQuantity("-2", "piece") },
            independent: [{ axisId: "weight", quantity: parseQuantity("-4", "kg") }],
          });
        }
        const credits = result.event.stockEffects.filter((effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0);
        expect(credits.map((credit) => credit.position.lotId).sort()).toEqual(verb === "transfer" ? movement.lots : []);
        for (const credit of credits) {
          expect(credit.measurementsDelta).toEqual({
            primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
            independent: [{ axisId: "weight", quantity: parseQuantity("4", "kg") }],
          });
        }
      }
      const claim = (await inventory.read.reservationFeasibility(time2)).groups[0];
      expect(claim).toMatchObject({ reservationIds: ["weight"], shortage: { amountMinor: 4 } });
    }
  );

  it("keeps an explicit deficit report inside its selected placement subtree", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({
      operationId: "older-unlabelled", occurredAtEpochMs: time0, to: loosePosition("store"),
      placementNode: { useByEpochMs: time3 }, amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receive({
      operationId: "younger-labelled", occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "young" }), amount: stockAmount("3", "piece"),
    });
    await expect(inventory.stock.transferManyByPolicy({
      operationId: "report-then-pick", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      requests: [
        {
          requestId: "report", method: InventoryAllocationMethod.Fifo,
          selector: { ...selector, withinPlacementNodeIds: ["another-root"] },
          deficitPosition: loosePosition("store"), amount: stockAmount("2", "piece"),
        },
        {
          requestId: "pick", method: InventoryAllocationMethod.Fifo,
          selector, amount: stockAmount("1", "piece"),
        },
      ],
    })).rejects.toThrow("outside the selected placement scope");
    expect(await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual([]);
    expect((await inventory.read.positions(selector)).map((position) => position.measurements.primary.quantity.amountMinor).sort()).toEqual([3, 5]);
  });

  it.each(["transfer", "scrap"] as const)(
    "records the exact measured residual for a policy %s",
    async (verb) => {
      const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
      const request = {
        selector: { itemId: "measured", placementNodeIds: ["store"] },
        method: InventoryAllocationMethod.Fifo,
        occurredAtEpochMs: time2,
      };
      await inventory.stock.receive({
        operationId: "receive-known-measurements", occurredAtEpochMs: time0,
        to: { itemId: "measured", placementNodeId: "store", lotId: "known" },
        amount: measuredStockAmount("1", "piece", [{ axisId: "weight", value: "10", unit: "kg" }]),
      });
      const report = {
        ...request, operationId: "measure-residual",
        amount: measuredStockAmount("3", "piece", [{ axisId: "weight", value: "30", unit: "kg" }]),
      };
      const result = verb === "transfer"
        ? await inventory.stock.transferByPolicy({ ...report, toPlacementNodeId: "destination" })
        : await inventory.stock.scrapByPolicy({ ...report, reason: "Physical destruction" });
      expect(result.event.unwitnessedStockMovements).toMatchObject([{
        measurements: {
          primary: { quantity: { amountMinor: 2 } },
          independent: [{ axisId: "weight", quantity: { amountMinor: 20 } }],
        },
      }]);
      expect(result.event.stockEffects.some((effect) =>
        effect.position.lotId === "known" && effect.measurementsDelta.independent[0]?.quantity.amountMinor === -10
      )).toBe(true);
    }
  );

  it("rejects an independent difference when the primary count has no residual", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({
      operationId: "receive-light", occurredAtEpochMs: time0,
      to: { itemId: "measured", placementNodeId: "store" },
      amount: measuredStockAmount("2", "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    });
    const before = storage.readSegmentedStockHead();
    await expect(inventory.stock.transferByPolicy({
      operationId: "report-heavier", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] },
      method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("2", "piece", [{ axisId: "weight", value: "5", unit: "kg" }]),
    })).rejects.toThrow("Reported physical movement remainder");
    expect(storage.readSegmentedStockHead()).toEqual(before);
  });

  it.each([
    { reported: "4", remaining: 2 },
    { reported: "3", remaining: 1 },
  ])("uses the largest compatible partial witness in a $reported-piece measured transfer", async ({ reported, remaining }) => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, weight] of [["heavy", "40"], ["light", "10"], ["medium", "15"]] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}`, occurredAtEpochMs: time0,
        to: { itemId: "measured", placementNodeId: "store", lotId },
        amount: measuredStockAmount("1", "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "record-compatible-witnesses", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(reported, "piece", [{ axisId: "weight", value: "30", unit: "kg" }]),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: { amountMinor: remaining } },
        independent: [{ axisId: "weight", quantity: { amountMinor: 5 } }],
      },
    }]);
    expect(await inventory.read.positions({ itemId: "measured", lotIds: ["heavy"] })).toMatchObject([
      { key: { placementNodeId: "store" } },
    ]);
    expect(await inventory.read.positions({
      itemId: "measured", placementNodeIds: ["destination"], lotIds: ["light", "medium"],
    })).toHaveLength(2);
  });

  it.each([{ pieces: "2", weight: "2", residual: false }, { pieces: "3", weight: "5", residual: true }])(
    "keeps unreported axes on measured scrap effects with residual $residual", async ({ pieces, weight, residual }) => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: [...base.independentAxes, {
        axisId: "optional", role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("g"), requirement: InventoryMeasurementRequirement.Optional,
      }],
    });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    for (const lotId of ["a", "b"]) {
      await inventory.stock.receive({
        operationId: `receive-large-optional-${lotId}`, occurredAtEpochMs: time0,
        to: { itemId: "measured", lotId, placementNodeId: "store" },
        amount: measuredStockAmount("1", "piece", [
          { axisId: "weight", value: "1", unit: "kg" },
          { axisId: "optional", value: String(Number.MAX_SAFE_INTEGER), unit: "g" },
        ]),
      });
    }
    const result = await inventory.stock.scrapByPolicy({
      operationId: "scrap-without-optional-report", occurredAtEpochMs: time2, reason: "Physically discarded",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(pieces, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
    });
    if (residual) {
      expect(result.event.unwitnessedStockMovements?.map((movement) => movement.measurements)).toEqual([{
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("3", "kg") }],
      }]);
    } else {
      expect(result.event.unwitnessedStockMovements).toBeUndefined();
    }
    const witnessed = result.event.stockEffects.filter((effect) => effect.position.lotId !== undefined);
    expect(witnessed).toHaveLength(2);
    for (const effect of witnessed) {
      expect(effect.measurementsDelta.independent).toContainEqual({
        axisId: "optional", quantity: parseQuantity(String(Number.MIN_SAFE_INTEGER), "g"),
      });
    }
  });

  it("records a genuine measured shortage when none of the recorded stock can witness it", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({
      operationId: "receive-incompatible-witness", occurredAtEpochMs: time0,
      to: { itemId: "measured", placementNodeId: "store", lotId: "heavy" },
      amount: measuredStockAmount("1", "piece", [{ axisId: "weight", value: "40", unit: "kg" }]),
    });
    const result = await inventory.stock.transferByPolicy({
      operationId: "report-without-a-witness", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("3", "piece", [{ axisId: "weight", value: "30", unit: "kg" }]),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: { amountMinor: 3 } },
        independent: [{ axisId: "weight", quantity: { amountMinor: 30 } }],
      },
    }]);
    expect(result.event.stockEffects).toHaveLength(2);
    expect(await inventory.read.positions({ itemId: "measured", lotIds: ["heavy"] })).toMatchObject([
      { key: { placementNodeId: "store" } },
    ]);
  });

  it("records a measured remainder whose exact primary digits fit at a smaller scale", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, primary, weight] of [["heavy", "1.0", "40"], ["light", "1.0", "10"]] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}-mixed-scale`, occurredAtEpochMs: time0,
        to: { itemId: "measured", placementNodeId: "store", lotId },
        amount: measuredStockAmount(primary, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "record-mixed-scale-remaining", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(String(Number.MAX_SAFE_INTEGER), "piece", [{ axisId: "weight", value: "30", unit: "kg" }]),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: { amountMinor: Number.MAX_SAFE_INTEGER - 1, decimals: 0 } },
        independent: [{ axisId: "weight", quantity: { amountMinor: 20 } }],
      },
    }]);
  });

  it("records an exact measured shortfall after a FIFO prefix exceeds the storage scale", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, pieces, occurredAtEpochMs] of [["first", "1.1", time0], ["second", "1.9", time1]] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}-fractional`, occurredAtEpochMs,
        to: { itemId: "measured", placementNodeId: "store", lotId },
        amount: measuredStockAmount(pieces, "piece", [{ axisId: "weight", value: "1", unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "record-exact-after-fractional-prefix", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(String(Number.MAX_SAFE_INTEGER), "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    });
    const knownArrivals = result.event.stockEffects.filter((effect) =>
      effect.position.placementNodeId === "destination" && effect.position.lotId !== undefined
    );
    expect(knownArrivals.map((effect) => effect.position.lotId).sort()).toEqual(["first", "second"]);
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: { amountMinor: Number.MAX_SAFE_INTEGER - 3, decimals: 0 } },
        independent: [{ axisId: "weight", quantity: { amountMinor: 1 } }],
      },
    }]);
  });

  it.each([true, false])("records a measured report with an unstorable trial (later witness: %s)", async (hasLaterWitness) => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    const fractional = { lotId: "fractional", pieces: "1.9", weight: "1", occurredAtEpochMs: time1 };
    const lots = hasLaterWitness
      ? [
          { lotId: "heavy", pieces: "1.1", weight: "40", occurredAtEpochMs: time0 },
          fractional,
          { lotId: "whole", pieces: "1.0", weight: "1", occurredAtEpochMs: time2 },
        ]
      : [fractional];
    for (const { lotId, pieces, weight, occurredAtEpochMs } of lots) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}-measured`, occurredAtEpochMs,
        to: { itemId: "measured", placementNodeId: "store", lotId },
        amount: measuredStockAmount(pieces, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "record-later-witness-with-safe-remainder", occurredAtEpochMs: time3,
      toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(String(Number.MAX_SAFE_INTEGER), "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    });
    const knownArrivals = result.event.stockEffects.filter((effect) =>
      effect.position.placementNodeId === "destination" && effect.position.lotId !== undefined
    );
    expect(knownArrivals.map((effect) => effect.position.lotId)).toEqual(hasLaterWitness ? ["whole"] : []);
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: { amountMinor: Number.MAX_SAFE_INTEGER - (hasLaterWitness ? 1 : 0), decimals: 0 } },
        independent: [{ axisId: "weight", quantity: { amountMinor: hasLaterWitness ? 2 : 3 } }],
      },
    }]);
  });

  it.each([
    { verb: "transfer", held: true },
    { verb: "scrap", held: true },
    { verb: "transfer", held: false },
  ])("chooses a witness that matches every reported axis for $verb (held: $held)", async ({ verb, held }) => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    /** Exact source bin for both potential witnesses. */
    const selection = { itemId: "measured", placementNodeIds: ["store"] };
    const reported = measuredStockAmount("4", "piece", [{ axisId: "weight", value: "5", unit: "kg" }]);
    await inventory.stock.receive({
      operationId: "receive-light-witness", occurredAtEpochMs: time0,
      to: { itemId: "measured", placementNodeId: "store", lotId: "light" },
      amount: measuredStockAmount("4", "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    });
    await inventory.stock.receive({
      operationId: "receive-exact-witness", occurredAtEpochMs: time1,
      to: { itemId: "measured", placementNodeId: "store", lotId: "exact" }, amount: reported,
    });
    if (held) {
      const exactScope = { ...selection, lotIds: ["exact"] };
      const [exact] = await inventory.read.positions(exactScope);
      if (exact === undefined) throw new Error("Missing exact measured witness.");
      const requested = parseQuantity("4", "piece");
      await inventory.reservations.reserve({
        operationId: "reserve-exact-witness", reservationId: "hold-exact", itemRevisionId: "measured-v1",
        selector: exactScope, requested, createdAtEpochMs: time1,
      });
      await inventory.reservations.allocate({
        operationId: "allocate-exact-witness", reservationId: "hold-exact", occurredAtEpochMs: time1,
        allocations: [{ position: exact.key, quantity: requested }],
      });
    }
    const command = {
      operationId: "record-exact-witness", occurredAtEpochMs: time2, selector: selection,
      method: InventoryAllocationMethod.Fifo, amount: reported,
    };
    const result = verb === "transfer"
      ? await inventory.stock.transferByPolicy({ ...command, toPlacementNodeId: "destination" })
      : await inventory.stock.scrapByPolicy({ ...command, reason: "Measured physical destruction" });
    expect(result.event.unwitnessedStockMovements).toBeUndefined();
    expect(await inventory.read.positions(selection)).toMatchObject([{ key: { lotId: "light" } }]);
    if (held) {
      expect((await inventory.read.reservationFeasibility(time2)).groups).toMatchObject([
        { reservationIds: ["hold-exact"], shortage: { amountMinor: 4 } },
      ]);
    }
  });

  it("excludes placed deficits from a preview for explicitly unplaced stock", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.issue({
      operationId: "placed-shortage", occurredAtEpochMs: time1, from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const request = {
      method: InventoryAllocationMethod.Fifo, amount: stockAmount("1", "piece"), atEpochMs: time2,
    };
    const unplaced = await inventory.read.planAllocation({
      ...request,
      selector: { itemId: "item-a", placement: { kind: InventoryOptionalIdentityConstraintKind.Absent } },
    });
    expect(unplaced.recordedDeficit.amountMinor).toBe(0);
    const unrestricted = await inventory.read.planAllocation({ ...request, selector: { itemId: "item-a" } });
    expect(unrestricted.recordedDeficit.amountMinor).toBe(2);
  });

  it("reports only the deficit of the selected whereabouts cohort or state", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const amount = stockAmount("1", "piece");
    for (const bin of ["detached-source", "missing-source"]) {
      await inventory.stock.receive({ operationId: `receive-${bin}`, occurredAtEpochMs: time0, to: loosePosition(bin), amount });
      await inventory.stock.detach({ operationId: `detach-${bin}`, occurredAtEpochMs: time1, from: loosePosition(bin), amount });
    }
    const detachedRows = await inventory.read.positions({ itemId: "item-a" });
    const detached = detachedRows.find((row) => row.key.lastPlacementNodeId === "detached-source");
    const beforeMissing = detachedRows.find((row) => row.key.lastPlacementNodeId === "missing-source");
    if (detached?.key.whereaboutsId === undefined || beforeMissing?.key.whereaboutsId === undefined) {
      throw new Error("Expected both detached cohorts.");
    }
    await inventory.stock.markMissing({ operationId: "mark-other-cohort-missing", occurredAtEpochMs: time1, from: beforeMissing.key, amount });
    const [missing] = await inventory.read.positions({
      itemId: "item-a", whereaboutsStates: [InventoryStockWhereaboutsState.Missing],
    });
    if (missing === undefined) throw new Error("Expected the missing cohort.");
    await inventory.stock.issue({ operationId: "detached-deficit", occurredAtEpochMs: time2, from: detached.key, amount: stockAmount("3", "piece") });
    await inventory.stock.issue({ operationId: "missing-deficit", occurredAtEpochMs: time2, from: missing.key, amount: stockAmount("6", "piece") });
    const world = await inventory.read.world();
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const request = { method: InventoryAllocationMethod.Fifo, amount, atEpochMs: time2 };
    for (const { selector, deficit } of [
      { selector: { itemId: "item-a", whereaboutsIds: [detached.key.whereaboutsId] }, deficit: 2 },
      { selector: { itemId: "item-a", whereaboutsStates: [InventoryStockWhereaboutsState.Missing] }, deficit: 5 },
      { selector: { itemId: "item-a" }, deficit: 7 },
    ]) {
      const native = await inventory.read.planAllocation({ ...request, selector });
      expect(native).toEqual(planInventoryAllocation({ ...request, selector, catalog, world }));
      expect(native.recordedDeficit.amountMinor).toBe(deficit);
      expect(native.uncoveredDeficit.amountMinor).toBe(deficit);
    }
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("keeps preview quantity and claim time fixed across the scoped pool read", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await receiveKnownLots(inventory);
    await inventory.reservations.reserve({
      operationId: "reserve-at-preview-time", reservationId: "preview-hold", itemRevisionId: "item-a-v2",
      selector: { ...selector, lotIds: ["old"] }, requested: parseQuantity("2", "piece"), createdAtEpochMs: time2,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-at-preview-time", reservationId: "preview-hold",
      occurredAtEpochMs: time2, method: InventoryAllocationMethod.Fifo,
    });
    const request = {
      selector, method: InventoryAllocationMethod.Fifo, atEpochMs: time2,
      reservationAtEpochMs: time2, amount: stockAmount("1", "piece"),
    };
    const readPool = storage.readSegmentedStockPool.bind(storage);
    const pool = vi.spyOn(storage, "readSegmentedStockPool").mockImplementationOnce((input) => {
      request.reservationAtEpochMs = time1;
      request.amount = stockAmount("2", "piece");
      return readPool(input);
    });
    const plan = await inventory.read.planAllocation(request);
    expect(pool).toHaveBeenCalledWith(expect.objectContaining({ reservationAtEpochMs: time2 }));
    expect(plan.requestedPrimary.amountMinor).toBe(1);
    expect(plan.lines).toMatchObject([{ position: { lotId: "young" } }]);
  });

  it("snapshots only typed command fields through native physical planning", async () => {
    const inventory = createTestInventory();
    await receiveKnownLots(inventory);
    const batch = issueCommand();
    const [first, second] = batch.requests;
    if (first === undefined || second === undefined) throw new Error("Missing batch requests.");
    const extended = { ...first, applicationCallback: () => undefined };
    const result = await inventory.stock.issueManyByPolicy(new Proxy({
      ...batch, requests: [extended, second],
    }, {}));
    expect(result.allocations).toHaveLength(2);
    const movement = {
      operationId: "extended-policy", occurredAtEpochMs: time2, selector,
      amount: stockAmount("1", "piece"), method: InventoryAllocationMethod.Fifo,
      toPlacementNodeId: "destination", applicationCallback: () => undefined,
    };
    await inventory.stock.transferByPolicy(new Proxy(movement, {}));
    const contents = {
      operationId: "extended-contents", occurredAtEpochMs: time2,
      nodeId: "destination", into: "final", applicationCallback: () => undefined,
    };
    await inventory.placement.moveContents(new Proxy(contents, {}));
    expect(await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["final"] })).toHaveLength(1);
  });

  it.each(["exact transfer", "policy transfer", "policy scrap"])(
    "settles an unlabelled remainder against one signed row for %s",
    async (verb) => {
      for (const storage of [createInMemoryInventoryDurableStorage(), createInMemoryInventoryDurableStorage({ failpoint: () => undefined })]) {
        const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
        await receiveKnownLots(inventory);
        await inventory.stock.receive({
          operationId: "receive-unlabelled", occurredAtEpochMs: time1,
          to: loosePosition("store"), amount: stockAmount("5", "piece"),
        });
        const command = {
          operationId: "reported-with-unlabelled", occurredAtEpochMs: time2, amount: stockAmount("4", "piece"),
        };
        const policy = {
          ...command, method: InventoryAllocationMethod.Fifo,
          selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"], lotIds: ["old"] }),
        };
        const result = verb === "exact transfer" ? await inventory.stock.transfer({
          ...command, from: loosePosition("store", { lotId: "old" }), toPlacementNodeId: "destination",
        }) : verb === "policy transfer" ? await inventory.stock.transferByPolicy({
          ...policy, toPlacementNodeId: "destination",
        }) : await inventory.stock.scrapByPolicy({ ...policy, reason: "Destroyed stock" });
        expect(result.event.unwitnessedStockMovements).toHaveLength(1);
        const portion = result.event.unwitnessedStockMovements?.[0];
        expect(portion?.measurements.primary.quantity.amountMinor).toBe(2);
        expect(portion?.from.lotId).toBeUndefined();
        const source = await inventory.read.positions(selector);
        expect(source.map((row) => [row.key.lotId, row.measurements.primary.quantity.amountMinor])).toEqual([
          ["young", 2], [undefined, 3],
        ]);
        if (verb !== "policy scrap") {
          expect(portion?.to).toMatchObject({ placementNodeId: "destination" });
          expect(portion?.to?.lotId).toBeUndefined();
          const arrival = await inventory.read.planAllocation({
            selector: inventoryStockSelector("item-a", { placementNodeIds: ["destination"] }),
            amount: stockAmount("4", "piece"), method: InventoryAllocationMethod.Fifo, atEpochMs: time3,
          });
          expect(arrival.lines.map((line) => [line.position.lotId, line.allocatedPrimary.amountMinor, line.layerStartedAtEpochMs])).toEqual([
            ["old", 2, time0], [undefined, 2, time2],
          ]);
        } else {
          expect(result.event.reason).toBe("Destroyed stock");
          expect(portion?.to).toBeUndefined();
        }
      }
    }
  );

  it("keeps whole package counts when an unwitnessed posting settles into an existing row", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const packageId = "item-a-box-24-v1";
    await inventory.stock.receive({
      operationId: "lot-packages", occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "lot-pack" }), amount: packageAmount(1, packageId),
    });
    await inventory.stock.receive({
      operationId: "unlabelled-packages", occurredAtEpochMs: time1,
      to: loosePosition("store"), amount: packageAmount(3, packageId),
    });
    const result = await inventory.stock.transfer({
      operationId: "reported-packages", occurredAtEpochMs: time2,
      from: loosePosition("store", { lotId: "lot-pack" }), toPlacementNodeId: "destination",
      amount: packageAmount(2, packageId),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      from: { packagingRevisionId: packageId }, to: { packagingRevisionId: packageId },
      measurements: { primary: { quantity: { amountMinor: 24 } } },
    }]);
    expect(await inventory.read.positions(selector)).toMatchObject([{
      key: { packagingRevisionId: packageId },
      measurements: { primary: { quantity: { amountMinor: 48 } } },
    }]);
  });

  it("requires an explicit shortfall package to match the reported amount", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    const amount = packageAmount(1, "item-a-box-24-v1");
    const command = {
      operationId: "report-packaged-shortage", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector, method: InventoryAllocationMethod.Fifo, amount,
    };
    const before = storage.readSegmentedStockHead();
    await expect(inventory.stock.transferByPolicy({
      ...command, deficitPosition: loosePosition("store", { packagingRevisionId: "item-a-box-20-v1" }),
    })).rejects.toThrow("deficit position packaging revision differs");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    const result = await inventory.stock.transferByPolicy({
      ...command, deficitPosition: loosePosition("store", { packagingRevisionId: "item-a-box-24-v1" }),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([
      { from: { packagingRevisionId: "item-a-box-24-v1" }, to: { packagingRevisionId: "item-a-box-24-v1" } },
    ]);
  });

  it("preserves FIFO evidence for the unlabelled balance after a prior batch request", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    await receiveKnownLots(inventory);
    await inventory.stock.receive({
      operationId: "receive-unlabelled", occurredAtEpochMs: time1,
      to: loosePosition("store"), amount: stockAmount("5", "piece"),
    });
    const command = {
      operationId: "batch-debits-and-picks", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      requests: [
        {
          requestId: "report-old", method: InventoryAllocationMethod.Fifo, amount: stockAmount("4", "piece"),
          selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"], lotIds: ["old"] }),
        },
        {
          requestId: "pick-unlabelled", method: InventoryAllocationMethod.Fifo, amount: stockAmount("4", "piece"),
          selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"], lot: { kind: InventoryOptionalIdentityConstraintKind.Absent } }),
        },
      ],
    };
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const result = await inventory.stock.transferManyByPolicy(command);
    expect(result.allocations).toMatchObject([
      { requestId: "report-old", deficit: { primary: { amountMinor: 2 } } },
      { requestId: "pick-unlabelled", lines: [{ allocatedPrimary: { amountMinor: 3 }, layerStartedAtEpochMs: time1 }], deficit: { primary: { amountMinor: 1 } } },
    ]);
    expect((await inventory.stock.transferManyByPolicy(command)).event).toEqual(result.event);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("rejects a placed policy shortfall when the selector requires missing stock", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    const before = storage.readSegmentedStockHead();
    await expect(inventory.stock.transferByPolicy({
      operationId: "missing-stock-shortfall", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { ...selector, whereaboutsStates: [InventoryStockWhereaboutsState.Missing] },
      method: InventoryAllocationMethod.Fifo, amount: stockAmount("1", "piece"),
    })).rejects.toThrow("outside the selected placement scope");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await inventory.read.positions({ itemId: "item-a" })).toEqual([]);
  });

  it("merges mixed-scale postings and retains the exact witnessed FIFO route", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const witnessed = "9007199254740990";
    const total = "9007199254740991";
    await inventory.stock.receive({
      operationId: "mixed-scale-batch-source", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: stockAmount(witnessed, "piece"),
    });
    const result = await inventory.stock.transferManyByPolicy({
      operationId: "mixed-scale-batch-transfer", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      requests: [
        { requestId: "witnessed", selector, amount: stockAmount(witnessed, "piece"), method: InventoryAllocationMethod.Fifo },
        { requestId: "unwitnessed", selector, amount: stockAmount("1.0", "piece"), method: InventoryAllocationMethod.Fifo },
      ],
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([
      { measurements: { primary: { quantity: parseQuantity("1.0", "piece") } } },
    ]);
    expect(result.event.positiveLayerProvenanceTransfers).toMatchObject([
      { from: { placementNodeId: "store" }, to: { placementNodeId: "destination" } },
    ]);
    expect(result.event.stockEffects.map((effect) => effect.evidence?.transactedMeasurements?.primary.quantity))
      .toEqual([parseQuantity(total, "piece"), parseQuantity(total, "piece")]);
    expect((await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] }))[0]
      ?.measurements.primary.quantity).toEqual(parseQuantity(total, "piece"));
  });

  it("retains the witnessed leg when the destination balance absorbs it", async () => {
    for (const storage of [createInMemoryInventoryDurableStorage(), createInMemoryInventoryDurableStorage({ failpoint: () => undefined })]) {
      const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      await receiveKnownLots(inventory);
      const formerBalance = loosePosition("destination", { lotId: "old" });
      await inventory.stock.issue({
        operationId: "unrecorded-destination-receipt", occurredAtEpochMs: time1, from: formerBalance,
        amount: stockAmount("2", "piece"),
      });
      const result = await inventory.stock.transfer({
        operationId: "settle-and-transfer", occurredAtEpochMs: time2,
        from: loosePosition("store", { lotId: "old" }), toPlacementNodeId: "destination", amount: stockAmount("4", "piece"),
      });
      expect(result.event.positiveLayerProvenanceTransfers).toMatchObject([{ from: { lotId: "old" }, to: formerBalance }]);
      const readDestination = inventoryStockSelector("item-a", { placementNodeIds: ["destination"] });
      const arrival = await inventory.read.planAllocation({
        selector: readDestination, amount: stockAmount("2", "piece"), method: InventoryAllocationMethod.Fifo, atEpochMs: time3,
      });
      expect(arrival.lines).toMatchObject([{ allocatedPrimary: { amountMinor: 2 }, layerStartedAtEpochMs: time2 }]);
      expect((await inventory.read.world()).projection.lastRecordSequence).toBe(4);
    }
  });

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

  it("replays a scoped operation completed before a newer catalogue is published", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog);
    await receiveKnownLots(inventory);
    const extra = defineScalarInventoryItem({
      itemId: "later-item", revisionId: "later-item-v1", axisId: "pieces", unit: "piece",
    });
    const updated = createTestInventory(storage, extendInventoryCatalog({
      catalog,
      itemRevisions: [extra],
      activeItemRevisionIds: { [extra.itemId]: extra.revisionId },
    }));
    const command = issueCommand();
    const readOperation = storage.readOperation.bind(storage);
    const before = storage.readSegmentedStockHead();
    let committed: Awaited<ReturnType<typeof inventory.stock.issueManyByPolicy>> | undefined;
    vi.spyOn(storage, "readOperation").mockImplementationOnce(async (operationId) => {
      const prior = await readOperation(operationId);
      committed = await inventory.stock.issueManyByPolicy(command);
      await updated.catalog.publish({ operationId: "publish-after-scoped-command", occurredAtEpochMs: time2 });
      return prior;
    });
    const replay = await inventory.stock.issueManyByPolicy(command);
    expect(committed).toBeDefined();
    expect(replay).toEqual({ ...committed, replayed: true });
    expect(storage.readSegmentedStockHead().worldRevision).toBe(before.worldRevision + 2);
    await expect(inventory.stock.issueManyByPolicy({ ...command, operationId: "new-stale-catalogue-command" }))
      .rejects.toThrow("publish the retained inventory catalogue first");
  });

  it("replays an exact serialized transfer that wins the canonical planning race", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    const from = loosePosition("store", { serialId: "race-serial" });
    const amount = stockAmount("1", "piece");
    await inventory.stock.receive({ operationId: "receive-race-serial", occurredAtEpochMs: time0, to: from, amount });
    const command = { operationId: "serialized-canonical-race", occurredAtEpochMs: time1,
      from, toPlacementNodeId: "destination", amount };
    const head = storage.readSegmentedStockHead();
    const readOperation = storage.readOperation.bind(storage);
    const lookup = vi.spyOn(storage, "readOperation");
    let committed: Awaited<ReturnType<typeof inventory.stock.transfer>> | undefined;
    lookup.mockImplementationOnce(readOperation).mockImplementationOnce(async (operationId) => {
      expect(operationId).toBe(command.operationId);
      const prior = await readOperation(operationId);
      committed = await inventory.stock.transfer(command);
      return prior;
    });
    const replay = await inventory.stock.transfer(command);
    expect(committed?.replayed).toBe(false);
    expect(replay).toEqual({ ...committed, replayed: true });
    expect(storage.readSegmentedStockHead().worldRevision).toBe(head.worldRevision + 1);
    await expect(inventory.stock.transfer({ ...command, operationId: "genuinely-empty-serial" }))
      .rejects.toThrow("Unwitnessed transfer cannot claim a serial identity");
  });

  it("replays the concurrent winner of the final scoped publication attempt", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await receiveKnownLots(inventory);
    const command = issueCommand();
    const commit = storage.commitSegmentedStockEvent.bind(storage);
    const readHead = storage.readSegmentedStockHead.bind(storage);
    let declined = 0;
    let winner: Awaited<ReturnType<typeof inventory.stock.issueManyByPolicy>> | undefined;
    const planning: InventorySegmentedStockPlanningCapability = storage;
    const head = vi.spyOn(planning, "readSegmentedStockHead");
    vi.spyOn(storage, "commitSegmentedStockEvent").mockImplementation(async (plan) => {
      if (plan.operationId !== command.operationId || declined === 8) return commit(plan);
      declined += 1;
      if (declined === 8) {
        head.mockImplementationOnce(async () => {
          winner = await inventory.stock.issueManyByPolicy(command);
          return readHead();
        });
      } else {
        await inventory.stock.receive({ operationId: `intervening-${declined}`, occurredAtEpochMs: time1,
          to: loosePosition("other"), amount: stockAmount("1", "piece") });
      }
      return undefined;
    });
    const before = readHead().worldRevision;
    const replay = await inventory.stock.issueManyByPolicy(command);
    expect(winner?.replayed).toBe(false);
    expect(replay).toEqual({ ...winner, replayed: true });
    expect(declined).toBe(8);
    expect(readHead().worldRevision).toBe(before + 8);
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

  it("excludes deficits at direct placements outside the requested subtree", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    await inventory.placement.move({
      operationId: "place-inside", occurredAtEpochMs: time0, nodeId: "inside", into: "root",
    });
    for (const [bin, count] of [["inside", "2"], ["outside", "5"]] as const) {
      await inventory.stock.issue({
        operationId: `short-${bin}`, occurredAtEpochMs: time1,
        from: loosePosition(bin), amount: stockAmount(count, "piece"),
      });
    }
    const intersection = inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      placementNodeIds: ["inside", "outside"],
      withinPlacementNodeIds: ["root"],
    });
    const full = (await inventory.read.availability(intersection, time2)).revisions[0];
    expect(full?.deficit.primary.quantity.amountMinor).toBe(2);
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const scoped = await readInventoryScopedStockAvailability({
      storage, catalog, selector: intersection, itemRevisionId: "item-a-v2", atEpochMs: time2,
    });
    expect(scoped.deficit.primary.quantity.amountMinor).toBe(2);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("keeps an exact hold on a signed deficit out of usable allocations", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = loosePosition("store", { lotId: "held" });
    await inventory.stock.receive({
      operationId: "receive-held-deficit", occurredAtEpochMs: time0, to: from, amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      operationId: "reserve-held-deficit", reservationId: "held-deficit", itemRevisionId: "item-a-v2",
      selector, requested: parseQuantity("2", "piece"), createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-held-deficit", reservationId: "held-deficit",
      occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.issue({
      operationId: "issue-held-deficit", occurredAtEpochMs: time2, from, amount: stockAmount("3", "piece"),
    });
    const canonical = (await inventory.read.availability(selector, time2)).revisions[0];
    const scoped = await readInventoryScopedStockAvailability({
      storage, catalog, selector, itemRevisionId: "item-a-v2", atEpochMs: time2,
    });
    for (const report of [canonical, scoped]) {
      expect(report?.exactlyAllocatedUsable.amountMinor).toBe(0);
      expect(report?.onHand.primary.quantity.amountMinor).toBe(-1);
      expect(report?.deficit.primary.quantity.amountMinor).toBe(1);
      expect(report?.usableOnHand.primary.quantity.amountMinor).toBe(0);
      expect(report?.usableDeficit.primary.quantity.amountMinor).toBe(0);
      expect(report?.positions).toMatchObject([{
        isDeficit: true,
        exactlyAllocated: { amountMinor: 2 },
        exactAllocationReservationIds: ["held-deficit"],
      }]);
    }
  });

  it("publishes immutable pool claims and returns only local exact holds at historical times", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    for (const bin of ["store", "other"]) {
      await inventory.stock.receive({
        operationId: `stock-${bin}`, occurredAtEpochMs: time0,
        to: loosePosition(bin), amount: stockAmount("3", "piece"),
      });
      await inventory.reservations.reserve({
        operationId: `claim-${bin}`, reservationId: bin, itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: [bin] },
        requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
      });
      await inventory.reservations.allocateByPolicy({
        operationId: `allocate-${bin}`, reservationId: bin,
        occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
      });
    }
    await inventory.reservations.reserve({
      operationId: "claim-broad", reservationId: "broad", itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" }, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    });
    const request = { selector, itemRevisionId: "item-a-v2", exactHoldsOnly: true, reservationAtEpochMs: time1 };
    const [current, ...otherClaims] = storage.readSegmentedStockPool(request).reservations;
    expect(otherClaims).toEqual([]);
    const allocation = current?.allocations[0];
    expect(current?.reservationId).toBe("store");
    expect(allocation).toBeDefined();
    expect(Object.isFrozen(allocation?.position)).toBe(true);
    await inventory.reservations.release({
      operationId: "close-local-hold", reservationId: "store", occurredAtEpochMs: time2,
    });
    expect(storage.readSegmentedStockPool({ ...request, reservationAtEpochMs: time2 }).reservations).toEqual([]);
    const earlier = storage.readSegmentedStockPool(request);
    expect(earlier.reservations).toEqual([current]);
    expect(Object.isFrozen(earlier.reservations[0]?.allocations[0]?.quantity)).toBe(true);
  });

  it("samples default preview time after reading the published claim revision", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    let now = time1;
    const inventory = createTestInventory(storage, undefined, { nowEpochMs: () => now });
    await receiveKnownLots(inventory);
    const readHead = storage.readSegmentedStockHead.bind(storage);
    const planning: InventorySegmentedStockPlanningCapability = storage;
    vi.spyOn(planning, "readSegmentedStockHead").mockImplementationOnce(async () => {
      // The async adapter yields while another client publishes a newer hold.
      now = time2;
      await inventory.reservations.reserve({
        operationId: "claim-preview", reservationId: "preview", itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", lotIds: ["old"] },
        requested: parseQuantity("2", "piece"), createdAtEpochMs: time2,
      });
      await inventory.reservations.allocateByPolicy({
        operationId: "allocate-preview", reservationId: "preview", occurredAtEpochMs: time2,
        method: InventoryAllocationMethod.Fifo,
      });
      return readHead();
    });
    const request = { selector, amount: stockAmount("1", "piece"), method: InventoryAllocationMethod.Fifo };
    const current = await inventory.read.planAllocation(request);
    expect(current.lines[0]?.position.lotId).toBe("young");
    const historical = await inventory.read.planAllocation({ ...request, atEpochMs: time1 });
    expect(historical.lines[0]?.position.lotId).toBe("old");
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
