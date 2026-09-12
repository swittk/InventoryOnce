import { describe, expect, it } from "vitest";
import {
  createInventoryTransferDispatchEvent,
  createInventoryTransferPrepareEvent,
  createInventoryTransferReceiveEvent,
  createInventoryTransferReleaseEvent,
  defineInventoryEvent,
} from "../src/kernel.js";
import {
  createInventoryOnce,
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryTransferStatus,
  InventoryEventKind,
  inventoryStockSelector,
  negateInventoryMeasurements,
  packageAmount,
  parseQuantity,
  scalarInventoryMeasurements,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  abstractInventoryState,
  abstractOperationResult,
  abstractReservationState,
} from "./formal-implementation-abstraction.js";
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

/** Executable refinement witness for the first-class physical transfer lifecycle. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-TRANSFER-LIFECYCLE",
] as const;

describe("first-class physical transfer lifecycle", () => {
  it("never manufactures prepared stock through Record-mode deficits", async () => {
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage: createInMemoryInventoryDurableStorage(),
      deficitPolicy: InventoryDeficitPolicy.Record,
      clock: clockAt(time3),
    });

    await expect(
      inventory.transfers.prepare({
        operationId: "record-mode-empty-prepare",
        occurredAtEpochMs: time1,
        transferId: "RECORD-T",
        transitLocationId: "TRANSIT",
        destinationLocationId: "B",
        lines: [
          {
            lineId: "missing",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow(
      "Transfer lifecycle cannot subtract stock that is not currently physical."
    );

    const world = await inventory.read.world();
    expect(world.projection.transfers?.["RECORD-T"]).toBeUndefined();
    expect(
      Object.values(world.projection.positions).filter(
        /** No transfer-bound positive bucket or recorded source deficit may be invented. */
        (position) =>
          position.key.transferId === "RECORD-T" ||
          position.measurements.primary.quantity.amountMinor < 0
      )
    ).toEqual([]);
  });

  // Malformed prepare identity or cross-transfer effects must be rejected before lifecycle truth appears.
  it("rejects duplicate transfer line ids and cross-transfer stock effects", async () => {
    const inventory = createTestInventory();
    const beforeDuplicatePrepare = await inventory.read.world();
    await expect(
      inventory.transfers.prepare({
        operationId: "duplicate-line-prepare",
        occurredAtEpochMs: time1,
        transferId: "DUP-LINE",
        transitLocationId: "TRANSIT",
        destinationLocationId: "B",
        lines: [
          {
            lineId: "same",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
          {
            lineId: "same",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow(/duplicate transfer prepare lineid/i);
    expect(await inventory.read.world()).toEqual(beforeDuplicatePrepare);

    const catalog = createTabletCatalog();
    expect(() =>
      createInventoryTransferPrepareEvent({
        catalog,
        operationId: "duplicate-source-prepare",
        occurredAtEpochMs: time1,
        transferId: "DUP-SOURCE",
        transitLocationId: "TRANSIT",
        destinationLocationId: "B",
        lines: [
          {
            lineId: "first",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
          {
            lineId: "second",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).toThrow(/distinct source positions/i);

    const transferBoundFrom = {
      ...loosePosition("A"),
      transferId: "FOREIGN-TRANSFER",
    };
    expect(() =>
      createInventoryTransferPrepareEvent({
        catalog,
        operationId: "reject-transfer-bound-source",
        occurredAtEpochMs: time1,
        transferId: "NEW-TRANSFER",
        transitLocationId: "TRANSIT",
        destinationLocationId: "B",
        lines: [
          {
            lineId: "bound-source",
            from: transferBoundFrom,
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).toThrow(/transfer-bound stock/i);

    const draft = createInventoryTransferPrepareEvent({
      catalog,
      operationId: "cross-transfer-effect-op",
      occurredAtEpochMs: time1,
      transferId: "T1",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "one",
          from: loosePosition("A"),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    const stockEffects = draft.stockEffects.map((effect) =>
      effect.position.transferId === "T1"
        ? { ...effect, position: { ...effect.position, transferId: "T2" } }
        : effect
    );
    expect(() =>
      defineInventoryEvent({
        catalog,
        event: { ...draft, stockEffects, positiveLayerProvenanceTransfers: [] },
      })
    ).toThrow(/different transfer than its lifecycle change/i);
  });

  // Duplicate receipt identity must fail atomically and leave dispatched transfer truth unchanged.
  it("rejects duplicate receipt line ids without changing transfer truth", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-duplicate-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("5", "piece"),
    });
    await inventory.transfers.prepare({
      operationId: "prepare-duplicate-receipt",
      occurredAtEpochMs: time1,
      transferId: "DUP-RECEIVE",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "line",
          from: loosePosition("A"),
          amount: stockAmount("4", "piece"),
        },
      ],
    });
    await inventory.transfers.dispatch({
      operationId: "dispatch-duplicate-receipt",
      occurredAtEpochMs: time2,
      transferId: "DUP-RECEIVE",
    });
    const before = await inventory.transfers.find({
      transferId: "DUP-RECEIVE",
    });
    const worldBefore = await inventory.read.world();
    await expect(
      inventory.transfers.receive({
        operationId: "receive-duplicate-lines",
        occurredAtEpochMs: time3,
        transferId: "DUP-RECEIVE",
        lines: [
          { lineId: "line", amount: stockAmount("1", "piece") },
          { lineId: "line", amount: stockAmount("1", "piece") },
        ],
      })
    ).rejects.toThrow("Duplicate transfer receive line 'line'.");
    expect(
      await inventory.transfers.find({ transferId: "DUP-RECEIVE" })
    ).toEqual(before);
    expect(await inventory.read.world()).toEqual(worldBefore);
  });

  it("rejects raw lifecycle-less events that touch transfer-bound stock", () => {
    const catalog = createTabletCatalog();
    expect(() =>
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "raw-transfer-bypass-event",
          operationId: "raw-transfer-bypass-operation",
          kind: InventoryEventKind.Issue,
          occurredAtEpochMs: time1,
          stockEffects: [
            {
              itemRevisionId: "item-a-v2",
              position: {
                itemId: "item-a",
                itemRevisionId: "item-a-v2",
                locationId: "TRANSIT",
                transferId: "RAW-T",
              },
              measurementsDelta: negateInventoryMeasurements(
                scalarInventoryMeasurements(
                  "pieces",
                  parseQuantity("1", "piece")
                )
              ),
            },
          ],
          traceabilityChanges: [],
        },
      })
    ).toThrow(/structured transfer lifecycle event/i);
  });

  it("isolates identical concurrent shipments through partial receipt", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-transfer-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("A", { ownerId: "clinic", custodianId: "clinic" }),
      amount: stockAmount("100", "piece"),
    });

    await inventory.transfers.prepare({
      operationId: "prepare-t1",
      occurredAtEpochMs: time1,
      transferId: "T1",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      destinationCustodianId: "clinic-b",
      lines: [
        {
          lineId: "tablets",
          from: loosePosition("A", {
            ownerId: "clinic",
            custodianId: "clinic",
          }),
          amount: stockAmount("20", "piece"),
        },
      ],
    });
    await inventory.transfers.prepare({
      operationId: "prepare-t2",
      occurredAtEpochMs: time1,
      transferId: "T2",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      destinationCustodianId: "clinic-b",
      lines: [
        {
          lineId: "tablets",
          from: loosePosition("A", {
            ownerId: "clinic",
            custodianId: "clinic",
          }),
          amount: stockAmount("30", "piece"),
        },
      ],
    });

    const sourceAvailability = await inventory.read.availability(
      inventoryStockSelector("item-a", { locationIds: ["A"] }),
      time1
    );
    expect(
      sourceAvailability.revisions[0]?.physicalOnHand.primary.quantity
        .amountMinor
    ).toBe(100);
    expect(
      sourceAvailability.revisions[0]?.unallocatedUsablePhysical.amountMinor
    ).toBe(50);
    await expect(
      inventory.stock.issueByPolicy({
        operationId: "cannot-use-prepared",
        occurredAtEpochMs: time1,
        selector: inventoryStockSelector("item-a", { locationIds: ["A"] }),
        amount: stockAmount("51", "piece"),
        method: InventoryAllocationMethod.Fifo,
      })
    ).rejects.toThrow(
      "Inventory policy has insufficient eligible stock (1 piece shortfall)."
    );

    await inventory.transfers.dispatch({
      operationId: "dispatch-t1",
      occurredAtEpochMs: time2,
      transferId: "T1",
      carrierCustodianId: "carrier",
    });
    await inventory.transfers.dispatch({
      operationId: "dispatch-t2",
      occurredAtEpochMs: time2,
      transferId: "T2",
      carrierCustodianId: "carrier",
    });

    const transitPositions = await inventory.read.positions(
      inventoryStockSelector("item-a", { locationIds: ["TRANSIT"] })
    );
    expect(transitPositions).toHaveLength(2);
    expect(
      transitPositions.map((position) => position.key.transferId).sort()
    ).toEqual(["T1", "T2"]);
    expect(
      transitPositions.every((position) => position.key.ownerId === "clinic")
    ).toBe(true);
    expect(
      transitPositions.every(
        (position) => position.key.custodianId === "carrier"
      )
    ).toBe(true);
    const transitWorld = await inventory.read.world();
    const t1TransitIdentity = Object.entries(
      transitWorld.projection.positions
    ).find(
      /** Find only T1's exact conserved transit bucket. */
      ([, position]) => position.key.transferId === "T1"
    )?.[0];
    expect(t1TransitIdentity).toBeDefined();
    if (t1TransitIdentity === undefined) throw new Error("Missing T1 transit identity.");
    expect(
      transitWorld.projection.positiveLayerStartedAtEpochMsByPositionId[t1TransitIdentity]
    ).toBe(time0);
    const smuggledTransitPosition = transitPositions[0];
    if (smuggledTransitPosition === undefined)
      throw new Error("Missing transit position.");
    await expect(
      inventory.stock.issue({
        operationId: "cannot-smuggle-transfer-position",
        occurredAtEpochMs: time2,
        // Deliberately pass a transfer-bound key to verify issue refuses what its honest type excludes.
        from: smuggledTransitPosition.key as never,
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow(/first-class transfer lifecycle API/i);

    const partial = await inventory.transfers.receive({
      operationId: "receive-t1-five",
      occurredAtEpochMs: time3,
      transferId: "T1",
      lines: [{ lineId: "tablets", amount: stockAmount("5", "piece") }],
    });
    expect(partial.transfer.status).toBe(
      InventoryTransferStatus.PartiallyReceived
    );
    expect(
      partial.transfer.lines[0]?.receivedMeasurements.primary.quantity
        .amountMinor
    ).toBe(5);
    expect(
      (await inventory.transfers.find({ transferId: "T2" }))?.lines[0]
        ?.receivedMeasurements.primary.quantity.amountMinor
    ).toBe(0);

    const publishedAfterPartial = await inventory.read.world();
    const abstractWorld = abstractInventoryState(publishedAfterPartial);
    expect(
      abstractWorld.transfers.find((transfer) => transfer.transferId === "T1")
        ?.status
    ).toBe(InventoryTransferStatus.PartiallyReceived);
    expect(
      abstractWorld.buckets.filter((bucket) => bucket.key.transferId === "T1")
    ).toHaveLength(1);
    expect(
      abstractReservationState(publishedAfterPartial.reservations).reservations
    ).toEqual([]);
    expect(abstractOperationResult(partial).transfer?.status).toBe(
      InventoryTransferStatus.PartiallyReceived
    );

    const transitAfterPartial = await inventory.read.positions(
      inventoryStockSelector("item-a", { locationIds: ["TRANSIT"] })
    );
    const t1 = transitAfterPartial.find(
      (position) => position.key.transferId === "T1"
    );
    const t2 = transitAfterPartial.find(
      (position) => position.key.transferId === "T2"
    );
    expect(t1?.measurements.primary.quantity.amountMinor).toBe(15);
    expect(t2?.measurements.primary.quantity.amountMinor).toBe(30);

    const destination = await inventory.read.positions(
      inventoryStockSelector("item-a", { locationIds: ["B"] })
    );
    expect(destination).toHaveLength(1);
    expect(destination[0]?.key.transferId).toBeUndefined();
    expect(destination[0]?.key.ownerId).toBe("clinic");
    expect(destination[0]?.key.custodianId).toBe("clinic-b");
    expect(destination[0]?.measurements.primary.quantity.amountMinor).toBe(5);
    const receivedWorld = await inventory.read.world();
    const destinationIdentity = Object.entries(
      receivedWorld.projection.positions
    ).find(
      /** Find the ordinary destination bucket produced by partial receipt. */
      ([, position]) => position.key.locationId === "B"
    )?.[0];
    expect(destinationIdentity).toBeDefined();
    if (destinationIdentity === undefined) throw new Error("Missing destination identity.");
    expect(
      receivedWorld.projection.positiveLayerStartedAtEpochMsByPositionId[
        destinationIdentity
      ]
    ).toBe(time0);
  });

  it("stutters exact retries, rejects changed intent, and completes receipt", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-retry",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("20", "piece"),
    });
    const prepared = await inventory.transfers.prepare({
      operationId: "prepare-retry",
      occurredAtEpochMs: time1,
      transferId: "TR",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "line",
          from: loosePosition("A"),
          amount: stockAmount("20", "piece"),
        },
      ],
    });
    const directDispatchDraft = createInventoryTransferDispatchEvent({
      catalog: createTabletCatalog(),
      operationId: "direct-dispatch-builder",
      occurredAtEpochMs: time2,
      transfer: prepared.transfer,
    });
    expect(directDispatchDraft.stockEffects.length).toBeGreaterThan(0);
    const dispatched = await inventory.transfers.dispatch({
      operationId: "dispatch-retry",
      occurredAtEpochMs: time2,
      transferId: "TR",
    });
    const directReceiveDraft = createInventoryTransferReceiveEvent({
      catalog: createTabletCatalog(),
      operationId: "direct-receive-builder",
      occurredAtEpochMs: time3,
      transfer: dispatched.transfer,
      lines: [{ lineId: "line", amount: stockAmount("1", "piece") }],
    });
    expect(directReceiveDraft.stockEffects.length).toBeGreaterThan(0);

    const first = await inventory.transfers.receive({
      operationId: "receive-seven",
      occurredAtEpochMs: time2,
      transferId: "TR",
      lines: [{ lineId: "line", amount: stockAmount("7", "piece") }],
    });
    const replayed = await inventory.transfers.receive({
      operationId: "receive-seven",
      occurredAtEpochMs: time2,
      transferId: "TR",
      lines: [{ lineId: "line", amount: stockAmount("7", "piece") }],
    });
    expect(first.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(replayed.event.eventId).toBe(first.event.eventId);
    expect(
      replayed.transfer.lines[0]?.receivedMeasurements.primary.quantity
        .amountMinor
    ).toBe(7);

    await expect(
      inventory.transfers.receive({
        operationId: "receive-seven",
        occurredAtEpochMs: time2,
        transferId: "TR",
        lines: [{ lineId: "line", amount: stockAmount("8", "piece") }],
      })
    ).rejects.toThrow(/changed intent/i);

    const completed = await inventory.transfers.receive({
      operationId: "receive-rest",
      occurredAtEpochMs: time3,
      transferId: "TR",
    });
    expect(completed.transfer.status).toBe(InventoryTransferStatus.Received);
    expect(
      await inventory.read.positions(
        inventoryStockSelector("item-a", { locationIds: ["TRANSIT"] })
      )
    ).toHaveLength(0);
    const destination = await inventory.read.positions(
      inventoryStockSelector("item-a", { locationIds: ["B"] })
    );
    expect(destination[0]?.measurements.primary.quantity.amountMinor).toBe(20);
  });

  it("fails closed when generic correction targets transfer lifecycle truth", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-transfer-correction",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("8", "piece"),
    });
    const prepared = await inventory.transfers.prepare({
      operationId: "prepare-transfer-correction",
      occurredAtEpochMs: time1,
      transferId: "CORRECT-T",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "line",
          from: loosePosition("A"),
          amount: stockAmount("3", "piece"),
        },
      ],
    });

    await expect(
      inventory.stock.correct({
        operationId: "generic-correct-transfer",
        occurredAtEpochMs: time2,
        correctsEventId: prepared.event.eventId,
        reason: "Attempt generic correction of transfer lifecycle truth.",
        replaceWith: (plans) => plans.omit(),
      })
    ).rejects.toThrow(/transfer lifecycle events cannot be corrected/i);
    expect(
      (await inventory.transfers.find({ transferId: "CORRECT-T" }))?.status
    ).toBe(InventoryTransferStatus.Prepared);
  });

  it("releases prepared stock without physical movement and forbids later dispatch", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-release",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("10", "piece"),
    });
    const prepared = await inventory.transfers.prepare({
      operationId: "prepare-release",
      occurredAtEpochMs: time1,
      transferId: "REL",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "line",
          from: loosePosition("A"),
          amount: stockAmount("6", "piece"),
        },
      ],
    });
    const directReleaseDraft = createInventoryTransferReleaseEvent({
      catalog: createTabletCatalog(),
      operationId: "direct-release-builder",
      occurredAtEpochMs: time2,
      transfer: prepared.transfer,
    });
    expect(directReleaseDraft.stockEffects.length).toBeGreaterThan(0);
    let availability = await inventory.read.availability(
      inventoryStockSelector("item-a", { locationIds: ["A"] }),
      time1
    );
    expect(
      availability.revisions[0]?.unallocatedUsablePhysical.amountMinor
    ).toBe(4);

    const released = await inventory.transfers.release({
      operationId: "release",
      occurredAtEpochMs: time2,
      transferId: "REL",
    });
    expect(released.transfer.status).toBe(InventoryTransferStatus.Released);
    availability = await inventory.read.availability(
      inventoryStockSelector("item-a", { locationIds: ["A"] }),
      time2
    );
    expect(
      availability.revisions[0]?.physicalOnHand.primary.quantity.amountMinor
    ).toBe(10);
    expect(
      availability.revisions[0]?.unallocatedUsablePhysical.amountMinor
    ).toBe(10);
    await expect(
      inventory.transfers.dispatch({
        operationId: "dispatch-released",
        occurredAtEpochMs: time3,
        transferId: "REL",
      })
    ).rejects.toThrow(/^Only a prepared transfer can be dispatched\.$/u);
  });

  it("preserves exact lot/package/container/form identity across transit", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "seed-exact-package",
      occurredAtEpochMs: time0,
      to: loosePosition("A", { lotId: "LOT-PACK" }),
      amount: packageAmount(2, "item-a-box-24-v1"),
      lot: { expiresAtEpochMs: 1830297600000 },
    });
    await inventory.transfers.prepare({
      operationId: "prepare-exact-package",
      occurredAtEpochMs: time1,
      transferId: "PACK-T",
      transitLocationId: "TRANSIT",
      destinationLocationId: "B",
      lines: [
        {
          lineId: "sealed",
          from: loosePosition("A", {
            lotId: "LOT-PACK",
            packagingRevisionId: "item-a-box-24-v1",
          }),
          amount: packageAmount(1, "item-a-box-24-v1"),
        },
      ],
    });
    await inventory.transfers.dispatch({
      operationId: "dispatch-exact-package",
      occurredAtEpochMs: time2,
      transferId: "PACK-T",
    });
    await inventory.transfers.receive({
      operationId: "receive-exact-package",
      occurredAtEpochMs: time3,
      transferId: "PACK-T",
    });
    const receivedPackage = (
      await inventory.read.positions(
        inventoryStockSelector("item-a", {
          locationIds: ["B"],
          lotIds: ["LOT-PACK"],
        })
      )
    )[0];
    expect(receivedPackage?.key.itemRevisionId).toBe("item-a-v2");
    expect(receivedPackage?.key.packagingRevisionId).toBe("item-a-box-24-v1");
    expect(receivedPackage?.key.lotId).toBe("LOT-PACK");
    expect(receivedPackage?.key.transferId).toBeUndefined();

    await inventory.stock.receive({
      operationId: "seed-exact-container",
      occurredAtEpochMs: time0,
      to: loosePosition("A", {
        lotId: "LOT-TRAY",
        containerId: "TRAY-X",
        qualifiedDimensions: [{ dimensionId: "grade", valueId: "A" }],
      }),
      amount: stockAmount("6", "piece"),
      lot: { expiresAtEpochMs: 1832976000000 },
      container: { containerType: "tray", identifiers: { barcode: "TRAY-X" } },
    });
    await inventory.transfers.prepare({
      operationId: "prepare-exact-container",
      occurredAtEpochMs: time1,
      transferId: "TRAY-T",
      transitLocationId: "TRANSIT",
      destinationLocationId: "C",
      lines: [
        {
          lineId: "tray",
          from: loosePosition("A", {
            lotId: "LOT-TRAY",
            containerId: "TRAY-X",
            qualifiedDimensions: [{ dimensionId: "grade", valueId: "A" }],
          }),
          amount: stockAmount("6", "piece"),
        },
      ],
    });
    await inventory.transfers.dispatch({
      operationId: "dispatch-exact-container",
      occurredAtEpochMs: time2,
      transferId: "TRAY-T",
      carrierCustodianId: "carrier",
    });
    const transitTray = (
      await inventory.read.positions(
        inventoryStockSelector("item-a", {
          locationIds: ["TRANSIT"],
          containerIds: ["TRAY-X"],
        })
      )
    )[0];
    expect(transitTray?.key.transferId).toBe("TRAY-T");
    expect(transitTray?.key.containerId).toBe("TRAY-X");
    expect(transitTray?.key.lotId).toBe("LOT-TRAY");
    expect(transitTray?.key.itemRevisionId).toBe("item-a-v2");
    expect(transitTray?.key.qualifiedDimensions).toEqual([
      { dimensionId: "grade", valueId: "A" },
    ]);

    await inventory.transfers.receive({
      operationId: "receive-exact-container",
      occurredAtEpochMs: time3,
      transferId: "TRAY-T",
    });
    const receivedTray = (
      await inventory.read.positions(
        inventoryStockSelector("item-a", {
          locationIds: ["C"],
          containerIds: ["TRAY-X"],
        })
      )
    )[0];
    expect(receivedTray?.key.transferId).toBeUndefined();
    expect(receivedTray?.key.containerId).toBe("TRAY-X");
    expect(receivedTray?.key.lotId).toBe("LOT-TRAY");
    expect(receivedTray?.key.itemRevisionId).toBe("item-a-v2");
    expect(receivedTray?.key.qualifiedDimensions).toEqual([
      { dimensionId: "grade", valueId: "A" },
    ]);
  });
});


describe("custody collapse is atomically rejected at the publishing boundary", () => {
  it.each(["destination", "carrier"])("does not publish %s overrides that merge distinct receiving lines", async override => {
    const inventory = createTestInventory();
    const fromA = { ...loosePosition("A"), custodianId: "custodian-a" };
    const fromB = { ...loosePosition("A"), custodianId: "custodian-b" };
    await inventory.stock.receive({ operationId: "seed-a", occurredAtEpochMs: time0, to: fromA, amount: stockAmount("1", "piece") });
    await inventory.stock.receive({ operationId: "seed-b", occurredAtEpochMs: time0, to: fromB, amount: stockAmount("1", "piece") });
    const preparation = { operationId: "prepare-collapsed", occurredAtEpochMs: time1, transferId: "collapse-transfer", transitLocationId: "T", destinationLocationId: "B",
      lines: [{ lineId: "a", from: fromA, amount: stockAmount("1", "piece") }, { lineId: "b", from: fromB, amount: stockAmount("1", "piece") }] };
    if (override === "destination") {
      const before = await inventory.read.world();
      await expect(inventory.transfers.prepare({ ...preparation, destinationCustodianId: "destination" })).rejects.toThrow("destination positions would collapse distinct transfer lines");
      expect(await inventory.read.world()).toEqual(before);
    } else {
      await inventory.transfers.prepare(preparation);
      const before = await inventory.read.world();
      await expect(inventory.transfers.dispatch({ operationId: "dispatch-collapsed", occurredAtEpochMs: time1, transferId: "collapse-transfer", carrierCustodianId: "carrier" })).rejects.toThrow("Inventory event repeats stock position");
      expect(await inventory.read.world()).toEqual(before);
    }
  });
});
