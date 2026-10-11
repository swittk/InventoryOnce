import { compareInventoryIdentityText } from "./ordering.js";
import {
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
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

/** Current association graph plus append-only transformation genealogy. */
export interface InventoryTraceabilityState {
  /** Effective relations keyed by stable relationship identity. */
  readonly relations: Readonly<Record<string, InventoryTraceabilityRelation>>;
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
  return { relations: {} };
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
  let genealogyChanged = false;
  for (const change of changes) {
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
        from: { ...change.from },
        to: { ...change.to },
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
  if (genealogyChanged) assertGenealogyHasNoCycles(relations);
  return { relations };
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

/** One explicit DFS frame used to avoid consuming the JavaScript call stack. */
interface InventoryGenealogyTraversalFrame {
  /** Current genealogy node being expanded. */
  readonly node: string;
  /** Index of the next outgoing edge to inspect. */
  nextOutput: number;
}

/** Depth-first genealogy cycle check without consuming the JavaScript call stack. */
function assertNoGenealogyCycleFrom(
  node: string,
  outputsByInput: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>,
  activePath: Set<string>
): void {
  if (activePath.has(node))
    throw new Error(`Genealogy graph contains a cycle at '${node}'.`);
  if (visited.has(node)) return;
  // Hold explicit DFS frames so deep genealogy traversal never consumes call-stack depth.
  const pending: InventoryGenealogyTraversalFrame[] = [
    { node, nextOutput: 0 },
  ];
  activePath.add(node);
  while (pending.length > 0) {
    const frame = pending[pending.length - 1];
    if (frame === undefined) break;
    const outputs = outputsByInput.get(frame.node) ?? [];
    if (frame.nextOutput >= outputs.length) {
      activePath.delete(frame.node);
      visited.add(frame.node);
      pending.pop();
      continue;
    }
    const output = outputs[frame.nextOutput];
    frame.nextOutput += 1;
    if (output === undefined) continue;
    if (activePath.has(output)) {
      throw new Error(`Genealogy graph contains a cycle at '${output}'.`);
    }
    if (visited.has(output)) continue;
    activePath.add(output);
    pending.push({ node: output, nextOutput: 0 });
  }
}

/** Sort relations by stable relation identity. */
function compareRelation(
  left: InventoryTraceabilityRelation,
  right: InventoryTraceabilityRelation
): number {
  return compareInventoryIdentityText(inventoryTraceabilityRelationIdentity(
    left.kind,
    left.from,
    left.to
  ), inventoryTraceabilityRelationIdentity(right.kind, right.from, right.to));
}

/** Sort graph nodes by stable node identity. */
function compareNode(
  left: InventoryTraceabilityNodeRef,
  right: InventoryTraceabilityNodeRef
): number {
  return compareInventoryIdentityText(inventoryTraceabilityNodeIdentity(left), inventoryTraceabilityNodeIdentity(right));
}
