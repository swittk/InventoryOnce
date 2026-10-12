import { cloneInventoryRetainedData } from "./sparse-record.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
  type InventoryIntentFingerprintValue,
} from "./canonical.js";
import {
  InventoryCatalog,
  assertInventoryCatalogRetainsSnapshot,
  assertMeasurementsMatchItem,
  assertPositionMatchesItem,
  inventoryCatalogFromSnapshot,
  type InventoryCatalogSnapshot,
} from "./catalog.js";
import {
  addInventoryMeasurements,
  assertWholeMeasurementMultiple,
  inventoryMeasurementsAreZero,
  inventoryMeasurementsFingerprint,
  negateInventoryMeasurements,
  positiveInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  assertInventoryIdentity,
  InventoryTraceabilityNodeKind,
  inventoryPlacementNodeIdentity,
  inventoryLotIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryPlacementNodeDefinition,
  type InventoryLotDefinition,
  type InventoryMetadata,
  type InventoryStockPositionKey,
  type InventoryTraceabilityNodeRef,
  type ItemRevisionId,
  type PartyId,
} from "./model.js";
import {
  normalizeInventoryPlacementChange,
  type InventoryPlacementChange,
} from "./placement.js";
import { compareQuantity, zeroQuantity } from "./quantity.js";

/** Generic reason one committed inventory event changes or annotates resource truth. */
export enum InventoryEventKind {
  /** Explicit adoption/opening fact for stock that existed before InventoryOnce authority. */
  Opening = "opening",
  /** Resource entered from outside this inventory world. */
  Receipt = "receipt",
  /** Resource left this inventory world for use/dispense/consumption. */
  Issue = "issue",
  /** Same stock moved between direct placement nodes. */
  Transfer = "transfer",
  /** Same resource changed owner/custody/status/direct placement/other dimensions. */
  Reclassification = "reclassification",
  /** Loose/inner stock became one exact intact package form. */
  Pack = "pack",
  /** Intact package stock became loose/inner stock. */
  Unpack = "unpack",
  /** Inputs were consumed and outputs with explicit genealogy were produced. */
  Transformation = "transformation",
  /** Resource was explicitly destroyed/discarded/scrapped. */
  Scrap = "scrap",
  /** Physical-count reconciliation recorded an explicit discrepancy. */
  CountAdjustment = "count-adjustment",
  /** Generic placement topology changed without rewriting descendant stock. */
  Placement = "placement",
  /** Association/genealogy graph changed without changing stock quantities. */
  Traceability = "traceability",
  /** Lot/batch master metadata was asserted without changing stock quantity. */
  LotMetadata = "lot-metadata",
  /** Placement-node metadata/use-by facts were asserted without changing stock quantity. */
  PlacementNodeMetadata = "placement-node-metadata",
  /** A retained item/package catalogue revision set became durable/active. */
  CatalogPublication = "catalog-publication",
  /** Append-only correction changed current truth while retaining the original event. */
  Correction = "correction",
}

/** Reject a runtime event discriminator outside the closed durable event-kind set. */
function assertSupportedInventoryEventKind(kind: InventoryEventKind): void {
  switch (kind) {
    case InventoryEventKind.Opening:
    case InventoryEventKind.Receipt:
    case InventoryEventKind.Issue:
    case InventoryEventKind.Transfer:
    case InventoryEventKind.Reclassification:
    case InventoryEventKind.Pack:
    case InventoryEventKind.Unpack:
    case InventoryEventKind.Transformation:
    case InventoryEventKind.Scrap:
    case InventoryEventKind.CountAdjustment:
    case InventoryEventKind.Placement:
    case InventoryEventKind.Traceability:
    case InventoryEventKind.LotMetadata:
    case InventoryEventKind.PlacementNodeMetadata:
    case InventoryEventKind.CatalogPublication:
    case InventoryEventKind.Correction:
      return;
    default:
      throw new Error(`Unsupported inventory event kind '${String(kind)}'.`);
  }
}

/** Original human/package measurement retained beside exact item-axis truth. */
export interface InventoryMeasurementEvidence {
  /** Measurements exactly as the source expressed/observed them. */
  readonly transactedMeasurements: InventoryMeasurementVector;
  /** Exact package revision used to interpret a package count. */
  readonly packagingRevisionId?: string;
  /** Exact positive package count in the package unit when applicable. */
  readonly packageCount?: string;
}

/** One signed measurement-vector change to one exact stock position. */
export interface InventoryStockEffect {
  /** Frozen item-definition revision used to interpret every axis/dimension. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact position receiving this signed delta. */
  readonly position: InventoryStockPositionKey;
  /** Signed primary plus independently measured changes. */
  readonly measurementsDelta: InventoryMeasurementVector;
  /** Optional original measurement/package evidence. */
  readonly evidence?: InventoryMeasurementEvidence;
  /** Extra JSON-safe application facts about this effect. */
  readonly metadata?: InventoryMetadata;
}

/** Relationship category in the traceability graph. */
export enum InventoryTraceabilityRelationKind {
  /** Longer-lived installation/association relationship. */
  Association = "association",
  /** Irreversible transformation input-to-output genealogy. */
  Genealogy = "genealogy",
}

/** Whether one event adds or removes a traceability relationship. */
export enum InventoryTraceabilityRelationAction {
  /** Add one relationship. */
  Add = "add",
  /** Remove one reversible current relationship. */
  Remove = "remove",
  /** Mark one earlier relationship assertion erroneous while retaining its event history. */
  Invalidate = "invalidate",
}

/** Reject a runtime traceability relation discriminator outside the closed relation-kind set. */
function assertSupportedTraceabilityRelationKind(
  kind: InventoryTraceabilityRelationKind
): void {
  switch (kind) {
    case InventoryTraceabilityRelationKind.Association:
    case InventoryTraceabilityRelationKind.Genealogy:
      return;
    default:
      throw new Error(
        `Unsupported traceability relation kind '${String(kind)}'.`
      );
  }
}

/** Reject a runtime traceability action discriminator outside the closed action set. */
function assertSupportedTraceabilityRelationAction(
  action: InventoryTraceabilityRelationAction
): void {
  switch (action) {
    case InventoryTraceabilityRelationAction.Add:
    case InventoryTraceabilityRelationAction.Remove:
    case InventoryTraceabilityRelationAction.Invalidate:
      return;
    default:
      throw new Error(`Unsupported traceability action '${String(action)}'.`);
  }
}

/** One graph relationship change carried by an immutable event. */
export interface InventoryTraceabilityRelationChange {
  /** Add or remove. */
  readonly action: InventoryTraceabilityRelationAction;
  /** Association or genealogy. */
  readonly kind: InventoryTraceabilityRelationKind;
  /** Child/subject/transformation-input node. */
  readonly from: InventoryTraceabilityNodeRef;
  /** Parent/object/transformation-output node. */
  readonly to: InventoryTraceabilityNodeRef;
  /** Exact event assertion being invalidated; required only for Invalidate. */
  readonly invalidatesCreatedByEventId?: string;
}

/** Explicit pointer from a correction event to the retained event it corrects. */
export interface InventoryCorrectionReference {
  /** Earlier committed event whose current meaning is being corrected. */
  readonly correctsEventId: string;
  /** Plain reason the earlier assertion was wrong/incomplete. */
  readonly reason: string;
  /** Current correction event being superseded when this is not the first correction. */
  readonly supersedesCorrectionEventId?: string;
}

/** One correction-only replacement for the current positive-layer FIFO provenance. */
export interface InventoryPositiveLayerProvenanceOverride {
  /** Exact stock position whose current uninterrupted positive layer is corrected. */
  readonly position: InventoryStockPositionKey;
  /** Correct physical start time; omission removes provenance when the positive layer no longer exists. */
  readonly startedAtEpochMs?: number;
}

/** One conserved movement that carries FIFO layer age from an exact source to destination. */
export interface InventoryPositiveLayerProvenanceTransfer {
  /** Exact positive source position before the conserved movement. */
  readonly from: InventoryStockPositionKey;
  /** Exact destination position receiving the same measurement vector. */
  readonly to: InventoryStockPositionKey;
}

/** Physical transfer-lifecycle transition carried by an immutable inventory event. */
export enum InventoryTransferLifecycleAction {
  /** Prepare transfer-lifecycle state/action. */ Prepare = "prepare",
  /** Dispatch transfer-lifecycle state/action. */ Dispatch = "dispatch",
  /** Receive transfer-lifecycle state/action. */ Receive = "receive",
  /** Release transfer-lifecycle state/action. */ Release = "release",
}

/** Reject a runtime transfer-lifecycle discriminator outside the closed action set. */
function assertSupportedInventoryTransferLifecycleAction(
  action: InventoryTransferLifecycleAction
): void {
  switch (action) {
    case InventoryTransferLifecycleAction.Prepare:
    case InventoryTransferLifecycleAction.Dispatch:
    case InventoryTransferLifecycleAction.Receive:
    case InventoryTransferLifecycleAction.Release:
      return;
    default:
      throw new Error(
        `Unsupported transfer lifecycle action '${String(action)}'.`
      );
  }
}

/** Exact source line frozen when one transfer is prepared. */
export interface InventoryTransferPrepareLifecycleLine {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle sourcePosition value retained or supplied by this record. */ readonly sourcePosition: InventoryStockPositionKey;
  /** Transfer-lifecycle preparedMeasurements value retained or supplied by this record. */ readonly preparedMeasurements: InventoryMeasurementVector;
}

/** Exact partial/full receipt amount for one already-dispatched transfer line. */
export interface InventoryTransferReceiveLifecycleLine {
  /** Transfer-lifecycle lineId value retained or supplied by this record. */ readonly lineId: string;
  /** Transfer-lifecycle receivedMeasurements value retained or supplied by this record. */ readonly receivedMeasurements: InventoryMeasurementVector;
}

/** Structured kernel-owned lifecycle fact; application approval/workflow remains outside InventoryOnce. */
export type InventoryTransferLifecycleChange =
  | {
      /** Transfer-lifecycle action value retained or supplied by this record. */ readonly action: InventoryTransferLifecycleAction.Prepare;
      /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
      /** Transfer-lifecycle sourcePlacementNodeId value retained or supplied by this record. */ readonly sourcePlacementNodeId: string;
      /** Transfer-lifecycle transitPlacementNodeId value retained or supplied by this record. */ readonly transitPlacementNodeId: string;
      /** Transfer-lifecycle destinationPlacementNodeId value retained or supplied by this record. */ readonly destinationPlacementNodeId: string;
      /** Transfer-lifecycle destinationCustodianId value retained or supplied by this record. */ readonly destinationCustodianId?: PartyId;
      /** Transfer-lifecycle lines value retained or supplied by this record. */ readonly lines: readonly InventoryTransferPrepareLifecycleLine[];
    }
  | {
      /** Transfer-lifecycle action value retained or supplied by this record. */ readonly action: InventoryTransferLifecycleAction.Dispatch;
      /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
      /** Transfer-lifecycle carrierCustodianId value retained or supplied by this record. */ readonly carrierCustodianId?: PartyId;
    }
  | {
      /** Transfer-lifecycle action value retained or supplied by this record. */ readonly action: InventoryTransferLifecycleAction.Receive;
      /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
      /** Transfer-lifecycle lines value retained or supplied by this record. */ readonly lines: readonly InventoryTransferReceiveLifecycleLine[];
    }
  | {
      /** Transfer-lifecycle action value retained or supplied by this record. */ readonly action: InventoryTransferLifecycleAction.Release;
      /** Transfer-lifecycle transferId value retained or supplied by this record. */ readonly transferId: string;
    };

/** Caller-supplied immutable event intent before durable record time/order is assigned. */
export interface InventoryEventDraft {
  /** Stable event identity chosen by the operation. */
  readonly eventId: string;
  /** Stable retry identity; the same operation id freezes one exact event intent. */
  readonly operationId: string;
  /** Generic physical/business meaning of the event. */
  readonly kind: InventoryEventKind;
  /** Real-world event occurrence time as safe-integer epoch milliseconds. */
  readonly occurredAtEpochMs: number;
  /** Signed exact stock changes; may be empty for metadata/traceability-only events. */
  readonly stockEffects: readonly InventoryStockEffect[];
  /** Conserved source-to-destination movements that retain FIFO layer age. */
  readonly positiveLayerProvenanceTransfers?: readonly InventoryPositiveLayerProvenanceTransfer[];
  /** Correction-only FIFO provenance replacements derived from hypothetical retained-history replay. */
  readonly positiveLayerProvenanceOverrides?: readonly InventoryPositiveLayerProvenanceOverride[];
  /** Lot/batch facts asserted by this retained event, when known. */
  readonly lotDefinitions?: readonly InventoryLotDefinition[];
  /** Generic placement-node metadata/use-by facts asserted by this event, when known. */
  readonly placementNodeDefinitions?: readonly InventoryPlacementNodeDefinition[];
  /** Direct-parent topology changes belonging to the same logical event. */
  readonly placementChanges?: readonly InventoryPlacementChange[];
  /** Traceability graph changes belonging to the same logical event. */
  readonly traceabilityChanges: readonly InventoryTraceabilityRelationChange[];
  /** Optional first-class physical transfer lifecycle transition represented by this event. */
  readonly transferLifecycle?: InventoryTransferLifecycleChange;
  /** Required exact retained catalogue digest for a catalogue-publication event. */
  readonly catalogDigest?: string;
  /** Exact catalogue snapshot published by a catalogue-publication event. */
  readonly catalogSnapshot?: InventoryCatalogSnapshot;
  /** Actor who asserted/performed this event when known. */
  readonly actorId?: PartyId;
  /** Owning/possessing/business source party when meaningful. */
  readonly sourcePartyId?: PartyId;
  /** Owning/possessing/business destination party when meaningful. */
  readonly destinationPartyId?: PartyId;
  /** External application/provider document/event identity. */
  readonly sourceReference?: string;
  /** Human/operator reason when one is useful. */
  readonly reason?: string;
  /** Required correction pointer for a Correction event. */
  readonly correction?: InventoryCorrectionReference;
  /** Extra JSON-safe application facts that do not define inventory math. */
  readonly metadata?: InventoryMetadata;
}

/** Durable immutable event after storage assigns record time and total order. */
export interface InventoryCommittedEvent extends InventoryEventDraft {
  /** Time this event record became durable, distinct from physical occurrence time. */
  readonly recordedAtEpochMs: number;
  /** Monotonic durable stream position used for projections/count snapshots/corrections. */
  readonly recordSequence: number;
}

/** Inputs for validating/normalizing one event draft. */
export interface DefineInventoryEventInput {
  /** Frozen catalogue used to validate every item/package axis/dimension reference. */
  readonly catalog: InventoryCatalog;
  /** Raw event intent. */
  readonly event: InventoryEventDraft;
}

/** Validate, merge, and deterministically sort one event intent. */
export function defineInventoryEvent({
  catalog,
  event,
}: DefineInventoryEventInput): InventoryEventDraft {
  assertInventoryIdentity(event.eventId, "eventId");
  assertInventoryIdentity(event.operationId, "operationId");
  assertInventoryEpochMilliseconds(event.occurredAtEpochMs, "occurredAtEpochMs");
  assertSupportedInventoryEventKind(event.kind);
  if (event.kind === InventoryEventKind.CatalogPublication) {
    if (event.catalogSnapshot === undefined) {
      throw new Error(
        "Catalogue-publication event must retain its exact catalogue snapshot."
      );
    }
    const publishedCatalog = inventoryCatalogFromSnapshot(
      event.catalogSnapshot
    );
    if (event.catalogDigest !== publishedCatalog.digest) {
      throw new Error(
        "Catalogue-publication digest does not match its retained catalogue snapshot."
      );
    }
    assertInventoryCatalogRetainsSnapshot(catalog, event.catalogSnapshot);
  } else if (
    event.catalogDigest !== undefined ||
    event.catalogSnapshot !== undefined
  ) {
    throw new Error(
      "Only a CataloguePublication event may name catalogDigest/catalogSnapshot."
    );
  }
  if (
    event.kind === InventoryEventKind.Correction &&
    event.correction === undefined
  ) {
    throw new Error("Correction event needs correction reference.");
  }
  if (
    event.kind !== InventoryEventKind.Correction &&
    event.correction !== undefined
  ) {
    throw new Error("Only a Correction event may name correction reference.");
  }
  if (event.correction !== undefined) {
    assertInventoryIdentity(
      event.correction.correctsEventId,
      "correctsEventId"
    );
    if (event.correction.correctsEventId === event.eventId) {
      throw new Error("Inventory event cannot correct itself.");
    }
    if (event.correction.supersedesCorrectionEventId !== undefined) {
      assertInventoryIdentity(
        event.correction.supersedesCorrectionEventId,
        "supersedesCorrectionEventId"
      );
      if (event.correction.supersedesCorrectionEventId === event.eventId) {
        throw new Error("Inventory correction cannot supersede itself.");
      }
    }
    if (event.correction.reason.trim().length === 0) {
      throw new Error("Inventory correction needs a non-empty reason.");
    }
  }
  const stockEffects = normalizeStockEffects(
    catalog,
    event.stockEffects,
    event.kind
  );
  const positiveLayerProvenanceTransfers =
    normalizePositiveLayerProvenanceTransfers(
      catalog,
      event.kind,
      event.positiveLayerProvenanceTransfers ?? [],
      stockEffects
    );
  const positiveLayerProvenanceOverrides =
    normalizePositiveLayerProvenanceOverrides(
      catalog,
      event.kind,
      event.positiveLayerProvenanceOverrides ?? []
    );
  const lotDefinitions = normalizeLotDefinitions(
    catalog,
    event.lotDefinitions ?? []
  );
  const placementNodeDefinitions = normalizePlacementNodeDefinitions(
    event.placementNodeDefinitions ?? []
  );
  const placementChanges = normalizePlacementChanges(
    event.placementChanges ?? []
  );
  const traceabilityChanges = normalizeTraceabilityChanges(
    event.traceabilityChanges
  );
  const transferLifecycle = normalizeInventoryTransferLifecycleChange(
    event.kind,
    event.transferLifecycle
  );
  // Transfer-bound stock effects must name the same transferId as the lifecycle transition.
  for (const effect of stockEffects) {
    const effectTransferId = effect.position.transferId;
    if (effectTransferId === undefined) continue;
    if (transferLifecycle === undefined) {
      throw new Error(
        "Transfer-bound stock can only change through a structured transfer lifecycle event."
      );
    }
    if (effectTransferId !== transferLifecycle.transferId) {
      throw new Error(
        "Transfer-bound stock effect names a different transfer than its lifecycle change."
      );
    }
  }
  if (
    stockEffects.length === 0 &&
    lotDefinitions.length === 0 &&
    placementNodeDefinitions.length === 0 &&
    placementChanges.length === 0 &&
    traceabilityChanges.length === 0 &&
    event.kind !== InventoryEventKind.Correction &&
    event.kind !== InventoryEventKind.CatalogPublication
  ) {
    throw new Error(
      "Inventory event needs a stock, metadata, placement, or traceability change."
    );
  }
  assertEventKindShape(
    event.kind,
    stockEffects,
    lotDefinitions,
    placementNodeDefinitions,
    placementChanges,
    traceabilityChanges
  );
  assertLotDefinitionsBelongToEvent(event.kind, stockEffects, lotDefinitions);
  assertPlacementNodeDefinitionsBelongToEvent(
    event.kind,
    stockEffects,
    placementChanges,
    traceabilityChanges,
    placementNodeDefinitions
  );
  // Snapshot the complete validated intent, not a hand-maintained subset of optional fact fields.
  return cloneInventoryRetainedData({
    ...event,
    stockEffects,
    positiveLayerProvenanceTransfers,
    positiveLayerProvenanceOverrides,
    lotDefinitions,
    placementNodeDefinitions,
    placementChanges,
    traceabilityChanges,
    ...(transferLifecycle === undefined ? {} : { transferLifecycle }),
  });
}

/** Assign durable record time/order after storage has won the operation commit. */
export function commitInventoryEvent(
  event: InventoryEventDraft,
  recordedAtEpochMs: number,
  recordSequence: number
): InventoryCommittedEvent {
  assertInventoryEpochMilliseconds(recordedAtEpochMs, "recordedAtEpochMs");
  assertInventoryEpochMilliseconds(event.occurredAtEpochMs, "occurredAtEpochMs");
  // A committed physical fact cannot claim it happened after the clock that stored it.
  if (event.occurredAtEpochMs > recordedAtEpochMs) {
    throw new Error(
      "Inventory event occurredAtEpochMs cannot be after its durable recordedAtEpochMs time."
    );
  }
  for (const override of event.positiveLayerProvenanceOverrides ?? []) {
    if (override.startedAtEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(override.startedAtEpochMs, "positive-layer startedAtEpochMs");
    }
    if (override.startedAtEpochMs !== undefined && override.startedAtEpochMs > recordedAtEpochMs) {
      throw new Error(
        "Inventory positive-layer provenance cannot start after durable record time."
      );
    }
  }
  if (!Number.isSafeInteger(recordSequence) || recordSequence <= 0) {
    throw new Error("recordSequence must be a positive safe integer.");
  }
  return cloneInventoryRetainedData({ ...event, recordedAtEpochMs, recordSequence });
}

/** Stable deterministic fingerprint for exact idempotency comparison. */
export function inventoryEventIntentFingerprint(
  event: InventoryEventDraft
): string {
  return inventoryIntentFingerprint([
    event.eventId,
    event.operationId,
    event.kind,
    event.occurredAtEpochMs,
    event.actorId ?? null,
    event.sourcePartyId ?? null,
    event.destinationPartyId ?? null,
    event.sourceReference ?? null,
    event.reason ?? null,
    event.catalogDigest ?? null,
    event.catalogSnapshot?.digest ?? null,
    event.correction === undefined
      ? null
      : [
          event.correction.correctsEventId,
          event.correction.reason,
          event.correction.supersedesCorrectionEventId ?? null,
        ],
    inventoryMetadataFingerprint(event.metadata),
    inventoryTransferLifecycleFingerprint(event.transferLifecycle),
    (event.lotDefinitions ?? []).map(lotDefinitionFingerprintParts),
    (event.placementNodeDefinitions ?? []).map(placementNodeDefinitionFingerprintParts),
    (event.placementChanges ?? []).map(placementChangeFingerprintParts),
    (event.positiveLayerProvenanceTransfers ?? []).map(
      /** Turn one conserved provenance transfer into stable fingerprint parts. */
      (transfer) => [
        inventoryStockPositionIdentity(transfer.from),
        inventoryStockPositionIdentity(transfer.to),
      ]
    ),
    (event.positiveLayerProvenanceOverrides ?? []).map(
      /** Turn one correction provenance replacement into stable fingerprint parts. */
      (override) => [
        inventoryStockPositionIdentity(override.position),
        override.startedAtEpochMs ?? null,
      ]
    ),
    event.stockEffects.map(
      /** Turn one stock effect into collision-free fingerprint parts. */
      (effect) => [
        effect.itemRevisionId,
        inventoryStockPositionIdentity(effect.position),
        inventoryMeasurementsFingerprint(effect.measurementsDelta),
        effect.evidence === undefined
          ? null
          : [
              inventoryMeasurementsFingerprint(
                effect.evidence.transactedMeasurements
              ),
              effect.evidence.packagingRevisionId ?? null,
              effect.evidence.packageCount ?? null,
            ],
        inventoryMetadataFingerprint(effect.metadata),
      ]
    ),
    event.traceabilityChanges.map(traceabilityChangeIdentity),
  ]);
}

/** Validate and normalize one structured physical transfer lifecycle transition. */
function normalizeInventoryTransferLifecycleChange(
  kind: InventoryEventKind,
  change: InventoryTransferLifecycleChange | undefined
): InventoryTransferLifecycleChange | undefined {
  if (change === undefined) return undefined;
  assertInventoryIdentity(change.transferId, "transferId");
  assertSupportedInventoryTransferLifecycleAction(change.action);
  if (
    (change.action === InventoryTransferLifecycleAction.Prepare ||
      change.action === InventoryTransferLifecycleAction.Release) &&
    kind !== InventoryEventKind.Reclassification
  ) {
    throw new Error(
      "Transfer prepare/release lifecycle facts require a Reclassification event."
    );
  }
  if (
    (change.action === InventoryTransferLifecycleAction.Dispatch ||
      change.action === InventoryTransferLifecycleAction.Receive) &&
    kind !== InventoryEventKind.Transfer
  ) {
    throw new Error(
      "Transfer dispatch/receive lifecycle facts require a Transfer event."
    );
  }
  if (change.action === InventoryTransferLifecycleAction.Prepare) {
    assertInventoryIdentity(
      change.sourcePlacementNodeId,
      "transfer sourcePlacementNodeId"
    );
    assertInventoryIdentity(
      change.transitPlacementNodeId,
      "transfer transitPlacementNodeId"
    );
    assertInventoryIdentity(
      change.destinationPlacementNodeId,
      "transfer destinationPlacementNodeId"
    );
    if (change.destinationCustodianId !== undefined)
      assertInventoryIdentity(
        change.destinationCustodianId,
        "transfer destinationCustodianId"
      );
    if (
      change.sourcePlacementNodeId === change.transitPlacementNodeId ||
      change.sourcePlacementNodeId === change.destinationPlacementNodeId ||
      change.transitPlacementNodeId === change.destinationPlacementNodeId
    ) {
      throw new Error(
        "Transfer source, transit, and destination placements must be distinct."
      );
    }
    if (change.lines.length === 0)
      throw new Error("Transfer prepare lifecycle needs at least one line.");
    const seenLines = new Set<string>();
    const seenSources = new Set<string>();
    const lines: InventoryTransferPrepareLifecycleLine[] = [];
    for (const raw of change.lines) {
      assertInventoryIdentity(raw.lineId, "transfer lineId");
      if (seenLines.has(raw.lineId))
        throw new Error(`Duplicate transfer line '${raw.lineId}'.`);
      seenLines.add(raw.lineId);
      const sourcePosition = normalizeInventoryStockPositionKey(
        raw.sourcePosition
      );
      if (sourcePosition.transferId !== undefined)
        throw new Error(
          "Transfer prepare source position must not already belong to a transfer."
        );
      if (sourcePosition.placementNodeId !== change.sourcePlacementNodeId)
        throw new Error(
          "Transfer prepare line source placement differs from transfer source."
        );
      const sourceIdentity = inventoryStockPositionIdentity(sourcePosition);
      if (seenSources.has(sourceIdentity))
        throw new Error(
          "Transfer prepare lines must name distinct exact source positions."
        );
      seenSources.add(sourceIdentity);
      positiveInventoryMeasurements(
        raw.preparedMeasurements,
        "transfer preparedMeasurements"
      );
      lines.push({
        lineId: raw.lineId,
        sourcePosition,
        preparedMeasurements: raw.preparedMeasurements,
      });
    }
    lines.sort(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        left,
        right
      ) => compareInventoryIdentityText(left.lineId, right.lineId)
    );
    return { ...change, lines };
  }
  if (change.action === InventoryTransferLifecycleAction.Dispatch) {
    if (change.carrierCustodianId !== undefined)
      assertInventoryIdentity(
        change.carrierCustodianId,
        "transfer carrierCustodianId"
      );
    return change;
  }
  if (change.action === InventoryTransferLifecycleAction.Receive) {
    if (change.lines.length === 0)
      throw new Error("Transfer receive lifecycle needs at least one line.");
    const seenLines = new Set<string>();
    const lines: InventoryTransferReceiveLifecycleLine[] = [];
    for (const raw of change.lines) {
      assertInventoryIdentity(raw.lineId, "transfer receive lineId");
      if (seenLines.has(raw.lineId))
        throw new Error(`Duplicate transfer receive line '${raw.lineId}'.`);
      seenLines.add(raw.lineId);
      positiveInventoryMeasurements(
        raw.receivedMeasurements,
        "transfer receivedMeasurements"
      );
      lines.push(raw);
    }
    lines.sort(
      /** Process one transfer-lifecycle collection entry deterministically. */ (
        left,
        right
      ) => compareInventoryIdentityText(left.lineId, right.lineId)
    );
    return { ...change, lines };
  }
  return change;
}

/** Stable lifecycle fingerprint parts kept separate from application metadata. */
function inventoryTransferLifecycleFingerprint(
  change: InventoryTransferLifecycleChange | undefined
): InventoryIntentFingerprintValue {
  if (change === undefined) return null;
  if (change.action === InventoryTransferLifecycleAction.Prepare) {
    return [
      change.action,
      change.transferId,
      change.sourcePlacementNodeId,
      change.transitPlacementNodeId,
      change.destinationPlacementNodeId,
      change.destinationCustodianId ?? null,
      change.lines.map(
        /** Process one transfer-lifecycle collection entry deterministically. */ (
          line
        ) => [
          line.lineId,
          inventoryStockPositionIdentity(line.sourcePosition),
          inventoryMeasurementsFingerprint(line.preparedMeasurements),
        ]
      ),
    ];
  }
  if (change.action === InventoryTransferLifecycleAction.Dispatch)
    return [
      change.action,
      change.transferId,
      change.carrierCustodianId ?? null,
    ];
  if (change.action === InventoryTransferLifecycleAction.Receive)
    return [
      change.action,
      change.transferId,
      change.lines.map(
        /** Process one transfer-lifecycle collection entry deterministically. */ (
          line
        ) => [
          line.lineId,
          inventoryMeasurementsFingerprint(line.receivedMeasurements),
        ]
      ),
    ];
  return [change.action, change.transferId];
}

/** Validate conserved FIFO provenance transfers and return stable destination ordering. */
function normalizePositiveLayerProvenanceTransfers(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  transfers: readonly InventoryPositiveLayerProvenanceTransfer[],
  effects: readonly InventoryStockEffect[]
): readonly InventoryPositiveLayerProvenanceTransfer[] {
  if (
    transfers.length !== 0 &&
    kind !== InventoryEventKind.Transfer &&
    kind !== InventoryEventKind.Reclassification &&
    kind !== InventoryEventKind.Pack &&
    kind !== InventoryEventKind.Unpack &&
    kind !== InventoryEventKind.Placement
  ) {
    throw new Error(
      "Only conserved transfer/reclassification/pack/unpack/placement events may carry FIFO provenance."
    );
  }
  const effectByPositionId = new Map<string, InventoryStockEffect>();
  for (const effect of effects) {
    effectByPositionId.set(
      inventoryStockPositionIdentity(effect.position),
      effect
    );
  }
  const normalized: InventoryPositiveLayerProvenanceTransfer[] = [];
  const endpoints = new Set<string>();
  for (const raw of transfers) {
    const from = normalizeInventoryStockPositionKey(raw.from);
    const to = normalizeInventoryStockPositionKey(raw.to);
    const fromIdentity = inventoryStockPositionIdentity(from);
    const toIdentity = inventoryStockPositionIdentity(to);
    if (fromIdentity === toIdentity) {
      throw new Error(
        "Inventory FIFO provenance transfer needs distinct positions."
      );
    }
    if (endpoints.has(fromIdentity) || endpoints.has(toIdentity)) {
      throw new Error(
        "Inventory FIFO provenance transfer positions must form disjoint one-to-one pairs."
      );
    }
    endpoints.add(fromIdentity);
    endpoints.add(toIdentity);
    const fromItem = catalog.itemRevision(from.itemRevisionId);
    const toItem = catalog.itemRevision(to.itemRevisionId);
    if (
      from.itemId !== fromItem.itemId ||
      to.itemId !== toItem.itemId ||
      from.itemId !== to.itemId ||
      from.itemRevisionId !== to.itemRevisionId
    ) {
      throw new Error(
        "Inventory FIFO provenance transfer cannot change item identity or revision."
      );
    }
    assertPositionMatchesItem(fromItem, from);
    assertPositionMatchesItem(toItem, to);
    const fromEffect = effectByPositionId.get(fromIdentity);
    const toEffect = effectByPositionId.get(toIdentity);
    if (fromEffect === undefined || toEffect === undefined) {
      throw new Error(
        "Inventory FIFO provenance transfer must reference positions changed by the same event."
      );
    }
    if (
      compareQuantity(
        fromEffect.measurementsDelta.primary.quantity,
        zeroQuantity(fromEffect.measurementsDelta.primary.quantity.unit)
      ) >= 0 ||
      compareQuantity(
        toEffect.measurementsDelta.primary.quantity,
        zeroQuantity(toEffect.measurementsDelta.primary.quantity.unit)
      ) <= 0 ||
      !inventoryMeasurementsAreZero(
        addInventoryMeasurements(
          fromEffect.measurementsDelta,
          toEffect.measurementsDelta
        )
      )
    ) {
      throw new Error(
        "Inventory FIFO provenance transfer must pair equal negative and positive measurement vectors."
      );
    }
    normalized.push({ from, to });
  }
  normalized.sort(comparePositiveLayerProvenanceTransfer);
  return normalized;
}

/** Sort conserved FIFO provenance transfers by exact destination then source identity. */
function comparePositiveLayerProvenanceTransfer(
  left: InventoryPositiveLayerProvenanceTransfer,
  right: InventoryPositiveLayerProvenanceTransfer
): number {
  const destinationOrder = compareInventoryIdentityText(inventoryStockPositionIdentity(
    left.to
  ), inventoryStockPositionIdentity(right.to));
  return destinationOrder === 0
    ? compareInventoryIdentityText(inventoryStockPositionIdentity(left.from), inventoryStockPositionIdentity(right.from))
    : destinationOrder;
}

/** Validate correction-only FIFO provenance replacements and return stable position ordering. */
function normalizePositiveLayerProvenanceOverrides(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  overrides: readonly InventoryPositiveLayerProvenanceOverride[]
): readonly InventoryPositiveLayerProvenanceOverride[] {
  if (overrides.length !== 0 && kind !== InventoryEventKind.Correction) {
    throw new Error(
      "Only a Correction event may replace positive-layer FIFO provenance."
    );
  }
  const normalized: InventoryPositiveLayerProvenanceOverride[] = [];
  const seen = new Set<string>();
  for (const raw of overrides) {
    const position = normalizeInventoryStockPositionKey(raw.position);
    const item = catalog.itemRevision(position.itemRevisionId);
    if (position.itemId !== item.itemId) {
      throw new Error(
        "Inventory provenance override position does not match its item revision."
      );
    }
    assertPositionMatchesItem(item, position);
    if (position.packagingRevisionId !== undefined) {
      const packaging = catalog.packagingRevision(position.packagingRevisionId);
      if (
        packaging.itemId !== position.itemId ||
        packaging.itemRevisionId !== position.itemRevisionId
      ) {
        throw new Error(
          "Inventory provenance override package does not match its item revision."
        );
      }
    }
    if (raw.startedAtEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(raw.startedAtEpochMs, "positive-layer startedAtEpochMs");
    }
    const identity = inventoryStockPositionIdentity(position);
    if (seen.has(identity)) {
      throw new Error(
        `Inventory event repeats positive-layer provenance position ${identity}.`
      );
    }
    seen.add(identity);
    normalized.push({
      position,
      ...(raw.startedAtEpochMs === undefined ? {} : { startedAtEpochMs: raw.startedAtEpochMs }),
    });
  }
  normalized.sort(comparePositiveLayerProvenanceOverride);
  return normalized;
}

/** Sort correction provenance replacements by exact stock-position identity. */
function comparePositiveLayerProvenanceOverride(
  left: InventoryPositiveLayerProvenanceOverride,
  right: InventoryPositiveLayerProvenanceOverride
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Validate each effect against catalogue truth and return stable position ordering. */
function normalizeStockEffects(
  catalog: InventoryCatalog,
  effects: readonly InventoryStockEffect[],
  kind: InventoryEventKind
): readonly InventoryStockEffect[] {
  const normalized: NormalizedStockEffectEntry[] = [];
  const seenPositions = new Set<string>();
  for (const rawEffect of effects) {
    const item = catalog.itemRevision(rawEffect.itemRevisionId);
    const position = normalizeInventoryStockPositionKey(rawEffect.position);
    if (
      position.itemId !== item.itemId ||
      position.itemRevisionId !== item.revisionId
    ) {
      throw new Error(
        "Inventory effect position does not match frozen item revision."
      );
    }
    assertPositionMatchesItem(item, position);
    assertMeasurementsMatchItem(item, rawEffect.measurementsDelta, true);
    if (inventoryMeasurementsAreZero(rawEffect.measurementsDelta)) {
      throw new Error("Inventory event must not contain a zero stock effect.");
    }
    const primaryDeltaIsZero =
      compareQuantity(
        rawEffect.measurementsDelta.primary.quantity,
        zeroQuantity(
          rawEffect.measurementsDelta.primary.quantity.unit,
          rawEffect.measurementsDelta.primary.quantity.decimals
        )
      ) === 0;
    const absolute =
      primaryDeltaIsZero && kind === InventoryEventKind.CountAdjustment
        ? undefined
        : absoluteInventoryMeasurements(rawEffect.measurementsDelta);
    const positionIdentity = inventoryStockPositionIdentity(position);
    if (seenPositions.has(positionIdentity)) {
      throw new Error(
        `Inventory event repeats stock position ${positionIdentity}; combine it before calling the kernel.`
      );
    }
    seenPositions.add(positionIdentity);
    if (position.packagingRevisionId !== undefined) {
      const packaging = catalog.packagingRevision(position.packagingRevisionId);
      if (
        packaging.itemId !== position.itemId ||
        packaging.itemRevisionId !== rawEffect.itemRevisionId
      ) {
        throw new Error(
          "Packaged stock effect does not match its exact item/package revisions."
        );
      }
      assertWholeMeasurementMultiple(
        absolute ?? rawEffect.measurementsDelta,
        packaging.fixedContents
      );
    }
    if (rawEffect.evidence !== undefined) {
      assertMeasurementsMatchItem(
        item,
        rawEffect.evidence.transactedMeasurements,
        false
      );
      if (
        rawEffect.evidence.packagingRevisionId !== undefined &&
        rawEffect.evidence.packagingRevisionId !==
          position.packagingRevisionId &&
        kind !== InventoryEventKind.Pack &&
        kind !== InventoryEventKind.Unpack
      ) {
        throw new Error(
          "Measurement evidence package revision differs from stock position."
        );
      }
    }
    normalized.push({
      effect: { ...rawEffect, position },
      positionIdentity,
    });
  }
  normalized.sort(compareNormalizedStockEffect);
  return normalized.map(unwrapNormalizedStockEffect);
}

/** Validate item-scoped lot facts and return deterministic identity ordering. */
function normalizeLotDefinitions(
  catalog: InventoryCatalog,
  definitions: readonly InventoryLotDefinition[]
): readonly InventoryLotDefinition[] {
  const normalized: InventoryLotDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of definitions) {
    catalog.activeItem(raw.itemId);
    const identity = inventoryLotIdentity(raw.itemId, raw.lotId);
    if (seen.has(identity)) {
      throw new Error(`Inventory event repeats lot definition ${identity}.`);
    }
    seen.add(identity);
    if (raw.manufacturedAtEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(raw.manufacturedAtEpochMs, "lot manufacturedAtEpochMs");
    }
    if (raw.expiresAtEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(raw.expiresAtEpochMs, "lot expiresAtEpochMs");
    }
    if (
      raw.manufacturedAtEpochMs !== undefined &&
      raw.expiresAtEpochMs !== undefined &&
      raw.expiresAtEpochMs <= raw.manufacturedAtEpochMs
    ) {
      throw new Error(
        "Inventory lot expiry must be after its manufacturing time."
      );
    }
    normalized.push({
      itemId: raw.itemId,
      lotId: raw.lotId,
      ...(raw.manufacturedAtEpochMs === undefined
        ? {}
        : { manufacturedAtEpochMs: raw.manufacturedAtEpochMs }),
      ...(raw.expiresAtEpochMs === undefined ? {} : { expiresAtEpochMs: raw.expiresAtEpochMs }),
      ...(raw.metadata === undefined ? {} : { metadata: raw.metadata }),
    });
  }
  normalized.sort(compareLotDefinition);
  return normalized;
}

/** Normal stock events may only assert metadata for lots they physically touch. */
function assertLotDefinitionsBelongToEvent(
  kind: InventoryEventKind,
  effects: readonly InventoryStockEffect[],
  definitions: readonly InventoryLotDefinition[]
): void {
  if (
    kind === InventoryEventKind.Correction ||
    kind === InventoryEventKind.LotMetadata
  )
    return;
  for (const definition of definitions) {
    let found = false;
    for (const effect of effects) {
      if (
        effect.position.itemId === definition.itemId &&
        effect.position.lotId === definition.lotId
      ) {
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(
        "Inventory event lot metadata must belong to a lot touched by the same event."
      );
    }
  }
}

/** Stable collision-free lot-definition fingerprint components. */
function lotDefinitionFingerprintParts(
  definition: InventoryLotDefinition
): readonly (string | number | null)[] {
  return [
    definition.itemId,
    definition.lotId,
    definition.manufacturedAtEpochMs ?? null,
    definition.expiresAtEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ];
}

/** Sort item-scoped lot definitions by their collision-free identity. */
function compareLotDefinition(
  left: InventoryLotDefinition,
  right: InventoryLotDefinition
): number {
  return compareInventoryIdentityText(inventoryLotIdentity(left.itemId, left.lotId), inventoryLotIdentity(right.itemId, right.lotId));
}

/** Validate generic placement-node facts and return deterministic identity ordering. */
function normalizePlacementNodeDefinitions(
  definitions: readonly InventoryPlacementNodeDefinition[]
): readonly InventoryPlacementNodeDefinition[] {
  const normalized: InventoryPlacementNodeDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of definitions) {
    const identity = inventoryPlacementNodeIdentity(raw.nodeId);
    if (seen.has(identity)) {
      throw new Error(
        `Inventory event repeats placement-node definition ${identity}.`
      );
    }
    seen.add(identity);
    if (raw.category !== undefined && raw.category.trim().length === 0) {
      throw new Error("Inventory placement-node category must be omitted instead of empty.");
    }
    if (
      raw.acceptsPlacement !== undefined &&
      typeof raw.acceptsPlacement !== "boolean"
    ) {
      throw new Error("Inventory placement-node acceptsPlacement must be boolean.");
    }
    if (raw.embodiedBy !== undefined) {
      assertInventoryIdentity(
        raw.embodiedBy.itemId,
        "placement-node embodiedBy itemId"
      );
      assertInventoryIdentity(
        raw.embodiedBy.serialId,
        "placement-node embodiedBy serialId"
      );
    }
    if (raw.openedAtEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(
        raw.openedAtEpochMs,
        "placement-node openedAtEpochMs"
      );
    }
    if (raw.useByEpochMs !== undefined) {
      assertInventoryEpochMilliseconds(
        raw.useByEpochMs,
        "placement-node useByEpochMs"
      );
    }
    if (
      raw.openedAtEpochMs !== undefined &&
      raw.useByEpochMs !== undefined &&
      raw.useByEpochMs <= raw.openedAtEpochMs
    ) {
      throw new Error(
        "Inventory placement-node useByEpochMs must be after openedAtEpochMs."
      );
    }
    normalized.push({
      nodeId: raw.nodeId,
      ...(raw.category === undefined ? {} : { category: raw.category }),
      ...(raw.acceptsPlacement === undefined
        ? {}
        : { acceptsPlacement: raw.acceptsPlacement }),
      ...(raw.embodiedBy === undefined
        ? {}
        : { embodiedBy: { ...raw.embodiedBy } }),
      ...(raw.identifiers === undefined
        ? {}
        : { identifiers: normalizePlacementNodeIdentifiers(raw.identifiers) }),
      ...(raw.openedAtEpochMs === undefined
        ? {}
        : { openedAtEpochMs: raw.openedAtEpochMs }),
      ...(raw.useByEpochMs === undefined
        ? {}
        : { useByEpochMs: raw.useByEpochMs }),
      ...(raw.metadata === undefined ? {} : { metadata: raw.metadata }),
    });
  }
  normalized.sort(comparePlacementNodeDefinition);
  return normalized;
}

/** Copy external node identifiers in stable key order and reject empty keys/values. */
function normalizePlacementNodeIdentifiers(
  identifiers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const keys = Object.keys(identifiers);
  keys.sort(compareInventoryIdentityText);
  const normalized: Record<string, string> = {};
  for (const key of keys) {
    const value = identifiers[key];
    if (
      key.trim().length === 0 ||
      value === undefined ||
      value.trim().length === 0
    ) {
      throw new Error(
        "Inventory placement-node identifiers need non-empty keys and values."
      );
    }
    // Direct assignment would invoke the inherited __proto__ setter instead of preserving an own identifier.
    Object.defineProperty(normalized, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return normalized;
}

/** Normal events may assert metadata only for placement nodes they directly touch. */
function assertPlacementNodeDefinitionsBelongToEvent(
  kind: InventoryEventKind,
  effects: readonly InventoryStockEffect[],
  placementChanges: readonly InventoryPlacementChange[],
  traceabilityChanges: readonly InventoryTraceabilityRelationChange[],
  definitions: readonly InventoryPlacementNodeDefinition[]
): void {
  if (
    kind === InventoryEventKind.Correction ||
    kind === InventoryEventKind.PlacementNodeMetadata
  ) {
    return;
  }
  for (const definition of definitions) {
    let found = false;
    for (const effect of effects) {
      if (effect.position.placementNodeId === definition.nodeId) {
        found = true;
        break;
      }
    }
    if (!found && definition.embodiedBy !== undefined) {
      for (const effect of effects) {
        if (
          effect.position.itemId === definition.embodiedBy.itemId &&
          effect.position.serialId === definition.embodiedBy.serialId
        ) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      for (const change of placementChanges) {
        if (
          change.nodeId === definition.nodeId ||
          change.fromParentNodeId === definition.nodeId ||
          change.toParentNodeId === definition.nodeId
        ) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      for (const change of traceabilityChanges) {
        if (
          (change.from.kind === InventoryTraceabilityNodeKind.PlacementNode &&
            change.from.id === definition.nodeId) ||
          (change.to.kind === InventoryTraceabilityNodeKind.PlacementNode &&
            change.to.id === definition.nodeId)
        ) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      throw new Error(
        "Inventory event placement-node metadata must belong to a node touched by the same event."
      );
    }
  }
}

/** Stable collision-free placement-node definition fingerprint components. */
function placementNodeDefinitionFingerprintParts(
  definition: InventoryPlacementNodeDefinition
): readonly (string | number | boolean | null)[] {
  return [
    definition.nodeId,
    definition.category ?? null,
    definition.acceptsPlacement ?? null,
    definition.embodiedBy?.itemId ?? null,
    definition.embodiedBy?.serialId ?? null,
    inventoryMetadataFingerprint(definition.identifiers),
    definition.openedAtEpochMs ?? null,
    definition.useByEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ];
}

/** Sort exact placement-node definitions by their collision-free identity. */
function comparePlacementNodeDefinition(
  left: InventoryPlacementNodeDefinition,
  right: InventoryPlacementNodeDefinition
): number {
  return compareInventoryIdentityText(
    inventoryPlacementNodeIdentity(left.nodeId),
    inventoryPlacementNodeIdentity(right.nodeId)
  );
}

/** Normalize direct-parent changes and reject repeated nodes inside one event. */
function normalizePlacementChanges(
  changes: readonly InventoryPlacementChange[]
): readonly InventoryPlacementChange[] {
  const normalized: InventoryPlacementChange[] = [];
  const seenNodeIds = new Set<string>();
  for (const raw of changes) {
    const change = normalizeInventoryPlacementChange(raw);
    if (seenNodeIds.has(change.nodeId)) {
      throw new Error(
        `Inventory event changes placement node '${change.nodeId}' more than once.`
      );
    }
    seenNodeIds.add(change.nodeId);
    normalized.push(change);
  }
  normalized.sort(
    /** Keep multi-node topology facts deterministic by stable child identity. */
    (left, right) => compareInventoryIdentityText(left.nodeId, right.nodeId)
  );
  return normalized;
}

/** Stable collision-free placement transition fingerprint components. */
function placementChangeFingerprintParts(
  change: InventoryPlacementChange
): readonly (string | null)[] {
  return [
    change.nodeId,
    change.fromParentNodeId ?? null,
    change.toParentNodeId ?? null,
  ];
}

/** Validate graph changes, forbid genealogy deletion, and return stable ordering. */
function normalizeTraceabilityChanges(
  changes: readonly InventoryTraceabilityRelationChange[]
): readonly InventoryTraceabilityRelationChange[] {
  const normalized: InventoryTraceabilityRelationChange[] = [];
  const seen = new Set<string>();
  const seenEdges = new Set<string>();
  for (const rawChange of changes) {
    assertSupportedTraceabilityRelationAction(rawChange.action);
    assertSupportedTraceabilityRelationKind(rawChange.kind);
    const change: InventoryTraceabilityRelationChange = {
      ...rawChange,
      from: { ...rawChange.from },
      to: { ...rawChange.to },
    };
    normalized.push(change);
    if (
      inventoryTraceabilityNodeIdentity(change.from) ===
      inventoryTraceabilityNodeIdentity(change.to)
    ) {
      throw new Error(
        "Traceability relationship cannot point a node to itself."
      );
    }
    if (change.action === InventoryTraceabilityRelationAction.Invalidate) {
      if (change.invalidatesCreatedByEventId === undefined) {
        throw new Error(
          "Traceability invalidation must name the exact creating event."
        );
      }
      assertInventoryIdentity(
        change.invalidatesCreatedByEventId,
        "invalidated traceability creating event id"
      );
    } else if (change.invalidatesCreatedByEventId !== undefined) {
      throw new Error(
        "Only traceability invalidation may name invalidatesCreatedByEventId."
      );
    }
    if (
      change.kind === InventoryTraceabilityRelationKind.Genealogy &&
      change.action === InventoryTraceabilityRelationAction.Remove
    ) {
      throw new Error(
        "Transformation genealogy can only be invalidated by a correction, not removed."
      );
    }
    const identity = traceabilityChangeIdentity(change);
    if (seen.has(identity)) {
      throw new Error(
        `Inventory event repeats traceability change '${identity}'.`
      );
    }
    seen.add(identity);
    const edgeIdentity = traceabilityEdgeIdentity(change);
    if (seenEdges.has(edgeIdentity)) {
      throw new Error(
        `Inventory event asserts multiple traceability actions for one edge '${edgeIdentity}'.`
      );
    }
    seenEdges.add(edgeIdentity);
  }
  normalized.sort(compareTraceabilityChange);
  return normalized;
}

/** Enforce event-kind sign/conservation rules before the event can become durable. */
function assertEventKindShape(
  kind: InventoryEventKind,
  effects: readonly InventoryStockEffect[],
  lotDefinitions: readonly InventoryLotDefinition[],
  placementNodeDefinitions: readonly InventoryPlacementNodeDefinition[],
  placementChanges: readonly InventoryPlacementChange[],
  traceabilityChanges: readonly InventoryTraceabilityRelationChange[]
): void {
  for (const change of traceabilityChanges) {
    if (
      change.action === InventoryTraceabilityRelationAction.Invalidate &&
      kind !== InventoryEventKind.Correction
    ) {
      throw new Error(
        "Only a Correction event may invalidate an earlier relation assertion."
      );
    }
  }
  if (kind === InventoryEventKind.Correction) return;
  if (kind === InventoryEventKind.CatalogPublication) {
    if (
      effects.length !== 0 ||
      lotDefinitions.length !== 0 ||
      placementNodeDefinitions.length !== 0 ||
      placementChanges.length !== 0 ||
      traceabilityChanges.length !== 0
    ) {
      throw new Error(
        "Catalogue-publication event must contain no stock/metadata/placement/traceability changes."
      );
    }
    return;
  }
  if (kind === InventoryEventKind.LotMetadata) {
    if (
      effects.length !== 0 ||
      placementNodeDefinitions.length !== 0 ||
      placementChanges.length !== 0 ||
      traceabilityChanges.length !== 0 ||
      lotDefinitions.length === 0
    ) {
      throw new Error(
        "Lot-metadata event must contain lot facts and no stock/placement/traceability changes."
      );
    }
    return;
  }
  if (kind === InventoryEventKind.PlacementNodeMetadata) {
    if (
      effects.length !== 0 ||
      lotDefinitions.length !== 0 ||
      placementChanges.length !== 0 ||
      traceabilityChanges.length !== 0 ||
      placementNodeDefinitions.length === 0
    ) {
      throw new Error(
        "Placement-node-metadata event must contain node facts and no stock/lot/topology/traceability changes."
      );
    }
    return;
  }
  if (kind === InventoryEventKind.Placement) {
    if (
      lotDefinitions.length !== 0 ||
      traceabilityChanges.length !== 0 ||
      (effects.length === 0 && placementChanges.length === 0)
    ) {
      throw new Error(
        "Placement event needs stock and/or topology changes and cannot contain lot/traceability changes."
      );
    }
    if (effects.length !== 0) {
      if (effects.length < 2) {
        throw new Error("Placement stock movement needs at least two effects.");
      }
      assertInternalEventConservesEachItem(effects, kind);
    }
    return;
  }
  if (kind === InventoryEventKind.Traceability) {
    if (
      effects.length !== 0 ||
      lotDefinitions.length !== 0 ||
      placementNodeDefinitions.length !== 0 ||
      placementChanges.length !== 0 ||
      traceabilityChanges.length === 0
    ) {
      throw new Error(
        "Traceability event must contain association/genealogy relations and no stock/metadata/placement changes."
      );
    }
    return;
  }
  if (placementChanges.length !== 0) {
    throw new Error(
      `Inventory event '${kind}' cannot hide a placement-topology change.`
    );
  }
  if (effects.length === 0) {
    throw new Error(`Inventory event '${kind}' needs stock effects.`);
  }
  if (
    kind === InventoryEventKind.Opening ||
    kind === InventoryEventKind.Receipt
  ) {
    assertEveryPrimarySign(effects, 1, kind);
    return;
  }
  if (kind === InventoryEventKind.Issue || kind === InventoryEventKind.Scrap) {
    assertEveryPrimarySign(effects, -1, kind);
    return;
  }
  if (
    kind === InventoryEventKind.Transfer ||
    kind === InventoryEventKind.Reclassification ||
    kind === InventoryEventKind.Pack ||
    kind === InventoryEventKind.Unpack
  ) {
    if (effects.length < 2)
      throw new Error(`${kind} event needs at least two stock effects.`);
    assertInternalEventConservesEachItem(effects, kind);
    if (kind === InventoryEventKind.Reclassification) {
      assertReclassificationPreservesPackagingBuckets(effects);
    }
    return;
  }
  if (kind === InventoryEventKind.Transformation) {
    let hasInput = false;
    let hasOutput = false;
    for (const effect of effects) {
      const sign = primarySign(effect.measurementsDelta);
      hasInput = hasInput || sign < 0;
      hasOutput = hasOutput || sign > 0;
    }
    if (!hasInput || !hasOutput) {
      throw new Error(
        "Transformation event needs both consumed and produced stock."
      );
    }
  }
}

/** Require every effect primary axis to have one requested sign. */
function assertEveryPrimarySign(
  effects: readonly InventoryStockEffect[],
  expectedSign: -1 | 1,
  kind: InventoryEventKind
): void {
  for (const effect of effects) {
    if (primarySign(effect.measurementsDelta) !== expectedSign) {
      throw new Error(
        `Inventory event '${kind}' contains an effect with the wrong sign.`
      );
    }
    positiveInventoryMeasurements(
      expectedSign === 1
        ? effect.measurementsDelta
        : negateInventoryMeasurements(effect.measurementsDelta),
      `${kind} effect`
    );
  }
}

/** Require internal verbs to conserve every measurement axis inside each frozen item revision. */
function assertInternalEventConservesEachItem(
  effects: readonly InventoryStockEffect[],
  kind: InventoryEventKind
): void {
  const totalByItemRevision = new Map<string, InventoryMeasurementVector>();
  for (const effect of effects) {
    const earlier = totalByItemRevision.get(effect.itemRevisionId);
    totalByItemRevision.set(
      effect.itemRevisionId,
      earlier === undefined
        ? effect.measurementsDelta
        : addInventoryMeasurements(earlier, effect.measurementsDelta)
    );
  }
  for (const [itemRevisionId, total] of totalByItemRevision) {
    if (!inventoryMeasurementsAreZero(total)) {
      throw new Error(
        `Inventory event '${kind}' does not conserve item revision '${itemRevisionId}'.`
      );
    }
  }
}

/** Prevent generic reclassification from silently acting like pack/unpack. */
function assertReclassificationPreservesPackagingBuckets(
  effects: readonly InventoryStockEffect[]
): void {
  const totalByPackageBucket = new Map<string, InventoryMeasurementVector>();
  for (const effect of effects) {
    const bucket = inventoryIntentFingerprint([
      effect.itemRevisionId,
      effect.position.packagingRevisionId ?? null,
    ]);
    const earlier = totalByPackageBucket.get(bucket);
    totalByPackageBucket.set(
      bucket,
      earlier === undefined
        ? effect.measurementsDelta
        : addInventoryMeasurements(earlier, effect.measurementsDelta)
    );
  }
  for (const [bucket, total] of totalByPackageBucket) {
    if (!inventoryMeasurementsAreZero(total)) {
      throw new Error(
        `Inventory reclassification changes packaging bucket ${bucket}; use pack/unpack instead.`
      );
    }
  }
}

/** Return -1 or +1 from a non-zero primary measurement. */
function primarySign(value: InventoryMeasurementVector): -1 | 1 {
  const comparison = compareQuantity(
    value.primary.quantity,
    zeroQuantity(value.primary.quantity.unit, value.primary.quantity.decimals)
  );
  if (comparison === 0) {
    throw new Error("Inventory effect primary measurement must not be zero.");
  }
  return comparison < 0 ? -1 : 1;
}

/** Return a positive vector and reject axes whose signs contradict the primary axis. */
function absoluteInventoryMeasurements(
  value: InventoryMeasurementVector
): InventoryMeasurementVector {
  const absolute =
    primarySign(value) < 0 ? negateInventoryMeasurements(value) : value;
  return positiveInventoryMeasurements(absolute, "Inventory effect");
}

/** Stable action-independent identity for one relation edge inside an event. */
function traceabilityEdgeIdentity(
  change: InventoryTraceabilityRelationChange
): string {
  return inventoryIntentFingerprint([
    change.kind,
    inventoryTraceabilityNodeIdentity(change.from),
    inventoryTraceabilityNodeIdentity(change.to),
  ]);
}

/** Stable identity for one relation action/kind/edge. */
function traceabilityChangeIdentity(
  change: InventoryTraceabilityRelationChange
): string {
  return inventoryIntentFingerprint([
    change.action,
    change.kind,
    inventoryTraceabilityNodeIdentity(change.from),
    inventoryTraceabilityNodeIdentity(change.to),
    change.invalidatesCreatedByEventId ?? null,
  ]);
}

/** One normalized stock effect paired with its precomputed exact position identity. */
interface NormalizedStockEffectEntry {
  /** Normalized public event effect returned after deterministic ordering. */
  readonly effect: InventoryStockEffect;
  /** Canonical position identity cached before sort to avoid comparator recomputation. */
  readonly positionIdentity: string;
}

/** Sort normalized effects by cached position identity then frozen item revision. */
function compareNormalizedStockEffect(
  left: NormalizedStockEffectEntry,
  right: NormalizedStockEffectEntry
): number {
  const positionOrder = compareInventoryIdentityText(
    left.positionIdentity,
    right.positionIdentity
  );
  return positionOrder === 0
    ? compareInventoryIdentityText(
        left.effect.itemRevisionId,
        right.effect.itemRevisionId
      )
    : positionOrder;
}

/** Remove the private cached identity decoration after deterministic ordering. */
function unwrapNormalizedStockEffect(
  entry: NormalizedStockEffectEntry
): InventoryStockEffect {
  return entry.effect;
}

/** Sort traceability changes by stable relation identity. */
function compareTraceabilityChange(
  left: InventoryTraceabilityRelationChange,
  right: InventoryTraceabilityRelationChange
): number {
  return compareInventoryIdentityText(traceabilityChangeIdentity(left), traceabilityChangeIdentity(right));
}

/** Require an exact numeric instant; epoch zero and dates before 1970 are valid. */
export function assertInventoryEpochMilliseconds(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be safe-integer epoch milliseconds.`);
  }
}
