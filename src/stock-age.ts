import { InventoryEventKind, type InventoryCommittedEvent } from "./events.js";
import { inventoryStockPositionIdentity } from "./model.js";

/** Internal replay marker for corrected history that can remove a retained transfer's source age. */
export const replayEffectiveStockAge = Symbol("replayEffectiveStockAge");

/** Preserve FIFO provenance only for the final positive stock row of a correction. */
export function assertInventoryStockAgeOverride(start: number | undefined, positive: boolean, positionId: string): void {
  if ((start !== undefined) === positive) return;
  throw new Error(positive
    ? `Correction cannot remove positive-layer provenance from positive position ${positionId}.`
    : `Correction cannot assign positive-layer provenance to non-positive position ${positionId}.`);
}

/** Capture FIFO age before a conserved movement changes source/destination positions. */
export function captureConservedPositiveLayerStarts(
  event: InventoryCommittedEvent,
  positiveLayerStart: (positionId: string) => number | undefined,
  replayEffectiveHistory = false
): Map<string, number> {
  const result = new Map<string, number>();
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    const sourceId = inventoryStockPositionIdentity(transfer.from);
    const destinationId = inventoryStockPositionIdentity(transfer.to);
    const sourceStartedAtEpochMs = positiveLayerStart(sourceId);
    if (sourceStartedAtEpochMs === undefined) {
      // A corrected earlier receipt can expose a shortage behind a retained
      // loose-stock transfer. The route remains evidence, with no earlier age to carry.
      if (replayEffectiveHistory && transfer.from.serialId === undefined &&
        inventoryConservedArrivalCanSettleDeficit(event)) continue;
      throw new Error(
        `Conserved FIFO provenance source ${sourceId} is not currently positive.`
      );
    }
    const destinationStartedAtEpochMs = positiveLayerStart(destinationId);
    result.set(
      destinationId,
      destinationStartedAtEpochMs === undefined ||
        sourceStartedAtEpochMs < destinationStartedAtEpochMs
        ? sourceStartedAtEpochMs
        : destinationStartedAtEpochMs
    );
  }
  return result;
}

/** A direct transfer that pays down a signed balance only leaves an age when positive stock remains. */
export function inventoryConservedArrivalCanSettleDeficit(event: InventoryCommittedEvent): boolean {
  return event.kind === InventoryEventKind.Transfer && event.transferLifecycle === undefined;
}
