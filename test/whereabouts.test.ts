import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  InventoryAllocationMethod,
  InventoryCountStatus,
  InventoryEventKind,
  InventoryOptionalIdentityConstraintKind,
  InventoryStockWhereaboutsState,
  InventoryWhereaboutsAction,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import { createInventoryOpeningEvent } from "../src/kernel.js";
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

/** Flatten current unresolved lifecycle rows for stock-operation tests. */
async function currentUnresolvedPositions(
  inventory: ReturnType<typeof createTestInventory>,
  input: Parameters<typeof inventory.read.whereabouts>[0] = {}
) {
  const lifecycles = await inventory.read.whereabouts(input);
  return lifecycles.flatMap((lifecycle) => lifecycle.currentPositions);
}

/** Read one current unresolved position by its stable lifecycle identity. */
async function unresolvedById(
  inventory: ReturnType<typeof createTestInventory>,
  whereaboutsId: string
) {
  const rows = await currentUnresolvedPositions(inventory, {
    whereaboutsIds: [whereaboutsId],
  });
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`Expected exactly one unresolved row for '${whereaboutsId}'.`);
  }
  return rows[0];
}

/** Sum current primary quantity for one exact direct placement. */
async function quantityAt(
  inventory: ReturnType<typeof createTestInventory>,
  placementNodeId: string
): Promise<number> {
  const rows = await inventory.read.positions({
    itemId: "item-a",
    placementNodeIds: [placementNodeId],
  });
  return rows.reduce(
    (total, row) => total + row.measurements.primary.quantity.amountMinor,
    0
  );
}

describe("detached and missing stock whereabouts", () => {
  it("keeps unresolved lifecycle identity kernel-owned at stock intake", async () => {
    const inventory = createTestInventory();
    await expect(
      inventory.stock.receive({
        operationId: "reject-caller-whereabouts-receipt",
        occurredAtEpochMs: time0,
        to: {
          itemId: "item-a",
          placementNodeId: "store",
          whereaboutsId: "caller-owned-cohort",
        },
        amount: stockAmount("1", "piece"),
      } as never)
    ).rejects.toThrow(
      "cannot supply detached/missing whereabouts lifecycle fields"
    );

    expect(() =>
      createInventoryOpeningEvent({
        catalog: createTabletCatalog(),
        operationId: "reject-caller-whereabouts-opening",
        occurredAtEpochMs: time0,
        to: {
          itemId: "item-a",
          placementNodeId: "store",
          whereaboutsId: "caller-owned-opening-cohort",
        },
        amount: stockAmount("1", "piece"),
      } as never)
    ).toThrow("cannot supply detached/missing whereabouts lifecycle fields");
  });

  it("keeps separate detach cohorts queryable and later resolves them without fake receipts", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "whereabouts-receive-ten",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-A" }),
      amount: stockAmount("10", "piece"),
    });

    await inventory.stock.detach({
      operationId: "detach-first-five",
      occurredAtEpochMs: time1,
      from: loosePosition("store", { lotId: "LOT-A" }),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.detach({
      operationId: "detach-second-two",
      occurredAtEpochMs: time2,
      from: loosePosition("store", { lotId: "LOT-A" }),
      amount: stockAmount("2", "piece"),
    });

    const detached = await currentUnresolvedPositions(inventory, {
      states: [InventoryStockWhereaboutsState.Detached],
    });
    expect(detached).toHaveLength(2);
    expect(new Set(detached.map((row) => row.key.whereaboutsId)).size).toBe(2);
    expect(detached.map((row) => row.key.lastPlacementNodeId)).toEqual([
      "store",
      "store",
    ]);
    expect(detached.map((row) => row.key.detachedAtEpochMs)).toEqual([
      time1,
      time2,
    ]);
    expect(
      detached.map((row) => row.measurements.primary.quantity.amountMinor)
    ).toEqual([5, 2]);

    const older = await currentUnresolvedPositions(inventory, {
      detachedBeforeEpochMs: time1,
    });
    expect(older).toHaveLength(1);
    expect(older[0]?.measurements.primary.quantity.amountMinor).toBe(5);

    const firstWhereaboutsId = detached[0]?.key.whereaboutsId;
    const secondWhereaboutsId = detached[1]?.key.whereaboutsId;
    if (firstWhereaboutsId === undefined || secondWhereaboutsId === undefined) {
      throw new Error("Detach lifecycle identity was not projected.");
    }

    const first = await unresolvedById(inventory, firstWhereaboutsId);
    await inventory.stock.markMissing({
      operationId: "mark-first-missing",
      occurredAtEpochMs: time2,
      from: first.key,
      amount: stockAmount("5", "piece"),
    });
    const missing = await unresolvedById(inventory, firstWhereaboutsId);
    expect(missing.key.whereaboutsState).toBe(
      InventoryStockWhereaboutsState.Missing
    );
    expect(missing.key.detachedAtEpochMs).toBe(time1);
    expect(missing.key.missingAtEpochMs).toBe(time2);

    await inventory.stock.place({
      operationId: "recover-first-into-room",
      occurredAtEpochMs: time3,
      from: missing.key,
      into: "room",
      amount: stockAmount("5", "piece"),
    });
    expect(await currentUnresolvedPositions(inventory, { whereaboutsIds: [firstWhereaboutsId] }))
      .toEqual([]);
    expect(await quantityAt(inventory, "room")).toBe(5);

    const second = await unresolvedById(inventory, secondWhereaboutsId);
    const issued = await inventory.stock.issue({
      operationId: "issue-second-detached",
      occurredAtEpochMs: time3,
      from: second.key,
      amount: stockAmount("2", "piece"),
    });
    expect(issued.event.kind).toBe(InventoryEventKind.Issue);
    expect(await currentUnresolvedPositions(inventory)).toEqual([]);
    expect(await quantityAt(inventory, "store")).toBe(3);

    const placedHistory = await inventory.read.whereaboutsHistory({
      whereaboutsIds: [firstWhereaboutsId],
      actions: [InventoryWhereaboutsAction.Placed],
      resolved: true,
    });
    expect(placedHistory).toHaveLength(1);
    expect(placedHistory[0]?.originEvent.operationId).toBe("detach-first-five");
    expect(
      placedHistory[0]?.history.flatMap((entry) => entry.actions)
    ).toContain(InventoryWhereaboutsAction.MarkedMissing);
    expect(
      placedHistory[0]?.history.flatMap((entry) => entry.actions)
    ).toContain(InventoryWhereaboutsAction.Placed);

    const issuedHistory = await inventory.read.whereaboutsHistory({
      whereaboutsIds: [secondWhereaboutsId],
      actions: [InventoryWhereaboutsAction.Issued],
      resolved: true,
    });
    expect(issuedHistory).toHaveLength(1);
    expect(issuedHistory[0]?.originEvent.operationId).toBe("detach-second-two");
    expect(issuedHistory[0]?.currentPositions).toEqual([]);
  });

  it("keeps unresolved stock accounted while excluding it from usable allocation", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "availability-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.detach({
      operationId: "availability-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });

    const broad = await inventory.read.availability(
      { itemId: "item-a" },
      time2
    );
    expect(broad.revisions[0]?.physicalOnHand.primary.quantity.amountMinor).toBe(
      2
    );
    expect(
      broad.revisions[0]?.usablePhysicalOnHand.primary.quantity.amountMinor
    ).toBe(0);
    expect(broad.revisions[0]?.usableOnHand.primary.quantity.amountMinor).toBe(0);

    const store = await inventory.read.availability(
      { itemId: "item-a", placementNodeIds: ["store"] },
      time2
    );
    expect(store.revisions[0]?.physicalOnHand.primary.quantity.amountMinor).toBe(
      0
    );

    const unresolved = await inventory.read.availability(
      {
        itemId: "item-a",
        placement: {
          kind: InventoryOptionalIdentityConstraintKind.Absent,
        },
      },
      time2
    );
    expect(
      unresolved.revisions[0]?.physicalOnHand.primary.quantity.amountMinor
    ).toBe(2);

    const plan = await inventory.read.planAllocation({
      selector: { itemId: "item-a" },
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
    });
    expect(plan.shortfall.amountMinor).toBe(1);
    expect(plan.lines).toEqual([]);

    const detached = (await currentUnresolvedPositions(inventory))[0];
    if (detached === undefined) throw new Error("Expected detached stock.");
    await expect(
      inventory.stock.transfer({
        operationId: "bad-transfer-from-detached",
        occurredAtEpochMs: time2,
        from: detached.key,
        toPlacementNodeId: "room",
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("stock.place");
  });

  it("does not let detached stock satisfy broad reservations", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "broad-reservation-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "broad-reservation-two",
      operationId: "broad-reservation-two:create",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });

    await expect(
      inventory.stock.detach({
        operationId: "broad-reservation-blocked-detach",
        occurredAtEpochMs: time2,
        from: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");

    await inventory.reservations.release({
      operationId: "broad-reservation-two:release",
      reservationId: "broad-reservation-two",
      occurredAtEpochMs: time2,
    });
    await inventory.stock.detach({
      operationId: "broad-reservation-detach-all",
      occurredAtEpochMs: time2,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await expect(
      inventory.reservations.reserve({
        reservationId: "broad-reservation-after-detach",
        operationId: "broad-reservation-after-detach:create",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a" },
        requested: parseQuantity("1", "piece"),
        createdAtEpochMs: time3,
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");
  });

  it("rejects exact reservation binding to detached stock with the physical reason", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-detached-allocation",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.detach({
      operationId: "detach-for-allocation",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const detached = (await currentUnresolvedPositions(inventory))[0];
    if (detached === undefined) throw new Error("Expected detached stock.");

    await inventory.reservations.reserve({
      reservationId: "claim-one-placed-piece",
      operationId: "claim-one-placed-piece:create",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time2,
    });

    await expect(
      inventory.reservations.allocate({
        operationId: "allocate-detached-piece",
        reservationId: "claim-one-placed-piece",
        occurredAtEpochMs: time3,
        allocations: [
          {
            position: detached.key,
            quantity: parseQuantity("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow(
      "Reservation allocation cannot bind detached or missing stock; place it explicitly first."
    );
  });

  it("supports partial scrap and later missing escalation without destroying the remaining quantity", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "scrap-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("4", "piece"),
    });
    await inventory.stock.detach({
      operationId: "scrap-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const detached = (await currentUnresolvedPositions(inventory))[0];
    if (detached === undefined) throw new Error("Expected detached stock.");

    const scrapped = await inventory.stock.scrap({
      operationId: "scrap-one-detached",
      occurredAtEpochMs: time2,
      from: detached.key,
      amount: stockAmount("1", "piece"),
      reason: "Broken while out of storage.",
    });
    expect(scrapped.event.kind).toBe(InventoryEventKind.Scrap);

    const remaining = (await currentUnresolvedPositions(inventory))[0];
    if (remaining === undefined) throw new Error("Expected one detached piece.");
    expect(remaining.measurements.primary.quantity.amountMinor).toBe(1);

    await inventory.stock.markMissing({
      operationId: "remaining-is-missing",
      occurredAtEpochMs: time3,
      from: remaining.key,
      amount: stockAmount("1", "piece"),
    });
    const missing = await currentUnresolvedPositions(inventory, {
      states: [InventoryStockWhereaboutsState.Missing],
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]?.measurements.primary.quantity.amountMinor).toBe(1);
    expect(await quantityAt(inventory, "store")).toBe(2);
  });


  it("keeps unresolved identity through absolute count reconciliation and exact replay", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "count-unresolved-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.detach({
      operationId: "count-unresolved-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const detached = (await currentUnresolvedPositions(inventory))[0];
    if (detached === undefined || detached.key.whereaboutsId === undefined) {
      throw new Error("Expected detached stock for absolute count.");
    }

    const command = {
      countId: "count-unresolved",
      operationId: "count-unresolved-replace",
      itemRevisionId: detached.key.itemRevisionId,
      selector: {
        itemId: "item-a",
        whereaboutsIds: [detached.key.whereaboutsId],
      },
      observedMeasurements: {
        primary: {
          axisId: "pieces",
          quantity: parseQuantity("1", "piece"),
        },
        independent: [],
      },
      occurredAtEpochMs: time2,
      reason: "One detached piece was physically absent at recount.",
    } as const;

    const replaced = await inventory.counts.replaceAbsolute(command);
    const replayed = await inventory.counts.replaceAbsolute(command);
    expect(replaced.count.status).toBe(InventoryCountStatus.Completed);
    expect(replayed.replayed).toBe(true);

    const remaining = await currentUnresolvedPositions(inventory, {
      whereaboutsIds: [detached.key.whereaboutsId],
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.key.placementNodeId).toBeUndefined();
    expect(remaining[0]?.key.whereaboutsState).toBe(
      InventoryStockWhereaboutsState.Detached
    );
    expect(remaining[0]?.measurements.primary.quantity.amountMinor).toBe(1);
  });

  it("protects exact reservation bindings while still allowing unreserved stock to detach", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "reserved-detach-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "reserved-detach-claim",
      operationId: "reserved-detach-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const placed = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["store"],
      })
    )[0];
    if (placed === undefined) throw new Error("Expected stock to reserve.");
    await inventory.reservations.allocate({
      operationId: "reserved-detach-allocate",
      reservationId: "reserved-detach-claim",
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: placed.key,
          quantity: parseQuantity("1", "piece"),
        },
      ],
    });

    await inventory.stock.detach({
      operationId: "reserved-detach-unallocated-unit",
      occurredAtEpochMs: time2,
      from: placed.key,
      amount: stockAmount("1", "piece"),
    });
    expect(await currentUnresolvedPositions(inventory)).toHaveLength(1);

    await expect(
      inventory.stock.detach({
        operationId: "reserved-detach-bound-unit",
        occurredAtEpochMs: time2,
        from: placed.key,
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");

    await inventory.reservations.release({
      operationId: "reserved-detach-release",
      reservationId: "reserved-detach-claim",
      occurredAtEpochMs: time2,
    });
    await inventory.stock.detach({
      operationId: "reserved-detach-after-release",
      occurredAtEpochMs: time3,
      from: placed.key,
      amount: stockAmount("1", "piece"),
    });
    expect(await currentUnresolvedPositions(inventory)).toHaveLength(2);
  });

  it("can append-only correct a detach when later evidence shows it was actually issued", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "correction-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    const detached = await inventory.stock.detach({
      operationId: "mistaken-detach",
      occurredAtEpochMs: time1,
      actorId: "nurse-a",
      sourceReference: "handoff-sheet-7",
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    expect(await currentUnresolvedPositions(inventory)).toHaveLength(1);

    const correction = await inventory.stock.correct({
      operationId: "correct-detach-to-issue",
      correctsEventId: detached.event.eventId,
      occurredAtEpochMs: time2,
      reason: "Later evidence showed these were dispensed.",
      replaceWith: (plans) =>
        plans.issue({
          occurredAtEpochMs: time1,
          from: loosePosition("store"),
          amount: stockAmount("2", "piece"),
          reason: "Actual historical dispense.",
        }),
    });
    expect(correction.event.kind).toBe(InventoryEventKind.Correction);
    expect(await currentUnresolvedPositions(inventory)).toEqual([]);
    expect(await quantityAt(inventory, "store")).toBe(3);
    expect(await inventory.read.event(detached.event.eventId)).toBeDefined();

    const correctedHistory = await inventory.read.whereaboutsHistory({
      actions: [InventoryWhereaboutsAction.Corrected],
      resolved: true,
    });
    expect(correctedHistory).toHaveLength(1);
    expect(correctedHistory[0]?.originEvent.operationId).toBe("mistaken-detach");
    expect(correctedHistory[0]?.originEvent.actorId).toBe("nurse-a");
    expect(correctedHistory[0]?.originEvent.sourceReference).toBe(
      "handoff-sheet-7"
    );
    expect(
      correctedHistory[0]?.history.flatMap((entry) => entry.actions)
    ).toContain(InventoryWhereaboutsAction.Corrected);
  });
  it("keeps indexed lifecycle history and item identities scoped to one cohort", async () => {
    const itemA = defineScalarInventoryItem({
      itemId: "item-a",
      revisionId: "item-a-v1",
      unit: "piece",
      axisId: "pieces",
    });
    const itemB = defineScalarInventoryItem({
      itemId: "item-b",
      revisionId: "item-b-v1",
      unit: "piece",
      axisId: "pieces",
    });
    const inventory = createInventoryOnce({
      catalog: defineInventoryCatalog({
        itemRevisions: [itemA, itemB],
        activeItemRevisionIds: {
          "item-a": itemA.revisionId,
          "item-b": itemB.revisionId,
        },
      }),
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(),
    });
    await inventory.stock.receiveMany({
      operationId: "whereabouts-mixed-receive",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: { itemId: "item-a", placementNodeId: "store-a" },
          amount: stockAmount("1", "piece"),
        },
        {
          to: { itemId: "item-b", placementNodeId: "store-b" },
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    await inventory.stock.detach({
      operationId: "whereabouts-mixed-detach-a",
      occurredAtEpochMs: time1,
      from: { itemId: "item-a", placementNodeId: "store-a" },
      amount: stockAmount("1", "piece"),
    });
    const lifecycle = (await inventory.read.whereabouts())[0];
    const detached = lifecycle?.currentPositions[0];
    if (lifecycle === undefined || detached === undefined) {
      throw new Error("Expected one detached cohort.");
    }

    await inventory.stock.issueMany({
      operationId: "whereabouts-mixed-issue",
      occurredAtEpochMs: time2,
      lines: [
        { from: detached.key, amount: stockAmount("1", "piece") },
        {
          from: { itemId: "item-b", placementNodeId: "store-b" },
          amount: stockAmount("1", "piece"),
        },
      ],
    });

    const history = await inventory.read.whereaboutsHistory({
      whereaboutsIds: [lifecycle.whereaboutsId],
      resolved: true,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.itemIds).toEqual(["item-a"]);
    expect(
      history[0]?.history.flatMap((entry) => entry.actions)
    ).toContain(InventoryWhereaboutsAction.Issued);

    const world = await inventory.read.world();
    expect(
      world.projection.eventSequencesByWhereaboutsId[lifecycle.whereaboutsId]
    ).toEqual(history[0]?.history.map((entry) => entry.event.recordSequence));
  });


});
