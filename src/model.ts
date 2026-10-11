import { compareInventoryIdentityText } from "./ordering.js";
import type { InventoryMeasurementVector } from "./measurements.js";

/** Generic item identity with no application/database meaning. */
export type ItemId = string;
/** Immutable item-definition revision identity. */
export type ItemRevisionId = string;
/** Stable identity for one generic physical placement node. */
export type PlacementNodeId = string;
/** Stable kernel-owned identity for one detached/missing stock whereabouts lifecycle. */
export type InventoryWhereaboutsId = string;
/** Current unresolved whereabouts classification for stock with no asserted placement. */
export enum InventoryStockWhereaboutsState {
  /** Deliberately removed from its prior placement; next placement is not yet asserted. */
  Detached = "detached",
  /** Still-accounted-for stock whose current physical whereabouts are genuinely unknown. */
  Missing = "missing",
}
/** Generic maker/production lot identity. */
export type LotId = string;
/** Generic individually tracked serial identity. */
export type SerialId = string;
/** Generic party identity used for ownership, custody, authority, source, and destination roles. */
export type PartyId = string;
/** Stable kernel-owned identity for one prepared/dispatched physical transfer lifecycle. */
export type TransferId = string;
/** Generic stock-state identity such as usable, quarantine, recalled, or damaged. */
export type StockStatusId = string;
/** Generic explicitly configured extra inventory-dimension identity. */
export type InventoryDimensionId = string;
/** JSON-safe metadata value allowed on generic InventoryOnce facts. */
export type InventoryMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly InventoryMetadataValue[]
  | {
      /** One JSON-safe metadata field by application-defined key. */
      readonly [key: string]: InventoryMetadataValue;
    };
/** JSON-safe metadata map kept outside the hard inventory invariants. */
export type InventoryMetadata = Readonly<
  Record<string, InventoryMetadataValue>
>;

/** One configured extra stock dimension/value that contributes to position identity. */
export interface InventoryQualifiedDimension {
  /** Catalogue-defined dimension name. */
  readonly dimensionId: InventoryDimensionId;
  /** Application-defined value inside that dimension. */
  readonly valueId: string;
}

/**
 * Dimensions that distinguish one homogeneous stock position.
 * A verb may only change the dimensions it explicitly names.
 */
export interface InventoryStockPositionKey {
  /** Thing whose stock is being counted. */
  readonly itemId: ItemId;
  /** Frozen item definition revision governing measurements/tracking/dimensions for this stock. */
  readonly itemRevisionId: ItemRevisionId;
  /** Generic node directly holding this stock; omitted only for explicit detached/missing whereabouts. */
  readonly placementNodeId?: PlacementNodeId;
  /** Stable lifecycle/cohort identity while current placement is unresolved. */
  readonly whereaboutsId?: InventoryWhereaboutsId;
  /** Detached/missing classification while current placement is unresolved. */
  readonly whereaboutsState?: InventoryStockWhereaboutsState;
  /** Last asserted direct placement before the current unresolved whereabouts lifecycle began. */
  readonly lastPlacementNodeId?: PlacementNodeId;
  /** Original intentional-detach time for this unresolved whereabouts lifecycle. */
  readonly detachedAtEpochMs?: number;
  /** Time the unresolved lifecycle was escalated to genuinely missing; valid only for Missing. */
  readonly missingAtEpochMs?: number;
  /** Production lot when lot traceability matters. */
  readonly lotId?: LotId;
  /** Exact serial identity when one resource is individually tracked. */
  readonly serialId?: SerialId;
  /** Exact package revision while stock remains physically intact in that package form. */
  readonly packagingRevisionId?: string;
  /** Current usable/quarantine/recalled/etc. state. */
  readonly statusId?: StockStatusId;
  /** Current legal/economic owner. */
  readonly ownerId?: PartyId;
  /** Current physical custodian/possessor. */
  readonly custodianId?: PartyId;
  /** Party currently entitled to decide how the stock is disposed/used. */
  readonly dispositionAuthorityId?: PartyId;
  /** Kernel-owned transfer partition while stock is prepared or physically in transit. */
  readonly transferId?: TransferId;
  /** Additional catalogue-declared dimensions, sorted by dimension id. */
  readonly qualifiedDimensions?: readonly InventoryQualifiedDimension[];
}

/** Application command position before InventoryOnce injects the frozen item revision. */
export type InventoryStockPositionInput = Omit<
  InventoryStockPositionKey,
  "itemRevisionId" | "transferId"
>;

/** Current projected measurements for one exact stock position. */
export interface InventoryStockPosition {
  /** Dimensions identifying which homogeneous stock this row represents. */
  readonly key: InventoryStockPositionKey;
  /** Exact primary plus independently measured quantities at this position. */
  readonly measurements: InventoryMeasurementVector;
}

/** Stable item-scoped identity for one individually tracked serial. */
export function inventorySerialIdentity(
  itemId: ItemId,
  serialId: SerialId
): string {
  assertInventoryIdentity(itemId, "serial itemId");
  assertInventoryIdentity(serialId, "serialId");
  return JSON.stringify([itemId, serialId]);
}

/** Immutable lot facts used for allocation, expiry, and traceability. */
export interface InventoryLotDefinition {
  /** Item this lot belongs to. */
  readonly itemId: ItemId;
  /** Stable lot identity from the maker/application. */
  readonly lotId: LotId;
  /** Manufacturing time in safe-integer epoch milliseconds when known. */
  readonly manufacturedAtEpochMs?: number;
  /** Maker/use-by expiry time in safe-integer epoch milliseconds when known. */
  readonly expiresAtEpochMs?: number;
  /** Extra application metadata that does not change lot identity. */
  readonly metadata?: InventoryMetadata;
}

/** Stable item-scoped identity for one lot/batch master. */
export function inventoryLotIdentity(itemId: ItemId, lotId: LotId): string {
  assertInventoryIdentity(itemId, "lot itemId");
  assertInventoryIdentity(lotId, "lotId");
  return JSON.stringify([itemId, lotId]);
}

/** Optional metadata and policy for one generic physical placement node. */
export interface InventoryPlacementNodeDefinition {
  /** Stable identity for this exact physical/logical node. */
  readonly nodeId: PlacementNodeId;
  /** Application-defined category with no kernel behavior. */
  readonly category?: string;
  /** Whether other nodes or stock may be placed directly here; omission means allowed. */
  readonly acceptsPlacement?: boolean;
  /** Barcode/vendor/application identifiers that help resolve this exact node. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Time this node was physically opened/prepared when meaningful. */
  readonly openedAtEpochMs?: number;
  /** Node-specific use-by time applied to stock anywhere in its descendant subtree. */
  readonly useByEpochMs?: number;
  /** Extra application metadata that does not change node identity or topology. */
  readonly metadata?: InventoryMetadata;
}

/** Stable identity for one generic physical placement node. */
export function inventoryPlacementNodeIdentity(nodeId: PlacementNodeId): string {
  assertInventoryIdentity(nodeId, "placement nodeId");
  return JSON.stringify([nodeId]);
}

/** Kind of object that can participate in association or genealogy. */
export enum InventoryTraceabilityNodeKind {
  /** Individually tracked serial/resource identity. */
  Serial = "serial",
  /** Generic physical placement-node identity. */
  PlacementNode = "placement-node",
  /** Lot/batch identity qualified by item. */
  Lot = "lot",
  /** Application-owned external traceability identity. */
  External = "external",
}

/** Stable reference to one traceability graph node. */
export interface InventoryTraceabilityNodeRef {
  /** Node category used to avoid collisions between serial/placement-node/lot namespaces. */
  readonly kind: InventoryTraceabilityNodeKind;
  /** Stable identity inside that category. */
  readonly id: string;
  /** Required item qualifier for lot nodes. */
  readonly itemId?: ItemId;
}

/** Reject a malformed, empty, or padded identity before it can become durable inventory truth. */
export function assertInventoryIdentity(value: string, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label} must not be empty.`);
  if (trimmed !== value) {
    throw new Error(`${label} must not contain surrounding whitespace.`);
  }
}

/** Return a normalized copy with extra dimensions sorted and duplicate ids rejected. */
export function normalizeInventoryStockPositionKey(
  key: InventoryStockPositionKey
): InventoryStockPositionKey {
  assertInventoryIdentity(key.itemId, "itemId");
  assertInventoryIdentity(key.itemRevisionId, "itemRevisionId");
  if (key.placementNodeId !== undefined) {
    assertInventoryIdentity(key.placementNodeId, "placementNodeId");
  }
  assertInventoryPositionPlacementOrWhereabouts(key);
  for (const [label, value] of [
    ["lotId", key.lotId],
    ["serialId", key.serialId],
    ["packagingRevisionId", key.packagingRevisionId],
    ["statusId", key.statusId],
    ["ownerId", key.ownerId],
    ["custodianId", key.custodianId],
    ["dispositionAuthorityId", key.dispositionAuthorityId],
    ["transferId", key.transferId],
    ["whereaboutsId", key.whereaboutsId],
    ["lastPlacementNodeId", key.lastPlacementNodeId],
  ] as const) {
    if (value !== undefined) assertInventoryIdentity(value, label);
  }
  // Copy the caller-owned key so later mutation cannot change retained position truth.
  if (key.qualifiedDimensions === undefined) return { ...key };
  const { qualifiedDimensions, ...withoutQualifiedDimensions } = key;
  // Empty qualified dimensions are semantic omission and must share one durable position identity.
  if (qualifiedDimensions.length === 0) return withoutQualifiedDimensions;
  // Copy each caller-owned element so later alias mutation cannot change retained position truth.
  const dimensions = qualifiedDimensions.map(
    /** Copy one item-defined dimension value into kernel-owned position truth. */
    (dimension) => ({
      dimensionId: dimension.dimensionId,
      valueId: dimension.valueId,
    })
  );
  dimensions.sort(compareQualifiedDimension);
  let previousDimensionId: string | undefined;
  for (const dimension of dimensions) {
    assertInventoryIdentity(dimension.dimensionId, "qualified dimension id");
    assertInventoryIdentity(dimension.valueId, "qualified dimension value");
    if (dimension.dimensionId === previousDimensionId) {
      throw new Error(
        `Duplicate qualified dimension '${dimension.dimensionId}'.`
      );
    }
    previousDimensionId = dimension.dimensionId;
  }
  return { ...key, qualifiedDimensions: dimensions };
}


/** Enforce one honest current physical-placement representation on every stock position. */
function assertInventoryPositionPlacementOrWhereabouts(
  key: InventoryStockPositionKey
): void {
  const hasPlacement = key.placementNodeId !== undefined;
  const whereaboutsFields = [
    key.whereaboutsId,
    key.whereaboutsState,
    key.lastPlacementNodeId,
    key.detachedAtEpochMs,
  ];
  const hasAnyWhereabouts =
    whereaboutsFields.some(
      /** Return whether one unresolved-whereabouts field is present. */
      (value) => value !== undefined
    ) ||
    key.missingAtEpochMs !== undefined;
  if (hasPlacement) {
    if (hasAnyWhereabouts) {
      throw new Error(
        "Placed stock cannot simultaneously carry unresolved whereabouts fields."
      );
    }
    return;
  }
  if (
    key.whereaboutsId === undefined ||
    key.whereaboutsState === undefined ||
    key.lastPlacementNodeId === undefined ||
    key.detachedAtEpochMs === undefined
  ) {
    throw new Error(
      "Unplaced stock requires whereaboutsId, whereaboutsState, lastPlacementNodeId, and detachedAtEpochMs."
    );
  }
  assertInventoryIdentity(key.whereaboutsId, "whereaboutsId");
  assertInventoryIdentity(key.lastPlacementNodeId, "lastPlacementNodeId");
  assertInventoryPositionEpochMilliseconds(
    key.detachedAtEpochMs,
    "detachedAtEpochMs"
  );
  if (key.whereaboutsState === InventoryStockWhereaboutsState.Detached) {
    if (key.missingAtEpochMs !== undefined) {
      throw new Error("Detached stock cannot carry missingAtEpochMs.");
    }
    return;
  }
  if (key.whereaboutsState !== InventoryStockWhereaboutsState.Missing) {
    throw new Error("Unknown inventory whereabouts state.");
  }
  if (key.missingAtEpochMs === undefined) {
    throw new Error("Missing stock requires missingAtEpochMs.");
  }
  assertInventoryPositionEpochMilliseconds(
    key.missingAtEpochMs,
    "missingAtEpochMs"
  );
  if (key.missingAtEpochMs < key.detachedAtEpochMs) {
    throw new Error("missingAtEpochMs cannot precede detachedAtEpochMs.");
  }
}

/** Require one non-negative safe-integer epoch millisecond on position lifecycle truth. */
function assertInventoryPositionEpochMilliseconds(
  value: number,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be non-negative safe-integer epoch milliseconds.");
  }
}

/** Sort extra position dimensions by their configured dimension identity. */
function compareQualifiedDimension(
  left: InventoryQualifiedDimension,
  right: InventoryQualifiedDimension
): number {
  return compareInventoryIdentityText(left.dimensionId, right.dimensionId);
}

/** Reduce one qualified dimension to the fixed primitive tuple used in position identity. */
function qualifiedDimensionIdentityTuple(
  dimension: InventoryQualifiedDimension
): readonly [string, string] {
  return [dimension.dimensionId, dimension.valueId];
}

/** Stable deterministic identity used by projections, locks, maps, and tests. */
export function inventoryStockPositionIdentity(
  rawKey: InventoryStockPositionKey
): string {
  const key = normalizeInventoryStockPositionKey(rawKey);
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
    key.qualifiedDimensions?.map(qualifiedDimensionIdentityTuple) ?? null,
  ]);
}

/** Stable deterministic identity for one traceability graph node. */
export function inventoryTraceabilityNodeIdentity(
  node: InventoryTraceabilityNodeRef
): string {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Traceability node must be an object.");
  }
  assertInventoryIdentity(node.id, "traceability node id");
  switch (node.kind) {
    case InventoryTraceabilityNodeKind.Serial:
    case InventoryTraceabilityNodeKind.PlacementNode:
    case InventoryTraceabilityNodeKind.Lot:
    case InventoryTraceabilityNodeKind.External:
      break;
    default:
      throw new Error(
        `Unsupported traceability node kind '${String(node.kind)}'.`
      );
  }
  if (node.kind === InventoryTraceabilityNodeKind.Lot) {
    if (node.itemId === undefined)
      throw new Error("Lot traceability node needs itemId.");
    assertInventoryIdentity(node.itemId, "lot traceability itemId");
  } else if (node.itemId !== undefined) {
    // Only lot nodes are item-qualified; accepting this field would split one non-lot durable identity.
    throw new Error(
      `Traceability node kind '${node.kind}' must not name itemId.`
    );
  }
  return JSON.stringify([node.kind, node.itemId ?? null, node.id]);
}
