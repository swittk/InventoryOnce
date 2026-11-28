import type { Quantity } from "./quantity.js";

/** Largest absolute digit allowed in a stored quantity. */
export const MAXIMUM_STORED_QUANTITY_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** An exact arithmetic result with no durable finite-decimal representation. */
export class InventoryQuantityRepresentationError extends Error {}

/** Exact working digits before applying the storage limit. */
export interface ExactQuantityDigits {
  /** Signed digits aligned to the current decimal scale. */
  minor: bigint;
  /** Number of fractional decimal places. */
  decimals: number;
}

/** Stored or private working quantity used before a value must fit the storage range. */
export interface InventoryWorkingQuantity {
  /** Exact signed digits at the given scale. */
  readonly amountMinor: number | bigint;
  /** Number of fractional decimal places. */
  readonly decimals: number;
  /** Unit frozen by the resolved measurement schema. */
  readonly unit: Quantity["unit"];
}

/** Align working digits to an equal or greater scale without narrowing them. */
export function workingQuantityAtDecimals(value: InventoryWorkingQuantity, decimals: number): bigint {
  return BigInt(value.amountMinor) * 10n ** BigInt(decimals - value.decimals);
}

/** Return the greatest common divisor used by exact quantity ratios. */
export function quantityGreatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

/** Return the least common multiple of positive same-unit quantities before applying storage limits. */
export function leastCommonWorkingQuantityMultiple(left: Quantity, right: Quantity): InventoryWorkingQuantity {
  const decimals = Math.max(left.decimals, right.decimals);
  const leftInteger = workingQuantityAtDecimals(left, decimals);
  const rightInteger = workingQuantityAtDecimals(right, decimals);
  const divisor = quantityGreatestCommonDivisor(leftInteger, rightInteger);
  return { amountMinor: (leftInteger / divisor) * rightInteger, decimals, unit: left.unit };
}

/** Compare same-unit working balances without narrowing either one. */
export function compareWorkingQuantities(left: InventoryWorkingQuantity, right: InventoryWorkingQuantity): -1 | 0 | 1 {
  if (left.unit !== right.unit) throw new Error("Quantity units must match.");
  const decimals = Math.max(left.decimals, right.decimals);
  const difference = workingQuantityAtDecimals(left, decimals) - workingQuantityAtDecimals(right, decimals);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Subtract a private balance whose caller has already matched the units. */
export function subtractWorkingQuantity(left: InventoryWorkingQuantity, right: InventoryWorkingQuantity): InventoryWorkingQuantity {
  const total: ExactQuantityDigits = { minor: BigInt(left.amountMinor), decimals: left.decimals };
  addExactQuantityDigits(total, -BigInt(right.amountMinor), right.decimals);
  return { amountMinor: total.minor, decimals: total.decimals, unit: left.unit };
}

/** Decide whether a signed change leaves a storable balance without materializing it. */
export function inventoryQuantityChangeFitsStorage(
  balance: Quantity,
  change: Quantity,
  sign: 1 | -1
): boolean {
  if (balance.decimals === change.decimals &&
      Number.isSafeInteger(balance.amountMinor + sign * change.amountMinor)) return true;
  const decimals = Math.max(balance.decimals, change.decimals);
  const minor = workingQuantityAtDecimals(balance, decimals) +
    BigInt(sign) * workingQuantityAtDecimals(change, decimals);
  return storableQuantityScale(minor, decimals) !== undefined;
}

/** Materialize an exact working quantity only when the returned digits fit storage. */
export function materializeInventoryWorkingQuantity(value: InventoryWorkingQuantity, label: string): Quantity {
  const stored = storableQuantityDigits(BigInt(value.amountMinor), value.decimals);
  if (stored === undefined) throw new Error(`${label} exceeds the safe integer storage range.`);
  return { ...stored, unit: value.unit };
}

/** Add signed digits at the least scale that retains both quantities exactly. */
export function addExactQuantityDigits(total: ExactQuantityDigits, minor: bigint, decimals: number): void {
  if (decimals > total.decimals) {
    total.minor *= 10n ** BigInt(decimals - total.decimals);
    total.decimals = decimals;
  }
  total.minor += decimals === total.decimals ? minor : minor * (10n ** BigInt(total.decimals - decimals));
}

/** Safe integer digits and the exact scale that goes with them. */
interface StorableQuantityDigits {
  /** Signed digits that fit a stored quantity. */
  readonly amountMinor: number;
  /** Scale after removing only the trailing zeros required by storage. */
  readonly decimals: number;
}

/** Narrow a completed exact value only when every significant digit fits. */
export function storableQuantityDigits(minor: bigint, decimals: number): StorableQuantityDigits | undefined {
  const scale = storableQuantityScale(minor, decimals);
  if (scale === undefined) return undefined;
  const narrowed = scale === decimals ? minor : minor / (10n ** BigInt(decimals - scale));
  return { amountMinor: Number(narrowed), decimals: scale };
}

/** Keep the original scale unless exact trailing zeros must be removed. */
export function storableQuantityScale(minor: bigint, decimals: number): number | undefined {
  while (minor > MAXIMUM_STORED_QUANTITY_MINOR || minor < -MAXIMUM_STORED_QUANTITY_MINOR) {
    if (decimals === 0 || minor % 10n !== 0n) return undefined;
    minor /= 10n;
    decimals -= 1;
  }
  return decimals;
}
