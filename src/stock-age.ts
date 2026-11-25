import type { InventoryCommittedEvent } from "./events.js";
import { inventoryStockPositionIdentity } from "./model.js";

/** Capture FIFO age before a conserved movement changes source/destination positions. */
export function captureConservedPositiveLayerStarts(
  event: InventoryCommittedEvent,
  positiveLayerStart: (positionId: string) => number | undefined
): Map<string, number> {
  const result = new Map<string, number>();
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    const sourceId = inventoryStockPositionIdentity(transfer.from);
    const destinationId = inventoryStockPositionIdentity(transfer.to);
    const sourceStartedAtEpochMs = positiveLayerStart(sourceId);
    if (sourceStartedAtEpochMs === undefined) {
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
