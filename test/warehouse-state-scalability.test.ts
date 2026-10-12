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
