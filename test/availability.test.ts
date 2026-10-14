import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryOptionalIdentityConstraintKind,
  InventoryReservationFeasibilityStatus,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Use-by between the allocation time and the availability-read time. */
const useByBetweenTime1AndTime2 = 1787563800000;
/** Lot expiry safely after every test time. */
const farFutureExpiry = 1819065600000;

/** Read one revision summary or fail instead of hiding a test setup error. */
async function currentAvailability(
  inventory: ReturnType<typeof createTestInventory>,
  atEpochMs: number
) {
  const summary = await inventory.read.availability(
    inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      withinPlacementNodeIds: ["store"],
    }),
    atEpochMs
  );
  const revision = summary.revisions[0];
  if (revision === undefined) {
    throw new Error(
      "Availability test lost its current item revision summary."
    );
  }
  return { summary, revision };
}

describe("truthful native availability read model", () => {
  it("separates physical, expired, exact-allocation, and broad-claim facts", async () => {
    // Mutable instant driving the injected clock across this availability scenario.
    let recordedAtEpochMs = time1;
    const inventory = createTestInventory(undefined, undefined, {
      nowEpochMs: () => recordedAtEpochMs,
    });
    await inventory.stock.receiveMany({
      operationId: "availability-receive-lots",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "USABLE" }),
          amount: stockAmount("5", "piece"),
          lot: { expiresAtEpochMs: farFutureExpiry },
        },
        {
          to: loosePosition("OPENED", {
            lotId: "EXPIRED",
          }),
          amount: stockAmount("3", "piece"),
          lot: { expiresAtEpochMs: farFutureExpiry },
          placementNode: {
            category: "opened-vial",
            openedAtEpochMs: time0,
            useByEpochMs: useByBetweenTime1AndTime2,
          },
        },
      ],
    });
    await inventory.placement.move({
      operationId: "place-opened-vial-in-store",
      occurredAtEpochMs: time0,
      nodeId: "OPENED",
      into: "store",
    });
    await inventory.reservations.reserve({
      reservationId: "usable-exact",
      operationId: "reserve-usable-exact",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["USABLE"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-usable-exact",
      reservationId: "usable-exact",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.reservations.reserve({
      reservationId: "expired-exact",
      operationId: "reserve-expired-exact",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["EXPIRED"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-expired-exact",
      reservationId: "expired-exact",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.reservations.reserve({
      reservationId: "broad-claim",
      operationId: "reserve-broad",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", withinPlacementNodeIds: ["store"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    recordedAtEpochMs = time3;

    const { summary, revision } = await currentAvailability(inventory, time2);
    expect(revision.onHand.primary.quantity.amountMinor).toBe(8);
    expect(revision.usableOnHand.primary.quantity.amountMinor).toBe(5);
    expect(revision.expiredOnHand.primary.quantity.amountMinor).toBe(3);
    expect(revision.exactlyAllocatedUsable.amountMinor).toBe(2);
    expect(revision.exactlyAllocatedExpired.amountMinor).toBe(1);
    expect(revision.unallocatedUsablePhysical.amountMinor).toBe(3);
    expect(revision.broadRequested.amountMinor).toBe(1);
    expect(revision.broadReservationIds).toEqual(["broad-claim"]);
    expect(revision.unbackedExactlyAllocated.amountMinor).toBe(0);
    expect(summary.reservationFeasibility.status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );

    const byLot = new Map(
      revision.positions.map(
        /** Key exact position availability by lot for focused assertions. */
        (position) => [position.position.key.lotId, position]
      )
    );
    expect(byLot.get("USABLE")).toMatchObject({
      expired: false,
      exactlyAllocated: { amountMinor: 2, unit: "piece" },
      exactAllocationReservationIds: ["usable-exact"],
      unallocatedUsablePhysical: { amountMinor: 3, unit: "piece" },
    });
    expect(byLot.get("EXPIRED")).toMatchObject({
      expired: true,
      effectiveUseByEpochMs: useByBetweenTime1AndTime2,
      exactlyAllocated: { amountMinor: 1, unit: "piece" },
      exactAllocationReservationIds: ["expired-exact"],
      unallocatedUsablePhysical: { amountMinor: 0, unit: "piece" },
    });
  });

  it("separates recorded deficit from physical and burdens exact-lot availability", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "availability-record-deficit",
      occurredAtEpochMs: time0,
      from: loosePosition("store", { lotId: "__untracked__" }),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receive({
      operationId: "availability-receive-positive",
      occurredAtEpochMs: time1,
      to: loosePosition("store", { lotId: "POSITIVE" }),
      amount: stockAmount("10", "piece"),
    });

    const exact = await inventory.read.availability(
      inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
        lotIds: ["POSITIVE"],
      }),
      time2
    );
    const exactRevision = exact.revisions[0];
    if (exactRevision === undefined) throw new Error("Missing exact revision.");
    expect(exactRevision.onHand.primary.quantity.amountMinor).toBe(5);
    expect(exactRevision.physicalOnHand.primary.quantity.amountMinor).toBe(10);
    expect(exactRevision.deficit.primary.quantity.amountMinor).toBe(5);
    expect(
      exactRevision.usablePhysicalOnHand.primary.quantity.amountMinor
    ).toBe(10);
    expect(exactRevision.usableOnHand.primary.quantity.amountMinor).toBe(5);
    expect(exactRevision.unallocatedUsablePhysical.amountMinor).toBe(5);
    expect(exactRevision.positions).toMatchObject([
      {
        isDeficit: false,
        unallocatedUsablePhysical: { amountMinor: 5 },
      },
    ]);

    const broad = await currentAvailability(inventory, time2);
    const deficitPosition = broad.revision.positions.find(
      /** Select the explicit recorded-deficit row from broad availability. */
      (position) => position.isDeficit
    );
    expect(deficitPosition).toMatchObject({
      position: { key: { lotId: "__untracked__" } },
      deficitMeasurements: { primary: { quantity: { amountMinor: 5 } } },
      unallocatedUsablePhysical: { amountMinor: 0 },
    });
  });

  it("keeps detached recorded deficit separate from unrelated placed deficit", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({
      operationId: "avail-absent-receive", occurredAtEpochMs: time0,
      to: loosePosition("store-a"), amount: stockAmount("2", "piece"),
    });
    await inventory.stock.detach({
      operationId: "avail-absent-detach", occurredAtEpochMs: time1,
      from: loosePosition("store-a"), amount: stockAmount("2", "piece"),
    });
    const detached = (await inventory.read.whereabouts())[0]?.currentPositions[0];
    if (detached === undefined) throw new Error("Expected detached position.");
    await inventory.stock.issue({
      operationId: "avail-absent-overissue", occurredAtEpochMs: time2,
      from: detached.key, amount: stockAmount("5", "piece"),
    });
    await inventory.stock.issue({
      operationId: "avail-placed-shortage", occurredAtEpochMs: time3,
      from: loosePosition("store-b"), amount: stockAmount("7", "piece"),
    });
    /** Read one revision under exact placement-presence or wildcard selection. */
    const read = async (kind?: InventoryOptionalIdentityConstraintKind) =>
      inventory.read.availability(
        inventoryStockSelector("item-a", {
          itemRevisionIds: ["item-a-v2"],
          ...(kind === undefined ? {} : { placement: { kind } }),
        }),
        time3
      );
    const absent = (await read(InventoryOptionalIdentityConstraintKind.Absent)).revisions[0];
    const present = (await read(InventoryOptionalIdentityConstraintKind.Present)).revisions[0];
    const broad = (await read()).revisions[0];
    expect(absent?.deficit.primary.quantity.amountMinor).toBe(3);
    expect(absent?.onHand.primary.quantity.amountMinor).toBe(-3);
    expect(present?.deficit.primary.quantity.amountMinor).toBe(7);
    expect(broad?.deficit.primary.quantity.amountMinor).toBe(10);
  });


  it("attributes one location deficit once across exact-lot availability rows", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "availability-record-multilot-deficit",
      occurredAtEpochMs: time0,
      from: loosePosition("store", { lotId: "__untracked__" }),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receiveMany({
      operationId: "availability-receive-multilot-positive",
      occurredAtEpochMs: time1,
      lines: [
        {
          to: loosePosition("store", { lotId: "A-FIRST" }),
          amount: stockAmount("4", "piece"),
        },
        {
          to: loosePosition("store", { lotId: "B-SECOND" }),
          amount: stockAmount("6", "piece"),
        },
      ],
    });

    const first = await inventory.read.availability(
      inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
        lotIds: ["A-FIRST"],
      }),
      time2
    );
    const firstRevision = first.revisions[0];
    if (firstRevision === undefined)
      throw new Error("Missing first lot revision.");
    expect(firstRevision.physicalOnHand.primary.quantity.amountMinor).toBe(4);
    expect(firstRevision.deficit.primary.quantity.amountMinor).toBe(4);
    expect(firstRevision.usableDeficit.primary.quantity.amountMinor).toBe(4);
    expect(firstRevision.onHand.primary.quantity.amountMinor).toBe(0);
    expect(firstRevision.usableOnHand.primary.quantity.amountMinor).toBe(0);
    expect(firstRevision.unallocatedUsablePhysical.amountMinor).toBe(0);

    const second = await inventory.read.availability(
      inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["store"],
        lotIds: ["B-SECOND"],
      }),
      time2
    );
    const secondRevision = second.revisions[0];
    if (secondRevision === undefined)
      throw new Error("Missing second lot revision.");
    expect(secondRevision.physicalOnHand.primary.quantity.amountMinor).toBe(6);
    expect(secondRevision.deficit.primary.quantity.amountMinor).toBe(1);
    expect(secondRevision.usableDeficit.primary.quantity.amountMinor).toBe(1);
    expect(secondRevision.onHand.primary.quantity.amountMinor).toBe(5);
    expect(secondRevision.usableOnHand.primary.quantity.amountMinor).toBe(5);
    expect(secondRevision.unallocatedUsablePhysical.amountMinor).toBe(5);

    const broad = await currentAvailability(inventory, time2);
    expect(broad.revision.physicalOnHand.primary.quantity.amountMinor).toBe(10);
    expect(broad.revision.deficit.primary.quantity.amountMinor).toBe(5);
    expect(broad.revision.onHand.primary.quantity.amountMinor).toBe(5);
  });

  it("reports exact allocations whose physical positions disappeared", async () => {
    const inventory = createTestInventory(undefined, undefined, {
      nowEpochMs: () => time3,
    });
    await inventory.stock.receive({
      operationId: "receive-unbacked-position",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "MISSING" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "unbacked-claim",
      operationId: "reserve-unbacked",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["MISSING"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-unbacked",
      reservationId: "unbacked-claim",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.stock.scrap({
      operationId: "physically-destroy-unbacked",
      occurredAtEpochMs: time2,
      from: loosePosition("store", { lotId: "MISSING" }),
      amount: stockAmount("1", "piece"),
      reason: "The allocated piece was physically destroyed.",
    });

    const { summary, revision } = await currentAvailability(inventory, time3);
    expect(revision.onHand.primary.quantity.amountMinor).toBe(0);
    expect(revision.positions).toEqual([]);
    expect(revision.unbackedExactlyAllocated.amountMinor).toBe(1);
    expect(revision.unbackedReservationIds).toEqual(["unbacked-claim"]);
    expect(summary.reservationFeasibility.status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
  });

  it("adds exact allocations across several usable positions once each", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-several-allocation-rows",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "ALLOC-A" }),
          amount: stockAmount("4", "piece"),
        },
        {
          to: loosePosition("store", { lotId: "ALLOC-B" }),
          amount: stockAmount("5", "piece"),
        },
      ],
    });
    await inventory.reservations.reserve({
      reservationId: "allocation-a",
      operationId: "reserve-allocation-a",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["ALLOC-A"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-allocation-a",
      reservationId: "allocation-a",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fifo,
    });
    await inventory.reservations.reserve({
      reservationId: "allocation-b",
      operationId: "reserve-allocation-b",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", lotIds: ["ALLOC-B"] },
      requested: parseQuantity("3", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocateByPolicy({
      operationId: "allocate-allocation-b",
      reservationId: "allocation-b",
      occurredAtEpochMs: time1,
      method: InventoryAllocationMethod.Fifo,
    });

    const { revision } = await currentAvailability(inventory, time2);
    expect(revision.exactlyAllocatedUsable.amountMinor).toBe(5);
    expect(revision.unallocatedUsablePhysical.amountMinor).toBe(4);
  });
});
