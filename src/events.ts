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
  assertInventoryMeasurementsFollowPrimarySign,
  subtractInventoryMeasurements,
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
import {
  compareQuantity,
  integerAtDecimals,
  negateQuantity,
  positiveQuantity,
  quantityEq,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import { convertInventoryRevisionQuantity } from "./revision-transition-math.js";

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
  /** One accounted resource moved between immutable item-definition revisions with explicit unit equivalence. */
  RevisionTransition = "revision-transition",
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
  /** Late-discovered historical assertions changed current truth after deterministic replay. */
  HistoricalRepair = "historical-repair",
}

/** Reject a runtime event discriminator outside the closed durable event-kind set. */
function assertSupportedInventoryEventKind(kind: InventoryEventKind): void {
  switch (kind) {
    case InventoryEventKind.Opening:
    case InventoryEventKind.Receipt:
    case InventoryEventKind.Issue:
    case InventoryEventKind.Transfer:
    case InventoryEventKind.Reclassification:
    case InventoryEventKind.RevisionTransition:
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
    case InventoryEventKind.HistoricalRepair:
      return;
    default:
      throw new Error(`Unsupported inventory event kind '${String(kind)}'.`);
  }
}

/** Frozen meaning of one prospective redefinition of physically unchanged stock. */
export interface InventoryRevisionTransitionEvidence {
  /** Stable inventory item across both revisions; no physical substitution is implied. */
  readonly itemId: string;
  /** Retained item revision whose quantities are being reinterpreted from this point onward. */
  readonly fromRevisionId: string;
  /** Already published destination item revision. */
  readonly toRevisionId: string;
  /** Exact old-unit amount declared equivalent to targetUnit. */
  readonly sourceUnit: Quantity;
  /** Exact new-unit amount declared equivalent to sourceUnit. */
  readonly targetUnit: Quantity;
  /** World revision whose precise live positions and dependencies were reviewed. */
  readonly expectedWorldRevision: number;
  /** Canonical selector identity, keeping exact retry intent distinct even if positions match. */
  readonly selectorIdentity: string;
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

/** One interval where corrected/repaired history records more outflow than accounted inflow. */
export interface InventoryHistoricalDeficitInterval {
  /** Frozen item revision governing the exact signed resource. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact signed stock bucket that became negative during historical replay. */
  readonly position: InventoryStockPositionKey;
  /** Largest shortage per measured axis; different axes may peak at different times. */
  readonly maximumDeficit: InventoryMeasurementVector;
  /** Effective assertion that first made this bucket negative. */
  readonly startedByEventId: string;
  /** Physical occurrence time of the deficit start. */
  readonly startedAtEpochMs: number;
  /** Effective assertion that returned this bucket to non-negative truth, when resolved. */
  readonly endedByEventId?: string;
  /** Physical occurrence time of the resolving assertion, when resolved. */
  readonly endedAtEpochMs?: number;
}

/** Auditable consequences derived while replaying corrected or late historical truth. */
export interface InventoryHistoricalImpact {
  /** Effective retained/asserted events whose meaning participated in this replay. */
  readonly affectedEventIds: readonly string[];
  /** Whereabouts cohorts whose retained lifecycle evidence changed. */
  readonly whereaboutsIds: readonly string[];
  /** Newly exposed signed-deficit intervals, including intervals already resolved later. */
  readonly deficits: readonly InventoryHistoricalDeficitInterval[];
}

/** One embedded ordinary event assertion discovered after its physical occurrence. */
export interface InventoryHistoricalAssertion {
  /** Stable identity inside all historical-repair envelopes. */
  readonly assertionId: string;
  /** Optional retained/effective event after which this assertion must be replayed. */
  readonly afterEventId?: string;
  /** Ordinary validated physical assertion; never another correction/repair/catalogue event. */
  readonly event: InventoryEventDraft;
}

/** Append-only historical-repair evidence retained by one derived current-state delta. */
export interface InventoryHistoricalRepairEvidence {
  /** New late-discovered assertions introduced by this repair. */
  readonly assertions: readonly InventoryHistoricalAssertion[];
  /** Earlier embedded assertion identities removed from latest effective history. */
  readonly omittedAssertionIds: readonly string[];
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

/** Exact portion of a physical report whose original lot, serial and source age were unwitnessed. */
export interface InventoryUnwitnessedStockMovement {
  /** Signed source posting, without a lot or serial assignment. */
  readonly from: InventoryStockPositionKey;
  /** Unlabelled arrival for a transfer, or omission for destruction. */
  readonly to?: InventoryStockPositionKey;
  /** Positive exact quantity vector belonging to these postings. */
  readonly measurements: InventoryMeasurementVector;
}

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
  /** Unwitnessed portions of an ordinary physical transfer or scrap, when recorded. */
  readonly unwitnessedStockMovements?: readonly InventoryUnwitnessedStockMovement[];
  /** Conserved witnessed movements that retain source FIFO layer age. */
  readonly positiveLayerProvenanceTransfers?: readonly InventoryPositiveLayerProvenanceTransfer[];
  /** Required exact unit/revision evidence for a revision-transition event. */
  readonly revisionTransition?: InventoryRevisionTransitionEvidence;
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
  /** Full replacement assertion retained for future corrected-history replay; null means omit. */
  readonly correctionReplacement?: InventoryEventDraft | null;
  /** Required embedded evidence for a HistoricalRepair event. */
  readonly historicalRepair?: InventoryHistoricalRepairEvidence;
  /** Optional typed replay consequences on a Correction/HistoricalRepair event. */
  readonly historicalImpact?: InventoryHistoricalImpact;
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

/** Normalize one append-only historical-repair envelope and its ordinary assertions. */
function normalizeInventoryHistoricalRepairEvidence(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  repairOccurredAtEpochMs: number,
  evidence: InventoryHistoricalRepairEvidence | undefined
): InventoryHistoricalRepairEvidence | undefined {
  if (evidence === undefined) return undefined;
  if (kind !== InventoryEventKind.HistoricalRepair) {
    throw new Error("Historical repair evidence belongs only to HistoricalRepair events.");
  }
  if (
    evidence.assertions.length === 0 &&
    evidence.omittedAssertionIds.length === 0
  ) {
    throw new Error(
      "Historical repair must add or omit at least one historical assertion."
    );
  }
  const assertionIds = new Set<string>();
  const eventIds = new Set<string>();
  const operationIds = new Set<string>();
  const assertions: InventoryHistoricalAssertion[] = [];
  for (const raw of evidence.assertions) {
    assertInventoryIdentity(raw.assertionId, "historical assertionId");
    if (assertionIds.has(raw.assertionId)) {
      throw new Error(
        `Historical repair repeats assertionId '${raw.assertionId}'.`
      );
    }
    assertionIds.add(raw.assertionId);
    if (raw.afterEventId !== undefined) {
      assertInventoryIdentity(raw.afterEventId, "historical assertion afterEventId");
    }
    if (
      raw.event.kind === InventoryEventKind.Correction ||
      raw.event.kind === InventoryEventKind.HistoricalRepair ||
      raw.event.kind === InventoryEventKind.CatalogPublication ||
      raw.event.correction !== undefined ||
      raw.event.historicalRepair !== undefined ||
      raw.event.historicalImpact !== undefined ||
      raw.event.transferLifecycle !== undefined
    ) {
      throw new Error(
        "Historical assertions must be ordinary non-correction, non-repair physical/metadata/graph events."
      );
    }
    if (raw.event.occurredAtEpochMs > repairOccurredAtEpochMs) {
      throw new Error(
        "Historical assertion cannot occur after its repair operation."
      );
    }
    const event = defineInventoryEvent({ catalog, event: raw.event });
    if (eventIds.has(event.eventId) || operationIds.has(event.operationId)) {
      throw new Error(
        "Historical repair assertion event/operation identities must be unique."
      );
    }
    eventIds.add(event.eventId);
    operationIds.add(event.operationId);
    assertions.push({
      assertionId: raw.assertionId,
      ...(raw.afterEventId === undefined
        ? {}
        : { afterEventId: raw.afterEventId }),
      event,
    });
  }
  const omitted = new Set<string>();
  for (const assertionId of evidence.omittedAssertionIds) {
    assertInventoryIdentity(assertionId, "omitted historical assertionId");
    if (assertionIds.has(assertionId)) {
      throw new Error(
        `Historical repair cannot add and omit assertion '${assertionId}' together.`
      );
    }
    if (omitted.has(assertionId)) {
      throw new Error(
        `Historical repair repeats omitted assertionId '${assertionId}'.`
      );
    }
    omitted.add(assertionId);
  }
  const omittedAssertionIds = [...omitted];
  omittedAssertionIds.sort(compareInventoryIdentityText);
  return cloneInventoryRetainedData({ assertions, omittedAssertionIds });
}

/** Normalize typed replay consequences retained on correction/repair events. */
function normalizeInventoryHistoricalImpact(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  impact: InventoryHistoricalImpact | undefined
): InventoryHistoricalImpact | undefined {
  if (impact === undefined) return undefined;
  if (
    kind !== InventoryEventKind.Correction &&
    kind !== InventoryEventKind.HistoricalRepair
  ) {
    throw new Error(
      "Historical impact belongs only to Correction/HistoricalRepair events."
    );
  }
  const affected = new Set<string>();
  for (const eventId of impact.affectedEventIds) {
    assertInventoryIdentity(eventId, "historical impact affected eventId");
    affected.add(eventId);
  }
  const affectedEventIds = [...affected];
  affectedEventIds.sort(compareInventoryIdentityText);
  const whereaboutsIds = new Set<string>();
  for (const whereaboutsId of impact.whereaboutsIds) {
    assertInventoryIdentity(whereaboutsId, "historical impact whereaboutsId");
    whereaboutsIds.add(whereaboutsId);
  }
  const orderedWhereaboutsIds = [...whereaboutsIds];
  orderedWhereaboutsIds.sort(compareInventoryIdentityText);
  const deficits: InventoryHistoricalDeficitInterval[] = [];
  for (const raw of impact.deficits) {
    assertInventoryIdentity(raw.startedByEventId, "historical deficit start eventId");
    assertInventoryEpochMilliseconds(
      raw.startedAtEpochMs,
      "historical deficit startedAtEpochMs"
    );
    if (
      (raw.endedByEventId === undefined) !==
      (raw.endedAtEpochMs === undefined)
    ) {
      throw new Error(
        "Historical deficit end event/time must either both be present or both be omitted."
      );
    }
    if (raw.endedByEventId !== undefined) {
      assertInventoryIdentity(raw.endedByEventId, "historical deficit end eventId");
      assertInventoryEpochMilliseconds(
        raw.endedAtEpochMs!,
        "historical deficit endedAtEpochMs"
      );
      if (raw.endedAtEpochMs! < raw.startedAtEpochMs) {
        throw new Error("Historical deficit cannot end before it starts.");
      }
    }
    const position = normalizeInventoryStockPositionKey(raw.position);
    const item = catalog.itemRevision(raw.itemRevisionId);
    if (position.itemId !== item.itemId) {
      throw new Error(
        "Historical deficit position does not match its item revision."
      );
    }
    assertPositionMatchesItem(item, position);
    assertMeasurementsMatchItem(item, raw.maximumDeficit, true);
    positiveInventoryMeasurements(
      raw.maximumDeficit,
      "Historical maximum deficit"
    );
    deficits.push({
      itemRevisionId: raw.itemRevisionId,
      position,
      maximumDeficit: raw.maximumDeficit,
      startedByEventId: raw.startedByEventId,
      startedAtEpochMs: raw.startedAtEpochMs,
      ...(raw.endedByEventId === undefined
        ? {}
        : {
            endedByEventId: raw.endedByEventId,
            endedAtEpochMs: raw.endedAtEpochMs!,
          }),
    });
  }
  deficits.sort(
    /** Order deficit intervals by physical start, event, then position. */
    (left, right) => {
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
  );
  return cloneInventoryRetainedData({
    affectedEventIds,
    whereaboutsIds: orderedWhereaboutsIds,
    deficits,
  });
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
  if (
    event.kind === InventoryEventKind.Correction &&
    event.correctionReplacement === undefined
  ) {
    throw new Error(
      "Correction event requires an explicit replacement assertion or null omission."
    );
  }
  if (
    event.kind !== InventoryEventKind.Correction &&
    event.correctionReplacement !== undefined
  ) {
    throw new Error(
      "Only a Correction event may retain a correction replacement assertion."
    );
  }
  let correctionReplacement: InventoryEventDraft | null | undefined;
  if (event.correctionReplacement === null) {
    correctionReplacement = null;
  } else if (event.correctionReplacement !== undefined) {
    const replacement = event.correctionReplacement;
    if (
      replacement.kind === InventoryEventKind.Correction ||
      replacement.kind === InventoryEventKind.HistoricalRepair ||
      replacement.kind === InventoryEventKind.CatalogPublication ||
      replacement.correction !== undefined ||
      replacement.correctionReplacement !== undefined ||
      replacement.historicalRepair !== undefined ||
      replacement.historicalImpact !== undefined ||
      replacement.transferLifecycle !== undefined
    ) {
      throw new Error(
        "Correction replacement evidence must be one ordinary non-correction assertion."
      );
    }
    correctionReplacement = defineInventoryEvent({
      catalog,
      event: replacement,
    });
  }
  if (
    event.kind === InventoryEventKind.HistoricalRepair &&
    event.historicalRepair === undefined
  ) {
    throw new Error("HistoricalRepair event needs historicalRepair evidence.");
  }
  if (
    event.kind !== InventoryEventKind.HistoricalRepair &&
    event.historicalRepair !== undefined
  ) {
    throw new Error(
      "Only a HistoricalRepair event may retain historicalRepair evidence."
    );
  }
  if (
    event.historicalImpact !== undefined &&
    event.kind !== InventoryEventKind.Correction &&
    event.kind !== InventoryEventKind.HistoricalRepair
  ) {
    throw new Error(
      "Only Correction/HistoricalRepair events may retain historical impact."
    );
  }
  const historicalRepair = normalizeInventoryHistoricalRepairEvidence(
    catalog,
    event.kind,
    event.occurredAtEpochMs,
    event.historicalRepair
  );
  const historicalImpact = normalizeInventoryHistoricalImpact(
    catalog,
    event.kind,
    event.historicalImpact
  );
  const stockEffects = normalizeStockEffects(
    catalog,
    event.stockEffects,
    event.kind
  );
  const unwitnessed = normalizeUnwitnessedStockMovements({
    catalog, kind: event.kind, rawMovements: event.unwitnessedStockMovements, normalizedStockEffects: stockEffects,
  });
  const positiveLayerProvenanceTransfers =
    normalizePositiveLayerProvenanceTransfers(
      catalog,
      event.kind,
      event.positiveLayerProvenanceTransfers ?? [],
      stockEffects,
      unwitnessed?.witnessedEffects
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
    event.kind !== InventoryEventKind.HistoricalRepair &&
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
  assertInventoryRevisionTransitionEvidence(
    catalog,
    event.kind,
    event.revisionTransition,
    stockEffects,
    positiveLayerProvenanceTransfers
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
    ...(unwitnessed === undefined ? {} : { unwitnessedStockMovements: unwitnessed.movements }),
    positiveLayerProvenanceTransfers,
    positiveLayerProvenanceOverrides,
    lotDefinitions,
    placementNodeDefinitions,
    placementChanges,
    traceabilityChanges,
    ...(transferLifecycle === undefined ? {} : { transferLifecycle }),
    ...(correctionReplacement === undefined
      ? {}
      : { correctionReplacement }),
    ...(historicalRepair === undefined ? {} : { historicalRepair }),
    ...(historicalImpact === undefined ? {} : { historicalImpact }),
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
  if (
    event.correctionReplacement !== undefined &&
    event.correctionReplacement !== null &&
    event.correctionReplacement.occurredAtEpochMs > recordedAtEpochMs
  ) {
    throw new Error(
      "Correction replacement occurredAtEpochMs cannot be after durable correction record time."
    );
  }
  for (const assertion of event.historicalRepair?.assertions ?? []) {
    if (assertion.event.occurredAtEpochMs > recordedAtEpochMs) {
      throw new Error(
        "Historical assertion occurredAtEpochMs cannot be after durable repair record time."
      );
    }
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
    event.correctionReplacement === undefined ||
    event.correctionReplacement === null
      ? null
      : inventoryEventIntentFingerprint(event.correctionReplacement),
    event.historicalRepair === undefined
      ? null
      : [
          event.historicalRepair.assertions.map(
            /** Freeze one embedded assertion identity and exact event intent. */
            (assertion) => [
            assertion.assertionId,
            assertion.afterEventId ?? null,
              inventoryEventIntentFingerprint(assertion.event),
            ]
          ),
          event.historicalRepair.omittedAssertionIds,
        ],
    event.historicalImpact === undefined
      ? null
      : [
          event.historicalImpact.affectedEventIds,
          event.historicalImpact.whereaboutsIds,
          event.historicalImpact.deficits.map(
            /** Freeze one typed historical-deficit interval. */
            (deficit) => [
            deficit.itemRevisionId,
            inventoryStockPositionIdentity(deficit.position),
            inventoryMeasurementsFingerprint(deficit.maximumDeficit),
            deficit.startedByEventId,
            deficit.startedAtEpochMs,
            deficit.endedByEventId ?? null,
              deficit.endedAtEpochMs ?? null,
            ]
          ),
        ],
    inventoryMetadataFingerprint(event.metadata),
    event.revisionTransition === undefined
      ? null
      : [
          event.revisionTransition.itemId,
          event.revisionTransition.fromRevisionId,
          event.revisionTransition.toRevisionId,
          event.revisionTransition.expectedWorldRevision,
          event.revisionTransition.selectorIdentity,
          [
            event.revisionTransition.sourceUnit.amountMinor,
            event.revisionTransition.sourceUnit.decimals,
            event.revisionTransition.sourceUnit.unit,
          ],
          [
            event.revisionTransition.targetUnit.amountMinor,
            event.revisionTransition.targetUnit.decimals,
            event.revisionTransition.targetUnit.unit,
          ],
        ],
    inventoryTransferLifecycleFingerprint(event.transferLifecycle),
    (event.lotDefinitions ?? []).map(lotDefinitionFingerprintParts),
    (event.placementNodeDefinitions ?? []).map(placementNodeDefinitionFingerprintParts),
    (event.placementChanges ?? []).map(placementChangeFingerprintParts),
    (event.unwitnessedStockMovements ?? []).map(
      /** Bind one unlabelled route and its exact reported vector into the physical assertion identity. */
      (movement) => [
        inventoryStockPositionIdentity(movement.from),
        movement.to === undefined ? null : inventoryStockPositionIdentity(movement.to),
        inventoryMeasurementsFingerprint(movement.measurements),
      ]
    ),
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

/** Normalized unwitnessed routes and the witnessed remainder of each affected posting. */
interface NormalizedUnwitnessedStockMovements {
  /** Individual reports retained for exact audit and costing. */
  readonly movements: readonly InventoryUnwitnessedStockMovement[];
  /** Validated signed witness per affected position, used to verify FIFO provenance. */
  readonly witnessedEffects: ReadonlyMap<string, InventoryMeasurementVector>;
}

/** Reported portions and the normalized postings that bound them. */
interface NormalizeUnwitnessedStockMovementsInput {
  /** Exact catalogue used by the event. */
  readonly catalog: InventoryCatalog;
  /** Event kind determining whether each portion must have a destination. */
  readonly kind: InventoryEventKind;
  /** Reported portions before validation and normalization. */
  readonly rawMovements: readonly InventoryUnwitnessedStockMovement[] | undefined;
  /** Signed normalized postings that already include the reported portions. */
  readonly normalizedStockEffects: readonly InventoryStockEffect[];
}

/** Validate typed unwitnessed routes and their partition of the event's concrete postings. */
function normalizeUnwitnessedStockMovements({
  catalog, kind, rawMovements, normalizedStockEffects,
}: NormalizeUnwitnessedStockMovementsInput): NormalizedUnwitnessedStockMovements | undefined {
  if (rawMovements === undefined) return undefined;
  if (rawMovements.length === 0 || (kind !== InventoryEventKind.Transfer && kind !== InventoryEventKind.Scrap)) {
    throw new Error("Unwitnessed movement requires a transfer or scrap with a reported quantity.");
  }
  const movements: InventoryUnwitnessedStockMovement[] = [];
  const effects = new Map<string, InventoryMeasurementVector>();
  for (const portion of rawMovements) {
    const from = normalizeInventoryStockPositionKey(portion.from);
    if (from.lotId !== undefined || from.serialId !== undefined || from.placementNodeId === undefined) {
      throw new Error("Unwitnessed stock needs a direct source placement without a lot or serial.");
    }
    const item = catalog.itemRevision(from.itemRevisionId);
    assertPositionMatchesItem(item, from);
    assertMeasurementsMatchItem(item, portion.measurements, true);
    const measurements = positiveInventoryMeasurements(portion.measurements, "Unwitnessed stock");
    if (from.packagingRevisionId !== undefined) {
      assertWholeMeasurementMultiple(measurements, catalog.packagingRevision(from.packagingRevisionId).fixedContents);
    }
    const to = portion.to === undefined ? undefined : normalizeInventoryStockPositionKey(portion.to);
    if (kind === InventoryEventKind.Transfer) {
      if (to === undefined || to.placementNodeId === undefined || to.placementNodeId === from.placementNodeId ||
          inventoryStockPositionIdentity(to) !== inventoryStockPositionIdentity({ ...from, placementNodeId: to.placementNodeId })) {
        throw new Error("Unwitnessed transfer must preserve every dimension except direct placement.");
      }
      addUnwitnessedEffect(effects, to, measurements);
    } else if (to !== undefined) {
      throw new Error("Unwitnessed scrap cannot have a destination.");
    }
    addUnwitnessedEffect(effects, from, negateInventoryMeasurements(measurements));
    movements.push({ from, measurements, ...(to === undefined ? {} : { to }) });
  }

  // A portion must be represented in the existing effect, with any remainder still a coherent witness.
  const stockById = new Map<string, InventoryMeasurementVector>();
  for (const effect of normalizedStockEffects) {
    stockById.set(inventoryStockPositionIdentity(effect.position), effect.measurementsDelta);
  }
  /** Keep the exact partition so FIFO checks use the same validated digits. */
  const witnessedEffects = new Map<string, InventoryMeasurementVector>();
  for (const [id, portion] of effects) {
    const total = stockById.get(id);
    if (total === undefined || primarySign(total) !== primarySign(portion)) {
      throw new Error("Unwitnessed movement is missing its signed stock effect.");
    }
    const witnessed = subtractInventoryMeasurements(total, portion);
    assertInventoryMeasurementsFollowPrimarySign(witnessed, "Witnessed movement");
    if (!inventoryMeasurementsAreZero(witnessed) && primarySign(witnessed) !== primarySign(total)) {
      throw new Error("Unwitnessed movement exceeds its signed stock effect.");
    }
    witnessedEffects.set(id, witnessed);
  }
  return { movements, witnessedEffects };
}

/** Sum one explicitly signed part of an unwitnessed route by its exact position. */
function addUnwitnessedEffect(
  effects: Map<string, InventoryMeasurementVector>,
  position: InventoryStockPositionKey,
  measurements: InventoryMeasurementVector
): void {
  const id = inventoryStockPositionIdentity(position);
  const current = effects.get(id);
  if (current !== undefined && primarySign(current) !== primarySign(measurements)) {
    throw new Error("An unwitnessed position cannot be both source and destination in one movement.");
  }
  effects.set(id, current === undefined ? measurements : addInventoryMeasurements(current, measurements));
}

/** Validate conserved FIFO provenance transfers and return stable destination ordering. */
function normalizePositiveLayerProvenanceTransfers(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  transfers: readonly InventoryPositiveLayerProvenanceTransfer[],
  effects: readonly InventoryStockEffect[],
  witnessedEffects?: ReadonlyMap<string, InventoryMeasurementVector>
): readonly InventoryPositiveLayerProvenanceTransfer[] {
  if (
    transfers.length !== 0 &&
    kind !== InventoryEventKind.Transfer &&
    kind !== InventoryEventKind.Reclassification &&
    kind !== InventoryEventKind.RevisionTransition &&
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
  const normalized: NormalizedPositiveLayerProvenanceTransferEntry[] = [];
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
      (kind !== InventoryEventKind.RevisionTransition &&
        from.itemRevisionId !== to.itemRevisionId)
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
    const fromWitness = witnessedEffects?.get(fromIdentity) ?? fromEffect.measurementsDelta;
    const toWitness = witnessedEffects?.get(toIdentity) ?? toEffect.measurementsDelta;
    if (
      compareQuantity(
        fromWitness.primary.quantity,
        zeroQuantity(fromWitness.primary.quantity.unit)
      ) >= 0 ||
      compareQuantity(
        toWitness.primary.quantity,
        zeroQuantity(toWitness.primary.quantity.unit)
      ) <= 0 ||
      (kind !== InventoryEventKind.RevisionTransition &&
        !inventoryMeasurementsAreZero(
          addInventoryMeasurements(
            fromWitness,
            toWitness
          )
        ))
    ) {
      throw new Error(
        "Inventory FIFO provenance transfer must pair equal negative and positive measurement vectors."
      );
    }
    normalized.push({
      transfer: { from, to },
      fromIdentity,
      toIdentity,
    });
  }
  normalized.sort(compareNormalizedPositiveLayerProvenanceTransfer);
  return normalized.map(unwrapNormalizedPositiveLayerProvenanceTransfer);
}

/** One conserved FIFO transfer paired with its already validated exact sort identities. */
interface NormalizedPositiveLayerProvenanceTransferEntry {
  /** Freshly normalized source/destination objects kept separate from stock effects. */
  readonly transfer: InventoryPositiveLayerProvenanceTransfer;
  /** Collision-free source position identity computed before sorting. */
  readonly fromIdentity: string;
  /** Collision-free destination position identity computed before sorting. */
  readonly toIdentity: string;
}

/** Sort conserved FIFO provenance by cached destination and source identities. */
function compareNormalizedPositiveLayerProvenanceTransfer(
  left: NormalizedPositiveLayerProvenanceTransferEntry,
  right: NormalizedPositiveLayerProvenanceTransferEntry
): number {
  const destinationOrder = compareInventoryIdentityText(
    left.toIdentity,
    right.toIdentity
  );
  return destinationOrder === 0
    ? compareInventoryIdentityText(left.fromIdentity, right.fromIdentity)
    : destinationOrder;
}

/** Unwrap one normalized transfer after canonical ordering without changing object ownership. */
function unwrapNormalizedPositiveLayerProvenanceTransfer(
  entry: NormalizedPositiveLayerProvenanceTransferEntry
): InventoryPositiveLayerProvenanceTransfer {
  return entry.transfer;
}

/** Prove every cross-revision stock effect belongs to one complete, exact pair. */
function assertInventoryRevisionTransitionEvidence(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  evidence: InventoryRevisionTransitionEvidence | undefined,
  effects: readonly InventoryStockEffect[],
  transfers: readonly InventoryPositiveLayerProvenanceTransfer[]
): void {
  if (kind !== InventoryEventKind.RevisionTransition) {
    if (evidence !== undefined) {
      throw new Error("Revision-transition evidence belongs only to RevisionTransition events.");
    }
    return;
  }
  if (evidence === undefined || transfers.length === 0 ||
    effects.length !== transfers.length * 2) {
    throw new Error("Revision-transition needs complete one-to-one source/destination evidence.");
  }
  const fromItem = catalog.itemRevision(evidence.fromRevisionId);
  const toItem = catalog.itemRevision(evidence.toRevisionId);
  if (evidence.fromRevisionId === evidence.toRevisionId ||
    fromItem.itemId !== evidence.itemId ||
    toItem.itemId !== evidence.itemId) {
    throw new Error("Revision-transition must retain one item across two distinct item revisions.");
  }
  positiveQuantity(evidence.sourceUnit, "Revision-transition source-unit equivalence");
  positiveQuantity(evidence.targetUnit, "Revision-transition target-unit equivalence");
  if (!Number.isSafeInteger(evidence.expectedWorldRevision) ||
    evidence.expectedWorldRevision < 0 || evidence.selectorIdentity.length === 0) {
    throw new Error("Revision-transition needs an exact reviewed world revision and selector identity.");
  }
  if (fromItem.primaryAxis.unit !== evidence.sourceUnit.unit ||
    toItem.primaryAxis.unit !== evidence.targetUnit.unit) {
    throw new Error("Revision-transition conversion units must match the frozen item revisions.");
  }
  // The paired FIFO continuity marker is also the pairing proof. It must cover every effect.
  const effectById = new Map<string, InventoryStockEffect>();
  for (const effect of effects) {
    effectById.set(inventoryStockPositionIdentity(effect.position), effect);
  }
  for (const transfer of transfers) {
    const from = transfer.from;
    const to = transfer.to;
    if (from.itemId !== evidence.itemId || to.itemId !== evidence.itemId ||
      from.itemRevisionId !== evidence.fromRevisionId ||
      to.itemRevisionId !== evidence.toRevisionId ||
      from.packagingRevisionId !== undefined ||
      to.packagingRevisionId !== undefined ||
      from.transferId !== undefined ||
      to.transferId !== undefined ||
      from.whereaboutsId !== undefined ||
      to.whereaboutsId !== undefined ||
      inventoryStockPositionIdentity({
        ...from,
        itemRevisionId: evidence.toRevisionId,
      }) !== inventoryStockPositionIdentity(to)) {
      throw new Error("Revision-transition must preserve each unwrapped stock position identity.");
    }
    const fromEffect = effectById.get(inventoryStockPositionIdentity(from));
    const toEffect = effectById.get(inventoryStockPositionIdentity(to));
    if (fromEffect === undefined || toEffect === undefined) {
      throw new Error("Revision-transition evidence references missing stock effects.");
    }
    const source = negateQuantity(fromEffect.measurementsDelta.primary.quantity);
    const expected = convertInventoryRevisionQuantity(source, evidence);
    if (!quantityEq(expected, toEffect.measurementsDelta.primary.quantity) ||
      fromEffect.measurementsDelta.primary.axisId !== fromItem.primaryAxis.axisId ||
      toEffect.measurementsDelta.primary.axisId !== toItem.primaryAxis.axisId ||
      fromEffect.measurementsDelta.independent.length !== toEffect.measurementsDelta.independent.length) {
      throw new Error("Revision-transition changes physical amounts without its exact unit equivalence.");
    }
    for (let i = 0; i < fromEffect.measurementsDelta.independent.length; i += 1) {
      const oldAxis = fromEffect.measurementsDelta.independent[i];
      const newAxis = toEffect.measurementsDelta.independent[i];
      if (oldAxis === undefined || newAxis === undefined ||
        oldAxis.axisId !== newAxis.axisId ||
        !quantityEq(
          negateQuantity(oldAxis.quantity),
          newAxis.quantity
        )) {
        throw new Error("Revision-transition changes an independently measured axis.");
      }
    }
  }
}

/** Validate correction-only FIFO provenance replacements and return stable position ordering. */
function normalizePositiveLayerProvenanceOverrides(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  overrides: readonly InventoryPositiveLayerProvenanceOverride[]
): readonly InventoryPositiveLayerProvenanceOverride[] {
  if (
    overrides.length !== 0 &&
    kind !== InventoryEventKind.Correction &&
    kind !== InventoryEventKind.HistoricalRepair
  ) {
    throw new Error(
      "Only a Correction/HistoricalRepair event may replace positive-layer FIFO provenance."
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
    kind === InventoryEventKind.HistoricalRepair ||
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
    kind === InventoryEventKind.HistoricalRepair ||
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
      kind !== InventoryEventKind.Correction &&
      kind !== InventoryEventKind.HistoricalRepair
    ) {
      throw new Error(
        "Only a Correction/HistoricalRepair event may invalidate an earlier relation assertion."
      );
    }
  }
  if (
    kind === InventoryEventKind.Correction ||
    kind === InventoryEventKind.HistoricalRepair
  ) return;
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
  if (kind === InventoryEventKind.RevisionTransition) {
    if (
      effects.length < 2 ||
      lotDefinitions.length !== 0 ||
      placementNodeDefinitions.length !== 0 ||
      traceabilityChanges.length !== 0
    ) {
      throw new Error("Revision-transition events need only paired stock effects.");
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

/** Accumulate conservation totals without the safe-integer limit of stored quantities. */
interface InventoryConservationTotal {
  /** Signed net quantity at the current scale. */
  minor: bigint;
  /** Decimal places needed by the effects seen so far. */
  decimals: number;
}

/** Require internal verbs to conserve every measurement axis inside each frozen item revision. */
function assertInternalEventConservesEachItem(
  effects: readonly InventoryStockEffect[],
  kind: InventoryEventKind
): void {
  /** Normalization already checked the axis units against each frozen revision. */
  const totalByItemRevision = new Map<string, Map<string, InventoryConservationTotal>>();
  for (const effect of effects) {
    let totals = totalByItemRevision.get(effect.itemRevisionId);
    if (totals === undefined) {
      totals = new Map();
      totalByItemRevision.set(effect.itemRevisionId, totals);
    }
    addInventoryConservationMeasurements(totals, effect.measurementsDelta);
  }
  for (const [itemRevisionId, totals] of totalByItemRevision) {
    if (!inventoryConservationTotalsAreZero(totals)) {
      throw new Error(`Inventory event '${kind}' does not conserve item revision '${itemRevisionId}'.`);
    }
  }
}

/** Add all axes without narrowing intermediate sums to stored quantities. */
function addInventoryConservationMeasurements(
  totals: Map<string, InventoryConservationTotal>,
  { primary, independent }: InventoryMeasurementVector
): void {
  addInventoryConservationQuantity(totals, primary.axisId, primary.quantity);
  for (const axis of independent) addInventoryConservationQuantity(totals, axis.axisId, axis.quantity);
}

/** Report whether every measurement axis is balanced exactly. */
function inventoryConservationTotalsAreZero(totals: ReadonlyMap<string, InventoryConservationTotal>): boolean {
  for (const total of totals.values()) if (total.minor !== 0n) return false;
  return true;
}

/** Add one normalized measurement to a temporary exact balance. */
function addInventoryConservationQuantity(
  totals: Map<string, InventoryConservationTotal>,
  axisId: string,
  quantity: Quantity
): void {
  const total = totals.get(axisId);
  if (total === undefined) {
    totals.set(axisId, { minor: BigInt(quantity.amountMinor), decimals: quantity.decimals });
    return;
  }
  if (quantity.decimals > total.decimals) {
    total.minor *= 10n ** BigInt(quantity.decimals - total.decimals);
    total.decimals = quantity.decimals;
  }
  total.minor += integerAtDecimals(quantity, total.decimals);
}

/** Prevent generic reclassification from silently acting like pack/unpack. */
function assertReclassificationPreservesPackagingBuckets(
  effects: readonly InventoryStockEffect[]
): void {
  const totalByPackageBucket = new Map<string, Map<string, InventoryConservationTotal>>();
  for (const effect of effects) {
    const bucket = inventoryIntentFingerprint([
      effect.itemRevisionId,
      effect.position.packagingRevisionId ?? null,
    ]);
    let totals = totalByPackageBucket.get(bucket);
    if (totals === undefined) {
      totals = new Map();
      totalByPackageBucket.set(bucket, totals);
    }
    addInventoryConservationMeasurements(totals, effect.measurementsDelta);
  }
  for (const [bucket, totals] of totalByPackageBucket) {
    if (!inventoryConservationTotalsAreZero(totals)) {
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
