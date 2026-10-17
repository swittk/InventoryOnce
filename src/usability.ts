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
  let earliest =
    position.lotId === undefined
      ? undefined
      : inventorySparseRecordValue(
          projection.lots,
          inventoryLotIdentity(position.itemId, position.lotId)
        )?.definition.expiresAtEpochMs;
  if (earliest !== undefined) {
    assertInventoryEpochMilliseconds(earliest, "lot expiresAtEpochMs");
  }
  for (const nodeId of
    position.placementNodeId === undefined
      ? []
      : inventoryPlacementAncestry(projection.placement, position.placementNodeId)) {
    const nodeUseByEpochMs = inventorySparseRecordValue(
      projection.placementNodes,
      nodeId
    )?.definition.useByEpochMs;
    if (nodeUseByEpochMs === undefined) continue;
    assertInventoryEpochMilliseconds(
      nodeUseByEpochMs,
      "placement-node useByEpochMs"
    );
    if (earliest === undefined || nodeUseByEpochMs < earliest) {
      earliest = nodeUseByEpochMs;
    }
  }
  return earliest;
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
