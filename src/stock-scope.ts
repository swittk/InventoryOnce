import { compareInventoryIdentityText } from "./ordering.js";
import type { InventoryStockPosition, InventoryStockPositionKey } from "./model.js";
import type { InventoryReservation } from "./reservations.js";
import {
  inventoryStockPositionMatchesNormalizedSelector,
  type InventoryStockSelector,
} from "./selectors.js";

/** One exact signed position and its current policy evidence. */
export interface InventoryScopedStockPosition {
  /** Published exact key and signed measurement vector. */
  readonly position: InventoryStockPosition;
  /** Direct placement and its ancestors, empty for unresolved stock. */
  readonly ancestry: readonly string[];
  /** Current positive layer origin, absent for signed deficit rows. */
  readonly layerStartedAtEpochMs?: number;
  /** Earliest use-by from the lot and current placement ancestry. */
  readonly effectiveUseByEpochMs?: number;
}

/** Complete signed stock and claim evidence for one selected revision's physical pools. */
export interface InventoryScopedStockPool {
  /** Exact rows in deterministic position-identity order. */
  readonly positions: readonly InventoryScopedStockPosition[];
  /** Claim states at the requested time, including exact holds on returned positions. */
  readonly reservations: readonly InventoryReservation[];
}

/** Apply the existing stock selector with this position's real ancestry. */
export function inventoryScopedStockMatches(
  position: InventoryStockPositionKey,
  selector: InventoryStockSelector,
  ancestry: readonly string[]
): boolean {
  if (selector.withinPlacementNodeIds === undefined) {
    return inventoryStockPositionMatchesNormalizedSelector(position, selector);
  }
  const { withinPlacementNodeIds, ...directSelector } = selector;
  for (const nodeId of ancestry) {
    if (withinPlacementNodeIds.includes(nodeId)) {
      return inventoryStockPositionMatchesNormalizedSelector(position, directSelector);
    }
  }
  return false;
}

/** Exact direct stock postings and direct-child indexes used by a bounded subtree query. */
interface InventorySubtreeStockIndexes {
  /** Read the local stock posting list without materializing its positions. */
  positionIds(nodeId: string): {
    /** Number of direct positions at this node. */
    readonly size: number;
    /** Exact posting identities in adapter order. */
    readonly ids: Iterable<string>;
  };
  /** Read only the immediate children of this node. */
  childNodeIds(nodeId: string): readonly string[];
}

/** One enter/leave visit in the bounded physical placement traversal. */
interface InventorySubtreeCandidateVisit {
  /** Exact placement node being inspected. */
  readonly nodeId: string;
  /** Whether this visit finishes a node after its descendants. */
  readonly exiting: boolean;
}

/**
 * Enumerate selective subtree stock without traversing an arbitrarily large
 * mostly empty topology. Once the graph/index search would cost as much as
 * the item/revision candidates, return undefined to use that existing index.
 */
export function candidateSubtreePositionIds(
  indexes: InventorySubtreeStockIndexes,
  rootNodeIds: readonly string[],
  itemCandidateCount: number
): readonly string[] | undefined {
  // With small item scopes, filtering a few rows is cheaper than graph work.
  if (itemCandidateCount < 128) return undefined;
  const visitedNodes = new Set<string>();
  const ancestors = new Set<string>();
  const candidates: string[] = [];
  for (const rootNodeId of rootNodeIds) {
    const pending: InventorySubtreeCandidateVisit[] = [
      { nodeId: rootNodeId, exiting: false },
    ];
    while (pending.length > 0) {
      const visit = pending.pop();
      if (visit === undefined) break;
      const nodeId = visit.nodeId;
      if (visit.exiting) {
        ancestors.delete(nodeId);
        visitedNodes.add(nodeId);
        continue;
      }
      if (ancestors.has(nodeId)) {
        throw new Error("Placement graph contains a cycle at '" + nodeId + "'.");
      }
      // Several selected roots can overlap. A direct-stock identity must be
      // considered exactly once, regardless of the number of matching roots.
      if (visitedNodes.has(nodeId)) continue;
      if (visitedNodes.size + ancestors.size + 1 >= itemCandidateCount) {
        return undefined;
      }
      ancestors.add(nodeId);
      const directPositions = indexes.positionIds(nodeId);
      if (candidates.length + directPositions.size >= itemCandidateCount) return undefined;
      for (const positionId of directPositions.ids) candidates.push(positionId);
      if (candidates.length >= itemCandidateCount) return undefined;
      const children = indexes.childNodeIds(nodeId);
      // Do not allocate/traverse 100k sibling nodes to answer a 5k-row item
      // query. This conservative bound affects only the chosen index path.
      if (
        children.length + visitedNodes.size + ancestors.size >=
        itemCandidateCount
      ) {
        return undefined;
      }
      pending.push({ nodeId, exiting: true });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          pending.push({ nodeId: child, exiting: false });
        }
      }
    }
  }
  candidates.sort(compareInventoryIdentityText);
  return candidates;
}
