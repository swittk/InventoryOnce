import { describe, expect, it, vi } from "vitest";
import {
  createInventoryReceiptEvent,
  createInventoryReceiptManyEvent,
  createInventoryPlacementNodeMetadataEvent,
  createInventoryTraceabilityEvent,
  createInventoryTransferEvent,
} from "../src/commands.js";
import {
  commitInventoryEvent,
  defineInventoryEvent,
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryCommittedEvent,
} from "../src/events.js";
import {
  inventorySerialIdentity,
  InventoryTraceabilityNodeKind,
} from "../src/model.js";
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

  it("rejects a newly embodied placement node without its serialized resource in mutable batch replay", () => {
    const catalog = createTabletCatalog();
    const base = emptyInventoryProjectionState();
    const definition = commitInventoryEvent(
      createInventoryPlacementNodeMetadataEvent({
        catalog,
        operationId: "batch-orphan-embodied-node",
        occurredAtEpochMs: time0,
        nodeId: "UNOWNED-CABINET",
        placementNode: {
          category: "cabinet",
          acceptsPlacement: true,
          embodiedBy: { itemId: "item-a", serialId: "UNOWNED-CABINET-SERIAL" },
        },
      }),
      time0,
      1
    );
    expect(() =>
      applyInventoryCommittedEvent({
        catalog,
        state: base,
        event: definition,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      })
    ).toThrow("cannot be embodied without one live serialized resource");
    // A multi-event catch-up must enforce the same pre-event incarnation rule.
    expect(() =>
      applyInventoryCommittedEvents({
        catalog,
        state: base,
        events: [definition],
        deficitPolicy: InventoryDeficitPolicy.Reject,
      })
    ).toThrow("cannot be embodied without one live serialized resource");
    expect(base.placementNodes["UNOWNED-CABINET"]).toBeUndefined();
  });

  it("does not rebuild unrelated embodied-serial mappings for every metadata event in a mutable batch", () => {
    const catalog = createTabletCatalog();
    const serialIdentity = inventorySerialIdentity("item-a", "BOUND-SERIAL");
    const originalSerial = commitInventoryEvent(
      createInventoryReceiptEvent({
        catalog,
        operationId: "metadata-scale-receive-serial",
        occurredAtEpochMs: time0,
        to: loosePosition("SERIAL-STORE", { serialId: "BOUND-SERIAL" }),
        amount: stockAmount("1", "piece"),
      }),
      time0,
      1
    );
    const seedMetadata = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "metadata-scale-seed",
          operationId: "metadata-scale-seed",
          kind: InventoryEventKind.PlacementNodeMetadata,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [],
          placementNodeDefinitions: [
            {
              nodeId: "BOUND-CABINET",
              category: "cabinet",
              embodiedBy: { itemId: "item-a", serialId: "BOUND-SERIAL" },
            },
            ...Array.from({ length: 250 }, (_, index) => ({
              nodeId: "SEED-" + String(index).padStart(4, "0"),
              category: "ordinary-location",
            })),
          ],
        },
      }),
      time0,
      2
    );
    const base = projectInventoryEvents({
      catalog,
      events: [originalSerial, seedMetadata],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(base.placementNodeIdByEmbodiedSerialIdentity[serialIdentity]).toBe(
      "BOUND-CABINET"
    );
    const metadataTail = Array.from({ length: 24 }, (_, index) =>
      commitInventoryEvent(
        createInventoryPlacementNodeMetadataEvent({
          catalog,
          operationId: "metadata-scale-tail-" + index,
          occurredAtEpochMs: time0,
          nodeId: "TAIL-" + String(index).padStart(4, "0"),
          placementNode: { category: "ordinary-location" },
        }),
        time0,
        index + 3
      )
    );
    const originalEntries = Object.entries;
    let unrelatedNodeMapEnumerations = 0;
    const entries = vi.spyOn(Object, "entries").mockImplementation(
      /** Observe whole-node passes without instrumenting the projection implementation. */
      (value: object) => {
        if (
          value !== null &&
          typeof value === "object" &&
          Object.hasOwn(value, "SEED-0000") &&
          Object.hasOwn(value, "SEED-0249")
        ) {
          unrelatedNodeMapEnumerations += 1;
        }
        return originalEntries(value);
      }
    );
    let batch;
    try {
      batch = applyInventoryCommittedEvents({
        catalog,
        state: base,
        events: metadataTail,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      });
    } finally {
      entries.mockRestore();
    }
    expect(batch.placementNodeIdByEmbodiedSerialIdentity[serialIdentity]).toBe(
      "BOUND-CABINET"
    );
    expect(Object.keys(batch.placementNodes)).toHaveLength(275);
    expect(unrelatedNodeMapEnumerations).toBe(0);
    expect(base.placementNodes["TAIL-0000"]).toBeUndefined();
  });

  it("reassigns multiple embodied serial bindings atomically during root correction and rejects conflicts", () => {
    const catalog = createTabletCatalog();
    const serialA = inventorySerialIdentity("item-a", "SERIAL-A");
    const serialB = inventorySerialIdentity("item-a", "SERIAL-B");
    const received = commitInventoryEvent(
      createInventoryReceiptManyEvent({
        catalog,
        operationId: "swap-serials-receive",
        occurredAtEpochMs: time0,
        lines: [
          {
            to: loosePosition("store", { serialId: "SERIAL-A" }),
            amount: stockAmount("1", "piece"),
          },
          {
            to: loosePosition("store", { serialId: "SERIAL-B" }),
            amount: stockAmount("1", "piece"),
          },
        ],
      }),
      time0,
      1
    );
    const root = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "swap-serials-root",
          operationId: "swap-serials-root",
          kind: InventoryEventKind.PlacementNodeMetadata,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [],
          placementNodeDefinitions: [
            {
              nodeId: "CABINET-A",
              category: "cabinet",
              embodiedBy: { itemId: "item-a", serialId: "SERIAL-A" },
            },
            {
              nodeId: "CABINET-B",
              category: "cabinet",
              embodiedBy: { itemId: "item-a", serialId: "SERIAL-B" },
            },
          ],
        },
      }),
      time0,
      2
    );
    const base = projectInventoryEvents({
      catalog,
      events: [received, root],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(base.placementNodeIdByEmbodiedSerialIdentity[serialA]).toBe(
      "CABINET-A"
    );
    expect(base.placementNodeIdByEmbodiedSerialIdentity[serialB]).toBe(
      "CABINET-B"
    );
    const change = (bothToA: boolean) =>
      commitInventoryEvent(
        defineInventoryEvent({
          catalog,
          event: {
            eventId: bothToA ? "swap-serials-conflict" : "swap-serials-correction",
            operationId: bothToA
              ? "swap-serials-conflict"
              : "swap-serials-correction",
            kind: InventoryEventKind.Correction,
            occurredAtEpochMs: time0,
            stockEffects: [],
            traceabilityChanges: [],
            correction: {
              correctsEventId: root.eventId,
              reason: "Correct which serial embodies each cabinet.",
            },
            placementNodeDefinitions: [
              {
                nodeId: "CABINET-A",
                category: "cabinet",
                embodiedBy: {
                  itemId: "item-a",
                  serialId: bothToA ? "SERIAL-A" : "SERIAL-B",
                },
              },
              {
                nodeId: "CABINET-B",
                category: "cabinet",
                embodiedBy: {
                  itemId: "item-a",
                  serialId: "SERIAL-A",
                },
              },
            ],
          },
        }),
        time0,
        3
      );
    const corrected = change(false);
    const batch = applyInventoryCommittedEvents({
      catalog,
      state: base,
      events: [corrected],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const cold = projectInventoryEvents({
      catalog,
      events: [received, root, corrected],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(batch).toEqual(cold);
    expect(batch.placementNodeIdByEmbodiedSerialIdentity[serialA]).toBe(
      "CABINET-B"
    );
    expect(batch.placementNodeIdByEmbodiedSerialIdentity[serialB]).toBe(
      "CABINET-A"
    );
    expect(base.placementNodeIdByEmbodiedSerialIdentity[serialA]).toBe(
      "CABINET-A"
    );
    expect(() =>
      applyInventoryCommittedEvents({
        catalog,
        state: base,
        events: [change(true)],
        deficitPolicy: InventoryDeficitPolicy.Reject,
      })
    ).toThrow("already bound");
    expect(base.placementNodeIdByEmbodiedSerialIdentity[serialB]).toBe(
      "CABINET-B"
    );
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
