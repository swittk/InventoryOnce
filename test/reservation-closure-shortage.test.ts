import { describe, expect, it, vi } from "vitest";

import {
  InventoryDeficitPolicy,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  packageAmount,
  parseQuantity,
  stockAmount,
  type InventoryOnce,
} from "../src/index.js";
import {
  createInventoryTransferEvent,
  releaseInventoryReservation,
} from "../src/kernel.js";
import {
  commitInventoryOperation,
  createInMemoryInventoryDurableStorage,
  InventoryWorldRevisionConflictError,
  type InMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
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

it("keeps a large supported whole-stock assignment within the runtime stack", async () => {
  const item = defineScalarInventoryItem({ itemId: "packed", revisionId: "packed-v1", axisId: "pieces", unit: "piece" });
  const pack = defineScalarInventoryPackaging({ revisionId: "single", item, packageUnit: "box", contains: "1" });
  const catalog = defineInventoryCatalog({
    itemRevisions: [item], activeItemRevisionIds: { packed: item.revisionId }, packagingRevisions: [pack],
  });
  const inventory = createTestInventory(undefined, catalog);
  const position = { itemId: item.itemId, placementNodeId: "store" };
  const selector = { itemId: item.itemId, placementNodeIds: ["store"] };
  await inventory.stock.receive({ operationId: "loose", occurredAtEpochMs: time0, to: position, amount: stockAmount("64", "piece") });
  for (let index = 0; index < 64; index += 1) {
    const reservationId = `claim-${index}`;
    await inventory.reservations.reserve({
      operationId: reservationId, reservationId, itemRevisionId: item.revisionId, selector,
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    });
  }
  await inventory.stock.receiveMany({
    operationId: "whole-stock", occurredAtEpochMs: time1,
    lines: Array.from({ length: 120 }, (_, index) => ({
      to: { ...position, lotId: `pack-${index}` }, amount: packageAmount(1, pack.revisionId),
    })),
  });
  await inventory.stock.issue({ operationId: "issue-loose", occurredAtEpochMs: time2, from: position, amount: stockAmount("64", "piece") });
  const report = await inventory.read.reservationFeasibility();
  expect(report.groups[0]?.fulfillable).toEqual(parseQuantity("64", "piece"));
  expect(report.groups[0]?.shortage).toEqual(parseQuantity("0", "piece"));
});

it.each([false, true])("reports each broad claim's whole-piece shortfall after loose stock is issued (canonical: %s)", async (canonical) => {
  const item = defineScalarInventoryItem({ itemId: "paired", revisionId: "paired-v1", axisId: "pieces", unit: "piece" });
  const pair = defineScalarInventoryPackaging({ revisionId: "pair", item, packageUnit: "box", contains: "2" });
  const triple = defineScalarInventoryPackaging({ revisionId: "triple", item, packageUnit: "box", contains: "3" });
  const catalog = defineInventoryCatalog({
    itemRevisions: [item], activeItemRevisionIds: { paired: item.revisionId }, packagingRevisions: [pair, triple],
  });
  const store = { itemId: item.itemId, placementNodeId: "store" };
  for (const { rows, claims, losses } of [
    { rows: [{ lot: "even", packaging: pair, packs: 4, loose: "2" }], claims: [["even", 3], ["even", 3]], losses: [["even", 1], ["even", 2]] },
    { rows: [{ lot: "even", packaging: pair, packs: 100_004, loose: "2" }], claims: [["even", 100_003], ["even", 100_003]],
      losses: [["even", 1], ["even", 2]] },
    { rows: [{ lot: "even", packaging: pair, packs: 50_002, loose: "1" }, { lot: "three", packaging: triple, packs: 50_002, loose: "1" }],
      claims: [["even", 100_003], ["three", 150_004]], losses: [["even", 1], ["three", 2]] },
    { rows: [{ lot: "even", packaging: pair, packs: 100_004, loose: "1" }, { lot: "spare", packaging: pair, packs: 0, loose: "2" }],
      claims: [["even", 100_003], ["spare", 1]], losses: [["even", 1]] },
  ] as const) {
    // A failpoint routes reference writes through the canonical staged coordinator.
    const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
    const inventory = createTestInventory(storage, catalog);
    await inventory.stock.receiveMany({
      operationId: "receive-pairs-and-loose", occurredAtEpochMs: time0,
      lines: rows.flatMap(({ lot, packaging, packs, loose }) => [
        ...(packs > 0 ? [{ to: { ...store, lotId: lot }, amount: packageAmount(packs, packaging.revisionId) }] : []),
        { to: { ...store, lotId: `${lot}-loose` }, amount: stockAmount(loose, "piece") },
      ]),
    });
    let totalRequested = 0;
    for (const [index, [lot, demand]] of claims.entries()) {
      totalRequested += demand;
      const selector = { itemId: item.itemId, placementNodeIds: ["store"], lotIds: [lot, `${lot}-loose`] };
      await inventory.reservations.reserve({
        operationId: `reserve-${index}`, reservationId: `hold-${index}`, itemRevisionId: item.revisionId,
        selector, requested: parseQuantity(String(demand), "piece"), createdAtEpochMs: time1,
      });
    }
    expect((await inventory.read.reservationFeasibility()).status).toBe(InventoryReservationFeasibilityStatus.Feasible);
    for (const [lot, shortage] of losses) {
      await inventory.stock.issue({
        operationId: `issue-loose-${shortage}`, occurredAtEpochMs: time2,
        from: { ...store, lotId: `${lot}-loose` }, amount: stockAmount("1", "piece"),
      });
      expect(await inventory.read.reservationFeasibility()).toMatchObject({
        status: InventoryReservationFeasibilityStatus.Shortage,
        groups: [{
          requested: parseQuantity(String(totalRequested), "piece"),
          fulfillable: parseQuantity(String(totalRequested - shortage), "piece"),
          shortage: parseQuantity(String(shortage), "piece"),
        }],
      });
    }
  }
});

it.each([false, true])("bounds mixed whole increments after loose stock is issued (canonical: %s)", async (canonical) => {
  const item = defineScalarInventoryItem({ itemId: "mixed", revisionId: "mixed-v1", axisId: "pieces", unit: "piece" });
  const four = defineScalarInventoryPackaging({ revisionId: "four", item, packageUnit: "box", contains: "4" });
  const seven = defineScalarInventoryPackaging({ revisionId: "seven", item, packageUnit: "box", contains: "7" });
  const catalog = defineInventoryCatalog({
    itemRevisions: [item], activeItemRevisionIds: { mixed: item.revisionId }, packagingRevisions: [four, seven],
  });
  const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
  const inventory = createTestInventory(storage, catalog);
  const store = { itemId: item.itemId, placementNodeId: "store" };
  const loose = { ...store, lotId: "loose" };
  await inventory.stock.receiveMany({
    operationId: "receive-mixed-increments", occurredAtEpochMs: time0,
    lines: [
      { to: { ...store, lotId: "four" }, amount: packageAmount(200_000, four.revisionId) },
      { to: { ...store, lotId: "seven" }, amount: packageAmount(1, seven.revisionId) },
      { to: loose, amount: stockAmount("3", "piece") },
    ],
  });
  const requested = parseQuantity("800002", "piece");
  await inventory.reservations.reserve({
    operationId: "reserve-mixed-increments", reservationId: "hold", itemRevisionId: item.revisionId,
    selector: { itemId: item.itemId, placementNodeIds: ["store"] }, requested, createdAtEpochMs: time1,
  });
  expect((await inventory.read.reservationFeasibility()).status).toBe(InventoryReservationFeasibilityStatus.Feasible);

  // Taking the seven-piece package leaves a worse remainder than skipping it.
  for (const shortage of [0, 1, 2]) {
    await inventory.stock.issue({
      operationId: `issue-mixed-loose-${shortage}`, occurredAtEpochMs: time2,
      from: loose, amount: stockAmount("1", "piece"),
    });
    expect((await inventory.read.reservationFeasibility()).groups).toMatchObject([{
      requested, fulfillable: parseQuantity(String(800_002 - shortage), "piece"),
      shortage: parseQuantity(String(shortage), "piece"),
    }]);
  }
  expect(await inventory.read.reservation("hold")).toMatchObject({ requested, status: InventoryReservationStatus.Active });
});

/** Runtime and durable adapter after physical loss leaves only claim c1 short. */
interface ReservationShortageFixture {
  /** Real application-facing InventoryOnce facade. */
  readonly inventory: InventoryOnce;
  /** Reference durable adapter used to inspect frozen operation and event truth. */
  readonly storage: InMemoryInventoryDurableStorage;
}

it("replays the matching operation after the last canonical revision conflict", async () => {
  const catalog = createTabletCatalog();
  const storage = createInMemoryInventoryDurableStorage();
  const inventory = createTestInventory(storage, catalog);
  const amount = stockAmount("1", "piece");
  await inventory.stock.receive({ operationId: "canonical-race-stock", occurredAtEpochMs: time0,
    to: loosePosition("store"), amount });
  const operationId = "canonical-final-replay";
  const event = createInventoryTransferEvent({
    catalog, operationId, occurredAtEpochMs: time1, from: loosePosition("store"), toPlacementNodeId: "destination", amount,
  });
  const input = { catalog, storage, operationId, intentFingerprint: "same-transfer", clock: clockAt(time3),
    deficitPolicy: InventoryDeficitPolicy.Reject, maxRevisionRetries: 1,
    /** Plan the same physical operation in both contenders. */
    plan: () => ({ event }) };
  const begin = storage.begin.bind(storage);
  const before = (await storage.readWorld()).revision;
  let won: Awaited<ReturnType<typeof commitInventoryOperation>> | undefined;
  vi.spyOn(storage, "begin").mockImplementationOnce(async (request) => {
    await inventory.stock.receive({ operationId: "canonical-intervening-stock", occurredAtEpochMs: time1,
      to: loosePosition("elsewhere"), amount });
    try {
      return await begin(request);
    } catch (error) {
      if (!(error instanceof InventoryWorldRevisionConflictError)) throw error;
      won = await commitInventoryOperation(input);
      throw error;
    }
  });
  const replay = await commitInventoryOperation(input);
  expect(won?.replayed).toBe(false);
  expect(replay).toEqual({ ...won, replayed: true });
  expect(replay.world.revision).toBe(before + 2);
});

/** Build the exact ReservationScope release counterexample through public calls. */
async function createReservationShortageFixture(
  secondClaimExpiresAtEpochMs?: number
): Promise<ReservationShortageFixture> {
  const storage = createInMemoryInventoryDurableStorage();
  let recordedAtEpochMs = time1;
  const inventory = createTestInventory(
    storage,
    createTabletCatalog(),
    {
      /** Let the fixture cross the optional c2 expiry before recording physical loss. */
      nowEpochMs: () => recordedAtEpochMs,
    }
  );
  await inventory.stock.receiveMany({
    operationId: "closure:init:receive",
    occurredAtEpochMs: time0,
    lines: [
      { to: loosePosition("u1"), amount: stockAmount("1", "piece") },
      { to: loosePosition("u2"), amount: stockAmount("1", "piece") },
    ],
  });
  await inventory.reservations.reserve({
    reservationId: "c1",
    operationId: "closure:reserve:c1",
    itemRevisionId: "item-a-v2",
    selector: { itemId: "item-a", placementNodeIds: ["u1"] },
    requested: parseQuantity("1", "piece"),
    createdAtEpochMs: time1,
  });
  await inventory.reservations.reserve({
    reservationId: "c2",
    operationId: "closure:reserve:c2",
    itemRevisionId: "item-a-v2",
    selector: { itemId: "item-a", placementNodeIds: ["u2"] },
    requested: parseQuantity("1", "piece"),
    createdAtEpochMs: time1,
    ...(secondClaimExpiresAtEpochMs === undefined
      ? {}
      : { expiresAtEpochMs: secondClaimExpiresAtEpochMs }),
  });
  recordedAtEpochMs = time3;
  await inventory.stock.scrap({
    operationId: "closure:physical-loss:u1",
    occurredAtEpochMs: time2,
    from: loosePosition("u1"),
    amount: stockAmount("1", "piece"),
    reason: "The u1 token was physically lost.",
  });
  expect(
    (await inventory.read.reservationFeasibility(time2)).status
  ).toBe(InventoryReservationFeasibilityStatus.Shortage);
  return { inventory, storage };
}

/** Return every current primary stock quantity in deterministic world-row order. */
function primaryStockAmounts(inventory: InventoryOnce): Promise<readonly number[]> {
  return inventory.read.world().then((world) =>
    Object.values(world.projection.positions).map(
      (position) => position.measurements.primary.quantity.amountMinor
    )
  );
}

describe("reservation closure through an existing shortage", () => {
  it("releases one claim while an unrelated claim remains short and freezes retries", async () => {
    const { inventory, storage } = await createReservationShortageFixture();
    const before = await inventory.read.world();
    const operationCountBefore = Object.keys(before.projection.events).length;
    const command = {
      reservationId: "c2",
      operationId: "closure:release:c2",
      occurredAtEpochMs: time2,
    };

    const released = await inventory.reservations.release(command);
    const frozenRelease = structuredClone(released);
    const after = await inventory.read.world();
    expect(released).toMatchObject({
      replayed: false,
      reservation: { reservationId: "c2", status: InventoryReservationStatus.Released },
    });
    expect(after.projection).toEqual(before.projection);
    expect(Object.keys(after.projection.events)).toHaveLength(
      operationCountBefore
    );
    expect(
      (await inventory.read.reservationFeasibility(time2)).groups[0]
    ).toMatchObject({
      reservationIds: ["c1"],
      requested: { amountMinor: 1 },
      fulfillable: { amountMinor: 0 },
      shortage: { amountMinor: 1 },
    });
    expect(await primaryStockAmounts(inventory)).toEqual([1]);
    expect((await primaryStockAmounts(inventory)).every((amount) => amount >= 0)).toBe(
      true
    );

    const replayed = await inventory.reservations.release(command);
    expect(replayed).toMatchObject({
      replayed: true,
      reservation: { reservationId: "c2", status: InventoryReservationStatus.Released },
    });
    expect(replayed.receipt).toEqual(frozenRelease.receipt);
    expect(replayed.reservation).toEqual(frozenRelease.reservation);
    expect(await inventory.read.world()).toEqual(after);
    await expect(
      inventory.reservations.release({ ...command, occurredAtEpochMs: time3 })
    ).rejects.toThrow("retried with changed intent");
    const durableOperation = await storage.readOperation(command.operationId);
    expect(durableOperation).toMatchObject({
      receipt: { reservationId: "c2" },
    });
    expect(durableOperation).not.toHaveProperty("event");
    expect(durableOperation?.receipt).not.toHaveProperty("eventId");
  });

  it("expires one claim at its canonical boundary while the other claim stays short", async () => {
    const { inventory } = await createReservationShortageFixture(time2);
    const before = await inventory.read.world();

    await expect(inventory.reservations.expire({
      reservationId: "c2",
      operationId: "closure:premature-expire:c2",
      occurredAtEpochMs: time1,
    })).rejects.toThrow("has not reached its expiry time");
    expect(await inventory.read.world()).toEqual(before);
    const command = {
      reservationId: "c2",
      operationId: "closure:expire:c2",
      occurredAtEpochMs: time2,
    };
    const expired = await inventory.reservations.expire(command);
    const frozenExpiry = structuredClone(expired);

    expect(expired).toMatchObject({
      replayed: false,
      reservation: { reservationId: "c2", status: InventoryReservationStatus.Expired },
    });
    expect((await inventory.read.world()).projection).toEqual(before.projection);
    expect(
      (await inventory.read.reservationFeasibility(time2)).status
    ).toBe(InventoryReservationFeasibilityStatus.Shortage);
    const after = await inventory.read.world();
    const replayed = await inventory.reservations.expire(command);
    expect(replayed.replayed).toBe(true);
    expect(replayed.receipt).toEqual(frozenExpiry.receipt);
    expect(replayed.reservation).toEqual(frozenExpiry.reservation);
    expect(await inventory.read.world()).toEqual(after);
    await expect(inventory.reservations.expire({ ...command, occurredAtEpochMs: time3 }))
      .rejects.toThrow("retried with changed intent");
  });

  it("retains the original release receipt after a later claim closure advances the world", async () => {
    const { inventory } = await createReservationShortageFixture();
    const command = { reservationId: "c2", operationId: "closure:old-receipt:c2", occurredAtEpochMs: time2 };
    const frozenRelease = structuredClone(await inventory.reservations.release(command));
    await inventory.reservations.release({ reservationId: "c1", operationId: "closure:later-release:c1", occurredAtEpochMs: time3 });
    const latestWorld = await inventory.read.world();
    expect(latestWorld.revision).toBeGreaterThan(frozenRelease.receipt.worldRevision);
    const replayed = await inventory.reservations.release(command);
    expect(replayed.replayed).toBe(true);
    expect(replayed.receipt).toEqual(frozenRelease.receipt);
    expect(replayed.reservation).toEqual(frozenRelease.reservation);
    expect(await inventory.read.world()).toEqual(latestWorld);
  });

  it("publishes physical changes during shortage and keeps new and refined claims protected", async () => {
    const { inventory } = await createReservationShortageFixture();
    const before = await inventory.read.world();

    await inventory.stock.receive({
      operationId: "closure:unrelated-receive",
      occurredAtEpochMs: time2,
      to: loosePosition("u2"),
      amount: stockAmount("1", "piece"),
    });
    const selector = { itemId: "item-a", placementNodeIds: ["u2"] };
    expect(await inventory.read.positions(selector)).toMatchObject([{ measurements: { primary: { quantity: parseQuantity("2", "piece") } } }]);
    await expect(
      inventory.reservations.reserve({
        reservationId: "c3",
        operationId: "closure:unrelated-reserve",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["u2"] },
        requested: parseQuantity("1", "piece"),
        createdAtEpochMs: time2,
      })
    ).rejects.toThrow("cannot all be fulfilled");
    await expect(
      inventory.reservations.refine({
        reservationId: "c2",
        operationId: "closure:unrelated-refine",
        selector: { itemId: "item-a", placementNodeIds: ["u2"] },
        occurredAtEpochMs: time2,
      })
    ).rejects.toThrow("cannot all be fulfilled");
    await inventory.stock.issue({
      operationId: "closure:unrelated-issue",
      occurredAtEpochMs: time2,
      from: loosePosition("u2"),
      amount: stockAmount("1", "piece"),
    });
    expect(await inventory.read.positions(selector)).toMatchObject([{ measurements: { primary: { quantity: parseQuantity("1", "piece") } } }]);
    const after = await inventory.read.world();
    expect(after.revision).toBe(before.revision + 2);
    expect(after.reservations).toEqual(before.reservations);
  });

  it("reports a disjoint placement shortfall without adding deficits outside either filter", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    await inventory.stock.receive({ operationId: "intersection-receipt", occurredAtEpochMs: time0,
      to: loosePosition("bin"), amount: stockAmount("1", "piece") });
    await inventory.placement.move({ operationId: "place-bin-in-scope", occurredAtEpochMs: time0, nodeId: "bin", into: "scope" });
    await inventory.reservations.reserve({
      operationId: "reserve-intersection", reservationId: "intersection", itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["bin"], withinPlacementNodeIds: ["scope"] },
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    });
    await inventory.placement.move({ operationId: "place-bin-elsewhere", occurredAtEpochMs: time2, nodeId: "bin", into: "outside" });
    for (const nodeId of ["unrelated-a", "unrelated-b"]) {
      await inventory.stock.issue({ operationId: `deficit-${nodeId}`, occurredAtEpochMs: time2,
        from: loosePosition(nodeId), amount: stockAmount(String(Number.MAX_SAFE_INTEGER), "piece") });
      expect(await inventory.read.positions({ itemId: "item-a", placementNodeIds: [nodeId] })).toMatchObject([{
        key: { placementNodeId: nodeId },
        measurements: { primary: { quantity: parseQuantity(String(-Number.MAX_SAFE_INTEGER), "piece") } },
      }]);
    }
    expect((await inventory.read.reservationFeasibility(time2)).groups).toMatchObject([{
      reservationIds: ["intersection"], shortage: parseQuantity("1", "piece"),
    }]);
  });

  it("rejects a forged release plan that changes an unrelated reservation row", async () => {
    const { inventory, storage } = await createReservationShortageFixture();
    const before = await inventory.read.world();

    await expect(
      commitInventoryOperation({
        catalog: createTabletCatalog(),
        storage,
        operationId: "closure:forged-release",
        intentFingerprint: "closure:forged-release:v1",
        clock: clockAt(time3),
        deficitPolicy: InventoryDeficitPolicy.Reject,
        /** Start from a real release, then forge an unrelated c1 terminal row. */
        plan: ({ world }) => {
          const valid = releaseInventoryReservation({
            book: world.reservations,
            operationId: "closure:forged-release",
            reservationId: "c2",
            occurredAtEpochMs: time2,
          });
          const first = valid.book.reservations.c1;
          if (first === undefined) throw new Error("Forged-plan fixture lost c1.");
          return {
            reservationId: "c2",
            reservationResult: {
              ...valid,
              book: {
                ...valid.book,
                reservations: {
                  ...valid.book.reservations,
                  c1: {
                    ...first,
                    status: InventoryReservationStatus.Released,
                    statusAtEpochMs: time2,
                    lastChangedAtEpochMs: time2,
                  },
                },
              },
            },
          };
        },
      })
    ).rejects.toThrow("changed or deleted an unrelated row");
    expect(await inventory.read.world()).toEqual(before);
    expect(await storage.readOperation("closure:forged-release")).toBeUndefined();
  });

  it("does not exempt a validated release bundled with a conserved physical event", async () => {
    const { inventory, storage } = await createReservationShortageFixture();
    const catalog = createTabletCatalog();
    const before = await inventory.read.world();

    await expect(
      commitInventoryOperation({
        catalog,
        storage,
        operationId: "closure:release-with-transfer",
        intentFingerprint: "closure:release-with-transfer:v1",
        clock: clockAt(time3),
        deficitPolicy: InventoryDeficitPolicy.Reject,
        /** Pair a valid close with a quantity-conserving event to prove event absence is required. */
        plan: ({ world }) => ({
          event: createInventoryTransferEvent({
            catalog,
            operationId: "closure:release-with-transfer",
            occurredAtEpochMs: time2,
            from: loosePosition("u2"),
            toPlacementNodeId: "u3",
            amount: stockAmount("1", "piece"),
          }),
          reservationResult: releaseInventoryReservation({
            book: world.reservations,
            operationId: "closure:release-with-transfer",
            reservationId: "c2",
            occurredAtEpochMs: time2,
          }),
          reservationId: "c2",
        }),
      })
    ).rejects.toThrow("cannot all be fulfilled");
    expect(await inventory.read.world()).toEqual(before);
    expect(
      await storage.readOperation("closure:release-with-transfer")
    ).toBeUndefined();
  });

  it("caps fulfillableBound per shared indivisible row so exact shortages do not exhaust the state limit", async () => {
    const item = defineScalarInventoryItem({ itemId: "shared-pack", revisionId: "shared-pack-v1", axisId: "pieces", unit: "piece" });
    const pair = defineScalarInventoryPackaging({ revisionId: "shared-pair", item, packageUnit: "box", contains: "2" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { "shared-pack": item.revisionId }, packagingRevisions: [pair],
    });
    const inventory = createTestInventory(undefined, catalog);
    const store = { itemId: item.itemId, placementNodeId: "store" };
    await inventory.stock.receiveMany({
      operationId: "shared-row-receive",
      occurredAtEpochMs: time0,
      lines: [
        { to: { ...store, lotId: "shared-a" }, amount: packageAmount(25, pair.revisionId) },
        { to: { ...store, lotId: "shared-b" }, amount: packageAmount(25, pair.revisionId) },
        { to: { ...store, lotId: "spare" }, amount: packageAmount(100, pair.revisionId) },
        { to: { ...store, lotId: "loose" }, amount: stockAmount("1", "piece") },
      ],
    });
    // Start feasible with 50 pieces in each shared lot, while 5 broad claims each request 10.
    for (const lotId of ["shared-a", "shared-b"]) {
      for (let index = 0; index < 5; index += 1) {
        const reservationId = `${lotId}-claim-${index}`;
        await inventory.reservations.reserve({
          operationId: `reserve-${reservationId}`,
          reservationId,
          itemRevisionId: item.revisionId,
          selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: [lotId] },
          requested: parseQuantity("10", "piece"),
          createdAtEpochMs: time1,
        });
      }
    }
    await inventory.reservations.reserve({
      operationId: "reserve-spare-claim",
      reservationId: "spare-claim",
      itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["spare", "loose"] },
      requested: parseQuantity("21", "piece"),
      createdAtEpochMs: time1,
    });
    // Reduce shared-a to 18 pieces and shared-b to 20 pieces so both shared rows enter an exact shortage.
    await inventory.stock.issue({
      operationId: "issue-shared-a-packs",
      occurredAtEpochMs: time2,
      from: { ...store, lotId: "shared-a", packagingRevisionId: pair.revisionId },
      amount: packageAmount(16, pair.revisionId),
    });
    await inventory.stock.issue({
      operationId: "issue-shared-b-packs",
      occurredAtEpochMs: time2,
      from: { ...store, lotId: "shared-b", packagingRevisionId: pair.revisionId },
      amount: packageAmount(15, pair.revisionId),
    });

    const report = await inventory.read.reservationFeasibility(time2);
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Shortage);
    expect(report.groups).toMatchObject([{
      requested: parseQuantity("121", "piece"),
      fulfillable: parseQuantity("59", "piece"),
      shortage: parseQuantity("62", "piece"),
    }]);
  });

  it("caps multi-claim simultaneous indivisible shortage via flow bound before searching large lots", async () => {
    const item = defineScalarInventoryItem({ itemId: "flow-pack", revisionId: "flow-pack-v1", axisId: "pieces", unit: "piece" });
    const pair = defineScalarInventoryPackaging({ revisionId: "flow-pair", item, packageUnit: "box", contains: "2" });
    const quad = defineScalarInventoryPackaging({ revisionId: "flow-quad", item, packageUnit: "case", contains: "4" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { "flow-pack": item.revisionId }, packagingRevisions: [pair, quad],
    });
    const inventory = createTestInventory(undefined, catalog);
    const store = { itemId: item.itemId, placementNodeId: "store" };
    await inventory.stock.receiveMany({
      operationId: "flow-bound-receive",
      occurredAtEpochMs: time0,
      lines: [
        { to: { ...store, lotId: "X1" }, amount: packageAmount(1, pair.revisionId) },
        { to: { ...store, lotId: "X2" }, amount: packageAmount(1, pair.revisionId) },
        { to: { ...store, lotId: "Z" }, amount: packageAmount(2, pair.revisionId) },
        { to: { ...store, lotId: "Y" }, amount: packageAmount(100001, quad.revisionId) },
      ],
    });
    await inventory.reservations.reserve({
      operationId: "flow-reserve-a",
      reservationId: "claim-a",
      itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["X1", "X2"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      operationId: "flow-reserve-b",
      reservationId: "claim-b",
      itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["Z"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      operationId: "flow-reserve-c",
      reservationId: "claim-c",
      itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["Z"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      operationId: "flow-reserve-d",
      reservationId: "claim-d",
      itemRevisionId: item.revisionId,
      selector: { itemId: item.itemId, placementNodeIds: ["store"], lotIds: ["Y"] },
      requested: parseQuantity("400004", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.stock.issue({
      operationId: "flow-bound-issue-z",
      occurredAtEpochMs: time2,
      from: { ...store, lotId: "Z", packagingRevisionId: pair.revisionId },
      amount: packageAmount(1, pair.revisionId),
    });

    const report = await inventory.read.reservationFeasibility(time2);
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Shortage);
    expect(report.groups).toMatchObject([{
      requested: parseQuantity("400010", "piece"),
      fulfillable: parseQuantity("400008", "piece"),
      shortage: parseQuantity("2", "piece"),
    }]);
  });
});
