import { compareInventoryIdentityText } from "./ordering.js";
import {
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  commitInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryHistoricalAssertion,
  type InventoryHistoricalDeficitInterval,
  type InventoryHistoricalImpact,
} from "./events.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementsAreZero,
  negateInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
} from "./model.js";
import {
  InventoryDeficitPolicy,
  projectInventoryEvents,
  type InventoryProjectionState,
} from "./projection.js";
import { inventoryTraceabilityRelationIdentity } from "./traceability.js";
import { compareQuantity, zeroQuantity } from "./quantity.js";
import type { InventoryCatalog } from "./catalog.js";
import { inventoryEventDependencyKeys } from "./event-query.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** Machine-readable reason one proposed historical scenario cannot become inventory truth. */
export type InventoryHistoricalReplayConflictCode =
  | "invalid-history"
  | "negative-stock"
  | "serialized-deficit"
  | "missing-anchor"
  | "duplicate-assertion"
  | "legacy-correction";

/** Structured historical planning failure retained by side-effect-free public plans. */
export interface InventoryHistoricalReplayConflict {
  /** Stable broad conflict category for applications that do not parse messages. */
  readonly code: InventoryHistoricalReplayConflictCode;
  /** Human-readable exact kernel diagnostic. */
  readonly message: string;
  /** Effective event being processed when known. */
  readonly eventId?: string;
}

/** Error used internally so commit APIs retain ordinary throwing behavior. */
export class InventoryHistoricalReplayConflictError extends Error {
  /** Structured planning conflict. */
  readonly conflict: InventoryHistoricalReplayConflict;

  /** Wrap one deterministic historical-replay failure. */
  constructor(conflict: InventoryHistoricalReplayConflict) {
    super(conflict.message);
    this.name = "InventoryHistoricalReplayConflictError";
    this.conflict = conflict;
  }
}

/** One late assertion together with its retained repair-envelope ordering. */
export interface InventoryPendingHistoricalAssertion {
  /** Stable assertion/evidence shape. */
  readonly assertion: InventoryHistoricalAssertion;
  /** Time the system learned this assertion. */
  readonly recordedAtEpochMs: number;
  /** Durable envelope order; proposed assertions use the next unpublished sequence. */
  readonly durableOrder: number;
  /** Exact assertion order inside its atomic repair bundle. */
  readonly assertionOrder: number;
}

/** Optional replacement of one retained root while deriving corrected effective history. */
export interface InventoryHistoricalRootReplacement {
  /** Retained non-correction root event being reinterpreted. */
  readonly rootEventId: string;
  /** Replacement assertion, or omission when it never happened. */
  readonly replacement?: InventoryEventDraft;
}

/** Inputs for deriving one effective historical scenario without mutating published state. */
export interface ReplayInventoryHistoricalScenarioInput {
  /** Frozen catalogue validating all retained and embedded assertions. */
  readonly catalog: InventoryCatalog;
  /** Current published projection/event authority. */
  readonly projection: InventoryProjectionState;
  /** Configured policy governing whether fungible deficits may become current truth. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Optional current root replacement used by correction planning. */
  readonly rootReplacement?: InventoryHistoricalRootReplacement;
  /** Optional resource-scoped retained event component; omission uses the complete projection. */
  readonly sourceEvents?: readonly InventoryCommittedEvent[];
  /** New late assertions introduced by a proposed historical repair. */
  readonly assertions?: readonly InventoryPendingHistoricalAssertion[];
  /** Earlier embedded assertion identities removed by a proposed repair. */
  readonly omittedAssertionIds?: readonly string[];
}

/** Complete result of one deterministic corrected/late historical replay. */
export interface InventoryHistoricalReplayResult {
  /** Effective current projection for this complete/resource-scoped history component. */
  readonly actualProjection: InventoryProjectionState;
  /** Rebuilt desired projection after the proposed historical truth. */
  readonly projection: InventoryProjectionState;
  /** Contiguous effective event sequence used by the replay. */
  readonly effectiveEvents: readonly InventoryCommittedEvent[];
  /** Consequences newly introduced relative to currently effective history. */
  readonly impact: InventoryHistoricalImpact;
}

/** Build and validate one proposed effective history, preserving published history unchanged. */
export function replayInventoryHistoricalScenario({
  catalog,
  projection,
  deficitPolicy,
  rootReplacement,
  sourceEvents,
  assertions = [],
  omittedAssertionIds = [],
}: ReplayInventoryHistoricalScenarioInput): InventoryHistoricalReplayResult {
  const actualEvents = reconcileInventoryHistoricalGraphEvents(
    effectiveInventoryHistoryEvents({
      projection,
      ...(sourceEvents === undefined ? {} : { sourceEvents }),
    })
  );
  const effectiveEvents = reconcileInventoryHistoricalGraphEvents(
    effectiveInventoryHistoryEvents({
      projection,
      ...(sourceEvents === undefined ? {} : { sourceEvents }),
      assertions,
      omittedAssertionIds,
      ...(rootReplacement === undefined ? {} : { rootReplacement }),
      rejectLegacyCorrections:
        rootReplacement !== undefined ||
        assertions.length !== 0 ||
        omittedAssertionIds.length !== 0,
    })
  );
  const actualDeficits = inventoryHistoricalDeficitIntervals(actualEvents);
  const proposedDeficits = inventoryHistoricalDeficitIntervals(effectiveEvents);
  const actualDeficitsByIdentity = new Map(
    actualDeficits.map(
      /** Key existing shortages independently of their severity and eventual resolution. */
      (deficit) => [inventoryHistoricalDeficitIdentity(deficit), deficit]
    )
  );
  const deficits = proposedDeficits.filter(
    /** Report a genuinely new or longer/deeper interval, not an improvement. */
    (deficit) => {
      const previous = actualDeficitsByIdentity.get(
        inventoryHistoricalDeficitIdentity(deficit)
      );
      if (previous === undefined) return true;
      if (
        compareQuantity(
          deficit.maximumDeficit.primary.quantity,
          previous.maximumDeficit.primary.quantity
        ) > 0 ||
        deficit.startedAtEpochMs < previous.startedAtEpochMs
      ) {
        return true;
      }
      if (deficit.endedAtEpochMs === undefined) {
        return previous.endedAtEpochMs !== undefined;
      }
      return (
        previous.endedAtEpochMs !== undefined &&
        deficit.endedAtEpochMs > previous.endedAtEpochMs
      );
    }
  );
  // An existing recorded serialized shortage is retained historical truth;
  // only a newly exposed negative serialized interval is a new identity error.
  for (const deficit of deficits) {
    if (deficit.position.serialId !== undefined) {
      throw new InventoryHistoricalReplayConflictError({
        code: "serialized-deficit",
        message:
          "Historical replay cannot represent a negative serialized resource; add/correct the missing identity event instead.",
        eventId: deficit.startedByEventId,
      });
    }
  }
  if (deficitPolicy === InventoryDeficitPolicy.Reject && deficits.length !== 0) {
    // A pre-existing recorded interval is historical truth, not a new
    // Reject-policy failure; only a newly exposed interval is forbidden.
    throw new InventoryHistoricalReplayConflictError({
      code: "negative-stock",
      message: "Historical replay would expose a new negative stock interval.",
      eventId: deficits[0]!.startedByEventId,
    });
  }
  let actualProjection: InventoryProjectionState;
  let desired: InventoryProjectionState;
  try {
    actualProjection = projectInventoryEvents({
      catalog,
      events: actualEvents,
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    desired = projectInventoryEvents({
      catalog,
      events: effectiveEvents,
      // Analyze first-class deficits explicitly above; Record lets replay reach later facts.
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
  } catch (error) {
    if (error instanceof InventoryHistoricalReplayConflictError) throw error;
    throw new InventoryHistoricalReplayConflictError({
      code: "invalid-history",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (deficitPolicy === InventoryDeficitPolicy.Reject) {
    // An already-open interval may retain its historical peak while a changed
    // receipt deepens the current shortage. Reject this new burden using only
    // indexed positions for open intervals, not a second full-history replay.
    for (const interval of proposedDeficits) {
      if (interval.endedByEventId !== undefined) continue;
      const positionId = inventoryStockPositionIdentity(interval.position);
      const before = inventorySparseRecordValue(
        actualProjection.positions,
        positionId
      )?.measurements.primary.quantity;
      const after = inventorySparseRecordValue(
        desired.positions,
        positionId
      )?.measurements.primary.quantity;
      if (after !== undefined &&
        (before === undefined || compareQuantity(after, before) < 0)) {
        throw new InventoryHistoricalReplayConflictError({
          code: "negative-stock",
          message: "Historical replay would deepen an existing recorded shortage.",
          ...(rootReplacement === undefined ? {} : { eventId: rootReplacement.rootEventId }),
        });
      }
    }
  }
  return {
    actualProjection,
    projection: desired,
    effectiveEvents,
    impact: {
      affectedEventIds: inventoryAffectedHistoricalEventIds(
        actualEvents,
        effectiveEvents
      ),
      whereaboutsIds: inventoryChangedHistoricalWhereaboutsIds(
        actualEvents,
        effectiveEvents
      ),
      deficits,
    },
  };
}

/** Collect current active embedded assertions, merge new evidence, then replay in deterministic order. */
function effectiveInventoryHistoryEvents({
  projection,
  sourceEvents,
  assertions = [],
  omittedAssertionIds = [],
  rootReplacement,
  rejectLegacyCorrections = false,
}: {
  /** Current projection owning the complete durable event indexes. */
  readonly projection: InventoryProjectionState;
  /** Optional indexed transitive event component. */
  readonly sourceEvents?: readonly InventoryCommittedEvent[];
  /** New late assertions to merge into effective history. */
  readonly assertions?: readonly InventoryPendingHistoricalAssertion[];
  /** Active embedded assertions to remove from effective history. */
  readonly omittedAssertionIds?: readonly string[];
  /** Optional retained root replacement used by correction planning. */
  readonly rootReplacement?: InventoryHistoricalRootReplacement;
  /** Whether legacy correction envelopes lacking replacement evidence must fail closed. */
  readonly rejectLegacyCorrections?: boolean;
}): readonly InventoryCommittedEvent[] {
  const ordered = sourceEvents === undefined
    ? orderedProjectionEvents(projection)
    : [...sourceEvents].sort(
        /** Replay one indexed component in exact durable order. */
        (left, right) => left.recordSequence - right.recordSequence
      );
  const active = new Map<string, InventoryPendingHistoricalAssertion>();
  const ordinary: InventoryCommittedEvent[] = [];
  const correctionByRoot = new Map<string, InventoryCommittedEvent>();
  const legacyCorrections: InventoryCommittedEvent[] = [];
  for (const event of ordered) {
    if (event.kind === InventoryEventKind.Correction) {
      const rootId = event.correction?.correctsEventId;
      if (rootId === undefined) {
        throw new InventoryHistoricalReplayConflictError({
          code: "invalid-history",
          message: `Correction event '${event.eventId}' lost its root reference.`,
          eventId: event.eventId,
        });
      }
      if (event.correctionReplacement === undefined) {
        legacyCorrections.push(event);
      } else {
        correctionByRoot.set(rootId, event);
      }
      continue;
    }
    if (event.kind !== InventoryEventKind.HistoricalRepair) {
      ordinary.push(event);
      continue;
    }
    const repair = event.historicalRepair;
    if (repair === undefined) {
      throw new InventoryHistoricalReplayConflictError({
        code: "invalid-history",
        message: `Historical repair event '${event.eventId}' lost its evidence.`,
        eventId: event.eventId,
      });
    }
    for (const assertionId of repair.omittedAssertionIds) {
      if (!active.delete(assertionId)) {
        throw new InventoryHistoricalReplayConflictError({
          code: "invalid-history",
          message: `Historical repair omits unknown assertion '${assertionId}'.`,
          eventId: event.eventId,
        });
      }
    }
    for (
      let assertionOrder = 0;
      assertionOrder < repair.assertions.length;
      assertionOrder += 1
    ) {
      const assertion = repair.assertions[assertionOrder]!;
      if (active.has(assertion.assertionId)) {
        throw new InventoryHistoricalReplayConflictError({
          code: "duplicate-assertion",
          message: `Historical assertion '${assertion.assertionId}' already exists.`,
          eventId: event.eventId,
        });
      }
      active.set(assertion.assertionId, {
        assertion,
        recordedAtEpochMs: event.recordedAtEpochMs,
        durableOrder: event.recordSequence,
        assertionOrder,
      });
    }
  }
  if (rejectLegacyCorrections && legacyCorrections.length !== 0) {
    const legacy = legacyCorrections[0]!;
    throw new InventoryHistoricalReplayConflictError({
      code: "legacy-correction",
      message:
        "Connected historical correction lacks retained replacement evidence; supersede/restate that correction before late-history repair.",
      eventId: legacy.eventId,
    });
  }
  const base: InventoryCommittedEvent[] = [];
  let replacedRootFound = rootReplacement === undefined;
  for (const event of ordinary) {
    if (rootReplacement?.rootEventId === event.eventId) {
      replacedRootFound = true;
      if (rootReplacement.replacement === undefined) continue;
      base.push({
        ...rootReplacement.replacement,
        eventId: event.eventId,
        operationId: event.operationId,
        recordedAtEpochMs: event.recordedAtEpochMs,
        recordSequence: event.recordSequence,
      });
      continue;
    }
    const correction = correctionByRoot.get(event.eventId);
    if (correction === undefined) {
      base.push(event);
      continue;
    }
    const replacement = correction.correctionReplacement;
    if (replacement === null) continue;
    if (replacement === undefined) {
      base.push(event);
      continue;
    }
    base.push({
      ...replacement,
      eventId: event.eventId,
      operationId: event.operationId,
      recordedAtEpochMs: event.recordedAtEpochMs,
      recordSequence: event.recordSequence,
    });
  }
  if (!replacedRootFound) {
    throw new InventoryHistoricalReplayConflictError({
      code: "invalid-history",
      message: `Correction root event '${rootReplacement!.rootEventId}' does not exist.`,
      eventId: rootReplacement!.rootEventId,
    });
  }
  base.push(...legacyCorrections);
  for (const assertionId of omittedAssertionIds) {
    if (!active.delete(assertionId)) {
      throw new InventoryHistoricalReplayConflictError({
        code: "invalid-history",
        message: `Historical repair omits unknown assertion '${assertionId}'.`,
      });
    }
  }
  for (const pending of assertions) {
    const id = pending.assertion.assertionId;
    if (active.has(id)) {
      throw new InventoryHistoricalReplayConflictError({
        code: "duplicate-assertion",
        message: `Historical assertion '${id}' already exists.`,
        eventId: pending.assertion.event.eventId,
      });
    }
    active.set(id, pending);
  }
  const pending = [...active.values()];
  pending.sort(comparePendingHistoricalAssertion);
  const merged: Array<{
    /** Effective assertion replayed into this temporary history. */
    readonly event: InventoryEventDraft | InventoryCommittedEvent;
    /** Durable time when the system learned this assertion. */
    readonly recordedAtEpochMs: number;
  }> = base.map(
    /** Preserve each retained assertion's durable evidence time. */
    (event) => ({ event, recordedAtEpochMs: event.recordedAtEpochMs })
  );
  for (const entry of pending) {
    insertHistoricalAssertion(merged, entry);
  }
  return merged.map(
    /** Assign contiguous local replay sequence without changing durable evidence time. */
    (entry, index) =>
      commitInventoryEvent(entry.event, entry.recordedAtEpochMs, index + 1)
  );
}

/** Read retained events in exact durable sequence without broad object-order assumptions. */
function orderedProjectionEvents(
  projection: InventoryProjectionState
): readonly InventoryCommittedEvent[] {
  const result: InventoryCommittedEvent[] = [];
  for (let sequence = 1; sequence <= projection.lastRecordSequence; sequence += 1) {
    const eventId = projection.eventIdsBySequence[String(sequence)];
    const event = eventId === undefined ? undefined : projection.events[eventId];
    if (event === undefined || event.recordSequence !== sequence) {
      throw new InventoryHistoricalReplayConflictError({
        code: "invalid-history",
        message: `Historical event index disagrees at recordSequence ${sequence}.`,
        ...(eventId === undefined ? {} : { eventId }),
      });
    }
    result.push(event);
  }
  return result;
}

/** Keep caller assertion order stable while sorting independent repairs by physical time/identity. */
function comparePendingHistoricalAssertion(
  left: InventoryPendingHistoricalAssertion,
  right: InventoryPendingHistoricalAssertion
): number {
  const time =
    left.assertion.event.occurredAtEpochMs -
    right.assertion.event.occurredAtEpochMs;
  if (time !== 0) return time;
  const durableOrder = left.durableOrder - right.durableOrder;
  if (durableOrder !== 0) return durableOrder;
  const assertionOrder = left.assertionOrder - right.assertionOrder;
  if (assertionOrder !== 0) return assertionOrder;
  return compareInventoryIdentityText(
    left.assertion.assertionId,
    right.assertion.assertionId
  );
}

/** Insert after an explicit anchor, otherwise after the latest no-later physical assertion. */
function insertHistoricalAssertion(
  target: Array<{
    /** Effective assertion already placed in temporary replay order. */
    readonly event: InventoryEventDraft | InventoryCommittedEvent;
    /** Durable time when the system learned this assertion. */
    readonly recordedAtEpochMs: number;
  }>,
  pending: InventoryPendingHistoricalAssertion
): void {
  const assertion = pending.assertion;
  let insertionIndex = -1;
  if (assertion.afterEventId !== undefined) {
    insertionIndex = target.findIndex(
      /** Find the exact retained/effective anchor requested by the assertion. */
      (entry) => entry.event.eventId === assertion.afterEventId
    );
    if (insertionIndex < 0) {
      throw new InventoryHistoricalReplayConflictError({
        code: "missing-anchor",
        message: `Historical assertion '${assertion.assertionId}' names missing afterEventId '${assertion.afterEventId}'.`,
        eventId: assertion.event.eventId,
      });
    }
  } else {
    for (let index = 0; index < target.length; index += 1) {
      if (
        target[index]!.event.occurredAtEpochMs <=
        assertion.event.occurredAtEpochMs
      ) {
        insertionIndex = index;
      }
    }
  }
  target.splice(insertionIndex + 1, 0, {
    event: assertion.event,
    recordedAtEpochMs: pending.recordedAtEpochMs,
  });
}

/** Reconcile graph-only later intents after corrected/late earlier history changes. */
function reconcileInventoryHistoricalGraphEvents(
  effectiveEvents: readonly InventoryCommittedEvent[]
): readonly InventoryCommittedEvent[] {
  const reconciled: InventoryCommittedEvent[] = [];
  const parentByNodeId = new Map<string, string>();
  const relationCreatorById = new Map<string, string>();
  const droppedGraphEventIds = new Set<string>();
  let nextSequence = 1;
  for (const event of effectiveEvents) {
    if (
      event.correction !== undefined &&
      droppedGraphEventIds.has(event.correction.correctsEventId)
    ) {
      continue;
    }
    const placementChanges = reconcileHistoricalPlacementChanges(
      event.placementChanges ?? [],
      parentByNodeId
    );
    const traceabilityChanges = reconcileHistoricalTraceabilityChanges(
      event.traceabilityChanges,
      event.eventId,
      relationCreatorById
    );
    if (
      (event.kind === InventoryEventKind.Placement &&
        placementChanges.length === 0 &&
        event.stockEffects.length === 0) ||
      (event.kind === InventoryEventKind.Traceability &&
        traceabilityChanges.length === 0)
    ) {
      droppedGraphEventIds.add(event.eventId);
      continue;
    }
    reconciled.push(
      commitInventoryEvent(
        {
          ...event,
          placementChanges,
          traceabilityChanges,
        },
        event.recordedAtEpochMs,
        nextSequence
      )
    );
    nextSequence += 1;
  }
  return reconciled;
}

/** Rebase topology source edges exactly as the existing correction planner does. */
function reconcileHistoricalPlacementChanges(
  changes: readonly import("./placement.js").InventoryPlacementChange[],
  parentByNodeId: Map<string, string>
): readonly import("./placement.js").InventoryPlacementChange[] {
  if (changes.length === 0) return changes;
  const result: import("./placement.js").InventoryPlacementChange[] = [];
  for (const change of changes) {
    const currentParentNodeId = parentByNodeId.get(change.nodeId);
    if (currentParentNodeId === change.toParentNodeId) continue;
    result.push({
      nodeId: change.nodeId,
      ...(currentParentNodeId === undefined
        ? {}
        : { fromParentNodeId: currentParentNodeId }),
      ...(change.toParentNodeId === undefined
        ? {}
        : { toParentNodeId: change.toParentNodeId }),
    });
    if (change.toParentNodeId === undefined) parentByNodeId.delete(change.nodeId);
    else parentByNodeId.set(change.nodeId, change.toParentNodeId);
  }
  return result;
}

/** Drop only reversible relation removals made redundant by changed earlier history. */
function reconcileHistoricalTraceabilityChanges(
  changes: readonly import("./events.js").InventoryTraceabilityRelationChange[],
  eventId: string,
  creatorById: Map<string, string>
): readonly import("./events.js").InventoryTraceabilityRelationChange[] {
  let filtered: import("./events.js").InventoryTraceabilityRelationChange[] | undefined;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    const relationId = inventoryTraceabilityRelationIdentity(change.kind, change.from, change.to);
    if (
      change.action === InventoryTraceabilityRelationAction.Remove &&
      !creatorById.has(relationId)
    ) {
      filtered ??= changes.slice(0, index);
      continue;
    }
    filtered?.push(change);
    if (change.action === InventoryTraceabilityRelationAction.Add) {
      creatorById.set(relationId, eventId);
    } else {
      creatorById.delete(relationId);
    }
  }
  return filtered ?? changes;
}

/** Derive every negative-balance interval without manufacturing missing physical stock. */
function inventoryHistoricalDeficitIntervals(
  events: readonly InventoryCommittedEvent[]
): readonly InventoryHistoricalDeficitInterval[] {
  const balances = new Map<
    string,
    {
      /** Item revision governing this signed balance. */
      readonly itemRevisionId: string;
      /** Exact stock bucket whose balance is accumulated. */
      readonly position: InventoryCommittedEvent["stockEffects"][number]["position"];
      /** Current signed measurements at this replay point. */
      measurements: InventoryMeasurementVector;
    }
  >();
  const open = new Map<
    string,
    {
      /** Item revision governing this deficit interval. */
      readonly itemRevisionId: string;
      /** Exact stock bucket that became negative. */
      readonly position: InventoryCommittedEvent["stockEffects"][number]["position"];
      /** Largest positive deficit magnitude reached while open. */
      maximumDeficit: InventoryMeasurementVector;
      /** Effective assertion that opened this interval. */
      readonly startedByEventId: string;
      /** Physical occurrence time when the interval opened. */
      readonly startedAtEpochMs: number;
    }
  >();
  const result: InventoryHistoricalDeficitInterval[] = [];
  for (const event of events) {
    for (const effect of event.stockEffects) {
      const identity = inventoryStockPositionIdentity(effect.position);
      const earlier = balances.get(identity);
      const next = addInventoryMeasurements(
        earlier?.measurements ?? zeroInventoryMeasurements(effect.measurementsDelta),
        effect.measurementsDelta
      );
      if (inventoryMeasurementsAreZero(next)) balances.delete(identity);
      else {
        balances.set(identity, {
          itemRevisionId: effect.itemRevisionId,
          position: effect.position,
          measurements: next,
        });
      }
      const primary = next.primary.quantity;
      const negative =
        compareQuantity(
          primary,
          zeroQuantity(primary.unit, primary.decimals)
        ) < 0;
      const current = open.get(identity);
      if (negative) {
        const magnitude = negateInventoryMeasurements(next);
        if (current === undefined) {
          open.set(identity, {
            itemRevisionId: effect.itemRevisionId,
            position: effect.position,
            maximumDeficit: magnitude,
            startedByEventId: event.eventId,
            startedAtEpochMs: event.occurredAtEpochMs,
          });
        } else if (
          compareQuantity(
            magnitude.primary.quantity,
            current.maximumDeficit.primary.quantity
          ) > 0
        ) {
          current.maximumDeficit = magnitude;
        }
      } else if (current !== undefined) {
        result.push({
          ...current,
          endedByEventId: event.eventId,
          endedAtEpochMs: event.occurredAtEpochMs,
        });
        open.delete(identity);
      }
    }
  }
  for (const interval of open.values()) result.push(interval);
  result.sort(compareHistoricalDeficitInterval);
  return result;
}

/** Stable historical-deficit ordering. */
function compareHistoricalDeficitInterval(
  left: InventoryHistoricalDeficitInterval,
  right: InventoryHistoricalDeficitInterval
): number {
  const time = left.startedAtEpochMs - right.startedAtEpochMs;
  if (time !== 0) return time;
  const event = compareInventoryIdentityText(
    left.startedByEventId,
    right.startedByEventId
  );
  return event !== 0
    ? event
    : compareInventoryIdentityText(
        inventoryStockPositionIdentity(left.position),
        inventoryStockPositionIdentity(right.position)
      );
}

/** Match one retained shortage by its opening assertion, regardless of later improvement. */
function inventoryHistoricalDeficitIdentity(
  deficit: InventoryHistoricalDeficitInterval
): string {
  return JSON.stringify([
    deficit.itemRevisionId,
    inventoryStockPositionIdentity(deficit.position),
    deficit.startedByEventId,
  ]);
}

/** Cohort identities named by changed effective assertions before or after repair. */
function inventoryChangedHistoricalWhereaboutsIds(
  actual: readonly InventoryCommittedEvent[],
  proposed: readonly InventoryCommittedEvent[]
): readonly string[] {
  const actualById = new Map(
    actual.map(
      /** Key one actual effective assertion by stable event identity. */
      (event) => [event.eventId, event]
    )
  );
  const proposedById = new Map(
    proposed.map(
      /** Key one proposed effective assertion by stable event identity. */
      (event) => [event.eventId, event]
    )
  );
  const result = new Set<string>();
  for (const eventId of new Set([...actualById.keys(), ...proposedById.keys()])) {
    const before = actualById.get(eventId);
    const after = proposedById.get(eventId);
    if (
      before !== undefined &&
      after !== undefined &&
      inventoryEventIntentFingerprint(before) ===
        inventoryEventIntentFingerprint(after)
    ) continue;
    for (const event of [before, after]) {
      if (event === undefined) continue;
      for (const effect of event.stockEffects) {
        if (effect.position.whereaboutsId !== undefined) {
          result.add(effect.position.whereaboutsId);
        }
      }
      for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
        if (transfer.from.whereaboutsId !== undefined) result.add(transfer.from.whereaboutsId);
        if (transfer.to.whereaboutsId !== undefined) result.add(transfer.to.whereaboutsId);
      }
    }
  }
  return [...result].sort(compareInventoryIdentityText);
}

/** Find the transitive event cone connected to modified resource identities. */
function inventoryAffectedHistoricalEventIds(
  actual: readonly InventoryCommittedEvent[],
  proposed: readonly InventoryCommittedEvent[]
): readonly string[] {
  const actualById = new Map(
    actual.map(
      /** Key one actual assertion by stable event identity. */
      (event) => [event.eventId, event]
    )
  );
  const proposedById = new Map(
    proposed.map(
      /** Key one proposed assertion by stable event identity. */
      (event) => [event.eventId, event]
    )
  );
  const changed = new Set<string>();
  const resourceKeys = new Set<string>();
  for (const eventId of new Set([...actualById.keys(), ...proposedById.keys()])) {
    const before = actualById.get(eventId);
    const after = proposedById.get(eventId);
    if (
      before === undefined ||
      after === undefined ||
      inventoryEventIntentFingerprint(before) !==
        inventoryEventIntentFingerprint(after)
    ) {
      changed.add(eventId);
      for (const key of inventoryEventDependencyKeys(before ?? after!)) {
        resourceKeys.add(key);
      }
    }
  }
  const dependencyKeysByEventId = new Map<string, readonly string[]>();
  for (const event of proposed) {
    if (!changed.has(event.eventId)) {
      dependencyKeysByEventId.set(
        event.eventId,
        inventoryEventDependencyKeys(event)
      );
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const event of proposed) {
      if (changed.has(event.eventId)) continue;
      const keys = dependencyKeysByEventId.get(event.eventId) ?? [];
      if (
        !keys.some(
          /** Detect whether this event touches the already-expanded dependency cone. */
          (key) => resourceKeys.has(key)
        )
      ) continue;
      changed.add(event.eventId);
      for (const key of keys) {
        if (!resourceKeys.has(key)) {
          resourceKeys.add(key);
          expanded = true;
        }
      }
    }
  }
  const result = [...changed];
  result.sort(compareInventoryIdentityText);
  return result;
}
