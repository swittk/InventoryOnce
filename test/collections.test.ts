import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryCollectionMemberKind,
  InventoryDeficitPolicy,
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
  unitCode,
  type InventoryCatalog,
  type InventoryCollectionDefinitionRevision,
} from "../src/index.js";
import { summarizeInventoryCollection } from "../src/kernel.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { clockAt, time0, time1, time2 } from "./test-fixtures.js";

/** Build one exact scalar collection roll-up member. */
function packRollupMember(itemRevisionId: string) {
  return {
    itemRevisionId,
    measurementAxisId: "packs",
    memberQuantity: parseQuantity("1", "pack"),
    rollupQuantity: parseQuantity("1", "pack-count"),
  };
}

/** Build retained same-brand and All-OCP collection revisions over exact pack item revisions. */
function collectionCatalog(): InventoryCatalog {
  const oldBrand = defineScalarInventoryItem({
    itemId: "brand-x-old",
    revisionId: "brand-x-old-v1",
    unit: "pack",
    axisId: "packs",
  });
  const newBrand = defineScalarInventoryItem({
    itemId: "brand-x-new",
    revisionId: "brand-x-new-v1",
    unit: "pack",
    axisId: "packs",
  });
  const other = defineScalarInventoryItem({
    itemId: "other-ocp",
    revisionId: "other-ocp-v1",
    unit: "pack",
    axisId: "packs",
  });
  const future = defineScalarInventoryItem({
    itemId: "future-ocp",
    revisionId: "future-ocp-v1",
    unit: "pack",
    axisId: "packs",
  });
  const brand: InventoryCollectionDefinitionRevision = {
    collectionId: "brand-x",
    revisionId: "brand-x-view-v1",
    members: [
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: oldBrand.revisionId,
      },
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: newBrand.revisionId,
      },
    ],
    rollups: [
      {
        rollupId: "pack-count",
        basisAxisId: "pack-count",
        basisUnit: unitCode("pack-count"),
        members: [
          packRollupMember(oldBrand.revisionId),
          packRollupMember(newBrand.revisionId),
        ],
      },
    ],
  };
  const allV1: InventoryCollectionDefinitionRevision = {
    collectionId: "all-ocps",
    revisionId: "all-ocps-v1",
    members: [
      {
        kind: InventoryCollectionMemberKind.CollectionRevision,
        revisionId: brand.revisionId,
      },
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: other.revisionId,
      },
    ],
    rollups: [
      {
        rollupId: "pack-count",
        basisAxisId: "pack-count",
        basisUnit: unitCode("pack-count"),
        members: [
          packRollupMember(oldBrand.revisionId),
          packRollupMember(newBrand.revisionId),
          packRollupMember(other.revisionId),
        ],
      },
    ],
  };
  const allV2: InventoryCollectionDefinitionRevision = {
    collectionId: "all-ocps",
    revisionId: "all-ocps-v2",
    members: [
      {
        kind: InventoryCollectionMemberKind.CollectionRevision,
        revisionId: brand.revisionId,
      },
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: other.revisionId,
      },
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: future.revisionId,
      },
    ],
    rollups: [
      {
        rollupId: "pack-count",
        basisAxisId: "pack-count",
        basisUnit: unitCode("pack-count"),
        members: [
          packRollupMember(oldBrand.revisionId),
          packRollupMember(newBrand.revisionId),
          packRollupMember(other.revisionId),
          packRollupMember(future.revisionId),
        ],
      },
    ],
  };
  return defineInventoryCatalog({
    itemRevisions: [oldBrand, newBrand, other, future],
    activeItemRevisionIds: {
      [oldBrand.itemId]: oldBrand.revisionId,
      [newBrand.itemId]: newBrand.revisionId,
      [other.itemId]: other.revisionId,
      [future.itemId]: future.revisionId,
    },
    // Deliberately put parents before their nested member to prove arbitrary-order resolution.
    collectionRevisions: [allV2, allV1, brand],
    activeCollectionRevisionIds: {
      [brand.collectionId]: brand.revisionId,
      [allV1.collectionId]: allV2.revisionId,
    },
  });
}

/** Add one exact pack item at one location. */
async function receivePacks(
  inventory: ReturnType<typeof createInventoryOnce>,
  itemId: string,
  itemRevisionId: string,
  amount: string,
  locationId = "store"
): Promise<void> {
  await inventory.stock.receive({
    operationId: `receive:${itemRevisionId}:${locationId}`,
    occurredAt: time0,
    to: { itemId, locationId },
    itemRevisionId,
    amount: stockAmount(amount, "pack"),
  });
}

/** Machine-declared bounded collection identity/read trace. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-COLLECTION-READ-IDENTITY",
] as const;

describe("revision-frozen read-only inventory collections", () => {
  it("shows same-brand and All-OCP views with exact members and explicit pack-count rollups", async () => {
    const catalog = collectionCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time2),
    });
    await receivePacks(inventory, "brand-x-old", "brand-x-old-v1", "2");
    await receivePacks(inventory, "brand-x-new", "brand-x-new-v1", "3");
    await receivePacks(inventory, "other-ocp", "other-ocp-v1", "4");
    await receivePacks(inventory, "future-ocp", "future-ocp-v1", "5", "room");

    expect(
      (await inventory.collections.activeDefinition("all-ocps")).revisionId
    ).toBe("all-ocps-v2");
    const brand = await inventory.collections.summary({
      collectionRevisionId: "brand-x-view-v1",
    });
    expect(
      brand.members.map(
        /** Keep exact old/new brand revisions visible instead of one merged product. */
        (member) => [
          member.itemRevisionId,
          member.physical.total.primary.quantity.amountMinor,
        ]
      )
    ).toEqual([
      ["brand-x-new-v1", 3],
      ["brand-x-old-v1", 2],
    ]);
    expect(brand.rollups[0]?.total).toMatchObject({
      amountMinor: 5,
      unit: "pack-count",
    });

    const allV1 = await inventory.collections.summary({
      collectionRevisionId: "all-ocps-v1",
    });
    expect(
      allV1.members.map(
        /** Return exact retained member identities from the old view revision. */
        (member) => member.itemRevisionId
      )
    ).toEqual(["brand-x-new-v1", "brand-x-old-v1", "other-ocp-v1"]);
    expect(allV1.rollups[0]?.total.amountMinor).toBe(9);

    const allV2 = await inventory.collections.summary({
      collectionRevisionId: "all-ocps-v2",
    });
    expect(
      allV2.members.map(
        /** Return exact retained member identities from the newer view revision. */
        (member) => member.itemRevisionId
      )
    ).toEqual([
      "brand-x-new-v1",
      "brand-x-old-v1",
      "future-ocp-v1",
      "other-ocp-v1",
    ]);
    expect(allV2.rollups[0]?.total.amountMinor).toBe(14);
    // Reading active v2 did not reinterpret retained v1 membership or totals.
    expect(
      (
        await inventory.collections.summary({
          collectionRevisionId: "all-ocps-v1",
        })
      ).rollups[0]?.total.amountMinor
    ).toBe(9);

    const storeOnly = await inventory.collections.summary({
      collectionRevisionId: "all-ocps-v2",
      scope: { locationIds: ["store"] },
    });
    expect(storeOnly.rollups[0]?.total.amountMinor).toBe(9);
    expect(
      storeOnly.members.find(
        /** Locate the future member to prove scoped zero rows remain visible. */
        (member) => member.itemRevisionId === "future-ocp-v1"
      )?.physical.total.primary.quantity.amountMinor
    ).toBe(0);
  });

  it("reports recorded deficit separately from physical collection stock and rollups", async () => {
    const catalog = collectionCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time2),
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    await inventory.stock.issueByPolicy({
      operationId: "record-old-brand-deficit-for-collection",
      occurredAt: time0,
      selector: inventoryStockSelector("brand-x-old", {
        itemRevisionIds: ["brand-x-old-v1"],
        locationIds: ["store"],
      }),
      itemRevisionId: "brand-x-old-v1",
      amount: stockAmount("3", "pack"),
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.receive({
      operationId: "receive-old-brand-after-collection-deficit",
      occurredAt: time1,
      to: { itemId: "brand-x-old", locationId: "store", lotId: "OLD-LATE" },
      itemRevisionId: "brand-x-old-v1",
      amount: stockAmount("10", "pack"),
    });

    const summary = await inventory.collections.summary({
      collectionRevisionId: "brand-x-view-v1",
      scope: { locationIds: ["store"] },
    });
    const oldMember = summary.members.find(
      /** Read the one member carrying both physical stock and recorded deficit. */
      (member) => member.itemRevisionId === "brand-x-old-v1"
    );
    expect(oldMember?.physical.total.primary.quantity.amountMinor).toBe(7);
    expect(
      oldMember?.physical.physicalOnHand.primary.quantity.amountMinor
    ).toBe(10);
    expect(oldMember?.physical.deficit.primary.quantity.amountMinor).toBe(3);
    expect(summary.rollups[0]).toMatchObject({
      total: { amountMinor: 7, unit: "pack-count" },
      physicalTotal: { amountMinor: 10, unit: "pack-count" },
      deficitTotal: { amountMinor: 3, unit: "pack-count" },
    });
  });

  it("uses item/revision indexes instead of enumerating every stock position", async () => {
    const catalog = collectionCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time2),
    });
    await receivePacks(inventory, "brand-x-old", "brand-x-old-v1", "2");
    await receivePacks(inventory, "brand-x-new", "brand-x-new-v1", "3");
    const world = await inventory.read.world();
    const positions = new Proxy(world.projection.positions, {
      /** Collection summaries must use exact item indexes, not whole-record enumeration. */
      ownKeys: () => {
        throw new Error(
          "Performance regression: collection enumerated all positions."
        );
      },
    });
    const summary = summarizeInventoryCollection({
      catalog,
      projection: { ...world.projection, positions },
      collectionRevisionId: "brand-x-view-v1",
    });
    expect(summary.rollups[0]?.total.amountMinor).toBe(5);
  });

  it("rejects nested collection cycles before any view can be published", () => {
    const item = defineScalarInventoryItem({
      itemId: "cycle-item",
      revisionId: "cycle-item-v1",
      unit: "pack",
      axisId: "packs",
    });
    const left: InventoryCollectionDefinitionRevision = {
      collectionId: "left",
      revisionId: "left-v1",
      members: [
        {
          kind: InventoryCollectionMemberKind.CollectionRevision,
          revisionId: "right-v1",
        },
      ],
    };
    const right: InventoryCollectionDefinitionRevision = {
      collectionId: "right",
      revisionId: "right-v1",
      members: [
        {
          kind: InventoryCollectionMemberKind.CollectionRevision,
          revisionId: "left-v1",
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: [item],
        activeItemRevisionIds: { [item.itemId]: item.revisionId },
        collectionRevisions: [left, right],
        activeCollectionRevisionIds: {
          [left.collectionId]: left.revisionId,
          [right.collectionId]: right.revisionId,
        },
      })
    ).toThrow("collection graph contains a cycle");
  });

  it("clones member and roll-up arrays so caller mutation cannot rewrite a retained view", () => {
    const item = defineScalarInventoryItem({
      itemId: "immutable-view-item",
      revisionId: "immutable-view-item-v1",
      unit: "pack",
      axisId: "packs",
    });
    const members: Array<
      InventoryCollectionDefinitionRevision["members"][number]
    > = [
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: item.revisionId,
      },
    ];
    const rollupMembers = [packRollupMember(item.revisionId)];
    const collection: InventoryCollectionDefinitionRevision = {
      collectionId: "immutable-view",
      revisionId: "immutable-view-v1",
      members,
      rollups: [
        {
          rollupId: "pack-count",
          basisAxisId: "pack-count",
          basisUnit: unitCode("pack-count"),
          members: rollupMembers,
        },
      ],
    };
    const catalog = defineInventoryCatalog({
      itemRevisions: [item],
      activeItemRevisionIds: { [item.itemId]: item.revisionId },
      collectionRevisions: [collection],
      activeCollectionRevisionIds: {
        [collection.collectionId]: collection.revisionId,
      },
    });
    members[0] = {
      kind: InventoryCollectionMemberKind.ItemRevision,
      revisionId: "mutated-item-v1",
    };
    rollupMembers[0] = {
      ...rollupMembers[0]!,
      rollupQuantity: parseQuantity("999", "pack-count"),
    };
    const retained = catalog.collectionRevision(collection.revisionId);
    expect(retained.members).toEqual([
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: item.revisionId,
      },
    ]);
    expect(retained.rollups?.[0]?.members[0]?.rollupQuantity.amountMinor).toBe(
      1
    );
  });

  it("rejects scalar roll-ups whose member axis or membership is not explicitly compatible", () => {
    const item = defineScalarInventoryItem({
      itemId: "rollup-item",
      revisionId: "rollup-item-v1",
      unit: "pack",
      axisId: "packs",
    });
    const outside = defineScalarInventoryItem({
      itemId: "outside-item",
      revisionId: "outside-item-v1",
      unit: "pack",
      axisId: "packs",
    });
    const badAxis: InventoryCollectionDefinitionRevision = {
      collectionId: "bad-axis",
      revisionId: "bad-axis-v1",
      members: [
        {
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: item.revisionId,
        },
      ],
      rollups: [
        {
          rollupId: "bad",
          basisAxisId: "pack-count",
          basisUnit: unitCode("pack-count"),
          members: [
            {
              ...packRollupMember(item.revisionId),
              measurementAxisId: "not-an-item-axis",
            },
          ],
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: [item, outside],
        activeItemRevisionIds: {
          [item.itemId]: item.revisionId,
          [outside.itemId]: outside.revisionId,
        },
        collectionRevisions: [badAxis],
        activeCollectionRevisionIds: {
          [badAxis.collectionId]: badAxis.revisionId,
        },
      })
    ).toThrow("unknown item axis");

    const outsideMember: InventoryCollectionDefinitionRevision = {
      collectionId: "outside-rollup",
      revisionId: "outside-rollup-v1",
      members: [
        {
          kind: InventoryCollectionMemberKind.ItemRevision,
          revisionId: item.revisionId,
        },
      ],
      rollups: [
        {
          rollupId: "bad",
          basisAxisId: "pack-count",
          basisUnit: unitCode("pack-count"),
          members: [packRollupMember(outside.revisionId)],
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: [item, outside],
        activeItemRevisionIds: {
          [item.itemId]: item.revisionId,
          [outside.itemId]: outside.revisionId,
        },
        collectionRevisions: [outsideMember],
        activeCollectionRevisionIds: {
          [outsideMember.collectionId]: outsideMember.revisionId,
        },
      })
    ).toThrow("outside collection membership");
  });
});
