import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  inventoryStockSelector,
  stockAmount,
} from "../src/index.js";
import { summarizeInventoryAvailability } from "../src/availability.js";
import {
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  commitInventoryEvent,
  defineInventoryEvent,
} from "../src/events.js";
import {
  InventoryTraceabilityNodeKind,
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
} from "../src/model.js";
import { planInventoryAllocation } from "../src/picking.js";
import {
  emptyInventoryProjectionState,
  findInventoryPositions,
  projectInventoryEvents,
} from "../src/projection.js";
import { parseQuantity } from "../src/quantity.js";
import {
  InventoryReservationOperationKind,
  InventoryReservationStatus,
  type InventoryReservation,
  type InventoryReservationAllocation,
  type InventoryReservationBook,
  type InventoryReservationOperation,
} from "../src/reservations.js";
import type { InventoryWorldState } from "../src/world.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
} from "./test-fixtures.js";

/** Machine-audited real-world index-locality trace. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-PROJECTION-INDEX-SCALE-LOCALITY",
] as const;

/** Absolute directory used to inspect package source for index-locality guards. */
const testDirectory = dirname(fileURLToPath(import.meta.url));

/** Attach one exact active reservation to each test lot while counting allocation reads. */
function createWorldWithExactReservations(
  world: InventoryWorldState,
  positionCount: number,
  onAllocationRead: () => void
): InventoryWorldState {
  // Accumulate exact reservation rows for the synthetic reservation book.
  const reservations: Record<string, InventoryReservation> = {};
  // Accumulate matching lifecycle operations for the synthetic reservation book.
  const operations: Record<string, InventoryReservationOperation> = {};
  const selector = inventoryStockSelector("item-a", {
    itemRevisionIds: ["item-a-v2"],
    placementNodeIds: ["scale-store"],
  });
  for (let index = 0; index < positionCount; index += 1) {
    const reservationId = `scale-reservation-${index}`;
    const operationId = `scale-reservation-create-${index}`;
    const allocations: readonly InventoryReservationAllocation[] = [
      {
        position: {
          ...loosePosition("scale-store", {
            lotId: `SCALE-${String(index).padStart(5, "0")}`,
          }),
          itemRevisionId: "item-a-v2",
        },
        quantity: parseQuantity("1", "piece"),
      },
    ];
    const reservation: InventoryReservation = {
      reservationId,
      operationId,
      itemRevisionId: "item-a-v2",
      selector,
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time0,
      status: InventoryReservationStatus.Active,
      get allocations(): readonly InventoryReservationAllocation[] {
        onAllocationRead();
        return allocations;
      },
      lastChangedAtEpochMs: time0,
    };
    reservations[reservationId] = reservation;
    operations[operationId] = {
      operationId,
      reservationId,
      kind: InventoryReservationOperationKind.Create,
      intentFingerprint: `scale-reservation-intent-${index}`,
      lifecycleSequence: index + 1,
      reservationAfter: reservation,
    };
  }
  const reservationBook: InventoryReservationBook = {
    reservations,
    operations,
  };
  return { ...world, reservations: reservationBook };
}

/** Publish and inspect one high-lot item without relying on journal scans. */
async function runHighLotItem(positionCount: number) {
  const inventory = createTestInventory();
  const lines = Array.from({ length: positionCount }, (_, index) => ({
    to: loosePosition("scale-store", {
      lotId: `SCALE-${String(index).padStart(5, "0")}`,
    }),
    amount: stockAmount("1", "piece"),
  }));
  const publishStarted = performance.now();
  await inventory.stock.receiveMany({
    operationId: `scale-${positionCount}`,
    occurredAtEpochMs: time0,
    lines,
  });
  const publishMs = performance.now() - publishStarted;
  const world = await inventory.read.world();
  const readStarted = performance.now();
  const rows = await inventory.read.positions(
    inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      placementNodeIds: ["scale-store"],
    })
  );
  const readMs = performance.now() - readStarted;
  const planStarted = performance.now();
  const plan = await inventory.read.planAllocation({
    selector: inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      placementNodeIds: ["scale-store"],
    }),
    amount: stockAmount("1", "piece"),
    method: InventoryAllocationMethod.Fifo,
    atEpochMs: 1787702400000,
  });
  const planMs = performance.now() - planStarted;
  return { inventory, world, rows, plan, publishMs, readMs, planMs };
}

/** Move one placement ancestor over a large descendant stock population. */
async function runPlacementAncestorMove(positionCount: number) {
  const inventory = createTestInventory();
  const lines = Array.from({ length: positionCount }, (_, index) => ({
    to: loosePosition("scale-leaf", {
      lotId: `PLACEMENT-${String(index).padStart(5, "0")}`,
    }),
    amount: stockAmount("1", "piece"),
  }));
  await inventory.stock.receiveMany({
    operationId: `placement-scale-receive-${positionCount}`,
    occurredAtEpochMs: time0,
    lines,
  });
  await inventory.placement.move({
    operationId: `placement-scale-leaf-${positionCount}`,
    occurredAtEpochMs: time0,
    nodeId: "scale-leaf",
    into: "scale-carrier",
  });
  await inventory.placement.move({
    operationId: `placement-scale-carrier-old-${positionCount}`,
    occurredAtEpochMs: time0,
    nodeId: "scale-carrier",
    into: "scale-root-old",
  });
  const before = await inventory.read.world();
  const beforePositionIds = Object.keys(before.projection.positions).sort();
  const started = performance.now();
  const moved = await inventory.placement.move({
    operationId: `placement-scale-carrier-new-${positionCount}`,
    occurredAtEpochMs: time0,
    nodeId: "scale-carrier",
    into: "scale-root-new",
    expectedParent: "scale-root-old",
  });
  const elapsedMs = performance.now() - started;
  const after = await inventory.read.world();
  return {
    elapsedMs,
    moved,
    beforePositionIds,
    afterPositionIds: Object.keys(after.projection.positions).sort(),
    directParent: after.projection.placement.relationByNodeId["scale-carrier"]
      ?.parentNodeId,
  };
}

/** Move one embodied placement ancestor over a large descendant stock population. */
async function runEmbodiedPlacementAncestorMove(positionCount: number) {
  const inventory = createTestInventory();
  const descendantLines = Array.from({ length: positionCount }, (_, index) => ({
    to: loosePosition("scale-leaf", {
      lotId:
        "EMBODIED-PLACEMENT-" + String(index).padStart(5, "0"),
    }),
    amount: stockAmount("1", "piece"),
  }));
  await inventory.stock.receiveMany({
    operationId: "embodied-placement-scale-receive-" + positionCount,
    occurredAtEpochMs: time0,
    lines: descendantLines,
  });
  await inventory.stock.receive({
    operationId: "embodied-placement-carrier-receive-" + positionCount,
    occurredAtEpochMs: time0,
    to: loosePosition("scale-root-old"),
    amount: stockAmount("1", "piece"),
  });
  const serialId = "SCALE-CARRIER-" + positionCount;
  await inventory.stock.individualize({
    operationId: "embodied-placement-carrier-individualize-" + positionCount,
    occurredAtEpochMs: time0,
    from: loosePosition("scale-root-old"),
    amount: stockAmount("1", "piece"),
    serialId,
    asPlacementNode: {
      nodeId: "scale-carrier",
      category: "carrier",
      acceptsPlacement: true,
    },
  });
  await inventory.placement.move({
    operationId: "embodied-placement-scale-leaf-" + positionCount,
    occurredAtEpochMs: time0,
    nodeId: "scale-leaf",
    into: "scale-carrier",
  });

  const before = await inventory.read.world();
  const beforeDescendantPositionIds = [
    ...(before.projection.positionIdsByPlacementNodeId["scale-leaf"] ?? []),
  ].sort();
  const started = performance.now();
  const moved = await inventory.placement.move({
    operationId: "embodied-placement-scale-carrier-new-" + positionCount,
    occurredAtEpochMs: time0,
    nodeId: "scale-carrier",
    into: "scale-root-new",
    expectedParent: "scale-root-old",
  });
  const elapsedMs = performance.now() - started;
  const after = await inventory.read.world();
  const serialPosition = (
    await inventory.read.positions({
      itemId: "item-a",
      serialIds: [serialId],
    })
  )[0];
  return {
    elapsedMs,
    moved,
    beforeDescendantPositionIds,
    afterDescendantPositionIds: [
      ...(after.projection.positionIdsByPlacementNodeId["scale-leaf"] ?? []),
    ].sort(),
    directParent: after.projection.placement.relationByNodeId["scale-carrier"]
      ?.parentNodeId,
    serialPlacementNodeId: serialPosition?.key.placementNodeId,
  };
}

/** Deliberately large quadratic comparison bound used by scale assertions. */
function positionCountSquared(positionCount: number): number {
  return positionCount * positionCount;
}

/** Rebuild one long single-position history through the same reducer used by count/correction/migration replay. */
function replayRetainedEventHistory(eventCount: number): {
  readonly elapsedMs: number;
  readonly finalAmountMinor: number | undefined;
} {
  const catalog = createTabletCatalog();
  const events = Array.from({ length: eventCount }, (_, index) =>
    commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: `scale-history-event-${index}`,
          operationId: `scale-history-operation-${index}`,
          kind: InventoryEventKind.Receipt,
          occurredAtEpochMs: time0,
          stockEffects: [
            {
              itemRevisionId: "item-a-v2",
              position: {
                ...loosePosition("history-store"),
                itemRevisionId: "item-a-v2",
              },
              measurementsDelta: {
                primary: {
                  axisId: "pieces",
                  quantity: parseQuantity("1", "piece"),
                },
                independent: [],
              },
            },
          ],
          traceabilityChanges: [],
        },
      }),
      time0,
      index + 1
    )
  );
  const started = performance.now();
  const projection = projectInventoryEvents({
    catalog,
    events,
    deficitPolicy: InventoryDeficitPolicy.Reject,
  });
  return {
    elapsedMs: performance.now() - started,
    finalAmountMinor: Object.values(projection.positions)[0]?.measurements
      .primary.quantity.amountMinor,
  };
}

/** Rebuild independent structural graph history through the private sequential graph builder. */
function replayTraceabilityHistory(
  kind: InventoryTraceabilityRelationKind,
  eventCount: number
): { readonly elapsedMs: number; readonly relationCount: number } {
  const catalog = createTabletCatalog();
  const events = Array.from({ length: eventCount }, (_, index) =>
    commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: `scale-${kind}-event-${index}`,
          operationId: `scale-${kind}-operation-${index}`,
          kind: InventoryEventKind.Traceability,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [
            {
              action: InventoryTraceabilityRelationAction.Add,
              kind,
              from: {
                kind: InventoryTraceabilityNodeKind.PlacementNode,
                id: `scale-${kind}-child-${index}`,
              },
              to: {
                kind: InventoryTraceabilityNodeKind.PlacementNode,
                id: `scale-${kind}-parent-${index}`,
              },
            },
          ],
        },
      }),
      time0,
      index + 1
    )
  );
  const started = performance.now();
  const projection = projectInventoryEvents({
    catalog,
    events,
    deficitPolicy: InventoryDeficitPolicy.Reject,
  });
  return {
    elapsedMs: performance.now() - started,
    relationCount: Object.keys(projection.traceability.relations).length,
  };
}

describe("projection index real-world scale", () => {
  it("keeps a 5,000-lot batch near-linear and fully rebuildable", async () => {
    const baseline = await runHighLotItem(1_000);
    const scaled = await runHighLotItem(5_000);
    expect(scaled.rows).toHaveLength(5_000);
    expect(scaled.plan.lines).toHaveLength(1);
    expect(scaled.world.projection.positionIdsByItemId["item-a"]).toHaveLength(
      5_000
    );
    expect(
      scaled.world.projection.positionIdsByItemRevisionId["item-a-v2"]
    ).toHaveLength(5_000);
    const rebuilt = projectInventoryEvents({
      catalog: createTabletCatalog(),
      events: Object.values(scaled.world.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(rebuilt.positionIdsByItemId).toEqual(
      scaled.world.projection.positionIdsByItemId
    );
    expect(rebuilt.positionIdsByItemRevisionId).toEqual(
      scaled.world.projection.positionIdsByItemRevisionId
    );
    expect(scaled.publishMs).toBeLessThan(baseline.publishMs * 7 + 500);
    expect(scaled.readMs).toBeLessThan(1_000);
    expect(scaled.planMs).toBeLessThan(1_000);
    console.log(
      JSON.stringify({
        adapter: "memory",
        baselinePositions: 1_000,
        scaledPositions: 5_000,
        baselinePublishMs: baseline.publishMs,
        scaledPublishMs: scaled.publishMs,
        scaledReadMs: scaled.readMs,
        scaledPlanMs: scaled.planMs,
      })
    );
  }, 20_000);

  it("moves one ancestor without cloning or rewriting descendant stock", async () => {
    const baseline = await runPlacementAncestorMove(1_000);
    const scaled = await runPlacementAncestorMove(5_000);
    expect(baseline.moved.event.stockEffects).toEqual([]);
    expect(scaled.moved.event.stockEffects).toEqual([]);
    expect(baseline.moved.event.placementChanges).toHaveLength(1);
    expect(scaled.moved.event.placementChanges).toHaveLength(1);
    expect(baseline.beforePositionIds).toEqual(baseline.afterPositionIds);
    expect(scaled.beforePositionIds).toEqual(scaled.afterPositionIds);
    expect(scaled.directParent).toBe("scale-root-new");
    // Five times as many descendants may add fixed publication noise, but must not
    // restore the old descendant-cardinality slope (previously ~21 ms -> ~82 ms).
    expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 3 + 10);
    console.log(
      JSON.stringify({
        adapter: "memory-placement-ancestor-move",
        baselineDescendantPositions: 1_000,
        scaledDescendantPositions: 5_000,
        baselineMoveMs: baseline.elapsedMs,
        scaledMoveMs: scaled.elapsedMs,
      })
    );
  }, 20_000);

  it("moves one embodied ancestor with constant-size stock effects and no descendant rewrites", async () => {
    const baseline = await runEmbodiedPlacementAncestorMove(1_000);
    const scaled = await runEmbodiedPlacementAncestorMove(5_000);
    expect(baseline.moved.event.stockEffects).toHaveLength(2);
    expect(scaled.moved.event.stockEffects).toHaveLength(2);
    expect(baseline.moved.event.placementChanges ?? []).toEqual([]);
    expect(scaled.moved.event.placementChanges ?? []).toEqual([]);
    expect(baseline.beforeDescendantPositionIds).toEqual(
      baseline.afterDescendantPositionIds
    );
    expect(scaled.beforeDescendantPositionIds).toEqual(
      scaled.afterDescendantPositionIds
    );
    expect(scaled.directParent).toBe("scale-root-new");
    expect(scaled.serialPlacementNodeId).toBe("scale-root-new");
    expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 4 + 50);
    console.log(
      JSON.stringify({
        adapter: "memory-embodied-placement-ancestor-move",
        baselineDescendantPositions: 1_000,
        scaledDescendantPositions: 5_000,
        baselineMoveMs: baseline.elapsedMs,
        scaledMoveMs: scaled.elapsedMs,
        stockEffectsPerMove: scaled.moved.event.stockEffects.length,
      })
    );
  }, 20_000);

  it("rebuilds retained event history near-linearly without cloning growing indexes", () => {
    const baseline = replayRetainedEventHistory(500);
    const scaled = replayRetainedEventHistory(2_000);
    expect(baseline.finalAmountMinor).toBe(500);
    expect(scaled.finalAmountMinor).toBe(2_000);
    // Four times the history must stay far below the old quadratic ~16x growth.
    expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 8 + 250);
    expect(scaled.elapsedMs).toBeLessThan(1_000);
    console.log(
      JSON.stringify({
        adapter: "memory-history-replay",
        baselineEvents: 500,
        scaledEvents: 2_000,
        baselineReplayMs: baseline.elapsedMs,
        scaledReplayMs: scaled.elapsedMs,
      })
    );
  }, 15_000);

  it.each([
    InventoryTraceabilityRelationKind.Association,
    InventoryTraceabilityRelationKind.Genealogy,
  ])(
    "rebuilds %s history near-linearly through the private graph builder",
    (kind) => {
      const baseline = replayTraceabilityHistory(kind, 250);
      const scaled = replayTraceabilityHistory(kind, 1_000);
      expect(baseline.relationCount).toBe(250);
      expect(scaled.relationCount).toBe(1_000);
      expect(scaled.elapsedMs).toBeLessThan(baseline.elapsedMs * 8 + 250);
      expect(scaled.elapsedMs).toBeLessThan(1_000);
      console.log(
        JSON.stringify({
          adapter: "memory-traceability-replay",
          kind,
          baselineRelations: 250,
          scaledRelations: 1_000,
          baselineReplayMs: baseline.elapsedMs,
          scaledReplayMs: scaled.elapsedMs,
        })
      );
    }
  );

  it("plans a 100-request policy batch over 1,000 positions from one private snapshot", async () => {
    const { inventory } = await runHighLotItem(1_000);
    const requests = Array.from({ length: 100 }, (_, index) => ({
      requestId: `scale-batch-request-${index}`,
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["scale-store"],
        lotIds: [`SCALE-${String(index).padStart(5, "0")}`],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
    }));
    const started = performance.now();
    const issued = await inventory.stock.issueManyByPolicy({
      operationId: "scale-policy-batch-100",
      occurredAtEpochMs: time0,
      requests,
    });
    const elapsedMs = performance.now() - started;
    expect(issued.allocations).toHaveLength(100);
    expect(
      issued.allocations.reduce(
        (sum, allocation) => sum + allocation.lines.length,
        0
      )
    ).toBe(100);
    expect(elapsedMs).toBeLessThan(5_000);
    console.log(
      JSON.stringify({
        adapter: "memory-policy-batch",
        positions: 1_000,
        requests: 100,
        elapsedMs,
      })
    );
  }, 20_000);

  it("indexes exact reservation pressure once instead of scanning every claim per candidate", async () => {
    const positionCount = 256;
    const published = await runHighLotItem(positionCount);
    let allocationReads = 0;
    const world = createWorldWithExactReservations(
      published.world,
      positionCount,
      () => {
        allocationReads += 1;
      }
    );
    const plan = planInventoryAllocation({
      catalog: createTabletCatalog(),
      world,
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: ["scale-store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: 1787702400000,
    });
    expect(plan.lines).toEqual([]);
    expect(plan.shortfall.amountMinor).toBe(1);
    expect(plan.unallocatedReservationsPresent).toBe(false);
    expect(allocationReads).toBe(positionCount);
  });

  it("indexes availability allocations once per revision instead of once per position", async () => {
    /** Measure reservation-allocation reads for one indexed position population. */
    const measureAllocationReads = async (
      positionCount: number
    ): Promise<number> => {
      const published = await runHighLotItem(positionCount);
      let allocationReads = 0;
      const world = createWorldWithExactReservations(
        published.world,
        positionCount,
        () => {
          allocationReads += 1;
        }
      );
      const summary = summarizeInventoryAvailability({
        catalog: createTabletCatalog(),
        projection: world.projection,
        reservations: world.reservations,
        selector: inventoryStockSelector("item-a", {
          itemRevisionIds: ["item-a-v2"],
          placementNodeIds: ["scale-store"],
        }),
        atEpochMs: 1787702400000,
      });
      expect(summary.revisions[0]?.positions).toHaveLength(positionCount);
      expect(summary.revisions[0]?.exactlyAllocatedUsable.amountMinor).toBe(
        positionCount
      );
      return allocationReads;
    };

    const baselineReads = await measureAllocationReads(32);
    const scaledReads = await measureAllocationReads(128);
    expect(scaledReads).toBeLessThanOrEqual(baselineReads * 5);
    expect(scaledReads).toBeLessThan(positionCountSquared(128));
  });

  it("keeps hot reads and FIFO planning on rebuildable indexes", () => {
    const projection = readFileSync(
      resolve(testDirectory, "../src/projection.ts"),
      "utf8"
    );
    const picking = readFileSync(
      resolve(testDirectory, "../src/picking.ts"),
      "utf8"
    );
    const availability = readFileSync(
      resolve(testDirectory, "../src/availability.ts"),
      "utf8"
    );
    const reservations = readFileSync(
      resolve(testDirectory, "../src/reservations.ts"),
      "utf8"
    );
    const facade = readFileSync(
      resolve(testDirectory, "../src/facade.ts"),
      "utf8"
    );
    const counts = readFileSync(
      resolve(testDirectory, "../src/counts.ts"),
      "utf8"
    );
    const corrections = readFileSync(
      resolve(testDirectory, "../src/corrections.ts"),
      "utf8"
    );
    const placement = readFileSync(
      resolve(testDirectory, "../src/placement.ts"),
      "utf8"
    );
    const traceability = readFileSync(
      resolve(testDirectory, "../src/traceability.ts"),
      "utf8"
    );
    const traceabilityReplay = readFileSync(
      resolve(testDirectory, "../src/traceability-replay.ts"),
      "utf8"
    );
    const fungibility = readFileSync(
      resolve(testDirectory, "../src/fungibility.ts"),
      "utf8"
    );
    const packageRoot = readFileSync(
      resolve(testDirectory, "../src/index.ts"),
      "utf8"
    );
    const kernel = readFileSync(
      resolve(testDirectory, "../src/kernel.ts"),
      "utf8"
    );
    const candidateStart = projection.indexOf("function candidatePositionIds");
    const candidateEnd = projection.indexOf(
      "\nfunction captureConservedPositiveLayerStarts(",
      candidateStart
    );
    expect(candidateStart).toBeGreaterThanOrEqual(0);
    expect(candidateEnd).toBeGreaterThanOrEqual(0);
    const candidateBody = projection.slice(candidateStart, candidateEnd);
    const findStart = projection.indexOf(
      "export function findInventoryPositions"
    );
    const findEnd = projection.indexOf(
      "\nfunction candidatePositionIds(",
      findStart + 1
    );
    expect(findStart).toBeGreaterThanOrEqual(0);
    expect(findEnd).toBeGreaterThanOrEqual(0);
    const findBody = projection.slice(findStart, findEnd);
    expect(candidateBody).toContain("positionIdsByItemRevisionId");
    expect(candidateBody).toContain("positionIdsByItemId");
    expect(candidateBody).not.toContain("Object.values(state.positions)");
    expect(findBody).toContain("candidatePositionIds(");
    expect(findBody).not.toContain("Object.values(state.positions)");
    expect(projection).toContain("recordIndexedIdentityMutation(");
    expect(projection).toContain("applyIndexedIdentityMutations(");
    expect(projection).not.toContain("function addIndexedPosition(");
    expect(projection).not.toContain("function removeIndexedPosition(");
    expect(picking).toContain("positiveLayerStartedAtEpochMsByPositionId");
    expect(picking).toContain("createExactPrimaryReservationSummary(");
    expect(picking).toContain("reservedPrimaryByPositionIdentity.get(");
    expect(picking).not.toContain("exactPrimaryReservedAtPosition(");
    expect(picking).not.toContain("Object.values(world.projection.events)");
    expect(availability).toContain("indexAvailabilityReservations({");
    expect(availability).toContain("exactAllocationsByPositionIdentity.get(");
    expect(availability).not.toContain("exactAllocationsAtPosition(");
    expect(reservations).toContain("if (broadReservations.length === 0)");
    expect(reservations).toContain("exactReservationGroupFeasibility({");
    expect(reservations).toContain("allocatedByPositionIdentity");
    expect(projection).toContain("applyInventoryCommittedEventInternal(");
    expect(projection).toContain("mutateProjection: boolean");
    expect(projection).toContain("inventoryEventsInRecordSequence(events)");
    expect(traceability).toContain("if (changes.length === 0) return state;");
    expect(projection).toContain("projectInventoryTraceabilityEvents(");
    expect(placement).toContain("relationByNodeId");
    expect(placement).toContain("childNodeIdsByParentNodeId");
    expect(placement).toContain("assertPlacementChangeHasNoCycle(");
    expect(traceabilityReplay).toContain("genealogyOutputsByInput");
    expect(fungibility).toContain("createFungibilitySparseRecordOverlay(");
    expect(fungibility).not.toContain("...world.projection.positions");
    expect(fungibility).not.toContain(
      "...world.projection.positionIdsByItemId"
    );
    expect(packageRoot).not.toContain("traceability-replay");
    expect(kernel).not.toContain("traceability-replay");
    expect(facade).toContain(
      "inventoryCommittedEventsInSequence(world.projection)"
    );
    expect(facade).not.toContain("Object.values(world.projection.events)");
    expect(facade).toContain(
      "const planningPositions: Record<string, InventoryStockPosition>"
    );
    expect(facade).toContain("applyPolicyAllocationToPlanningPositions(");
    expect(facade).not.toContain("inventoryWorldAfterPolicyAllocation(");
    expect(facade).toContain(
      "inventorySparseRecordValue(projection.lotIdentitiesByItemId, itemId)"
    );
    expect(facade).not.toContain(
      "for (const projected of Object.values(world.projection.lots))"
    );
    expect(counts).toContain("inventoryEventsInRecordSequence(events)");
    expect(corrections).toContain("projection.eventIdsBySequence[");
    expect(corrections).not.toContain("Object.values(projection.events)");
  });
});


describe("canonical projection exact-placement index locality", () => {
  it("falls back to the item index before traversing 100,000 irrelevant placement nodes", () => {
    const positions: Record<string, InventoryStockPosition> = Object.create(null);
    const itemPositionIds: string[] = [];
    const measurements: InventoryStockPosition["measurements"] = {
      primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
      independent: [],
    };
    for (let index = 0; index < 5_000; index += 1) {
      const key = {
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        placementNodeId: "outside-warehouse",
        lotId: "OUTSIDE-" + String(index).padStart(6, "0"),
      };
      const identity = inventoryStockPositionIdentity(key);
      positions[identity] = { key, measurements };
      itemPositionIds.push(identity);
    }
    itemPositionIds.sort();
    const emptyBinIds: string[] = [];
    const parentByNode: Record<string, {
      nodeId: string;
      parentNodeId: string;
      createdByEventId: string;
    }> = Object.create(null);
    for (let index = 0; index < 100_000; index += 1) {
      const nodeId = "empty-bin-" + String(index).padStart(6, "0");
      emptyBinIds.push(nodeId);
      parentByNode[nodeId] = {
        nodeId,
        parentNodeId: "large-empty-warehouse",
        createdByEventId: "warehouse-topology",
      };
    }
    let placementIndexProbes = 0;
    const state = {
      ...emptyInventoryProjectionState(),
      positions,
      positionIdsByItemId: { "item-a": itemPositionIds },
      positionIdsByItemRevisionId: { "item-a-v2": itemPositionIds },
      positionIdsByPlacementNodeId: new Proxy(
        Object.create(null) as Record<string, readonly string[]>,
        {
          /** Count sparse-index membership checks, including absent bins. */
          getOwnPropertyDescriptor(target, key) {
            placementIndexProbes += 1;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        }
      ),
      placement: {
        relationByNodeId: parentByNode,
        childNodeIdsByParentNodeId: {
          "large-empty-warehouse": emptyBinIds,
        },
      },
    };
    expect(findInventoryPositions(state, {
      itemId: "item-a",
      withinPlacementNodeIds: ["large-empty-warehouse"],
    })).toEqual([]);
    // Selectivity must be bounded by the 5,000 item candidates, not the
    // 100,000 unrelated empty physical nodes.
    expect(placementIndexProbes).toBeLessThan(5_000);
  });

  it("returns sorted exact-bin rows without probing 100,000 unrelated item positions", () => {
    const positions: Record<string, InventoryStockPosition> = Object.create(null);
    const itemPositionIds: string[] = [];
    const revisionPositionIds: Record<string, string[]> = Object.create(null);
    const placementPositionIds: Record<string, string[]> = Object.create(null);
    const measurements: InventoryStockPosition["measurements"] = {
      primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
      independent: [],
    };

    for (let index = 0; index < 100_000; index += 1) {
      const placementNodeId = "bin-" + String(index % 1_000).padStart(4, "0");
      const itemRevisionId = index % 2 === 0 ? "item-a-v2" : "item-a-v3";
      const key = {
        itemId: "item-a",
        itemRevisionId,
        placementNodeId,
        lotId: "BATCH-" + String(index).padStart(6, "0"),
      };
      const identity = inventoryStockPositionIdentity(key);
      positions[identity] = { key, measurements };
      itemPositionIds.push(identity);
      (revisionPositionIds[itemRevisionId] ??= []).push(identity);
      (placementPositionIds[placementNodeId] ??= []).push(identity);
    }
    itemPositionIds.sort();
    for (const row of Object.values(revisionPositionIds)) row.sort();
    for (const row of Object.values(placementPositionIds)) row.sort();

    let positionReads = 0;
    const guardedPositions = new Proxy(positions, {
      /** Count touched exact stock positions rather than elapsed wall-clock noise. */
      get(target, key, receiver) {
        if (typeof key === "string") positionReads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const state = {
      ...emptyInventoryProjectionState(),
      positions: guardedPositions,
      positionIdsByItemId: { "item-a": itemPositionIds },
      positionIdsByItemRevisionId: revisionPositionIds,
      positionIdsByPlacementNodeId: placementPositionIds,
    };

    const selected = findInventoryPositions(state, {
      itemId: "item-a",
      itemRevisionIds: ["item-a-v3"],
      placementNodeIds: ["bin-0001", "bin-0032"],
    });
    expect(selected).toHaveLength(100);
    expect(selected.every((row) =>
      row.key.itemRevisionId === "item-a-v3" &&
      (row.key.placementNodeId === "bin-0001" ||
        row.key.placementNodeId === "bin-0032")
    )).toBe(true);
    expect(selected.map((row) => inventoryStockPositionIdentity(row.key))).toEqual(
      [...selected]
        .map((row) => inventoryStockPositionIdentity(row.key))
        .sort()
    );
    // The old item-only index scanned 50,000 item/revision positions here.
    expect(positionReads).toBeLessThanOrEqual(200);

    positionReads = 0;
    const exactOne = findInventoryPositions(state, {
      itemId: "item-a",
      placementNodeIds: ["bin-0001"],
    });
    expect(exactOne).toHaveLength(100);
    expect(positionReads).toBe(100);

    // Both roots designate the same physical bin through overlapping
    // ancestor/descendant selection. The returned rows must not double-count.
    const nestedState = {
      ...state,
      placement: {
        relationByNodeId: {
          "bin-0001": {
            nodeId: "bin-0001",
            parentNodeId: "area-a",
            createdByEventId: "placement-index-test",
          },
          "bin-0032": {
            nodeId: "bin-0032",
            parentNodeId: "area-a",
            createdByEventId: "placement-index-test",
          },
        },
        childNodeIdsByParentNodeId: {
          "area-a": ["bin-0001", "bin-0032"],
        },
      },
    };
    positionReads = 0;
    const subtree = findInventoryPositions(nestedState, {
      itemId: "item-a",
      itemRevisionIds: ["item-a-v3"],
      withinPlacementNodeIds: ["area-a", "bin-0001"],
    });
    expect(subtree).toHaveLength(100);
    expect(subtree.every((row) => row.key.placementNodeId === "bin-0001")).toBe(true);
    expect(positionReads).toBe(200);

    positionReads = 0;
    expect(findInventoryPositions(nestedState, {
      itemId: "item-a",
      withinPlacementNodeIds: ["empty-area"],
    })).toEqual([]);
    expect(positionReads).toBe(0);
  });
});
