import { describe, expect, it } from "vitest";
import {
  InventoryCompositionOutputAmountKind,
  InventoryCompositionOutputLotPolicy,
  InventoryEventKind,
  InventoryTraceabilityNodeKind,
  createInventoryOnce,
  defineInventoryComposition,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  inventoryMeasurement,
  inventoryMeasurementVector,
  packageAmount,
  parseQuantity,
  type InventoryCatalog,
  type InventoryCompositionDefinitionRevision,
  type InventoryItemDefinitionRevision,
  type InventoryMetadata,
  type InventoryPackagingDefinitionRevision,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { clockAt, time0, time1, time2, time3 } from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-COMPOSITION-OPEN-REVISION",
  "TRACE-STOCK-EXACT-TRANSFER",
] as const;

/** Exact retained pieces of the realistic calendar-pack catalogue fixture. */
interface OcpCatalogFixture {
  /** Complete immutable catalogue. */
  readonly catalog: InventoryCatalog;
  /** Old calendar-pack item revision. */
  readonly oldPackItem: InventoryItemDefinitionRevision;
  /** New calendar-pack item revision. */
  readonly newPackItem: InventoryItemDefinitionRevision;
  /** Exact old source package revision. */
  readonly oldPack: InventoryPackagingDefinitionRevision;
  /** Exact new source package revision. */
  readonly newPack: InventoryPackagingDefinitionRevision;
}

/** Build one scalar measurement-vector component amount. */
function tablets(value: string) {
  return inventoryMeasurementVector(
    inventoryMeasurement("tablets", parseQuantity(value, "tablet"))
  );
}

/** Build the two exact heterogeneous OCP generations from the formal model. */
function ocpCatalog(
  activeCompositionRevisionId = "brand-x-composition-v2"
): OcpCatalogFixture {
  const oldPackItem = defineScalarInventoryItem({
    itemId: "brand-x-pack",
    revisionId: "brand-x-pack-v1",
    unit: "pack",
    axisId: "packs",
  });
  const newPackItem = defineScalarInventoryItem({
    itemId: "brand-x-pack",
    revisionId: "brand-x-pack-v2",
    unit: "pack",
    axisId: "packs",
  });
  const activeA = defineScalarInventoryItem({
    itemId: "active-a",
    revisionId: "active-a-v1",
    unit: "tablet",
    axisId: "tablets",
  });
  const activeB = defineScalarInventoryItem({
    itemId: "active-b",
    revisionId: "active-b-v1",
    unit: "tablet",
    axisId: "tablets",
  });
  const placeboA = defineScalarInventoryItem({
    itemId: "placebo-a",
    revisionId: "placebo-a-v1",
    unit: "tablet",
    axisId: "tablets",
  });
  const placeboB = defineScalarInventoryItem({
    itemId: "placebo-b",
    revisionId: "placebo-b-v1",
    unit: "tablet",
    axisId: "tablets",
  });
  const oldPack = defineScalarInventoryPackaging({
    revisionId: "brand-x-calendar-pack-v1",
    item: oldPackItem,
    packageUnit: "calendar-pack",
    contains: "1",
  });
  const newPack = defineScalarInventoryPackaging({
    revisionId: "brand-x-calendar-pack-v2",
    item: newPackItem,
    packageUnit: "calendar-pack",
    contains: "1",
  });
  const v1: InventoryCompositionDefinitionRevision = {
    compositionId: "brand-x-composition",
    revisionId: "brand-x-composition-v1",
    sourcePackagingRevisionId: oldPack.revisionId,
    outputs: [
      {
        outputId: "active-a",
        itemRevisionId: activeA.revisionId,
        lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
        amount: {
          kind: InventoryCompositionOutputAmountKind.Measured,
          measurements: tablets("21"),
        },
      },
      {
        outputId: "placebo-a",
        itemRevisionId: placeboA.revisionId,
        lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
        amount: {
          kind: InventoryCompositionOutputAmountKind.Measured,
          measurements: tablets("7"),
        },
      },
    ],
  };
  const v2: InventoryCompositionDefinitionRevision = {
    compositionId: "brand-x-composition",
    revisionId: "brand-x-composition-v2",
    sourcePackagingRevisionId: newPack.revisionId,
    outputs: [
      {
        outputId: "active-a",
        itemRevisionId: activeA.revisionId,
        lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
        amount: {
          kind: InventoryCompositionOutputAmountKind.Measured,
          measurements: tablets("20"),
        },
      },
      {
        outputId: "active-b",
        itemRevisionId: activeB.revisionId,
        lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
        amount: {
          kind: InventoryCompositionOutputAmountKind.Measured,
          measurements: tablets("5"),
        },
      },
      {
        outputId: "placebo-b",
        itemRevisionId: placeboB.revisionId,
        lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource,
        amount: {
          kind: InventoryCompositionOutputAmountKind.Measured,
          measurements: tablets("3"),
        },
      },
    ],
  };
  const catalog = defineInventoryCatalog({
    itemRevisions: [
      oldPackItem,
      newPackItem,
      activeA,
      activeB,
      placeboA,
      placeboB,
    ],
    activeItemRevisionIds: {
      "brand-x-pack": newPackItem.revisionId,
      "active-a": activeA.revisionId,
      "active-b": activeB.revisionId,
      "placebo-a": placeboA.revisionId,
      "placebo-b": placeboB.revisionId,
    },
    packagingRevisions: [oldPack, newPack],
    compositionRevisions: [v1, v2],
    activeCompositionRevisionIds: {
      "brand-x-composition": activeCompositionRevisionId,
    },
  });
  return { catalog, oldPackItem, newPackItem, oldPack, newPack };
}

/** Named lookup for one exact item revision/location/lot quantity fixture. */
interface ItemQuantityQuery {
  /** Inventory facade queried by the fixture. */
  readonly inventory: ReturnType<typeof createInventoryOnce>;
  /** Stable catalog item identity. */
  readonly itemId: string;
  /** Exact item revision identity. */
  readonly itemRevisionId: string;
  /** Exact stock location identity. */
  readonly locationId: string;
  /** Exact lot identity. */
  readonly lotId: string;
}

/** Read one exact item revision/location/lot primary tablet amount. */
async function itemQuantity({
  inventory,
  itemId,
  itemRevisionId,
  locationId,
  lotId,
}: ItemQuantityQuery): Promise<number> {
  const positions = await inventory.read.positions({
    itemId,
    itemRevisionIds: [itemRevisionId],
    locationIds: [locationId],
    lotIds: [lotId],
  });
  let total = 0;
  for (const position of positions) {
    total += position.measurements.primary.quantity.amountMinor;
  }
  return total;
}

describe("revision-frozen heterogeneous package composition", () => {
  it("transfers an old pack and opens its own 21+7 revision after v2 is active", async () => {
    const fixture = ocpCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage,
      clock: clockAt(time3),
    });
    expect(
      (await inventory.compositions.activeDefinition("brand-x-composition"))
        .revisionId
    ).toBe("brand-x-composition-v2");
    expect(
      (
        await inventory.compositions.forSourcePackagingRevision(
          fixture.oldPack.revisionId
        )
      ).revisionId
    ).toBe("brand-x-composition-v1");

    await inventory.stock.receive({
      operationId: "receive-old-ocp-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        lotId: "OLD-OCP-LOT",
        containerId: "OLD-OCP-CARTON",
      },
      amount: packageAmount(1, fixture.oldPack.revisionId),
      lot: { expiresAt: "2028-01-01T00:00:00.000Z" },
      container: { containerType: "calendar-pack-carton" },
    });
    await inventory.stock.receive({
      operationId: "receive-new-ocp-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.newPackItem.itemId,
        locationId: "store",
        lotId: "NEW-OCP-LOT",
      },
      amount: packageAmount(1, fixture.newPack.revisionId),
      lot: { expiresAt: "2029-01-01T00:00:00.000Z" },
    });
    await inventory.stock.transfer({
      operationId: "transfer-old-ocp-pack",
      occurredAt: time1,
      from: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        lotId: "OLD-OCP-LOT",
        packagingRevisionId: fixture.oldPack.revisionId,
        containerId: "OLD-OCP-CARTON",
      },
      toLocationId: "room",
      amount: packageAmount(1, fixture.oldPack.revisionId),
    });

    const command = {
      operationId: "open-old-ocp-pack",
      occurredAt: time2,
      from: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "room",
        lotId: "OLD-OCP-LOT",
        packagingRevisionId: fixture.oldPack.revisionId,
        containerId: "OLD-OCP-CARTON",
      },
      packageCount: 1,
      reason: "The calendar pack was opened for loose dispensing.",
    };
    const opened = await inventory.compositions.open(command);
    const replayed = await inventory.compositions.open(command);
    expect(opened.event.kind).toBe(InventoryEventKind.Transformation);
    expect(opened.event.metadata?.inventoryOnceComposition).toMatchObject({
      compositionId: "brand-x-composition",
      revisionId: "brand-x-composition-v1",
      sourcePackagingRevisionId: fixture.oldPack.revisionId,
      sourcePackageCount: 1,
    });
    expect(opened.event.traceabilityChanges).toHaveLength(2);
    expect(
      opened.event.traceabilityChanges.every(
        /** Prefer the exact source container over its additional lot identity. */
        (change) => change.from.kind === InventoryTraceabilityNodeKind.Container
      )
    ).toBe(true);
    expect(replayed.replayed).toBe(true);

    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "active-a",
        itemRevisionId: "active-a-v1",
        locationId: "room",
        lotId: "OLD-OCP-LOT",
      })
    ).toBe(21);
    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "placebo-a",
        itemRevisionId: "placebo-a-v1",
        locationId: "room",
        lotId: "OLD-OCP-LOT",
      })
    ).toBe(7);
    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "active-b",
        itemRevisionId: "active-b-v1",
        locationId: "room",
        lotId: "OLD-OCP-LOT",
      })
    ).toBe(0);
    expect(
      (await inventory.read.lot("active-a", "OLD-OCP-LOT"))?.definition
        .expiresAt
    ).toBe("2028-01-01T00:00:00.000Z");
    const newPackRows = await inventory.read.positions({
      itemId: fixture.newPackItem.itemId,
      itemRevisionIds: [fixture.newPackItem.revisionId],
      locationIds: ["store"],
      packagingRevisionIds: [fixture.newPack.revisionId],
    });
    expect(newPackRows[0]?.measurements.primary.quantity.amountMinor).toBe(1);

    await expect(
      inventory.compositions.open({
        ...command,
        packageCount: 2,
      })
    ).rejects.toThrow("changed intent");
  });

  it("scales the new 20+5+3 vector exactly for several whole packs", async () => {
    const fixture = ocpCatalog();
    const inventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-two-new-ocp-packs",
      occurredAt: time0,
      to: {
        itemId: fixture.newPackItem.itemId,
        locationId: "store",
        lotId: "NEW-TWO",
      },
      amount: packageAmount(2, fixture.newPack.revisionId),
    });
    await inventory.compositions.open({
      operationId: "open-two-new-ocp-packs",
      occurredAt: time1,
      from: {
        itemId: fixture.newPackItem.itemId,
        locationId: "store",
        lotId: "NEW-TWO",
        packagingRevisionId: fixture.newPack.revisionId,
      },
      packageCount: 2,
    });
    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "active-a",
        itemRevisionId: "active-a-v1",
        locationId: "store",
        lotId: "NEW-TWO",
      })
    ).toBe(40);
    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "active-b",
        itemRevisionId: "active-b-v1",
        locationId: "store",
        lotId: "NEW-TWO",
      })
    ).toBe(10);
    expect(
      await itemQuantity({
        inventory: inventory,
        itemId: "placebo-b",
        itemRevisionId: "placebo-b-v1",
        locationId: "store",
        lotId: "NEW-TWO",
      })
    ).toBe(6);
  });

  it("rejects multiple compositions for one source package and recursive package graphs", () => {
    const fixture = ocpCatalog();
    expect(() =>
      defineInventoryComposition({
        definition: fixture.catalog.compositionRevision(
          "brand-x-composition-v1"
        ),
        itemRevisions: [...fixture.catalog.itemRevisions, fixture.oldPackItem],
        packagingRevisions: fixture.catalog.packagingRevisions,
      })
    ).toThrow("Duplicate inventory item revision");
    expect(() =>
      defineInventoryComposition({
        definition: fixture.catalog.compositionRevision(
          "brand-x-composition-v1"
        ),
        itemRevisions: fixture.catalog.itemRevisions,
        packagingRevisions: [
          ...fixture.catalog.packagingRevisions,
          fixture.oldPack,
        ],
      })
    ).toThrow("Duplicate inventory packaging revision");
    const disguisedUnpack: InventoryCompositionDefinitionRevision = {
      compositionId: "disguised-unpack",
      revisionId: "disguised-unpack-v1",
      sourcePackagingRevisionId: fixture.oldPack.revisionId,
      outputs: [
        {
          outputId: "same-item",
          itemRevisionId: fixture.oldPackItem.revisionId,
          lotPolicy: InventoryCompositionOutputLotPolicy.None,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Measured,
            measurements: inventoryMeasurementVector(
              inventoryMeasurement("packs", parseQuantity("1", "pack"))
            ),
          },
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: fixture.catalog.itemRevisions,
        activeItemRevisionIds: fixture.catalog.activeItemRevisionIds,
        packagingRevisions: fixture.catalog.packagingRevisions,
        compositionRevisions: [disguisedUnpack],
        activeCompositionRevisionIds: {
          [disguisedUnpack.compositionId]: disguisedUnpack.revisionId,
        },
      })
    ).toThrow("use homogeneous pack/unpack");
    const duplicate: InventoryCompositionDefinitionRevision = {
      compositionId: "duplicate-old-composition",
      revisionId: "duplicate-old-composition-v1",
      sourcePackagingRevisionId: fixture.oldPack.revisionId,
      outputs: [
        {
          outputId: "duplicate-active",
          itemRevisionId: "active-a-v1",
          lotPolicy: InventoryCompositionOutputLotPolicy.None,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Measured,
            measurements: tablets("1"),
          },
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: fixture.catalog.itemRevisions,
        activeItemRevisionIds: fixture.catalog.activeItemRevisionIds,
        packagingRevisions: fixture.catalog.packagingRevisions,
        compositionRevisions: [
          ...fixture.catalog.compositionRevisions,
          duplicate,
        ],
        activeCompositionRevisionIds: {
          ...fixture.catalog.activeCompositionRevisionIds,
          "duplicate-old-composition": duplicate.revisionId,
        },
      })
    ).toThrow("more than one heterogeneous composition");

    const kitA = defineScalarInventoryItem({
      itemId: "kit-a",
      revisionId: "kit-a-v1",
      unit: "pack",
      axisId: "packs",
    });
    const kitB = defineScalarInventoryItem({
      itemId: "kit-b",
      revisionId: "kit-b-v1",
      unit: "pack",
      axisId: "packs",
    });
    const packageA = defineScalarInventoryPackaging({
      revisionId: "kit-a-package-v1",
      item: kitA,
      packageUnit: "pack",
      contains: "1",
    });
    const packageB = defineScalarInventoryPackaging({
      revisionId: "kit-b-package-v1",
      item: kitB,
      packageUnit: "pack",
      contains: "1",
    });
    const compositionA: InventoryCompositionDefinitionRevision = {
      compositionId: "kit-a-composition",
      revisionId: "kit-a-composition-v1",
      sourcePackagingRevisionId: packageA.revisionId,
      outputs: [
        {
          outputId: "kit-b",
          itemRevisionId: kitB.revisionId,
          lotPolicy: InventoryCompositionOutputLotPolicy.None,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Package,
            packagingRevisionId: packageB.revisionId,
            packageCount: 1,
          },
        },
      ],
    };
    const compositionB: InventoryCompositionDefinitionRevision = {
      compositionId: "kit-b-composition",
      revisionId: "kit-b-composition-v1",
      sourcePackagingRevisionId: packageB.revisionId,
      outputs: [
        {
          outputId: "kit-a",
          itemRevisionId: kitA.revisionId,
          lotPolicy: InventoryCompositionOutputLotPolicy.None,
          amount: {
            kind: InventoryCompositionOutputAmountKind.Package,
            packagingRevisionId: packageA.revisionId,
            packageCount: 1,
          },
        },
      ],
    };
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: [kitA, kitB],
        activeItemRevisionIds: {
          [kitA.itemId]: kitA.revisionId,
          [kitB.itemId]: kitB.revisionId,
        },
        packagingRevisions: [packageA, packageB],
        compositionRevisions: [compositionA, compositionB],
        activeCompositionRevisionIds: {
          [compositionA.compositionId]: compositionA.revisionId,
          [compositionB.compositionId]: compositionB.revisionId,
        },
      })
    ).toThrow("composition graph contains a cycle");
  });

  it("clones composition output arrays so caller mutation cannot reinterpret retained stock", () => {
    const fixture = ocpCatalog();
    const retained = fixture.catalog.compositionRevision(
      "brand-x-composition-v1"
    );
    const callerOutputs = [...retained.outputs];
    const copied: InventoryCompositionDefinitionRevision = {
      compositionId: "copied-composition",
      revisionId: "copied-composition-v1",
      sourcePackagingRevisionId: fixture.oldPack.revisionId,
      outputs: callerOutputs,
    };
    const catalog = defineInventoryCatalog({
      itemRevisions: fixture.catalog.itemRevisions,
      activeItemRevisionIds: fixture.catalog.activeItemRevisionIds,
      packagingRevisions: fixture.catalog.packagingRevisions,
      compositionRevisions: [copied],
      activeCompositionRevisionIds: {
        [copied.compositionId]: copied.revisionId,
      },
    });
    callerOutputs[0] = {
      outputId: "mutated",
      itemRevisionId: "active-a-v1",
      lotPolicy: InventoryCompositionOutputLotPolicy.None,
      amount: {
        kind: InventoryCompositionOutputAmountKind.Measured,
        measurements: tablets("999"),
      },
    };
    expect(
      catalog.compositionRevision(copied.revisionId).outputs.map(
        /** Read retained output ids after caller-owned array mutation. */
        (output) => output.outputId
      )
    ).toEqual(["active-a", "placebo-a"]);
  });

  it("keeps every output at the source location and rejects undeclared placement fields", async () => {
    const fixture = ocpCatalog();
    const inventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-placement-guard-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        lotId: "PLACEMENT-GUARD-LOT",
        statusId: "usable",
        ownerId: "clinic-owner",
        custodianId: "clinic-custodian",
        dispositionAuthorityId: "clinic-authority",
      },
      amount: packageAmount(1, fixture.oldPack.revisionId),
    });
    const hiddenRelocation = {
      metadata: { attemptedRelocation: true },
      locationId: "room",
    };
    await expect(
      inventory.compositions.open({
        operationId: "reject-hidden-composition-transfer",
        occurredAt: time1,
        from: {
          itemId: fixture.oldPackItem.itemId,
          locationId: "store",
          lotId: "PLACEMENT-GUARD-LOT",
          packagingRevisionId: fixture.oldPack.revisionId,
          statusId: "usable",
          ownerId: "clinic-owner",
          custodianId: "clinic-custodian",
          dispositionAuthorityId: "clinic-authority",
        },
        packageCount: 1,
        outputPlacements: { "active-a": hiddenRelocation },
      })
    ).rejects.toThrow("unsupported field 'locationId'");

    // Put active-a on the prototype so compositions.open proves it reads only own placement properties.
    const inheritedPlacements = Object.create({
      "active-a": hiddenRelocation,
    }) as Record<string, { readonly metadata?: InventoryMetadata }>;
    await inventory.compositions.open({
      operationId: "open-placement-guard-pack",
      occurredAt: time2,
      from: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        lotId: "PLACEMENT-GUARD-LOT",
        packagingRevisionId: fixture.oldPack.revisionId,
        statusId: "usable",
        ownerId: "clinic-owner",
        custodianId: "clinic-custodian",
        dispositionAuthorityId: "clinic-authority",
      },
      packageCount: 1,
      outputPlacements: inheritedPlacements,
    });
    const outputs = await inventory.read.positions({
      itemId: "active-a",
      locationIds: ["store"],
      lotIds: ["PLACEMENT-GUARD-LOT"],
    });
    expect(outputs[0]?.key).toMatchObject({
      locationId: "store",
      statusId: "usable",
      ownerId: "clinic-owner",
      custodianId: "clinic-custodian",
      dispositionAuthorityId: "clinic-authority",
    });
    expect(
      await inventory.read.positions({
        itemId: "active-a",
        locationIds: ["room"],
      })
    ).toEqual([]);
  });

  it("requires an explicit genealogy choice when an output has several physical identities", async () => {
    const fixture = ocpCatalog();
    const inventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-ambiguous-output-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.newPackItem.itemId,
        locationId: "store",
        lotId: "AMBIGUOUS-SOURCE-LOT",
      },
      amount: packageAmount(1, fixture.newPack.revisionId),
      lot: { expiresAt: "2029-01-01T00:00:00.000Z" },
    });
    await expect(
      inventory.compositions.open({
        operationId: "open-ambiguous-output-pack",
        occurredAt: time1,
        from: {
          itemId: fixture.newPackItem.itemId,
          locationId: "store",
          lotId: "AMBIGUOUS-SOURCE-LOT",
          packagingRevisionId: fixture.newPack.revisionId,
        },
        packageCount: 1,
        outputPlacements: {
          "active-a": {
            serialId: "AMBIGUOUS-SERIAL",
            containerId: "AMBIGUOUS-CONTAINER",
          },
        },
      })
    ).rejects.toThrow(/several stock identities/i);
  });

  it("requires an explicit genealogy choice when the source has several physical identities", async () => {
    const fixture = ocpCatalog();
    const inventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-ambiguous-source-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.newPackItem.itemId,
        locationId: "store",
        lotId: "AMBIGUOUS-SOURCE-LOT",
        serialId: "AMBIGUOUS-SOURCE-SERIAL",
        containerId: "AMBIGUOUS-SOURCE-CONTAINER",
      },
      amount: packageAmount(1, fixture.newPack.revisionId),
      lot: { expiresAt: "2029-01-01T00:00:00.000Z" },
      container: { containerType: "calendar-pack" },
    });
    const from = {
      itemId: fixture.newPackItem.itemId,
      locationId: "store",
      lotId: "AMBIGUOUS-SOURCE-LOT",
      serialId: "AMBIGUOUS-SOURCE-SERIAL",
      containerId: "AMBIGUOUS-SOURCE-CONTAINER",
      packagingRevisionId: fixture.newPack.revisionId,
    };
    await expect(
      inventory.compositions.open({
        operationId: "reject-ambiguous-source-pack",
        occurredAt: time1,
        from,
        packageCount: 1,
      })
    ).rejects.toThrow(/several stock identities/i);

    await expect(
      inventory.compositions.open({
        operationId: "open-explicit-ambiguous-source-pack",
        occurredAt: time2,
        from,
        packageCount: 1,
        sourceTraceabilityNode: {
          kind: InventoryTraceabilityNodeKind.Container,
          id: "AMBIGUOUS-SOURCE-CONTAINER",
        },
      })
    ).resolves.toBeDefined();
  });

  it("enforces strict, optional, and explicit lot policies without guessing", async () => {
    const fixture = ocpCatalog();
    const strictInventory = createInventoryOnce({
      catalog: fixture.catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await strictInventory.stock.receive({
      operationId: "receive-strict-no-lot-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
      },
      amount: packageAmount(1, fixture.oldPack.revisionId),
    });
    await expect(
      strictInventory.compositions.open({
        operationId: "reject-strict-no-lot-open",
        occurredAt: time1,
        from: {
          itemId: fixture.oldPackItem.itemId,
          locationId: "store",
          packagingRevisionId: fixture.oldPack.revisionId,
        },
        packageCount: 1,
      })
    ).rejects.toThrow("requires the source package to have a lotId");

    const optionalCompositions = fixture.catalog.compositionRevisions.map(
      /** Copy the fixture with an explicit optional source-lot preservation policy. */
      (definition) => ({
        ...definition,
        outputs: definition.outputs.map(
          /** Preserve source lot when available but permit legacy aggregate packs. */
          (output) => ({
            ...output,
            lotPolicy:
              InventoryCompositionOutputLotPolicy.InheritSourceWhenPresent,
          })
        ),
      })
    );
    const optionalCatalog = defineInventoryCatalog({
      itemRevisions: fixture.catalog.itemRevisions,
      activeItemRevisionIds: fixture.catalog.activeItemRevisionIds,
      packagingRevisions: fixture.catalog.packagingRevisions,
      compositionRevisions: optionalCompositions,
      activeCompositionRevisionIds:
        fixture.catalog.activeCompositionRevisionIds,
    });
    const optionalInventory = createInventoryOnce({
      catalog: optionalCatalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await optionalInventory.stock.receive({
      operationId: "receive-optional-no-lot-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
      },
      amount: packageAmount(1, fixture.oldPack.revisionId),
    });
    await optionalInventory.compositions.open({
      operationId: "open-optional-no-lot-pack",
      occurredAt: time1,
      from: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        packagingRevisionId: fixture.oldPack.revisionId,
      },
      packageCount: 1,
    });
    const unqualifiedOutputs = await optionalInventory.read.positions({
      itemId: "active-a",
      locationIds: ["store"],
    });
    expect(unqualifiedOutputs[0]?.key.lotId).toBeUndefined();
    expect(
      unqualifiedOutputs[0]?.measurements.primary.quantity.amountMinor
    ).toBe(21);

    const strictV1 = fixture.catalog.compositionRevision(
      "brand-x-composition-v1"
    );
    const explicitV1 = {
      ...strictV1,
      revisionId: "brand-x-composition-explicit-v1",
      outputs: strictV1.outputs.map(
        /** Require a separately named output lot for each produced item. */
        (output) => ({
          ...output,
          lotPolicy: InventoryCompositionOutputLotPolicy.Explicit,
        })
      ),
    };
    const explicitCatalog = defineInventoryCatalog({
      itemRevisions: fixture.catalog.itemRevisions,
      activeItemRevisionIds: fixture.catalog.activeItemRevisionIds,
      packagingRevisions: fixture.catalog.packagingRevisions,
      compositionRevisions: [explicitV1],
      activeCompositionRevisionIds: {
        [explicitV1.compositionId]: explicitV1.revisionId,
      },
    });
    const explicitInventory = createInventoryOnce({
      catalog: explicitCatalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await explicitInventory.stock.receive({
      operationId: "receive-explicit-lot-pack",
      occurredAt: time0,
      to: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
      },
      amount: packageAmount(1, fixture.oldPack.revisionId),
    });
    const explicitOpen = {
      operationId: "open-explicit-lot-pack",
      occurredAt: time1,
      from: {
        itemId: fixture.oldPackItem.itemId,
        locationId: "store",
        packagingRevisionId: fixture.oldPack.revisionId,
      },
      packageCount: 1,
    };
    await expect(
      explicitInventory.compositions.open(explicitOpen)
    ).rejects.toThrow("requires an explicit lotId");
    await explicitInventory.compositions.open({
      ...explicitOpen,
      outputPlacements: {
        "active-a": {
          lotId: "ACTIVE-OUTPUT-LOT",
          lot: { expiresAt: "2028-01-01T00:00:00.000Z" },
        },
        "placebo-a": { lotId: "PLACEBO-OUTPUT-LOT" },
      },
    });
    expect(
      await itemQuantity({
        inventory: explicitInventory,
        itemId: "active-a",
        itemRevisionId: "active-a-v1",
        locationId: "store",
        lotId: "ACTIVE-OUTPUT-LOT",
      })
    ).toBe(21);
    expect(
      await itemQuantity({
        inventory: explicitInventory,
        itemId: "placebo-a",
        itemRevisionId: "placebo-a-v1",
        locationId: "store",
        lotId: "PLACEBO-OUTPUT-LOT",
      })
    ).toBe(7);
  });
});


describe("composition amount discriminator admission", () => {
  it("rejects unknown amount kinds before catalog normalization can reinterpret them as packages", () => {
    const fixture = ocpCatalog();
    const outputItem = fixture.catalog.itemRevision("active-a-v1");
    const outputPackaging = defineScalarInventoryPackaging({ revisionId: "boundary-output-package", item: outputItem, packageUnit: "blister", contains: "1" });
    const amount: InventoryCompositionDefinitionRevision["outputs"][number]["amount"] = { kind: InventoryCompositionOutputAmountKind.Package, packagingRevisionId: outputPackaging.revisionId, packageCount: 1 };
    const definition: InventoryCompositionDefinitionRevision = {
      compositionId: "boundary-composition", revisionId: "boundary-composition-v1", sourcePackagingRevisionId: fixture.oldPack.revisionId,
      outputs: [{ outputId: "boundary-output", itemRevisionId: outputItem.revisionId, lotPolicy: InventoryCompositionOutputLotPolicy.InheritSource, amount }],
    };
    const create = () => defineInventoryComposition({ definition, itemRevisions: fixture.catalog.itemRevisions, packagingRevisions: [...fixture.catalog.packagingRevisions, outputPackaging] });
    expect(create().outputs[0]?.amount.kind).toBe(InventoryCompositionOutputAmountKind.Package);
    for (const kind of ["future-composition-kind", "", undefined, null, 0]) {
      Reflect.set(amount, "kind", kind);
      expect(create).toThrow("Inventory composition output amount kind is invalid");
    }
  });
});
