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
  addExactQuantityDigits,
  compareWorkingQuantities,
  subtractWorkingQuantity,
  workingQuantityAtDecimals,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
  inventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  compareQuantity,
  zeroQuantity,
  type UnitCode,
} from "./quantity.js";

/** Reserved untracked lot identity used by ordinary policy shortfall when no explicit deficit position is supplied. */
export const INVENTORY_RECORDED_DEFICIT_LOT_ID = "__inventory_deficit__";

/** One positive capacity on the selected axis before narrowing any returned quantities. */
export interface InventoryWorkingDeficitCapacityLine {
  /** Exact positive physical position supplying this capacity. */
  readonly position: InventoryStockPositionKey;
  /** Positive capacity already reduced by exact claims or caller-owned constraints. */
  readonly capacity: InventoryWorkingQuantity;
  /** Smallest legal remaining quantity for intact package/serial rows. */
  readonly allocationIncrement?: InventoryWorkingQuantity;
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
  readonly lines: readonly InventoryWorkingDeficitCapacityLine[];
}

/**
 * Broaden one caller selector to the direct-placement pool that owns recorded deficit.
 * Lot/package/serial/owner constraints choose what the caller may consume; they do not split
 * one item's shortage into separate liabilities. Explicit whereabouts select distinct pools.
 */
export function inventoryRecordedDeficitPoolSelector(
  selector: InventoryStockSelector,
  itemRevisionId: ItemRevisionId
): InventoryStockSelector {
  return inventoryStockSelector(selector.itemId, {
    itemRevisionIds: [itemRevisionId],
    // Direct and subtree predicates intersect. Keep ancestry as a predicate
    // so a warehouse read need not enumerate every descendant.
    ...(selector.placement === undefined ? {} : { placement: selector.placement }),
    ...(selector.placementNodeIds === undefined ? {} : { placementNodeIds: selector.placementNodeIds }),
    ...(selector.withinPlacementNodeIds === undefined ? {} : { withinPlacementNodeIds: selector.withinPlacementNodeIds }),
    ...(selector.whereabouts === undefined ? {} : { whereabouts: selector.whereabouts }),
    ...(selector.whereaboutsStates === undefined ? {} : { whereaboutsStates: selector.whereaboutsStates }),
  });
}

/**
 * Limit deficit pools to direct nodes holding this item revision, without
 * traversing unrelated empty descendants. An intersected selector can return
 * no direct pools, and the feasibility reducer treats that as no capacity.
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
}: ApplyInventoryRecordedDeficitBurdenInput): InventoryWorkingDeficitBurden {
  return applyInventoryWorkingDeficitBurdenToPositions({
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
interface ApplyInventoryWorkingDeficitBurdenToPositionsInput
  extends Omit<ApplyInventoryRecordedDeficitBurdenInput, "projection" | "lines"> {
  /** Signed position rows of this revision from every selected pool. */
  readonly positions: Iterable<InventoryStockPosition>;
  /** Working capacity in the order that bears each pool's deficit. */
  readonly lines: readonly InventoryWorkingDeficitCapacityLine[];
}

/** Attribute deficit to working capacities using the supplied published signs. */
export function applyInventoryWorkingDeficitBurdenToPositions({
  positions,
  lines,
  axisId,
  unit,
  ...scope
}: ApplyInventoryWorkingDeficitBurdenToPositionsInput): InventoryWorkingDeficitBurden {
  return applyInventoryWorkingDeficitBurden({
    ...scope, unit, lines, deficits: inventorySignedDeficitRows(positions, axisId, unit),
  });
}

/** One negative measurement in a signed stock pool. */
export interface InventorySignedDeficitRow {
  /** Exact position that owns the negative balance. */
  readonly position: InventoryStockPositionKey;
  /** Signed deficit measurement on the selected axis. */
  readonly signed: InventoryWorkingQuantity;
}

/** Read only negative selected-axis measurements from the published signed rows. */
function* inventorySignedDeficitRows(
  positions: Iterable<InventoryStockPosition>,
  axisId: string,
  unit: UnitCode,
): Iterable<InventorySignedDeficitRow> {
  for (const position of positions) {
    if (!inventoryPositionIsDeficit(position)) continue;
    const signed = inventoryMeasurementAt(position.measurements, axisId, unit);
    if (signed.amountMinor < 0) yield { position: position.key, signed };
  }
}

/** Signed pool rows and ordered positive capacities on a single working axis. */
interface ApplyInventoryWorkingDeficitBurdenInput extends Omit<ApplyInventoryRecordedDeficitBurdenInput, "projection" | "axisId" | "lines"> {
  /** Negative balances from the selected signed pool. */
  readonly deficits: Iterable<InventorySignedDeficitRow>;
  /** Positive capacity in the order that supplies deficit. */
  readonly lines: readonly InventoryWorkingDeficitCapacityLine[];
}

/** Full-precision result of charging each signed pool's deficit to its capacity. */
interface InventoryWorkingDeficitBurden {
  /** Exact remaining capacity by position identity. */
  readonly capacityByPositionIdentity: ReadonlyMap<string, InventoryWorkingQuantity>;
  /** Exact total deficit in every selected pool. */
  readonly recordedDeficit: InventoryWorkingQuantity;
  /** Exact deficit left after the available capacity is used. */
  readonly uncoveredDeficit: InventoryWorkingQuantity;
}

/** Reduce published or unpublished capacity with the same per-pool liability rule. */
export function applyInventoryWorkingDeficitBurden({
  deficits,
  itemRevisionId,
  unit,
  placementNodeIds,
  lines,
}: ApplyInventoryWorkingDeficitBurdenInput): InventoryWorkingDeficitBurden {
  const selectedLocations = normalizePlacementNodeIds(placementNodeIds);
  const allLocationsSelected = selectedLocations.size === 0;
  const deficitByLocation = recordedDeficitByLocation(
    deficits,
    allLocationsSelected ? undefined : selectedLocations
  );
  /** Aggregate all pools before materializing any reported quantity. */
  const recordedDeficit: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  for (const deficit of deficitByLocation.values()) {
    addExactQuantityDigits(recordedDeficit, deficit.minor, deficit.decimals);
  }

  const capacityByPositionIdentity = new Map<string, InventoryWorkingQuantity>();
  const linesByLocation = new Map<string, InventoryWorkingDeficitCapacityLine[]>();
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

  /** Accumulate debt left after all usable capacity has been attributed. */
  const uncoveredDeficit: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  for (const placementNodeId of burdenLocations) {
    const poolDeficit = deficitByLocation.get(placementNodeId);
    if (poolDeficit === undefined) continue;
    /** Keep debt exact while every position in this pool absorbs its share. */
    let remaining: InventoryWorkingQuantity = { amountMinor: poolDeficit.minor, decimals: poolDeficit.decimals, unit };
    const locationLines = linesByLocation.get(placementNodeId) ?? [];
    for (const line of locationLines) {
      if (
        remaining.amountMinor <= 0n
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
    addExactQuantityDigits(uncoveredDeficit, BigInt(remaining.amountMinor), remaining.decimals);
  }
  return {
    capacityByPositionIdentity,
    recordedDeficit: { amountMinor: recordedDeficit.minor, decimals: recordedDeficit.decimals, unit },
    uncoveredDeficit: { amountMinor: uncoveredDeficit.minor, decimals: uncoveredDeficit.decimals, unit },
  };
}

/** Collect positive deficit magnitude by exact direct placement without assigning it to lots. */
function recordedDeficitByLocation(
  deficits: Iterable<InventorySignedDeficitRow>,
  selectedLocations: ReadonlySet<string> | undefined
): ReadonlyMap<string, ExactQuantityDigits> {
  const result = new Map<string, ExactQuantityDigits>();
  for (const { position, signed } of deficits) {
    if (
      selectedLocations !== undefined &&
      (position.placementNodeId === undefined ||
        !selectedLocations.has(position.placementNodeId))
    ) continue;
    const poolIdentity =
      selectedLocations === undefined
        ? inventoryDeficitPhysicalPoolIdentity(position)
        : position.placementNodeId!;
    const total = result.get(poolIdentity);
    if (total === undefined) result.set(poolIdentity, { minor: -BigInt(signed.amountMinor), decimals: signed.decimals });
    else addExactQuantityDigits(total, -BigInt(signed.amountMinor), signed.decimals);
  }
  return result;
}

/** Stable internal physical-pool identity for broad deficit accounting without inventing a placement. */
export function inventoryDeficitPhysicalPoolIdentity(
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
  capacity: InventoryWorkingQuantity,
  deficit: InventoryWorkingQuantity,
  allocationIncrement: InventoryWorkingQuantity | undefined
): {
  /** Capacity remaining after applying as much deficit as this line can absorb. */
  readonly capacity: InventoryWorkingQuantity;
  /** Deficit still requiring attribution to later positive capacity lines. */
  readonly remainingDeficit: InventoryWorkingQuantity;
} {
  if (compareWorkingQuantities(capacity, deficit) <= 0) {
    return {
      capacity: zeroQuantity(capacity.unit, capacity.decimals),
      remainingDeficit: subtractWorkingQuantity(deficit, capacity),
    };
  }
  const exactRemainder = subtractWorkingQuantity(capacity, deficit);
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
  value: InventoryWorkingQuantity,
  increment: InventoryWorkingQuantity
): InventoryWorkingQuantity {
  const decimals = Math.max(value.decimals, increment.decimals);
  const valueMinor = workingQuantityAtDecimals(value, decimals);
  const incrementMinor = workingQuantityAtDecimals(increment, decimals);
  // BigInt division truncates exactly; non-negative operands therefore floor without Number conversion.
  const floored = (valueMinor / incrementMinor) * incrementMinor;
  return {
    amountMinor: floored,
    decimals,
    unit: value.unit,
  };
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
  value: InventoryWorkingQuantity,
  unit: UnitCode,
  label: string
): void {
  if (value.unit !== unit) {
    throw new Error(`${label} uses a different unit.`);
  }
  if (value.amountMinor <= 0n) {
    throw new Error(`${label} must be positive.`);
  }
}
