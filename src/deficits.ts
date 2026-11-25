import {
  inventoryMeasurementAt,
  negateInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
  type ItemRevisionId,
} from "./model.js";
import {
  findInventoryPositions,
  type InventoryProjectionState,
} from "./projection.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import {
  inventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  addQuantity,
  compareQuantity,
  integerAtDecimals,
  negateQuantity,
  quantity,
  safeNumber,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
  type UnitCode,
} from "./quantity.js";

/** Reserved untracked lot identity used by ordinary policy shortfall when no explicit deficit position is supplied. */
export const INVENTORY_RECORDED_DEFICIT_LOT_ID = "__inventory_deficit__";

/** One positive capacity row that may be burdened by recorded direct-placement-pool deficit. */
export interface InventoryDeficitCapacityLine {
  /** Exact positive physical position supplying this capacity. */
  readonly position: InventoryStockPositionKey;
  /** Positive capacity already reduced by exact claims or caller-owned constraints. */
  readonly capacity: Quantity;
  /** Smallest legal remaining quantity for intact package/serial rows. */
  readonly allocationIncrement?: Quantity;
}

/** Exact capacities after every selected direct placement's recorded deficit has first priority. */
export interface InventoryDeficitCapacityAdjustment {
  /** Adjusted non-negative capacity by exact physical position identity. */
  readonly capacityByPositionIdentity: ReadonlyMap<string, Quantity>;
  /** Total positive deficit magnitude recorded in the selected direct-placement pools. */
  readonly recordedDeficit: Quantity;
  /** Deficit still not backed by any supplied positive capacity. */
  readonly uncoveredDeficit: Quantity;
}

/** Inputs for applying durable signed deficit to otherwise-positive capacity rows. */
export interface ApplyInventoryRecordedDeficitBurdenInput {
  /** Current published projection containing signed positions. */
  readonly projection: InventoryProjectionState;
  /** Exact item revision whose positive/negative rows form the resource pools. */
  readonly itemRevisionId: ItemRevisionId;
  /** Measurement axis used by this availability/allocation calculation. */
  readonly axisId: string;
  /** Exact unit used by every capacity/deficit quantity. */
  readonly unit: UnitCode;
  /** Selected pools; deficit never crosses direct-placement boundaries. */
  readonly placementNodeIds: readonly string[];
  /** Positive capacities in deterministic burden order, reduced without going negative. */
  readonly lines: readonly InventoryDeficitCapacityLine[];
}

/**
 * Broaden one caller selector to the direct-placement pool that owns recorded deficit.
 * Lot/package/serial/owner constraints choose what the caller may consume; they do not split
 * one item's shortage into separate liabilities that can be bypassed or paid repeatedly.
 */
export function inventoryRecordedDeficitPoolSelector(
  selector: InventoryStockSelector,
  itemRevisionId: ItemRevisionId
): InventoryStockSelector {
  return inventoryStockSelector(selector.itemId, {
    itemRevisionIds: [itemRevisionId],
    // Direct and subtree predicates intersect. Keep ancestry as a predicate
    // so a warehouse read need not enumerate every descendant.
    ...(selector.placementNodeIds === undefined ? {} : { placementNodeIds: selector.placementNodeIds }),
    ...(selector.withinPlacementNodeIds === undefined ? {} : { withinPlacementNodeIds: selector.withinPlacementNodeIds }),
  });
}

/**
 * Limit deficit pools to direct nodes holding this item revision, without
 * traversing unrelated empty descendants. Include roots so an empty subtree
 * never becomes the unconstrained empty-list wildcard.
 */
export function inventorySelectedDeficitPlacementNodeIds(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector,
  itemRevisionId: ItemRevisionId
): readonly string[] {
  const roots = selector.withinPlacementNodeIds;
  if (roots === undefined) return selector.placementNodeIds ?? [];
  const selected = new Set<string>(selector.placementNodeIds === undefined ? roots : []);
  // Reuse the projection's bounded subtree-vs-item index chooser: a small
  // subtree of a huge item must not scan every unrelated item position,
  // while a huge empty subtree must not walk all unrelated placement nodes.
  const occupied = findInventoryPositions(
    projection,
    inventoryRecordedDeficitPoolSelector(selector, itemRevisionId)
  );
  for (const position of occupied) {
    const nodeId = position.key.placementNodeId;
    if (nodeId !== undefined) selected.add(nodeId);
  }
  return [...selected].sort();
}

/** Return whether one signed projected position is an explicit recorded deficit. */
export function inventoryPositionIsDeficit(
  position: InventoryStockPosition
): boolean {
  const primary = position.measurements.primary.quantity;
  return (
    compareQuantity(primary, zeroQuantity(primary.unit, primary.decimals)) < 0
  );
}

/** Return positive deficit magnitude on every axis, or undefined for physical stock. */
export function inventoryPositionDeficitMeasurements(
  position: InventoryStockPosition
): InventoryMeasurementVector | undefined {
  return inventoryPositionIsDeficit(position)
    ? negateInventoryMeasurements(position.measurements)
    : undefined;
}

/**
 * Give durable deficit first claim on positive capacity in the same item-revision/direct-placement pool.
 * The burden is a conservative read/allocation calculation; it never writes synthetic lot history.
 */
export function applyInventoryRecordedDeficitBurden({
  projection,
  ...input
}: ApplyInventoryRecordedDeficitBurdenInput): InventoryDeficitCapacityAdjustment {
  return applyInventoryDeficitBurdenToPositions({
    ...input,
    positions: inventoryDeficitRevisionRows(projection, input.itemRevisionId),
  });
}

/** Read signed rows for one exact revision through the canonical projection index. */
function* inventoryDeficitRevisionRows(
  projection: InventoryProjectionState,
  itemRevisionId: ItemRevisionId
): Iterable<InventoryStockPosition> {
  for (const positionIdentity of inventorySparseRecordValue(
    projection.positionIdsByItemRevisionId,
    itemRevisionId
  ) ?? []) {
    const position = projection.positions[positionIdentity];
    if (position === undefined) {
      throw new Error(
        `Inventory deficit item-revision index references missing position '${positionIdentity}'.`
      );
    }
    yield position;
  }
}

/** Deficit reducer inputs with all signed rows supplied by the caller's physical pool. */
interface ApplyInventoryDeficitBurdenToPositionsInput
  extends Omit<ApplyInventoryRecordedDeficitBurdenInput, "projection"> {
  /** Signed position rows of this revision from every selected pool. */
  readonly positions: Iterable<InventoryStockPosition>;
}

/** Reduce candidate capacities using the exact signed deficit of each supplied pool. */
export function applyInventoryDeficitBurdenToPositions({
  positions,
  itemRevisionId,
  axisId,
  unit,
  placementNodeIds,
  lines,
}: ApplyInventoryDeficitBurdenToPositionsInput): InventoryDeficitCapacityAdjustment {
  const selectedLocations = normalizePlacementNodeIds(placementNodeIds);
  const allLocationsSelected = selectedLocations.size === 0;
  const deficitByLocation = recordedDeficitByLocation(
    positions,
    axisId,
    unit,
    allLocationsSelected ? undefined : selectedLocations
  );
  let recordedDeficit = zeroQuantity(unit);
  for (const deficit of deficitByLocation.values()) {
    recordedDeficit = addQuantity(recordedDeficit, deficit);
  }

  const capacityByPositionIdentity = new Map<string, Quantity>();
  const linesByLocation = new Map<string, InventoryDeficitCapacityLine[]>();
  for (const line of lines) {
    if (line.position.itemRevisionId !== itemRevisionId) {
      throw new Error(
        "Inventory deficit capacity line belongs to another item revision."
      );
    }
    if (
      !allLocationsSelected &&
      (line.position.placementNodeId === undefined ||
        !selectedLocations.has(line.position.placementNodeId))
    ) {
      throw new Error(
        "Inventory deficit capacity line belongs to an unselected direct placement."
      );
    }
    requirePositiveCapacity(line.capacity, unit, "Inventory deficit capacity");
    if (line.allocationIncrement !== undefined) {
      requirePositiveCapacity(
        line.allocationIncrement,
        unit,
        "Inventory deficit allocation increment"
      );
    }
    const identity = inventoryStockPositionIdentity(line.position);
    if (capacityByPositionIdentity.has(identity)) {
      throw new Error(
        `Inventory deficit capacity repeats position '${identity}'.`
      );
    }
    capacityByPositionIdentity.set(identity, line.capacity);
    const poolIdentity = allLocationsSelected
      ? inventoryDeficitPhysicalPoolIdentity(line.position)
      : line.position.placementNodeId!;
    const locationLines = linesByLocation.get(poolIdentity) ?? [];
    locationLines.push(line);
    linesByLocation.set(poolIdentity, locationLines);
  }

  let burdenLocations: ReadonlySet<string> = selectedLocations;
  if (allLocationsSelected) {
    const allLocations = new Set<string>();
    for (const placementNodeId of deficitByLocation.keys()) allLocations.add(placementNodeId);
    for (const placementNodeId of linesByLocation.keys()) allLocations.add(placementNodeId);
    burdenLocations = new Set([...allLocations].sort());
  }

  let uncoveredDeficit = zeroQuantity(unit);
  for (const placementNodeId of burdenLocations) {
    let remaining = deficitByLocation.get(placementNodeId) ?? zeroQuantity(unit);
    const locationLines = linesByLocation.get(placementNodeId) ?? [];
    for (const line of locationLines) {
      if (
        compareQuantity(remaining, zeroQuantity(unit, remaining.decimals)) <= 0
      ) {
        break;
      }
      const identity = inventoryStockPositionIdentity(line.position);
      const capacity = capacityByPositionIdentity.get(identity);
      if (capacity === undefined) {
        throw new Error(
          `Inventory deficit burden lost capacity position '${identity}'.`
        );
      }
      const adjusted = capacityAfterDeficit(
        capacity,
        remaining,
        line.allocationIncrement
      );
      capacityByPositionIdentity.set(identity, adjusted.capacity);
      remaining = adjusted.remainingDeficit;
    }
    uncoveredDeficit = addQuantity(uncoveredDeficit, remaining);
  }
  return {
    capacityByPositionIdentity,
    recordedDeficit,
    uncoveredDeficit,
  };
}

/** Collect positive deficit magnitude by exact direct placement without assigning it to lots. */
function recordedDeficitByLocation(
  positions: Iterable<InventoryStockPosition>,
  axisId: string,
  unit: UnitCode,
  selectedLocations: ReadonlySet<string> | undefined
): ReadonlyMap<string, Quantity> {
  const result = new Map<string, Quantity>();
  for (const position of positions) {
    if (
      selectedLocations !== undefined &&
      (position.key.placementNodeId === undefined ||
        !selectedLocations.has(position.key.placementNodeId))
    ) continue;
    if (!inventoryPositionIsDeficit(position)) continue;
    const signed = inventoryMeasurementAt(position.measurements, axisId, unit);
    if (compareQuantity(signed, zeroQuantity(unit, signed.decimals)) >= 0) {
      continue;
    }
    const magnitude = negateQuantity(signed);
    const poolIdentity =
      selectedLocations === undefined
        ? inventoryDeficitPhysicalPoolIdentity(position.key)
        : position.key.placementNodeId!;
    result.set(
      poolIdentity,
      addQuantity(result.get(poolIdentity) ?? zeroQuantity(unit), magnitude)
    );
  }
  return result;
}

/** Stable internal physical-pool identity for broad deficit accounting without inventing a placement. */
function inventoryDeficitPhysicalPoolIdentity(
  position: InventoryStockPositionKey
): string {
  if (position.placementNodeId !== undefined) {
    return JSON.stringify(["placement", position.placementNodeId]);
  }
  if (position.whereaboutsId === undefined) {
    throw new Error("Unplaced inventory deficit/capacity lost whereabouts identity.");
  }
  return JSON.stringify(["whereabouts", position.whereaboutsId]);
}

/** Reduce one positive capacity by deficit while respecting intact allocation increments. */
function capacityAfterDeficit(
  capacity: Quantity,
  deficit: Quantity,
  allocationIncrement: Quantity | undefined
): {
  /** Capacity remaining after applying as much deficit as this line can absorb. */
  readonly capacity: Quantity;
  /** Deficit still requiring attribution to later positive capacity lines. */
  readonly remainingDeficit: Quantity;
} {
  if (compareQuantity(capacity, deficit) <= 0) {
    return {
      capacity: zeroQuantity(capacity.unit, capacity.decimals),
      remainingDeficit: subtractQuantity(deficit, capacity),
    };
  }
  const exactRemainder = subtractQuantity(capacity, deficit);
  if (allocationIncrement === undefined) {
    return {
      capacity: exactRemainder,
      remainingDeficit: zeroQuantity(deficit.unit, deficit.decimals),
    };
  }
  return {
    capacity: floorQuantityToIncrement(exactRemainder, allocationIncrement),
    // Increment rounding can only withhold additional physical stock, never expose deficit.
    remainingDeficit: zeroQuantity(deficit.unit, deficit.decimals),
  };
}

/** Floor one non-negative quantity to an exact positive same-unit increment. */
function floorQuantityToIncrement(
  value: Quantity,
  increment: Quantity
): Quantity {
  const decimals = Math.max(value.decimals, increment.decimals);
  const valueMinor = integerAtDecimals(value, decimals);
  const incrementMinor = integerAtDecimals(increment, decimals);
  // BigInt division truncates exactly; non-negative operands therefore floor without Number conversion.
  const floored = (valueMinor / incrementMinor) * incrementMinor;
  return quantity({
    amountMinor: safeNumber(
      floored,
      "Inventory deficit adjusted capacity"
    ),
    decimals,
    unit: value.unit,
  });
}

/** Normalize, sort, and reject duplicate/empty direct-placement identities. */
function normalizePlacementNodeIds(values: readonly string[]): ReadonlySet<string> {
  const normalized = [...values];
  normalized.sort();
  const result = new Set<string>();
  for (const value of normalized) {
    if (value.trim().length === 0 || value !== value.trim()) {
      throw new Error(
        "Inventory deficit direct-placement identity must be non-empty and trimmed."
      );
    }
    if (result.has(value)) {
      throw new Error(`Inventory deficit repeats direct placement '${value}'.`);
    }
    result.add(value);
  }
  return result;
}

/** Require a positive same-unit capacity before arithmetic starts. */
function requirePositiveCapacity(
  value: Quantity,
  unit: UnitCode,
  label: string
): void {
  if (value.unit !== unit) {
    throw new Error(`${label} uses a different unit.`);
  }
  if (compareQuantity(value, zeroQuantity(unit, value.decimals)) <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}
