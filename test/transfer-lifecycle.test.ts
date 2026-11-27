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
  defineInventoryCatalog,
  defineScalarInventoryItem,
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
  it.each(["separate", "mixed", "disjoint", "connected", "missing-source"] as const)("replays only lifecycle stock the count depends on (%s)", async (scenario) => {
    const counted = defineScalarInventoryItem({ itemId: "counted", revisionId: "counted-v1", axisId: "pieces", unit: "piece" });
    const other = defineScalarInventoryItem({ itemId: "other", revisionId: "other-v1", axisId: "pieces", unit: "piece" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [counted, other], activeItemRevisionIds: { counted: counted.revisionId, other: other.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog);
    const amount = stockAmount("1", "piece");
    const countedSource = { itemId: counted.itemId, placementNodeId: "source" };
    const sameItem = scenario === "disjoint" || scenario === "connected" || scenario === "missing-source";
    const lateSource = scenario === "disjoint" || scenario === "missing-source";
    const otherSource = { itemId: sameItem ? counted.itemId : other.itemId, placementNodeId: "source" };
    if (scenario !== "connected" && scenario !== "missing-source") {
      await inventory.stock.receive({
        operationId: "receive-counted", occurredAtEpochMs: time0,
        to: scenario === "mixed" ? countedSource : { itemId: counted.itemId, placementNodeId: "destination" }, amount,
      });
    }
    await inventory.stock.receive({
      operationId: "receive-other", occurredAtEpochMs: lateSource ? time3 : time0, to: otherSource, amount,
    });
    const otherLine = { lineId: "other", from: otherSource, amount };
    await inventory.transfers.prepare({
      operationId: "prepare", occurredAtEpochMs: time1, transferId: "transfer",
      transitPlacementNodeId: "transit",
      destinationPlacementNodeId: scenario === "disjoint" || scenario === "connected" ? "elsewhere" : "destination",
      lines: scenario === "mixed" ? [{ lineId: "counted", from: countedSource, amount }, otherLine] : [otherLine],
    });
    await inventory.transfers.dispatch({ operationId: "dispatch", occurredAtEpochMs: time1, transferId: "transfer" });
    await inventory.transfers.receive({ operationId: "receive", occurredAtEpochMs: time2, transferId: "transfer" });
    if (scenario === "connected") {
      await inventory.stock.transfer({
        operationId: "conserved-move", occurredAtEpochMs: time2,
        from: { itemId: counted.itemId, placementNodeId: "elsewhere" }, toPlacementNodeId: "destination", amount,
      });
    }
    const command = {
      countId: "count", operationId: "count", itemRevisionId: counted.revisionId,
      selector: { itemId: counted.itemId, placementNodeIds: ["destination"] },
      observedMeasurements: scalarInventoryMeasurements("pieces", parseQuantity("1", "piece")), occurredAtEpochMs: time2,
    };
    if (scenario === "missing-source") {
      await expect(inventory.counts.replaceAbsolute(command)).rejects.toThrow("not currently physical");
    } else {
      expect((await inventory.counts.replaceAbsolute(command)).event).toBeUndefined();
      expect((await inventory.counts.replaceAbsolute(command)).replayed).toBe(true);
    }
    expect((await inventory.read.world()).projection.transfers.transfer?.status).toBe(InventoryTransferStatus.Received);
  });

  it("publishes release and transit completion while retaining an unrelated shortage", async () => {
    const inventory = createTestInventory();
    const selector = inventoryStockSelector("item-a", { placementNodeIds: ["A"] });
    for (const node of ["A", "B", "C"]) {
      await inventory.stock.receive({
        operationId: `seed-${node}`, occurredAtEpochMs: time0, to: loosePosition(node), amount: stockAmount("1", "piece"),
      });
    }
    await inventory.reservations.reserve({
      operationId: "reserve-transfer-unrelated-a", reservationId: "hold-A", itemRevisionId: "item-a-v2",
      selector, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    });
    for (const node of ["B", "C"]) {
      await inventory.transfers.prepare({
        operationId: `prepare-${node}`, occurredAtEpochMs: time1, transferId: node,
        transitPlacementNodeId: "transit", destinationPlacementNodeId: "destination",
        lines: [{ lineId: "one", from: loosePosition(node), amount: stockAmount("1", "piece") }],
      });
    }
    await inventory.stock.issue({
      operationId: "issue-claimed-a", occurredAtEpochMs: time2, from: loosePosition("A"), amount: stockAmount("1", "piece"),
    });
    const before = await inventory.read.reservationFeasibility();
    expect(before.groups[0]?.shortage).toEqual(parseQuantity("1", "piece"));
    const released = await inventory.transfers.release({
      operationId: "release-B", occurredAtEpochMs: time2, transferId: "B",
    });
    expect(released.transfer.status).toBe(InventoryTransferStatus.Released);
    await inventory.transfers.dispatch({ operationId: "dispatch-C", occurredAtEpochMs: time2, transferId: "C" });
    await inventory.transfers.receive({ operationId: "receive-C", occurredAtEpochMs: time3, transferId: "C" });
    for (const node of ["B", "destination"]) {
      const rows = await inventory.read.positions(inventoryStockSelector("item-a", { placementNodeIds: [node] }));
      expect(rows.map(({ measurements }) => measurements.primary.quantity)).toEqual([parseQuantity("1", "piece")]);
    }
    expect(await inventory.read.reservationFeasibility()).toEqual(before);
  });

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
        transitPlacementNodeId: "TRANSIT",
        destinationPlacementNodeId: "B",
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
        transitPlacementNodeId: "TRANSIT",
        destinationPlacementNodeId: "B",
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
        transitPlacementNodeId: "TRANSIT",
        destinationPlacementNodeId: "B",
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
        transitPlacementNodeId: "TRANSIT",
        destinationPlacementNodeId: "B",
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
                placementNodeId: "TRANSIT",
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
      inventoryStockSelector("item-a", { placementNodeIds: ["A"] }),
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
        selector: inventoryStockSelector("item-a", { placementNodeIds: ["A"] }),
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
      inventoryStockSelector("item-a", { placementNodeIds: ["TRANSIT"] })
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
      inventoryStockSelector("item-a", { placementNodeIds: ["TRANSIT"] })
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
      inventoryStockSelector("item-a", { placementNodeIds: ["B"] })
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
      ([, position]) => position.key.placementNodeId === "B"
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
        inventoryStockSelector("item-a", { placementNodeIds: ["TRANSIT"] })
      )
    ).toHaveLength(0);
    const destination = await inventory.read.positions(
      inventoryStockSelector("item-a", { placementNodeIds: ["B"] })
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
      inventoryStockSelector("item-a", { placementNodeIds: ["A"] }),
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
      inventoryStockSelector("item-a", { placementNodeIds: ["A"] }),
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
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "B",
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
          placementNodeIds: ["B"],
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
        qualifiedDimensions: [{ dimensionId: "grade", valueId: "A" }],
      }),
      amount: stockAmount("6", "piece"),
      lot: { expiresAtEpochMs: 1832976000000 },
    });
    await inventory.transfers.prepare({
      operationId: "prepare-exact-container",
      occurredAtEpochMs: time1,
      transferId: "TRAY-T",
      transitPlacementNodeId: "TRANSIT",
      destinationPlacementNodeId: "C",
      lines: [
        {
          lineId: "tray",
          from: loosePosition("A", {
            lotId: "LOT-TRAY",
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
          placementNodeIds: ["TRANSIT"],
        })
      )
    )[0];
    expect(transitTray?.key.transferId).toBe("TRAY-T");
    expect(transitTray?.key.placementNodeId).toBe("TRANSIT");
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
          placementNodeIds: ["C"],
        })
      )
    )[0];
    expect(receivedTray?.key.transferId).toBeUndefined();
    expect(receivedTray?.key.placementNodeId).toBe("C");
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
    const preparation = { operationId: "prepare-collapsed", occurredAtEpochMs: time1, transferId: "collapse-transfer", transitPlacementNodeId: "T", destinationPlacementNodeId: "B",
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
