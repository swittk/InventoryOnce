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
  type InventoryProjectionState,
} from "./projection.js";
import type {
  InventoryPlacementChange,
  InventoryPlacementRelation,
} from "./placement.js";
import {
  inventoryTraceabilityRelationIdentity,
  type InventoryTraceabilityRelation,
} from "./traceability.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import { replayInventoryHistoricalScenario } from "./historical-replay.js";

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
  /** Optional indexed transitive event component; omission replays complete retained history. */
  readonly historyEvents?: readonly InventoryCommittedEvent[];
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
  if (original.kind === InventoryEventKind.HistoricalRepair) {
    throw new Error(
      "Historical-repair envelopes are superseded through recordHistorical assertion omission/replacement, not generic correction."
    );
  }
  if (original.transferLifecycle !== undefined) {
    throw new Error(
      "Physical transfer lifecycle events cannot be corrected through generic event replacement; use transfer lifecycle commands instead."
    );
  }
  if (input.occurredAtEpochMs < original.occurredAtEpochMs) {
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
  if (input.replacement?.kind === InventoryEventKind.HistoricalRepair) {
    throw new Error(
      "Correction replacement cannot be a historical-repair envelope."
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
  if (replacement !== undefined && replacement.occurredAtEpochMs > original.recordedAtEpochMs) {
    throw new Error(
      "Inventory correction replacement cannot occur after the retained root event was durably recorded."
    );
  }
  const replay = replayInventoryHistoricalScenario({
    catalog: input.catalog,
    projection: input.projection,
    deficitPolicy,
    rootReplacement: {
      rootEventId: original.eventId,
      ...(replacement === undefined ? {} : { replacement }),
    },
    ...(input.historyEvents === undefined
      ? {}
      : { sourceEvents: input.historyEvents }),
  });
  const delta = createInventoryProjectionDelta(
    replay.actualProjection,
    replay.projection
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
      occurredAtEpochMs: input.occurredAtEpochMs,
      stockEffects: delta.stockEffects,
      positiveLayerProvenanceOverrides:
        delta.positiveLayerProvenanceOverrides,
      lotDefinitions: replacement?.lotDefinitions ?? [],
      placementNodeDefinitions: replacement?.placementNodeDefinitions ?? [],
      placementChanges: delta.placementChanges,
      traceabilityChanges: delta.traceabilityChanges,
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
      correctionReplacement: replacement ?? null,
      historicalImpact: replay.impact,
      metadata: {
        ...(input.metadata ?? {}),
        correctedKind: original.kind,
        replacementKind: replacement?.kind ?? "omit",
        ...(replacement === undefined
          ? {}
          : {
              replacementOccurredAtEpochMs: replacement.occurredAtEpochMs,
              replacementEventIntentId: replacement.eventId,
              replacementOperationIntentId: replacement.operationId,
            }),
      },
    },
  });
}

/** Complete current-projection delta shared by correction and historical-repair envelopes. */
export interface InventoryProjectionDelta {
  /** Signed current stock delta from actual to desired projection. */
  readonly stockEffects: readonly InventoryStockEffect[];
  /** Exact FIFO layer provenance replacements for touched current positions. */
  readonly positiveLayerProvenanceOverrides: readonly InventoryPositiveLayerProvenanceOverride[];
  /** Current topology changes not already derived from embodied stock movement. */
  readonly placementChanges: readonly InventoryPlacementChange[];
  /** Current reversible relation changes from actual to desired graph. */
  readonly traceabilityChanges: readonly InventoryTraceabilityRelationChange[];
}

/** Derive one exact current-state delta without mutating either projection. */
export function createInventoryProjectionDelta(
  actual: InventoryProjectionState,
  desired: InventoryProjectionState
): InventoryProjectionDelta {
  return {
    stockEffects: createCorrectionStockEffects(
      actual.positions,
      desired.positions
    ),
    positiveLayerProvenanceOverrides:
      createCorrectionPositiveLayerProvenanceOverrides(actual, desired),
    placementChanges: createCorrectionPlacementChanges(
      actual.placement.relationByNodeId,
      desired.placement.relationByNodeId,
      /** Embodied parents are always derived from their one serialized stock row. */
      (nodeId) =>
        inventorySparseRecordValue(actual.placementNodes, nodeId)?.definition
          .embodiedBy !== undefined ||
        inventorySparseRecordValue(desired.placementNodes, nodeId)?.definition
          .embodiedBy !== undefined
    ),
    traceabilityChanges: createCorrectionTraceabilityChanges(
      actual.traceability.relations,
      desired.traceability.relations
    ),
  };
}

/** Replace FIFO positive-layer provenance so correction equals hypothetical retained-history replay. */
function createCorrectionPositiveLayerProvenanceOverrides(
  actual: InventoryProjectionState,
  desired: InventoryProjectionState
): readonly InventoryPositiveLayerProvenanceOverride[] {
  const identities = new Set<string>([
    ...Object.keys(actual.positiveLayerStartedAtEpochMsByPositionId),
    ...Object.keys(desired.positiveLayerStartedAtEpochMsByPositionId),
  ]);
  const orderedIdentities = [...identities];
  orderedIdentities.sort();
  const overrides: InventoryPositiveLayerProvenanceOverride[] = [];
  for (const identity of orderedIdentities) {
    const actualStartedAtEpochMs = actual.positiveLayerStartedAtEpochMsByPositionId[identity];
    const desiredStartedAtEpochMs =
      desired.positiveLayerStartedAtEpochMsByPositionId[identity];
    if (actualStartedAtEpochMs === desiredStartedAtEpochMs) continue;
    const position =
      desired.positions[identity]?.key ?? actual.positions[identity]?.key;
    if (position === undefined) {
      throw new Error(
        `Correction provenance position '${identity}' is missing from both projections.`
      );
    }
    overrides.push({
      position,
      ...(desiredStartedAtEpochMs === undefined
        ? {}
        : { startedAtEpochMs: desiredStartedAtEpochMs }),
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

/** Create exact direct-parent transitions that make current placement equal hypothetical replay. */
function createCorrectionPlacementChanges(
  actual: Readonly<Record<string, InventoryPlacementRelation>>,
  desired: Readonly<Record<string, InventoryPlacementRelation>>,
  parentIsDerived: (nodeId: string) => boolean
): readonly InventoryPlacementChange[] {
  const nodeIds = new Set<string>([
    ...Object.keys(actual),
    ...Object.keys(desired),
  ]);
  const orderedNodeIds = [...nodeIds];
  orderedNodeIds.sort(compareInventoryIdentityText);
  const changes: InventoryPlacementChange[] = [];
  for (const nodeId of orderedNodeIds) {
    const actualParentNodeId = actual[nodeId]?.parentNodeId;
    const desiredParentNodeId = desired[nodeId]?.parentNodeId;
    if (actualParentNodeId === desiredParentNodeId) continue;
    // An embodied node's parent is derived from its unique stock position.
    // Explicit placement changes would violate the same invariant the projection enforces.
    if (parentIsDerived(nodeId)) continue;
    changes.push({
      nodeId,
      ...(actualParentNodeId === undefined
        ? {}
        : { fromParentNodeId: actualParentNodeId }),
      ...(desiredParentNodeId === undefined
        ? {}
        : { toParentNodeId: desiredParentNodeId }),
    });
  }
  return changes;
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
