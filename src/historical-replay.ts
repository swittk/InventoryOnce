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
  inventoryMeasurementAt,
  inventoryMeasurementVector,
  inventoryMeasurementsAreZero,
  negateInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurement,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventorySerialIdentity,
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
import { replayEffectiveStockAge } from "./stock-age.js";

/** Machine-readable reason one proposed historical scenario cannot become inventory truth. */
export type InventoryHistoricalReplayConflictCode =
  | "invalid-history"
  | "negative-stock"
  | "serialized-deficit"
  | "missing-anchor"
  | "duplicate-assertion";

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

/** Project effective history after separately checking the newly exposed deficits. */
function projectEffectiveInventoryEvents(
  catalog: InventoryCatalog,
  events: readonly InventoryCommittedEvent[]
): InventoryProjectionState {
  const effectiveHistory = {
    catalog,
    events,
    deficitPolicy: InventoryDeficitPolicy.Record,
    [replayEffectiveStockAge]: "effective-history",
  };
  return projectInventoryEvents(effectiveHistory);
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
  const ordered = sourceEvents === undefined
    ? orderedProjectionEvents(projection)
    : [...sourceEvents].sort(
        /** Replay one indexed component in exact durable order. */
        (left, right) => left.recordSequence - right.recordSequence
      );
  const actualEvents = reconcileInventoryHistoricalGraphEvents(
    effectiveInventoryHistoryEvents({ ordered })
  );
  const effectiveEvents = reconcileInventoryHistoricalGraphEvents(
    effectiveInventoryHistoryEvents({
      ordered,
      assertions,
      omittedAssertionIds,
      ...(rootReplacement === undefined ? {} : { rootReplacement }),
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
        historicalDeficitMagnitudeIncreased(
          previous.maximumDeficit,
          deficit.maximumDeficit
        ) ||
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
    actualProjection = projectEffectiveInventoryEvents(catalog, actualEvents);
    desired = projectEffectiveInventoryEvents(catalog, effectiveEvents);
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
      )?.measurements;
      const after = inventorySparseRecordValue(
        desired.positions,
        positionId
      )?.measurements;
      if (
        after !== undefined &&
        (before === undefined ||
          historicalSignedBalanceDecreased(before, after))
      ) {
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

/** Expand repairs into physical facts before the count selects events by occurrence. */
export function expandInventoryCountRepairAssertions(
  ordered: readonly InventoryCommittedEvent[]
): readonly InventoryCommittedEvent[] {
  if (!ordered.some(
    /** Skip assertion expansion for histories without a repair envelope. */
    (event) => event.kind === InventoryEventKind.HistoricalRepair
  )) return ordered;
  // Corrections retain their own observation rule and predecessor evidence.
  return effectiveInventoryHistoryEvents({
    ordered,
    retainCorrections: true,
  });
}

/** Collect current active embedded assertions, merge new evidence, then replay in deterministic order. */
function effectiveInventoryHistoryEvents({
  ordered,
  assertions = [],
  omittedAssertionIds = [],
  rootReplacement,
  retainCorrections = false,
}: {
  /** Retained event component in durable order. */
  readonly ordered: readonly InventoryCommittedEvent[];
  /** New late assertions to merge into effective history. */
  readonly assertions?: readonly InventoryPendingHistoricalAssertion[];
  /** Active embedded assertions to remove from effective history. */
  readonly omittedAssertionIds?: readonly string[];
  /** Optional retained root replacement used by correction planning. */
  readonly rootReplacement?: InventoryHistoricalRootReplacement;
  /** Count cuts apply committed corrections rather than rewriting their root events. */
  readonly retainCorrections?: boolean;
}): readonly InventoryCommittedEvent[] {
  const active = new Map<string, InventoryPendingHistoricalAssertion>();
  const ordinary: InventoryCommittedEvent[] = [];
  /** Last current-format replacement (including explicit omitted-root null) by root event. */
  const correctionByRoot = new Map<string, InventoryEventDraft | null>();
  for (const event of ordered) {
    if (event.kind === InventoryEventKind.Correction && !retainCorrections) {
      const rootId = event.correction?.correctsEventId;
      if (rootId === undefined) {
        throw new InventoryHistoricalReplayConflictError({
          code: "invalid-history",
          message: `Correction event '${event.eventId}' lost its root reference.`,
          eventId: event.eventId,
        });
      }
      if (event.correctionReplacement === undefined) {
        throw new InventoryHistoricalReplayConflictError({
          code: "invalid-history",
          message: `Correction event '${event.eventId}' has no retained replacement evidence.`,
          eventId: event.eventId,
        });
      }
      correctionByRoot.set(rootId, event.correctionReplacement);
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
    const replacement = correctionByRoot.get(event.eventId);
    if (replacement === undefined) {
      base.push(event);
      continue;
    }
    if (replacement === null) continue;
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
  const merged: InventoryHistoricalReplayEntry[] = base.map(
    /** Preserve each retained assertion's durable evidence time. */
    (event) => ({ event, recordedAtEpochMs: event.recordedAtEpochMs })
  );
  const embeddedEvents = new Set(
    pending.map(
      /** Identify embedded repair assertions before anchor insertion completes. */
      (entry) => entry.assertion.event
    )
  );
  for (const entry of pending) {
    insertHistoricalAssertion(merged, entry);
  }
  const usedOperationIds = new Set<string>();
  for (const entry of merged) {
    if (embeddedEvents.has(entry.event)) continue;
    usedOperationIds.add(entry.event.operationId);
  }
  let embeddedCounter = 0;
  return merged.map(
    /** Isolate embedded operationIds from ordinary operations inside reducer receipts while keeping disjoint eventIds intact. */
    (entry, index) => {
      if (!embeddedEvents.has(entry.event)) {
        return commitInventoryEvent(entry.event, entry.recordedAtEpochMs, index + 1);
      }
      let operationId = entry.event.operationId;
      if (usedOperationIds.has(operationId)) {
        embeddedCounter += 1;
        operationId = `inventory:historical-assertion-op:${embeddedCounter}`;
        while (usedOperationIds.has(operationId)) {
          embeddedCounter += 1;
          operationId = `inventory:historical-assertion-op:${embeddedCounter}`;
        }
      }
      usedOperationIds.add(operationId);
      return commitInventoryEvent(
        operationId === entry.event.operationId
          ? entry.event
          : { ...entry.event, operationId },
        entry.recordedAtEpochMs,
        index + 1
      );
    }
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

/** A retained fact in the temporary effective history. */
interface InventoryHistoricalReplayEntry {
  /** Effective event replayed into this temporary history. */
  readonly event: InventoryEventDraft | InventoryCommittedEvent;
  /** Durable time when the system learned this event. */
  readonly recordedAtEpochMs: number;
  /** An explicit ordering constraint on a previously inserted assertion. */
  readonly afterEventId?: string;
}

/** True when a retained correction edits a placement edge touched by these dependencies. */
function isSharedPlacementCorrection(
  event: InventoryEventDraft | InventoryCommittedEvent,
  dependencies: ReadonlySet<string>
): boolean {
  if (event.kind !== InventoryEventKind.Correction) return false;
  return (event.placementChanges ?? []).some(
    /** Match only corrections modifying the same placement edge. */
    (change) => dependencies.has("dep:placement-edge:" + change.nodeId)
  );
}

/** Match a stock correction that adds capacity at one exact source of an assertion. */
function isHistoricalStockSupplyCorrection(
  event: InventoryEventDraft | InventoryCommittedEvent,
  sourcePositionIds: ReadonlySet<string>
): boolean {
  return event.kind === InventoryEventKind.Correction && sourcePositionIds.size > 0 &&
    event.stockEffects.some(
      /** A correction must add primary stock to the same exact position that is debited. */
      (effect) => effect.measurementsDelta.primary.quantity.amountMinor > 0 &&
        sourcePositionIds.has(inventoryStockPositionIdentity(effect.position))
    );
}

/** Match a stock correction that removes positive stock for a serial received by an assertion. */
function isHistoricalSerialRemovalCorrection(
  event: InventoryEventDraft | InventoryCommittedEvent,
  destinationSerialIds: ReadonlySet<string>
): boolean {
  return event.kind === InventoryEventKind.Correction && destinationSerialIds.size > 0 &&
    event.stockEffects.some(
      /** A correction must remove positive stock on a serial the assertion receives. */
      (effect) => effect.position.serialId !== undefined &&
        effect.measurementsDelta.primary.quantity.amountMinor < 0 &&
        destinationSerialIds.has(inventorySerialIdentity(effect.position.itemId, effect.position.serialId))
    );
}

/** Insert after an explicit anchor or between the earlier and later facts using the same resources. */
function insertHistoricalAssertion(
  target: InventoryHistoricalReplayEntry[],
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
    /** Only events using these resources can constrain this assertion's replay order. */
    const dependencies = new Set(inventoryEventDependencyKeys(assertion.event));
    /** Exact stock positions this assertion needs to debit. */
    const sourcePositionIds = new Set<string>();
    /** Serialized identities this assertion receives so earlier omitting corrections precede it. */
    const destinationSerialIds = new Set<string>();
    for (const effect of assertion.event.stockEffects) {
      if (effect.measurementsDelta.primary.quantity.amountMinor < 0) {
        sourcePositionIds.add(inventoryStockPositionIdentity(effect.position));
      } else if (effect.position.serialId !== undefined && effect.measurementsDelta.primary.quantity.amountMinor > 0) {
        destinationSerialIds.add(inventorySerialIdentity(effect.position.itemId, effect.position.serialId));
      }
    }
    const occurredAt = assertion.event.occurredAtEpochMs;
    for (let index = 0; index < target.length; index += 1) {
      const event = target[index]!.event;
      // Keep shared topology corrections and earlier corrections that supply stock or clear a received serial.
      if (event.kind === InventoryEventKind.Correction && !isSharedPlacementCorrection(event, dependencies) &&
          (event.occurredAtEpochMs > occurredAt ||
            (!isHistoricalStockSupplyCorrection(event, sourcePositionIds) &&
              !isHistoricalSerialRemovalCorrection(event, destinationSerialIds)))) {
        continue;
      }
      if (event.occurredAtEpochMs <= occurredAt) {
        insertionIndex = index;
      } else if (inventoryEventDependencyKeys(event).some(
        /** A later event sharing a resource must see the assertion first. */
        (key) => dependencies.has(key)
      )) {
        // First put any backdated predecessors ahead of this later fact.
        const predecessors = bringForwardHistoricalPredecessors(target, index, occurredAt, dependencies, sourcePositionIds);
        if (predecessors > 0) insertionIndex = index + predecessors - 1;
        break;
      }
    }
  }
  target.splice(insertionIndex + 1, 0, {
    event: assertion.event,
    recordedAtEpochMs: pending.recordedAtEpochMs,
    ...(assertion.afterEventId === undefined ? {} : { afterEventId: assertion.afterEventId }),
  });
}

/** Move earlier related facts and their earlier predecessors ahead of the first later dependency. */
function bringForwardHistoricalPredecessors(
  target: InventoryHistoricalReplayEntry[],
  firstLater: number,
  occurredAt: number,
  dependencies: ReadonlySet<string>,
  sourcePositionIds: ReadonlySet<string>
): number {
  /** Events already ordered before the insertion slice satisfy anchor prerequisites immediately. */
  const priorEventIds = new Set<string>();
  for (let index = 0; index < firstLater; index += 1) {
    priorEventIds.add(target[index]!.event.eventId);
  }
  /** Earlier facts can be connected through ordinary keys or already-selected anchors. */
  const keysByIndex = new Map<number, readonly string[]>();
  /** Eligible earlier facts indexed by dependency key, including explicitly anchored supplies. */
  const indexesByKey = new Map<string, number[]>();
  /** Eligible in-slice positions by event id so anchored supplies can pull their anchor chain. */
  const eligibleIndexByEventId = new Map<string, number>();
  /** Superseded corrections can be required even when they changed no stock or placement. */
  const correctionIndexesById = new Map<string, number>();
  for (let index = firstLater; index < target.length; index += 1) {
    const entry = target[index]!;
    const { event } = entry;
    if (event.kind === InventoryEventKind.Correction) correctionIndexesById.set(event.eventId, index);
    if (
      index === firstLater ||
      event.occurredAtEpochMs > occurredAt ||
      (event.kind === InventoryEventKind.Correction && (event.placementChanges ?? []).length === 0 &&
        !isHistoricalStockSupplyCorrection(event, sourcePositionIds))
    ) {
      continue;
    }
    const keys = inventoryEventDependencyKeys(event);
    keysByIndex.set(index, keys);
    eligibleIndexByEventId.set(event.eventId, index);
    for (const key of keys) {
      const indexes = indexesByKey.get(key);
      if (indexes === undefined) indexesByKey.set(key, [index]);
      else indexes.push(index);
    }
  }
  /** Expand reached dependency keys while keeping anchored supplies contingent on eligible anchors. */
  const reached = new Set(dependencies);
  const pendingKeys = [...reached];
  const predecessors = new Set<number>();
  /** Resolve an eligible anchor prerequisite chain, returning in-slice anchors or undefined if blocked. */
  function resolveAnchorChain(startIndex: number): number[] | undefined {
    const chain: number[] = [];
    const seen = new Set<number>([startIndex]);
    let anchorId = target[startIndex]!.afterEventId;
    while (anchorId !== undefined) {
      if (priorEventIds.has(anchorId)) break;
      const anchorIndex = eligibleIndexByEventId.get(anchorId);
      if (anchorIndex === undefined || seen.has(anchorIndex)) return undefined;
      seen.add(anchorIndex);
      chain.push(anchorIndex);
      anchorId = target[anchorIndex]!.afterEventId;
    }
    return chain;
  }
  /** Select one predecessor and its anchor prerequisites, enqueueing newly reached resource keys. */
  function selectPredecessor(index: number): void {
    if (predecessors.has(index)) return;
    const anchorChain = resolveAnchorChain(index);
    if (anchorChain === undefined) return;
    const batch = [index, ...anchorChain];
    for (const selectedIndex of batch) {
      if (predecessors.has(selectedIndex)) continue;
      predecessors.add(selectedIndex);
      for (const dependency of keysByIndex.get(selectedIndex) ?? []) {
        if (reached.has(dependency)) continue;
        reached.add(dependency);
        pendingKeys.push(dependency);
      }
    }
  }
  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    for (const index of indexesByKey.get(key) ?? []) {
      selectPredecessor(index);
    }
  }
  if (predecessors.size === 0) return 0;

  // A selected correction's deltas require its durable predecessors, even when their effects
  // did not seed the closure. A predecessor already in the prefix stays where it is.
  for (const index of predecessors) {
    const supersededId = target[index]!.event.correction?.supersedesCorrectionEventId;
    if (supersededId === undefined) continue;
    const supersededIndex = correctionIndexesById.get(supersededId);
    if (supersededIndex !== undefined) predecessors.add(supersededIndex);
  }
  const earlier: InventoryHistoricalReplayEntry[] = [];
  const remaining: InventoryHistoricalReplayEntry[] = [];
  for (let index = firstLater; index < target.length; index += 1) {
    (predecessors.has(index) ? earlier : remaining).push(target[index]!);
  }
  // Keep unrelated facts in their original order and avoid a variable-size splice argument list.
  const ordered = orderHistoricalPredecessors(earlier);
  let index = firstLater;
  for (const entry of ordered) target[index++] = entry;
  for (const entry of remaining) target[index++] = entry;
  return ordered.length;
}

/** True when ready entry `left` precedes `right` by physical time, then original slice order. */
function isEarlierHistoricalReadyIndex(
  earlier: readonly InventoryHistoricalReplayEntry[],
  left: number,
  right: number
): boolean {
  const timeDelta =
    earlier[left]!.event.occurredAtEpochMs -
    earlier[right]!.event.occurredAtEpochMs;
  return timeDelta < 0 || (timeDelta === 0 && left < right);
}

/** Insert one unblocked predecessor index into the min-heap. */
function pushHistoricalReadyIndex(
  heap: number[],
  earlier: readonly InventoryHistoricalReplayEntry[],
  index: number
): void {
  heap.push(index);
  let child = heap.length - 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (isEarlierHistoricalReadyIndex(earlier, heap[parent]!, heap[child]!)) break;
    const swap = heap[parent]!;
    heap[parent] = heap[child]!;
    heap[child] = swap;
    child = parent;
  }
}

/** Pop the earliest unblocked predecessor index from the min-heap. */
function popHistoricalReadyIndex(
  heap: number[],
  earlier: readonly InventoryHistoricalReplayEntry[]
): number | undefined {
  if (heap.length === 0) return undefined;
  const root = heap[0]!;
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const smaller =
        right < heap.length &&
        isEarlierHistoricalReadyIndex(earlier, heap[right]!, heap[left]!)
          ? right
          : left;
      if (isEarlierHistoricalReadyIndex(earlier, heap[parent]!, heap[smaller]!)) break;
      const swap = heap[parent]!;
      heap[parent] = heap[smaller]!;
      heap[smaller] = swap;
      parent = smaller;
    }
  }
  return root;
}

/** Order moved predecessors by occurrence time while retaining in-slice anchor and correction dependencies. */
function orderHistoricalPredecessors(
  earlier: readonly InventoryHistoricalReplayEntry[]
): readonly InventoryHistoricalReplayEntry[] {
  const indexByEventId = new Map<string, number>();
  for (let index = 0; index < earlier.length; index += 1) {
    indexByEventId.set(earlier[index]!.event.eventId, index);
  }
  const dependentsByIndex = new Map<number, number[]>();
  const inDegree = new Array<number>(earlier.length).fill(0);
  /** Only constraints with both ends in this slice require the ready heap. */
  let hasOrderingConstraint = false;
  for (let index = 0; index < earlier.length; index += 1) {
    const { afterEventId, event } = earlier[index]!;
    for (const predecessorId of [afterEventId, event.correction?.supersedesCorrectionEventId]) {
      if (predecessorId === undefined) continue;
      const predecessorIndex = indexByEventId.get(predecessorId);
      if (predecessorIndex === undefined || predecessorIndex === index) continue;
      hasOrderingConstraint = true;
      inDegree[index] = (inDegree[index] ?? 0) + 1;
      const dependents = dependentsByIndex.get(predecessorIndex);
      if (dependents === undefined) dependentsByIndex.set(predecessorIndex, [index]);
      else dependents.push(index);
    }
  }
  if (!hasOrderingConstraint) {
    const sorted = [...earlier];
    sorted.sort(
      /** Keep the collected durable/anchor order for equal occurrences. */
      (left, right) => left.event.occurredAtEpochMs - right.event.occurredAtEpochMs
    );
    return sorted;
  }
  const readyHeap: number[] = [];
  for (let index = 0; index < earlier.length; index += 1) {
    if (inDegree[index] === 0) pushHistoricalReadyIndex(readyHeap, earlier, index);
  }
  const ordered: InventoryHistoricalReplayEntry[] = [];
  for (
    let chosenIndex = popHistoricalReadyIndex(readyHeap, earlier);
    chosenIndex !== undefined;
    chosenIndex = popHistoricalReadyIndex(readyHeap, earlier)
  ) {
    ordered.push(earlier[chosenIndex]!);
    for (const dependentIndex of dependentsByIndex.get(chosenIndex) ?? []) {
      const nextDegree = (inDegree[dependentIndex] ?? 0) - 1;
      inDegree[dependentIndex] = nextDegree;
      if (nextDegree === 0) pushHistoricalReadyIndex(readyHeap, earlier, dependentIndex);
    }
  }
  if (ordered.length < earlier.length) {
    for (let index = 0; index < earlier.length; index += 1) {
      if ((inDegree[index] ?? 0) > 0) ordered.push(earlier[index]!);
    }
  }
  return ordered;
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
    const redundantPlacement =
      event.kind === InventoryEventKind.Placement &&
      placementChanges.length === 0 &&
      event.stockEffects.length === 0;
    if (
      (redundantPlacement &&
        (event.placementNodeDefinitions?.length ?? 0) === 0) ||
      (event.kind === InventoryEventKind.Traceability &&
        traceabilityChanges.length === 0)
    ) {
      droppedGraphEventIds.add(event.eventId);
      continue;
    }
    // A redundant move may still establish durable placement-node metadata.
    const kind = redundantPlacement
      ? InventoryEventKind.PlacementNodeMetadata
      : event.kind;
    reconciled.push(
      commitInventoryEvent(
        {
          ...event,
          kind,
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

/** True when any measured axis reaches a deeper shortage, including optional axes. */
function historicalDeficitMagnitudeIncreased(
  earlier: InventoryMeasurementVector,
  proposed: InventoryMeasurementVector
): boolean {
  if (compareQuantity(proposed.primary.quantity, earlier.primary.quantity) > 0) {
    return true;
  }
  for (const measured of proposed.independent) {
    const previous = inventoryMeasurementAt(
      earlier,
      measured.axisId,
      measured.quantity.unit
    );
    if (compareQuantity(measured.quantity, previous) > 0) return true;
  }
  return false;
}

/** Keep each axis's largest historical deficit even when the axes peak at different times. */
function historicalMaximumDeficitMeasurements(
  earlier: InventoryMeasurementVector,
  proposed: InventoryMeasurementVector
): InventoryMeasurementVector {
  const primaryIncreased =
    compareQuantity(proposed.primary.quantity, earlier.primary.quantity) > 0;
  const primary = primaryIncreased ? proposed.primary : earlier.primary;
  // Most stocked items have only the primary axis; don't allocate a map for those.
  if (earlier.independent.length === 0 && proposed.independent.length === 0) {
    return primaryIncreased ? proposed : earlier;
  }
  const maximumByAxis = new Map<string, InventoryMeasurement>();
  for (const measured of earlier.independent) {
    maximumByAxis.set(measured.axisId, measured);
  }
  let changed = primaryIncreased;
  for (const measured of proposed.independent) {
    const previous = maximumByAxis.get(measured.axisId);
    if (
      previous === undefined ||
      compareQuantity(measured.quantity, previous.quantity) > 0
    ) {
      maximumByAxis.set(measured.axisId, measured);
      changed = true;
    }
  }
  return changed
    ? inventoryMeasurementVector(primary, [...maximumByAxis.values()])
    : earlier;
}

/** True when a currently open deficit loses stock on any measured axis. */
function historicalSignedBalanceDecreased(
  earlier: InventoryMeasurementVector,
  proposed: InventoryMeasurementVector
): boolean {
  if (compareQuantity(proposed.primary.quantity, earlier.primary.quantity) < 0) {
    return true;
  }
  for (const measured of proposed.independent) {
    const previous = inventoryMeasurementAt(
      earlier,
      measured.axisId,
      measured.quantity.unit
    );
    if (compareQuantity(measured.quantity, previous) < 0) return true;
  }
  return false;
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
        } else {
          current.maximumDeficit = historicalMaximumDeficitMeasurements(
            current.maximumDeficit,
            magnitude
          );
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
  /** Retained event -> one already-computed set of resource dependencies. */
  const dependencyKeysByEventId = new Map<string, readonly string[]>();
  /** Resource dependency -> unchanged event identities that directly reference it. */
  const eventIdsByResourceKey = new Map<string, string[]>();
  for (const event of proposed) {
    if (changed.has(event.eventId)) continue;
    const keys = inventoryEventDependencyKeys(event);
    dependencyKeysByEventId.set(event.eventId, keys);
    for (const key of keys) {
      const eventIds = eventIdsByResourceKey.get(key);
      if (eventIds === undefined) eventIdsByResourceKey.set(key, [event.eventId]);
      else eventIds.push(event.eventId);
    }
  }
  /** Newly reached resource keys, each expanded exactly once. */
  const pendingKeys = [...resourceKeys];
  while (pendingKeys.length > 0) {
    const key = pendingKeys.pop()!;
    for (const eventId of eventIdsByResourceKey.get(key) ?? []) {
      if (changed.has(eventId)) continue;
      changed.add(eventId);
      // Expand only this event's new dependencies; rescanning every prior
      // event would become quadratic for chains linked in reverse history order.
      for (const nextKey of dependencyKeysByEventId.get(eventId) ?? []) {
        if (resourceKeys.has(nextKey)) continue;
        resourceKeys.add(nextKey);
        pendingKeys.push(nextKey);
      }
    }
  }
  const result = [...changed];
  result.sort(compareInventoryIdentityText);
  return result;
}
