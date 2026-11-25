import { inventoryIntentFingerprint } from "./canonical.js";
import { compareInventoryIdentityText } from "./ordering.js";
import { compareWorkingQuantities } from "./quantity-storage.js";
import {
  addQuantity,
  compareQuantity,
  integerAtDecimals,
  multiplyQuantityByWholeNumber,
  negateQuantity,
  positiveQuantity,
  quantity,
  quantityEq,
  quantityIsWholeMultipleOf,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
  type UnitCode,
} from "./quantity.js";

/** Generic item-measurement axis identity such as `pieces`, `volume`, or `weight`. */
export type InventoryMeasurementAxisId = string;

/** One exact measured amount on one item-defined axis. */
export interface InventoryMeasurement {
  /** Item-defined axis identity. */
  readonly axisId: InventoryMeasurementAxisId;
  /** Exact amount and physical unit on that axis. */
  readonly quantity: Quantity;
}

/**
 * Exact vector for one inventory resource.
 * The primary axis controls stock/reservation availability; independent axes are measured separately.
 */
export interface InventoryMeasurementVector {
  /** Required primary stock axis. */
  readonly primary: InventoryMeasurement;
  /** Optional independently measured axes sorted by axis identity. */
  readonly independent: readonly InventoryMeasurement[];
}

/** Plain record accepted by the ergonomic measured-stock helper. */
export interface InventoryIndependentMeasurementInput {
  /** Item-defined independent axis identity. */
  readonly axisId: InventoryMeasurementAxisId;
  /** Exact measured amount on that axis. */
  readonly quantity: Quantity;
}

/** Build one validated measurement axis/value pair. */
export function inventoryMeasurement(
  axisId: InventoryMeasurementAxisId,
  measuredQuantity: Quantity,
): InventoryMeasurement {
  const trimmedAxisId = axisId.trim();
  if (trimmedAxisId.length === 0) throw new Error("Measurement axisId must not be empty.");
  if (trimmedAxisId !== axisId) {
    throw new Error("Measurement axisId must not contain surrounding whitespace.");
  }
  return { axisId, quantity: { ...measuredQuantity } };
}

/** Build and normalize one primary-plus-independent measurement vector. */
export function inventoryMeasurementVector(
  primary: InventoryMeasurement,
  independent: readonly InventoryIndependentMeasurementInput[] = [],
): InventoryMeasurementVector {
  const normalizedPrimary = inventoryMeasurement(primary.axisId, primary.quantity);
  const normalizedIndependent: InventoryMeasurement[] = [];
  for (const measured of independent) {
    if (measured.axisId === normalizedPrimary.axisId) {
      throw new Error("Independent measurement cannot reuse the primary axisId.");
    }
    normalizedIndependent.push(inventoryMeasurement(measured.axisId, measured.quantity));
  }
  normalizedIndependent.sort(compareMeasurementAxis);
  let previousAxisId: string | undefined;
  for (const measured of normalizedIndependent) {
    if (measured.axisId === previousAxisId) {
      throw new Error(`Duplicate measurement axis '${measured.axisId}'.`);
    }
    previousAxisId = measured.axisId;
  }
  return { primary: normalizedPrimary, independent: normalizedIndependent };
}

/** Build a primary-only vector for ordinary single-unit stock. */
export function scalarInventoryMeasurements(
  axisId: InventoryMeasurementAxisId,
  measuredQuantity: Quantity,
): InventoryMeasurementVector {
  return inventoryMeasurementVector(inventoryMeasurement(axisId, measuredQuantity));
}

/** Return one axis quantity, treating an absent independent axis as exact zero in the requested unit. */
export function inventoryMeasurementAt(
  vector: InventoryMeasurementVector,
  axisId: InventoryMeasurementAxisId,
  unit: UnitCode,
): Quantity {
  if (vector.primary.axisId === axisId) {
    if (vector.primary.quantity.unit !== unit) {
      throw new Error(`Measurement axis '${axisId}' uses a different unit.`);
    }
    return vector.primary.quantity;
  }
  for (const measured of vector.independent) {
    if (measured.axisId !== axisId) continue;
    if (measured.quantity.unit !== unit) {
      throw new Error(`Measurement axis '${axisId}' uses a different unit.`);
    }
    return measured.quantity;
  }
  return zeroQuantity(unit);
}

/** Add two same-schema vectors without losing independently measured axes. */
export function addInventoryMeasurements(
  left: InventoryMeasurementVector,
  right: InventoryMeasurementVector,
): InventoryMeasurementVector {
  assertSamePrimaryMeasurementAxis(left, right);
  const primary = inventoryMeasurement(
    left.primary.axisId,
    addQuantity(left.primary.quantity, right.primary.quantity),
  );
  const independentByAxis = new Map<string, Quantity>();
  for (const measured of left.independent) {
    independentByAxis.set(measured.axisId, measured.quantity);
  }
  for (const measured of right.independent) {
    const earlier = independentByAxis.get(measured.axisId);
    independentByAxis.set(
      measured.axisId,
      earlier === undefined ? measured.quantity : addQuantity(earlier, measured.quantity),
    );
  }
  const independent: InventoryMeasurement[] = [];
  for (const [axisId, measuredQuantity] of independentByAxis) {
    independent.push(inventoryMeasurement(axisId, measuredQuantity));
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Subtract two same-schema vectors without losing independently measured axes. */
export function subtractInventoryMeasurements(
  left: InventoryMeasurementVector,
  right: InventoryMeasurementVector,
): InventoryMeasurementVector {
  return addInventoryMeasurements(left, negateInventoryMeasurements(right));
}

/** Flip every axis sign without changing axis/unit identity. */
export function negateInventoryMeasurements(
  value: InventoryMeasurementVector,
): InventoryMeasurementVector {
  const primary = inventoryMeasurement(
    value.primary.axisId,
    negateQuantity(value.primary.quantity),
  );
  const independent: InventoryMeasurement[] = [];
  for (const measured of value.independent) {
    independent.push(inventoryMeasurement(
      measured.axisId,
      negateQuantity(measured.quantity),
    ));
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Create exact zero using the complete axis/unit schema of another vector. */
export function zeroInventoryMeasurements(
  schema: InventoryMeasurementVector,
): InventoryMeasurementVector {
  const primary = inventoryMeasurement(
    schema.primary.axisId,
    zeroQuantity(schema.primary.quantity.unit, schema.primary.quantity.decimals),
  );
  const independent: InventoryMeasurement[] = [];
  for (const measured of schema.independent) {
    independent.push(inventoryMeasurement(
      measured.axisId,
      zeroQuantity(measured.quantity.unit, measured.quantity.decimals),
    ));
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Return whether every axis is exactly zero. */
export function inventoryMeasurementsAreZero(
  value: InventoryMeasurementVector,
): boolean {
  if (!quantityEq(
    value.primary.quantity,
    zeroQuantity(value.primary.quantity.unit, value.primary.quantity.decimals),
  )) return false;
  for (const measured of value.independent) {
    if (!quantityEq(
      measured.quantity,
      zeroQuantity(measured.quantity.unit, measured.quantity.decimals),
    )) return false;
  }
  return true;
}

/** Require a positive primary amount and non-negative independent measurements. */
export function positiveInventoryMeasurements(
  value: InventoryMeasurementVector,
  label = "Inventory measurements",
): InventoryMeasurementVector {
  positiveQuantity(value.primary.quantity, `${label} primary quantity`);
  for (const measured of value.independent) {
    if (compareQuantity(
      measured.quantity,
      zeroQuantity(measured.quantity.unit, measured.quantity.decimals),
    ) < 0) {
      throw new Error(`${label} axis '${measured.axisId}' must not be negative.`);
    }
  }
  return value;
}

/** Require every axis to be non-negative; zero primary requires every independent axis to be zero. */
export function nonNegativeInventoryMeasurements(
  value: InventoryMeasurementVector,
  label = "Inventory measurements",
): InventoryMeasurementVector {
  if (compareQuantity(
    value.primary.quantity,
    zeroQuantity(value.primary.quantity.unit, value.primary.quantity.decimals),
  ) < 0) {
    throw new Error(`${label} primary quantity must not be negative.`);
  }
  for (const measured of value.independent) {
    if (compareQuantity(
      measured.quantity,
      zeroQuantity(measured.quantity.unit, measured.quantity.decimals),
    ) < 0) {
      throw new Error(`${label} axis '${measured.axisId}' must not be negative.`);
    }
  }
  if (
    quantityEq(
      value.primary.quantity,
      zeroQuantity(value.primary.quantity.unit, value.primary.quantity.decimals),
    ) &&
    !inventoryMeasurementsAreZero(value)
  ) {
    throw new Error(`${label} cannot keep independent measurements after primary stock reaches zero.`);
  }
  return value;
}

/** Return whether two vectors carry exactly equal values on every axis. */
export function inventoryMeasurementsEqual(
  left: InventoryMeasurementVector,
  right: InventoryMeasurementVector,
): boolean {
  if (left.primary.axisId !== right.primary.axisId) return false;
  if (!quantityEq(left.primary.quantity, right.primary.quantity)) return false;
  if (left.independent.length !== right.independent.length) return false;
  for (let index = 0; index < left.independent.length; index += 1) {
    const leftMeasured = left.independent[index];
    const rightMeasured = right.independent[index];
    if (leftMeasured === undefined || rightMeasured === undefined) return false;
    if (leftMeasured.axisId !== rightMeasured.axisId) return false;
    if (!quantityEq(leftMeasured.quantity, rightMeasured.quantity)) return false;
  }
  return true;
}

/** Multiply every axis by one exact positive whole-number package/resource count. */
export function multiplyInventoryMeasurementsByWholeNumber(
  value: InventoryMeasurementVector,
  multiplier: number,
): InventoryMeasurementVector {
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
    throw new Error("Inventory measurement multiplier must be a positive safe integer.");
  }
  const primary = inventoryMeasurement(
    value.primary.axisId,
    multiplyQuantityByWholeNumber(value.primary.quantity, multiplier),
  );
  const independent: InventoryMeasurement[] = [];
  for (const measured of value.independent) {
    independent.push(inventoryMeasurement(
      measured.axisId,
      multiplyQuantityByWholeNumber(measured.quantity, multiplier),
    ));
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Require a vector to represent a whole number of one exact package/resource contents vector. */
export function assertWholeMeasurementMultiple(
  value: InventoryMeasurementVector,
  oneWhole: InventoryMeasurementVector,
): void {
  assertSamePrimaryMeasurementAxis(value, oneWhole);
  if (!quantityIsWholeMultipleOf(value.primary.quantity, oneWhole.primary.quantity)) {
    throw new Error("Primary quantity is not a whole multiple of the exact package/resource contents.");
  }
  const primaryDecimals = Math.max(
    value.primary.quantity.decimals,
    oneWhole.primary.quantity.decimals,
  );
  const valuePrimaryMinor = integerAtDecimals(value.primary.quantity, primaryDecimals);
  const wholePrimaryMinor = integerAtDecimals(oneWhole.primary.quantity, primaryDecimals);
  const packageCount = valuePrimaryMinor / wholePrimaryMinor;
  for (const wholeMeasured of oneWhole.independent) {
    const actual = inventoryMeasurementAt(
      value,
      wholeMeasured.axisId,
      wholeMeasured.quantity.unit,
    );
    // The product can exceed safe digits at its original scale even when the posted total fits.
    const expected = {
      amountMinor: BigInt(wholeMeasured.quantity.amountMinor) * packageCount,
      decimals: wholeMeasured.quantity.decimals,
      unit: wholeMeasured.quantity.unit,
    };
    if (compareWorkingQuantities(actual, expected) !== 0) {
      throw new Error(
        `Independent axis '${wholeMeasured.axisId}' does not match the same whole package count.`,
      );
    }
  }
}

/** Stable deterministic text for idempotency fingerprints and durable comparisons. */
export function inventoryMeasurementsFingerprint(
  value: InventoryMeasurementVector,
): string {
  return inventoryIntentFingerprint([
    measurementFingerprint(value.primary),
    value.independent.map(measurementFingerprint),
  ]);
}

/** Compare two normalized measurements by axis identity. */
function compareMeasurementAxis(
  left: InventoryMeasurement,
  right: InventoryMeasurement,
): number {
  return compareInventoryIdentityText(left.axisId, right.axisId);
}

/** Require the same primary axis/unit before vector arithmetic. */
function assertSamePrimaryMeasurementAxis(
  left: InventoryMeasurementVector,
  right: InventoryMeasurementVector,
): void {
  if (left.primary.axisId !== right.primary.axisId) {
    throw new Error("Inventory measurement primary axisIds must match.");
  }
  if (left.primary.quantity.unit !== right.primary.quantity.unit) {
    throw new Error("Inventory measurement primary units must match.");
  }
}

/** Stable deterministic text for one axis/value pair. */
function measurementFingerprint(value: InventoryMeasurement): string {
  return inventoryIntentFingerprint([
    value.axisId,
    value.quantity.amountMinor,
    value.quantity.decimals,
    value.quantity.unit,
  ]);
}

/** Require every non-zero independent axis to have the same sign as the primary balance. */
export function assertInventoryMeasurementsFollowPrimarySign(
  value: InventoryMeasurementVector,
  label = "Inventory measurements",
): void {
  const primaryZero = zeroQuantity(
    value.primary.quantity.unit,
    value.primary.quantity.decimals,
  );
  const primaryComparison = compareQuantity(value.primary.quantity, primaryZero);
  for (const measured of value.independent) {
    const comparison = compareQuantity(
      measured.quantity,
      zeroQuantity(measured.quantity.unit, measured.quantity.decimals),
    );
    if (primaryComparison === 0 && comparison !== 0) {
      throw new Error(`${label} cannot retain axis '${measured.axisId}' when primary is zero.`);
    }
    if (primaryComparison > 0 && comparison < 0) {
      throw new Error(`${label} axis '${measured.axisId}' cannot be negative while primary is positive.`);
    }
    if (primaryComparison < 0 && comparison > 0) {
      throw new Error(`${label} axis '${measured.axisId}' cannot be positive while primary is negative.`);
    }
  }
}
