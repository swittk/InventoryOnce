import { compareInventoryIdentityText } from "./ordering.js";
import type { InventoryMeasurementVector } from "./measurements.js";

/** Generic item identity with no application/database meaning. */
export type ItemId = string;
/** Immutable item-definition revision identity. */
export type ItemRevisionId = string;
/** Generic physical/logical location identity. */
export type LocationId = string;
/** Generic maker/production lot identity. */
export type LotId = string;
/** Generic individually tracked serial identity. */
export type SerialId = string;
/** Generic physical/logical handling-unit identity. */
export type ContainerId = string;
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
  /** Place where this stock currently exists; transit is represented as a real location. */
  readonly locationId: LocationId;
  /** Production lot when lot traceability matters. */
  readonly lotId?: LotId;
  /** Exact serial identity when one resource is individually tracked. */
  readonly serialId?: SerialId;
  /** Exact package revision while stock remains physically intact in that package form. */
  readonly packagingRevisionId?: string;
  /** Exact handling unit/container currently holding this stock. */
  readonly containerId?: ContainerId;
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
  /** Manufacturing time in canonical ISO-8601 form when known. */
  readonly manufacturedAt?: string;
  /** Maker/use-by expiry time in canonical ISO-8601 form when known. */
  readonly expiresAt?: string;
  /** Extra application metadata that does not change lot identity. */
  readonly metadata?: InventoryMetadata;
}

/** Stable item-scoped identity for one lot/batch master. */
export function inventoryLotIdentity(itemId: ItemId, lotId: LotId): string {
  assertInventoryIdentity(itemId, "lot itemId");
  assertInventoryIdentity(lotId, "lotId");
  return JSON.stringify([itemId, lotId]);
}

/** Immutable identifying facts for one physical/logical handling unit. */
export interface InventoryContainerDefinition {
  /** Stable identity for this exact handling unit. */
  readonly containerId: ContainerId;
  /** Plain application-defined kind such as vial, syringe, carton, tray, or pallet. */
  readonly containerType?: string;
  /** GTIN/SSCC/barcode/vendor identifiers that help resolve this exact container. */
  readonly identifiers?: Readonly<Record<string, string>>;
  /** Time this exact container was physically opened/prepared when known. */
  readonly openedAt?: string;
  /** Container-specific use-by time, often shorter than the source lot expiry. */
  readonly useBy?: string;
  /** Extra application metadata that does not change container identity. */
  readonly metadata?: InventoryMetadata;
}

/** Stable identity for one exact physical/logical handling unit. */
export function inventoryContainerIdentity(containerId: ContainerId): string {
  assertInventoryIdentity(containerId, "containerId");
  return JSON.stringify([containerId]);
}

/** Kind of object that can participate in containment, association, or genealogy. */
export enum InventoryTraceabilityNodeKind {
  /** Individually tracked serial/resource identity. */
  Serial = "serial",
  /** Physical/logical handling-unit identity. */
  Container = "container",
  /** Lot/batch identity qualified by item. */
  Lot = "lot",
  /** Application-owned external traceability identity. */
  External = "external",
}

/** Stable reference to one traceability graph node. */
export interface InventoryTraceabilityNodeRef {
  /** Node category used to avoid collisions between serial/container/lot namespaces. */
  readonly kind: InventoryTraceabilityNodeKind;
  /** Stable identity inside that category. */
  readonly id: string;
  /** Required item qualifier for lot nodes. */
  readonly itemId?: ItemId;
}

/** Reject an empty or padded identity before it can become durable inventory truth. */
export function assertInventoryIdentity(value: string, label: string): void {
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
  assertInventoryIdentity(key.locationId, "locationId");
  for (const [label, value] of [
    ["lotId", key.lotId],
    ["serialId", key.serialId],
    ["packagingRevisionId", key.packagingRevisionId],
    ["containerId", key.containerId],
    ["statusId", key.statusId],
    ["ownerId", key.ownerId],
    ["custodianId", key.custodianId],
    ["dispositionAuthorityId", key.dispositionAuthorityId],
    ["transferId", key.transferId],
  ] as const) {
    if (value !== undefined) assertInventoryIdentity(value, label);
  }
  if (key.qualifiedDimensions === undefined) return key;
  const dimensions = [...key.qualifiedDimensions];
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
    key.locationId,
    key.lotId ?? null,
    key.serialId ?? null,
    key.packagingRevisionId ?? null,
    key.containerId ?? null,
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
  assertInventoryIdentity(node.id, "traceability node id");
  if (node.kind === InventoryTraceabilityNodeKind.Lot) {
    if (node.itemId === undefined)
      throw new Error("Lot traceability node needs itemId.");
    assertInventoryIdentity(node.itemId, "lot traceability itemId");
  }
  return JSON.stringify([node.kind, node.itemId ?? null, node.id]);
}
