import { candidateSubtreePositionIds } from "./stock-scope.js";
import { assertInventoryStockAgeOverride, captureConservedPositiveLayerStarts, inventoryConservedArrivalCanSettleDeficit, replayEffectiveStockAge, type InventoryStockAgeReplay } from "./stock-age.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  cloneInventorySparseRecord,
  createInventorySparseRecord,
  deleteInventorySparseRecordValue,
  inventorySparseRecordValue,
  setInventorySparseRecordValue,
  updateInventorySortedIdentitySet,
} from "./sparse-record.js";
import { inventoryMetadataFingerprint } from "./canonical.js";
import type { InventoryCatalog } from "./catalog.js";
import {
  InventoryEventKind,
  commitInventoryEvent,
  defineInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
} from "./events.js";
import {
  addInventoryMeasurements,
  assertInventoryMeasurementsFollowPrimarySign,
  inventoryMeasurementsAreZero,
  nonNegativeInventoryMeasurements,
  zeroInventoryMeasurements,
} from "./measurements.js";
import {
  inventoryLotIdentity,
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  type InventoryPlacementNodeDefinition,
  type InventoryLotDefinition,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
} from "./model.js";
import {
  applyInventoryPlacementChanges,
  emptyInventoryPlacementState,
  inventoryPlacementParentNodeId,
  type InventoryPlacementState,
} from "./placement.js";
import {
  compareQuantity,
  parseQuantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import { assertInventoryActiveSerialQuantity } from "./stock-amount-rules.js";
import {
  InventoryOptionalIdentityConstraintKind,
  inventoryStockPositionMatchesNormalizedSelector,
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  applyInventoryTraceabilityChanges,
  applyInventoryTraceabilityChangesBatch,
  emptyInventoryTraceabilityState,
  type ApplyInventoryTraceabilityChangesInput,
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

/** Current placement-node metadata plus the retained root assertion that owns it. */
export interface InventoryProjectedPlacementNodeDefinition {
  /** Current exact placement-node metadata/use-by/embodiment assertion. */
  readonly definition: InventoryPlacementNodeDefinition;
  /** Retained non-correction event that first established this placement-node master. */
  readonly rootEventId: string;
  /** Latest event that established/corrected the current metadata value. */
  readonly assertedByEventId: string;
  /** Event that ended the embodied resource and retired this node from current placement use. */
  readonly retiredByEventId?: string;
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
  /** Exact current position identities grouped by their direct placement node. */
  readonly positionIdsByPlacementNodeId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Exact current position identities grouped by kernel-owned whereabouts cohort. */
  readonly positionIdsByWhereaboutsId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Current uninterrupted positive-layer occurrence time by exact position identity. */
  readonly positiveLayerStartedAtEpochMsByPositionId: Readonly<Record<string, number>>;
  /** Current positive exact position by item-scoped serial identity. */
  readonly positivePositionIdBySerialIdentity: Readonly<Record<string, string>>;
  /** Current and retired placement-node metadata keyed by exact node id. */
  readonly placementNodes: Readonly<
    Record<string, InventoryProjectedPlacementNodeDefinition>
  >;
  /** Historical/current unique embodiment binding from item-scoped serial to node id. */
  readonly placementNodeIdByEmbodiedSerialIdentity: Readonly<
    Record<string, string>
  >;
  /** First retained root event that owns each placement-node metadata identity. */
  readonly placementNodeRootEventIdByNodeId: Readonly<Record<string, string>>;
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
  /** Whereabouts lifecycle -> durable event sequences touching that exact cohort. */
  readonly eventSequencesByWhereaboutsId: Readonly<
    Record<string, readonly number[]>
  >;
  /** Operation id -> committed event id index for exact retry semantics. */
  readonly eventIdByOperationId: Readonly<Record<string, string>>;
  /** Corrected event id -> one current direct correction event id. */
  readonly correctionEventIdByCorrectedEventId: Readonly<
    Record<string, string>
  >;
  /** Current direct-parent placement forest. */
  readonly placement: InventoryPlacementState;
  /** Current association plus append-only genealogy graph. */
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
    positionIdsByItemId: createInventorySparseRecord(),
    positionIdsByItemRevisionId: createInventorySparseRecord(),
    positionIdsByPlacementNodeId: createInventorySparseRecord(),
    positionIdsByWhereaboutsId: createInventorySparseRecord(),
    positiveLayerStartedAtEpochMsByPositionId: {},
    positivePositionIdBySerialIdentity: {},
    placementNodes: createInventorySparseRecord(),
    placementNodeIdByEmbodiedSerialIdentity: createInventorySparseRecord(),
    placementNodeRootEventIdByNodeId: createInventorySparseRecord(),
    lots: {},
    lotIdentitiesByItemId: createInventorySparseRecord(),
    lotRootEventIdByIdentity: {},
    transfers: createInventorySparseRecord(),
    events: createInventorySparseRecord(),
    eventIdsBySequence: {},
    eventSequencesByWhereaboutsId: createInventorySparseRecord(),
    eventIdByOperationId: createInventorySparseRecord(),
    correctionEventIdByCorrectedEventId: createInventorySparseRecord(),
    placement: emptyInventoryPlacementState(),
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

/** Inputs for appending a committed event batch to one already published projection. */
export interface ApplyInventoryCommittedEventsInput {
  /** Frozen catalogue validating every appended event. */
  readonly catalog: InventoryCatalog;
  /** Existing immutable projection; never modified by this operation. */
  readonly state: InventoryProjectionState;
  /** Ordered or unordered committed events, including exact idempotent replays. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Same explicit deficit semantics as single-event commit and cold replay. */
  readonly deficitPolicy: InventoryDeficitPolicy;
}

/**
 * Catch up an existing projection through many committed events atomically.
 * Clone the flat maps once into a private workspace, then reuse the exact
 * validated reducer in its mutable replay mode. A failure cannot expose any
 * partial state, while N pending events avoid N growing whole-record copies.
 */
export function applyInventoryCommittedEvents({
  catalog,
  state,
  events,
  deficitPolicy,
}: ApplyInventoryCommittedEventsInput): InventoryProjectionState {
  if (events.length === 0) return state;
  const ordered = inventoryEventsInRecordSequence(events);
  // Exact retries must not clone a giant published projection just to prove
  // that no new event is necessary. The ordinary single-event validator
  // remains the authority for both replay equivalence and changed intent.
  let allPreviouslyCommitted = true;
  for (const event of ordered) {
    if (
      inventorySparseRecordValue(
        state.eventIdByOperationId,
        event.operationId
      ) === undefined
    ) {
      allPreviouslyCommitted = false;
      break;
    }
  }
  if (allPreviouslyCommitted) {
    for (const event of ordered) {
      const replay = applyInventoryCommittedEventInternal(
        { catalog, state, event, deficitPolicy },
        false,
        true
      );
      if (!replay.replayed) {
        throw new Error("Committed batch replay unexpectedly changed the projection.");
      }
    }
    return state;
  }
  let next = cloneInventoryProjectionForEventBatch(state);
  // Placement is not copied for ordinary stock-only batches. The first real
  // topology change uses the single-event COW rule, then its copy belongs
  // exclusively to this batch and may be mutated for later changes.
  let ownsPlacement = false;
  let changed = false;
  const traceabilityTail: Array<
    Pick<ApplyInventoryTraceabilityChangesInput, "eventId" | "changes">
  > = [];
  for (const event of ordered) {
    // Validate all stock/placement/transfer state via the existing exact
    // reducer, but do not repeatedly copy the full traceability relation
    // map while catching up a deferred event sequence.
    const result = applyInventoryCommittedEventInternal(
      { catalog, state: next, event, deficitPolicy },
      true,
      false,
      ownsPlacement
    );
    if (result.state.placement !== next.placement) ownsPlacement = true;
    next = result.state;
    changed ||= !result.replayed;
    if (!result.replayed && result.event.traceabilityChanges.length !== 0) {
      traceabilityTail.push({
        eventId: result.event.eventId,
        changes: result.event.traceabilityChanges,
      });
    }
  }
  if (!changed) return state;
  return {
    ...next,
    traceability: applyInventoryTraceabilityChangesBatch({
      state: state.traceability,
      events: traceabilityTail,
    }),
  };
}

/** Clone each mutable root once; immutable rows and sorted arrays remain shared. */
function cloneInventoryProjectionForEventBatch(
  state: InventoryProjectionState
): InventoryProjectionState {
  return {
    ...state,
    positions: cloneInventorySparseRecord(state.positions),
    positionIdsByItemId: cloneInventorySparseRecord(state.positionIdsByItemId),
    positionIdsByItemRevisionId: cloneInventorySparseRecord(
      state.positionIdsByItemRevisionId
    ),
    positionIdsByPlacementNodeId: cloneInventorySparseRecord(
      state.positionIdsByPlacementNodeId
    ),
    positionIdsByWhereaboutsId: cloneInventorySparseRecord(
      state.positionIdsByWhereaboutsId
    ),
    positiveLayerStartedAtEpochMsByPositionId: cloneInventorySparseRecord(
      state.positiveLayerStartedAtEpochMsByPositionId
    ),
    positivePositionIdBySerialIdentity: cloneInventorySparseRecord(
      state.positivePositionIdBySerialIdentity
    ),
    placementNodes: cloneInventorySparseRecord(state.placementNodes),
    placementNodeIdByEmbodiedSerialIdentity: cloneInventorySparseRecord(
      state.placementNodeIdByEmbodiedSerialIdentity
    ),
    placementNodeRootEventIdByNodeId: cloneInventorySparseRecord(
      state.placementNodeRootEventIdByNodeId
    ),
    lots: cloneInventorySparseRecord(state.lots),
    lotIdentitiesByItemId: cloneInventorySparseRecord(
      state.lotIdentitiesByItemId
    ),
    lotRootEventIdByIdentity: cloneInventorySparseRecord(
      state.lotRootEventIdByIdentity
    ),
    transfers: cloneInventorySparseRecord(state.transfers),
    events: cloneInventorySparseRecord(state.events),
    eventIdsBySequence: cloneInventorySparseRecord(state.eventIdsBySequence),
    eventSequencesByWhereaboutsId: cloneInventorySparseRecord(
      state.eventSequencesByWhereaboutsId
    ),
    eventIdByOperationId: cloneInventorySparseRecord(state.eventIdByOperationId),
    correctionEventIdByCorrectedEventId: cloneInventorySparseRecord(
      state.correctionEventIdByCorrectedEventId
    ),
    // Placement is kept read-only until the first actual topology change.
  };
}

/**
 * Shared reducer. Whole-history replay owns a fresh private projection and may mutate its maps
 * to avoid cloning every growing index once per event; live commits always use copy-on-write.
 */
function applyInventoryCommittedEventInternal(
  { catalog, state, event, deficitPolicy }: ApplyInventoryCommittedEventInput,
  mutateProjection: boolean,
  projectTraceability: boolean,
  ownsPlacement = mutateProjection,
  replayStockAge?: InventoryStockAgeReplay
): ApplyInventoryCommittedEventResult {
  const normalizedDraft = defineInventoryEvent({ catalog, event });
  const normalizedEvent = commitInventoryEvent(
    normalizedDraft,
    event.recordedAtEpochMs,
    event.recordSequence
  );
  const earlierEventId = inventorySparseRecordValue(
    state.eventIdByOperationId,
    normalizedEvent.operationId
  );
  if (earlierEventId !== undefined) {
    const earlier = inventorySparseRecordValue(state.events, earlierEventId);
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
  const existingEventWithSameId = inventorySparseRecordValue(
    state.events,
    normalizedEvent.eventId
  );
  if (existingEventWithSameId !== undefined) {
    if (
      inventoryEventIntentFingerprint(existingEventWithSameId) !==
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
  /** Whether this event can change the correction ownership index. */
  const correctionProjectionChanges = normalizedEvent.correction !== undefined;
  /** Whether stock effects touch a serial historically/currently bound to a node. */
  const embodiedSerialStockChanges = normalizedEvent.stockEffects.some(
    /** Detect one serial whose lifetime or placement can change embodied topology. */
    (effect) =>
      effect.position.serialId !== undefined &&
      inventorySparseRecordValue(
        state.placementNodeIdByEmbodiedSerialIdentity,
        inventorySerialIdentity(effect.position.itemId, effect.position.serialId)
      ) !== undefined
  );
  /** Whether node metadata, embodiment lifetime, or root ownership needs a private copy. */
  const placementNodeProjectionChanges =
    correctionProjectionChanges ||
    embodiedSerialStockChanges ||
    (normalizedEvent.placementNodeDefinitions?.length ?? 0) > 0;
  /** Whether lot metadata/root ownership needs a private copy for this event. */
  const lotProjectionChanges =
    correctionProjectionChanges ||
    (normalizedEvent.lotDefinitions?.length ?? 0) > 0;
  /** Whether any current stock/index/FIFO/serial value can change. */
  const stockProjectionChanges =
    normalizedEvent.stockEffects.length > 0 ||
    (normalizedEvent.positiveLayerProvenanceOverrides?.length ?? 0) > 0;
  const correctionEventIdByCorrectedEventId: Record<string, string> =
    mutateProjection
      ? (state.correctionEventIdByCorrectedEventId as Record<string, string>)
      : correctionProjectionChanges
        ? cloneInventorySparseRecord(state.correctionEventIdByCorrectedEventId)
        : (state.correctionEventIdByCorrectedEventId as Record<string, string>);
  if (normalizedEvent.correction !== undefined) {
    const correctedEventId = normalizedEvent.correction.correctsEventId;
    const correctedEvent = inventorySparseRecordValue(
      state.events,
      correctedEventId
    );
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
    const currentCorrectionEventId = inventorySparseRecordValue(
      correctionEventIdByCorrectedEventId,
      correctedEventId
    );
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
    setInventorySparseRecordValue(
      correctionEventIdByCorrectedEventId,
      correctedEventId,
      normalizedEvent.eventId
    );
  }

  /** Copy used while deriving the next all-or-nothing placement-node metadata projection. */
  const placementNodes: Record<
    string,
    InventoryProjectedPlacementNodeDefinition
  > = mutateProjection
    ? (state.placementNodes as Record<
        string,
        InventoryProjectedPlacementNodeDefinition
      >)
    : placementNodeProjectionChanges
      ? cloneInventorySparseRecord(state.placementNodes)
      : (state.placementNodes as Record<
          string,
          InventoryProjectedPlacementNodeDefinition
        >);
  /** Pre-event metadata for nodes changed in this mutable batch replay step. */
  const previousPlacementNodeById =
    mutateProjection && placementNodeProjectionChanges
      ? new Map<string, InventoryProjectedPlacementNodeDefinition | undefined>()
      : undefined;
  /** Capture only a changed node's pre-event row before mutating the shared batch workspace. */
  const rememberPreviousPlacementNode = (nodeId: string): void => {
    if (
      previousPlacementNodeById !== undefined &&
      !previousPlacementNodeById.has(nodeId)
    ) {
      previousPlacementNodeById.set(
        nodeId,
        inventorySparseRecordValue(state.placementNodes, nodeId)
      );
    }
  };
  /** Historical/current embodied serial -> node binding; retired embodiments remain reserved. */
  const placementNodeIdByEmbodiedSerialIdentity: Record<string, string> =
    mutateProjection
      ? (state.placementNodeIdByEmbodiedSerialIdentity as Record<string, string>)
      : placementNodeProjectionChanges
        ? cloneInventorySparseRecord(
            state.placementNodeIdByEmbodiedSerialIdentity
          )
        : (state.placementNodeIdByEmbodiedSerialIdentity as Record<
            string,
            string
          >);
  /** Embodied nodes whose serial or definition may need topology/lifetime reconciliation. */
  const touchedEmbodiedNodeIds = new Set<string>();
  /** Retained root ownership survives when one correction temporarily omits node metadata. */
  const placementNodeRootEventIdByNodeId: Record<string, string> =
    mutateProjection
      ? (state.placementNodeRootEventIdByNodeId as Record<string, string>)
      : placementNodeProjectionChanges
        ? cloneInventorySparseRecord(state.placementNodeRootEventIdByNodeId)
        : (state.placementNodeRootEventIdByNodeId as Record<string, string>);
  const correctedPlacementNodeRootEventId =
    normalizedEvent.correction?.correctsEventId;
  // Only the retained root and its latest superseded correction can own
  // currently effective metadata for this root. Do not scan the warehouse.
  const correctedMetadataSources = inventoryCorrectionMetadataSources(
    state,
    normalizedEvent
  );
  const replacementPlacementNodeIds = new Set<string>();
  for (const definition of normalizedEvent.placementNodeDefinitions ?? []) {
    replacementPlacementNodeIds.add(definition.nodeId);
  }
  /** Only nodes redefined or removed by this event can change serial binding identities. */
  const changedPlacementNodeIds = new Set(replacementPlacementNodeIds);
  if (correctedPlacementNodeRootEventId !== undefined) {
    const previouslyOwnedNodeIds = new Set<string>();
    for (const sourceEvent of correctedMetadataSources) {
      for (const definition of sourceEvent.placementNodeDefinitions ?? []) {
        previouslyOwnedNodeIds.add(definition.nodeId);
      }
    }
    for (const nodeId of previouslyOwnedNodeIds) {
      const projected = inventorySparseRecordValue(placementNodes, nodeId);
      if (
        projected?.rootEventId === correctedPlacementNodeRootEventId &&
        !replacementPlacementNodeIds.has(nodeId)
      ) {
        if (projected.retiredByEventId !== undefined) {
          throw new Error(
            `Retired embodied placement node '${nodeId}' cannot be erased by correction.`
          );
        }
        if (projected.definition.embodiedBy !== undefined) {
          touchedEmbodiedNodeIds.add(nodeId);
        }
        rememberPreviousPlacementNode(nodeId);
        changedPlacementNodeIds.add(nodeId);
        deleteInventorySparseRecordValue(placementNodes, nodeId);
      }
    }
  }
  for (const definition of normalizedEvent.placementNodeDefinitions ?? []) {
    const nodeId = definition.nodeId;
    rememberPreviousPlacementNode(nodeId);
    const rootEventId =
      correctedPlacementNodeRootEventId ?? normalizedEvent.eventId;
    const existingRootEventId = inventorySparseRecordValue(
      placementNodeRootEventIdByNodeId,
      nodeId
    );
    const current = inventorySparseRecordValue(placementNodes, nodeId);
    if (
      current?.retiredByEventId !== undefined &&
      (current.definition.embodiedBy?.itemId !== definition.embodiedBy?.itemId ||
        current.definition.embodiedBy?.serialId !== definition.embodiedBy?.serialId)
    ) {
      throw new Error(
        `Retired embodied placement node '${nodeId}' cannot change its physical embodiment.`
      );
    }
    if (
      current?.definition.embodiedBy !== undefined ||
      definition.embodiedBy !== undefined
    ) {
      touchedEmbodiedNodeIds.add(nodeId);
    }
    if (existingRootEventId === undefined) {
      setInventorySparseRecordValue(
        placementNodeRootEventIdByNodeId,
        nodeId,
        rootEventId
      );
      setInventorySparseRecordValue(placementNodes, nodeId, {
        definition,
        rootEventId,
        assertedByEventId: normalizedEvent.eventId,
      });
      continue;
    }
    const sameDefinition =
      current !== undefined &&
      inventoryPlacementNodeDefinitionFingerprint(current.definition) ===
        inventoryPlacementNodeDefinitionFingerprint(definition);
    if (correctedPlacementNodeRootEventId === undefined) {
      if (current === undefined) {
        throw new Error(
          `Inventory placement node '${nodeId}' was removed by correction; correct its retained root to restore it.`
        );
      }
      if (!sameDefinition) {
        throw new Error(
          `Inventory placement node '${nodeId}' already has different metadata; correct retained root '${existingRootEventId}'.`
        );
      }
      continue;
    }
    if (existingRootEventId !== correctedPlacementNodeRootEventId) {
      if (!sameDefinition) {
        throw new Error(
          `Inventory placement node '${nodeId}' belongs to retained root '${existingRootEventId}', not '${correctedPlacementNodeRootEventId}'.`
        );
      }
      continue;
    }
    setInventorySparseRecordValue(placementNodes, nodeId, {
      definition,
      rootEventId: existingRootEventId,
      assertedByEventId: normalizedEvent.eventId,
      ...(current?.retiredByEventId === undefined
        ? {}
        : { retiredByEventId: current.retiredByEventId }),
    });
  }
  if (changedPlacementNodeIds.size !== 0) {
    /** Next serial bindings wait until every affected previous binding is removed. */
    const nextSerialByChangedNodeId = new Map<string, string>();
    for (const nodeId of changedPlacementNodeIds) {
      const previous =
        previousPlacementNodeById?.has(nodeId) === true
          ? previousPlacementNodeById.get(nodeId)
          : inventorySparseRecordValue(state.placementNodes, nodeId);
      const before = previous?.definition.embodiedBy;
      const after = inventorySparseRecordValue(placementNodes, nodeId)
        ?.definition.embodiedBy;
      const previousSerialIdentity =
        before === undefined
          ? undefined
          : inventorySerialIdentity(before.itemId, before.serialId);
      const nextSerialIdentity =
        after === undefined
          ? undefined
          : inventorySerialIdentity(after.itemId, after.serialId);
      // A stable serial keeps its exact binding, including retired embodiments.
      if (previousSerialIdentity === nextSerialIdentity) continue;
      if (
        previousSerialIdentity !== undefined &&
        inventorySparseRecordValue(
          placementNodeIdByEmbodiedSerialIdentity,
          previousSerialIdentity
        ) === nodeId
      ) {
        deleteInventorySparseRecordValue(
          placementNodeIdByEmbodiedSerialIdentity,
          previousSerialIdentity
        );
      }
      if (nextSerialIdentity !== undefined) {
        nextSerialByChangedNodeId.set(nodeId, nextSerialIdentity);
      }
    }
    // Release all old bindings before adding new ones so corrected nodes can
    // exchange serial identities without transient duplicate conflicts.
    for (const [nodeId, serialIdentity] of nextSerialByChangedNodeId) {
      const existingNodeId = inventorySparseRecordValue(
        placementNodeIdByEmbodiedSerialIdentity,
        serialIdentity
      );
      if (existingNodeId !== undefined && existingNodeId !== nodeId) {
        throw new Error(
          "Embodied serial " + serialIdentity +
            " is already bound to placement node '" + existingNodeId + "'."
        );
      }
      setInventorySparseRecordValue(
        placementNodeIdByEmbodiedSerialIdentity,
        serialIdentity,
        nodeId
      );
    }
  }

  /** Copy used while deriving the next all-or-nothing lot-metadata projection. */
  const lots: Record<string, InventoryProjectedLotDefinition> = mutateProjection
    ? (state.lots as Record<string, InventoryProjectedLotDefinition>)
    : lotProjectionChanges
      ? cloneInventorySparseRecord(state.lots)
      : (state.lots as Record<string, InventoryProjectedLotDefinition>);
  /** Item -> current lot identities index supports item-local lot reads without a global scan. */
  const lotIdentitiesByItemId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.lotIdentitiesByItemId as Record<string, readonly string[]>)
      : lotProjectionChanges
        ? cloneInventorySparseRecord(state.lotIdentitiesByItemId)
        : (state.lotIdentitiesByItemId as Record<string, readonly string[]>);
  /** One desired final membership per touched item lot-index row. */
  const lotIndexMutations = new Map<string, Map<string, boolean>>();
  /** Retained root ownership survives even when one correction temporarily omits the lot master. */
  const lotRootEventIdByIdentity: Record<string, string> = mutateProjection
    ? (state.lotRootEventIdByIdentity as Record<string, string>)
    : lotProjectionChanges
      ? cloneInventorySparseRecord(state.lotRootEventIdByIdentity)
      : (state.lotRootEventIdByIdentity as Record<string, string>);
  const correctedRootEventId = normalizedEvent.correction?.correctsEventId;
  const replacementLotIdentities = new Set<string>();
  for (const definition of normalizedEvent.lotDefinitions ?? []) {
    replacementLotIdentities.add(
      inventoryLotIdentity(definition.itemId, definition.lotId)
    );
  }
  if (correctedRootEventId !== undefined) {
    const previouslyOwnedLotIdentities = new Set<string>();
    for (const sourceEvent of correctedMetadataSources) {
      for (const definition of sourceEvent.lotDefinitions ?? []) {
        previouslyOwnedLotIdentities.add(
          inventoryLotIdentity(definition.itemId, definition.lotId)
        );
      }
    }
    for (const identity of previouslyOwnedLotIdentities) {
      const projected = inventorySparseRecordValue(lots, identity);
      if (
        projected?.rootEventId === correctedRootEventId &&
        !replacementLotIdentities.has(identity)
      ) {
        deleteInventorySparseRecordValue(lots, identity);
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
      setInventorySparseRecordValue(
        lotRootEventIdByIdentity,
        identity,
        rootEventId
      );
      setInventorySparseRecordValue(lots, identity, {
        definition,
        rootEventId,
        assertedByEventId: normalizedEvent.eventId,
      });
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
    setInventorySparseRecordValue(lots, identity, {
      definition,
      rootEventId: existingRootEventId,
      assertedByEventId: normalizedEvent.eventId,
    });
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
    : stockProjectionChanges
      ? cloneInventorySparseRecord(state.positions)
      : (state.positions as Record<string, InventoryStockPosition>);
  /** Copy-on-write item indexes avoid scanning unrelated inventory on normal reads. */
  const positionIdsByItemId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByItemId as Record<string, readonly string[]>)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(state.positionIdsByItemId)
        : (state.positionIdsByItemId as Record<string, readonly string[]>);
  /** Copy-on-write revision indexes support revisioned collections and summaries. */
  const positionIdsByItemRevisionId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByItemRevisionId as Record<string, readonly string[]>)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(state.positionIdsByItemRevisionId)
        : (state.positionIdsByItemRevisionId as Record<string, readonly string[]>);
  /** Copy-on-write direct-placement index supports subtree operations across item types. */
  const positionIdsByPlacementNodeId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByPlacementNodeId as Record<
          string,
          readonly string[]
        >)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(state.positionIdsByPlacementNodeId)
        : (state.positionIdsByPlacementNodeId as Record<
            string,
            readonly string[]
          >);
  /** Current unresolved-cohort memberships, copied only when stock changes. */
  const positionIdsByWhereaboutsId: Record<string, readonly string[]> =
    mutateProjection
      ? (state.positionIdsByWhereaboutsId as Record<string, readonly string[]>)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(state.positionIdsByWhereaboutsId)
        : (state.positionIdsByWhereaboutsId as Record<string, readonly string[]>);
  /** One desired final membership per touched whereabouts cohort. */
  const whereaboutsIndexMutations = new Map<string, Map<string, boolean>>();
  /** One desired final membership per touched item index row; applied once after all effects. */
  const itemIndexMutations = new Map<string, Map<string, boolean>>();
  /** One desired final membership per touched revision index row. */
  const revisionIndexMutations = new Map<string, Map<string, boolean>>();
  /** One desired final membership per touched direct-placement index row. */
  const placementNodeIndexMutations = new Map<string, Map<string, boolean>>();
  /** O(1) FIFO provenance for each current uninterrupted positive layer. */
  const positiveLayerStartedAtEpochMsByPositionId: Record<string, number> =
    mutateProjection
      ? (state.positiveLayerStartedAtEpochMsByPositionId as Record<string, number>)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(
            state.positiveLayerStartedAtEpochMsByPositionId
          )
        : (state.positiveLayerStartedAtEpochMsByPositionId as Record<
            string,
            number
          >);
  /** Current serial ownership index updated only for serials touched by this event. */
  const positivePositionIdBySerialIdentity: Record<string, string> =
    mutateProjection
      ? (state.positivePositionIdBySerialIdentity as Record<string, string>)
      : stockProjectionChanges
        ? cloneInventorySparseRecord(
            state.positivePositionIdBySerialIdentity
          )
        : (state.positivePositionIdBySerialIdentity as Record<string, string>);
  const touchedPositionIdsBySerialIdentity = new Map<string, Set<string>>();
  /** Conserved moves carry the oldest current source/destination layer into the destination. */
  const conservedPositiveLayerStartByDestinationId =
    captureConservedPositiveLayerStarts(
      normalizedEvent,
      /** Read a FIFO start from the published state before applying any effect. */
      (positionId) => state.positiveLayerStartedAtEpochMsByPositionId[positionId],
      replayStockAge
    );
  for (const effect of normalizedEvent.stockEffects) {
    /** Embodied serial stock must still have a positive instance after a move. */
    let embodiedNodeId: string | undefined;
    if (effect.position.serialId !== undefined) {
      const serialIdentity = inventorySerialIdentity(
        effect.position.itemId,
        effect.position.serialId
      );
      embodiedNodeId = inventorySparseRecordValue(
        placementNodeIdByEmbodiedSerialIdentity,
        serialIdentity
      );
      if (embodiedNodeId !== undefined) {
        touchedEmbodiedNodeIds.add(embodiedNodeId);
      }
    }
    const placementNode =
      effect.position.placementNodeId === undefined
        ? undefined
        : inventorySparseRecordValue(
            placementNodes,
            effect.position.placementNodeId
          );
    if (placementNode?.retiredByEventId !== undefined) {
      throw new Error(
        `Retired placement node '${effect.position.placementNodeId}' cannot receive stock.`
      );
    }
    if (placementNode?.definition.acceptsPlacement === false) {
      throw new Error(
        `Placement node '${effect.position.placementNodeId}' does not accept stock.`
      );
    }
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
    // Historical planners reject newly exposed shortages; a verified correction
    // may leave a previously recorded deficit open while improving it.
    if (
      deficitPolicy === InventoryDeficitPolicy.Reject &&
      normalizedEvent.kind !== InventoryEventKind.Correction &&
      normalizedEvent.kind !== InventoryEventKind.HistoricalRepair
    ) {
      nonNegativeInventoryMeasurements(next, `Stock position ${identity}`);
    }
    const wasPositive = quantityIsPositive(current.primary.quantity);
    const isPositive = quantityIsPositive(next.primary.quantity);
    if (embodiedNodeId !== undefined && !isPositive &&
      conservedPositiveLayerStartByDestinationId.has(identity)) {
      throw new Error(
        `Conserved FIFO provenance destination ${identity} is not positive after its event.`
      );
    }
    if (inventoryMeasurementsAreZero(next)) {
      deleteInventorySparseRecordValue(positions, identity);
      if (effect.position.whereaboutsId !== undefined) {
        recordIndexedIdentityMutation(
          whereaboutsIndexMutations,
          effect.position.whereaboutsId,
          identity,
          false
        );
      }
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
      if (effect.position.placementNodeId !== undefined) {
        recordIndexedIdentityMutation(
          placementNodeIndexMutations,
          effect.position.placementNodeId,
          identity,
          false
        );
      }
    } else {
      setInventorySparseRecordValue(positions, identity, {
        key: effect.position,
        measurements: next,
      });
      if (earlier === undefined) {
        if (effect.position.whereaboutsId !== undefined) {
          recordIndexedIdentityMutation(
            whereaboutsIndexMutations,
            effect.position.whereaboutsId,
            identity,
            true
          );
        }
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
        if (effect.position.placementNodeId !== undefined) {
          recordIndexedIdentityMutation(
            placementNodeIndexMutations,
            effect.position.placementNodeId,
            identity,
            true
          );
        }
      }
    }
    if (!wasPositive && isPositive) {
      setInventorySparseRecordValue(
        positiveLayerStartedAtEpochMsByPositionId,
        identity,
        normalizedEvent.occurredAtEpochMs
      );
    } else if (wasPositive && !isPositive) {
      deleteInventorySparseRecordValue(
        positiveLayerStartedAtEpochMsByPositionId,
        identity
      );
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
    positionIdsByWhereaboutsId,
    whereaboutsIndexMutations
  );
  applyIndexedIdentityMutations(
    positionIdsByItemRevisionId,
    revisionIndexMutations
  );
  applyIndexedIdentityMutations(
    positionIdsByPlacementNodeId,
    placementNodeIndexMutations
  );
  for (const [
    identity,
    startedAtEpochMs,
  ] of conservedPositiveLayerStartByDestinationId) {
    const position = positions[identity];
    if (
      position === undefined ||
      !quantityIsPositive(position.measurements.primary.quantity)
    ) {
      // The exact transfer still witnessed this route. All incoming stock
      // paid down the signed balance, leaving no current layer to age.
      if (inventoryConservedArrivalCanSettleDeficit(normalizedEvent)) continue;
      throw new Error(
        `Conserved FIFO provenance destination ${identity} is not positive after its event.`
      );
    }
    setInventorySparseRecordValue(
      positiveLayerStartedAtEpochMsByPositionId,
      identity,
      startedAtEpochMs
    );
  }
  for (const override of normalizedEvent.positiveLayerProvenanceOverrides ??
    []) {
    const identity = inventoryStockPositionIdentity(override.position);
    const position = positions[identity];
    assertInventoryStockAgeOverride(
      override.startedAtEpochMs,
      position !== undefined && quantityIsPositive(position.measurements.primary.quantity),
      identity
    );
    if (override.startedAtEpochMs === undefined) {
      deleteInventorySparseRecordValue(
        positiveLayerStartedAtEpochMsByPositionId,
        identity
      );
      continue;
    }
    setInventorySparseRecordValue(
      positiveLayerStartedAtEpochMsByPositionId,
      identity,
      override.startedAtEpochMs
    );
  }
  refreshTouchedSerialIndexes({
    positions,
    touchedPositionIdsBySerialIdentity,
    positivePositionIdBySerialIdentity,
  });
  for (const change of normalizedEvent.placementChanges ?? []) {
    const projected = inventorySparseRecordValue(placementNodes, change.nodeId);
    if (
      projected?.retiredByEventId === undefined &&
      projected?.definition.embodiedBy !== undefined
    ) {
      throw new Error(
        `Embodied placement node '${change.nodeId}' must move through its unique stock instance.`
      );
    }
    if (projected?.retiredByEventId !== undefined) {
      throw new Error(`Retired placement node '${change.nodeId}' cannot move.`);
    }
  }
  let placement = applyInventoryPlacementChanges({
    state: state.placement,
    eventId: normalizedEvent.eventId,
    changes: normalizedEvent.placementChanges ?? [],
    mutatePrivateBatch: ownsPlacement,
    /** Resolve destination policy from the event-final projected node metadata. */
    acceptsPlacement: (nodeId) => {
      const projected = inventorySparseRecordValue(placementNodes, nodeId);
      return (
        projected?.retiredByEventId === undefined &&
        projected?.definition.acceptsPlacement !== false
      );
    },
  });
  placement = reconcileInventoryPlacementEmbodiments({
    previousPlacementNodes: state.placementNodes,
    ...(previousPlacementNodeById === undefined
      ? {}
      : { previousPlacementNodeById }),
    placementNodes,
    placementNodeIdByEmbodiedSerialIdentity,
    positions,
    positionIdsByPlacementNodeId,
    positivePositionIdBySerialIdentity,
    touchedEmbodiedNodeIds,
    placement,
    mutatePrivateBatch: ownsPlacement || placement !== state.placement,
    eventId: normalizedEvent.eventId,
    ...(normalizedEvent.correction === undefined
      ? {}
      : {
          correctsEventId: normalizedEvent.correction.correctsEventId,
          ...(normalizedEvent.correction.supersedesCorrectionEventId === undefined
            ? {}
            : {
                supersedesCorrectionEventId:
                  normalizedEvent.correction.supersedesCorrectionEventId,
              }),
        }),
    ...(normalizedEvent.historicalRepair === undefined
      ? {}
      : { omittedHistoricalAssertionIds: normalizedEvent.historicalRepair.omittedAssertionIds }),
    retainedEvents: state.events,
  });
  for (const definition of normalizedEvent.placementNodeDefinitions ?? []) {
    if (definition.acceptsPlacement !== false) continue;
    const directPositions =
      inventorySparseRecordValue(
        positionIdsByPlacementNodeId,
        definition.nodeId
      ) ?? [];
    const childNodes =
      inventorySparseRecordValue(
        placement.childNodeIdsByParentNodeId,
        definition.nodeId
      ) ?? [];
    if (directPositions.length > 0 || childNodes.length > 0) {
      throw new Error(
        `Placement node '${definition.nodeId}' cannot reject placement while it still has direct contents.`
      );
    }
  }
  const traceability = projectTraceability
    ? applyInventoryTraceabilityChanges({
        state: state.traceability,
        eventId: normalizedEvent.eventId,
        changes: normalizedEvent.traceabilityChanges,
      })
    : state.traceability;
  const touchedWhereaboutsIds = inventoryWhereaboutsIdsTouchedByProjectionEvent(
    state,
    normalizedEvent
  );
  const eventSequencesByWhereaboutsId: Record<string, readonly number[]> =
    mutateProjection
      ? (state.eventSequencesByWhereaboutsId as Record<string, readonly number[]>)
      : touchedWhereaboutsIds.length === 0
        ? (state.eventSequencesByWhereaboutsId as Record<
            string,
            readonly number[]
          >)
        : cloneInventorySparseRecord(state.eventSequencesByWhereaboutsId);
  for (const whereaboutsId of touchedWhereaboutsIds) {
    const earlierSequences =
      inventorySparseRecordValue(
        eventSequencesByWhereaboutsId,
        whereaboutsId
      ) ?? [];
    setInventorySparseRecordValue(
      eventSequencesByWhereaboutsId,
      whereaboutsId,
      [...earlierSequences, normalizedEvent.recordSequence]
    );
  }
  const events: Record<string, InventoryCommittedEvent> = mutateProjection
    ? (state.events as Record<string, InventoryCommittedEvent>)
    : cloneInventorySparseRecord(state.events);
  const eventIdsBySequence: Record<string, string> = mutateProjection
    ? (state.eventIdsBySequence as Record<string, string>)
    : cloneInventorySparseRecord(state.eventIdsBySequence);
  const eventIdByOperationId: Record<string, string> = mutateProjection
    ? (state.eventIdByOperationId as Record<string, string>)
    : cloneInventorySparseRecord(state.eventIdByOperationId);
  setInventorySparseRecordValue(
    events,
    normalizedEvent.eventId,
    normalizedEvent
  );
  setInventorySparseRecordValue(
    eventIdsBySequence,
    String(normalizedEvent.recordSequence),
    normalizedEvent.eventId
  );
  setInventorySparseRecordValue(
    eventIdByOperationId,
    normalizedEvent.operationId,
    normalizedEvent.eventId
  );

  return {
    event: normalizedEvent,
    replayed: false,
    state: {
      positions,
      positionIdsByItemId,
      positionIdsByItemRevisionId,
      positionIdsByPlacementNodeId,
      positionIdsByWhereaboutsId,
      positiveLayerStartedAtEpochMsByPositionId,
      positivePositionIdBySerialIdentity,
      placementNodes,
      placementNodeIdByEmbodiedSerialIdentity,
      placementNodeRootEventIdByNodeId,
      lots,
      lotIdentitiesByItemId,
      lotRootEventIdByIdentity,
      transfers,
      events,
      eventIdsBySequence,
      eventSequencesByWhereaboutsId,
      eventIdByOperationId,
      correctionEventIdByCorrectedEventId,
      placement,
      traceability,
      lastRecordSequence: normalizedEvent.recordSequence,
    },
  };
}

/** Inputs for synchronizing active placement topology with unique embodied stock truth. */
interface ReconcileInventoryPlacementEmbodimentsInput {
  /** Node projection before this event, used to distinguish creation from retirement. */
  readonly previousPlacementNodes: Readonly<
    Record<string, InventoryProjectedPlacementNodeDefinition>
  >;
  /** Pre-event changed rows captured before in-place mutation of the batch workspace. */
  readonly previousPlacementNodeById?: ReadonlyMap<
    string,
    InventoryProjectedPlacementNodeDefinition | undefined
  >;
  /** Mutable next node projection, including any metadata assertions from this event. */
  readonly placementNodes: Record<
    string,
    InventoryProjectedPlacementNodeDefinition
  >;
  /** Historical/current item-scoped serial -> node binding. */
  readonly placementNodeIdByEmbodiedSerialIdentity: Readonly<
    Record<string, string>
  >;
  /** Complete next stock projection. */
  readonly positions: Readonly<Record<string, InventoryStockPosition>>;
  /** Complete next direct-stock index. */
  readonly positionIdsByPlacementNodeId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Complete next positive serial index. */
  readonly positivePositionIdBySerialIdentity: Readonly<Record<string, string>>;
  /** Nodes whose embodiment definition or serial stock changed in this event. */
  readonly touchedEmbodiedNodeIds: ReadonlySet<string>;
  /** Placement topology after explicit standalone-node changes. */
  readonly placement: InventoryPlacementState;
  /** True only when this reducer owns the detached batch/cold-replay placement maps. */
  readonly mutatePrivateBatch: boolean;
  /** Event responsible for any derived parent synchronization or retirement. */
  readonly eventId: string;
  /** Exact retired event being append-only corrected, when this is a correction. */
  readonly correctsEventId?: string;
  /** Prior correction replaced by this correction of the same retained root. */
  readonly supersedesCorrectionEventId?: string;
  /** Exact historical assertions explicitly omitted by this repair, if any. */
  readonly omittedHistoricalAssertionIds?: readonly string[];
  /** Previously published events used to authenticate a retrospective omission. */
  readonly retainedEvents: Readonly<Record<string, InventoryCommittedEvent>>;
}

/** Allow revival only when the exact retained repair's serialized retirement is omitted. */
function historicalRepairOmitsEmbodiedRetirement({
  omittedAssertionIds,
  retainedEvents,
  retirementEventId,
  itemId,
  serialId,
}: {
  /** Explicit source assertion identities removed from effective history, if any. */
  readonly omittedAssertionIds: readonly string[] | undefined;
  /** Previously committed envelopes, including the retirement owner. */
  readonly retainedEvents: Readonly<Record<string, InventoryCommittedEvent>>;
  /** Envelope that retired the embodied node. */
  readonly retirementEventId: string;
  /** Item identity of the embodied physical instance. */
  readonly itemId: string;
  /** Serial identity of the embodied physical instance. */
  readonly serialId: string;
}): boolean {
  if (omittedAssertionIds === undefined || omittedAssertionIds.length === 0) {
    return false;
  }
  const retiredBy = inventorySparseRecordValue(retainedEvents, retirementEventId);
  if (retiredBy?.historicalRepair === undefined) return false;
  const omitted = new Set(omittedAssertionIds);
  for (const assertion of retiredBy.historicalRepair.assertions) {
    if (!omitted.has(assertion.assertionId)) continue;
    for (const effect of assertion.event.stockEffects) {
      if (
        effect.position.itemId === itemId &&
        effect.position.serialId === serialId &&
        effect.measurementsDelta.primary.quantity.amountMinor < 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Keep embodied node parent/lifetime derived from its one live serial resource. */
function reconcileInventoryPlacementEmbodiments({
  previousPlacementNodes,
  previousPlacementNodeById,
  placementNodes,
  placementNodeIdByEmbodiedSerialIdentity,
  positions,
  positionIdsByPlacementNodeId,
  positivePositionIdBySerialIdentity,
  touchedEmbodiedNodeIds,
  placement,
  mutatePrivateBatch,
  eventId,
  correctsEventId,
  supersedesCorrectionEventId,
  omittedHistoricalAssertionIds,
  retainedEvents,
}: ReconcileInventoryPlacementEmbodimentsInput): InventoryPlacementState {
  let nextPlacement = placement;
  // An initial copy-on-write transition creates the private batch forest;
  // additional embodied-node moves within the same event can reuse it.
  let ownsPlacement = mutatePrivateBatch;
  const nodeIds = [...touchedEmbodiedNodeIds];
  nodeIds.sort(compareInventoryIdentityText);
  for (const nodeId of nodeIds) {
    let projected = inventorySparseRecordValue(placementNodes, nodeId);
    const embodiment = projected?.definition.embodiedBy;
    if (projected === undefined || embodiment === undefined) continue;
    const serialIdentity = inventorySerialIdentity(
      embodiment.itemId,
      embodiment.serialId
    );
    const boundNodeId = inventorySparseRecordValue(
      placementNodeIdByEmbodiedSerialIdentity,
      serialIdentity
    );
    if (boundNodeId !== nodeId) {
      throw new Error(
        `Embodied serial ${serialIdentity} is not bound to placement node '${nodeId}'.`
      );
    }
    const positivePositionId = inventorySparseRecordValue(
      positivePositionIdBySerialIdentity,
      serialIdentity
    );
    if (projected.retiredByEventId !== undefined) {
      if (positivePositionId === undefined) continue;
      if (
        correctsEventId !== projected.retiredByEventId &&
        supersedesCorrectionEventId !== projected.retiredByEventId &&
        !historicalRepairOmitsEmbodiedRetirement({
          omittedAssertionIds: omittedHistoricalAssertionIds,
          retainedEvents,
          retirementEventId: projected.retiredByEventId,
          itemId: embodiment.itemId,
          serialId: embodiment.serialId,
        })
      ) {
        throw new Error(
          `Retired embodied serial ${serialIdentity} cannot become current stock again without correcting its retirement event.`
        );
      }
      const {
        retiredByEventId: _retiredByEventId,
        ...restoredProjection
      } = projected;
      projected = {
        ...restoredProjection,
        assertedByEventId: eventId,
      };
      setInventorySparseRecordValue(placementNodes, nodeId, projected);
    }
    if (positivePositionId === undefined) {
      const previous =
        previousPlacementNodeById?.has(nodeId) === true
          ? previousPlacementNodeById.get(nodeId)
          : inventorySparseRecordValue(previousPlacementNodes, nodeId);
      if (
        previous === undefined ||
        previous.definition.embodiedBy === undefined ||
        previous.retiredByEventId !== undefined
      ) {
        throw new Error(
          `Placement node '${nodeId}' cannot be embodied without one live serialized resource.`
        );
      }
      const directPositionIds =
        inventorySparseRecordValue(positionIdsByPlacementNodeId, nodeId) ?? [];
      // Recorded negative positions are contents too; the index holds every live row.
      const childNodeIds =
        inventorySparseRecordValue(
          nextPlacement.childNodeIdsByParentNodeId,
          nodeId
        ) ?? [];
      if (directPositionIds.length > 0 || childNodeIds.length > 0) {
        throw new Error(
          `Embodied placement node '${nodeId}' must be empty before its unique resource can leave or become generic.`
        );
      }
      const currentParentNodeId = inventoryPlacementParentNodeId(
        nextPlacement,
        nodeId
      );
      if (currentParentNodeId !== undefined) {
        nextPlacement = applyInventoryPlacementChanges({
          state: nextPlacement,
          eventId,
          changes: [{ nodeId, fromParentNodeId: currentParentNodeId }],
          mutatePrivateBatch: ownsPlacement,
          acceptsPlacement:
            /** Removing an edge while retiring a node never adds a new parent. */
            () => true,
        });
        ownsPlacement = true;
      }
      setInventorySparseRecordValue(placementNodes, nodeId, {
        ...projected,
        retiredByEventId: eventId,
      });
      continue;
    }
    const position = inventorySparseRecordValue(positions, positivePositionId);
    if (position === undefined) {
      throw new Error(
        `Embodied serial index ${serialIdentity} references missing stock.`
      );
    }
    const desiredParentNodeId = position.key.placementNodeId;
    if (desiredParentNodeId !== undefined) {
      const desiredParent = inventorySparseRecordValue(
        placementNodes,
        desiredParentNodeId
      );
      if (desiredParent?.retiredByEventId !== undefined) {
        throw new Error(
          `Embodied placement node '${nodeId}' cannot move into retired node '${desiredParentNodeId}'.`
        );
      }
    }
    const currentParentNodeId = inventoryPlacementParentNodeId(
      nextPlacement,
      nodeId
    );
    if (currentParentNodeId === desiredParentNodeId) continue;
    nextPlacement = applyInventoryPlacementChanges({
      state: nextPlacement,
      eventId,
      changes: [
        {
          nodeId,
          ...(currentParentNodeId === undefined
            ? {}
            : { fromParentNodeId: currentParentNodeId }),
          ...(desiredParentNodeId === undefined
            ? {}
            : { toParentNodeId: desiredParentNodeId }),
        },
      ],
      mutatePrivateBatch: ownsPlacement,
      acceptsPlacement:
        /** Resolve one derived embodied parent against current active node policy. */
        (parentNodeId) => {
        const parent = inventorySparseRecordValue(
          placementNodes,
          parentNodeId
        );
        return (
          parent?.retiredByEventId === undefined &&
          parent?.definition.acceptsPlacement !== false
        );
      },
    });
    ownsPlacement = true;
  }
  return nextPlacement;
}

/** Identify only metadata-owner events whose definitions can survive into a root correction. */
function inventoryCorrectionMetadataSources(
  state: InventoryProjectionState,
  event: InventoryCommittedEvent
): readonly InventoryCommittedEvent[] {
  const correction = event.correction;
  if (correction === undefined) return [];
  const root = inventorySparseRecordValue(state.events, correction.correctsEventId);
  if (root === undefined || root.kind === InventoryEventKind.Correction) {
    throw new Error("Metadata correction lost its retained root event.");
  }
  const supersededId = correction.supersedesCorrectionEventId;
  if (supersededId === undefined) return [root];
  const superseded = inventorySparseRecordValue(state.events, supersededId);
  if (
    superseded === undefined ||
    superseded.correction?.correctsEventId !== correction.correctsEventId
  ) {
    throw new Error("Metadata correction lost its superseded root assertion.");
  }
  return [root, superseded];
}

/** Return every whereabouts lifecycle identity retained by one event or its corrected root. */
function inventoryWhereaboutsIdsTouchedByProjectionEvent(
  state: InventoryProjectionState,
  event: InventoryCommittedEvent
): readonly string[] {
  const result = new Set<string>();
  addDirectInventoryWhereaboutsIds(result, event);
  for (const whereaboutsId of event.historicalImpact?.whereaboutsIds ?? []) {
    result.add(whereaboutsId);
  }
  for (const assertion of event.historicalRepair?.assertions ?? []) {
    addDirectInventoryWhereaboutsIds(result, assertion.event);
  }
  if (event.correction !== undefined) {
    const corrected = inventorySparseRecordValue(
      state.events,
      event.correction.correctsEventId
    );
    if (corrected === undefined) {
      throw new Error(
        "Whereabouts correction references missing event '" +
          event.correction.correctsEventId +
          "'."
      );
    }
    addDirectInventoryWhereaboutsIds(result, corrected);
  }
  const ordered = [...result];
  ordered.sort(compareInventoryIdentityText);
  return ordered;
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

/** Stable current placement-node comparison including policy, identifiers, and metadata. */
function inventoryPlacementNodeDefinitionFingerprint(
  definition: InventoryPlacementNodeDefinition
): string {
  return JSON.stringify([
    definition.nodeId,
    definition.category ?? null,
    definition.acceptsPlacement ?? null,
    definition.embodiedBy?.itemId ?? null,
    definition.embodiedBy?.serialId ?? null,
    inventoryMetadataFingerprint(definition.identifiers),
    definition.openedAtEpochMs ?? null,
    definition.useByEpochMs ?? null,
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
    definition.manufacturedAtEpochMs ?? null,
    definition.expiresAtEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Replay committed history through the same reducer used for live commits. */
export function projectInventoryEvents(input: ProjectInventoryEventsInput): InventoryProjectionState {
  const { catalog, events, deficitPolicy, throughRecordSequence } = input;
  const stockAge = replayEffectiveStockAge in input ? input[replayEffectiveStockAge] : undefined;
  const replayStockAge = stockAge === "effective-history" || stockAge === "occurrence-cut" ? stockAge : undefined;
  if (
    throughRecordSequence !== undefined &&
    (!Number.isSafeInteger(throughRecordSequence) || throughRecordSequence < 0)
  ) {
    throw new Error("throughRecordSequence must be a non-negative safe integer.");
  }
  const ordered = inventoryEventsInRecordSequence(events);
  let state = emptyInventoryProjectionState();
  /** Number of ordered events actually replayed into this requested historical cut. */
  let appliedEventCount = 0;
  for (const event of ordered) {
    if (
      throughRecordSequence !== undefined &&
      event.recordSequence > throughRecordSequence
    )
      break;
    state = applyInventoryCommittedEventInternal(
      { catalog, state, event, deficitPolicy },
      true,
      false,
      true,
      replayStockAge
    ).state;
    appliedEventCount += 1;
  }
  /** Reuse the exact replayed prefix so post-cut graph changes can never leak into the historical state. */
  const traceabilityEvents =
    throughRecordSequence === undefined
      ? ordered
      : ordered.slice(0, appliedEventCount);
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
  // The retained membership arrays and multi-index unions are already ordered
  // by canonical position identity. Do not allocate pairs and sort again.
  for (const identity of candidatePositionIds(state, normalizedSelector)) {
    const position = inventorySparseRecordValue(state.positions, identity);
    if (position === undefined) {
      throw new Error(
        `Inventory stock index references missing position ${identity}.`
      );
    }
    if (
      inventoryStockPositionMatchesNormalizedSelector(
        position.key,
        normalizedSelector,
        state.placement
      )
    ) {
      result.push(position);
    }
  }
  return result;
}

/** Select the smallest indexed candidate set without scanning unrelated stock. */
function candidatePositionIds(
  state: InventoryProjectionState,
  selector: InventoryStockSelector
): readonly string[] {
  const revisionIds = selector.itemRevisionIds;
  let itemCandidates: readonly string[] | undefined;
  let itemCandidateCount = 0;
  if (revisionIds === undefined) {
    itemCandidates =
      inventorySparseRecordValue(state.positionIdsByItemId, selector.itemId) ??
      [];
    itemCandidateCount = itemCandidates.length;
  } else if (revisionIds.length === 1) {
    itemCandidates =
      inventorySparseRecordValue(
        state.positionIdsByItemRevisionId,
        revisionIds[0] ?? ""
      ) ?? [];
    itemCandidateCount = itemCandidates.length;
  } else {
    // Count only first. Building a multi-revision union can be much more
    // expensive than one selective direct-placement index.
    for (const revisionId of revisionIds) {
      itemCandidateCount +=
        inventorySparseRecordValue(
          state.positionIdsByItemRevisionId,
          revisionId
        )?.length ?? 0;
    }
  }

  // Exact direct placement is independent of item, but may be much narrower
  // than an item spanning thousands of bins. Subtree predicates are applied
  // later by the full selector matcher; the direct-placement index remains exact.
  const directPlacementIds =
    selector.placement?.kind === InventoryOptionalIdentityConstraintKind.Allowed
      ? selector.placement.valueIds
      : undefined;
  if (directPlacementIds !== undefined) {
    let placementCandidateCount = 0;
    for (const nodeId of directPlacementIds) {
      placementCandidateCount +=
        inventorySparseRecordValue(
          state.positionIdsByPlacementNodeId,
          nodeId
        )?.length ?? 0;
    }
    if (placementCandidateCount < itemCandidateCount) {
      if (directPlacementIds.length === 1) {
        return inventorySparseRecordValue(
          state.positionIdsByPlacementNodeId,
          directPlacementIds[0] ?? ""
        ) ?? [];
      }
      const placements: string[] = [];
      for (const nodeId of directPlacementIds) {
        const positionIds = inventorySparseRecordValue(
          state.positionIdsByPlacementNodeId,
          nodeId
        ) ?? [];
        for (const positionId of positionIds) placements.push(positionId);
      }
      // A position can have only one direct placement, so these lists are
      // disjoint; preserve canonical ordering across the selected nodes.
      placements.sort(compareInventoryIdentityText);
      return placements;
    }
  }

  // For a large item inventory, a small room/cabinet subtree may provide
  // a much narrower candidate list. Its direct-node rows are disjoint; the
  // full selector matcher still verifies each position's current ancestry.
  if (selector.withinPlacementNodeIds !== undefined) {
    const subtreeCandidates = candidateSubtreePositionIds(
      {
        /** Read exact position postings for one anchored node. */
        positionIds: (nodeId) => {
          const ids = inventorySparseRecordValue(state.positionIdsByPlacementNodeId, nodeId) ?? [];
          return { size: ids.length, ids };
        },
        /** Read immediate child postings without copying the published array. */
        childNodeIds: (nodeId) => {
          const ids = inventorySparseRecordValue(state.placement.childNodeIdsByParentNodeId, nodeId) ?? [];
          return { size: ids.length, ids };
        },
      },
      selector.withinPlacementNodeIds,
      itemCandidateCount
    );
    if (subtreeCandidates !== undefined) return subtreeCandidates;
  }

  if (itemCandidates !== undefined) return itemCandidates;
  const candidates: string[] = [];
  for (const revisionId of revisionIds ?? []) {
    for (const positionId of
      inventorySparseRecordValue(
        state.positionIdsByItemRevisionId,
        revisionId
      ) ?? []) {
      candidates.push(positionId);
    }
  }
  // A position has exactly one item revision; no deduplication is necessary.
  candidates.sort(compareInventoryIdentityText);
  return candidates;
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
    const current = inventorySparseRecordValue(index, groupId) ?? [];
    const ordered = updateInventorySortedIdentitySet(
      current,
      desiredMembership
    );
    if (ordered.length === 0) {
      deleteInventorySparseRecordValue(index, groupId);
      continue;
    }
    if (ordered !== current) {
      setInventorySparseRecordValue(index, groupId, ordered);
    }
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
    deleteInventorySparseRecordValue(
      positivePositionIdBySerialIdentity,
      serialIdentity
    );
    let positivePositionId: string | undefined;
    for (const positionId of positionIds) {
      const position = positions[positionId];
      if (position === undefined) continue;
      const primary = position.measurements.primary.quantity;
      if (!quantityIsPositive(primary)) continue;
      assertInventoryActiveSerialQuantity(serialIdentity, primary);
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
      setInventorySparseRecordValue(
        positivePositionIdBySerialIdentity,
        serialIdentity,
        positivePositionId
      );
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
