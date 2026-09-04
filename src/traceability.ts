import {
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
  InventoryTraceabilityNodeKind,
  inventoryTraceabilityNodeIdentity,
  type InventoryTraceabilityNodeRef,
} from "./model.js";

/** One currently effective traceability relationship plus its creating event. */
export interface InventoryTraceabilityRelation {
  /** Relationship category. */
  readonly kind: InventoryTraceabilityRelationKind;
  /** Child/subject/input node. */
  readonly from: InventoryTraceabilityNodeRef;
  /** Parent/object/output node. */
  readonly to: InventoryTraceabilityNodeRef;
  /** Event that made this relationship current/historical. */
  readonly createdByEventId: string;
}

/** Current containment/association graph plus append-only transformation genealogy. */
export interface InventoryTraceabilityState {
  /** Effective relations keyed by stable relationship identity. */
  readonly relations: Readonly<Record<string, InventoryTraceabilityRelation>>;
  /** Direct child container ids grouped by exact parent-container node identity. */
  readonly containmentChildContainerIdsByParentNodeIdentity: Readonly<
    Record<string, readonly string[]>
  >;
}

/** Inputs for applying one event's graph changes all-or-nothing. */
export interface ApplyInventoryTraceabilityChangesInput {
  /** Current graph state. */
  readonly state: InventoryTraceabilityState;
  /** Event whose graph changes are being applied. */
  readonly eventId: string;
  /** Already-normalized relationship changes. */
  readonly changes: readonly InventoryTraceabilityRelationChange[];
}

/** Create an empty traceability graph. */
export function emptyInventoryTraceabilityState(): InventoryTraceabilityState {
  return {
    relations: {},
    containmentChildContainerIdsByParentNodeIdentity: {},
  };
}

/** Apply graph changes atomically without mutating the caller-owned state. */
export function applyInventoryTraceabilityChanges({
  state,
  eventId,
  changes,
}: ApplyInventoryTraceabilityChangesInput): InventoryTraceabilityState {
  if (changes.length === 0) return state;
  const relations: Record<string, InventoryTraceabilityRelation> = {
    ...state.relations,
  };
  let containmentChanged = false;
  let genealogyChanged = false;
  for (const change of changes) {
    containmentChanged ||=
      change.kind === InventoryTraceabilityRelationKind.Containment;
    genealogyChanged ||=
      change.kind === InventoryTraceabilityRelationKind.Genealogy;
    const identity = inventoryTraceabilityRelationIdentity(
      change.kind,
      change.from,
      change.to
    );
    const earlier = relations[identity];
    if (change.action === InventoryTraceabilityRelationAction.Add) {
      if (earlier !== undefined) {
        throw new Error(
          `Traceability relationship '${identity}' already exists.`
        );
      }
      relations[identity] = {
        kind: change.kind,
        from: change.from,
        to: change.to,
        createdByEventId: eventId,
      };
      continue;
    }
    if (earlier === undefined) {
      throw new Error(
        `Traceability relationship '${identity}' does not exist.`
      );
    }
    if (change.action === InventoryTraceabilityRelationAction.Remove) {
      if (change.kind === InventoryTraceabilityRelationKind.Genealogy) {
        throw new Error(
          "Transformation genealogy can only be invalidated by correction."
        );
      }
      delete relations[identity];
      continue;
    }
    if (change.invalidatesCreatedByEventId !== earlier.createdByEventId) {
      throw new Error(
        `Traceability invalidation expected creating event ` +
          `'${change.invalidatesCreatedByEventId}', not '${earlier.createdByEventId}'.`
      );
    }
    delete relations[identity];
  }
  if (containmentChanged) assertContainmentHasOneParentAndNoCycles(relations);
  if (genealogyChanged) assertGenealogyHasNoCycles(relations);
  return {
    relations,
    containmentChildContainerIdsByParentNodeIdentity: containmentChanged
      ? buildContainmentChildContainerIndex(relations)
      : state.containmentChildContainerIdsByParentNodeIdentity,
  };
}

/** Build direct container-child lookup while retaining the relation map as canonical graph truth. */
export function buildContainmentChildContainerIndex(
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>
): Readonly<Record<string, readonly string[]>> {
  const childrenByParent = new Map<string, Set<string>>();
  for (const relation of Object.values(relations)) {
    if (relation.kind !== InventoryTraceabilityRelationKind.Containment)
      continue;
    if (
      relation.from.kind !== InventoryTraceabilityNodeKind.Container ||
      relation.to.kind !== InventoryTraceabilityNodeKind.Container
    )
      continue;
    const parentIdentity = inventoryTraceabilityNodeIdentity(relation.to);
    const children = childrenByParent.get(parentIdentity) ?? new Set<string>();
    children.add(relation.from.id);
    childrenByParent.set(parentIdentity, children);
  }
  const index: Record<string, readonly string[]> = {};
  for (const [parentIdentity, children] of childrenByParent) {
    const ordered = [...children];
    ordered.sort();
    index[parentIdentity] = ordered;
  }
  return index;
}

/** Stable identity for one relation regardless of creating event. */
export function inventoryTraceabilityRelationIdentity(
  kind: InventoryTraceabilityRelationKind,
  from: InventoryTraceabilityNodeRef,
  to: InventoryTraceabilityNodeRef
): string {
  return JSON.stringify([
    kind,
    inventoryTraceabilityNodeIdentity(from),
    inventoryTraceabilityNodeIdentity(to),
  ]);
}

/** Return every currently effective relation of one kind. */
export function inventoryTraceabilityRelationsOfKind(
  state: InventoryTraceabilityState,
  kind: InventoryTraceabilityRelationKind
): readonly InventoryTraceabilityRelation[] {
  const result: InventoryTraceabilityRelation[] = [];
  for (const relation of Object.values(state.relations)) {
    if (relation.kind === kind) result.push(relation);
  }
  result.sort(compareRelation);
  return result;
}

/** Return every transformation ancestor that can reach one output node. */
export function inventoryGenealogyAncestors(
  state: InventoryTraceabilityState,
  output: InventoryTraceabilityNodeRef
): readonly InventoryTraceabilityNodeRef[] {
  const targetIdentity = inventoryTraceabilityNodeIdentity(output);
  const parentsByOutput = new Map<string, InventoryTraceabilityNodeRef[]>();
  for (const relation of Object.values(state.relations)) {
    if (relation.kind !== InventoryTraceabilityRelationKind.Genealogy) continue;
    const outputIdentity = inventoryTraceabilityNodeIdentity(relation.to);
    const parents = parentsByOutput.get(outputIdentity) ?? [];
    parents.push(relation.from);
    parentsByOutput.set(outputIdentity, parents);
  }
  const ancestors = new Map<string, InventoryTraceabilityNodeRef>();
  const pending = [targetIdentity];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const parent of parentsByOutput.get(current) ?? []) {
      const identity = inventoryTraceabilityNodeIdentity(parent);
      if (ancestors.has(identity)) continue;
      ancestors.set(identity, parent);
      pending.push(identity);
    }
  }
  const result = [...ancestors.values()];
  result.sort(compareNode);
  return result;
}

/** Require containment to be a forest: one parent per child and no path back to itself. */
function assertContainmentHasOneParentAndNoCycles(
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>
): void {
  const parentByChild = new Map<string, string>();
  for (const relation of Object.values(relations)) {
    if (relation.kind !== InventoryTraceabilityRelationKind.Containment)
      continue;
    const child = inventoryTraceabilityNodeIdentity(relation.from);
    const parent = inventoryTraceabilityNodeIdentity(relation.to);
    const earlierParent = parentByChild.get(child);
    if (earlierParent !== undefined && earlierParent !== parent) {
      throw new Error(`Contained node '${child}' cannot have two parents.`);
    }
    parentByChild.set(child, parent);
  }
  const settled = new Set<string>();
  for (const child of parentByChild.keys()) {
    if (settled.has(child)) continue;
    const path = new Set<string>();
    let current: string | undefined = child;
    while (current !== undefined && !settled.has(current)) {
      if (path.has(current)) {
        throw new Error(`Containment graph contains a cycle at '${current}'.`);
      }
      path.add(current);
      current = parentByChild.get(current);
    }
    for (const node of path) settled.add(node);
  }
}

/** Require transformation genealogy to remain a directed acyclic graph. */
function assertGenealogyHasNoCycles(
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>
): void {
  const outputsByInput = new Map<string, string[]>();
  for (const relation of Object.values(relations)) {
    if (relation.kind !== InventoryTraceabilityRelationKind.Genealogy) continue;
    const input = inventoryTraceabilityNodeIdentity(relation.from);
    const output = inventoryTraceabilityNodeIdentity(relation.to);
    const outputs = outputsByInput.get(input) ?? [];
    outputs.push(output);
    outputsByInput.set(input, outputs);
  }
  const visited = new Set<string>();
  const activePath = new Set<string>();
  for (const start of outputsByInput.keys()) {
    assertNoGenealogyCycleFrom(start, outputsByInput, visited, activePath);
  }
}

/** Depth-first genealogy cycle check using explicit path/visited sets. */
function assertNoGenealogyCycleFrom(
  node: string,
  outputsByInput: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>,
  activePath: Set<string>
): void {
  if (activePath.has(node))
    throw new Error(`Genealogy graph contains a cycle at '${node}'.`);
  if (visited.has(node)) return;
  activePath.add(node);
  for (const output of outputsByInput.get(node) ?? []) {
    assertNoGenealogyCycleFrom(output, outputsByInput, visited, activePath);
  }
  activePath.delete(node);
  visited.add(node);
}

/** Sort relations by stable relation identity. */
function compareRelation(
  left: InventoryTraceabilityRelation,
  right: InventoryTraceabilityRelation
): number {
  return inventoryTraceabilityRelationIdentity(
    left.kind,
    left.from,
    left.to
  ).localeCompare(
    inventoryTraceabilityRelationIdentity(right.kind, right.from, right.to)
  );
}

/** Sort graph nodes by stable node identity. */
function compareNode(
  left: InventoryTraceabilityNodeRef,
  right: InventoryTraceabilityNodeRef
): number {
  return inventoryTraceabilityNodeIdentity(left).localeCompare(
    inventoryTraceabilityNodeIdentity(right)
  );
}
