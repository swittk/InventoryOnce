import { compareInventoryIdentityText } from "./ordering.js";
import {
  assertInventoryIdentity,
  type PlacementNodeId,
} from "./model.js";
import {
  cloneInventorySparseRecord,
  createInventorySparseRecord,
  inventorySparseRecordValue,
  setInventorySparseRecordValue,
} from "./sparse-record.js";

/** One immutable direct-parent transition carried by an inventory event. */
export interface InventoryPlacementChange {
  /** Physical/logical node whose direct placement changes. */
  readonly nodeId: PlacementNodeId;
  /** Exact earlier direct parent, or omission when the node was unplaced. */
  readonly fromParentNodeId?: PlacementNodeId;
  /** Exact new direct parent, or omission when the node becomes unplaced. */
  readonly toParentNodeId?: PlacementNodeId;
}

/** One currently effective direct placement edge plus the event that established it. */
export interface InventoryPlacementRelation {
  /** Physical/logical child node. */
  readonly nodeId: PlacementNodeId;
  /** Direct parent accepting this node. */
  readonly parentNodeId: PlacementNodeId;
  /** Event that established this current edge. */
  readonly createdByEventId: string;
}

/** Current generic placement forest and its rebuildable child index. */
export interface InventoryPlacementState {
  /** Current direct-parent edge keyed by exact child node identity. */
  readonly relationByNodeId: Readonly<
    Record<PlacementNodeId, InventoryPlacementRelation>
  >;
  /** Direct child node identities grouped by exact parent node identity. */
  readonly childNodeIdsByParentNodeId: Readonly<
    Record<PlacementNodeId, readonly PlacementNodeId[]>
  >;
}

/** Inputs for applying one event's placement changes atomically. */
export interface ApplyInventoryPlacementChangesInput {
  /** Current placement forest. */
  readonly state: InventoryPlacementState;
  /** Event establishing every resulting edge. */
  readonly eventId: string;
  /** Already-normalized direct-parent changes. */
  readonly changes: readonly InventoryPlacementChange[];
  /** Return whether one target node currently accepts direct placement. */
  readonly acceptsPlacement: (nodeId: PlacementNodeId) => boolean;
}

/** Create an empty placement forest with no hidden roots. */
export function emptyInventoryPlacementState(): InventoryPlacementState {
  return {
    relationByNodeId: createInventorySparseRecord(),
    childNodeIdsByParentNodeId: createInventorySparseRecord(),
  };
}

/** Normalize and detach one placement transition from caller-owned objects. */
export function normalizeInventoryPlacementChange(
  change: InventoryPlacementChange
): InventoryPlacementChange {
  if (change === null || typeof change !== "object" || Array.isArray(change)) {
    throw new Error("Placement change must be an object.");
  }
  assertInventoryIdentity(change.nodeId, "placement nodeId");
  if (change.fromParentNodeId !== undefined) {
    assertInventoryIdentity(
      change.fromParentNodeId,
      "placement fromParentNodeId"
    );
  }
  if (change.toParentNodeId !== undefined) {
    assertInventoryIdentity(change.toParentNodeId, "placement toParentNodeId");
  }
  if (change.fromParentNodeId === change.toParentNodeId) {
    throw new Error("Placement change must alter the node's direct parent.");
  }
  if (change.toParentNodeId === change.nodeId) {
    throw new Error("A placement node cannot be its own direct parent.");
  }
  return {
    nodeId: change.nodeId,
    ...(change.fromParentNodeId === undefined
      ? {}
      : { fromParentNodeId: change.fromParentNodeId }),
    ...(change.toParentNodeId === undefined
      ? {}
      : { toParentNodeId: change.toParentNodeId }),
  };
}

/** Apply direct-parent transitions together, preserving one-parent and acyclic topology. */
export function applyInventoryPlacementChanges({
  state,
  eventId,
  changes,
  acceptsPlacement,
}: ApplyInventoryPlacementChangesInput): InventoryPlacementState {
  if (changes.length === 0) return state;
  assertInventoryIdentity(eventId, "placement eventId");
  const normalizedChanges = changes.map(normalizeInventoryPlacementChange);
  const seenNodeIds = new Set<PlacementNodeId>();
  const relations = cloneInventorySparseRecord(state.relationByNodeId);
  /** Old/new parent pairs used to update only touched child-index rows. */
  const parentChanges = new Map<
    PlacementNodeId,
    {
      /** Direct parent before this event, when one existed. */
      readonly oldParentNodeId?: PlacementNodeId;
      /** Direct parent after this event, when one exists. */
      readonly newParentNodeId?: PlacementNodeId;
    }
  >();
  for (const change of normalizedChanges) {
    if (seenNodeIds.has(change.nodeId)) {
      throw new Error(
        `Placement event changes node '${change.nodeId}' more than once.`
      );
    }
    seenNodeIds.add(change.nodeId);
    const current = inventorySparseRecordValue(relations, change.nodeId);
    const currentParentNodeId = current?.parentNodeId;
    if (currentParentNodeId !== change.fromParentNodeId) {
      throw new Error(
        `Placement node '${change.nodeId}' expected parent '${
          change.fromParentNodeId ?? "<unplaced>"
        }', not '${currentParentNodeId ?? "<unplaced>"}'.`
      );
    }
    parentChanges.set(change.nodeId, {
      ...(currentParentNodeId === undefined
        ? {}
        : { oldParentNodeId: currentParentNodeId }),
      ...(change.toParentNodeId === undefined
        ? {}
        : { newParentNodeId: change.toParentNodeId }),
    });
    if (change.toParentNodeId === undefined) {
      delete relations[change.nodeId];
      continue;
    }
    setInventorySparseRecordValue(relations, change.nodeId, {
      nodeId: change.nodeId,
      parentNodeId: change.toParentNodeId,
      createdByEventId: eventId,
    });
  }
  for (const change of normalizedChanges) {
    const parentNodeId = change.toParentNodeId;
    if (parentNodeId === undefined) continue;
    if (!acceptsPlacement(parentNodeId)) {
      throw new Error(
        `Placement node '${parentNodeId}' does not accept direct placement.`
      );
    }
    assertPlacementChangeHasNoCycle(relations, change.nodeId);
  }
  const childrenByParent = cloneInventorySparseRecord(
    state.childNodeIdsByParentNodeId
  );
  /** Mutable child sets only for parents touched by this event. */
  const touchedChildren = new Map<PlacementNodeId, Set<PlacementNodeId>>();
  /** Return the mutable child set for one parent touched by this event. */
  const mutableChildren = (parentNodeId: PlacementNodeId): Set<PlacementNodeId> => {
    const existing = touchedChildren.get(parentNodeId);
    if (existing !== undefined) return existing;
    const created = new Set(
      inventorySparseRecordValue(childrenByParent, parentNodeId) ?? []
    );
    touchedChildren.set(parentNodeId, created);
    return created;
  };
  for (const [nodeId, change] of parentChanges) {
    if (change.oldParentNodeId !== undefined) {
      mutableChildren(change.oldParentNodeId).delete(nodeId);
    }
    if (change.newParentNodeId !== undefined) {
      mutableChildren(change.newParentNodeId).add(nodeId);
    }
  }
  for (const [parentNodeId, childNodeIds] of touchedChildren) {
    if (childNodeIds.size === 0) {
      delete childrenByParent[parentNodeId];
      continue;
    }
    const ordered = [...childNodeIds];
    ordered.sort(compareInventoryIdentityText);
    setInventorySparseRecordValue(childrenByParent, parentNodeId, ordered);
  }
  return {
    relationByNodeId: relations,
    childNodeIdsByParentNodeId: childrenByParent,
  };
}

/** Return one node's current direct parent, or undefined when it is a root/unplaced node. */
export function inventoryPlacementParentNodeId(
  state: InventoryPlacementState,
  nodeId: PlacementNodeId
): PlacementNodeId | undefined {
  assertInventoryIdentity(nodeId, "placement nodeId");
  return inventorySparseRecordValue(state.relationByNodeId, nodeId)?.parentNodeId;
}

/** Return whether a node is equal to or descends from one candidate ancestor. */
export function inventoryPlacementNodeIsWithin(
  state: InventoryPlacementState,
  nodeId: PlacementNodeId,
  ancestorNodeId: PlacementNodeId
): boolean {
  assertInventoryIdentity(nodeId, "placement nodeId");
  assertInventoryIdentity(ancestorNodeId, "placement ancestorNodeId");
  let current: PlacementNodeId | undefined = nodeId;
  const visited = new Set<PlacementNodeId>();
  while (current !== undefined) {
    if (current === ancestorNodeId) return true;
    if (visited.has(current)) {
      throw new Error(`Placement graph contains a cycle at '${current}'.`);
    }
    visited.add(current);
    current = inventorySparseRecordValue(
      state.relationByNodeId,
      current
    )?.parentNodeId;
  }
  return false;
}

/** Return a node followed by each direct ancestor up to its unplaced root. */
export function inventoryPlacementAncestry(
  state: InventoryPlacementState,
  nodeId: PlacementNodeId
): readonly PlacementNodeId[] {
  assertInventoryIdentity(nodeId, "placement nodeId");
  const ancestry: PlacementNodeId[] = [];
  const visited = new Set<PlacementNodeId>();
  let current: PlacementNodeId | undefined = nodeId;
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new Error(`Placement graph contains a cycle at '${current}'.`);
    }
    visited.add(current);
    ancestry.push(current);
    current = inventorySparseRecordValue(
      state.relationByNodeId,
      current
    )?.parentNodeId;
  }
  return ancestry;
}

/** Return one node and every current descendant in deterministic traversal order. */
export function inventoryPlacementSubtreeNodeIds(
  state: InventoryPlacementState,
  rootNodeId: PlacementNodeId
): readonly PlacementNodeId[] {
  assertInventoryIdentity(rootNodeId, "placement rootNodeId");
  const result: PlacementNodeId[] = [];
  const pending: PlacementNodeId[] = [rootNodeId];
  const visited = new Set<PlacementNodeId>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (visited.has(current)) {
      throw new Error(`Placement graph contains a cycle at '${current}'.`);
    }
    visited.add(current);
    result.push(current);
    const children =
      inventorySparseRecordValue(
        state.childNodeIdsByParentNodeId,
        current
      ) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }
  return result;
}

/** Require the final parent chain for one changed node to remain acyclic. */
function assertPlacementChangeHasNoCycle(
  relations: Readonly<Record<PlacementNodeId, InventoryPlacementRelation>>,
  changedNodeId: PlacementNodeId
): void {
  const visited = new Set<PlacementNodeId>();
  let current: PlacementNodeId | undefined = changedNodeId;
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new Error(`Placement graph contains a cycle at '${current}'.`);
    }
    visited.add(current);
    current = inventorySparseRecordValue(relations, current)?.parentNodeId;
  }
}
