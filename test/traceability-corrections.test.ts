import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryEventKind,
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
} from "../src/migrations-api.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { createInventoryCorrectionEvent } from "../src/corrections.js";
import { commitInventoryEvent, defineInventoryEvent } from "../src/events.js";
import {
  inventoryGenealogyAncestors,
  inventoryTraceabilityNodeIdentity,
} from "../src/kernel.js";
import { projectInventoryTraceabilityEvents } from "../src/traceability-replay.js";
import {
  applyInventoryTraceabilityChanges,
  inventoryTraceabilityRelationIdentity,
  type InventoryTraceabilityRelation,
} from "../src/traceability.js";
import {
  createTestInventory,
  clockAt,
  createTabletCatalog,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-CORRECTION-TRANSFORMATION-PACKAGING",
] as const;

describe("traceability graph meanings", () => {
  it("rejects contradictory actions for the same relation edge in one event", () => {
    const catalog = createTabletCatalog();
    const child = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "same-edge-child",
    };
    const parent = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "same-edge-parent",
    };

    expect(() =>
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "same-edge-conflict",
          operationId: "same-edge-conflict",
          kind: InventoryEventKind.Traceability,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [
            {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from: child,
              to: parent,
            },
            {
              action: InventoryTraceabilityRelationAction.Remove,
              kind: InventoryTraceabilityRelationKind.Containment,
              from: child,
              to: parent,
            },
          ],
        },
      })
    ).toThrow("multiple traceability actions for one edge");
  });
  it("rejects item qualifiers on non-lot traceability identities", () => {
    expect(() =>
      inventoryTraceabilityNodeIdentity({
        kind: InventoryTraceabilityNodeKind.Container,
        id: "QUALIFIED-CONTAINER",
        itemId: "item-a",
      })
    ).toThrow("must not name itemId");
    expect(
      inventoryTraceabilityNodeIdentity({
        kind: InventoryTraceabilityNodeKind.Lot,
        id: "QUALIFIED-LOT",
        itemId: "item-a",
      })
    ).toContain("item-a");
  });

  it("keeps containment and association independent and rejects containment cycles", async () => {
    const inventory = createTestInventory();
    const child = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "child",
    };
    const parent = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "parent",
    };
    await inventory.traceability.aggregate({
      operationId: "aggregate-child",
      occurredAtEpochMs: time0,
      from: child,
      to: parent,
    });
    await inventory.traceability.associate({
      operationId: "associate-child",
      occurredAtEpochMs: time1,
      from: child,
      to: parent,
    });
    const world = await inventory.read.world();
    const kinds = Object.values(world.projection.traceability.relations)
      .map(
        /** Return each retained relation kind for deterministic comparison. */
        (relation) => relation.kind
      )
      .sort();
    expect(kinds).toEqual([
      InventoryTraceabilityRelationKind.Association,
      InventoryTraceabilityRelationKind.Containment,
    ]);
    await expect(
      inventory.traceability.aggregate({
        operationId: "aggregate-cycle",
        occurredAtEpochMs: time2,
        from: parent,
        to: child,
      })
    ).rejects.toThrow("Containment graph contains a cycle");
    await inventory.traceability.disaggregate({
      operationId: "disaggregate-child",
      occurredAtEpochMs: time3,
      from: child,
      to: parent,
    });
    const remaining = Object.values(
      (await inventory.read.world()).projection.traceability.relations
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.kind).toBe(
      InventoryTraceabilityRelationKind.Association
    );
  });

  it("replays same-event genealogy replacement against the event-final graph", () => {
    const catalog = createTabletCatalog();
    const left = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "atomic-left",
    };
    const right = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "atomic-right",
    };
    const original = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "atomic-genealogy-root",
          operationId: "atomic-genealogy-root",
          kind: InventoryEventKind.Traceability,
          occurredAtEpochMs: time0,
          stockEffects: [],
          traceabilityChanges: [
            {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Genealogy,
              from: left,
              to: right,
            },
          ],
        },
      }),
      time0,
      1
    );
    const correction = commitInventoryEvent(
      defineInventoryEvent({
        catalog,
        event: {
          eventId: "atomic-genealogy-correction",
          operationId: "atomic-genealogy-correction",
          kind: InventoryEventKind.Correction,
          occurredAtEpochMs: time1,
          stockEffects: [],
          traceabilityChanges: [
            {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Genealogy,
              from: right,
              to: left,
            },
            {
              action: InventoryTraceabilityRelationAction.Invalidate,
              kind: InventoryTraceabilityRelationKind.Genealogy,
              from: left,
              to: right,
              invalidatesCreatedByEventId: original.eventId,
            },
          ],
          correction: {
            correctsEventId: original.eventId,
            reason: "The genealogy direction was reversed.",
          },
        },
      }),
      time1,
      2
    );

    const replayed = projectInventoryTraceabilityEvents([original, correction]);
    const relations = Object.values(replayed.relations);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      kind: InventoryTraceabilityRelationKind.Genealogy,
      from: right,
      to: left,
      createdByEventId: correction.eventId,
    });
  });

  it("validates deep genealogy without relying on the JavaScript call stack", () => {
    // Exercise a genealogy deep enough to expose accidental recursive traversal.
    const relationCount = 20_000;
    // Retain each relation by its canonical traceability relation identity.
    const relations: Record<string, InventoryTraceabilityRelation> = {};
    for (let index = 0; index < relationCount; index += 1) {
      const from = {
        kind: InventoryTraceabilityNodeKind.Serial,
        id: `deep-${String(index)}`,
      };
      const to = {
        kind: InventoryTraceabilityNodeKind.Serial,
        id: `deep-${String(index + 1)}`,
      };
      relations[
        inventoryTraceabilityRelationIdentity(
          InventoryTraceabilityRelationKind.Genealogy,
          from,
          to
        )
      ] = {
        kind: InventoryTraceabilityRelationKind.Genealogy,
        from,
        to,
        createdByEventId: `deep-event-${String(index)}`,
      };
    }
    const from = {
      kind: InventoryTraceabilityNodeKind.Serial,
      id: `deep-${String(relationCount)}`,
    };
    const to = {
      kind: InventoryTraceabilityNodeKind.Serial,
      id: `deep-${String(relationCount + 1)}`,
    };

    const next = applyInventoryTraceabilityChanges({
      state: {
        relations,
        containmentChildContainerIdsByParentNodeIdentity: {},
      },
      eventId: "deep-tail-event",
      changes: [
        {
          action: InventoryTraceabilityRelationAction.Add,
          kind: InventoryTraceabilityRelationKind.Genealogy,
          from,
          to,
        },
      ],
    });
    expect(Object.keys(next.relations)).toHaveLength(relationCount + 1);
  });

  it("rejects transforming a container while an effective containment edge still uses it", async () => {
    const inventory = createTestInventory();
    const child = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "transform-contained-child",
    };
    const container = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "transform-containing-input",
    };
    await inventory.stock.receive({
      operationId: "receive-containing-input",
      occurredAtEpochMs: time0,
      to: loosePosition("transform-containment-store", {
        containerId: container.id,
      }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.traceability.aggregate({
      operationId: "aggregate-before-transform",
      occurredAtEpochMs: time0,
      from: child,
      to: container,
    });
    await expect(
      inventory.stock.transform({
        operationId: "transform-containing-input",
        occurredAtEpochMs: time1,
        consume: [
          {
            position: loosePosition("transform-containment-store", {
              containerId: container.id,
            }),
            amount: stockAmount("1", "piece"),
          },
        ],
        produce: [
          {
            position: loosePosition("transform-containment-store", {
              containerId: "transform-output",
            }),
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow("disaggregated from containment");
    expect(
      (await inventory.read.positions({
        itemId: "item-a",
        locationIds: ["transform-containment-store"],
      }))[0]?.key.containerId
    ).toBe(container.id);
  });

  it("records transformation genealogy without treating it as containment", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-transform-input",
      occurredAtEpochMs: time0,
      to: loosePosition("work", { serialId: "serial-in" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transform({
      operationId: "transform-one",
      occurredAtEpochMs: time1,
      consume: [
        {
          position: loosePosition("work", { serialId: "serial-in" }),
          amount: stockAmount("1", "piece"),
        },
      ],
      produce: [
        {
          position: loosePosition("work", { serialId: "serial-out" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    const world = await inventory.read.world();
    const relations = Object.values(world.projection.traceability.relations);
    expect(relations).toHaveLength(1);
    expect(relations[0]?.kind).toBe(
      InventoryTraceabilityRelationKind.Genealogy
    );
    expect(
      inventoryGenealogyAncestors(world.projection.traceability, {
        kind: InventoryTraceabilityNodeKind.Serial,
        id: "serial-out",
      })
    ).toEqual([
      { kind: InventoryTraceabilityNodeKind.Serial, id: "serial-in" },
    ]);
  });

  it("rejects transformation genealogy unrelated to the stock identity on its line", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-related-serial",
      occurredAtEpochMs: time0,
      to: loosePosition("work", { serialId: "serial-a" }),
      amount: stockAmount("1", "piece"),
    });
    await expect(
      inventory.stock.transform({
        operationId: "unrelated-genealogy",
        occurredAtEpochMs: time1,
        consume: [
          {
            position: loosePosition("work", { serialId: "serial-a" }),
            amount: stockAmount("1", "piece"),
            traceabilityNode: {
              kind: InventoryTraceabilityNodeKind.Serial,
              id: "serial-x",
            },
          },
        ],
        produce: [
          {
            position: loosePosition("work", { serialId: "serial-b" }),
            amount: stockAmount("1", "piece"),
          },
        ],
      })
    ).rejects.toThrow("does not match the serial, container, or lot");
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.key.serialId
    ).toBe("serial-a");
  });
});

describe("append-only corrections", () => {
  it("treats a later traceability removal as a no-op when correction omits its root add", async () => {
    const inventory = createTestInventory();
    const child = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "omit-trace-child",
    };
    const parent = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "omit-trace-parent",
    };
    const root = await inventory.traceability.aggregate({
      operationId: "omit-trace-root",
      occurredAtEpochMs: time0,
      from: child,
      to: parent,
    });
    const removal = await inventory.traceability.disaggregate({
      operationId: "omit-trace-later-remove",
      occurredAtEpochMs: time1,
      from: child,
      to: parent,
    });
    await inventory.stock.correct({
      operationId: "verify-omit-trace-later-remove",
      occurredAtEpochMs: time2,
      correctsEventId: removal.event.eventId,
      reason: "The later removal was verified before the root was corrected.",
      replaceWith: (plans) =>
        plans.disaggregate({ occurredAtEpochMs: time1, from: child, to: parent }),
    });

    const correction = await inventory.stock.correct({
      operationId: "omit-trace-root-correction",
      occurredAtEpochMs: time2,
      correctsEventId: root.event.eventId,
      reason: "The original aggregation never occurred.",
      replaceWith: (plans) => plans.omit(),
    });

    expect(correction.event.traceabilityChanges).toEqual([]);
    expect(
      Object.values((await inventory.read.world()).projection.traceability.relations)
    ).toEqual([]);
  });

  it("retains the original event and supersedes correction heads without rewriting history", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "wrong-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("10", "piece"),
    });
    const firstCorrection = await inventory.stock.correct({
      operationId: "correct-to-seven",
      occurredAtEpochMs: time1,
      correctsEventId: original.event.eventId,
      reason: "The source document said seven.",
      metadata: { correctionTicket: "ticket-1" },
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("7", "piece"),
        }),
    });
    const secondCorrection = await inventory.stock.correct({
      operationId: "correct-to-eight",
      occurredAtEpochMs: time2,
      correctsEventId: original.event.eventId,
      reason: "Final recount confirmed eight.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("8", "piece"),
        }),
    });

    const world = await inventory.read.world();
    expect(Object.keys(world.projection.events)).toHaveLength(3);
    expect(world.projection.events[original.event.eventId]?.kind).toBe(
      InventoryEventKind.Receipt
    );
    expect(firstCorrection.event.kind).toBe(InventoryEventKind.Correction);
    expect(firstCorrection.event.occurredAtEpochMs).toBe(time1);
    expect(firstCorrection.event.metadata).toMatchObject({
      correctionTicket: "ticket-1",
      replacementOccurredAtEpochMs: time0,
    });
    expect(secondCorrection.event.correction?.supersedesCorrectionEventId).toBe(
      firstCorrection.event.eventId
    );
    expect(
      world.projection.correctionEventIdByCorrectedEventId[
        original.event.eventId
      ]
    ).toBe(secondCorrection.event.eventId);
    const positions = await inventory.read.positions({ itemId: "item-a" });
    expect(positions[0]?.measurements.primary.quantity.amountMinor).toBe(8);
  });

  it("rejects replacement occurrence after the retained root was durably recorded", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "future-replacement-root",
      occurredAtEpochMs: time0,
      to: loosePosition("future-replacement-store"),
      amount: stockAmount("1", "piece"),
    });

    await expect(
      inventory.stock.correct({
        operationId: "future-replacement-correction",
        occurredAtEpochMs: time2,
        correctsEventId: original.event.eventId,
        reason: "Reject impossible replacement chronology explicitly.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: 1787572800000,
            to: loosePosition("future-replacement-store"),
            amount: stockAmount("1", "piece"),
          }),
      })
    ).rejects.toThrow("after the retained root event was durably recorded");
    expect((await inventory.read.world()).revision).toBe(1);
  });

  it("rejects a replacement whose historical replay violates Reject deficit policy", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "reject-correction-root",
      occurredAtEpochMs: time0,
      to: loosePosition("reject-correction-store"),
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.issue({
      operationId: "reject-correction-issue",
      occurredAtEpochMs: time1,
      from: loosePosition("reject-correction-store"),
      amount: stockAmount("8", "piece"),
    });
    await inventory.stock.receive({
      operationId: "reject-correction-later-receipt",
      occurredAtEpochMs: time2,
      to: loosePosition("reject-correction-store"),
      amount: stockAmount("5", "piece"),
    });

    await expect(
      inventory.stock.correct({
        operationId: "reject-correction-rewrite-root",
        occurredAtEpochMs: time3,
        correctsEventId: original.event.eventId,
        reason: "The original receipt was only five pieces.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: time0,
            to: loosePosition("reject-correction-store"),
            amount: stockAmount("5", "piece"),
          }),
      })
    ).rejects.toThrow(/primary quantity must not be negative/u);
    expect(
      (await inventory.read.positions({ itemId: "item-a" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(7);
  });

  it("replaces same-quantity FIFO provenance and supersedes it without stale history", async () => {
    const inventory = createTestInventory();
    const correctedRoot = await inventory.stock.receive({
      operationId: "fifo-provenance-root",
      occurredAtEpochMs: time1,
      to: loosePosition("fifo-store", { lotId: "LOT-A" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "fifo-other-root",
      occurredAtEpochMs: time0,
      to: loosePosition("fifo-store", { lotId: "LOT-B" }),
      amount: stockAmount("1", "piece"),
    });
    const request = {
      selector: inventoryStockSelector("item-a", {
        locationIds: ["fifo-store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time2,
    };
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-B");

    const earlierTime = 1787554800000;
    const firstCorrection = await inventory.stock.correct({
      operationId: "fifo-provenance-earlier",
      occurredAtEpochMs: time2,
      correctsEventId: correctedRoot.event.eventId,
      reason: "The receipt happened one hour earlier.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: earlierTime,
          to: loosePosition("fifo-store", { lotId: "LOT-A" }),
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(firstCorrection.event.stockEffects).toEqual([]);
    expect(
      firstCorrection.event.positiveLayerProvenanceOverrides
    ).toMatchObject([{ startedAtEpochMs: earlierTime }]);
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-A");

    const secondCorrection = await inventory.stock.correct({
      operationId: "fifo-provenance-restored",
      occurredAtEpochMs: time3,
      correctsEventId: correctedRoot.event.eventId,
      reason: "The original receipt time was confirmed after all.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("fifo-store", { lotId: "LOT-A" }),
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(secondCorrection.event.correction?.supersedesCorrectionEventId).toBe(
      firstCorrection.event.eventId
    );
    expect(secondCorrection.event.stockEffects).toEqual([]);
    expect(
      secondCorrection.event.positiveLayerProvenanceOverrides
    ).toMatchObject([{ startedAtEpochMs: time1 }]);
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-B");
  });

  it("rebuilds FIFO provenance when an omitted root leaves a later top-up", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "omit-layer-root",
      occurredAtEpochMs: time0,
      to: loosePosition("omit-layer-store", { lotId: "LOT-OMIT" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "omit-layer-top-up",
      occurredAtEpochMs: time1,
      to: loosePosition("omit-layer-store", { lotId: "LOT-OMIT" }),
      amount: stockAmount("1", "piece"),
    });

    const correction = await inventory.stock.correct({
      operationId: "omit-layer-root-correction",
      occurredAtEpochMs: time2,
      correctsEventId: root.event.eventId,
      reason: "The first receipt never happened.",
      replaceWith: (plans) => plans.omit(),
    });
    expect(correction.event.positiveLayerProvenanceOverrides).toMatchObject([
      { startedAtEpochMs: time1 },
    ]);
    const plan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["omit-layer-store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time3,
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.layerStartedAtEpochMs).toBe(time1);
    expect(plan.lines[0]?.allocatedPrimary.amountMinor).toBe(1);
  });

  it("ignores metadata-only correction chains during later physical correction replay", async () => {
    const inventory = createTestInventory();
    await inventory.lots.define({
      operationId: "metadata-replay-lot-root",
      occurredAtEpochMs: time0,
      itemId: "item-a",
      lotId: "META-REPLAY",
      lot: { manufacturedAtEpochMs: time0 },
    });
    await inventory.lots.correct({
      operationId: "metadata-replay-lot-correction",
      occurredAtEpochMs: time1,
      itemId: "item-a",
      lotId: "META-REPLAY",
      lot: { manufacturedAtEpochMs: time0, expiresAtEpochMs: time3 },
      reason: "Expiry date was confirmed later.",
    });
    const root = await inventory.stock.receive({
      operationId: "metadata-replay-stock-root",
      occurredAtEpochMs: time1,
      to: loosePosition("metadata-replay-store"),
      amount: stockAmount("2", "piece"),
    });

    await inventory.stock.correct({
      operationId: "metadata-replay-stock-correction",
      occurredAtEpochMs: time2,
      correctsEventId: root.event.eventId,
      reason: "Physical receipt was independently checked.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time1,
          to: loosePosition("metadata-replay-store"),
          amount: stockAmount("2", "piece"),
        }),
    });

    const positions = await inventory.read.positions({
      itemId: "item-a",
      locationIds: ["metadata-replay-store"],
    });
    expect(positions).toHaveLength(1);
    expect(positions[0]?.measurements.primary.quantity.amountMinor).toBe(2);
  });

  it("offers a truthful declarative replacement for every non-correction event kind", async () => {
    // Accumulate every corrected root kind for the final coverage assertion below.
    const correctedRootKinds = new Set<InventoryEventKind>();

    {
      const inventory = createTestInventory();
      const root = await inventory.stock.receive({
        operationId: "receipt-kind-root",
        occurredAtEpochMs: time0,
        to: loosePosition("receipt-kind-store"),
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-receipt-kind",
        occurredAtEpochMs: time1,
        correctsEventId: root.event.eventId,
        reason: "Receipt row was checked.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAtEpochMs: time0,
            to: loosePosition("receipt-kind-store"),
            amount: stockAmount("1", "piece"),
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const catalog = createTabletCatalog();
      const storage = createInMemoryInventoryDurableStorage();
      const migration = defineInventoryMigration({
        catalog,
        declaration: {
          migrationId: "correction-opening",
          sourceSystem: "legacy-stock",
          cutoverAtEpochMs: time1,
          openingStock: [
            {
              openingId: "opening-one",
              position: loosePosition("opening-store"),
              amount: stockAmount("2", "piece"),
              occurredAtEpochMs: time1,
              itemRevisionId: "item-a-v2",
              source: { sourceType: "legacy-stock", sourceId: "opening-one" },
            },
          ],
        },
      });
      const migrationDryRun = dryRunInventoryMigration({
        catalog,
        plan: migration,
        targetWorld: await storage.readWorld(),
      });
      await applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: migration,
        dryRun: migrationDryRun,
        clock: clockAt(time3),
      });
      const inventory = createTestInventory(storage, catalog);
      const root = migration.events[0];
      if (root === undefined)
        throw new Error("Opening correction root disappeared.");
      const openingCorrection = await inventory.stock.correct({
        operationId: "correct-opening",
        occurredAtEpochMs: time2,
        correctsEventId: root.eventId,
        reason: "Opening stock existed one day earlier than recorded.",
        replaceWith: (plans) =>
          plans.opening({
            occurredAtEpochMs: time0,
            to: loosePosition("opening-store"),
            amount: stockAmount("2", "piece"),
            itemRevisionId: "item-a-v2",
          }),
      });
      expect(openingCorrection.event.stockEffects).toEqual([]);
      expect(
        openingCorrection.event.positiveLayerProvenanceOverrides
      ).toMatchObject([{ startedAtEpochMs: time0 }]);
      const openingPlan = await inventory.read.planAllocation({
        selector: inventoryStockSelector("item-a", {
          locationIds: ["opening-store"],
        }),
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
        atEpochMs: time3,
      });
      expect(openingPlan.lines[0]?.layerStartedAtEpochMs).toBe(time0);
      correctedRootKinds.add(root.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "issue-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("issue-store"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.issue({
        operationId: "issue-root",
        occurredAtEpochMs: time1,
        from: loosePosition("issue-store"),
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-issue",
        occurredAtEpochMs: time2,
        correctsEventId: root.event.eventId,
        reason: "Issue row was checked.",
        replaceWith: (plans) =>
          plans.issue({
            occurredAtEpochMs: time1,
            from: loosePosition("issue-store"),
            amount: stockAmount("1", "piece"),
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "transfer-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("transfer-a"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.transfer({
        operationId: "transfer-root",
        occurredAtEpochMs: time1,
        from: loosePosition("transfer-a"),
        toLocationId: "transfer-b",
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-transfer",
        occurredAtEpochMs: time2,
        correctsEventId: root.event.eventId,
        reason: "Transfer row was checked.",
        replaceWith: (plans) =>
          plans.transfer({
            occurredAtEpochMs: time1,
            from: loosePosition("transfer-a"),
            toLocationId: "transfer-b",
            amount: stockAmount("1", "piece"),
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "reclass-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("reclass-store"),
        amount: stockAmount("1", "piece"),
      });
      const root = await inventory.stock.changeStatus({
        operationId: "reclass-root",
        occurredAtEpochMs: time1,
        from: loosePosition("reclass-store"),
        toStatusId: "quarantine",
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-reclass",
        occurredAtEpochMs: time2,
        correctsEventId: root.event.eventId,
        reason: "Status row was checked.",
        replaceWith: (plans) =>
          plans.changeStatus({
            occurredAtEpochMs: time1,
            from: loosePosition("reclass-store"),
            toStatusId: "quarantine",
            amount: stockAmount("1", "piece"),
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "package-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("package-store"),
        itemRevisionId: "item-a-v1",
        amount: stockAmount("20", "piece"),
      });
      const packRoot = await inventory.stock.pack({
        operationId: "pack-root",
        occurredAtEpochMs: time1,
        from: loosePosition("package-store"),
        packagingRevisionId: "item-a-box-20-v1",
        packageCount: 1,
      });
      await inventory.stock.correct({
        operationId: "correct-pack",
        occurredAtEpochMs: time2,
        correctsEventId: packRoot.event.eventId,
        reason: "Pack row was checked.",
        replaceWith: (plans) =>
          plans.pack({
            occurredAtEpochMs: time1,
            from: loosePosition("package-store"),
            packagingRevisionId: "item-a-box-20-v1",
            packageCount: 1,
          }),
      });
      correctedRootKinds.add(packRoot.event.kind);
      const unpackRoot = await inventory.stock.unpack({
        operationId: "unpack-root",
        occurredAtEpochMs: time2,
        from: loosePosition("package-store", {
          packagingRevisionId: "item-a-box-20-v1",
        }),
        packageCount: 1,
      });
      await inventory.stock.correct({
        operationId: "correct-unpack",
        occurredAtEpochMs: time3,
        correctsEventId: unpackRoot.event.eventId,
        reason: "Unpack row was checked.",
        replaceWith: (plans) =>
          plans.unpack({
            occurredAtEpochMs: time2,
            from: loosePosition("package-store", {
              packagingRevisionId: "item-a-box-20-v1",
            }),
            packageCount: 1,
          }),
      });
      correctedRootKinds.add(unpackRoot.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "transform-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("transform-store", { serialId: "input-serial" }),
        amount: stockAmount("1", "piece"),
      });
      const root = await inventory.stock.transform({
        operationId: "transform-root",
        occurredAtEpochMs: time1,
        consume: [
          {
            position: loosePosition("transform-store", {
              serialId: "input-serial",
            }),
            amount: stockAmount("1", "piece"),
          },
        ],
        produce: [
          {
            position: loosePosition("transform-store", {
              serialId: "output-serial",
            }),
            amount: stockAmount("1", "piece"),
          },
        ],
      });
      await inventory.stock.correct({
        operationId: "correct-transform",
        occurredAtEpochMs: time2,
        correctsEventId: root.event.eventId,
        reason: "Transformation row was checked.",
        replaceWith: (plans) =>
          plans.transform({
            occurredAtEpochMs: time1,
            consume: [
              {
                position: loosePosition("transform-store", {
                  serialId: "input-serial",
                }),
                amount: stockAmount("1", "piece"),
              },
            ],
            produce: [
              {
                position: loosePosition("transform-store", {
                  serialId: "output-serial",
                }),
                amount: stockAmount("1", "piece"),
              },
            ],
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "scrap-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("scrap-store"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.scrap({
        operationId: "scrap-root",
        occurredAtEpochMs: time1,
        from: loosePosition("scrap-store"),
        amount: stockAmount("1", "piece"),
        reason: "Broken.",
      });
      await inventory.stock.correct({
        operationId: "correct-scrap",
        occurredAtEpochMs: time2,
        correctsEventId: root.event.eventId,
        reason: "Scrap row was checked.",
        replaceWith: (plans) =>
          plans.scrap({
            occurredAtEpochMs: time1,
            from: loosePosition("scrap-store"),
            amount: stockAmount("1", "piece"),
            reason: "Broken.",
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      const child = {
        kind: InventoryTraceabilityNodeKind.Container,
        id: "trace-child",
      };
      const parent = {
        kind: InventoryTraceabilityNodeKind.Container,
        id: "trace-parent",
      };
      const root = await inventory.traceability.aggregate({
        operationId: "trace-root",
        occurredAtEpochMs: time0,
        from: child,
        to: parent,
      });
      await inventory.stock.correct({
        operationId: "correct-trace",
        occurredAtEpochMs: time1,
        correctsEventId: root.event.eventId,
        reason: "Traceability row was checked.",
        replaceWith: (plans) =>
          plans.aggregate({
            occurredAtEpochMs: time0,
            from: child,
            to: parent,
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      const root = await inventory.lots.define({
        operationId: "lot-metadata-root",
        occurredAtEpochMs: time0,
        itemId: "item-a",
        lotId: "lot-correction",
        lot: { expiresAtEpochMs: time3 },
      });
      await inventory.stock.correct({
        operationId: "correct-lot-metadata",
        occurredAtEpochMs: time1,
        correctsEventId: root.event.eventId,
        reason: "Lot metadata row was checked.",
        replaceWith: (plans) =>
          plans.lotMetadata({
            occurredAtEpochMs: time0,
            itemId: "item-a",
            lotId: "lot-correction",
            lot: { expiresAtEpochMs: time3 },
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      const root = await inventory.containers.define({
        operationId: "container-metadata-root",
        occurredAtEpochMs: time0,
        containerId: "container-correction",
        container: { containerType: "tray", useByEpochMs: time3 },
      });
      await inventory.stock.correct({
        operationId: "correct-container-metadata",
        occurredAtEpochMs: time1,
        correctsEventId: root.event.eventId,
        reason: "Container metadata row was checked.",
        replaceWith: (plans) =>
          plans.containerMetadata({
            occurredAtEpochMs: time0,
            containerId: "container-correction",
            container: { containerType: "tray", useByEpochMs: time3 },
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "count-correction-stock",
        occurredAtEpochMs: time0,
        to: loosePosition("count-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.counts.start({
        countId: "count-correction",
        operationId: "count-correction-start",
        selector: { itemId: "item-a", locationIds: ["count-store"] },
        startedAtEpochMs: time0,
      });
      const position = (
        await inventory.read.positions({
          itemId: "item-a",
          locationIds: ["count-store"],
        })
      )[0];
      if (position === undefined)
        throw new Error("Count correction stock disappeared.");
      const observed = {
        primary: { axisId: "pieces", quantity: parseQuantity("1", "piece") },
        independent: [],
      };
      await inventory.counts.observe({
        operationId: "count-correction-observe",
        countId: "count-correction",
        observedAtEpochMs: time1,
        observations: [{ position: position.key, measurements: observed }],
      });
      const root = await inventory.counts.reconcile({
        operationId: "count-adjustment-root",
        countId: "count-correction",
        completedAtEpochMs: time2,
        reason: "One missing.",
      });
      if (root.event === undefined)
        throw new Error("Expected count discrepancy event.");
      await inventory.stock.correct({
        operationId: "correct-count-adjustment",
        occurredAtEpochMs: time3,
        correctsEventId: root.event.eventId,
        reason: "Count discrepancy row was checked.",
        replaceWith: (plans) =>
          plans.countAdjustment({
            occurredAtEpochMs: time1,
            lines: [
              {
                position: position.key,
                expectedAtObservation: position.measurements,
                observed,
              },
            ],
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    const expectedCorrectableKinds = new Set(
      Object.values(InventoryEventKind).filter(
        (kind) =>
          kind !== InventoryEventKind.Correction &&
          kind !== InventoryEventKind.CatalogPublication
      )
    );
    expect(correctedRootKinds).toEqual(expectedCorrectableKinds);
  });
});


describe("transformation genealogy set semantics", () => {
  it("deduplicates shared input/output nodes independently of stock location and line order", async () => {
    for (const sharedInputLot of [false, true]) {
      for (const sharedOutputLot of [false, true]) {
        const inventory = createTestInventory();
        const consume = [0, 1].map(index => ({
          position: loosePosition(`source-${index}`, { lotId: sharedInputLot ? "input-shared" : `input-${index}` }),
          amount: stockAmount("1", "piece"),
        }));
        const produce = [0, 1].map(index => ({
          position: loosePosition(`output-${index}`, { lotId: sharedOutputLot ? "output-shared" : `output-${index}` }),
          amount: stockAmount("1", "piece"),
        }));
        for (const [index, line] of consume.entries()) {
          await inventory.stock.receive({ operationId: `genealogy-seed-${index}`, occurredAtEpochMs: time0, to: line.position, amount: line.amount });
        }
        const command = { operationId: "genealogy-shared-nodes", occurredAtEpochMs: time1, consume, produce };
        const result = await inventory.stock.transform(command);
        const after = await inventory.read.world();
        const relations = Object.values(after.projection.traceability.relations);
        const expectedEdges = (sharedInputLot ? 1 : 2) * (sharedOutputLot ? 1 : 2);
        expect(result.event.traceabilityChanges).toHaveLength(expectedEdges);
        expect(relations).toHaveLength(expectedEdges);
        expect(new Set(relations.map(relation => inventoryTraceabilityRelationIdentity(relation.kind, relation.from, relation.to))).size).toBe(expectedEdges);
        expect((await inventory.stock.transform(command)).replayed).toBe(true);
        expect(await inventory.read.world()).toEqual(after);
        const reordered = await inventory.stock.transform({ ...command, consume: [...consume].reverse(), produce: [...produce].reverse() });
        expect(reordered.replayed).toBe(true);
        expect(await inventory.read.world()).toEqual(after);
      }
    }
  });
});


describe("runtime discriminator and ownership hardening", () => {
  it("rejects unsupported event, transfer, traceability, and node discriminators", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory();
    const received = await inventory.stock.receive({
      operationId: "discriminator-receipt",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    expect(() =>
      Reflect.apply(defineInventoryEvent, undefined, [
        { catalog, event: { ...received.event, kind: "unsupported-event" } },
      ])
    ).toThrow(/Unsupported inventory event kind/u);
    expect(() =>
      Reflect.apply(defineInventoryEvent, undefined, [
        {
          catalog,
          event: {
            ...received.event,
            transferLifecycle: {
              action: "unsupported-transfer-action",
              transferId: "TRANSFER-UNKNOWN-ACTION",
            },
          },
        },
      ])
    ).toThrow(/Unsupported transfer lifecycle action/u);

    const from = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "DISCRIMINATOR-FROM",
    };
    const to = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "DISCRIMINATOR-TO",
    };
    const traceabilityEvent = {
      eventId: "discriminator-trace-event",
      operationId: "discriminator-trace-operation",
      kind: InventoryEventKind.Traceability,
      occurredAtEpochMs: time0,
      stockEffects: [],
      traceabilityChanges: [
        {
          action: InventoryTraceabilityRelationAction.Add,
          kind: InventoryTraceabilityRelationKind.Association,
          from,
          to,
        },
      ],
    };
    expect(() =>
      Reflect.apply(defineInventoryEvent, undefined, [
        {
          catalog,
          event: {
            ...traceabilityEvent,
            traceabilityChanges: [
              { ...traceabilityEvent.traceabilityChanges[0], kind: "unsupported-relation" },
            ],
          },
        },
      ])
    ).toThrow(/Unsupported traceability relation kind/u);
    expect(() =>
      Reflect.apply(defineInventoryEvent, undefined, [
        {
          catalog,
          event: {
            ...traceabilityEvent,
            traceabilityChanges: [
              { ...traceabilityEvent.traceabilityChanges[0], action: "unsupported-action" },
            ],
          },
        },
      ])
    ).toThrow(/Unsupported traceability action/u);
    expect(() =>
      Reflect.apply(inventoryTraceabilityNodeIdentity, undefined, [
        { kind: "unsupported-node", id: "NODE-UNKNOWN-KIND" },
      ])
    ).toThrow(/Unsupported traceability node kind/u);
  });

  it("detaches projected traceability relation nodes from caller and event objects", () => {
    const from = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "OWNERSHIP-FROM",
    };
    const to = {
      kind: InventoryTraceabilityNodeKind.Container,
      id: "OWNERSHIP-TO",
    };
    const change = {
      action: InventoryTraceabilityRelationAction.Add,
      kind: InventoryTraceabilityRelationKind.Association,
      from,
      to,
    };
    const identity = inventoryTraceabilityRelationIdentity(
      change.kind,
      change.from,
      change.to
    );
    const live = applyInventoryTraceabilityChanges({
      state: { relations: {}, containmentChildContainerIdsByParentNodeIdentity: {} },
      eventId: "ownership-live-event",
      changes: [change],
    });
    from.id = "MUTATED-CALLER-FROM";
    to.id = "MUTATED-CALLER-TO";
    expect(live.relations[identity]?.from.id).toBe("OWNERSHIP-FROM");
    expect(live.relations[identity]?.to.id).toBe("OWNERSHIP-TO");

    const catalog = createTabletCatalog();
    const draft = defineInventoryEvent({
      catalog,
      event: {
        eventId: "ownership-replay-event",
        operationId: "ownership-replay-operation",
        kind: InventoryEventKind.Traceability,
        occurredAtEpochMs: time0,
        stockEffects: [],
        traceabilityChanges: [
          {
            action: InventoryTraceabilityRelationAction.Add,
            kind: InventoryTraceabilityRelationKind.Association,
            from: {
              kind: InventoryTraceabilityNodeKind.Container,
              id: "REPLAY-FROM",
            },
            to: {
              kind: InventoryTraceabilityNodeKind.Container,
              id: "REPLAY-TO",
            },
          },
        ],
      },
    });
    const committed = commitInventoryEvent(draft, time1, 1);
    const replayed = projectInventoryTraceabilityEvents([committed]);
    const replayIdentity = Object.keys(replayed.relations)[0];
    const committedChange = committed.traceabilityChanges[0];
    expect(committedChange).toBeDefined();
    Reflect.set(committedChange?.from ?? {}, "id", "MUTATED-COMMITTED-FROM");
    Reflect.set(committedChange?.to ?? {}, "id", "MUTATED-COMMITTED-TO");
    expect(replayed.relations[replayIdentity ?? ""]?.from.id).toBe("REPLAY-FROM");
    expect(replayed.relations[replayIdentity ?? ""]?.to.id).toBe("REPLAY-TO");
  });

  it("replays a cross-kind metadata-root correction using the replacement physical kind", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog);
    const metadataRoot = await inventory.lots.define({
      operationId: "cross-kind-lot-root",
      occurredAtEpochMs: time0,
      itemId: "item-a",
      lotId: "CROSS-KIND-LOT",
      lot: { expiresAtEpochMs: time3 + 86_400_000 },
    });
    const replacementInventory = createTestInventory(undefined, catalog);
    const receipt = await replacementInventory.stock.receive({
      operationId: "cross-kind-receipt-template",
      occurredAtEpochMs: time0,
      to: loosePosition("store", { lotId: "CROSS-KIND-LOT" }),
      amount: stockAmount("1", "piece"),
      lot: { expiresAtEpochMs: time3 + 86_400_000 },
    });
    const world = await inventory.read.world();
    const correction = createInventoryCorrectionEvent({
      catalog,
      projection: world.projection,
      operationId: "cross-kind-correction",
      occurredAtEpochMs: time3,
      correctsEventId: metadataRoot.event.eventId,
      replacement: {
        ...receipt.event,
        eventId: metadataRoot.event.eventId,
        operationId: metadataRoot.event.operationId,
      },
      reason: "The retained root was a physical receipt, not metadata-only.",
    });
    expect(correction.stockEffects).toHaveLength(1);
    expect(
      correction.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor
    ).toBe(1);
  });
});
