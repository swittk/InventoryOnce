import { assertInventoryEpochMilliseconds } from "./events.js";
import {
  inventoryLotIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import { inventoryPlacementAncestry } from "./placement.js";
import type { InventoryProjectionState } from "./projection.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** Return the earliest lot expiry or placement-ancestor use-by for one exact position. */
export function inventoryPositionEffectiveUseByEpochMs(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey
): number | undefined {
  const lotExpiresAtEpochMs =
    position.lotId === undefined
      ? undefined
      : inventorySparseRecordValue(
          projection.lots,
          inventoryLotIdentity(position.itemId, position.lotId)
        )?.definition.expiresAtEpochMs;
  return inventoryEffectiveUseByFromAncestry(
    lotExpiresAtEpochMs,
    position.placementNodeId === undefined
      ? []
      : inventoryPlacementAncestry(projection.placement, position.placementNodeId),
    /** Read the current node use-by from the same published projection. */
    (nodeId) => inventorySparseRecordValue(projection.placementNodes, nodeId)?.definition.useByEpochMs
  );
}

/** Reduce lot expiry and every applicable node use-by to one inclusive cutoff. */
export function inventoryEffectiveUseByFromAncestry(
  lotExpiresAtEpochMs: number | undefined,
  ancestry: readonly string[],
  nodeUseBy: (nodeId: string) => number | undefined
): number | undefined {
  let earliest: number | undefined;
  for (const nodeId of ancestry) {
    const nodeUseByEpochMs = nodeUseBy(nodeId);
    if (nodeUseByEpochMs === undefined) continue;
    assertInventoryEpochMilliseconds(
      nodeUseByEpochMs,
      "placement-node useByEpochMs"
    );
    if (earliest === undefined || nodeUseByEpochMs < earliest) {
      earliest = nodeUseByEpochMs;
    }
  }
  return inventoryLotAndPlacementUseBy(lotExpiresAtEpochMs, earliest);
}

/** Combine lot expiry with a placement cutoff already validated for this snapshot. */
export function inventoryLotAndPlacementUseBy(
  lotExpiresAtEpochMs: number | undefined,
  placementUseByEpochMs: number | undefined
): number | undefined {
  if (lotExpiresAtEpochMs === undefined) return placementUseByEpochMs;
  assertInventoryEpochMilliseconds(lotExpiresAtEpochMs, "lot expiresAtEpochMs");
  return placementUseByEpochMs === undefined
    ? lotExpiresAtEpochMs
    : Math.min(lotExpiresAtEpochMs, placementUseByEpochMs);
}

/** Return whether one position is expired at the supplied time; expiry is inclusive at effective use-by. */
export function inventoryPositionIsExpiredAt(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
  atEpochMs: number
): boolean {
  assertInventoryEpochMilliseconds(atEpochMs, "position query atEpochMs");
  const useByEpochMs = inventoryPositionEffectiveUseByEpochMs(
    projection,
    position
  );
  return useByEpochMs !== undefined && useByEpochMs <= atEpochMs;
}
