import type { InventoryEventDraft, InventoryCommittedEvent } from "./events.js";
import {
  inventoryEventDependencyKeys,
} from "./event-query.js";
import type { InventoryProjectionState } from "./projection.js";
import {
  inventoryStorageSupportsEventQuery,
  type InventoryDurableStorage,
} from "./storage.js";

/** Stream the retained events matching these keys, or yield undefined if the fence changed. */
export type InventoryHistoricalDependencyReader = (
  resourceKeys: readonly string[]
) => AsyncIterable<InventoryCommittedEvent | undefined>;

/** Inputs for walking one transitive event/resource component at a fixed published head. */
export interface LoadInventoryHistoricalDependencyComponentInput {
  /** Proposed/root assertions whose touched resources seed the closure. */
  readonly seedEvents: readonly InventoryEventDraft[];
  /** Embedded historical assertion identities whose envelopes seed the closure. */
  readonly assertionIds?: readonly string[];
  /** Adapter reads all matches for these keys at the same published head. */
  readonly readEvents: InventoryHistoricalDependencyReader;
}

/** Existing facade read using the optional event-query capability at its saved head. */
export interface LoadInventoryHistoricalDependenciesInput
  extends Omit<LoadInventoryHistoricalDependencyComponentInput, "readEvents"> {
  /** Durable adapter, optionally exposing internal resource event indexes. */
  readonly storage: InventoryDurableStorage;
  /** Published projection/head the returned component must match. */
  readonly projection: InventoryProjectionState;
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
  assertionIds,
}: LoadInventoryHistoricalDependenciesInput): Promise<
  readonly InventoryCommittedEvent[] | undefined
> {
  if (!inventoryStorageSupportsEventQuery(storage)) return undefined;
  return loadInventoryHistoricalDependencyComponent({
    seedEvents,
    ...(assertionIds === undefined ? {} : { assertionIds }),
    /** Adapt the facade's sequence cursor to the same walk used by pinned row stores. */
    async *readEvents(resourceKeys) {
      let afterRecordSequence: number | undefined;
      do {
        const page = await storage.queryInventoryEventsByResourceKeys({
          resourceKeys,
          ...(afterRecordSequence === undefined ? {} : { afterRecordSequence }),
          limit: 1_000,
        });
        if (page.throughRecordSequence !== projection.lastRecordSequence) {
          yield undefined;
          return;
        }
        yield* page.events;
        afterRecordSequence = page.nextAfterRecordSequence;
      } while (afterRecordSequence !== undefined);
    },
  });
}

/** Expand only linked resources and restore durable event order for the historical planner. */
export async function loadInventoryHistoricalDependencyComponent({
  seedEvents,
  assertionIds = [],
  readEvents,
}: LoadInventoryHistoricalDependencyComponentInput): Promise<
  readonly InventoryCommittedEvent[] | undefined
> {
  /** Keys discovered from seeds or loaded events and still waiting for their index read. */
  const pendingKeys = new Set<string>();
  for (const event of seedEvents) {
    for (const key of inventoryEventDependencyKeys(event)) pendingKeys.add(key);
  }
  for (const assertionId of assertionIds) {
    pendingKeys.add("dep:assertion:" + assertionId);
  }
  if (pendingKeys.size === 0) return [];
  /** Each dependency key is expanded once, even when several events point to it. */
  const queriedKeys = new Set<string>();
  /** Events are stored once even when they are posted under several resource keys. */
  const events = new Map<string, InventoryCommittedEvent>();
  while (pendingKeys.size !== 0) {
    const batch = [...pendingKeys].filter(
      /** Keep only resource keys not already expanded. */
      (key) => !queriedKeys.has(key)
    );
    pendingKeys.clear();
    if (batch.length === 0) break;
    for (const key of batch) queriedKeys.add(key);
    for await (const event of readEvents(batch)) {
      if (event === undefined) return undefined;
      if (events.has(event.eventId)) continue;
      events.set(event.eventId, event);
      for (const key of inventoryEventDependencyKeys(event)) {
        if (!queriedKeys.has(key)) pendingKeys.add(key);
      }
    }
  }
  const result = [...events.values()];
  result.sort(
    /** Restore exact durable event order after indexed union traversal. */
    (left, right) => left.recordSequence - right.recordSequence
  );
  return result;
}
