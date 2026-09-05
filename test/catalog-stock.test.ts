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
      occurredAt: time0,
      to: loosePosition("store", { lotId: "lot-old" }),
      amount: packageAmount(2, "item-a-box-20-v1"),
    });
    await inventory.stock.receive({
      operationId: "receive-new-box",
      occurredAt: time1,
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
      occurredAt: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "DUPLICATE-PACKAGE" }),
          amount: packageAmount(1, "item-a-box-24-v1"),
          lot: { expiresAt: "2027-01-01T00:00:00.000Z" },
        },
        {
          to: loosePosition("store", { lotId: "DUPLICATE-PACKAGE" }),
          amount: packageAmount(1, "item-a-box-24-v1"),
          lot: { expiresAt: "2027-01-01T00:00:00.000Z" },
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
      definition: { expiresAt: "2027-01-01T00:00:00.000Z" },
    });
  });

  it("rejects conflicting metadata on duplicate receipt destinations atomically", async () => {
    const inventory = createTestInventory();
    await expect(
      inventory.stock.receiveMany({
        operationId: "reject-duplicate-receipt-metadata",
        occurredAt: time0,
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
      occurredAt: time0,
      to: { itemId: "catch-item", locationId: "cold-room" },
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "3.40", unit: "kg" },
      ]),
    });
    await inventory.stock.issue({
      operationId: "issue-measured",
      occurredAt: time1,
      from: { itemId: "catch-item", locationId: "cold-room" },
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
        occurredAt: time1,
        correctsEventId: received.event.eventId,
        reason: "Replacement changes only the independently measured weight.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAt: time0,
            to: { itemId: "catch-item", locationId: "cold-room" },
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
      occurredAt: time0,
      to: source,
      amount: stockAmount("10", "piece"),
    });
    const moved = await inventory.stock.transfer({
      operationId: "move-loose",
      occurredAt: time1,
      from: source,
      toLocationId: "room-b",
      amount: stockAmount("4", "piece"),
    });
    expect(moved.event.occurredAt).toBe(time1);
    expect(moved.event.recordedAt).toBe(time3);
    const destinationEffect = moved.event.stockEffects.find(
      (effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0
    );
    expect(destinationEffect?.position).toMatchObject({
      locationId: "room-b",
      lotId: "lot-1",
      statusId: "usable",
      ownerId: "owner-a",
      custodianId: "custodian-a",
      dispositionAuthorityId: "authority-a",
      qualifiedDimensions: [{ dimensionId: "grade", valueId: "a" }],
    });
    await inventory.stock.changeStatus({
      operationId: "quarantine-moved",
      occurredAt: time2,
      from: { ...source, locationId: "room-b" },
      toStatusId: "quarantine",
      amount: stockAmount("4", "piece"),
    });
    const quarantined = await inventory.read.positions({
      itemId: "item-a",
      locationIds: ["room-b"],
      statusIds: ["quarantine"],
    });
    expect(quarantined[0]?.measurements.primary.quantity.amountMinor).toBe(4);
  });

  it("normalizes transfer destinations once and rejects padded position identities", async () => {
    const inventory = createTestInventory();
    const source = loosePosition("room-a");
    await inventory.stock.receive({
      operationId: "receive-transfer-normalization",
      occurredAt: time0,
      to: source,
      amount: stockAmount("2", "piece"),
    });

    const moved = await inventory.stock.transfer({
      operationId: "move-trimmed-destination",
      occurredAt: time1,
      from: source,
      toLocationId: " room-b ",
      amount: stockAmount("1", "piece"),
    });
    expect(
      moved.event.stockEffects.find(
        (effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0
      )?.position.locationId
    ).toBe("room-b");

    await expect(
      inventory.stock.transfer({
        operationId: "move-padded-same-destination",
        occurredAt: time2,
        from: source,
        toLocationId: " room-a ",
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("source/destination locations must differ");

    await expect(
      inventory.stock.receive({
        operationId: "receive-padded-lot",
        occurredAt: time2,
        to: loosePosition("room-a", { lotId: " LOT-A " }),
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("surrounding whitespace");
  });

  it("packs and unpacks only whole counts of one exact immutable package revision", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-loose-v1",
      occurredAt: time0,
      to: loosePosition("store"),
      itemRevisionId: "item-a-v1",
      amount: stockAmount("40", "piece"),
    });
    await inventory.stock.pack({
      operationId: "pack-one",
      occurredAt: time1,
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
      occurredAt: time2,
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

  it("changes owner, custody, authority, container, and configured dimensions only through named verbs", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-dimensions",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeOwner({
      operationId: "change-owner",
      occurredAt: time1,
      from: loosePosition("store"),
      toOwnerId: "owner-b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeCustodian({
      operationId: "change-custodian",
      occurredAt: time1,
      from: loosePosition("store", { ownerId: "owner-b" }),
      toCustodianId: "custodian-b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeDispositionAuthority({
      operationId: "change-authority",
      occurredAt: time1,
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
    await inventory.stock.placeInContainer({
      operationId: "place-container",
      occurredAt: time2,
      from: beforeContainer,
      toContainerId: "container-1",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.changeQualifiedDimension({
      operationId: "set-grade",
      occurredAt: time2,
      from: { ...beforeContainer, containerId: "container-1" },
      dimensionId: "grade",
      toValueId: "b",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.removeFromContainer({
      operationId: "remove-container",
      occurredAt: time3,
      from: {
        ...beforeContainer,
        containerId: "container-1",
        qualifiedDimensions: [{ dimensionId: "grade", valueId: "b" }],
      },
      amount: stockAmount("1", "piece"),
    });
    const final = (await inventory.read.positions({ itemId: "item-a" }))[0];
    expect(final?.key).toMatchObject({
      ownerId: "owner-b",
      custodianId: "custodian-b",
      dispositionAuthorityId: "authority-b",
      qualifiedDimensions: [{ dimensionId: "grade", valueId: "b" }],
    });
    expect(final?.key.containerId).toBeUndefined();
  });

  it("replays exact intent once and rejects changed retry facts", async () => {
    const inventory = createTestInventory();
    const command = {
      operationId: "retry-receipt",
      occurredAt: time0,
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
