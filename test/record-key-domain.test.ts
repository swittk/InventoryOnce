import { describe, expect, it } from "vitest";
import { emptyInventoryCountBook, startInventoryCount, observeInventoryCount } from "../src/counts.js";
import { emptyInventoryProjectionState } from "../src/projection.js";
import { emptyInventoryReservationBook, createInventoryReservation, allocateInventoryReservation, releaseInventoryReservation } from "../src/reservations.js";
import {
  InventoryAllocationMethod,
  InventoryCollectionMemberKind,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryCollection,
  defineInventoryItem,
  defineInventoryTransformation,
  extendInventoryCatalog,
  inventoryMeasurement,
  inventoryMeasurementVector,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
  unitCode,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
} from "./test-fixtures.js";

describe("string-keyed inventory records", () => {
  it("treats never-recorded prototype-named identities as absent", () => {
    const projection = emptyInventoryProjectionState();
    const reservations = emptyInventoryReservationBook();
    const counts = emptyInventoryCountBook();

    const inherited = [
      ["projection.events/toString", projection.events["toString"]],
      ["projection.operation/constructor", projection.eventIdByOperationId["constructor"]],
      ["projection.correction/hasOwnProperty", projection.correctionEventIdByCorrectedEventId["hasOwnProperty"]],
      ["projection.item/valueOf", projection.positionIdsByItemId["valueOf"]],
      ["projection.revision/toLocaleString", projection.positionIdsByItemRevisionId["toLocaleString"]],
      ["projection.lot/isPrototypeOf", projection.lotIdentitiesByItemId["isPrototypeOf"]],
      ["projection.transfer/propertyIsEnumerable", projection.transfers["propertyIsEnumerable"]],
      ["reservation.row/toString", reservations.reservations["toString"]],
      ["reservation.operation/constructor", reservations.operations["constructor"]],
      ["count.row/hasOwnProperty", counts.counts["hasOwnProperty"]],
      ["count.operation/valueOf", counts.operations["valueOf"]],
    ].filter(([, value]) => value !== undefined).map(([label, value]) => [label, typeof value]);

    expect(inherited).toEqual([]);
  });

  it("keeps absent prototype-named keys absent after reference-storage cloning", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const world = await storage.readWorld();
    expect(world.catalog.activeItemRevisionIds["toString"]).toBeUndefined();
    expect(world.catalog.activeTransformationRevisionIds["constructor"]).toBeUndefined();
    expect(world.projection.events["toString"]).toBeUndefined();
    expect(world.projection.eventIdByOperationId["constructor"]).toBeUndefined();
    expect(world.projection.positionIdsByItemId["valueOf"]).toBeUndefined();
    expect(world.projection.transfers["hasOwnProperty"]).toBeUndefined();
    expect(world.reservations.reservations["toString"]).toBeUndefined();
    expect(world.reservations.operations["constructor"]).toBeUndefined();
    expect(world.counts.counts["hasOwnProperty"]).toBeUndefined();
    expect(world.counts.operations["valueOf"]).toBeUndefined();
  });

  it("preserves own-only book maps after ordinary publication and replay", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "book-map-stock", occurredAtEpochMs: time0, to: loosePosition("store"), amount: stockAmount("2", "piece") });
    const reserve = { reservationId: "book-map-claim", operationId: "book-map-reserve", itemRevisionId: "item-a-v2", selector: { itemId: "item-a", locationIds: ["store"] }, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1 };
    const count = { countId: "book-map-count", operationId: "book-map-start", itemRevisionId: "item-a-v2", selector: { itemId: "item-a", locationIds: ["store"] }, startedAtEpochMs: time1 };
    for (let replay = 0; replay < 2; replay += 1) {
      await inventory.reservations.reserve(reserve);
      await inventory.counts.start(count);
      const world = await inventory.read.world();
      for (const record of [world.reservations.reservations, world.reservations.operations, world.counts.counts, world.counts.operations]) {
        for (const absent of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
          expect.soft(record[absent]).toBeUndefined();
        }
      }
      expect(world.reservations.reservations[reserve.reservationId]?.reservationId).toBe(reserve.reservationId);
      expect(world.counts.counts[count.countId]?.countId).toBe(count.countId);
    }
  });

  it("retains prototype-named item and revision ids through active and projection indexes", async () => {
    const item = defineInventoryItem({
      itemId: "valueOf",
      revisionId: "toLocaleString",
      primaryAxis: {
        axisId: "pieces",
        role: InventoryMeasurementAxisRole.Primary,
        unit: unitCode("piece"),
        requirement: InventoryMeasurementRequirement.Required,
      },
      independentAxes: [],
      reservationAxisId: "pieces",
      tracking: {
        lot: InventoryTrackingRequirement.Forbidden,
        serial: InventoryTrackingRequirement.Forbidden,
      },
      qualifiedDimensions: [],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item],
      activeItemRevisionIds: { [item.itemId]: item.revisionId },
      packagingRevisions: [],
    });
    expect(catalog.activeItemRevisionIds["valueOf"]).toBe("toLocaleString");
    expect(catalog.activeItemRevisionIds["constructor"]).toBeUndefined();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: { nowEpochMs: () => time1 },
    });
    await inventory.stock.receive({
      operationId: "prototype-index-receive",
      occurredAtEpochMs: time0,
      to: { itemId: "valueOf", locationId: "store" },
      amount: stockAmount("2", "piece"),
    });
    const positions = await inventory.read.positions({
      itemId: "valueOf",
      itemRevisionIds: ["toLocaleString"],
      locationIds: ["store"],
    });
    expect(positions).toHaveLength(1);
    expect(positions[0]?.key.itemId).toBe("valueOf");
    expect(positions[0]?.key.itemRevisionId).toBe("toLocaleString");

    const batch = await inventory.stock.issueManyByPolicy({
      operationId: "prototype-index-batch",
      occurredAtEpochMs: time1,
      requests: [
        {
          requestId: "first",
          selector: inventoryStockSelector("valueOf", {
            itemRevisionIds: ["toLocaleString"],
            locationIds: ["store"],
          }),
          amount: stockAmount("1", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
        {
          requestId: "second",
          selector: inventoryStockSelector("valueOf", {
            itemRevisionIds: ["toLocaleString"],
            locationIds: ["store"],
          }),
          amount: stockAmount("1", "piece"),
          method: InventoryAllocationMethod.Fifo,
        },
      ],
    });
    expect(batch.allocations.map((allocation) => allocation.lines.length)).toEqual([1, 1]);
    expect(
      await inventory.read.positions({
        itemId: "valueOf",
        itemRevisionIds: ["toLocaleString"],
        locationIds: ["store"],
      })
    ).toEqual([]);
  });

  it("keeps prototype-named active definition ids and ignores inherited selector overrides", async () => {
    const base = createTabletCatalog();
    const item = base.itemRevision("item-a-v2");
    const onePiece = inventoryMeasurementVector(
      inventoryMeasurement("pieces", parseQuantity("1", "piece"))
    );
    const transformation = defineInventoryTransformation({
      definition: {
        transformationId: "constructor",
        revisionId: "toLocaleString",
        inputs: [{
          lineId: "hasOwnProperty",
          itemRevisionId: item.revisionId,
          amount: onePiece,
        }],
        outputs: [{
          lineId: "output",
          itemRevisionId: item.revisionId,
          amount: onePiece,
        }],
      },
      itemRevisions: base.itemRevisions,
    });
    const collection = defineInventoryCollection({
      definition: {
        collectionId: "propertyIsEnumerable",
        revisionId: "isPrototypeOf",
        members: [{
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: item.revisionId,
        }],
      },
      itemRevisions: base.itemRevisions,
      collectionRevisions: [],
    });
    const catalog = extendInventoryCatalog({
      catalog: base,
      transformationRevisions: [transformation],
      activeTransformationRevisionIds: {
        [transformation.transformationId]: transformation.revisionId,
      },
      collectionRevisions: [collection],
      activeCollectionRevisionIds: {
        [collection.collectionId]: collection.revisionId,
      },
    });
    expect(catalog.activeTransformationRevisionIds["constructor"])
      .toBe("toLocaleString");
    expect(catalog.activeTransformationRevisionIds["valueOf"]).toBeUndefined();
    expect(catalog.activeCollectionRevisionIds["propertyIsEnumerable"])
      .toBe("isPrototypeOf");
    expect(catalog.activeCollectionRevisionIds["toString"]).toBeUndefined();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: { nowEpochMs: () => time1 },
    });
    const plan = await inventory.transformations.plan({
      transformationRevisionId: transformation.revisionId,
      selectorsByInputLine: {},
    });
    expect(plan.inputs[0]?.lineId).toBe("hasOwnProperty");
    expect(plan.inputs[0]?.selector.itemId).toBe("item-a");
  });

  it("accepts a first reservation whose id matches an inherited property name", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-reserved-name-reservation", occurredAtEpochMs: time0,
      to: loosePosition("store"), amount: stockAmount("2", "piece"),
    });
    await expect(inventory.reservations.reserve({
      reservationId: "toString", operationId: "reserve-prototype-name",
      itemRevisionId: "item-a-v2", selector: { itemId: "item-a", locationIds: ["store"] },
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    })).resolves.toMatchObject({ reservation: { reservationId: "toString" } });
  });

  it("accepts a first count whose id matches an inherited property name", async () => {
    const inventory = createTestInventory();
    await expect(inventory.counts.start({
      countId: "hasOwnProperty", operationId: "count-prototype-name",
      itemRevisionId: "item-a-v2", selector: { itemId: "item-a", locationIds: ["store"] },
      startedAtEpochMs: time1,
    })).resolves.toMatchObject({ count: { countId: "hasOwnProperty" } });
  });

  it("accepts a first transfer whose id matches an inherited property name", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-reserved-name-transfer", occurredAtEpochMs: time0,
      to: loosePosition("A"), amount: stockAmount("2", "piece"),
    });
    await expect(inventory.transfers.prepare({
      operationId: "prepare-prototype-name", occurredAtEpochMs: time1, transferId: "constructor",
      transitLocationId: "TRANSIT", destinationLocationId: "B",
      lines: [{ lineId: "line", from: loosePosition("A"), amount: stockAmount("1", "piece") }],
    })).resolves.toMatchObject({ transfer: { transferId: "constructor" } });
  });

  it("accepts a first event operation whose id matches an inherited property name", async () => {
    const inventory = createTestInventory();
    await expect(inventory.stock.receive({
      operationId: "toString", occurredAtEpochMs: time0, to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    })).resolves.toBeDefined();
  });

});


describe("retained book ownership and sparse dictionaries", () => {
  it("keeps arbitrary missing keys absent after count start and observe, not only in empty books", async () => {
    const catalog = createTabletCatalog(), inventory = createTestInventory(undefined, catalog);
    const world = await inventory.read.world();
    const started = startInventoryCount({ catalog, projection: world.projection, book: emptyInventoryCountBook(), countId: "count", operationId: "start", selector: inventoryStockSelector("item-a"), startedAtEpochMs: time0 });
    const observed = observeInventoryCount({ catalog, projection: world.projection, book: started.book, countId: "count", operationId: "observe", observedAtEpochMs: time1, observations: [] });
    for (const result of [started, observed]) {
      expect(result.book.counts["constructor"]).toBeUndefined();
      expect(result.book.operations["toString"]).toBeUndefined();
      expect(Object.getPrototypeOf(result.book.counts)).toBeNull();
      expect(Object.getPrototypeOf(result.book.operations)).toBeNull();
    }
  });

  it("retains count metadata and complete observation rows independently of mutable callers", async () => {
    const catalog = createTabletCatalog(), inventory = createTestInventory(undefined, catalog);
    const world = await inventory.read.world(), metadata = { entries: [{ label: "before" }] };
    const started = startInventoryCount({ catalog, projection: world.projection, book: emptyInventoryCountBook(), countId: "count", operationId: "start", selector: inventoryStockSelector("item-a"), startedAtEpochMs: time0, metadata });
    const position = { itemId: "item-a", itemRevisionId: "item-a-v2", locationId: "A" };
    const measuredQuantity = { ...parseQuantity("2", "piece") };
    const measurements = { primary: { axisId: "pieces", quantity: measuredQuantity }, independent: [] };
    const observed = observeInventoryCount({ catalog, projection: world.projection, book: started.book, countId: "count", operationId: "observe", observedAtEpochMs: time1, observations: [{ position, measurements }] });
    position.locationId = "B"; measuredQuantity.amountMinor = 3; metadata.entries[0]!.label = "after";
    expect(started.count.metadata).toEqual({ entries: [{ label: "before" }] });
    expect(observed.count.metadata).toEqual({ entries: [{ label: "before" }] });
    expect(observed.count.observations[0]?.position.locationId).toBe("A");
    expect(observed.count.observations[0]?.measurements.primary.quantity.amountMinor).toBe(2);
  });

  it.each([1, 2])("owns reservation creation and allocation facts for %i source rows, preserving sparse keys through release", async rows => {
    const catalog = createTabletCatalog(), inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({ operationId: "seed", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("2", "piece") });
    const world = await inventory.read.world();
    const requested = { ...parseQuantity("2", "piece") }, metadata = { nested: ["before"] };
    const created = createInventoryReservation({ catalog, projection: world.projection, book: emptyInventoryReservationBook(), nowEpochMs: time1,
      reservation: { reservationId: "claim", operationId: "create", itemRevisionId: "item-a-v2", selector: inventoryStockSelector("item-a"), requested, createdAtEpochMs: time1, metadata } });
    const position = { itemId: "item-a", itemRevisionId: "item-a-v2", locationId: "A" };
    const amount = { ...parseQuantity(rows === 1 ? "2" : "1", "piece") };
    const allocation = { position, quantity: amount };
    const allocated = allocateInventoryReservation({ catalog, projection: world.projection, book: created.book, reservationId: "claim", operationId: "allocate", occurredAtEpochMs: time1, allocations: rows === 1 ? [allocation] : [allocation, allocation] });
    const released = releaseInventoryReservation({ book: allocated.book, reservationId: "claim", operationId: "release", occurredAtEpochMs: time1 });
    requested.amountMinor = 8; metadata.nested[0] = "after"; position.locationId = "B"; amount.amountMinor = 9;
    for (const result of [created, allocated, released]) {
      expect(result.reservation.requested.amountMinor).toBe(2);
      expect(result.reservation.metadata).toEqual({ nested: ["before"] });
      expect(result.book.reservations["constructor"]).toBeUndefined();
      expect(result.book.operations["toString"]).toBeUndefined();
      expect(Object.getPrototypeOf(result.book.reservations)).toBeNull();
      expect(Object.getPrototypeOf(result.book.operations)).toBeNull();
    }
    expect(allocated.reservation.allocations[0]?.position.locationId).toBe("A");
    expect(allocated.reservation.allocations[0]?.quantity.amountMinor).toBe(2);
    expect(allocated.book.operations["allocate"]?.reservationAfter).toEqual(allocated.reservation);
  });

  it("normalizes measurement values without retaining caller-owned quantity objects", () => {
    const primaryQuantity = { ...parseQuantity("2", "piece") };
    const secondaryQuantity = { ...parseQuantity("3", "gram") };
    const primary = inventoryMeasurement("pieces", primaryQuantity);
    const vector = inventoryMeasurementVector(primary, [{ axisId: "weight", quantity: secondaryQuantity }]);
    primaryQuantity.amountMinor = 5; secondaryQuantity.amountMinor = 6;
    expect(primary.quantity.amountMinor).toBe(2);
    expect(vector.primary.quantity.amountMinor).toBe(2);
    expect(vector.independent[0]?.quantity.amountMinor).toBe(3);
  });
});
