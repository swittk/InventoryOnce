import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import {
  createInventoryOnce,
  inventoryCatalogSnapshot,
  stockAmount,
} from "../src/index.js";
import {
  createInventoryDetachEvent,
  createInventoryReceiptEvent,
  createInventoryReceiptManyEvent,
} from "../src/commands.js";
import {
  commitInventoryEvent,
  InventoryEventKind,
} from "../src/events.js";
import {
  InventoryDeficitPolicy,
  projectInventoryEvents,
} from "../src/projection.js";
import {
  createInMemoryInventoryDurableStorage,
  type InMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
import { emptyInventoryWorldState } from "../src/world.js";
import { inventoryWhereaboutsLifecycles } from "../src/whereabouts.js";
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

/** One prebuilt warehouse whose timed reads/plans exclude import/rebuild cost. */
function createHistoricalScaleWarehouse(
  eventCount: number,
  targetAmount: "1" | "2" = "1"
): {
  readonly storage: InMemoryInventoryDurableStorage;
  readonly inventory: ReturnType<typeof createInventoryOnce>;
  readonly rootEventId: string;
} {
  const catalog = createTabletCatalog();
  const events = Array.from({ length: eventCount }, (_, index) => {
    const target = index === 0;
    return commitInventoryEvent(
      createInventoryReceiptEvent({
        catalog,
        operationId: target
          ? "scale-target-root"
          : `scale-unrelated-${String(index).padStart(6, "0")}`,
        occurredAtEpochMs: time0,
        to: loosePosition(
          target ? "scale-target-store" : `scale-unrelated-store-${index}`,
          target ? {} : { serialId: `UNRELATED-${index}` }
        ),
        amount: stockAmount(target ? targetAmount : "1", "piece"),
      }),
      time3,
      index + 1
    );
  });
  const projection = projectInventoryEvents({
    catalog,
    events,
    deficitPolicy: InventoryDeficitPolicy.Reject,
  });
  const empty = emptyInventoryWorldState();
  const storage = createInMemoryInventoryDurableStorage({
    initialWorld: {
      ...empty,
      revision: eventCount,
      catalog: inventoryCatalogSnapshot(catalog),
      projection,
    },
  });
  return {
    storage,
    inventory: createInventoryOnce({
      catalog,
      storage,
      clock: clockAt(time3),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }),
    rootEventId: events[0]!.eventId,
  };
}

/** Median of ascending samples, sufficient for noisy local CI clocks. */
function median(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

/** Time repeated exact indexed event reads. */
async function benchmarkExactEventRead(eventCount: number) {
  const { inventory } = createHistoricalScaleWarehouse(eventCount);
  const samples: number[] = [];
  for (let sample = 0; sample < 25; sample += 1) {
    const started = performance.now();
    const page = await inventory.read.events({
      serials: [{ itemId: "item-a", serialId: "UNRELATED-1" }],
      limit: 10,
    });
    samples.push(performance.now() - started);
    expect(page.events).toHaveLength(1);
  }
  return median(samples.slice(5));
}

/** Time correction planning and prove its loaded dependency component remains constant-size. */
async function benchmarkCorrectionPlan(eventCount: number) {
  const { storage, inventory, rootEventId } =
    createHistoricalScaleWarehouse(eventCount);
  const originalQuery = storage.queryInventoryEventsByResourceKeys.bind(storage);
  let maximumReturnedEvents = 0;
  const query = vi
    .spyOn(storage, "queryInventoryEventsByResourceKeys")
    .mockImplementation(async (input) => {
      const page = await originalQuery(input);
      maximumReturnedEvents = Math.max(
        maximumReturnedEvents,
        page.events.length
      );
      return page;
    });
  try {
    const samples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const started = performance.now();
      const plan = await inventory.stock.planCorrection({
        operationId: `scale-plan-${sample}`,
        occurredAtEpochMs: time3,
        correctsEventId: rootEventId,
        reason: "Scale audit reconfirmed the retained receipt.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: time0,
            to: loosePosition("scale-target-store"),
            amount: stockAmount("1", "piece"),
            reason: "Scale audit confirmation.",
          }),
      });
      samples.push(performance.now() - started);
      expect(plan.valid).toBe(true);
    }
    return {
      medianMs: median(samples.slice(4)),
      maximumReturnedEvents,
    };
  } finally {
    query.mockRestore();
  }
}

/** Time one first-attempt stock-only correction and prove canonical begin is bypassed. */
async function benchmarkCorrectionCommit(eventCount: number) {
  const { storage, inventory, rootEventId } =
    createHistoricalScaleWarehouse(eventCount, "2");
  const begin = vi.spyOn(storage, "begin").mockRejectedValue(
    new Error("Scale correction unexpectedly used whole-world coordinator.")
  );
  try {
    const started = performance.now();
    const result = await inventory.stock.correct({
      operationId: `scale-commit-${eventCount}`,
      occurredAtEpochMs: time3,
      correctsEventId: rootEventId,
      reason: "Scale audit found one piece in the initial receipt.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("scale-target-store"),
          amount: stockAmount("1", "piece"),
        }),
    });
    const elapsedMs = performance.now() - started;
    expect(begin).not.toHaveBeenCalled();
    expect(result.event.stockEffects).toHaveLength(1);
    return elapsedMs;
  } finally {
    begin.mockRestore();
  }
}

/** Build and repeatedly query one exact cohort beside many same-item rows. */
function benchmarkExactCohort(positionCount: number) {
  const catalog = createTabletCatalog();
  const received = commitInventoryEvent(
    createInventoryReceiptManyEvent({
      catalog,
      operationId: `cohort-scale-receive-${positionCount}`,
      occurredAtEpochMs: time0,
      lines: Array.from({ length: positionCount }, (_, index) => ({
        to: loosePosition("cohort-store", {
          lotId: `COHORT-${String(index).padStart(7, "0")}`,
        }),
        amount: stockAmount("1", "piece"),
      })),
    }),
    time2,
    1
  );
  const detached = commitInventoryEvent(
    createInventoryDetachEvent({
      catalog,
      operationId: `cohort-scale-detach-${positionCount}`,
      occurredAtEpochMs: time1,
      from: loosePosition("cohort-store", { lotId: "COHORT-0000000" }),
      amount: stockAmount("1", "piece"),
    }),
    time2,
    2
  );
  const projection = projectInventoryEvents({
    catalog,
    events: [received, detached],
    deficitPolicy: InventoryDeficitPolicy.Reject,
  });
  const whereaboutsId = detached.stockEffects.find(
    /** Select the kernel-owned cohort established by detach. */
    (effect) => effect.position.whereaboutsId !== undefined
  )?.position.whereaboutsId;
  if (whereaboutsId === undefined) {
    throw new Error("Scale detach did not produce a whereabouts identity.");
  }
  const started = performance.now();
  let resultLength = 0;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    resultLength = inventoryWhereaboutsLifecycles(
      projection,
      new Set([whereaboutsId])
    ).length;
  }
  return { elapsedMs: performance.now() - started, resultLength };
}

/** Measure one ordinary public append after seeding unrelated positions. */
async function benchmarkOrdinaryAppend(positionCount: number) {
  const inventory = createTestInventory();
  await inventory.stock.receiveMany({
    operationId: `ordinary-append-seed-${positionCount}`,
    occurredAtEpochMs: time0,
    lines: Array.from({ length: positionCount }, (_, index) => ({
      to: loosePosition("ordinary-store", {
        lotId: `ORDINARY-${String(index).padStart(7, "0")}`,
      }),
      amount: stockAmount("1", "piece"),
    })),
  });
  const started = performance.now();
  const appended = await inventory.stock.receive({
    operationId: `ordinary-append-tail-${positionCount}`,
    occurredAtEpochMs: time1,
    to: loosePosition("ordinary-store", {
      lotId: `ORDINARY-TAIL-${positionCount}`,
    }),
    amount: stockAmount("1", "piece"),
  });
  const elapsedMs = performance.now() - started;
  const rows = await inventory.read.positions({
    itemId: "item-a",
    lotIds: [`ORDINARY-TAIL-${positionCount}`],
  });
  return { elapsedMs, appended, rows };
}

describe("historical repair and event-query scale boundaries", () => {
  it(
    "keeps exact event reads and correction plans independent of 10x unrelated history",
    async () => {
      const baselineEvents = 1_000;
      const warehouseEvents = 10_000;
      const baselineReadMs = await benchmarkExactEventRead(baselineEvents);
      const warehouseReadMs = await benchmarkExactEventRead(warehouseEvents);
      const baselinePlan = await benchmarkCorrectionPlan(baselineEvents);
      const warehousePlan = await benchmarkCorrectionPlan(warehouseEvents);

      expect(baselinePlan.maximumReturnedEvents).toBeLessThanOrEqual(2);
      expect(warehousePlan.maximumReturnedEvents).toBeLessThanOrEqual(2);
      expect(warehouseReadMs).toBeLessThan(baselineReadMs * 8 + 20);
      expect(warehousePlan.medianMs).toBeLessThan(
        baselinePlan.medianMs * 8 + 30
      );
      console.log(
        JSON.stringify({
          adapter: "indexed-historical-read-plan",
          baselineEvents,
          warehouseEvents,
          baselineReadMs,
          warehouseReadMs,
          baselinePlanMs: baselinePlan.medianMs,
          warehousePlanMs: warehousePlan.medianMs,
          warehouseDependencyEvents:
            warehousePlan.maximumReturnedEvents,
        })
      );
    },
    180_000
  );

  it(
    "publishes one correction without cloning 10x unrelated canonical history",
    async () => {
      const baselineEvents = 1_000;
      const warehouseEvents = 10_000;
      const baselineMs = await benchmarkCorrectionCommit(baselineEvents);
      const warehouseMs = await benchmarkCorrectionCommit(warehouseEvents);
      expect(warehouseMs).toBeLessThan(baselineMs * 8 + 50);
      console.log(
        JSON.stringify({
          adapter: "segmented-historical-correction-commit",
          baselineEvents,
          warehouseEvents,
          baselineMs,
          warehouseMs,
        })
      );
    },
    180_000
  );

  it(
    "keeps ordinary current writes independent of 50,000 unrelated positions",
    async () => {
      const baseline = await benchmarkOrdinaryAppend(1_000);
      const scaled = await benchmarkOrdinaryAppend(50_000);
      expect(baseline.rows).toHaveLength(1);
      expect(scaled.rows).toHaveLength(1);
      expect(scaled.appended.event.kind).toBe(InventoryEventKind.Receipt);
      expect(scaled.appended.event.historicalRepair).toBeUndefined();
      expect(scaled.appended.event.historicalImpact).toBeUndefined();
      expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 8 + 100);
      expect(scaled.elapsedMs).toBeLessThan(500);
      console.log(
        JSON.stringify({
          adapter: "ordinary-segmented-stock-append",
          baselinePositions: 1_000,
          scaledPositions: 50_000,
          baselineAppendMs: baseline.elapsedMs,
          scaledAppendMs: scaled.elapsedMs,
        })
      );
    },
    60_000
  );

  it("keeps exact cohort reads independent of 50,000 same-item positions", () => {
    const baseline = benchmarkExactCohort(1_000);
    const scaled = benchmarkExactCohort(50_000);
    expect(baseline.resultLength).toBe(1);
    expect(scaled.resultLength).toBe(1);
    expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 8 + 25);
    expect(scaled.elapsedMs).toBeLessThan(100);
    console.log(
      JSON.stringify({
        adapter: "direct-whereabouts-cohort-index",
        baselinePositions: 1_000,
        scaledPositions: 50_000,
        baselineHundredReadsMs: baseline.elapsedMs,
        scaledHundredReadsMs: scaled.elapsedMs,
      })
    );
  }, 60_000);

});
