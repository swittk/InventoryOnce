import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createInventoryTraceabilityEvent,
} from "../src/commands.js";
import {
  commitInventoryEvent,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryCommittedEvent,
  type InventoryTraceabilityRelationChange,
} from "../src/events.js";
import { InventoryTraceabilityNodeKind } from "../src/model.js";
import {
  applyInventoryTraceabilityChanges,
  applyInventoryTraceabilityChangesBatch,
  emptyInventoryTraceabilityState,
  inventoryTraceabilityRelationIdentity,
} from "../src/traceability.js";
import {
  applyInventoryCommittedEvent,
  applyInventoryCommittedEvents,
  emptyInventoryProjectionState,
  InventoryDeficitPolicy,
  projectInventoryEvents,
} from "../src/projection.js";
import { createTabletCatalog, time0 } from "./test-fixtures.js";

/** Build one association edge with two distinct traceability identities. */
function association(index: number): InventoryTraceabilityRelationChange {
  return {
    action: InventoryTraceabilityRelationAction.Add,
    kind: InventoryTraceabilityRelationKind.Association,
    from: {
      kind: InventoryTraceabilityNodeKind.External,
      id: "trace-input-" + String(index),
    },
    to: {
      kind: InventoryTraceabilityNodeKind.External,
      id: "trace-output-" + String(index),
    },
  };
}

/** Build retained association history followed by small deferred mutations. */
function traceabilityCatchupFixture(baseSize: number, tailSize: number) {
  const catalog = createTabletCatalog();
  const initial = commitInventoryEvent(
    createInventoryTraceabilityEvent({
      catalog,
      operationId: "trace-batch-seed",
      occurredAtEpochMs: time0,
      changes: Array.from({ length: baseSize }, (_, i) => association(i)),
    }),
    time0,
    1
  );
  const base = applyInventoryCommittedEvent({
    catalog,
    state: emptyInventoryProjectionState(),
    event: initial,
    deficitPolicy: InventoryDeficitPolicy.Reject,
  }).state;
  const pending: InventoryCommittedEvent[] = [];
  for (let index = 0; index < tailSize; index += 1) {
    pending.push(commitInventoryEvent(
      createInventoryTraceabilityEvent({
        catalog,
        operationId: "trace-batch-tail-" + index,
        occurredAtEpochMs: time0,
        changes: [association(baseSize + index)],
      }),
      time0,
      index + 2
    ));
  }
  return { catalog, initial, base, pending };
}

describe("batched traceability projection locality", () => {
  it("measures deferred association-heavy catch-up while retaining current graph truth", () => {
    const { catalog, initial, base, pending } = traceabilityCatchupFixture(
      5_000,
      100
    );
    const initialGraph = base.traceability.relations;
    const started = performance.now();
    const next = applyInventoryCommittedEvents({
      catalog,
      state: base,
      events: pending,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const elapsedMs = performance.now() - started;
    expect(Object.keys(next.traceability.relations)).toHaveLength(5_100);
    expect(Object.keys(base.traceability.relations)).toHaveLength(5_000);
    expect(base.traceability.relations).toBe(initialGraph);
    expect(next.traceability).toEqual(projectInventoryEvents({
      catalog,
      events: [initial, ...pending],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }).traceability);
    console.log(JSON.stringify({
      bench: "traceability-batch-catchup",
      baseRelations: 5_000,
      appendedEvents: 100,
      elapsedMs,
    }));
  });

  it("preserves every source event ID and rejects transient genealogy cycles", () => {
    const state = emptyInventoryTraceabilityState();
    const genealogyKind = InventoryTraceabilityRelationKind.Genealogy;
    const a = { kind: InventoryTraceabilityNodeKind.External, id: "A" };
    const b = { kind: InventoryTraceabilityNodeKind.External, id: "B" };
    const created = {
      eventId: "trace-created",
      changes: [{
        action: InventoryTraceabilityRelationAction.Add,
        kind: genealogyKind,
        from: a,
        to: b,
      }],
    } as const;
    const later = {
      eventId: "trace-later",
      changes: [association(999_999)],
    };
    const appended = applyInventoryTraceabilityChangesBatch({
      state,
      events: [created, later],
    });
    const exact = inventoryTraceabilityRelationIdentity(genealogyKind, a, b);
    expect(appended.relations[exact]?.createdByEventId).toBe("trace-created");
    expect(Object.keys(appended.relations)).toHaveLength(2);
    expect(Object.keys(state.relations)).toHaveLength(0);

    // Even if a later event would remove the edge causing the cycle, it
    // cannot make an invalid intermediate committed graph valid.
    expect(() => applyInventoryTraceabilityChangesBatch({
      state,
      events: [
        created,
        {
          eventId: "trace-cycle",
          changes: [{
            action: InventoryTraceabilityRelationAction.Add,
            kind: genealogyKind,
            from: b,
            to: a,
          }],
        },
        {
          eventId: "trace-invalidate-cycle",
          changes: [{
            action: InventoryTraceabilityRelationAction.Invalidate,
            kind: genealogyKind,
            from: b,
            to: a,
            invalidatesCreatedByEventId: "trace-cycle",
          }],
        },
      ],
    })).toThrow("cycle");
    expect(state).toEqual(emptyInventoryTraceabilityState());
  });

  it("rejects an invalid later graph event without publishing earlier batch changes", () => {
    const catalog = createTabletCatalog();
    const a = { kind: InventoryTraceabilityNodeKind.External, id: "batch-A" };
    const b = { kind: InventoryTraceabilityNodeKind.External, id: "batch-B" };
    const forward = commitInventoryEvent(
      createInventoryTraceabilityEvent({
        catalog,
        operationId: "batch-graph-forward",
        occurredAtEpochMs: time0,
        changes: [{
          action: InventoryTraceabilityRelationAction.Add,
          kind: InventoryTraceabilityRelationKind.Genealogy,
          from: a,
          to: b,
        }],
      }),
      time0,
      1
    );
    const cycle = commitInventoryEvent(
      createInventoryTraceabilityEvent({
        catalog,
        operationId: "batch-graph-cycle",
        occurredAtEpochMs: time0,
        changes: [{
          action: InventoryTraceabilityRelationAction.Add,
          kind: InventoryTraceabilityRelationKind.Genealogy,
          from: b,
          to: a,
        }],
      }),
      time0,
      2
    );
    const before = emptyInventoryProjectionState();
    expect(() => applyInventoryCommittedEvents({
      catalog,
      state: before,
      events: [forward, cycle],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })).toThrow("cycle");
    expect(before.lastRecordSequence).toBe(0);
    expect(Object.keys(before.events)).toHaveLength(0);
    expect(Object.keys(before.traceability.relations)).toHaveLength(0);
  });

  it("measures independent genealogy catch-up without rescanning all prior edges per event", () => {
    const genealogy = (index: number): InventoryTraceabilityRelationChange => ({
      action: InventoryTraceabilityRelationAction.Add,
      kind: InventoryTraceabilityRelationKind.Genealogy,
      from: {
        kind: InventoryTraceabilityNodeKind.External,
        id: "genealogy-source-" + index,
      },
      to: {
        kind: InventoryTraceabilityNodeKind.External,
        id: "genealogy-output-" + index,
      },
    });
    const graphSize = 5_000;
    const tailSize = 100;
    const state = applyInventoryTraceabilityChanges({
      state: emptyInventoryTraceabilityState(),
      eventId: "genealogy-batch-seed",
      changes: Array.from({ length: graphSize }, (_, index) => genealogy(index)),
    });
    const events = Array.from({ length: tailSize }, (_, index) => ({
      eventId: "genealogy-batch-append-" + index,
      changes: [genealogy(graphSize + index)],
    }));
    const started = performance.now();
    const result = applyInventoryTraceabilityChangesBatch({
      state,
      events,
    });
    const elapsedMs = performance.now() - started;
    let sequential = state;
    for (const event of events) {
      sequential = applyInventoryTraceabilityChanges({
        state: sequential,
        eventId: event.eventId,
        changes: event.changes,
      });
    }
    expect(result).toEqual(sequential);
    expect(Object.keys(state.relations)).toHaveLength(graphSize);
    expect(Object.keys(result.relations)).toHaveLength(graphSize + tailSize);
    console.log(JSON.stringify({
      bench: "traceability-genealogy-batch-catchup",
      baseRelations: graphSize,
      appendedEvents: tailSize,
      elapsedMs,
    }));
  });

  it("allows a canceled same-event cycle but rejects an indirect surviving back-edge", () => {
    const state = emptyInventoryTraceabilityState();
    const a = { kind: InventoryTraceabilityNodeKind.External, id: "graph-A" };
    const b = { kind: InventoryTraceabilityNodeKind.External, id: "graph-B" };
    const c = { kind: InventoryTraceabilityNodeKind.External, id: "graph-C" };
    const edge = (
      from: typeof a,
      to: typeof a,
      action: InventoryTraceabilityRelationAction,
      invalidatesCreatedByEventId?: string
    ): InventoryTraceabilityRelationChange => ({
      action,
      kind: InventoryTraceabilityRelationKind.Genealogy,
      from,
      to,
      ...(invalidatesCreatedByEventId === undefined
        ? {}
        : { invalidatesCreatedByEventId }),
    });
    const sameEventChanges = [
      edge(a, b, InventoryTraceabilityRelationAction.Add),
      edge(b, a, InventoryTraceabilityRelationAction.Add),
      edge(b, a, InventoryTraceabilityRelationAction.Invalidate, "same-event"),
    ];
    const standalone = applyInventoryTraceabilityChanges({
      state,
      eventId: "same-event",
      changes: sameEventChanges,
    });
    const batch = applyInventoryTraceabilityChangesBatch({
      state,
      events: [{ eventId: "same-event", changes: sameEventChanges }],
    });
    expect(batch).toEqual(standalone);
    expect(Object.keys(batch.relations)).toHaveLength(1);

    expect(() => applyInventoryTraceabilityChangesBatch({
      state,
      events: [
        {
          eventId: "long-chain",
          changes: [
            edge(a, b, InventoryTraceabilityRelationAction.Add),
            edge(b, c, InventoryTraceabilityRelationAction.Add),
          ],
        },
        {
          eventId: "indirect-back-edge",
          changes: [edge(c, a, InventoryTraceabilityRelationAction.Add)],
        },
      ],
    })).toThrow("cycle");
    expect(Object.keys(state.relations)).toHaveLength(0);
  });

  it("does not double-add replayed graph operations in a mixed append batch", () => {
    const { catalog, base, pending } = traceabilityCatchupFixture(50, 3);
    const first = pending[0];
    const second = pending[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two deferred association events.");
    }
    const afterFirst = applyInventoryCommittedEvents({
      catalog,
      state: base,
      events: [first],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const once = applyInventoryCommittedEvents({
      catalog,
      state: afterFirst,
      events: [first, second],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const sequential = applyInventoryCommittedEvent({
      catalog,
      state: afterFirst,
      event: second,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }).state;
    expect(once).toEqual(sequential);
    expect(Object.keys(once.traceability.relations)).toHaveLength(52);
    expect(Object.keys(afterFirst.traceability.relations)).toHaveLength(51);
  });
});
