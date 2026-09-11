import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryEventKind,
  InventoryReservationFeasibilityStatus,
  InventoryTraceabilityNodeKind,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  inventoryStockSelector,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
} from "../src/migrations-api.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-CONTAINER-COMMAND-ATOMIC",
] as const;

/** Container use-by after opening but before the later test authority time. */
const shortUseBy = 1787563800000;
/** Corrected container use-by later than all test authority times. */
const longUseBy = 1798761600000;
/** Source lot expiry later than the short container-specific use-by. */
const lotExpiryEpochMs = 1830297600000;

/** Add a second item so whole-container tests prove rows are not rebuilt item-by-item outside the package. */
function createHeterogeneousContainerCatalog() {
  const catalog = createTabletCatalog();
  const instrument = defineScalarInventoryItem({
    itemId: "item-b",
    revisionId: "item-b-v1",
    unit: "piece",
    axisId: "pieces",
  });
  return extendInventoryCatalog({
    catalog,
    itemRevisions: [instrument],
    activeItemRevisionIds: { "item-b": instrument.revisionId },
  });
}

/** Return current scalar stock in one exact container. */
async function quantityInContainer(
  inventory: ReturnType<typeof createTestInventory>,
  containerId: string
): Promise<number> {
  const positions = await inventory.read.positions({
    itemId: "item-a",
    containerIds: [containerId],
  });
  let total = 0;
  for (const position of positions) {
    total += position.measurements.primary.quantity.amountMinor;
  }
  return total;
}

describe("native handling-unit masters", () => {
  it("moves and re-statuses heterogeneous nested contents while preserving every other field", async () => {
    const catalog = createHeterogeneousContainerCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receiveMany({
      operationId: "receive-whole-pallet-contents",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", {
            lotId: "OUTER-LOT",
            containerId: "PALLET-1",
            ownerId: "clinic",
          }),
          amount: stockAmount("3", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          container: { containerType: "pallet" },
        },
        {
          to: loosePosition("store", {
            lotId: "INNER-LOT",
            containerId: "CARTON-1",
            ownerId: "clinic",
          }),
          amount: packageAmount(30, "item-a-box-20-v1"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          container: { containerType: "carton" },
        },
        {
          to: {
            itemId: "item-b",
            locationId: "store",
            lotId: "INSTRUMENT-LOT",
            serialId: "INSTRUMENT-001",
            containerId: "CARTON-1",
            ownerId: "clinic",
          },
          amount: stockAmount("1", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          container: { containerType: "carton" },
        },
      ],
    });
    await inventory.traceability.aggregate({
      operationId: "put-carton-on-pallet",
      occurredAtEpochMs: time1,
      from: { kind: InventoryTraceabilityNodeKind.Container, id: "CARTON-1" },
      to: { kind: InventoryTraceabilityNodeKind.Container, id: "PALLET-1" },
    });
    await inventory.reservations.reserve({
      reservationId: "exact-carton-packages",
      operationId: "reserve-carton-packages",
      itemRevisionId: "item-a-v1",
      selector: {
        itemId: "item-a",
        containerIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      },
      requested: parseQuantity("600", "piece"),
      createdAtEpochMs: time1,
    });
    const packagedPosition = (
      await inventory.read.positions({
        itemId: "item-a",
        containerIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      })
    )[0];
    if (packagedPosition === undefined)
      throw new Error("Expected nested package stock.");
    await inventory.reservations.allocate({
      operationId: "allocate-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: packagedPosition.key,
          quantity: parseQuantity("600", "piece"),
        },
      ],
    });
    await expect(
      inventory.containers.transfer({
        operationId: "blocked-pallet-transfer",
        occurredAtEpochMs: time2,
        containerId: "PALLET-1",
        toLocationId: "room",
      })
    ).rejects.toThrow("exact reservation bindings");
    await inventory.reservations.release({
      operationId: "release-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time2,
    });
    await inventory.reservations.reserve({
      reservationId: "broad-instrument-claim",
      operationId: "reserve-broad-instrument",
      itemRevisionId: "item-b-v1",
      selector: { itemId: "item-b" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time2,
    });

    const moved = await inventory.containers.transfer({
      operationId: "move-whole-pallet",
      occurredAtEpochMs: time3,
      containerId: "PALLET-1",
      toLocationId: "room",
    });
    expect(moved.event.kind).toBe(InventoryEventKind.Transfer);
    const movedRows = await inventory.read.positions({ itemId: "item-a" });
    const movedInstrumentRows = await inventory.read.positions({
      itemId: "item-b",
    });
    expect([...movedRows, ...movedInstrumentRows]).toHaveLength(3);
    expect(
      [...movedRows, ...movedInstrumentRows].every(
        /** Every outer/direct and nested row moved under the one pallet fact. */
        (position) => position.key.locationId === "room"
      )
    ).toBe(true);
    expect(
      movedRows.find(
        /** Find the old exact package revision after the whole-unit move. */
        (position) => position.key.packagingRevisionId === "item-a-box-20-v1"
      )?.key
    ).toMatchObject({
      lotId: "INNER-LOT",
      containerId: "CARTON-1",
      ownerId: "clinic",
      packagingRevisionId: "item-a-box-20-v1",
    });
    expect(movedInstrumentRows[0]?.key).toMatchObject({
      serialId: "INSTRUMENT-001",
      containerId: "CARTON-1",
      ownerId: "clinic",
    });

    await inventory.containers.changeStatus({
      operationId: "quarantine-whole-pallet",
      occurredAtEpochMs: time3,
      containerId: "PALLET-1",
      toStatusId: "quarantine",
    });
    const quarantined = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ];
    expect(
      quarantined.every(
        /** Status changes on every nested content row but does not flatten its container identity. */
        (position) => position.key.statusId === "quarantine"
      )
    ).toBe(true);
    await inventory.containers.clearStatus({
      operationId: "clear-whole-pallet-status",
      occurredAtEpochMs: time3,
      containerId: "PALLET-1",
    });
    const cleared = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ];
    expect(
      cleared.every(
        /** Clear removes only status and keeps all other row fields intact. */
        (position) => position.key.statusId === undefined
      )
    ).toBe(true);
  });

  it("issues a whole container and records whole-container scrap shortage truth", async () => {
    const issuedInventory = createTestInventory();
    await issuedInventory.stock.receiveMany({
      operationId: "receive-container-to-issue",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", {
            containerId: "ISSUE-TRAY",
            lotId: "ISSUE-A",
          }),
          amount: stockAmount("2", "piece"),
          container: { containerType: "tray" },
        },
        {
          to: loosePosition("store", {
            containerId: "ISSUE-TRAY",
            lotId: "ISSUE-B",
          }),
          amount: stockAmount("1", "piece"),
          container: { containerType: "tray" },
        },
      ],
    });
    const issued = await issuedInventory.containers.issue({
      operationId: "issue-whole-tray",
      occurredAtEpochMs: time1,
      containerId: "ISSUE-TRAY",
      destinationPartyId: "patient",
    });
    expect(issued.event.kind).toBe(InventoryEventKind.Issue);
    expect(await issuedInventory.read.positions({ itemId: "item-a" })).toEqual(
      []
    );

    const scrappedInventory = createTestInventory();
    await scrappedInventory.stock.receive({
      operationId: "receive-container-to-scrap",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { containerId: "SCRAP-TRAY" }),
      amount: stockAmount("2", "piece"),
      container: { containerType: "tray" },
    });
    await scrappedInventory.reservations.reserve({
      reservationId: "broad-scrap-claim",
      operationId: "reserve-before-whole-scrap",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const scrapped = await scrappedInventory.containers.scrap({
      operationId: "scrap-whole-tray",
      occurredAtEpochMs: time2,
      containerId: "SCRAP-TRAY",
      reason: "The whole tray was physically destroyed.",
    });
    expect(scrapped.event.kind).toBe(InventoryEventKind.Scrap);
    expect((await scrappedInventory.read.reservationFeasibility()).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
  });

  it("unpacks an exact package into an opened container atomically and uses its shorter use-by", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-container-box",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-CONTAINER" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
    });
    const unpacked = await inventory.stock.unpack({
      operationId: "unpack-into-open-vial",
      occurredAtEpochMs: time1,
      from: loosePosition("store", {
        lotId: "LOT-CONTAINER",
        packagingRevisionId: "item-a-box-24-v1",
      }),
      packageCount: 1,
      toContainerId: "OPEN-VIAL-1",
      container: {
        containerType: "opened-vial",
        openedAtEpochMs: time1,
        useByEpochMs: shortUseBy,
        identifiers: { barcode: "VIAL-001" },
      },
    });
    expect(unpacked.event.kind).toBe(InventoryEventKind.Unpack);
    expect(unpacked.event.containerDefinitions).toHaveLength(1);
    expect(await quantityInContainer(inventory, "OPEN-VIAL-1")).toBe(24);
    expect(await inventory.read.container("OPEN-VIAL-1")).toMatchObject({
      definition: {
        containerId: "OPEN-VIAL-1",
        containerType: "opened-vial",
        openedAtEpochMs: time1,
        useByEpochMs: shortUseBy,
      },
      rootEventId: unpacked.event.eventId,
    });

    const preview = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["store"],
        containerIds: ["OPEN-VIAL-1"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      atEpochMs: time2,
    });
    expect(preview.expiredStockWasExcluded).toBe(true);
    expect(preview.lines).toEqual([]);
    expect(preview.shortfall.amountMinor).toBe(1);
  });

  it("preserves an own __proto__ container identifier through event and projection normalization", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-proto-container-box",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "PROTO-LOT" }),
      amount: packageAmount(1, "item-a-box-24-v1"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
    });
    const identifiers = JSON.parse(
      '{"__proto__":"SSCC-PROTO","gtin":"GTIN-PROTO"}'
    ) as Record<string, string>;
    const unpacked = await inventory.stock.unpack({
      operationId: "unpack-proto-container",
      occurredAtEpochMs: time1,
      from: loosePosition("store", {
        lotId: "PROTO-LOT",
        packagingRevisionId: "item-a-box-24-v1",
      }),
      packageCount: 1,
      toContainerId: "PROTO-CONTAINER",
      container: { identifiers },
    });
    const eventIdentifiers = unpacked.event.containerDefinitions?.[0]?.identifiers;
    expect(Object.prototype.hasOwnProperty.call(eventIdentifiers, "__proto__")).toBe(true);
    expect(eventIdentifiers?.["__proto__"]).toBe("SSCC-PROTO");
    const projectedIdentifiers = (await inventory.read.container("PROTO-CONTAINER"))
      ?.definition.identifiers;
    expect(Object.prototype.hasOwnProperty.call(projectedIdentifiers, "__proto__")).toBe(true);
    expect(projectedIdentifiers?.["__proto__"]).toBe("SSCC-PROTO");
    expect(projectedIdentifiers?.gtin).toBe("GTIN-PROTO");
  });

  it("corrects, omits, and restores container use-by append-only without moving contents", async () => {
    const inventory = createTestInventory();
    const placed = await inventory.stock.receive({
      operationId: "receive-open-syringe",
      occurredAtEpochMs: time0,
      to: loosePosition("store", {
        lotId: "SYRINGE-LOT",
        containerId: "SYRINGE-1",
      }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
      container: {
        containerType: "prepared-syringe",
        openedAtEpochMs: time0,
        useByEpochMs: shortUseBy,
      },
    });
    const corrected = await inventory.containers.correct({
      operationId: "correct-syringe-use-by",
      occurredAtEpochMs: time1,
      containerId: "SYRINGE-1",
      container: {
        containerType: "prepared-syringe",
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The preparation protocol supplied the wrong use-by.",
    });
    expect(corrected.event.kind).toBe(InventoryEventKind.Correction);
    expect(corrected.event.correction?.correctsEventId).toBe(
      placed.event.eventId
    );
    expect(
      (await inventory.read.container("SYRINGE-1"))?.definition.useByEpochMs
    ).toBe(longUseBy);
    expect(await quantityInContainer(inventory, "SYRINGE-1")).toBe(5);

    await inventory.containers.correct({
      operationId: "omit-syringe-master",
      occurredAtEpochMs: time2,
      containerId: "SYRINGE-1",
      reason: "This row was not actually a separately tracked container.",
    });
    expect(await inventory.read.container("SYRINGE-1")).toBeUndefined();
    expect(await quantityInContainer(inventory, "SYRINGE-1")).toBe(5);
    await expect(
      inventory.containers.define({
        operationId: "cannot-redefine-removed-container",
        occurredAtEpochMs: time2,
        containerId: "SYRINGE-1",
        container: { useByEpochMs: longUseBy },
      })
    ).rejects.toThrow("removed by correction");

    await inventory.containers.correct({
      operationId: "restore-syringe-master",
      occurredAtEpochMs: time3,
      containerId: "SYRINGE-1",
      container: {
        containerType: "prepared-syringe",
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The physical syringe identity was confirmed.",
    });
    expect(
      (await inventory.read.container("SYRINGE-1"))?.definition.useByEpochMs
    ).toBe(longUseBy);
    expect(await quantityInContainer(inventory, "SYRINGE-1")).toBe(5);
  });

  it("places loose stock into a newly defined container without recreating substock semantics", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-loose-for-container",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "PLACE-LOT" }),
      amount: stockAmount("3", "piece"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
    });
    const placed = await inventory.stock.placeInContainer({
      operationId: "place-into-tray",
      occurredAtEpochMs: time1,
      from: loosePosition("store", { lotId: "PLACE-LOT" }),
      amount: stockAmount("3", "piece"),
      toContainerId: "TRAY-1",
      container: {
        containerType: "procedure-tray",
        identifiers: { barcode: "TRAY-001" },
      },
    });
    expect(placed.event.kind).toBe(InventoryEventKind.Reclassification);
    expect(await quantityInContainer(inventory, "TRAY-1")).toBe(3);
    expect(
      (await inventory.read.container("TRAY-1"))?.definition.containerType
    ).toBe("procedure-tray");
  });

  it("carries container masters through reviewed migration opening facts", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "legacy-container-opening",
        sourceSystem: "legacy-substock",
        cutoverAtEpochMs: time0,
        openingStock: [
          {
            openingId: "legacy-opened-vial",
            position: loosePosition("store", {
              lotId: "LEGACY-LOT",
              containerId: "LEGACY-VIAL",
            }),
            amount: stockAmount("4", "piece"),
            itemRevisionId: "item-a-v2",
            lot: { expiresAtEpochMs: lotExpiryEpochMs },
            container: {
              containerType: "opened-vial",
              openedAtEpochMs: time0,
              useByEpochMs: longUseBy,
            },
            source: {
              sourceType: "InventoryStockSubstock",
              sourceId: "legacy-child-1",
            },
          },
        ],
      },
    });
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: await storage.readWorld(),
    });
    await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    const inventory = createTestInventory(storage, catalog);
    expect(
      (await inventory.read.container("LEGACY-VIAL"))?.definition
    ).toMatchObject({
      containerType: "opened-vial",
      openedAtEpochMs: time0,
      useByEpochMs: longUseBy,
    });
    expect(await quantityInContainer(inventory, "LEGACY-VIAL")).toBe(4);
  });

  it("lists standalone container masters in deterministic identity order", async () => {
    const inventory = createTestInventory();
    await inventory.containers.define({
      operationId: "define-container-z",
      occurredAtEpochMs: time0,
      containerId: "Z-CONTAINER",
      container: { containerType: "carton" },
    });
    await inventory.containers.define({
      operationId: "define-container-a",
      occurredAtEpochMs: time0,
      containerId: "A-CONTAINER",
      container: { containerType: "vial" },
    });
    expect(
      (await inventory.read.containers()).map(
        /** Return public container ids to prove deterministic read ordering. */
        (projected) => projected.definition.containerId
      )
    ).toEqual(["A-CONTAINER", "Z-CONTAINER"]);
  });
});
