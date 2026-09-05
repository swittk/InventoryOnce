import type {
  InventoryCommittedEvent,
  InventoryCount,
  InventoryCountBook,
  InventoryMeasurementVector,
  InventoryOnceCountResult,
  InventoryOnceEventResult,
  InventoryOnceOperationResult,
  InventoryOncePolicyBatchResult,
  InventoryOnceReservationResult,
  InventoryOnceTransferResult,
  InventoryReservation,
  InventoryReservationBook,
  InventoryStockPosition,
  InventoryStockPositionKey,
  InventoryTransfer,
  InventoryWorldState,
  Quantity,
} from "../src/index.js";
import type {
  InventoryMigrationDryRun,
  InventoryMigrationPlan,
} from "../src/migrations.js";
import type { InventoryMigrationSourceDisposition } from "../src/migration-evidence.js";
import type { InventoryTraceabilityState } from "../src/traceability.js";
import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
  type InventoryAuthorityState,
} from "../src/authority.js";
import type { InventoryMigrationManifest } from "../src/storage.js";
import {
  addQuantity,
  quantity,
  quantityToDecimalString,
  zeroQuantity,
} from "../src/quantity.js";

/** Locale-independent ordering used only by the independent executable abstraction. */
function compareAbstractIdentityText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Exact JSON-safe quantity tuple used by the executable abstraction. */
export type AbstractQuantity = readonly [
  amountMinor: number,
  decimals: number,
  unit: string
];

/** One exact position and its abstract measurement vector. */
export interface AbstractInventoryBucket {
  /** Collision-free canonical resource identity. */
  readonly identity: string;
  /** All qualified physical dimensions retained independently. */
  readonly key: Readonly<Record<string, string | readonly string[]>>;
  /** Exact axis that remains primary even after measurements are sorted. */
  readonly primaryAxisId: string;
  /** Primary and independently measured axes in canonical order. */
  readonly measurements: readonly AbstractMeasurement[];
}

/** One abstract measurement-axis value. */
export interface AbstractMeasurement {
  /** Immutable catalogue axis identity. */
  readonly axisId: string;
  /** Exact decimal/unit quantity. */
  readonly quantity: AbstractQuantity;
}

/** Published physical-state observation used by executable refinement tests. */
export interface AbstractInventoryState {
  /** Fully published world revision. */
  readonly worldRevision: number;
  /** Immutable catalogue content identity. */
  readonly catalogDigest: string;
  /** Highest durable event order included in the world. */
  readonly lastRecordSequence: number;
  /** Exact nonzero physical buckets. */
  readonly buckets: readonly AbstractInventoryBucket[];
  /** Immutable event identities and resource deltas in durable order. */
  readonly events: readonly AbstractInventoryEvent[];
  /** Current lot metadata facts without application decoration. */
  readonly lots: readonly Readonly<Record<string, unknown>>[];
  /** Current container metadata facts without application decoration. */
  readonly containers: readonly Readonly<Record<string, unknown>>[];
  /** Current first-class physical transfer lifecycle facts. */
  readonly transfers: readonly Readonly<Record<string, unknown>>[];
}

/** One committed event's modeled transition observation. */
export interface AbstractInventoryEvent {
  /** Stable event identity. */
  readonly eventId: string;
  /** Stable retry identity. */
  readonly operationId: string;
  /** Physical transition kind. */
  readonly kind: string;
  /** Real-world occurrence time. */
  readonly occurredAt: string;
  /** Durable total order. */
  readonly recordSequence: number;
  /** Exact additive/subtractive resource effects. */
  readonly effects: readonly Readonly<Record<string, unknown>>[];
  /** Exact graph changes. */
  readonly traceabilityChanges: readonly Readonly<Record<string, unknown>>[];
  /** Corrected-root identity when this is a correction. */
  readonly correctsEventId?: string;
  /** Structured physical transfer transition when present. */
  readonly transferLifecycle?: Readonly<Record<string, unknown>>;
}

/** Current claim-book observation used by reservation refinement. */
export interface AbstractReservationState {
  /** Current claims in identity order. */
  readonly reservations: readonly Readonly<Record<string, unknown>>[];
  /** Append-only lifecycle operations in deterministic order. */
  readonly operations: readonly Readonly<Record<string, unknown>>[];
}

/** Current physical-count-book observation used by count refinement. */
export interface AbstractCountState {
  /** Current count rows in identity order. */
  readonly counts: readonly Readonly<Record<string, unknown>>[];
  /** Append-only lifecycle operations in deterministic order. */
  readonly operations: readonly Readonly<Record<string, unknown>>[];
}

/** Current graph observation used by traceability refinement. */
export interface AbstractTraceabilityState {
  /** Effective containment/association/genealogy relations. */
  readonly relations: readonly Readonly<Record<string, unknown>>[];
}

/** Durable command-result observation used by result refinement. */
export interface AbstractOperationResult {
  /** Stable retry identity. */
  readonly operationId: string;
  /** Published world revision. */
  readonly worldRevision: number;
  /** True only for an exact replay. */
  readonly replayed: boolean;
  /** Optional committed event observation. */
  readonly event?: AbstractInventoryEvent;
  /** Optional current reservation observation. */
  readonly reservation?: Readonly<Record<string, unknown>>;
  /** Optional current count observation. */
  readonly count?: Readonly<Record<string, unknown>>;
  /** Optional current physical transfer lifecycle observation. */
  readonly transfer?: Readonly<Record<string, unknown>>;
  /** Exact single-request recorded-deficit result evidence. */
  readonly deficit?: Readonly<Record<string, unknown>>;
  /** Exact per-request policy allocation evidence. */
  readonly allocations?: readonly Readonly<Record<string, unknown>>[];
}

/** Monotonic writer-fence state observation used by authority refinement. */
export interface AbstractAuthorityState {
  /** Persisted monotonic authority mode. */
  readonly mode: InventoryAuthorityMode;
  /** Exact first-activation provenance. */
  readonly activationKind: InventoryAuthorityActivationKind;
  /** Monotonic durable authority document revision. */
  readonly revision: number;
  /** Whether one adapter certification digest is retained. */
  readonly adapterCertified: boolean;
  /** Whether explicit greenfield deployment authorization is retained. */
  readonly greenfieldAuthorized: boolean;
  /** Number of canonically admitted legacy writer attempts. */
  readonly activeLegacyWriters: number;
  /** Number of retained dual-run mismatches. */
  readonly mismatches: number;
  /** Whether one legacy cutover fence is retained. */
  readonly fenceHeld: boolean;
  /** Whether legacy source-root evidence is retained. */
  readonly sourceBound: boolean;
  /** Whether migration plan/catalog evidence is retained. */
  readonly sourcePlanBound: boolean;
  /** Whether one target-world root is retained. */
  readonly targetBound: boolean;
  /** Exact target-world revision retained at first activation. */
  readonly targetWorldRevision: number;
  /** Current compatibility-projection repair status. */
  readonly projectionStatus: InventoryCompatibilityProjectionStatus;
}

/** Migration plan/dry-run/manifest observation used by publication refinement. */
export interface AbstractMigrationState {
  /** Stable migration identity. */
  readonly migrationId: string;
  /** Frozen normalized plan digest. */
  readonly planDigest: string;
  /** Ready/blocked or applying/completed/aborted lifecycle. */
  readonly status: string;
  /** Exact reviewed base when available. */
  readonly base?: readonly [revision: number, root: string];
  /** Exact resulting published world when available. */
  readonly result?: AbstractInventoryState;
  /** Ordered operation/event identities. */
  readonly operationIds: readonly string[];
  /** Non-physical source rows retained as monotonic do-not-replay evidence. */
  readonly sourceDispositions: readonly Readonly<Record<string, unknown>>[];
  /** Explicit compiler blockers/diagnostics. */
  readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
}

/** Convert one exact quantity to the model's integer/scale/unit tuple. */
export function abstractQuantity(value: Quantity): AbstractQuantity {
  return [value.amountMinor, value.decimals, value.unit];
}

/** Convert one measurement vector without reusing implementation arithmetic. */
export function abstractMeasurements(
  vector: InventoryMeasurementVector
): readonly AbstractMeasurement[] {
  const values = [vector.primary, ...vector.independent].map((measurement) => ({
    axisId: measurement.axisId,
    quantity: abstractQuantity(measurement.quantity),
  }));
  values.sort((left, right) => compareAbstractIdentityText(left.axisId, right.axisId));
  return values;
}

/** Convert one exact stock-position key to all independent model dimensions. */
export function abstractPositionKey(
  key: InventoryStockPositionKey
): Readonly<Record<string, string | readonly string[]>> {
  return {
    itemId: key.itemId,
    itemRevisionId: key.itemRevisionId,
    locationId: key.locationId,
    ...(key.lotId === undefined ? {} : { lotId: key.lotId }),
    ...(key.serialId === undefined ? {} : { serialId: key.serialId }),
    ...(key.packagingRevisionId === undefined
      ? {}
      : { packagingRevisionId: key.packagingRevisionId }),
    ...(key.containerId === undefined ? {} : { containerId: key.containerId }),
    ...(key.statusId === undefined ? {} : { statusId: key.statusId }),
    ...(key.ownerId === undefined ? {} : { ownerId: key.ownerId }),
    ...(key.custodianId === undefined ? {} : { custodianId: key.custodianId }),
    ...(key.dispositionAuthorityId === undefined
      ? {}
      : { dispositionAuthorityId: key.dispositionAuthorityId }),
    ...(key.transferId === undefined ? {} : { transferId: key.transferId }),
    ...(key.qualifiedDimensions === undefined || key.qualifiedDimensions.length === 0
      ? {}
      : {
          // Keep each dimension pair structured so delimiters inside IDs cannot alias.
          qualifiedDimensions: key.qualifiedDimensions
            .map((dimension) =>
              JSON.stringify([dimension.dimensionId, dimension.valueId])
            )
            .sort(compareAbstractIdentityText),
        }),
  };
}

/** Canonical identity derived independently from every qualified position field. */
export function abstractPositionIdentity(
  key: InventoryStockPositionKey
): string {
  return JSON.stringify(abstractPositionKey(key));
}

/** Convert one projected physical bucket to the finite model resource record. */
function abstractBucket(
  position: InventoryStockPosition
): AbstractInventoryBucket {
  return {
    identity: abstractPositionIdentity(position.key),
    key: abstractPositionKey(position.key),
    primaryAxisId: position.measurements.primary.axisId,
    measurements: abstractMeasurements(position.measurements),
  };
}

/** Convert one current transfer to lifecycle state without invoking transfer reducers. */
function abstractTransfer(transfer: InventoryTransfer): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    transferId: transfer.transferId,
    sourceLocationId: transfer.sourceLocationId,
    transitLocationId: transfer.transitLocationId,
    destinationLocationId: transfer.destinationLocationId,
    destinationCustodianId: transfer.destinationCustodianId,
    carrierCustodianId: transfer.carrierCustodianId,
    status: transfer.status,
    lines: transfer.lines.map((line) => ({
      lineId: line.lineId,
      sourcePosition: abstractPositionKey(line.sourcePosition),
      preparedMeasurements: abstractMeasurements(line.preparedMeasurements),
      receivedMeasurements: abstractMeasurements(line.receivedMeasurements),
    })),
    preparedAt: transfer.preparedAt,
    preparedEventId: transfer.preparedEventId,
    dispatchedAt: transfer.dispatchedAt,
    dispatchEventId: transfer.dispatchEventId,
    lastReceivedAt: transfer.lastReceivedAt,
    releasedAt: transfer.releasedAt,
    releaseEventId: transfer.releaseEventId,
    sourceReference: transfer.sourceReference,
  });
}

/** Convert one structured transfer event transition to executable abstract evidence. */
function abstractTransferLifecycle(
  change: NonNullable<InventoryCommittedEvent["transferLifecycle"]>
): Readonly<Record<string, unknown>> {
  if (change.action === "prepare") {
    return canonicalRecord({
      ...change,
      lines: change.lines.map((line) => ({
        lineId: line.lineId,
        sourcePosition: abstractPositionKey(line.sourcePosition),
        preparedMeasurements: abstractMeasurements(line.preparedMeasurements),
      })),
    });
  }
  if (change.action === "receive") {
    return canonicalRecord({
      ...change,
      lines: change.lines.map((line) => ({
        lineId: line.lineId,
        receivedMeasurements: abstractMeasurements(line.receivedMeasurements),
      })),
    });
  }
  return canonicalRecord(change);
}

/** Convert one committed event to its modeled identity/order/effect observation. */
function abstractEvent(event: InventoryCommittedEvent): AbstractInventoryEvent {
  return {
    eventId: event.eventId,
    operationId: event.operationId,
    kind: event.kind,
    occurredAt: event.occurredAt,
    recordSequence: event.recordSequence,
    effects: event.stockEffects.map((effect) => ({
      itemRevisionId: effect.itemRevisionId,
      position: abstractPositionKey(effect.position),
      measurementsDelta: abstractMeasurements(effect.measurementsDelta),
    })),
    traceabilityChanges: event.traceabilityChanges.map((change) => ({
      action: change.action,
      kind: change.kind,
      from: `${change.from.kind}:${change.from.id}`,
      to: `${change.to.kind}:${change.to.id}`,
    })),
    ...(event.correction === undefined
      ? {}
      : { correctsEventId: event.correction.correctsEventId }),
    ...(event.transferLifecycle === undefined
      ? {}
      : { transferLifecycle: abstractTransferLifecycle(event.transferLifecycle) }),
  };
}

/** Canonicalize one JSON-safe public value without invoking InventoryOnce reducers. */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).sort(([left], [right]) =>
      compareAbstractIdentityText(left, right)
    )) {
      if (typeof nested === "function" || nested === undefined) continue;
      result[key] = canonicalValue(nested);
    }
    return result;
  }
  return value;
}

/** Require a canonicalized structured value. */
function canonicalRecord(value: object): Readonly<Record<string, unknown>> {
  const canonical = canonicalValue(value);
  if (
    canonical === null ||
    typeof canonical !== "object" ||
    Array.isArray(canonical)
  ) {
    throw new Error("Formal abstraction expected a structured record.");
  }
  return canonical as Readonly<Record<string, unknown>>;
}

/** Project one fully published concrete world to modeled physical state. */
export function abstractInventoryState(
  world: InventoryWorldState
): AbstractInventoryState {
  const buckets = Object.values(world.projection.positions).map(abstractBucket);
  buckets.sort((left, right) => compareAbstractIdentityText(left.identity, right.identity));
  const events = Object.values(world.projection.events).map(abstractEvent);
  events.sort((left, right) => left.recordSequence - right.recordSequence);
  const lots = Object.entries(world.projection.lots).map(([identity, lot]) =>
    canonicalRecord({
      identity,
      definition: lot.definition,
      rootEventId: lot.rootEventId,
      assertedByEventId: lot.assertedByEventId,
    })
  );
  lots.sort((left, right) =>
    compareAbstractIdentityText(String(left.identity), String(right.identity))
  );
  const containers = Object.entries(world.projection.containers).map(
    ([identity, container]) =>
      canonicalRecord({
        identity,
        definition: container.definition,
        rootEventId: container.rootEventId,
        assertedByEventId: container.assertedByEventId,
      })
  );
  containers.sort((left, right) =>
    compareAbstractIdentityText(String(left.identity), String(right.identity))
  );
  const transfers = Object.values(world.projection.transfers ?? {}).map(abstractTransfer);
  transfers.sort((left, right) =>
    compareAbstractIdentityText(String(left.transferId), String(right.transferId))
  );
  return {
    worldRevision: world.revision,
    catalogDigest: world.catalog.digest,
    lastRecordSequence: world.projection.lastRecordSequence,
    buckets,
    events,
    lots,
    containers,
    transfers,
  };
}

/** Convert one reservation to exact claim/allocation/lifecycle facts. */
function abstractReservation(
  reservation: InventoryReservation
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    reservationId: reservation.reservationId,
    operationId: reservation.operationId,
    itemRevisionId: reservation.itemRevisionId,
    selector: reservation.selector,
    requested: abstractQuantity(reservation.requested),
    createdAt: reservation.createdAt,
    expiresAt: reservation.expiresAt,
    allowExpiredStock: reservation.allowExpiredStock,
    status: reservation.status,
    allocations: reservation.allocations.map((allocation) => ({
      position: abstractPositionKey(allocation.position),
      quantity: abstractQuantity(allocation.quantity),
    })),
    statusAt: reservation.statusAt,
    lastChangedAt: reservation.lastChangedAt,
    consumptionEventId: reservation.consumptionEventId,
  });
}

/** Project the current reservation book to the modeled claim lifecycle. */
export function abstractReservationState(
  book: InventoryReservationBook
): AbstractReservationState {
  const reservations = Object.values(book.reservations).map(
    abstractReservation
  );
  reservations.sort((left, right) =>
    compareAbstractIdentityText(String(left.reservationId), String(right.reservationId))
  );
  const operations = Object.values(book.operations).map((operation) =>
    canonicalRecord({
      operationId: operation.operationId,
      reservationId: operation.reservationId,
      kind: operation.kind,
      intentFingerprint: operation.intentFingerprint,
      lifecycleSequence: operation.lifecycleSequence,
      reservationAfter: abstractReservation(operation.reservationAfter),
    })
  );
  operations.sort(
    (left, right) =>
      Number(left.lifecycleSequence) - Number(right.lifecycleSequence)
  );
  return { reservations, operations };
}

/** Convert one physical count to its snapshot/observation/terminal facts. */
function abstractCount(
  count: InventoryCount
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    countId: count.countId,
    operationId: count.operationId,
    itemRevisionId: count.itemRevisionId,
    selector: count.selector,
    startedAt: count.startedAt,
    snapshotRecordSequence: count.snapshotRecordSequence,
    status: count.status,
    observedAt: count.observedAt,
    observedThroughRecordSequence: count.observedThroughRecordSequence,
    observations: count.observations.map((observation) => ({
      position: abstractPositionKey(observation.position),
      measurements: abstractMeasurements(observation.measurements),
    })),
    statusAt: count.statusAt,
    reconciliationEventId: count.reconciliationEventId,
  });
}

/** Project the current count book to modeled count lifecycle state. */
export function abstractCountState(
  book: InventoryCountBook
): AbstractCountState {
  const counts = Object.values(book.counts).map(abstractCount);
  counts.sort((left, right) =>
    compareAbstractIdentityText(String(left.countId), String(right.countId))
  );
  const operations = Object.values(book.operations).map((operation) =>
    canonicalRecord({
      operationId: operation.operationId,
      countId: operation.countId,
      kind: operation.kind,
      intentFingerprint: operation.intentFingerprint,
    })
  );
  operations.sort((left, right) =>
    compareAbstractIdentityText(String(left.operationId), String(right.operationId))
  );
  return { counts, operations };
}

/** Project the effective graph without calling graph reducers. */
export function abstractTraceabilityState(
  state: InventoryTraceabilityState
): AbstractTraceabilityState {
  const relations = Object.entries(state.relations).map(
    ([identity, relation]) =>
      canonicalRecord({
        identity,
        kind: relation.kind,
        from: relation.from,
        to: relation.to,
        createdByEventId: relation.createdByEventId,
      })
  );
  relations.sort((left, right) =>
    compareAbstractIdentityText(String(left.identity), String(right.identity))
  );
  return { relations };
}

/** Project one durable command result to event/book/allocation observations. */
export function abstractOperationResult(
  result:
    | InventoryOnceOperationResult
    | InventoryOnceEventResult
    | InventoryOnceReservationResult
    | InventoryOnceCountResult
    | InventoryOnceTransferResult
    | InventoryOncePolicyBatchResult
): AbstractOperationResult {
  const event = "event" in result ? result.event : undefined;
  const reservation = "reservation" in result ? result.reservation : undefined;
  const count = "count" in result ? result.count : undefined;
  const transfer = "transfer" in result ? result.transfer : undefined;
  const deficit = "deficit" in result ? result.deficit : undefined;
  const allocations = "allocations" in result ? result.allocations : undefined;
  return {
    operationId: result.receipt.operationId,
    worldRevision: result.receipt.worldRevision,
    replayed: result.replayed,
    ...(event === undefined ? {} : { event: abstractEvent(event) }),
    ...(reservation === undefined
      ? {}
      : { reservation: abstractReservation(reservation) }),
    ...(count === undefined ? {} : { count: abstractCount(count) }),
    ...(transfer === undefined ? {} : { transfer: abstractTransfer(transfer) }),
    ...(deficit === undefined
      ? {}
      : {
          deficit: canonicalRecord({
            position: abstractPositionKey(deficit.position),
            amount: deficit.amount,
            primary: abstractQuantity(deficit.primary),
          }),
        }),
    ...(allocations === undefined
      ? {}
      : {
          allocations: allocations.map((allocation) =>
            canonicalRecord({
              requestId: allocation.requestId,
              groupId: allocation.groupId,
              lines: allocation.lines.map((line) => ({
                position: abstractPositionKey(line.position),
                positionIdentity: line.positionIdentity,
                amount: line.amount,
                allocatedPrimary: abstractQuantity(line.allocatedPrimary),
                layerStartedAt: line.layerStartedAt,
                expiresAt: line.expiresAt,
              })),
              deficit:
                allocation.deficit === undefined
                  ? undefined
                  : {
                      position: abstractPositionKey(
                        allocation.deficit.position
                      ),
                      amount: allocation.deficit.amount,
                      primary: abstractQuantity(allocation.deficit.primary),
                    },
            })
          ),
        }),
  };
}

/** Project exact monotonic authority evidence to the writer-fence abstraction. */
export function abstractAuthorityState(
  state: InventoryAuthorityState
): AbstractAuthorityState {
  return {
    mode: state.mode,
    activationKind: state.activationKind,
    revision: state.revision,
    adapterCertified: state.adapterCertificationDigest.length > 0,
    greenfieldAuthorized: state.greenfieldAuthorizationId.length > 0,
    activeLegacyWriters: state.activeLegacyWriters.length,
    mismatches: state.dualRunMismatchEvidence.length,
    fenceHeld: state.fenceToken.length > 0,
    sourceBound: state.sourceRoot.length > 0,
    sourcePlanBound:
      state.sourcePlanDigest.length > 0 && state.sourceCatalogDigest.length > 0,
    targetBound: state.targetWorldRoot.length > 0,
    targetWorldRevision: state.targetWorldRevision,
    projectionStatus: state.compatibilityProjectionStatus,
  };
}

/** Canonicalize source dispositions without interpreting application evidence. */
function abstractMigrationSourceDispositions(
  dispositions: readonly InventoryMigrationSourceDisposition[]
): readonly Readonly<Record<string, unknown>>[] {
  return dispositions.map((disposition) =>
    canonicalRecord({
      dispositionId: disposition.dispositionId,
      kind: disposition.kind,
      source: disposition.source,
      snapshotAt: disposition.snapshotAt,
      reason: disposition.reason,
      evidence: disposition.evidence,
    })
  );
}

/** Project migration compile, dry-run, or durable publication state. */
export function abstractMigrationState(
  value:
    | InventoryMigrationPlan
    | InventoryMigrationDryRun
    | InventoryMigrationManifest
): AbstractMigrationState {
  if ("resultWorld" in value) {
    return {
      migrationId: `dry-run:${value.planDigest}`,
      planDigest: value.planDigest,
      status: "dry-run",
      base: [value.baseRevision, value.baseWorldRoot],
      result: abstractInventoryState(value.resultWorld),
      operationIds: Object.values(value.resultWorld.projection.events)
        .sort((left, right) => left.recordSequence - right.recordSequence)
        .map((event) => event.operationId),
      sourceDispositions: abstractMigrationSourceDispositions(
        value.sourceDispositions
      ),
      diagnostics: [],
    };
  }
  if ("events" in value) {
    return {
      migrationId: value.migrationId,
      planDigest: value.planDigest,
      status: value.status,
      operationIds: value.events.map((event) => event.operationId),
      sourceDispositions: abstractMigrationSourceDispositions(
        value.sourceDispositions
      ),
      diagnostics: value.diagnostics.map((diagnostic) =>
        canonicalRecord(diagnostic)
      ),
    };
  }
  return {
    migrationId: value.migrationId,
    planDigest: value.planDigest,
    status: value.state,
    base: [value.baseRevision, value.baseWorldRoot],
    operationIds: [...value.operationIds],
    sourceDispositions: abstractMigrationSourceDispositions(
      value.sourceDispositions
    ),
    diagnostics: [],
  };
}

/** Require one nonnegative safe integer in the concrete-state observation. */
function requireNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
}

/** Independently check the published resource/event/index invariants used by refinement. */
export function assertAbstractInventoryInvariants(
  world: InventoryWorldState
): void {
  const state = abstractInventoryState(world);
  requireNonnegativeSafeInteger(state.worldRevision, "Abstract world revision");
  requireNonnegativeSafeInteger(
    state.lastRecordSequence,
    "Abstract last record sequence"
  );
  const bucketIdentities = new Set<string>();
  const positiveSerials = new Set<string>();
  for (const bucket of state.buckets) {
    if (bucketIdentities.has(bucket.identity)) {
      throw new Error(`Duplicate abstract stock bucket '${bucket.identity}'.`);
    }
    bucketIdentities.add(bucket.identity);
    const axisIds = new Set<string>();
    let nonzero = false;
    for (const measurement of bucket.measurements) {
      if (axisIds.has(measurement.axisId)) {
        throw new Error(
          `Duplicate abstract measurement axis '${measurement.axisId}'.`
        );
      }
      axisIds.add(measurement.axisId);
      nonzero ||= measurement.quantity[0] !== 0;
    }
    if (!nonzero)
      throw new Error("Published projection retained an all-zero position.");
    const serialId = bucket.key.serialId;
    if (typeof serialId === "string") {
      const serialIdentity = JSON.stringify([String(bucket.key.itemId), serialId]);
      if (positiveSerials.has(serialIdentity)) {
        throw new Error(
          `Positive serial '${serialIdentity}' appears in two buckets.`
        );
      }
      positiveSerials.add(serialIdentity);
    }
  }

  const eventIds = new Set<string>();
  const operationIds = new Set<string>();
  let expectedSequence = 1;
  for (const event of state.events) {
    if (event.recordSequence !== expectedSequence) {
      throw new Error(
        `Durable event sequence expected ${expectedSequence}, got ${event.recordSequence}.`
      );
    }
    expectedSequence += 1;
    if (eventIds.has(event.eventId))
      throw new Error(`Duplicate event '${event.eventId}'.`);
    if (operationIds.has(event.operationId)) {
      throw new Error(
        `Operation '${event.operationId}' committed more than one event.`
      );
    }
    eventIds.add(event.eventId);
    operationIds.add(event.operationId);
    if (
      world.projection.eventIdsBySequence[String(event.recordSequence)] !==
      event.eventId
    ) {
      throw new Error(`Event sequence index disagrees for '${event.eventId}'.`);
    }
    if (
      world.projection.eventIdByOperationId[event.operationId] !== event.eventId
    ) {
      throw new Error(`Operation index disagrees for '${event.operationId}'.`);
    }
  }
  if (state.events.length !== state.lastRecordSequence) {
    throw new Error("Published event count does not match lastRecordSequence.");
  }
  assertAbstractTraceabilityInvariants(world.projection.traceability);
}

/** Independently check claim lifecycle/allocation evidence. */
export function assertAbstractReservationInvariants(
  book: InventoryReservationBook
): void {
  const operationIds = new Set<string>();
  const lifecycleSequences = new Set<number>();
  for (const operation of Object.values(book.operations)) {
    if (operationIds.has(operation.operationId)) {
      throw new Error(
        `Duplicate reservation operation '${operation.operationId}'.`
      );
    }
    operationIds.add(operation.operationId);
    if (lifecycleSequences.has(operation.lifecycleSequence)) {
      throw new Error(
        `Duplicate reservation lifecycle sequence '${operation.lifecycleSequence}'.`
      );
    }
    lifecycleSequences.add(operation.lifecycleSequence);
    if (book.reservations[operation.reservationId] === undefined) {
      throw new Error(
        `Reservation operation lost '${operation.reservationId}'.`
      );
    }
  }
  for (const reservation of Object.values(book.reservations)) {
    if (reservation.requested.amountMinor <= 0) {
      throw new Error(
        `Reservation '${reservation.reservationId}' is not positive.`
      );
    }
    const positions = new Set<string>();
    for (const allocation of reservation.allocations) {
      if (allocation.quantity.amountMinor <= 0) {
        throw new Error(
          `Reservation '${reservation.reservationId}' has nonpositive allocation.`
        );
      }
      const identity = abstractPositionIdentity(allocation.position);
      if (positions.has(identity)) {
        throw new Error(
          `Reservation '${reservation.reservationId}' duplicates allocation.`
        );
      }
      positions.add(identity);
    }
    if (
      reservation.status === "consumed" &&
      reservation.consumptionEventId === undefined
    ) {
      throw new Error(
        `Consumed reservation '${reservation.reservationId}' lacks evidence.`
      );
    }
    if (
      reservation.status !== "consumed" &&
      reservation.consumptionEventId !== undefined
    ) {
      throw new Error(
        `Unconsumed reservation '${reservation.reservationId}' names issue evidence.`
      );
    }
  }
}

/** Independently check count-stage evidence and observation completeness shape. */
export function assertAbstractCountInvariants(book: InventoryCountBook): void {
  for (const operation of Object.values(book.operations)) {
    if (book.counts[operation.countId] === undefined) {
      throw new Error(`Count operation lost '${operation.countId}'.`);
    }
  }
  for (const count of Object.values(book.counts)) {
    requireNonnegativeSafeInteger(
      count.snapshotRecordSequence,
      `Count '${count.countId}' snapshot sequence`
    );
    if (count.status === "started" && count.observedAt !== undefined) {
      throw new Error(
        `Started count '${count.countId}' already has an observation time.`
      );
    }
    if (
      (count.status === "observed" || count.status === "completed") &&
      (count.observedAt === undefined ||
        count.observedThroughRecordSequence === undefined)
    ) {
      throw new Error(
        `Observed count '${count.countId}' lacks observation evidence.`
      );
    }
    if (count.status === "completed" && count.statusAt === undefined) {
      throw new Error(
        `Completed count '${count.countId}' lacks terminal time.`
      );
    }
    const observationPositions = new Set<string>();
    for (const observation of count.observations) {
      const identity = abstractPositionIdentity(observation.position);
      if (observationPositions.has(identity)) {
        throw new Error(
          `Count '${count.countId}' duplicates an observation position.`
        );
      }
      observationPositions.add(identity);
    }
  }
}

/** Independently check that the effective containment graph is acyclic. */
export function assertAbstractTraceabilityInvariants(
  state: InventoryTraceabilityState
): void {
  const childrenByParent = new Map<string, string[]>();
  for (const relation of Object.values(state.relations)) {
    if (relation.kind !== "containment") continue;
    const child = JSON.stringify(canonicalValue(relation.from));
    const parent = JSON.stringify(canonicalValue(relation.to));
    const children = childrenByParent.get(parent) ?? [];
    children.push(child);
    childrenByParent.set(parent, children);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node))
      throw new Error("Abstract containment graph contains a cycle.");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const child of childrenByParent.get(node) ?? []) visit(child);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of childrenByParent.keys()) visit(node);
}

/** Independently check mode/evidence prerequisites in one authority state. */
export function assertAbstractAuthorityInvariants(
  state: InventoryAuthorityState
): void {
  const abstract = abstractAuthorityState(state);
  if (!Number.isSafeInteger(abstract.revision) || abstract.revision < 0) {
    throw new Error(
      "Authority revision must remain a non-negative safe integer."
    );
  }
  const authoritative = abstract.mode === InventoryAuthorityMode.Authoritative;
  if (
    authoritative !==
    (abstract.activationKind !== InventoryAuthorityActivationKind.None)
  ) {
    throw new Error(
      "Authority mode and first-activation provenance must change together."
    );
  }
  if (
    (abstract.mode === InventoryAuthorityMode.Fencing || authoritative) &&
    abstract.activeLegacyWriters !== 0
  ) {
    throw new Error(
      "Fenced or authoritative state cannot retain legacy writer admissions."
    );
  }
  if (authoritative && (!abstract.adapterCertified || !abstract.targetBound)) {
    throw new Error(
      "Authoritative state requires adapter certification and exact target evidence."
    );
  }
  if (abstract.activationKind === InventoryAuthorityActivationKind.Greenfield) {
    if (
      !abstract.greenfieldAuthorized ||
      abstract.sourceBound ||
      abstract.sourcePlanBound ||
      abstract.fenceHeld ||
      abstract.mismatches !== 0 ||
      abstract.targetWorldRevision !== 0
    ) {
      throw new Error(
        "Greenfield authority must bind explicit authorization to an empty target without legacy source, migration, mismatch, or fence evidence."
      );
    }
  } else if (abstract.greenfieldAuthorized) {
    throw new Error(
      "Only greenfield authority may retain greenfield deployment authorization."
    );
  }
  if (
    abstract.activationKind ===
      InventoryAuthorityActivationKind.LegacyCutover &&
    (!abstract.sourceBound || !abstract.sourcePlanBound || !abstract.fenceHeld)
  ) {
    throw new Error(
      "Legacy-cutover authority must retain source, migration, and fence evidence."
    );
  }
  if (
    abstract.mode === InventoryAuthorityMode.Fencing &&
    (!abstract.adapterCertified || !abstract.fenceHeld)
  ) {
    throw new Error(
      "Fencing requires adapter certification and one retained fence token."
    );
  }
}

/** Independently check migration plan/manifest identity and terminal-shape invariants. */
export function assertAbstractMigrationInvariants(
  value:
    | InventoryMigrationPlan
    | InventoryMigrationDryRun
    | InventoryMigrationManifest
): void {
  const state = abstractMigrationState(value);
  if (state.planDigest.trim() === "")
    throw new Error("Migration lacks plan digest.");
  const operationIds = new Set<string>();
  for (const operationId of state.operationIds) {
    if (operationId.trim() === "")
      throw new Error("Migration contains empty operation ID.");
    if (operationIds.has(operationId)) {
      throw new Error(`Migration repeats operation '${operationId}'.`);
    }
    operationIds.add(operationId);
  }
  if ("resultWorld" in value) {
    if (value.resultWorld.revision !== value.baseRevision + 1) {
      throw new Error(
        "Migration dry-run did not publish exactly one target revision."
      );
    }
    assertAbstractInventoryInvariants(value.resultWorld);
  } else if ("events" in value) {
    const hasErrors = value.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error"
    );
    if ((value.status === "blocked") !== hasErrors) {
      throw new Error("Migration status disagrees with blocking diagnostics.");
    }
  } else {
    if (value.state === "completed" && !value.worldPublished) {
      throw new Error(
        "Completed migration manifest did not publish its world."
      );
    }
    if (value.state === "aborted" && value.worldPublished) {
      throw new Error("Aborted migration manifest published a world.");
    }
  }
}

/** Check one concrete command/result step refines one atomic publication or exact stutter. */
export function assertStateResultRefinement(
  before: InventoryWorldState,
  after: InventoryWorldState,
  result:
    | InventoryOnceOperationResult
    | InventoryOnceEventResult
    | InventoryOnceReservationResult
    | InventoryOnceCountResult
    | InventoryOnceTransferResult
    | InventoryOncePolicyBatchResult,
  expectedNewRevisionDelta = 1
): void {
  assertAbstractInventoryInvariants(after);
  assertAbstractReservationInvariants(after.reservations);
  assertAbstractCountInvariants(after.counts);
  const observation = abstractOperationResult(result);
  if (observation.worldRevision !== after.revision) {
    throw new Error(
      "Operation receipt revision disagrees with published world."
    );
  }
  if (result.replayed) {
    if (
      JSON.stringify(abstractInventoryState(before)) !==
      JSON.stringify(abstractInventoryState(after))
    ) {
      throw new Error("Exact replay changed abstract physical state.");
    }
    if (
      JSON.stringify(abstractReservationState(before.reservations)) !==
        JSON.stringify(abstractReservationState(after.reservations)) ||
      JSON.stringify(abstractCountState(before.counts)) !==
        JSON.stringify(abstractCountState(after.counts))
    ) {
      throw new Error("Exact replay changed an abstract lifecycle book.");
    }
  } else if (after.revision !== before.revision + expectedNewRevisionDelta) {
    throw new Error(
      `Successful command published ${
        after.revision - before.revision
      } world revisions; expected ${expectedNewRevisionDelta}.`
    );
  }
  if (observation.event !== undefined) {
    if (observation.event.operationId !== observation.operationId) {
      throw new Error(
        "Result event and receipt use different operation identities."
      );
    }
    if (result.receipt.eventId !== observation.event.eventId) {
      throw new Error("Result receipt and event identity disagree.");
    }
  }
}

/** Sum one primary unit across abstract buckets with exact scaled-integer arithmetic. */
export function abstractPrimaryBalance(
  world: InventoryWorldState,
  itemId: string,
  locationId: string,
  unit: string
): string {
  let total = zeroQuantity(unit);
  for (const bucket of abstractInventoryState(world).buckets) {
    if (bucket.key.itemId !== itemId || bucket.key.locationId !== locationId)
      continue;
    const primary = bucket.measurements.find(
      (measurement) => measurement.axisId === bucket.primaryAxisId
    );
    if (primary === undefined || primary.quantity[2] !== unit) continue;
    total = addQuantity(
      total,
      quantity({
        amountMinor: primary.quantity[0],
        decimals: primary.quantity[1],
        unit: primary.quantity[2],
      })
    );
  }
  return quantityToDecimalString(total);
}
