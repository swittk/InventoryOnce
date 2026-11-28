import { describe, expect, it, vi } from "vitest";
import { inventoryEventDependencyKeys } from "../src/event-query.js";
import { inventoryLotIdentity, inventoryStockPositionIdentity } from "../src/model.js";
import {
  InventoryEventKind,
  InventoryEventQueryDirection,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

describe("indexed retained event history", () => {
  it("queries serial/resource history, embedded historical assertions, and stable pages", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "event-query-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store", {
        serialId: "SERIAL-Q",
        lotId: "LOT-Q",
      }),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.transfer({
      operationId: "event-query-transfer",
      occurredAtEpochMs: time3,
      from: loosePosition("store", {
        serialId: "SERIAL-Q",
        lotId: "LOT-Q",
      }),
      toPlacementNodeId: "room",
      amount: stockAmount("1", "piece"),
    });
    const repair = await inventory.stock.recordHistorical({
      operationId: "event-query-repair",
      occurredAtEpochMs: time3,
      reason: "The serial was briefly missing and recovered before transfer.",
      assertions: [
        {
          assertionId: "query-missing",
          assert: (plans) =>
            plans.markMissing({
              occurredAtEpochMs: time1,
              from: loosePosition("store", {
                serialId: "SERIAL-Q",
                lotId: "LOT-Q",
              }),
              amount: stockAmount("1", "piece"),
            }),
        },
        {
          assertionId: "query-found",
          assert: (plans) =>
            plans.place({
              occurredAtEpochMs: time2,
              from: plans.outputOf("query-missing"),
              into: "store",
              amount: stockAmount("1", "piece"),
            }),
        },
      ],
    });
    const whereaboutsId = repair.event.historicalRepair?.assertions[0]?.event
      .stockEffects.find((effect) => effect.position.whereaboutsId !== undefined)
      ?.position.whereaboutsId;
    if (whereaboutsId === undefined) {
      throw new Error("Historical missing assertion lost its cohort identity.");
    }

    const worldRead = vi.spyOn(storage, "readWorld").mockRejectedValue(
      new Error("Indexed read.events unexpectedly materialized the canonical world.")
    );
    try {
      const serialPage = await inventory.read.events({
        serials: [{ itemId: "item-a", serialId: "SERIAL-Q" }],
      });
      expect(serialPage.events.map((event) => event.operationId)).toEqual([
        "event-query-receive",
        "event-query-transfer",
        "event-query-repair",
      ]);

      const embeddedKind = await inventory.read.events({
        kinds: [InventoryEventKind.Reclassification],
        occurredFromEpochMs: time1,
        occurredThroughEpochMs: time2,
      });
      expect(embeddedKind.events.map((event) => event.operationId)).toEqual([
        "event-query-repair",
      ]);

      const cohortPage = await inventory.read.events({
        whereaboutsIds: [whereaboutsId],
      });
      expect(cohortPage.events.map((event) => event.operationId)).toEqual([
        "event-query-repair",
      ]);

      const first = await inventory.read.events({
        itemIds: ["item-a"],
        limit: 1,
      });
      expect(first.events).toHaveLength(1);
      expect(first.nextCursor).toBeDefined();
      if (first.nextCursor === undefined) {
        throw new Error("Expected another item-history cursor.");
      }
      const second = await inventory.read.events({
        itemIds: ["item-a"],
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(second.events[0]?.recordSequence).toBeGreaterThan(
        first.events[0]?.recordSequence ?? 0
      );
    } finally {
      worldRead.mockRestore();
    }

    const snapshot = await inventory.read.snapshot();
    expect(
      snapshot
        .events({ lots: [{ itemId: "item-a", lotId: "LOT-Q" }] })
        .events.map((event) => event.operationId)
    ).toEqual([
      "event-query-receive",
      "event-query-transfer",
      "event-query-repair",
    ]);
  });

  it("indexes correction envelopes through their replacement kind in segmented and canonical reads", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "replacement-kind-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const detached = await inventory.stock.detach({
      operationId: "replacement-kind-detach",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const correction = await inventory.stock.correct({
      operationId: "replacement-kind-correction",
      occurredAtEpochMs: time2,
      correctsEventId: detached.event.eventId,
      reason: "Audit showed the unit was issued rather than detached.",
      replaceWith: (plans) =>
        plans.issue({
          occurredAtEpochMs: time1,
          from: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        }),
    });

    const worldRead = vi.spyOn(storage, "readWorld").mockRejectedValue(
      new Error("Replacement-kind query unexpectedly materialized the world.")
    );
    try {
      const segmented = await inventory.read.events({
        kinds: [InventoryEventKind.Issue],
      });
      expect(segmented.events.map((event) => event.eventId)).toEqual([
        correction.event.eventId,
      ]);
    } finally {
      worldRead.mockRestore();
    }

    const snapshot = await inventory.read.snapshot();
    expect(
      snapshot
        .events({ kinds: [InventoryEventKind.Issue] })
        .events.map((event) => event.eventId)
    ).toEqual([correction.event.eventId]);
  });

  it("queries correction lineage without scanning caller-visible projection maps", async () => {
    const inventory = createTestInventory();
    const root = await inventory.stock.receive({
      operationId: "event-query-correction-root",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    const correction = await inventory.stock.correct({
      operationId: "event-query-correction",
      occurredAtEpochMs: time1,
      correctsEventId: root.event.eventId,
      reason: "The receipt contained one piece.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time0,
          to: loosePosition("store"),
          amount: stockAmount("1", "piece"),
        }),
    });
    const page = await inventory.read.events({
      correctsEventIds: [root.event.eventId],
    });
    expect(page.events.map((event) => event.eventId)).toEqual([
      correction.event.eventId,
    ]);
  });

  it("keeps cursor pages on one journal head and supports newest-first traversal", async () => {
    const inventory = createTestInventory();
    for (const [index, placementNodeId] of ["a", "b", "c"].entries()) {
      await inventory.stock.receive({
        operationId: `stable-page-${index + 1}`,
        occurredAtEpochMs: time0 + index,
        to: loosePosition(placementNodeId),
        amount: stockAmount("1", "piece"),
      });
    }

    const first = await inventory.read.events({ limit: 1 });
    expect(first.throughRecordSequence).toBe(3);
    expect(first.nextCursor).toBeDefined();
    await inventory.stock.receive({
      operationId: "stable-page-4",
      occurredAtEpochMs: time3,
      to: loosePosition("d"),
      amount: stockAmount("1", "piece"),
    });

    const frozenIds = [...first.events.map((event) => event.operationId)];
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page = await inventory.read.events({ cursor, limit: 1 });
      expect(page.throughRecordSequence).toBe(3);
      frozenIds.push(...page.events.map((event) => event.operationId));
      cursor = page.nextCursor;
    }
    expect(frozenIds).toEqual([
      "stable-page-1",
      "stable-page-2",
      "stable-page-3",
    ]);

    const newest = await inventory.read.events({
      direction: InventoryEventQueryDirection.Descending,
      limit: 2,
    });
    expect(newest.events.map((event) => event.operationId)).toEqual([
      "stable-page-4",
      "stable-page-3",
    ]);
    expect(newest.nextCursor).toBeDefined();
    if (newest.nextCursor === undefined) {
      throw new Error("Expected a newest-first continuation cursor.");
    }
    const older = await inventory.read.events({
      direction: InventoryEventQueryDirection.Descending,
      cursor: newest.nextCursor,
      limit: 2,
    });
    expect(older.events.map((event) => event.operationId)).toEqual([
      "stable-page-2",
      "stable-page-1",
    ]);
    expect(older.nextCursor).toBeUndefined();
  });

  /** Sequence zero is a valid inclusive lower bound, never an indexed event. */
  it("keeps descending zero-bound pages empty or complete across indexed and snapshot reads", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const fromZero = {
      direction: InventoryEventQueryDirection.Descending,
      recordSequenceFrom: 0,
    } as const;
    const zeroOnly = { ...fromZero, recordSequenceThrough: 0 };

    const empty = await inventory.read.snapshot();
    expect(empty.events(fromZero).events).toEqual([]);
    expect(empty.events(zeroOnly).events).toEqual([]);
    expect((await inventory.read.events(fromZero)).events).toEqual([]);
    expect((await inventory.read.events(zeroOnly)).events).toEqual([]);

    for (const [index, placementNodeId] of ["a", "b"].entries()) {
      await inventory.stock.receive({
        operationId: `zero-bound-receive-${index + 1}`,
        occurredAtEpochMs: time0 + index,
        to: loosePosition(placementNodeId),
        amount: stockAmount("1", "piece"),
      });
    }

    const snapshot = await inventory.read.snapshot();
    const expected = snapshot.events({ direction: InventoryEventQueryDirection.Descending });
    expect(expected.events.map((event) => event.operationId)).toEqual([
      "zero-bound-receive-2",
      "zero-bound-receive-1",
    ]);
    expect(snapshot.events(fromZero)).toEqual(expected);
    expect(await inventory.read.events(fromZero)).toEqual(expected);
    expect(snapshot.events(zeroOnly).events).toEqual([]);
    expect((await inventory.read.events(zeroOnly)).events).toEqual([]);

    const first = await inventory.read.events({ ...fromZero, limit: 1 });
    expect(first.events.map((event) => event.recordSequence)).toEqual([2]);
    if (first.nextCursor === undefined) {
      throw new Error("Expected descending continuation before sequence one.");
    }
    const second = await inventory.read.events({
      ...fromZero,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.events.map((event) => event.recordSequence)).toEqual([1]);
    expect(second.nextCursor).toBeUndefined();
    expect(
      snapshot.events({ ...fromZero, recordSequenceThrough: 1 }).events.map(
        (event) => event.recordSequence
      )
    ).toEqual([1]);
  });

  it("rejects malformed or query-mismatched continuation cursors", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "cursor-guard-1",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "cursor-guard-2",
      occurredAtEpochMs: time1,
      to: loosePosition("b"),
      amount: stockAmount("1", "piece"),
    });
    const first = await inventory.read.events({
      itemIds: ["item-a"],
      limit: 1,
    });
    if (first.nextCursor === undefined) {
      throw new Error("Expected one guarded continuation cursor.");
    }

    await expect(
      inventory.read.events({ cursor: "broken" })
    ).rejects.toThrow("cursor is invalid");
    await expect(
      inventory.read.events({
        cursor: first.nextCursor,
        itemIds: ["another-item"],
      })
    ).rejects.toThrow("does not match");
    await expect(
      inventory.read.events({
        cursor: first.nextCursor,
        itemIds: ["item-a"],
        direction: InventoryEventQueryDirection.Descending,
      })
    ).rejects.toThrow("does not match");
    await expect(
      inventory.read.events({
        occurredFromEpochMs: time2,
        occurredThroughEpochMs: time0,
      })
    ).rejects.toThrow("range is reversed");
  });

  it("includes query-mode dependency keys for positive-layer provenance override positions with zero stock delta", async () => {
    const inventory = createTestInventory();
    const to = loosePosition("store", { lotId: "LOT-OVERRIDE" });
    const receipt = await inventory.stock.receive({
      operationId: "override-key-receipt-1",
      occurredAtEpochMs: time0,
      to,
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.receive({
      operationId: "override-key-receipt-2",
      occurredAtEpochMs: time1,
      to,
      amount: stockAmount("2", "piece"),
    });
    await inventory.stock.issue({
      operationId: "override-key-issue",
      occurredAtEpochMs: time3,
      from: to,
      amount: stockAmount("2", "piece"),
    });
    const correction = await inventory.stock.correct({
      operationId: "override-key-correct",
      occurredAtEpochMs: time3,
      correctsEventId: receipt.event.eventId,
      reason: "Move initial receipt occurrence without changing ending stock quantity.",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: time2,
          to,
          amount: stockAmount("2", "piece"),
        }),
    });
    expect(correction.event.stockEffects).toEqual([]);
    expect(correction.event.positiveLayerProvenanceOverrides).toHaveLength(1);
    const overridePosition =
      correction.event.positiveLayerProvenanceOverrides![0]!.position;
    const keys = new Set(inventoryEventDependencyKeys(correction.event));
    expect(keys.has("dep:position:" + inventoryStockPositionIdentity(overridePosition))).toBe(true);
    expect(keys.has("dep:lot-stock:" + inventoryLotIdentity(to.itemId, "LOT-OVERRIDE"))).toBe(true);
    expect(keys.has("dep:lot-definition:" + inventoryLotIdentity(to.itemId, "LOT-OVERRIDE"))).toBe(true);
    expect(keys.has("dep:placement-definition:store")).toBe(true);
  });

});
