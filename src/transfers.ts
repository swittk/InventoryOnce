import {
  InventoryEventKind,
  InventoryTransferLifecycleAction,
  defineInventoryEvent,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryMeasurementEvidence,
  type InventoryPositiveLayerProvenanceTransfer,
  type InventoryStockEffect,
  type InventoryTransferLifecycleChange,
} from "./events.js";
import {
  InventoryAmountKind,
  resolveInventoryAmount,
  type InventoryAmount,
  type ResolvedInventoryAmount,
} from "./amounts.js";
import type {
  InventoryCatalog,
  InventoryItemDefinitionRevision,
} from "./catalog.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
  type InventoryIntentFingerprintValue,
} from "./canonical.js";
import {
  inventoryEventIdForOperation,
  type InventoryCommandHeader,
} from "./commands.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementsAreZero,
  inventoryMeasurementsEqual,
  negateInventoryMeasurements,
  nonNegativeInventoryMeasurements,
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  inventoryStockPositionIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryStockPosition,
  type InventoryStockPositionInput,
  type InventoryStockPositionKey,
  type PartyId,
} from "./model.js";

/** Durable lifecycle derived from immutable physical transfer events. */
export enum InventoryTransferStatus {
  /** Prepared transfer-lifecycle state/action. */ Prepared = "prepared",
  /** InTransit transfer-lifecycle state/action. */ InTransit = "in-transit",
  /** PartiallyReceived transfer-lifecycle state/action. */ PartiallyReceived = "partially-received",
  /** Received transfer-lifecycle state/action. */ Received = "received",
  /** Released transfer-lifecycle state/action. */ Released = "released",
}

/** One exact physical line retained for the lifetime of a transfer. */
export interface InventoryTransferLine {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle sourcePosition value retained or supplied by this record. */ readonly sourcePosition: InventoryStockPositionKey;
  /** Transfer-lifecycle preparedMeasurements value retained or supplied by this record. */ readonly preparedMeasurements: InventoryMeasurementVector;
  /** Transfer-lifecycle receivedMeasurements value retained or supplied by this record. */ readonly receivedMeasurements: InventoryMeasurementVector;
}

/** Current first-class physical transfer truth rebuilt from committed events. */
export interface InventoryTransfer {
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
  /** Transfer-lifecycle sourceLocationId value retained or supplied by this record. */ readonly sourceLocationId: string;
  /** Transfer-lifecycle transitLocationId value retained or supplied by this record. */ readonly transitLocationId: string;
  /** Transfer-lifecycle destinationLocationId value retained or supplied by this record. */ readonly destinationLocationId: string;
  /** Transfer-lifecycle destinationCustodianId value retained or supplied by this record. */ readonly destinationCustodianId?: PartyId;
  /** Transfer-lifecycle carrierCustodianId value retained or supplied by this record. */ readonly carrierCustodianId?: PartyId;
  /** Transfer-lifecycle status value retained or supplied by this record. */ readonly status: InventoryTransferStatus;
  /** Transfer-lifecycle lines value retained or supplied by this record. */ readonly lines: readonly InventoryTransferLine[];
  /** Transfer-lifecycle preparedAt value retained or supplied by this record. */ readonly preparedAt: string;
  /** Transfer-lifecycle preparedEventId value retained or supplied by this record. */ readonly preparedEventId: string;
  /** Transfer-lifecycle dispatchedAt value retained or supplied by this record. */ readonly dispatchedAt?: string;
  /** Transfer-lifecycle dispatchEventId value retained or supplied by this record. */ readonly dispatchEventId?: string;
  /** Transfer-lifecycle lastReceivedAt value retained or supplied by this record. */ readonly lastReceivedAt?: string;
  /** Transfer-lifecycle releasedAt value retained or supplied by this record. */ readonly releasedAt?: string;
  /** Transfer-lifecycle releaseEventId value retained or supplied by this record. */ readonly releaseEventId?: string;
  /** Transfer-lifecycle sourceReference value retained or supplied by this record. */ readonly sourceReference?: string;
}

/** Kernel-owned source commitment position for one prepared line. */
export function inventoryTransferPreparedPosition(
  transfer: Pick<InventoryTransfer, "transferId">,
  line: Pick<InventoryTransferLine, "sourcePosition">
): InventoryStockPositionKey {
  return normalizeInventoryStockPositionKey({
    ...line.sourcePosition,
    transferId: transfer.transferId,
  });
}

/** Kernel-owned real in-transit position for one dispatched line. */
export function inventoryTransferTransitPosition(
  transfer: Pick<
    InventoryTransfer,
    "transferId" | "transitLocationId" | "carrierCustodianId"
  >,
  line: Pick<InventoryTransferLine, "sourcePosition">
): InventoryStockPositionKey {
  return normalizeInventoryStockPositionKey({
    ...line.sourcePosition,
    locationId: transfer.transitLocationId,
    transferId: transfer.transferId,
    ...(transfer.carrierCustodianId === undefined
      ? {}
      : { custodianId: transfer.carrierCustodianId }),
  });
}

/** Ordinary destination position after receipt clears the transfer partition. */
export function inventoryTransferDestinationPosition(
  transfer: Pick<
    InventoryTransfer,
    "destinationLocationId" | "destinationCustodianId"
  >,
  line: Pick<InventoryTransferLine, "sourcePosition">
): InventoryStockPositionKey {
  return normalizeInventoryStockPositionKey({
    ...line.sourcePosition,
    locationId: transfer.destinationLocationId,
    ...(transfer.destinationCustodianId === undefined
      ? {}
      : { custodianId: transfer.destinationCustodianId }),
  });
}

/** Exact still-unreceived quantity for one transfer line. */
export function inventoryTransferRemainingMeasurements(
  line: InventoryTransferLine
): InventoryMeasurementVector {
  return subtractInventoryMeasurements(
    line.preparedMeasurements,
    line.receivedMeasurements
  );
}

/** Apply/validate one structured lifecycle event and return the next transfer projection. */
export function applyInventoryTransferLifecycleEvent(
  current: Readonly<Record<string, InventoryTransfer>>,
  positions: Readonly<Record<string, InventoryStockPosition>>,
  event: InventoryCommittedEvent
): Readonly<Record<string, InventoryTransfer>> {
  const change = event.transferLifecycle;
  if (change === undefined) return current;
  assertTransferNegativeEffectsHavePhysicalCapacity(
    positions,
    event.stockEffects
  );
  const existing = current[change.transferId];
  if (change.action === InventoryTransferLifecycleAction.Prepare) {
    if (existing !== undefined)
      throw new Error(
        `Inventory transfer '${change.transferId}' already exists.`
      );
    // Reject duplicate logical lines before effects are derived so one transfer line cannot appear twice.
    assertUniqueTransferLineIds(change.lines, "prepared transfer");
    const lines = change.lines.map(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        line
      ): InventoryTransferLine => ({
        ...line,
        receivedMeasurements: zeroInventoryMeasurements(
          line.preparedMeasurements
        ),
      })
    );
    const transfer: InventoryTransfer = {
      transferId: change.transferId,
      sourceLocationId: change.sourceLocationId,
      transitLocationId: change.transitLocationId,
      destinationLocationId: change.destinationLocationId,
      ...(change.destinationCustodianId === undefined
        ? {}
        : { destinationCustodianId: change.destinationCustodianId }),
      status: InventoryTransferStatus.Prepared,
      lines,
      preparedAt: event.occurredAt,
      preparedEventId: event.eventId,
      ...(event.sourceReference === undefined
        ? {}
        : { sourceReference: event.sourceReference }),
    };
    assertTransferEventEffects(event.stockEffects, prepareEffects(transfer));
    assertDistinctLifecyclePositions(transfer);
    return { ...current, [transfer.transferId]: transfer };
  }
  if (existing === undefined)
    throw new Error(`Unknown inventory transfer '${change.transferId}'.`);
  if (change.action === InventoryTransferLifecycleAction.Release) {
    if (existing.status !== InventoryTransferStatus.Prepared)
      throw new Error("Only a prepared transfer can be released.");
    assertTransferEventEffects(event.stockEffects, releaseEffects(existing));
    return {
      ...current,
      [existing.transferId]: {
        ...existing,
        status: InventoryTransferStatus.Released,
        releasedAt: event.occurredAt,
        releaseEventId: event.eventId,
      },
    };
  }
  if (change.action === InventoryTransferLifecycleAction.Dispatch) {
    if (existing.status !== InventoryTransferStatus.Prepared)
      throw new Error("Only a prepared transfer can be dispatched.");
    const dispatched: InventoryTransfer = {
      ...existing,
      ...(change.carrierCustodianId === undefined
        ? {}
        : { carrierCustodianId: change.carrierCustodianId }),
      status: InventoryTransferStatus.InTransit,
      dispatchedAt: event.occurredAt,
      dispatchEventId: event.eventId,
    };
    assertDistinctLifecyclePositions(dispatched);
    assertTransferEventEffects(event.stockEffects, dispatchEffects(dispatched));
    return { ...current, [existing.transferId]: dispatched };
  }
  if (
    existing.status !== InventoryTransferStatus.InTransit &&
    existing.status !== InventoryTransferStatus.PartiallyReceived
  ) {
    throw new Error("Only dispatched transfer stock can be received.");
  }
  assertUniqueTransferLineIds(change.lines, "transfer receipt");
  const receivedByLine = new Map<string, InventoryMeasurementVector>();
  for (const line of change.lines)
    receivedByLine.set(line.lineId, line.receivedMeasurements);
  const nextLines = existing.lines.map(
    /** Process one transfer-lifecycle collection entry deterministically. */ (
      line
    ): InventoryTransferLine => {
      const received = receivedByLine.get(line.lineId);
      if (received === undefined) return line;
      const cumulative = addInventoryMeasurements(
        line.receivedMeasurements,
        received
      );
      nonNegativeInventoryMeasurements(
        subtractInventoryMeasurements(line.preparedMeasurements, cumulative),
        "transfer remaining measurements"
      );
      return { ...line, receivedMeasurements: cumulative };
    }
  );
  for (const lineId of receivedByLine.keys())
    if (
      !existing.lines.some(
        /** Process one transfer-lifecycle collection entry deterministically. */ (
          line
        ) => line.lineId === lineId
      )
    )
      throw new Error(`Unknown transfer line '${lineId}'.`);
  assertTransferEventEffects(
    event.stockEffects,
    receiveEffects(existing, receivedByLine)
  );
  const complete = nextLines.every(
    /** Process one transfer-lifecycle collection entry deterministically. */ (
      line
    ) =>
      inventoryMeasurementsAreZero(inventoryTransferRemainingMeasurements(line))
  );
  return {
    ...current,
    [existing.transferId]: {
      ...existing,
      lines: nextLines,
      status: complete
        ? InventoryTransferStatus.Received
        : InventoryTransferStatus.PartiallyReceived,
      lastReceivedAt: event.occurredAt,
    },
  };
}

/** Require every transfer lifecycle subtraction to be backed by current positive physical truth. */
function assertTransferNegativeEffectsHavePhysicalCapacity(
  positions: Readonly<Record<string, InventoryStockPosition>>,
  effects: readonly InventoryStockEffect[]
): void {
  for (const effect of effects) {
    if (effect.measurementsDelta.primary.quantity.amountMinor >= 0) continue;
    const identity = inventoryStockPositionIdentity(effect.position);
    const current = positions[identity];
    if (current === undefined) {
      throw new Error(
        "Transfer lifecycle cannot subtract stock that is not currently physical."
      );
    }
    nonNegativeInventoryMeasurements(
      subtractInventoryMeasurements(
        current.measurements,
        negateInventoryMeasurements(effect.measurementsDelta)
      ),
      "transfer lifecycle physical remainder"
    );
  }
}

/** Build the exact stock effects required to prepare one transfer. */
function prepareEffects(
  transfer: InventoryTransfer
): readonly ExpectedTransferEffect[] {
  const effects: ExpectedTransferEffect[] = [];
  for (const line of transfer.lines) {
    effects.push({
      position: line.sourcePosition,
      measurements: negateInventoryMeasurements(line.preparedMeasurements),
    });
    effects.push({
      position: inventoryTransferPreparedPosition(transfer, line),
      measurements: line.preparedMeasurements,
    });
  }
  return effects;
}

/** Build the exact effects required to release a prepared transfer. */
function releaseEffects(
  transfer: InventoryTransfer
): readonly ExpectedTransferEffect[] {
  const effects: ExpectedTransferEffect[] = [];
  for (const line of transfer.lines) {
    effects.push({
      position: inventoryTransferPreparedPosition(transfer, line),
      measurements: negateInventoryMeasurements(line.preparedMeasurements),
    });
    effects.push({
      position: line.sourcePosition,
      measurements: line.preparedMeasurements,
    });
  }
  return effects;
}

/** Build the exact effects required to dispatch every prepared line. */
function dispatchEffects(
  transfer: InventoryTransfer
): readonly ExpectedTransferEffect[] {
  const effects: ExpectedTransferEffect[] = [];
  for (const line of transfer.lines) {
    effects.push({
      position: inventoryTransferPreparedPosition(transfer, line),
      measurements: negateInventoryMeasurements(line.preparedMeasurements),
    });
    effects.push({
      position: inventoryTransferTransitPosition(transfer, line),
      measurements: line.preparedMeasurements,
    });
  }
  return effects;
}

/** Build exact partial/full receipt effects for only named lines. */
function receiveEffects(
  transfer: InventoryTransfer,
  receivedByLine: ReadonlyMap<string, InventoryMeasurementVector>
): readonly ExpectedTransferEffect[] {
  const effects: ExpectedTransferEffect[] = [];
  for (const line of transfer.lines) {
    const received = receivedByLine.get(line.lineId);
    if (received === undefined) continue;
    effects.push({
      position: inventoryTransferTransitPosition(transfer, line),
      measurements: negateInventoryMeasurements(received),
    });
    effects.push({
      position: inventoryTransferDestinationPosition(transfer, line),
      measurements: received,
    });
  }
  return effects;
}

/** ExpectedTransferEffect shape used by exact transfer-lifecycle semantics. */ interface ExpectedTransferEffect {
  /** Transfer-lifecycle position value retained or supplied by this record. */ readonly position: InventoryStockPositionKey;
  /** Transfer-lifecycle measurements value retained or supplied by this record. */ readonly measurements: InventoryMeasurementVector;
}

/** Prove lifecycle metadata and physical effects describe exactly the same conserved movement. */
function assertTransferEventEffects(
  actual: readonly InventoryStockEffect[],
  expected: readonly ExpectedTransferEffect[]
): void {
  const expectedByPosition = combineExpectedEffects(expected);
  if (actual.length !== expectedByPosition.size)
    throw new Error(
      "Transfer lifecycle stock effects differ from its structured physical truth."
    );
  for (const effect of actual) {
    const identity = inventoryStockPositionIdentity(effect.position);
    const wanted = expectedByPosition.get(identity);
    if (
      wanted === undefined ||
      !inventoryMeasurementsEqual(effect.measurementsDelta, wanted)
    ) {
      throw new Error(
        "Transfer lifecycle stock effects differ from its structured physical truth."
      );
    }
    expectedByPosition.delete(identity);
  }
  if (expectedByPosition.size !== 0)
    throw new Error("Transfer lifecycle is missing required stock effects.");
}

/** Combine expected effects so legal destination merges remain explicit and deterministic. */
function combineExpectedEffects(
  effects: readonly ExpectedTransferEffect[]
): Map<string, InventoryMeasurementVector> {
  const result = new Map<string, InventoryMeasurementVector>();
  for (const effect of effects) {
    const identity = inventoryStockPositionIdentity(effect.position);
    const earlier = result.get(identity);
    result.set(
      identity,
      earlier === undefined
        ? effect.measurements
        : addInventoryMeasurements(earlier, effect.measurements)
    );
  }
  for (const [identity, measurements] of [...result])
    if (inventoryMeasurementsAreZero(measurements)) result.delete(identity);
  return result;
}

/** Require stable line identity to be unique inside one lifecycle change. */
function assertUniqueTransferLineIds(
  lines: readonly {
    /** Stable lifecycle line identity being checked for uniqueness. */
    readonly lineId: string;
  }[],
  context: string
): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.lineId))
      throw new Error(`Duplicate ${context} lineId '${line.lineId}'.`);
    seen.add(line.lineId);
  }
}

/** Reject custody overrides that would collapse independently receivable lines. */
function assertDistinctLifecyclePositions(transfer: InventoryTransfer): void {
  assertDistinctPositions(
    transfer.lines.map(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        line
      ) => inventoryTransferPreparedPosition(transfer, line)
    ),
    "prepared"
  );
  assertDistinctPositions(
    transfer.lines.map(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        line
      ) => inventoryTransferTransitPosition(transfer, line)
    ),
    "transit"
  );
  assertDistinctPositions(
    transfer.lines.map(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        line
      ) => inventoryTransferDestinationPosition(transfer, line)
    ),
    "destination"
  );
}

/** assertDistinctPositions helper for exact transfer-lifecycle semantics. */ function assertDistinctPositions(
  positions: readonly InventoryStockPositionKey[],
  label: string
): void {
  const seen = new Set<string>();
  for (const position of positions) {
    const identity = inventoryStockPositionIdentity(position);
    if (seen.has(identity))
      throw new Error(
        `Transfer ${label} positions would collapse distinct transfer lines.`
      );
    seen.add(identity);
  }
}

/** One exact source line committed by transfer preparation. */
export interface InventoryTransferPrepareLineInput {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle from value retained or supplied by this record. */ readonly from: InventoryStockPositionInput;
  /** Transfer-lifecycle amount value retained or supplied by this record. */ readonly amount: InventoryAmount;
  /** Transfer-lifecycle itemRevisionId value retained or supplied by this record. */ readonly itemRevisionId?: string;
}

/** First-class source commitment before any physical dispatch. */
export interface CreateInventoryTransferPrepareEventInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle catalog value retained or supplied by this record. */ readonly catalog: InventoryCatalog;
  /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
  /** Transfer-lifecycle transitLocationId value retained or supplied by this record. */ readonly transitLocationId: string;
  /** Transfer-lifecycle destinationLocationId value retained or supplied by this record. */ readonly destinationLocationId: string;
  /** Transfer-lifecycle destinationCustodianId value retained or supplied by this record. */ readonly destinationCustodianId?: PartyId;
  /** Transfer-lifecycle lines value retained or supplied by this record. */ readonly lines: readonly InventoryTransferPrepareLineInput[];
}

/** Dispatch one whole prepared transfer into its dedicated transit partition. */
export interface CreateInventoryTransferDispatchEventInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle catalog value retained or supplied by this record. */ readonly catalog: InventoryCatalog;
  /** Transfer-lifecycle transfer value retained or supplied by this record. */ readonly transfer: InventoryTransfer;
  /** Transfer-lifecycle carrierCustodianId value retained or supplied by this record. */ readonly carrierCustodianId?: PartyId;
}

/** One partial/full line receipt expressed in normal public inventory amount semantics. */
export interface InventoryTransferReceiveLineInput {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle amount value retained or supplied by this record. */ readonly amount: InventoryAmount;
}

/** Receive named quantities, or all remaining quantities when lines are omitted. */
export interface CreateInventoryTransferReceiveEventInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle catalog value retained or supplied by this record. */ readonly catalog: InventoryCatalog;
  /** Transfer-lifecycle transfer value retained or supplied by this record. */ readonly transfer: InventoryTransfer;
  /** Transfer-lifecycle lines value retained or supplied by this record. */ readonly lines?: readonly InventoryTransferReceiveLineInput[];
}

/** Release one prepared transfer before dispatch. */
export interface CreateInventoryTransferReleaseEventInput
  extends InventoryCommandHeader {
  /** Transfer-lifecycle catalog value retained or supplied by this record. */ readonly catalog: InventoryCatalog;
  /** Transfer-lifecycle transfer value retained or supplied by this record. */ readonly transfer: InventoryTransfer;
}

/** Partition exact source stock under a kernel-owned transfer identity without moving location. */
export function createInventoryTransferPrepareEvent(
  input: CreateInventoryTransferPrepareEventInput
): InventoryEventDraft {
  if (input.lines.length === 0)
    throw new Error("Transfer prepare needs at least one physical line.");
  const sourceLocations = new Set<string>();
  const effects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  const lifecycleLines: {
    /** Transfer-lifecycle lineId value retained or supplied by this record. */ lineId: string;
    /** Transfer-lifecycle sourcePosition value retained or supplied by this record. */ sourcePosition: InventoryStockPositionKey;
    /** Transfer-lifecycle preparedMeasurements value retained or supplied by this record. */ preparedMeasurements: InventoryMeasurementVector;
  }[] = [];
  const seenLineIds = new Set<string>();
  for (const line of input.lines) {
    if (seenLineIds.has(line.lineId)) {
      throw new Error(`Duplicate transfer prepare lineId '${line.lineId}'.`);
    }
    seenLineIds.add(line.lineId);
    const resolvedLine = resolveTransferPrepareLine(input.catalog, line);
    sourceLocations.add(resolvedLine.position.locationId);
    effects.push(
      transferEffect(
        resolvedLine.position,
        negateInventoryMeasurements(resolvedLine.amount.measurements),
        resolvedLine.amount
      )
    );
    const preparedPosition = normalizeInventoryStockPositionKey({
      ...resolvedLine.position,
      transferId: input.transferId,
    });
    effects.push(
      transferEffect(
        preparedPosition,
        resolvedLine.amount.measurements,
        resolvedLine.amount
      )
    );
    provenanceTransfers.push({
      from: resolvedLine.position,
      to: preparedPosition,
    });
    lifecycleLines.push({
      lineId: line.lineId,
      sourcePosition: resolvedLine.position,
      preparedMeasurements: resolvedLine.amount.measurements,
    });
  }
  if (sourceLocations.size !== 1)
    throw new Error(
      "One physical transfer must have exactly one source location."
    );
  const sourceLocationId = sourceLocations.values().next().value;
  if (sourceLocationId === undefined)
    throw new Error("Transfer prepare source location is missing.");
  return transferLifecycleEvent(
    input.catalog,
    InventoryEventKind.Reclassification,
    input,
    effects,
    {
      action: InventoryTransferLifecycleAction.Prepare,
      transferId: input.transferId,
      sourceLocationId,
      transitLocationId: input.transitLocationId,
      destinationLocationId: input.destinationLocationId,
      ...(input.destinationCustodianId === undefined
        ? {}
        : { destinationCustodianId: input.destinationCustodianId }),
      lines: lifecycleLines,
    },
    provenanceTransfers
  );
}

/** Move every prepared line into real in-transit stock, retaining transfer identity. */
export function createInventoryTransferDispatchEvent(
  input: CreateInventoryTransferDispatchEventInput
): InventoryEventDraft {
  if (input.transfer.status !== InventoryTransferStatus.Prepared)
    throw new Error("Only a prepared transfer can be dispatched.");
  const dispatched: InventoryTransfer = {
    ...input.transfer,
    ...(input.carrierCustodianId === undefined
      ? {}
      : { carrierCustodianId: input.carrierCustodianId }),
  };
  const effects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const line of dispatched.lines) {
    const preparedPosition = inventoryTransferPreparedPosition(
      dispatched,
      line
    );
    const transitPosition = inventoryTransferTransitPosition(dispatched, line);
    effects.push(
      transferEffect(
        preparedPosition,
        negateInventoryMeasurements(line.preparedMeasurements)
      )
    );
    effects.push(transferEffect(transitPosition, line.preparedMeasurements));
    provenanceTransfers.push({ from: preparedPosition, to: transitPosition });
  }
  return transferLifecycleEvent(
    input.catalog,
    InventoryEventKind.Transfer,
    input,
    effects,
    {
      action: InventoryTransferLifecycleAction.Dispatch,
      transferId: input.transfer.transferId,
      ...(input.carrierCustodianId === undefined
        ? {}
        : { carrierCustodianId: input.carrierCustodianId }),
    },
    provenanceTransfers
  );
}

/** Move only this transfer's named in-transit quantities into ordinary destination stock. */
export function createInventoryTransferReceiveEvent(
  input: CreateInventoryTransferReceiveEventInput
): InventoryEventDraft {
  const transfer = input.transfer;
  if (
    transfer.status !== InventoryTransferStatus.InTransit &&
    transfer.status !== InventoryTransferStatus.PartiallyReceived
  )
    throw new Error("Only dispatched transfer stock can be received.");
  const requested =
    input.lines === undefined
      ? fullRemainingReceiptLines(transfer)
      : resolveRequestedReceiptLines(input.catalog, transfer, input.lines);
  if (requested.length === 0)
    throw new Error(
      "Transfer receive needs at least one positive remaining line."
    );
  const effects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const received of requested) {
    const line = requireTransferLine(transfer, received.lineId);
    const transitPosition = inventoryTransferTransitPosition(transfer, line);
    const destinationPosition = inventoryTransferDestinationPosition(
      transfer,
      line
    );
    effects.push(
      transferEffect(
        transitPosition,
        negateInventoryMeasurements(received.receivedMeasurements),
        received.resolvedAmount
      )
    );
    effects.push(
      transferEffect(
        destinationPosition,
        received.receivedMeasurements,
        received.resolvedAmount
      )
    );
    provenanceTransfers.push({
      from: transitPosition,
      to: destinationPosition,
    });
  }
  return transferLifecycleEvent(
    input.catalog,
    InventoryEventKind.Transfer,
    input,
    effects,
    {
      action: InventoryTransferLifecycleAction.Receive,
      transferId: transfer.transferId,
      lines: requested.map(
        /** Process one transfer-lifecycle collection entry deterministically. */ ({
          lineId,
          receivedMeasurements,
        }) => ({ lineId, receivedMeasurements })
      ),
    },
    provenanceTransfers
  );
}

/** Return prepared stock to its exact ordinary source positions without faking a movement. */
export function createInventoryTransferReleaseEvent(
  input: CreateInventoryTransferReleaseEventInput
): InventoryEventDraft {
  const transfer = input.transfer;
  if (transfer.status !== InventoryTransferStatus.Prepared)
    throw new Error("Only a prepared transfer can be released.");
  const effects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const line of transfer.lines) {
    const preparedPosition = inventoryTransferPreparedPosition(transfer, line);
    effects.push(
      transferEffect(
        preparedPosition,
        negateInventoryMeasurements(line.preparedMeasurements)
      )
    );
    effects.push(
      transferEffect(line.sourcePosition, line.preparedMeasurements)
    );
    provenanceTransfers.push({
      from: preparedPosition,
      to: line.sourcePosition,
    });
  }
  return transferLifecycleEvent(
    input.catalog,
    InventoryEventKind.Reclassification,
    input,
    effects,
    {
      action: InventoryTransferLifecycleAction.Release,
      transferId: transfer.transferId,
    },
    provenanceTransfers
  );
}

/** ResolvedTransferPrepareLine shape used by exact transfer-lifecycle semantics. */ interface ResolvedTransferPrepareLine {
  /** Transfer-lifecycle position value retained or supplied by this record. */ readonly position: InventoryStockPositionKey;
  /** Transfer-lifecycle amount value retained or supplied by this record. */ readonly amount: ResolvedInventoryAmount;
}
/** ResolvedTransferReceiveLine shape used by exact transfer-lifecycle semantics. */ interface ResolvedTransferReceiveLine {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle receivedMeasurements value retained or supplied by this record. */ readonly receivedMeasurements: InventoryMeasurementVector;
  /** Transfer-lifecycle resolvedAmount value retained or supplied by this record. */ readonly resolvedAmount?: ResolvedInventoryAmount;
}

/** resolveTransferPrepareLine helper for exact transfer-lifecycle semantics. */ function resolveTransferPrepareLine(
  catalog: InventoryCatalog,
  line: InventoryTransferPrepareLineInput
): ResolvedTransferPrepareLine {
  const item = transferCommandItem(
    catalog,
    line.from,
    line.amount,
    line.itemRevisionId
  );
  const amount = resolveInventoryAmount(catalog, item, line.amount);
  return {
    position: transferPositionWithPackaging(line.from, amount, item.revisionId),
    amount,
  };
}

/** fullRemainingReceiptLines helper for exact transfer-lifecycle semantics. */ function fullRemainingReceiptLines(
  transfer: InventoryTransfer
): readonly ResolvedTransferReceiveLine[] {
  const result: ResolvedTransferReceiveLine[] = [];
  for (const line of transfer.lines) {
    const remaining = inventoryTransferRemainingMeasurements(line);
    if (!inventoryMeasurementsAreZero(remaining))
      result.push({ lineId: line.lineId, receivedMeasurements: remaining });
  }
  return result;
}

/** resolveRequestedReceiptLines helper for exact transfer-lifecycle semantics. */ function resolveRequestedReceiptLines(
  catalog: InventoryCatalog,
  transfer: InventoryTransfer,
  requested: readonly InventoryTransferReceiveLineInput[]
): readonly ResolvedTransferReceiveLine[] {
  if (requested.length === 0)
    throw new Error("Transfer receive lines must be omitted instead of empty.");
  const seen = new Set<string>();
  const result: ResolvedTransferReceiveLine[] = [];
  for (const request of requested) {
    if (seen.has(request.lineId))
      throw new Error(`Duplicate transfer receive line '${request.lineId}'.`);
    seen.add(request.lineId);
    const line = requireTransferLine(transfer, request.lineId);
    const item = catalog.itemRevision(line.sourcePosition.itemRevisionId);
    const resolvedAmount = resolveInventoryAmount(
      catalog,
      item,
      request.amount
    );
    assertReceiptPackaging(line.sourcePosition, resolvedAmount);
    nonNegativeInventoryMeasurements(
      subtractInventoryMeasurements(
        inventoryTransferRemainingMeasurements(line),
        resolvedAmount.measurements
      ),
      "transfer remaining measurements"
    );
    result.push({
      lineId: request.lineId,
      receivedMeasurements: resolvedAmount.measurements,
      resolvedAmount,
    });
  }
  return result;
}

/** transferCommandItem helper for exact transfer-lifecycle semantics. */ function transferCommandItem(
  catalog: InventoryCatalog,
  position: InventoryStockPositionInput,
  amount: InventoryAmount,
  explicitRevisionId: string | undefined
): InventoryItemDefinitionRevision {
  if (amount.kind === InventoryAmountKind.Package) {
    const packaging = catalog.packagingRevision(amount.packagingRevisionId);
    if (packaging.itemId !== position.itemId)
      throw new Error("Transfer package amount belongs to a different item.");
    if (
      explicitRevisionId !== undefined &&
      explicitRevisionId !== packaging.itemRevisionId
    )
      throw new Error(
        "Transfer item revision differs from exact package revision."
      );
    return catalog.itemRevision(packaging.itemRevisionId);
  }
  const item =
    explicitRevisionId === undefined
      ? catalog.activeItem(position.itemId)
      : catalog.itemRevision(explicitRevisionId);
  if (item.itemId !== position.itemId)
    throw new Error("Transfer item revision belongs to a different item.");
  return item;
}

/** transferPositionWithPackaging helper for exact transfer-lifecycle semantics. */ function transferPositionWithPackaging(
  raw: InventoryStockPositionInput,
  amount: ResolvedInventoryAmount,
  itemRevisionId: string
): InventoryStockPositionKey {
  if (amount.packaging === undefined) {
    if (raw.packagingRevisionId !== undefined)
      throw new Error(
        "Transfer from intact packaged stock must use packageAmount with that exact revision."
      );
    return normalizeInventoryStockPositionKey({ ...raw, itemRevisionId });
  }
  if (
    raw.packagingRevisionId !== undefined &&
    raw.packagingRevisionId !== amount.packaging.revisionId
  )
    throw new Error(
      "Transfer stock package revision differs from package amount."
    );
  return normalizeInventoryStockPositionKey({
    ...raw,
    itemRevisionId,
    packagingRevisionId: amount.packaging.revisionId,
  });
}

/** assertReceiptPackaging helper for exact transfer-lifecycle semantics. */ function assertReceiptPackaging(
  position: InventoryStockPositionKey,
  amount: ResolvedInventoryAmount
): void {
  if (position.packagingRevisionId === undefined) {
    if (amount.packaging !== undefined)
      throw new Error(
        "Loose transfer stock cannot be received as intact package stock."
      );
    return;
  }
  if (amount.packaging?.revisionId !== position.packagingRevisionId)
    throw new Error(
      "Intact transfer package receipt must use its exact package revision."
    );
}

/** requireTransferLine helper for exact transfer-lifecycle semantics. */ function requireTransferLine(
  transfer: InventoryTransfer,
  lineId: string
): InventoryTransferLine {
  const line = transfer.lines.find(
    /** Process one transfer-lifecycle collection entry deterministically. */ (
      candidate
    ) => candidate.lineId === lineId
  );
  if (line === undefined) throw new Error(`Unknown transfer line '${lineId}'.`);
  return line;
}

/** transferEffect helper for exact transfer-lifecycle semantics. */ function transferEffect(
  position: InventoryStockPositionKey,
  measurementsDelta: InventoryMeasurementVector,
  amount?: ResolvedInventoryAmount
): InventoryStockEffect {
  return {
    itemRevisionId: position.itemRevisionId,
    position,
    measurementsDelta,
    ...(amount === undefined
      ? {}
      : { evidence: transferAmountEvidence(amount) }),
  };
}

/** transferAmountEvidence helper for exact transfer-lifecycle semantics. */ function transferAmountEvidence(
  amount: ResolvedInventoryAmount
): InventoryMeasurementEvidence {
  return {
    transactedMeasurements: amount.measurements,
    ...(amount.packaging === undefined
      ? {}
      : { packagingRevisionId: amount.packaging.revisionId }),
    ...(amount.packageCount === undefined
      ? {}
      : { packageCount: String(amount.packageCount) }),
  };
}

/** transferLifecycleEvent helper for exact transfer-lifecycle semantics. */ function transferLifecycleEvent(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  header: InventoryCommandHeader,
  stockEffects: readonly InventoryStockEffect[],
  transferLifecycle: InventoryTransferLifecycleChange,
  positiveLayerProvenanceTransfers: readonly InventoryPositiveLayerProvenanceTransfer[]
): InventoryEventDraft {
  return defineInventoryEvent({
    catalog,
    event: {
      eventId: inventoryEventIdForOperation(header.operationId),
      operationId: header.operationId,
      kind,
      occurredAt: header.occurredAt,
      stockEffects,
      positiveLayerProvenanceTransfers,
      traceabilityChanges: [],
      transferLifecycle,
      ...(header.actorId === undefined ? {} : { actorId: header.actorId }),
      ...(header.sourcePartyId === undefined
        ? {}
        : { sourcePartyId: header.sourcePartyId }),
      ...(header.destinationPartyId === undefined
        ? {}
        : { destinationPartyId: header.destinationPartyId }),
      ...(header.sourceReference === undefined
        ? {}
        : { sourceReference: header.sourceReference }),
      ...(header.reason === undefined ? {} : { reason: header.reason }),
      ...(header.metadata === undefined ? {} : { metadata: header.metadata }),
    },
  });
}

/** Stable caller-intent fingerprint for state-dependent dispatch planning. */
export function inventoryTransferDispatchIntentFingerprint(
  header: InventoryCommandHeader,
  transferId: string,
  carrierCustodianId?: PartyId
): string {
  return inventoryTransferActionIntentFingerprint(
    header,
    InventoryTransferLifecycleAction.Dispatch,
    transferId,
    [carrierCustodianId ?? null]
  );
}

/** Stable caller-intent fingerprint for state-dependent receive planning. */
export function inventoryTransferReceiveIntentFingerprint(
  header: InventoryCommandHeader,
  transferId: string,
  lines?: readonly InventoryTransferReceiveLineInput[]
): string {
  let encoded: InventoryIntentFingerprintValue = null;
  if (lines !== undefined) {
    const orderedLines = [...lines];
    orderedLines.sort(
      /** Keep receive intent independent of caller array order. */
      (left, right) => compareInventoryIdentityText(left.lineId, right.lineId)
    );
    encoded = orderedLines.map(
      /** Encode one receive line into collision-free fingerprint parts. */
      (line) =>
        [line.lineId, inventoryTransferAmountIntentValue(line.amount)] as const
    );
  }
  return inventoryTransferActionIntentFingerprint(
    header,
    InventoryTransferLifecycleAction.Receive,
    transferId,
    [encoded]
  );
}

/** Stable caller-intent fingerprint for release planning. */
export function inventoryTransferReleaseIntentFingerprint(
  header: InventoryCommandHeader,
  transferId: string
): string {
  return inventoryTransferActionIntentFingerprint(
    header,
    InventoryTransferLifecycleAction.Release,
    transferId,
    []
  );
}

/** inventoryTransferActionIntentFingerprint helper for exact transfer-lifecycle semantics. */ function inventoryTransferActionIntentFingerprint(
  header: InventoryCommandHeader,
  action: InventoryTransferLifecycleAction,
  transferId: string,
  extra: readonly InventoryIntentFingerprintValue[]
): string {
  return inventoryIntentFingerprint([
    header.operationId,
    action,
    transferId,
    header.occurredAt,
    header.actorId ?? null,
    header.sourcePartyId ?? null,
    header.destinationPartyId ?? null,
    header.sourceReference ?? null,
    header.reason ?? null,
    inventoryMetadataFingerprint(header.metadata),
    ...extra,
  ]);
}

/** inventoryTransferAmountIntentValue helper for exact transfer-lifecycle semantics. */ function inventoryTransferAmountIntentValue(
  amount: InventoryAmount
): InventoryIntentFingerprintValue {
  const orderedIndependent = [...amount.independent];
  orderedIndependent.sort(
    /** Keep independently measured axes in deterministic identity order. */
    (left, right) => compareInventoryIdentityText(left.axisId, right.axisId)
  );
  const independent = orderedIndependent.map(
    /** Encode one independent measured axis into stable fingerprint parts. */
    (axis) => [axis.axisId, axis.value, axis.unit] as const
  );
  return amount.kind === InventoryAmountKind.Measured
    ? [amount.kind, amount.primaryValue, amount.primaryUnit, independent]
    : [amount.kind, amount.count, amount.packagingRevisionId, independent];
}
