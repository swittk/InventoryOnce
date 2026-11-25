import { inventoryMeasurement, inventoryMeasurementVector, type InventoryMeasurement, type InventoryMeasurementVector } from "./measurements.js";
import { quantity, type Quantity } from "./quantity.js";
import { addExactQuantityDigits, storableQuantityDigits, type ExactQuantityDigits } from "./quantity-storage.js";

/** Temporary sum of one normalized measurement axis. */
interface InventoryMeasurementTotal extends ExactQuantityDigits {
  /** Exact unit established by normalization. */
  readonly unit: Quantity["unit"];
}

/** Exact working totals for measurements of one frozen item schema. */
export type InventoryMeasurementTotals = Map<string, InventoryMeasurementTotal>;

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

/** Store every final axis exactly, removing trailing zeros only when required. */
export function materializeInventoryMeasurementTotals(
  totals: InventoryMeasurementTotals,
  primaryAxisId: string
): InventoryMeasurementVector {
  let primary: InventoryMeasurement | undefined;
  const independent: InventoryMeasurement[] = [];
  for (const [axisId, { minor, decimals, unit }] of totals) {
    const stored = storableQuantityDigits(minor, decimals);
    if (stored === undefined) throw new Error("Inventory measurement total exceeds the safe integer storage range.");
    const axis = inventoryMeasurement(axisId, quantity({ ...stored, unit }));
    if (axisId === primaryAxisId) primary = axis;
    else independent.push(axis);
  }
  if (primary === undefined) throw new Error("Inventory measurement total has no primary axis.");
  return inventoryMeasurementVector(primary, independent);
}
