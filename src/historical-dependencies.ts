import type { InventoryEventDraft, InventoryCommittedEvent } from "./events.js";
import {
  inventoryEventDependencyKeys,
} from "./event-query.js";
import type { InventoryProjectionState } from "./projection.js";
import {
  inventoryStorageSupportsEventQuery,
  type InventoryDurableStorage,
} from "./storage.js";

/** Inputs for loading one transitive event/resource component from an indexed adapter. */
export interface LoadInventoryHistoricalDependenciesInput {
  /** Durable adapter, optionally exposing internal resource event indexes. */
  readonly storage: InventoryDurableStorage;
  /** Published projection/head the returned component must match. */
  readonly projection: InventoryProjectionState;
  /** Proposed/root assertions whose touched resources seed the closure. */
  readonly seedEvents: readonly InventoryEventDraft[];
  /** Embedded historical assertion identities whose envelopes seed the closure. */
  readonly assertionIds?: readonly string[];
  /** Explicit anchor event identities whose containing envelopes seed the closure. */
  readonly afterEventIds?: readonly string[];
  /** Removed or corrected event identities whose reverse anchored dependents must also be loaded. */
  readonly reverseAnchorEventIds?: readonly string[];
}

/**
 * Load every retained event transitively sharing one touched resource.
 * Undefined means the adapter lacks the optional capability or raced the supplied head;
 * callers then use the canonical complete-history fallback.
 */
export async function loadInventoryHistoricalDependencies({
  storage,
  projection,
  seedEvents,
  assertionIds = [],
  afterEventIds = [],
  reverseAnchorEventIds = [],
}: LoadInventoryHistoricalDependenciesInput): Promise<
  readonly InventoryCommittedEvent[] | undefined
> {
  if (!inventoryStorageSupportsEventQuery(storage)) return undefined;
  const pendingKeys = new Set<string>();
  const omittedAssertionIds = new Set<string>(assertionIds);
  const reverseTargets = new Set<string>(reverseAnchorEventIds);
  for (const event of seedEvents) {
    for (const key of inventoryEventDependencyKeys(event)) pendingKeys.add(key);
  }
  for (const assertionId of assertionIds) {
    pendingKeys.add("dep:assertion:" + assertionId);
  }
  for (const afterEventId of afterEventIds) {
    pendingKeys.add("dep:event:" + afterEventId);
  }
  for (const eventId of reverseAnchorEventIds) {
    pendingKeys.add("dep:anchored-to:" + eventId);
  }
  if (pendingKeys.size === 0) return [];
  const queriedKeys = new Set<string>();
  const events = new Map<string, InventoryCommittedEvent>();
  /** Enqueue one dependency key unless it was already queried in this closure walk. */
  function enqueueKey(key: string): void {
    if (!queriedKeys.has(key)) pendingKeys.add(key);
  }
  while (pendingKeys.size !== 0) {
    const batch = [...pendingKeys].filter(
      /** Keep only resource keys not already expanded. */
      (key) => !queriedKeys.has(key)
    );
    pendingKeys.clear();
    if (batch.length === 0) break;
    for (const key of batch) queriedKeys.add(key);
    let afterRecordSequence: number | undefined;
    do {
      const page = await storage.queryInventoryEventsByResourceKeys({
        resourceKeys: batch,
        ...(afterRecordSequence === undefined
          ? {}
          : { afterRecordSequence }),
        limit: 1_000,
      });
      if (page.throughRecordSequence !== projection.lastRecordSequence) {
        return undefined;
      }
      for (const event of page.events) {
        if (events.has(event.eventId)) continue;
        events.set(event.eventId, event);
        for (const key of inventoryEventDependencyKeys(event)) {
          enqueueKey(key);
        }
        // Only omitted/corrected anchors pull reverse dependents so ordinary reads avoid fanout.
        for (const assertion of event.historicalRepair?.assertions ?? []) {
          if (omittedAssertionIds.has(assertion.assertionId)) {
            enqueueKey("dep:anchored-to:" + assertion.event.eventId);
          }
        }
        if (
          event.correction !== undefined &&
          reverseTargets.has(event.correction.correctsEventId)
        ) {
          reverseTargets.add(event.eventId);
          enqueueKey("dep:anchored-to:" + event.eventId);
          if (
            event.correctionReplacement !== undefined &&
            event.correctionReplacement !== null
          ) {
            reverseTargets.add(event.correctionReplacement.eventId);
            enqueueKey("dep:anchored-to:" + event.correctionReplacement.eventId);
          }
        }
      }
      afterRecordSequence = page.nextAfterRecordSequence;
    } while (afterRecordSequence !== undefined);
  }
  const result = [...events.values()];
  result.sort(
    /** Restore exact durable event order after indexed union traversal. */
    (left, right) => left.recordSequence - right.recordSequence
  );
  return result;
}
