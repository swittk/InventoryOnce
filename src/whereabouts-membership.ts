import type { InventoryEventDraft } from "./events.js";
import { compareInventoryIdentityText } from "./ordering.js";

/** Derive the cohort lifecycle membership of a committed event and its retained correction root. */
export function inventoryEventWhereaboutsMembership(
  event: InventoryEventDraft,
  correctedRoot?: InventoryEventDraft
): readonly string[] {
  const result = new Set<string>();
  addDirectInventoryWhereaboutsIds(result, event);
  for (const whereaboutsId of event.historicalImpact?.whereaboutsIds ?? []) result.add(whereaboutsId);
  for (const assertion of event.historicalRepair?.assertions ?? []) {
    addDirectInventoryWhereaboutsIds(result, assertion.event);
  }
  if (correctedRoot !== undefined) addDirectInventoryWhereaboutsIds(result, correctedRoot);
  return [...result].sort(compareInventoryIdentityText);
}

/** Add direct whereabouts identities retained in one event's stock/provenance evidence. */
function addDirectInventoryWhereaboutsIds(
  result: Set<string>,
  event: InventoryEventDraft
): void {
  for (const effect of event.stockEffects) {
    if (effect.position.whereaboutsId !== undefined) {
      result.add(effect.position.whereaboutsId);
    }
  }
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    if (transfer.from.whereaboutsId !== undefined) {
      result.add(transfer.from.whereaboutsId);
    }
    if (transfer.to.whereaboutsId !== undefined) {
      result.add(transfer.to.whereaboutsId);
    }
  }
  for (const override of event.positiveLayerProvenanceOverrides ?? []) {
    if (override.position.whereaboutsId !== undefined) {
      result.add(override.position.whereaboutsId);
    }
  }
}
