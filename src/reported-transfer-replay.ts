import type { InventoryEventDraft } from "./events.js";

/** Reserved journal metadata carrying the original reported transfer intent and receipt revision. */
export const inventoryReportedTransferReplayMetadataKey = "inventoryOnceReportedTransferReplay";

/** Retain the original report identity and exact publication revision on a plain transfer draft. */
export function stampInventoryReportedTransferReplay(
  event: InventoryEventDraft,
  intentFingerprint: string,
  worldRevision: number,
): InventoryEventDraft {
  return {
    ...event,
    metadata: {
      ...event.metadata,
      [inventoryReportedTransferReplayMetadataKey]: {
        /** Original operation input identity used to reject changed retries. */
        intentFingerprint,
        /** Published world revision restored in the durable receipt. */
        worldRevision,
      },
    },
  };
}
