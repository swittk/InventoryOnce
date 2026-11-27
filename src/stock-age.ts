import { InventoryEventKind, InventoryTransferLifecycleAction, type InventoryCommittedEvent } from "./events.js";
import { inventoryStockPositionIdentity } from "./model.js";

/** Internal replay marker for histories that can omit source age or the stock behind a count debit. */
export const replayEffectiveStockAge = Symbol("replayEffectiveStockAge");

/** Internal scope for reconstructing a count baseline from committed history. */
export const replayCountScope = Symbol("replayCountScope");

/** The filtered view that owns the age reconstruction. */
export type InventoryStockAgeReplay = "effective-history" | "occurrence-cut";

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
  replay?: InventoryStockAgeReplay
): Map<string, number> {
  const result = new Map<string, number>();
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    const sourceId = inventoryStockPositionIdentity(transfer.from);
    const destinationId = inventoryStockPositionIdentity(transfer.to);
    const sourceStartedAtEpochMs = positiveLayerStart(sourceId);
    if (sourceStartedAtEpochMs === undefined) {
      // The retained route still records the movement when filtered history has no earlier age to carry.
      if (inventoryReplayCanOmitConservedSourceAge(event, replay, transfer.from.serialId)) continue;
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

/** A conserved arrival can settle signed debt without leaving a positive FIFO layer. */
export function inventoryConservedArrivalCanSettleDeficit(event: InventoryCommittedEvent, serialId: string | undefined): boolean {
  switch (event.kind) {
    case InventoryEventKind.Transfer:
      return event.transferLifecycle === undefined ||
        event.transferLifecycle.action === InventoryTransferLifecycleAction.Receive;
    case InventoryEventKind.Reclassification:
      return event.transferLifecycle === undefined ||
        event.transferLifecycle.action === InventoryTransferLifecycleAction.Release;
    case InventoryEventKind.RevisionTransition:
    case InventoryEventKind.Pack:
    case InventoryEventKind.Unpack:
      return true;
    case InventoryEventKind.Placement:
      // Placement of a serialized resource needs a live destination for its stock and edge.
      return serialId === undefined;
    default:
      return false;
  }
}

/** Decide when a filtered history can retain the conserved route without its source FIFO age. */
function inventoryReplayCanOmitConservedSourceAge(
  event: InventoryCommittedEvent,
  replay: InventoryStockAgeReplay | undefined,
  serialId: string | undefined,
): boolean {
  if (replay === undefined || serialId !== undefined || event.transferLifecycle !== undefined) return false;
  return event.kind === InventoryEventKind.Transfer ||
    event.kind === InventoryEventKind.Reclassification ||
    event.kind === InventoryEventKind.Pack ||
    event.kind === InventoryEventKind.Unpack ||
    event.kind === InventoryEventKind.RevisionTransition ||
    event.kind === InventoryEventKind.Placement;
}
