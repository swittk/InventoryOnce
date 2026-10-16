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

  it("corrects stock without enumerating unrelated lot and placement metadata masters", () => {
    const catalog = createTabletCatalog();
    const received = commitInventoryEvent(
      createInventoryReceiptEvent({
        catalog,
        operationId: "correction-metadata-scan-receive",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      }),
      time0,
      1
    );
    const placementMasters = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "correction-metadata-scan-placement-seed",
          operationId: "correction-metadata-scan-placement-seed",
          kind: InventoryEventKind.PlacementNodeMetadata,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [],
          placementNodeDefinitions: Array.from({ length: 250 }, (_, index) => ({
            nodeId: "MASTER-NODE-" + String(index).padStart(4, "0"),
            category: "storage",
          })),
        },
      }),
      time0,
      2
    );
    const lotMasters = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "correction-metadata-scan-lot-seed",
          operationId: "correction-metadata-scan-lot-seed",
          kind: InventoryEventKind.LotMetadata,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [],
          lotDefinitions: Array.from({ length: 250 }, (_, index) => ({
            itemId: "item-a",
            lotId: "MASTER-LOT-" + String(index).padStart(4, "0"),
          })),
        },
      }),
      time0,
      3
    );
    const base = projectInventoryEvents({
      catalog,
      events: [received, placementMasters, lotMasters],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    const correction = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "correction-metadata-scan-correction",
          operationId: "correction-metadata-scan-correction",
          kind: InventoryEventKind.Correction,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [],
          correction: {
            correctsEventId: received.eventId,
            reason: "Rechecked the original stock receipt.",
          },
          correctionReplacement: {
            eventId: "correction-metadata-scan-replacement",
            operationId: "correction-metadata-scan-replacement",
            kind: InventoryEventKind.Receipt,
            occurredAtEpochMs: time0,
            stockEffects: received.stockEffects,
            traceabilityChanges: [],
          },
        },
      }),
      time0,
      4
    );
    const originalEntries = Object.entries;
    let unrelatedMetadataEnumerations = 0;
    const entries = vi.spyOn(Object, "entries").mockImplementation(
      /** Detect full scans of unrelated metadata maps during a stock-only correction. */
      (value: object) => {
        if (
          value !== null &&
          typeof value === "object" &&
          ((Object.hasOwn(value, "MASTER-NODE-0000") &&
            Object.hasOwn(value, "MASTER-NODE-0249")) ||
            (Object.hasOwn(value, '["item-a","MASTER-LOT-0000"]') &&
              Object.hasOwn(value, '["item-a","MASTER-LOT-0249"]')))
        ) {
          unrelatedMetadataEnumerations += 1;
        }
        return originalEntries(value);
      }
    );
    let corrected;
    try {
      corrected = applyInventoryCommittedEvent({
        catalog,
        state: base,
        event: correction,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      }).state;
    } finally {
      entries.mockRestore();
    }
    expect(unrelatedMetadataEnumerations).toBe(0);
    expect(corrected.lots).toEqual(base.lots);
    expect(corrected.placementNodes).toEqual(base.placementNodes);
  });

  it("removes metadata identities introduced by superseded corrections without global scans", () => {
    const catalog = createTabletCatalog();
    /** Create a valid metadata assertion with one concrete definition owner. */
    const metadataEvent = (
      sequence: number,
      kind: InventoryEventKind.LotMetadata | InventoryEventKind.PlacementNodeMetadata,
      definitions: {
        readonly lots?: readonly { readonly itemId: string; readonly lotId: string }[];
        readonly nodes?: readonly { readonly nodeId: string }[];
      }
    ) =>
      commitInventoryEvent(
        defineInventoryEvent({
          catalog,
          event: {
            eventId: "owned-metadata-root-" + sequence,
            operationId: "owned-metadata-root-" + sequence,
            kind,
            occurredAtEpochMs: time0,
            stockEffects: [],
            traceabilityChanges: [],
            ...(definitions.lots === undefined ? {} : { lotDefinitions: definitions.lots }),
            ...(definitions.nodes === undefined ? {} : { placementNodeDefinitions: definitions.nodes }),
          },
        }),
        time0,
        sequence
      );
    const originalNode = metadataEvent(1, InventoryEventKind.PlacementNodeMetadata, {
      nodes: [{ nodeId: "INITIAL-NODE" }],
    });
    const originalLot = metadataEvent(2, InventoryEventKind.LotMetadata, {
      lots: [{ itemId: "item-a", lotId: "INITIAL-LOT" }],
    });
    /** Replace or omit one historical metadata root while retaining its identity. */
    const correction = (
      sequence: number,
      root: InventoryCommittedEvent,
      previous: InventoryCommittedEvent | undefined,
      definitions: {
        readonly lots?: readonly { readonly itemId: string; readonly lotId: string }[];
        readonly nodes?: readonly { readonly nodeId: string }[];
      }
    ) =>
      commitInventoryEvent(
        defineInventoryEvent({
          catalog,
          event: {
            eventId: "owned-metadata-correction-" + sequence,
            operationId: "owned-metadata-correction-" + sequence,
            kind: InventoryEventKind.Correction,
            occurredAtEpochMs: time0,
            stockEffects: [],
            traceabilityChanges: [],
            correction: {
              correctsEventId: root.eventId,
              reason: "Metadata owner was misidentified.",
              ...(previous === undefined
                ? {}
                : { supersedesCorrectionEventId: previous.eventId }),
            },
            correctionReplacement:
              definitions.lots !== undefined
                ? {
                    eventId: "owned-metadata-replacement-" + sequence,
                    operationId: "owned-metadata-replacement-" + sequence,
                    kind: InventoryEventKind.LotMetadata,
                    occurredAtEpochMs: time0,
                    stockEffects: [],
                    traceabilityChanges: [],
                    lotDefinitions: definitions.lots,
                  }
                : definitions.nodes !== undefined
                  ? {
                      eventId: "owned-metadata-replacement-" + sequence,
                      operationId: "owned-metadata-replacement-" + sequence,
                      kind: InventoryEventKind.PlacementNodeMetadata,
                      occurredAtEpochMs: time0,
                      stockEffects: [],
                      traceabilityChanges: [],
                      placementNodeDefinitions: definitions.nodes,
                    }
                  : null,
            ...(definitions.lots === undefined ? {} : { lotDefinitions: definitions.lots }),
            ...(definitions.nodes === undefined ? {} : { placementNodeDefinitions: definitions.nodes }),
          },
        }),
        time0,
        sequence
      );
    const newNode = correction(3, originalNode, undefined, {
      nodes: [{ nodeId: "REPLACED-NODE" }],
    });
    const newLot = correction(4, originalLot, undefined, {
      lots: [{ itemId: "item-a", lotId: "REPLACED-LOT" }],
    });
    const removeNode = correction(5, originalNode, newNode, {});
    const removeLot = correction(6, originalLot, newLot, {});
    const events = [originalNode, originalLot, newNode, newLot, removeNode, removeLot];
    let state = emptyInventoryProjectionState();
    for (const event of events) {
      state = applyInventoryCommittedEvent({
        catalog,
        state,
        event,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      }).state;
      if (event === newNode) {
        expect(state.placementNodes["REPLACED-NODE"]?.rootEventId).toBe(originalNode.eventId);
      }
      if (event === newLot) {
        expect(state.lots['["item-a","REPLACED-LOT"]']?.rootEventId).toBe(originalLot.eventId);
      }
    }
    expect(Object.keys(state.placementNodes)).toEqual([]);
    expect(Object.keys(state.lots)).toEqual([]);
    expect(state).toEqual(projectInventoryEvents({
      catalog,
      events,
      deficitPolicy: InventoryDeficitPolicy.Reject,
    }));
    expect(
      applyInventoryCommittedEvents({
        catalog,
        state: emptyInventoryProjectionState(),
        events,
        deficitPolicy: InventoryDeficitPolicy.Reject,
      })
    ).toEqual(state);
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
    /** Represent the one current metadata correction with matching retained root replacement. */
    const change = (bothToA: boolean) => {
      const placementNodeDefinitions = [
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
      ];
      return commitInventoryEvent(
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
            placementNodeDefinitions,
            correctionReplacement: {
              eventId: bothToA
                ? "swap-serials-conflict-replacement"
                : "swap-serials-replacement",
              operationId: bothToA
                ? "swap-serials-conflict-replacement"
                : "swap-serials-replacement",
              kind: InventoryEventKind.PlacementNodeMetadata,
              occurredAtEpochMs: time0,
              stockEffects: [],
              traceabilityChanges: [],
              placementNodeDefinitions,
            },
          },
        }),
        time0,
        3
      );
    };
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
