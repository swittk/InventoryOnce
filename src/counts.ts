import {
  assertMeasurementsMatchItem,
  assertPositionMatchesItem,
  type InventoryCatalog,
} from "./catalog.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
} from "./canonical.js";
import { inventoryEventIdForOperation } from "./commands.js";
import {
  InventoryEventKind,
  assertCanonicalInventoryTime,
  defineInventoryEvent,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryStockEffect,
} from "./events.js";
import {
  inventoryMeasurementsAreZero,
  inventoryMeasurementsFingerprint,
  nonNegativeInventoryMeasurements,
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  type InventoryMetadata,
  type InventoryStockPositionKey,
  type PartyId,
} from "./model.js";
import {
  findInventoryPositions,
  inventoryEventsInRecordSequence,
  projectInventoryEvents,
  type InventoryDeficitPolicy,
  type InventoryProjectionState,
} from "./projection.js";
import {
  assertPositionInsideSelector,
  inventoryStockSelectorIdentity,
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";

/** Durable lifecycle of one physical/cycle count. */
export enum InventoryCountStatus {
  /** Snapshot scope was opened but no complete observation has been recorded. */
  Started = "started",
  /** Complete observation was recorded against one durable event-stream position. */
  Observed = "observed",
  /** Discrepancy was reconciled while preserving later legitimate movements. */
  Completed = "completed",
  /** Operator explicitly abandoned this count without changing stock. */
  Abandoned = "abandoned",
}

/** One exact observed position and measurement vector. */
export interface InventoryCountObservationLine {
  /** Exact position physically counted. */
  readonly position: InventoryStockPositionKey;
  /** Exact observed primary plus independently measured quantities. */
  readonly measurements: InventoryMeasurementVector;
}

/** Current physical-count row including snapshot, observation, and completion evidence. */
export interface InventoryCount {
  /** Stable identity for this count. */
  readonly countId: string;
  /** Stable creation retry identity. */
  readonly operationId: string;
  /** Frozen item definition used for observations/reconciliation. */
  readonly itemRevisionId: string;
  /** Complete scope the observation promises to cover. */
  readonly selector: InventoryStockSelector;
  /** Time count work started. */
  readonly startedAt: string;
  /** Durable event-stream sequence visible when count work started. */
  readonly snapshotRecordSequence: number;
  /** Current lifecycle state. */
  readonly status: InventoryCountStatus;
  /** Time the physical observation was completed. */
  readonly observedAt?: string;
  /** Durable sequence visible when observation was saved; later pre-observation records still join the occurrence cut. */
  readonly observedThroughRecordSequence?: number;
  /** Exact observed rows; omitted eligible rows mean observed zero. */
  readonly observations: readonly InventoryCountObservationLine[];
  /** Time the count became terminal. */
  readonly statusAt?: string;
  /** Reconciliation event, absent when no discrepancy existed. */
  readonly reconciliationEventId?: string;
  /** Actor responsible for the count when known. */
  readonly actorId?: PartyId;
  /** Application/source row requesting the count. */
  readonly sourceReference?: string;
  /** Extra application facts that do not change count math. */
  readonly metadata?: InventoryMetadata;
}

/** Kind of immutable count lifecycle operation. */
export enum InventoryCountOperationKind {
  /** Open one count snapshot. */
  Start = "start",
  /** Record one complete physical observation. */
  Observe = "observe",
  /** Finalize reconciliation. */
  Complete = "complete",
  /** Abandon without stock adjustment. */
  Abandon = "abandon",
}

/** Immutable count-operation evidence used for retry comparison. */
export interface InventoryCountOperation {
  /** Stable retry identity. */
  readonly operationId: string;
  /** Count affected. */
  readonly countId: string;
  /** Lifecycle action. */
  readonly kind: InventoryCountOperationKind;
  /** Stable normalized intent fingerprint. */
  readonly intentFingerprint: string;
}

/** Current count rows plus append-only lifecycle operation evidence. */
export interface InventoryCountBook {
  /** Count rows keyed by stable count identity. */
  readonly counts: Readonly<Record<string, InventoryCount>>;
  /** Lifecycle operations keyed by operation identity. */
  readonly operations: Readonly<Record<string, InventoryCountOperation>>;
}

/** Result after applying/replaying one count lifecycle operation. */
export interface InventoryCountBookResult {
  /** Next book; unchanged on exact replay. */
  readonly book: InventoryCountBook;
  /** Current count row. */
  readonly count: InventoryCount;
  /** True when this exact lifecycle intent already exists. */
  readonly replayed: boolean;
}

/** Create an empty physical-count book. */
export function emptyInventoryCountBook(): InventoryCountBook {
  return { counts: {}, operations: {} };
}

/** Inputs for opening one physical-count snapshot. */
export interface StartInventoryCountInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current projection whose durable sequence becomes the snapshot. */
  readonly projection: InventoryProjectionState;
  /** Current count book. */
  readonly book: InventoryCountBook;
  /** Stable count identity. */
  readonly countId: string;
  /** Stable creation retry identity. */
  readonly operationId: string;
  /** Frozen item revision; defaults to selector item's active revision. */
  readonly itemRevisionId?: string;
  /** Complete scope that staff promise to observe. */
  readonly selector: InventoryStockSelector;
  /** Time count work started. */
  readonly startedAt: string;
  /** Actor responsible for this count. */
  readonly actorId?: PartyId;
  /** Application/source row requesting this count. */
  readonly sourceReference?: string;
  /** Extra application facts. */
  readonly metadata?: InventoryMetadata;
}

/** Open one count at the exact current durable event-stream sequence. */
export function startInventoryCount(
  input: StartInventoryCountInput
): InventoryCountBookResult {
  assertCanonicalInventoryTime(input.startedAt, "count startedAt");
  const requestedSelector = normalizeInventoryStockSelector(input.selector);
  const item =
    input.itemRevisionId === undefined
      ? input.catalog.activeItem(requestedSelector.itemId)
      : input.catalog.itemRevision(input.itemRevisionId);
  if (item.itemId !== requestedSelector.itemId) {
    throw new Error("Count selector item differs from frozen item revision.");
  }
  if (
    requestedSelector.itemRevisionIds !== undefined &&
    !requestedSelector.itemRevisionIds.includes(item.revisionId)
  ) {
    throw new Error("Count selector excludes the frozen item revision.");
  }
  // One count uses one measurement schema. Narrow an item-wide selector now so old revisions cannot enter later.
  const selector = normalizeInventoryStockSelector({
    ...requestedSelector,
    itemRevisionIds: [item.revisionId],
  });
  const fingerprint = inventoryIntentFingerprint([
    input.countId,
    input.operationId,
    item.revisionId,
    inventoryStockSelectorIdentity(selector),
    input.startedAt,
    String(input.projection.lastRecordSequence),
    input.actorId ?? null,
    input.sourceReference ?? null,
    inventoryMetadataFingerprint(input.metadata),
  ]);
  const replay = findCountOperationReplay(
    input.book,
    input.operationId,
    InventoryCountOperationKind.Start,
    input.countId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  if (input.book.counts[input.countId] !== undefined) {
    throw new Error(`Inventory count '${input.countId}' already exists.`);
  }
  const count: InventoryCount = {
    countId: input.countId,
    operationId: input.operationId,
    itemRevisionId: item.revisionId,
    selector,
    startedAt: input.startedAt,
    snapshotRecordSequence: input.projection.lastRecordSequence,
    status: InventoryCountStatus.Started,
    observations: [],
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
  const book = replaceCountWithOperation(input.book, count, {
    operationId: input.operationId,
    countId: input.countId,
    kind: InventoryCountOperationKind.Start,
    intentFingerprint: fingerprint,
  });
  return { book, count, replayed: false };
}

/** Inputs for recording one complete observation at the current durable sequence. */
export interface ObserveInventoryCountInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current projection whose sequence is frozen with this observation. */
  readonly projection: InventoryProjectionState;
  /** Current count book. */
  readonly book: InventoryCountBook;
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Started count being observed. */
  readonly countId: string;
  /** Time staff completed the physical observation. */
  readonly observedAt: string;
  /** Complete observed rows; eligible positions omitted here mean physically observed zero. */
  readonly observations: readonly InventoryCountObservationLine[];
}

/** Record one complete count observation without yet changing inventory truth. */
export function observeInventoryCount(
  input: ObserveInventoryCountInput
): InventoryCountBookResult {
  assertCanonicalInventoryTime(input.observedAt, "count observedAt");
  const count = input.book.counts[input.countId];
  if (count === undefined) throw new Error("Unknown inventory count.");
  const observations = normalizeCountObservations(
    input.catalog,
    count,
    input.observations
  );
  const normalizedInput: ObserveInventoryCountInput = {
    ...input,
    observations,
  };
  const fingerprint = observationFingerprint(normalizedInput, count);
  const replay = findCountOperationReplay(
    input.book,
    input.operationId,
    InventoryCountOperationKind.Observe,
    input.countId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  if (count.status !== InventoryCountStatus.Started) {
    throw new Error("Only a started inventory count can be observed.");
  }
  if (input.observedAt < count.startedAt) {
    throw new Error(
      "Count observation cannot happen before the count started."
    );
  }
  // The operation planner owns this cut. Staff code never guesses or races a journal sequence.
  const observedThroughRecordSequence = input.projection.lastRecordSequence;
  if (observedThroughRecordSequence < count.snapshotRecordSequence) {
    throw new Error(
      "Count observation projection is older than the frozen count snapshot."
    );
  }
  const value: InventoryCount = {
    ...count,
    status: InventoryCountStatus.Observed,
    observedAt: input.observedAt,
    observedThroughRecordSequence,
    observations,
  };
  const book = replaceCountWithOperation(input.book, value, {
    operationId: input.operationId,
    countId: input.countId,
    kind: InventoryCountOperationKind.Observe,
    intentFingerprint: fingerprint,
  });
  return { book, count: value, replayed: false };
}

/** Inputs for deriving one movement-safe count reconciliation plan. */
export interface CreateInventoryCountReconciliationPlanInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Full committed event history needed to project the physical observation-time cut. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Projection deficit rule used for historical replay. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Current count book. */
  readonly book: InventoryCountBook;
  /** Stable completion retry identity. */
  readonly operationId: string;
  /** Observed count to reconcile. */
  readonly countId: string;
  /** Time the reconciliation operation was requested/approved. */
  readonly completedAt: string;
  /** Optional actor overriding the count starter. */
  readonly actorId?: PartyId;
  /** Optional human reconciliation reason. */
  readonly reason?: string;
}

/** Side-effect-free count completion plan; event is absent when observation already matched truth. */
export interface InventoryCountReconciliationPlan {
  /** Count being completed. */
  readonly count: InventoryCount;
  /** Stable normalized completion intent fingerprint. */
  readonly intentFingerprint: string;
  /** Exact discrepancy event to commit before/with count completion. */
  readonly event?: InventoryEventDraft;
  /** True when this exact completion operation already exists. */
  readonly replayed: boolean;
}

/** Derive observed-minus-expected-at-observation, never current-balance replacement. */
export function createInventoryCountReconciliationPlan(
  input: CreateInventoryCountReconciliationPlanInput
): InventoryCountReconciliationPlan {
  assertCanonicalInventoryTime(input.completedAt, "count completedAt");
  const count = input.book.counts[input.countId];
  if (count === undefined) throw new Error("Unknown inventory count.");
  const fingerprint = countCompletionFingerprint(input, count);
  const replay = findCountOperationReplay(
    input.book,
    input.operationId,
    InventoryCountOperationKind.Complete,
    input.countId,
    fingerprint
  );
  if (replay !== undefined) {
    return {
      count: replay.count,
      intentFingerprint: fingerprint,
      replayed: true,
    };
  }
  if (
    count.status !== InventoryCountStatus.Observed ||
    count.observedAt === undefined ||
    count.observedThroughRecordSequence === undefined
  ) {
    throw new Error("Only a fully observed inventory count can be reconciled.");
  }
  if (input.completedAt < count.observedAt) {
    throw new Error(
      "Count reconciliation cannot happen before the observation."
    );
  }
  // Record order alone is wrong when an earlier physical movement arrives after the observation row.
  const expectedProjection = projectInventoryEventsAtOrBefore(
    input.catalog,
    input.events,
    input.deficitPolicy,
    count.observedAt
  );
  const expectedPositions = findInventoryPositions(
    expectedProjection,
    count.selector
  );
  const expectedByPosition = new Map<string, InventoryMeasurementVector>();
  for (const position of expectedPositions) {
    expectedByPosition.set(
      inventoryStockPositionIdentity(position.key),
      position.measurements
    );
  }
  const observedByPosition = new Map<string, InventoryCountObservationLine>();
  for (const observation of count.observations) {
    observedByPosition.set(
      inventoryStockPositionIdentity(observation.position),
      observation
    );
  }
  const positionIds = new Set<string>();
  for (const identity of expectedByPosition.keys()) positionIds.add(identity);
  for (const identity of observedByPosition.keys()) positionIds.add(identity);
  const orderedPositionIds = [...positionIds];
  orderedPositionIds.sort();

  const stockEffects: InventoryStockEffect[] = [];
  for (const positionId of orderedPositionIds) {
    const observation = observedByPosition.get(positionId);
    const expected = expectedByPosition.get(positionId);
    if (observation === undefined && expected === undefined) continue;
    const schema = observation?.measurements ?? expected;
    if (schema === undefined) continue;
    const observed =
      observation?.measurements ?? zeroInventoryMeasurements(schema);
    const expectedAtObservation = expected ?? zeroInventoryMeasurements(schema);
    const delta = subtractInventoryMeasurements(
      observed,
      expectedAtObservation
    );
    if (inventoryMeasurementsAreZero(delta)) continue;
    const position =
      observation?.position ??
      findExpectedPosition(expectedPositions, positionId);
    stockEffects.push({
      itemRevisionId: count.itemRevisionId,
      position,
      measurementsDelta: delta,
      metadata: {
        countId: count.countId,
        expectedAtObservation: inventoryMeasurementsFingerprint(
          expectedAtObservation
        ),
        observed: inventoryMeasurementsFingerprint(observed),
      },
    });
  }
  const event =
    stockEffects.length === 0
      ? undefined
      : defineInventoryEvent({
          catalog: input.catalog,
          event: {
            eventId: inventoryEventIdForOperation(input.operationId),
            operationId: input.operationId,
            kind: InventoryEventKind.CountAdjustment,
            occurredAt: count.observedAt,
            stockEffects,
            traceabilityChanges: [],
            ...((input.actorId ?? count.actorId) === undefined
              ? {}
              : { actorId: input.actorId ?? count.actorId }),
            ...(count.sourceReference === undefined
              ? {}
              : { sourceReference: count.sourceReference }),
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            metadata: {
              countId: count.countId,
              snapshotRecordSequence: count.snapshotRecordSequence,
              observedThroughRecordSequence:
                count.observedThroughRecordSequence,
              completedAt: input.completedAt,
            },
          },
        });
  return {
    count,
    intentFingerprint: fingerprint,
    ...(event === undefined ? {} : { event }),
    replayed: false,
  };
}

/** Replay every fact that physically occurred by the observation, including late durable rows. */
function projectInventoryEventsAtOrBefore(
  catalog: InventoryCatalog,
  events: readonly InventoryCommittedEvent[],
  deficitPolicy: InventoryDeficitPolicy,
  observedAt: string
): InventoryProjectionState {
  const ordered = inventoryEventsInRecordSequence(events);
  const occurrenceCut: InventoryCommittedEvent[] = [];
  let cutSequence = 1;
  for (const event of ordered) {
    if (event.occurredAt > observedAt) continue;
    // Historical replay needs contiguous local sequence numbers after later-occurring rows are removed.
    occurrenceCut.push({ ...event, recordSequence: cutSequence });
    cutSequence += 1;
  }
  return projectInventoryEvents({
    catalog,
    events: occurrenceCut,
    deficitPolicy,
  });
}

/** Inputs for atomically marking one reconciliation plan completed. */
export interface CompleteInventoryCountInput {
  /** Current count book. */
  readonly book: InventoryCountBook;
  /** Stable completion retry identity. */
  readonly operationId: string;
  /** Count being completed. */
  readonly countId: string;
  /** Stable fingerprint returned by the reconciliation plan. */
  readonly intentFingerprint: string;
  /** Completion time. */
  readonly completedAt: string;
  /** Committed discrepancy event; absent when no discrepancy existed. */
  readonly reconciliationEventId?: string;
}

/** Mark one observed count complete after its optional discrepancy event committed. */
export function completeInventoryCount(
  input: CompleteInventoryCountInput
): InventoryCountBookResult {
  assertCanonicalInventoryTime(input.completedAt, "count completion time");
  const replay = findCountOperationReplay(
    input.book,
    input.operationId,
    InventoryCountOperationKind.Complete,
    input.countId,
    input.intentFingerprint
  );
  if (replay !== undefined) return replay;
  const count = input.book.counts[input.countId];
  if (count === undefined) throw new Error("Unknown inventory count.");
  if (count.status !== InventoryCountStatus.Observed) {
    throw new Error("Only an observed inventory count can complete.");
  }
  if (count.observedAt === undefined || input.completedAt < count.observedAt) {
    throw new Error("Count completion cannot happen before the observation.");
  }
  const value: InventoryCount = {
    ...count,
    status: InventoryCountStatus.Completed,
    statusAt: input.completedAt,
    ...(input.reconciliationEventId === undefined
      ? {}
      : { reconciliationEventId: input.reconciliationEventId }),
  };
  const book = replaceCountWithOperation(input.book, value, {
    operationId: input.operationId,
    countId: input.countId,
    kind: InventoryCountOperationKind.Complete,
    intentFingerprint: input.intentFingerprint,
  });
  return { book, count: value, replayed: false };
}

/** Inputs for abandoning one started/observed count without stock adjustment. */
export interface AbandonInventoryCountInput {
  /** Current count book. */
  readonly book: InventoryCountBook;
  /** Stable lifecycle retry identity. */
  readonly operationId: string;
  /** Count being abandoned. */
  readonly countId: string;
  /** Abandonment occurrence time. */
  readonly occurredAt: string;
  /** Required plain reason for abandoning work. */
  readonly reason: string;
}

/** Abandon one non-terminal count without changing inventory truth. */
export function abandonInventoryCount(
  input: AbandonInventoryCountInput
): InventoryCountBookResult {
  assertCanonicalInventoryTime(input.occurredAt, "count abandon occurredAt");
  if (input.reason.trim().length === 0)
    throw new Error("Abandoned count needs reason.");
  const fingerprint = inventoryIntentFingerprint([
    input.countId,
    input.occurredAt,
    input.reason,
  ]);
  const replay = findCountOperationReplay(
    input.book,
    input.operationId,
    InventoryCountOperationKind.Abandon,
    input.countId,
    fingerprint
  );
  if (replay !== undefined) return replay;
  const count = input.book.counts[input.countId];
  if (count === undefined) throw new Error("Unknown inventory count.");
  if (
    count.status === InventoryCountStatus.Completed ||
    count.status === InventoryCountStatus.Abandoned
  ) {
    throw new Error("Terminal inventory count cannot be abandoned again.");
  }
  const lastCountWorkAt = count.observedAt ?? count.startedAt;
  if (input.occurredAt < lastCountWorkAt) {
    throw new Error(
      "Count abandonment cannot happen before the latest count work."
    );
  }
  const value: InventoryCount = {
    ...count,
    status: InventoryCountStatus.Abandoned,
    statusAt: input.occurredAt,
    metadata: {
      ...(count.metadata ?? {}),
      abandonmentReason: input.reason,
    },
  };
  const book = replaceCountWithOperation(input.book, value, {
    operationId: input.operationId,
    countId: input.countId,
    kind: InventoryCountOperationKind.Abandon,
    intentFingerprint: fingerprint,
  });
  return { book, count: value, replayed: false };
}

/** Validate, deduplicate, and sort complete observation rows. */
function normalizeCountObservations(
  catalog: InventoryCatalog,
  count: InventoryCount,
  observations: readonly InventoryCountObservationLine[]
): readonly InventoryCountObservationLine[] {
  const normalized: InventoryCountObservationLine[] = [];
  const seenPositions = new Set<string>();
  for (const observation of observations) {
    assertPositionInsideSelector(observation.position, count.selector);
    const item = catalog.itemRevision(observation.position.itemRevisionId);
    if (item.revisionId !== count.itemRevisionId) {
      throw new Error(
        "Count observation position differs from the frozen count revision."
      );
    }
    assertPositionMatchesItem(item, observation.position);
    assertMeasurementsMatchItem(item, observation.measurements, true);
    nonNegativeInventoryMeasurements(
      observation.measurements,
      "Count observation"
    );
    if (inventoryMeasurementsAreZero(observation.measurements)) {
      throw new Error(
        "Omit zero count observation rows; omission already means observed zero."
      );
    }
    const identity = inventoryStockPositionIdentity(observation.position);
    if (seenPositions.has(identity)) {
      throw new Error(`Count observation repeats position ${identity}.`);
    }
    seenPositions.add(identity);
    normalized.push(observation);
  }
  normalized.sort(compareObservationLine);
  return normalized;
}

/** Stable observation intent fingerprint. */
function observationFingerprint(
  input: ObserveInventoryCountInput,
  count: InventoryCount
): string {
  return inventoryIntentFingerprint([
    input.countId,
    input.observedAt,
    input.projection.lastRecordSequence,
    count.snapshotRecordSequence,
    input.observations.map(
      /** Turn one observation row into collision-free fingerprint parts. */
      (observation) => [
        inventoryStockPositionIdentity(observation.position),
        inventoryMeasurementsFingerprint(observation.measurements),
      ]
    ),
  ]);
}

/** Stable completion intent fingerprint independent of the derived discrepancy event. */
function countCompletionFingerprint(
  input: CreateInventoryCountReconciliationPlanInput,
  count: InventoryCount
): string {
  return inventoryIntentFingerprint([
    input.countId,
    input.completedAt,
    count.observedAt ?? null,
    count.observedThroughRecordSequence ?? null,
    input.actorId ?? null,
    input.reason ?? null,
  ]);
}

/** Find an expected projected position by deterministic identity or fail closed. */
function findExpectedPosition(
  positions: readonly {
    /** Exact projected position key. */
    readonly key: InventoryStockPositionKey;
  }[],
  identity: string
): InventoryStockPositionKey {
  for (const position of positions) {
    if (inventoryStockPositionIdentity(position.key) === identity)
      return position.key;
  }
  throw new Error(
    `Expected count position '${identity}' disappeared during reconciliation planning.`
  );
}

/** Return an exact operation replay or reject changed count intent. */
function findCountOperationReplay(
  book: InventoryCountBook,
  operationId: string,
  kind: InventoryCountOperationKind,
  countId: string,
  fingerprint: string
): InventoryCountBookResult | undefined {
  const earlier = book.operations[operationId];
  if (earlier === undefined) return undefined;
  if (
    earlier.kind !== kind ||
    earlier.countId !== countId ||
    earlier.intentFingerprint !== fingerprint
  ) {
    throw new Error("Count operationId was retried with changed intent.");
  }
  const count = book.counts[countId];
  if (count === undefined)
    throw new Error("Count operation references a missing count.");
  return { book, count, replayed: true };
}

/** Replace one count row and append one immutable lifecycle operation together. */
function replaceCountWithOperation(
  book: InventoryCountBook,
  count: InventoryCount,
  operation: InventoryCountOperation
): InventoryCountBook {
  if (book.operations[operation.operationId] !== undefined) {
    throw new Error(
      `Count operation '${operation.operationId}' already exists.`
    );
  }
  return {
    counts: { ...book.counts, [count.countId]: count },
    operations: { ...book.operations, [operation.operationId]: operation },
  };
}

/** Sort observation rows by exact position identity. */
function compareObservationLine(
  left: InventoryCountObservationLine,
  right: InventoryCountObservationLine
): number {
  return inventoryStockPositionIdentity(left.position).localeCompare(
    inventoryStockPositionIdentity(right.position)
  );
}
