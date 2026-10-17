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
  inventoryEventDependencyIndexKeys,
  inventoryEventResourceKeys,
} from "../src/event-query.js";
import {
  InventoryStockWhereaboutsState,
} from "../src/model.js";
import {
  InventoryDeficitPolicy,
  projectInventoryEvents,
} from "../src/projection.js";
import {
  inventoryMeasurement,
  inventoryMeasurementVector,
} from "../src/measurements.js";
import { parseQuantity } from "../src/quantity.js";
import { stockAmount } from "../src/amounts.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
} from "./test-fixtures.js";

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

  it("indexes historical-impact-only cohorts exactly like the canonical projection", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "impact-only-root",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const correction = await inventory.stock.correct({
      operationId: "impact-only-correction",
      occurredAtEpochMs: time1,
      correctsEventId: root.event.eventId,
      reason: "Keep current stock unchanged while retaining impacted cohort evidence.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        }),
    });
    const impactedWhereaboutsId = "IMPACT-ONLY-COHORT";
    const impactedCorrection = {
      ...correction.event,
      historicalImpact: {
        affectedEventIds:
          correction.event.historicalImpact?.affectedEventIds ?? [
            root.event.eventId,
          ],
        whereaboutsIds: [impactedWhereaboutsId],
        deficits: correction.event.historicalImpact?.deficits ?? [],
      },
    };
    const events = [root.event, impactedCorrection];
    const projection = projectInventoryEvents({
      catalog: createTabletCatalog(),
      events,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const journal = createInMemoryInventorySegmentedEventJournal({ events });

    expect(journal.sequencesForWhereabouts(impactedWhereaboutsId)).toEqual(
      projection.eventSequencesByWhereaboutsId[impactedWhereaboutsId]
    );
    expect(journal.materialize().eventSequencesByWhereaboutsId).toEqual(
      projection.eventSequencesByWhereaboutsId
    );
  });

  it("leaves assertion indexes unchanged when one repair append is rejected", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "journal-atomic-root",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const repair = await inventory.stock.recordHistorical({
      operationId: "journal-atomic-repair",
      occurredAtEpochMs: time2,
      reason: "One piece was historically discarded.",
      assertions: [
        {
          assertionId: "journal-atomic-scrap",
          assert: (plans) =>
            plans.scrap({
              occurredAtEpochMs: time1,
              from: loosePosition("store"),
              amount: stockAmount("1", "piece"),
              reason: "Historical disposal.",
            }),
        },
      ],
    });
    const journal = createInMemoryInventorySegmentedEventJournal({
      events: [root.event, repair.event],
    });
    const beforeRoot = journal.contentRoot();
    const beforeMaterialized = journal.materialize();
    const rejected = {
      ...repair.event,
      eventId: "journal-atomic-rejected",
      operationId: "journal-atomic-rejected",
      recordedAtEpochMs: time2 + 1,
      recordSequence: 3,
      historicalRepair: {
        assertions: [],
        omittedAssertionIds: [
          "journal-atomic-scrap",
          "journal-atomic-missing",
        ],
      },
    };

    expect(() => journal.append(rejected)).toThrow("omits unknown assertion");
    expect(journal.lastRecordSequence()).toBe(2);
    expect(journal.contentRoot()).toBe(beforeRoot);
    expect(journal.materialize()).toEqual(beforeMaterialized);

    journal.append({
      ...rejected,
      eventId: "journal-atomic-valid",
      operationId: "journal-atomic-valid",
      historicalRepair: {
        assertions: [],
        omittedAssertionIds: ["journal-atomic-scrap"],
      },
    });
    expect(journal.lastRecordSequence()).toBe(3);
    expect(journal.eventBySequence(3)?.eventId).toBe("journal-atomic-valid");
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

  /** Bounded pages must not enumerate all prior indexed postings on each request. */
  it("pages overlapping resource postings without scanning retained history", () => {
    const journal = createInMemoryInventorySegmentedEventJournal();
    const root = committedEvent(1, { whereaboutsId: "HOT-COHORT" });
    const second = committedEvent(2, { whereaboutsId: "HOT-COHORT" });
    const secondKeys = new Set([
      ...inventoryEventDependencyIndexKeys(second),
      ...inventoryEventResourceKeys(second),
    ]);
    const commonKeys = [
      ...inventoryEventDependencyIndexKeys(root),
      ...inventoryEventResourceKeys(root),
    ].filter((key) => secondKeys.has(key));
    expect(commonKeys.length).toBeGreaterThanOrEqual(2);
    const selectedKeys = [...new Set(commonKeys)].slice(0, 2);
    for (let sequence = 1; sequence <= 1_200; sequence += 1) {
      journal.append(committedEvent(sequence, { whereaboutsId: "HOT-COHORT" }));
    }

    // A read-only proxy on the real posting index witnesses work, not wall-clock noise.
    const storedIndex: unknown = Reflect.get(journal, "sequencesByResourceKey");
    if (!(storedIndex instanceof Map)) {
      throw new Error("Expected an indexed segmented journal.");
    }
    let visitedPostings = 0;
    for (const key of selectedKeys) {
      const rows: readonly number[] | undefined = storedIndex.get(key);
      if (rows === undefined) throw new Error("Missing retained resource posting.");
      storedIndex.set(
        key,
        new Proxy(rows, {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) {
              visitedPostings += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        })
      );
    }
    const first = journal.queryEventsByResourceKeys({
      resourceKeys: [...selectedKeys, selectedKeys[0]!],
      afterRecordSequence: 600,
      limit: 7,
    });
    expect(first.events.map((event) => event.recordSequence)).toEqual([
      601, 602, 603, 604, 605, 606, 607,
    ]);
    expect(first.nextAfterRecordSequence).toBe(607);
    const firstCursor = first.nextAfterRecordSequence;
    if (firstCursor === undefined) throw new Error("Expected a resource continuation cursor.");
    const secondPage = journal.queryEventsByResourceKeys({
      resourceKeys: selectedKeys,
      afterRecordSequence: firstCursor,
      limit: 7,
    });
    expect(secondPage.events.map((event) => event.recordSequence)).toEqual([
      608, 609, 610, 611, 612, 613, 614,
    ]);
    expect(secondPage.nextAfterRecordSequence).toBe(614);
    // A bounded 14-result query may probe the two lists ~O(log N + limit);
    // the old path touches all 4,800 postings for these two pages.
    expect(visitedPostings).toBeLessThan(200);
  });

  /** Union pages preserve ordering, de-duplication, gaps and terminal cursors. */
  it("merges sparse resource keys across multiple cursor pages", () => {
    const journal = createInMemoryInventorySegmentedEventJournal();
    for (let sequence = 1; sequence <= 29; sequence += 1) {
      journal.append(committedEvent(sequence, {
        whereaboutsId: sequence % 2 === 1 ? "ODD-COHORT" : "EVEN-COHORT",
      }));
    }
    const oddKey = inventoryEventDependencyIndexKeys(
      committedEvent(1, { whereaboutsId: "ODD-COHORT" })
    ).find((key) => key.startsWith("dep:pool:"));
    const evenKey = inventoryEventDependencyIndexKeys(
      committedEvent(2, { whereaboutsId: "EVEN-COHORT" })
    ).find((key) => key.startsWith("dep:pool:"));
    if (oddKey === undefined || evenKey === undefined) {
      throw new Error("Expected stable resource-pool index keys.");
    }

    const odd = journal.queryEventsByResourceKeys({
      resourceKeys: [oddKey],
      afterRecordSequence: 15,
      limit: 3,
    });
    expect(odd.events.map((event) => event.recordSequence)).toEqual([17, 19, 21]);
    expect(odd.nextAfterRecordSequence).toBe(21);

    const union = journal.queryEventsByResourceKeys({
      resourceKeys: [evenKey, oddKey, oddKey],
      afterRecordSequence: 24,
      limit: 4,
    });
    expect(union.events.map((event) => event.recordSequence)).toEqual([25, 26, 27, 28]);
    expect(union.nextAfterRecordSequence).toBe(28);
    const unionCursor = union.nextAfterRecordSequence;
    if (unionCursor === undefined) throw new Error("Expected a union continuation cursor.");
    const final = journal.queryEventsByResourceKeys({
      resourceKeys: [oddKey, evenKey],
      afterRecordSequence: unionCursor,
      limit: 4,
    });
    expect(final.events.map((event) => event.recordSequence)).toEqual([29]);
    expect(final.nextAfterRecordSequence).toBeUndefined();

    const empty = journal.queryEventsByResourceKeys({
      resourceKeys: [oddKey],
      afterRecordSequence: 29,
    });
    expect(empty.events).toEqual([]);
    expect(empty.nextAfterRecordSequence).toBeUndefined();
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
