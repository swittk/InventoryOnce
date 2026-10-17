import { describe, expect, it } from "vitest";
import { InventoryDeficitPolicy, stockAmount } from "../src/index.js";
import {
  inventoryProjectionDigest,
  inventoryWorldContentRoots,
} from "../src/integrity.js";
import {
  cloneInventorySparseRecord,
  inventorySparseRecordLineage,
  inventorySortedIdentitySetLineage,
  setInventorySparseRecordValue,
  updateInventorySortedIdentitySet,
} from "../src/sparse-record.js";
import { emptyInventoryProjectionState, projectInventoryEvents } from "../src/projection.js";
import { createInMemoryInventoryDurableStorage, InventoryStorageWriteStage, type InventoryDurableStorage } from "../src/storage.js";
import { createInMemoryInventorySegmentedPositionStore, type InventorySegmentedPositionStorageCapability } from "../src/segmented-state.js";
import { repairInventoryDurableOperations } from "../src/coordinator.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
} from "./test-fixtures.js";

/** Populate unrelated rows and repeatedly move one exact row through ordinary public commands. */
async function repeatedWarehouseTransfers(rows: number, moves: number) {
  const inventory = createTestInventory();
  await inventory.stock.receiveMany({
    operationId: "retention-receive",
    occurredAtEpochMs: time0,
    lines: Array.from({ length: rows }, (_, index) => ({
      to: loosePosition("retention-a", { lotId: `L${index}` }),
      amount: stockAmount("1", "piece"),
    })),
  });
  const initial = await inventory.read.world();
  const initialRoots = inventoryWorldContentRoots(initial);
  let current = "retention-a";
  for (let index = 0; index < moves; index += 1) {
    const destination = current === "retention-a" ? "retention-b" : "retention-a";
    await inventory.stock.transfer({
      operationId: `retention-move-${index}`,
      occurredAtEpochMs: time0 + index + 1,
      from: loosePosition(current, { lotId: "L0" }),
      toPlacementNodeId: destination,
      amount: stockAmount("1", "piece"),
    });
    current = destination;
  }
  const final = await inventory.read.world();
  return { inventory, initial, initialRoots, final };
}

/** Count older full record versions strongly retained through private lineage metadata. */
function retainedRecordVersions(value: Readonly<Record<string, unknown>>): number {
  let count = 0;
  let current = value;
  const seen = new Set<object>();
  for (;;) {
    if (seen.has(current)) throw new Error("Cyclic sparse-record lineage.");
    seen.add(current);
    const lineage = inventorySparseRecordLineage(current);
    if (lineage === undefined) return count;
    count += 1;
    current = lineage.base;
  }
}

/** Count older full membership arrays strongly retained through private lineage metadata. */
function retainedMembershipVersions(value: readonly string[]): number {
  let count = 0;
  let current = value;
  const seen = new Set<object>();
  for (;;) {
    if (seen.has(current)) throw new Error("Cyclic membership-array lineage.");
    seen.add(current);
    const lineage = inventorySortedIdentitySetLineage(current);
    if (lineage === undefined) return count;
    count += 1;
    current = lineage.base;
  }
}

/** Check the indexed read capability against the same published canonical world. */
async function assertPublishedSegmentMatchesWorld(
  storage: ReturnType<typeof createInMemoryInventoryDurableStorage>
): Promise<void> {
  const world = await storage.readWorld();
  const segment = storage.readPositionSegment();
  const exported = segment.materialize();
  expect(segment.revision()).toBe(world.revision);
  expect(exported.positions).toEqual(world.projection.positions);
  expect(exported.positionIdsByItemId).toEqual(world.projection.positionIdsByItemId);
  expect(exported.positionIdsByItemRevisionId).toEqual(world.projection.positionIdsByItemRevisionId);
  expect(exported.positionIdsByPlacementNodeId).toEqual(world.projection.positionIdsByPlacementNodeId);
  expect(exported.positivePositionIdBySerialIdentity).toEqual(world.projection.positivePositionIdBySerialIdentity);
  const rebuilt = createInMemoryInventorySegmentedPositionStore({
    positions: Object.values(world.projection.positions),
    revision: world.revision,
  });
  expect(segment.contentRoot()).toBe(rebuilt.contentRoot());
}

describe("warehouse hot-state lifetime and export equivalence", () => {
  it("does not retain a full stock and index snapshot per completed small transfer", async () => {
    const { final } = await repeatedWarehouseTransfers(1_000, 50);
    inventoryWorldContentRoots(final);
    const projection = final.projection;
    expect(Object.keys(projection.positions)).toHaveLength(1_000);
    // Optimization metadata must not become a second full-snapshot history. The ledger
    // retains actual immutable events; cached aggregate roots need no predecessor maps.
    expect(retainedRecordVersions(projection.positions)).toBe(0);
    expect(retainedRecordVersions(
      projection.positiveLayerStartedAtEpochMsByPositionId
    )).toBe(0);
    expect(retainedRecordVersions(projection.positionIdsByItemId)).toBe(0);
    expect(retainedMembershipVersions(projection.positionIdsByItemId["item-a"] ?? [])).toBe(0);
    expect(retainedMembershipVersions(
      projection.positionIdsByItemRevisionId["item-a-v2"] ?? []
    )).toBe(0);
  });

  it("keeps mutable change revisions until their digest becomes immutable", () => {
    const base = Object.freeze({ "1": "first-event" });
    const empty = emptyInventoryProjectionState();
    inventoryProjectionDigest({ ...empty, eventIdsBySequence: base });
    const next = cloneInventorySparseRecord(base);
    setInventorySparseRecordValue(next, "1", "second-event");
    const planned = { ...empty, eventIdsBySequence: next };
    const second = inventoryProjectionDigest(planned);
    expect(inventorySparseRecordLineage(next)).toBeDefined();
    setInventorySparseRecordValue(next, "1", "third-event");
    const third = inventoryProjectionDigest(planned);
    expect(third).not.toBe(second);
    Object.freeze(next);
    expect(inventoryProjectionDigest(planned)).toBe(third);
    expect(inventorySparseRecordLineage(next)).toBeUndefined();
    expect(inventoryProjectionDigest(structuredClone(planned))).toBe(third);
    const fourth = cloneInventorySparseRecord(next);
    setInventorySparseRecordValue(fourth, "2", "fourth-event");
    const fourthProjection = { ...empty, eventIdsBySequence: fourth };
    expect(inventoryProjectionDigest(fourthProjection)).toBe(
      inventoryProjectionDigest(structuredClone(fourthProjection))
    );
  });

  it("does not build an unbounded lineage stack before the first membership digest", () => {
    let membership: readonly string[] = Object.freeze(["a"]);
    for (let index = 0; index < 6_000; index += 1) {
      membership = updateInventorySortedIdentitySet(membership, new Map([
        ["a", index % 2 !== 0],
        ["b", index % 2 === 0],
      ]));
    }
    expect(retainedMembershipVersions(membership)).toBe(0);
    const projection = {
      ...emptyInventoryProjectionState(),
      positionIdsByItemId: { "item-a": membership },
    };
    expect(inventoryProjectionDigest(projection)).toBe(
      inventoryProjectionDigest(structuredClone(projection))
    );
  });

  it("keeps explicit old snapshots intact and agrees with cold export and complete event replay", async () => {
    const { initial, initialRoots, final } = await repeatedWarehouseTransfers(250, 21);
    const finalRoots = inventoryWorldContentRoots(final);
    expect(inventoryWorldContentRoots(initial)).toEqual(initialRoots);
    expect(Object.values(initial.projection.positions).every(
      (row) => row.key.placementNodeId === "retention-a"
    )).toBe(true);
    expect(inventoryWorldContentRoots(structuredClone(final))).toEqual(finalRoots);
    const replayed = projectInventoryEvents({
      catalog: createTabletCatalog(),
      events: Object.values(final.projection.events),
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(inventoryWorldContentRoots({ ...final, projection: replayed })).toEqual(finalRoots);
    expect(inventoryWorldContentRoots(initial)).toEqual(initialRoots);
  });
});


describe("indexed segment publication matches durable inventory", () => {
  it("never exposes staged rows and supports partial moves into an existing destination", async () => {
    const seen = new Set<string>();
    const storage = createInMemoryInventoryDurableStorage({
      failpoint: async ({ stage, timing }) => {
        seen.add(`${stage}:${timing}`);
        await assertPublishedSegmentMatchesWorld(storage);
      },
    });
    const inventory = createTestInventory(storage);
    await inventory.stock.receiveMany({
      operationId: "segment-merged-receive",
      occurredAtEpochMs: time0,
      lines: [
        { to: loosePosition("a"), amount: stockAmount("10", "piece") },
        { to: loosePosition("b"), amount: stockAmount("2", "piece") },
      ],
    });
    await inventory.stock.transfer({
      operationId: "segment-partial-transfer",
      occurredAtEpochMs: time0 + 1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("3", "piece"),
    });
    await assertPublishedSegmentMatchesWorld(storage);
    expect(storage.readPositionSegment().positionsByPlacement("a")[0]?.measurements.primary.quantity.amountMinor).toBe(7);
    expect(storage.readPositionSegment().positionsByPlacement("b")[0]?.measurements.primary.quantity.amountMinor).toBe(5);
    expect(seen.has(`${InventoryStorageWriteStage.PublishWorld}:before`)).toBe(true);
    expect(seen.has(`${InventoryStorageWriteStage.PublishWorld}:after`)).toBe(true);
  });

  it("returns one coherent stock view when publication interleaves indexed location reads", async () => {
    const storage: InventoryDurableStorage & InventorySegmentedPositionStorageCapability = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segment-interleaved-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    const readSegment = storage.readPositionSegment.bind(storage);
    let moveBetweenReads = true;
    // The optional adapter contract permits asynchronous indexed reads. Publish an
    // ordinary supported transfer after the first lookup, before the second lookup.
    storage.readPositionSegment = async () => {
      const base = await readSegment();
      return {
        revision: () => base.revision(),
        contentRoot: () => base.contentRoot(),
        position: (id) => base.position(id),
        positivePositionBySerial: (itemId, serialId) =>
          base.positivePositionBySerial(itemId, serialId),
        positionsByItem: (itemId) => base.positionsByItem(itemId),
        positionsByItemRevision: (revisionId) =>
          base.positionsByItemRevision(revisionId),
        positionsByPlacement: (nodeId) => base.positionsByPlacement(nodeId),
        queryPositions: async (selector) => {
          const before =
            (await base.queryPositions({
              ...selector,
              placementNodeIds: ["a"],
            })) ?? [];
          if (moveBetweenReads) {
            moveBetweenReads = false;
            await inventory.stock.transfer({
              operationId: "segment-interleaved-move",
              occurredAtEpochMs: time0 + 1,
              from: loosePosition("a"),
              toPlacementNodeId: "b",
              amount: stockAmount("1", "piece"),
            });
          }
          const after =
            (await base.queryPositions({
              ...selector,
              placementNodeIds: ["b"],
            })) ?? [];
          return [...before, ...after];
        },
        materialize: () => base.materialize(),
      };
    };
    const rows = await inventory.read.positions({
      itemId: "item-a",
      placementNodeIds: ["a", "b"],
    });
    expect(moveBetweenReads).toBe(false);
    // Both the old and new committed worlds have one unit. A mixed snapshot has two.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.measurements.primary.quantity.amountMinor).toBe(1);
  });

  it("publishes and repairs an indexed move exactly once after a publication-boundary failure", async () => {
    let injected = false;
    const storage = createInMemoryInventoryDurableStorage({
      failpoint: async ({ operationId, stage, timing }) => {
        await assertPublishedSegmentMatchesWorld(storage);
        if (!injected && operationId === "segment-crash-move" &&
            stage === InventoryStorageWriteStage.PublishWorld && timing === "after") {
          injected = true;
          throw new Error("test crash after indexed publication");
        }
      },
    });
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "segment-crash-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("a"),
      amount: stockAmount("1", "piece"),
    });
    const move = {
      operationId: "segment-crash-move",
      occurredAtEpochMs: time0 + 1,
      from: loosePosition("a"),
      toPlacementNodeId: "b",
      amount: stockAmount("1", "piece"),
    };
    await expect(inventory.stock.transfer(move)).rejects.toThrow("test crash after indexed publication");
    const visibleRevision = storage.readPositionSegment().revision();
    const visibleRoot = storage.readPositionSegment().contentRoot();
    await repairInventoryDurableOperations({ storage, limit: 10 });
    await inventory.stock.transfer(move);
    await assertPublishedSegmentMatchesWorld(storage);
    expect(storage.readPositionSegment().revision()).toBe(visibleRevision);
    expect(storage.readPositionSegment().contentRoot()).toBe(visibleRoot);
    expect(storage.readPositionSegment().positionsByPlacement("a")).toEqual([]);
    expect(storage.readPositionSegment().positionsByPlacement("b")).toHaveLength(1);
  });
});
