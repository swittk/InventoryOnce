import { describe, expect, it } from "vitest";
import {
  InventoryCollectionMemberKind,
  InventoryCompositionOutputAmountKind,
  InventoryCompositionOutputLotPolicy,
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  inventoryMeasurement,
  inventoryMeasurementVector,
  packageAmount,
  parseQuantity,
  unitCode,
  type InventoryCollectionDefinitionRevision,
  type InventoryCompositionDefinitionRevision,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { clockAt, time0, time1, time2, time3 } from "./test-fixtures.js";

/** Build one exact scalar output amount for a composition fixture. */
function tablets(value: string) {
  return inventoryMeasurementVector(
    inventoryMeasurement("tablets", parseQuantity(value, "tablet"))
  );
}

/** Build one explicit one-pack read-only roll-up conversion. */
function packRollupMember(itemRevisionId: string) {
  return {
    /** Exact item revision represented by this read-only member. */
    itemRevisionId,
    /** Measurement axis used to interpret the member quantity. */
    measurementAxisId: "packs",
    /** Quantity contributed by one member instance. */
    memberQuantity: parseQuantity("1", "pack"),
    /** Quantity exposed through the collection roll-up view. */
    rollupQuantity: parseQuantity("1", "pack-count"),
  };
}

describe("composition/collection catalogue publication", () => {
  it("publishes newer revisions without reinterpreting retained packs or views", async () => {
    const oldPackItem = defineScalarInventoryItem({
      itemId: "publication-pack",
      revisionId: "publication-pack-v1",
      unit: "pack",
      axisId: "packs",
    });
    const component = defineScalarInventoryItem({
      itemId: "publication-component",
      revisionId: "publication-component-v1",
      unit: "tablet",
      axisId: "tablets",
    });
    const oldPackage = defineScalarInventoryPackaging({
      revisionId: "publication-calendar-v1",
      item: oldPackItem,
      packageUnit: "calendar-pack",
      contains: "1",
    });
    const compositionV1: InventoryCompositionDefinitionRevision = {
      compositionId: "publication-composition",
      revisionId: "publication-composition-v1",
      sourcePackagingRevisionId: oldPackage.revisionId,
      outputs: [
        {
          outputId: "component",
          itemRevisionId: component.revisionId,
          lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Measured,
            measurements: tablets("21"),
          },
        },
      ],
    };
    const collectionV1: InventoryCollectionDefinitionRevision = {
      collectionId: "publication-all-packs",
      revisionId: "publication-all-packs-v1",
      members: [
        {
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: oldPackItem.revisionId,
        },
      ],
      rollups: [
        {
          rollupId: "pack-count",
          basisAxisId: "pack-count",
          basisUnit: unitCode("pack-count"),
          members: [packRollupMember(oldPackItem.revisionId)],
        },
      ],
    };
    const baseCatalog = defineInventoryCatalog({
      itemRevisions: [oldPackItem, component],
      activeItemRevisionIds: {
        [oldPackItem.itemId]: oldPackItem.revisionId,
        [component.itemId]: component.revisionId,
      },
      packagingRevisions: [oldPackage],
      compositionRevisions: [compositionV1],
      activeCompositionRevisionIds: {
        [compositionV1.compositionId]: compositionV1.revisionId,
      },
      collectionRevisions: [collectionV1],
      activeCollectionRevisionIds: {
        [collectionV1.collectionId]: collectionV1.revisionId,
      },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const baseInventory = createInventoryOnce({
      catalog: baseCatalog,
      storage,
      clock: clockAt(time3),
    });
    await baseInventory.catalog.publish({
      operationId: "publish-composition-collection-v1",
      occurredAtEpochMs: time0,
    });
    await baseInventory.stock.receive({
      operationId: "receive-publication-old-pack",
      occurredAtEpochMs: time0,
      to: {
        itemId: oldPackItem.itemId,
        locationId: "store",
        lotId: "PUBLICATION-OLD-PACK",
      },
      amount: packageAmount(1, oldPackage.revisionId),
    });

    const newPackItem = defineScalarInventoryItem({
      itemId: oldPackItem.itemId,
      revisionId: "publication-pack-v2",
      unit: "pack",
      axisId: "packs",
    });
    const newPackage = defineScalarInventoryPackaging({
      revisionId: "publication-calendar-v2",
      item: newPackItem,
      packageUnit: "calendar-pack",
      contains: "1",
    });
    const compositionV2: InventoryCompositionDefinitionRevision = {
      compositionId: compositionV1.compositionId,
      revisionId: "publication-composition-v2",
      sourcePackagingRevisionId: newPackage.revisionId,
      outputs: [
        {
          outputId: "component",
          itemRevisionId: component.revisionId,
          lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Measured,
            measurements: tablets("20"),
          },
        },
      ],
    };
    const collectionV2: InventoryCollectionDefinitionRevision = {
      collectionId: collectionV1.collectionId,
      revisionId: "publication-all-packs-v2",
      members: [
        {
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: oldPackItem.revisionId,
        },
        {
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: newPackItem.revisionId,
        },
      ],
      rollups: [
        {
          rollupId: "pack-count",
          basisAxisId: "pack-count",
          basisUnit: unitCode("pack-count"),
          members: [
            packRollupMember(oldPackItem.revisionId),
            packRollupMember(newPackItem.revisionId),
          ],
        },
      ],
    };
    const extendedCatalog = extendInventoryCatalog({
      catalog: baseCatalog,
      itemRevisions: [newPackItem],
      activeItemRevisionIds: {
        [newPackItem.itemId]: newPackItem.revisionId,
      },
      packagingRevisions: [newPackage],
      compositionRevisions: [compositionV2],
      activeCompositionRevisionIds: {
        [compositionV2.compositionId]: compositionV2.revisionId,
      },
      collectionRevisions: [collectionV2],
      activeCollectionRevisionIds: {
        [collectionV2.collectionId]: collectionV2.revisionId,
      },
    });
    const extendedInventory = createInventoryOnce({
      catalog: extendedCatalog,
      storage,
      clock: clockAt(time3),
    });

    await expect(
      extendedInventory.compositions.definition(compositionV2.revisionId)
    ).rejects.toThrow("Unknown inventory composition revision");
    await expect(
      extendedInventory.collections.definition(collectionV2.revisionId)
    ).rejects.toThrow("Unknown inventory collection revision");
    await expect(
      extendedInventory.compositions.open({
        operationId: "open-before-composition-publication",
        occurredAtEpochMs: time1,
        from: {
          itemId: oldPackItem.itemId,
          locationId: "store",
          lotId: "PUBLICATION-OLD-PACK",
          packagingRevisionId: oldPackage.revisionId,
        },
        packageCount: 1,
      })
    ).rejects.toThrow("publish the retained inventory catalogue first");
    expect(
      await storage.readOperation("open-before-composition-publication")
    ).toBeUndefined();

    await extendedInventory.catalog.publish({
      operationId: "publish-composition-collection-v2",
      occurredAtEpochMs: time1,
    });
    expect(
      (
        await extendedInventory.compositions.activeDefinition(
          compositionV1.compositionId
        )
      ).revisionId
    ).toBe(compositionV2.revisionId);
    expect(
      (
        await extendedInventory.collections.activeDefinition(
          collectionV1.collectionId
        )
      ).revisionId
    ).toBe(collectionV2.revisionId);
    expect(
      (
        await extendedInventory.compositions.definition(
          compositionV1.revisionId
        )
      ).outputs[0]?.amount
    ).toMatchObject({
      kind: InventoryCompositionOutputAmountKind.Measured,
    });
    expect(
      (await extendedInventory.collections.definition(collectionV1.revisionId))
        .members
    ).toHaveLength(1);

    await extendedInventory.stock.receive({
      operationId: "receive-publication-new-pack",
      occurredAtEpochMs: time1,
      to: {
        itemId: newPackItem.itemId,
        locationId: "store",
        lotId: "PUBLICATION-NEW-PACK",
      },
      amount: packageAmount(1, newPackage.revisionId),
    });
    expect(
      (
        await extendedInventory.collections.summary({
          collectionRevisionId: collectionV1.revisionId,
        })
      ).rollups[0]?.total.amountMinor
    ).toBe(1);
    expect(
      (
        await extendedInventory.collections.summary({
          collectionRevisionId: collectionV2.revisionId,
        })
      ).rollups[0]?.total.amountMinor
    ).toBe(2);

    const opened = await extendedInventory.compositions.open({
      operationId: "open-retained-publication-old-pack",
      occurredAtEpochMs: time2,
      from: {
        itemId: oldPackItem.itemId,
        locationId: "store",
        lotId: "PUBLICATION-OLD-PACK",
        packagingRevisionId: oldPackage.revisionId,
      },
      packageCount: 1,
    });
    expect(opened.event.metadata?.inventoryOnceComposition).toMatchObject({
      revisionId: compositionV1.revisionId,
      sourcePackagingRevisionId: oldPackage.revisionId,
    });
    const componentRows = await extendedInventory.read.positions({
      itemId: component.itemId,
      itemRevisionIds: [component.revisionId],
      locationIds: ["store"],
      lotIds: ["PUBLICATION-OLD-PACK"],
    });
    expect(componentRows[0]?.measurements.primary.quantity.amountMinor).toBe(
      21
    );

    const world = await extendedInventory.read.world();
    expect(
      world.catalog.compositionRevisions.map(
        /** Return every retained composition revision after publication. */
        (composition) => composition.revisionId
      )
    ).toEqual([compositionV1.revisionId, compositionV2.revisionId]);
    expect(
      world.catalog.collectionRevisions.map(
        /** Return every retained collection revision after publication. */
        (collection) => collection.revisionId
      )
    ).toEqual([collectionV1.revisionId, collectionV2.revisionId]);
    expect(world.catalog.activeCompositionRevisionIds).toEqual({
      [compositionV1.compositionId]: compositionV2.revisionId,
    });
    expect(world.catalog.activeCollectionRevisionIds).toEqual({
      [collectionV1.collectionId]: collectionV2.revisionId,
    });
  });
});
