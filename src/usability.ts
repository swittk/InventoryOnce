import {
  inventoryContainerIdentity,
  inventoryLotIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import type { InventoryProjectionState } from "./projection.js";

/** Return the earliest lot expiry or container-specific use-by for one exact position. */
export function inventoryPositionEffectiveUseBy(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
): string | undefined {
  const lotExpiry = position.lotId === undefined
    ? undefined
    : projection.lots[
        inventoryLotIdentity(position.itemId, position.lotId)
      ]?.definition.expiresAt;
  const containerUseBy = position.containerId === undefined
    ? undefined
    : projection.containers[
        inventoryContainerIdentity(position.containerId)
      ]?.definition.useBy;
  if (lotExpiry === undefined) return containerUseBy;
  if (containerUseBy === undefined) return lotExpiry;
  return lotExpiry <= containerUseBy ? lotExpiry : containerUseBy;
}

/** Return whether one position is past its effective lot/container use-by at the supplied time. */
export function inventoryPositionIsExpiredAt(
  projection: InventoryProjectionState,
  position: InventoryStockPositionKey,
  at: string,
): boolean {
  const useBy = inventoryPositionEffectiveUseBy(projection, position);
  return useBy !== undefined && useBy <= at;
}
