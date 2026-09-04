import { compareInventoryIdentityText } from "./ordering.js";
import type {
  InventoryCatalog,
  InventoryItemDefinitionRevision,
  InventoryPackagingDefinitionRevision,
} from "./catalog.js";
import {
  inventoryPositionDeficitMeasurements,
  inventoryPositionIsDeficit,
} from "./deficits.js";
import type { InventoryCommittedEvent } from "./events.js";
import {
  addInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import { zeroInventoryMeasurementsForItem } from "./measurement-schema.js";
import type {
  InventoryStockPosition,
  ItemId,
  ItemRevisionId,
} from "./model.js";
import {
  findInventoryPositions,
  type InventoryProjectionState,
} from "./projection.js";
import {
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";

/** One exact aggregation bucket for an optional stock-position identity. */
export interface InventoryStockDimensionBucket {
  /** Dimension value, or omission for positions where that optional identity is absent. */
  readonly valueId?: string;
  /** Exact summed primary plus independent measurements in one item revision. */
  readonly measurements: InventoryMeasurementVector;
  /** Number of exact stock positions contributing to this bucket. */
  readonly positionCount: number;
}

/** One qualified-dimension aggregation retaining the application-defined dimension identity. */
export interface InventoryQualifiedDimensionSummary {
  /** Item-defined qualified dimension being summarized. */
  readonly dimensionId: string;
  /** Exact value/absence buckets for this dimension. */
  readonly buckets: readonly InventoryStockDimensionBucket[];
}

/** Revision-safe physical stock summary; quantities from different item revisions never collapse silently. */
export interface InventoryStockRevisionSummary {
  /** Stable inventory item identity. */
  readonly itemId: ItemId;
  /** Exact item definition revision shared by every quantity in this summary. */
  readonly itemRevisionId: ItemRevisionId;
  /** Signed net truth: positive physical stock minus recorded deficit. */
  readonly total: InventoryMeasurementVector;
  /** Positive physical stock only; recorded deficits never contribute here. */
  readonly physicalOnHand: InventoryMeasurementVector;
  /** Positive magnitude of every recorded deficit in this summary. */
  readonly deficit: InventoryMeasurementVector;
  /** Exact current positions contributing to this summary. */
  readonly positions: readonly InventoryStockPosition[];
  /** Signed net totals grouped by location; recorded deficit rows reduce these buckets. */
  readonly byLocation: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by lot identity, including deficit/no-lot buckets when present. */
  readonly byLot: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by exact package revision, including loose/deficit stock. */
  readonly byPackagingRevision: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by container/handling-unit identity. */
  readonly byContainer: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by stock status/disposition. */
  readonly byStatus: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by legal/economic owner. */
  readonly byOwner: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by physical custodian/possessor. */
  readonly byCustodian: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by disposition authority. */
  readonly byDispositionAuthority: readonly InventoryStockDimensionBucket[];
  /** Signed net totals grouped by every qualified dimension present in matching stock. */
  readonly qualifiedDimensions: readonly InventoryQualifiedDimensionSummary[];
}

/** Generic physical stock read model for one broad selector. */
export interface InventoryStockSummary {
  /** Normalized selector used to build this summary. */
  readonly selector: InventoryStockSelector;
  /** Revision-safe summaries sorted by item revision identity. */
  readonly revisions: readonly InventoryStockRevisionSummary[];
}

/** Inputs for building one generic physical stock summary. */
export interface SummarizeInventoryStockInput {
  /** Frozen catalogue retaining active and historical item/package revisions. */
  readonly catalog: InventoryCatalog;
  /** Current committed physical stock projection. */
  readonly projection: InventoryProjectionState;
  /** Broad or exact eligible-stock selector. */
  readonly selector: InventoryStockSelector;
}

/** Find one committed event by stable operation identity using the rebuildable projection index. */
export function findInventoryEventByOperationId(
  projection: InventoryProjectionState,
  operationId: string
): InventoryCommittedEvent | undefined {
  if (operationId.trim().length === 0) {
    throw new Error("Inventory operationId must not be empty.");
  }
  const eventId = projection.eventIdByOperationId[operationId];
  if (eventId === undefined) return undefined;
  const event = projection.events[eventId];
  if (event === undefined) {
    throw new Error(
      `Inventory operation '${operationId}' references missing event '${eventId}'.`
    );
  }
  if (event.operationId !== operationId) {
    throw new Error(
      `Inventory operation index '${operationId}' points to event for '${event.operationId}'.`
    );
  }
  return event;
}

/** Inputs for listing exact package revisions available to application unit pickers. */
export interface ListInventoryPackagingRevisionsInput {
  /** Frozen catalogue containing current and historical package definitions. */
  readonly catalog: InventoryCatalog;
  /** Stable item whose package revisions should be returned. */
  readonly itemId: ItemId;
  /** Optional exact item revision; omission lists retained package revisions across history. */
  readonly itemRevisionId?: ItemRevisionId;
}

/** Summarize physical stock once inside InventoryOnce instead of reimplementing aggregation in each UI. */
export function summarizeInventoryStock({
  catalog,
  projection,
  selector: rawSelector,
}: SummarizeInventoryStockInput): InventoryStockSummary {
  const selector = normalizeInventoryStockSelector(rawSelector);
  const positions = findInventoryPositions(projection, selector);
  const positionsByRevision = new Map<
    ItemRevisionId,
    InventoryStockPosition[]
  >();
  for (const position of positions) {
    const rows = positionsByRevision.get(position.key.itemRevisionId) ?? [];
    rows.push(position);
    positionsByRevision.set(position.key.itemRevisionId, rows);
  }

  // Requested revisions and the active revision stay visible even when their balance is exactly zero.
  const revisionIds = new Set<ItemRevisionId>();
  for (const revisionId of selector.itemRevisionIds ?? [])
    revisionIds.add(revisionId);
  for (const revisionId of positionsByRevision.keys())
    revisionIds.add(revisionId);
  if (selector.itemRevisionIds === undefined) {
    revisionIds.add(catalog.activeItem(selector.itemId).revisionId);
  }
  const orderedRevisionIds = [...revisionIds];
  orderedRevisionIds.sort();

  const revisions: InventoryStockRevisionSummary[] = [];
  for (const revisionId of orderedRevisionIds) {
    const item = catalog.itemRevision(revisionId);
    if (item.itemId !== selector.itemId) {
      throw new Error(
        `Selector item '${selector.itemId}' cannot summarize revision '${revisionId}'.`
      );
    }
    const revisionPositions = positionsByRevision.get(revisionId) ?? [];
    revisions.push({
      itemId: item.itemId,
      itemRevisionId: item.revisionId,
      total: sumRevisionMeasurements(item, revisionPositions),
      physicalOnHand: sumRevisionPhysicalMeasurements(item, revisionPositions),
      deficit: sumRevisionDeficitMeasurements(item, revisionPositions),
      positions: revisionPositions,
      byLocation: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's physical/logical location identity. */
        (position) => position.key.locationId
      ),
      byLot: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional lot/batch identity. */
        (position) => position.key.lotId
      ),
      byPackagingRevision: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional exact packaging revision. */
        (position) => position.key.packagingRevisionId
      ),
      byContainer: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional handling-unit identity. */
        (position) => position.key.containerId
      ),
      byStatus: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional stock-status identity. */
        (position) => position.key.statusId
      ),
      byOwner: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional legal/economic owner. */
        (position) => position.key.ownerId
      ),
      byCustodian: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional physical custodian. */
        (position) => position.key.custodianId
      ),
      byDispositionAuthority: summarizeOptionalIdentity(
        revisionPositions,
        /** Read one position's optional disposition authority. */
        (position) => position.key.dispositionAuthorityId
      ),
      qualifiedDimensions: summarizeQualifiedDimensions(revisionPositions),
    });
  }
  return { selector, revisions };
}

/** List retained exact package revisions without collapsing equal human package-unit labels. */
export function listInventoryPackagingRevisions({
  catalog,
  itemId,
  itemRevisionId,
}: ListInventoryPackagingRevisionsInput): readonly InventoryPackagingDefinitionRevision[] {
  const result: InventoryPackagingDefinitionRevision[] = [];
  for (const packaging of catalog.packagingRevisions) {
    if (packaging.itemId !== itemId) continue;
    if (
      itemRevisionId !== undefined &&
      packaging.itemRevisionId !== itemRevisionId
    )
      continue;
    result.push(packaging);
  }
  result.sort(comparePackagingDefinition);
  return result;
}

/** Sum exact positions within one frozen item revision, returning schema-correct zero when empty. */
function sumRevisionMeasurements(
  item: InventoryItemDefinitionRevision,
  positions: readonly InventoryStockPosition[]
): InventoryMeasurementVector {
  let total = zeroInventoryMeasurementsForItem(item);
  for (const position of positions) {
    total = addInventoryMeasurements(total, position.measurements);
  }
  return total;
}

/** Sum only positive physical positions; signed deficit is reported separately. */
function sumRevisionPhysicalMeasurements(
  item: InventoryItemDefinitionRevision,
  positions: readonly InventoryStockPosition[]
): InventoryMeasurementVector {
  let total = zeroInventoryMeasurementsForItem(item);
  for (const position of positions) {
    if (inventoryPositionIsDeficit(position)) continue;
    total = addInventoryMeasurements(total, position.measurements);
  }
  return total;
}

/** Sum positive deficit magnitude without exposing it as physical stock. */
function sumRevisionDeficitMeasurements(
  item: InventoryItemDefinitionRevision,
  positions: readonly InventoryStockPosition[]
): InventoryMeasurementVector {
  let total = zeroInventoryMeasurementsForItem(item);
  for (const position of positions) {
    const deficit = inventoryPositionDeficitMeasurements(position);
    if (deficit === undefined) continue;
    total = addInventoryMeasurements(total, deficit);
  }
  return total;
}


/** Mutable accumulator used only while building one immutable summary bucket. */
interface MutableInventoryStockDimensionBucket {
  /** Dimension value, omitted for the explicit absence bucket. */
  readonly valueId?: string;
  /** Running exact measurement total. */
  readonly measurements: InventoryMeasurementVector;
  /** Running number of exact positions. */
  readonly positionCount: number;
}

/** Group exact positions by one optional identity while retaining absent-value stock explicitly. */
function summarizeOptionalIdentity(
  positions: readonly InventoryStockPosition[],
  readValueId: (position: InventoryStockPosition) => string | undefined
): readonly InventoryStockDimensionBucket[] {
  const buckets = new Map<string, MutableInventoryStockDimensionBucket>();
  for (const position of positions) {
    const valueId = readValueId(position);
    const key = valueId ?? "";
    const current = buckets.get(key);
    if (current === undefined) {
      buckets.set(key, {
        ...(valueId === undefined ? {} : { valueId }),
        measurements: position.measurements,
        positionCount: 1,
      });
      continue;
    }
    buckets.set(key, {
      ...(current.valueId === undefined ? {} : { valueId: current.valueId }),
      measurements: addInventoryMeasurements(
        current.measurements,
        position.measurements
      ),
      positionCount: current.positionCount + 1,
    });
  }
  const result = [...buckets.values()];
  result.sort(compareDimensionBucket);
  return result;
}

/** Summarize every qualified dimension found on the selected positions, including absence buckets. */
function summarizeQualifiedDimensions(
  positions: readonly InventoryStockPosition[]
): readonly InventoryQualifiedDimensionSummary[] {
  const dimensionIds = new Set<string>();
  for (const position of positions) {
    for (const dimension of position.key.qualifiedDimensions ?? []) {
      dimensionIds.add(dimension.dimensionId);
    }
  }
  const orderedDimensionIds = [...dimensionIds];
  orderedDimensionIds.sort();
  const result: InventoryQualifiedDimensionSummary[] = [];
  for (const dimensionId of orderedDimensionIds) {
    result.push({
      dimensionId,
      buckets: summarizeOptionalIdentity(
        positions,
        /** Read this qualified dimension's optional value from one position. */
        (position) => readQualifiedDimensionValue(position, dimensionId)
      ),
    });
  }
  return result;
}

/** Read one qualified-dimension value from an exact position. */
function readQualifiedDimensionValue(
  position: InventoryStockPosition,
  dimensionId: string
): string | undefined {
  for (const dimension of position.key.qualifiedDimensions ?? []) {
    if (dimension.dimensionId === dimensionId) return dimension.valueId;
  }
  return undefined;
}

/** Sort optional-identity buckets with real values first and the absence bucket last. */
function compareDimensionBucket(
  left: InventoryStockDimensionBucket,
  right: InventoryStockDimensionBucket
): number {
  if (left.valueId === undefined && right.valueId === undefined) return 0;
  if (left.valueId === undefined) return 1;
  if (right.valueId === undefined) return -1;
  return compareInventoryIdentityText(left.valueId, right.valueId);
}

/** Sort package definitions by human unit then exact immutable revision identity. */
function comparePackagingDefinition(
  left: InventoryPackagingDefinitionRevision,
  right: InventoryPackagingDefinitionRevision
): number {
  const unitOrder = compareInventoryIdentityText(
    left.packageUnit,
    right.packageUnit
  );
  return unitOrder !== 0
    ? unitOrder
    : compareInventoryIdentityText(left.revisionId, right.revisionId);
}
