import { compareInventoryIdentityText } from "./ordering.js";
import type { InventoryCatalog } from "./catalog.js";
import { inventoryIntentFingerprint } from "./canonical.js";
import {
  inventoryEventIdForOperation,
  type InventoryCommandHeader,
} from "./commands.js";
import {
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  commitInventoryEvent,
  defineInventoryEvent,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryPositiveLayerProvenanceOverride,
  type InventoryStockEffect,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
  inventoryMeasurementsAreZero,
  inventoryMeasurementsFingerprint,
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
} from "./model.js";
import {
  InventoryDeficitPolicy,
  projectInventoryEvents,
  type InventoryProjectionState,
} from "./projection.js";
import {
  inventoryTraceabilityRelationIdentity,
  type InventoryTraceabilityRelation,
} from "./traceability.js";
import { inventorySparseRecordValue } from "./sparse-record.js";

/** Inputs for replacing one retained event assertion without deleting/revising history. */
export interface CreateInventoryCorrectionInput extends InventoryCommandHeader {
  /** Frozen catalogue used to validate original replacement semantics. */
  readonly catalog: InventoryCatalog;
  /** Current projection containing the retained event being corrected. */
  readonly projection: InventoryProjectionState;
  /** Earlier committed event whose current meaning is wrong/incomplete. */
  readonly correctsEventId: string;
  /** Fully declarative replacement event, or omission when the root assertion never happened. */
  readonly replacement?: InventoryEventDraft;
}

/**
 * Create one append-only correction delta.
 * Original history remains; current stock/reversible relations move from original result to replacement result.
 */
export function createInventoryCorrectionEvent(
  input: CreateInventoryCorrectionInput,
  deficitPolicy: InventoryDeficitPolicy = InventoryDeficitPolicy.Record
): InventoryEventDraft {
  const correctionReason = input.reason;
  if (correctionReason === undefined || correctionReason.trim().length === 0) {
    throw new Error("Inventory correction needs an explicit reason.");
  }
  const original = inventorySparseRecordValue(input.projection.events, input.correctsEventId);
  if (original === undefined) {
    throw new Error(
      `Correction target event '${input.correctsEventId}' does not exist.`
    );
  }
  if (original.kind === InventoryEventKind.Correction) {
    throw new Error(
      "Correction must name the retained root event, not a correction event."
    );
  }
  if (original.kind === InventoryEventKind.CatalogPublication) {
    throw new Error(
      "Catalogue publication is append-only definition history; publish a later retained catalogue instead of correcting it."
    );
  }
  if (original.transferLifecycle !== undefined) {
    throw new Error(
      "Physical transfer lifecycle events cannot be corrected through generic event replacement; use transfer lifecycle commands instead."
    );
  }
  if (input.occurredAt < original.occurredAt) {
    throw new Error(
      "Inventory correction cannot occur before the retained root event."
    );
  }
  const currentCorrectionEventId =
    inventorySparseRecordValue(
    input.projection.correctionEventIdByCorrectedEventId,
    input.correctsEventId
  );
  if (input.replacement?.kind === InventoryEventKind.Correction) {
    throw new Error(
      "Correction replacement must be a normal event assertion, not another correction."
    );
  }
  if (input.replacement?.kind === InventoryEventKind.CatalogPublication) {
    throw new Error(
      "Correction replacement cannot be a catalogue publication; publish retained definitions separately."
    );
  }
  if (input.replacement?.transferLifecycle !== undefined) {
    throw new Error(
      "Generic correction replacement cannot introduce physical transfer lifecycle truth."
    );
  }
  const replacement =
    input.replacement === undefined
      ? undefined
      : defineInventoryEvent({
          catalog: input.catalog,
          event: input.replacement,
        });
  if (replacement !== undefined && replacement.occurredAt > original.recordedAt) {
    throw new Error(
      "Inventory correction replacement cannot occur after the retained root event was durably recorded."
    );
  }
  const desiredProjection = projectHistoryWithReplacement(
    input.catalog,
    input.projection,
    original.eventId,
    replacement,
    deficitPolicy
  );
  const stockEffects = createCorrectionStockEffects(
    input.projection.positions,
    desiredProjection.positions
  );
  const positiveLayerProvenanceOverrides =
    createCorrectionPositiveLayerProvenanceOverrides(
      input.projection,
      desiredProjection
    );
  const traceabilityChanges = createCorrectionTraceabilityChanges(
    input.projection.traceability.relations,
    desiredProjection.traceability.relations
  );
  const sourcePartyId = input.sourcePartyId ?? replacement?.sourcePartyId;
  const destinationPartyId =
    input.destinationPartyId ?? replacement?.destinationPartyId;
  return defineInventoryEvent({
    catalog: input.catalog,
    event: {
      eventId: inventoryEventIdForOperation(input.operationId),
      operationId: input.operationId,
      kind: InventoryEventKind.Correction,
      occurredAt: input.occurredAt,
      stockEffects,
      positiveLayerProvenanceOverrides,
      lotDefinitions: replacement?.lotDefinitions ?? [],
      containerDefinitions: replacement?.containerDefinitions ?? [],
      traceabilityChanges,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(sourcePartyId === undefined ? {} : { sourcePartyId }),
      ...(destinationPartyId === undefined ? {} : { destinationPartyId }),
      ...(input.sourceReference === undefined
        ? {}
        : { sourceReference: input.sourceReference }),
      reason: correctionReason,
      correction: {
        correctsEventId: input.correctsEventId,
        reason: correctionReason,
        ...(currentCorrectionEventId === undefined
          ? {}
          : { supersedesCorrectionEventId: currentCorrectionEventId }),
      },
      metadata: {
        ...(input.metadata ?? {}),
        correctedKind: original.kind,
        replacementKind: replacement?.kind ?? "omit",
        ...(replacement === undefined
          ? {}
          : {
              replacementOccurredAt: replacement.occurredAt,
              replacementEventIntentId: replacement.eventId,
              replacementOperationIntentId: replacement.operationId,
            }),
      },
    },
  });
}

/** Replay retained history as though the root event had always been the replacement assertion. */
function projectHistoryWithReplacement(
  catalog: InventoryCatalog,
  projection: InventoryProjectionState,
  rootEventId: string,
  replacement: InventoryEventDraft | undefined,
  deficitPolicy: InventoryDeficitPolicy
): InventoryProjectionState {
  const root = inventorySparseRecordValue(projection.events, rootEventId);
  if (root === undefined)
    throw new Error("Correction root event disappeared during planning.");
  const replacementAtRoot =
    replacement === undefined
      ? undefined
      : {
          ...replacement,
          eventId: root.eventId,
          operationId: root.operationId,
        };
  const hypothetical: InventoryCommittedEvent[] = [];
  // Effective relation creators for the hypothetical history built below.
  const hypotheticalRelationCreatorById = new Map<string, string>();
  // Traceability rows can become semantic no-ops after an earlier replacement; their
  // correction chain must disappear from the same hypothetical history as well.
  const droppedTraceabilityEventIds = new Set<string>();
  let nextSequence = 1;
  for (
    let recordSequence = 1;
    recordSequence <= projection.lastRecordSequence;
    recordSequence += 1
  ) {
    const eventId = projection.eventIdsBySequence[String(recordSequence)];
    if (eventId === undefined) {
      throw new Error(
        `Correction history is missing recordSequence ${recordSequence}.`
      );
    }
    const event = inventorySparseRecordValue(projection.events, eventId);
    if (event === undefined || event.recordSequence !== recordSequence) {
      throw new Error(
        `Correction history index disagrees at recordSequence ${recordSequence}.`
      );
    }
    if (event.correction?.correctsEventId === rootEventId) continue;
    const correctedEvent =
      event.correction === undefined
        ? undefined
        : inventorySparseRecordValue(
            projection.events,
            event.correction.correctsEventId
          );
    if (
      (event.correction !== undefined &&
        droppedTraceabilityEventIds.has(event.correction.correctsEventId)) ||
      correctedEvent?.kind === InventoryEventKind.LotMetadata ||
      correctedEvent?.kind === InventoryEventKind.ContainerMetadata
    ) {
      continue;
    }
    // Metadata-only events remain their own master assertions. Replaying them as
    // stock/graph drafts would consume a physical sequence without changing stock truth.
    if (
      event.kind === InventoryEventKind.LotMetadata ||
      event.kind === InventoryEventKind.ContainerMetadata
    ) {
      continue;
    }
    if (event.eventId === rootEventId && replacementAtRoot === undefined)
      continue;
    const draft = event.eventId === rootEventId ? replacementAtRoot : event;
    if (draft === undefined) continue;
    // Lot-master replacement is carried directly by the correction event; stock/graph replay must not
    // reinterpret later duplicate lot confirmations as competing roots.
    const stockAndGraphDraft: InventoryEventDraft = {
      ...draft,
      lotDefinitions: [],
      containerDefinitions: [],
    };
    const reconciledTraceabilityChanges =
      reconcileHypotheticalTraceabilityChanges(
        stockAndGraphDraft.traceabilityChanges,
        stockAndGraphDraft.eventId,
        hypotheticalRelationCreatorById
      );
    if (
      stockAndGraphDraft.kind === InventoryEventKind.Traceability &&
      reconciledTraceabilityChanges.length === 0
    ) {
      droppedTraceabilityEventIds.add(event.eventId);
      continue;
    }
    hypothetical.push(
      commitInventoryEvent(
        reconciledTraceabilityChanges === stockAndGraphDraft.traceabilityChanges
          ? stockAndGraphDraft
          : {
              ...stockAndGraphDraft,
              traceabilityChanges: reconciledTraceabilityChanges,
            },
        event.recordedAt,
        nextSequence
      )
    );
    nextSequence += 1;
  }
  return projectInventoryEvents({
    catalog,
    events: hypothetical,
    deficitPolicy,
  });
}

/** Reconcile relation removals that became unnecessary only because earlier corrected history changed. */
function reconcileHypotheticalTraceabilityChanges(
  changes: readonly InventoryTraceabilityRelationChange[],
  eventId: string,
  relationCreatorById: Map<string, string>
): readonly InventoryTraceabilityRelationChange[] {
  let filtered: InventoryTraceabilityRelationChange[] | undefined;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) continue;
    const identity = inventoryTraceabilityRelationIdentity(
      change.kind,
      change.from,
      change.to
    );
    const earlierCreator = relationCreatorById.get(identity);
    if (change.action === InventoryTraceabilityRelationAction.Add) {
      // Preserve duplicate adds for the strict projector to reject; only valid adds advance the local fact map.
      if (earlierCreator === undefined) relationCreatorById.set(identity, eventId);
      if (filtered !== undefined) filtered.push(change);
      continue;
    }
    if (earlierCreator === undefined) {
      // This removal was valid in retained history but is now unnecessary because the
      // corrected hypothetical history no longer contains the relation it targeted.
      filtered ??= changes.slice(0, index);
      continue;
    }
    if (
      change.action !== InventoryTraceabilityRelationAction.Invalidate ||
      change.invalidatesCreatedByEventId === earlierCreator
    ) {
      relationCreatorById.delete(identity);
    }
    // Preserve wrong-creator invalidations for the strict projector to reject.
    if (filtered !== undefined) filtered.push(change);
  }
  return filtered ?? changes;
}

/** Replace FIFO positive-layer provenance so correction equals hypothetical retained-history replay. */
function createCorrectionPositiveLayerProvenanceOverrides(
  actual: InventoryProjectionState,
  desired: InventoryProjectionState
): readonly InventoryPositiveLayerProvenanceOverride[] {
  const identities = new Set<string>([
    ...Object.keys(actual.positiveLayerStartedAtByPositionId),
    ...Object.keys(desired.positiveLayerStartedAtByPositionId),
  ]);
  const orderedIdentities = [...identities];
  orderedIdentities.sort();
  const overrides: InventoryPositiveLayerProvenanceOverride[] = [];
  for (const identity of orderedIdentities) {
    const actualStartedAt = actual.positiveLayerStartedAtByPositionId[identity];
    const desiredStartedAt =
      desired.positiveLayerStartedAtByPositionId[identity];
    if (actualStartedAt === desiredStartedAt) continue;
    const position =
      desired.positions[identity]?.key ?? actual.positions[identity]?.key;
    if (position === undefined) {
      throw new Error(
        `Correction provenance position '${identity}' is missing from both projections.`
      );
    }
    overrides.push({
      position,
      ...(desiredStartedAt === undefined
        ? {}
        : { startedAt: desiredStartedAt }),
    });
  }
  return overrides;
}

/** Create exact desired-current minus actual-current stock deltas. */
function createCorrectionStockEffects(
  actual: Readonly<Record<string, InventoryStockPosition>>,
  desired: Readonly<Record<string, InventoryStockPosition>>
): readonly InventoryStockEffect[] {
  const positionIds = new Set<string>();
  for (const identity of Object.keys(actual)) positionIds.add(identity);
  for (const identity of Object.keys(desired)) positionIds.add(identity);
  const orderedPositionIds = [...positionIds];
  orderedPositionIds.sort();
  const effects: InventoryStockEffect[] = [];
  for (const identity of orderedPositionIds) {
    const actualPosition = actual[identity];
    const desiredPosition = desired[identity];
    const schema =
      desiredPosition?.measurements ?? actualPosition?.measurements;
    if (schema === undefined) continue;
    const actualMeasurements =
      actualPosition?.measurements ?? zeroInventoryMeasurements(schema);
    const desiredMeasurements =
      desiredPosition?.measurements ?? zeroInventoryMeasurements(schema);
    const delta = subtractInventoryMeasurements(
      desiredMeasurements,
      actualMeasurements
    );
    if (inventoryMeasurementsAreZero(delta)) continue;
    if (delta.primary.quantity.amountMinor === 0) {
      throw new Error(
        "Inventory correction cannot change independent measurements without changing primary stock."
      );
    }
    const position = desiredPosition?.key ?? actualPosition?.key;
    if (position === undefined) continue;
    effects.push({
      itemRevisionId: position.itemRevisionId,
      position,
      measurementsDelta: delta,
      metadata: {
        correctionActual: inventoryMeasurementsFingerprint(actualMeasurements),
        correctionDesired:
          inventoryMeasurementsFingerprint(desiredMeasurements),
      },
    });
  }
  effects.sort(compareCorrectionStockEffect);
  return effects;
}

/** Create relation changes that make current graph equal the hypothetical replacement graph. */
function createCorrectionTraceabilityChanges(
  actual: Readonly<Record<string, InventoryTraceabilityRelation>>,
  desired: Readonly<Record<string, InventoryTraceabilityRelation>>
): readonly InventoryTraceabilityRelationChange[] {
  const relationIds = new Set<string>();
  for (const identity of Object.keys(actual)) relationIds.add(identity);
  for (const identity of Object.keys(desired)) relationIds.add(identity);
  const orderedRelationIds = [...relationIds];
  orderedRelationIds.sort();
  const changes: InventoryTraceabilityRelationChange[] = [];
  for (const identity of orderedRelationIds) {
    const actualRelation = actual[identity];
    const desiredRelation = desired[identity];
    if (actualRelation !== undefined && desiredRelation === undefined) {
      changes.push({
        action: InventoryTraceabilityRelationAction.Invalidate,
        kind: actualRelation.kind,
        from: actualRelation.from,
        to: actualRelation.to,
        invalidatesCreatedByEventId: actualRelation.createdByEventId,
      });
      continue;
    }
    if (actualRelation === undefined && desiredRelation !== undefined) {
      changes.push({
        action: InventoryTraceabilityRelationAction.Add,
        kind: desiredRelation.kind,
        from: desiredRelation.from,
        to: desiredRelation.to,
      });
    }
  }
  changes.sort(compareCorrectionTraceabilityChange);
  return changes;
}

/** Sort correction stock deltas by exact position identity. */
function compareCorrectionStockEffect(
  left: InventoryStockEffect,
  right: InventoryStockEffect
): number {
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Sort correction relation changes by stable edge plus exact invalidated creator. */
function compareCorrectionTraceabilityChange(
  left: InventoryTraceabilityRelationChange,
  right: InventoryTraceabilityRelationChange
): number {
  const leftIdentity = inventoryIntentFingerprint([
    inventoryTraceabilityRelationIdentity(left.kind, left.from, left.to),
    left.action,
    left.invalidatesCreatedByEventId ?? null,
  ]);
  const rightIdentity = inventoryIntentFingerprint([
    inventoryTraceabilityRelationIdentity(right.kind, right.from, right.to),
    right.action,
    right.invalidatesCreatedByEventId ?? null,
  ]);
  return compareInventoryIdentityText(leftIdentity, rightIdentity);
}
