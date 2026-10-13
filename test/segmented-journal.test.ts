import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  createInMemoryInventorySegmentedEventJournal,
} from "../src/segmented-journal.js";
import {
  InventoryEventKind,
  type InventoryCommittedEvent,
} from "../src/events.js";
import {
  InventoryStockWhereaboutsState,
} from "../src/model.js";
import {
  inventoryMeasurement,
  inventoryMeasurementVector,
} from "../src/measurements.js";
import { parseQuantity } from "../src/quantity.js";
import { stockAmount } from "../src/amounts.js";
import { createTestInventory, loosePosition, time0, time1, time2 } from "./test-fixtures.js";

/** Build one already-committed event fact for journal/index tests. */
function committedEvent(
  sequence: number,
  input: {
    readonly whereaboutsId?: string;
    readonly correction?: InventoryCommittedEvent["correction"];
  } = {}
): InventoryCommittedEvent {
  return {
    eventId: "event-" + sequence,
    operationId: "operation-" + sequence,
    kind:
      input.correction === undefined
        ? InventoryEventKind.Placement
        : InventoryEventKind.Correction,
    occurredAtEpochMs: sequence,
    recordedAtEpochMs: sequence + 1_000_000,
    recordSequence: sequence,
    stockEffects:
      input.whereaboutsId === undefined
        ? []
        : [
            {
              itemRevisionId: "item-a-v2",
              position: {
                itemId: "item-a",
                itemRevisionId: "item-a-v2",
                whereaboutsId: input.whereaboutsId,
                whereaboutsState: InventoryStockWhereaboutsState.Detached,
                lastPlacementNodeId: "store",
                detachedAtEpochMs: sequence,
              },
              measurementsDelta: inventoryMeasurementVector(
                inventoryMeasurement(
                  "pieces",
                  parseQuantity("1", "piece")
                )
              ),
            },
          ],
    traceabilityChanges: [],
    ...(input.correction === undefined
      ? {}
      : { correction: input.correction }),
  };
}

/** Append many tiny events and return average hot append time over the tail. */
function benchmarkJournalAppend(
  eventCount: number,
  measuredTail: number
): number {
  const journal = createInMemoryInventorySegmentedEventJournal();
  const started = performance.now();
  let tailStarted = started;
  for (let sequence = 1; sequence <= eventCount; sequence += 1) {
    if (sequence === eventCount - measuredTail + 1) {
      tailStarted = performance.now();
    }
    journal.append(committedEvent(sequence));
  }
  return (performance.now() - tailStarted) / measuredTail;
}

describe("segmented inventory event journal", () => {
  it("indexes operation, sequence, whereabouts, and current correction without flat-world scans", () => {
    const journal = createInMemoryInventorySegmentedEventJournal();
    const root = committedEvent(1, { whereaboutsId: "W-1" });
    const firstCorrection = committedEvent(2, {
      correction: {
        correctsEventId: root.eventId,
        reason: "first correction",
      },
    });
    const secondCorrection = committedEvent(3, {
      correction: {
        correctsEventId: root.eventId,
        supersedesCorrectionEventId: firstCorrection.eventId,
        reason: "second correction",
      },
    });

    journal.append(root);
    const rootBeforeCorrection = journal.contentRoot();
    journal.append(firstCorrection);
    journal.append(secondCorrection);

    expect(journal.lastRecordSequence()).toBe(3);
    expect(journal.event(root.eventId)).toEqual(root);
    expect(journal.eventByOperation("operation-1")).toEqual(root);
    expect(journal.eventBySequence(1)).toEqual(root);
    expect(journal.sequencesForWhereabouts("W-1")).toEqual([1, 2, 3]);
    expect(journal.currentCorrectionFor(root.eventId)).toEqual(
      secondCorrection
    );
    expect(journal.contentRoot()).not.toBe(rootBeforeCorrection);

    const materialized = journal.materialize();
    expect(materialized.events[root.eventId]).toEqual(root);
    expect(materialized.eventIdsBySequence["3"]).toBe(
      secondCorrection.eventId
    );
    expect(materialized.eventIdByOperationId["operation-2"]).toBe(
      firstCorrection.eventId
    );
    expect(materialized.eventSequencesByWhereaboutsId["W-1"]).toEqual([
      1, 2, 3,
    ]);
    expect(
      materialized.correctionEventIdByCorrectedEventId[root.eventId]
    ).toBe(secondCorrection.eventId);

    const rebuilt = createInMemoryInventorySegmentedEventJournal({
      events: Object.values(materialized.events),
    });
    expect(rebuilt.contentRoot()).toBe(journal.contentRoot());
    expect(rebuilt.materialize()).toEqual(materialized);
  });

  it("indexes both root and direct correction cohorts without duplicate sequences", () => {
    const journal = createInMemoryInventorySegmentedEventJournal();
    const root = committedEvent(1, { whereaboutsId: "W-1" });
    const firstCorrection = committedEvent(2, {
      whereaboutsId: "W-2",
      correction: {
        correctsEventId: root.eventId,
        reason: "Correction touches another cohort",
      },
    });
    const secondCorrection = committedEvent(3, {
      whereaboutsId: "W-1",
      correction: {
        correctsEventId: root.eventId,
        supersedesCorrectionEventId: firstCorrection.eventId,
        reason: "Correction also touches its root cohort directly",
      },
    });

    journal.append(root);
    journal.append(firstCorrection);
    journal.append(secondCorrection);

    expect(journal.sequencesForWhereabouts("W-1")).toEqual([1, 2, 3]);
    expect(journal.sequencesForWhereabouts("W-2")).toEqual([2]);
    const materialized = journal.materialize();
    expect(materialized.eventSequencesByWhereaboutsId["W-1"]).toEqual([1, 2, 3]);
    expect(materialized.eventSequencesByWhereaboutsId["W-2"]).toEqual([2]);
  });

  it("materializes the same cohort history as the canonical projection after correcting a detach", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "journal-parity-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("5", "piece"),
    });
    const detached = await inventory.stock.detach({
      operationId: "journal-parity-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.correct({
      operationId: "journal-parity-correct",
      correctsEventId: detached.event.eventId,
      occurredAtEpochMs: time2,
      reason: "Audit shows these units were issued, not detached.",
      replaceWith: (plans) =>
        plans.issue({
          occurredAtEpochMs: time1,
          from: loosePosition("store"),
          amount: stockAmount("2", "piece"),
        }),
    });
    const projection = (await inventory.read.world()).projection;
    const journal = createInMemoryInventorySegmentedEventJournal({
      events: Object.values(projection.events).reverse(),
    });
    const materialized = journal.materialize();
    expect(materialized.eventSequencesByWhereaboutsId).toEqual(
      projection.eventSequencesByWhereaboutsId
    );
    expect(materialized.correctionEventIdByCorrectedEventId).toEqual(
      projection.correctionEventIdByCorrectedEventId
    );
    const whereaboutsId = detached.event.stockEffects.find(
      (effect) => effect.position.whereaboutsId !== undefined
    )?.position.whereaboutsId;
    if (whereaboutsId === undefined) {
      throw new Error("Detached source did not establish a cohort.");
    }
    expect(journal.sequencesForWhereabouts(whereaboutsId)).toEqual([2, 3]);
  });

  it("fails closed on sequence, operation, and correction ownership conflicts", () => {
    const journal = createInMemoryInventorySegmentedEventJournal();
    const root = committedEvent(1);
    journal.append(root);

    expect(() => journal.append(committedEvent(3))).toThrow(
      "recordSequence 2"
    );
    expect(() =>
      journal.append({
        ...committedEvent(2),
        operationId: root.operationId,
      })
    ).toThrow("operationId");

    journal.append(
      committedEvent(2, {
        correction: {
          correctsEventId: root.eventId,
          reason: "first",
        },
      })
    );
    expect(() =>
      journal.append(
        committedEvent(3, {
          correction: {
            correctsEventId: root.eventId,
            reason: "missing supersession",
          },
        })
      )
    ).toThrow("must supersede");
  });

  it(
    "keeps append cost effectively independent of 10k vs 100k retained events",
    () => {
      const baselineMs = benchmarkJournalAppend(10_000, 1_000);
      const warehouseMs = benchmarkJournalAppend(100_000, 1_000);
      expect(warehouseMs).toBeLessThan(baselineMs * 5 + 0.1);
      console.log(
        JSON.stringify({
          adapter: "segmented-event-journal",
          baselineEvents: 10_000,
          warehouseEvents: 100_000,
          baselineTailAverageAppendMs: baselineMs,
          warehouseTailAverageAppendMs: warehouseMs,
        })
      );
    },
    30_000
  );
});
