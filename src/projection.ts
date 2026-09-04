import { inventoryMetadataFingerprint } from "./canonical.js";
import type { InventoryCatalog } from "./catalog.js";
import {
  InventoryEventKind,
  commitInventoryEvent,
  defineInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
} from "./events.js";
import {
  addInventoryMeasurements,
  assertInventoryMeasurementsFollowPrimarySign,
  inventoryMeasurementsAreZero,
  nonNegativeInventoryMeasurements,
  zeroInventoryMeasurements,
} from "./measurements.js";
import {
  inventoryContainerIdentity,
  inventoryLotIdentity,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  type InventoryContainerDefinition,
  type InventoryLotDefinition,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
} from "./model.js";
import {
  compareQuantity,
  parseQuantity,
  quantityEq,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  inventoryStockPositionMatchesNormalizedSelector,
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  applyInventoryTraceabilityChanges,
  emptyInventoryTraceabilityState,
  type InventoryTraceabilityState,
} from "./traceability.js";
import { projectInventoryTraceabilityEvents } from "./traceability-replay.js";
import {
  applyInventoryTransferLifecycleEvent,
  type InventoryTransfer,
} from "./transfers.js";

/** Whether one operation may explicitly record that physical reality outran bookkeeping. */
export enum InventoryDeficitPolicy {
  /** Reject an event that would make any exact stock position negative. */
  Reject = "reject",
  /** Keep an explicit coherent negative position until a later reconciliation repairs it. */
  Record = "record",
}

/** Current handling-unit metadata plus the retained root assertion that owns it. */
export interface InventoryProjectedContainerDefinition {
  /** Current exact container metadata/use-by assertion. */
  readonly definition: InventoryContainerDefinition;
  /** Retained non-correction event that first established this container master. */
  readonly rootEventId: string;
  /** Latest event that established/corrected the current metadata value. */
  readonly assertedByEventId: string;
}

/** Current lot/batch metadata plus the retained root event whose assertion may be corrected. */
export interface InventoryProjectedLotDefinition {
  /** Current lot metadata assertion. */
  readonly definition: InventoryLotDefinition;
  /** Retained non-correction event that originally established this current lot master. */
  readonly rootEventId: string;
  /** Latest event that established/corrected the current metadata value. */
  readonly assertedByEventId: string;
}

/** Immutable event stream plus current rebuildable stock/traceability projection. */
export interface InventoryProjectionState {
  /** Current non-zero stock positions keyed by deterministic position identity. */
  readonly positions: Readonly<Record<string, InventoryStockPosition>>;
  /** Exact current position identities grouped by stable item identity for item-local reads. */
  readonly positionIdsByItemId: Readonly<Record<string, readonly string[]>>;
  /** Exact current position identities grouped by immutable item revision. */
  readonly positionIdsByItemRevisionId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Exact current position identities grouped by exact handling-unit identity. */
  readonly positionIdsByContainerIdentity: Readonly<
    Record<string, readonly string[]>
  >;
  /** Current uninterrupted positive-layer occurrence time by exact position identity. */
  readonly positiveLayerStartedAtByPositionId: Readonly<Record<string, string>>;
  /** Current positive exact position by item-scoped serial identity. */
  readonly positivePositionIdBySerialIdentity: Readonly<Record<string, string>>;
  /** Current handling-unit metadata keyed by exact container identity. */
  readonly containers: Readonly<
    Record<string, InventoryProjectedContainerDefinition>
  >;
  /** First retained root event that owns each container master identity. */
  readonly containerRootEventIdByIdentity: Readonly<Record<string, string>>;
  /** Current item-scoped lot metadata keyed by deterministic lot identity. */
  readonly lots: Readonly<Record<string, InventoryProjectedLotDefinition>>;
  /** Current lot identities grouped by item id for item-local metadata reads. */
  readonly lotIdentitiesByItemId: Readonly<Record<string, readonly string[]>>;
  /** First retained root event that owns each item-scoped lot master identity. */
  readonly lotRootEventIdByIdentity: Readonly<Record<string, string>>;
  /** First-class physical transfer lifecycle truth keyed by stable transfer identity. */
  readonly transfers: Readonly<Record<string, InventoryTransfer>>;
  /** Every committed event keyed by stable event id. */
  readonly events: Readonly<Record<string, InventoryCommittedEvent>>;
  /** Durable sequence -> event id index used by snapshot/replay/count semantics. */
  readonly eventIdsBySequence: Readonly<Record<string, string>>;
  /** Operation id -> committed event id index for exact retry semantics. */
  readonly eventIdByOperationId: Readonly<Record<string, string>>;
  /** Corrected event id -> one current direct correction event id. */
  readonly correctionEventIdByCorrectedEventId: Readonly<
    Record<string, string>
  >;
  /** Current containment/association plus append-only genealogy graph. */
  readonly traceability: InventoryTraceabilityState;
  /** Highest applied durable sequence; zero means no events. */
  readonly lastRecordSequence: number;
}

/** Inputs for applying/replaying one committed event. */
export interface ApplyInventoryCommittedEventInput {
  /** Frozen catalogue needed to validate every event reference. */
  readonly catalog: InventoryCatalog;
  /** Current projection before this event. */
  readonly state: InventoryProjectionState;
  /** Event with durable record time/order already assigned. */
  readonly event: InventoryCommittedEvent;
  /** Explicit negative-stock rule. */
  readonly deficitPolicy: InventoryDeficitPolicy;
}

/** Result of applying/replaying one committed event. */
export interface ApplyInventoryCommittedEventResult {
  /** Next projection; unchanged on an exact replay. */
  readonly state: InventoryProjectionState;
  /** Stored event (the earlier event on replay). */
  readonly event: InventoryCommittedEvent;
  /** True when this exact operation intent was already committed. */
  readonly replayed: boolean;
}

/** Inputs for replaying a whole event stream. */
export interface ProjectInventoryEventsInput {
  /** Frozen catalogue used by every event. */
  readonly catalog: InventoryCatalog;
  /** Events in any order; projection sorts by durable sequence. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Explicit negative-stock rule. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Optional inclusive durable sequence for historical snapshot projection. */
  readonly throughRecordSequence?: number;
}

/** Create an empty projection with no hidden initial stock. */
export function emptyInventoryProjectionState(): InventoryProjectionState {
  return {
    positions: {},
    positionIdsByItemId: {},
    positionIdsByItemRevisionId: {},
    positionIdsByContainerIdentity: {},
    positiveLayerStartedAtByPositionId: {},
    positivePositionIdBySerialIdentity: {},
    containers: {},
    containerRootEventIdByIdentity: {},
    lots: {},
    lotIdentitiesByItemId: {},
    lotRootEventIdByIdentity: {},
    transfers: {},
    events: {},
    eventIdsBySequence: {},
    eventIdByOperationId: {},
    correctionEventIdByCorrectedEventId: {},
    traceability: emptyInventoryTraceabilityState(),
    lastRecordSequence: 0,
  };
}

/** Apply one committed event atomically without mutating the caller-owned projection. */
export function applyInventoryCommittedEvent(
  input: ApplyInventoryCommittedEventInput
): ApplyInventoryCommittedEventResult {
  return applyInventoryCommittedEventInternal(input, false, true);
}

/**
 * Shared reducer. Whole-history replay owns a fresh private projection and may mutate its maps
 * to avoid cloning every growing index once per event; live commits always use copy-on-write.
 */
function applyInventoryCommittedEventInternal(
  { catalog, state, event, deficitPolicy }: ApplyInventoryCommittedEventInput,
  mutateProjection: boolean,
  projectTraceability: boolean
): ApplyInventoryCommittedEventResult {
  const normalizedDraft = defineInventoryEvent({ catalog, event });
  const normalizedEvent = commitInventoryEvent(
    normalizedDraft,
    event.recordedAt,
    event.recordSequence
  );
  const earlierEventId =
    state.eventIdByOperationId[normalizedEvent.operationId];
  if (earlierEventId !== undefined) {
    const earlier = state.events[earlierEventId];
    if (earlier === undefined) {
      throw new Error("Inventory operation index references a missing event.");
    }
    if (
      inventoryEventIntentFingerprint(earlier) !==
      inventoryEventIntentFingerprint(normalizedEvent)
    ) {
      throw new Error("Inventory operationId was retried with changed intent.");
    }
    return { state, event: earlier, replayed: true };
  }
  const sameEventId = state.events[normalizedEvent.eventId];
  if (sameEventId !== undefined) {
    if (
      inventoryEventIntentFingerprint(sameEventId) !==
      inventoryEventIntentFingerprint(normalizedEvent)
    ) {
      throw new Error("Inventory eventId was reused with changed intent.");
    }
    throw new Error(
      "Inventory eventId already exists under another operationId."
    );
  }
  if (normalizedEvent.recordSequence !== state.lastRecordSequence + 1) {
    throw new Error(
      `Inventory recordSequence must be ${state.lastRecordSequence + 1}, not ${
        normalizedEvent.recordSequence
      }.`
    );
  }
  if (
    state.eventIdsBySequence[String(normalizedEvent.recordSequence)] !==
    undefined
  ) {
    throw new Error(
      `Inventory recordSequence ${normalizedEvent.recordSequence} already exists.`
    );
  }
  const correctionEventIdByCorrectedEventId: Record<string, string> =
    mutateProjection
      ? (state.correctionEventIdByCorrectedEventId as Record<string, string>)
      : { ...state.correctionEventIdByCorrectedEventId };
  if (normalizedEvent.correction !== undefined) {
    const correctedEventId = normalizedEvent.correction.correctsEventId;
    const correctedEvent = state.events[correctedEventId];
    if (correctedEvent === undefined) {
      throw new Error(
        `Correction target event '${correctedEventId}' does not exist.`
      );
    }
    if (correctedEvent.kind === InventoryEventKind.Correction) {
      throw new Error(
        "Correction must name the retained root event, not a correction event."
      );
    }
    const currentCorrectionEventId =
      correctionEventIdByCorrectedEventId[correctedEventId];
    const supersedesCorrectionEventId =
      normalizedEvent.correction.supersedesCorrectionEventId;
    if (currentCorrectionEventId === undefined) {
      if (supersedesCorrectionEventId !== undefined) {
        throw new Error(
          "First correction cannot supersede a missing correction event."
        );
      }
    } else if (supersedesCorrectionEventId !== currentCorrectionEventId) {
      throw new Error(
        `Correction must supersede current correction '${currentCorrectionEventId}'.`
      );
    }
    correctionEventIdByCorrectedEventId[correctedEventId] =
      normalizedEvent.eventId;
  }

  /** Copy used while deriving the next all-or-nothing container-metadata projection. */
  const containers: Record<string, InventoryProjectedContainerDefinition> =
    mutateProjection
      ? (state.containers as Record<
          string,
          InventoryProjectedContainerDefinition
        >)
      : { ...state.containers };
  /** Retained root ownership survives when one correction temporarily omits the container master. */
  const containerRootEventIdByIdentity: Record<string, string> =
    mutateProjection
      ? (state.containerRootEventIdByIdentity as Record<string, string>)
      : { ...state.containerRootEventIdByIdentity };
  const correctedContainerRootEventId =
    normalizedEvent.correction?.correctsEventId;
  const replacementContainerIdentities = new Set<string>();
  for (const definition of normalizedEvent.containerDefinitions ?? []) {
    replacementContainerIdentities.add(
      inventoryContainerIdentity(definition.containerId)
    );
  }
  if (correctedContainerRootEventId !== undefined) {
    for (const [identity, projected] of Object.entries(containers)) {
      if (
        projected.rootEventId === correctedContainerRootEventId &&
        !replacementContainerIdentities.has(identity)
      ) {
        delete containers[identity];
      }
    }
  }
  for (const definition of normalizedEvent.containerDefinitions ?? []) {
    const identity = inventoryContainerIdentity(definition.containerId);
    const rootEventId =
      correctedContainerRootEventId ?? normalizedEvent.eventId;
    const existingRootEventId = containerRootEventIdByIdentity[identity];
    const current = containers[identity];
    if (existingRootEventId === undefined) {
      containerRootEventIdByIdentity[identity] = rootEventId;
      containers[identity] = {
        definition,
        rootEventId,
        assertedByEventId: normalizedEvent.eventId,
      };
      continue;
    }
    const sameDefinition =
      current !== undefined &&
      inventoryContainerDefinitionFingerprint(current.definition) ===
        inventoryContainerDefinitionFingerprint(definition);
    if (correctedContainerRootEventId === undefined) {
      if (current === undefined) {
        throw new Error(
          `Inventory container ${identity} was removed by correction; correct its retained root to restore it.`
        );
      }
      if (!sameDefinition) {
        throw new Error(
          `Inventory container ${identity} already has different metadata; correct retained root '${existingRootEventId}'.`
        );
      }
      continue;
    }
    if (existingRootEventId !== correctedContainerRootEventId) {
      if (!sameDefinition) {
        throw new Error(
          `Inventory container ${identity} belongs to retained root '${existingRootEventId}', not '${correctedContainerRootEventId}'.`
        );
      }
      continue;
    }
    containers[identity] = {
      definition,
      rootEventId: existingRootEventId,
      assertedByEventId: normalizedEvent.eventId,
    };
  }

  /** Copy used while deriving the next all-or-nothing lot-metadata projection. */
  const lots: Record<string, InventoryProjectedLotDefinition> = mutateProjection
    ? (state.lots as Record<string, InventoryProjectedLotDefinition>)
    : { ...state.lots };
  /** Item -> current lot identities index supports item-local lot reads without a global scan. */
  const lotIdentitiesByItemId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.lotIdentitiesByItemId as Record<string, readonly string[]>)
      : { ...state.lotIdentitiesByItemId };
  /** One desired final membership per touched item lot-index row. */
  const lotIndexMutations = new Map<string, Map<string, boolean>>();
  /** Retained root ownership survives even when one correction temporarily omits the lot master. */
  const lotRootEventIdByIdentity: Record<string, string> = mutateProjection
    ? (state.lotRootEventIdByIdentity as Record<string, string>)
    : { ...state.lotRootEventIdByIdentity };
  const correctedRootEventId = normalizedEvent.correction?.correctsEventId;
  const replacementLotIdentities = new Set<string>();
  for (const definition of normalizedEvent.lotDefinitions ?? []) {
    replacementLotIdentities.add(
      inventoryLotIdentity(definition.itemId, definition.lotId)
    );
  }
  if (correctedRootEventId !== undefined) {
    for (const [identity, projected] of Object.entries(lots)) {
      if (
        projected.rootEventId === correctedRootEventId &&
        !replacementLotIdentities.has(identity)
      ) {
        delete lots[identity];
        recordIndexedIdentityMutation(
          lotIndexMutations,
          projected.definition.itemId,
          identity,
          false
        );
      }
    }
  }
  for (const definition of normalizedEvent.lotDefinitions ?? []) {
    const identity = inventoryLotIdentity(definition.itemId, definition.lotId);
    const rootEventId = correctedRootEventId ?? normalizedEvent.eventId;
    const existingRootEventId = lotRootEventIdByIdentity[identity];
    const current = lots[identity];
    if (existingRootEventId === undefined) {
      lotRootEventIdByIdentity[identity] = rootEventId;
      lots[identity] = {
        definition,
        rootEventId,
        assertedByEventId: normalizedEvent.eventId,
      };
      recordIndexedIdentityMutation(
        lotIndexMutations,
        definition.itemId,
        identity,
        true
      );
      continue;
    }
    const sameDefinition =
      current !== undefined &&
      inventoryLotDefinitionFingerprint(current.definition) ===
        inventoryLotDefinitionFingerprint(definition);
    if (correctedRootEventId === undefined) {
      if (current === undefined) {
        throw new Error(
          `Inventory lot ${identity} was removed by correction; correct its retained root to restore it.`
        );
      }
      if (!sameDefinition) {
        throw new Error(
          `Inventory lot ${identity} already has different metadata; correct retained root '${existingRootEventId}'.`
        );
      }
      continue;
    }
    if (existingRootEventId !== correctedRootEventId) {
      if (!sameDefinition) {
        throw new Error(
          `Inventory lot ${identity} belongs to retained root '${existingRootEventId}', not '${correctedRootEventId}'.`
        );
      }
      continue;
    }
    lots[identity] = {
      definition,
      rootEventId: existingRootEventId,
      assertedByEventId: normalizedEvent.eventId,
    };
    recordIndexedIdentityMutation(
      lotIndexMutations,
      definition.itemId,
      identity,
      true
    );
  }
  applyIndexedIdentityMutations(lotIdentitiesByItemId, lotIndexMutations);

  /** Structured transfer truth is rebuilt from the same immutable event before publication. */
  const transfers = applyInventoryTransferLifecycleEvent(
    state.transfers,
    state.positions,
    normalizedEvent
  );

  /** Copy used while deriving the next all-or-nothing stock projection. */
  const positions: Record<string, InventoryStockPosition> = mutateProjection
    ? (state.positions as Record<string, InventoryStockPosition>)
    : { ...state.positions };
  /** Copy-on-write item indexes avoid scanning unrelated inventory on normal reads. */
  const positionIdsByItemId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByItemId as Record<string, readonly string[]>)
      : { ...state.positionIdsByItemId };
  /** Copy-on-write revision indexes support revisioned collections and summaries. */
  const positionIdsByItemRevisionId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByItemRevisionId as Record<string, readonly string[]>)
      : { ...state.positionIdsByItemRevisionId };
  /** Copy-on-write handling-unit index supports whole-container operations across item types. */
  const positionIdsByContainerIdentity: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByContainerIdentity as Record<
          string,
          readonly string[]
        >)
      : { ...state.positionIdsByContainerIdentity };
  /** One desired final membership per touched item index row; applied once after all effects. */
  const itemIndexMutations = new Map<string, Map<string, boolean>>();
  /** One desired final membership per touched revision index row. */
  const revisionIndexMutations = new Map<string, Map<string, boolean>>();
  /** One desired final membership per touched container index row. */
  const containerIndexMutations = new Map<string, Map<string, boolean>>();
  /** O(1) FIFO provenance for each current uninterrupted positive layer. */
  const positiveLayerStartedAtByPositionId: Record<string, string> =
    mutateProjection
      ? (state.positiveLayerStartedAtByPositionId as Record<string, string>)
      : { ...state.positiveLayerStartedAtByPositionId };
  /** Current serial ownership index updated only for serials touched by this event. */
  const positivePositionIdBySerialIdentity: Record<string, string> =
    mutateProjection
      ? (state.positivePositionIdBySerialIdentity as Record<string, string>)
      : { ...state.positivePositionIdBySerialIdentity };
  const touchedPositionIdsBySerialIdentity = new Map<string, Set<string>>();
  /** Conserved moves carry the oldest current source/destination layer into the destination. */
  const conservedPositiveLayerStartByDestinationId =
    captureConservedPositiveLayerStarts(state, normalizedEvent);
  for (const effect of normalizedEvent.stockEffects) {
    const identity = inventoryStockPositionIdentity(effect.position);
    const earlier = positions[identity];
    const current =
      earlier?.measurements ??
      zeroInventoryMeasurements(effect.measurementsDelta);
    const next = addInventoryMeasurements(current, effect.measurementsDelta);
    assertInventoryMeasurementsFollowPrimarySign(
      next,
      `Stock position ${identity}`
    );
    if (deficitPolicy === InventoryDeficitPolicy.Reject) {
      nonNegativeInventoryMeasurements(next, `Stock position ${identity}`);
    }
    const wasPositive = quantityIsPositive(current.primary.quantity);
    const isPositive = quantityIsPositive(next.primary.quantity);
    if (inventoryMeasurementsAreZero(next)) {
      delete positions[identity];
      recordIndexedIdentityMutation(
        itemIndexMutations,
        effect.position.itemId,
        identity,
        false
      );
      recordIndexedIdentityMutation(
        revisionIndexMutations,
        effect.position.itemRevisionId,
        identity,
        false
      );
      if (effect.position.containerId !== undefined) {
        recordIndexedIdentityMutation(
          containerIndexMutations,
          inventoryContainerIdentity(effect.position.containerId),
          identity,
          false
        );
      }
    } else {
      positions[identity] = { key: effect.position, measurements: next };
      if (earlier === undefined) {
        recordIndexedIdentityMutation(
          itemIndexMutations,
          effect.position.itemId,
          identity,
          true
        );
        recordIndexedIdentityMutation(
          revisionIndexMutations,
          effect.position.itemRevisionId,
          identity,
          true
        );
        if (effect.position.containerId !== undefined) {
          recordIndexedIdentityMutation(
            containerIndexMutations,
            inventoryContainerIdentity(effect.position.containerId),
            identity,
            true
          );
        }
      }
    }
    if (!wasPositive && isPositive) {
      positiveLayerStartedAtByPositionId[identity] = normalizedEvent.occurredAt;
    } else if (wasPositive && !isPositive) {
      delete positiveLayerStartedAtByPositionId[identity];
    }
    registerTouchedSerialPosition(
      touchedPositionIdsBySerialIdentity,
      positivePositionIdBySerialIdentity,
      effect.position,
      identity
    );
  }
  applyIndexedIdentityMutations(positionIdsByItemId, itemIndexMutations);
  applyIndexedIdentityMutations(
    positionIdsByItemRevisionId,
    revisionIndexMutations
  );
  applyIndexedIdentityMutations(
    positionIdsByContainerIdentity,
    containerIndexMutations
  );
  for (const [
    identity,
    startedAt,
  ] of conservedPositiveLayerStartByDestinationId) {
    const position = positions[identity];
    if (
      position === undefined ||
      !quantityIsPositive(position.measurements.primary.quantity)
    ) {
      throw new Error(
        `Conserved FIFO provenance destination ${identity} is not positive after its event.`
      );
    }
    positiveLayerStartedAtByPositionId[identity] = startedAt;
  }
  for (const override of normalizedEvent.positiveLayerProvenanceOverrides ??
    []) {
    const identity = inventoryStockPositionIdentity(override.position);
    const position = positions[identity];
    if (override.startedAt === undefined) {
      if (
        position !== undefined &&
        quantityIsPositive(position.measurements.primary.quantity)
      ) {
        throw new Error(
          `Correction cannot remove positive-layer provenance from positive position ${identity}.`
        );
      }
      delete positiveLayerStartedAtByPositionId[identity];
      continue;
    }
    if (
      position === undefined ||
      !quantityIsPositive(position.measurements.primary.quantity)
    ) {
      throw new Error(
        `Correction cannot assign positive-layer provenance to non-positive position ${identity}.`
      );
    }
    positiveLayerStartedAtByPositionId[identity] = override.startedAt;
  }
  refreshTouchedSerialIndexes({
    positions,
    touchedPositionIdsBySerialIdentity,
    positivePositionIdBySerialIdentity,
  });
  const traceability = projectTraceability
    ? applyInventoryTraceabilityChanges({
        state: state.traceability,
        eventId: normalizedEvent.eventId,
        changes: normalizedEvent.traceabilityChanges,
      })
    : state.traceability;
  const events: Record<string, InventoryCommittedEvent> = mutateProjection
    ? (state.events as Record<string, InventoryCommittedEvent>)
    : { ...state.events };
  const eventIdsBySequence: Record<string, string> = mutateProjection
    ? (state.eventIdsBySequence as Record<string, string>)
    : { ...state.eventIdsBySequence };
  const eventIdByOperationId: Record<string, string> = mutateProjection
    ? (state.eventIdByOperationId as Record<string, string>)
    : { ...state.eventIdByOperationId };
  events[normalizedEvent.eventId] = normalizedEvent;
  eventIdsBySequence[String(normalizedEvent.recordSequence)] =
    normalizedEvent.eventId;
  eventIdByOperationId[normalizedEvent.operationId] = normalizedEvent.eventId;

  return {
    event: normalizedEvent,
    replayed: false,
    state: {
      positions,
      positionIdsByItemId,
      positionIdsByItemRevisionId,
      positionIdsByContainerIdentity,
      positiveLayerStartedAtByPositionId,
      positivePositionIdBySerialIdentity,
      containers,
      containerRootEventIdByIdentity,
      lots,
      lotIdentitiesByItemId,
      lotRootEventIdByIdentity,
      transfers,
      events,
      eventIdsBySequence,
      eventIdByOperationId,
      correctionEventIdByCorrectedEventId,
      traceability,
      lastRecordSequence: normalizedEvent.recordSequence,
    },
  };
}

/** Stable current-container comparison including identifiers and JSON-safe metadata. */
function inventoryContainerDefinitionFingerprint(
  definition: InventoryContainerDefinition
): string {
  return JSON.stringify([
    definition.containerId,
    definition.containerType ?? null,
    inventoryMetadataFingerprint(definition.identifiers),
    definition.openedAt ?? null,
    definition.useBy ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Stable current-lot comparison including JSON-safe metadata. */
function inventoryLotDefinitionFingerprint(
  definition: InventoryLotDefinition
): string {
  return JSON.stringify([
    definition.itemId,
    definition.lotId,
    definition.manufacturedAt ?? null,
    definition.expiresAt ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Replay committed history through the same reducer used for live commits. */
export function projectInventoryEvents({
  catalog,
  events,
  deficitPolicy,
  throughRecordSequence,
}: ProjectInventoryEventsInput): InventoryProjectionState {
  const ordered = inventoryEventsInRecordSequence(events);
  let state = emptyInventoryProjectionState();
  for (const event of ordered) {
    if (
      throughRecordSequence !== undefined &&
      event.recordSequence > throughRecordSequence
    )
      break;
    state = applyInventoryCommittedEventInternal(
      { catalog, state, event, deficitPolicy },
      true,
      false
    ).state;
  }
  /** Sequence-indexed history is contiguous, so the cutoff is one prefix without a predicate scan. */
  const traceabilityEvents =
    throughRecordSequence === undefined
      ? ordered
      : ordered.slice(0, throughRecordSequence);
  return {
    ...state,
    traceability: projectInventoryTraceabilityEvents(traceabilityEvents),
  };
}

/** Reuse already ordered streams and sort only callers that supplied arbitrary order. */
export function inventoryEventsInRecordSequence(
  events: readonly InventoryCommittedEvent[]
): readonly InventoryCommittedEvent[] {
  let previous = 0;
  for (const event of events) {
    if (event.recordSequence <= previous) {
      const ordered = [...events];
      ordered.sort(compareCommittedEventSequence);
      return ordered;
    }
    previous = event.recordSequence;
  }
  return events;
}

/** Return current stock positions eligible under one broad selector. */
export function findInventoryPositions(
  state: InventoryProjectionState,
  selector: InventoryStockSelector
): readonly InventoryStockPosition[] {
  const normalizedSelector = normalizeInventoryStockSelector(selector);
  const result: InventoryStockPosition[] = [];
  for (const identity of candidatePositionIds(state, normalizedSelector)) {
    const position = state.positions[identity];
    if (position === undefined) {
      throw new Error(
        `Inventory stock index references missing position ${identity}.`
      );
    }
    if (
      inventoryStockPositionMatchesNormalizedSelector(
        position.key,
        normalizedSelector
      )
    ) {
      result.push(position);
    }
  }
  result.sort(compareStockPosition);
  return result;
}

/** Select the narrowest retained position index that satisfies this selector. */
function candidatePositionIds(
  state: InventoryProjectionState,
  selector: InventoryStockSelector
): readonly string[] {
  const revisionIds = selector.itemRevisionIds;
  if (revisionIds === undefined) {
    return state.positionIdsByItemId[selector.itemId] ?? [];
  }
  if (revisionIds.length === 1) {
    const revisionId = revisionIds[0];
    return revisionId === undefined
      ? []
      : state.positionIdsByItemRevisionId[revisionId] ?? [];
  }
  const candidates = new Set<string>();
  for (const revisionId of revisionIds) {
    for (const positionId of state.positionIdsByItemRevisionId[revisionId] ??
      []) {
      candidates.add(positionId);
    }
  }
  const ordered = [...candidates];
  ordered.sort();
  return ordered;
}

/** Capture FIFO age before a conserved movement changes source/destination positions. */
function captureConservedPositiveLayerStarts(
  state: InventoryProjectionState,
  event: InventoryCommittedEvent
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
    const sourceId = inventoryStockPositionIdentity(transfer.from);
    const destinationId = inventoryStockPositionIdentity(transfer.to);
    const source = state.positions[sourceId];
    if (
      source === undefined ||
      !quantityIsPositive(source.measurements.primary.quantity)
    ) {
      throw new Error(
        `Conserved FIFO provenance source ${sourceId} is not currently positive.`
      );
    }
    const sourceStartedAt = state.positiveLayerStartedAtByPositionId[sourceId];
    if (sourceStartedAt === undefined) {
      throw new Error(
        `Conserved FIFO provenance source ${sourceId} has no projected layer start.`
      );
    }
    const destinationStartedAt =
      state.positiveLayerStartedAtByPositionId[destinationId];
    result.set(
      destinationId,
      destinationStartedAt === undefined ||
        sourceStartedAt < destinationStartedAt
        ? sourceStartedAt
        : destinationStartedAt
    );
  }
  return result;
}

/** Record one exact final identity membership for a touched grouping row. */
function recordIndexedIdentityMutation(
  mutations: Map<string, Map<string, boolean>>,
  groupId: string,
  identity: string,
  present: boolean
): void {
  const group = mutations.get(groupId) ?? new Map<string, boolean>();
  group.set(identity, present);
  mutations.set(groupId, group);
}

/** Apply all touched identity changes once, avoiding quadratic copy/sort per event line. */
function applyIndexedIdentityMutations(
  index: Record<string, readonly string[]>,
  mutations: ReadonlyMap<string, ReadonlyMap<string, boolean>>
): void {
  for (const [groupId, desiredMembership] of mutations) {
    const next = new Set(index[groupId] ?? []);
    for (const [positionId, present] of desiredMembership) {
      if (present) next.add(positionId);
      else next.delete(positionId);
    }
    if (next.size === 0) {
      delete index[groupId];
      continue;
    }
    const ordered = [...next];
    ordered.sort();
    index[groupId] = ordered;
  }
}

/** Return whether one exact quantity is strictly positive. */
function quantityIsPositive(value: Quantity): boolean {
  return compareQuantity(value, zeroQuantity(value.unit, value.decimals)) > 0;
}

/** Register every possibly affected position for one item-scoped serial. */
function registerTouchedSerialPosition(
  touched: Map<string, Set<string>>,
  serialIndex: Readonly<Record<string, string>>,
  position: InventoryStockPositionKey,
  positionId: string
): void {
  const serialId = position.serialId;
  if (serialId === undefined) return;
  const serialIdentity = inventorySerialIdentity(position.itemId, serialId);
  const positionIds = touched.get(serialIdentity) ?? new Set<string>();
  const earlierPositionId = serialIndex[serialIdentity];
  if (earlierPositionId !== undefined) positionIds.add(earlierPositionId);
  positionIds.add(positionId);
  touched.set(serialIdentity, positionIds);
}

/** Inputs for rebuilding only serial-index rows touched by one atomic event. */
interface RefreshTouchedSerialIndexesInput {
  /** Complete next stock projection. */
  readonly positions: Readonly<Record<string, InventoryStockPosition>>;
  /** Candidate position identities for every affected serial. */
  readonly touchedPositionIdsBySerialIdentity: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  /** Mutable copy-on-write serial index. */
  readonly positivePositionIdBySerialIdentity: Record<string, string>;
}

/** Rebuild affected serial rows after every leg has reached its atomic next state. */
function refreshTouchedSerialIndexes({
  positions,
  touchedPositionIdsBySerialIdentity,
  positivePositionIdBySerialIdentity,
}: RefreshTouchedSerialIndexesInput): void {
  for (const [
    serialIdentity,
    positionIds,
  ] of touchedPositionIdsBySerialIdentity) {
    delete positivePositionIdBySerialIdentity[serialIdentity];
    let positivePositionId: string | undefined;
    for (const positionId of positionIds) {
      const position = positions[positionId];
      if (position === undefined) continue;
      const primary = position.measurements.primary.quantity;
      if (!quantityIsPositive(primary)) continue;
      if (!quantityEq(primary, parseQuantity("1", primary.unit))) {
        throw new Error(
          `Active serial ${serialIdentity} must represent exactly one primary resource.`
        );
      }
      if (
        positivePositionId !== undefined &&
        positivePositionId !== positionId
      ) {
        throw new Error(
          `Active serial ${serialIdentity} appears in more than one stock position.`
        );
      }
      positivePositionId = positionId;
    }
    if (positivePositionId !== undefined) {
      positivePositionIdBySerialIdentity[serialIdentity] = positivePositionId;
    }
  }
}

/** Sort committed events by durable sequence and reject ties during apply. */
export function compareCommittedEventSequence(
  left: InventoryCommittedEvent,
  right: InventoryCommittedEvent
): number {
  return left.recordSequence - right.recordSequence;
}

/** Sort projected stock rows by exact deterministic position identity. */
function compareStockPosition(
  left: InventoryStockPosition,
  right: InventoryStockPosition
): number {
  return inventoryStockPositionIdentity(left.key).localeCompare(
    inventoryStockPositionIdentity(right.key)
  );
}
