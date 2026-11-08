import { isDeepStrictEqual } from "node:util";
import type {
  InventoryCommittedEvent,
  InventoryCount,
  InventoryCountBook,
  InventoryMeasurementVector,
  InventoryOnceCountResult,
  InventoryOnceEventResult,
  InventoryOnceOperationResult,
  InventoryOncePolicyBatchAllocation,
  InventoryOncePolicyBatchAllocationGroup,
  InventoryOncePolicyBatchResult,
  InventoryOnceRecordedDeficit,
  InventoryOnceReservationResult,
  InventoryOnceTransferResult,
  InventoryReservation,
  InventoryReservationBook,
  InventoryStockPosition,
  InventoryStockPositionKey,
  InventoryStockSelector,
  InventoryTransfer,
  InventoryWorldState,
  Quantity,
} from "../src/index.js";
import type {
  InventoryMigrationDryRun,
  InventoryMigrationPlan,
} from "../src/migrations.js";
import type { InventoryMigrationSourceDisposition } from "../src/migration-evidence.js";
import type {
  InventoryTraceabilityRelation,
  InventoryTraceabilityState,
} from "../src/traceability.js";
import type { InventoryPlacementState } from "../src/placement.js";
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
  /** Current placement-node metadata facts without application decoration. */
  readonly placementNodes: readonly Readonly<Record<string, unknown>>[];
  /** Current direct-parent placement relations in child identity order. */
  readonly placements: readonly Readonly<Record<string, unknown>>[];
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
  readonly occurredAtEpochMs: number;
  /** Durable total order. */
  readonly recordSequence: number;
  /** Exact additive/subtractive resource effects. */
  readonly effects: readonly Readonly<Record<string, unknown>>[];
  /** Exact direct-parent topology changes. */
  readonly placementChanges: readonly Readonly<Record<string, unknown>>[];
  /** Exact association/genealogy graph changes. */
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

/** Current association/genealogy observation used by traceability refinement. */
export interface AbstractTraceabilityState {
  /** Effective association/genealogy relations. */
  readonly relations: readonly Readonly<Record<string, unknown>>[];
}

/** Durable command-result observation used by result refinement. */
export interface AbstractOperationResult {
  /** Stable retry identity. */
  readonly operationId: string;
  /** Durable record time frozen with the operation receipt. */
  readonly recordedAtEpochMs: number;
  /** Published world revision. */
  readonly worldRevision: number;
  /** Committed event identity retained by the receipt when present. */
  readonly receiptEventId?: string;
  /** Reservation identity retained by the receipt when present. */
  readonly receiptReservationId?: string;
  /** Count identity retained by the receipt when present. */
  readonly receiptCountId?: string;
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
  /** Exact caller-grouped policy allocation evidence. */
  readonly allocationGroups?: readonly Readonly<Record<string, unknown>>[];
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
    ...(key.placementNodeId === undefined
      ? {}
      : { placementNodeId: key.placementNodeId }),
    ...(key.whereaboutsId === undefined
      ? {}
      : { whereaboutsId: key.whereaboutsId }),
    ...(key.whereaboutsState === undefined
      ? {}
      : { whereaboutsState: key.whereaboutsState }),
    ...(key.lastPlacementNodeId === undefined
      ? {}
      : { lastPlacementNodeId: key.lastPlacementNodeId }),
    ...(key.detachedAtEpochMs === undefined
      ? {}
      : { detachedAtEpochMs: String(key.detachedAtEpochMs) }),
    ...(key.missingAtEpochMs === undefined
      ? {}
      : { missingAtEpochMs: String(key.missingAtEpochMs) }),
    ...(key.lotId === undefined ? {} : { lotId: key.lotId }),
    ...(key.serialId === undefined ? {} : { serialId: key.serialId }),
    ...(key.packagingRevisionId === undefined
      ? {}
      : { packagingRevisionId: key.packagingRevisionId }),
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

/** Independently derive the concrete projection dictionary identity without calling the producer helper. */
function abstractProjectionPositionIdentity(key: InventoryStockPositionKey): string {
  const qualifiedDimensions = key.qualifiedDimensions === undefined || key.qualifiedDimensions.length === 0
    ? null
    : key.qualifiedDimensions
      .map((dimension) => [dimension.dimensionId, dimension.valueId] as const)
      .sort((left, right) => compareAbstractIdentityText(left[0], right[0]));
  return JSON.stringify([
    key.itemId,
    key.itemRevisionId,
    key.placementNodeId ?? null,
    key.whereaboutsId ?? null,
    key.whereaboutsState ?? null,
    key.lastPlacementNodeId ?? null,
    key.detachedAtEpochMs ?? null,
    key.missingAtEpochMs ?? null,
    key.lotId ?? null,
    key.serialId ?? null,
    key.packagingRevisionId ?? null,
    key.statusId ?? null,
    key.ownerId ?? null,
    key.custodianId ?? null,
    key.dispositionAuthorityId ?? null,
    key.transferId ?? null,
    qualifiedDimensions,
  ]);
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
    sourcePlacementNodeId: transfer.sourcePlacementNodeId,
    transitPlacementNodeId: transfer.transitPlacementNodeId,
    destinationPlacementNodeId: transfer.destinationPlacementNodeId,
    destinationCustodianId: transfer.destinationCustodianId,
    carrierCustodianId: transfer.carrierCustodianId,
    status: transfer.status,
    lines: transfer.lines.map((line) => ({
      lineId: line.lineId,
      sourcePosition: abstractPositionKey(line.sourcePosition),
      preparedMeasurements: abstractMeasurements(line.preparedMeasurements),
      receivedMeasurements: abstractMeasurements(line.receivedMeasurements),
    })),
    preparedAtEpochMs: transfer.preparedAtEpochMs,
    preparedEventId: transfer.preparedEventId,
    dispatchedAtEpochMs: transfer.dispatchedAtEpochMs,
    dispatchEventId: transfer.dispatchEventId,
    lastReceivedAtEpochMs: transfer.lastReceivedAtEpochMs,
    releasedAtEpochMs: transfer.releasedAtEpochMs,
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
    occurredAtEpochMs: event.occurredAtEpochMs,
    recordSequence: event.recordSequence,
    effects: event.stockEffects.map((effect) => ({
      itemRevisionId: effect.itemRevisionId,
      position: abstractPositionKey(effect.position),
      measurementsDelta: abstractMeasurements(effect.measurementsDelta),
    })),
    placementChanges: (event.placementChanges ?? []).map((change) => ({
      nodeId: change.nodeId,
      fromParentNodeId: change.fromParentNodeId ?? null,
      toParentNodeId: change.toParentNodeId ?? null,
    })),
    traceabilityChanges: event.traceabilityChanges.map((change) => ({
      action: change.action,
      kind: change.kind,
      from: [change.from.kind, change.from.id] as const,
      to: [change.to.kind, change.to.id] as const,
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
      Object.defineProperty(result, key, {
        value: canonicalValue(nested),
        enumerable: true,
        configurable: true,
        writable: true,
      });
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
  // The guards above establish the canonical value is a non-array structured record.
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
  const placementNodes = Object.entries(world.projection.placementNodes).map(
    ([identity, node]) =>
      canonicalRecord({
        identity,
        definition: node.definition,
        rootEventId: node.rootEventId,
        assertedByEventId: node.assertedByEventId,
        retiredByEventId: node.retiredByEventId,
      })
  );
  placementNodes.sort((left, right) =>
    compareAbstractIdentityText(String(left.identity), String(right.identity))
  );
  const placements = Object.entries(
    world.projection.placement.relationByNodeId
  ).map(([nodeId, relation]) =>
    canonicalRecord({
      nodeId,
      parentNodeId: relation.parentNodeId,
      createdByEventId: relation.createdByEventId,
    })
  );
  placements.sort((left, right) =>
    compareAbstractIdentityText(String(left.nodeId), String(right.nodeId))
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
    placementNodes,
    placements,
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
    createdAtEpochMs: reservation.createdAtEpochMs,
    expiresAtEpochMs: reservation.expiresAtEpochMs,
    allowExpiredStock: reservation.allowExpiredStock,
    status: reservation.status,
    allocations: reservation.allocations.map((allocation) => ({
      position: abstractPositionKey(allocation.position),
      quantity: abstractQuantity(allocation.quantity),
    })),
    statusAtEpochMs: reservation.statusAtEpochMs,
    lastChangedAtEpochMs: reservation.lastChangedAtEpochMs,
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
    startedAtEpochMs: count.startedAtEpochMs,
    snapshotRecordSequence: count.snapshotRecordSequence,
    status: count.status,
    observedAtEpochMs: count.observedAtEpochMs,
    observedThroughRecordSequence: count.observedThroughRecordSequence,
    observations: count.observations.map((observation) => ({
      position: abstractPositionKey(observation.position),
      measurements: abstractMeasurements(observation.measurements),
    })),
    statusAtEpochMs: count.statusAtEpochMs,
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

/** Project one recorded deficit into the exact immutable event-metadata shape. */
function abstractPolicyDeficitMetadata(
  deficit: InventoryOnceRecordedDeficit
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    version: 1,
    positionIdentity: abstractProjectionPositionIdentity(deficit.position),
    amount: deficit.amount,
    primary: deficit.primary,
  });
}

/** Project one policy allocation into public result-refinement evidence. */
function abstractPolicyAllocation(
  allocation: InventoryOncePolicyBatchAllocation
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    requestId: allocation.requestId,
    groupId: allocation.groupId,
    lines: allocation.lines.map((line) => ({
      position: abstractPositionKey(line.position),
      positionIdentity: line.positionIdentity,
      amount: line.amount,
      allocatedPrimary: line.allocatedPrimary,
      layerStartedAtEpochMs: line.layerStartedAtEpochMs,
      expiresAtEpochMs: line.expiresAtEpochMs,
    })),
    deficit:
      allocation.deficit === undefined
        ? undefined
        : canonicalRecord({
            position: abstractPositionKey(allocation.deficit.position),
            amount: allocation.deficit.amount,
            primary: allocation.deficit.primary,
          }),
  });
}

/** Project one grouped policy allocation into replay-visible result evidence. */
function abstractPolicyAllocationGroup(
  group: InventoryOncePolicyBatchAllocationGroup
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    groupId: group.groupId,
    requestIds: group.requestIds,
    lines: group.lines.map((line) => ({
      position: abstractPositionKey(line.position),
      positionIdentity: line.positionIdentity,
      amount: line.amount,
      allocatedPrimary: line.allocatedPrimary,
      layerStartedAtEpochMs: line.layerStartedAtEpochMs,
      expiresAtEpochMs: line.expiresAtEpochMs,
    })),
  });
}

/** Independently regroup exact policy allocations by stable caller result identity. */
function abstractExpectedPolicyAllocationGroups(
  allocations: readonly InventoryOncePolicyBatchAllocation[]
): readonly Readonly<Record<string, unknown>>[] {
  const groups = new Map<string, InventoryOncePolicyBatchAllocationGroup>();
  for (const allocation of allocations) {
    const current = groups.get(allocation.groupId);
    groups.set(
      allocation.groupId,
      current === undefined
        ? {
            groupId: allocation.groupId,
            requestIds: [allocation.requestId],
            lines: allocation.lines,
          }
        : {
            groupId: current.groupId,
            requestIds: [...current.requestIds, allocation.requestId],
            lines: [...current.lines, ...allocation.lines],
          }
    );
  }
  return [...groups.values()].map(abstractPolicyAllocationGroup);
}

/** Encode exact policy allocations into the independently expected event-metadata shape. */
function abstractPolicyBatchMetadata(
  allocations: readonly InventoryOncePolicyBatchAllocation[]
): Readonly<Record<string, unknown>> {
  return canonicalRecord({
    version: 2,
    allocations: allocations.map((allocation) => ({
      requestId: allocation.requestId,
      groupId: allocation.groupId,
      lines: allocation.lines.map((line) => ({
        positionIdentity: line.positionIdentity,
        amount: line.amount,
        allocatedPrimary: line.allocatedPrimary,
        layerStartedAtEpochMs: line.layerStartedAtEpochMs,
        expiresAtEpochMs: line.expiresAtEpochMs,
      })),
      deficit:
        allocation.deficit === undefined
          ? undefined
          : abstractPolicyDeficitMetadata(allocation.deficit),
    })),
  });
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
  const allocationGroups =
    "allocationGroups" in result ? result.allocationGroups : undefined;
  return {
    operationId: result.receipt.operationId,
    recordedAtEpochMs: result.receipt.recordedAtEpochMs,
    worldRevision: result.receipt.worldRevision,
    ...(result.receipt.eventId === undefined
      ? {}
      : { receiptEventId: result.receipt.eventId }),
    ...(result.receipt.reservationId === undefined
      ? {}
      : { receiptReservationId: result.receipt.reservationId }),
    ...(result.receipt.countId === undefined
      ? {}
      : { receiptCountId: result.receipt.countId }),
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
      : { allocations: allocations.map(abstractPolicyAllocation) }),
    ...(allocationGroups === undefined
      ? {}
      : { allocationGroups: allocationGroups.map(abstractPolicyAllocationGroup) }),
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
      snapshotAtEpochMs: disposition.snapshotAtEpochMs,
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
    if (world.projection.events[event.eventId]?.eventId !== event.eventId) {
      throw new Error(`Event dictionary key disagrees for '${event.eventId}'.`);
    }
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
  if (Object.keys(world.projection.eventIdsBySequence).length !== eventIds.size ||
      Object.keys(world.projection.eventIdByOperationId).length !== operationIds.size) {
    throw new Error("Event indexes retain entries without a published event.");
  }
  for (const relation of Object.values(world.projection.placement.relationByNodeId)) {
    if (!eventIds.has(relation.createdByEventId)) {
      throw new Error(
        `Placement relation names missing creating event '${relation.createdByEventId}'.`
      );
    }
  }
  for (const relation of Object.values(world.projection.traceability.relations)) {
    if (!eventIds.has(relation.createdByEventId)) {
      throw new Error(
        `Traceability relation names missing creating event '${relation.createdByEventId}'.`
      );
    }
  }
  assertAbstractPositionIndexes(world.projection);
  assertAbstractHistoryIndexes(world.projection);
  assertAbstractCommittedStock(world.projection);
  assertAbstractPlacementInvariants(
    world.projection.placement,
    world.projection.placementNodes,
    world.projection.positions
  );
  assertAbstractTraceabilityInvariants(world.projection.traceability);
}

/** Require an exact scalar index domain and value mapping, including absence of orphan keys. */
function assertAbstractScalarIndex<T>(actual: Readonly<Record<string, T>>, expected: ReadonlyMap<string, T>, label: string): void {
  if (Object.keys(actual).length !== expected.size) throw new Error(`${label} index domain differs from its primary facts.`);
  for (const [key, value] of expected) {
    if (!Object.hasOwn(actual, key) || actual[key] !== value) throw new Error(`${label} index value disagrees at '${key}'.`);
  }
}

/** Require exact grouped-index membership, order, and domain independently of the reducer's builders. */
function assertAbstractGroupedIndex(actual: Readonly<Record<string, readonly string[]>>, expected: ReadonlyMap<string, string[]>, label: string): void {
  if (Object.keys(actual).length !== expected.size) throw new Error(`${label} index domain differs from its primary facts.`);
  for (const [key, members] of expected) {
    members.sort(compareAbstractIdentityText);
    const retained = actual[key];
    if (!Object.hasOwn(actual, key) || retained === undefined || retained.length !== members.length) throw new Error(`${label} index membership differs at '${key}'.`);
    for (let i = 0; i < members.length; i += 1) if (retained[i] !== members[i]) throw new Error(`${label} index order/value differs at '${key}'.`);
  }
}

/** Add one primary identity to an independently derived group. */
function addAbstractIndexMember(groups: Map<string, string[]>, key: string, identity: string): void {
  const members = groups.get(key);
  if (members === undefined) groups.set(key, [identity]); else members.push(identity);
}

/** Independently derive current position, serial, positive-layer, and lot index domains. */
function assertAbstractPositionIndexes(p: InventoryWorldState["projection"]): void {
  assertAbstractRecordIdentities(p.positions, row => abstractProjectionPositionIdentity(row.key), "Position");
  assertAbstractRecordIdentities(p.lots, row => JSON.stringify([row.definition.itemId, row.definition.lotId]), "Lot");
  assertAbstractRecordIdentities(
    p.placementNodes,
    row => row.definition.nodeId,
    "Placement node"
  );
  const byItem = new Map<string, string[]>(), byRevision = new Map<string, string[]>(), byPlacementNode = new Map<string, string[]>(), byWhereabouts = new Map<string, string[]>();
  const serials = new Map<string, string>(), positiveLayers = new Set<string>();
  for (const [identity, position] of Object.entries(p.positions)) {
    addAbstractIndexMember(byItem, position.key.itemId, identity);
    addAbstractIndexMember(byRevision, position.key.itemRevisionId, identity);
    if (position.key.whereaboutsId !== undefined) {
      addAbstractIndexMember(byWhereabouts, position.key.whereaboutsId, identity);
    }
    if (position.key.placementNodeId !== undefined) {
      addAbstractIndexMember(
        byPlacementNode,
        position.key.placementNodeId,
        identity
      );
    }
    if (position.measurements.primary.quantity.amountMinor > 0) {
      positiveLayers.add(identity);
      if (position.key.serialId !== undefined) serials.set(JSON.stringify([position.key.itemId, position.key.serialId]), identity);
    }
  }
  assertAbstractGroupedIndex(p.positionIdsByItemId, byItem, "Item position");
  assertAbstractGroupedIndex(p.positionIdsByItemRevisionId, byRevision, "Revision position");
  assertAbstractGroupedIndex(
    p.positionIdsByWhereaboutsId,
    byWhereabouts,
    "Whereabouts cohort position"
  );
  assertAbstractGroupedIndex(
    p.positionIdsByPlacementNodeId,
    byPlacementNode,
    "Direct placement position"
  );
  assertAbstractScalarIndex(p.positivePositionIdBySerialIdentity, serials, "Positive serial");
  const embodiedNodes = new Map<string, string>();
  for (const [nodeId, projected] of Object.entries(p.placementNodes)) {
    const embodiment = projected.definition.embodiedBy;
    if (embodiment === undefined) continue;
    const serialIdentity = JSON.stringify([
      embodiment.itemId,
      embodiment.serialId,
    ]);
    if (embodiedNodes.has(serialIdentity)) {
      throw new Error("One serial embodiment is bound to more than one node.");
    }
    embodiedNodes.set(serialIdentity, nodeId);
    const positivePositionId = serials.get(serialIdentity);
    const relation = p.placement.relationByNodeId[nodeId];
    if (projected.retiredByEventId !== undefined) {
      if (positivePositionId !== undefined) {
        throw new Error("Retired embodied node still has a live serial resource.");
      }
      if (relation !== undefined) {
        throw new Error("Retired embodied node remains in placement topology.");
      }
      const childNodeIds =
        p.placement.childNodeIdsByParentNodeId[nodeId] ?? [];
      const directPositionIds = p.positionIdsByPlacementNodeId[nodeId] ?? [];
      if (childNodeIds.length !== 0 || directPositionIds.length !== 0) {
        throw new Error("Retired embodied node still has direct contents.");
      }
      continue;
    }
    if (positivePositionId === undefined) {
      throw new Error("Active embodied node has no live serial resource.");
    }
    const position = p.positions[positivePositionId];
    if (position === undefined) {
      throw new Error("Embodied serial index references missing stock.");
    }
    if (relation?.parentNodeId !== position.key.placementNodeId) {
      if (relation !== undefined || position.key.placementNodeId !== undefined) {
        throw new Error(
          "Embodied node parent differs from its unique resource placement."
        );
      }
    }
  }
  assertAbstractScalarIndex(
    p.placementNodeIdByEmbodiedSerialIdentity,
    embodiedNodes,
    "Embodied serial placement node"
  );
  if (Object.keys(p.positiveLayerStartedAtEpochMsByPositionId).length !== positiveLayers.size) throw new Error("Positive layer index domain differs from positive positions.");
  for (const identity of positiveLayers) if (!Object.hasOwn(p.positiveLayerStartedAtEpochMsByPositionId, identity) || !Number.isSafeInteger(p.positiveLayerStartedAtEpochMsByPositionId[identity])) throw new Error("Positive layer index lacks a valid occurrence time.");
  const lotsByItem = new Map<string, string[]>();
  for (const [identity, lot] of Object.entries(p.lots)) addAbstractIndexMember(lotsByItem, lot.definition.itemId, identity);
  assertAbstractGroupedIndex(p.lotIdentitiesByItemId, lotsByItem, "Item lot");
}

/** Derive retained metadata ownership and current corrections from ordered event facts, including tombstoned masters. */
function assertAbstractHistoryIndexes(p: InventoryWorldState["projection"]): void {
  const lotRoots = new Map<string, string>(), placementNodeRoots = new Map<string, string>(), corrections = new Map<string, string>();
  const events = Object.values(p.events).sort((a, b) => a.recordSequence - b.recordSequence);
  for (const event of events) {
    const root = event.correction?.correctsEventId ?? event.eventId;
    if (event.correction !== undefined) corrections.set(root, event.eventId);
    for (const lot of event.lotDefinitions ?? []) {
      const identity = JSON.stringify([lot.itemId, lot.lotId]);
      if (!lotRoots.has(identity)) lotRoots.set(identity, root);
    }
    for (const node of event.placementNodeDefinitions ?? []) {
      if (!placementNodeRoots.has(node.nodeId)) {
        placementNodeRoots.set(node.nodeId, root);
      }
    }
  }
  assertAbstractScalarIndex(p.lotRootEventIdByIdentity, lotRoots, "Lot root ownership");
  assertAbstractScalarIndex(
    p.placementNodeRootEventIdByNodeId,
    placementNodeRoots,
    "Placement-node root ownership"
  );
  assertAbstractScalarIndex(p.correctionEventIdByCorrectedEventId, corrections, "Current correction");
  assertAbstractRecordIdentities(p.transfers, row => row.transferId, "Transfer");
}

/** Require row primary identities to match dictionary keys rather than merely enumerating values. */
function assertAbstractRecordIdentities<T>(rows: Readonly<Record<string, T>>, identityOf: (value: T) => string, label: string): void {
  for (const [key, value] of Object.entries(rows)) if (key !== identityOf(value)) throw new Error(`${label} dictionary key disagrees with its primary identity.`);
}

/** Exact test-only signed amount; no producer quantity arithmetic is reused. */
interface AbstractExactAmount {
  /** Signed integer coefficient accumulated from committed effects. */
  readonly amount: bigint;
  /** Decimal exponent of the integer coefficient. */
  readonly decimals: number;
  /** Physical unit frozen for this measurement axis. */
  readonly unit: string;
}

/** Add a committed measurement with independent scaled-integer arithmetic. */
function addAbstractExactAmount(previous: AbstractExactAmount | undefined, value: Quantity): AbstractExactAmount {
  if (previous !== undefined && previous.unit !== value.unit) throw new Error("Committed measurement history changed the unit of an axis.");
  const decimals = Math.max(previous?.decimals ?? 0, value.decimals);
  return {
    amount: (previous?.amount ?? 0n) * 10n ** BigInt(decimals - (previous?.decimals ?? 0)) + BigInt(value.amountMinor) * 10n ** BigInt(decimals - value.decimals),
    decimals,
    unit: value.unit,
  };
}

/** Compare an observed measurement to its independently accumulated history. */
function abstractExactAmountMatches(expected: AbstractExactAmount | undefined, actual: Quantity): boolean {
  if (expected === undefined) return actual.amountMinor === 0;
  if (expected.unit !== actual.unit) return false;
  const decimals = Math.max(expected.decimals, actual.decimals);
  return expected.amount * 10n ** BigInt(decimals - expected.decimals) === BigInt(actual.amountMinor) * 10n ** BigInt(decimals - actual.decimals);
}

/** Reconstruct every signed stock axis and FIFO age from committed effects, never from projection values. */
function assertAbstractCommittedStock(p: InventoryWorldState["projection"]): void {
  // Journal effects include compensating correction deltas; they are summed, not silently replaced.
  const amounts = new Map<string, Map<string, AbstractExactAmount>>();
  const primaryAxes = new Map<string, string>();
  const layers = new Map<string, number>();
  const orderedEvents = Object.values(p.events).sort((left, right) => left.recordSequence - right.recordSequence);
  for (const event of orderedEvents) {
    // Conserved movement carries the source age that existed before any leg was applied.
    const movedAges = new Map<string, number>();
    for (const transfer of event.positiveLayerProvenanceTransfers ?? []) {
      const source = abstractProjectionPositionIdentity(transfer.from);
      const target = abstractProjectionPositionIdentity(transfer.to);
      const sourceAge = layers.get(source);
      if (sourceAge === undefined) throw new Error("FIFO movement lost its positive source layer.");
      const targetAge = layers.get(target);
      movedAges.set(target, targetAge === undefined ? sourceAge : Math.min(sourceAge, targetAge));
    }
    for (const effect of event.stockEffects) {
      const identity = abstractProjectionPositionIdentity(effect.position);
      let axes = amounts.get(identity);
      if (axes === undefined) { axes = new Map(); amounts.set(identity, axes); }
      const primaryId = effect.measurementsDelta.primary.axisId;
      const retainedPrimary = primaryAxes.get(identity);
      if (retainedPrimary !== undefined && retainedPrimary !== primaryId) throw new Error("Committed stock history changed its primary measurement axis.");
      primaryAxes.set(identity, primaryId);
      const wasPositive = (axes.get(primaryId)?.amount ?? 0n) > 0n;
      for (const measurement of [effect.measurementsDelta.primary, ...effect.measurementsDelta.independent]) {
        axes.set(measurement.axisId, addAbstractExactAmount(axes.get(measurement.axisId), measurement.quantity));
      }
      const isPositive = (axes.get(primaryId)?.amount ?? 0n) > 0n;
      if (!wasPositive && isPositive) layers.set(identity, event.occurredAtEpochMs);
      if (!isPositive) layers.delete(identity);
      if ([...axes.values()].every(value => value.amount === 0n)) { amounts.delete(identity); primaryAxes.delete(identity); }
    }
    for (const [identity, age] of movedAges) {
      if (!layers.has(identity)) throw new Error("FIFO movement has no positive destination layer.");
      layers.set(identity, age);
    }
    // Corrections carry explicit historical-age replacement evidence even when quantity did not change.
    for (const override of event.positiveLayerProvenanceOverrides ?? []) {
      const identity = abstractProjectionPositionIdentity(override.position);
      if (override.startedAtEpochMs === undefined) {
        if (layers.has(identity)) throw new Error("FIFO correction removed the age of positive stock.");
      } else {
        if (!layers.has(identity)) throw new Error("FIFO correction assigned age to nonpositive stock.");
        layers.set(identity, override.startedAtEpochMs);
      }
    }
  }
  if (Object.keys(p.positions).length !== amounts.size) throw new Error("Published stock domain differs from committed effects.");
  for (const [identity, axes] of amounts) {
    const position = p.positions[identity];
    if (position === undefined || !Object.hasOwn(p.positions, identity)) throw new Error("Published stock is missing a committed position.");
    if (position.measurements.primary.axisId !== primaryAxes.get(identity)) throw new Error("Published primary axis differs from committed effects.");
    const observedAxes = new Set<string>();
    for (const measurement of [position.measurements.primary, ...position.measurements.independent]) {
      observedAxes.add(measurement.axisId);
      if (!abstractExactAmountMatches(axes.get(measurement.axisId), measurement.quantity)) throw new Error("Published stock quantity differs from committed effects.");
    }
    for (const [axis, amount] of axes) {
      if (amount.amount !== 0n && !observedAxes.has(axis)) throw new Error("Published stock omitted a committed measurement axis.");
    }
  }
  assertAbstractScalarIndex(p.positiveLayerStartedAtEpochMsByPositionId, layers, "Positive layer history");
}

/** Match one optional identity from the declarative presence or membership meaning. */
function abstractOptionalIdentityMatches(value: string | undefined, kind: "present" | "absent" | "allowed", allowed: readonly string[] | undefined): boolean {
  if (kind === "absent") return value === undefined;
  if (kind === "present") return value !== undefined;
  return value !== undefined && allowed !== undefined && allowed.includes(value);
}

/** Independently interpret all frozen selector dimensions without calling the production matcher. */
function abstractPositionMatchesSelector(
  position: InventoryStockPositionKey,
  selector: InventoryStockSelector,
  placement?: InventoryPlacementState
): boolean {
  if (position.itemId !== selector.itemId) return false;
  if (selector.itemRevisionIds !== undefined && selector.itemRevisionIds.length !== 0 && !selector.itemRevisionIds.includes(position.itemRevisionId)) return false;
  if (
    selector.placement !== undefined &&
    !abstractOptionalIdentityMatches(
      position.placementNodeId,
      selector.placement.kind,
      selector.placement.valueIds
    )
  ) return false;
  if (selector.placementNodeIds !== undefined && selector.placementNodeIds.length !== 0 && (position.placementNodeId === undefined || !selector.placementNodeIds.includes(position.placementNodeId))) return false;
  if (
    selector.whereabouts !== undefined &&
    !abstractOptionalIdentityMatches(
      position.whereaboutsId,
      selector.whereabouts.kind,
      selector.whereabouts.valueIds
    )
  ) return false;
  if (selector.whereaboutsIds !== undefined && selector.whereaboutsIds.length !== 0 && (position.whereaboutsId === undefined || !selector.whereaboutsIds.includes(position.whereaboutsId))) return false;
  if (
    selector.whereaboutsStates !== undefined &&
    (position.whereaboutsState === undefined ||
      !selector.whereaboutsStates.includes(position.whereaboutsState))
  ) return false;
  if (selector.withinPlacementNodeIds !== undefined) {
    if (position.placementNodeId === undefined) return false;
    if (placement === undefined) {
      throw new Error(
        "Abstract subtree selector requires placement topology."
      );
    }
    let matched = false;
    for (const rootNodeId of selector.withinPlacementNodeIds) {
      if (abstractPlacementNodeIsWithin(placement, position.placementNodeId, rootNodeId)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  const identities = [
    [selector.lot, selector.lotIds, position.lotId],
    [selector.serial, selector.serialIds, position.serialId],
    [selector.packagingRevision, selector.packagingRevisionIds, position.packagingRevisionId],
    [selector.status, selector.statusIds, position.statusId],
    [selector.owner, selector.ownerIds, position.ownerId],
    [selector.custodian, selector.custodianIds, position.custodianId],
    [selector.dispositionAuthority, selector.dispositionAuthorityIds, position.dispositionAuthorityId],
  ] as const;
  for (const [constraint, shorthand, value] of identities) {
    if (constraint !== undefined && !abstractOptionalIdentityMatches(value, constraint.kind, constraint.valueIds)) return false;
    if (shorthand !== undefined && shorthand.length !== 0 && (value === undefined || !shorthand.includes(value))) return false;
  }
  for (const dimension of selector.qualifiedDimensions ?? []) {
    const value = position.qualifiedDimensions?.find(row => row.dimensionId === dimension.dimensionId)?.valueId;
    if (!abstractOptionalIdentityMatches(value, dimension.kind ?? "allowed", dimension.valueIds)) return false;
  }
  return true;
}

/** Independently check claim lifecycle/allocation evidence. */
export function assertAbstractReservationInvariants(
  book: InventoryReservationBook,
  placement?: InventoryPlacementState
): void {
  assertAbstractRecordIdentities(book.reservations, row => row.reservationId, "Reservation");
  assertAbstractRecordIdentities(book.operations, row => row.operationId, "Reservation operation");
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
    if (!Object.hasOwn(book.reservations, operation.reservationId)) {
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
    let allocatedTotal: AbstractExactAmount | undefined;
    for (const allocation of reservation.allocations) {
      if (!abstractPositionMatchesSelector(allocation.position, reservation.selector, placement)) throw new Error("Reservation allocation lies outside its frozen selector.");
      allocatedTotal = addAbstractExactAmount(allocatedTotal, allocation.quantity);
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
    if (reservation.allocations.length !== 0 && !abstractExactAmountMatches(allocatedTotal, reservation.requested)) throw new Error("Reservation allocation total differs from its frozen request.");
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
  assertAbstractRecordIdentities(book.counts, row => row.countId, "Count");
  assertAbstractRecordIdentities(book.operations, row => row.operationId, "Count operation");
  for (const operation of Object.values(book.operations)) {
    if (!Object.hasOwn(book.counts, operation.countId)) {
      throw new Error(`Count operation lost '${operation.countId}'.`);
    }
  }
  for (const count of Object.values(book.counts)) {
    requireNonnegativeSafeInteger(
      count.snapshotRecordSequence,
      `Count '${count.countId}' snapshot sequence`
    );
    if (count.status === "started" && count.observedAtEpochMs !== undefined) {
      throw new Error(
        `Started count '${count.countId}' already has an observation time.`
      );
    }
    if (
      (count.status === "observed" || count.status === "completed") &&
      (count.observedAtEpochMs === undefined ||
        count.observedThroughRecordSequence === undefined)
    ) {
      throw new Error(
        `Observed count '${count.countId}' lacks observation evidence.`
      );
    }
    if (count.status === "completed" && count.statusAtEpochMs === undefined) {
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

/** Derive one traceability node identity without calling the production identity helper. */
function abstractTraceabilityNodeIdentity(
  node: InventoryTraceabilityRelation["from"]
): string {
  return JSON.stringify([node.kind, node.itemId ?? null, node.id]);
}

/** Reject a cycle in one independently derived directed adjacency map without recursion. */
function assertAbstractDirectedGraphAcyclic(
  outputsByInput: ReadonlyMap<string, readonly string[]>,
  label: string
): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  for (const start of outputsByInput.keys()) {
    if (visited.has(start)) continue;
    const stack: { node: string; nextOutput: number }[] = [
      { node: start, nextOutput: 0 },
    ];
    active.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const outputs = outputsByInput.get(frame.node) ?? [];
      if (frame.nextOutput >= outputs.length) {
        active.delete(frame.node);
        visited.add(frame.node);
        stack.pop();
        continue;
      }
      const output = outputs[frame.nextOutput];
      frame.nextOutput += 1;
      if (output === undefined) continue;
      if (active.has(output))
        throw new Error(`Abstract ${label} graph contains a cycle.`);
      if (visited.has(output)) continue;
      active.add(output);
      stack.push({ node: output, nextOutput: 0 });
    }
  }
}

/** Return whether one node is equal to or descends from one candidate root. */
function abstractPlacementNodeIsWithin(
  state: InventoryPlacementState,
  nodeId: string,
  rootNodeId: string
): boolean {
  const visited = new Set<string>();
  let current: string | undefined = nodeId;
  while (current !== undefined) {
    if (current === rootNodeId) return true;
    if (visited.has(current)) {
      throw new Error(`Abstract placement graph contains a cycle at '${current}'.`);
    }
    visited.add(current);
    current = state.relationByNodeId[current]?.parentNodeId;
  }
  return false;
}

/** Independently check placement identity, child-index, policy, and forest invariants. */
export function assertAbstractPlacementInvariants(
  state: InventoryPlacementState,
  placementNodes: InventoryWorldState["projection"]["placementNodes"] = {},
  positions: InventoryWorldState["projection"]["positions"] = {}
): void {
  const expectedChildren = new Map<string, string[]>();
  const parentByNode = new Map<string, string>();
  for (const [nodeId, relation] of Object.entries(state.relationByNodeId)) {
    if (nodeId !== relation.nodeId) {
      throw new Error(
        "Placement relation dictionary key disagrees with its child identity."
      );
    }
    if (nodeId === relation.parentNodeId) {
      throw new Error(`Abstract placement node '${nodeId}' cannot parent itself.`);
    }
    parentByNode.set(nodeId, relation.parentNodeId);
    addAbstractIndexMember(expectedChildren, relation.parentNodeId, nodeId);
    if (placementNodes[relation.parentNodeId]?.definition.acceptsPlacement === false) {
      throw new Error(
        `Abstract placement parent '${relation.parentNodeId}' rejects direct placement.`
      );
    }
  }
  assertAbstractGroupedIndex(
    state.childNodeIdsByParentNodeId,
    expectedChildren,
    "Placement child"
  );
  const outputs = new Map<string, string[]>();
  for (const [child, parent] of parentByNode) {
    addAbstractIndexMember(outputs, child, parent);
  }
  assertAbstractDirectedGraphAcyclic(outputs, "placement");
  for (const position of Object.values(positions)) {
    if (
      position.key.placementNodeId !== undefined &&
      placementNodes[position.key.placementNodeId]?.definition
        .acceptsPlacement === false
    ) {
      throw new Error(
        `Abstract direct placement node '${position.key.placementNodeId}' rejects stock.`
      );
    }
  }
}

/** Independently check effective association identities and genealogy DAG invariants. */
export function assertAbstractTraceabilityInvariants(
  state: InventoryTraceabilityState
): void {
  const genealogyOutputs = new Map<string, string[]>();
  for (const [identity, relation] of Object.entries(state.relations)) {
    const fromIdentity = abstractTraceabilityNodeIdentity(relation.from);
    const toIdentity = abstractTraceabilityNodeIdentity(relation.to);
    const expectedIdentity = JSON.stringify([
      relation.kind,
      fromIdentity,
      toIdentity,
    ]);
    if (identity !== expectedIdentity) {
      throw new Error(
        "Traceability relation dictionary key disagrees with its primary identity."
      );
    }
    if (relation.kind === "genealogy") {
      addAbstractIndexMember(genealogyOutputs, fromIdentity, toIdentity);
    }
  }
  assertAbstractDirectedGraphAcyclic(genealogyOutputs, "genealogy");
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
  assertAbstractReservationInvariants(after.reservations, after.projection.placement);
  assertAbstractCountInvariants(after.counts);
  const observation = abstractOperationResult(result);
  const resultEvent = "event" in result ? result.event : undefined;
  const resultReservation = "reservation" in result ? result.reservation : undefined;
  const resultCount = "count" in result ? result.count : undefined;
  if ((resultEvent === undefined) !== (result.receipt.eventId === undefined)) {
    throw new Error("Result receipt event selector disagrees with the returned result kind.");
  }
  if ((resultReservation === undefined) !== (result.receipt.reservationId === undefined)) {
    throw new Error("Result receipt reservation selector disagrees with the returned result kind.");
  }
  if ((resultCount === undefined) !== (result.receipt.countId === undefined)) {
    throw new Error("Result receipt count selector disagrees with the returned result kind.");
  }
  if (observation.worldRevision !== after.revision) {
    throw new Error(
      "Operation receipt revision disagrees with published world."
    );
  }
  if (result.replayed) {
    if (
      !isDeepStrictEqual(
        abstractInventoryState(before),
        abstractInventoryState(after)
      )
    ) {
      throw new Error("Exact replay changed abstract physical state.");
    }
    if (
      !isDeepStrictEqual(
        abstractReservationState(before.reservations),
        abstractReservationState(after.reservations)
      ) ||
      !isDeepStrictEqual(
        abstractCountState(before.counts),
        abstractCountState(after.counts)
      )
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
    const publishedEvent = after.projection.events[observation.event.eventId];
    if (
      publishedEvent === undefined ||
      !("event" in result) ||
      !isDeepStrictEqual(
        canonicalValue(publishedEvent),
        canonicalValue(result.event)
      )
    ) {
      throw new Error("Result event disagrees with published event truth.");
    }
    if (result.receipt.recordedAtEpochMs !== publishedEvent.recordedAtEpochMs) {
      throw new Error("Result receipt record time disagrees with committed event truth.");
    }
  }
  if (observation.reservation !== undefined) {
    const reservationId = String(observation.reservation.reservationId);
    const publishedReservation = after.reservations.reservations[reservationId];
    if (
      publishedReservation === undefined ||
      !("reservation" in result) ||
      !isDeepStrictEqual(
        canonicalValue(publishedReservation),
        canonicalValue(result.reservation)
      )
    ) {
      throw new Error("Result reservation disagrees with published reservation truth.");
    }
    if (result.receipt.reservationId !== reservationId) {
      throw new Error("Result receipt and reservation identity disagree.");
    }
    const receiptOperation = after.reservations.operations[observation.operationId];
    if (
      !Object.hasOwn(after.reservations.operations, observation.operationId) ||
      receiptOperation === undefined ||
      receiptOperation.reservationId !== reservationId
    ) {
      throw new Error("Result receipt operation identity disagrees with reservation lifecycle truth.");
    }
    const operationExistedBefore = Object.hasOwn(
      before.reservations.operations,
      observation.operationId
    );
    if (operationExistedBefore !== result.replayed) {
      throw new Error("Result reservation replay flag disagrees with lifecycle operation history.");
    }
  }
  if (observation.count !== undefined) {
    const countId = String(observation.count.countId);
    const publishedCount = after.counts.counts[countId];
    if (
      publishedCount === undefined ||
      !("count" in result) ||
      !isDeepStrictEqual(
        canonicalValue(publishedCount),
        canonicalValue(result.count)
      )
    ) {
      throw new Error("Result count disagrees with published count truth.");
    }
    if (result.receipt.countId !== countId) {
      throw new Error("Result receipt and count identity disagree.");
    }
    const receiptOperation = after.counts.operations[observation.operationId];
    if (
      !Object.hasOwn(after.counts.operations, observation.operationId) ||
      receiptOperation === undefined ||
      receiptOperation.countId !== countId
    ) {
      throw new Error("Result receipt operation identity disagrees with count lifecycle truth.");
    }
    const operationExistedBefore = Object.hasOwn(
      before.counts.operations,
      observation.operationId
    );
    if (operationExistedBefore !== result.replayed) {
      throw new Error("Result count replay flag disagrees with lifecycle operation history.");
    }
  }
  if (observation.transfer !== undefined) {
    const transferId = String(observation.transfer.transferId);
    const publishedTransfer = after.projection.transfers[transferId];
    if (
      publishedTransfer === undefined ||
      !("transfer" in result) ||
      !isDeepStrictEqual(
        canonicalValue(publishedTransfer),
        canonicalValue(result.transfer)
      )
    ) {
      throw new Error("Result transfer disagrees with published transfer truth.");
    }
  }
  if ("deficit" in result && result.deficit !== undefined) {
    const metadata = canonicalValue(
      result.event.metadata?.inventoryOncePolicyDeficit
    );
    if (
      !isDeepStrictEqual(
        metadata,
        abstractPolicyDeficitMetadata(result.deficit)
      )
    ) {
      throw new Error("Result deficit disagrees with immutable event evidence.");
    }
  }
  if ("allocations" in result) {
    const metadata = canonicalValue(
      result.event.metadata?.inventoryOncePolicyBatch
    );
    if (
      !isDeepStrictEqual(
        metadata,
        abstractPolicyBatchMetadata(result.allocations)
      )
    ) {
      throw new Error("Policy allocations disagree with immutable event evidence.");
    }
    if (
      !isDeepStrictEqual(
        result.allocationGroups.map(abstractPolicyAllocationGroup),
        abstractExpectedPolicyAllocationGroups(result.allocations)
      )
    ) {
      throw new Error("Policy allocation groups disagree with exact allocations.");
    }
  }
}

/** Sum one primary unit across abstract buckets with exact scaled-integer arithmetic. */
export function abstractPrimaryBalance(
  world: InventoryWorldState,
  itemId: string,
  placementNodeId: string,
  unit: string
): string {
  let total = zeroQuantity(unit);
  for (const bucket of abstractInventoryState(world).buckets) {
    if (bucket.key.itemId !== itemId || bucket.key.placementNodeId !== placementNodeId)
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
