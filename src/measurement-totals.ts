import { inventoryMeasurement, inventoryMeasurementVector, type InventoryMeasurement, type InventoryMeasurementVector } from "./measurements.js";
import { integerAtDecimals, quantity, safeNumber, type Quantity } from "./quantity.js";
import { storableQuantityScale } from "./quantity-storage.js";

/** Temporary sum of one normalized measurement axis. */
interface InventoryMeasurementTotal {
  /** Signed digits before applying the stored quantity limit. */
  minor: bigint;
  /** Scale required by the terms already added. */
  decimals: number;
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
  if (quantity.decimals > total.decimals) {
    total.minor *= 10n ** BigInt(quantity.decimals - total.decimals);
    total.decimals = quantity.decimals;
  }
  total.minor += sign * integerAtDecimals(quantity, total.decimals);
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
    const scale = storableQuantityScale(minor, decimals) ?? decimals;
    const digits = minor / (10n ** BigInt(decimals - scale));
    const axis = inventoryMeasurement(axisId, quantity({
      amountMinor: safeNumber(digits, "Inventory measurement total"), decimals: scale, unit,
    }));
    if (axisId === primaryAxisId) primary = axis;
    else independent.push(axis);
  }
  if (primary === undefined) throw new Error("Inventory measurement total has no primary axis.");
  return inventoryMeasurementVector(primary, independent);
}
