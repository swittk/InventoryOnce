import { InventoryEventKind, type InventoryEventDraft } from "./events.js";

/** Reserved journal metadata carrying the original reported transfer intent and receipt revision. */
export const inventoryReportedTransferReplayMetadataKey = "inventoryOnceReportedTransferReplay";

/** Read the reserved audit value only on a plain transfer. */
function inventoryReportedTransferReplayValue(event: InventoryEventDraft | undefined) {
  if (event?.kind !== InventoryEventKind.Transfer || event.transferLifecycle !== undefined) return undefined;
  return event.metadata?.[inventoryReportedTransferReplayMetadataKey];
}

/** Read the original intent and receipt revision from a published transfer. */
export function inventoryReportedTransferReplayEvidence(event: InventoryEventDraft | undefined) {
  const replay = inventoryReportedTransferReplayValue(event);
  if (typeof replay !== "object" || replay === null || !("intentFingerprint" in replay) || !("worldRevision" in replay)) {
    return undefined;
  }
  const { intentFingerprint, worldRevision } = replay;
  if (typeof intentFingerprint !== "string" || typeof worldRevision !== "number") return undefined;
  return { intentFingerprint, worldRevision };
}

/** Bind any reserved replay evidence to the accepted intent and the next published revision. */
export function assertInventoryPublishedTransferReplayEvidence(
  event: InventoryEventDraft | undefined,
  intentFingerprint: string,
  worldRevision: number,
): void {
  if (inventoryReportedTransferReplayValue(event) === undefined) return;
  const replay = inventoryReportedTransferReplayEvidence(event);
  if (replay === undefined || replay.intentFingerprint !== intentFingerprint || replay.worldRevision !== worldRevision) {
    throw new Error("Inventory transfer replay evidence must match the accepted operation intent and receipt revision.");
  }
}
