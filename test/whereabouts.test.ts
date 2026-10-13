import { describe, expect, it, vi } from "vitest";
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
import {
  createInventoryDetachEvent,
  createInventoryOpeningEvent,
  createInventoryReclassificationEvent,
  createInventoryReclassificationManyEvent,
  createInventoryTransformationEvent,
} from "../src/kernel.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  findInventoryWhereaboutsHistory,
  inventoryWhereaboutsLifecycles,
} from "../src/whereabouts.js";
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

  it("rejects lifecycle invention through generic reclassification and transformation builders", () => {
    const catalog = createTabletCatalog();
    const forgedUnresolved = {
      itemId: "item-a",
      whereaboutsId: "caller-forged-cohort",
      whereaboutsState: InventoryStockWhereaboutsState.Detached,
      lastPlacementNodeId: "store",
      detachedAtEpochMs: time1,
    } as const;

    expect(() =>
      createInventoryReclassificationEvent({
        catalog,
        operationId: "reject-forged-single-reclassification-cohort",
        occurredAtEpochMs: time1,
        from: loosePosition("store"),
        to: forgedUnresolved,
        amount: stockAmount("1", "piece"),
      })
    ).toThrow(
      "Generic reclassification cannot change a whereabouts lifecycle"
    );

    expect(() =>
      createInventoryReclassificationManyEvent({
        catalog,
        operationId: "reject-forged-reclassification-cohort",
        occurredAtEpochMs: time1,
        consume: [
          {
            from: loosePosition("store"),
            amount: stockAmount("1", "piece"),
          },
        ],
        produce: [
          {
            to: forgedUnresolved,
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).toThrow(
      "Generic reclassification cannot create or resolve detached/missing whereabouts cohorts."
    );

    const explicitDetach = createInventoryDetachEvent({
      catalog,
      operationId: "explicit-low-level-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    expect(explicitDetach.stockEffects[1]?.position).toMatchObject({
      whereaboutsId:
        "inventory:whereabouts:explicit-low-level-detach",
      whereaboutsState: InventoryStockWhereaboutsState.Detached,
      lastPlacementNodeId: "store",
      detachedAtEpochMs: time1,
    });

    expect(() =>
      createInventoryTransformationEvent({
        catalog,
        operationId: "reject-forged-transformation-cohort",
        occurredAtEpochMs: time1,
        consume: [
          {
            position: loosePosition("store"),
            amount: stockAmount("1", "piece"),
          },
        ],
        produce: [
          {
            position: forgedUnresolved,
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).toThrow(
      "Transformation output cannot invent or switch a detached/missing whereabouts lifecycle."
    );
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
    const secondDetach = await inventory.stock.detach({
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

    // A global first-row selection would incorrectly select the older detach;
    // derive the exact cohort from the event and use its indexed read instead.
    const secondDetachWhereaboutsId = secondDetach.event.stockEffects.find(
      (effect) => effect.position.whereaboutsId !== undefined
    )?.position.whereaboutsId;
    expect(secondDetachWhereaboutsId).toBe(secondWhereaboutsId);
    expect(firstWhereaboutsId).not.toBe(secondDetachWhereaboutsId);
    if (secondDetachWhereaboutsId === undefined) {
      throw new Error("The second detach did not produce a whereabouts cohort.");
    }
    const matchedCohort = await inventory.read.whereabouts({
      whereaboutsIds: [secondDetachWhereaboutsId],
    });
    expect(matchedCohort).toHaveLength(1);
    expect(matchedCohort[0]?.originEvent.eventId).toBe(
      secondDetach.event.eventId
    );
    expect(matchedCohort[0]?.currentPositions[0]?.key.whereaboutsId).toBe(
      secondDetachWhereaboutsId
    );
    expect(matchedCohort[0]?.currentPositions[0]?.measurements.primary.quantity.amountMinor)
      .toBe(2);

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


  it("uses the retained item index when querying only selected whereabouts cohorts", async () => {
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
      operationId: "indexed-whereabouts-seed",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: { itemId: "item-a", placementNodeId: "store-a" },
          amount: stockAmount("2", "piece"),
        },
        {
          to: { itemId: "item-b", placementNodeId: "store-b" },
          amount: stockAmount("500", "piece"),
        },
      ],
    });
    await inventory.stock.detach({
      operationId: "indexed-whereabouts-detach",
      occurredAtEpochMs: time1,
      from: { itemId: "item-a", placementNodeId: "store-a" },
      amount: stockAmount("1", "piece"),
    });
    const cohort = (await inventory.read.whereabouts())[0];
    if (cohort === undefined) throw new Error("Expected detached cohort.");
    const published = (await inventory.read.world()).projection;
    const guarded = {
      ...published,
      positions: new Proxy(published.positions, {
        /** A cohort-local query must never enumerate every warehouse position. */
        ownKeys() {
          throw new Error("Filtered whereabouts query enumerated the entire warehouse.");
        },
      }),
      positionIdsByItemId: new Proxy(published.positionIdsByItemId, {
        /** Exact cohort lookup must not widen to every current position for its item. */
        get() {
          throw new Error("Filtered whereabouts query widened to the item index.");
        },
      }),
    };
    expect(
      inventoryWhereaboutsLifecycles(
        guarded,
        new Set([cohort.whereaboutsId])
      )
    ).toEqual([cohort]);
    // An unfiltered read still needs only unresolved cohort positions; placed
    // warehouse rows must not be enumerated to return complete lifecycle history.
    expect(inventoryWhereaboutsLifecycles(guarded)).toEqual([cohort]);
    expect(
      findInventoryWhereaboutsHistory(guarded, { itemIds: ["item-a"] })
    ).toEqual([cohort]);
    expect(
      findInventoryWhereaboutsHistory(guarded, { resolved: true })
    ).toEqual([]);
  });

  it("reads an exact whereabouts cohort without enumerating every unrelated warehouse position", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "cohort-read-warehouse-receive",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store-a"),
          amount: stockAmount("3", "piece"),
        },
        {
          to: loosePosition("store-b"),
          amount: stockAmount("100", "piece"),
        },
      ],
    });
    const detached = await inventory.stock.detach({
      operationId: "cohort-read-warehouse-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store-a"),
      amount: stockAmount("1", "piece"),
    });
    const whereaboutsId = detached.event.stockEffects.find(
      (effect) => effect.position.whereaboutsId !== undefined
    )?.position.whereaboutsId;
    if (whereaboutsId === undefined) {
      throw new Error("Detach did not retain its whereabouts identity.");
    }
    const snapshot = await inventory.read.snapshot();
    const originalValues = Object.values;
    const positions = (await inventory.read.world()).projection.positions;
    const detachedPositionId = Object.keys(positions).find(
      (identity) => positions[identity]?.key.whereaboutsId === whereaboutsId
    );
    if (detachedPositionId === undefined) {
      throw new Error("Published projection lost the detached stock row.");
    }
    const allPositions = vi.spyOn(Object, "values").mockImplementation(
      /** Reject any warehouse-wide positions enumeration inside the focused read. */
      (record) => {
        if (Object.prototype.hasOwnProperty.call(record, detachedPositionId)) {
          throw new Error("Exact cohort query enumerated every stock position.");
        }
        return originalValues(record);
      }
    );
    try {
      const lifecycles = snapshot.whereabouts({ whereaboutsIds: [whereaboutsId] });
      expect(lifecycles).toHaveLength(1);
      expect(lifecycles[0]?.currentPositions[0]?.key.whereaboutsId).toBe(
        whereaboutsId
      );
      // Item-scoped reads should also use the retained item index rather than
      // enumerating the entire warehouse for a narrow item filter.
      const byItem = snapshot.whereabouts({ itemIds: ["item-a"] });
      expect(byItem).toHaveLength(1);
      expect(byItem[0]?.whereaboutsId).toBe(whereaboutsId);
    } finally {
      allPositions.mockRestore();
    }
  });

  it("keeps an embodied node aligned through detach, missing, recovery, and final issue", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "embodied-whereabouts-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("3", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "embodied-whereabouts-individualize",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "CAB-DETACHED",
      asPlacementNode: {
        category: "cabinet",
        acceptsPlacement: true,
      },
    });
    await inventory.stock.transfer({
      operationId: "embodied-whereabouts-load",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      toPlacementNodeId: "CAB-DETACHED",
      amount: stockAmount("1", "piece"),
    });

    await inventory.stock.detach({
      operationId: "embodied-whereabouts-detach",
      occurredAtEpochMs: time2,
      from: {
        itemId: "item-a",
        placementNodeId: "store",
        serialId: "CAB-DETACHED",
      },
      amount: stockAmount("1", "piece"),
    });
    expect(await inventory.read.placementAncestry("CAB-DETACHED")).toEqual([
      "CAB-DETACHED",
    ]);
    expect(await quantityAt(inventory, "CAB-DETACHED")).toBe(1);

    const detached = (await currentUnresolvedPositions(inventory)).find(
      /** Find the detached unique cabinet rather than unrelated unresolved stock. */
      (position) => position.key.serialId === "CAB-DETACHED"
    );
    if (detached === undefined || detached.key.whereaboutsId === undefined) {
      throw new Error("Expected the embodied cabinet to be detached.");
    }
    const whereaboutsId = detached.key.whereaboutsId;
    await inventory.stock.markMissing({
      operationId: "embodied-whereabouts-missing",
      occurredAtEpochMs: time2,
      from: detached.key,
      amount: stockAmount("1", "piece"),
    });
    const missing = await unresolvedById(inventory, whereaboutsId);
    expect(missing.key.serialId).toBe("CAB-DETACHED");
    expect(missing.key.whereaboutsState).toBe(
      InventoryStockWhereaboutsState.Missing
    );
    expect(await inventory.read.placementAncestry("CAB-DETACHED")).toEqual([
      "CAB-DETACHED",
    ]);
    expect(await quantityAt(inventory, "CAB-DETACHED")).toBe(1);

    await inventory.stock.place({
      operationId: "embodied-whereabouts-recover",
      occurredAtEpochMs: time3,
      from: missing.key,
      into: "room",
      amount: stockAmount("1", "piece"),
    });
    expect(await inventory.read.placementAncestry("CAB-DETACHED")).toEqual([
      "CAB-DETACHED",
      "room",
    ]);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          serialIds: ["CAB-DETACHED"],
        })
      )[0]?.key.placementNodeId
    ).toBe("room");
    expect(await quantityAt(inventory, "CAB-DETACHED")).toBe(1);

    await expect(
      inventory.stock.issue({
        operationId: "embodied-whereabouts-reject-loaded-issue",
        occurredAtEpochMs: time3,
        from: {
          itemId: "item-a",
          placementNodeId: "room",
          serialId: "CAB-DETACHED",
        },
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("must be empty");

    await inventory.stock.transfer({
      operationId: "embodied-whereabouts-empty",
      occurredAtEpochMs: time3,
      from: loosePosition("CAB-DETACHED"),
      toPlacementNodeId: "room",
      amount: stockAmount("1", "piece"),
    });
    const issued = await inventory.stock.issue({
      operationId: "embodied-whereabouts-final-issue",
      occurredAtEpochMs: time3,
      from: {
        itemId: "item-a",
        placementNodeId: "room",
        serialId: "CAB-DETACHED",
      },
      amount: stockAmount("1", "piece"),
    });
    expect(issued.event.kind).toBe(InventoryEventKind.Issue);
    expect(
      (await inventory.read.placementNode("CAB-DETACHED"))?.retiredByEventId
    ).toBeDefined();
    expect(
      await inventory.read.positions({
        itemId: "item-a",
        serialIds: ["CAB-DETACHED"],
      })
    ).toEqual([]);

    const history = await inventory.read.whereaboutsHistory({
      whereaboutsIds: [whereaboutsId],
      resolved: true,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.history.flatMap((entry) => entry.actions)).toContain(
      InventoryWhereaboutsAction.MarkedMissing
    );
    expect(history[0]?.history.flatMap((entry) => entry.actions)).toContain(
      InventoryWhereaboutsAction.Placed
    );
  });


});
