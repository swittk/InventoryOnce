import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryEventKind,
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  inventoryStockSelector,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
} from "../src/migrations-api.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { commitInventoryEvent, defineInventoryEvent } from "../src/events.js";
import { inventoryGenealogyAncestors } from "../src/kernel.js";
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
      occurredAt: time0,
      from: child,
      to: parent,
    });
    await inventory.traceability.associate({
      operationId: "associate-child",
      occurredAt: time1,
      from: child,
      to: parent,
    });
    const world = await inventory.read.world();
    const kinds = Object.values(world.projection.traceability.relations)
      .map((relation) => relation.kind)
      .sort();
    expect(kinds).toEqual([
      InventoryTraceabilityRelationKind.Association,
      InventoryTraceabilityRelationKind.Containment,
    ]);
    await expect(
      inventory.traceability.aggregate({
        operationId: "aggregate-cycle",
        occurredAt: time2,
        from: parent,
        to: child,
      })
    ).rejects.toThrow("Containment graph contains a cycle");
    await inventory.traceability.disaggregate({
      operationId: "disaggregate-child",
      occurredAt: time3,
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
          occurredAt: time0,
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
          occurredAt: time1,
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
    const relationCount = 20_000;
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

  it("records transformation genealogy without treating it as containment", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-transform-input",
      occurredAt: time0,
      to: loosePosition("work", { serialId: "serial-in" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transform({
      operationId: "transform-one",
      occurredAt: time1,
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
      occurredAt: time0,
      to: loosePosition("work", { serialId: "serial-a" }),
      amount: stockAmount("1", "piece"),
    });
    await expect(
      inventory.stock.transform({
        operationId: "unrelated-genealogy",
        occurredAt: time1,
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
  it("retains the original event and supersedes correction heads without rewriting history", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "wrong-receipt",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("10", "piece"),
    });
    const firstCorrection = await inventory.stock.correct({
      operationId: "correct-to-seven",
      occurredAt: time1,
      correctsEventId: original.event.eventId,
      reason: "The source document said seven.",
      metadata: { correctionTicket: "ticket-1" },
      replaceWith: (plans) =>
        plans.receive({
          occurredAt: time0,
          to: loosePosition("store"),
          amount: stockAmount("7", "piece"),
        }),
    });
    const secondCorrection = await inventory.stock.correct({
      operationId: "correct-to-eight",
      occurredAt: time2,
      correctsEventId: original.event.eventId,
      reason: "Final recount confirmed eight.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAt: time0,
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
    expect(firstCorrection.event.occurredAt).toBe(time1);
    expect(firstCorrection.event.metadata).toMatchObject({
      correctionTicket: "ticket-1",
      replacementOccurredAt: time0,
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

  it("rejects a replacement whose historical replay violates Reject deficit policy", async () => {
    const inventory = createTestInventory();
    const original = await inventory.stock.receive({
      operationId: "reject-correction-root",
      occurredAt: time0,
      to: loosePosition("reject-correction-store"),
      amount: stockAmount("10", "piece"),
    });
    await inventory.stock.issue({
      operationId: "reject-correction-issue",
      occurredAt: time1,
      from: loosePosition("reject-correction-store"),
      amount: stockAmount("8", "piece"),
    });
    await inventory.stock.receive({
      operationId: "reject-correction-later-receipt",
      occurredAt: time2,
      to: loosePosition("reject-correction-store"),
      amount: stockAmount("5", "piece"),
    });

    await expect(
      inventory.stock.correct({
        operationId: "reject-correction-rewrite-root",
        occurredAt: time3,
        correctsEventId: original.event.eventId,
        reason: "The original receipt was only five pieces.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAt: time0,
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
      occurredAt: time1,
      to: loosePosition("fifo-store", { lotId: "LOT-A" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "fifo-other-root",
      occurredAt: time0,
      to: loosePosition("fifo-store", { lotId: "LOT-B" }),
      amount: stockAmount("1", "piece"),
    });
    const request = {
      selector: inventoryStockSelector("item-a", {
        locationIds: ["fifo-store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time2,
    };
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-B");

    const earlierTime = "2026-08-24T07:00:00.000Z";
    const firstCorrection = await inventory.stock.correct({
      operationId: "fifo-provenance-earlier",
      occurredAt: time2,
      correctsEventId: correctedRoot.event.eventId,
      reason: "The receipt happened one hour earlier.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAt: earlierTime,
          to: loosePosition("fifo-store", { lotId: "LOT-A" }),
          amount: stockAmount("1", "piece"),
        }),
    });
    expect(firstCorrection.event.stockEffects).toEqual([]);
    expect(
      firstCorrection.event.positiveLayerProvenanceOverrides
    ).toMatchObject([{ startedAt: earlierTime }]);
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-A");

    const secondCorrection = await inventory.stock.correct({
      operationId: "fifo-provenance-restored",
      occurredAt: time3,
      correctsEventId: correctedRoot.event.eventId,
      reason: "The original receipt time was confirmed after all.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAt: time1,
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
    ).toMatchObject([{ startedAt: time1 }]);
    expect(
      (await inventory.read.planAllocation(request)).lines[0]?.position.lotId
    ).toBe("LOT-B");
  });

  it("rebuilds FIFO provenance when an omitted root leaves a later top-up", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "omit-layer-root",
      occurredAt: time0,
      to: loosePosition("omit-layer-store", { lotId: "LOT-OMIT" }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "omit-layer-top-up",
      occurredAt: time1,
      to: loosePosition("omit-layer-store", { lotId: "LOT-OMIT" }),
      amount: stockAmount("1", "piece"),
    });

    const correction = await inventory.stock.correct({
      operationId: "omit-layer-root-correction",
      occurredAt: time2,
      correctsEventId: root.event.eventId,
      reason: "The first receipt never happened.",
      replaceWith: (plans) => plans.omit(),
    });
    expect(correction.event.positiveLayerProvenanceOverrides).toMatchObject([
      { startedAt: time1 },
    ]);
    const plan = await inventory.read.planAllocation({
      selector: inventoryStockSelector("item-a", {
        locationIds: ["omit-layer-store"],
      }),
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fifo,
      at: time3,
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.layerStartedAt).toBe(time1);
    expect(plan.lines[0]?.allocatedPrimary.amountMinor).toBe(1);
  });

  it("offers a truthful declarative replacement for every non-correction event kind", async () => {
    const correctedRootKinds = new Set<InventoryEventKind>();

    {
      const inventory = createTestInventory();
      const root = await inventory.stock.receive({
        operationId: "receipt-kind-root",
        occurredAt: time0,
        to: loosePosition("receipt-kind-store"),
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-receipt-kind",
        occurredAt: time1,
        correctsEventId: root.event.eventId,
        reason: "Receipt row was checked.",
        replaceWith: (plans) =>
          plans.receive({
            occurredAt: time0,
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
          cutoverAt: time1,
          openingStock: [
            {
              openingId: "opening-one",
              position: loosePosition("opening-store"),
              amount: stockAmount("2", "piece"),
              occurredAt: time1,
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
        occurredAt: time2,
        correctsEventId: root.eventId,
        reason: "Opening stock existed one day earlier than recorded.",
        replaceWith: (plans) =>
          plans.opening({
            occurredAt: time0,
            to: loosePosition("opening-store"),
            amount: stockAmount("2", "piece"),
            itemRevisionId: "item-a-v2",
          }),
      });
      expect(openingCorrection.event.stockEffects).toEqual([]);
      expect(
        openingCorrection.event.positiveLayerProvenanceOverrides
      ).toMatchObject([{ startedAt: time0 }]);
      const openingPlan = await inventory.read.planAllocation({
        selector: inventoryStockSelector("item-a", {
          locationIds: ["opening-store"],
        }),
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
        at: time3,
      });
      expect(openingPlan.lines[0]?.layerStartedAt).toBe(time0);
      correctedRootKinds.add(root.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "issue-stock",
        occurredAt: time0,
        to: loosePosition("issue-store"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.issue({
        operationId: "issue-root",
        occurredAt: time1,
        from: loosePosition("issue-store"),
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-issue",
        occurredAt: time2,
        correctsEventId: root.event.eventId,
        reason: "Issue row was checked.",
        replaceWith: (plans) =>
          plans.issue({
            occurredAt: time1,
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
        occurredAt: time0,
        to: loosePosition("transfer-a"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.transfer({
        operationId: "transfer-root",
        occurredAt: time1,
        from: loosePosition("transfer-a"),
        toLocationId: "transfer-b",
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-transfer",
        occurredAt: time2,
        correctsEventId: root.event.eventId,
        reason: "Transfer row was checked.",
        replaceWith: (plans) =>
          plans.transfer({
            occurredAt: time1,
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
        occurredAt: time0,
        to: loosePosition("reclass-store"),
        amount: stockAmount("1", "piece"),
      });
      const root = await inventory.stock.changeStatus({
        operationId: "reclass-root",
        occurredAt: time1,
        from: loosePosition("reclass-store"),
        toStatusId: "quarantine",
        amount: stockAmount("1", "piece"),
      });
      await inventory.stock.correct({
        operationId: "correct-reclass",
        occurredAt: time2,
        correctsEventId: root.event.eventId,
        reason: "Status row was checked.",
        replaceWith: (plans) =>
          plans.changeStatus({
            occurredAt: time1,
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
        occurredAt: time0,
        to: loosePosition("package-store"),
        itemRevisionId: "item-a-v1",
        amount: stockAmount("20", "piece"),
      });
      const packRoot = await inventory.stock.pack({
        operationId: "pack-root",
        occurredAt: time1,
        from: loosePosition("package-store"),
        packagingRevisionId: "item-a-box-20-v1",
        packageCount: 1,
      });
      await inventory.stock.correct({
        operationId: "correct-pack",
        occurredAt: time2,
        correctsEventId: packRoot.event.eventId,
        reason: "Pack row was checked.",
        replaceWith: (plans) =>
          plans.pack({
            occurredAt: time1,
            from: loosePosition("package-store"),
            packagingRevisionId: "item-a-box-20-v1",
            packageCount: 1,
          }),
      });
      correctedRootKinds.add(packRoot.event.kind);
      const unpackRoot = await inventory.stock.unpack({
        operationId: "unpack-root",
        occurredAt: time2,
        from: loosePosition("package-store", {
          packagingRevisionId: "item-a-box-20-v1",
        }),
        packageCount: 1,
      });
      await inventory.stock.correct({
        operationId: "correct-unpack",
        occurredAt: time3,
        correctsEventId: unpackRoot.event.eventId,
        reason: "Unpack row was checked.",
        replaceWith: (plans) =>
          plans.unpack({
            occurredAt: time2,
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
        occurredAt: time0,
        to: loosePosition("transform-store", { serialId: "input-serial" }),
        amount: stockAmount("1", "piece"),
      });
      const root = await inventory.stock.transform({
        operationId: "transform-root",
        occurredAt: time1,
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
        occurredAt: time2,
        correctsEventId: root.event.eventId,
        reason: "Transformation row was checked.",
        replaceWith: (plans) =>
          plans.transform({
            occurredAt: time1,
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
        occurredAt: time0,
        to: loosePosition("scrap-store"),
        amount: stockAmount("2", "piece"),
      });
      const root = await inventory.stock.scrap({
        operationId: "scrap-root",
        occurredAt: time1,
        from: loosePosition("scrap-store"),
        amount: stockAmount("1", "piece"),
        reason: "Broken.",
      });
      await inventory.stock.correct({
        operationId: "correct-scrap",
        occurredAt: time2,
        correctsEventId: root.event.eventId,
        reason: "Scrap row was checked.",
        replaceWith: (plans) =>
          plans.scrap({
            occurredAt: time1,
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
        occurredAt: time0,
        from: child,
        to: parent,
      });
      await inventory.stock.correct({
        operationId: "correct-trace",
        occurredAt: time1,
        correctsEventId: root.event.eventId,
        reason: "Traceability row was checked.",
        replaceWith: (plans) =>
          plans.aggregate({
            occurredAt: time0,
            from: child,
            to: parent,
          }),
      });
      correctedRootKinds.add(root.event.kind);
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "count-correction-stock",
        occurredAt: time0,
        to: loosePosition("count-store"),
        amount: stockAmount("2", "piece"),
      });
      await inventory.counts.start({
        countId: "count-correction",
        operationId: "count-correction-start",
        selector: { itemId: "item-a", locationIds: ["count-store"] },
        startedAt: time0,
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
        observedAt: time1,
        observations: [{ position: position.key, measurements: observed }],
      });
      const root = await inventory.counts.reconcile({
        operationId: "count-adjustment-root",
        countId: "count-correction",
        completedAt: time2,
        reason: "One missing.",
      });
      if (root.event === undefined)
        throw new Error("Expected count discrepancy event.");
      await inventory.stock.correct({
        operationId: "correct-count-adjustment",
        occurredAt: time3,
        correctsEventId: root.event.eventId,
        reason: "Count discrepancy row was checked.",
        replaceWith: (plans) =>
          plans.countAdjustment({
            occurredAt: time1,
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

    expect(correctedRootKinds).toEqual(
      new Set([
        InventoryEventKind.Opening,
        InventoryEventKind.Receipt,
        InventoryEventKind.Issue,
        InventoryEventKind.Transfer,
        InventoryEventKind.Reclassification,
        InventoryEventKind.Pack,
        InventoryEventKind.Unpack,
        InventoryEventKind.Transformation,
        InventoryEventKind.Scrap,
        InventoryEventKind.Traceability,
        InventoryEventKind.CountAdjustment,
      ])
    );
  });
});
