import {
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  type InventoryCommittedEvent,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import { inventoryTraceabilityNodeIdentity } from "./model.js";
import {
  inventoryTraceabilityRelationIdentity,
  type InventoryTraceabilityRelation,
  type InventoryTraceabilityState,
} from "./traceability.js";

/** Rebuild the complete effective graph in durable event order without cloning a growing map. */
export function projectInventoryTraceabilityEvents(
  events: readonly InventoryCommittedEvent[]
): InventoryTraceabilityState {
  // Canonical effective relation truth accumulated in durable event order.
  const relations: Record<string, InventoryTraceabilityRelation> = {};
  // Genealogy adjacency index used to reject ancestry cycles during replay.
  const genealogyOutputsByInput = new Map<string, Set<string>>();

  for (const event of events) {
    // Preserve each touched relation as it existed before this event mutates it.
    const beforeByIdentity = new Map<
      string,
      InventoryTraceabilityRelation | undefined
    >();
    for (const change of event.traceabilityChanges) {
      const identity = inventoryTraceabilityRelationIdentity(
        change.kind,
        change.from,
        change.to
      );
      const earlier = relations[identity];
      if (!beforeByIdentity.has(identity)) {
        beforeByIdentity.set(identity, earlier);
      }
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
          createdByEventId: event.eventId,
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
      } else if (
        change.invalidatesCreatedByEventId !== earlier.createdByEventId
      ) {
        throw new Error(
          `Traceability invalidation expected creating event ` +
            `'${change.invalidatesCreatedByEventId}', not '${earlier.createdByEventId}'.`
        );
      }
      delete relations[identity];
    }

    // Event changes are atomic. Remove every superseded pre-event edge first so a
    // replacement edge is checked against the event's final graph, not a transient graph.
    for (const [identity, before] of beforeByIdentity) {
      const after = relations[identity];
      if (before !== undefined && before !== after) {
        removeIndexedRelation(before, genealogyOutputsByInput);
      }
    }
    for (const [identity, before] of beforeByIdentity) {
      const after = relations[identity];
      if (after !== undefined && before !== after) {
        validateAndIndexAddition(after, genealogyOutputsByInput);
      }
    }
  }

  return { relations };
}

/** Prove one new genealogy edge preserves the DAG invariant, then index it. */
function validateAndIndexAddition(
  relation: Pick<InventoryTraceabilityRelationChange, "kind" | "from" | "to">,
  genealogyOutputsByInput: Map<string, Set<string>>
): void {
  if (relation.kind !== InventoryTraceabilityRelationKind.Genealogy) return;
  const fromIdentity = inventoryTraceabilityNodeIdentity(relation.from);
  const toIdentity = inventoryTraceabilityNodeIdentity(relation.to);
  assertNoGenealogyPath(genealogyOutputsByInput, toIdentity, fromIdentity);
  const outputs =
    genealogyOutputsByInput.get(fromIdentity) ?? new Set<string>();
  outputs.add(toIdentity);
  genealogyOutputsByInput.set(fromIdentity, outputs);
}

/** Remove one effective genealogy edge from the incremental validation index. */
function removeIndexedRelation(
  relation: InventoryTraceabilityRelation,
  genealogyOutputsByInput: Map<string, Set<string>>
): void {
  if (relation.kind !== InventoryTraceabilityRelationKind.Genealogy) return;
  const fromIdentity = inventoryTraceabilityNodeIdentity(relation.from);
  const toIdentity = inventoryTraceabilityNodeIdentity(relation.to);
  const outputs = genealogyOutputsByInput.get(fromIdentity);
  outputs?.delete(toIdentity);
  if (outputs?.size === 0) genealogyOutputsByInput.delete(fromIdentity);
}

/** Reject a genealogy edge when its proposed output already reaches its input. */
function assertNoGenealogyPath(
  outputsByInput: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  target: string
): void {
  /** Genealogy nodes still awaiting traversal from the proposed output. */
  const pending = [start];
  /** Genealogy nodes already inspected while searching for a path back to the input. */
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current === target) {
      throw new Error(`Genealogy graph contains a cycle at '${current}'.`);
    }
    if (visited.has(current)) continue;
    visited.add(current);
    for (const output of outputsByInput.get(current) ?? []) pending.push(output);
  }
}
