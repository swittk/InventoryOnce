import { assertInventoryEpochMilliseconds } from "./events.js";
import { compareInventoryIdentityText } from "./ordering.js";
import { inventoryLotIdentity, type InventoryStockPosition, type InventoryStockPositionKey } from "./model.js";
import type { InventoryProjectionState } from "./projection.js";
import type { InventoryReservation } from "./reservations.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import { inventoryLotAndPlacementUseBy } from "./usability.js";
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

/** One captured placement path node shared by all stock below it. */
interface StockPoolPlacementPath {
  /** Identity of this placement in the retained path. */
  readonly nodeId: string;
  /** The shared remainder of the path toward the root. */
  readonly parent: StockPoolPlacementPath | undefined;
  /** Earliest placement use-by, if any. */
  readonly useByEpochMs: number | undefined;
}

/** Create pool rows that share captured parent paths and inherited expiry evidence. */
export function inventoryStockPoolRowReader(
  metadata: Pick<InventoryProjectionState, "lots" | "placementNodes">,
  parentNodeId: (nodeId: string) => string | undefined,
): (position: InventoryStockPosition, layerStartedAtEpochMs: number | undefined) => InventoryScopedStockPosition {
  /** Capture each related direct edge and its inherited cutoff once per read. */
  const byNode = new Map<string, StockPoolPlacementPath>();
  /** Build one stock row using path and expiry evidence shared with the rest of the pool. */
  function readRow(
    position: InventoryStockPosition,
    layerStartedAtEpochMs: number | undefined,
  ): InventoryScopedStockPosition {
    const { placementNodeId, lotId, itemId } = position.key;
    /** New ancestors are filled from the first retained parent back toward this row. */
    const missing: string[] = [];
    /** The retained parent path, ending at the row's direct node once filled. */
    let placement: StockPoolPlacementPath | undefined;
    let nodeId = placementNodeId;
    while (nodeId !== undefined) {
      placement = byNode.get(nodeId);
      if (placement !== undefined) break;
      missing.push(nodeId);
      nodeId = parentNodeId(nodeId);
    }
    missing.reverse();
    for (const id of missing) {
      const directUseBy = inventorySparseRecordValue(metadata.placementNodes, id)?.definition.useByEpochMs;
      let useByEpochMs = placement?.useByEpochMs;
      if (directUseBy !== undefined) {
        assertInventoryEpochMilliseconds(directUseBy, "placement-node useByEpochMs");
        if (useByEpochMs === undefined || directUseBy < useByEpochMs) useByEpochMs = directUseBy;
      }
      placement = {
        /** Direct node represented by this link. */
        nodeId: id,
        /** Previously captured path above this link. */
        parent: placement,
        /** Earliest cutoff from this link through the root. */
        useByEpochMs,
      };
      byNode.set(id, placement);
    }
    const lotExpires = lotId === undefined
      ? undefined
      : inventorySparseRecordValue(metadata.lots, inventoryLotIdentity(itemId, lotId))?.definition.expiresAtEpochMs;
    const effectiveUseByEpochMs = inventoryLotAndPlacementUseBy(lotExpires, placement?.useByEpochMs);
    return stockPoolRow(position, placement, layerStartedAtEpochMs, effectiveUseByEpochMs);
  }
  return readRow;
}

/** Construct one row whose ancestry holds only its captured path. */
function stockPoolRow(
  position: InventoryStockPosition,
  placement: StockPoolPlacementPath | undefined,
  layerStartedAtEpochMs: number | undefined,
  effectiveUseByEpochMs: number | undefined,
): InventoryScopedStockPosition {
  return {
    /** Published signed stock row. */
    position,
    /** Materialize the ancestry array only on request from the captured path. */
    get ancestry(): readonly string[] {
      const ancestry: string[] = [];
      for (let current = placement; current !== undefined; current = current.parent) ancestry.push(current.nodeId);
      return ancestry;
    },
    ...(layerStartedAtEpochMs === undefined ? {} : { layerStartedAtEpochMs }),
    ...(effectiveUseByEpochMs === undefined ? {} : { effectiveUseByEpochMs }),
  };
}

/** Apply a normalized stock selector with this position's real ancestry. */
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

/** Exact posting identities and their count, available before traversal. */
export interface InventorySubtreeStockPostings {
  /** Number of direct posts at this node. */
  readonly size: number;
  /** Exact posting identities in adapter order. */
  readonly ids: Iterable<string>;
}

/** Exact direct stock postings and direct-child indexes used by a bounded subtree query. */
interface InventorySubtreeStockIndexes {
  /** Read direct stock identities without materializing positions. */
  positionIds(nodeId: string): InventorySubtreeStockPostings;
  /** Read immediate child postings without copying or sorting them. */
  childNodeIds(nodeId: string): InventorySubtreeStockPostings;
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
  /** Placement nodes already inspected, counted once even when roots overlap. */
  const visitedNodes = new Set<string>();
  /** Exact stock postings collected across the visited subtree. */
  const candidates: string[] = [];
  for (const rootNodeId of rootNodeIds) {
    /** Children still to inspect in the published placement graph. */
    const pending = [rootNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (nodeId === undefined) break;
      // Several selected roots can overlap. A direct-stock identity must be
      // considered exactly once, regardless of the number of matching roots.
      if (visitedNodes.has(nodeId)) continue;
      if (visitedNodes.size + 1 >= itemCandidateCount) {
        return undefined;
      }
      visitedNodes.add(nodeId);
      const directPositions = indexes.positionIds(nodeId);
      if (candidates.length + directPositions.size >= itemCandidateCount) return undefined;
      for (const positionId of directPositions.ids) candidates.push(positionId);
      const children = indexes.childNodeIds(nodeId);
      // Check the complete worklist before iterating the child postings.
      if (
        children.size + pending.length + visitedNodes.size >=
        itemCandidateCount
      ) {
        return undefined;
      }
      for (const child of children.ids) {
        pending.push(child);
      }
    }
  }
  candidates.sort(compareInventoryIdentityText);
  return candidates;
}
