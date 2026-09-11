import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryEventKind,
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryFungibilityPool,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import { projectInventoryEvents } from "../src/kernel.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-CATALOG-PUBLICATION-REPLAY",
] as const;

describe("append-only retained catalogue publication", () => {
  it("publishes item/package definitions explicitly and replays the exact publication", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({
      catalog,
      storage,
      clock: clockAt(time3),
    });
    const command = {
      operationId: "publish-base-catalog",
      occurredAtEpochMs: time0,
      reason: "Initial inventory definitions became authoritative.",
    };
    const published = await inventory.catalog.publish(command);
    const replayed = await inventory.catalog.publish(command);

    expect(published.event.kind).toBe(InventoryEventKind.CatalogPublication);
    expect(published.event.catalogDigest).toBe(catalog.digest);
    expect(replayed.replayed).toBe(true);
    expect((await inventory.read.world()).catalog).toMatchObject({
      digest: catalog.digest,
      activeItemRevisionIds: { "item-a": "item-a-v2" },
    });
    await expect(
      inventory.catalog.publish({
        operationId: "redundant-base-publication",
        occurredAtEpochMs: time1,
      })
    ).rejects.toThrow("already the current durable catalogue");
  });

  it("replays an earlier exact publication after a later retained extension", async () => {
    const baseCatalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const baseInventory = createInventoryOnce({
      catalog: baseCatalog,
      storage,
      clock: clockAt(time3),
    });
    const originalCommand = {
      operationId: "publish-before-later-extension",
      occurredAtEpochMs: time0,
    };
    await baseInventory.catalog.publish(originalCommand);

    const itemV3 = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v3-retry-proof",
      unit: "piece",
      axisId: "pieces",
    });
    const extendedCatalog = extendInventoryCatalog({
      catalog: baseCatalog,
      itemRevisions: [itemV3],
      activeItemRevisionIds: { "item-a": itemV3.revisionId },
    });
    await createInventoryOnce({
      catalog: extendedCatalog,
      storage,
      clock: clockAt(time3),
    }).catalog.publish({
      operationId: "publish-later-extension",
      occurredAtEpochMs: time1,
    });
    const beforeRetry = await storage.readWorld();

    const replayed = await baseInventory.catalog.publish(originalCommand);

    expect(replayed.replayed).toBe(true);
    expect(await storage.readWorld()).toEqual(beforeRetry);
  });

  it("appends immutable revisions, changes active pointers, and then accepts the new package", async () => {
    const baseCatalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const baseInventory = createInventoryOnce({
      catalog: baseCatalog,
      storage,
      clock: clockAt(time3),
    });
    await baseInventory.catalog.publish({
      operationId: "publish-before-extension",
      occurredAtEpochMs: time0,
    });

    const itemV3 = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v3",
      unit: "piece",
      axisId: "pieces",
    });
    const box30 = defineScalarInventoryPackaging({
      revisionId: "item-a-box-30-v1",
      item: itemV3,
      packageUnit: "box",
      contains: "30",
    });
    const extendedCatalog = extendInventoryCatalog({
      catalog: baseCatalog,
      itemRevisions: [itemV3],
      activeItemRevisionIds: { "item-a": itemV3.revisionId },
      packagingRevisions: [box30],
    });
    const extendedInventory = createInventoryOnce({
      catalog: extendedCatalog,
      storage,
      clock: clockAt(time3),
    });
    await expect(
      extendedInventory.stock.receive({
        operationId: "receive-before-catalog-publication",
        occurredAtEpochMs: time1,
        to: loosePosition("store", { lotId: "UNPUBLISHED-LOT" }),
        amount: packageAmount(1, "item-a-box-30-v1"),
      })
    ).rejects.toThrow("publish the retained inventory catalogue first");
    expect(
      await storage.readOperation("receive-before-catalog-publication")
    ).toBeUndefined();
    expect(
      (
        await extendedInventory.read.summary({ itemId: "item-a" })
      ).revisions.map(
        /** Read durable active revision ids before the process catalogue is published. */
        (revision) => revision.itemRevisionId
      )
    ).toEqual(["item-a-v2"]);
    expect(
      (
        await extendedInventory.read.packagingRevisions({ itemId: "item-a" })
      ).map(
        /** Read only package revisions already present in durable catalogue truth. */
        (packaging) => packaging.revisionId
      )
    ).toEqual(["item-a-box-20-v1", "item-a-box-24-v1"]);
    const extensionPublication = await extendedInventory.catalog.publish({
      operationId: "publish-extended-catalog",
      occurredAtEpochMs: time1,
      reason: "Supplier changed the exact box definition.",
    });
    expect(extensionPublication.event.catalogDigest).toBe(
      extendedCatalog.digest
    );
    const worldAfterPublication = await extendedInventory.read.world();
    expect(
      worldAfterPublication.catalog.itemRevisions.map(
        /** Return retained revision identities to prove old definitions remain available. */
        (revision) => revision.revisionId
      )
    ).toEqual(["item-a-v1", "item-a-v2", "item-a-v3"]);
    expect(
      worldAfterPublication.catalog.packagingRevisions.map(
        /** Return retained package identities across the supplier change. */
        (packaging) => packaging.revisionId
      )
    ).toEqual(["item-a-box-20-v1", "item-a-box-24-v1", "item-a-box-30-v1"]);

    await extendedInventory.stock.receive({
      operationId: "receive-new-box-30",
      occurredAtEpochMs: time2,
      to: loosePosition("store", { lotId: "NEW-BOX-LOT" }),
      amount: packageAmount(1, "item-a-box-30-v1"),
    });
    const current = await extendedInventory.read.summary({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v3"],
      locationIds: ["store"],
    });
    expect(current.revisions[0]?.total.primary.quantity.amountMinor).toBe(30);

    const finalWorld = await extendedInventory.read.world();
    const events = Object.values(finalWorld.projection.events);
    const rebuilt = projectInventoryEvents({
      catalog: extendedCatalog,
      events,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt.lastRecordSequence).toBe(
      finalWorld.projection.lastRecordSequence
    );
    expect(rebuilt.positions).toEqual(finalWorld.projection.positions);
    expect(
      rebuilt.events["inventory:event:publish-before-extension"]
        ?.catalogSnapshot
    ).toMatchObject({ digest: baseCatalog.digest });
    expect(
      rebuilt.events["inventory:event:publish-extended-catalog"]
        ?.catalogSnapshot
    ).toMatchObject({ digest: extendedCatalog.digest });
  });

  it("publishes newer fungibility revisions explicitly without reinterpreting retained pools", async () => {
    const oldItem = defineScalarInventoryItem({
      itemId: "publication-old-brand",
      revisionId: "publication-old-brand-v1",
      unit: "piece",
      axisId: "pieces",
    });
    const newItem = defineScalarInventoryItem({
      itemId: "publication-new-brand",
      revisionId: "publication-new-brand-v1",
      unit: "piece",
      axisId: "pieces",
    });
    const doubleItem = defineScalarInventoryItem({
      itemId: "publication-double",
      revisionId: "publication-double-v1",
      unit: "piece",
      axisId: "pieces",
    });
    const poolV1 = defineScalarInventoryFungibilityPool({
      poolId: "publication-brand-pool",
      revisionId: "publication-brand-pool-v1",
      basisUnit: "dose-equivalent",
      members: [{ item: oldItem }, { item: newItem }],
    });
    const baseCatalog = defineInventoryCatalog({
      itemRevisions: [oldItem, newItem, doubleItem],
      activeItemRevisionIds: {
        [oldItem.itemId]: oldItem.revisionId,
        [newItem.itemId]: newItem.revisionId,
        [doubleItem.itemId]: doubleItem.revisionId,
      },
      fungibilityRevisions: [poolV1],
      activeFungibilityRevisionIds: {
        [poolV1.poolId]: poolV1.revisionId,
      },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const baseInventory = createInventoryOnce({
      catalog: baseCatalog,
      storage,
      clock: clockAt(time3),
    });
    await baseInventory.catalog.publish({
      operationId: "publish-fungibility-v1",
      occurredAtEpochMs: time0,
    });
    await baseInventory.stock.receive({
      operationId: "receive-publication-old",
      occurredAtEpochMs: time0,
      to: {
        itemId: oldItem.itemId,
        locationId: "store",
        lotId: "PUBLICATION-OLD",
      },
      amount: stockAmount("1", "piece"),
      itemRevisionId: oldItem.revisionId,
    });
    await baseInventory.stock.receive({
      operationId: "receive-publication-double",
      occurredAtEpochMs: time0,
      to: {
        itemId: doubleItem.itemId,
        locationId: "store",
        lotId: "PUBLICATION-DOUBLE",
      },
      amount: stockAmount("1", "piece"),
      itemRevisionId: doubleItem.revisionId,
    });

    const poolV2 = defineScalarInventoryFungibilityPool({
      poolId: poolV1.poolId,
      revisionId: "publication-brand-pool-v2",
      basisUnit: "dose-equivalent",
      members: [
        { item: oldItem },
        { item: newItem },
        { item: doubleItem, poolQuantity: "2" },
      ],
    });
    const extendedCatalog = extendInventoryCatalog({
      catalog: baseCatalog,
      fungibilityRevisions: [poolV2],
      activeFungibilityRevisionIds: {
        [poolV2.poolId]: poolV2.revisionId,
      },
    });
    const extendedInventory = createInventoryOnce({
      catalog: extendedCatalog,
      storage,
      clock: clockAt(time3),
    });

    await expect(
      extendedInventory.fungibility.definition(poolV2.revisionId)
    ).rejects.toThrow("Unknown inventory fungibility revision");
    await expect(
      extendedInventory.fungibility.issue({
        operationId: "issue-unpublished-fungibility-v2",
        occurredAtEpochMs: time1,
        fungibilityRevisionId: poolV2.revisionId,
        requested: parseQuantity("2", "dose-equivalent"),
        method: InventoryAllocationMethod.Fifo,
        scope: { locationIds: ["store"] },
      })
    ).rejects.toThrow("publish the retained inventory catalogue first");
    expect(
      await storage.readOperation("issue-unpublished-fungibility-v2")
    ).toBeUndefined();

    await extendedInventory.catalog.publish({
      operationId: "publish-fungibility-v2",
      occurredAtEpochMs: time1,
    });
    expect(
      (await extendedInventory.fungibility.activeDefinition(poolV2.poolId))
        .revisionId
    ).toBe(poolV2.revisionId);
    expect(
      (await extendedInventory.fungibility.definition(poolV1.revisionId))
        .members
    ).toHaveLength(2);

    const issuedV2 = await extendedInventory.fungibility.issue({
      operationId: "issue-published-fungibility-v2",
      occurredAtEpochMs: time2,
      fungibilityRevisionId: poolV2.revisionId,
      requested: parseQuantity("2", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: {
        locationIds: ["store"],
        lotIds: ["PUBLICATION-DOUBLE"],
      },
    });
    expect(issuedV2.event.stockEffects[0]?.position.itemId).toBe(
      doubleItem.itemId
    );

    const issuedV1 = await extendedInventory.fungibility.issue({
      operationId: "issue-retained-fungibility-v1",
      occurredAtEpochMs: time3,
      fungibilityRevisionId: poolV1.revisionId,
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: {
        locationIds: ["store"],
        lotIds: ["PUBLICATION-OLD"],
      },
    });
    expect(issuedV1.event.stockEffects[0]?.position.itemId).toBe(
      oldItem.itemId
    );
  });

  it("fails closed when a later process drops retained definitions or reuses a publication id", async () => {
    const baseCatalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const baseInventory = createInventoryOnce({
      catalog: baseCatalog,
      storage,
      clock: clockAt(time3),
    });
    await baseInventory.catalog.publish({
      operationId: "publish-retained-base",
      occurredAtEpochMs: time0,
    });

    const itemV3 = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v3-only",
      unit: "piece",
      axisId: "pieces",
    });
    const incompleteCatalog = defineInventoryCatalog({
      itemRevisions: [itemV3],
      activeItemRevisionIds: { "item-a": itemV3.revisionId },
      packagingRevisions: [],
    });
    const incompleteInventory = createInventoryOnce({
      catalog: incompleteCatalog,
      storage,
      clock: clockAt(time3),
    });
    await expect(
      incompleteInventory.catalog.publish({
        operationId: "publish-dropped-history",
        occurredAtEpochMs: time1,
      })
    ).rejects.toThrow("Unknown inventory item revision");

    const extendedCatalog = extendInventoryCatalog({
      catalog: baseCatalog,
      itemRevisions: [itemV3],
      activeItemRevisionIds: { "item-a": itemV3.revisionId },
    });
    const extendedInventory = createInventoryOnce({
      catalog: extendedCatalog,
      storage,
      clock: clockAt(time3),
    });
    await expect(
      extendedInventory.catalog.publish({
        operationId: "publish-retained-base",
        occurredAtEpochMs: time0,
      })
    ).rejects.toThrow("changed intent");
  });

  it("does not pretend immutable catalogue history can be corrected away", async () => {
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    const published = await inventory.catalog.publish({
      operationId: "publish-uncorrectable-catalog",
      occurredAtEpochMs: time0,
    });
    await expect(
      inventory.stock.correct({
        operationId: "try-correcting-catalog",
        occurredAtEpochMs: time1,
        correctsEventId: published.event.eventId,
        reason: "This should become a later publication instead.",
        replaceWith: (plans) => plans.omit(),
      })
    ).rejects.toThrow("append-only definition history");
  });
});
