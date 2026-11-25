import { describe, expect, it, vi } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryEventKind,
  InventoryWhereaboutsAction,
  inventoryCatalogSnapshot,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { applyInventoryCommittedEvent, projectInventoryEvents } from "../src/projection.js";
import { createInventoryPlacementEvent } from "../src/commands.js";
import { commitInventoryEvent } from "../src/events.js";
import { createInventoryCorrectionEvent } from "../src/corrections.js";
import { replayInventoryHistoricalScenario } from "../src/historical-replay.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded historical-repair trace identity. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-HISTORICAL-REPAIR-ATOMIC",
] as const;

describe("late historical repair", () => {
  it("retains a mixed transfer witness while exposing the shortage from an earlier corrected receipt", async () => {
    const inventory = createTestInventory(undefined, undefined, undefined, InventoryDeficitPolicy.Record);
    const from = loosePosition("historical-transfer-source", { lotId: "TRANSFER-LOT" });
    const receipt = await inventory.stock.receive({
      operationId: "historical-transfer-receipt", occurredAtEpochMs: time0, to: from, amount: stockAmount("2", "piece"),
    });
    const transfer = await inventory.stock.transfer({
      operationId: "historical-mixed-transfer", occurredAtEpochMs: time1,
      from, toPlacementNodeId: "historical-transfer-destination", amount: stockAmount("3", "piece"),
    });
    expect(transfer.event.unwitnessedStockMovements).toMatchObject([{
      measurements: { primary: { quantity: parseQuantity("1", "piece") } },
    }]);
    const correction = await inventory.stock.correct({
      operationId: "historical-transfer-receipt-correction", occurredAtEpochMs: time2,
      reason: "The receipt was one piece smaller than recorded.", correctsEventId: receipt.event.eventId,
      replaceWith: (plans) => plans.receive({ occurredAtEpochMs: time0, to: from, amount: stockAmount("1", "piece") }),
    });
    expect(correction.event.historicalImpact?.deficits).toMatchObject([{
      position: { lotId: from.lotId }, maximumDeficit: { primary: { quantity: parseQuantity("1", "piece") } },
    }]);
    const world = await inventory.read.world();
    expect(world.projection.events[transfer.event.eventId]).toEqual(transfer.event);
    const destination = await inventory.read.planAllocation({
      selector: { itemId: from.itemId, lotIds: ["TRANSFER-LOT"], placementNodeIds: ["historical-transfer-destination"] },
      amount: stockAmount("2", "piece"), method: InventoryAllocationMethod.Fifo, atEpochMs: time2,
    });
    expect(destination.lines).toMatchObject([{ layerStartedAtEpochMs: time0, allocatedPrimary: parseQuantity("2", "piece") }]);
  });
  /** A later redundant move still contributes its retained parent-node definition. */
  it("preserves placement metadata when an earlier correction makes a later move redundant", () => {
    const catalog = createTabletCatalog();
    const early = commitInventoryEvent(
      createInventoryPlacementEvent({
        catalog,
        operationId: "metadata-replay-initial-placement",
        occurredAtEpochMs: time0,
        nodeId: "METADATA-REPLAY-BOX",
        toParentNodeId: "METADATA-REPLAY-OLD",
      }),
      time0,
      1
    );
    const later = commitInventoryEvent(
      createInventoryPlacementEvent({
        catalog,
        operationId: "metadata-replay-later-move",
        occurredAtEpochMs: time1,
        nodeId: "METADATA-REPLAY-BOX",
        fromParentNodeId: "METADATA-REPLAY-OLD",
        toParentNodeId: "METADATA-REPLAY-NEW",
        parent: {
          category: "shelf",
          acceptsPlacement: true,
        },
      }),
      time1,
      2
    );
    const projection = projectInventoryEvents({
      catalog,
      events: [early, later],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(
      projection.placementNodes["METADATA-REPLAY-NEW"]?.definition.category
    ).toBe("shelf");

    // The corrected earlier move now places the box directly in the later target.
    const replacement = createInventoryPlacementEvent({
      catalog,
      operationId: "metadata-replay-corrected-initial-placement",
      occurredAtEpochMs: time0,
      nodeId: "METADATA-REPLAY-BOX",
      toParentNodeId: "METADATA-REPLAY-NEW",
    });
    const replay = replayInventoryHistoricalScenario({
      catalog,
      projection,
      deficitPolicy: InventoryDeficitPolicy.Reject,
      rootReplacement: {
        rootEventId: early.eventId,
        replacement,
      },
    });
    const retained = replay.effectiveEvents.find(
      /** Identify the later metadata assertion even if its move was rebased away. */
      (event) => event.eventId === later.eventId
    );
    expect(retained?.kind).toBe(InventoryEventKind.PlacementNodeMetadata);
    expect(retained?.placementChanges).toEqual([]);
    expect(retained?.placementNodeDefinitions).toEqual(later.placementNodeDefinitions);
    expect(
      replay.projection.placementNodes["METADATA-REPLAY-NEW"]?.definition.category
    ).toBe("shelf");
    expect(
      replay.projection.placementNodeRootEventIdByNodeId["METADATA-REPLAY-NEW"]
    ).toBe(later.eventId);
    expect(
      replay.projection.placement.relationByNodeId["METADATA-REPLAY-BOX"]?.parentNodeId
    ).toBe("METADATA-REPLAY-NEW");
    expect(
      projection.placement.relationByNodeId["METADATA-REPLAY-BOX"]?.parentNodeId
    ).toBe("METADATA-REPLAY-NEW");

    // The same current kernel correction planner must retain that separate
    // later metadata root when deriving and applying the published delta.
    const correction = commitInventoryEvent(
      createInventoryCorrectionEvent({
        catalog,
        projection,
        operationId: "metadata-replay-root-correction",
        occurredAtEpochMs: time3,
        correctsEventId: early.eventId,
        reason: "The original box was placed directly into the new shelf.",
        replacement,
      }, InventoryDeficitPolicy.Reject),
      time3,
      3
    );
    const published = applyInventoryCommittedEvent({
      catalog,
      state: projection,
      event: correction,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }).state;
    expect(
      published.placementNodes["METADATA-REPLAY-NEW"]?.definition.category
    ).toBe("shelf");
    expect(
      published.placementNodeRootEventIdByNodeId["METADATA-REPLAY-NEW"]
    ).toBe(later.eventId);
    expect(published).toEqual(projectInventoryEvents({
      catalog,
      events: [early, later, correction],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }));
  });

  /** A smaller negative interval from the same retained issue is improvement, not new exposure. */
  it("accepts a smaller retained deficit from the same issue root while rejecting growth", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const recorder = createTestInventory(
      storage,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    const root = await recorder.stock.issue({
      operationId: "shrink-existing-deficit-root",
      occurredAtEpochMs: time0,
      from: loosePosition("historical-shortage"),
      amount: stockAmount("5", "piece"),
    });
    const strict = createTestInventory(storage);
    const correction = {
      operationId: "shrink-existing-deficit-correction",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "Four pieces were actually issued, not five.",
      replaceWith: (plans: Parameters<typeof strict.stock.correct>[0]["replaceWith"] extends
        (plans: infer Plans) => unknown ? Plans : never) =>
        plans.issue({
          occurredAtEpochMs: time0,
          from: loosePosition("historical-shortage"),
          amount: stockAmount("4", "piece"),
        }),
    };
    const proposed = await strict.stock.planCorrection(correction);
    expect(proposed.valid).toBe(true);
    if (!proposed.valid) throw new Error(proposed.conflict.message);
    expect(proposed.impact.deficits).toEqual([]);
    const committed = await strict.stock.correct(correction);
    expect(committed.event.historicalImpact?.deficits).toEqual([]);
    expect(
      (await strict.read.positions({ itemId: "item-a" }))[0]?.measurements.primary.quantity.amountMinor
    ).toBe(-4);
    expect((await strict.stock.correct(correction)).replayed).toBe(true);

    const worsening = await strict.stock.planCorrection({
      ...correction,
      operationId: "grow-existing-deficit-correction",
      reason: "An inaccurate proposal that would deepen the prior deficit.",
      replaceWith: (plans) =>
        plans.issue({
          occurredAtEpochMs: time0,
          from: loosePosition("historical-shortage"),
          amount: stockAmount("6", "piece"),
        }),
    });
    expect(worsening).toMatchObject({
      valid: false,
      conflict: { code: "negative-stock" },
    });
  });

  it("allows a Reject-policy correction that does not change a retained recorded deficit", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const recorder = createTestInventory(
      storage,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await recorder.stock.issue({
      operationId: "retained-deficit-initial-issue",
      occurredAtEpochMs: time0,
      from: loosePosition("historical-shortage"),
      amount: stockAmount("5", "piece"),
    });
    const unrelated = await recorder.stock.receive({
      operationId: "retained-deficit-unrelated-receipt",
      occurredAtEpochMs: time1,
      to: loosePosition("historical-shortage"),
      amount: stockAmount("8", "piece"),
    });

    // A new strict facade over the same supported persisted stock must prevent
    // new deficits, not misclassify the already-recorded shortage as new.
    const strict = createTestInventory(storage);
    const corrected = await strict.stock.planCorrection({
      operationId: "retained-deficit-safe-correction",
      occurredAtEpochMs: time3,
      correctsEventId: unrelated.event.eventId,
      reason: "Receipt was seven pieces, still sufficient to close the old shortage.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("historical-shortage"),
          amount: stockAmount("7", "piece"),
        }),
    });
    if (!corrected.valid) throw new Error(corrected.conflict.code + ": " + corrected.conflict.message);
    expect(corrected.valid).toBe(true);
    expect(corrected.event.historicalImpact?.deficits).toEqual([]);

    const stillUnsafe = await strict.stock.planCorrection({
      operationId: "retained-deficit-worsened-correction",
      occurredAtEpochMs: time3,
      correctsEventId: unrelated.event.eventId,
      reason: "This would leave the old shortage unresolved.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("historical-shortage"),
          amount: stockAmount("4", "piece"),
        }),
    });
    expect(stillUnsafe).toMatchObject({
      valid: false,
      conflict: { code: "negative-stock" },
    });

    // An interval can retain its old peak and still become MORE negative now.
    // Reject must not mistake a worsened current shortage for unchanged history.
    const openStorage = createInMemoryInventoryDurableStorage();
    const openRecorder = createTestInventory(
      openStorage,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await openRecorder.stock.issue({
      operationId: "ongoing-deficit-initial-issue",
      occurredAtEpochMs: time0,
      from: loosePosition("ongoing-shortage"),
      amount: stockAmount("5", "piece"),
    });
    const partialRepayment = await openRecorder.stock.receive({
      operationId: "ongoing-deficit-partial-receipt",
      occurredAtEpochMs: time1,
      to: loosePosition("ongoing-shortage"),
      amount: stockAmount("3", "piece"),
    });
    const strictOnOpen = createTestInventory(openStorage);
    const improvement = await strictOnOpen.stock.planCorrection({
      operationId: "ongoing-deficit-improves-correction",
      occurredAtEpochMs: time3,
      correctsEventId: partialRepayment.event.eventId,
      reason: "A little more was received, reducing the old shortage.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("ongoing-shortage"),
          amount: stockAmount("4", "piece"),
        }),
    });
    expect(improvement.valid).toBe(true);
    if (!improvement.valid) throw new Error(improvement.conflict.message);
    expect(improvement.impact.deficits).toEqual([]);

    const worsening = await strictOnOpen.stock.planCorrection({
      operationId: "ongoing-deficit-worsened-correction",
      occurredAtEpochMs: time3,
      correctsEventId: partialRepayment.event.eventId,
      reason: "The already open shortage would become worse.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("ongoing-shortage"),
          amount: stockAmount("2", "piece"),
        }),
    });
    expect(worsening).toMatchObject({
      valid: false,
      conflict: { code: "negative-stock" },
    });
  });

  it("publishes eligible repair and correction envelopes without the canonical coordinator", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const root = await inventory.stock.receive({
      operationId: "historical-fast-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("fast-store"),
      amount: stockAmount("5", "piece"),
    });
    // Materialize the seed before guarding the later state-dependent operations.
    await inventory.read.world();
    const begin = vi.spyOn(storage, "begin").mockRejectedValue(
      new Error("Eligible historical envelope used canonical coordinator.")
    );
    try {
      const repair = await inventory.stock.recordHistorical({
        operationId: "historical-fast-repair",
        occurredAtEpochMs: time3,
        reason: "One piece was briefly missing and returned.",
        assertions: [
          {
            assertionId: "historical-fast-missing",
            assert: (plans) =>
              plans.markMissing({
                occurredAtEpochMs: time1,
                from: loosePosition("fast-store"),
                amount: stockAmount("1", "piece"),
              }),
          },
          {
            assertionId: "historical-fast-found",
            assert: (plans) =>
              plans.place({
                occurredAtEpochMs: time2,
                from: plans.outputOf("historical-fast-missing"),
                into: "fast-store",
                amount: stockAmount("1", "piece"),
              }),
          },
        ],
      });
      expect(repair.event.stockEffects).toEqual([]);
      expect(begin).not.toHaveBeenCalled();

      const correction = await inventory.stock.correct({
        operationId: "historical-fast-correction",
        occurredAtEpochMs: time3,
        correctsEventId: root.event.eventId,
        reason: "The original receipt contained four pieces.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: time0,
            to: loosePosition("fast-store"),
            amount: stockAmount("4", "piece"),
          }),
      });
      expect(correction.event.kind).toBe(InventoryEventKind.Correction);
      expect(begin).not.toHaveBeenCalled();
      expect(
        (
          await inventory.read.positions({
            itemId: "item-a",
            placementNodeIds: ["fast-store"],
          })
        )[0]?.measurements.primary.quantity.amountMinor
      ).toBe(4);
    } finally {
      begin.mockRestore();
    }
  });

  it("declines a stale segmented historical plan without publishing it", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog);
    const root = await inventory.stock.receive({
      operationId: "historical-stale-root",
      occurredAtEpochMs: time0,
      to: loosePosition("stale-store"),
      amount: stockAmount("2", "piece"),
    });
    const before = await inventory.read.world();
    const plan = await inventory.stock.planCorrection({
      operationId: "historical-stale-correction",
      occurredAtEpochMs: time2,
      correctsEventId: root.event.eventId,
      reason: "Only one piece was received.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("stale-store"),
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(plan.valid).toBe(true);
    if (!plan.valid) throw new Error(plan.conflict.message);

    await inventory.stock.receive({
      operationId: "historical-stale-racing-receipt",
      occurredAtEpochMs: time1,
      to: loosePosition("other-store"),
      amount: stockAmount("1", "piece"),
    });
    const committed = await storage.commitSegmentedStockEvent({
      catalog: inventoryCatalogSnapshot(catalog),
      operationId: plan.event.operationId,
      intentFingerprint: "historical-stale-intent",
      recordedAtEpochMs: time3,
      expectedWorldRevision: before.revision,
      expectedRecordSequence: before.projection.lastRecordSequence,
      deficitPolicy: InventoryDeficitPolicy.Reject,
      event: plan.event,
    });
    expect(committed).toBeUndefined();
    expect(
      (await inventory.read.events({
        kinds: [InventoryEventKind.Correction],
      })).events
    ).toEqual([]);
  });

  it("does not mutate segmented stock when journal validation rejects", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog);
    await inventory.stock.receive({
      operationId: "segmented-journal-reject-root",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const beforeWorld = await inventory.read.world();
    const plan = await inventory.stock.planHistorical({
      operationId: "segmented-journal-reject-stock",
      occurredAtEpochMs: time3,
      reason: "Build one net-zero missing-to-found repair.",
      assertions: [
        {
          assertionId: "segmented-journal-reject-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "segmented-journal-reject-found",
          assert: (plans) =>
            plans.place({
              occurredAtEpochMs: time2,
              from: plans.outputOf("segmented-journal-reject-missing"),
              into: "store",
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    expect(plan.valid).toBe(true);
    if (!plan.valid || plan.event.historicalRepair === undefined) {
      throw new Error("Expected one valid historical repair plan.");
    }
    expect(plan.event.stockEffects).toEqual([]);
    const beforeSegment = storage.readPositionSegment().materialize();
    const beforeSegmentRevision = storage.readPositionSegment().revision();
    const invalidEvent = {
      ...plan.event,
      historicalRepair: {
        ...plan.event.historicalRepair,
        omittedAssertionIds: ["assertion-that-does-not-exist"],
      },
    };

    await expect(
      storage.commitSegmentedStockEvent({
        catalog: inventoryCatalogSnapshot(catalog),
        operationId: invalidEvent.operationId,
        intentFingerprint: "segmented-journal-reject-stock-intent",
        recordedAtEpochMs: time3,
        expectedWorldRevision: beforeWorld.revision,
        expectedRecordSequence: beforeWorld.projection.lastRecordSequence,
        deficitPolicy: InventoryDeficitPolicy.Reject,
        event: invalidEvent,
      })
    ).rejects.toThrow("omits unknown assertion");

    expect(storage.readPositionSegment().revision()).toBe(
      beforeSegmentRevision
    );
    expect(storage.readPositionSegment().materialize()).toEqual(beforeSegment);
    expect((await storage.readWorld()).revision).toBe(beforeWorld.revision);
    expect(
      await storage.readOperation(invalidEvent.operationId)
    ).toBeUndefined();
  });

  it("does not mutate segmented placement when journal validation rejects", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog);
    await inventory.placement.define({
      operationId: "segmented-placement-source-definition",
      occurredAtEpochMs: time0,
      nodeId: "SEGMENTED-SOURCE",
      placementNode: { category: "cart", acceptsPlacement: true },
    });
    await inventory.placement.define({
      operationId: "segmented-placement-target-definition",
      occurredAtEpochMs: time0,
      nodeId: "SEGMENTED-TARGET",
      placementNode: { category: "room", acceptsPlacement: true },
    });
    const beforeWorld = await inventory.read.world();
    const beforePositions = storage.readPositionSegment().materialize();
    const beforePositionRevision = storage.readPositionSegment().revision();
    const beforePlacement = storage.readPlacementSegment().materialize();
    const beforePlacementRevision = storage.readPlacementSegment().revision();
    const journal = Reflect.get(storage, "eventJournal") as {
      /** Side-effect-free journal append validation owned by the reference adapter. */
      validateAppend(event: unknown): void;
    };
    const validate = vi.spyOn(journal, "validateAppend").mockImplementation(
      /** Simulate one future journal invariant rejecting before publication. */
      () => {
        throw new Error("synthetic journal rejection");
      }
    );
    try {
      await expect(
        storage.commitSegmentedPlacementChange({
          operationId: "segmented-placement-rejected",
          intentFingerprint: "segmented-placement-rejected-intent",
          catalog: inventoryCatalogSnapshot(catalog),
          recordedAtEpochMs: time2,
          occurredAtEpochMs: time1,
          nodeId: "SEGMENTED-SOURCE",
          toParentNodeId: "SEGMENTED-TARGET",
          expectedParent: null,
        })
      ).rejects.toThrow("synthetic journal rejection");
    } finally {
      validate.mockRestore();
    }

    expect(storage.readPositionSegment().revision()).toBe(
      beforePositionRevision
    );
    expect(storage.readPositionSegment().materialize()).toEqual(beforePositions);
    expect(storage.readPlacementSegment().revision()).toBe(
      beforePlacementRevision
    );
    expect(storage.readPlacementSegment().materialize()).toEqual(
      beforePlacement
    );
    expect((await storage.readWorld()).revision).toBe(beforeWorld.revision);
    expect(
      await storage.readOperation("segmented-placement-rejected")
    ).toBeUndefined();
  });

  it("does not publish canonical hot state when journal validation rejects", async () => {
    const storage = createInMemoryInventoryDurableStorage({
      /** Presence of this no-op failpoint keeps the operation on the staged coordinator path. */
      failpoint: () => undefined,
    });
    const inventory = createTestInventory(storage);
    const beforeWorld = await inventory.read.world();
    const beforePositions = storage.readPositionSegment().materialize();
    const beforePositionRevision = storage.readPositionSegment().revision();
    const beforePlacement = storage.readPlacementSegment().materialize();
    const beforePlacementRevision = storage.readPlacementSegment().revision();
    const journal = Reflect.get(storage, "eventJournal") as {
      /** Side-effect-free journal append validation owned by the reference adapter. */
      validateAppend(event: unknown): void;
    };
    const validate = vi.spyOn(journal, "validateAppend").mockImplementation(
      /** Simulate one journal invariant rejecting before canonical publication. */
      () => {
        throw new Error("synthetic canonical journal rejection");
      }
    );
    try {
      await expect(
        inventory.stock.receive({
          operationId: "canonical-journal-rejected",
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        })
      ).rejects.toThrow("synthetic canonical journal rejection");
    } finally {
      validate.mockRestore();
    }

    expect(storage.readPositionSegment().revision()).toBe(
      beforePositionRevision
    );
    expect(storage.readPositionSegment().materialize()).toEqual(beforePositions);
    expect(storage.readPlacementSegment().revision()).toBe(
      beforePlacementRevision
    );
    expect(storage.readPlacementSegment().materialize()).toEqual(
      beforePlacement
    );
    expect((await storage.readWorld()).revision).toBe(beforeWorld.revision);
    expect((await inventory.read.events()).events).toEqual([]);
  });

  it("publishes a correction with same-item claims and preserves the open-count path", async () => {
    {
      const storage = createInMemoryInventoryDurableStorage();
      const inventory = createTestInventory(storage);
      const root = await inventory.stock.receive({
        operationId: "historical-reservation-root",
        occurredAtEpochMs: time0,
        to: loosePosition("reservation-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.reservations.reserve({
        reservationId: "historical-reservation",
        operationId: "historical-reservation:create",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a" },
        requested: parseQuantity("2", "piece"),
        createdAtEpochMs: time1,
      });
      const begin = vi.spyOn(storage, "begin");
      try {
        await inventory.stock.correct({
          operationId: "historical-reservation-correction",
          occurredAtEpochMs: time2,
          correctsEventId: root.event.eventId,
          reason: "Only one piece was received.",
          replaceWith: (plans) =>
            plans.receive({
              occurredAtEpochMs: time0,
              to: loosePosition("reservation-store"),
              amount: stockAmount("1", "piece"),
            }),
        });
        expect(begin).not.toHaveBeenCalled();
        expect((await inventory.read.reservationFeasibility()).groups[0]?.shortage.amountMinor).toBe(1);
      } finally {
        begin.mockRestore();
      }
    }

    {
      const storage = createInMemoryInventoryDurableStorage();
      const inventory = createTestInventory(storage);
      const root = await inventory.stock.receive({
        operationId: "historical-count-root",
        occurredAtEpochMs: time0,
        to: loosePosition("count-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.counts.start({
        countId: "historical-active-count",
        operationId: "historical-active-count:start",
        selector: { itemId: "item-a" },
        startedAtEpochMs: time1,
      });
      const begin = vi.spyOn(storage, "begin");
      try {
        await inventory.stock.correct({
          operationId: "historical-count-correction",
          occurredAtEpochMs: time2,
          correctsEventId: root.event.eventId,
          reason: "Only one piece was received.",
          replaceWith: (plans) =>
            plans.receive({
              occurredAtEpochMs: time0,
              to: loosePosition("count-store"),
              amount: stockAmount("1", "piece"),
            }),
        });
        expect(begin).toHaveBeenCalled();
      } finally {
        begin.mockRestore();
      }
    }
  });

  it("rebuilds correction and historical-repair envelopes to the exact published projection", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog);
    const root = await inventory.stock.receive({
      operationId: "historical-rebuild-root",
      occurredAtEpochMs: time0,
      to: loosePosition("rebuild-store"),
      amount: stockAmount("4", "piece"),
    });
    await inventory.stock.recordHistorical({
      operationId: "historical-rebuild-repair",
      occurredAtEpochMs: time3,
      reason: "One piece was temporarily missing and recovered.",
      assertions: [
        {
          assertionId: "historical-rebuild-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("rebuild-store"),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "historical-rebuild-found",
          assert: (plans) =>
            plans.place({
              occurredAtEpochMs: time2,
              from: plans.outputOf("historical-rebuild-missing"),
              into: "rebuild-store",
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    await inventory.stock.correct({
      operationId: "historical-rebuild-correction",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "The opening receipt contained three pieces.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("rebuild-store"),
          amount: stockAmount("3", "piece"),
        }),
    });
    const world = await inventory.read.world();
    const rebuilt = projectInventoryEvents({
      catalog,
      events: Object.values(world.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt).toEqual(world.projection);
  });

  it("plans conflicts without writes and commits one atomic missing-to-found repair", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "historical-repair-receive-ten",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.issue({
      operationId: "historical-repair-issue-nine",
      occurredAtEpochMs: time3,
      from: loosePosition("store"),
      amount: stockAmount("9", "piece"),
    });
    const before = await inventory.read.world();

    const invalid = await inventory.stock.planHistorical({
      operationId: "historical-repair-missing-only",
      occurredAtEpochMs: time3,
      reason: "Two pieces likely fell from the cart and were temporarily unaccounted for.",
      assertions: [
        {
          assertionId: "cart-missing-two",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("2", "piece"),
            }),
        },
      ],
    });
    expect(invalid).toMatchObject({
      valid: false,
      basedOnWorldRevision: before.revision,
      conflict: { code: "negative-stock" },
    });
    expect((await inventory.read.world()).revision).toBe(before.revision);

    const repairInput = {
      operationId: "historical-repair-missing-and-found",
      occurredAtEpochMs: time3,
      reason: "Two pieces fell from the cart and were returned before later issue.",
      assertions: [
        {
          assertionId: "cart-missing-two",
          assert: (plans: Parameters<typeof inventory.stock.planHistorical>[0]["assertions"][number]["assert"] extends (plans: infer Plans) => unknown ? Plans : never) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("2", "piece"),
            }),
        },
        {
          assertionId: "cart-found-two",
          assert: (plans: Parameters<typeof inventory.stock.planHistorical>[0]["assertions"][number]["assert"] extends (plans: infer Plans) => unknown ? Plans : never) =>
            plans.place({
              occurredAtEpochMs: time2,
              from: plans.outputOf("cart-missing-two"),
              into: "store",
              amount: stockAmount("2", "piece"),
            }),
        },
      ],
    };
    const planned = await inventory.stock.planHistorical(repairInput);
    expect(planned.valid).toBe(true);
    if (!planned.valid) throw new Error(planned.conflict.message);
    expect(planned.event.kind).toBe(InventoryEventKind.HistoricalRepair);
    expect(planned.event.stockEffects).toEqual([]);
    expect(planned.event.historicalRepair?.assertions).toHaveLength(2);
    expect(planned.impact.deficits).toEqual([]);
    expect((await inventory.read.world()).revision).toBe(before.revision);

    const committed = await inventory.stock.recordHistorical(repairInput);
    expect(committed.event.kind).toBe(InventoryEventKind.HistoricalRepair);
    expect(committed.event.historicalRepair).toEqual(
      planned.event.historicalRepair
    );
    expect(committed.event.historicalImpact).toEqual(planned.impact);
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(1);
    expect(await inventory.read.whereabouts()).toEqual([]);
    const history = await inventory.read.whereaboutsHistory({
      actions: [InventoryWhereaboutsAction.HistoricallyRepaired],
      resolved: true,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.itemIds).toEqual(["item-a"]);
    expect(history[0]?.history[0]?.actions).toEqual(
      expect.arrayContaining([
        InventoryWhereaboutsAction.HistoricallyRepaired,
        InventoryWhereaboutsAction.MarkedMissing,
        InventoryWhereaboutsAction.Placed,
      ])
    );

    const replay = await inventory.stock.recordHistorical(repairInput);
    expect(replay.replayed).toBe(true);
    await expect(
      inventory.stock.recordHistorical({
        ...repairInput,
        reason: "Changed retry intent.",
      })
    ).rejects.toThrow("changed intent");
  });

  it("does not fabricate a cohort reclassification from unrelated assertions in one historical repair", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "historical-cohort-unrelated-seed",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("4", "piece"),
    });
    const repair = await inventory.stock.recordHistorical({
      operationId: "historical-cohort-unrelated-repair",
      occurredAtEpochMs: time3,
      reason: "Record one missing piece and a separate receipt from another source.",
      assertions: [
        {
          assertionId: "historical-cohort-one-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "historical-unrelated-receipt",
          assert: (plans) =>
            plans.receive({
              occurredAtEpochMs: time2,
              to: loosePosition("unrelated-store"),
              amount: stockAmount("2", "piece"),
            }),
        },
      ],
    });
    expect(repair.event.historicalRepair?.assertions).toHaveLength(2);

    const lifecycles = await inventory.read.whereaboutsHistory({
      actions: [InventoryWhereaboutsAction.HistoricallyRepaired],
    });
    expect(lifecycles).toHaveLength(1);
    const cohort = lifecycles[0];
    if (cohort === undefined) throw new Error("Missing repaired whereabouts cohort.");
    const repairActions = cohort.history.find(
      (entry) => entry.event.eventId === repair.event.eventId
    )?.actions;
    expect(repairActions).toEqual([
      InventoryWhereaboutsAction.HistoricallyRepaired,
      InventoryWhereaboutsAction.MarkedMissing,
    ]);
    expect(
      await inventory.read.whereaboutsHistory({
        whereaboutsIds: [cohort.whereaboutsId],
        actions: [InventoryWhereaboutsAction.Reclassified],
      })
    ).toEqual([]);
  });

  it("preserves a recorded serialized deficit interval when correcting a later unrelated serial receipt under Reject", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const recorder = createTestInventory(
      storage,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    const serial = loosePosition("serial-store", { serialId: "RECORDED-OLD-SHORTAGE" });
    await recorder.stock.issue({
      operationId: "recorded-old-serial-shortage",
      occurredAtEpochMs: time0,
      from: serial,
      amount: stockAmount("1", "piece"),
    });
    await recorder.stock.receive({
      operationId: "settle-old-serial-shortage",
      occurredAtEpochMs: time1,
      to: serial,
      amount: stockAmount("1", "piece"),
    });
    const later = await recorder.stock.receive({
      operationId: "later-separate-serial-receipt",
      occurredAtEpochMs: time2,
      to: serial,
      amount: stockAmount("1", "piece"),
    });

    // The previously recorded negative interval remains unchanged. Only the
    // later positive receipt's placement was wrong, so no new shortfall exists.
    const strict = createTestInventory(storage);
    const plan = await strict.stock.planCorrection({
      operationId: "correct-later-serial-placement",
      occurredAtEpochMs: time3,
      correctsEventId: later.event.eventId,
      reason: "The received serial was placed in the adjacent bin.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time2,
          to: loosePosition("adjacent-bin", { serialId: "RECORDED-OLD-SHORTAGE" }),
          amount: stockAmount("1", "piece"),
        }),
    });
    if (!plan.valid) throw new Error(plan.conflict.code + ": " + plan.conflict.message);
    expect(plan.valid).toBe(true);
    expect(plan.event.historicalImpact?.deficits).toEqual([]);

    const corrected = await strict.stock.correct({
      operationId: "correct-later-serial-placement",
      occurredAtEpochMs: time3,
      correctsEventId: later.event.eventId,
      reason: "The received serial was placed in the adjacent bin.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time2,
          to: loosePosition("adjacent-bin", { serialId: "RECORDED-OLD-SHORTAGE" }),
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(corrected.event.kind).toBe(InventoryEventKind.Correction);
    const serialRows = await strict.read.positions({ itemId: "item-a" });
    expect(serialRows).toHaveLength(1);
    expect(serialRows[0]?.key.placementNodeId).toBe("adjacent-bin");
    expect(serialRows[0]?.measurements.primary.quantity.amountMinor).toBe(1);
  });

  it("rejects a negative serialized historical assertion even under Record policy", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    const plan = await inventory.stock.planHistorical({
      operationId: "historical-serialized-deficit",
      occurredAtEpochMs: time2,
      reason: "A serialized unit was reportedly issued before any accountable receipt.",
      assertions: [
        {
          assertionId: "unsupported-serial-issue",
          assert: (plans) =>
            plans.issue({
              occurredAtEpochMs: time1,
              from: loosePosition("store", { serialId: "SERIAL-MISSING" }),
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    expect(plan).toMatchObject({
      valid: false,
      conflict: { code: "serialized-deficit" },
    });
  });

  it("can append-only omit earlier historical assertions without changing ordinary APIs", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "historical-omit-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("3", "piece"),
    });
    const first = await inventory.stock.recordHistorical({
      operationId: "historical-omit-first",
      occurredAtEpochMs: time3,
      reason: "A one-piece temporary loss was initially asserted.",
      assertions: [
        {
          assertionId: "temporary-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "temporary-found",
          assert: (plans) =>
            plans.place({
              occurredAtEpochMs: time2,
              from: plans.outputOf("temporary-missing"),
              into: "store",
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    expect(first.event.historicalRepair?.assertions).toHaveLength(2);

    const second = await inventory.stock.recordHistorical({
      operationId: "historical-omit-second",
      occurredAtEpochMs: time3,
      reason: "Audit showed the temporary loss report belonged to another item.",
      assertions: [],
      omittedAssertionIds: ["temporary-missing", "temporary-found"],
    });
    expect(second.event.historicalRepair?.omittedAssertionIds).toEqual([
      "temporary-found",
      "temporary-missing",
    ]);
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(3);
    expect(await inventory.read.whereabouts()).toEqual([]);
  });

  it("does not add empty historical fields to ordinary event shapes", async () => {
    const inventory = createTestInventory();
    const receipt = await inventory.stock.receive({
      operationId: "ordinary-shape-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });

    expect(Object.hasOwn(receipt.event, "historicalRepair")).toBe(false);
    expect(Object.hasOwn(receipt.event, "historicalImpact")).toBe(false);
    expect(Object.hasOwn(receipt.event, "correctionReplacement")).toBe(false);
  });

  it("does not flatten replacement callback failures into domain conflicts", async () => {
    const inventory = createTestInventory();
    const receipt = await inventory.stock.receive({
      operationId: "callback-failure-root",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const before = await inventory.read.world();

    await expect(
      inventory.stock.planCorrection({
        operationId: "callback-failure-plan",
        occurredAtEpochMs: time1,
        correctsEventId: receipt.event.eventId,
        reason: "Exercise caller failure propagation.",
        replaceWith: () => {
          throw new TypeError("application replacement callback failed");
        },
      })
    ).rejects.toThrow("application replacement callback failed");
    expect((await inventory.read.world()).revision).toBe(before.revision);
  });

  it("lets a late historical receipt clear a current recorded deficit without inventing a count", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "late-source-issue",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    const repair = {
      operationId: "late-source-repair",
      occurredAtEpochMs: time3,
      reason: "The five-piece source receipt was entered late.",
      assertions: [
        {
          assertionId: "late-source-receipt",
          assert: (plans: Parameters<
            typeof inventory.stock.planHistorical
          >[0]["assertions"][number]["assert"] extends (
            plans: infer Plans
          ) => unknown
            ? Plans
            : never) =>
            plans.receive({
              occurredAtEpochMs: time0,
              to: loosePosition("store"),
              amount: stockAmount("5", "piece"),
            }),
        },
      ],
    };
    const plan = await inventory.stock.planHistorical(repair);
    expect(plan.valid).toBe(true);
    if (!plan.valid) throw new Error(plan.conflict.message);
    expect(plan.impact.deficits).toEqual([]);

    await inventory.stock.recordHistorical(repair);
    const availability = await inventory.read.availability({
      itemId: "item-a",
      placementNodeIds: ["store"],
    });
    expect(availability.revisions[0]?.onHand.primary.quantity.amountMinor).toBe(0);
    expect(availability.revisions[0]?.deficit.primary.quantity.amountMinor).toBe(0);
    expect(
      (await inventory.read.events({ kinds: [InventoryEventKind.CountAdjustment] }))
        .events
    ).toEqual([]);
  });


  it("reports a hard identity conflict when a serial was historically missing before an unrepaired transfer", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "serial-gap-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a", { serialId: "SERIAL-GAP" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "serial-gap-transfer",
      occurredAtEpochMs: time2,
      from: loosePosition("a", { serialId: "SERIAL-GAP" }),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    });

    const plan = await inventory.stock.planHistorical({
      operationId: "serial-gap-repair",
      occurredAtEpochMs: time3,
      reason: "The serialized unit was reported missing before its transfer.",
      assertions: [
        {
          assertionId: "serial-gap-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("a", { serialId: "SERIAL-GAP" }),
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });

    expect(plan.valid).toBe(false);
    if (plan.valid) throw new Error("Missing serial history must conflict.");
    expect(["negative-stock", "serialized-deficit"]).toContain(plan.conflict.code);
    expect(
      (await inventory.read.positions({ itemId: "item-a", serialIds: ["SERIAL-GAP"] }))[0]
        ?.key.placementNodeId
    ).toBe("b");
  });

  /** Derived embodied retirement is stock lifecycle, not an asserted metadata edit. */
  it("permits a late embodied scrap to retire its node without editing metadata", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "late-embodied-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "late-embodied-individualize",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "LATE-CAB",
      asPlacementNode: { category: "cabinet" },
    });
    const before = await inventory.read.world();
    const metadataBefore = before.projection.placementNodes["LATE-CAB"];
    expect(metadataBefore?.retiredByEventId).toBeUndefined();

    const input = {
      operationId: "late-embodied-scrap-repair",
      occurredAtEpochMs: time3,
      reason: "The individualized cabinet was scrapped earlier.",
      assertions: [{
        assertionId: "late-embodied-scrap",
        assert: (plans: Parameters<
          typeof inventory.stock.recordHistorical
        >[0]["assertions"][number]["assert"] extends (plans: infer Plans) => unknown
          ? Plans
          : never) => plans.scrap({
            occurredAtEpochMs: time2,
            from: loosePosition("store", { serialId: "LATE-CAB" }),
            amount: stockAmount("1", "piece"),
            reason: "Physical retirement verified after the fact.",
          }),
      }],
    };

    const planned = await inventory.stock.planHistorical(input);
    if (!planned.valid) throw new Error(planned.conflict.message);
    expect(planned.valid).toBe(true);
    expect(planned.event.lotDefinitions).toEqual([]);
    expect(planned.event.placementNodeDefinitions).toEqual([]);
    expect((await inventory.read.world()).revision).toBe(before.revision);

    const committed = await inventory.stock.recordHistorical(input);
    const retired = await inventory.read.placementNode("LATE-CAB");
    expect(retired?.definition).toEqual(metadataBefore?.definition);
    expect(retired?.rootEventId).toBe(metadataBefore?.rootEventId);
    expect(retired?.retiredByEventId).toBeDefined();
    expect(await inventory.read.positions({
      itemId: "item-a",
      serialIds: ["LATE-CAB"],
    })).toEqual([]);
    await expect(inventory.stock.receive({
      operationId: "reject-ordinary-revival-of-late-cab",
      occurredAtEpochMs: time3,
      to: loosePosition("store", { serialId: "LATE-CAB" }),
      amount: stockAmount("1", "piece"),
    })).rejects.toThrow();
    expect((await inventory.stock.recordHistorical(input)).replayed).toBe(true);
    const world = await inventory.read.world();
    const rebuilt = projectInventoryEvents({
      catalog: createTabletCatalog(),
      events: Object.values(world.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt.placementNodes["LATE-CAB"]?.retiredByEventId).toBe(
      retired?.retiredByEventId
    );
    expect(committed.event.kind).toBe(InventoryEventKind.HistoricalRepair);

    // Correcting the asserted history can restore the same immutable master.
    await inventory.stock.recordHistorical({
      operationId: "late-embodied-scrap-omission",
      occurredAtEpochMs: time3,
      reason: "A later inspection confirmed this cabinet had not been scrapped.",
      assertions: [],
      omittedAssertionIds: ["late-embodied-scrap"],
    });
    const revived = await inventory.read.placementNode("LATE-CAB");
    expect(revived?.definition).toEqual(metadataBefore?.definition);
    expect(revived?.rootEventId).toBe(metadataBefore?.rootEventId);
    expect(revived?.retiredByEventId).toBeUndefined();
    expect(await inventory.read.positions({
      itemId: "item-a",
      serialIds: ["LATE-CAB"],
    })).toHaveLength(1);
    const restoredWorld = await inventory.read.world();
    expect(projectInventoryEvents({
      catalog: createTabletCatalog(),
      events: Object.values(restoredWorld.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })).toEqual(restoredWorld.projection);
  });

  it("fails closed when v1 historical repair would introduce metadata masters", async () => {
    const inventory = createTestInventory();
    const plan = await inventory.stock.planHistorical({
      operationId: "metadata-boundary-repair",
      occurredAtEpochMs: time3,
      reason: "Exercise the v1 metadata boundary.",
      assertions: [
        {
          assertionId: "metadata-boundary-receipt",
          assert: (plans) =>
            plans.receive({
              occurredAtEpochMs: time1,
              to: loosePosition("store", { lotId: "NEW-HISTORICAL-LOT" }),
              amount: stockAmount("1", "piece"),
              lot: { expiresAtEpochMs: time3 + 10_000 },
            }),
        },
      ],
    });

    expect(plan.valid).toBe(false);
    if (plan.valid) throw new Error("Metadata-changing repair must fail closed.");
    expect(plan.conflict.code).toBe("invalid-history");
    expect(plan.conflict.message).toContain(
      "cannot create/change lot or placement-node metadata"
    );
  });

  it("records one late scrap idempotently through ordinary scrap semantics", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "late-scrap-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("3", "piece"),
    });
    const input = {
      operationId: "late-scrap-repair",
      occurredAtEpochMs: time3,
      reason: "Audit showed one piece was discarded earlier.",
      assertions: [
        {
          assertionId: "late-scrap-assertion",
          assert: (plans: Parameters<
            typeof inventory.stock.recordHistorical
          >[0]["assertions"][number]["assert"] extends (
            plans: infer Plans
          ) => unknown
            ? Plans
            : never) =>
            plans.scrap({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
              reason: "Discarded from the shaky cart.",
            }),
        },
      ],
    };

    const first = await inventory.stock.recordHistorical(input);
    expect(first.event.historicalRepair?.assertions[0]?.event.kind).toBe(
      InventoryEventKind.Scrap
    );
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(2);
    const replay = await inventory.stock.recordHistorical(input);
    expect(replay.replayed).toBe(true);
    expect(replay.event).toEqual(first.event);
    await expect(
      inventory.stock.recordHistorical({
        ...input,
        reason: "Changed historical scrap intent.",
      })
    ).rejects.toThrow("changed intent");
  });


  it("uses an explicit same-time anchor and rejects a missing anchor", async () => {
    const inventory = createTestInventory();
    const received = await inventory.stock.receive({
      operationId: "anchor-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a", { serialId: "SERIAL-ANCHOR" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "anchor-transfer",
      occurredAtEpochMs: time1,
      from: loosePosition("a", { serialId: "SERIAL-ANCHOR" }),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    });

    const anchored = await inventory.stock.planHistorical({
      operationId: "anchor-repair",
      occurredAtEpochMs: time3,
      reason: "Force the assertion between receive and transfer.",
      assertions: [
        {
          assertionId: "anchor-missing",
          afterEventId: received.event.eventId,
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("a", { serialId: "SERIAL-ANCHOR" }),
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    expect(anchored.valid).toBe(false);

    const missingAnchor = await inventory.stock.planHistorical({
      operationId: "missing-anchor-repair",
      occurredAtEpochMs: time3,
      reason: "Reject an unknown ordering anchor.",
      assertions: [
        {
          assertionId: "missing-anchor-assertion",
          afterEventId: "event-that-does-not-exist",
          assert: (plans) =>
            plans.receive({
              occurredAtEpochMs: time1,
              to: loosePosition("a"),
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    expect(missingAnchor).toMatchObject({
      valid: false,
      conflict: { code: "missing-anchor" },
    });
  });

  it("rejects generic correction of a historical repair envelope", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "repair-envelope-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const repair = await inventory.stock.recordHistorical({
      operationId: "repair-envelope",
      occurredAtEpochMs: time2,
      reason: "One piece was historically missing.",
      assertions: [
        {
          assertionId: "repair-envelope-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });

    await expect(
      inventory.stock.correct({
        operationId: "repair-envelope-generic-correction",
        occurredAtEpochMs: time3,
        correctsEventId: repair.event.eventId,
        reason: "Historical repair must be superseded through its own semantics.",
        replaceWith: (plans) => plans.omit(),
      })
    ).rejects.toThrow(/historical repair|HistoricalRepair|historical-repair/iu);
  });

  it("rejects duplicate assertion identities without writing", async () => {
    const inventory = createTestInventory();
    const before = await inventory.read.world();
    await expect(
      inventory.stock.planHistorical({
        operationId: "duplicate-assertion-repair",
        occurredAtEpochMs: time3,
        reason: "Duplicate assertion identities are ambiguous.",
        assertions: [
          {
            assertionId: "duplicate-id",
            assert: (plans) =>
              plans.receive({
                occurredAtEpochMs: time0,
                to: loosePosition("store"),
                amount: stockAmount("1", "piece"),
              }),
          },
          {
            assertionId: "duplicate-id",
            assert: (plans) =>
              plans.receive({
                occurredAtEpochMs: time1,
                to: loosePosition("store"),
                amount: stockAmount("1", "piece"),
              }),
          },
        ],
      })
    ).rejects.toThrow("repeats assertionId");
    expect((await inventory.read.world()).revision).toBe(before.revision);
  });


  it("preserves caller order for same-time assertions instead of sorting by assertionId", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "same-time-order-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });

    const plan = await inventory.stock.planHistorical({
      operationId: "same-time-order-repair",
      occurredAtEpochMs: time3,
      reason: "The item was reported missing and found during one audit interval.",
      assertions: [
        {
          assertionId: "z-missing-first",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "a-found-second",
          assert: (plans) =>
            plans.place({
              occurredAtEpochMs: time1,
              from: plans.outputOf("z-missing-first"),
              into: "store",
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });

    expect(plan.valid).toBe(true);
    if (!plan.valid) throw new Error(plan.conflict.message);
    expect(plan.impact.deficits).toEqual([]);
  });

  it("replaces one earlier repair assertion explicitly without retaining stale effects", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "repair-replace-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    await inventory.stock.recordHistorical({
      operationId: "repair-replace-first",
      occurredAtEpochMs: time3,
      reason: "Initial audit estimated two discarded pieces.",
      assertions: [
        {
          assertionId: "initial-two-piece-scrap",
          assert: (plans) =>
            plans.scrap({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("2", "piece"),
              reason: "Initial historical write-off.",
            }),
        },
      ],
    });
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(3);

    await inventory.stock.recordHistorical({
      operationId: "repair-replace-second",
      occurredAtEpochMs: time3,
      reason: "Later evidence showed only one piece was discarded.",
      omittedAssertionIds: ["initial-two-piece-scrap"],
      assertions: [
        {
          assertionId: "final-one-piece-scrap",
          assert: (plans) =>
            plans.scrap({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
              reason: "Final historical write-off.",
            }),
        },
      ],
    });
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(4);
    await expect(
      inventory.stock.planHistorical({
        operationId: "repair-replace-third",
        occurredAtEpochMs: time3,
        reason: "The already removed assertion cannot be omitted twice.",
        omittedAssertionIds: ["initial-two-piece-scrap"],
        assertions: [],
      })
    ).resolves.toMatchObject({
      valid: false,
      conflict: { code: "invalid-history" },
    });
  });

});
