import { assertInventoryEpochMilliseconds } from "./events.js";
import {
  inventoryContainerIdentity,
  inventoryLotIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import type { InventoryProjectionState } from "./projection.js";

/** Return the earliest lot expiry or container-specific use-by for one exact position. */
export function inventoryPositionEffectiveUseByEpochMs(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
): number | undefined {
  const lotExpiryEpochMs = position.lotId === undefined
    ? undefined
    : projection.lots[
        inventoryLotIdentity(position.itemId, position.lotId)
      ]?.definition.expiresAtEpochMs;
  const containerUseByEpochMs = position.containerId === undefined
    ? undefined
    : projection.containers[
        inventoryContainerIdentity(position.containerId)
      ]?.definition.useByEpochMs;
  if (lotExpiryEpochMs !== undefined) assertInventoryEpochMilliseconds(lotExpiryEpochMs, "lot expiresAtEpochMs");
  if (containerUseByEpochMs !== undefined) assertInventoryEpochMilliseconds(containerUseByEpochMs, "container useByEpochMs");
  if (lotExpiryEpochMs === undefined) return containerUseByEpochMs;
  if (containerUseByEpochMs === undefined) return lotExpiryEpochMs;
  return lotExpiryEpochMs <= containerUseByEpochMs ? lotExpiryEpochMs : containerUseByEpochMs;
}

/** Return whether one position is expired at the supplied time; expiry is inclusive at effective use-by. */
export function inventoryPositionIsExpiredAt(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
  atEpochMs: number,
): boolean {
  assertInventoryEpochMilliseconds(atEpochMs, "position query atEpochMs");
  const useByEpochMs = inventoryPositionEffectiveUseByEpochMs(projection, position);
  return useByEpochMs !== undefined && useByEpochMs <= atEpochMs;
}
