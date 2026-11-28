import { assertInventoryAmountKind } from "./stock-amount-rules.js";
import { inventoryReportedTransferReplayMetadataKey } from "./reported-transfer-replay.js";
import {
  InventoryAmountKind,
  packageAmount,
  resolveInventoryAmount,
  type InventoryAmount,
  type ResolvedInventoryAmount,
} from "./amounts.js";
import {
  inventoryCatalogSnapshot,
  type InventoryCatalog,
  type InventoryCatalogSnapshot,
  type InventoryItemDefinitionRevision,
  type InventoryPackagingDefinitionRevision,
} from "./catalog.js";
import { inventoryMetadataFingerprint } from "./canonical.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  addInventoryMeasurementTotals,
  inventoryMeasurementTotalsCancel,
  inventoryMeasurementTotalsFromVector,
  materializeInventoryMeasurementTotals,
  type InventoryMeasurementTotals,
} from "./measurement-totals.js";
import { parseQuantity, quantityEq } from "./quantity.js";
import {
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  defineInventoryEvent,
  type InventoryEventDraft,
  type InventoryMeasurementEvidence,
  type InventoryRevisionTransitionEvidence,
  type InventoryPositiveLayerProvenanceTransfer,
  type InventoryStockEffect,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementsEqual,
  negateInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  InventoryStockWhereaboutsState,
  InventoryTraceabilityNodeKind,
  inventoryPlacementNodeIdentity,
  inventoryLotIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryPlacementNodeDefinition,
  type InventoryPlacementNodeEmbodiment,
  type InventoryLotDefinition,
  type InventoryMetadata,
  type InventoryStockIntakePositionInput,
  type InventoryStockPositionInput,
  type InventoryStockPositionKey,
  type InventoryTraceabilityNodeRef,
  type PartyId,
} from "./model.js";
import type { InventoryPlacementChange } from "./placement.js";
/** Common immutable identity/provenance supplied to every application command. */
export interface InventoryCommandHeader {
  /** Stable retry identity; one operation id freezes one exact intent. */
  readonly operationId: string;
  /** Real-world occurrence time in safe-integer epoch milliseconds. */
  readonly occurredAtEpochMs: number;
  /** Actor who performed/asserted the event when known. */
  readonly actorId?: PartyId;
  /** Business/owning/possessing source party when meaningful. */
  readonly sourcePartyId?: PartyId;
  /** Business/owning/possessing destination party when meaningful. */
  readonly destinationPartyId?: PartyId;
  /** External application/provider document/event identity. */
  readonly sourceReference?: string;
  /** Human/operator reason when one is useful. */
  readonly reason?: string;
  /** Extra JSON-safe application facts that do not define stock math. */
  readonly metadata?: InventoryMetadata;
}

/** Optional lot/batch metadata asserted by a stock or metadata event. */
export interface InventoryLotMetadataInput {
  /** Manufacturing time when known. */
  readonly manufacturedAtEpochMs?: number;
  /** Expiry/use-by time when known. */
  readonly expiresAtEpochMs?: number;
  /** Extra JSON-safe lot metadata that does not change stock arithmetic. */
  readonly metadata?: InventoryMetadata;
}

/** Optional metadata and placement policy asserted for one generic node. */
export interface InventoryPlacementNodeMetadataInput {
  /** Application-defined category with no kernel behavior. */
  readonly category?: string;
  /** Whether stock or child nodes may be placed directly here; omission means allowed. */
  readonly acceptsPlacement?: boolean;
  /** Optional unique inventory resource whose lifetime and placement own this node. */
  readonly embodiedBy?: InventoryPlacementNodeEmbodiment;
  /** Barcode/vendor/application identifiers resolving this exact node. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Time this node was physically opened/prepared when meaningful. */
  readonly openedAtEpochMs?: number;
  /** Node-specific use-by time applied through placement ancestry. */
  readonly useByEpochMs?: number;
  /** Extra JSON-safe metadata that does not change identity or topology. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for adopting stock that existed before InventoryOnce became authoritative. */
export interface CreateInventoryOpeningInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve exact item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact opening position; package identity is added from package amount. */
  readonly to: InventoryStockIntakePositionInput;
  /** Exact direct measurements or whole package count already present. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`; requires the destination to name a lot. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.placementNodeId`; requires the destination to name a placementNode. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for receiving stock from outside this inventory world. */
export interface CreateInventoryReceiptInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact destination position; package identity is added from package amount. */
  readonly to: InventoryStockIntakePositionInput;
  /** Direct measurements or exact whole package count received. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to the active revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`; requires the destination to name a lot. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.placementNodeId`; requires the destination to name a placementNode. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for issuing/dispensing stock out of this inventory world. */
export interface CreateInventoryIssueInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact source position. */
  readonly from: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count leaving inventory. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for moving unchanged stock between direct placement nodes. */
export interface CreateInventoryTransferInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact source position; every non-placement dimension is preserved automatically. */
  readonly from: InventoryStockPositionInput;
  /** Destination direct placement node only—other dimensions cannot be silently changed. */
  readonly toPlacementNodeId: string;
  /** Direct measurements or exact whole package count moved. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for one explicit dimension-only resource reclassification. */
export interface CreateInventoryReclassificationInput
  extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact destination position after explicitly named dimensions change. */
  readonly to: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count reclassified. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.placementNodeId` when this change introduces/confirms a placementNode. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for explicitly detaching known-placed stock without issuing it. */
export interface CreateInventoryDetachInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve the source item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Exact currently placed source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact amount becoming intentionally unplaced. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for explicitly placing currently detached/missing stock. */
export interface CreateInventoryPlaceInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve the source item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Exact detached/missing source position. */
  readonly from: InventoryStockPositionInput;
  /** Known direct placement becoming current. */
  readonly into: string;
  /** Exact amount being placed. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for explicitly escalating placed/detached stock to genuinely missing. */
export interface CreateInventoryMarkMissingInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve the source item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Exact placed or detached source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact amount becoming genuinely missing. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Optional placement-node role created while one fungible unit becomes unique. */
export interface InventoryIndividualizedPlacementNodeInput
  extends Omit<InventoryPlacementNodeMetadataInput, "embodiedBy"> {
  /** Global placement-node identity; omission reuses the new serial identity. */
  readonly nodeId?: string;
}

/** Inputs for splitting one exact physical unit into a new current serial identity. */
export interface CreateInventoryIndividualizeInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve the source item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Exact non-serialized source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact measurements representing one physical resource. */
  readonly amount: InventoryAmount;
  /** New current serial identity for the separated physical resource. */
  readonly serialId: string;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional placement-node role embodied by the new serial resource. */
  readonly asPlacementNode?: InventoryIndividualizedPlacementNodeInput;
}

/** Inputs for merging one exact serialized resource back into fungible stock. */
export interface CreateInventoryDeindividualizeInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve the source item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Exact serialized source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact measurements of the one serialized resource. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** One exact source line in an atomic conserved reclassification. */
export interface InventoryReclassificationSourceLine {
  /** Exact source position before classification/identity changes. */
  readonly from: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count leaving this position. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Extra JSON-safe facts about this source line. */
  readonly metadata?: InventoryMetadata;
}

/** One exact destination line in an atomic conserved reclassification. */
export interface InventoryReclassificationDestinationLine {
  /** Exact destination position after explicit classification/identity changes. */
  readonly to: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count entering this position. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.placementNodeId`. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
  /** Extra JSON-safe facts about this destination line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for atomic conserved split/merge/reclassification across exact stock positions. */
export interface CreateInventoryReclassificationManyInput
  extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Non-empty exact source lines. */
  readonly consume: readonly InventoryReclassificationSourceLine[];
  /** Non-empty exact destination lines; total measurements must equal sources per item/package revision. */
  readonly produce: readonly InventoryReclassificationDestinationLine[];
}

/** One explicitly paired old/new stock position in a revision-transition preview. */
export interface InventoryRevisionTransitionLine {
  /** Exact live stock position under the retained source item revision. */
  readonly from: InventoryStockPositionKey;
  /** Entire exact positive vector currently accounted under the source revision. */
  readonly sourceMeasurements: InventoryMeasurementVector;
  /** Exact positive vector under the target revision, with explicit converted primary quantity. */
  readonly targetMeasurements: InventoryMeasurementVector;
}

/** Commit one stock-definition change without calling a clerical correction a physical transformation. */
export interface CreateInventoryRevisionTransitionInput extends InventoryCommandHeader {
  /** Current full item catalogue retaining both old and target definitions. */
  readonly catalog: InventoryCatalog;
  /** Frozen exact conversion/revision meaning published before this operation. */
  readonly transition: InventoryRevisionTransitionEvidence;
  /** Complete one-to-one positions validated by the user's exact-world preview. */
  readonly lines: readonly InventoryRevisionTransitionLine[];
}

/** One destination line in an atomic multi-item receipt. */
export interface InventoryReceiptLine {
  /** Exact placed destination position before package identity is resolved from amount. */
  readonly to: InventoryStockIntakePositionInput;
  /** Direct measurements or exact whole package count received. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.placementNodeId`. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
  /** Extra JSON-safe facts about this physical line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for one atomic multi-line receipt. */
export interface CreateInventoryReceiptManyInput
  extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Non-empty physical receipt lines committed as one fact. */
  readonly lines: readonly InventoryReceiptLine[];
}

/** One source line in an atomic multi-position issue. */
export interface InventoryIssueLine {
  /** Exact source position. */
  readonly from: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count leaving inventory. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Extra JSON-safe facts about this physical line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for one atomic multi-position issue/dispense. */
export interface CreateInventoryIssueManyInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Non-empty exact source lines committed as one issue fact. */
  readonly lines: readonly InventoryIssueLine[];
}

/** One source/destination line in an atomic multi-position transfer. */
export interface InventoryTransferLine {
  /** Exact source position; every non-placement dimension is preserved. */
  readonly from: InventoryStockPositionInput;
  /** Destination direct placement node for this exact line. */
  readonly toPlacementNodeId: string;
  /** Direct measurements or exact whole package count moved. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Extra JSON-safe facts about this physical line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for one atomic multi-position transfer. */
export interface CreateInventoryTransferManyInput
  extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Non-empty transfer lines committed as one conserved fact. */
  readonly lines: readonly InventoryTransferLine[];
}

/** One exact source line in an atomic multi-position scrap/destruction. */
export interface InventoryScrapLine {
  /** Exact source position destroyed. */
  readonly from: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count destroyed. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Extra JSON-safe facts about this physical line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for one atomic multi-position scrap/destruction. */
export interface CreateInventoryScrapManyInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Non-empty exact source lines destroyed by the same reason. */
  readonly lines: readonly InventoryScrapLine[];
}

/** Inputs for explicitly converting loose/inner stock into an intact package bucket. */
export interface CreateInventoryPackInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve package/item definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact loose/inner source position; must not already claim intact packaging. */
  readonly from: InventoryStockPositionInput;
  /** Exact package revision being created. */
  readonly packagingRevisionId: string;
  /** Positive whole packages created. */
  readonly packageCount: number;
  /** Independently measured values not fixed by the package definition. */
  readonly independent?: readonly {
    /** Item independent axis identity. */
    readonly axisId: string;
    /** Exact decimal measurement text. */
    readonly value: string;
    /** Physical unit. */
    readonly unit: string;
  }[];
}

/** Inputs for explicitly converting intact package stock into loose/inner stock. */
export interface CreateInventoryUnpackInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve package/item definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact intact package source position. */
  readonly from: InventoryStockPositionInput;
  /** Positive whole packages opened/unpacked. */
  readonly packageCount: number;
  /** Independently measured values not fixed by the package definition. */
  readonly independent?: readonly {
    /** Item independent axis identity. */
    readonly axisId: string;
    /** Exact decimal measurement text. */
    readonly value: string;
    /** Physical unit. */
    readonly unit: string;
  }[];
  /** Optional exact destination placementNode for the unpacked/loose contents. */
  readonly toPlacementNodeId?: string;
  /** Optional metadata for `toPlacementNodeId`. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
}

/** One input/output line of an explicit inventory transformation. */
export interface InventoryTransformationLine {
  /** Exact source/output position. */
  readonly position: InventoryStockPositionInput;
  /** Exact measurements or whole package count consumed/produced. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional serial/placementNode/lot/external identity used for genealogy. */
  readonly traceabilityNode?: InventoryTraceabilityNodeRef;
  /** Optional metadata for `position.lotId`, normally used on produced outputs. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `position.placementNodeId`, normally used on produced outputs. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
  /** Extra JSON-safe facts about this line. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for consuming arbitrary resources and producing explicit outputs atomically. */
export interface CreateInventoryTransformationInput
  extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve every item/package definition. */
  readonly catalog: InventoryCatalog;
  /** Positive inputs that disappear. */
  readonly consume: readonly InventoryTransformationLine[];
  /** Positive outputs that appear. */
  readonly produce: readonly InventoryTransformationLine[];
}

/** Inputs for explicitly destroying/discarding stock. */
export interface CreateInventoryScrapInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact source position. */
  readonly from: InventoryStockPositionInput;
  /** Exact amount destroyed. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
}

/** Inputs for asserting lot metadata without changing physical quantity. */
export interface CreateInventoryLotMetadataInput
  extends InventoryCommandHeader {
  /** Frozen catalogue validating the stable item identity. */
  readonly catalog: InventoryCatalog;
  /** Stable item owning this item-scoped lot. */
  readonly itemId: string;
  /** Stable lot/batch identity. */
  readonly lotId: string;
  /** Current metadata assertion for this lot. */
  readonly lot: InventoryLotMetadataInput;
}

/** Inputs for asserting placement-node metadata without changing stock or topology. */
export interface CreateInventoryPlacementNodeMetadataInput
  extends InventoryCommandHeader {
  /** Frozen catalogue retained for the common event-validation boundary. */
  readonly catalog: InventoryCatalog;
  /** Stable generic placement-node identity. */
  readonly nodeId: string;
  /** Current metadata/policy assertion for this node. */
  readonly placementNode: InventoryPlacementNodeMetadataInput;
}

/** Inputs for one direct-parent topology change. */
export interface CreateInventoryPlacementInput extends InventoryCommandHeader {
  /** Frozen catalogue retained for the common event-validation boundary. */
  readonly catalog: InventoryCatalog;
  /** Node whose direct placement changes. */
  readonly nodeId: string;
  /** Exact current direct parent, omitted when currently unplaced. */
  readonly fromParentNodeId?: string;
  /** New direct parent, omitted to make this node unplaced. */
  readonly toParentNodeId?: string;
  /** Optional metadata/policy assertion for the moved node. */
  readonly node?: InventoryPlacementNodeMetadataInput;
  /** Optional metadata/policy assertion for the destination parent. */
  readonly parent?: InventoryPlacementNodeMetadataInput;
}

/** Inputs for publishing the façade's retained item/package catalogue without moving stock. */
export interface CreateInventoryCatalogPublicationInput
  extends InventoryCommandHeader {
  /** Exact complete retained catalogue becoming durable/active. */
  readonly catalog: InventoryCatalog;
}

/** Inputs for changing only traceability relationships. */
export interface CreateInventoryTraceabilityInput
  extends InventoryCommandHeader {
  /** Frozen catalogue retained for one uniform event-validation boundary. */
  readonly catalog: InventoryCatalog;
  /** Explicit graph changes. */
  readonly changes: readonly InventoryTraceabilityRelationChange[];
}

/** Intake cannot invent or merge kernel-owned detached/missing whereabouts lifecycles. */
function assertInventoryIntakeHasKnownPlacement(
  position: InventoryStockPositionInput,
  label: string
): asserts position is InventoryStockIntakePositionInput {
  if (
    position.whereaboutsId !== undefined ||
    position.whereaboutsState !== undefined ||
    position.lastPlacementNodeId !== undefined ||
    position.detachedAtEpochMs !== undefined ||
    position.missingAtEpochMs !== undefined
  ) {
    throw new Error(
      label +
        " cannot supply detached/missing whereabouts lifecycle fields; receive/open stock at a known placement and use stock.detach/markMissing explicitly."
    );
  }
  if (position.placementNodeId === undefined) {
    throw new Error(label + " must name a current direct placement.");
  }
}

/** Create a validated opening event for pre-existing stock adoption/import. */
export function createInventoryOpeningEvent(
  input: CreateInventoryOpeningInput
): InventoryEventDraft {
  assertInventoryIntakeHasKnownPlacement(input.to, "Inventory opening");
  const item = findCommandItem(
    input.catalog,
    input.to,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const to = positionWithAmountPackaging(input.to, resolved, item.revisionId);
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Opening,
    input,
    [positiveEffect(item, to, resolved)],
    [],
    lotDefinitionsForPosition(to, input.lot),
    placementNodeDefinitionsForPosition(to, input.placementNode)
  );
}

/** Create a validated receipt event from one declarative command. */
export function createInventoryReceiptEvent(
  input: CreateInventoryReceiptInput
): InventoryEventDraft {
  assertInventoryIntakeHasKnownPlacement(input.to, "Inventory receipt");
  const item = findCommandItem(
    input.catalog,
    input.to,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const to = positionWithAmountPackaging(input.to, resolved, item.revisionId);
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Receipt,
    input,
    [positiveEffect(item, to, resolved)],
    [],
    lotDefinitionsForPosition(to, input.lot),
    placementNodeDefinitionsForPosition(to, input.placementNode)
  );
}

/** Create a validated issue event from one declarative command. */
export function createInventoryIssueEvent(
  input: CreateInventoryIssueInput
): InventoryEventDraft {
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  return createMovementEvent(input.catalog, InventoryEventKind.Issue, input, [
    negativeEffect(item, from, resolved),
  ]);
}

/** Create a direct-placement-only transfer event that copies every other stock dimension automatically. */
export function createInventoryTransferEvent(
  input: CreateInventoryTransferInput
): InventoryEventDraft {
  const toPlacementNodeId = input.toPlacementNodeId.trim();
  if (toPlacementNodeId.length === 0)
    throw new Error("toPlacementNodeId must not be empty.");
  if (input.from.placementNodeId === undefined) {
    throw new Error(
      "Inventory transfer source must have a current placement; use stock.place for detached/missing stock."
    );
  }
  if (input.from.placementNodeId === toPlacementNodeId) {
    throw new Error(
      "Inventory transfer source/destination direct placement nodes must differ."
    );
  }
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  const to = normalizeInventoryStockPositionKey({
    ...from,
    placementNodeId: toPlacementNodeId,
  });
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(input.catalog, InventoryEventKind.Transfer, input, [
      negativeEffect(item, from, resolved),
      positiveEffect(item, to, resolved),
    ]),
    [{ from, to }]
  );
}

/** Create one atomic receipt event from multiple exact destination lines. */
export function createInventoryReceiptManyEvent(
  input: CreateInventoryReceiptManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "receipt");
  // Duplicate exact destinations are one physical effect, not an application-side stock engine.
  const groupedEffects = new Map<string, GroupedInventoryMovementLine>();
  /** Lot masters deduplicated across lines such as the same lot received into two direct placements. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Placement-node definitions deduplicated across lines such as several items received in one carton. */
  const placementNodeDefinitions = new Map<string, InventoryPlacementNodeDefinition>();
  for (const line of input.lines) {
    assertInventoryIntakeHasKnownPlacement(line.to, "Inventory receipt line");
    const item = findCommandItem(
      input.catalog,
      line.to,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const position = positionWithAmountPackaging(
      line.to,
      resolved,
      item.revisionId
    );
    collectLotDefinition(lotDefinitions, position, line.lot);
    collectPlacementNodeDefinition(placementNodeDefinitions, position, line.placementNode);
    const identity = inventoryStockPositionIdentity(position);
    const earlier = groupedEffects.get(identity);
    groupedEffects.set(
      identity,
      earlier === undefined
        ? groupedInventoryMovementLine(item, position, resolved, line.metadata)
        : mergeGroupedInventoryMovementLine(earlier, resolved, line.metadata, identity, "Receipt")
    );
  }
  const groupedEntries = [...groupedEffects.entries()];
  groupedEntries.sort(compareGroupedInventoryMovementEntry);
  const stockEffects: InventoryStockEffect[] = [];
  for (const [, line] of groupedEntries) {
    stockEffects.push(
      positiveEffect(
        line.item,
        line.position,
        groupedInventoryMovementAmount(line),
        line.metadata
      )
    );
  }
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Receipt,
    input,
    stockEffects,
    [],
    sortedLotDefinitions(lotDefinitions),
    sortedPlacementNodeDefinitions(placementNodeDefinitions)
  );
}

/** One exact position accumulated from duplicate movement command lines. */
interface GroupedInventoryMovementLine {
  /** Frozen item definition governing the exact source. */
  readonly item: InventoryItemDefinitionRevision;
  /** Revision-qualified exact source after package identity is resolved. */
  readonly position: InventoryStockPositionKey;
  /** First exact line's measurements, used directly for an unmerged posting. */
  readonly measurements: InventoryMeasurementVector;
  /** Wide per-axis totals once two or more lines share this posting. */
  readonly combinedMeasurements?: InventoryMeasurementTotals;
  /** Exact intact-package revision retained by this movement. */
  readonly packaging?: InventoryPackagingDefinitionRevision;
  /** Whole package count represented by the summed lines. */
  readonly packageCount?: number;
  /** Identical application metadata retained for the one combined effect. */
  readonly metadata?: InventoryMetadata;
}

/** One exact one-to-one transfer route accumulated from duplicate batch lines. */
interface GroupedInventoryTransferLine extends GroupedInventoryMovementLine {
  /** Exact destination preserving every non-placement stock dimension. */
  readonly destination: InventoryStockPositionKey;
}

/** One exact transformation position plus its normalized genealogy node. */
interface GroupedInventoryTransformationLine {
  /** Grouped physical amount and metadata for this exact position. */
  readonly movement: GroupedInventoryMovementLine;
  /** Effective serial/placementNode/lot/external genealogy identity after inference. */
  readonly genealogyNode?: InventoryTraceabilityNodeRef;
}

/** Compare two optional genealogy nodes by the exact traceability identity they represent. */
function sameTransformationGenealogyNode(
  left: InventoryTraceabilityNodeRef | undefined,
  right: InventoryTraceabilityNodeRef | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    inventoryTraceabilityNodeIdentity(left) ===
    inventoryTraceabilityNodeIdentity(right)
  );
}

/** Sort grouped transformation entries by their collision-free exact position identity. */
function compareGroupedInventoryTransformationEntry(
  left: readonly [string, GroupedInventoryTransformationLine],
  right: readonly [string, GroupedInventoryTransformationLine]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Freeze one resolved line before duplicate exact identities are combined. */
function groupedInventoryMovementLine(
  item: InventoryItemDefinitionRevision,
  position: InventoryStockPositionKey,
  resolved: ResolvedInventoryAmount,
  metadata: InventoryMetadata | undefined
): GroupedInventoryMovementLine {
  return {
    item,
    position,
    measurements: resolved.measurements,
    ...(resolved.packaging === undefined ? {} : { packaging: resolved.packaging }),
    ...(resolved.packageCount === undefined ? {} : { packageCount: resolved.packageCount }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Accumulate duplicate lines without narrowing intermediate quantities. */
function mergeGroupedInventoryMovementLine(
  earlier: GroupedInventoryMovementLine,
  resolved: ResolvedInventoryAmount,
  metadata: InventoryMetadata | undefined,
  identity: string,
  label: string
): GroupedInventoryMovementLine {
  if (
    inventoryMetadataFingerprint(earlier.metadata) !==
    inventoryMetadataFingerprint(metadata)
  ) {
    throw new Error(
      `${label} lines for exact movement ${identity} have conflicting effect metadata.`
    );
  }
  const packageEvidence = mergeMovementPackageCount(earlier, resolved, identity, label);
  const combinedMeasurements = earlier.combinedMeasurements ?? new Map();
  if (earlier.combinedMeasurements === undefined) {
    addInventoryMeasurementTotals(combinedMeasurements, earlier.measurements);
  }
  addInventoryMeasurementTotals(combinedMeasurements, resolved.measurements);
  return { ...earlier, combinedMeasurements, ...packageEvidence };
}

/** Preserve package identity and count while combining duplicate lines. */
function mergeMovementPackageCount(
  earlier: GroupedInventoryMovementLine,
  resolved: ResolvedInventoryAmount,
  identity: string,
  label: string
): Pick<GroupedInventoryMovementLine, "packaging" | "packageCount"> {
  if (earlier.packaging === undefined && resolved.packaging === undefined) {
    return {};
  }
  const packaging = earlier.packaging;
  const resolvedPackaging = resolved.packaging;
  if (
    packaging === undefined ||
    resolvedPackaging === undefined ||
    packaging.revisionId !== resolvedPackaging.revisionId ||
    earlier.packageCount === undefined ||
    resolved.packageCount === undefined
  ) {
    throw new Error(
      `${label} lines for exact movement ${identity} disagree about package identity.`
    );
  }
  const packageCount = earlier.packageCount + resolved.packageCount;
  if (!Number.isSafeInteger(packageCount) || packageCount <= 0) {
    throw new Error(
      `${label} package count overflowed at exact movement ${identity}.`
    );
  }
  return { packaging, packageCount };
}

/** Store the final grouped measurements and retain exact package evidence. */
function groupedInventoryMovementAmount(
  line: GroupedInventoryMovementLine
): ResolvedInventoryAmount {
  return {
    measurements: groupedInventoryMovementMeasurements(line),
    ...(line.packaging === undefined ? {} : { packaging: line.packaging }),
    ...(line.packageCount === undefined ? {} : { packageCount: line.packageCount }),
  };
}

/** Return one original vector or narrow its completed exact sum. */
function groupedInventoryMovementMeasurements(line: GroupedInventoryMovementLine): InventoryMeasurementVector {
  return line.combinedMeasurements === undefined ? line.measurements :
    materializeInventoryMeasurementTotals(line.combinedMeasurements, line.measurements.primary.axisId);
}

/** Sort grouped movement entries by their collision-free identity key. */
function compareGroupedInventoryMovementEntry(
  left: readonly [string, GroupedInventoryMovementLine],
  right: readonly [string, GroupedInventoryMovementLine]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Create one atomic issue event from multiple exact source lines. */
export function createInventoryIssueManyEvent(
  input: CreateInventoryIssueManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "issue");
  const groupedEffects = new Map<string, GroupedInventoryMovementLine>();
  for (const line of input.lines) {
    const item = findCommandItem(
      input.catalog,
      line.from,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const from = positionWithAmountPackaging(
      line.from,
      resolved,
      item.revisionId
    );
    const identity = inventoryStockPositionIdentity(from);
    const earlier = groupedEffects.get(identity);
    groupedEffects.set(
      identity,
      earlier === undefined
        ? groupedInventoryMovementLine(item, from, resolved, line.metadata)
        : mergeGroupedInventoryMovementLine(
            earlier,
            resolved,
            line.metadata,
            identity,
            "Issue"
          )
    );
  }
  const groupedEntries = [...groupedEffects.entries()];
  groupedEntries.sort(compareGroupedInventoryMovementEntry);
  const stockEffects: InventoryStockEffect[] = [];
  for (const [, line] of groupedEntries) {
    stockEffects.push(
      negativeEffect(
        line.item,
        line.position,
        groupedInventoryMovementAmount(line),
        line.metadata
      )
    );
  }
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Issue,
    input,
    stockEffects
  );
}

/** Create one atomic conserved transfer event from multiple exact source lines. */
export function createInventoryTransferManyEvent(
  input: CreateInventoryTransferManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "transfer");
  const groupedTransfers = new Map<string, GroupedInventoryTransferLine>();
  // One-to-one FIFO provenance cannot represent a source split, destination merge, or route cycle.
  const endpointRoutes = new Map<string, string>();
  for (const line of input.lines) {
    const toPlacementNodeId = line.toPlacementNodeId.trim();
    if (toPlacementNodeId.length === 0) {
      throw new Error("Transfer line toPlacementNodeId must not be empty.");
    }
    if (line.from.placementNodeId === undefined) {
      throw new Error(
        "Transfer line source must have a current placement; use stock.place for detached/missing stock."
      );
    }
    if (line.from.placementNodeId === toPlacementNodeId) {
      throw new Error(
        "Transfer line source/destination direct placement nodes must differ."
      );
    }
    const item = findCommandItem(
      input.catalog,
      line.from,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const from = positionWithAmountPackaging(
      line.from,
      resolved,
      item.revisionId
    );
    const to = normalizeInventoryStockPositionKey({
      ...from,
      placementNodeId: toPlacementNodeId,
    });
    const fromIdentity = inventoryStockPositionIdentity(from);
    const toIdentity = inventoryStockPositionIdentity(to);
    const routeIdentity = JSON.stringify([fromIdentity, toIdentity]);
    for (const endpointIdentity of [fromIdentity, toIdentity]) {
      const earlierRoute = endpointRoutes.get(endpointIdentity);
      if (earlierRoute !== undefined && earlierRoute !== routeIdentity) {
        throw new Error(
          "Transfer batch lines must form disjoint one-to-one exact source/destination routes."
        );
      }
      endpointRoutes.set(endpointIdentity, routeIdentity);
    }
    const earlier = groupedTransfers.get(routeIdentity);
    if (earlier === undefined) {
      groupedTransfers.set(routeIdentity, {
        ...groupedInventoryMovementLine(item, from, resolved, line.metadata),
        destination: to,
      });
    } else {
      groupedTransfers.set(routeIdentity, {
        ...mergeGroupedInventoryMovementLine(
          earlier,
          resolved,
          line.metadata,
          routeIdentity,
          "Transfer"
        ),
        destination: earlier.destination,
      });
    }
  }
  const groupedEntries = [...groupedTransfers.entries()];
  groupedEntries.sort(compareGroupedInventoryMovementEntry);
  const stockEffects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const [, line] of groupedEntries) {
    const amount = groupedInventoryMovementAmount(line);
    stockEffects.push(
      negativeEffect(line.item, line.position, amount, line.metadata)
    );
    stockEffects.push(
      positiveEffect(line.item, line.destination, amount, line.metadata)
    );
    provenanceTransfers.push({ from: line.position, to: line.destination });
  }
  // This movement already has exact one-to-one FIFO provenance. Construct
  // and validate the complete event once rather than validating 20k stock
  // effects, appending provenance, and validating all 20k effects again.
  return defineInventoryEvent({
    catalog: input.catalog,
    event: {
      ...movementEventDraft(
        InventoryEventKind.Transfer,
        input,
        stockEffects
      ),
      positiveLayerProvenanceTransfers: provenanceTransfers,
    },
  });
}

/** Create an ordinary dimension-only reclassification that preserves whereabouts. */
export function createInventoryReclassificationEvent(
  input: CreateInventoryReclassificationInput
): InventoryEventDraft {
  return createInventoryReclassificationEventInternal(input, false);
}

/** Create an explicit known-placement -> detached lifecycle transition. */
export function createInventoryDetachEvent(
  input: CreateInventoryDetachInput
): InventoryEventDraft {
  return createInventoryReclassificationEventInternal(
    {
      ...input,
      to: inventoryDetachedCommandPosition(input),
    },
    true
  );
}

/** Create an explicit detached/missing -> known-placement lifecycle transition. */
export function createInventoryPlaceEvent(
  input: CreateInventoryPlaceInput
): InventoryEventDraft {
  return createInventoryReclassificationEventInternal(
    {
      ...input,
      to: inventoryPlacedCommandPosition(input),
    },
    true
  );
}

/** Create an explicit placed/detached -> missing lifecycle transition. */
export function createInventoryMarkMissingEvent(
  input: CreateInventoryMarkMissingInput
): InventoryEventDraft {
  return createInventoryReclassificationEventInternal(
    {
      ...input,
      to: inventoryMissingCommandPosition(input),
    },
    true
  );
}

/** Shared single-line reducer; only explicit lifecycle verbs may bypass preservation. */
function createInventoryReclassificationEventInternal(
  input: CreateInventoryReclassificationInput,
  allowWhereaboutsTransition: boolean
): InventoryEventDraft {
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  const to = positionWithAmountPackaging(input.to, resolved, item.revisionId);
  if (!allowWhereaboutsTransition) {
    assertInventoryReclassificationPreservesWhereabouts(from, to);
  }
  if (from.itemId !== to.itemId) {
    throw new Error(
      "Reclassification cannot change item identity; use transformation."
    );
  }
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Reclassification,
      input,
      [
        negativeEffect(item, from, resolved),
        positiveEffect(item, to, resolved),
      ],
      [],
      [],
      placementNodeDefinitionsForPosition(to, input.placementNode)
    ),
    [{ from, to }]
  );
}

/** Split one exact physical unit out of fungible stock and optionally embody a node. */
export function createInventoryIndividualizeEvent(
  input: CreateInventoryIndividualizeInput
): InventoryEventDraft {
  if (input.from.serialId !== undefined) {
    throw new Error("Individualize source must not already have a serial identity.");
  }
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  if (
    !quantityEq(
      resolved.measurements.primary.quantity,
      parseQuantity("1", resolved.measurements.primary.quantity.unit)
    )
  ) {
    throw new Error("Individualize must split exactly one primary resource.");
  }
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  const to = normalizeInventoryStockPositionKey({
    ...from,
    serialId: input.serialId,
  });
  const placementNodeDefinitions: InventoryPlacementNodeDefinition[] = [];
  if (input.asPlacementNode !== undefined) {
    const { nodeId = input.serialId, ...metadata } = input.asPlacementNode;
    placementNodeDefinitions.push({
      nodeId,
      ...metadata,
      embodiedBy: { itemId: from.itemId, serialId: input.serialId },
    });
  }
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Reclassification,
      input,
      [negativeEffect(item, from, resolved), positiveEffect(item, to, resolved)],
      [],
      [],
      placementNodeDefinitions
    ),
    [{ from, to }]
  );
}

/** Merge one exact serialized resource back into otherwise identical fungible stock. */
export function createInventoryDeindividualizeEvent(
  input: CreateInventoryDeindividualizeInput
): InventoryEventDraft {
  const serialId = input.from.serialId;
  if (serialId === undefined) {
    throw new Error("Deindividualize source must name one serial identity.");
  }
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  if (
    !quantityEq(
      resolved.measurements.primary.quantity,
      parseQuantity("1", resolved.measurements.primary.quantity.unit)
    )
  ) {
    throw new Error("Deindividualize must merge exactly one primary resource.");
  }
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  const { serialId: _serialId, ...withoutSerial } = from;
  const to = normalizeInventoryStockPositionKey(withoutSerial);
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Reclassification,
      input,
      [negativeEffect(item, from, resolved), positiveEffect(item, to, resolved)]
    ),
    [{ from, to }]
  );
}

/** Create one atomic conserved split/merge/reclassification event. */
export function createInventoryReclassificationManyEvent(
  input: CreateInventoryReclassificationManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.consume, "reclassification source");
  assertNonEmptyMovementLines(input.produce, "reclassification destination");
  const groupedSources = new Map<string, GroupedInventoryMovementLine>();
  const groupedDestinations = new Map<string, GroupedInventoryMovementLine>();
  /** Exact source identities must not also be emitted as unchanged destinations. */
  const sourceIdentities = new Set<string>();
  /** Lot masters asserted by destination lines and deduplicated for this event. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Placement-node definitions asserted by destination lines and deduplicated for this event. */
  const placementNodeDefinitions = new Map<string, InventoryPlacementNodeDefinition>();
  for (const line of input.consume) {
    const item = findCommandItem(
      input.catalog,
      line.from,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const from = positionWithAmountPackaging(
      line.from,
      resolved,
      item.revisionId
    );
    const identity = inventoryStockPositionIdentity(from);
    sourceIdentities.add(identity);
    const earlier = groupedSources.get(identity);
    groupedSources.set(
      identity,
      earlier === undefined
        ? groupedInventoryMovementLine(item, from, resolved, line.metadata)
        : mergeGroupedInventoryMovementLine(
            earlier,
            resolved,
            line.metadata,
            identity,
            "Reclassification source"
          )
    );
  }
  for (const line of input.produce) {
    const item = findCommandItem(
      input.catalog,
      line.to,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const to = positionWithAmountPackaging(line.to, resolved, item.revisionId);
    const identity = inventoryStockPositionIdentity(to);
    if (sourceIdentities.has(identity)) {
      throw new Error(
        "Reclassification source and destination exact positions must be disjoint."
      );
    }
    collectLotDefinition(lotDefinitions, to, line.lot);
    collectPlacementNodeDefinition(placementNodeDefinitions, to, line.placementNode);
    const earlier = groupedDestinations.get(identity);
    groupedDestinations.set(
      identity,
      earlier === undefined
        ? groupedInventoryMovementLine(item, to, resolved, line.metadata)
        : mergeGroupedInventoryMovementLine(
            earlier,
            resolved,
            line.metadata,
            identity,
            "Reclassification destination"
          )
    );
  }
  const sourceEntries = [...groupedSources.entries()];
  const destinationEntries = [...groupedDestinations.entries()];
  assertInventoryReclassificationManyPreservesWhereabouts(
    sourceEntries.map(
      /** Project one grouped source into lifecycle-conservation evidence. */
      ([, line]) => ({
        position: line.position,
        measurements: groupedInventoryMovementMeasurements(line),
      })
    ),
    destinationEntries.map(
      /** Project one grouped destination into lifecycle-conservation evidence. */
      ([, line]) => ({
        position: line.position,
        measurements: groupedInventoryMovementMeasurements(line),
      })
    )
  );
  sourceEntries.sort(compareGroupedInventoryMovementEntry);
  destinationEntries.sort(compareGroupedInventoryMovementEntry);
  const stockEffects: InventoryStockEffect[] = [];
  const provenanceSources: InventoryProvenanceLine[] = [];
  const provenanceDestinations: InventoryProvenanceLine[] = [];
  for (const [, line] of sourceEntries) {
    const amount = groupedInventoryMovementAmount(line);
    stockEffects.push(
      negativeEffect(line.item, line.position, amount, line.metadata)
    );
    provenanceSources.push({
      position: line.position,
      measurements: amount.measurements,
    });
  }
  for (const [, line] of destinationEntries) {
    const amount = groupedInventoryMovementAmount(line);
    stockEffects.push(
      positiveEffect(line.item, line.position, amount, line.metadata)
    );
    provenanceDestinations.push({
      position: line.position,
      measurements: amount.measurements,
    });
  }
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Reclassification,
      input,
      stockEffects,
      [],
      sortedLotDefinitions(lotDefinitions),
      sortedPlacementNodeDefinitions(placementNodeDefinitions)
    ),
    pairwiseReclassificationProvenanceTransfers(
      provenanceSources,
      provenanceDestinations
    )
  );
}

/** Construct one atomic, separately typed revision transition from exact paired positions. */
export function createInventoryRevisionTransitionEvent(
  input: CreateInventoryRevisionTransitionInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "revision-transition");
  const stockEffects: InventoryStockEffect[] = [];
  const transfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const line of input.lines) {
    const from = normalizeInventoryStockPositionKey(line.from);
    if (from.itemId !== input.transition.itemId ||
      from.itemRevisionId !== input.transition.fromRevisionId) {
      throw new Error("Revision-transition source position differs from the declared source revision.");
    }
    const to = normalizeInventoryStockPositionKey({
      ...from,
      itemRevisionId: input.transition.toRevisionId,
    });
    // Effects are deliberately different item revisions; generic same-revision
    // reclassification would reject this and physical transformation would
    // incorrectly assert production genealogy for unchanged physical stock.
    stockEffects.push({
      itemRevisionId: from.itemRevisionId,
      position: from,
      measurementsDelta: negateInventoryMeasurements(line.sourceMeasurements),
      evidence: { transactedMeasurements: line.sourceMeasurements },
    });
    stockEffects.push({
      itemRevisionId: to.itemRevisionId,
      position: to,
      measurementsDelta: line.targetMeasurements,
      evidence: { transactedMeasurements: line.targetMeasurements },
    });
    transfers.push({ from, to });
  }
  return defineInventoryEvent({
    catalog: input.catalog,
    event: {
      ...movementEventDraft(
        InventoryEventKind.RevisionTransition,
        input,
        stockEffects,
      ),
      revisionTransition: input.transition,
      positiveLayerProvenanceTransfers: transfers,
    },
  });
}

/** Create an explicit loose/inner -> intact-package event. */
export function createInventoryPackEvent(
  input: CreateInventoryPackInput
): InventoryEventDraft {
  assertCommandPositionIsNotTransferBound(input.from);
  if (input.from.packagingRevisionId !== undefined) {
    throw new Error("Pack source must not already claim intact packaging.");
  }
  const packaging = input.catalog.packagingRevision(input.packagingRevisionId);
  if (packaging.itemId !== input.from.itemId) {
    throw new Error("Package revision belongs to a different item.");
  }
  const item = input.catalog.itemRevision(packaging.itemRevisionId);
  const amount = packageAmount(
    input.packageCount,
    packaging.revisionId,
    input.independent ?? []
  );
  const resolved = resolveInventoryAmount(input.catalog, item, amount);
  const from = normalizeInventoryStockPositionKey({
    ...input.from,
    itemRevisionId: item.revisionId,
  });
  const to = normalizeInventoryStockPositionKey({
    ...from,
    packagingRevisionId: packaging.revisionId,
  });
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(input.catalog, InventoryEventKind.Pack, input, [
      negativeEffect(item, from, resolved),
      positiveEffect(item, to, resolved),
    ]),
    [{ from, to }]
  );
}

/** Create an explicit intact-package -> loose/inner event. */
export function createInventoryUnpackEvent(
  input: CreateInventoryUnpackInput
): InventoryEventDraft {
  assertCommandPositionIsNotTransferBound(input.from);
  const packagingRevisionId = input.from.packagingRevisionId;
  if (packagingRevisionId === undefined) {
    throw new Error("Unpack source must name exact packagingRevisionId.");
  }
  const packaging = input.catalog.packagingRevision(packagingRevisionId);
  if (packaging.itemId !== input.from.itemId) {
    throw new Error("Package revision belongs to a different item.");
  }
  const item = input.catalog.itemRevision(packaging.itemRevisionId);
  const amount = packageAmount(
    input.packageCount,
    packagingRevisionId,
    input.independent ?? []
  );
  const resolved = resolveInventoryAmount(input.catalog, item, amount);
  const from = normalizeInventoryStockPositionKey({
    ...input.from,
    itemRevisionId: item.revisionId,
  });
  const loose = removePackagingRevision(from);
  const to =
    input.toPlacementNodeId === undefined
      ? loose
      : normalizeInventoryStockPositionKey({
          ...loose,
          placementNodeId: input.toPlacementNodeId,
        });
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Unpack,
      input,
      [
        negativeEffect(item, from, resolved),
        positiveEffect(item, to, resolved),
      ],
      [],
      [],
      placementNodeDefinitionsForPosition(to, input.placementNode)
    ),
    [{ from, to }]
  );
}

/** Create one inseparable consume-inputs/produce-outputs event with optional complete genealogy. */
export function createInventoryTransformationEvent(
  input: CreateInventoryTransformationInput
): InventoryEventDraft {
  if (input.consume.length === 0 || input.produce.length === 0) {
    throw new Error(
      "Inventory transformation needs both consume and produce lines."
    );
  }
  const groupedConsumed = new Map<string, GroupedInventoryTransformationLine>();
  const groupedProduced = new Map<string, GroupedInventoryTransformationLine>();
  /** Exact consumed positions must not also be emitted unchanged as transformation outputs. */
  const consumedIdentities = new Set<string>();
  /** Lot masters asserted by consumed/produced lines and deduplicated for this event. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Placement-node definitions asserted by consumed/produced lines and deduplicated for this event. */
  const placementNodeDefinitions = new Map<string, InventoryPlacementNodeDefinition>();
  for (const line of input.consume) {
    const item = findCommandItem(
      input.catalog,
      line.position,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const position = positionWithAmountPackaging(
      line.position,
      resolved,
      item.revisionId
    );
    const identity = inventoryStockPositionIdentity(position);
    consumedIdentities.add(identity);
    collectLotDefinition(lotDefinitions, position, line.lot);
    collectPlacementNodeDefinition(placementNodeDefinitions, position, line.placementNode);
    const genealogyNode = findTransformationGenealogyNodeForLine({
      position,
      ...(line.traceabilityNode === undefined
        ? {}
        : { explicitNode: line.traceabilityNode }),
    });
    const earlier = groupedConsumed.get(identity);
    if (earlier !== undefined &&
        !sameTransformationGenealogyNode(earlier.genealogyNode, genealogyNode)) {
      throw new Error(
        `Transformation consume lines for exact position ${identity} disagree about genealogy identity.`
      );
    }
    groupedConsumed.set(identity, {
      movement:
        earlier === undefined
          ? groupedInventoryMovementLine(item, position, resolved, line.metadata)
          : mergeGroupedInventoryMovementLine(
              earlier.movement,
              resolved,
              line.metadata,
              identity,
              "Transformation consume"
            ),
      ...(genealogyNode === undefined ? {} : { genealogyNode }),
    });
  }
  for (const line of input.produce) {
    const item = findCommandItem(
      input.catalog,
      line.position,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const position = positionWithAmountPackaging(
      line.position,
      resolved,
      item.revisionId
    );
    const identity = inventoryStockPositionIdentity(position);
    if (consumedIdentities.has(identity)) {
      throw new Error(
        "Transformation consume and produce exact positions must be disjoint."
      );
    }
    collectLotDefinition(lotDefinitions, position, line.lot);
    collectPlacementNodeDefinition(placementNodeDefinitions, position, line.placementNode);
    const genealogyNode = findTransformationGenealogyNodeForLine({
      position,
      ...(line.traceabilityNode === undefined
        ? {}
        : { explicitNode: line.traceabilityNode }),
    });
    const earlier = groupedProduced.get(identity);
    if (earlier !== undefined &&
        !sameTransformationGenealogyNode(earlier.genealogyNode, genealogyNode)) {
      throw new Error(
        `Transformation produce lines for exact position ${identity} disagree about genealogy identity.`
      );
    }
    groupedProduced.set(identity, {
      movement:
        earlier === undefined
          ? groupedInventoryMovementLine(item, position, resolved, line.metadata)
          : mergeGroupedInventoryMovementLine(
              earlier.movement,
              resolved,
              line.metadata,
              identity,
              "Transformation produce"
            ),
      ...(genealogyNode === undefined ? {} : { genealogyNode }),
    });
  }
  const consumedEntries = [...groupedConsumed.entries()];
  const producedEntries = [...groupedProduced.entries()];
  assertInventoryTransformationWhereaboutsInheritance(
    consumedEntries.map(
      /** Project one consumed line to the exact whereabouts-bearing position. */
      ([, line]) => line.movement.position
    ),
    producedEntries.map(
      /** Project one produced line to the exact whereabouts-bearing position. */
      ([, line]) => line.movement.position
    )
  );
  consumedEntries.sort(compareGroupedInventoryTransformationEntry);
  producedEntries.sort(compareGroupedInventoryTransformationEntry);
  const stockEffects: InventoryStockEffect[] = [];
  const consumedGenealogyLines: InventoryTransformationGenealogyLine[] = [];
  const producedGenealogyLines: InventoryTransformationGenealogyLine[] = [];
  for (const [, line] of consumedEntries) {
    const movement = line.movement;
    stockEffects.push(
      negativeEffect(
        movement.item,
        movement.position,
        groupedInventoryMovementAmount(movement),
        movement.metadata
      )
    );
    consumedGenealogyLines.push({
      position: movement.position,
      ...(line.genealogyNode === undefined
        ? {}
        : { explicitNode: line.genealogyNode }),
    });
  }
  for (const [, line] of producedEntries) {
    const movement = line.movement;
    stockEffects.push(
      positiveEffect(
        movement.item,
        movement.position,
        groupedInventoryMovementAmount(movement),
        movement.metadata
      )
    );
    producedGenealogyLines.push({
      position: movement.position,
      ...(line.genealogyNode === undefined
        ? {}
        : { explicitNode: line.genealogyNode }),
    });
  }
  const traceabilityChanges = createTransformationGenealogy(
    consumedGenealogyLines,
    producedGenealogyLines
  );
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Transformation,
    input,
    stockEffects,
    traceabilityChanges,
    sortedLotDefinitions(lotDefinitions),
    sortedPlacementNodeDefinitions(placementNodeDefinitions)
  );
}

/** Create one explicit destruction/scrap event. */
export function createInventoryScrapEvent(
  input: CreateInventoryScrapInput
): InventoryEventDraft {
  if ((input.reason ?? "").trim().length === 0) {
    throw new Error("Scrapping inventory needs an explicit reason.");
  }
  const item = findCommandItem(
    input.catalog,
    input.from,
    input.amount,
    input.itemRevisionId
  );
  const resolved = resolveInventoryAmount(input.catalog, item, input.amount);
  const from = positionWithAmountPackaging(
    input.from,
    resolved,
    item.revisionId
  );
  return createMovementEvent(input.catalog, InventoryEventKind.Scrap, input, [
    negativeEffect(item, from, resolved),
  ]);
}

/** Create one atomic explicit destruction event from multiple exact source lines. */
export function createInventoryScrapManyEvent(
  input: CreateInventoryScrapManyInput
): InventoryEventDraft {
  if ((input.reason ?? "").trim().length === 0) {
    throw new Error("Scrapping inventory needs an explicit reason.");
  }
  assertNonEmptyMovementLines(input.lines, "scrap");
  const groupedEffects = new Map<string, GroupedInventoryMovementLine>();
  for (const line of input.lines) {
    const item = findCommandItem(
      input.catalog,
      line.from,
      line.amount,
      line.itemRevisionId
    );
    const resolved = resolveInventoryAmount(input.catalog, item, line.amount);
    const from = positionWithAmountPackaging(
      line.from,
      resolved,
      item.revisionId
    );
    const identity = inventoryStockPositionIdentity(from);
    const earlier = groupedEffects.get(identity);
    groupedEffects.set(
      identity,
      earlier === undefined
        ? groupedInventoryMovementLine(item, from, resolved, line.metadata)
        : mergeGroupedInventoryMovementLine(
            earlier,
            resolved,
            line.metadata,
            identity,
            "Scrap"
          )
    );
  }
  const groupedEntries = [...groupedEffects.entries()];
  groupedEntries.sort(compareGroupedInventoryMovementEntry);
  const stockEffects: InventoryStockEffect[] = [];
  for (const [, line] of groupedEntries) {
    stockEffects.push(
      negativeEffect(
        line.item,
        line.position,
        groupedInventoryMovementAmount(line),
        line.metadata
      )
    );
  }
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Scrap,
    input,
    stockEffects
  );
}

/** Create one retained catalogue-publication event without changing physical stock. */
export function createInventoryCatalogPublicationEvent(
  input: CreateInventoryCatalogPublicationInput
): InventoryEventDraft {
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.CatalogPublication,
    input,
    [],
    [],
    [],
    [],
    input.catalog.digest,
    inventoryCatalogSnapshot(input.catalog)
  );
}

/** Create one lot-metadata assertion event without changing physical stock. */
export function createInventoryLotMetadataEvent(
  input: CreateInventoryLotMetadataInput
): InventoryEventDraft {
  input.catalog.activeItem(input.itemId);
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.LotMetadata,
    input,
    [],
    [],
    [{ itemId: input.itemId, lotId: input.lotId, ...input.lot }]
  );
}

/** Create one placement-node metadata assertion without changing stock or topology. */
export function createInventoryPlacementNodeMetadataEvent(
  input: CreateInventoryPlacementNodeMetadataInput
): InventoryEventDraft {
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.PlacementNodeMetadata,
    input,
    [],
    [],
    [],
    [{ nodeId: input.nodeId, ...input.placementNode }]
  );
}

/** Create one direct-parent topology transition without rewriting descendant stock. */
export function createInventoryPlacementEvent(
  input: CreateInventoryPlacementInput
): InventoryEventDraft {
  const definitions: InventoryPlacementNodeDefinition[] = [];
  if (input.node !== undefined) {
    definitions.push({ nodeId: input.nodeId, ...input.node });
  }
  if (input.parent !== undefined) {
    if (input.toParentNodeId === undefined) {
      throw new Error(
        "Placement parent metadata requires a destination parent node."
      );
    }
    definitions.push({ nodeId: input.toParentNodeId, ...input.parent });
  }
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Placement,
    input,
    [],
    [],
    [],
    definitions,
    undefined,
    undefined,
    [
      {
        nodeId: input.nodeId,
        ...(input.fromParentNodeId === undefined
          ? {}
          : { fromParentNodeId: input.fromParentNodeId }),
        ...(input.toParentNodeId === undefined
          ? {}
          : { toParentNodeId: input.toParentNodeId }),
      },
    ]
  );
}

/** Create one relation-only traceability event. */
export function createInventoryTraceabilityEvent(
  input: CreateInventoryTraceabilityInput
): InventoryEventDraft {
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.Traceability,
    input,
    [],
    input.changes
  );
}

/** Stable unresolved-whereabouts tuple; placed stock has no lifecycle tuple. */
function inventoryWhereaboutsLifecycleIdentity(
  position: InventoryStockPositionKey
): string | undefined {
  if (position.whereaboutsId === undefined) return undefined;
  return JSON.stringify([
    position.whereaboutsId,
    position.whereaboutsState ?? null,
    position.lastPlacementNodeId ?? null,
    position.detachedAtEpochMs ?? null,
    position.missingAtEpochMs ?? null,
  ]);
}

/** Kernel-owned unresolved lifecycle identity derived from one explicit physical operation. */
function inventoryWhereaboutsIdForCommand(operationId: string): string {
  return "inventory:whereabouts:" + encodeURIComponent(operationId);
}

/** Require one lifecycle command to name a structurally valid source object. */
function requireInventoryWhereaboutsCommandSource(
  value: InventoryStockPositionInput | undefined,
  label: string
): InventoryStockPositionInput {
  if (value === undefined || value === null || typeof value !== "object") {
    throw new Error(label + " must name an exact source position.");
  }
  return value;
}

/** Build a canonical detached destination from one known-placed source. */
function inventoryDetachedCommandPosition(
  input: CreateInventoryDetachInput
): InventoryStockPositionInput {
  const from = requireInventoryWhereaboutsCommandSource(input.from, "Detach source");
  const placementNodeId = from.placementNodeId;
  if (placementNodeId === undefined) {
    throw new Error("Detach source must currently have a placement.");
  }
  const {
    placementNodeId: _placementNodeId,
    whereaboutsId: _whereaboutsId,
    whereaboutsState: _whereaboutsState,
    lastPlacementNodeId: _lastPlacementNodeId,
    detachedAtEpochMs: _detachedAtEpochMs,
    missingAtEpochMs: _missingAtEpochMs,
    ...rest
  } = from;
  return {
    ...rest,
    whereaboutsId: inventoryWhereaboutsIdForCommand(input.operationId),
    whereaboutsState: InventoryStockWhereaboutsState.Detached,
    lastPlacementNodeId: placementNodeId,
    detachedAtEpochMs: input.occurredAtEpochMs,
  };
}

/** Build a canonical known-placement destination from detached/missing stock. */
function inventoryPlacedCommandPosition(
  input: CreateInventoryPlaceInput
): InventoryStockPositionInput {
  const from = requireInventoryWhereaboutsCommandSource(input.from, "Place source");
  if (from.placementNodeId !== undefined) {
    throw new Error("Place source must currently be detached or missing.");
  }
  if (from.whereaboutsId === undefined || from.whereaboutsState === undefined) {
    throw new Error("Place source has no unresolved whereabouts lifecycle.");
  }
  const into = typeof input.into === "string" ? input.into.trim() : "";
  if (into.length === 0) throw new Error("Place destination must not be empty.");
  const {
    whereaboutsId: _whereaboutsId,
    whereaboutsState: _whereaboutsState,
    lastPlacementNodeId: _lastPlacementNodeId,
    detachedAtEpochMs: _detachedAtEpochMs,
    missingAtEpochMs: _missingAtEpochMs,
    ...rest
  } = from;
  return { ...rest, placementNodeId: into };
}

/** Build a canonical missing destination from known-placed or detached stock. */
function inventoryMissingCommandPosition(
  input: CreateInventoryMarkMissingInput
): InventoryStockPositionInput {
  const from = requireInventoryWhereaboutsCommandSource(
    input.from,
    "Mark-missing source"
  );
  if (from.whereaboutsState === InventoryStockWhereaboutsState.Missing) {
    throw new Error("Stock is already marked missing.");
  }
  if (from.placementNodeId !== undefined) {
    const {
      placementNodeId,
      whereaboutsId: _whereaboutsId,
      whereaboutsState: _whereaboutsState,
      lastPlacementNodeId: _lastPlacementNodeId,
      detachedAtEpochMs: _detachedAtEpochMs,
      missingAtEpochMs: _missingAtEpochMs,
      ...rest
    } = from;
    return {
      ...rest,
      whereaboutsId: inventoryWhereaboutsIdForCommand(input.operationId),
      whereaboutsState: InventoryStockWhereaboutsState.Missing,
      lastPlacementNodeId: placementNodeId,
      detachedAtEpochMs: input.occurredAtEpochMs,
      missingAtEpochMs: input.occurredAtEpochMs,
    };
  }
  if (
    from.whereaboutsId === undefined ||
    from.whereaboutsState !== InventoryStockWhereaboutsState.Detached ||
    from.lastPlacementNodeId === undefined ||
    from.detachedAtEpochMs === undefined
  ) {
    throw new Error(
      "Mark-missing source must be placed or intentionally detached stock."
    );
  }
  return {
    ...from,
    whereaboutsState: InventoryStockWhereaboutsState.Missing,
    missingAtEpochMs: input.occurredAtEpochMs,
  };
}

/** Ordinary reclassification cannot start, resolve, switch, or mutate whereabouts. */
function assertInventoryReclassificationPreservesWhereabouts(
  from: InventoryStockPositionKey,
  to: InventoryStockPositionKey
): void {
  if (
    inventoryWhereaboutsLifecycleIdentity(from) ===
    inventoryWhereaboutsLifecycleIdentity(to)
  ) {
    return;
  }
  throw new Error(
    "Generic reclassification cannot change a whereabouts lifecycle; use stock.detach, stock.markMissing, or stock.place."
  );
}

/** Conserved split/merge reclassification cannot move quantity between whereabouts cohorts. */
function assertInventoryReclassificationManyPreservesWhereabouts(
  sources: readonly InventoryProvenanceLine[],
  destinations: readonly InventoryProvenanceLine[]
): void {
  const sourceTotals = inventoryWhereaboutsMeasurementTotals(sources);
  const destinationTotals = inventoryWhereaboutsMeasurementTotals(destinations, -1n);
  if (sourceTotals.size !== destinationTotals.size) {
    throw new Error(
      "Generic reclassification cannot create or resolve detached/missing whereabouts cohorts."
    );
  }
  for (const [identity, sourceMeasurements] of sourceTotals) {
    const destinationMeasurements = destinationTotals.get(identity);
    if (
      destinationMeasurements === undefined ||
      !inventoryMeasurementTotalsCancel(sourceMeasurements, destinationMeasurements)
    ) {
      throw new Error(
        "Generic reclassification must preserve each detached/missing whereabouts cohort exactly."
      );
    }
  }
}

/** Aggregate unresolved measurements in working precision by item/revision plus exact lifecycle tuple. */
function inventoryWhereaboutsMeasurementTotals(
  lines: readonly InventoryProvenanceLine[],
  sign: 1n | -1n = 1n
): ReadonlyMap<string, InventoryMeasurementTotals> {
  const totals = new Map<string, InventoryMeasurementTotals>();
  for (const line of lines) {
    const lifecycle = inventoryWhereaboutsLifecycleIdentity(line.position);
    if (lifecycle === undefined) continue;
    const key = JSON.stringify([
      line.position.itemId,
      line.position.itemRevisionId,
      lifecycle,
    ]);
    const earlier = totals.get(key);
    if (earlier === undefined) {
      const created: InventoryMeasurementTotals = new Map();
      addInventoryMeasurementTotals(created, line.measurements, sign);
      totals.set(key, created);
    } else {
      addInventoryMeasurementTotals(earlier, line.measurements, sign);
    }
  }
  return totals;
}

/** Transformation outputs may inherit unresolved truth only from consumed stock. */
function assertInventoryTransformationWhereaboutsInheritance(
  consumed: readonly InventoryStockPositionKey[],
  produced: readonly InventoryStockPositionKey[]
): void {
  const consumedLifecycles = new Set<string>();
  for (const position of consumed) {
    const lifecycle = inventoryWhereaboutsLifecycleIdentity(position);
    if (lifecycle !== undefined) consumedLifecycles.add(lifecycle);
  }
  for (const position of produced) {
    const lifecycle = inventoryWhereaboutsLifecycleIdentity(position);
    if (lifecycle !== undefined && !consumedLifecycles.has(lifecycle)) {
      throw new Error(
        "Transformation output cannot invent or switch a detached/missing whereabouts lifecycle."
      );
    }
  }
}

/** One resolved line used only to identify exact one-to-one conserved reclassifications. */
interface InventoryProvenanceLine {
  /** Exact stock position on one side of the reclassification. */
  readonly position: InventoryStockPositionKey;
  /** Exact measurements moved through this line. */
  readonly measurements: InventoryMeasurementVector;
}

/** Attach conserved FIFO provenance evidence and revalidate the complete immutable event. */
function withPositiveLayerProvenanceTransfers(
  catalog: InventoryCatalog,
  event: InventoryEventDraft,
  transfers: readonly InventoryPositiveLayerProvenanceTransfer[]
): InventoryEventDraft {
  if (transfers.length === 0) return event;
  return defineInventoryEvent({
    catalog,
    event: {
      ...event,
      positiveLayerProvenanceTransfers: transfers,
    },
  });
}

/**
 * Preserve FIFO age only when the batch itself proves one source maps to one destination.
 * Multi-line split/merge arrays do not declare pair identities, so inferring by array order
 * would be a semantic guess; they create new layers unless a future API names lineage.
 */
function pairwiseReclassificationProvenanceTransfers(
  sources: readonly InventoryProvenanceLine[],
  destinations: readonly InventoryProvenanceLine[]
): readonly InventoryPositiveLayerProvenanceTransfer[] {
  if (sources.length !== 1 || destinations.length !== 1) return [];
  const source = sources[0];
  const destination = destinations[0];
  if (source === undefined || destination === undefined) return [];
  if (
    source.position.itemId !== destination.position.itemId ||
    source.position.itemRevisionId !== destination.position.itemRevisionId ||
    !inventoryMeasurementsEqual(source.measurements, destination.measurements)
  ) {
    return [];
  }
  return [{ from: source.position, to: destination.position }];
}

/** Create and validate one event draft with deterministic event identity. */
function createMovementEvent(
  catalog: InventoryCatalog,
  kind: InventoryEventKind,
  header: InventoryCommandHeader,
  stockEffects: readonly InventoryStockEffect[],
  traceabilityChanges: readonly InventoryTraceabilityRelationChange[] = [],
  lotDefinitions: readonly InventoryLotDefinition[] = [],
  placementNodeDefinitions: readonly InventoryPlacementNodeDefinition[] = [],
  catalogDigest?: string,
  catalogSnapshot?: InventoryCatalogSnapshot,
  placementChanges: readonly InventoryPlacementChange[] = []
): InventoryEventDraft {
  return defineInventoryEvent({
    catalog,
    event: movementEventDraft(
      kind,
      header,
      stockEffects,
      traceabilityChanges,
      lotDefinitions,
      placementNodeDefinitions,
      catalogDigest,
      catalogSnapshot,
      placementChanges
    ),
  });
}

/** Build the event's exact unvalidated fields for one final normalized validation. */
function movementEventDraft(
  kind: InventoryEventKind,
  header: InventoryCommandHeader,
  stockEffects: readonly InventoryStockEffect[],
  traceabilityChanges: readonly InventoryTraceabilityRelationChange[] = [],
  lotDefinitions: readonly InventoryLotDefinition[] = [],
  placementNodeDefinitions: readonly InventoryPlacementNodeDefinition[] = [],
  catalogDigest?: string,
  catalogSnapshot?: InventoryCatalogSnapshot,
  placementChanges: readonly InventoryPlacementChange[] = []
): InventoryEventDraft {
  if (kind === InventoryEventKind.Transfer && header.metadata?.[inventoryReportedTransferReplayMetadataKey] !== undefined) {
    throw new Error(`Inventory metadata key '${inventoryReportedTransferReplayMetadataKey}' is reserved for transfer replay.`);
  }
  return {
    eventId: inventoryEventIdForOperation(header.operationId),
    operationId: header.operationId,
    kind,
    occurredAtEpochMs: header.occurredAtEpochMs,
    stockEffects,
    lotDefinitions,
    placementNodeDefinitions,
    placementChanges,
    traceabilityChanges,
    ...(catalogDigest === undefined ? {} : { catalogDigest }),
    ...(catalogSnapshot === undefined ? {} : { catalogSnapshot }),
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
  };
}

/** Reject malformed or empty batch commands so one operation identity always means a real physical fact. */
function assertNonEmptyMovementLines(
  lines: readonly object[],
  label: string
): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error(`Inventory ${label} needs at least one physical line.`);
  }
}

/** Add one optional lot assertion while allowing identical same-lot receipt lines. */
function collectLotDefinition(
  definitions: Map<string, InventoryLotDefinition>,
  position: InventoryStockPositionKey,
  lot: InventoryLotMetadataInput | undefined
): void {
  const candidates = lotDefinitionsForPosition(position, lot);
  const definition = candidates[0];
  if (definition === undefined) return;
  const identity = inventoryLotIdentity(definition.itemId, definition.lotId);
  const existing = definitions.get(identity);
  if (
    existing !== undefined &&
    inventoryLotDefinitionCommandFingerprint(existing) !==
      inventoryLotDefinitionCommandFingerprint(definition)
  ) {
    throw new Error(`Event lines disagree about lot metadata for ${identity}.`);
  }
  definitions.set(identity, definition);
}

/** Return lot assertions in deterministic item-scoped identity order. */
function sortedLotDefinitions(
  definitions: ReadonlyMap<string, InventoryLotDefinition>
): readonly InventoryLotDefinition[] {
  const entries = [...definitions.entries()];
  entries.sort(compareLotDefinitionEntry);
  const result: InventoryLotDefinition[] = [];
  for (const entry of entries) result.push(entry[1]);
  return result;
}

/** Stable same-event lot metadata comparison including key-sorted JSON-safe metadata. */
function inventoryLotDefinitionCommandFingerprint(
  definition: InventoryLotDefinition
): string {
  return JSON.stringify([
    definition.itemId,
    definition.lotId,
    definition.manufacturedAtEpochMs ?? null,
    definition.expiresAtEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Sort item-scoped lot-definition map entries by their collision-free identity key. */
function compareLotDefinitionEntry(
  left: readonly [string, InventoryLotDefinition],
  right: readonly [string, InventoryLotDefinition]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Build one typed lot assertion from a lot-qualified stock position. */
function lotDefinitionsForPosition(
  position: InventoryStockPositionKey,
  lot: InventoryLotMetadataInput | undefined
): readonly InventoryLotDefinition[] {
  if (lot === undefined) return [];
  if (position.lotId === undefined) {
    throw new Error(
      "Inventory lot metadata requires the stock position to name lotId."
    );
  }
  return [{ itemId: position.itemId, lotId: position.lotId, ...lot }];
}

/** Add one optional placementNode assertion while allowing identical same-placementNode lines. */
function collectPlacementNodeDefinition(
  definitions: Map<string, InventoryPlacementNodeDefinition>,
  position: InventoryStockPositionKey,
  placementNode: InventoryPlacementNodeMetadataInput | undefined
): void {
  const candidates = placementNodeDefinitionsForPosition(position, placementNode);
  const definition = candidates[0];
  if (definition === undefined) return;
  const identity = inventoryPlacementNodeIdentity(definition.nodeId);
  const existing = definitions.get(identity);
  if (
    existing !== undefined &&
    inventoryPlacementNodeDefinitionCommandFingerprint(existing) !==
      inventoryPlacementNodeDefinitionCommandFingerprint(definition)
  ) {
    throw new Error(
      `Event lines disagree about placementNode metadata for ${identity}.`
    );
  }
  definitions.set(identity, definition);
}

/** Return placementNode assertions in deterministic exact identity order. */
function sortedPlacementNodeDefinitions(
  definitions: ReadonlyMap<string, InventoryPlacementNodeDefinition>
): readonly InventoryPlacementNodeDefinition[] {
  const entries = [...definitions.entries()];
  entries.sort(comparePlacementNodeDefinitionEntry);
  const result: InventoryPlacementNodeDefinition[] = [];
  for (const entry of entries) result.push(entry[1]);
  return result;
}

/** Stable same-event placementNode metadata comparison. */
function inventoryPlacementNodeDefinitionCommandFingerprint(
  definition: InventoryPlacementNodeDefinition
): string {
  return JSON.stringify([
    definition.nodeId,
    definition.category ?? null,
    definition.acceptsPlacement ?? null,
    definition.embodiedBy?.itemId ?? null,
    definition.embodiedBy?.serialId ?? null,
    inventoryMetadataFingerprint(definition.identifiers),
    definition.openedAtEpochMs ?? null,
    definition.useByEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Sort exact placementNode-definition map entries by identity key. */
function comparePlacementNodeDefinitionEntry(
  left: readonly [string, InventoryPlacementNodeDefinition],
  right: readonly [string, InventoryPlacementNodeDefinition]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Build one typed placementNode assertion from a placementNode-qualified stock position. */
function placementNodeDefinitionsForPosition(
  position: InventoryStockPositionKey,
  placementNode: InventoryPlacementNodeMetadataInput | undefined
): readonly InventoryPlacementNodeDefinition[] {
  if (placementNode === undefined) return [];
  if (position.placementNodeId === undefined) {
    throw new Error("Placement-node metadata requires a placed stock position.");
  }
  return [{ nodeId: position.placementNodeId, ...placementNode }];
}

/** Stable event id derived from one operation id without exposing event-id bookkeeping to callers. */
export function inventoryEventIdForOperation(operationId: string): string {
  if (typeof operationId !== "string" || operationId.trim().length === 0)
    throw new Error("operationId must not be empty.");
  return `inventory:event:${encodeURIComponent(operationId)}`;
}

/** Resolve the exact item revision selected by package, explicit revision, or active catalogue. */
function findCommandItem(
  catalog: InventoryCatalog,
  position: InventoryStockPositionInput,
  amount: InventoryAmount,
  explicitItemRevisionId: string | undefined
): InventoryItemDefinitionRevision {
  assertInventoryAmountKind(amount);
  if (amount.kind === InventoryAmountKind.Package) {
    const packaging = catalog.packagingRevision(amount.packagingRevisionId);
    if (packaging.itemId !== position.itemId) {
      throw new Error(
        "Package amount belongs to a different item than the stock position."
      );
    }
    if (
      explicitItemRevisionId !== undefined &&
      explicitItemRevisionId !== packaging.itemRevisionId
    ) {
      throw new Error(
        "Explicit item revision differs from exact package revision."
      );
    }
    return catalog.itemRevision(packaging.itemRevisionId);
  }
  const item =
    explicitItemRevisionId === undefined
      ? catalog.activeItem(position.itemId)
      : catalog.itemRevision(explicitItemRevisionId);
  if (item.itemId !== position.itemId) {
    throw new Error("Selected item revision belongs to a different item.");
  }
  return item;
}

/** Reject kernel-owned transfer partitions from every ordinary public stock command. */
function assertCommandPositionIsNotTransferBound(
  position: InventoryStockPositionInput
): void {
  // Untyped JavaScript callers may supply transferId even though the typed input omits it.
  const transferId = (position as InventoryStockPositionKey).transferId;
  if (transferId !== undefined) {
    throw new Error(
      "Transfer-bound stock can only move through the first-class transfer lifecycle API."
    );
  }
}

/** Add/verify exact package identity on a position based on the public amount kind. */
function positionWithAmountPackaging(
  rawPosition: InventoryStockPositionInput,
  amount: ResolvedInventoryAmount,
  itemRevisionId: string
): InventoryStockPositionKey {
  assertCommandPositionIsNotTransferBound(rawPosition);
  if (amount.packaging === undefined) {
    if (rawPosition.packagingRevisionId !== undefined) {
      throw new Error(
        "Movement from intact packaged stock must use packageAmount with that exact revision."
      );
    }
    return normalizeInventoryStockPositionKey({
      ...rawPosition,
      itemRevisionId,
    });
  }
  if (
    rawPosition.packagingRevisionId !== undefined &&
    rawPosition.packagingRevisionId !== amount.packaging.revisionId
  ) {
    throw new Error(
      "Stock position packaging revision differs from package amount."
    );
  }
  return normalizeInventoryStockPositionKey({
    ...rawPosition,
    itemRevisionId,
    packagingRevisionId: amount.packaging.revisionId,
  });
}

/** Create one positive stock effect with package/source evidence preserved. */
function positiveEffect(
  item: InventoryItemDefinitionRevision,
  position: InventoryStockPositionKey,
  amount: ResolvedInventoryAmount,
  metadata?: InventoryMetadata
): InventoryStockEffect {
  return {
    itemRevisionId: item.revisionId,
    position,
    measurementsDelta: amount.measurements,
    evidence: createAmountEvidence(amount),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Create one negative stock effect with package/source evidence preserved. */
function negativeEffect(
  item: InventoryItemDefinitionRevision,
  position: InventoryStockPositionKey,
  amount: ResolvedInventoryAmount,
  metadata?: InventoryMetadata
): InventoryStockEffect {
  return {
    itemRevisionId: item.revisionId,
    position,
    measurementsDelta: negateInventoryMeasurements(amount.measurements),
    evidence: createAmountEvidence(amount),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Keep enough evidence to explain exact package conversion without making evidence authoritative. */
function createAmountEvidence(
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

/** Normalized transformation line used only to tie genealogy to the stock identity on that line. */
interface InventoryTransformationGenealogyLine {
  /** Exact revision-qualified stock position consumed or produced. */
  readonly position: InventoryStockPositionKey;
  /** Optional caller mapping, accepted only when it matches a position identity or no such identity exists. */
  readonly explicitNode?: InventoryTraceabilityNodeRef;
}

/** Build complete lineage edges from exact serial/placementNode/lot identities or checked external mappings. */
function createTransformationGenealogy(
  consume: readonly InventoryTransformationGenealogyLine[],
  produce: readonly InventoryTransformationGenealogyLine[]
): readonly InventoryTraceabilityRelationChange[] {
  const consumedNodes = consume.map(findTransformationGenealogyNodeForLine);
  const producedNodes = produce.map(findTransformationGenealogyNodeForLine);
  let namedNodes = 0;
  for (const node of consumedNodes) namedNodes += node === undefined ? 0 : 1;
  for (const node of producedNodes) namedNodes += node === undefined ? 0 : 1;
  if (namedNodes === 0) return [];
  if (namedNodes !== consume.length + produce.length) {
    throw new Error(
      "Transformation lineage must name nodes on every input and output, or none."
    );
  }
  // Several stock positions may describe one physical lot/node. Form the product of identity sets, not line slots.
  const uniqueConsumedNodes = uniqueTransformationGenealogyNodes(consumedNodes);
  const uniqueProducedNodes = uniqueTransformationGenealogyNodes(producedNodes);
  const changes: InventoryTraceabilityRelationChange[] = [];
  for (const inputNode of uniqueConsumedNodes) {
    for (const outputNode of uniqueProducedNodes) {
      if (inputNode === undefined || outputNode === undefined) {
        throw new Error("Complete transformation lineage lost one node.");
      }
      changes.push({
        action: InventoryTraceabilityRelationAction.Add,
        kind: InventoryTraceabilityRelationKind.Genealogy,
        from: inputNode,
        to: outputNode,
      });
    }
  }
  return changes;
}

/** Deduplicate exact genealogy identities while retaining the first equivalent node and rejecting missing lineage. */
function uniqueTransformationGenealogyNodes(
  nodes: readonly (InventoryTraceabilityNodeRef | undefined)[]
): readonly InventoryTraceabilityNodeRef[] {
  const unique = new Map<string, InventoryTraceabilityNodeRef>();
  for (const node of nodes) {
    if (node === undefined) throw new Error("Complete transformation lineage lost one node.");
    const identity = inventoryTraceabilityNodeIdentity(node);
    if (!unique.has(identity)) unique.set(identity, node);
  }
  return [...unique.values()];
}

/** Derive one unambiguous stock node or check that a caller mapping names a real line identity. */
function findTransformationGenealogyNodeForLine(
  line: InventoryTransformationGenealogyLine
): InventoryTraceabilityNodeRef | undefined {
  const candidates: InventoryTraceabilityNodeRef[] = [];
  if (line.position.serialId !== undefined) {
    candidates.push({
      kind: InventoryTraceabilityNodeKind.Serial,
      id: line.position.serialId,
    });
  }
  if (line.position.lotId !== undefined) {
    candidates.push({
      kind: InventoryTraceabilityNodeKind.Lot,
      id: line.position.lotId,
      itemId: line.position.itemId,
    });
  }
  const explicitNode = line.explicitNode;
  if (explicitNode !== undefined) {
    if (explicitNode.kind === InventoryTraceabilityNodeKind.PlacementNode) {
      if (explicitNode.id !== line.position.placementNodeId) {
        throw new Error(
          "Transformation placement-node genealogy must name the stock line's direct placement node."
        );
      }
      return explicitNode;
    }
    if (candidates.length === 0) return explicitNode;
    const explicitIdentity = inventoryTraceabilityNodeIdentity(explicitNode);
    for (const candidate of candidates) {
      if (inventoryTraceabilityNodeIdentity(candidate) === explicitIdentity) {
        return explicitNode;
      }
    }
    throw new Error(
      "Transformation genealogy node does not match the serial or lot on its stock line."
    );
  }
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new Error(
      "Transformation line has several stock identities; name which serial or lot is the genealogy node."
    );
  }
  return candidates[0];
}

/** Return one position without package identity after an explicit unpack operation. */
function removePackagingRevision(
  position: InventoryStockPositionKey
): InventoryStockPositionKey {
  const {
    packagingRevisionId: removedPackagingRevisionId,
    ...withoutPackaging
  } = position;
  if (removedPackagingRevisionId === undefined) {
    throw new Error("Cannot remove missing packaging revision.");
  }
  return normalizeInventoryStockPositionKey(withoutPackaging);
}
