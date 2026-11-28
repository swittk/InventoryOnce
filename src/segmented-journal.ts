import { inventoryEventWhereaboutsMembership } from "./whereabouts-membership.js";
import { inventoryIntentFingerprint } from "./canonical.js";
import { inventorySha256 } from "./digest.js";
import {
  inventoryEventIntentFingerprint,
  InventoryEventKind,
  type InventoryCommittedEvent,
} from "./events.js";
import {
  cloneInventoryRetainedData,
  createInventorySparseRecord,
  setInventorySparseRecordValue,
} from "./sparse-record.js";
import {
  createInventoryEventPage,
  inventoryEventDependencyIndexKeys,
  inventoryEventEffectiveKinds,
  inventoryEventMatchesQuery,
  inventoryEventQueryResourceKeyGroups,
  inventoryEventQuerySequenceWindow,
  inventoryEventResourceKeys,
  normalizeInventoryEventQuery,
  InventoryEventQueryDirection,
  type InventoryEventPage,
  type InventoryEventQuery,
} from "./event-query.js";

/** Adapter-local journal reads may be synchronous or asynchronous. */
export type InventorySegmentedJournalResult<T> = T | Promise<T>;

/** Canonical flat journal/index projection materialized only for export/proof compatibility. */
export interface InventoryEventJournalMaterialization {
  /** Every retained committed event keyed by event id. */
  readonly events: Readonly<Record<string, InventoryCommittedEvent>>;
  /** Durable sequence -> event id. */
  readonly eventIdsBySequence: Readonly<Record<string, string>>;
  /** Stable operation id -> event id. */
  readonly eventIdByOperationId: Readonly<Record<string, string>>;
  /** Whereabouts lifecycle -> durable sequences touching that cohort. */
  readonly eventSequencesByWhereaboutsId: Readonly<
    Record<string, readonly number[]>
  >;
  /** Retained root event -> current direct correction event. */
  readonly correctionEventIdByCorrectedEventId: Readonly<
    Record<string, string>
  >;
  /** Highest appended durable sequence. */
  readonly lastRecordSequence: number;
}

/** Read-only append journal/index contract suitable for database/native adapters. */
export interface InventorySegmentedEventJournalReader {
  /** Highest committed sequence currently retained. */
  lastRecordSequence(): InventorySegmentedJournalResult<number>;
  /** Authenticated root over every exact committed event. */
  contentRoot(): InventorySegmentedJournalResult<string>;
  /** Read one event by stable event identity. */
  event(eventId: string): InventorySegmentedJournalResult<InventoryCommittedEvent | undefined>;
  /** Read one event by idempotency operation identity. */
  eventByOperation(
    operationId: string
  ): InventorySegmentedJournalResult<InventoryCommittedEvent | undefined>;
  /** Read one event by durable total-order sequence. */
  eventBySequence(
    recordSequence: number
  ): InventorySegmentedJournalResult<InventoryCommittedEvent | undefined>;
  /** Read durable sequences touching one exact whereabouts lifecycle. */
  sequencesForWhereabouts(
    whereaboutsId: string
  ): InventorySegmentedJournalResult<readonly number[]>;
  /** Read the current direct correction event for one retained root event. */
  currentCorrectionFor(
    correctedEventId: string
  ): InventorySegmentedJournalResult<InventoryCommittedEvent | undefined>;
  /** Explicitly materialize the canonical flat journal/index projection for export and proof. */
  materialize(): InventorySegmentedJournalResult<InventoryEventJournalMaterialization>;
}

/** Internal/resource-index query used by scoped historical replay planners. */
export interface InventorySegmentedEventResourceQuery {
  /** Non-empty domain-separated resource keys; events touching any are returned. */
  readonly resourceKeys: readonly string[];
  /** Stable pagination cursor. */
  readonly afterRecordSequence?: number;
  /** Maximum events returned; defaults/caps at 1,000. */
  readonly limit?: number;
}

/** Cursor page for the internal resource-indexed historical dependency planner. */
export interface InventorySegmentedResourceEventPage extends InventoryEventPage {
  /** Exclusive durable sequence for the next internal dependency page. */
  readonly nextAfterRecordSequence?: number;
}

/** Optional indexed event-query capability, separate from the canonical event journal. */
export interface InventorySegmentedEventQueryReader {
  /** Query exact retained envelopes/events in durable order using adapter-native indexes. */
  queryEvents(
    input: InventoryEventQuery
  ): InventorySegmentedJournalResult<InventoryEventPage>;
  /** Query the union of exact internal resource-index rows. */
  queryEventsByResourceKeys(
    input: InventorySegmentedEventResourceQuery
  ): InventorySegmentedJournalResult<InventorySegmentedResourceEventPage>;
}

/** Mutable journal contract used inside one adapter-native publication transaction. */
export interface InventorySegmentedEventJournal
  extends InventorySegmentedEventJournalReader {
  /** Append exactly the next committed event under monotonic durable order. */
  append(
    event: InventoryCommittedEvent
  ): InventorySegmentedJournalResult<void>;
}

/** Inputs for constructing the reference segmented journal. */
export interface CreateInMemoryInventorySegmentedEventJournalInput {
  /** Existing committed events in arbitrary input order. */
  readonly events?: readonly InventoryCommittedEvent[];
}

/** One fully validated active-assertion index mutation. */
interface InventoryPreparedJournalAssertionMutation {
  /** Stable embedded assertion identity. */
  readonly assertionId: string;
  /** Exact public/dependency keys retained for that assertion. */
  readonly resourceKeys: readonly string[];
}

/** Side-effect-free preparation for one append-only journal mutation. */
interface InventoryPreparedJournalAppend {
  /** Defensive retained copy of the event being appended. */
  readonly retained: InventoryCommittedEvent;
  /** Exact whereabouts cohorts touched directly or through correction roots. */
  readonly touchedWhereaboutsIds: readonly string[];
  /** Complete resource-key set for the envelope and embedded evidence. */
  readonly resourceKeys: readonly string[];
  /** Existing assertion rows removed only after every validation passes. */
  readonly omittedAssertions: readonly InventoryPreparedJournalAssertionMutation[];
  /** New assertion rows inserted only after every validation passes. */
  readonly addedAssertions: readonly InventoryPreparedJournalAssertionMutation[];
  /** Top-level and embedded physical event kinds. */
  readonly kinds: readonly InventoryEventKind[];
  /** Precomputed authenticated event-root leaf. */
  readonly leaf: InventoryJournalRootLeaf;
}

/** One forward-only pointer into sorted resource-sequence postings. */
interface InventoryResourcePostingCursor {
  /** Immutable ascending record sequences for one indexed resource key. */
  readonly rows: readonly number[];
  /** Index of this cursor's next unconsumed sequence. */
  index: number;
}

/** Reference append-only indexed event journal. */
export class InMemoryInventorySegmentedEventJournal
  implements InventorySegmentedEventJournal, InventorySegmentedEventQueryReader
{
  /** Event rows keyed by exact event identity. */
  private readonly eventsById = new Map<string, InventoryCommittedEvent>();
  /** Durable sequence -> event id. */
  private readonly eventIdBySequence = new Map<number, string>();
  /** Stable operation id -> event id. */
  private readonly eventIdByOperation = new Map<string, string>();
  /** Whereabouts lifecycle -> ordered durable sequences. */
  private readonly sequencesByWhereabouts = new Map<string, number[]>();
  /** Root event -> current direct correction event id. */
  private readonly correctionByRootEvent = new Map<string, string>();
  /** Resource identity -> ordered durable sequences touching that resource. */
  private readonly sequencesByResourceKey = new Map<string, number[]>();
  /** Top-level/embedded assertion kind -> ordered durable envelope sequences. */
  private readonly sequencesByKind = new Map<InventoryEventKind, number[]>();
  /** Corrected retained root -> every correction sequence. */
  private readonly sequencesByCorrectionRoot = new Map<string, number[]>();
  /** Active embedded assertion -> its public/dependency resource index keys. */
  private readonly resourceKeysByAssertionId = new Map<
    string,
    readonly string[]
  >();
  /** Highest appended sequence. */
  private lastSequence = 0;
  /** Order-independent primary 256-bit event aggregate. */
  private primaryRootSum = 0n;
  /** Independent secondary 256-bit event aggregate. */
  private secondaryRootSum = 0n;

  /** Build one indexed journal from already-committed events. */
  constructor(input: CreateInMemoryInventorySegmentedEventJournalInput = {}) {
    const events = [...(input.events ?? [])];
    events.sort(
      /** Rebuild in durable order regardless of input order. */
      (left, right) => left.recordSequence - right.recordSequence
    );
    for (const event of events) this.append(event);
  }

  /** Return the highest committed sequence. */
  lastRecordSequence(): number {
    return this.lastSequence;
  }

  /** Return one constant-size authenticated root over exact retained events. */
  contentRoot(): string {
    return inventorySha256(
      inventoryIntentFingerprint([
        "inventory-event-segment-root-v1",
        this.eventsById.size,
        this.lastSequence,
        inventoryJournalRootHex(this.primaryRootSum),
        inventoryJournalRootHex(this.secondaryRootSum),
      ])
    );
  }

  /** Read one exact retained event. */
  event(eventId: string): InventoryCommittedEvent | undefined {
    const event = this.eventsById.get(eventId);
    return event === undefined ? undefined : cloneInventoryRetainedData(event);
  }

  /** Read one exact event through its operation/idempotency index. */
  eventByOperation(operationId: string): InventoryCommittedEvent | undefined {
    const eventId = this.eventIdByOperation.get(operationId);
    return eventId === undefined ? undefined : this.event(eventId);
  }

  /** Read one exact event through durable total order. */
  eventBySequence(recordSequence: number): InventoryCommittedEvent | undefined {
    const eventId = this.eventIdBySequence.get(recordSequence);
    return eventId === undefined ? undefined : this.event(eventId);
  }

  /** Read immutable lifecycle sequence evidence for one whereabouts cohort. */
  sequencesForWhereabouts(whereaboutsId: string): readonly number[] {
    return [...(this.sequencesByWhereabouts.get(whereaboutsId) ?? [])];
  }

  /** Read the current direct correction event for one retained root event. */
  currentCorrectionFor(
    correctedEventId: string
  ): InventoryCommittedEvent | undefined {
    const eventId = this.correctionByRootEvent.get(correctedEventId);
    return eventId === undefined ? undefined : this.event(eventId);
  }

  /** Query one indexed durable page without materializing the complete journal. */
  queryEvents(input: InventoryEventQuery): InventoryEventPage {
    const query = normalizeInventoryEventQuery(input);
    const window = inventoryEventQuerySequenceWindow(query, this.lastSequence);
    const candidateGroups: Set<number>[] = [];
    for (const resourceKeys of inventoryEventQueryResourceKeyGroups(query)) {
      const union = new Set<number>();
      for (const key of resourceKeys) {
        for (const sequence of this.sequencesByResourceKey.get(key) ?? []) {
          union.add(sequence);
        }
      }
      candidateGroups.push(union);
    }
    if (query.kinds !== undefined) {
      const union = new Set<number>();
      for (const kind of query.kinds) {
        for (const sequence of this.sequencesByKind.get(kind) ?? []) {
          union.add(sequence);
        }
      }
      candidateGroups.push(union);
    }
    if (query.correctsEventIds !== undefined) {
      const union = new Set<number>();
      for (const correctedEventId of query.correctsEventIds) {
        for (const sequence of
          this.sequencesByCorrectionRoot.get(correctedEventId) ?? []) {
          union.add(sequence);
        }
      }
      candidateGroups.push(union);
    }

    let candidates: readonly number[] | undefined;
    if (candidateGroups.length !== 0) {
      candidateGroups.sort(
        /** Probe the smallest candidate set before intersecting wider groups. */
        (left, right) => left.size - right.size
      );
      const [smallest, ...rest] = candidateGroups;
      const selected: number[] = [];
      for (const sequence of smallest ?? []) {
        if (
          rest.every(
            /** Require this sequence in every independently filtered group. */
            (group) => group.has(sequence)
          )
        ) selected.push(sequence);
      }
      selected.sort(
        query.direction === InventoryEventQueryDirection.Ascending
          ? compareAscendingEventSequence
          : compareDescendingEventSequence
      );
      candidates = selected;
    }

    const events: InventoryCommittedEvent[] = [];
    let hasMore = false;
    /** Visit one in-window candidate; true means one further match filled the page. */
    const visit = (sequence: number): boolean => {
      const eventId = this.eventIdBySequence.get(sequence);
      const event = eventId === undefined ? undefined : this.eventsById.get(eventId);
      if (event === undefined || event.recordSequence !== sequence) {
        throw new Error(
          `Segmented event-query index disagrees at recordSequence ${sequence}.`
        );
      }
      if (!inventoryEventMatchesQuery(event, query)) return false;
      if (events.length === query.limit) {
        hasMore = true;
        return true;
      }
      events.push(cloneInventoryRetainedData(event));
      return false;
    };

    if (candidates === undefined) {
      for (
        let sequence = window.firstRecordSequence;
        window.step === 1
          ? sequence <= window.lastRecordSequence
          : sequence >= window.lastRecordSequence;
        sequence += window.step
      ) {
        if (visit(sequence)) break;
      }
    } else {
      for (const sequence of candidates) {
        if (window.step === 1) {
          if (sequence < window.firstRecordSequence) continue;
          if (sequence > window.lastRecordSequence) break;
        } else {
          if (sequence > window.firstRecordSequence) continue;
          if (sequence < window.lastRecordSequence) break;
        }
        if (visit(sequence)) break;
      }
    }
    return createInventoryEventPage(
      query,
      this.lastSequence,
      events,
      hasMore
    );
  }

  /** Query exact resource-index rows for a dependency-closure planner. */
  queryEventsByResourceKeys(
    input: InventorySegmentedEventResourceQuery
  ): InventorySegmentedResourceEventPage {
    if (input.resourceKeys.length === 0) {
      throw new Error("Resource event query needs at least one resource key.");
    }
    const limit = input.limit ?? 1_000;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error(
        "Resource event query limit must be a positive safe integer at most 1,000."
      );
    }
    const after = input.afterRecordSequence ?? 0;
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new Error(
        "Resource event query afterRecordSequence must be a non-negative safe integer."
      );
    }
    // Each posting list is already ascending; advance directly to the requested
    // cursor before merging, rather than collecting/sorting all retained history.
    const heap: InventoryResourcePostingCursor[] = [];
    for (const key of new Set(input.resourceKeys)) {
      if (key.length === 0) {
        throw new Error("Resource event query key must not be empty.");
      }
      const rows = this.sequencesByResourceKey.get(key) ?? [];
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle]! <= after) low = middle + 1;
        else high = middle;
      }
      if (low === rows.length) continue;
      const cursor: InventoryResourcePostingCursor = { rows, index: low };
      const sequence = rows[low]!;
      let position = heap.length;
      while (position > 0) {
        const parent = Math.floor((position - 1) / 2);
        const parentCursor = heap[parent]!;
        if (parentCursor.rows[parentCursor.index]! <= sequence) break;
        heap[position] = parentCursor;
        position = parent;
      }
      heap[position] = cursor;
    }

    const ordered: number[] = [];
    // One extra distinct candidate determines whether another page exists.
    while (heap.length > 0 && ordered.length <= limit) {
      const first = heap[0]!;
      const sequence = first.rows[first.index]!;
      if (ordered[ordered.length - 1] !== sequence) ordered.push(sequence);

      const nextIndex = first.index + 1;
      let nextCursor: InventoryResourcePostingCursor;
      if (nextIndex < first.rows.length) {
        first.index = nextIndex;
        nextCursor = first;
      } else {
        // Replace the exhausted heap root with its last cursor.
        nextCursor = heap.pop()!;
        if (heap.length === 0) break;
      }

      let position = 0;
      while (2 * position + 1 < heap.length) {
        const left = 2 * position + 1;
        const right = left + 1;
        let smallest = left;
        if (
          right < heap.length &&
          heap[right]!.rows[heap[right]!.index]! <
            heap[left]!.rows[heap[left]!.index]!
        ) {
          smallest = right;
        }
        if (
          nextCursor.rows[nextCursor.index]! <=
          heap[smallest]!.rows[heap[smallest]!.index]!
        ) break;
        heap[position] = heap[smallest]!;
        position = smallest;
      }
      heap[position] = nextCursor;
    }
    const events: InventoryCommittedEvent[] = [];
    for (const sequence of ordered.slice(0, limit)) {
      const eventId = this.eventIdBySequence.get(sequence);
      const event = eventId === undefined ? undefined : this.eventsById.get(eventId);
      if (event === undefined || event.recordSequence !== sequence) {
        throw new Error(
          `Segmented resource index disagrees at recordSequence ${sequence}.`
        );
      }
      events.push(cloneInventoryRetainedData(event));
    }
    return {
      throughRecordSequence: this.lastSequence,
      events,
      ...(ordered.length > limit && events.length !== 0
        ? {
            nextAfterRecordSequence:
              events[events.length - 1]!.recordSequence,
          }
        : {}),
    };
  }

  /** Validate every append invariant without mutating journal rows or indexes. */
  validateAppend(event: InventoryCommittedEvent): void {
    this.prepareAppend(event);
  }

  /** Append one exact committed event and update only its touched indexes/root leaves. */
  append(event: InventoryCommittedEvent): void {
    const prepared = this.prepareAppend(event);
    const retained = prepared.retained;
    const correction = retained.correction;

    for (const key of prepared.resourceKeys) {
      appendJournalSequence(
        this.sequencesByResourceKey,
        key,
        retained.recordSequence
      );
    }
    for (const kind of prepared.kinds) {
      appendJournalSequence(
        this.sequencesByKind,
        kind,
        retained.recordSequence
      );
    }
    if (correction !== undefined) {
      appendJournalSequence(
        this.sequencesByCorrectionRoot,
        correction.correctsEventId,
        retained.recordSequence
      );
    }
    for (const omitted of prepared.omittedAssertions) {
      this.resourceKeysByAssertionId.delete(omitted.assertionId);
    }
    for (const added of prepared.addedAssertions) {
      this.resourceKeysByAssertionId.set(
        added.assertionId,
        added.resourceKeys
      );
    }

    this.eventsById.set(retained.eventId, retained);
    this.eventIdBySequence.set(retained.recordSequence, retained.eventId);
    this.eventIdByOperation.set(retained.operationId, retained.eventId);
    for (const whereaboutsId of prepared.touchedWhereaboutsIds) {
      const sequences = this.sequencesByWhereabouts.get(whereaboutsId) ?? [];
      sequences.push(retained.recordSequence);
      this.sequencesByWhereabouts.set(whereaboutsId, sequences);
    }
    if (correction !== undefined) {
      this.correctionByRootEvent.set(
        correction.correctsEventId,
        retained.eventId
      );
    }
    this.primaryRootSum = inventoryNormalizeJournalRootSum(
      this.primaryRootSum + prepared.leaf.primary
    );
    this.secondaryRootSum = inventoryNormalizeJournalRootSum(
      this.secondaryRootSum + prepared.leaf.secondary
    );
    this.lastSequence = retained.recordSequence;
  }

  /** Compute every fallible append decision before any journal mutation occurs. */
  private prepareAppend(
    event: InventoryCommittedEvent
  ): InventoryPreparedJournalAppend {
    const retained = cloneInventoryRetainedData(event);
    if (
      !Number.isSafeInteger(retained.recordSequence) ||
      retained.recordSequence <= 0
    ) {
      throw new Error(
        "Segmented journal recordSequence must be a positive safe integer."
      );
    }
    if (retained.recordSequence !== this.lastSequence + 1) {
      throw new Error(
        `Segmented journal expected recordSequence ${this.lastSequence + 1}, not ${retained.recordSequence}.`
      );
    }
    if (this.eventsById.has(retained.eventId)) {
      throw new Error(
        `Segmented journal eventId '${retained.eventId}' already exists.`
      );
    }
    if (this.eventIdByOperation.has(retained.operationId)) {
      throw new Error(
        `Segmented journal operationId '${retained.operationId}' already exists.`
      );
    }

    /** The retained ordinary root also contributes its direct cohort evidence. */
    let correctedRoot: InventoryCommittedEvent | undefined;
    const resourceKeys = new Set([
      ...inventoryEventResourceKeys(retained),
      ...inventoryEventDependencyIndexKeys(retained),
    ]);
    const correction = retained.correction;
    if (correction !== undefined) {
      const corrected = this.eventsById.get(correction.correctsEventId);
      correctedRoot = corrected;
      if (corrected === undefined) {
        throw new Error(
          `Segmented journal correction target '${correction.correctsEventId}' does not exist.`
        );
      }
      if (corrected.kind === InventoryEventKind.Correction) {
        throw new Error(
          "Segmented journal correction must name the retained root event."
        );
      }
      const currentCorrection = this.correctionByRootEvent.get(
        correction.correctsEventId
      );
      if (currentCorrection === undefined) {
        if (correction.supersedesCorrectionEventId !== undefined) {
          throw new Error(
            "First segmented journal correction cannot supersede a missing correction."
          );
        }
      } else if (
        correction.supersedesCorrectionEventId !== currentCorrection
      ) {
        throw new Error(
          `Segmented journal correction must supersede '${currentCorrection}'.`
        );
      }
      for (const key of [
        ...inventoryEventResourceKeys(corrected),
        ...inventoryEventDependencyIndexKeys(corrected),
      ]) {
        resourceKeys.add(key);
      }
    }

    const omittedAssertions: InventoryPreparedJournalAssertionMutation[] = [];
    const addedAssertions: InventoryPreparedJournalAssertionMutation[] = [];
    const repair = retained.historicalRepair;
    if (repair !== undefined) {
      const omittedIds = new Set<string>();
      for (const assertionId of repair.omittedAssertionIds) {
        if (omittedIds.has(assertionId)) {
          throw new Error(
            `Segmented journal historical repair repeats omitted assertion '${assertionId}'.`
          );
        }
        omittedIds.add(assertionId);
        const earlierKeys = this.resourceKeysByAssertionId.get(assertionId);
        if (earlierKeys === undefined) {
          throw new Error(
            `Segmented journal historical repair omits unknown assertion '${assertionId}'.`
          );
        }
        omittedAssertions.push({
          assertionId,
          resourceKeys: earlierKeys,
        });
        for (const key of earlierKeys) resourceKeys.add(key);
      }

      const addedIds = new Set<string>();
      for (const assertion of repair.assertions) {
        if (
          addedIds.has(assertion.assertionId) ||
          (this.resourceKeysByAssertionId.has(assertion.assertionId) &&
            !omittedIds.has(assertion.assertionId))
        ) {
          throw new Error(
            `Segmented journal historical assertion '${assertion.assertionId}' already exists.`
          );
        }
        addedIds.add(assertion.assertionId);
        const assertionKeys = [
          ...new Set([
            ...inventoryEventResourceKeys(assertion.event),
            ...inventoryEventDependencyIndexKeys(assertion.event),
          ]),
        ].sort();
        addedAssertions.push({
          assertionId: assertion.assertionId,
          resourceKeys: assertionKeys,
        });
        for (const key of assertionKeys) resourceKeys.add(key);
      }
    }

    const kinds = inventoryEventEffectiveKinds(retained);
    return {
      retained,
      touchedWhereaboutsIds: inventoryEventWhereaboutsMembership(retained, correctedRoot),
      resourceKeys: [...resourceKeys].sort(),
      omittedAssertions,
      addedAssertions,
      kinds,
      leaf: inventoryJournalEventLeaf(retained),
    };
  }

  /** Materialize the canonical flat event/index projection on explicit request only. */
  materialize(): InventoryEventJournalMaterialization {
    const events = createInventorySparseRecord<InventoryCommittedEvent>();
    const eventIdsBySequence = createInventorySparseRecord<string>();
    const eventIdByOperationId = createInventorySparseRecord<string>();
    const eventSequencesByWhereaboutsId =
      createInventorySparseRecord<readonly number[]>();
    const correctionEventIdByCorrectedEventId =
      createInventorySparseRecord<string>();

    const eventIds = [...this.eventsById.keys()];
    eventIds.sort();
    for (const eventId of eventIds) {
      const event = this.eventsById.get(eventId);
      if (event !== undefined) {
        setInventorySparseRecordValue(
          events,
          eventId,
          cloneInventoryRetainedData(event)
        );
      }
    }
    for (let sequence = 1; sequence <= this.lastSequence; sequence += 1) {
      const eventId = this.eventIdBySequence.get(sequence);
      if (eventId !== undefined) {
        setInventorySparseRecordValue(
          eventIdsBySequence,
          String(sequence),
          eventId
        );
      }
    }
    const operationIds = [...this.eventIdByOperation.keys()];
    operationIds.sort();
    for (const operationId of operationIds) {
      const eventId = this.eventIdByOperation.get(operationId);
      if (eventId !== undefined) {
        setInventorySparseRecordValue(
          eventIdByOperationId,
          operationId,
          eventId
        );
      }
    }
    const whereaboutsIds = [...this.sequencesByWhereabouts.keys()];
    whereaboutsIds.sort();
    for (const whereaboutsId of whereaboutsIds) {
      setInventorySparseRecordValue(
        eventSequencesByWhereaboutsId,
        whereaboutsId,
        [...(this.sequencesByWhereabouts.get(whereaboutsId) ?? [])]
      );
    }
    const correctedEventIds = [...this.correctionByRootEvent.keys()];
    correctedEventIds.sort();
    for (const correctedEventId of correctedEventIds) {
      const correctionEventId = this.correctionByRootEvent.get(
        correctedEventId
      );
      if (correctionEventId !== undefined) {
        setInventorySparseRecordValue(
          correctionEventIdByCorrectedEventId,
          correctedEventId,
          correctionEventId
        );
      }
    }

    return {
      events,
      eventIdsBySequence,
      eventIdByOperationId,
      eventSequencesByWhereaboutsId,
      correctionEventIdByCorrectedEventId,
      lastRecordSequence: this.lastSequence,
    };
  }
}

/** Create the reference segmented event journal. */
export function createInMemoryInventorySegmentedEventJournal(
  input: CreateInMemoryInventorySegmentedEventJournalInput = {}
): InMemoryInventorySegmentedEventJournal {
  return new InMemoryInventorySegmentedEventJournal(input);
}

/** Append one monotonically increasing sequence to an index row. */
function appendJournalSequence<Key>(
  index: Map<Key, number[]>,
  key: Key,
  sequence: number
): void {
  const sequences = index.get(key) ?? [];
  sequences.push(sequence);
  index.set(key, sequences);
}

/** Compare durable event sequences oldest first. */
function compareAscendingEventSequence(left: number, right: number): number {
  return left - right;
}

/** Compare durable event sequences newest first. */
function compareDescendingEventSequence(left: number, right: number): number {
  return right - left;
}

/** 256-bit modular field used by the order-independent event segment root. */
const inventoryJournalRootModulus = 1n << 256n;

/** Two independent authenticated leaf contributions for one retained journal event. */
interface InventoryJournalRootLeaf {
  /** Primary 256-bit modular contribution. */
  readonly primary: bigint;
  /** Independent secondary 256-bit modular contribution. */
  readonly secondary: bigint;
}

/** Bind one exact committed event to two independent leaf hashes. */
function inventoryJournalEventLeaf(
  event: InventoryCommittedEvent
): InventoryJournalRootLeaf {
  const eventFingerprint = inventoryEventIntentFingerprint(event);
  const common = [
    event.eventId,
    event.operationId,
    event.recordSequence,
    event.recordedAtEpochMs,
    eventFingerprint,
  ] as const;
  return {
    primary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-event-segment-leaf-primary-v1",
            common,
          ])
        )
    ),
    secondary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-event-segment-leaf-secondary-v1",
            common,
          ])
        )
    ),
  };
}

/** Normalize one signed journal aggregate into the canonical unsigned 256-bit domain. */
function inventoryNormalizeJournalRootSum(value: bigint): bigint {
  const normalized = value % inventoryJournalRootModulus;
  return normalized < 0n
    ? normalized + inventoryJournalRootModulus
    : normalized;
}

/** Encode one journal aggregate as exactly 64 lower-case hexadecimal digits. */
function inventoryJournalRootHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
