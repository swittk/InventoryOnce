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
  InventoryReservationStatus,
  InventoryStockWhereaboutsState,
  InventoryTrackingRequirement,
  inventoryCatalogSnapshot,
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
import { createInventoryTransferManyEvent, defineInventoryEvent, planInventoryAllocation } from "../src/kernel.js";
import { InMemoryInventorySegmentedPlacementStore } from "../src/segmented-placement.js";
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
  it.each([false, true])("validates fixed-package effects and broad claims at exact scale (grouped: %s)", async (grouped) => {
    const item = measuredItemCatalog("pieces").activeItem("measured");
    const packageId = "precise-weight-box";
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId },
      packagingRevisions: [{
        revisionId: packageId, itemId: item.itemId, itemRevisionId: item.revisionId, packageUnit: unitCode("box"),
        fixedContents: {
          primary: { axisId: "pieces", quantity: parseQuantity("1.000000000000000", "piece") },
          independent: [{ axisId: "weight", quantity: parseQuantity("1.000000000000000", "kg") }],
        },
      }],
    });
    const inventory = createTestInventory(undefined, catalog);
    const to = { itemId: item.itemId, placementNodeId: "store" };
    const lines = grouped
      ? [{ to, amount: packageAmount(5, packageId) }, { to, amount: packageAmount(5, packageId) }]
      : [{ to, amount: packageAmount(10, packageId) }];
    const received = await inventory.stock.receiveMany({
      operationId: "receive-grouped-precise-packages", occurredAtEpochMs: time0,
      lines,
    });
    const storedWeight = parseQuantity("10.00000000000000", "kg");
    expect(received.event.stockEffects).toMatchObject([{
      measurementsDelta: { independent: [{ quantity: storedWeight }] },
    }]);
    expect(() => defineInventoryEvent({
      catalog, event: { ...received.event, stockEffects: received.event.stockEffects.map((effect) => ({
        ...effect,
        measurementsDelta: {
          ...effect.measurementsDelta,
          independent: [{ axisId: "weight", quantity: parseQuantity("9.00000000000000", "kg") }],
        },
      })) },
    })).toThrow("does not match the same whole package count");
    const storedPieces = parseQuantity("10.00000000000000", "piece");
    await inventory.reservations.reserve({
      reservationId: "claim-grouped-precise-packages", operationId: "reserve-grouped-precise-packages",
      itemRevisionId: item.revisionId, selector: { itemId: item.itemId }, requested: storedPieces, createdAtEpochMs: time1,
    });
    expect((await inventory.read.reservationFeasibility(time2)).groups).toMatchObject([{
      requested: storedPieces, fulfillable: storedPieces, shortage: parseQuantity("0.000000000000000", "piece"),
    }]);
  });

  it("publishes a witnessed issue and a later exact-position shortage in the same batch", async () => {
    for (const storage of [createInMemoryInventoryDurableStorage(), createInMemoryInventoryDurableStorage({ failpoint: () => undefined })]) {
      const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      const from = loosePosition("store");
      const amount = stockAmount("1", "piece");
      await inventory.stock.receive({ operationId: "receive-for-shared-issue", occurredAtEpochMs: time0, to: from, amount });
      const request = { selector, method: InventoryAllocationMethod.Fifo, amount };
      const command = {
        operationId: "shared-issue", occurredAtEpochMs: time1,
        requests: [
          { ...request, requestId: "witnessed" },
          { ...request, requestId: "shortage", deficitPosition: from },
        ],
      };
      const result = await inventory.stock.issueManyByPolicy(command);
      expect(result.allocations).toMatchObject([
        { requestId: "witnessed", lines: [{ allocatedPrimary: parseQuantity("1", "piece"), layerStartedAtEpochMs: time0 }] },
        { requestId: "shortage", lines: [], deficit: { primary: parseQuantity("1", "piece") } },
      ]);
      expect(result.event.stockEffects).toMatchObject([{
        measurementsDelta: { primary: { quantity: parseQuantity("-2", "piece") } },
      }]);
      expect(result.event.stockEffects[0]?.metadata).toBeUndefined();
      expect(await inventory.read.positions(selector)).toMatchObject([{
        measurements: { primary: { quantity: parseQuantity("-1", "piece") } },
      }]);
      expect(await inventory.stock.issueManyByPolicy(command)).toEqual({ ...result, replayed: true });
    }
  });

  it("keeps positive stock outside the owner scope out of a recorded movement", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
    const outside = loosePosition("store", { ownerId: "owner-b" });
    const inside = loosePosition("store", { ownerId: "owner-a" });
    await inventory.stock.receive({
      operationId: "receive-outside-owner", occurredAtEpochMs: time0, to: outside, amount: stockAmount("5", "piece"),
    });
    const before = storage.readSegmentedStockHead();
    const request = {
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"], ownerIds: ["owner-a"] }),
      method: InventoryAllocationMethod.Fifo, amount: stockAmount("2", "piece"),
    };
    await expect(inventory.stock.transferByPolicy({
      ...request, deficitPosition: outside, operationId: "transfer-outside-owner", occurredAtEpochMs: time1,
      toPlacementNodeId: "destination",
    })).rejects.toThrow("positive stock outside the selected stock scope");
    await expect(inventory.stock.scrapByPolicy({
      ...request, deficitPosition: outside, operationId: "scrap-outside-owner", occurredAtEpochMs: time1, reason: "Discarded",
    })).rejects.toThrow("positive stock outside the selected stock scope");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    const moved = await inventory.stock.transferByPolicy({
      ...request, deficitPosition: inside, operationId: "transfer-owner-shortage", occurredAtEpochMs: time1,
      toPlacementNodeId: "destination",
    });
    expect(moved.event.unwitnessedStockMovements).toMatchObject([{
      from: inside, to: { ownerId: "owner-a", placementNodeId: "destination" },
      measurements: { primary: { quantity: parseQuantity("2", "piece") } },
    }]);
    expect(await inventory.read.positions({ itemId: "item-a", ownerIds: ["owner-b"] })).toMatchObject([
      { key: outside, measurements: { primary: { quantity: parseQuantity("5", "piece") } } },
    ]);
  });

  it.each([
    { verb: "receive", values: ["0.1", "9007199254740990", "0.9"] },
    { verb: "transfer", values: ["9007199254740990", "0.9", "0.1"] },
    { verb: "issue", values: ["0.9", "9007199254740990", "0.1"] },
    { verb: "policy transfer", values: ["9007199254740990", "0.1", "0.9"] },
    { verb: "policy issue", values: ["9007199254740990", "0.9", "0.1"] },
    { verb: "policy transfer", values: ["0.1", "0.9", "9007199254740990"] },
    { verb: "policy issue", values: ["0.9", "0.1", "9007199254740990"], canonical: true },
  ])("stores the exact final total of duplicate $verb lines in order $values", async ({ verb, values, canonical }) => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const storage = canonical ? createInMemoryInventoryDurableStorage({ failpoint: () => undefined }) : undefined;
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const source = { itemId: item.itemId, placementNodeId: "store" };
    // An independent tenths calculation fixes the expected durable quantity for every ordering.
    const tenths = values.reduce((sum, value) => {
      const [whole, fraction = "0"] = value.split(".");
      return sum + BigInt(whole ?? "0") * 10n + BigInt(fraction);
    }, 0n);
    expect(tenths).toBe(BigInt(Number.MAX_SAFE_INTEGER) * 10n);
    const total = (tenths / 10n).toString();
    if (verb !== "receive") {
      await inventory.stock.receive({ operationId: "receive-batch-total", occurredAtEpochMs: time0,
        to: source, amount: stockAmount(total, "kg") });
    }
    const header = { operationId: "merge-exact-batch-total", occurredAtEpochMs: time1 };
    const amounts = values.map((value) => stockAmount(value, "kg"));
    const requests = amounts.map((amount, index) => ({ requestId: String(index), amount,
      method: index === 1 ? InventoryAllocationMethod.Fefo : InventoryAllocationMethod.Fifo,
      selector: { itemId: item.itemId, placementNodeIds: ["store"] } }));
    /** Submit or replay the same public batch. */
    const execute = async () => {
      switch (verb) {
        case "receive": return inventory.stock.receiveMany({ ...header, lines: amounts.map((amount) => ({ to: source, amount })) });
        case "transfer": return inventory.stock.transferMany({ ...header, lines: amounts.map((amount) => ({ from: source, amount, toPlacementNodeId: "destination" })) });
        case "issue": return inventory.stock.issueMany({ ...header, lines: amounts.map((amount) => ({ from: source, amount })) });
        default: {
          const result = verb === "policy transfer"
            ? await inventory.stock.transferManyByPolicy({ ...header, requests, toPlacementNodeId: "destination" })
            : await inventory.stock.issueManyByPolicy({ ...header, requests });
          expect(result.allocations.map((allocation) => allocation.lines.map((line) => line.allocatedPrimary)))
            .toEqual(values.map((value) => [parseQuantity(value, "kg")]));
          expect(result.allocations.every((allocation) => allocation.deficit === undefined)).toBe(true);
          return result;
        }
      }
    };
    const first = await execute();
    const polarized = first.event.stockEffects.map((effect) => effect.measurementsDelta.primary.quantity);
    const positive = parseQuantity(total, "kg");
    const negative = parseQuantity(`-${total}`, "kg");
    const expected = verb === "receive" ? [positive] : verb.endsWith("transfer") ? [positive, negative] : [negative];
    expect(polarized).toEqual(expected);
    const publishedSource = await inventory.read.positions({ itemId: item.itemId, placementNodeIds: ["store"] });
    expect(publishedSource.map((position) => position.measurements.primary.quantity))
      .toEqual(verb === "receive" ? [positive] : []);
    if (verb.endsWith("transfer")) {
      const publishedDestination = await inventory.read.positions({ itemId: item.itemId, placementNodeIds: ["destination"] });
      expect(publishedDestination.map((position) => position.measurements.primary.quantity)).toEqual([positive]);
    }
    expect(await execute()).toEqual({ ...first, replayed: true });
  });

  it("keeps a temporarily unstorable signed deficit exact and rejects an unstorable final balance", async () => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const deficitPosition = { itemId: item.itemId, placementNodeId: "store", lotId: "recorded-shortfall" };
    const baseRequest = {
      selector: { itemId: item.itemId, placementNodeIds: ["store"] },
      method: InventoryAllocationMethod.Fefo, deficitPosition,
    };
    await inventory.stock.issueByPolicy({
      ...baseRequest, operationId: "large-existing-deficit", occurredAtEpochMs: time0, amount: stockAmount("9007199254740990", "kg"),
    });
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const before = storage.readSegmentedStockHead();
    /** Submit these ordered amounts against the same signed deficit row. */
    const issue = (operationId: string, values: readonly string[]) => inventory.stock.issueManyByPolicy({
      operationId, occurredAtEpochMs: time1,
      requests: values.map((value) => ({ ...baseRequest, requestId: value, amount: stockAmount(value, "kg") })),
    });
    await expect(issue("unstorable-final-deficit", ["0.1"])).rejects.toThrow("safe integer storage range");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await storage.readOperation("unstorable-final-deficit")).toBeUndefined();
    const result = await issue("storable-final-deficit", ["0.1", "0.9"]);
    expect(result.allocations.map((allocation) => allocation.deficit?.primary))
      .toEqual(["0.1", "0.9"].map((value) => parseQuantity(value, "kg")));
    expect(await inventory.read.positions(baseRequest.selector)).toMatchObject([{
      key: deficitPosition,
      measurements: { primary: { quantity: parseQuantity("-9007199254740991", "kg") } },
    }]);
    expect(await issue("storable-final-deficit", ["0.1", "0.9"])).toEqual({ ...result, replayed: true });
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("uses exact unheld capacity when the physical balance and its hold have different scales", async () => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog);
    const position = { itemId: item.itemId, placementNodeId: "store" };
    const scope = { itemId: item.itemId, placementNodeIds: ["store"] };
    const held = parseQuantity("0.1", "kg");
    const method = InventoryAllocationMethod.Fifo;
    await inventory.stock.receive({ operationId: "large-held-position", occurredAtEpochMs: time0,
      to: position, amount: stockAmount("9007199254740991", "kg") });
    await inventory.reservations.reserve({
      operationId: "hold-fractional-quantity", reservationId: "fractional", itemRevisionId: item.revisionId,
      selector: scope, requested: held, createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-fractional-quantity", reservationId: "fractional", method, occurredAtEpochMs: time1,
    });
    const preview = await inventory.read.planAllocation({
      selector: scope, amount: stockAmount("0.9", "kg"), method, atEpochMs: time2,
    });
    expect(preview.lines.map((line) => line.allocatedPrimary)).toEqual([parseQuantity("0.9", "kg")]);
    const result = await inventory.stock.issueManyByPolicy({
      operationId: "issue-separate-from-fractional-hold", occurredAtEpochMs: time2,
      requests: ["0.9", "0.1"].map((value) => ({
        requestId: value, selector: scope, amount: stockAmount(value, "kg"), method,
      })),
    });
    expect(result.allocations.map((allocation) => allocation.lines.map((line) => line.allocatedPrimary)))
      .toEqual([[parseQuantity("0.9", "kg")], [held]]);
    expect((await inventory.read.reservation("fractional"))?.allocations.map((allocation) => allocation.quantity))
      .toEqual([held]);
  });

  it("returns the selected lot when an unselected lot absorbs a fractional deficit", async () => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const position = { itemId: item.itemId, placementNodeId: "store" };
    for (const [lotId, value] of [["a-large", "9007199254740991"], ["b-selected", "1"]] as const) {
      await inventory.stock.receive({ operationId: lotId, occurredAtEpochMs: time0,
        to: { ...position, lotId }, amount: stockAmount(value, "kg") });
    }
    await inventory.stock.issue({ operationId: "fractional-pool-shortfall", occurredAtEpochMs: time1,
      from: { ...position, lotId: "debt" }, amount: stockAmount("0.1", "kg") });
    const selector = inventoryStockSelector(item.itemId, { placementNodeIds: ["store"], lotIds: ["b-selected"] });
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const result = await readInventoryScopedStockAvailability({
      storage, catalog, selector, itemRevisionId: item.revisionId, atEpochMs: time2,
    });
    expect(result).toMatchObject({
      unallocatedUsablePhysical: parseQuantity("1", "kg"),
      deficit: { primary: { quantity: parseQuantity("0", "kg") } },
      positions: [{ position: { key: { lotId: "b-selected" } }, unallocatedUsablePhysical: parseQuantity("1", "kg") }],
    });
    expect(readWorld).not.toHaveBeenCalled();
  });

  it.each([
    { report: "physical", values: ["9007199254740990", "0.1", "0.9"] },
    { report: "physical", values: ["0.1", "0.9", "9007199254740990"] },
    { report: "expired", values: ["9007199254740990", "0.1", "0.9"] },
    { report: "deficit", values: ["9007199254740990", "0.1", "0.9"] },
    { report: "held", values: ["9007199254740990", "0.1", "0.9"] },
    { report: "broad", values: ["9007199254740990", "0.1", "0.9"] },
  ])("reports exact $report totals after summing $values", async ({ report, values }) => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    const placementNodeId = "store";
    const selector = inventoryStockSelector(item.itemId, { placementNodeIds: [placementNodeId] });
    const rows = values.map((value, index) => ({ lotId: String(index), value }));
    for (const { lotId, value } of rows) {
      const position = { itemId: item.itemId, placementNodeId, lotId };
      const header = { operationId: lotId, occurredAtEpochMs: time0, amount: stockAmount(value, "kg") };
      if (report === "deficit") {
        await inventory.stock.issue({ ...header, from: position });
      } else {
        await inventory.stock.receive({ ...header, to: position,
          ...(report === "expired" ? { lot: { expiresAtEpochMs: time1 } } : {}) });
      }
    }
    if (report === "held" || report === "broad") {
      // Establish the fractions first so each published claim total fits storage.
      for (const { lotId, value } of [...rows.slice(1), ...rows.slice(0, 1)]) {
        await inventory.reservations.reserve({
          operationId: "hold-" + lotId, reservationId: lotId, itemRevisionId: item.revisionId,
          selector: { ...selector, lotIds: [lotId] }, requested: parseQuantity(value, "kg"), createdAtEpochMs: time1,
        });
        if (report === "held") {
          await inventory.reservations.allocateByPolicy({
            operationId: "allocate-" + lotId, reservationId: lotId, occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
          });
        }
      }
    }
    const zero = parseQuantity("0", "kg");
    const max = parseQuantity("9007199254740991", "kg");
    const total = report === "deficit" ? parseQuantity("-9007199254740991", "kg") : max;
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const scope = { storage, catalog, selector, itemRevisionId: item.revisionId, atEpochMs: time2 };
    const scoped = await readInventoryScopedStockAvailability(scope);
    const stock = (await inventory.read.summary(selector)).revisions[0];
    expect(readWorld).not.toHaveBeenCalled();
    readWorld.mockRestore();
    expect(stock).toMatchObject({
      total: { primary: { quantity: total } },
      deficit: { primary: { quantity: report === "deficit" ? max : zero } },
      byPlacementNode: [{ valueId: placementNodeId, positionCount: 3, measurements: { primary: { quantity: total } } }],
    });
    expect(scoped).toMatchObject({
      onHand: { primary: { quantity: total } },
      expiredOnHand: { primary: { quantity: report === "expired" ? max : zero } },
      exactlyAllocatedUsable: report === "held" ? max : zero,
    });
    const unallocated = report === "physical" || report === "broad" ? max
      : report === "expired" ? zero : parseQuantity("0.0", "kg");
    expect(scoped.unallocatedUsablePhysical).toEqual(unallocated);
    expect((await inventory.read.availability(selector, time2)).revisions[0]).toMatchObject({
      ...scoped, broadRequested: report === "broad" ? max : zero,
    });
    if (report === "physical") {
      await inventory.stock.receive({ operationId: "unstorable-final-report", occurredAtEpochMs: time1,
        to: { itemId: item.itemId, placementNodeId, lotId: "overflow" }, amount: stockAmount("0.1", "kg") });
      await expect(readInventoryScopedStockAvailability(scope)).rejects.toThrow("safe integer storage range");
      await expect(inventory.read.summary(selector)).rejects.toThrow("safe integer storage range");
    }
  });

  it("fulfills a storable claim against a wide post-deficit capacity", async () => {
    const item = defineScalarInventoryItem({ itemId: "bulk", revisionId: "bulk-v1", axisId: "weight", unit: "kg" });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { bulk: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const position = { itemId: item.itemId, placementNodeId: "store" };
    await inventory.stock.receive({ operationId: "receive-large", occurredAtEpochMs: time0,
      to: { ...position, lotId: "large" }, amount: stockAmount("9007199254740991", "kg") });
    await inventory.stock.issue({ operationId: "record-fractional-deficit", occurredAtEpochMs: time0,
      from: { ...position, lotId: "deficit" }, amount: stockAmount("0.1", "kg") });
    const requested = parseQuantity("0.9", "kg");
    await inventory.reservations.reserve({
      operationId: "reserve-small", reservationId: "small", itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["large"] },
      requested, createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-small", reservationId: "small", occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
    });
    expect(await inventory.read.reservationFeasibility(time2)).toMatchObject({
      status: "feasible", groups: [{ requested, fulfillable: requested, shortage: parseQuantity("0.0", "kg") }],
    });
  });

  it("considers a later measured witness when a private row cannot supply a storable whole amount", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    /** Resolve one report in pieces and independently measured kilograms. */
    const amount = (pieces: string, weight: string) =>
      measuredStockAmount(pieces, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]);
    const unlabelled = { itemId: "measured", placementNodeId: "store" };
    const labelled = { ...unlabelled, lotId: "witness" };
    await inventory.stock.receive({ operationId: "large-measured-row", occurredAtEpochMs: time0,
      to: unlabelled, amount: amount("3", "9007199254740991") });
    await inventory.stock.receive({ operationId: "smaller-measured-row", occurredAtEpochMs: time1,
      to: labelled, amount: amount("2", "1") });
    const allLots = { itemId: "measured", placementNodeIds: ["store"] };
    const missingLot = { ...allLots, lotIds: ["unwitnessed"] };
    const method = InventoryAllocationMethod.Fifo;
    const result = await inventory.stock.transferManyByPolicy({
      operationId: "ordered-measured-witness", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      requests: [
        { requestId: "first", amount: amount("1", "0.1"), method, selector: missingLot },
        { requestId: "known", amount: amount("2", "1"), method, selector: allLots },
        { requestId: "last", amount: amount("1", "0.9"), method, selector: missingLot },
      ],
    });
    expect(result.allocations.map((allocation) => allocation.lines.map((line) => line.position.lotId)))
      .toEqual([[], ["witness"], []]);
    expect(result.event.positiveLayerProvenanceTransfers).toMatchObject([{ from: labelled }]);
    expect(await inventory.read.positions(allLots)).toMatchObject([{
      key: unlabelled,
      measurements: {
        primary: { quantity: parseQuantity("1", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("9007199254740990", "kg") }],
      },
    }]);
  });

  it("rejects a duplicate receipt whose completed posting cannot be stored", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const before = storage.readSegmentedStockHead();
    const operationId = "unstorable-completed-receipt";
    await expect(inventory.stock.receiveMany({
      operationId, occurredAtEpochMs: time0,
      lines: [String(Number.MAX_SAFE_INTEGER), "0.1"].map((value) => ({
        to: loosePosition("store"), amount: stockAmount(value, "piece"),
      })),
    })).rejects.toThrow("safe integer storage range");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await storage.readOperation(operationId)).toBeUndefined();
  });

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
    expect(result.event.stockEffects.map((effect) => effect.measurementsDelta.primary.quantity))
      .toEqual([parseQuantity("9007199254740991", "kg"), parseQuantity("-9007199254740991", "kg")]);
  });

  it.each([
    { method: InventoryAllocationMethod.Fifo, requested: "6", lastCount: "4", remaining: "2" },
    { method: InventoryAllocationMethod.Fefo, requested: "6", lastCount: "4", remaining: "2" },
    { method: InventoryAllocationMethod.Fifo, requested: "7", lastCount: "8", remaining: "3" },
    { method: InventoryAllocationMethod.Fefo, requested: "7", lastCount: "8", remaining: "3" },
  ])(
    "records a compatible measured shortage of $remaining pieces with $method", async ({ method, requested, lastCount, remaining }) => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const { lotId, count, weight, expiresAtEpochMs } of [
      { lotId: "a", count: "4", weight: "4", expiresAtEpochMs: time3 + 200 },
      { lotId: "b", count: "2", weight: "4", expiresAtEpochMs: time3 + 100 },
      { lotId: "c", count: lastCount, weight: "10", expiresAtEpochMs: time3 },
    ]) {
      await inventory.stock.receive({
        operationId: `receive-measured-${lotId}`, occurredAtEpochMs: time0,
        to: { itemId: "measured", lotId, placementNodeId: "store" },
        lot: { expiresAtEpochMs },
        amount: measuredStockAmount(count, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "transfer-weighed-pieces", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method,
      amount: measuredStockAmount(requested, "piece", [{ axisId: "weight", value: "5", unit: "kg" }]),
    });
    expect(result.event.positiveLayerProvenanceTransfers).toMatchObject([{ from: { lotId: "a" } }]);
    expect(result.event.unwitnessedStockMovements?.map((portion) => portion.measurements)).toEqual([{
      primary: { axisId: "pieces", quantity: parseQuantity(remaining, "piece") },
      independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
    }]);
  });

  it("picks a larger compatible witness when a whole measured FIFO prefix leaves an increment gap", async () => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, count, weight, occurredAtEpochMs] of [
      ["older", "5", "4", time0], ["later-a", "3", "2", time1], ["later-b", "3", "2", time1],
    ] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}`, occurredAtEpochMs,
        to: { itemId: "measured", lotId, placementNodeId: "store" },
        amount: measuredStockAmount(count, "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "report-seven-measured-pieces", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("7", "piece", [{ axisId: "weight", value: "5", unit: "kg" }]),
    });
    expect(result.event.positiveLayerProvenanceTransfers?.map((line) => line.from.lotId))
      .toEqual(["later-a", "later-b"]);
    expect(result.event.unwitnessedStockMovements?.map((portion) => portion.measurements)).toEqual([{
      primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
      independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
    }]);
  });

  it.each([false, true])("separates a measured physical shortage from a split-required report (second lot: %s)", async (secondLot) => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    for (const lotId of secondLot ? ["earlier", "later"] : ["earlier"]) {
      await inventory.stock.receive({
        operationId: `receive-split-${lotId}`, occurredAtEpochMs: time0,
        to: { itemId: "measured", lotId, placementNodeId: "store" },
        amount: measuredStockAmount("2", "piece", [{ axisId: "weight", value: "2.0", unit: "kg" }]),
      });
    }
    const before = storage.readSegmentedStockHead();
    const report = inventory.stock.transferByPolicy({
      operationId: "report-split-or-shortage", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: "measured", placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("3", "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    });
    if (secondLot) {
      await expect(report).rejects.toThrow("increments cannot be split");
      expect(storage.readSegmentedStockHead()).toEqual(before);
    } else {
      expect((await report).event.unwitnessedStockMovements).toMatchObject([{
        measurements: {
          primary: { quantity: parseQuantity("1", "piece") },
          independent: [{ quantity: parseQuantity("1.0", "kg") }],
        },
      }]);
    }
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
          expect(credit.position.placementNodeId).toBe("destination");
          expect(credit.measurementsDelta).toEqual({
            primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
            independent: [{ axisId: "weight", quantity: parseQuantity("4", "kg") }],
          });
        }
      }
      const claim = (await inventory.read.reservationFeasibility(time2)).groups[0];
      expect(claim).toMatchObject({ reservationIds: ["weight"], shortage: parseQuantity("4", "kg") });
      const reservation = await inventory.read.reservation("weight");
      expect(reservation?.status).toBe(InventoryReservationStatus.Active);
      expect(reservation?.allocations).toEqual([{ position: heldRow.key, quantity }]);
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
    const sourceBefore = await inventory.read.positions(selector);
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
    expect(await inventory.read.positions(selector)).toEqual(sourceBefore);
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
          primary: { quantity: parseQuantity("2", "piece") },
          independent: [{ axisId: "weight", quantity: parseQuantity("20", "kg") }],
        },
      }]);
      const knownDebit = result.event.stockEffects.find(
        (effect) => effect.position.lotId === "known" && effect.position.placementNodeId === "store"
      );
      expect(knownDebit?.measurementsDelta.independent[0]?.quantity).toEqual(parseQuantity("-10", "kg"));
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
        primary: { quantity: parseQuantity(String(remaining), "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("5", "kg") }],
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
        primary: { quantity: parseQuantity("3", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("30", "kg") }],
      },
    }]);
    expect(result.event.stockEffects).toHaveLength(2);
    expect(await inventory.read.positions({ itemId: "measured", lotIds: ["heavy"] })).toMatchObject([
      { key: { placementNodeId: "store" } },
    ]);
  });

  it.each([false, true])("keeps a physical split diagnosis when held stock ties the preferred witness (%s)", async (held) => {
    const inventory = createTestInventory(undefined, measuredItemCatalog("pieces"), undefined, InventoryDeficitPolicy.Record);
    const selector = { itemId: "measured", placementNodeIds: ["store"] };
    const lotAmount = measuredStockAmount("2", "piece", [{ axisId: "weight", value: "2", unit: "kg" }]);
    await inventory.stock.receive({
      operationId: "receive-free", occurredAtEpochMs: time0,
      to: { itemId: selector.itemId, placementNodeId: "store", lotId: "free" }, amount: lotAmount,
    });
    if (held) {
      const scoped = { ...selector, lotIds: ["held"] };
      await inventory.stock.receive({
        operationId: "receive-held", occurredAtEpochMs: time1,
        to: { itemId: selector.itemId, placementNodeId: "store", lotId: "held" }, amount: lotAmount,
      });
      const row = (await inventory.read.positions(scoped))[0];
      if (row === undefined) throw new Error("Missing held witness.");
      const quantity = parseQuantity("2", "piece");
      await inventory.reservations.reserve({
        operationId: "reserve-held", reservationId: "held", itemRevisionId: "measured-v1",
        selector: scoped, requested: quantity, createdAtEpochMs: time1,
      });
      await inventory.reservations.allocate({
        operationId: "allocate-held", reservationId: "held", occurredAtEpochMs: time1,
        allocations: [{ position: row.key, quantity }],
      });
    }
    const transfer = {
      operationId: "transfer-measured-residual", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("3", "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    };
    if (held) {
      const before = await inventory.read.world();
      await expect(inventory.stock.transferByPolicy(transfer)).rejects.toThrow("intact package/serial increments");
      expect(await inventory.read.world()).toEqual(before);
    } else {
      const result = await inventory.stock.transferByPolicy(transfer);
      expect(result.event.unwitnessedStockMovements).toMatchObject([{
        measurements: {
          primary: { quantity: parseQuantity("1", "piece") },
          independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
        },
      }]);
    }
  });

  it.each([false, true])("rejects a measured split of the package left in a picked row (canonical: %s)", async (canonical) => {
    const item = measuredItemCatalog("pieces").activeItem("measured");
    const packageId = "two-piece-fixed-weight-pack";
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { [item.itemId]: item.revisionId },
      packagingRevisions: [{
        revisionId: packageId, itemId: item.itemId, itemRevisionId: item.revisionId, packageUnit: unitCode("pack"),
        fixedContents: {
          primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
          independent: [{ axisId: "weight", quantity: parseQuantity("2", "kg") }],
        },
      }],
    });
    const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : undefined);
    const inventory = createTestInventory(storage, catalog, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({
      operationId: "receive-two-fixed-weight-packs", occurredAtEpochMs: time0,
      to: { itemId: item.itemId, placementNodeId: "store", lotId: "same-row" }, amount: packageAmount(2, packageId),
    });
    const before = await inventory.read.world();
    const transfer = {
      occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: item.itemId, placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
    };
    await expect(inventory.stock.transferByPolicy({
      ...transfer, operationId: "reject-split-of-second-pack",
      amount: measuredStockAmount("3", "piece", [{ axisId: "weight", value: "3", unit: "kg" }]),
    })).rejects.toThrow("intact package/serial increments");
    expect(await inventory.read.world()).toEqual(before);
    expect(await storage.readOperation("reject-split-of-second-pack")).toBeUndefined();
    const shortage = await inventory.stock.transferByPolicy({
      ...transfer, operationId: "record-shortage-after-two-packs",
      amount: measuredStockAmount("5", "piece", [{ axisId: "weight", value: "5", unit: "kg" }]),
    });
    expect(shortage.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("1", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
      },
    }]);
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
        primary: { quantity: parseQuantity(String(Number.MAX_SAFE_INTEGER - 1), "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("20", "kg") }],
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
        primary: { quantity: parseQuantity(String(Number.MAX_SAFE_INTEGER - 3), "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
      },
    }]);
  });

  it.each([
    { volumeCase: "none", volume: undefined },
    { volumeCase: "primary", volume: "0.001" },
    { volumeCase: "volume", volume: "1" },
    { volumeCase: "fixed-package-volume", volume: "1" },
    { volumeCase: "insufficient-volume", volume: "0.0006" },
    { volumeCase: "combined-volume", volume: "0.0006" },
  ])("records exact witnesses and remainder for $volumeCase", async ({ volumeCase, volume }) => {
    const item = defineInventoryItem({
      itemId: "material", revisionId: "material-v1",
      primaryAxis: {
        axisId: "weight", role: InventoryMeasurementAxisRole.Primary,
        unit: unitCode("kg"), requirement: InventoryMeasurementRequirement.Required,
      },
      independentAxes: [{
        axisId: "volume", role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("L"), requirement: InventoryMeasurementRequirement.Optional,
      }],
      reservationAxisId: "weight",
      tracking: { lot: InventoryTrackingRequirement.Optional, serial: InventoryTrackingRequirement.Optional },
      qualifiedDimensions: [],
    });
    const packaging = {
      revisionId: "measured-package", itemId: item.itemId, itemRevisionId: item.revisionId, packageUnit: unitCode("pack"),
      fixedContents: {
        primary: { axisId: "weight", quantity: parseQuantity("1", "kg") },
        independent: [{ axisId: "volume", quantity: parseQuantity("1", "L") }],
      },
    };
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { material: item.revisionId }, packagingRevisions: [packaging],
    });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, occurredAtEpochMs] of [["older", time0], ["newer", time1]] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}`, occurredAtEpochMs,
        to: { itemId: item.itemId, placementNodeId: "store", lotId }, amount: stockAmount("5", "kg"),
      });
    }
    if (volume !== undefined) {
      const amount = volumeCase === "fixed-package-volume"
        ? packageAmount(2, packaging.revisionId)
        : measuredStockAmount(volumeCase === "primary" ? "6" : "1", "kg", [
            { axisId: "volume", value: volume, unit: "L" },
          ]);
      await inventory.stock.receive({
        operationId: "receive-later-measured-lot", occurredAtEpochMs: time2,
        to: { itemId: item.itemId, placementNodeId: "store", lotId: "measured-later" },
        amount,
      });
    }
    const combinedVolume = volumeCase === "combined-volume";
    if (combinedVolume) {
      await inventory.stock.receive({
        operationId: "receive-other-measured-lot", occurredAtEpochMs: time2,
        to: { itemId: item.itemId, placementNodeId: "store", lotId: "measured-other" },
        amount: measuredStockAmount("1", "kg", [{ axisId: "volume", value: "0.0004", unit: "L" }]),
      });
    }
    const result = await inventory.stock.transferByPolicy({
      operationId: "transfer-with-unwitnessed-volume", occurredAtEpochMs: time3, toPlacementNodeId: "destination",
      selector: { itemId: item.itemId, placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount(combinedVolume ? "7" : "5.000001", "kg", [
        { axisId: "volume", value: "0.001", unit: "L" },
      ]),
    });
    const arrived = await inventory.read.positions({ itemId: item.itemId, placementNodeIds: ["destination"] });
    if (combinedVolume) {
      expect(arrived.map(({ key }) => key.lotId).sort()).toEqual(["measured-later", "measured-other", "older"]);
      expect(result.event.unwitnessedStockMovements).toBeUndefined();
      return;
    }
    expect(arrived.find(({ key }) => key.lotId === "older")?.measurements.primary.quantity).toEqual(parseQuantity("5.000000", "kg"));
    expect(arrived.filter(({ key }) => key.lotId !== undefined).map(({ key }) => key.lotId)).toEqual(["older"]);
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("0.000001", "kg") },
        independent: [{ axisId: "volume", quantity: parseQuantity("0.001", "L") }],
      },
    }]);
  });

  it("records a proven measured remainder when the stock pool exceeds the search depth", async () => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: base.independentAxes.map((axis) => ({ ...axis, requirement: InventoryMeasurementRequirement.Optional })),
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { [item.itemId]: item.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receiveMany({
      operationId: "receive-deep-measured-pool", occurredAtEpochMs: time0,
      lines: Array.from({ length: 5_001 }, (_, index) => ({
        to: { itemId: item.itemId, placementNodeId: "store", lotId: `lot-${String(index).padStart(4, "0")}` },
        amount: stockAmount("1", "piece"),
      })),
    });
    const result = await inventory.stock.transferByPolicy({
      operationId: "record-deep-measured-pool", occurredAtEpochMs: time1, toPlacementNodeId: "destination",
      selector: { itemId: item.itemId, placementNodeIds: ["store"] }, method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("2", "piece", [{ axisId: "weight", value: "1", unit: "kg" }]),
    });
    const selected = result.event.stockEffects.filter((effect) =>
      effect.position.placementNodeId === "destination" && effect.position.lotId !== undefined
    );
    expect(selected).toMatchObject([{
      position: { lotId: "lot-0000" },
      measurementsDelta: { primary: { quantity: parseQuantity("1", "piece") } },
    }]);
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("1", "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
      },
    }]);
  }, 15_000);

  it("records a measured two-piece remainder from a whole-package allocation", async () => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: base.independentAxes.map((axis) => ({ ...axis, requirement: InventoryMeasurementRequirement.Optional })),
    });
    const packageId = "two-piece-pack";
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId },
      packagingRevisions: [{
        revisionId: packageId, itemId: item.itemId, itemRevisionId: item.revisionId, packageUnit: unitCode("pack"),
        fixedContents: { primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") }, independent: [] },
      }],
    });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    for (const [lotId, occurredAtEpochMs] of [["older", time0], ["newer", time1]] as const) {
      await inventory.stock.receive({
        operationId: `receive-${lotId}-packs`, occurredAtEpochMs,
        to: { itemId: item.itemId, placementNodeId: "store", lotId }, amount: packageAmount(150_000, packageId),
      });
    }
    const moved = await inventory.stock.transferByPolicy({
      operationId: "transfer-with-unwitnessed-package-weight", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      selector: { itemId: item.itemId, placementNodeIds: ["store"], packagingRevisionIds: [packageId] },
      method: InventoryAllocationMethod.Fifo,
      amount: packageAmount(250_000, packageId, [{ axisId: "weight", value: "1", unit: "kg" }]),
    });
    const arrived = await inventory.read.positions({ itemId: item.itemId, placementNodeIds: ["destination"] });
    expect(arrived.find(({ key }) => key.lotId === "older")?.measurements.primary.quantity).toEqual(parseQuantity("300000", "piece"));
    expect(arrived.find(({ key }) => key.lotId === "newer")?.measurements.primary.quantity).toEqual(parseQuantity("199998", "piece"));
    expect(moved.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("2", "piece") }, independent: [{ axisId: "weight", quantity: parseQuantity("1", "kg") }],
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
        primary: { quantity: parseQuantity(String(Number.MAX_SAFE_INTEGER - (hasLaterWitness ? 1 : 0)), "piece") },
        independent: [{ axisId: "weight", quantity: parseQuantity(hasLaterWitness ? "2" : "3", "kg") }],
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
        { reservationIds: ["hold-exact"], shortage: parseQuantity("4", "piece") },
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
      const expected = parseQuantity(String(deficit), "piece");
      expect(native.recordedDeficit).toEqual(expected);
      expect(native.uncoveredDeficit).toEqual(expected);
    }
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("selects stock using the requested reservation time", async () => {
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
    const beforeHold = await inventory.read.planAllocation({ ...request, reservationAtEpochMs: time1 });
    const atHold = await inventory.read.planAllocation(request);
    expect(beforeHold.lines).toMatchObject([{ position: { lotId: "old" }, allocatedPrimary: parseQuantity("1", "piece") }]);
    expect(atHold.lines).toMatchObject([{ position: { lotId: "young" }, allocatedPrimary: parseQuantity("1", "piece") }]);
  });

  it.each(["0", "1"])("treats an absent optional axis as zero for a report of $weight kg", async (weight) => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: base.independentAxes.map((axis) => ({ ...axis, requirement: InventoryMeasurementRequirement.Optional })),
    });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = { itemId: item.itemId, placementNodeId: "store" };
    await inventory.stock.receive({
      operationId: "receive-without-optional-weight", occurredAtEpochMs: time0,
      to: from, amount: stockAmount("1", "piece"),
    });
    const command = {
      operationId: "move-with-optional-weight", occurredAtEpochMs: time2, from, toPlacementNodeId: "destination",
      amount: measuredStockAmount("1", "piece", [{ axisId: "weight", value: weight, unit: "kg" }]),
    };
    if (weight === "0") {
      const moved = await inventory.stock.transfer(command);
      expect(moved.event.unwitnessedStockMovements).toBeUndefined();
      expect(moved.event.positiveLayerProvenanceTransfers).toHaveLength(1);
      expect(moved.event.stockEffects.map((effect) => effect.measurementsDelta.primary.quantity))
        .toEqual([parseQuantity("1", "piece"), parseQuantity("-1", "piece")]);
      expect(await inventory.stock.transfer(command)).toEqual({ ...moved, replayed: true });
    } else {
      const before = await inventory.read.world();
      await expect(inventory.stock.transfer(command)).rejects.toThrow("cannot partition independent measurements");
      expect(await inventory.read.world()).toEqual(before);
    }
  });

  it.each(["1", "2"])("keeps effect metadata only when it describes all $reported transferred pieces", async (reported) => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const from = loosePosition("store");
    await inventory.stock.receive({
      operationId: "receive-without-lot", occurredAtEpochMs: time0,
      to: from, amount: stockAmount("1", "piece"),
    });
    const metadata = { receipt: "witnessed-receipt" };
    const command = {
      operationId: "move-with-effect-metadata", occurredAtEpochMs: time2,
      lines: [{ from, toPlacementNodeId: "destination", amount: stockAmount(reported, "piece"), metadata }],
    };
    const result = await inventory.stock.transferMany(command);
    const effectMetadata = reported === "1" ? metadata : undefined;
    expect(result.event.stockEffects.map((effect) => effect.metadata)).toEqual([effectMetadata, effectMetadata]);
    expect(result.event.positiveLayerProvenanceTransfers).toHaveLength(1);
    expect(result.event.unwitnessedStockMovements?.map((portion) => portion.measurements.primary.quantity))
      .toEqual(reported === "1" ? undefined : [parseQuantity("1", "piece")]);
    expect(await inventory.stock.transferMany(command)).toEqual({ ...result, replayed: true });
  });

  it("preserves explicit zero measurements on witnessed routes in a mixed transfer", async () => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: base.independentAxes.map((axis) => ({ ...axis, requirement: InventoryMeasurementRequirement.Optional })),
    });
    const catalog = defineInventoryCatalog({ itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId } });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = { itemId: item.itemId, placementNodeId: "store" };
    const one = stockAmount("1", "piece");
    await inventory.stock.receive({ operationId: "mixed-zero-receive", occurredAtEpochMs: time0, to: from, amount: one });
    const command = {
      operationId: "mixed-zero-transfer", occurredAtEpochMs: time2,
      lines: [
        { from, toPlacementNodeId: "destination",
          amount: measuredStockAmount("1", "piece", [{ axisId: "weight", value: "0", unit: "kg" }]) },
        { from: { ...from, placementNodeId: "other" }, toPlacementNodeId: "other-destination", amount: one },
      ],
    };
    const moved = await inventory.stock.transferMany(command);
    expect(moved.event.unwitnessedStockMovements).toMatchObject([{
      from: { placementNodeId: "other" }, to: { placementNodeId: "other-destination" },
    }]);
    const witnessed = moved.event.stockEffects.filter((effect) =>
      effect.position.placementNodeId === "store" || effect.position.placementNodeId === "destination"
    );
    const zeroWeight = [{ axisId: "weight", quantity: parseQuantity("0", "kg") }];
    expect(witnessed).toMatchObject([
      { position: { placementNodeId: "destination" }, evidence: { transactedMeasurements: { independent: zeroWeight } } },
      { position: { placementNodeId: "store" }, evidence: { transactedMeasurements: { independent: zeroWeight } } },
    ]);
    expect(await inventory.stock.transferMany(command)).toEqual({ ...moved, replayed: true });
  });

  it.each([
    { packaged: false, reportedZero: true, policy: false },
    { packaged: true, reportedZero: true, policy: false },
    { packaged: false, reportedZero: false, policy: false },
    { packaged: true, reportedZero: false, policy: false },
    { packaged: false, reportedZero: true, policy: true },
    { packaged: true, reportedZero: true, policy: true },
  ])("keeps only reported optional axes on the remainder ($packaged packaged, $reportedZero zero, $policy policy)", async ({
    packaged, reportedZero, policy,
  }) => {
    const base = measuredItemCatalog("pieces").activeItem("measured");
    const item = defineInventoryItem({
      ...base,
      independentAxes: base.independentAxes.map((axis) => ({ ...axis, requirement: InventoryMeasurementRequirement.Optional })),
    });
    const packageId = "measured-box";
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { measured: item.revisionId },
      packagingRevisions: [{
        revisionId: packageId, itemId: item.itemId, itemRevisionId: item.revisionId, packageUnit: unitCode("box"),
        fixedContents: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
      }],
    });
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = { itemId: item.itemId, placementNodeId: "store" };
    const weight = [{ axisId: "weight", value: "0", unit: "kg" }];
    const received = reportedZero ? [] : weight;
    const reported = reportedZero ? weight : [];
    await inventory.stock.receive({
      operationId: "receive-remainder-axis", occurredAtEpochMs: time0, to: from,
      amount: packaged ? packageAmount(1, packageId, received) : measuredStockAmount("1", "piece", received),
    });
    const command = {
      operationId: "move-remainder-axis", occurredAtEpochMs: time2, from, toPlacementNodeId: "destination",
      amount: packaged ? packageAmount(2, packageId, reported) : measuredStockAmount("2", "piece", reported),
    };
    /** Commit or replay the same transfer using the selected public entry point. */
    const transfer = () => policy
      ? inventory.stock.transferByPolicy({
          operationId: command.operationId, occurredAtEpochMs: command.occurredAtEpochMs,
          amount: command.amount, toPlacementNodeId: command.toPlacementNodeId,
          method: InventoryAllocationMethod.Fifo,
          selector: inventoryStockSelector(item.itemId, { placementNodeIds: ["store"] }),
        })
      : inventory.stock.transfer(command);
    const moved = await transfer();
    expect(moved.event.unwitnessedStockMovements).toMatchObject([{
      measurements: {
        primary: { quantity: parseQuantity("1", "piece") },
        independent: reportedZero ? [{ axisId: "weight", quantity: parseQuantity("0", "kg") }] : [],
      },
    }]);
    const axes = moved.event.stockEffects.map((effect) => effect.evidence?.transactedMeasurements.independent.map(
      ({ axisId, quantity }) => [axisId, quantity.amountMinor === 0, quantity.unit, quantity.decimals],
    ));
    expect(axes).toEqual(reportedZero ? [[["weight", true, "kg", 0]], [["weight", true, "kg", 0]]] : [[], []]);
    expect(await transfer()).toEqual({ ...moved, replayed: true });
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
        expect(portion?.measurements.primary.quantity).toEqual(parseQuantity("2", "piece"));
        expect(portion?.from.lotId).toBeUndefined();
        const source = await inventory.read.positions(selector);
        expect(source.map((row) => [row.key.lotId, row.measurements.primary.quantity])).toEqual([
          ["young", parseQuantity("2", "piece")], [undefined, parseQuantity("3", "piece")],
        ]);
        if (verb !== "policy scrap") {
          expect(portion?.to).toMatchObject({ placementNodeId: "destination" });
          expect(portion?.to?.lotId).toBeUndefined();
          const arrival = await inventory.read.planAllocation({
            selector: inventoryStockSelector("item-a", { placementNodeIds: ["destination"] }),
            amount: stockAmount("4", "piece"), method: InventoryAllocationMethod.Fifo, atEpochMs: time3,
          });
          expect(arrival.lines.map((line) => [line.position.lotId, line.allocatedPrimary, line.layerStartedAtEpochMs])).toEqual([
            ["old", parseQuantity("2", "piece"), time0], [undefined, parseQuantity("2", "piece"), time2],
          ]);
        } else {
          expect(result.event.reason).toBe("Destroyed stock");
          expect(portion?.to).toBeUndefined();
        }
      }
    }
  );

  it("keeps whole package counts when a witnessed and unwitnessed posting share an exact row", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const packageId = "item-a-box-24-v1";
    await inventory.stock.receive({
      operationId: "unlabelled-packages", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: packageAmount(1, packageId),
    });
    const result = await inventory.stock.transfer({
      operationId: "reported-packages", occurredAtEpochMs: time2,
      from: loosePosition("store"), toPlacementNodeId: "destination",
      amount: packageAmount(2, packageId),
    });
    expect(result.event.unwitnessedStockMovements).toMatchObject([{
      from: { packagingRevisionId: packageId }, to: { packagingRevisionId: packageId },
      measurements: { primary: { quantity: parseQuantity("24", "piece") } },
    }]);
    expect(result.event.stockEffects).toMatchObject([
      { position: { placementNodeId: "destination" }, evidence: { packageCount: "2" } },
      { position: { placementNodeId: "store" }, evidence: { packageCount: "2" } },
    ]);
    expect(await inventory.read.positions(selector)).toMatchObject([{
      key: { packagingRevisionId: packageId },
      measurements: { primary: { quantity: parseQuantity("-24", "piece") } },
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
      { requestId: "report-old", deficit: { primary: parseQuantity("2", "piece") } },
      {
        requestId: "pick-unlabelled",
        lines: [{ allocatedPrimary: parseQuantity("3", "piece"), layerStartedAtEpochMs: time1 }],
        deficit: { primary: parseQuantity("1", "piece") },
      },
    ]);
    const replay = await inventory.stock.transferManyByPolicy(command);
    expect(replay.event).toEqual(result.event);
    expect(replay.allocations).toEqual(result.allocations);
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

  it("combines repeated witnessed picks and an unwitnessed fraction before storing the route", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const total = parseQuantity(String(Number.MAX_SAFE_INTEGER), "piece");
    await inventory.stock.receive({
      operationId: "wide-witness-source", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: stockAmount(String(total.amountMinor), "piece"),
    });
    const result = await inventory.stock.transferManyByPolicy({
      operationId: "wide-witness-batch", occurredAtEpochMs: time2, toPlacementNodeId: "destination",
      requests: [
        { requestId: "whole", selector, amount: stockAmount("9007199254740990", "piece"), method: InventoryAllocationMethod.Fifo },
        { requestId: "fractional", selector, amount: stockAmount("0.9", "piece"), method: InventoryAllocationMethod.Fifo },
        {
          requestId: "missing", amount: stockAmount("0.1", "piece"), method: InventoryAllocationMethod.Fifo,
          selector: { ...selector, lotIds: ["missing"] },
        },
      ],
    });
    expect(result.allocations.map((allocation) => [
      allocation.lines[0]?.allocatedPrimary, allocation.deficit?.primary,
    ])).toEqual([
      [parseQuantity("9007199254740990", "piece"), undefined],
      [parseQuantity("0.9", "piece"), undefined],
      [undefined, parseQuantity("0.1", "piece")],
    ]);
    expect(result.event.unwitnessedStockMovements).toHaveLength(1);
    expect(result.event.positiveLayerProvenanceTransfers).toHaveLength(1);
    expect(result.event.stockEffects.map((effect) => effect.evidence?.transactedMeasurements.primary.quantity))
      .toEqual([total, total]);
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

  it("validates a wide witnessed posting partition without storing it", () => {
    const catalog = createTabletCatalog();
    const draft = createInventoryTransferManyEvent({
      catalog, operationId: "wide-witness", occurredAtEpochMs: time2,
      lines: [{
        from: loosePosition("store"), toPlacementNodeId: "destination",
        amount: stockAmount(String(Number.MAX_SAFE_INTEGER), "piece"),
      }],
    });
    const route = draft.positiveLayerProvenanceTransfers?.[0];
    const posted = draft.stockEffects[0]?.evidence?.transactedMeasurements;
    if (route === undefined || posted === undefined) throw new Error("Expected exact transfer evidence.");
    const fractionalPortion = {
      ...route,
      measurements: { ...posted, primary: { ...posted.primary, quantity: parseQuantity("0.1", "piece") } },
    };
    const retained = defineInventoryEvent({
      catalog, event: { ...draft, unwitnessedStockMovements: [fractionalPortion] },
    });
    expect(retained.stockEffects).toEqual(draft.stockEffects);
    expect(retained.positiveLayerProvenanceTransfers).toEqual([route]);
    expect(retained.unwitnessedStockMovements).toEqual([fractionalPortion]);
    expect(() => defineInventoryEvent({
      catalog, event: { ...draft, unwitnessedStockMovements: [
        fractionalPortion, { ...route, measurements: posted },
      ] },
    })).toThrow("exceeds its signed stock effect");
  });

  it("keeps the witnessed remainder of a mixed transfer in its original owner bucket", () => {
    const catalog = createTabletCatalog();
    const from = loosePosition("source", { ownerId: "owner-x" });
    /** Build each legal posting with the public kernel's exact transfer builder. */
    const transfer = (amount: string, toPlacementNodeId: string) => createInventoryTransferManyEvent({
      catalog, operationId: "mixed-transfer-owner", occurredAtEpochMs: time2,
      lines: [{ from, toPlacementNodeId, amount: stockAmount(amount, "piece") }],
    });
    const draft = transfer("2", "witnessed");
    const debit = draft.stockEffects.find(({ position }) => position.placementNodeId === "source");
    const reported = transfer("1", "reported").stockEffects.find(({ position }) => position.placementNodeId === "reported");
    const witnessed = transfer("1", "witnessed").stockEffects.find(({ position }) => position.placementNodeId === "witnessed");
    if (debit === undefined || reported === undefined || witnessed === undefined) throw new Error("Expected all transfer effects.");
    const unwitnessedStockMovements = [{ from: debit.position, to: reported.position, measurements: reported.measurementsDelta }];
    const valid = {
      ...draft, stockEffects: [debit, reported, witnessed], unwitnessedStockMovements,
      positiveLayerProvenanceTransfers: [{ from: debit.position, to: witnessed.position }],
    };
    expect(defineInventoryEvent({ catalog, event: valid }).unwitnessedStockMovements).toEqual(unwitnessedStockMovements);
    const stolen = { ...witnessed, position: { ...witnessed.position, ownerId: "owner-y" } };
    const invalid = { ...valid, stockEffects: [debit, reported, stolen] };
    expect(() => defineInventoryEvent({
      catalog, event: { ...invalid, positiveLayerProvenanceTransfers: [{ from: debit.position, to: stolen.position }] },
    })).toThrow(/transfer.*preserve.*placement/i);
    expect(() => defineInventoryEvent({
      catalog, event: { ...invalid, positiveLayerProvenanceTransfers: [] },
    })).toThrow(/transfer.*preserve.*placement/i);
  });

  it("records an exact transfer shortage without copying the known lot, age or line cost", async () => {
    for (const canonical of [false, true]) {
      const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : undefined);
      const inventory = createTestInventory(storage, undefined, undefined, InventoryDeficitPolicy.Record);
      await receiveKnownLots(inventory);
      const originalSource = await inventory.read.positions(selector);
      const command = {
        operationId: "record-exact-transfer", occurredAtEpochMs: time2,
        lines: [{
          from: loosePosition("store", { lotId: "old" }), toPlacementNodeId: "destination",
          amount: stockAmount("4", "piece"), metadata: { unitCostMinor: 175 },
        }],
      };
      const begin = vi.spyOn(storage, "begin");
      const result = await inventory.stock.transferMany(command);
      const frozenBegin = begin.mock.calls.find(
        /** Read the valid canonical plan originally frozen for this report. */
        ([input]) => input.operationId === command.operationId
      )?.[0];
      begin.mockRestore();
      expect(frozenBegin !== undefined).toBe(canonical);
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
      const coldStorage = createInMemoryInventoryDurableStorage({ initialWorld: world });
      const cold = createTestInventory(coldStorage, undefined, clockAt(time3), InventoryDeficitPolicy.Record);
      expect((await coldStorage.readOperation(command.operationId))?.receipt).toEqual(result.receipt);
      expect(await coldStorage.complete(command.operationId)).toEqual(result.receipt);
      await expect(coldStorage.complete("unknown-transfer")).rejects.toThrow("Unknown inventory durable operation");
      if (frozenBegin !== undefined) {
        expect(await coldStorage.begin(frozenBegin)).toMatchObject({
          created: false, operation: { receipt: result.receipt },
        });
        await expect(coldStorage.begin({
          ...frozenBegin, intentFingerprint: "changed transfer",
        })).rejects.toThrow("changed intent");
      }
      expect(await cold.stock.transferMany(command)).toEqual({ ...result, replayed: true });
      await expect(cold.stock.transferMany({ ...command, reason: "changed" })).rejects.toThrow("changed intent");
      expect(coldStorage.readSegmentedStockHead().worldRevision).toBe(world.revision);
      expect(await cold.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual(
        await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })
      );
      await reopened.stock.correct({
        operationId: "omit-unwitnessed-transfer", occurredAtEpochMs: time3,
        correctsEventId: result.event.eventId, reason: "Report withdrawn",
        replaceWith: (plans) => plans.omit(),
      });
      expect(await reopened.read.positions({ itemId: "item-a", placementNodeIds: ["destination"] })).toEqual([]);
      expect(await reopened.read.positions(selector)).toEqual(originalSource);
      expect((await storage.readOperation(command.operationId))?.state).toBe("completed");
    }
  });

  it("replays a serialized reported transfer after reopening the exact journal", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const serial = loosePosition("store", { serialId: "one" });
    await inventory.stock.receive({
      operationId: "receive-serial", occurredAtEpochMs: time0,
      to: serial, amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-spare-for-claim", occurredAtEpochMs: time0,
      to: loosePosition("spare"), amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      operationId: "earlier-claim", reservationId: "earlier-claim", itemRevisionId: "item-a-v2",
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["spare"] }),
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time0,
    });
    const command = {
      operationId: "report-serial-transfer", occurredAtEpochMs: time1,
      from: serial, toPlacementNodeId: "destination", amount: stockAmount("1", "piece"),
    };
    const moved = await inventory.stock.transfer(command);
    expect(moved.receipt.worldRevision).not.toBe(moved.event.recordSequence);
    await inventory.reservations.reserve({
      operationId: "later-claim", reservationId: "later-claim", itemRevisionId: "item-a-v2",
      selector: inventoryStockSelector("item-a", { placementNodeIds: ["destination"] }),
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time2,
    });
    const world = await inventory.read.world();
    const storage = createInMemoryInventoryDurableStorage({ initialWorld: world });
    const reopened = createTestInventory(storage, undefined, clockAt(time3), InventoryDeficitPolicy.Record);
    const readWorld = vi.spyOn(storage, "readWorld").mockRejectedValue(new Error("whole world"));
    const completed = await storage.readOperation(command.operationId);
    expect(completed).toMatchObject({ state: "completed", receipt: moved.receipt });
    for (const stage of ["writeEvent", "writeProjection", "writeReservations", "writeCounts", "writeReceipt"] as const) {
      await expect(storage[stage](command.operationId)).resolves.toEqual(completed);
    }
    await expect(storage.writeReceipt("unknown-transfer")).rejects.toThrow("Unknown inventory durable operation");
    expect(await reopened.stock.transfer(command)).toEqual({ ...moved, replayed: true });
    await expect(reopened.stock.transfer({ ...command, toPlacementNodeId: "changed" })).rejects.toThrow("changed intent");
    await expect(reopened.stock.transfer({ ...command, operationId: "new-empty-serial" })).rejects.toThrow("cannot claim a serial");
    expect(storage.readSegmentedStockHead().worldRevision).toBe(world.revision);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it.each(["transfer", "batch", "scrap"])("retains expiry evidence for a held lot during %s recording", async (kind) => {
    const storage = createInMemoryInventoryDurableStorage();
    const beforeExpiry = createTestInventory(storage, undefined, clockAt(time1), InventoryDeficitPolicy.Record);
    const amount = stockAmount("1", "piece");
    await beforeExpiry.stock.receive({
      operationId: "receive-expiring-held-lot", occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "expiring" }), amount,
      lot: { expiresAtEpochMs: time2 },
    });
    await beforeExpiry.reservations.reserve({
      operationId: "reserve-expiring", reservationId: "hold-expiring", itemRevisionId: "item-a-v2",
      selector, requested: parseQuantity("1", "piece"), createdAtEpochMs: time0,
    });
    await beforeExpiry.reservations.allocateByPolicy({
      operationId: "allocate-expiring", reservationId: "hold-expiring",
      occurredAtEpochMs: time1, method: InventoryAllocationMethod.Fifo,
    });
    const inventory = createTestInventory(storage, undefined, clockAt(time3), InventoryDeficitPolicy.Record);
    const operationId = "report-expiring-stock";
    const before = storage.readSegmentedStockHead();
    /** Apply the same report through each physical picking entry point. */
    const report = (allowExpiredLots: boolean) => {
      const request = { selector, amount, method: InventoryAllocationMethod.Fifo, allowExpiredLots };
      const header = { operationId, occurredAtEpochMs: time2 };
      if (kind === "batch") return inventory.stock.transferManyByPolicy({
        ...header, toPlacementNodeId: "destination", requests: [{ ...request, requestId: "report" }],
      });
      if (kind === "scrap") return inventory.stock.scrapByPolicy({ ...header, ...request, reason: "Physical disposal" });
      return inventory.stock.transferByPolicy({ ...header, ...request, toPlacementNodeId: "destination" });
    };
    await expect(report(false)).rejects.toThrow("excluding expired stock");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await storage.readOperation(operationId)).toBeUndefined();
    const allowed = await report(true);
    expect(allowed.event.stockEffects[0]?.position.lotId).toBe("expiring");
    expect(allowed.event.unwitnessedStockMovements).toBeUndefined();
  });

  it.each([
    { kind: "transfer", canonical: false },
    { kind: "batch", canonical: false },
    { kind: "scrap", canonical: false },
    { kind: "transfer", canonical: true },
  ])("requires an expiry override for unlabelled $kind settlement (canonical: $canonical)", async ({ kind, canonical }) => {
    const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
    const inventory = createTestInventory(storage, undefined, clockAt(time3), InventoryDeficitPolicy.Record);
    const source = loosePosition("store");
    await inventory.stock.receive({
      operationId: "expiring-unlabelled-stock", occurredAtEpochMs: time0,
      to: source, amount: stockAmount("2", "piece"),
      placementNode: { useByEpochMs: time2 },
    });
    const before = storage.readSegmentedStockHead();
    /** Report a lot that was not present, so the unlabelled position can settle the debit. */
    const report = (allowExpiredLots: boolean) => {
      const request = {
        method: InventoryAllocationMethod.Fifo,
        selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"], lotIds: ["missing"] }),
        amount: stockAmount("1", "piece"), allowExpiredLots,
      };
      const header = { operationId: "settle-expired-unlabelled", occurredAtEpochMs: time2 };
      if (kind === "batch") return inventory.stock.transferManyByPolicy({
        ...header, toPlacementNodeId: "destination", requests: [{ ...request, requestId: "report" }],
      });
      if (kind === "scrap") return inventory.stock.scrapByPolicy({ ...header, ...request, reason: "Physical disposal" });
      return inventory.stock.transferByPolicy({ ...header, ...request, toPlacementNodeId: "destination" });
    };
    await expect(report(false)).rejects.toThrow("excluding expired stock");
    expect(storage.readSegmentedStockHead()).toEqual(before);
    expect(await report(true)).toMatchObject({
      event: { unwitnessedStockMovements: [{
        from: source, measurements: { primary: { quantity: parseQuantity("1", "piece") } },
      }] },
    });
    expect(await inventory.read.positions(selector)).toMatchObject([{
      key: source, measurements: { primary: { quantity: parseQuantity("1", "piece") } },
    }]);
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
      await inventory.stock.receive({
        operationId: "receive-dedicated-bin", occurredAtEpochMs: time0,
        to: loosePosition("dedicated-bin"), amount: stockAmount("1", "piece"),
      });
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
    const originalIssue = issueCommand();
    const [first, second] = originalIssue.requests;
    if (first === undefined || second === undefined) throw new Error("Expected both FIFO requests.");
    const middle = {
      ...second, requestId: "dedicated", selector: inventoryStockSelector("item-a", { placementNodeIds: ["dedicated-bin"] }),
    };
    const issue = { ...originalIssue, requests: [first, middle, second] };
    const preview = await native.read.planAllocation({ ...first, atEpochMs: time2 });
    expect(preview.lines[0]).toMatchObject({ position: { lotId: "old" }, layerStartedAtEpochMs: time0 });
    const readPool = vi.spyOn(nativeStorage, "readSegmentedStockPool");
    const nativeResult = await native.stock.issueManyByPolicy(issue);
    expect(nativeResult.allocations).toMatchObject([
      { requestId: "first", lines: [{ position: { lotId: "old" } }] },
      { requestId: "dedicated", lines: [{ position: { placementNodeId: "dedicated-bin" } }] },
      { requestId: "second", lines: [{ position: { lotId: "young" } }] },
    ]);
    expect(readPool).toHaveBeenCalledTimes(2);
    expect(nativeResult).toEqual(await canonical.stock.issueManyByPolicy(issue));
    expect(await native.stock.issueManyByPolicy(issue)).toEqual({ ...nativeResult, replayed: true });
    expect(await native.read.summary(selector)).toEqual(await canonical.read.summary(selector));
    expect(readWorld).not.toHaveBeenCalled();
    readWorld.mockRestore();
    expect(await native.read.world()).toEqual(await canonical.read.world());
  });

  it("replans a stale batch and rejects a changed retry", async () => {
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
    const batch = issueCommand();
    const [firstRequest] = batch.requests;
    if (firstRequest === undefined) throw new Error("Expected the retained request.");
    const input = { ...batch, requests: [firstRequest] };
    const result = await inventory.stock.issueManyByPolicy(input);
    expect(result.allocations).toMatchObject([{
      requestId: "first", lines: [{ position: { lotId: "young" }, allocatedPrimary: parseQuantity("2", "piece") }],
    }]);
    expect(write).toHaveBeenCalledTimes(3);
    expect(await inventory.stock.issueManyByPolicy(input)).toEqual({ ...result, replayed: true });
    await expect(inventory.stock.issueManyByPolicy({
      ...input, requests: [{ ...firstRequest, amount: stockAmount("1", "piece") }],
    })).rejects.toThrow("changed intent");
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
    /** Rejected publication attempts from the original command. */
    let declined = 0;
    /** Receipt from the competing invocation with the same intent. */
    let winner: Awaited<ReturnType<typeof inventory.stock.issueManyByPolicy>> | undefined;
    const planning: InventorySegmentedStockPlanningCapability = storage;
    const head = vi.spyOn(planning, "readSegmentedStockHead");
    vi.spyOn(storage, "commitSegmentedStockEvent").mockImplementation(async (plan) => {
      if (plan.operationId !== command.operationId || declined === 8) return commit(plan);
      declined += 1;
      if (declined === 8) {
        // Publish the winner as the original command reads the head after its final decline.
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
    const destinationSelector = inventoryStockSelector("item-a", { placementNodeIds: ["destination"] });
    const source = await reopened.read.positions(selector);
    const destination = await reopened.read.positions(destinationSelector);
    expect(source).toMatchObject([
      { key: { lotId: "young" }, measurements: { primary: { quantity: parseQuantity("1", "piece") } } },
    ]);
    expect(destination).toMatchObject([
      { key: { lotId: "old" }, measurements: { primary: { quantity: parseQuantity("2", "piece") } } },
      { key: { lotId: "young" }, measurements: { primary: { quantity: parseQuantity("1", "piece") } } },
    ]);
    const replay = await reopened.stock.transferManyByPolicy(command);
    expect(replay.replayed).toBe(true);
    expect(replay.event.recordSequence).toBe(before.recordSequence + 1);
    expect(replay.receipt.worldRevision).toBe(before.worldRevision + 1);
    expect(replay.allocations).toMatchObject([
      { requestId: "first", lines: [{ position: { lotId: "old" } }] },
      { requestId: "second", lines: [{ position: { lotId: "young" } }] },
    ]);
    expect(await reopened.read.positions(selector)).toEqual(source);
    expect(await reopened.read.positions(destinationSelector)).toEqual(destination);
    expect(await reopened.stock.transferManyByPolicy(command)).toEqual(replay);
    expect(write).toHaveBeenCalledTimes(2);
    expect(readWorld).not.toHaveBeenCalled();
  });

  it("reads shared placement paths once and keeps the pool's ancestry at its captured revision", async () => {
    const depth = 384;
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog);
    /** Stable identities keep different stock positions on the same deep path. */
    const nodeId = (index: number) => "deep-" + String(index).padStart(3, "0");
    for (const [index, useByEpochMs] of [[0, time3], [128, time2]] as const) {
      await inventory.placement.define({
        operationId: "define-" + nodeId(index), occurredAtEpochMs: time0,
        nodeId: nodeId(index), placementNode: { useByEpochMs },
      });
    }
    await inventory.placement.define({
      operationId: "define-new-root", occurredAtEpochMs: time0,
      nodeId: "new-root", placementNode: { useByEpochMs: time1 },
    });
    for (let index = depth - 1; index > 0; index -= 1) {
      await inventory.placement.move({
        operationId: "place-" + nodeId(index), occurredAtEpochMs: time1,
        nodeId: nodeId(index), into: nodeId(index - 1),
      });
    }
    await inventory.stock.receiveMany({
      operationId: "receive-deep-stock", occurredAtEpochMs: time1,
      lines: Array.from({ length: depth }, (_, index) => ({
        to: loosePosition(nodeId(index)), amount: stockAmount("1", "piece"),
      })),
    });
    const parentReads = vi.spyOn(InMemoryInventorySegmentedPlacementStore.prototype, "parentNodeId");
    const fullPaths = vi.spyOn(InMemoryInventorySegmentedPlacementStore.prototype, "ancestry");
    try {
      const request = {
        itemRevisionId: "item-a-v2", selector: inventoryStockSelector("item-a"), reservationAtEpochMs: time2,
      };
      const pool = storage.readSegmentedStockPool(request);
      expect(pool.positions).toHaveLength(depth);
      expect(parentReads).toHaveBeenCalledTimes(depth);
      expect(fullPaths).not.toHaveBeenCalled();
      const last = pool.positions.find((row) => row.position.key.placementNodeId === nodeId(depth - 1));
      expect(last?.effectiveUseByEpochMs).toBe(time2);
      const within = inventoryStockSelector("item-a", { withinPlacementNodeIds: [nodeId(32)] });
      parentReads.mockClear();
      const availability = await readInventoryScopedStockAvailability({
        storage, catalog, selector: within, itemRevisionId: request.itemRevisionId, atEpochMs: time2,
      });
      expect(availability.physicalOnHand.primary.quantity).toEqual(parseQuantity("352", "piece"));
      expect(availability.expiredOnHand.primary.quantity).toEqual(parseQuantity("256", "piece"));
      expect(parentReads.mock.calls.length).toBeLessThanOrEqual(depth * 2);
      expect(fullPaths).not.toHaveBeenCalled();
      await inventory.placement.move({
        operationId: "move-deep-subtree", occurredAtEpochMs: time2, nodeId: nodeId(128), into: "new-root",
      });
      expect(last?.ancestry).toEqual(Array.from({ length: depth }, (_, index) => nodeId(depth - 1 - index)));
      expect(last?.effectiveUseByEpochMs).toBe(time2);
      const moved = storage.readSegmentedStockPool(request).positions.find(
        (row) => row.position.key.placementNodeId === nodeId(depth - 1),
      );
      expect(moved?.ancestry).toEqual([
        ...Array.from({ length: depth - 128 }, (_, index) => nodeId(depth - 1 - index)), "new-root",
      ]);
      expect(moved?.effectiveUseByEpochMs).toBe(time1);
    } finally {
      fullPaths.mockRestore();
      parentReads.mockRestore();
    }
  });

  it("matches canonical physical availability for holds, signed deficits and ancestor expiry", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(storage, catalog, clockAt(time3), InventoryDeficitPolicy.Record);
    await receiveKnownLots(inventory);
    await inventory.placement.define({
      operationId: "define-expired-cart", occurredAtEpochMs: time0, nodeId: "cart",
      placementNode: { category: "opened-cart", useByEpochMs: time2 },
    });
    await inventory.stock.receive({
      operationId: "expired-cart-stock", occurredAtEpochMs: time0,
      to: loosePosition("cart-child", { lotId: "cart-lot" }), amount: stockAmount("3", "piece"),
    });
    await inventory.placement.move({
      operationId: "place-cart", occurredAtEpochMs: time1, nodeId: "cart", into: "store",
    });
    await inventory.placement.move({
      operationId: "put-bin-in-cart", occurredAtEpochMs: time1, nodeId: "cart-child", into: "cart",
    });
    expect(await inventory.read.placementAncestry("cart-child")).toEqual(["cart-child", "cart", "store"]);
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
        exactlyAllocated: parseQuantity("2", "piece"),
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
    expect(earlier.reservations).toMatchObject([{
      reservationId: "store", status: InventoryReservationStatus.Active,
      allocations: [{ position: loosePosition("store"), quantity: parseQuantity("1", "piece") }],
    }]);
    expect(Object.isFrozen(earlier.reservations[0]?.allocations[0]?.quantity)).toBe(true);
  });

  it("uses current broad leaders for a pre-epoch claim query after the last change", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, undefined, clockAt(-500));
    await inventory.stock.receive({
      operationId: "receive-archived-stock", occurredAtEpochMs: -4_000,
      to: loosePosition("store"), amount: stockAmount("3", "piece"),
    });
    for (const [id, time, expiry] of [["first", -3_000, 1_000], ["second", -2_000, 2_000], ["third", -1_000, 3_000]] as const) {
      await inventory.reservations.reserve({
        operationId: `reserve-${id}`, reservationId: id, itemRevisionId: "item-a-v2",
        selector, requested: parseQuantity("1", "piece"), createdAtEpochMs: time, expiresAtEpochMs: expiry,
      });
    }
    const request = { selector, itemRevisionId: "item-a-v2", exactHoldsOnly: false };
    expect(storage.readSegmentedStockPool({ ...request, reservationAtEpochMs: -500 }).reservations.map(({ reservationId }) => reservationId))
      .toEqual(["third", "second"]);
    expect(storage.readSegmentedStockPool({ ...request, reservationAtEpochMs: -1_500 }).reservations.map(({ reservationId }) => reservationId))
      .toEqual(["first", "second"]);
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
      await Promise.resolve();
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
