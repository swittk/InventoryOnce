import {
  inventoryMeasuredAmountFromVector,
  packageAmount,
  type InventoryAmount,
} from "./amounts.js";
import {
  InventoryCompositionOutputAmountKind,
  InventoryCompositionOutputLotPolicy,
  InventoryTrackingRequirement,
  type InventoryCatalog,
  type InventoryCompositionDefinitionRevision,
  type InventoryCompositionOutputDefinition,
  type InventoryItemDefinitionRevision,
} from "./catalog.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
} from "./canonical.js";
import {
  createInventoryTransformationEvent,
  type InventoryCommandHeader,
  type InventoryContainerMetadataInput,
  type InventoryLotMetadataInput,
  type InventoryTransformationLine,
} from "./commands.js";
import type { InventoryEventDraft } from "./events.js";
import {
  inventoryMeasurementsFingerprint,
  multiplyInventoryMeasurementsByWholeNumber,
} from "./measurements.js";
import {
  InventoryTraceabilityNodeKind,
  inventoryLotIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
  type ContainerId,
  type InventoryMetadata,
  type InventoryMetadataValue,
  type InventoryQualifiedDimension,
  type InventoryStockPositionInput,
  type InventoryTraceabilityNodeRef,
  type LotId,
  type SerialId,
} from "./model.js";
import type {
  InventoryProjectedLotDefinition,
  InventoryProjectionState,
} from "./projection.js";

/** Exact packaged source position required by the native heterogeneous-open verb. */
export type InventoryCompositionSourcePositionInput =
  InventoryStockPositionInput & {
    /** Exact immutable source package revision whose composition is frozen. */
    readonly packagingRevisionId: string;
  };

/** Optional identity/lifecycle placement for one named composition output line. */
export interface InventoryCompositionOutputPlacement {
  /** Explicit output lot identity when the frozen output lot policy requires it. */
  readonly lotId?: LotId;
  /** Exact output serial identity when required/known. */
  readonly serialId?: SerialId;
  /** Exact output handling unit when the produced component remains contained. */
  readonly containerId?: ContainerId;
  /** Output item-defined dimensions; never copied blindly across item revisions. */
  readonly qualifiedDimensions?: readonly InventoryQualifiedDimension[];
  /** Explicit genealogy node when the output position has several physical identities. */
  readonly traceabilityNode?: InventoryTraceabilityNodeRef;
  /** Optional metadata assertion for the selected output lot. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata assertion for the selected output container. */
  readonly container?: InventoryContainerMetadataInput;
  /** Extra JSON-safe facts retained on this output line. */
  readonly metadata?: InventoryMetadata;
}

/** Declarative native opening/decomposition of whole exact heterogeneous packages. */
export interface CreateInventoryCompositionOpenEventInput
  extends InventoryCommandHeader {
  /** Frozen catalogue containing source package and exact composition revision. */
  readonly catalog: InventoryCatalog;
  /** Current projection used only to preserve source lot metadata when appropriate. */
  readonly projection: InventoryProjectionState;
  /** Exact intact source package position. */
  readonly from: InventoryCompositionSourcePositionInput;
  /** Positive whole source packages opened by this operation. */
  readonly packageCount: number;
  /** Optional per-output placement overrides keyed by stable outputId. */
  readonly outputPlacements?: Readonly<
    Record<string, InventoryCompositionOutputPlacement>
  >;
  /** Explicit source genealogy node when source lot/serial/container is ambiguous. */
  readonly sourceTraceabilityNode?: InventoryTraceabilityNodeRef;
}

/** Stable command fingerprint that excludes derived lot metadata but pins every caller choice. */
export function inventoryCompositionOpenIntentFingerprint(
  input: Omit<CreateInventoryCompositionOpenEventInput, "projection">
): string {
  const sourcePackaging = input.catalog.packagingRevision(
    input.from.packagingRevisionId
  );
  const composition = input.catalog.compositionForSourcePackagingRevision(
    sourcePackaging.revisionId
  );
  const sourcePositionId = inventoryStockPositionIdentity({
    ...input.from,
    itemRevisionId: sourcePackaging.itemRevisionId,
  });
  const placementEntries = Object.entries(input.outputPlacements ?? {});
  placementEntries.sort(
    /** Sort output placement keys so caller object insertion order cannot change intent. */
    ([left], [right]) => left.localeCompare(right)
  );
  return inventoryIntentFingerprint([
    "composition-open",
    input.operationId,
    input.occurredAt,
    composition.revisionId,
    sourcePositionId,
    input.packageCount,
    input.actorId ?? null,
    input.sourcePartyId ?? null,
    input.destinationPartyId ?? null,
    input.sourceReference ?? null,
    input.reason ?? null,
    inventoryMetadataFingerprint(input.metadata),
    input.sourceTraceabilityNode === undefined
      ? null
      : inventoryTraceabilityNodeIdentity(input.sourceTraceabilityNode),
    placementEntries.map(
      /** Keep every output placement/lifecycle choice in exact retry intent. */
      ([outputId, placement]) => [
        outputId,
        placement.lotId ?? null,
        placement.serialId ?? null,
        placement.containerId ?? null,
        compositionQualifiedDimensionFingerprint(
          placement.qualifiedDimensions ?? []
        ),
        placement.traceabilityNode === undefined
          ? null
          : inventoryTraceabilityNodeIdentity(placement.traceabilityNode),
        placement.lot?.manufacturedAt ?? null,
        placement.lot?.expiresAt ?? null,
        inventoryMetadataFingerprint(placement.lot?.metadata),
        placement.container?.containerType ?? null,
        inventoryMetadataFingerprint(placement.container?.identifiers),
        placement.container?.openedAt ?? null,
        placement.container?.useBy ?? null,
        inventoryMetadataFingerprint(placement.container?.metadata),
        inventoryMetadataFingerprint(placement.metadata),
      ]
    ),
  ]);
}

/** Return sorted item-defined dimension/value pairs for semantic retry identity. */
function compositionQualifiedDimensionFingerprint(
  dimensions: readonly InventoryQualifiedDimension[]
): readonly (readonly [string, string])[] {
  const parts: Array<readonly [string, string]> = [];
  for (const dimension of dimensions) {
    parts.push([dimension.dimensionId, dimension.valueId]);
  }
  parts.sort(compareCompositionQualifiedDimensionFingerprint);
  return parts;
}

/** Sort one dimension/value fingerprint pair by stable dimension identity then value. */
function compareCompositionQualifiedDimensionFingerprint(
  left: readonly [string, string],
  right: readonly [string, string]
): number {
  const dimensionOrder = left[0].localeCompare(right[0]);
  return dimensionOrder === 0
    ? left[1].localeCompare(right[1])
    : dimensionOrder;
}

/**
 * Open exact heterogeneous packages using the composition attached to their immutable package revision.
 * The mutable active-composition pointer is intentionally never consulted.
 */
export function createInventoryCompositionOpenEvent(
  input: CreateInventoryCompositionOpenEventInput
): InventoryEventDraft {
  if (!Number.isSafeInteger(input.packageCount) || input.packageCount <= 0) {
    throw new Error(
      "Inventory composition open packageCount must be a positive safe integer."
    );
  }
  const sourcePackaging = input.catalog.packagingRevision(
    input.from.packagingRevisionId
  );
  if (sourcePackaging.itemId !== input.from.itemId) {
    throw new Error(
      "Inventory composition source package belongs to another item."
    );
  }
  const composition = input.catalog.compositionForSourcePackagingRevision(
    sourcePackaging.revisionId
  );
  assertKnownCompositionPlacements(composition, input.outputPlacements);
  const sourceLot = currentSourceLot(input.projection, input.from);
  const sourceTraceabilityNode = compositionTraceabilityNode(
    input.from,
    input.sourceTraceabilityNode,
    `${input.operationId}:source`
  );
  const consume: InventoryTransformationLine = {
    position: input.from,
    itemRevisionId: sourcePackaging.itemRevisionId,
    amount: packageAmount(input.packageCount, sourcePackaging.revisionId),
    ...(sourceTraceabilityNode === undefined
      ? {}
      : { traceabilityNode: sourceTraceabilityNode }),
    metadata: {
      inventoryOnceCompositionRole: "source",
      inventoryOnceCompositionRevisionId: composition.revisionId,
    },
  };
  const produce: InventoryTransformationLine[] = [];
  for (const output of composition.outputs) {
    const placement = input.outputPlacements?.[output.outputId];
    produce.push(
      createCompositionOutputLine({
        input,
        composition,
        output,
        ...(sourceLot === undefined ? {} : { sourceLot }),
        ...(placement === undefined ? {} : { placement }),
      })
    );
  }
  return createInventoryTransformationEvent({
    catalog: input.catalog,
    operationId: input.operationId,
    occurredAt: input.occurredAt,
    consume: [consume],
    produce,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.sourcePartyId === undefined
      ? {}
      : { sourcePartyId: input.sourcePartyId }),
    ...(input.destinationPartyId === undefined
      ? {}
      : { destinationPartyId: input.destinationPartyId }),
    ...(input.sourceReference === undefined
      ? {}
      : { sourceReference: input.sourceReference }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    metadata: compositionEventMetadata(
      input.metadata,
      composition,
      input.packageCount
    ),
  });
}

/** Inputs for creating one exact produced line from one frozen composition output. */
interface CreateCompositionOutputLineInput {
  /** Whole opening command. */
  readonly input: CreateInventoryCompositionOpenEventInput;
  /** Exact composition revision attached to the source package. */
  readonly composition: InventoryCompositionDefinitionRevision;
  /** Exact frozen output definition. */
  readonly output: InventoryCompositionOutputDefinition;
  /** Current source lot master when one exists. */
  readonly sourceLot?: InventoryProjectedLotDefinition;
  /** Optional caller placement/lifecycle overrides for this outputId. */
  readonly placement?: InventoryCompositionOutputPlacement;
}

/** Materialize one exact transformation output from a frozen composition line. */
function createCompositionOutputLine({
  input,
  composition,
  output,
  sourceLot,
  placement,
}: CreateCompositionOutputLineInput): InventoryTransformationLine {
  const item = input.catalog.itemRevision(output.itemRevisionId);
  const position = compositionOutputPosition(
    input.from,
    item,
    output,
    placement
  );
  const amount = compositionOutputAmount(output, input.packageCount);
  const lot = compositionOutputLotMetadata(
    input.from,
    position,
    sourceLot,
    output,
    placement
  );
  const traceabilityNode = compositionTraceabilityNode(
    position,
    placement?.traceabilityNode,
    `${input.operationId}:output:${output.outputId}`
  );
  return {
    position,
    itemRevisionId: output.itemRevisionId,
    amount,
    ...(traceabilityNode === undefined ? {} : { traceabilityNode }),
    ...(lot === undefined ? {} : { lot }),
    ...(placement?.container === undefined
      ? {}
      : { container: placement.container }),
    metadata: {
      ...(output.metadata ?? {}),
      ...(placement?.metadata ?? {}),
      inventoryOnceCompositionRole: "output",
      inventoryOnceCompositionId: composition.compositionId,
      inventoryOnceCompositionRevisionId: composition.revisionId,
      inventoryOnceCompositionOutputId: output.outputId,
    },
  };
}

/** Convert one per-package frozen output amount into the exact total opened now. */
function compositionOutputAmount(
  output: InventoryCompositionOutputDefinition,
  sourcePackageCount: number
): InventoryAmount {
  if (output.amount.kind === InventoryCompositionOutputAmountKind.Measured) {
    return inventoryMeasuredAmountFromVector(
      multiplyInventoryMeasurementsByWholeNumber(
        output.amount.measurements,
        sourcePackageCount
      )
    );
  }
  return packageAmount(
    output.amount.packageCount * sourcePackageCount,
    output.amount.packagingRevisionId
  );
}

/** Derive a safe default output position while never copying incompatible item dimensions blindly. */
function compositionOutputPosition(
  source: InventoryCompositionSourcePositionInput,
  item: InventoryItemDefinitionRevision,
  output: InventoryCompositionOutputDefinition,
  placement: InventoryCompositionOutputPlacement | undefined
): InventoryStockPositionInput {
  const lotId = compositionOutputLotId(source, item, output, placement);
  return {
    itemId: item.itemId,
    locationId: source.locationId,
    ...(lotId === undefined ? {} : { lotId }),
    ...(placement?.serialId === undefined
      ? {}
      : { serialId: placement.serialId }),
    ...(placement?.containerId === undefined
      ? {}
      : { containerId: placement.containerId }),
    ...(source.statusId === undefined ? {} : { statusId: source.statusId }),
    ...(source.ownerId === undefined ? {} : { ownerId: source.ownerId }),
    ...(source.custodianId === undefined
      ? {}
      : { custodianId: source.custodianId }),
    ...(source.dispositionAuthorityId === undefined
      ? {}
      : { dispositionAuthorityId: source.dispositionAuthorityId }),
    ...(placement?.qualifiedDimensions === undefined
      ? {}
      : { qualifiedDimensions: placement.qualifiedDimensions }),
  };
}

/** Resolve lot identity strictly from the frozen output policy. */
function compositionOutputLotId(
  source: InventoryCompositionSourcePositionInput,
  item: InventoryItemDefinitionRevision,
  output: InventoryCompositionOutputDefinition,
  placement: InventoryCompositionOutputPlacement | undefined
): LotId | undefined {
  if (output.lotPolicy === InventoryCompositionOutputLotPolicy.None) {
    if (placement?.lotId !== undefined || placement?.lot !== undefined) {
      throw new Error(
        `Composition output '${output.outputId}' forbids lot placement.`
      );
    }
    return undefined;
  }
  if (
    output.lotPolicy === InventoryCompositionOutputLotPolicy.InheritSource ||
    output.lotPolicy ===
      InventoryCompositionOutputLotPolicy.InheritSourceWhenPresent
  ) {
    if (placement?.lotId !== undefined || placement?.lot !== undefined) {
      throw new Error(
        `Composition output '${output.outputId}' inherits its source lot and cannot override it.`
      );
    }
    if (
      source.lotId === undefined &&
      output.lotPolicy === InventoryCompositionOutputLotPolicy.InheritSource
    ) {
      throw new Error(
        `Composition output '${output.outputId}' requires the source package to have a lotId.`
      );
    }
    return source.lotId;
  }
  const lotId = placement?.lotId;
  if (lotId === undefined) {
    throw new Error(
      `Composition output '${output.outputId}' requires an explicit lotId.`
    );
  }
  if (item.tracking.lot === InventoryTrackingRequirement.Forbidden) {
    throw new Error(
      `Composition output '${output.outputId}' item forbids lot identity.`
    );
  }
  return lotId;
}

/** Resolve lot metadata consistently with the frozen output lot policy. */
function compositionOutputLotMetadata(
  source: InventoryCompositionSourcePositionInput,
  outputPosition: InventoryStockPositionInput,
  sourceLot: InventoryProjectedLotDefinition | undefined,
  output: InventoryCompositionOutputDefinition,
  placement: InventoryCompositionOutputPlacement | undefined
): InventoryLotMetadataInput | undefined {
  if (output.lotPolicy === InventoryCompositionOutputLotPolicy.None) {
    return undefined;
  }
  if (output.lotPolicy === InventoryCompositionOutputLotPolicy.Explicit) {
    return placement?.lot;
  }
  if (
    sourceLot === undefined ||
    source.lotId === undefined ||
    outputPosition.lotId !== source.lotId
  ) {
    return undefined;
  }
  const definition = sourceLot.definition;
  return {
    ...(definition.manufacturedAt === undefined
      ? {}
      : { manufacturedAt: definition.manufacturedAt }),
    ...(definition.expiresAt === undefined
      ? {}
      : { expiresAt: definition.expiresAt }),
    ...(definition.metadata === undefined
      ? {}
      : { metadata: definition.metadata }),
  };
}

/** Read the source item-scoped lot master without interpreting a missing row as an error. */
function currentSourceLot(
  projection: InventoryProjectionState,
  source: InventoryCompositionSourcePositionInput
): InventoryProjectedLotDefinition | undefined {
  if (source.lotId === undefined) return undefined;
  return projection.lots[inventoryLotIdentity(source.itemId, source.lotId)];
}

/**
 * Supply complete genealogy: natural single identities are derived by the transformation kernel;
 * identity-free lines receive stable external nodes, while ambiguous positions require an explicit choice.
 */
function compositionTraceabilityNode(
  position: InventoryStockPositionInput,
  explicit: InventoryTraceabilityNodeRef | undefined,
  externalId: string
): InventoryTraceabilityNodeRef | undefined {
  if (explicit !== undefined) return explicit;
  if (position.serialId !== undefined) {
    return {
      kind: InventoryTraceabilityNodeKind.Serial,
      id: position.serialId,
    };
  }
  if (position.containerId !== undefined) {
    return {
      kind: InventoryTraceabilityNodeKind.Container,
      id: position.containerId,
    };
  }
  if (position.lotId !== undefined) {
    return {
      kind: InventoryTraceabilityNodeKind.Lot,
      itemId: position.itemId,
      id: position.lotId,
    };
  }
  return {
    kind: InventoryTraceabilityNodeKind.External,
    id: `inventory:composition:${encodeURIComponent(externalId)}`,
  };
}

/** Reject placement keys that do not name a frozen composition output line. */
function assertKnownCompositionPlacements(
  composition: InventoryCompositionDefinitionRevision,
  placements:
    | Readonly<Record<string, InventoryCompositionOutputPlacement>>
    | undefined
): void {
  if (placements === undefined) return;
  const outputIds = new Set<string>();
  for (const output of composition.outputs) outputIds.add(output.outputId);
  for (const outputId of Object.keys(placements)) {
    if (!outputIds.has(outputId)) {
      throw new Error(
        `Inventory composition '${composition.revisionId}' has no outputId '${outputId}'.`
      );
    }
    const placement = placements[outputId];
    if (placement !== undefined) {
      assertCompositionPlacementFields(outputId, placement);
    }
  }
}

/** Reject undeclared placement fields so JavaScript callers cannot hide a transfer/reclassification. */
function assertCompositionPlacementFields(
  outputId: string,
  placement: InventoryCompositionOutputPlacement
): void {
  const allowed = new Set([
    "lotId",
    "serialId",
    "containerId",
    "qualifiedDimensions",
    "traceabilityNode",
    "lot",
    "container",
    "metadata",
  ]);
  for (const key of Object.keys(placement)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Composition output '${outputId}' placement has unsupported field '${key}'.`
      );
    }
  }
}

/** Build immutable audit evidence without turning composition basis into synthetic stock. */
function compositionEventMetadata(
  applicationMetadata: InventoryMetadata | undefined,
  composition: InventoryCompositionDefinitionRevision,
  packageCount: number
): InventoryMetadata {
  const outputs: InventoryMetadataValue[] = [];
  for (const output of composition.outputs) {
    outputs.push(compositionOutputEvidence(output));
  }
  return {
    ...(applicationMetadata ?? {}),
    inventoryOnceComposition: {
      compositionId: composition.compositionId,
      revisionId: composition.revisionId,
      sourcePackagingRevisionId: composition.sourcePackagingRevisionId,
      sourcePackageCount: packageCount,
      outputs,
    },
  };
}

/** Encode one frozen output definition as JSON-safe audit evidence. */
function compositionOutputEvidence(
  output: InventoryCompositionOutputDefinition
): InventoryMetadataValue {
  if (output.amount.kind === InventoryCompositionOutputAmountKind.Measured) {
    return {
      outputId: output.outputId,
      itemRevisionId: output.itemRevisionId,
      amountKind: output.amount.kind,
      perPackageMeasurements: inventoryMeasurementsFingerprint(
        output.amount.measurements
      ),
    };
  }
  return {
    outputId: output.outputId,
    itemRevisionId: output.itemRevisionId,
    amountKind: output.amount.kind,
    packagingRevisionId: output.amount.packagingRevisionId,
    packageCountPerSourcePackage: output.amount.packageCount,
  };
}
