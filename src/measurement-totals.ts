import { inventoryMeasurement, inventoryMeasurementVector, type InventoryMeasurement, type InventoryMeasurementVector } from "./measurements.js";
import type { Quantity } from "./quantity.js";
import { addExactQuantityDigits, inventoryQuantityChangeFitsStorage, materializeInventoryWorkingQuantity, type ExactQuantityDigits } from "./quantity-storage.js";

/** Temporary sum of one normalized measurement axis. */
interface InventoryMeasurementTotal extends ExactQuantityDigits {
  /** Exact unit established by normalization. */
  readonly unit: Quantity["unit"];
}

/** Exact working totals for measurements of one frozen item schema. */
export type InventoryMeasurementTotals = Map<string, InventoryMeasurementTotal>;

/** Check only changed axes on two vectors of the same frozen schema. */
export function inventoryMeasurementChangeFitsStorage(
  balance: InventoryMeasurementVector,
  change: InventoryMeasurementVector,
  sign: 1 | -1
): boolean {
  if (!inventoryQuantityChangeFitsStorage(balance.primary.quantity, change.primary.quantity, sign)) return false;
  for (const { axisId, quantity } of change.independent) {
    // A previously absent axis gains only the already storable change.
    for (const current of balance.independent) {
      if (current.axisId !== axisId) continue;
      if (!inventoryQuantityChangeFitsStorage(current.quantity, quantity, sign)) return false;
      break;
    }
  }
  return true;
}

/** Start an exact accumulator with the normalized axes and values of a vector. */
export function inventoryMeasurementTotalsFromVector(measurements: InventoryMeasurementVector): InventoryMeasurementTotals {
  const totals: InventoryMeasurementTotals = new Map();
  addInventoryMeasurementTotals(totals, measurements);
  return totals;
}

/** Add the axes of one normalized vector, optionally as a subtraction. */
export function addInventoryMeasurementTotals(
  totals: InventoryMeasurementTotals,
  { primary, independent }: InventoryMeasurementVector,
  sign: 1n | -1n = 1n
): void {
  addInventoryMeasurementTotal(totals, primary, sign);
  for (const axis of independent) addInventoryMeasurementTotal(totals, axis, sign);
}

/** Accumulate one axis at its exact scale without narrowing intermediate digits. */
function addInventoryMeasurementTotal(
  totals: InventoryMeasurementTotals,
  { axisId, quantity }: InventoryMeasurement,
  sign: 1n | -1n
): void {
  const total = totals.get(axisId);
  if (total === undefined) {
    totals.set(axisId, { minor: sign * BigInt(quantity.amountMinor), decimals: quantity.decimals, unit: quantity.unit });
    return;
  }
  addExactQuantityDigits(total, sign * BigInt(quantity.amountMinor), quantity.decimals);
}

/** Check conservation without materializing a temporary quantity. */
export function inventoryMeasurementTotalsAreZero(totals: InventoryMeasurementTotals): boolean {
  for (const total of totals.values()) if (total.minor !== 0n) return false;
  return true;
}

/** Check whether two working vectors cancel on every axis without storing either subtotal. */
export function inventoryMeasurementTotalsCancel(
  left: InventoryMeasurementTotals,
  right: InventoryMeasurementTotals
): boolean {
  for (const [axisId, total] of left) {
    const opposite = right.get(axisId);
    const sum = { minor: total.minor, decimals: total.decimals };
    if (opposite !== undefined) {
      if (opposite.unit !== total.unit) return false;
      addExactQuantityDigits(sum, opposite.minor, opposite.decimals);
    }
    if (sum.minor !== 0n) return false;
  }
  for (const [axisId, total] of right) {
    if (total.minor !== 0n && !left.has(axisId)) return false;
  }
  return true;
}

/** Store every final axis exactly, removing trailing zeros only when required. */
export function materializeInventoryMeasurementTotals(
  totals: InventoryMeasurementTotals,
  primaryAxisId: string
): InventoryMeasurementVector {
  let primary: InventoryMeasurement | undefined;
  const independent: InventoryMeasurement[] = [];
  for (const [axisId, { minor, decimals, unit }] of totals) {
    const axis = inventoryMeasurement(axisId,
      materializeInventoryWorkingQuantity({ amountMinor: minor, decimals, unit }, "Inventory measurement total"));
    if (axisId === primaryAxisId) primary = axis;
    else independent.push(axis);
  }
  if (primary === undefined) throw new Error("Inventory measurement total has no primary axis.");
  return inventoryMeasurementVector(primary, independent);
}
