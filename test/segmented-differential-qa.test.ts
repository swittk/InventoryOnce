import { describe, expect, it } from "vitest";
import {
  createInMemoryInventoryDurableStorage,
  type InventoryDurableStorage,
} from "../src/storage-api.js";
import {
  InventoryStockWhereaboutsState,
  type InventoryStockPosition,
  type InventoryStockPositionInput,
} from "../src/model.js";
import {
  type InventoryOnce,
  type InventoryOnceEventResult,
} from "../src/facade.js";
import { stockAmount } from "../src/amounts.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time3,
} from "./test-fixtures.js";

/** Deliberately hide optional segmented capabilities to force the canonical durable coordinator. */
function canonicalOnlyStorage(
  storage: InventoryDurableStorage
): InventoryDurableStorage {
  return new Proxy(storage, {
    /** Preserve the same adapter semantics, exposing only the canonical interface. */
    get(target, property) {
      if (
        property === "commitSegmentedStockEvent" ||
        property === "readPositionSegment"
      ) {
        return undefined;
      }
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

/** Use a reproducible integer PRNG so a failed warehouse trace can be replayed exactly. */
function seededChoices(seed: number): (maxExclusive: number) => number {
  let state = seed >>> 0;
  return (maxExclusive) => {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("Seeded choice needs a positive nonempty candidate set.");
    }
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maxExclusive;
  };
}

/** Strip kernel-owned revision/transfer partitions from one projected source. */
function sourceOf(row: InventoryStockPosition): InventoryStockPositionInput {
  const {
    itemRevisionId: _itemRevisionId,
    transferId: _transferId,
    ...source
  } = row.key;
  return source;
}

/** Run one identical frozen command through both public authority implementations. */
async function compareCommittedCommand(
  segmented: InventoryOnce,
  canonical: InventoryOnce,
  run: (inventory: InventoryOnce) => Promise<InventoryOnceEventResult>,
  description: string
): Promise<void> {
  const fast = await run(segmented);
  const slow = await run(canonical);
  expect(fast.event, description).toEqual(slow.event);
  expect(fast.receipt, description).toEqual(slow.receipt);
  expect(fast.replayed, description).toBe(slow.replayed);
}

/** Compare the complete ledger and projected stock after both planners publish. */
async function compareWorlds(
  segmented: InventoryOnce,
  canonical: InventoryOnce,
  description: string
): Promise<void> {
  const fast = await segmented.read.world();
  const slow = await canonical.read.world();
  expect(fast, description).toEqual(slow);
  const fastRows = await segmented.read.positions({ itemId: "item-a" });
  const slowRows = await canonical.read.positions({ itemId: "item-a" });
  expect(fastRows, description).toEqual(slowRows);
  for (const placementNodeId of ["north", "south", "east", "west"]) {
    expect(
      await segmented.read.positions({
        itemId: "item-a",
        placementNodeIds: [placementNodeId],
      }),
      description + " placement=" + placementNodeId
    ).toEqual(await canonical.read.positions({
      itemId: "item-a",
      placementNodeIds: [placementNodeId],
    }));
  }
}

/** Require one failed public operation to leave the previous published truth unchanged. */
async function compareRejectedCommand(
  segmented: InventoryOnce,
  canonical: InventoryOnce,
  run: (inventory: InventoryOnce) => Promise<InventoryOnceEventResult>,
  description: string
): Promise<void> {
  const before = await segmented.read.world();
  await expect(run(segmented), description).rejects.toThrow();
  await expect(run(canonical), description).rejects.toThrow();
  await compareWorlds(segmented, canonical, description);
  expect(await segmented.read.world(), description).toEqual(before);
}

/** For eligible stock commands, prove no canonical whole-world read is required. */
async function withoutCanonicalWorldRead<Result>(
  storage: ReturnType<typeof createInMemoryInventoryDurableStorage>,
  perform: () => Promise<Result>
): Promise<Result> {
  const original = storage.readWorld;
  Object.defineProperty(storage, "readWorld", {
    configurable: true,
    value: async () => {
      throw new Error("eligible segmented command touched canonical readWorld");
    },
  });
  try {
    return await perform();
  } finally {
    Object.defineProperty(storage, "readWorld", {
      configurable: true,
      value: original,
    });
  }
}

describe("public segmented and canonical coordinator differential assurance", () => {
  it("keeps stock-only bulk, issue, and whereabouts commands off canonical world materialization", async () => {
    const catalog = createTabletCatalog();
    const segmentedStorage = createInMemoryInventoryDurableStorage();
    const canonicalStorage = createInMemoryInventoryDurableStorage();
    const segmented = createTestInventory(segmentedStorage, catalog, clockAt());
    const canonical = createTestInventory(
      canonicalOnlyStorage(canonicalStorage),
      catalog,
      clockAt()
    );
    const commands: Array<
      (inventory: InventoryOnce) => Promise<InventoryOnceEventResult>
    > = [
      (inventory) => inventory.stock.receiveMany({
        operationId: "hot-diff-receive",
        occurredAtEpochMs: time0,
        lines: [
          { to: loosePosition("north", { lotId: "HOT-A" }), amount: stockAmount("7", "piece") },
          { to: loosePosition("north", { lotId: "HOT-B" }), amount: stockAmount("6", "piece") },
          { to: loosePosition("north", { lotId: "HOT-C" }), amount: stockAmount("5", "piece") },
        ],
      }),
      (inventory) => inventory.stock.transferMany({
        operationId: "hot-diff-transfer-many",
        occurredAtEpochMs: time0,
        lines: [
          {
            from: loosePosition("north", { lotId: "HOT-A" }),
            toPlacementNodeId: "south",
            amount: stockAmount("2", "piece"),
          },
          {
            from: loosePosition("north", { lotId: "HOT-B" }),
            toPlacementNodeId: "east",
            amount: stockAmount("1", "piece"),
          },
        ],
      }),
      (inventory) => inventory.stock.issue({
        operationId: "hot-diff-issue",
        occurredAtEpochMs: time0,
        from: loosePosition("north", { lotId: "HOT-C" }),
        amount: stockAmount("1", "piece"),
      }),
      (inventory) => inventory.stock.changeStatus({
        operationId: "hot-diff-status",
        occurredAtEpochMs: time0,
        from: loosePosition("south", { lotId: "HOT-A" }),
        toStatusId: "quarantine",
        amount: stockAmount("1", "piece"),
      }),
      (inventory) => inventory.stock.detach({
        operationId: "hot-diff-detach",
        occurredAtEpochMs: time0,
        from: loosePosition("east", { lotId: "HOT-B" }),
        amount: stockAmount("1", "piece"),
      }),
    ];
    for (const [index, command] of commands.entries()) {
      const fast = await withoutCanonicalWorldRead(
        segmentedStorage,
        () => command(segmented)
      );
      const slow = await command(canonical);
      expect(fast.event, "hot command " + index).toEqual(slow.event);
      expect(fast.receipt, "hot command " + index).toEqual(slow.receipt);
    }
    const detached = (await segmented.read.positions({
      itemId: "item-a",
      whereaboutsStates: [InventoryStockWhereaboutsState.Detached],
    }))[0];
    if (detached === undefined) throw new Error("Expected detached HOT-B.");
    const promote = (inventory: InventoryOnce) => inventory.stock.markMissing({
      operationId: "hot-diff-mark-missing",
      occurredAtEpochMs: time0,
      from: sourceOf(detached),
      amount: stockAmount("1", "piece"),
    });
    await withoutCanonicalWorldRead(segmentedStorage, () => promote(segmented));
    await promote(canonical);

    const missing = (await segmented.read.positions({
      itemId: "item-a",
      whereaboutsStates: [InventoryStockWhereaboutsState.Missing],
    }))[0];
    if (missing === undefined) throw new Error("Expected missing HOT-B.");
    const recover = (inventory: InventoryOnce) => inventory.stock.place({
      operationId: "hot-diff-place",
      occurredAtEpochMs: time0,
      from: sourceOf(missing),
      into: "west",
      amount: stockAmount("1", "piece"),
    });
    await withoutCanonicalWorldRead(segmentedStorage, () => recover(segmented));
    await recover(canonical);

    await compareWorlds(segmented, canonical, "stock-only hot path complete");
  }, 60_000);

  it("catches up 160 deferred stock events in one canonical snapshot without changing history", async () => {
    const catalog = createTabletCatalog();
    const fastStorage = createInMemoryInventoryDurableStorage();
    const slowStorage = createInMemoryInventoryDurableStorage();
    const segmented = createTestInventory(fastStorage, catalog, clockAt());
    const canonical = createTestInventory(
      canonicalOnlyStorage(slowStorage),
      catalog,
      clockAt()
    );
    await compareCommittedCommand(
      segmented,
      canonical,
      (inventory) => inventory.stock.receive({
        operationId: "deferred-seed",
        occurredAtEpochMs: time0,
        to: loosePosition("north", { lotId: "DEFERRED-A" }),
        amount: stockAmount("1", "piece"),
      }),
      "deferred-seed"
    );
    for (let index = 0; index < 160; index += 1) {
      const from = index % 2 === 0 ? "north" : "south";
      const to = index % 2 === 0 ? "south" : "north";
      await compareCommittedCommand(
        segmented,
        canonical,
        (inventory) => inventory.stock.transfer({
          operationId: "deferred-transfer-" + index,
          occurredAtEpochMs: time0,
          from: loosePosition(from, { lotId: "DEFERRED-A" }),
          toPlacementNodeId: to,
          amount: stockAmount("1", "piece"),
        }),
        "deferred transfer " + index
      );
    }
    await compareWorlds(segmented, canonical, "160 deferred stock transfers");
    expect((await segmented.read.world()).projection.lastRecordSequence).toBe(161);
  }, 90_000);

  it.each([0xCAB17, 0xF00D, 0xBADA55, 0xDEADBEEF])(
    "preserves exact durable history under seed %i and mixed warehouse operations",
    async (seed) => {
    const catalog = createTabletCatalog();
    const segmentedStorage = createInMemoryInventoryDurableStorage();
    const canonicalStorage = createInMemoryInventoryDurableStorage();
    const segmented = createTestInventory(segmentedStorage, catalog, clockAt());
    const canonical = createTestInventory(
      canonicalOnlyStorage(canonicalStorage),
      catalog,
      clockAt()
    );
    const choose = seededChoices(seed);
    const exercised = Array.from({ length: 11 }, () => 0);
    /** Skip an unavailable operation kind rather than drawing from an empty array. */
    const pick = <Value>(candidates: readonly Value[]): Value | undefined =>
      candidates.length === 0
        ? undefined
        : candidates[choose(candidates.length)];
    const locations = ["north", "south", "east", "west"] as const;
    const initialLines = Array.from({ length: 24 }, (_, index) => ({
      to: loosePosition(locations[index % locations.length] ?? "north", {
        lotId: "CAB-" + String(index).padStart(3, "0"),
      }),
      amount: stockAmount("5", "piece"),
    }));
    await compareCommittedCommand(
      segmented,
      canonical,
      (inventory) => inventory.stock.receiveMany({
        operationId: "differential-seed",
        occurredAtEpochMs: time0,
        lines: initialLines,
      }),
      "initial receiveMany"
    );
    await compareWorlds(segmented, canonical, "initial receipt");

    for (let step = 0; step < 96; step += 1) {
      const operationId = "differential-step-" + String(step).padStart(3, "0");
      const occurredAtEpochMs = time0 + 1_000 + step * 1_000;
      const rows = await segmented.read.positions({ itemId: "item-a" });
      const stock = rows.filter((row) =>
        row.measurements.primary.quantity.amountMinor > 0
      );
      const placed = stock.filter((row) =>
        row.key.placementNodeId !== undefined
      );
      const unresolved = stock.filter((row) =>
        row.key.whereaboutsId !== undefined
      );
      const serials = stock.filter((row) => row.key.serialId !== undefined);
      const fungible = placed.filter((row) => row.key.serialId === undefined);
      const method = choose(11);

      let action:
        | ((inventory: InventoryOnce) => Promise<InventoryOnceEventResult>)
        | undefined;
      switch (method) {
        case 0: {
          const location = locations[choose(locations.length)] ?? "north";
          const lotId = "CAB-" + String(choose(24)).padStart(3, "0");
          action = (inventory) => inventory.stock.receive({
            operationId,
            occurredAtEpochMs,
            to: loosePosition(location, { lotId }),
            amount: stockAmount("2", "piece"),
          });
          break;
        }
        case 1: {
          const row = pick(placed);
          if (row === undefined) break;
          const to = locations.find((nodeId) =>
            nodeId !== row.key.placementNodeId
          ) ?? "east";
          action = (inventory) => inventory.stock.transfer({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            toPlacementNodeId: to,
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 2: {
          const row = pick(placed);
          if (row === undefined) break;
          action = (inventory) => inventory.stock.issue({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 3: {
          const row = pick(stock);
          if (row === undefined) break;
          const toStatusId = row.key.statusId === "quarantine"
            ? "usable"
            : "quarantine";
          action = (inventory) => inventory.stock.changeStatus({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            toStatusId,
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 4: {
          const row = pick(placed);
          if (row === undefined) break;
          action = (inventory) => inventory.stock.detach({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 5: {
          const row = pick(stock.filter((candidate) =>
            candidate.key.whereaboutsState !==
            InventoryStockWhereaboutsState.Missing
          ));
          if (row === undefined) break;
          action = (inventory) => inventory.stock.markMissing({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 6: {
          const row = pick(unresolved);
          if (row === undefined) break;
          const into = locations[choose(locations.length)] ?? "north";
          action = (inventory) => inventory.stock.place({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            into,
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 7: {
          if (fungible.length < 2) break;
          const first = pick(fungible);
          const second = fungible.find((row) => row !== first);
          if (first === undefined || second === undefined) break;
          action = (inventory) => inventory.stock.transferMany({
            operationId,
            occurredAtEpochMs,
            lines: [
              {
                from: sourceOf(first),
                toPlacementNodeId: "buffer-1-" + step,
                amount: stockAmount("1", "piece"),
              },
              {
                from: sourceOf(second),
                toPlacementNodeId: "buffer-2-" + step,
                amount: stockAmount("1", "piece"),
              },
            ],
          });
          break;
        }
        case 8: {
          const row = pick(fungible);
          if (row === undefined) break;
          action = (inventory) => inventory.stock.individualize({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            serialId: "DIFF-SERIAL-" + step,
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 9: {
          const row = pick(serials);
          if (row === undefined) break;
          action = (inventory) => inventory.stock.deindividualize({
            operationId,
            occurredAtEpochMs,
            from: sourceOf(row),
            amount: stockAmount("1", "piece"),
          });
          break;
        }
        case 10: {
          const row = pick(fungible);
          if (row === undefined) break;
          const source = sourceOf(row);
          const statusId = row.key.statusId === "review" ? "usable" : "review";
          action = (inventory) => inventory.stock.reclassifyMany({
            operationId,
            occurredAtEpochMs,
            consume: [{ from: source, amount: stockAmount("1", "piece") }],
            produce: [
              {
                to: { ...source, statusId },
                amount: stockAmount("1", "piece"),
              },
            ],
          });
          break;
        }
      }
      if (action === undefined) continue;
      exercised[method] = (exercised[method] ?? 0) + 1;
      await compareCommittedCommand(
        segmented,
        canonical,
        action,
        "seeded differential step=" + step + " method=" + method
      );
      if (step % 8 === 0 || step === 95) {
        await compareWorlds(segmented, canonical, "after step " + step);
      }
    }

    await compareWorlds(segmented, canonical, "full mixed operation trace");
    expect(exercised[0]).toBeGreaterThan(0);
    expect(exercised[1]).toBeGreaterThan(0);
    expect(exercised[2]).toBeGreaterThan(0);
    expect(exercised[3]).toBeGreaterThan(0);
    expect(exercised[4]).toBeGreaterThan(0);
    expect(exercised[7]).toBeGreaterThan(0);
    console.log(JSON.stringify({ scenario: "segmented-vs-canonical", seed, exercised }));
    const world = await segmented.read.world();
    const lastRevision = world.revision;
    const retryOperationId = "differential-final-replay";
    const retryInput = {
      operationId: retryOperationId,
      occurredAtEpochMs: time0,
      to: loosePosition("north", { lotId: "FINAL-REPLAY" }),
      amount: stockAmount("1", "piece"),
    };
    await compareCommittedCommand(
      segmented,
      canonical,
      (inventory) => inventory.stock.receive(retryInput),
      "new final receipt"
    );
    await compareCommittedCommand(
      segmented,
      canonical,
      (inventory) => inventory.stock.receive(retryInput),
      "exact final receipt replay"
    );
    expect((await segmented.read.world()).revision).toBe(lastRevision + 1);
    await compareRejectedCommand(
      segmented,
      canonical,
      (inventory) => inventory.stock.receive({
        ...retryInput,
        amount: stockAmount("9", "piece"),
      }),
      "changed receipt retry intent"
    );
  }, 90_000);
});
