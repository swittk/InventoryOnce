import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  InventoryCountStatus,
  InventoryDeficitPolicy,
  InventoryOptionalIdentityConstraintKind,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  InventoryTrackingRequirement,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  InventoryStorageWriteStage,
} from "../src/storage-api.js";
import { inventoryReservationsAt } from "../src/reservations.js";
import { inventoryStockPositionIdentity } from "../src/model.js";
import { projectInventoryEvents } from "../src/projection.js";
import { replayEffectiveStockAge } from "../src/stock-age.js";
import {
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
  "TRACE-RESERVATION-EXACT-ISSUE-SCRAP",
] as const;

describe("broad reservations and physical truth", () => {
  it("uses current claim rows without replaying lifecycle history", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "current-reservation-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "current-reservation",
      operationId: "current-reservation-create",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.release({
      reservationId: "current-reservation",
      operationId: "current-reservation-release",
      occurredAtEpochMs: time2,
    });
    const book = (await inventory.read.world()).reservations;
    const guardedOperations = new Proxy(book.operations, {
      /** Fail if the current-state fast path touches retained lifecycle history. */
      ownKeys(): never {
        throw new Error("Current reservation read replayed operation history.");
      },
    });

    expect(
      inventoryReservationsAt({ ...book, operations: guardedOperations }, time3)
    ).toEqual([
      expect.objectContaining({
        reservationId: "current-reservation",
        status: InventoryReservationStatus.Released,
      }),
    ]);
    expect(inventoryReservationsAt(book, time1)).toEqual([
      expect.objectContaining({
        reservationId: "current-reservation",
        status: InventoryReservationStatus.Active,
      }),
    ]);
  });
  it("keeps a globally feasible broad/exact claim set and blocks the allocated-u2/refine-to-u1 bug", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-u1",
      occurredAtEpochMs: time0,
      to: loosePosition("u1"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-u2",
      occurredAtEpochMs: time0,
      to: loosePosition("u2"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-broad",
      operationId: "reserve-broad",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "claim-u1",
      operationId: "reserve-u1",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["u1"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const u2 = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["u2"],
      })
    )[0];
    if (u2 === undefined) throw new Error("Test stock u2 disappeared.");
    await inventory.reservations.allocate({
      operationId: "allocate-broad-u2",
      reservationId: "claim-broad",
      occurredAtEpochMs: time2,
      allocations: [
        { position: u2.key, quantity: parseQuantity("1", "piece") },
      ],
    });

    await expect(
      inventory.reservations.refine({
        operationId: "refine-bound-claim",
        reservationId: "claim-broad",
        selector: { itemId: "item-a", placementNodeIds: ["u1"] },
        occurredAtEpochMs: time3,
      })
    ).rejects.toThrow("outside the declared selector");
    const report = await inventory.read.reservationFeasibility();
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Feasible);
    expect(report.groups[0]).toMatchObject({
      reservationIds: ["claim-broad", "claim-u1"],
      requested: { amountMinor: 2, unit: "piece" },
      fulfillable: { amountMinor: 2, unit: "piece" },
      shortage: { amountMinor: 0, unit: "piece" },
    });
  });

  it("persists subtree-to-descendant reservation refinement through the durable plan", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-subtree-refine-stock",
      occurredAtEpochMs: time0,
      to: loosePosition("child-node"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "place-child-under-root",
      occurredAtEpochMs: time0,
      nodeId: "child-node",
      into: "root-node",
    });
    await inventory.reservations.reserve({
      reservationId: "subtree-refine-claim",
      operationId: "reserve-subtree-refine",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        withinPlacementNodeIds: ["root-node"],
      },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });

    await expect(
      inventory.reservations.refine({
        operationId: "refine-subtree-to-child",
        reservationId: "subtree-refine-claim",
        selector: {
          itemId: "item-a",
          placementNodeIds: ["child-node"],
        },
        occurredAtEpochMs: time2,
      })
    ).resolves.toBeDefined();

    expect(await inventory.read.reservation("subtree-refine-claim")).toMatchObject({
      selector: {
        itemId: "item-a",
        placementNodeIds: ["child-node"],
      },
    });
  });

  it("backs recorded deficit before exact claims without crossing locations", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "reservation-record-deficit",
      occurredAtEpochMs: time0,
      from: loosePosition("store", { lotId: "__untracked__" }),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.receiveMany({
      operationId: "reservation-receive-after-deficit",
      occurredAtEpochMs: time1,
      lines: [
        {
          to: loosePosition("store", { lotId: "SUPPORT" }),
          amount: stockAmount("3", "piece"),
        },
        {
          to: loosePosition("store", { lotId: "EXACT" }),
          amount: stockAmount("7", "piece"),
        },
        {
          to: loosePosition("room", { lotId: "ROOM" }),
          amount: stockAmount("4", "piece"),
        },
      ],
    });

    await expect(
      inventory.reservations.reserve({
        reservationId: "too-much-exact",
        operationId: "reserve-too-much-exact",
        itemRevisionId: "item-a-v2",
        selector: {
          itemId: "item-a",
          placementNodeIds: ["store"],
          lotIds: ["EXACT"],
        },
        requested: parseQuantity("6", "piece"),
        createdAtEpochMs: time2,
      })
    ).rejects.toThrow("cannot all be fulfilled");

    await inventory.reservations.reserve({
      reservationId: "store-five",
      operationId: "reserve-store-five",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        placementNodeIds: ["store"],
        lotIds: ["EXACT"],
      },
      requested: parseQuantity("5", "piece"),
      createdAtEpochMs: time2,
    });
    await inventory.reservations.reserve({
      reservationId: "room-four",
      operationId: "reserve-room-four",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        placementNodeIds: ["room"],
        lotIds: ["ROOM"],
      },
      requested: parseQuantity("4", "piece"),
      createdAtEpochMs: time2,
    });

    const report = await inventory.read.reservationFeasibility();
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Feasible);
    expect(report.groups[0]).toMatchObject({
      requested: { amountMinor: 9 },
      fulfillable: { amountMinor: 9 },
      shortage: { amountMinor: 0 },
    });
  });

  it("records ordinary issue and unrelated receipt while retaining a short claim", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-three",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("3", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-two",
      operationId: "reserve-two",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.stock.issue({
      operationId: "ordinary-issue-two",
      occurredAtEpochMs: time2,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "unrelated-receipt-during-shortage",
      occurredAtEpochMs: time3,
      to: loosePosition("other-store"),
      amount: stockAmount("2", "piece"),
    });

    const report = await inventory.read.reservationFeasibility();
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Shortage);
    expect(report.groups[0]).toMatchObject({
      reservationIds: ["claim-two"],
      requested: { amountMinor: 2 },
      fulfillable: { amountMinor: 1 },
      shortage: { amountMinor: 1 },
    });
  });

  it("recovers a staged issue with a short claim as one exact physical fact", async () => {
    /** Trigger one interruption after the issue receipt was staged and before publication. */
    let interrupted = false;
    const storage = createInMemoryInventoryDurableStorage({
      failpoint: ({ stage, timing, operationId }) => {
        if (operationId === "record-held-issue" &&
            stage === InventoryStorageWriteStage.Receipt &&
            timing === "after" && !interrupted) {
          interrupted = true;
          throw new Error("issue publication interrupted");
        }
      },
    });
    const inventory = createTestInventory(storage);
    const position = loosePosition("store");
    await inventory.stock.receive({
      operationId: "receive-before-interrupted-issue", occurredAtEpochMs: time0,
      to: position, amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      operationId: "reserve-before-interrupted-issue", reservationId: "held",
      itemRevisionId: "item-a-v2", selector: { itemId: "item-a" },
      requested: parseQuantity("2", "piece"), createdAtEpochMs: time1,
    });
    const before = await inventory.read.world();
    /** Retry this exact physical issue through a new facade over the retained staged adapter. */
    const issue = {
      operationId: "record-held-issue", occurredAtEpochMs: time2,
      from: position, amount: stockAmount("1", "piece"),
    };
    await expect(inventory.stock.issue(issue)).rejects.toThrow("issue publication interrupted");
    expect(await inventory.read.world()).toEqual(before);

    const restarted = createTestInventory(storage);
    const recovered = await restarted.stock.issue(issue);
    expect(recovered.replayed).toBe(true);
    expect(await restarted.stock.issue(issue)).toEqual(recovered);
    expect(recovered.receipt.worldRevision).toBe(before.revision + 1);
    expect((await restarted.read.world()).reservations).toEqual(before.reservations);
    expect((await restarted.read.reservationFeasibility(time2)).groups[0]?.shortage)
      .toEqual(parseQuantity("1", "piece"));
    await expect(restarted.stock.issue({ ...issue, amount: stockAmount("2", "piece") }))
      .rejects.toThrow("changed intent");
    expect((await restarted.read.world()).revision).toBe(before.revision + 1);
  });

  it("keeps count lifecycle usable through an existing shortage and records further physical loss", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "count-shortage-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "count-shortage-claim",
      operationId: "count-shortage-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("2", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.stock.scrap({
      operationId: "count-shortage-scrap",
      occurredAtEpochMs: time2,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      reason: "Observed physical loss creates an existing shortage.",
    });
    expect((await inventory.read.reservationFeasibility()).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );

    await inventory.counts.start({
      countId: "count-during-shortage",
      operationId: "count-during-shortage:start",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      startedAtEpochMs: time2,
    });
    const position = (
      await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["store"] })
    )[0];
    if (position === undefined) throw new Error("Expected remaining shortage stock.");
    await inventory.counts.observe({
      operationId: "count-during-shortage:observe",
      countId: "count-during-shortage",
      observedAtEpochMs: time2,
      observations: [
        {
          position: position.key,
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const abandoned = await inventory.counts.abandon({
      operationId: "count-during-shortage:abandon",
      countId: "count-during-shortage",
      occurredAtEpochMs: time2,
      reason: "Metadata-only count lifecycle remains usable during shortage.",
    });
    expect(abandoned.count.status).toBe(InventoryCountStatus.Abandoned);

    const replaced = await inventory.counts.replaceAbsolute({
      countId: "absolute-loss-during-shortage",
      operationId: "absolute-loss-during-shortage",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      occurredAtEpochMs: time2,
      reason: "The remaining piece was also physically absent.",
    });
    expect(
      replaced.event?.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(-1);
    const report = await inventory.read.reservationFeasibility();
    expect(report.status).toBe(InventoryReservationFeasibilityStatus.Shortage);
    expect(report.groups[0]).toMatchObject({
      reservationIds: ["count-shortage-claim"],
      requested: { amountMinor: 2 },
      fulfillable: { amountMinor: 0 },
      shortage: { amountMinor: 2 },
    });
  });

  it("consumes one exact allocated claim and physical issue together exactly once", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-for-consume",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-consume",
      operationId: "reserve-consume",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const position = (await inventory.read.positions({ itemId: "item-a" }))[0];
    if (position === undefined)
      throw new Error("Expected reservation stock disappeared.");
    await inventory.reservations.allocate({
      operationId: "allocate-consume",
      reservationId: "claim-consume",
      allocations: [
        { position: position.key, quantity: parseQuantity("1", "piece") },
      ],
      occurredAtEpochMs: time1,
    });
    const consumeCommand = {
      operationId: "consume-claim",
      reservationId: "claim-consume",
      occurredAtEpochMs: time2,
      reason: "The reserved piece was used.",
      fulfillment: [{ from: position.key, amount: stockAmount("1", "piece") }],
    };
    const consumed = await inventory.reservations.consume(consumeCommand);
    const replayed = await inventory.reservations.consume(consumeCommand);
    expect(consumed.reservation.status).toBe(
      InventoryReservationStatus.Consumed
    );
    expect(consumed.event?.kind).toBe("issue");
    expect(replayed.replayed).toBe(true);
    await expect(
      inventory.reservations.consume({
        ...consumeCommand,
        reason: "Changed retry reason.",
      })
    ).rejects.toThrow("changed intent");
    const remaining = await inventory.read.positions({ itemId: "item-a" });
    expect(remaining[0]?.measurements.primary.quantity.amountMinor).toBe(1);
  });
});

describe("snapshot, observation, and movement-safe count reconciliation", () => {
  it("validates subtree-scoped observation and absolute count positions through placement ancestry", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "subtree-count-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("count-child"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.placement.move({
      operationId: "subtree-count-place-child",
      occurredAtEpochMs: time0,
      nodeId: "count-child",
      into: "count-root",
    });
    const position = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["count-child"],
      })
    )[0];
    if (position === undefined) throw new Error("Expected subtree count stock.");

    await inventory.counts.start({
      countId: "subtree-observation-count",
      operationId: "subtree-observation-count:start",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        withinPlacementNodeIds: ["count-root"],
      },
      startedAtEpochMs: time1,
    });
    const observed = await inventory.counts.observe({
      operationId: "subtree-observation-count:observe",
      countId: "subtree-observation-count",
      observedAtEpochMs: time1,
      observations: [
        {
          position: position.key,
          measurements: position.measurements,
        },
      ],
    });
    expect(observed.count.status).toBe(InventoryCountStatus.Observed);
    await inventory.counts.abandon({
      operationId: "subtree-observation-count:abandon",
      countId: "subtree-observation-count",
      occurredAtEpochMs: time2,
      reason: "Close subtree validation count.",
    });

    const absolute = await inventory.counts.replaceAbsolute({
      countId: "subtree-absolute-count",
      operationId: "subtree-absolute-count",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        withinPlacementNodeIds: ["count-root"],
      },
      observedMeasurements: position.measurements,
      occurredAtEpochMs: time2,
    });
    expect(absolute.count.status).toBe(InventoryCountStatus.Completed);
  });

  it("applies observed-minus-expected discrepancy without erasing later movement", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "count-receive-ten",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("10", "piece"),
    });
    await inventory.counts.start({
      countId: "count-a",
      operationId: "count-start",
      selector: { itemId: "item-a", placementNodeIds: ["a"] },
      startedAtEpochMs: time0,
    });
    await inventory.stock.transfer({
      operationId: "move-before-observation",
      occurredAtEpochMs: time1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("2", "piece"),
    });
    const aAtObservation = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["a"],
      })
    )[0];
    if (aAtObservation === undefined)
      throw new Error("Expected count position disappeared.");
    await inventory.counts.observe({
      operationId: "count-observe",
      countId: "count-a",
      observedAtEpochMs: time1,
      observations: [
        {
          position: aAtObservation.key,
          measurements: {
            primary: {
              axisId: "pieces",
              quantity: parseQuantity("7", "piece"),
            },
            independent: [],
          },
        },
      ],
    });
    await inventory.stock.transfer({
      operationId: "move-after-observation",
      occurredAtEpochMs: time2,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    });
    const reconciled = await inventory.counts.reconcile({
      operationId: "count-reconcile",
      countId: "count-a",
      completedAtEpochMs: time3,
      reason: "One piece was missing at observation.",
    });

    expect(reconciled.count.status).toBe(InventoryCountStatus.Completed);
    expect(
      reconciled.event?.stockEffects[0]?.measurementsDelta.primary.quantity
        .amountMinor
    ).toBe(-1);
    const positions = await inventory.read.positions({ itemId: "item-a" });
    expect(
      positions.map((row) => [
        row.key.placementNodeId,
        row.measurements.primary.quantity.amountMinor,
      ])
    ).toEqual([
      ["a", 6],
      ["b", 3],
    ]);
  });

  it.each([InventoryDeficitPolicy.Record, InventoryDeficitPolicy.Reject])("reconciles when a backdated contents move precedes its source receipt (%s)", async (policy) => {
    const inventory = createTestInventory(undefined, undefined, undefined, policy);
    const selector = { itemId: "item-a", placementNodeIds: ["destination"] };
    const countId = "contents-count";
    await inventory.counts.start({ countId, operationId: "start-contents-count", selector, startedAtEpochMs: time0 });
    await inventory.stock.receive({
      operationId: "receive-contents", occurredAtEpochMs: time2,
      to: loosePosition("source"), amount: stockAmount("2", "piece"),
    });
    const move = await inventory.placement.moveContents({
      operationId: "move-contents-before-receipt", occurredAtEpochMs: time1, nodeId: "source", into: "destination",
    });
    expect(move.event.positiveLayerProvenanceTransfers).toHaveLength(1);
    const [arrival] = await inventory.read.positions(selector);
    if (arrival === undefined) throw new Error("Expected the contents arrival.");
    await inventory.counts.observe({
      countId, operationId: "observe-contents-count", observedAtEpochMs: time1,
      observations: [{
        position: arrival.key,
        measurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
      }],
    });
    const result = await inventory.counts.reconcile({
      countId, operationId: "reconcile-contents-count", completedAtEpochMs: time3, reason: "One piece was missing.",
    });
    expect(result.count.status).toBe(InventoryCountStatus.Completed);
    expect(result.event?.stockEffects).toMatchObject([
      { position: arrival.key, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
    ]);
  });

  it.each([
    { earlierParent: undefined, countLocation: "destination" },
    { earlierParent: "older-bin", countLocation: "destination" },
    { earlierParent: "destination", countLocation: "destination" },
    { earlierParent: undefined, countLocation: "unrelated" },
  ])("reconciles a retained child move from $earlierParent while counting $countLocation", async ({ earlierParent, countLocation }) => {
    for (const policy of [InventoryDeficitPolicy.Record, InventoryDeficitPolicy.Reject]) {
      for (const canonical of [false, true]) {
        const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
        const inventory = createTestInventory(storage, undefined, undefined, policy);
        for (const location of ["child", "unrelated"]) await inventory.stock.receive({
          operationId: `receive-${location}`, occurredAtEpochMs: time0,
          to: loosePosition(location), amount: stockAmount("2", "piece"),
        });
        if (earlierParent !== undefined) await inventory.placement.move({
          operationId: "place-early", occurredAtEpochMs: time0, nodeId: "child", into: earlierParent,
        });
        const selector = { itemId: "item-a", withinPlacementNodeIds: [countLocation] };
        const countId = "child-count";
        await inventory.counts.start({ countId, operationId: "start-child-count", selector, startedAtEpochMs: time0 });
        await inventory.placement.move({ operationId: "place-late", occurredAtEpochMs: time2, nodeId: "child", into: "source" });
        const moved = await inventory.placement.moveContents({
          operationId: "move-child-contents", occurredAtEpochMs: time1, nodeId: "source", into: "destination",
        });
        expect(moved.event.placementChanges).toEqual([{ nodeId: "child", fromParentNodeId: "source", toParentNodeId: "destination" }]);
        const [position] = await inventory.read.positions(selector);
        if (position === undefined) throw new Error("Expected stock in the counted subtree.");
        await inventory.counts.observe({
          countId, operationId: "observe-child-count", observedAtEpochMs: time1,
          observations: [{
            position: position.key,
            measurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
          }],
        });
        const command = { countId, operationId: "reconcile-child-count", completedAtEpochMs: time3, reason: "One piece was missing." };
        const result = await inventory.counts.reconcile(command);
        expect(result.count.status).toBe(InventoryCountStatus.Completed);
        expect(result.event?.stockEffects).toMatchObject([
          { position: position.key, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
        ]);
        expect(await inventory.counts.reconcile(command)).toMatchObject({ replayed: true });
        expect(await inventory.read.placementAncestry("child")).toEqual(["child", "destination"]);
      }
    }
  });

  it("reconciles a mixed transfer when the occurrence cut excludes its source receipt", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const selector = { itemId: "item-a", placementNodeIds: ["destination"] };
    await inventory.counts.start({
      countId: "mixed-transfer-count", operationId: "start-mixed-transfer-count", selector,
      startedAtEpochMs: time0,
    });
    await inventory.stock.receive({
      operationId: "later-source-receipt", occurredAtEpochMs: time2,
      to: loosePosition("source"), amount: stockAmount("1", "piece"),
    });
    const moved = await inventory.stock.transfer({
      operationId: "backdated-mixed-transfer", occurredAtEpochMs: time1,
      from: loosePosition("source"), toPlacementNodeId: "destination", amount: stockAmount("2", "piece"),
    });
    expect(moved.event.positiveLayerProvenanceTransfers).toHaveLength(1);
    expect(moved.event.unwitnessedStockMovements).toMatchObject([
      { measurements: { primary: { quantity: parseQuantity("1", "piece") } } },
    ]);
    const [arrival] = await inventory.read.positions(selector);
    if (arrival === undefined) throw new Error("Expected the mixed transfer arrival.");
    await inventory.counts.observe({
      countId: "mixed-transfer-count", operationId: "observe-mixed-transfer-count", observedAtEpochMs: time1,
      observations: [{
        position: arrival.key,
        measurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
      }],
    });
    await inventory.stock.receive({
      operationId: "post-observation-arrival", occurredAtEpochMs: time2,
      to: loosePosition("destination"), amount: stockAmount("3", "piece"),
    });
    const result = await inventory.counts.reconcile({
      countId: "mixed-transfer-count", operationId: "reconcile-mixed-transfer-count", completedAtEpochMs: time3,
      reason: "One transferred piece was missing at observation.",
    });
    expect(result.count.status).toBe(InventoryCountStatus.Completed);
    expect(result.event?.stockEffects).toMatchObject([
      { position: arrival.key, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
    ]);
    expect((await inventory.read.positions(selector)).map(({ measurements }) => measurements.primary.quantity))
      .toEqual([parseQuantity("4", "piece")]);
  });

  it.each([
    { includeReceipt: false, debt: 1 },
    { includeReceipt: false, debt: 2 },
    { includeReceipt: true, debt: 1 },
  ])("replays a loose arrival across a signed deficit ($includeReceipt, $debt)", async ({ includeReceipt, debt }) => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog, undefined, InventoryDeficitPolicy.Record);
    const from = loosePosition("source");
    const to = loosePosition("destination");
    const selector = { itemId: "item-a", placementNodeIds: ["destination"] };
    const amount = stockAmount("1", "piece");
    const countId = "arrival-count";
    const receipt = await inventory.stock.receive({ operationId: "receive-source", occurredAtEpochMs: time0, to: from, amount });
    const debtAmount = stockAmount(String(debt), "piece");
    const deficit = await inventory.stock.issue({ operationId: "record-destination-deficit", occurredAtEpochMs: time0, from: to, amount: debtAmount });
    await inventory.counts.start({ countId, operationId: "start-arrival-count", selector, startedAtEpochMs: time0 });
    const settled = await inventory.stock.receive({ operationId: "settle-destination", occurredAtEpochMs: time2, to, amount: debtAmount });
    const move = await inventory.placement.moveContents({
      operationId: "backdated-arrival", occurredAtEpochMs: time1, nodeId: "source", into: "destination",
    });
    expect(move.event.positiveLayerProvenanceTransfers).toMatchObject([{ from, to }]);
    const [arrival] = await inventory.read.positions(selector);
    if (arrival === undefined) throw new Error("Expected the contents arrival.");
    const world = await inventory.read.world();
    const arrivalAges = { [inventoryStockPositionIdentity(arrival.key)]: time0 };
    expect(world.projection.positiveLayerStartedAtEpochMsByPositionId).toEqual(arrivalAges);
    /** Replay the same committed contents route with or without the later receipt. */
    const retained = includeReceipt
      ? [receipt.event, deficit.event, settled.event, move.event]
      : [receipt.event, deficit.event, { ...move.event, recordSequence: 3 }];
    const cut = { catalog, events: retained, deficitPolicy: InventoryDeficitPolicy.Record, [replayEffectiveStockAge]: "occurrence-cut" };
    const projected = projectInventoryEvents(cut);
    const cutPieces = includeReceipt ? 1 : 1 - debt;
    expect(Object.values(projected.positions).map(({ key, measurements }) => [key, measurements.primary.quantity]))
      .toEqual(cutPieces === 0 ? [] : [[arrival.key, parseQuantity(String(cutPieces), "piece")]]);
    expect(projected.positiveLayerStartedAtEpochMsByPositionId).toEqual(includeReceipt ? arrivalAges : {});
    await inventory.counts.observe({
      countId, operationId: "observe-arrival-count", observedAtEpochMs: includeReceipt ? time2 : time1,
      observations: [{ position: arrival.key, measurements: arrival.measurements }],
    });
    const result = await inventory.counts.reconcile({
      countId, operationId: "reconcile-arrival-count", completedAtEpochMs: time3, reason: "Observed one piece.",
    });
    expect(result.count.status).toBe(InventoryCountStatus.Completed);
    if (includeReceipt) {
      expect(result.event).toBeUndefined();
    } else {
      expect(result.event?.stockEffects).toMatchObject([
        { position: arrival.key, measurementsDelta: { primary: { quantity: parseQuantity(String(debt), "piece") } } },
      ]);
    }
    expect((await inventory.read.positions(selector))[0]?.measurements.primary.quantity)
      .toEqual(parseQuantity(String(includeReceipt ? 1 : 1 + debt), "piece"));
  });

  it.each([false, true])("keeps a direct count independent of a backdated topology cycle (subtree: %s)", async (subtree) => {
    const inventory = createTestInventory();
    const position = { ...loosePosition(subtree ? "node-a" : "store"), itemRevisionId: "item-a-v2" };
    await inventory.stock.receive({
      operationId: "receive-count-stock", occurredAtEpochMs: time0, to: position, amount: stockAmount("2", "piece"),
    });
    await inventory.placement.move({ operationId: "nest-b", occurredAtEpochMs: time0, nodeId: "node-b", into: "node-a" });
    await inventory.placement.move({ operationId: "nest-a", occurredAtEpochMs: time0, nodeId: "node-a", into: "source" });
    await inventory.placement.unplace({
      operationId: "later-unplace-b", occurredAtEpochMs: time2, nodeId: "node-b", expectedParent: "node-a",
    });
    await inventory.placement.moveContents({
      operationId: "backdated-contents", occurredAtEpochMs: time1, nodeId: "source", into: "node-b",
    });
    const selector = subtree
      ? { itemId: position.itemId, withinPlacementNodeIds: ["node-b"] }
      : { itemId: position.itemId, placementNodeIds: ["store"] };
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time0 });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time1,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [],
      } }],
    });
    const reconcile = { operationId: "reconcile", countId: "count", completedAtEpochMs: time3 };
    if (subtree) {
      await expect(inventory.counts.reconcile(reconcile)).rejects.toThrow("Placement graph contains a cycle");
    } else {
      const result = await inventory.counts.reconcile(reconcile);
      expect(result.event?.stockEffects).toMatchObject([
        { position, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
      ]);
      expect((await inventory.counts.reconcile(reconcile)).replayed).toBe(true);
    }
    expect(await inventory.read.placementAncestry("node-a")).toEqual(["node-a", "node-b"]);
  });

  it.each([false, true])("checks backdated serial source age only for stock a count depends on (serial: %s)", async (countSerial) => {
    const item = defineScalarInventoryItem({ itemId: "ordinary", revisionId: "ordinary-v1", axisId: "pieces", unit: "piece" });
    const serial = defineScalarInventoryItem({
      itemId: "serialized", revisionId: "serialized-v1", axisId: "pieces", unit: "piece",
      tracking: { lot: InventoryTrackingRequirement.Forbidden, serial: InventoryTrackingRequirement.Required },
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item, serial], activeItemRevisionIds: { ordinary: item.revisionId, serialized: serial.revisionId },
    });
    const inventory = createInventoryOnce({
      catalog, storage: createInMemoryInventoryDurableStorage(), clock: { nowEpochMs: () => time3 },
    });
    const from = { itemId: serial.itemId, placementNodeId: "origin", serialId: "serial-1" };
    await inventory.stock.receive({ operationId: "later-receipt", occurredAtEpochMs: time2, to: from, amount: stockAmount("1", "piece") });
    await inventory.stock.transfer({
      operationId: "backdated-serial-move", occurredAtEpochMs: time1, from, toPlacementNodeId: "destination", amount: stockAmount("1", "piece"),
    });
    const position = countSerial
      ? { ...from, itemRevisionId: serial.revisionId, placementNodeId: "destination" }
      : { itemId: item.itemId, itemRevisionId: item.revisionId, placementNodeId: "store" };
    if (!countSerial) {
      await inventory.stock.receive({
        operationId: "receive-ordinary", occurredAtEpochMs: time0, to: position, amount: stockAmount("2", "piece"),
      });
    }
    const selector = { itemId: position.itemId, placementNodeIds: [position.placementNodeId] };
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time0 });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time1,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [],
      } }],
    });
    const reconcile = { operationId: "reconcile", countId: "count", completedAtEpochMs: time3 };
    if (countSerial) {
      await expect(inventory.counts.reconcile(reconcile)).rejects.toThrow("is not currently positive");
    } else {
      const result = await inventory.counts.reconcile(reconcile);
      expect(result.event?.stockEffects).toMatchObject([
        { position, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
      ]);
      expect((await inventory.counts.reconcile(reconcile)).replayed).toBe(true);
    }
    expect(await inventory.read.positions({ itemId: serial.itemId, placementNodeIds: ["destination"] })).toHaveLength(1);
  });

  it.each(["receipt", "issue"] as const)("reconciles a backdated correction when a later %s changes the live FIFO layer", async (later) => {
    const inventory = createTestInventory();
    const from = loosePosition("store");
    const position = { ...from, itemRevisionId: "item-a-v2" };
    const selector = { itemId: position.itemId, placementNodeIds: ["store"] };
    const receipt = await inventory.stock.receive({
      operationId: "original-receipt", occurredAtEpochMs: time0, to: from, amount: stockAmount("3", "piece"),
    });
    await inventory.counts.start({
      countId: "corrected-cut", operationId: "start-corrected-cut", selector, startedAtEpochMs: time0,
    });
    if (later === "receipt") {
      await inventory.stock.receive({
        operationId: "later-receipt", occurredAtEpochMs: time2, to: from, amount: stockAmount("3", "piece"),
      });
    } else {
      await inventory.stock.issue({
        operationId: "later-issue", occurredAtEpochMs: time2, from, amount: stockAmount("2", "piece"),
      });
    }
    const correction = await inventory.stock.correct({
      operationId: "correct-original-receipt", occurredAtEpochMs: time1, correctsEventId: receipt.event.eventId,
      reason: "Correct the original physical receipt.",
      replaceWith: (plans) => later === "receipt"
        ? plans.omit()
        : plans.receive({ occurredAtEpochMs: time0, to: from, amount: stockAmount("2", "piece") }),
    });
    expect(correction.event.positiveLayerProvenanceOverrides).toHaveLength(1);
    expect(correction.event.positiveLayerProvenanceOverrides?.[0]?.startedAtEpochMs)
      .toBe(later === "receipt" ? time2 : undefined);
    await inventory.counts.observe({
      countId: "corrected-cut", operationId: "observe-corrected-cut", observedAtEpochMs: time1,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity(later === "receipt" ? "1" : "3", "piece") },
        independent: [],
      } }],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "corrected-cut", operationId: "reconcile-corrected-cut", completedAtEpochMs: time3,
    });
    expect(reconciled.count.status).toBe(InventoryCountStatus.Completed);
    expect(reconciled.event?.stockEffects).toMatchObject([
      { position, measurementsDelta: { primary: { quantity: parseQuantity("1", "piece") } } },
    ]);
    expect((await inventory.read.positions(selector)).map(({ measurements }) => measurements.primary.quantity))
      .toEqual([parseQuantity(later === "receipt" ? "4" : "1", "piece")]);
  });

  it("retains correction supersession predecessors in occurrence-time count replay", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "count-correction-root",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("10", "piece"),
    });
    await inventory.counts.start({
      countId: "count-correction-cut",
      operationId: "count-correction-cut-start",
      selector: { itemId: "item-a", placementNodeIds: ["a"] },
      startedAtEpochMs: time0,
    });
    await inventory.stock.correct({
      operationId: "count-correction-later-occurrence",
      occurredAtEpochMs: time3,
      correctsEventId: original.event.eventId,
      reason: "First retained correction was recorded with a later occurrence time.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("a"),
          amount: stockAmount("7", "piece"),
        }),
    });
    await inventory.stock.correct({
      operationId: "count-correction-earlier-occurrence",
      occurredAtEpochMs: time1,
      correctsEventId: original.event.eventId,
      reason: "Later correction is the final retained meaning at observation time.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("a"),
          amount: stockAmount("8", "piece"),
        }),
    });
    const position = (
      await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["a"] })
    )[0];
    if (position === undefined) throw new Error("Expected corrected count position.");
    expect(position.measurements.primary.quantity.amountMinor).toBe(8);
    await inventory.counts.observe({
      operationId: "count-correction-cut-observe",
      countId: "count-correction-cut",
      observedAtEpochMs: time2,
      observations: [
        { position: position.key, measurements: position.measurements },
      ],
    });

    const reconciled = await inventory.counts.reconcile({
      operationId: "count-correction-cut-reconcile",
      countId: "count-correction-cut",
      completedAtEpochMs: time3,
      reason: "Observed quantity already matches the final correction meaning.",
    });

    expect(reconciled.count.status).toBe(InventoryCountStatus.Completed);
    expect(reconciled.event).toBeUndefined();
  });

  it("replaces one exact bucket through the native lifecycle and replays the complete intent", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "absolute-count-receive-ten",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("10", "piece"),
    });
    const command = {
      countId: "absolute-count-seven",
      operationId: "absolute-count-seven",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      observedMeasurements: {
        primary: {
          axisId: "pieces",
          quantity: parseQuantity("7", "piece"),
        },
        independent: [],
      },
      positionWhenEmpty: {
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        placementNodeId: "store",
        qualifiedDimensions: [],
      },
      occurredAtEpochMs: time1,
      reason: "Seven pieces were physically present.",
    };

    const replaced = await inventory.counts.replaceAbsolute(command);
    const replayed = await inventory.counts.replaceAbsolute(command);

    expect(replaced.count.status).toBe(InventoryCountStatus.Completed);
    expect(
      replaced.event?.stockEffects[0]?.measurementsDelta.primary.quantity
        .amountMinor
    ).toBe(-3);
    expect(replaced.count.selector.lot?.kind).toBe(
      InventoryOptionalIdentityConstraintKind.Absent
    );
    expect(replaced.count.selector.packagingRevision?.kind).toBe(
      InventoryOptionalIdentityConstraintKind.Absent
    );
    expect(replaced.count.selector.qualifiedDimensions).toEqual([
      {
        dimensionId: "grade",
        kind: InventoryOptionalIdentityConstraintKind.Absent,
      },
    ]);
    expect(replayed.replayed).toBe(true);
    await expect(
      inventory.counts.replaceAbsolute({
        ...command,
        observedMeasurements: {
          ...command.observedMeasurements,
          primary: {
            axisId: "pieces",
            quantity: parseQuantity("8", "piece"),
          },
        },
      })
    ).rejects.toThrow("changed intent");
    await expect(
      inventory.stock.receive({
        operationId: command.operationId,
        occurredAtEpochMs: time2,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow("changed intent");
    const positions = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["store"],
    });
    expect(positions[0]?.measurements.primary.quantity.amountMinor).toBe(7);
  });

  it("replays an absolute zero count after the exact bucket disappears", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "absolute-zero-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "LOT-ZERO" }),
      amount: stockAmount("2", "piece"),
    });
    const command = {
      countId: "absolute-zero",
      operationId: "absolute-zero",
      itemRevisionId: "item-a-v2",
      selector: {
        itemId: "item-a",
        placementNodeIds: ["store"],
        lotIds: ["LOT-ZERO"],
      },
      occurredAtEpochMs: time1,
      reason: "The lot bucket was physically empty.",
    };

    const replaced = await inventory.counts.replaceAbsolute(command);
    const replayed = await inventory.counts.replaceAbsolute(command);

    expect(
      replaced.event?.stockEffects[0]?.measurementsDelta.primary.quantity
        .amountMinor
    ).toBe(-2);
    expect(replayed.replayed).toBe(true);
    expect(
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["store"],
        lotIds: ["LOT-ZERO"],
      })
    ).toEqual([]);
  });

  it("resumes the native lifecycle after failure between start and observation", async () => {
    // One-shot flag controlling the simulated crash before the first observation write.
    let shouldFailObservation = true;
    const storage = createInMemoryInventoryDurableStorage({
      // Inject the one-shot observation failure while allowing the resumed attempt through.
      failpoint: ({ stage, timing, operationId }) => {
        if (
          shouldFailObservation &&
          operationId === "absolute-resume:observe" &&
          stage === InventoryStorageWriteStage.Begin &&
          timing === "before"
        ) {
          shouldFailObservation = false;
          throw new Error("simulated observation-stage crash");
        }
      },
    });
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "absolute-resume-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    const command = {
      countId: "absolute-resume",
      operationId: "absolute-resume",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["store"] },
      observedMeasurements: {
        primary: {
          axisId: "pieces",
          quantity: parseQuantity("3", "piece"),
        },
        independent: [],
      },
      occurredAtEpochMs: time2,
      reason: "Three pieces were physically present.",
    };

    await expect(inventory.counts.replaceAbsolute(command)).rejects.toThrow(
      "simulated observation-stage crash"
    );
    expect((await inventory.read.count(command.countId))?.status).toBe(
      InventoryCountStatus.Started
    );
    await inventory.stock.issue({
      operationId: "absolute-resume-remove-current-row",
      occurredAtEpochMs: time2,
      from: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });

    const resumed = await inventory.counts.replaceAbsolute(command);
    const replayed = await inventory.counts.replaceAbsolute(command);
    expect(resumed.count.status).toBe(InventoryCountStatus.Completed);
    expect(resumed.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(
      (
        await inventory.read.positions({
          itemId: "item-a",
          placementNodeIds: ["store"],
        })
      )[0]?.measurements.primary.quantity.amountMinor
    ).toBe(3);
  });

  it("rejects an ambiguous absolute-count scope before starting any count", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "absolute-ambiguous-receive",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("store", { lotId: "LOT-A" }),
          amount: stockAmount("1", "piece"),
        },
        {
          to: loosePosition("store", { lotId: "LOT-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    const revisionBefore = (await inventory.read.world()).revision;

    await expect(
      inventory.counts.replaceAbsolute({
        countId: "absolute-ambiguous",
        operationId: "absolute-ambiguous",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["store"] },
        observedMeasurements: {
          primary: {
            axisId: "pieces",
            quantity: parseQuantity("1", "piece"),
          },
          independent: [],
        },
        positionWhenEmpty: {
          itemId: "item-a",
          itemRevisionId: "item-a-v2",
          placementNodeId: "store",
          qualifiedDimensions: [],
        },
        occurredAtEpochMs: time1,
      })
    ).rejects.toThrow("more than one current stock position");
    expect(await inventory.read.count("absolute-ambiguous")).toBeUndefined();
    expect((await inventory.read.world()).revision).toBe(revisionBefore);
  });

  it("preflights invalid observations before publishing the start stage", async () => {
    const inventory = createTestInventory();
    const revisionBefore = (await inventory.read.world()).revision;

    await expect(
      inventory.counts.replaceAbsolute({
        countId: "absolute-invalid-observation",
        operationId: "absolute-invalid-observation",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["empty-store"] },
        observedMeasurements: {
          primary: {
            axisId: "pieces",
            quantity: parseQuantity("0", "piece"),
          },
          independent: [],
        },
        positionWhenEmpty: {
          itemId: "item-a",
          itemRevisionId: "item-a-v2",
          placementNodeId: "empty-store",
          qualifiedDimensions: [],
        },
        occurredAtEpochMs: time1,
      })
    ).rejects.toThrow("Omit zero count observation rows");
    expect(
      await inventory.read.count("absolute-invalid-observation")
    ).toBeUndefined();
    expect((await inventory.read.world()).revision).toBe(revisionBefore);
  });
});
