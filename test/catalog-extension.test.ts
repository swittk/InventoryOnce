import { describe, expect, it } from "vitest";
import {
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  publishInventoryCatalogExtension,
  publishInventoryCatalogIfChanged,
  readPublishedInventoryCatalog,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { createTabletCatalog, time0, time1 } from "./test-fixtures.js";

describe("append-only native catalogue publication", () => {
  it("reads a catalogue only from the exact published world snapshot", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    await publishInventoryCatalogIfChanged({
      storage,
      catalog,
      operationId: "publish-read-catalog",
      occurredAt: time0,
    });
    const read = await readPublishedInventoryCatalog(storage);
    expect(read.world.revision).toBe(1);
    expect(read.catalog.digest).toBe(catalog.digest);
  });

  it("publishes one complete catalogue, then returns an unchanged-world no-op", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    const first = await publishInventoryCatalogIfChanged({
      storage,
      catalog,
      operationId: "publish-base-catalog",
      occurredAt: time0,
    });
    expect(first).toMatchObject({ published: true, replayed: false });
    expect(first.world.revision).toBe(1);
    const noOp = await publishInventoryCatalogIfChanged({
      storage,
      catalog,
      operationId: "unused-no-op-identity",
      occurredAt: time1,
    });
    expect(noOp).toMatchObject({ published: false, replayed: false });
    expect(noOp.world.revision).toBe(1);
    expect(noOp.catalog.digest).toBe(catalog.digest);
  });

  it("rebases compatible concurrent extensions so neither publisher erases the other", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    await publishInventoryCatalogIfChanged({
      storage,
      catalog,
      operationId: "publish-concurrent-base",
      occurredAt: time0,
    });
    const itemB = defineScalarInventoryItem({
      itemId: "item-b",
      revisionId: "item-b-v1",
      axisId: "pieces",
      unit: "piece",
    });
    const itemC = defineScalarInventoryItem({
      itemId: "item-c",
      revisionId: "item-c-v1",
      axisId: "pieces",
      unit: "piece",
    });
    await Promise.all([
      publishInventoryCatalogExtension({
        storage,
        operationId: "publish-item-b",
        occurredAt: time1,
        extension: {
          itemRevisions: [itemB],
          activeItemRevisionIds: { "item-b": itemB.revisionId },
        },
      }),
      publishInventoryCatalogExtension({
        storage,
        operationId: "publish-item-c",
        occurredAt: time1,
        extension: {
          itemRevisions: [itemC],
          activeItemRevisionIds: { "item-c": itemC.revisionId },
        },
      }),
    ]);
    const world = await storage.readWorld();
    const finalCatalog = (
      await publishInventoryCatalogExtension({
        storage,
        operationId: "catalog-concurrent-no-op",
        occurredAt: time1,
        extension: {},
      })
    ).catalog;
    expect(world.revision).toBe(3);
    expect(finalCatalog.activeItem("item-b").revisionId).toBe("item-b-v1");
    expect(finalCatalog.activeItem("item-c").revisionId).toBe("item-c-v1");
  });

  it("retains application publication reason and metadata without exposing catalogue plumbing", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    await publishInventoryCatalogIfChanged({
      storage,
      catalog: createTabletCatalog(),
      operationId: "publish-provenance-base",
      occurredAt: time0,
    });
    const itemB = defineScalarInventoryItem({
      itemId: "item-provenance",
      revisionId: "item-provenance-v1",
      axisId: "pieces",
      unit: "piece",
    });
    await publishInventoryCatalogExtension({
      storage,
      operationId: "publish-provenance-extension",
      occurredAt: time1,
      reason: "Staff saved a transformation definition.",
      metadata: { sourceComponent: "InventoryTransformationConfig" },
      extension: {
        itemRevisions: [itemB],
        activeItemRevisionIds: { [itemB.itemId]: itemB.revisionId },
      },
    });
    const operation = await storage.readOperation(
      "publish-provenance-extension"
    );
    expect(operation?.event).toMatchObject({
      reason: "Staff saved a transformation definition.",
      metadata: { sourceComponent: "InventoryTransformationConfig" },
    });
  });

  it("extends and publishes immutable revisions through one native operation", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const catalog = createTabletCatalog();
    await publishInventoryCatalogIfChanged({
      storage,
      catalog,
      operationId: "publish-extension-base",
      occurredAt: time0,
    });
    const itemV3 = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v3",
      axisId: "pieces",
      unit: "piece",
    });
    const box30 = defineScalarInventoryPackaging({
      revisionId: "item-a-box-30-v1",
      item: itemV3,
      packageUnit: "box",
      contains: "30",
    });
    const extended = await publishInventoryCatalogExtension({
      storage,
      operationId: "publish-extension-v3",
      occurredAt: time1,
      extension: {
        itemRevisions: [itemV3],
        activeItemRevisionIds: { "item-a": itemV3.revisionId },
        packagingRevisions: [box30],
      },
    });
    expect(extended).toMatchObject({ published: true, replayed: false });
    expect(extended.world.revision).toBe(2);
    expect(extended.catalog.activeItem("item-a").revisionId).toBe("item-a-v3");
    expect(extended.catalog.packagingRevision(box30.revisionId)).toEqual(box30);
    expect(
      extendInventoryCatalog({
        catalog: extended.catalog,
        itemRevisions: [itemV3],
        packagingRevisions: [box30],
      })
    ).toBe(extended.catalog);
  });
});
