import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  createInMemoryInventorySegmentedPlacementStore,
  InventoryPlacementSegmentRevisionConflictError,
} from "../src/storage-api.js";
import {
  applyInventoryPlacementChanges,
  type InventoryPlacementRelation,
  type InventoryPlacementState,
} from "../src/placement.js";

/** Create a valid deeply nested forest without recursion in the fixture itself. */
function placementChain(depth: number): InventoryPlacementState {
  const relationByNodeId: Record<string, InventoryPlacementRelation> =
    Object.create(null) as Record<string, InventoryPlacementRelation>;
  const childNodeIdsByParentNodeId: Record<string, string[]> =
    Object.create(null) as Record<string, string[]>;
  for (let index = 1; index < depth; index += 1) {
    const nodeId = "CHAIN-" + index;
    const parentNodeId = "CHAIN-" + (index - 1);
    relationByNodeId[nodeId] = {
      nodeId,
      parentNodeId,
      createdByEventId: "imported-forest",
    };
    childNodeIdsByParentNodeId[parentNodeId] = [nodeId];
  }
  return { relationByNodeId, childNodeIdsByParentNodeId };
}

/** Build one small forest with independently mutable parent/child input records. */
function smallForest(): InventoryPlacementState {
  return {
    relationByNodeId: {
      a: { nodeId: "a", parentNodeId: "room", createdByEventId: "old" },
      b: { nodeId: "b", parentNodeId: "a", createdByEventId: "old" },
      c: { nodeId: "c", parentNodeId: "b", createdByEventId: "old" },
    },
    childNodeIdsByParentNodeId: {
      room: ["a"],
      a: ["b"],
      b: ["c"],
    },
  };
}

describe("adapter-native segmented placement forest", () => {
  it("admits 1k/5k/10k deep chains with linear-traversal constructor scale", () => {
    const elapsed: number[] = [];
    for (const depth of [1_000, 5_000, 10_000]) {
      const forest = placementChain(depth);
      const started = performance.now();
      const store = createInMemoryInventorySegmentedPlacementStore({
        placement: forest,
        revision: 7,
      });
      const elapsedMs = performance.now() - started;
      elapsed.push(elapsedMs);
      expect(store.revision()).toBe(7);
      expect(store.parentNodeId("CHAIN-" + (depth - 1))).toBe(
        "CHAIN-" + (depth - 2)
      );
      expect(store.childNodeIds("CHAIN-" + (depth - 2))).toEqual([
        "CHAIN-" + (depth - 1),
      ]);
      console.log(JSON.stringify({
        bench: "segmented-placement-constructor-deep-chain",
        depth,
        elapsedMs,
      }));
    }
    const baseline = elapsed[0] ?? 0;
    const deepest = elapsed[2] ?? 0;
    // 10x depth should not trigger the old 100x walk (~70ms -> ~6.7s).
    expect(deepest).toBeLessThan(baseline * 25 + 250);
  }, 60_000);

  it("rejects real cycles, including a cycle with an unrelated valid subtree", () => {
    const valid = placementChain(100);
    const relations: Record<string, InventoryPlacementRelation> = {
      ...valid.relationByNodeId,
      X: { nodeId: "X", parentNodeId: "Y", createdByEventId: "cycle" },
      Y: { nodeId: "Y", parentNodeId: "Z", createdByEventId: "cycle" },
      Z: { nodeId: "Z", parentNodeId: "X", createdByEventId: "cycle" },
    };
    expect(() => createInMemoryInventorySegmentedPlacementStore({
      placement: { ...valid, relationByNodeId: relations },
    })).toThrow("cycle");
    expect(() => createInMemoryInventorySegmentedPlacementStore({
      placement: {
        relationByNodeId: {
          self: {
            nodeId: "self",
            parentNodeId: "self",
            createdByEventId: "self",
          },
        },
        childNodeIdsByParentNodeId: {},
      },
    })).toThrow("own direct parent");
  });

  it("moves one edge with revision fences and rolls a cyclic change back completely", () => {
    const input = smallForest();
    const store = createInMemoryInventorySegmentedPlacementStore({
      placement: input,
      revision: 10,
    });
    const originalRoot = store.contentRoot();
    const original = store.materialize();
    expect(original).toEqual(input);
    expect(store.ancestry("c")).toEqual(["c", "b", "a", "room"]);
    expect(store.subtreeNodeIds("a")).toEqual(["a", "b", "c"]);

    expect(() => store.applyChange({
      expectedRevision: 9,
      nextRevision: 10,
      eventId: "stale",
      nodeId: "b",
      fromParentNodeId: "a",
      toParentNodeId: "room",
      targetAcceptsPlacement: true,
    })).toThrow(InventoryPlacementSegmentRevisionConflictError);

    expect(() => store.applyChange({
      expectedRevision: 10,
      nextRevision: 11,
      eventId: "attempt-cycle",
      nodeId: "a",
      fromParentNodeId: "room",
      toParentNodeId: "c",
      targetAcceptsPlacement: true,
    })).toThrow("cycle");

    expect(store.contentRoot()).toBe(originalRoot);
    expect(store.materialize()).toEqual(original);
    expect(store.revision()).toBe(10);

    const moved = store.applyChange({
      expectedRevision: 10,
      nextRevision: 11,
      eventId: "move-b",
      nodeId: "b",
      fromParentNodeId: "a",
      toParentNodeId: "room",
      targetAcceptsPlacement: true,
    });
    expect(moved.revision).toBe(11);
    expect(store.parentNodeId("b")).toBe("room");
    expect(store.childNodeIds("room")).toEqual(["a", "b"]);
    const roomChildren = store.childPostings("room");
    expect(roomChildren.size).toBe(2);
    expect([...roomChildren.ids].sort()).toEqual(["a", "b"]);
    const oldParentChildren = store.childPostings("a");
    expect(oldParentChildren.size).toBe(0);
    expect([...oldParentChildren.ids]).toEqual([]);
    expect(store.ancestry("c")).toEqual(["c", "b", "room"]);
    expect(store.contentRoot()).not.toBe(originalRoot);
    expect(store.materialize().relationByNodeId["b"]?.createdByEventId).toBe(
      "move-b"
    );
  });

  it("refines the canonical placement reducer over mixed moves and rejected cycles", () => {
    const original = smallForest();
    const store = createInMemoryInventorySegmentedPlacementStore({
      placement: original,
      revision: 1,
    });
    let canonical = original;
    let revision = 1;
    const commands = [
      { nodeId: "b", toParentNodeId: "room" },
      { nodeId: "a", toParentNodeId: "c" },
      { nodeId: "c", toParentNodeId: "a" },
      { nodeId: "a", toParentNodeId: "room" },
      { nodeId: "b", toParentNodeId: "c" },
      { nodeId: "c", toParentNodeId: "room" },
      { nodeId: "a", toParentNodeId: "b" },
      { nodeId: "b", toParentNodeId: "a" },
    ];
    for (const [index, command] of commands.entries()) {
      const fromParentNodeId =
        canonical.relationByNodeId[command.nodeId]?.parentNodeId;
      if (fromParentNodeId === command.toParentNodeId) continue;
      const eventId = "differential-place-" + index;
      const change = {
        nodeId: command.nodeId,
        ...(fromParentNodeId === undefined ? {} : { fromParentNodeId }),
        toParentNodeId: command.toParentNodeId,
      };
      const beforeRoot = store.contentRoot();
      const beforeState = store.materialize();
      let next: InventoryPlacementState | undefined;
      try {
        next = applyInventoryPlacementChanges({
          state: canonical,
          eventId,
          changes: [change],
          acceptsPlacement: () => true,
        });
      } catch {
        expect(() => store.applyChange({
          expectedRevision: revision,
          nextRevision: revision + 1,
          eventId,
          ...change,
          targetAcceptsPlacement: true,
        })).toThrow();
        expect(store.contentRoot()).toBe(beforeRoot);
        expect(store.materialize()).toEqual(beforeState);
        expect(store.revision()).toBe(revision);
        continue;
      }
      store.applyChange({
        expectedRevision: revision,
        nextRevision: revision + 1,
        eventId,
        ...change,
        targetAcceptsPlacement: true,
      });
      canonical = next;
      revision += 1;
      expect(store.materialize()).toEqual(canonical);
      expect(store.revision()).toBe(revision);
    }
  });

  it("uses the same authenticated root after rebuilding an equivalent forest in another insertion order", () => {
    const forest = smallForest();
    const first = createInMemoryInventorySegmentedPlacementStore({
      placement: forest,
      revision: 1,
    });
    const reversedRelations = Object.fromEntries(
      Object.entries(forest.relationByNodeId).reverse()
    );
    const rebuilt = createInMemoryInventorySegmentedPlacementStore({
      placement: {
        relationByNodeId: reversedRelations,
        childNodeIdsByParentNodeId: {},
      },
      revision: 1,
    });
    expect(rebuilt.contentRoot()).toBe(first.contentRoot());
    expect(rebuilt.materialize()).toEqual(first.materialize());
  });
});
