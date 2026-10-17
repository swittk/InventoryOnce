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
  mutateInventoryTraceabilityRelations(relations, eventId, changes);
  return { relations };
}

/** Inputs for appending many independently validated traceability changes. */
export interface ApplyInventoryTraceabilityChangesBatchInput {
  /** Existing published graph; never modified. */
  readonly state: InventoryTraceabilityState;
  /** Committed event identities and changes in durable event order. */
  readonly events: readonly Pick<
    ApplyInventoryTraceabilityChangesInput,
    "eventId" | "changes"
  >[];
}

/**
 * Apply one deferred batch with only one complete relations copy. Each event
 * still enforces the same add/remove/invalidate semantics and genealogy DAG
 * safety as a standalone graph event, rather than deferring validation until
 * after several events could conceal an invalid intermediate graph.
 */
export function applyInventoryTraceabilityChangesBatch({
  state,
  events,
}: ApplyInventoryTraceabilityChangesBatchInput): InventoryTraceabilityState {
  let changesPresent = false;
  for (const event of events) {
    if (event.changes.length !== 0) {
      changesPresent = true;
      break;
    }
  }
  if (!changesPresent) return state;
  let genealogyTouched = false;
  for (const event of events) {
    for (const change of event.changes) {
      if (change.kind === InventoryTraceabilityRelationKind.Genealogy) {
        genealogyTouched = true;
        break;
      }
    }
    if (genealogyTouched) break;
  }
  // The ordinary single-event API verifies the entire DAG after a genealogy
  // mutation. Batch catch-up may validate its published base once, then use
  // an incremental adjacency index for newly added edges.
  if (genealogyTouched) assertGenealogyHasNoCycles(state.relations);
  const ancestry = genealogyTouched
    ? inventoryBatchGenealogyAdjacency(state.relations)
    : undefined;
  const relations: Record<string, InventoryTraceabilityRelation> = {
    ...state.relations,
  };
  for (const event of events) {
    if (event.changes.length === 0) continue;
    mutateInventoryTraceabilityRelations(
      relations,
      event.eventId,
      event.changes,
      ancestry === undefined
    );
    if (ancestry !== undefined) {
      validateInventoryBatchGenealogyChanges(
        ancestry,
        relations,
        event.changes
      );
    }
  }
  return { relations };
}

/** Apply one event to a private relation record, preserving standalone validation. */
function mutateInventoryTraceabilityRelations(
  relations: Record<string, InventoryTraceabilityRelation>,
  eventId: string,
  changes: readonly InventoryTraceabilityRelationChange[],
  validateWholeGenealogy = true
): void {
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
  if (genealogyChanged && validateWholeGenealogy) {
    assertGenealogyHasNoCycles(relations);
  }
}

/** Build the current adjacency once from the already validated genealogy DAG. */
function inventoryBatchGenealogyAdjacency(
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const relation of Object.values(relations)) {
    if (relation.kind !== InventoryTraceabilityRelationKind.Genealogy) {
      continue;
    }
    const from = inventoryTraceabilityNodeIdentity(relation.from);
    const to = inventoryTraceabilityNodeIdentity(relation.to);
    const outgoing = adjacency.get(from) ?? new Set<string>();
    outgoing.add(to);
    adjacency.set(from, outgoing);
  }
  return adjacency;
}

/**
 * Refresh all genealogy edges touched by this event from its final relations,
 * then verify that none of its retained additions closes a directed cycle.
 * This preserves the standalone per-event final-state semantics even when an
 * edge was added and invalidated within the same event.
 */
function validateInventoryBatchGenealogyChanges(
  adjacency: Map<string, Set<string>>,
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>,
  changes: readonly InventoryTraceabilityRelationChange[]
): void {
  const additions: Array<readonly [string, string]> = [];
  for (const change of changes) {
    if (change.kind !== InventoryTraceabilityRelationKind.Genealogy) {
      continue;
    }
    const from = inventoryTraceabilityNodeIdentity(change.from);
    const to = inventoryTraceabilityNodeIdentity(change.to);
    const identity = inventoryTraceabilityRelationIdentity(
      change.kind,
      change.from,
      change.to
    );
    const current = inventorySparseRelationValue(relations, identity);
    if (current === undefined) {
      const outgoing = adjacency.get(from);
      outgoing?.delete(to);
      if (outgoing?.size === 0) adjacency.delete(from);
    } else {
      const outgoing = adjacency.get(from) ?? new Set<string>();
      outgoing.add(to);
      adjacency.set(from, outgoing);
      if (change.action === InventoryTraceabilityRelationAction.Add) {
        additions.push([from, to]);
      }
    }
  }
  for (const [from, to] of additions) {
    if (inventoryGenealogyReachable(adjacency, to, from)) {
      throw new Error("Genealogy graph contains a cycle at '" + from + "'.");
    }
  }
}

/** Avoid prototype-chain collisions for graph identities from application strings. */
function inventorySparseRelationValue(
  relations: Readonly<Record<string, InventoryTraceabilityRelation>>,
  identity: string
): InventoryTraceabilityRelation | undefined {
  return Object.prototype.hasOwnProperty.call(relations, identity)
    ? relations[identity]
    : undefined;
}

/** Search only edges reachable from a newly added edge's destination. */
function inventoryGenealogyReachable(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  target: string
): boolean {
  if (start === target) return true;
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) pending.push(next);
    }
  }
  return false;
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
