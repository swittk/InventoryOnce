import { describe, expect, it } from "vitest";
import { emptyInventoryCountBook } from "../src/counts.js";
import { emptyInventoryProjectionState } from "../src/projection.js";
import { emptyInventoryReservationBook } from "../src/reservations.js";
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
