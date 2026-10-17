import { describe, expect, it } from "vitest";
import {
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  assertInventoryAmountSum,
  defineInventoryCatalog,
  defineInventoryItem,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  inventoryAmountFromUnit,
  measuredStockAmount,
  packageAmount,
  stockAmount,
  unitCode,
} from "../src/index.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

describe("catalogue, revisions, measurements, and stock verbs", () => {
  it("keeps old/new same-word package revisions in separate revision-qualified positions", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-old-box",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "lot-old" }),
      amount: packageAmount(2, "item-a-box-20-v1"),
    });
    await inventory.stock.receive({
      operationId: "receive-new-box",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "lot-new" }),
      amount: packageAmount(2, "item-a-box-24-v1"),
    });

    const positions = await inventory.read.positions({ itemId: "item-a" });
    expect(positions).toHaveLength(2);
    expect(
      positions.map((row) => [
        row.key.itemRevisionId,
        row.key.packagingRevisionId,
        row.measurements.primary.quantity.amountMinor,
      ])
    ).toEqual([
      ["item-a-v1", "item-a-box-20-v1", 40],
      ["item-a-v2", "item-a-box-24-v1", 48],
    ]);
  });

  it("resolves normalized primary/package units through one exact retained revision", () => {
    const catalog = createTabletCatalog();
    expect(
      inventoryAmountFromUnit({
        catalog,
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        value: "2.50",
        unit: "piece",
      })
    ).toEqual(stockAmount("2.50", "piece"));
    expect(
      inventoryAmountFromUnit({
        catalog,
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        value: "2.0",
        unit: "box",
      })
    ).toEqual(packageAmount(2, "item-a-box-24-v1"));
    expect(() =>
      inventoryAmountFromUnit({
        catalog,
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        value: "1.5",
        unit: "box",
      })
    ).toThrow("whole-number multiple");
  });

  it("rejects a human package unit that is ambiguous inside one exact item revision", () => {
    const item = defineScalarInventoryItem({
      itemId: "ambiguous-package-item",
      revisionId: "ambiguous-package-item-v1",
      unit: "piece",
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item],
      activeItemRevisionIds: { [item.itemId]: item.revisionId },
      packagingRevisions: [
        defineScalarInventoryPackaging({
          revisionId: "ambiguous-box-10",
          item,
          packageUnit: "box",
          contains: "10",
        }),
        defineScalarInventoryPackaging({
          revisionId: "ambiguous-box-20",
          item,
          packageUnit: "box",
          contains: "20",
        }),
      ],
    });
    expect(() =>
      inventoryAmountFromUnit({
        catalog,
        itemId: item.itemId,
        itemRevisionId: item.revisionId,
        value: "1",
        unit: "box",
      })
    ).toThrow("matches multiple package revisions");
  });

  it("proves parent and child amounts conserve exact measurements after package resolution", () => {
    const catalog = createTabletCatalog();
    const expectedAmount = inventoryAmountFromUnit({
      catalog,
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      value: "2",
      unit: "box",
    });
    const exactLines = [
      {
        itemRevisionId: "item-a-v2",
        amount: inventoryAmountFromUnit({
          catalog,
          itemId: "item-a",
          itemRevisionId: "item-a-v2",
          value: "1",
          unit: "box",
        }),
      },
      {
        itemRevisionId: "item-a-v2",
        amount: inventoryAmountFromUnit({
          catalog,
          itemId: "item-a",
          itemRevisionId: "item-a-v2",
          value: "24",
          unit: "piece",
        }),
      },
    ];
    expect(() =>
      assertInventoryAmountSum({
        catalog,
        itemId: "item-a",
        expectedItemRevisionId: "item-a-v2",
        expectedAmount,
        lines: exactLines,
        label: "Mixed package/base split",
      })
    ).not.toThrow();
    expect(() =>
      assertInventoryAmountSum({
        catalog,
        itemId: "item-a",
        expectedItemRevisionId: "item-a-v2",
        expectedAmount,
        lines: exactLines.slice(0, 1),
        label: "Mixed package/base split",
      })
    ).toThrow("must exactly equal the parent quantity");
  });

  it("extends retained catalogue facts append-only and rejects revision redefinition", () => {
    const catalog = createTabletCatalog();
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
    const extended = extendInventoryCatalog({
      catalog,
      itemRevisions: [itemV3],
      activeItemRevisionIds: { "item-a": itemV3.revisionId },
      packagingRevisions: [box30],
    });
    expect(extended.activeItem("item-a").revisionId).toBe("item-a-v3");
    expect(extended.packagingRevision(box30.revisionId)).toEqual(box30);
    expect(catalog.activeItem("item-a").revisionId).toBe("item-a-v2");
    expect(
      extendInventoryCatalog({
        catalog: extended,
        itemRevisions: [itemV3],
        packagingRevisions: [box30],
      })
    ).toBe(extended);
    const changedV3 = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v3",
      axisId: "doses",
      unit: "dose",
    });
    expect(() =>
      extendInventoryCatalog({ catalog: extended, itemRevisions: [changedV3] })
    ).toThrow("cannot be redefined");
  });

  it("combines duplicate native receipt destinations without losing intact package evidence", async () => {
    const inventory = createTestInventory();
    const command = {
      operationId: "receive-duplicate-package-lines",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "DUPLICATE-PACKAGE" }),
          amount: packageAmount(1, "item-a-box-24-v1"),
          lot: { expiresAtEpochMs: 1798761600000 },
        },
        {
          to: loosePosition("store", { lotId: "DUPLICATE-PACKAGE" }),
          amount: packageAmount(1, "item-a-box-24-v1"),
          lot: { expiresAtEpochMs: 1798761600000 },
        },
      ],
    };

    const received = await inventory.stock.receiveMany(command);
    const replayed = await inventory.stock.receiveMany(command);

    expect(received.event.stockEffects).toHaveLength(1);
    expect(received.event.stockEffects[0]).toMatchObject({
      position: {
        packagingRevisionId: "item-a-box-24-v1",
        lotId: "DUPLICATE-PACKAGE",
      },
      measurementsDelta: {
        primary: { quantity: { amountMinor: 48, unit: "piece" } },
      },
      evidence: {
        packagingRevisionId: "item-a-box-24-v1",
        packageCount: "2",
      },
    });
    expect(replayed.replayed).toBe(true);
    expect(
      await inventory.read.lot("item-a", "DUPLICATE-PACKAGE")
    ).toMatchObject({
      definition: { expiresAtEpochMs: 1798761600000 },
    });
  });

  it("rejects conflicting metadata on duplicate receipt destinations atomically", async () => {
    const inventory = createTestInventory();
    await expect(
      inventory.stock.receiveMany({
        operationId: "reject-duplicate-receipt-metadata",
        occurredAtEpochMs: time0,
        lines: [
          {
            to: loosePosition("store", { lotId: "DUPLICATE-METADATA" }),
            amount: stockAmount("1", "piece"),
            metadata: { source: "first" },
          },
          {
            to: loosePosition("store", { lotId: "DUPLICATE-METADATA" }),
            amount: stockAmount("1", "piece"),
            metadata: { source: "second" },
          },
        ],
      })
    ).rejects.toThrow("conflicting effect metadata");
    expect(await inventory.read.positions({ itemId: "item-a" })).toEqual([]);
  });

  it("combines duplicate issue scrap and exact transfer-route batch lines", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-duplicate-outgoing-lines",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("12", "piece"),
    });

    const issued = await inventory.stock.issueMany({
      operationId: "issue-duplicate-lines",
      occurredAtEpochMs: time1,
      lines: [
        { from: loosePosition("store"), amount: stockAmount("1", "piece") },
        { from: loosePosition("store"), amount: stockAmount("2", "piece") },
      ],
    });
    expect(issued.event.stockEffects).toHaveLength(1);
    expect(issued.event.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(-3);

    const transferred = await inventory.stock.transferMany({
      operationId: "transfer-duplicate-route-lines",
      occurredAtEpochMs: time2,
      lines: [
        { from: loosePosition("store"), toPlacementNodeId: "room-b", amount: stockAmount("1", "piece") },
        { from: loosePosition("store"), toPlacementNodeId: "room-b", amount: stockAmount("2", "piece") },
      ],
    });
    expect(transferred.event.stockEffects).toHaveLength(2);
    expect(
      transferred.event.stockEffects.find((effect) => effect.position.placementNodeId === "store")
        ?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(-3);
    expect(
      transferred.event.stockEffects.find((effect) => effect.position.placementNodeId === "room-b")
        ?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(3);

    const scrapped = await inventory.stock.scrapMany({
      operationId: "scrap-duplicate-lines",
      occurredAtEpochMs: time3,
      reason: "Destroyed in one physical batch.",
      lines: [
        { from: loosePosition("room-b"), amount: stockAmount("1", "piece") },
        { from: loosePosition("room-b"), amount: stockAmount("1", "piece") },
      ],
    });
    expect(scrapped.event.stockEffects).toHaveLength(1);
    expect(scrapped.event.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(-2);

    const positions = await inventory.read.positions({ itemId: "item-a" });
    const byPlacementNode = new Map(
      positions.map((position) => [
        position.key.placementNodeId,
        position.measurements.primary.quantity.amountMinor,
      ])
    );
    expect(byPlacementNode.get("store")).toBe(6);
    expect(byPlacementNode.get("room-b")).toBe(1);
  });

  it("combines duplicate reclassification and transformation positions systemically", async () => {
    const reclassificationInventory = createTestInventory();
    await reclassificationInventory.stock.receive({
      operationId: "receive-for-duplicate-reclassification",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("4", "piece"),
    });
    const reclassified = await reclassificationInventory.stock.reclassifyMany({
      operationId: "reclassify-duplicate-source-lines",
      occurredAtEpochMs: time1,
      consume: [
        { from: loosePosition("store"), amount: stockAmount("1", "piece") },
        { from: loosePosition("store"), amount: stockAmount("1", "piece") },
      ],
      produce: [
        {
          to: loosePosition("store", {
            qualifiedDimensions: [{ dimensionId: "grade", valueId: "b" }],
          }),
          amount: stockAmount("2", "piece"),
        },
      ],
    });
    expect(reclassified.event.stockEffects).toHaveLength(2);
    expect(
      reclassified.event.stockEffects.find(
        (effect) => effect.measurementsDelta.primary.quantity.amountMinor < 0
      )?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(-2);

    const transformationInventory = createTestInventory();
    await transformationInventory.stock.receive({
      operationId: "receive-for-duplicate-transformation",
      occurredAtEpochMs: time0,
      to: loosePosition("transform-store"),
      amount: stockAmount("2", "piece"),
    });
    const transformed = await transformationInventory.stock.transform({
      operationId: "transform-duplicate-consume-lines",
      occurredAtEpochMs: time1,
      consume: [
        { position: loosePosition("transform-store"), amount: stockAmount("1", "piece") },
        { position: loosePosition("transform-store"), amount: stockAmount("1", "piece") },
      ],
      produce: [
        {
          position: loosePosition("transform-store"),
          itemRevisionId: "item-a-v1",
          amount: stockAmount("2", "piece"),
        },
      ],
    });
    expect(transformed.event.stockEffects).toHaveLength(2);
    expect(
      transformed.event.stockEffects.find(
        (effect) => effect.position.itemRevisionId === "item-a-v1"
      )?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(2);
  });

  it("preserves package evidence while combining duplicate outgoing package lines", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-packages-for-duplicate-issue",
      occurredAtEpochMs: time0,
      lines: [
        { to: loosePosition("pack-store"), amount: packageAmount(1, "item-a-box-24-v1") },
        { to: loosePosition("pack-store"), amount: packageAmount(1, "item-a-box-24-v1") },
      ],
    });
    const issued = await inventory.stock.issueMany({
      operationId: "issue-duplicate-package-lines",
      occurredAtEpochMs: time1,
      lines: [
        { from: loosePosition("pack-store"), amount: packageAmount(1, "item-a-box-24-v1") },
        { from: loosePosition("pack-store"), amount: packageAmount(1, "item-a-box-24-v1") },
      ],
    });
    expect(issued.event.stockEffects).toHaveLength(1);
    expect(issued.event.stockEffects[0]).toMatchObject({
      measurementsDelta: {
        primary: { quantity: { amountMinor: -48, unit: "piece" } },
      },
      evidence: {
        packagingRevisionId: "item-a-box-24-v1",
        packageCount: "2",
      },
    });
  });

  it("rejects conflicting duplicate outgoing metadata and non-disjoint transfer routes", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-duplicate-outgoing-rejections",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("8", "piece"),
    });
    await expect(
      inventory.stock.issueMany({
        operationId: "reject-duplicate-issue-metadata",
        occurredAtEpochMs: time1,
        lines: [
          { from: loosePosition("store"), amount: stockAmount("1", "piece"), metadata: { source: "a" } },
          { from: loosePosition("store"), amount: stockAmount("1", "piece"), metadata: { source: "b" } },
        ],
      })
    ).rejects.toThrow("conflicting effect metadata");
    await expect(
      inventory.stock.transferMany({
        operationId: "reject-transfer-source-split",
        occurredAtEpochMs: time1,
        lines: [
          { from: loosePosition("store"), toPlacementNodeId: "room-b", amount: stockAmount("1", "piece") },
          { from: loosePosition("store"), toPlacementNodeId: "room-c", amount: stockAmount("1", "piece") },
        ],
      })
    ).rejects.toThrow("disjoint one-to-one exact source/destination routes");
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]
        ?.measurements.primary.quantity.amountMinor
    ).toBe(8);
  });

  it("stores primary and independently measured truth without converting one into the other", async () => {
    const measuredItem = defineInventoryItem({
      itemId: "catch-item",
      revisionId: "catch-item-v1",
      primaryAxis: {
        axisId: "pieces",
        role: InventoryMeasurementAxisRole.Primary,
        unit: unitCode("piece"),
        requirement: InventoryMeasurementRequirement.Required,
      },
      independentAxes: [
        {
          axisId: "weight",
          role: InventoryMeasurementAxisRole.Independent,
          unit: unitCode("kg"),
          requirement: InventoryMeasurementRequirement.Required,
        },
      ],
      reservationAxisId: "pieces",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Optional,
      },
      qualifiedDimensions: [],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [measuredItem],
      activeItemRevisionIds: { "catch-item": measuredItem.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog);
    const received = await inventory.stock.receive({
      operationId: "receive-measured",
      occurredAtEpochMs: time0,
      to: { itemId: "catch-item", placementNodeId: "cold-room" },
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "3.40", unit: "kg" },
      ]),
    });
    await inventory.stock.issue({
      operationId: "issue-measured",
      occurredAtEpochMs: time1,
      from: { itemId: "catch-item", placementNodeId: "cold-room" },
      amount: measuredStockAmount("1", "piece", [
        { axisId: "weight", value: "1.55", unit: "kg" },
      ]),
    });

    const positions = await inventory.read.positions({ itemId: "catch-item" });
    expect(positions[0]?.measurements.primary.quantity.amountMinor).toBe(1);
    expect(positions[0]?.measurements.independent[0]?.quantity).toMatchObject({
      amountMinor: 185,
      decimals: 2,
      unit: "kg",
    });
    await expect(
      inventory.stock.correct({
        operationId: "correct-measured-only-weight",
        occurredAtEpochMs: time1,
        correctsEventId: received.event.eventId,
        reason: "Replacement changes only the independently measured weight.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: time0,
            to: { itemId: "catch-item", placementNodeId: "cold-room" },
            amount: measuredStockAmount("2", "piece", [
              { axisId: "weight", value: "3.50", unit: "kg" },
            ]),
          }),
      })
    ).rejects.toThrow(
      "Inventory correction cannot change independent measurements without changing primary stock."
    );
  });

  it("uses declarative verbs and preserves every unnamed dimension on transfer", async () => {
    const inventory = createTestInventory();
    const source = loosePosition("room-a", {
      lotId: "lot-1",
      statusId: "usable",
      ownerId: "owner-a",
      custodianId: "custodian-a",
      dispositionAuthorityId: "authority-a",
      qualifiedDimensions: [{ dimensionId: "grade", valueId: "a" }],
    });
    await inventory.stock.receive({
      operationId: "receive-loose",
      occurredAtEpochMs: time0,
      to: source,
      amount: stockAmount("10", "piece"),
    });
    const moved = await inventory.stock.transfer({
      operationId: "move-loose",
      occurredAtEpochMs: time1,
      from: source,
      toPlacementNodeId: "room-b",
      amount: stockAmount("4", "piece"),
    });
    expect(moved.event.occurredAtEpochMs).toBe(time1);
    expect(moved.event.recordedAtEpochMs).toBe(time3);
    const destinationEffect = moved.event.stockEffects.find(
      (effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0
    );
    expect(destinationEffect?.position).toMatchObject({
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      placementNodeId: "room-b",
      lotId: "lot-1",
      statusId: "usable",
      ownerId: "owner-a",
      custodianId: "custodian-a",
      dispositionAuthorityId: "authority-a",
      qualifiedDimensions: [{ dimensionId: "grade", valueId: "a" }],
    });
    await inventory.stock.changeStatus({
      operationId: "quarantine-moved",
      occurredAtEpochMs: time2,
      from: { ...source, placementNodeId: "room-b" },
      toStatusId: "quarantine",
      amount: stockAmount("4", "piece"),
    });
    const quarantined = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["room-b"],
      statusIds: ["quarantine"],
    });
    expect(quarantined[0]?.measurements.primary.quantity.amountMinor).toBe(4);
  });

  it("normalizes transfer destinations once and rejects padded position identities", async () => {
    const inventory = createTestInventory();
    const source = loosePosition("room-a");
    await inventory.stock.receive({
      operationId: "receive-transfer-normalization",
      occurredAtEpochMs: time0,
      to: source,
      amount: stockAmount("2", "piece"),
    });

    const moved = await inventory.stock.transfer({
      operationId: "move-trimmed-destination",
      occurredAtEpochMs: time1,
      from: source,
      toPlacementNodeId: " room-b ",
      amount: stockAmount("1", "piece"),
    });
    expect(
      moved.event.stockEffects.find(
        (effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0
      )?.position.placementNodeId
    ).toBe("room-b");

    await expect(
      inventory.stock.transfer({
        operationId: "move-padded-same-destination",
        occurredAtEpochMs: time2,
        from: source,
        toPlacementNodeId: " room-a ",
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("source/destination direct placement nodes must differ");

    await expect(
      inventory.stock.receive({
        operationId: "receive-padded-lot",
        occurredAtEpochMs: time2,
        to: loosePosition("room-a", { lotId: " LOT-A " }),
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("surrounding whitespace");
  });

  it("packs and unpacks only whole counts of one exact immutable package revision", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-loose-v1",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      itemRevisionId: "item-a-v1",
      amount: stockAmount("40", "piece"),
    });
    await inventory.stock.pack({
      operationId: "pack-one",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      packagingRevisionId: "item-a-box-20-v1",
      packageCount: 1,
    });
    expect(
      await inventory.read.positions({
        itemId: "item-a",
        packagingRevisionIds: ["item-a-box-20-v1"],
      })
    ).toHaveLength(1);
    await inventory.stock.unpack({
      operationId: "unpack-one",
      occurredAtEpochMs: time2,
      from: loosePosition("store", {
        packagingRevisionId: "item-a-box-20-v1",
      }),
      packageCount: 1,
    });
    const loose = await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
    });
    expect(loose).toHaveLength(1);
    expect(loose[0]?.measurements.primary.quantity.amountMinor).toBe(40);
  });

  it("changes owner, custody, authority, direct placement, and configured dimensions only through named verbs", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-dimensions",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeOwner({
      operationId: "change-owner",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      toOwnerId: "owner-b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeCustodian({
      operationId: "change-custodian",
      occurredAtEpochMs: time1,
      from: loosePosition("store", { ownerId: "owner-b" }),
      toCustodianId: "custodian-b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeDispositionAuthority({
      operationId: "change-authority",
      occurredAtEpochMs: time1,
      from: loosePosition("store", {
        ownerId: "owner-b",
        custodianId: "custodian-b",
      }),
      toDispositionAuthorityId: "authority-b",
      amount: stockAmount("1", "piece"),
    });
    const beforeContainer = loosePosition("store", {
      ownerId: "owner-b",
      custodianId: "custodian-b",
      dispositionAuthorityId: "authority-b",
    });
    await inventory.stock.transfer({
      operationId: "move-to-container-node",
      occurredAtEpochMs: time2,
      from: beforeContainer,
      toPlacementNodeId: "container-1",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeQualifiedDimension({
      operationId: "set-grade",
      occurredAtEpochMs: time2,
      from: { ...beforeContainer, placementNodeId: "container-1" },
      dimensionId: "grade",
      toValueId: "b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "move-back-from-container-node",
      occurredAtEpochMs: time3,
      from: {
        ...beforeContainer,
        placementNodeId: "container-1",
        qualifiedDimensions: [{ dimensionId: "grade", valueId: "b" }],
      },
      toPlacementNodeId: "store",
      amount: stockAmount("1", "piece"),
    });
    const final = (await inventory.read.positions({ itemId: "item-a" }))[0];
    expect(final?.key).toMatchObject({
      ownerId: "owner-b",
      custodianId: "custodian-b",
      dispositionAuthorityId: "authority-b",
      qualifiedDimensions: [{ dimensionId: "grade", valueId: "b" }],
    });
    expect(final?.key.placementNodeId).toBe("store");
  });

  it("replays exact intent once and rejects changed retry facts", async () => {
    const inventory = createTestInventory();
    const command = {
      operationId: "retry-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    };
    const first = await inventory.stock.receive(command);
    const replay = await inventory.stock.receive(command);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.event.eventId).toBe(first.event.eventId);
    await expect(
      inventory.stock.receive({
        ...command,
        amount: stockAmount("6", "piece"),
      })
    ).rejects.toThrow("changed intent");
    expect((await inventory.read.world()).projection.lastRecordSequence).toBe(
      1
    );
  });

  it("rejects duplicate immutable package revision identities", () => {
    const catalog = createTabletCatalog();
    const oldPackage = catalog.packagingRevision("item-a-box-20-v1");
    expect(() =>
      defineInventoryCatalog({
        itemRevisions: catalog.itemRevisions,
        activeItemRevisionIds: { "item-a": "item-a-v2" },
        packagingRevisions: [oldPackage, oldPackage],
      })
    ).toThrow("Duplicate inventory packaging revision");
  });
});
