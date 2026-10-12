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
  /** Explicitly materialize the legacy flat journal/index projection. */
  materialize(): InventorySegmentedJournalResult<InventoryEventJournalMaterialization>;
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

/** Reference append-only indexed event journal. */
export class InMemoryInventorySegmentedEventJournal
  implements InventorySegmentedEventJournal
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

  /** Append one exact committed event and update only its touched indexes/root leaves. */
  append(event: InventoryCommittedEvent): void {
    const retained = cloneInventoryRetainedData(event);
    if (!Number.isSafeInteger(retained.recordSequence) || retained.recordSequence <= 0) {
      throw new Error("Segmented journal recordSequence must be a positive safe integer.");
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

    const correction = retained.correction;
    if (correction !== undefined) {
      const corrected = this.eventsById.get(correction.correctsEventId);
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
    }

    this.eventsById.set(retained.eventId, retained);
    this.eventIdBySequence.set(retained.recordSequence, retained.eventId);
    this.eventIdByOperation.set(retained.operationId, retained.eventId);
    for (const whereaboutsId of inventoryJournalTouchedWhereaboutsIds(retained)) {
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
    const leaf = inventoryJournalEventLeaf(retained);
    this.primaryRootSum = inventoryNormalizeJournalRootSum(
      this.primaryRootSum + leaf.primary
    );
    this.secondaryRootSum = inventoryNormalizeJournalRootSum(
      this.secondaryRootSum + leaf.secondary
    );
    this.lastSequence = retained.recordSequence;
  }

  /** Materialize the legacy flat event/index projection on explicit request only. */
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

/** Collect stable whereabouts lifecycle identities touched directly by one event. */
function inventoryJournalTouchedWhereaboutsIds(
  event: InventoryCommittedEvent
): readonly string[] {
  const result = new Set<string>();
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
  const ordered = [...result];
  ordered.sort();
  return ordered;
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
