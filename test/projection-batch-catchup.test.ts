import { describe, expect, it } from "vitest";
import {
  createInventoryReceiptEvent,
  createInventoryReceiptManyEvent,
  createInventoryTraceabilityEvent,
  createInventoryTransferEvent,
} from "../src/commands.js";
import {
  commitInventoryEvent,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryCommittedEvent,
} from "../src/events.js";
import { InventoryTraceabilityNodeKind } from "../src/model.js";
import {
  applyInventoryCommittedEvent,
  applyInventoryCommittedEvents,
  emptyInventoryProjectionState,
  InventoryDeficitPolicy,
  projectInventoryEvents,
} from "../src/projection.js";
import { stockAmount } from "../src/amounts.js";
import { createTabletCatalog, loosePosition, time0 } from "./test-fixtures.js";

/** Construct a 1,500-position published base plus a small append-only event tail. */
function stockCatchupFixture() {
  const catalog = createTabletCatalog();
  const initial = commitInventoryEvent(
    createInventoryReceiptManyEvent({
      catalog,
      operationId: "catchup-seed",
      occurredAtEpochMs: time0,
      lines: Array.from({ length: 1_500 }, (_, index) => ({
        to: loosePosition("batch-room", {
          lotId: "SEED-" + String(index).padStart(5, "0"),
        }),
        amount: stockAmount("1", "piece"),
      })),
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
  for (let index = 0; index < 128; index += 1) {
    pending.push(
      commitInventoryEvent(
        createInventoryReceiptEvent({
          catalog,
          operationId: "catchup-receipt-" + index,
          occurredAtEpochMs: time0,
          to: loosePosition("batch-room", { lotId: "SEED-00000" }),
          amount: stockAmount("1", "piece"),
        }),
        time0,
        index + 2
      )
    );
  }
  pending.push(
    commitInventoryEvent(
      createInventoryTransferEvent({
        catalog,
        operationId: "catchup-transfer",
        occurredAtEpochMs: time0,
        from: loosePosition("batch-room", { lotId: "SEED-00000" }),
        toPlacementNodeId: "batch-room-b",
        amount: stockAmount("1", "piece"),
      }),
      time0,
      pending.length + 2
    )
  );
  pending.push(
    commitInventoryEvent(
      createInventoryTraceabilityEvent({
        catalog,
        operationId: "catchup-traceability",
        occurredAtEpochMs: time0,
        changes: [
          {
            action: InventoryTraceabilityRelationAction.Add,
            kind: InventoryTraceabilityRelationKind.Association,
            from: { kind: InventoryTraceabilityNodeKind.External, id: "source" },
            to: { kind: InventoryTraceabilityNodeKind.External, id: "destination" },
          },
        ],
      }),
      time0,
      pending.length + 2
    )
  );
  return { catalog, base, initial, pending };
}

describe("batched canonical projection catch-up", () => {
  it("matches sequential append and cold replay without mutating its published base", () => {
    const { catalog, base, initial, pending } = stockCatchupFixture();
    const basePositionsBefore = structuredClone(base.positions);
    const baseEventIdsBefore = structuredClone(base.eventIdsBySequence);
    let completePositionEnumerations = 0;
    const watched = {
      ...base,
      positions: new Proxy(base.positions, {
        /** Prove batch catch-up clones the full position record only once. */
        ownKeys(target) {
          completePositionEnumerations += 1;
          return Reflect.ownKeys(target);
        },
      }),
    };
    const batch = applyInventoryCommittedEvents({
      catalog,
      state: watched,
      events: pending,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    let sequential = base;
    for (const event of pending) {
      sequential = applyInventoryCommittedEvent({
        catalog,
        state: sequential,
        event,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      }).state;
    }
    const cold = projectInventoryEvents({
      catalog,
      events: [initial, ...pending],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(batch).toEqual(sequential);
    expect(batch).toEqual(cold);
    expect(completePositionEnumerations).toBe(1);
    expect(base.positions).toEqual(basePositionsBefore);
    expect(base.eventIdsBySequence).toEqual(baseEventIdsBefore);
    expect(batch).not.toBe(base);
    expect(batch.positions).not.toBe(base.positions);
  });

  it("treats exact replay as a zero-copy no-op and rejects changed retry intent", () => {
    const { catalog, base, pending } = stockCatchupFixture();
    const published = applyInventoryCommittedEvents({
      catalog,
      state: base,
      events: pending,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    let positionEnumerations = 0;
    const watched = {
      ...published,
      positions: new Proxy(published.positions, {
        /** No whole-record cloning is necessary for already committed operations. */
        ownKeys(target) {
          positionEnumerations += 1;
          return Reflect.ownKeys(target);
        },
      }),
    };
    expect(applyInventoryCommittedEvents({
      catalog,
      state: watched,
      events: pending,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })).toBe(watched);
    expect(positionEnumerations).toBe(0);
    const first = pending[0];
    if (first === undefined) throw new Error("Expected committed receipt.");
    expect(() => applyInventoryCommittedEvents({
      catalog,
      state: published,
      events: [{ ...first, reason: "changed retry evidence" }],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })).toThrow("changed intent");
  });

  it("leaves the original base untouched after an invalid later event", () => {
    const { catalog, base, pending } = stockCatchupFixture();
    const before = structuredClone(base);
    const first = pending[0];
    const second = pending[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two committed receipts.");
    }
    expect(() => applyInventoryCommittedEvents({
      catalog,
      state: base,
      events: [first, { ...second, recordSequence: 99_999 }],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    })).toThrow("recordSequence must be");
    expect(base).toEqual(before);
  });
});
