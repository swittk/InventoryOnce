import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  ensureInventoryScalarCatalogRevision,
  type InventoryScalarCatalogDeclaration,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { time0, time1, time2 } from "./test-fixtures.js";

/** Build deterministic item/package revisions from one scalar catalogue declaration. */
function defineRevision(declaration: InventoryScalarCatalogDeclaration): {
  readonly item: ReturnType<typeof defineScalarInventoryItem>;
  readonly packaging: readonly ReturnType<typeof defineScalarInventoryPackaging>[];
} {
  const suffix = [
    declaration.primaryUnit,
    ...declaration.packageLevels.map(
      (level) => `${level.unit}-${level.primaryQuantity}`
    ),
  ].join(":");
  const item = defineScalarInventoryItem({
    itemId: declaration.itemId,
    revisionId: `${declaration.itemId}:${suffix}`,
    axisId: "stock",
    unit: declaration.primaryUnit,
  });
  return {
    item,
    packaging: declaration.packageLevels.map((level) =>
      defineScalarInventoryPackaging({
        revisionId: `${item.revisionId}:package:${level.unit}`,
        item,
        packageUnit: level.unit,
        contains: level.primaryQuantity,
      })
    ),
  };
}

describe("native scalar catalogue lifecycle", () => {
  it("publishes, reuses, appends historically, and activates an existing revision", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const first = await ensureInventoryScalarCatalogRevision({
      storage,
      itemId: "item-a",
      requestedUnit: "box",
      seed: {
        primaryUnit: "piece",
        packageLevels: [{ unit: "box", primaryQuantity: "10.0" }],
      },
      allowCreate: true,
      operationId: "catalog-first",
      occurredAt: time0,
      defineRevision,
    });
    expect(first).toMatchObject({ published: true, replayed: false });
    expect(first.catalog.activeItem("item-a").revisionId).toBe(
      "item-a:piece:box-10"
    );

    const reused = await ensureInventoryScalarCatalogRevision({
      storage,
      itemId: "item-a",
      requestedUnit: "box",
      allowCreate: false,
      operationId: "catalog-unused-read-id",
      occurredAt: time1,
      defineRevision,
    });
    expect(reused).toMatchObject({
      itemRevisionId: "item-a:piece:box-10",
      published: false,
    });

    const historical = await ensureInventoryScalarCatalogRevision({
      storage,
      itemId: "item-a",
      requestedUnit: "carton",
      seed: {
        packageLevels: [{ unit: "carton", primaryQuantity: "24" }],
      },
      allowCreate: true,
      operationId: "catalog-historical",
      occurredAt: time1,
      defineRevision,
    });
    expect(historical.itemRevisionId).toBe("item-a:piece:carton-24");
    expect(historical.catalog.activeItem("item-a").revisionId).toBe(
      "item-a:piece:box-10"
    );

    const activated = await ensureInventoryScalarCatalogRevision({
      storage,
      itemId: "item-a",
      requestedUnit: "carton",
      seed: {
        packageLevels: [{ unit: "carton", primaryQuantity: "24" }],
      },
      allowCreate: false,
      activateRevision: true,
      operationId: "catalog-activate-existing",
      occurredAt: time2,
      defineRevision,
    });
    expect(activated.catalog.activeItem("item-a").revisionId).toBe(
      historical.itemRevisionId
    );
  });

  it("rejects malformed package declarations and dishonest revision factories", async () => {
    const malformedStorage = createInMemoryInventoryDurableStorage();
    await expect(
      ensureInventoryScalarCatalogRevision({
        storage: malformedStorage,
        itemId: "item-a",
        requestedUnit: "box",
        seed: {
          primaryUnit: "piece",
          packageLevels: [
            { unit: "box", primaryQuantity: "10" },
            { unit: "box", primaryQuantity: "12" },
          ],
        },
        allowCreate: true,
        operationId: "catalog-conflict",
        occurredAt: time0,
        defineRevision,
      })
    ).rejects.toThrow("conflicting primary quantities");
    expect((await malformedStorage.readWorld()).revision).toBe(0);

    const dishonestStorage = createInMemoryInventoryDurableStorage();
    await expect(
      ensureInventoryScalarCatalogRevision({
        storage: dishonestStorage,
        itemId: "item-a",
        requestedUnit: "box",
        seed: {
          primaryUnit: "piece",
          packageLevels: [{ unit: "box", primaryQuantity: "10" }],
        },
        allowCreate: true,
        operationId: "catalog-dishonest-factory",
        occurredAt: time0,
        defineRevision: (declaration) => {
          const definitions = defineRevision(declaration);
          return {
            ...definitions,
            packaging: [
              defineScalarInventoryPackaging({
                revisionId: "dishonest-package",
                item: definitions.item,
                packageUnit: "box",
                contains: "11",
              }),
            ],
          };
        },
      })
    ).rejects.toThrow("different package declaration");
    expect((await dishonestStorage.readWorld()).revision).toBe(0);
  });

  it("rejects reused scalar item and package revision ids whose retained meaning differs", async () => {
    const itemConflict = defineScalarInventoryItem({
      itemId: "item-conflict",
      revisionId: "item-conflict-v1",
      axisId: "stock",
      unit: "piece",
    });
    const itemStorage = createInMemoryInventoryDurableStorage();
    await createInventoryOnce({
      catalog: defineInventoryCatalog({
        itemRevisions: [itemConflict],
        activeItemRevisionIds: { "item-conflict": itemConflict.revisionId },
      }),
      storage: itemStorage,
    }).catalog.publish({
      operationId: "publish-item-conflict-base",
      occurredAt: time0,
    });
    await expect(
      ensureInventoryScalarCatalogRevision({
        storage: itemStorage,
        itemId: "item-conflict",
        requestedUnit: "carton",
        seed: {
          packageLevels: [{ unit: "carton", primaryQuantity: "24" }],
        },
        allowCreate: true,
        operationId: "redefine-item-conflict",
        occurredAt: time1,
        defineRevision: (declaration) => ({
          item: defineScalarInventoryItem({
            itemId: declaration.itemId,
            revisionId: itemConflict.revisionId,
            axisId: "different-stock-axis",
            unit: declaration.primaryUnit,
          }),
          packaging: [
            defineScalarInventoryPackaging({
              revisionId: "item-conflict-carton-v1",
              item: defineScalarInventoryItem({
                itemId: declaration.itemId,
                revisionId: itemConflict.revisionId,
                axisId: "different-stock-axis",
                unit: declaration.primaryUnit,
              }),
              packageUnit: "carton",
              contains: "24",
            }),
          ],
        }),
      })
    ).rejects.toThrow("cannot be redefined");
    expect((await itemStorage.readWorld()).revision).toBe(1);

    const packageItem = defineScalarInventoryItem({
      itemId: "package-conflict",
      revisionId: "package-conflict-item-v1",
      axisId: "stock",
      unit: "piece",
    });
    const retainedPackage = defineScalarInventoryPackaging({
      revisionId: "package-conflict-box-v1",
      item: packageItem,
      packageUnit: "box",
      contains: "10",
    });
    const packageStorage = createInMemoryInventoryDurableStorage();
    await createInventoryOnce({
      catalog: defineInventoryCatalog({
        itemRevisions: [packageItem],
        activeItemRevisionIds: { "package-conflict": packageItem.revisionId },
        packagingRevisions: [retainedPackage],
      }),
      storage: packageStorage,
    }).catalog.publish({
      operationId: "publish-package-conflict-base",
      occurredAt: time0,
    });
    await expect(
      ensureInventoryScalarCatalogRevision({
        storage: packageStorage,
        itemId: "package-conflict",
        requestedUnit: "box",
        seed: {
          packageLevels: [{ unit: "box", primaryQuantity: "12" }],
        },
        allowCreate: true,
        operationId: "redefine-package-conflict",
        occurredAt: time1,
        defineRevision: (declaration) => ({
          item: packageItem,
          packaging: [
            defineScalarInventoryPackaging({
              revisionId: retainedPackage.revisionId,
              item: packageItem,
              packageUnit: "box",
              contains: declaration.packageLevels[0]?.primaryQuantity ?? "12",
            }),
          ],
        }),
      })
    ).rejects.toThrow("cannot be redefined");
    expect((await packageStorage.readWorld()).revision).toBe(1);
  });

  it("fails closed when several historical revisions share one physical declaration", async () => {
    const itemA = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-a",
      axisId: "stock",
      unit: "piece",
    });
    const itemB = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-b",
      axisId: "stock",
      unit: "piece",
    });
    const active = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-active",
      axisId: "stock",
      unit: "piece",
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [itemA, itemB, active],
      activeItemRevisionIds: { "item-a": active.revisionId },
      packagingRevisions: [
        defineScalarInventoryPackaging({
          revisionId: "box-a",
          item: itemA,
          packageUnit: "box",
          contains: "10",
        }),
        defineScalarInventoryPackaging({
          revisionId: "box-b",
          item: itemB,
          packageUnit: "box",
          contains: "10",
        }),
        defineScalarInventoryPackaging({
          revisionId: "carton-active",
          item: active,
          packageUnit: "carton",
          contains: "20",
        }),
      ],
    });
    const storage = createInMemoryInventoryDurableStorage();
    await createInventoryOnce({ catalog, storage }).catalog.publish({
      operationId: "publish-ambiguous-catalog",
      occurredAt: time0,
    });

    await expect(
      ensureInventoryScalarCatalogRevision({
        storage,
        itemId: "item-a",
        requestedUnit: "box",
        seed: {
          packageLevels: [{ unit: "box", primaryQuantity: "10" }],
        },
        allowCreate: false,
        activateRevision: true,
        operationId: "select-ambiguous",
        occurredAt: time1,
        defineRevision,
      })
    ).rejects.toThrow("matches 2 retained revisions");
  });
});
