import { assertInventoryAmountKind } from "./stock-amount-rules.js";
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
  InventoryEventKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  defineInventoryEvent,
  type InventoryEventDraft,
  type InventoryMeasurementEvidence,
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
  InventoryTraceabilityNodeKind,
  inventoryContainerIdentity,
  inventoryLotIdentity,
  inventoryStockPositionIdentity,
  inventoryTraceabilityNodeIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryContainerDefinition,
  type InventoryLotDefinition,
  type InventoryMetadata,
  type InventoryStockPositionInput,
  type InventoryStockPositionKey,
  type InventoryTraceabilityNodeRef,
  type PartyId,
} from "./model.js";

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

/** Optional identifying/lifecycle metadata asserted for one exact handling unit. */
export interface InventoryContainerMetadataInput {
  /** Plain application-defined kind such as vial, syringe, carton, tray, or pallet. */
  readonly containerType?: string;
  /** GTIN/SSCC/barcode/vendor identifiers resolving this exact container. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Time this exact container was physically opened/prepared when known. */
  readonly openedAtEpochMs?: number;
  /** Container-specific use-by time. */
  readonly useByEpochMs?: number;
  /** Extra JSON-safe metadata that does not change container identity. */
  readonly metadata?: InventoryMetadata;
}

/** Inputs for adopting stock that existed before InventoryOnce became authoritative. */
export interface CreateInventoryOpeningInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve exact item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact opening position; package identity is added from package amount. */
  readonly to: InventoryStockPositionInput;
  /** Exact direct measurements or whole package count already present. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`; requires the destination to name a lot. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.containerId`; requires the destination to name a container. */
  readonly container?: InventoryContainerMetadataInput;
}

/** Inputs for receiving stock from outside this inventory world. */
export interface CreateInventoryReceiptInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact destination position; package identity is added from package amount. */
  readonly to: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count received. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to the active revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`; requires the destination to name a lot. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.containerId`; requires the destination to name a container. */
  readonly container?: InventoryContainerMetadataInput;
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

/** Inputs for moving unchanged stock between locations. */
export interface CreateInventoryTransferInput extends InventoryCommandHeader {
  /** Frozen catalogue used to resolve active item/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact source position; every non-location dimension is preserved automatically. */
  readonly from: InventoryStockPositionInput;
  /** Destination location only—other dimensions cannot be silently changed. */
  readonly toLocationId: string;
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
  /** Optional metadata for `to.containerId` when this change introduces/confirms a container. */
  readonly container?: InventoryContainerMetadataInput;
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
  /** Optional metadata for `to.containerId`. */
  readonly container?: InventoryContainerMetadataInput;
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

/** One destination line in an atomic multi-item receipt. */
export interface InventoryReceiptLine {
  /** Exact destination position before package identity is resolved from amount. */
  readonly to: InventoryStockPositionInput;
  /** Direct measurements or exact whole package count received. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional metadata for `to.lotId`. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `to.containerId`. */
  readonly container?: InventoryContainerMetadataInput;
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
  /** Exact source position; every non-location dimension is preserved. */
  readonly from: InventoryStockPositionInput;
  /** Destination location for this exact line. */
  readonly toLocationId: string;
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
  /** Optional exact destination container for the unpacked/loose contents. */
  readonly toContainerId?: string;
  /** Optional metadata for `toContainerId`. */
  readonly container?: InventoryContainerMetadataInput;
}

/** One input/output line of an explicit inventory transformation. */
export interface InventoryTransformationLine {
  /** Exact source/output position. */
  readonly position: InventoryStockPositionInput;
  /** Exact measurements or whole package count consumed/produced. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional serial/container/lot/external identity used for genealogy. */
  readonly traceabilityNode?: InventoryTraceabilityNodeRef;
  /** Optional metadata for `position.lotId`, normally used on produced outputs. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `position.containerId`, normally used on produced outputs. */
  readonly container?: InventoryContainerMetadataInput;
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

/** Inputs for asserting handling-unit metadata without changing physical quantity. */
export interface CreateInventoryContainerMetadataInput
  extends InventoryCommandHeader {
  /** Frozen catalogue retained for the common event-validation boundary. */
  readonly catalog: InventoryCatalog;
  /** Stable exact handling-unit identity. */
  readonly containerId: string;
  /** Current metadata/use-by assertion for this container. */
  readonly container: InventoryContainerMetadataInput;
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

/** Create a validated opening event for pre-existing stock adoption/import. */
export function createInventoryOpeningEvent(
  input: CreateInventoryOpeningInput
): InventoryEventDraft {
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
    containerDefinitionsForPosition(to, input.container)
  );
}

/** Create a validated receipt event from one declarative command. */
export function createInventoryReceiptEvent(
  input: CreateInventoryReceiptInput
): InventoryEventDraft {
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
    containerDefinitionsForPosition(to, input.container)
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

/** Create a location-only transfer event that copies every other stock dimension automatically. */
export function createInventoryTransferEvent(
  input: CreateInventoryTransferInput
): InventoryEventDraft {
  const toLocationId = input.toLocationId.trim();
  if (toLocationId.length === 0)
    throw new Error("toLocationId must not be empty.");
  if (input.from.locationId === toLocationId) {
    throw new Error(
      "Inventory transfer source/destination locations must differ."
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
    locationId: toLocationId,
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

/** One exact destination accumulated from duplicate receipt command lines. */
interface GroupedInventoryReceiptLine {
  /** Frozen item definition governing the exact destination. */
  readonly item: InventoryItemDefinitionRevision;
  /** Revision-qualified destination after package identity is resolved. */
  readonly position: InventoryStockPositionKey;
  /** Sum of every receipt line targeting this exact position. */
  readonly measurements: InventoryMeasurementVector;
  /** Exact intact-package revision retained by this destination. */
  readonly packaging?: InventoryPackagingDefinitionRevision;
  /** Whole package count represented by the summed lines. */
  readonly packageCount?: number;
  /** Identical application metadata retained for the one combined effect. */
  readonly metadata?: InventoryMetadata;
}

/** Create one atomic receipt event from multiple exact destination lines. */
export function createInventoryReceiptManyEvent(
  input: CreateInventoryReceiptManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "receipt");
  // Duplicate exact destinations are one physical effect, not an application-side stock engine.
  const groupedEffects = new Map<string, GroupedInventoryReceiptLine>();
  /** Lot masters deduplicated across lines such as the same lot received into two locations. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Container masters deduplicated across lines such as several items received in one carton. */
  const containerDefinitions = new Map<string, InventoryContainerDefinition>();
  for (const line of input.lines) {
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
    collectContainerDefinition(containerDefinitions, position, line.container);
    const identity = inventoryStockPositionIdentity(position);
    const earlier = groupedEffects.get(identity);
    if (earlier === undefined) {
      groupedEffects.set(identity, {
        item,
        position,
        measurements: resolved.measurements,
        ...(resolved.packaging === undefined
          ? {}
          : { packaging: resolved.packaging }),
        ...(resolved.packageCount === undefined
          ? {}
          : { packageCount: resolved.packageCount }),
        ...(line.metadata === undefined ? {} : { metadata: line.metadata }),
      });
      continue;
    }
    if (
      inventoryMetadataFingerprint(earlier.metadata) !==
      inventoryMetadataFingerprint(line.metadata)
    ) {
      throw new Error(
        `Receipt lines for exact position ${identity} have conflicting effect metadata.`
      );
    }
    groupedEffects.set(identity, {
      ...earlier,
      measurements: addInventoryMeasurements(
        earlier.measurements,
        resolved.measurements
      ),
      ...mergeReceiptPackageCount(earlier, resolved, identity),
    });
  }
  const groupedEntries = [...groupedEffects.entries()];
  groupedEntries.sort(compareGroupedInventoryReceiptEntry);
  const stockEffects: InventoryStockEffect[] = [];
  for (const [, line] of groupedEntries) {
    stockEffects.push(
      positiveEffect(
        line.item,
        line.position,
        {
          measurements: line.measurements,
          ...(line.packaging === undefined
            ? {}
            : { packaging: line.packaging }),
          ...(line.packageCount === undefined
            ? {}
            : { packageCount: line.packageCount }),
        },
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
    sortedContainerDefinitions(containerDefinitions)
  );
}

/** Preserve package identity/count while combining duplicate receipt destinations. */
function mergeReceiptPackageCount(
  earlier: GroupedInventoryReceiptLine,
  resolved: ResolvedInventoryAmount,
  positionIdentity: string
): Pick<GroupedInventoryReceiptLine, "packaging" | "packageCount"> {
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
      `Receipt lines for exact position ${positionIdentity} disagree about package identity.`
    );
  }
  const packageCount = earlier.packageCount + resolved.packageCount;
  if (!Number.isSafeInteger(packageCount) || packageCount <= 0) {
    throw new Error(
      `Receipt package count overflowed at exact position ${positionIdentity}.`
    );
  }
  return { packaging, packageCount };
}

/** Sort grouped receipt effects by collision-free exact position identity. */
function compareGroupedInventoryReceiptEntry(
  left: readonly [string, GroupedInventoryReceiptLine],
  right: readonly [string, GroupedInventoryReceiptLine]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Create one atomic issue event from multiple exact source lines. */
export function createInventoryIssueManyEvent(
  input: CreateInventoryIssueManyInput
): InventoryEventDraft {
  assertNonEmptyMovementLines(input.lines, "issue");
  const stockEffects: InventoryStockEffect[] = [];
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
    stockEffects.push(negativeEffect(item, from, resolved, line.metadata));
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
  const stockEffects: InventoryStockEffect[] = [];
  const provenanceTransfers: InventoryPositiveLayerProvenanceTransfer[] = [];
  for (const line of input.lines) {
    const toLocationId = line.toLocationId.trim();
    if (toLocationId.length === 0) {
      throw new Error("Transfer line toLocationId must not be empty.");
    }
    if (line.from.locationId === toLocationId) {
      throw new Error(
        "Transfer line source/destination locations must differ."
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
      locationId: toLocationId,
    });
    stockEffects.push(negativeEffect(item, from, resolved, line.metadata));
    stockEffects.push(positiveEffect(item, to, resolved, line.metadata));
    provenanceTransfers.push({ from, to });
  }
  return withPositiveLayerProvenanceTransfers(
    input.catalog,
    createMovementEvent(
      input.catalog,
      InventoryEventKind.Transfer,
      input,
      stockEffects
    ),
    provenanceTransfers
  );
}

/** Create an explicit dimension-only reclassification event. */
export function createInventoryReclassificationEvent(
  input: CreateInventoryReclassificationInput
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
      containerDefinitionsForPosition(to, input.container)
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
  const stockEffects: InventoryStockEffect[] = [];
  const provenanceSources: InventoryProvenanceLine[] = [];
  const provenanceDestinations: InventoryProvenanceLine[] = [];
  /** Lot masters asserted by destination lines and deduplicated for this event. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Container masters asserted by destination lines and deduplicated for this event. */
  const containerDefinitions = new Map<string, InventoryContainerDefinition>();
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
    stockEffects.push(negativeEffect(item, from, resolved, line.metadata));
    provenanceSources.push({
      position: from,
      measurements: resolved.measurements,
    });
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
    stockEffects.push(positiveEffect(item, to, resolved, line.metadata));
    provenanceDestinations.push({
      position: to,
      measurements: resolved.measurements,
    });
    collectLotDefinition(lotDefinitions, to, line.lot);
    collectContainerDefinition(containerDefinitions, to, line.container);
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
      sortedContainerDefinitions(containerDefinitions)
    ),
    pairwiseReclassificationProvenanceTransfers(
      provenanceSources,
      provenanceDestinations
    )
  );
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
    input.toContainerId === undefined
      ? loose
      : normalizeInventoryStockPositionKey({
          ...loose,
          containerId: input.toContainerId,
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
      containerDefinitionsForPosition(to, input.container)
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
  const stockEffects: InventoryStockEffect[] = [];
  /** Lot masters asserted by consumed/produced lines and deduplicated for this event. */
  const lotDefinitions = new Map<string, InventoryLotDefinition>();
  /** Container masters asserted by consumed/produced lines and deduplicated for this event. */
  const containerDefinitions = new Map<string, InventoryContainerDefinition>();
  const consumedGenealogyLines: InventoryTransformationGenealogyLine[] = [];
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
    stockEffects.push(negativeEffect(item, position, resolved, line.metadata));
    collectLotDefinition(lotDefinitions, position, line.lot);
    collectContainerDefinition(containerDefinitions, position, line.container);
    consumedGenealogyLines.push({
      position,
      ...(line.traceabilityNode === undefined
        ? {}
        : { explicitNode: line.traceabilityNode }),
    });
  }
  const producedGenealogyLines: InventoryTransformationGenealogyLine[] = [];
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
    stockEffects.push(positiveEffect(item, position, resolved, line.metadata));
    collectLotDefinition(lotDefinitions, position, line.lot);
    collectContainerDefinition(containerDefinitions, position, line.container);
    producedGenealogyLines.push({
      position,
      ...(line.traceabilityNode === undefined
        ? {}
        : { explicitNode: line.traceabilityNode }),
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
    sortedContainerDefinitions(containerDefinitions)
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
  const stockEffects: InventoryStockEffect[] = [];
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
    stockEffects.push(negativeEffect(item, from, resolved, line.metadata));
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

/** Create one handling-unit metadata assertion event without changing physical stock. */
export function createInventoryContainerMetadataEvent(
  input: CreateInventoryContainerMetadataInput
): InventoryEventDraft {
  return createMovementEvent(
    input.catalog,
    InventoryEventKind.ContainerMetadata,
    input,
    [],
    [],
    [],
    [{ containerId: input.containerId, ...input.container }]
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
  containerDefinitions: readonly InventoryContainerDefinition[] = [],
  catalogDigest?: string,
  catalogSnapshot?: InventoryCatalogSnapshot
): InventoryEventDraft {
  return defineInventoryEvent({
    catalog,
    event: {
      eventId: inventoryEventIdForOperation(header.operationId),
      operationId: header.operationId,
      kind,
      occurredAtEpochMs: header.occurredAtEpochMs,
      stockEffects,
      lotDefinitions,
      containerDefinitions,
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
    },
  });
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

/** Add one optional container assertion while allowing identical same-container lines. */
function collectContainerDefinition(
  definitions: Map<string, InventoryContainerDefinition>,
  position: InventoryStockPositionKey,
  container: InventoryContainerMetadataInput | undefined
): void {
  const candidates = containerDefinitionsForPosition(position, container);
  const definition = candidates[0];
  if (definition === undefined) return;
  const identity = inventoryContainerIdentity(definition.containerId);
  const existing = definitions.get(identity);
  if (
    existing !== undefined &&
    inventoryContainerDefinitionCommandFingerprint(existing) !==
      inventoryContainerDefinitionCommandFingerprint(definition)
  ) {
    throw new Error(
      `Event lines disagree about container metadata for ${identity}.`
    );
  }
  definitions.set(identity, definition);
}

/** Return container assertions in deterministic exact identity order. */
function sortedContainerDefinitions(
  definitions: ReadonlyMap<string, InventoryContainerDefinition>
): readonly InventoryContainerDefinition[] {
  const entries = [...definitions.entries()];
  entries.sort(compareContainerDefinitionEntry);
  const result: InventoryContainerDefinition[] = [];
  for (const entry of entries) result.push(entry[1]);
  return result;
}

/** Stable same-event container metadata comparison. */
function inventoryContainerDefinitionCommandFingerprint(
  definition: InventoryContainerDefinition
): string {
  return JSON.stringify([
    definition.containerId,
    definition.containerType ?? null,
    inventoryMetadataFingerprint(definition.identifiers),
    definition.openedAtEpochMs ?? null,
    definition.useByEpochMs ?? null,
    inventoryMetadataFingerprint(definition.metadata),
  ]);
}

/** Sort exact container-definition map entries by identity key. */
function compareContainerDefinitionEntry(
  left: readonly [string, InventoryContainerDefinition],
  right: readonly [string, InventoryContainerDefinition]
): number {
  return compareInventoryIdentityText(left[0], right[0]);
}

/** Build one typed container assertion from a container-qualified stock position. */
function containerDefinitionsForPosition(
  position: InventoryStockPositionKey,
  container: InventoryContainerMetadataInput | undefined
): readonly InventoryContainerDefinition[] {
  if (container === undefined) return [];
  if (position.containerId === undefined) {
    throw new Error(
      "Inventory container metadata requires the stock position to name containerId."
    );
  }
  return [{ containerId: position.containerId, ...container }];
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

/** Build complete lineage edges from exact serial/container/lot identities or checked external mappings. */
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
  // Several stock locations may describe one physical lot/container node. Form the product of identity sets, not line slots.
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
  if (line.position.containerId !== undefined) {
    candidates.push({
      kind: InventoryTraceabilityNodeKind.Container,
      id: line.position.containerId,
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
    if (candidates.length === 0) return explicitNode;
    const explicitIdentity = inventoryTraceabilityNodeIdentity(explicitNode);
    for (const candidate of candidates) {
      if (inventoryTraceabilityNodeIdentity(candidate) === explicitIdentity) {
        return explicitNode;
      }
    }
    throw new Error(
      "Transformation genealogy node does not match the serial, container, or lot on its stock line."
    );
  }
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    throw new Error(
      "Transformation line has several stock identities; name which serial, container, or lot is the genealogy node."
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
