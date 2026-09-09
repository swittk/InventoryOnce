import { describe, expect, it } from "vitest";

import {
  InventoryEventKind,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineInventoryPackaging,
  inventoryMeasurementAt,
  inventoryMeasurementVector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  unitCode,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";

const occurredAt = "2030-01-01T00:00:00.000Z";
const itemId = "measured-count-item";
const itemRevisionId = "measured-count-item-v1";

function measuredItem() {
  return defineInventoryItem({
    itemId,
    revisionId: itemRevisionId,
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
      lot: InventoryTrackingRequirement.Forbidden,
      serial: InventoryTrackingRequirement.Forbidden,
    },
    qualifiedDimensions: [],
  });
}

function measuredVector(pieces: string, weight: string) {
  return inventoryMeasurementVector(
    { axisId: "pieces", quantity: parseQuantity(pieces, "piece") },
    [{ axisId: "weight", quantity: parseQuantity(weight, "kg") }],
  );
}

function inventoryFor(packagingRevisions: ReturnType<typeof defineInventoryPackaging>[] = []) {
  const item = measuredItem();
  const catalog = defineInventoryCatalog({
    itemRevisions: [item],
    activeItemRevisionIds: { [itemId]: itemRevisionId },
    packagingRevisions,
  });
  return createInventoryOnce({
    catalog,
    storage: createInMemoryInventoryDurableStorage(),
    clock: { now: () => occurredAt },
  });
}

describe("independent physical count reconciliation", () => {
  it("adjusts measured weight while primary piece stock is unchanged", async () => {
    const inventory = inventoryFor();
    await inventory.stock.receive({
      operationId: "measured-loose-receive",
      occurredAt,
      to: { itemId, locationId: "loose" },
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "20", unit: "kg" },
      ]),
    });

    const adjusted = await inventory.counts.replaceAbsolute({
      countId: "measured-loose-count",
      operationId: "measured-loose-count",
      itemRevisionId,
      selector: { itemId, locationIds: ["loose"] },
      observedMeasurements: measuredVector("2", "21"),
      occurredAt,
      reason: "Reweighed unchanged piece stock.",
    });

    expect(adjusted.event?.kind).toBe(InventoryEventKind.CountAdjustment);
    expect(adjusted.event?.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(0);
    expect(
      inventoryMeasurementAt(
        adjusted.event?.stockEffects[0]?.measurementsDelta ?? measuredVector("0", "0"),
        "weight",
        unitCode("kg"),
      ).amountMinor,
    ).toBe(1);
    const [position] = await inventory.read.positions({ itemId, locationIds: ["loose"] });
    expect(position?.measurements.primary.quantity.amountMinor).toBe(2);
    expect(
      position === undefined
        ? undefined
        : inventoryMeasurementAt(position.measurements, "weight", unitCode("kg")).amountMinor,
    ).toBe(21);
  });

  it("allows dynamic package weight adjustment when weight is not fixed package contents", async () => {
    const item = measuredItem();
    const packaging = defineInventoryPackaging({
      revisionId: "dynamic-weight-box-v1",
      itemId,
      itemRevisionId,
      packageUnit: unitCode("box"),
      fixedContents: inventoryMeasurementVector(
        { axisId: "pieces", quantity: parseQuantity("24", "piece") },
        [],
      ),
    }, item);
    const inventory = inventoryFor([packaging]);
    await inventory.stock.receive({
      operationId: "dynamic-package-receive",
      occurredAt,
      to: { itemId, locationId: "dynamic-package" },
      amount: packageAmount(1, packaging.revisionId, [
        { axisId: "weight", value: "3", unit: "kg" },
      ]),
    });

    const adjusted = await inventory.counts.replaceAbsolute({
      countId: "dynamic-package-count",
      operationId: "dynamic-package-count",
      itemRevisionId,
      selector: { itemId, locationIds: ["dynamic-package"] },
      observedMeasurements: measuredVector("24", "4"),
      occurredAt,
    });

    expect(adjusted.event?.kind).toBe(InventoryEventKind.CountAdjustment);
    expect(
      inventoryMeasurementAt(
        adjusted.event?.stockEffects[0]?.measurementsDelta ?? measuredVector("0", "0"),
        "weight",
        unitCode("kg"),
      ).amountMinor,
    ).toBe(1);
    expect(adjusted.event?.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(0);
  });

  it("rejects changing an independent axis that is part of fixed package contents", async () => {
    const item = measuredItem();
    const packaging = defineInventoryPackaging({
      revisionId: "fixed-weight-box-v1",
      itemId,
      itemRevisionId,
      packageUnit: unitCode("box"),
      fixedContents: measuredVector("24", "3"),
    }, item);
    const inventory = inventoryFor([packaging]);
    await inventory.stock.receive({
      operationId: "fixed-package-receive",
      occurredAt,
      to: { itemId, locationId: "fixed-package" },
      amount: packageAmount(1, packaging.revisionId),
    });
    const before = await inventory.read.world();

    await expect(inventory.counts.replaceAbsolute({
      countId: "fixed-package-count",
      operationId: "fixed-package-count",
      itemRevisionId,
      selector: { itemId, locationIds: ["fixed-package"] },
      observedMeasurements: measuredVector("24", "4"),
      occurredAt,
    })).rejects.toThrow("does not match the same whole package count");
    expect(await inventory.read.world()).toEqual(before);
  });
});
