import { inventoryIntentFingerprint } from "./canonical.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  assertInventoryEpochMilliseconds,
  InventoryEventKind,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
} from "./events.js";
import {
  assertInventoryIdentity,
  inventoryLotIdentity,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import { cloneInventoryRetainedData } from "./sparse-record.js";
import { inventoryTraceabilityRelationIdentity } from "./traceability.js";
import type { InventoryProjectionState } from "./projection.js";

/** Item-scoped serial filter for retained event history. */
export interface InventoryEventSerialRef {
  /** Stable item identity owning this serial namespace. */
  readonly itemId: string;
  /** Exact serial identity. */
  readonly serialId: string;
}

/** Item-scoped lot filter for retained event history. */
export interface InventoryEventLotRef {
  /** Stable item identity owning this lot namespace. */
  readonly itemId: string;
  /** Exact lot identity. */
  readonly lotId: string;
}

/** Durable ordering for retained-event pages. */
export enum InventoryEventQueryDirection {
  /** Oldest retained record first. */
  Ascending = "ascending",
  /** Newest retained record first. */
  Descending = "descending",
}

/** Indexed retained-event query in durable order. */
export interface InventoryEventQuery {
  /** Events touching any of these stable items. */
  readonly itemIds?: readonly string[];
  /** Events touching any of these immutable item revisions. */
  readonly itemRevisionIds?: readonly string[];
  /** Events touching any of these item-scoped serial identities. */
  readonly serials?: readonly InventoryEventSerialRef[];
  /** Events touching any of these item-scoped lot identities. */
  readonly lots?: readonly InventoryEventLotRef[];
  /** Events touching any of these placement nodes. */
  readonly placementNodeIds?: readonly string[];
  /** Events touching any of these unresolved whereabouts cohorts. */
  readonly whereaboutsIds?: readonly string[];
  /** Top-level or embedded historical assertion kinds. */
  readonly kinds?: readonly InventoryEventKind[];
  /** Correction events whose retained root is in this set. */
  readonly correctsEventIds?: readonly string[];
  /** Match event/assertion occurrence at or after this physical time. */
  readonly occurredFromEpochMs?: number;
  /** Match event/assertion occurrence at or before this physical time. */
  readonly occurredThroughEpochMs?: number;
  /** Match durable records learned at or after this time. */
  readonly recordedFromEpochMs?: number;
  /** Match durable records learned at or before this time. */
  readonly recordedThroughEpochMs?: number;
  /** Inclusive durable sequence lower bound. */
  readonly recordSequenceFrom?: number;
  /** Inclusive durable sequence upper bound. */
  readonly recordSequenceThrough?: number;
  /** Durable traversal direction; defaults to ascending. */
  readonly direction?: InventoryEventQueryDirection;
  /** Opaque continuation cursor binding filters, direction, and the first page's journal head. */
  readonly cursor?: string;
  /** Maximum events returned; defaults to 100 and is capped at 1,000. */
  readonly limit?: number;
}

/** One durable-order retained-event page. */
export interface InventoryEventPage {
  /** Published/event-journal sequence visible to this query. */
  readonly throughRecordSequence: number;
  /** Exact retained events in the requested durable direction. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Opaque stable-snapshot continuation cursor. */
  readonly nextCursor?: string;
}

/** Normalized query plus sets used by index-backed and fallback implementations. */
export interface NormalizedInventoryEventQuery {
  /** Validated stable item identities. */
  readonly itemIds: ReadonlySet<string> | undefined;
  /** Validated immutable item-revision identities. */
  readonly itemRevisionIds: ReadonlySet<string> | undefined;
  /** Validated collision-free item-scoped serial identities. */
  readonly serialIdentities: ReadonlySet<string> | undefined;
  /** Validated collision-free item-scoped lot identities. */
  readonly lotIdentities: ReadonlySet<string> | undefined;
  /** Validated placement-node identities. */
  readonly placementNodeIds: ReadonlySet<string> | undefined;
  /** Validated whereabouts cohort identities. */
  readonly whereaboutsIds: ReadonlySet<string> | undefined;
  /** Validated retained or embedded event kinds. */
  readonly kinds: ReadonlySet<InventoryEventKind> | undefined;
  /** Validated retained roots whose correction envelopes are requested. */
  readonly correctsEventIds: ReadonlySet<string> | undefined;
  /** Inclusive physical occurrence lower bound. */
  readonly occurredFromEpochMs?: number;
  /** Inclusive physical occurrence upper bound. */
  readonly occurredThroughEpochMs?: number;
  /** Inclusive durable record-time lower bound. */
  readonly recordedFromEpochMs?: number;
  /** Inclusive durable record-time upper bound. */
  readonly recordedThroughEpochMs?: number;
  /** Inclusive durable sequence lower bound before page-cursor application. */
  readonly recordSequenceFrom: number;
  /** Inclusive durable sequence upper bound before journal-head fencing. */
  readonly recordSequenceThrough?: number;
  /** Durable traversal direction. */
  readonly direction: InventoryEventQueryDirection;
  /** Exclusive prior-page sequence boundary decoded from one stable cursor. */
  readonly cursorBoundary?: number;
  /** Journal head frozen by the first page's cursor. */
  readonly cursorThroughRecordSequence?: number;
  /** Stable normalized filter fingerprint bound into every cursor. */
  readonly cursorFingerprint: string;
  /** Validated maximum page size. */
  readonly limit: number;
}

/** Prefix/version for opaque stable event-page cursors. */
const inventoryEventCursorPrefix = "inventory:event-query:v1:";

/** Decoded stable-page cursor payload. */
interface InventoryEventCursorPayload {
  /** Cursor schema version. */
  readonly version: 1;
  /** Durable traversal direction. */
  readonly direction: InventoryEventQueryDirection;
  /** Exclusive last sequence returned by the prior page. */
  readonly boundary: number;
  /** Journal head frozen by the first page. */
  readonly throughRecordSequence: number;
  /** Fingerprint of every filter/range/direction except page size. */
  readonly fingerprint: string;
}

/** Validate one public event query without performing storage work. */
export function normalizeInventoryEventQuery(
  query: InventoryEventQuery
): NormalizedInventoryEventQuery {
  const occurredFromEpochMs = normalizeOptionalEventEpoch(
    query.occurredFromEpochMs,
    "event query occurredFromEpochMs"
  );
  const occurredThroughEpochMs = normalizeOptionalEventEpoch(
    query.occurredThroughEpochMs,
    "event query occurredThroughEpochMs"
  );
  const recordedFromEpochMs = normalizeOptionalEventEpoch(
    query.recordedFromEpochMs,
    "event query recordedFromEpochMs"
  );
  const recordedThroughEpochMs = normalizeOptionalEventEpoch(
    query.recordedThroughEpochMs,
    "event query recordedThroughEpochMs"
  );
  if (
    occurredFromEpochMs !== undefined &&
    occurredThroughEpochMs !== undefined &&
    occurredFromEpochMs > occurredThroughEpochMs
  ) throw new Error("Event query occurrence-time range is reversed.");
  if (
    recordedFromEpochMs !== undefined &&
    recordedThroughEpochMs !== undefined &&
    recordedFromEpochMs > recordedThroughEpochMs
  ) throw new Error("Event query recorded-time range is reversed.");

  const direction = normalizeEventQueryDirection(query.direction);
  const recordSequenceFrom =
    normalizeOptionalEventSequence(
      query.recordSequenceFrom,
      "event query recordSequenceFrom"
    ) ?? 1;
  const recordSequenceThrough = normalizeOptionalEventSequence(
    query.recordSequenceThrough,
    "event query recordSequenceThrough"
  );
  if (
    recordSequenceThrough !== undefined &&
    recordSequenceFrom > recordSequenceThrough
  ) throw new Error("Event query durable-sequence range is reversed.");
  const limit = query.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new Error("Event query limit must be a positive safe integer at most 1,000.");
  }

  const itemIds = normalizeIdentitySet(query.itemIds, "event query itemId");
  const itemRevisionIds = normalizeIdentitySet(
    query.itemRevisionIds,
    "event query itemRevisionId"
  );
  const serialIdentities = normalizeSerialRefs(query.serials);
  const lotIdentities = normalizeLotRefs(query.lots);
  const placementNodeIds = normalizeIdentitySet(
    query.placementNodeIds,
    "event query placementNodeId"
  );
  const whereaboutsIds = normalizeIdentitySet(
    query.whereaboutsIds,
    "event query whereaboutsId"
  );
  const kinds = normalizeEventKinds(query.kinds);
  const correctsEventIds = normalizeIdentitySet(
    query.correctsEventIds,
    "event query correctsEventId"
  );
  const cursorFingerprint = inventoryEventQueryFingerprint({
    itemIds,
    itemRevisionIds,
    serialIdentities,
    lotIdentities,
    placementNodeIds,
    whereaboutsIds,
    kinds,
    correctsEventIds,
    occurredFromEpochMs,
    occurredThroughEpochMs,
    recordedFromEpochMs,
    recordedThroughEpochMs,
    recordSequenceFrom,
    recordSequenceThrough,
    direction,
  });
  const cursor =
    query.cursor === undefined
      ? undefined
      : decodeInventoryEventCursor(query.cursor);
  const cursorBoundary = cursor?.boundary;
  if (
    cursor !== undefined &&
    (cursor.direction !== direction || cursor.fingerprint !== cursorFingerprint)
  ) {
    throw new Error(
      "Event query cursor does not match the query filters or direction."
    );
  }

  return {
    itemIds,
    itemRevisionIds,
    serialIdentities,
    lotIdentities,
    placementNodeIds,
    whereaboutsIds,
    kinds,
    correctsEventIds,
    ...(occurredFromEpochMs === undefined ? {} : { occurredFromEpochMs }),
    ...(occurredThroughEpochMs === undefined
      ? {}
      : { occurredThroughEpochMs }),
    ...(recordedFromEpochMs === undefined ? {} : { recordedFromEpochMs }),
    ...(recordedThroughEpochMs === undefined
      ? {}
      : { recordedThroughEpochMs }),
    recordSequenceFrom,
    ...(recordSequenceThrough === undefined
      ? {}
      : { recordSequenceThrough }),
    direction,
    ...(cursorBoundary === undefined ? {} : { cursorBoundary }),
    ...(cursor === undefined
      ? {}
      : { cursorThroughRecordSequence: cursor.throughRecordSequence }),
    cursorFingerprint,
    limit,
  };
}

/** Exact sequence iteration window for one page against a current append-only head. */
export interface InventoryEventQuerySequenceWindow {
  /** Journal head frozen by the first page. */
  readonly throughRecordSequence: number;
  /** First durable sequence probed in this page. */
  readonly firstRecordSequence: number;
  /** Inclusive terminal sequence in this direction. */
  readonly lastRecordSequence: number;
  /** Positive or negative one. */
  readonly step: 1 | -1;
}

/** Resolve stable page bounds without allowing later appends into a continuation. */
export function inventoryEventQuerySequenceWindow(
  query: NormalizedInventoryEventQuery,
  currentRecordSequence: number
): InventoryEventQuerySequenceWindow {
  if (!Number.isSafeInteger(currentRecordSequence) || currentRecordSequence < 0) {
    throw new Error("Event query journal head must be a non-negative safe integer.");
  }
  const frozenHead = query.cursorThroughRecordSequence ?? currentRecordSequence;
  if (frozenHead > currentRecordSequence) {
    throw new Error("Event query cursor is ahead of the current journal head.");
  }
  const upper = Math.min(
    query.recordSequenceThrough ?? frozenHead,
    frozenHead
  );
  if (query.direction === InventoryEventQueryDirection.Ascending) {
    return {
      throughRecordSequence: frozenHead,
      firstRecordSequence: Math.max(
        query.recordSequenceFrom,
        (query.cursorBoundary ?? 0) + 1
      ),
      lastRecordSequence: upper,
      step: 1,
    };
  }
  return {
    throughRecordSequence: frozenHead,
    firstRecordSequence: Math.min(
      upper,
      (query.cursorBoundary ?? upper + 1) - 1
    ),
    // Zero is a valid filter boundary, but persisted sequences start at one.
    lastRecordSequence: Math.max(1, query.recordSequenceFrom),
    step: -1,
  };
}

/** Build one immutable public page and bind its continuation to this snapshot. */
export function createInventoryEventPage(
  query: NormalizedInventoryEventQuery,
  currentRecordSequence: number,
  events: readonly InventoryCommittedEvent[],
  hasMore: boolean
): InventoryEventPage {
  const window = inventoryEventQuerySequenceWindow(query, currentRecordSequence);
  const last = events[events.length - 1];
  return cloneInventoryRetainedData({
    throughRecordSequence: window.throughRecordSequence,
    events,
    ...(hasMore && last !== undefined
      ? {
          nextCursor: encodeInventoryEventCursor({
            version: 1,
            direction: query.direction,
            boundary: last.recordSequence,
            throughRecordSequence: window.throughRecordSequence,
            fingerprint: query.cursorFingerprint,
          }),
        }
      : {}),
  });
}

/** Query one canonical projection without depending on object insertion order. */
export function queryInventoryProjectionEvents(
  projection: InventoryProjectionState,
  query: InventoryEventQuery
): InventoryEventPage {
  const normalized = normalizeInventoryEventQuery(query);
  const window = inventoryEventQuerySequenceWindow(
    normalized,
    projection.lastRecordSequence
  );
  const events: InventoryCommittedEvent[] = [];
  let hasMore = false;
  for (
    let sequence = window.firstRecordSequence;
    window.step === 1
      ? sequence <= window.lastRecordSequence
      : sequence >= window.lastRecordSequence;
    sequence += window.step
  ) {
    const eventId = projection.eventIdsBySequence[String(sequence)];
    const event = eventId === undefined ? undefined : projection.events[eventId];
    if (event === undefined || event.recordSequence !== sequence) {
      throw new Error(`Event query index disagrees at recordSequence ${sequence}.`);
    }
    if (!inventoryEventMatchesQuery(event, normalized)) continue;
    if (events.length === normalized.limit) {
      hasMore = true;
      break;
    }
    events.push(event);
  }
  return createInventoryEventPage(
    normalized,
    projection.lastRecordSequence,
    events,
    hasMore
  );
}

/** Return whether one retained envelope/event matches every normalized filter. */
export function inventoryEventMatchesQuery(
  event: InventoryCommittedEvent,
  query: NormalizedInventoryEventQuery
): boolean {
  if (event.recordSequence < query.recordSequenceFrom) return false;
  if (
    query.recordSequenceThrough !== undefined &&
    event.recordSequence > query.recordSequenceThrough
  ) return false;
  if (
    query.recordedFromEpochMs !== undefined &&
    event.recordedAtEpochMs < query.recordedFromEpochMs
  ) return false;
  if (
    query.recordedThroughEpochMs !== undefined &&
    event.recordedAtEpochMs > query.recordedThroughEpochMs
  ) return false;
  if (
    query.correctsEventIds !== undefined &&
    (event.correction === undefined ||
      !query.correctsEventIds.has(event.correction.correctsEventId))
  ) return false;
  const assertions = inventoryEventEffectiveAssertions(event);
  if (
    query.kinds !== undefined &&
    !inventoryEventEffectiveKinds(event).some(
      /** Match one top-level or embedded assertion kind. */
      (kind) => query.kinds!.has(kind)
    )
  ) return false;
  if (
    (query.occurredFromEpochMs !== undefined ||
      query.occurredThroughEpochMs !== undefined) &&
    !assertions.some(
      /** Match one top-level or embedded assertion occurrence interval. */
      (assertion) =>
        (query.occurredFromEpochMs === undefined ||
          assertion.occurredAtEpochMs >= query.occurredFromEpochMs) &&
        (query.occurredThroughEpochMs === undefined ||
          assertion.occurredAtEpochMs <= query.occurredThroughEpochMs)
    )
  ) return false;
  const keys = new Set(inventoryEventResourceKeys(event));
  if (!matchesResourceGroup(keys, query.itemIds, inventoryItemEventKey)) return false;
  if (!matchesResourceGroup(keys, query.itemRevisionIds, inventoryRevisionEventKey)) return false;
  if (!matchesResourceGroup(keys, query.serialIdentities, inventorySerialEventKey)) return false;
  if (!matchesResourceGroup(keys, query.lotIdentities, inventoryLotEventKey)) return false;
  if (!matchesResourceGroup(keys, query.placementNodeIds, inventoryPlacementEventKey)) return false;
  if (!matchesResourceGroup(keys, query.whereaboutsIds, inventoryWhereaboutsEventKey)) return false;
  return true;
}

/** Index keys grouped by independently intersected public query dimensions. */
export function inventoryEventQueryResourceKeyGroups(
  query: NormalizedInventoryEventQuery
): readonly ReadonlySet<string>[] {
  const groups: ReadonlySet<string>[] = [];
  pushResourceGroup(groups, query.itemIds, inventoryItemEventKey);
  pushResourceGroup(groups, query.itemRevisionIds, inventoryRevisionEventKey);
  pushResourceGroup(groups, query.serialIdentities, inventorySerialEventKey);
  pushResourceGroup(groups, query.lotIdentities, inventoryLotEventKey);
  pushResourceGroup(groups, query.placementNodeIds, inventoryPlacementEventKey);
  pushResourceGroup(groups, query.whereaboutsIds, inventoryWhereaboutsEventKey);
  return groups;
}

/** Exact stable resource keys touched by an event or embedded historical assertions. */
export function inventoryEventResourceKeys(
  event: InventoryEventDraft
): readonly string[] {
  const keys = new Set<string>(["event:" + event.eventId]);
  for (const assertion of event.historicalRepair?.assertions ?? []) {
    keys.add(inventoryAssertionEventKey(assertion.assertionId));
  }
  for (const assertionId of event.historicalRepair?.omittedAssertionIds ?? []) {
    keys.add(inventoryAssertionEventKey(assertionId));
  }
  for (const whereaboutsId of event.historicalImpact?.whereaboutsIds ?? []) {
    keys.add(inventoryWhereaboutsEventKey(whereaboutsId));
  }
  for (const assertion of inventoryEventEffectiveAssertions(event)) {
    collectOneEventResourceKeys(assertion, keys);
  }
  const result = [...keys];
  result.sort(compareInventoryIdentityText);
  return result;
}

/** Exact event kinds visible through public retained-history matching. */
export function inventoryEventEffectiveKinds(
  event: InventoryEventDraft
): readonly InventoryEventKind[] {
  const kinds = new Set<InventoryEventKind>();
  for (const assertion of inventoryEventEffectiveAssertions(event)) {
    kinds.add(assertion.kind);
  }
  return [...kinds].sort(compareInventoryIdentityText);
}

/** Envelope plus embedded ordinary assertions relevant to kind/time/resource matching. */
function inventoryEventEffectiveAssertions(
  event: InventoryEventDraft
): readonly InventoryEventDraft[] {
  return [
    event,
    ...(event.correctionReplacement === undefined ||
    event.correctionReplacement === null
      ? []
      : [event.correctionReplacement]),
    ...(event.historicalRepair?.assertions.map(
      /** Expose one embedded ordinary assertion to query matching. */
      (assertion) => assertion.event
    ) ?? []),
  ];
}

/** Add public resource-index keys for one stock position. */
function collectPositionResourceKeys(
  position: InventoryStockPositionKey,
  itemRevisionId: string,
  keys: Set<string>
): void {
  keys.add(inventoryItemEventKey(position.itemId));
  keys.add(inventoryRevisionEventKey(itemRevisionId));
  keys.add("position:" + inventoryStockPositionIdentity(position));
  if (position.serialId !== undefined) {
    keys.add(inventorySerialEventKey(inventorySerialIdentity(position.itemId, position.serialId)));
  }
  if (position.lotId !== undefined) {
    keys.add(inventoryLotEventKey(inventoryLotIdentity(position.itemId, position.lotId)));
  }
  if (position.placementNodeId !== undefined) keys.add(inventoryPlacementEventKey(position.placementNodeId));
  if (position.lastPlacementNodeId !== undefined) keys.add(inventoryPlacementEventKey(position.lastPlacementNodeId));
  if (position.whereaboutsId !== undefined) keys.add(inventoryWhereaboutsEventKey(position.whereaboutsId));
  if (position.transferId !== undefined) keys.add("transfer:" + position.transferId);
}

/** Collect one ordinary/envelope event's directly named resource identities. */
function collectOneEventResourceKeys(
  event: InventoryEventDraft,
  keys: Set<string>
): void {
  for (const effect of event.stockEffects) {
    collectPositionResourceKeys(effect.position, effect.itemRevisionId, keys);
  }
  for (const override of event.positiveLayerProvenanceOverrides ?? []) {
    collectPositionResourceKeys(
      override.position,
      override.position.itemRevisionId,
      keys
    );
  }
  if (event.transferLifecycle !== undefined) {
    keys.add("transfer:" + event.transferLifecycle.transferId);
  }
  for (const change of event.placementChanges ?? []) {
    keys.add(inventoryPlacementEventKey(change.nodeId));
    if (change.fromParentNodeId !== undefined) keys.add(inventoryPlacementEventKey(change.fromParentNodeId));
    if (change.toParentNodeId !== undefined) keys.add(inventoryPlacementEventKey(change.toParentNodeId));
  }
  for (const definition of event.placementNodeDefinitions ?? []) {
    keys.add(inventoryPlacementEventKey(definition.nodeId));
    if (definition.embodiedBy !== undefined) {
      keys.add(inventoryItemEventKey(definition.embodiedBy.itemId));
      keys.add(
        inventorySerialEventKey(
          inventorySerialIdentity(
            definition.embodiedBy.itemId,
            definition.embodiedBy.serialId
          )
        )
      );
    }
  }
  for (const definition of event.lotDefinitions ?? []) {
    keys.add(inventoryItemEventKey(definition.itemId));
    keys.add(inventoryLotEventKey(inventoryLotIdentity(definition.itemId, definition.lotId)));
  }
  for (const change of event.traceabilityChanges) {
    keys.add(
      "relation:" +
        inventoryTraceabilityRelationIdentity(change.kind, change.from, change.to)
    );
    keys.add("trace-node:" + JSON.stringify([change.from.kind, change.from.id]));
    keys.add("trace-node:" + JSON.stringify([change.to.kind, change.to.id]));
  }
  if (event.correction !== undefined) {
    keys.add("event:" + event.correction.correctsEventId);
  }
}

/** Narrow keys requested while expanding one historical dependency closure. */
export function inventoryEventDependencyKeys(
  event: InventoryEventDraft
): readonly string[] {
  return inventoryEventDependencyKeysForMode(event, "query");
}

/** Keys one retained event provides to the dependency index. */
export function inventoryEventDependencyIndexKeys(
  event: InventoryEventDraft
): readonly string[] {
  return inventoryEventDependencyKeysForMode(event, "index");
}

/** Keep stock-resource coupling narrow while joining referenced metadata/topology providers. */
function inventoryEventDependencyKeysForMode(
  event: InventoryEventDraft,
  mode: "query" | "index"
): readonly string[] {
  const keys = new Set<string>(["dep:event:" + event.eventId]);
  if (
    mode === "index" &&
    event.correctionReplacement !== undefined &&
    event.correctionReplacement !== null
  ) {
    keys.add("dep:event:" + event.correctionReplacement.eventId);
  }
  for (const assertion of event.historicalRepair?.assertions ?? []) {
    keys.add("dep:assertion:" + assertion.assertionId);
    if (mode === "index") {
      keys.add("dep:event:" + assertion.event.eventId);
    }
    if (assertion.afterEventId !== undefined) {
      // Consumers query the provider directly without indexing all siblings under dep:event:<anchor>,
      // while anchor deletions/omissions query dep:anchored-to:<anchor> explicitly.
      keys.add((mode === "index" ? "dep:anchored-to:" : "dep:event:") + assertion.afterEventId);
    }
  }
  for (const assertionId of event.historicalRepair?.omittedAssertionIds ?? []) {
    keys.add("dep:assertion:" + assertionId);
  }
  if (mode === "index") {
    for (const whereaboutsId of event.historicalImpact?.whereaboutsIds ?? []) {
      keys.add("dep:whereabouts:" + whereaboutsId);
    }
  }
  for (const assertion of inventoryEventEffectiveAssertions(event)) {
    for (const effect of assertion.stockEffects) {
      addInventoryStockPositionDependencyKeys(
        keys,
        effect.itemRevisionId,
        effect.position,
        mode
      );
    }
    if (mode === "index") {
      for (const transfer of assertion.positiveLayerProvenanceTransfers ?? []) {
        if (transfer.from.whereaboutsId !== undefined) {
          keys.add("dep:whereabouts:" + transfer.from.whereaboutsId);
        }
        if (transfer.to.whereaboutsId !== undefined) {
          keys.add("dep:whereabouts:" + transfer.to.whereaboutsId);
        }
      }
    }
    for (const override of assertion.positiveLayerProvenanceOverrides ?? []) {
      addInventoryStockPositionDependencyKeys(
        keys,
        override.position.itemRevisionId,
        override.position,
        mode
      );
    }
    if (assertion.transferLifecycle !== undefined) {
      keys.add("dep:transfer:" + assertion.transferLifecycle.transferId);
    }
    for (const change of assertion.placementChanges ?? []) {
      keys.add("dep:placement-edge:" + change.nodeId);
      keys.add("dep:placement-definition:" + change.nodeId);
      if (change.fromParentNodeId !== undefined) {
        keys.add("dep:placement-definition:" + change.fromParentNodeId);
        if (mode === "index") {
          keys.add("dep:placement-contents:" + change.fromParentNodeId);
        }
      }
      if (change.toParentNodeId !== undefined) {
        keys.add("dep:placement-definition:" + change.toParentNodeId);
        if (mode === "index") {
          keys.add("dep:placement-contents:" + change.toParentNodeId);
        }
      }
    }
    for (const definition of assertion.placementNodeDefinitions ?? []) {
      keys.add("dep:placement-definition:" + definition.nodeId);
      if (mode === "query") {
        keys.add("dep:placement-contents:" + definition.nodeId);
      }
      if (definition.embodiedBy !== undefined) {
        keys.add(
          "dep:serial:" +
            inventorySerialIdentity(
              definition.embodiedBy.itemId,
              definition.embodiedBy.serialId
            )
        );
      }
    }
    for (const definition of assertion.lotDefinitions ?? []) {
      keys.add(
        "dep:lot-definition:" +
          inventoryLotIdentity(definition.itemId, definition.lotId)
      );
    }
    for (const change of assertion.traceabilityChanges) {
      keys.add(
        "dep:relation:" +
          inventoryTraceabilityRelationIdentity(change.kind, change.from, change.to)
      );
      keys.add(
        "dep:trace-node:" + JSON.stringify([change.from.kind, change.from.id])
      );
      keys.add(
        "dep:trace-node:" + JSON.stringify([change.to.kind, change.to.id])
      );
    }
    if (assertion.correction !== undefined) {
      keys.add("dep:event:" + assertion.correction.correctsEventId);
    }
  }
  const result = [...keys];
  result.sort(compareInventoryIdentityText);
  return result;
}

/** Add dependency keys shared by stock effects and positive-layer provenance overrides. */
function addInventoryStockPositionDependencyKeys(
  keys: Set<string>,
  itemRevisionId: string,
  position: InventoryStockPositionKey,
  mode: "query" | "index"
): void {
  keys.add("dep:position:" + inventoryStockPositionIdentity(position));
  if (position.serialId !== undefined) {
    keys.add(
      "dep:serial:" +
        inventorySerialIdentity(position.itemId, position.serialId)
    );
  } else {
    keys.add(
      "dep:pool:" +
        JSON.stringify([
          itemRevisionId,
          position.placementNodeId ?? null,
          position.whereaboutsId ?? null,
        ])
    );
    if (position.lotId !== undefined) {
      keys.add(
        "dep:lot-stock:" +
          inventoryLotIdentity(position.itemId, position.lotId)
      );
    }
  }
  if (position.placementNodeId !== undefined && mode === "index") {
    keys.add("dep:placement-contents:" + position.placementNodeId);
  }
  if (mode === "query") {
    if (position.lotId !== undefined) {
      keys.add(
        "dep:lot-definition:" +
          inventoryLotIdentity(position.itemId, position.lotId)
      );
    }
    if (position.placementNodeId !== undefined) {
      keys.add("dep:placement-definition:" + position.placementNodeId);
    }
    if (position.lastPlacementNodeId !== undefined) {
      keys.add("dep:placement-definition:" + position.lastPlacementNodeId);
    }
  }
  if (position.whereaboutsId !== undefined) {
    keys.add("dep:whereabouts:" + position.whereaboutsId);
  }
  if (position.transferId !== undefined) {
    keys.add("dep:transfer:" + position.transferId);
  }
}

/** Build one item resource-index key. */
export const inventoryItemEventKey = (value: string): string => "item:" + value;
/** Build one item-revision resource-index key. */
export const inventoryRevisionEventKey = (value: string): string => "revision:" + value;
/** Build one item-scoped serial resource-index key. */
export const inventorySerialEventKey = (value: string): string => "serial:" + value;
/** Build one item-scoped lot resource-index key. */
export const inventoryLotEventKey = (value: string): string => "lot:" + value;
/** Build one placement-node resource-index key. */
export const inventoryPlacementEventKey = (value: string): string => "placement:" + value;
/** Build one whereabouts-cohort resource-index key. */
export const inventoryWhereaboutsEventKey = (value: string): string => "whereabouts:" + value;
/** Build one embedded historical-assertion resource-index key. */
export const inventoryAssertionEventKey = (value: string): string => "assertion:" + value;

/** Inputs whose semantic identity is frozen into one continuation cursor. */
interface InventoryEventQueryFingerprintInput {
  /** Normalized stable item filters. */
  readonly itemIds: ReadonlySet<string> | undefined;
  /** Normalized immutable item-revision filters. */
  readonly itemRevisionIds: ReadonlySet<string> | undefined;
  /** Normalized item-scoped serial filters. */
  readonly serialIdentities: ReadonlySet<string> | undefined;
  /** Normalized item-scoped lot filters. */
  readonly lotIdentities: ReadonlySet<string> | undefined;
  /** Normalized placement-node filters. */
  readonly placementNodeIds: ReadonlySet<string> | undefined;
  /** Normalized whereabouts-cohort filters. */
  readonly whereaboutsIds: ReadonlySet<string> | undefined;
  /** Normalized retained or embedded event-kind filters. */
  readonly kinds: ReadonlySet<InventoryEventKind> | undefined;
  /** Normalized correction-root filters. */
  readonly correctsEventIds: ReadonlySet<string> | undefined;
  /** Inclusive physical-time lower bound. */
  readonly occurredFromEpochMs: number | undefined;
  /** Inclusive physical-time upper bound. */
  readonly occurredThroughEpochMs: number | undefined;
  /** Inclusive durable-record-time lower bound. */
  readonly recordedFromEpochMs: number | undefined;
  /** Inclusive durable-record-time upper bound. */
  readonly recordedThroughEpochMs: number | undefined;
  /** Inclusive durable-sequence lower bound. */
  readonly recordSequenceFrom: number;
  /** Inclusive durable-sequence upper bound. */
  readonly recordSequenceThrough: number | undefined;
  /** Durable traversal direction frozen into the cursor. */
  readonly direction: InventoryEventQueryDirection;
}

/** Normalize one optional traversal direction. */
function normalizeEventQueryDirection(
  value: InventoryEventQueryDirection | undefined
): InventoryEventQueryDirection {
  if (value === undefined) return InventoryEventQueryDirection.Ascending;
  if (
    value !== InventoryEventQueryDirection.Ascending &&
    value !== InventoryEventQueryDirection.Descending
  ) {
    throw new Error(`Event query contains unknown direction '${String(value)}'.`);
  }
  return value;
}

/** Freeze every filter/range/order field except page size into one stable digest. */
function inventoryEventQueryFingerprint(
  input: InventoryEventQueryFingerprintInput
): string {
  return inventoryIntentFingerprint([
    "inventory-event-query-cursor-v1",
    input.direction,
    sortedEventQueryValues(input.itemIds),
    sortedEventQueryValues(input.itemRevisionIds),
    sortedEventQueryValues(input.serialIdentities),
    sortedEventQueryValues(input.lotIdentities),
    sortedEventQueryValues(input.placementNodeIds),
    sortedEventQueryValues(input.whereaboutsIds),
    sortedEventQueryValues(input.kinds),
    sortedEventQueryValues(input.correctsEventIds),
    input.occurredFromEpochMs ?? null,
    input.occurredThroughEpochMs ?? null,
    input.recordedFromEpochMs ?? null,
    input.recordedThroughEpochMs ?? null,
    input.recordSequenceFrom,
    input.recordSequenceThrough ?? null,
  ]);
}

/** Canonicalize one optional query set for cursor intent hashing. */
function sortedEventQueryValues<T extends string>(
  values: ReadonlySet<T> | undefined
): readonly string[] | null {
  if (values === undefined) return null;
  return [...values].sort(compareInventoryIdentityText);
}

/** Encode one validated stable page cursor without adapter-specific state. */
function encodeInventoryEventCursor(payload: InventoryEventCursorPayload): string {
  return inventoryEventCursorPrefix + encodeURIComponent(JSON.stringify(payload));
}

/** Decode and validate one opaque public continuation cursor. */
function decodeInventoryEventCursor(cursor: string): InventoryEventCursorPayload {
  if (!cursor.startsWith(inventoryEventCursorPrefix)) {
    throw new Error("Event query cursor is invalid.");
  }
  try {
    const value = JSON.parse(
      decodeURIComponent(cursor.slice(inventoryEventCursorPrefix.length))
    ) as Partial<InventoryEventCursorPayload>;
    if (
      value.version !== 1 ||
      (value.direction !== InventoryEventQueryDirection.Ascending &&
        value.direction !== InventoryEventQueryDirection.Descending) ||
      !Number.isSafeInteger(value.boundary) ||
      (value.boundary ?? -1) < 0 ||
      !Number.isSafeInteger(value.throughRecordSequence) ||
      (value.throughRecordSequence ?? -1) < 0 ||
      (value.boundary ?? 0) > (value.throughRecordSequence ?? -1) ||
      typeof value.fingerprint !== "string" ||
      value.fingerprint.length === 0
    ) {
      throw new Error("invalid cursor fields");
    }
    return value as InventoryEventCursorPayload;
  } catch {
    throw new Error("Event query cursor is invalid.");
  }
}

/** Validate one optional identity set. */
function normalizeIdentitySet(
  values: readonly string[] | undefined,
  label: string
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0) throw new Error(label + " filter must be omitted instead of empty.");
  const result = new Set<string>();
  for (const value of values) {
    assertInventoryIdentity(value, label);
    result.add(value);
  }
  return result;
}

/** Normalize item-scoped serial references to collision-free identities. */
function normalizeSerialRefs(
  refs: readonly InventoryEventSerialRef[] | undefined
): ReadonlySet<string> | undefined {
  if (refs === undefined) return undefined;
  if (refs.length === 0) throw new Error("Event query serials must be omitted instead of empty.");
  const result = new Set<string>();
  for (const ref of refs) result.add(inventorySerialIdentity(ref.itemId, ref.serialId));
  return result;
}

/** Normalize item-scoped lot references to collision-free identities. */
function normalizeLotRefs(
  refs: readonly InventoryEventLotRef[] | undefined
): ReadonlySet<string> | undefined {
  if (refs === undefined) return undefined;
  if (refs.length === 0) throw new Error("Event query lots must be omitted instead of empty.");
  const result = new Set<string>();
  for (const ref of refs) result.add(inventoryLotIdentity(ref.itemId, ref.lotId));
  return result;
}

/** Normalize the closed event-kind set. */
function normalizeEventKinds(
  values: readonly InventoryEventKind[] | undefined
): ReadonlySet<InventoryEventKind> | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0) throw new Error("Event query kinds must be omitted instead of empty.");
  const supported = new Set(Object.values(InventoryEventKind));
  const result = new Set<InventoryEventKind>();
  for (const value of values) {
    if (!supported.has(value)) throw new Error(`Event query contains unknown kind '${String(value)}'.`);
    result.add(value);
  }
  return result;
}

/** Validate one optional epoch. */
function normalizeOptionalEventEpoch(value: number | undefined, label: string): number | undefined {
  if (value !== undefined) assertInventoryEpochMilliseconds(value, label);
  return value;
}

/** Validate one optional non-negative durable sequence. */
function normalizeOptionalEventSequence(value: number | undefined, label: string): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(label + " must be a non-negative safe integer.");
  }
  return value;
}

/** Check one optional indexed query group. */
function matchesResourceGroup(
  eventKeys: ReadonlySet<string>,
  values: ReadonlySet<string> | undefined,
  key: (value: string) => string
): boolean {
  if (values === undefined) return true;
  for (const value of values) if (eventKeys.has(key(value))) return true;
  return false;
}

/** Add one independently intersected key group. */
function pushResourceGroup(
  groups: ReadonlySet<string>[],
  values: ReadonlySet<string> | undefined,
  key: (value: string) => string
): void {
  if (values === undefined) return;
  groups.push(new Set([...values].map(key)));
}
