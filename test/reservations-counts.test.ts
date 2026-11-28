import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineInventoryPackaging,
  defineScalarInventoryItem,
  InventoryCountStatus,
  InventoryDeficitPolicy,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryOptionalIdentityConstraintKind,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  InventoryTrackingRequirement,
  inventoryMeasurementVector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  stockAmount,
  unitCode,
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

  it.each(["direct", "disjoint-subtree", "related-subtree"] as const)("checks topology only for the required placement history (%s)", async (scope) => {
    const inventory = createTestInventory();
    const position = { ...loosePosition(scope === "related-subtree" ? "node-a" : "store"), itemRevisionId: "item-a-v2" };
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
    const selector = scope === "direct"
      ? { itemId: position.itemId, placementNodeIds: ["store"] }
      : { itemId: position.itemId, withinPlacementNodeIds: [scope === "related-subtree" ? "node-b" : "store"] };
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time0 });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time1,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [],
      } }],
    });
    const reconcile = { operationId: "reconcile", countId: "count", completedAtEpochMs: time3 };
    if (scope === "related-subtree") {
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

  it.each(["other-item", "same-item", "missing-source", "valid-source"] as const)("checks backdated serial source age only for stock a count depends on (%s)", async (scope) => {
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
    await inventory.stock.receive({
      operationId: "source-receipt", occurredAtEpochMs: scope === "valid-source" ? time0 : time2, to: from, amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "backdated-serial-move", occurredAtEpochMs: time1, from, toPlacementNodeId: "destination", amount: stockAmount("1", "piece"),
    });
    const position = scope === "other-item"
      ? { itemId: item.itemId, itemRevisionId: item.revisionId, placementNodeId: "store" }
      : scope === "same-item"
        ? { itemId: serial.itemId, itemRevisionId: serial.revisionId, placementNodeId: "store", serialId: "serial-2" }
        : { ...from, itemRevisionId: serial.revisionId, placementNodeId: "destination" };
    if (scope === "other-item" || scope === "same-item") {
      await inventory.stock.receive({
        operationId: "receive-counted", occurredAtEpochMs: time0, to: position,
        amount: stockAmount(scope === "other-item" ? "2" : "1", "piece"),
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
    if (scope === "missing-source") {
      await expect(inventory.counts.reconcile(reconcile)).rejects.toThrow("is not currently positive");
    } else {
      const result = await inventory.counts.reconcile(reconcile);
      if (scope === "other-item") {
        expect(result.event?.stockEffects).toMatchObject([
          { position, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
        ]);
      } else {
        expect(result.event).toBeUndefined();
      }
      expect((await inventory.counts.reconcile(reconcile)).replayed).toBe(true);
    }
    expect(await inventory.read.positions({ itemId: serial.itemId, placementNodeIds: ["destination"] })).toHaveLength(1);
  });

  it("uses an embodied carrier's route to reconstruct the observed subtree", async () => {
    const carrier = defineScalarInventoryItem({
      itemId: "carrier", revisionId: "carrier-v1", axisId: "pieces", unit: "piece",
      tracking: { lot: InventoryTrackingRequirement.Forbidden, serial: InventoryTrackingRequirement.Optional },
    });
    const payload = defineScalarInventoryItem({ itemId: "payload", revisionId: "payload-v1", axisId: "pieces", unit: "piece" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [carrier, payload], activeItemRevisionIds: { carrier: carrier.revisionId, payload: payload.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog);
    const amount = stockAmount("1", "piece");
    const carrierOrigin = { itemId: carrier.itemId, placementNodeId: "origin" };
    await inventory.stock.receive({ operationId: "receive-carrier", occurredAtEpochMs: time0, to: carrierOrigin, amount });
    await inventory.stock.individualize({
      operationId: "individualize", occurredAtEpochMs: time0, from: carrierOrigin, amount,
      serialId: "cart", asPlacementNode: { category: "cart", acceptsPlacement: true },
    });
    const position = { itemId: payload.itemId, itemRevisionId: payload.revisionId, placementNodeId: "cart" };
    await inventory.stock.receive({
      operationId: "receive-payload", occurredAtEpochMs: time0, to: position, amount: stockAmount("2", "piece"),
    });
    const selector = { itemId: payload.itemId, withinPlacementNodeIds: ["count-root"] };
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time0 });
    await inventory.stock.transfer({
      operationId: "bring-cart", occurredAtEpochMs: time1, from: { ...carrierOrigin, serialId: "cart" },
      toPlacementNodeId: "count-root", amount,
    });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time1,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [],
      } }],
    });
    await inventory.stock.transfer({
      operationId: "take-cart", occurredAtEpochMs: time2, from: { ...carrierOrigin, placementNodeId: "count-root", serialId: "cart" },
      toPlacementNodeId: "later-room", amount,
    });
    const reconcile = { operationId: "reconcile", countId: "count", completedAtEpochMs: time3 };
    const result = await inventory.counts.reconcile(reconcile);
    expect(result.event?.stockEffects).toMatchObject([
      { position, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
    ]);
    expect(await inventory.read.placementAncestry("cart")).toEqual(["cart", "later-room"]);
    expect((await inventory.counts.reconcile(reconcile)).replayed).toBe(true);
  });

  it.each(["standalone", "embodied"] as const)("excludes a former %s node's payload from a subtree count", async (shape) => {
    const carrier = defineScalarInventoryItem({
      itemId: "carrier", revisionId: "carrier-v1", axisId: "pieces", unit: "piece",
      tracking: { lot: InventoryTrackingRequirement.Forbidden, serial: InventoryTrackingRequirement.Optional },
    });
    const payload = defineScalarInventoryItem({ itemId: "payload", revisionId: "payload-v1", axisId: "pieces", unit: "piece" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [carrier, payload], activeItemRevisionIds: { carrier: carrier.revisionId, payload: payload.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog);
    const one = stockAmount("1", "piece");
    const full = stockAmount(String(Number.MAX_SAFE_INTEGER), "piece");
    const former = { itemId: payload.itemId, placementNodeId: "child", lotId: "former" };
    if (shape === "standalone") {
      await inventory.placement.move({ operationId: "move-in", occurredAtEpochMs: time0, nodeId: "child", into: "root" });
    } else {
      const origin = { itemId: carrier.itemId, placementNodeId: "root" };
      await inventory.stock.receive({ operationId: "receive-carrier", occurredAtEpochMs: time0, to: origin, amount: one });
      await inventory.stock.individualize({
        operationId: "individualize", occurredAtEpochMs: time0, from: origin, amount: one,
        serialId: "child", asPlacementNode: { category: "cart" },
      });
    }
    await inventory.stock.receive({ operationId: "receive-former", occurredAtEpochMs: time0, to: former, amount: full });
    if (shape === "standalone") {
      await inventory.placement.move({ operationId: "move-out", occurredAtEpochMs: time1, nodeId: "child", into: "outside" });
    } else {
      await inventory.stock.transfer({
        operationId: "move-out", occurredAtEpochMs: time1,
        from: { itemId: carrier.itemId, placementNodeId: "root", serialId: "child" }, toPlacementNodeId: "outside", amount: one,
      });
    }
    await inventory.stock.issue({ operationId: "issue-former", occurredAtEpochMs: time3, from: former, amount: full });
    await inventory.stock.receive({ operationId: "late-former", occurredAtEpochMs: time2, to: former, amount: full });
    await inventory.stock.receive({
      operationId: "receive-counted", occurredAtEpochMs: time0,
      to: { itemId: payload.itemId, placementNodeId: "root", lotId: "counted" }, amount: one,
    });
    const selector = { itemId: payload.itemId, withinPlacementNodeIds: ["root"] };
    const [position] = await inventory.read.positions(selector);
    if (position === undefined) throw new Error("Expected stock at the counted root.");
    expect(position.key.lotId).toBe("counted");
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time1 });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time2,
      observations: [{ position: position.key, measurements: position.measurements }],
    });
    const reconcile = { operationId: "reconcile", countId: "count", completedAtEpochMs: time3 };
    expect((await inventory.counts.reconcile(reconcile)).event).toBeUndefined();
    expect((await inventory.counts.reconcile(reconcile)).replayed).toBe(true);
    expect(await inventory.read.placementAncestry("child")).toEqual(["child", "outside"]);
  });

  it("keeps a superseded correction with no placement effects in a subtree count", async () => {
    const inventory = createTestInventory();
    const original = await inventory.placement.move({
      operationId: "original-parent", occurredAtEpochMs: time0, nodeId: "child", into: "outside",
    });
    await inventory.stock.receive({
      operationId: "child-stock", occurredAtEpochMs: time0,
      to: loosePosition("child"), amount: stockAmount("2", "piece"),
    });
    const earlier = await inventory.stock.correct({
      operationId: "first-correction", occurredAtEpochMs: time3, correctsEventId: original.event.eventId,
      reason: "Confirm the recorded destination.",
      replaceWith: (plans) => plans.placement({ occurredAtEpochMs: time0, nodeId: "child", toParentNodeId: "outside" }),
    });
    expect(earlier.event.placementChanges ?? []).toEqual([]);
    const correction = await inventory.stock.correct({
      operationId: "supersede-correction", occurredAtEpochMs: time1, correctsEventId: original.event.eventId,
      reason: "Correct the recorded destination.",
      replaceWith: (plans) => plans.placement({ occurredAtEpochMs: time0, nodeId: "child", toParentNodeId: "root" }),
    });
    expect(correction.event.correction?.supersedesCorrectionEventId).toBe(earlier.event.eventId);
    const selector = { itemId: "item-a", withinPlacementNodeIds: ["root"] };
    await inventory.counts.start({
      countId: "count",
      operationId: "count-start",
      startedAtEpochMs: time2,
      selector,
    });
    await inventory.counts.observe({
      countId: "count",
      operationId: "count-observe",
      observedAtEpochMs: time2,
      observations: [
        {
          position: { ...loosePosition("child"), itemRevisionId: "item-a-v2" },
          measurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
        },
      ],
    });
    const result = await inventory.counts.reconcile({
      countId: "count",
      operationId: "count",
      completedAtEpochMs: time2,
    });
    expect(result.event?.stockEffects).toMatchObject([
      { position: loosePosition("child"), measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } },
    ]);
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

  it.each(["correction", "receipt"] as const)("places a late historical move before a later physical move despite an unrelated %s", async (intervening) => {
    const item = defineScalarInventoryItem({ itemId: "counted", revisionId: "counted-v1", axisId: "pieces", unit: "piece" });
    const other = defineScalarInventoryItem({ itemId: "other", revisionId: "other-v1", axisId: "pieces", unit: "piece" });
    const catalog = defineInventoryCatalog({
      itemRevisions: [item, other], activeItemRevisionIds: { counted: item.revisionId, other: other.revisionId },
    });
    const inventory = createTestInventory(undefined, catalog);
    const position = { itemId: item.itemId, itemRevisionId: item.revisionId, placementNodeId: "child" };
    const from = { itemId: other.itemId, placementNodeId: "store" };
    const one = stockAmount("1", "piece");
    await inventory.stock.receive({ operationId: "receive-counted", occurredAtEpochMs: time0, to: position, amount: one });
    const receipt = await inventory.stock.receive({
      operationId: "receive-other", occurredAtEpochMs: time0, to: from, amount: stockAmount("2", "piece"),
    });
    await inventory.placement.move({ operationId: "first-parent", occurredAtEpochMs: time0, nodeId: "child", into: "A" });
    await inventory.placement.move({ operationId: "last-parent", occurredAtEpochMs: time2, nodeId: "child", into: "B" });
    if (intervening === "correction") {
      await inventory.stock.correct({
        operationId: "other-correction", occurredAtEpochMs: time1, correctsEventId: receipt.event.eventId,
        reason: "Correct the unrelated receipt.",
        replaceWith: (plans) => plans.receive({ occurredAtEpochMs: time0, to: from, amount: one }),
      });
    } else {
      await inventory.stock.receive({ operationId: "other-receipt", occurredAtEpochMs: time1, to: from, amount: one });
    }
    await inventory.stock.recordHistorical({
      operationId: "historical-move", occurredAtEpochMs: time3, reason: "Record earlier movement.",
      assertions: [{ assertionId: "move-C", assert: (plans) => plans.placement({
        occurredAtEpochMs: time1, nodeId: "child", fromParentNodeId: "A", toParentNodeId: "C",
      }) }],
    });
    await inventory.counts.start({
      operationId: "start-earlier", countId: "earlier",
      selector: { itemId: item.itemId, withinPlacementNodeIds: ["A", "B"] }, startedAtEpochMs: time0,
    });
    await inventory.counts.observe({
      operationId: "observe-earlier", countId: "earlier", observedAtEpochMs: time1, observations: [],
    });
    const earlier = await inventory.counts.reconcile({
      operationId: "reconcile-earlier", countId: "earlier", completedAtEpochMs: time3,
    });
    expect(earlier.event).toBeUndefined();
    const selector = { itemId: item.itemId, withinPlacementNodeIds: ["B"] };
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: time0 });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: time3,
      observations: [{ position, measurements: {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [],
      } }],
    });
    const result = await inventory.counts.reconcile({ operationId: "reconcile", countId: "count", completedAtEpochMs: time3 });
    expect(result.event).toBeUndefined();
    expect(await inventory.read.placementAncestry("child")).toEqual(["child", "B"]);
  });

  it.each([false, true])("keeps unrelated loose quantities outside a count cut (same bin: %s)", async (sameBin) => {
    const inventory = createTestInventory();
    const position = loosePosition("counted", { lotId: "counted" });
    const unrelated = loosePosition(sameBin ? "counted" : "elsewhere", { lotId: "unrelated" });
    const one = stockAmount("1", "piece");
    const full = stockAmount(String(Number.MAX_SAFE_INTEGER), "piece");
    await inventory.stock.receive({ operationId: "counted", occurredAtEpochMs: time0, to: position, amount: one });
    await inventory.stock.receive({ operationId: "unrelated-first", occurredAtEpochMs: time0, to: unrelated, amount: full });
    await inventory.stock.issue({ operationId: "unrelated-issue", occurredAtEpochMs: time3, from: unrelated, amount: full });
    await inventory.stock.receive({ operationId: "unrelated-late", occurredAtEpochMs: time1, to: unrelated, amount: full });
    const command = {
      countId: "scope-count", operationId: "scope-count", itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["counted"], ...(sameBin ? { lotIds: ["counted"] } : {}) },
      observedMeasurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
      occurredAtEpochMs: time2,
    };
    expect((await inventory.counts.replaceAbsolute(command)).event).toBeUndefined();
    expect((await inventory.counts.replaceAbsolute(command)).replayed).toBe(true);
  });

  it.each([
    { canonical: false, structured: false }, { canonical: true, structured: false },
    { canonical: false, structured: true }, { canonical: true, structured: true },
  ])("bounds transfer funding to the last route that needs it (canonical: $canonical, structured: $structured)", async ({ canonical, structured }) => {
    for (const policy of [InventoryDeficitPolicy.Record, InventoryDeficitPolicy.Reject]) {
      const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
      const inventory = createTestInventory(storage, undefined, undefined, policy);
      const source = loosePosition("funding-source", { lotId: "FUNDING" });
      const relay = loosePosition("funding-relay", { lotId: "FUNDING" });
      const maximum = Number.MAX_SAFE_INTEGER;
      const full = stockAmount(String(maximum), "piece");
      const one = stockAmount("1", "piece");
      await inventory.stock.receive({ operationId: "funding-seed", occurredAtEpochMs: time0, to: source, amount: full });
      if (structured) {
        await inventory.transfers.prepare({
          operationId: "funding-prepare", occurredAtEpochMs: time0 + 1, transferId: "funding-transfer",
          transitPlacementNodeId: "funding-transit", destinationPlacementNodeId: "funding-counted",
          lines: [{ lineId: "one", from: source, amount: one }],
        });
        await inventory.transfers.dispatch({
          operationId: "funding-dispatch", occurredAtEpochMs: time0 + 2, transferId: "funding-transfer",
        });
        await inventory.transfers.receive({
          operationId: "funding-receive", occurredAtEpochMs: time0 + 3, transferId: "funding-transfer",
        });
      } else {
        await inventory.stock.transfer({
          operationId: "funding-first", occurredAtEpochMs: time0 + 1,
          from: source, toPlacementNodeId: "funding-relay", amount: one,
        });
        await inventory.stock.transfer({
          operationId: "funding-second", occurredAtEpochMs: time0 + 2,
          from: relay, toPlacementNodeId: "funding-counted", amount: one,
        });
      }
      await inventory.stock.issue({
        operationId: "funding-clear", occurredAtEpochMs: time3,
        from: source, amount: stockAmount(String(maximum - 1), "piece"),
      });
      await inventory.stock.receive({ operationId: "funding-late", occurredAtEpochMs: time1, to: source, amount: full });
      const result = await inventory.counts.replaceAbsolute({
        countId: "funding-count", operationId: "funding-count", itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["funding-counted"] },
        observedMeasurements: { primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") }, independent: [] },
        occurredAtEpochMs: time2,
      });
      expect(result.event).toBeUndefined();
      expect(await inventory.read.positions({ itemId: "item-a", placementNodeIds: ["funding-source"] }))
        .toMatchObject([{ measurements: { primary: { quantity: parseQuantity(String(maximum), "piece") } } }]);
    }
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

  it("reconciles counts with overlapping and disjoint subtree roots in one prepass", async () => {
    const inventory = createTestInventory();
    const depth = 600;
    const roots: string[] = [];
    for (let index = 0; index < depth; index += 1) {
      const nodeId = `chain-${index}`;
      roots.push(nodeId);
      if (index > 0) {
        await inventory.placement.move({
          operationId: `link-chain-${index}`,
          occurredAtEpochMs: time0,
          nodeId,
          into: `chain-${index - 1}`,
        });
      }
    }
    await inventory.placement.move({
      operationId: "link-disjoint",
      occurredAtEpochMs: time0,
      nodeId: "disjoint-child",
      into: "disjoint-root",
    });
    await inventory.stock.receiveMany({
      operationId: "receive-overlapping-subtrees",
      occurredAtEpochMs: time0,
      lines: [
        { to: loosePosition(`chain-${depth - 1}`), amount: stockAmount("2", "piece") },
        { to: loosePosition("disjoint-child"), amount: stockAmount("3", "piece") },
        { to: loosePosition("outside"), amount: stockAmount("5", "piece") },
      ],
    });
    const selector = {
      itemId: "item-a",
      withinPlacementNodeIds: [...roots, "disjoint-root", "chain-0"],
    };
    const count = await inventory.counts.start({
      countId: "overlapping-roots-count",
      operationId: "start-overlapping-roots-count",
      selector,
      startedAtEpochMs: time1,
    });
    await inventory.counts.observe({
      countId: count.count.countId,
      operationId: "observe-overlapping-roots-count",
      observedAtEpochMs: time1,
      observations: [
        {
          position: { ...loosePosition(`chain-${depth - 1}`), itemRevisionId: "item-a-v2" },
          measurements: { primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") }, independent: [] },
        },
        {
          position: { ...loosePosition("disjoint-child"), itemRevisionId: "item-a-v2" },
          measurements: { primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") }, independent: [] },
        },
      ],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: count.count.countId,
      operationId: "reconcile-overlapping-roots-count",
      completedAtEpochMs: time2,
    });
    expect(reconciled.event?.stockEffects).toMatchObject([
      {
        position: loosePosition("disjoint-child"),
        measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } },
      },
    ]);
  }, 15_000);

  it("excludes unrelated sibling-subtree placement cycles during scoped count prepass", async () => {
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "sibling-move-a-w",
      occurredAtEpochMs: time0,
      nodeId: "A",
      into: "W",
    });
    await inventory.placement.move({
      operationId: "sibling-move-s-w",
      occurredAtEpochMs: time0,
      nodeId: "S",
      into: "W",
    });
    await inventory.placement.move({
      operationId: "sibling-move-x-s",
      occurredAtEpochMs: time0,
      nodeId: "X",
      into: "S",
    });
    await inventory.placement.move({
      operationId: "sibling-move-b-x",
      occurredAtEpochMs: time0,
      nodeId: "B",
      into: "X",
    });
    await inventory.stock.receive({
      operationId: "sibling-stock-a",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.unplace({
      operationId: "sibling-unplace-b",
      occurredAtEpochMs: time2,
      nodeId: "B",
    });
    await inventory.placement.moveContents({
      operationId: "sibling-move-contents-s-b",
      occurredAtEpochMs: time1,
      nodeId: "S",
      into: "B",
    });
    await inventory.counts.start({
      countId: "sibling-scoped-count",
      operationId: "sibling-scoped-count-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["A"] },
    });
    await inventory.counts.observe({
      countId: "sibling-scoped-count",
      operationId: "sibling-scoped-count-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: { ...loosePosition("A"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "sibling-scoped-count",
      operationId: "sibling-scoped-count-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("excludes former-descendant cycles entered after stock moves out of the counted root", async () => {
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "former-move-x-r",
      occurredAtEpochMs: time0,
      nodeId: "X",
      into: "R",
    });
    await inventory.placement.move({
      operationId: "former-move-x-s",
      occurredAtEpochMs: time0 + 1,
      nodeId: "X",
      into: "S",
    });
    await inventory.placement.move({
      operationId: "former-move-b-x",
      occurredAtEpochMs: time0 + 2,
      nodeId: "B",
      into: "X",
    });
    await inventory.stock.receive({
      operationId: "former-stock-r",
      occurredAtEpochMs: time0,
      to: loosePosition("R"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.unplace({
      operationId: "former-unplace-b",
      occurredAtEpochMs: time3,
      nodeId: "B",
    });
    await inventory.placement.moveContents({
      operationId: "former-move-contents-s-b",
      occurredAtEpochMs: time1,
      nodeId: "S",
      into: "B",
    });
    await inventory.counts.start({
      countId: "former-descendant-count",
      operationId: "former-descendant-count-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "former-descendant-count",
      operationId: "former-descendant-count-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: { ...loosePosition("R"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "former-descendant-count",
      operationId: "former-descendant-count-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("excludes cycles involving destinations entered only when leaving a counted root", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "fd-dest-stock-r",
      occurredAtEpochMs: time0,
      to: loosePosition("R"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "fd-dest-x-r",
      occurredAtEpochMs: time0 + 1,
      nodeId: "X",
      into: "R",
    });
    await inventory.placement.move({
      operationId: "fd-dest-x-s",
      occurredAtEpochMs: time0 + 2,
      nodeId: "X",
      into: "S",
    });
    await inventory.placement.unplace({
      operationId: "fd-dest-unplace-x",
      occurredAtEpochMs: time3,
      nodeId: "X",
    });
    await inventory.placement.move({
      operationId: "fd-dest-s-x-backdated",
      occurredAtEpochMs: time1,
      nodeId: "S",
      into: "X",
    });
    await inventory.counts.start({
      countId: "fd-dest-count",
      operationId: "fd-dest-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "fd-dest-count",
      operationId: "fd-dest-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: { ...loosePosition("R"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "fd-dest-count",
      operationId: "fd-dest-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("excludes cycles on former root ancestors while still rejecting cycles on current root ancestors", async () => {
    const runScenario = async (stayUnderS: boolean) => {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "fra-stock-r",
        occurredAtEpochMs: time0,
        to: loosePosition("R"),
        amount: stockAmount("1", "piece"),
      });
      await inventory.placement.move({
        operationId: "fra-r-s",
        occurredAtEpochMs: time0 + 1,
        nodeId: "R",
        into: "S",
      });
      if (!stayUnderS) {
        await inventory.placement.move({
          operationId: "fra-r-t",
          occurredAtEpochMs: time0 + 2,
          nodeId: "R",
          into: "T",
        });
      }
      await inventory.placement.move({
        operationId: "fra-x-s",
        occurredAtEpochMs: time0 + 3,
        nodeId: "X",
        into: "S",
      });
      await inventory.placement.unplace({
        operationId: "fra-unplace-x",
        occurredAtEpochMs: time3,
        nodeId: "X",
      });
      await inventory.placement.move({
        operationId: "fra-s-x-backdated",
        occurredAtEpochMs: time1,
        nodeId: "S",
        into: "X",
      });
      await inventory.counts.start({
        countId: "fra-count",
        operationId: "fra-start",
        startedAtEpochMs: time1,
        selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
      });
      await inventory.counts.observe({
        countId: "fra-count",
        operationId: "fra-observe",
        observedAtEpochMs: time1,
        observations: [
          {
            position: { ...loosePosition("R"), itemRevisionId: "item-a-v2" },
            measurements: {
              primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
              independent: [],
            },
          },
        ],
      });
      return inventory.counts.reconcile({
        countId: "fra-count",
        operationId: "fra-reconcile",
        completedAtEpochMs: time1 + 1,
      });
    };

    expect((await runScenario(false)).event).toBeUndefined();
    await expect(runScenario(true)).rejects.toThrow(/cycle/iu);
  });

  it("preserves exact embodied carrier counts across direct, structured, and detach/reattach routes", async () => {
    const cartItem = defineScalarInventoryItem({
      itemId: "carrier-item",
      revisionId: "carrier-item-v1",
      unit: "piece",
      axisId: "pieces",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Optional,
      },
    });
    const payloadItem = defineScalarInventoryItem({
      itemId: "payload-item",
      revisionId: "payload-item-v1",
      unit: "piece",
      axisId: "pieces",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Forbidden,
      },
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [cartItem, payloadItem],
      activeItemRevisionIds: {
        [cartItem.itemId]: cartItem.revisionId,
        [payloadItem.itemId]: payloadItem.revisionId,
      },
    });
    const modes = ["direct", "structured", "detach-reattach"] as const;
    const directions = [["A", "Z"], ["Z", "A"]] as const;
    for (const canonical of [false, true]) {
      for (const mode of modes) {
        for (const [origin, dest] of directions) {
          for (const childBefore of [true, false]) {
            const backing = createInMemoryInventoryDurableStorage();
            const storage = canonical
              ? new Proxy(backing, {
                  /** Mask native segmented/indexed capabilities so counts exercise the canonical coordinator. */
                  get(target, property) {
                    if (
                      property === "readSegmentedStockPool" ||
                      property === "readPlacementSegment" ||
                      property === "commitSegmentedPlacementChange" ||
                      property === "queryInventoryEvents" ||
                      property === "queryInventoryEventsByResourceKeys"
                    ) {
                      return undefined;
                    }
                    const member = Reflect.get(target, property);
                    return typeof member === "function" ? member.bind(target) : member;
                  },
                })
              : backing;
            const inventory = createInventoryOnce({
              catalog,
              storage,
              deficitPolicy: InventoryDeficitPolicy.Reject,
              clock: { nowEpochMs: () => time3 },
            });
            const cartId = "CART";
            const destPos = { itemId: payloadItem.itemId, placementNodeId: dest };
            const cartChildPos = { itemId: payloadItem.itemId, placementNodeId: cartId };
            await inventory.stock.receive({
              operationId: "matrix-root-stock",
              occurredAtEpochMs: time0,
              to: destPos,
              amount: stockAmount("1", "piece"),
            });
            await inventory.stock.receive({
              operationId: "matrix-cart-stock",
              occurredAtEpochMs: time0,
              to: { itemId: cartItem.itemId, placementNodeId: origin },
              amount: stockAmount("1", "piece"),
            });
            await inventory.stock.individualize({
              operationId: "matrix-cart-embody",
              occurredAtEpochMs: time0 + 1,
              from: { itemId: cartItem.itemId, placementNodeId: origin },
              amount: stockAmount("1", "piece"),
              serialId: cartId,
              asPlacementNode: { category: "cart", acceptsPlacement: true },
            });
            const cartPos = { itemId: cartItem.itemId, placementNodeId: origin, serialId: cartId };
            if (childBefore) {
              await inventory.stock.receive({
                operationId: "matrix-child-before",
                occurredAtEpochMs: time0 + 2,
                to: cartChildPos,
                amount: stockAmount("1", "piece"),
              });
            }
            if (mode === "direct") {
              await inventory.stock.transfer({
                operationId: "matrix-direct-move",
                occurredAtEpochMs: time1,
                from: cartPos,
                toPlacementNodeId: dest,
                amount: stockAmount("1", "piece"),
              });
            } else if (mode === "structured") {
              await inventory.transfers.prepare({
                operationId: "matrix-structured-prepare",
                occurredAtEpochMs: time1,
                transferId: "matrix-tx",
                transitPlacementNodeId: "transit",
                destinationPlacementNodeId: dest,
                lines: [{ lineId: "cart", from: cartPos, amount: stockAmount("1", "piece") }],
              });
              await inventory.transfers.dispatch({
                operationId: "matrix-structured-dispatch",
                occurredAtEpochMs: time1 + 1,
                transferId: "matrix-tx",
              });
              await inventory.transfers.receive({
                operationId: "matrix-structured-receive",
                occurredAtEpochMs: time1 + 2,
                transferId: "matrix-tx",
              });
            } else {
              const detached = await inventory.stock.detach({
                operationId: "matrix-detach",
                occurredAtEpochMs: time1,
                from: cartPos,
                amount: stockAmount("1", "piece"),
              });
              const detachedCartPos = detached.event.stockEffects.find(
                /** Locate the detached carrier position. */
                (effect) => effect.position.whereaboutsId !== undefined,
              )?.position;
              if (detachedCartPos === undefined) throw new Error("Expected detached carrier position.");
              await inventory.stock.place({
                operationId: "matrix-reattach",
                occurredAtEpochMs: time1 + 1,
                from: detachedCartPos,
                into: dest,
                amount: stockAmount("1", "piece"),
              });
            }
            if (!childBefore) {
              await inventory.stock.receive({
                operationId: "matrix-child-after",
                occurredAtEpochMs: time1 + 3,
                to: cartChildPos,
                amount: stockAmount("1", "piece"),
              });
            }
            await inventory.counts.start({
              countId: "matrix-count",
              operationId: "matrix-count-start",
              startedAtEpochMs: time2,
              selector: { itemId: payloadItem.itemId, withinPlacementNodeIds: [dest] },
            });
            await inventory.counts.observe({
              countId: "matrix-count",
              operationId: "matrix-count-observe",
              observedAtEpochMs: time2,
              observations: [
                {
                  position: { ...destPos, itemRevisionId: payloadItem.revisionId },
                  measurements: {
                    primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
                    independent: [],
                  },
                },
                {
                  position: { ...cartChildPos, itemRevisionId: payloadItem.revisionId },
                  measurements: {
                    primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
                    independent: [],
                  },
                },
              ],
            });
            const reconciled = await inventory.counts.reconcile({
              countId: "matrix-count",
              operationId: "matrix-count-reconcile",
              completedAtEpochMs: time2 + 1,
            });
            expect(reconciled.event).toBeUndefined();
            const livePayload = await inventory.read.positions({
              itemId: payloadItem.itemId,
              withinPlacementNodeIds: [dest],
            });
            expect(livePayload).toHaveLength(2);
          }
        }
      }
    }
  });

  it("keeps count prepass work independent of root count across disjoint placement moves", async () => {
    const inventory = createTestInventory();
    const roots = Array.from({ length: 2401 }, (_, index) => `scale-root-${index}`);
    await inventory.stock.receive({
      operationId: "scale-roots-seed",
      occurredAtEpochMs: time0,
      to: loosePosition(roots[0]!),
      amount: stockAmount("1", "piece"),
    });
    for (let index = 0; index < 600; index += 1) {
      await inventory.placement.move({
        operationId: `scale-disjoint-move-${index}`,
        occurredAtEpochMs: time0 + index + 1,
        nodeId: `disjoint-node-${index}`,
        into: `disjoint-parent-${index}`,
      });
    }
    await inventory.counts.start({
      countId: "scale-roots-count",
      operationId: "scale-roots-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: roots },
    });
    await inventory.counts.observe({
      countId: "scale-roots-count",
      operationId: "scale-roots-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: { ...loosePosition(roots[0]!), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "scale-roots-count",
      operationId: "scale-roots-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("retains unplacement of a node whose former parent later re-enters the counted subtree", async () => {
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "reenter-x-r-1",
      occurredAtEpochMs: time0,
      nodeId: "X",
      into: "R",
    });
    await inventory.placement.move({
      operationId: "reenter-y-x",
      occurredAtEpochMs: time0 + 1,
      nodeId: "Y",
      into: "X",
    });
    await inventory.stock.receive({
      operationId: "reenter-stock-y",
      occurredAtEpochMs: time0 + 2,
      to: loosePosition("Y"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "reenter-x-outside",
      occurredAtEpochMs: time0 + 3,
      nodeId: "X",
      into: "OUTSIDE",
    });
    await inventory.placement.unplace({
      operationId: "reenter-unplace-y",
      occurredAtEpochMs: time0 + 4,
      nodeId: "Y",
    });
    await inventory.placement.move({
      operationId: "reenter-x-r-2",
      occurredAtEpochMs: time0 + 5,
      nodeId: "X",
      into: "R",
    });

    await inventory.counts.start({
      countId: "reenter-count",
      operationId: "reenter-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "reenter-count",
      operationId: "reenter-observe",
      observedAtEpochMs: time1,
      observations: [],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "reenter-count",
      operationId: "reenter-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("detaches a child reparented to an outside node before its former parent returns without pulling outside cycles", async () => {
    // Reparenting Y outside to OUTSIDE_2 before X returns to R must keep Y outside R.
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "reparent-x-r-1",
      occurredAtEpochMs: time0,
      nodeId: "X",
      into: "R",
    });
    await inventory.placement.move({
      operationId: "reparent-y-x",
      occurredAtEpochMs: time0 + 1,
      nodeId: "Y",
      into: "X",
    });
    await inventory.stock.receive({
      operationId: "reparent-stock-y",
      occurredAtEpochMs: time0 + 2,
      to: loosePosition("Y"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.move({
      operationId: "reparent-x-out1",
      occurredAtEpochMs: time0 + 3,
      nodeId: "X",
      into: "OUTSIDE_1",
    });
    await inventory.placement.move({
      operationId: "reparent-y-out2",
      occurredAtEpochMs: time0 + 4,
      nodeId: "Y",
      into: "OUTSIDE_2",
    });
    await inventory.placement.move({
      operationId: "reparent-x-r-2",
      occurredAtEpochMs: time0 + 5,
      nodeId: "X",
      into: "R",
    });

    await inventory.counts.start({
      countId: "reparent-empty-count",
      operationId: "reparent-empty-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "reparent-empty-count",
      operationId: "reparent-empty-observe",
      observedAtEpochMs: time1,
      observations: [],
    });
    const emptyCount = await inventory.counts.reconcile({
      countId: "reparent-empty-count",
      operationId: "reparent-empty-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(emptyCount.event).toBeUndefined();
    const liveAtY = await inventory.read.positions({
      itemId: "item-a",
      withinPlacementNodeIds: ["OUTSIDE_2"],
    });
    expect(liveAtY).toHaveLength(1);

    // Moving OUTSIDE_2 itself into R later must still bring Y under R.
    await inventory.placement.move({
      operationId: "reparent-out2-r",
      occurredAtEpochMs: time2,
      nodeId: "OUTSIDE_2",
      into: "R",
    });
    await inventory.counts.start({
      countId: "reparent-entered-count",
      operationId: "reparent-entered-start",
      startedAtEpochMs: time2 + 1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "reparent-entered-count",
      operationId: "reparent-entered-observe",
      observedAtEpochMs: time2 + 1,
      observations: [
        {
          position: { ...loosePosition("Y"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
      ],
    });
    const enteredCount = await inventory.counts.reconcile({
      countId: "reparent-entered-count",
      operationId: "reparent-entered-reconcile",
      completedAtEpochMs: time2 + 2,
    });
    expect(enteredCount.event).toBeUndefined();

    // Two nodes that both left R cannot introduce an outside backdated cycle into a count under R.
    const cycleInventory = createTestInventory();
    await cycleInventory.placement.move({
      operationId: "leaving-x-r",
      occurredAtEpochMs: time0,
      nodeId: "X",
      into: "R",
    });
    await cycleInventory.placement.move({
      operationId: "leaving-y-r",
      occurredAtEpochMs: time0 + 1,
      nodeId: "Y",
      into: "R",
    });
    await cycleInventory.placement.move({
      operationId: "leaving-x-o1",
      occurredAtEpochMs: time0 + 2,
      nodeId: "X",
      into: "OUTSIDE_1",
    });
    await cycleInventory.placement.move({
      operationId: "leaving-y-o2",
      occurredAtEpochMs: time0 + 3,
      nodeId: "Y",
      into: "OUTSIDE_2",
    });
    await cycleInventory.placement.move({
      operationId: "leaving-y-x-back",
      occurredAtEpochMs: time1,
      nodeId: "Y",
      into: "X",
    });
    await cycleInventory.placement.unplace({
      operationId: "leaving-unplace-y",
      occurredAtEpochMs: time3,
      nodeId: "Y",
    });
    await cycleInventory.placement.move({
      operationId: "leaving-x-y-back",
      occurredAtEpochMs: time1 + 1,
      nodeId: "X",
      into: "Y",
    });
    await cycleInventory.counts.start({
      countId: "leaving-cycle-count",
      operationId: "leaving-cycle-start",
      startedAtEpochMs: time2,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await cycleInventory.counts.observe({
      countId: "leaving-cycle-count",
      operationId: "leaving-cycle-observe",
      observedAtEpochMs: time2,
      observations: [],
    });
    const leavingCount = await cycleInventory.counts.reconcile({
      countId: "leaving-cycle-count",
      operationId: "leaving-cycle-reconcile",
      completedAtEpochMs: time2 + 1,
    });
    expect(leavingCount.event).toBeUndefined();
  });

  it("excludes out-of-scope embodied carrier moves when an unrelated backdated transfer moves X into former child B", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "carrier-cycle-rx",
      occurredAtEpochMs: time0,
      to: loosePosition("R"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "carrier-cycle-embody",
      occurredAtEpochMs: time0,
      from: loosePosition("R"),
      amount: stockAmount("1", "piece"),
      serialId: "X-CARRIER",
      asPlacementNode: { acceptsPlacement: true },
    });
    await inventory.placement.move({
      operationId: "carrier-cycle-place-b",
      occurredAtEpochMs: time0,
      nodeId: "B",
      into: "X-CARRIER",
    });
    await inventory.stock.transfer({
      operationId: "carrier-cycle-leave-r",
      occurredAtEpochMs: time1,
      from: loosePosition("R", { serialId: "X-CARRIER" }),
      toPlacementNodeId: "OUTSIDE",
      amount: stockAmount("1", "piece"),
    });
    await inventory.placement.unplace({
      operationId: "carrier-cycle-unplace-b",
      occurredAtEpochMs: time3,
      nodeId: "B",
    });
    await inventory.stock.transfer({
      operationId: "carrier-cycle-backdated-reparent",
      occurredAtEpochMs: time2,
      from: loosePosition("OUTSIDE", { serialId: "X-CARRIER" }),
      toPlacementNodeId: "B",
      amount: stockAmount("1", "piece"),
    });
    await inventory.counts.start({
      countId: "carrier-cycle-count",
      operationId: "carrier-cycle-start",
      startedAtEpochMs: time2 + 10,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await inventory.counts.observe({
      countId: "carrier-cycle-count",
      operationId: "carrier-cycle-observe",
      observedAtEpochMs: time2 + 10,
      observations: [],
    });
    const reconciled = await inventory.counts.reconcile({
      countId: "carrier-cycle-count",
      operationId: "carrier-cycle-reconcile",
      completedAtEpochMs: time2 + 20,
    });
    expect(reconciled.event).toBeUndefined();
  });

  it("retains derived carrier edges both on standalone embodiment definitions and atomic individualizations", async () => {
    const standaloneInventory = createTestInventory();
    await standaloneInventory.stock.receive({
      operationId: "standalone-rx-cab",
      occurredAtEpochMs: time0,
      to: loosePosition("R", { serialId: "CAB-STANDALONE" }),
      amount: stockAmount("1", "piece"),
    });
    await standaloneInventory.placement.define({
      operationId: "standalone-embody-cab",
      occurredAtEpochMs: time0 + 1,
      nodeId: "X-STANDALONE",
      placementNode: {
        category: "cabinet",
        acceptsPlacement: true,
        embodiedBy: { itemId: "item-a", serialId: "CAB-STANDALONE" },
      },
    });
    await standaloneInventory.stock.receive({
      operationId: "standalone-rx-contents",
      occurredAtEpochMs: time0 + 2,
      to: loosePosition("X-STANDALONE"),
      amount: stockAmount("2", "piece"),
    });
    await standaloneInventory.counts.start({
      countId: "standalone-cab-count",
      operationId: "standalone-cab-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await standaloneInventory.counts.observe({
      countId: "standalone-cab-count",
      operationId: "standalone-cab-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: {
            ...loosePosition("R", { serialId: "CAB-STANDALONE" }),
            itemRevisionId: "item-a-v2",
          },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
        {
          position: { ...loosePosition("X-STANDALONE"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
            independent: [],
          },
        },
      ],
    });
    const standaloneReconciled = await standaloneInventory.counts.reconcile({
      countId: "standalone-cab-count",
      operationId: "standalone-cab-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(standaloneReconciled.event).toBeUndefined();

    const atomicInventory = createTestInventory();
    await atomicInventory.stock.receive({
      operationId: "atomic-rx-seed",
      occurredAtEpochMs: time0,
      to: loosePosition("R"),
      amount: stockAmount("1", "piece"),
    });
    await atomicInventory.stock.individualize({
      operationId: "atomic-embody-cab",
      occurredAtEpochMs: time0 + 1,
      from: loosePosition("R"),
      amount: stockAmount("1", "piece"),
      serialId: "X-ATOMIC",
      asPlacementNode: { category: "cabinet", acceptsPlacement: true },
    });
    await atomicInventory.stock.receive({
      operationId: "atomic-rx-contents",
      occurredAtEpochMs: time0 + 2,
      to: loosePosition("X-ATOMIC"),
      amount: stockAmount("2", "piece"),
    });
    await atomicInventory.counts.start({
      countId: "atomic-cab-count",
      operationId: "atomic-cab-start",
      startedAtEpochMs: time1,
      selector: { itemId: "item-a", withinPlacementNodeIds: ["R"] },
    });
    await atomicInventory.counts.observe({
      countId: "atomic-cab-count",
      operationId: "atomic-cab-observe",
      observedAtEpochMs: time1,
      observations: [
        {
          position: {
            ...loosePosition("R", { serialId: "X-ATOMIC" }),
            itemRevisionId: "item-a-v2",
          },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
            independent: [],
          },
        },
        {
          position: { ...loosePosition("X-ATOMIC"), itemRevisionId: "item-a-v2" },
          measurements: {
            primary: { axisId: "pieces", quantity: parseQuantity("2", "piece") },
            independent: [],
          },
        },
      ],
    });
    const atomicReconciled = await atomicInventory.counts.reconcile({
      countId: "atomic-cab-count",
      operationId: "atomic-cab-reconcile",
      completedAtEpochMs: time1 + 1,
    });
    expect(atomicReconciled.event).toBeUndefined();
  });

  it("excludes prepared and in-transit transfer stock from backing debt inside reservation feasibility", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    const sourceLotP = loosePosition("transfer-debt-src", { lotId: "LOT-P" });
    const sourceLotO = loosePosition("transfer-debt-src", { lotId: "LOT-O" });
    const sourceLotD = loosePosition("transfer-debt-src", { lotId: "LOT-D" });
    await inventory.stock.receive({
      operationId: "td-rx-p",
      occurredAtEpochMs: time0,
      to: sourceLotP,
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.receive({
      operationId: "td-rx-o",
      occurredAtEpochMs: time0,
      to: sourceLotO,
      amount: stockAmount("5", "piece"),
    });
    await inventory.transfers.prepare({
      operationId: "td-prepare",
      occurredAtEpochMs: time1,
      transferId: "td-transfer-1",
      transitPlacementNodeId: "transfer-debt-transit",
      destinationPlacementNodeId: "transfer-debt-dst",
      lines: [{ lineId: "p10", from: sourceLotP, amount: stockAmount("10", "piece") }],
    });
    // Record an exact 5-piece deficit in another lot at the same placement node, consuming LOT-O capacity.
    await inventory.stock.issue({
      operationId: "td-record-deficit",
      occurredAtEpochMs: time1 + 1,
      from: sourceLotD,
      amount: stockAmount("5", "piece"),
    });

    const avail = await inventory.read.availability({
      itemId: "item-a",
      placementNodeIds: ["transfer-debt-src"],
    });
    expect(avail.revisions[0]?.unallocatedUsablePhysical).toEqual(parseQuantity("0", "piece"));

    await expect(
      inventory.reservations.reserve({
        reservationId: "td-reserve-5",
        operationId: "td-reserve-op",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["transfer-debt-src"] },
        requested: parseQuantity("5", "piece"),
        createdAtEpochMs: time2,
      })
    ).rejects.toThrow("Inventory reservations cannot all be fulfilled simultaneously");

    await inventory.transfers.dispatch({
      operationId: "td-dispatch",
      transferId: "td-transfer-1",
      occurredAtEpochMs: time1 + 2,
    });
    await expect(
      inventory.reservations.reserve({
        reservationId: "td-reserve-5-in-transit",
        operationId: "td-reserve-op-in-transit",
        itemRevisionId: "item-a-v2",
        selector: {
          itemId: "item-a",
          placementNodeIds: ["transfer-debt-src", "transfer-debt-transit"],
        },
        requested: parseQuantity("5", "piece"),
        createdAtEpochMs: time2,
      })
    ).rejects.toThrow("Inventory reservations cannot all be fulfilled simultaneously");
  });

  it("tightens whole-pack slack bounds when required unused capacity is unreachable without hitting search limits", async () => {
    const heavyItem = defineInventoryItem({
      itemId: "heavy-slab",
      revisionId: "heavy-slab-v1",
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
      reservationAxisId: "weight",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Optional,
      },
      qualifiedDimensions: [],
    });
    const tenKgPack = defineInventoryPackaging(
      {
        revisionId: "heavy-slab-10kg",
        itemId: heavyItem.itemId,
        itemRevisionId: heavyItem.revisionId,
        packageUnit: unitCode("pallet"),
        fixedContents: inventoryMeasurementVector(
          { axisId: "pieces", quantity: parseQuantity("1", "piece") },
          [{ axisId: "weight", quantity: parseQuantity("10", "kg") }]
        ),
      },
      heavyItem
    );
    const fourKgPack = defineInventoryPackaging(
      {
        revisionId: "heavy-slab-4kg",
        itemId: heavyItem.itemId,
        itemRevisionId: heavyItem.revisionId,
        packageUnit: unitCode("crate"),
        fixedContents: inventoryMeasurementVector(
          { axisId: "pieces", quantity: parseQuantity("1", "piece") },
          [{ axisId: "weight", quantity: parseQuantity("4", "kg") }]
        ),
      },
      heavyItem
    );
    const catalog = defineInventoryCatalog({
      itemRevisions: [heavyItem],
      activeItemRevisionIds: { [heavyItem.itemId]: heavyItem.revisionId },
      packagingRevisions: [tenKgPack, fourKgPack],
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: { nowEpochMs: () => time3 },
    });
    await inventory.stock.receive({
      operationId: "slab-rx-10",
      occurredAtEpochMs: time0,
      to: {
        itemId: heavyItem.itemId,
        lotId: "SLAB-10KG",
        placementNodeId: "slab-store",
        packagingRevisionId: tenKgPack.revisionId,
      },
      amount: packageAmount(600_001, tenKgPack.revisionId),
    });
    await inventory.stock.receive({
      operationId: "slab-rx-4",
      occurredAtEpochMs: time0,
      to: {
        itemId: heavyItem.itemId,
        lotId: "SLAB-4KG",
        placementNodeId: "slab-store",
        packagingRevisionId: fourKgPack.revisionId,
      },
      amount: packageAmount(499_999, fourKgPack.revisionId),
    });
    await inventory.stock.receive({
      operationId: "slab-rx-loose-2kg",
      occurredAtEpochMs: time0,
      to: {
        itemId: heavyItem.itemId,
        lotId: "SLAB-LOOSE",
        placementNodeId: "slab-store",
      },
      amount: measuredStockAmount("1", "piece", [
        { axisId: "weight", value: "2", unit: "kg" },
      ]),
    });
    const claimWeight = parseQuantity("4000000", "kg");
    await inventory.reservations.reserve({
      reservationId: "slab-claim-1",
      operationId: "slab-claim-op-1",
      itemRevisionId: heavyItem.revisionId,
      selector: { itemId: heavyItem.itemId, placementNodeIds: ["slab-store"] },
      requested: claimWeight,
      createdAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "slab-claim-2",
      operationId: "slab-claim-op-2",
      itemRevisionId: heavyItem.revisionId,
      selector: { itemId: heavyItem.itemId, placementNodeIds: ["slab-store"] },
      requested: claimWeight,
      createdAtEpochMs: time1,
    });

    // Divisible loose control: 2 kg loose stock closes the shortage completely.
    const looseFeasibility = await inventory.read.reservationFeasibility();
    expect(looseFeasibility.groups[0]).toMatchObject({
      fulfillable: parseQuantity("8000000", "kg"),
      shortage: parseQuantity("0", "kg"),
    });

    // After a count removes the loose stock, only 10 kg and 4 kg whole packs remain; 6 kg unused is unreachable (nearest >= 6 is 8 kg), reporting a 2 kg shortage.
    await inventory.counts.replaceAbsolute({
      countId: "slab-remove-loose-count",
      operationId: "slab-remove-loose-op",
      itemRevisionId: heavyItem.revisionId,
      selector: { itemId: heavyItem.itemId, lotIds: ["SLAB-LOOSE"], placementNodeIds: ["slab-store"] },
      occurredAtEpochMs: time2,
    });
    const wholeFeasibility = await inventory.read.reservationFeasibility();
    expect(wholeFeasibility.groups[0]).toMatchObject({
      fulfillable: parseQuantity("7999998", "kg"),
      shortage: parseQuantity("2", "kg"),
    });
  });

  it("retains earlier reservation holds when reopening a published world", async () => {
    const seeded = createTestInventory();
    await seeded.stock.receive({
      operationId: "seed-rx",
      occurredAtEpochMs: time0,
      to: loosePosition("seed-bin"),
      amount: stockAmount("2", "piece"),
    });
    await seeded.reservations.reserve({
      reservationId: "seed-claim",
      operationId: "seed-claim-op",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["seed-bin"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const world = await seeded.read.world();
    const reopenedStorage = createInMemoryInventoryDurableStorage({ initialWorld: world });
    const reopened = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage: reopenedStorage,
      clock: { nowEpochMs: () => time3 },
    });
    await reopened.reservations.reserve({
      reservationId: "later-claim",
      operationId: "later-claim-op",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", placementNodeIds: ["seed-bin"] },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time2,
    });
    const asOfPool = reopenedStorage.readSegmentedStockPool({
      selector: { itemId: "item-a", placementNodeIds: ["seed-bin"] },
      itemRevisionId: "item-a-v2",
      reservationAtEpochMs: time1,
    });
    expect(asOfPool.reservations.map((row) => row.reservationId)).toEqual(["seed-claim"]);
  });
});
