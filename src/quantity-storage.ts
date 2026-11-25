/** Largest absolute digit allowed in a stored quantity. */
export const MAXIMUM_STORED_QUANTITY_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** Exact working digits before applying the storage limit. */
export interface ExactQuantityDigits {
  /** Signed digits aligned to the current decimal scale. */
  minor: bigint;
  /** Number of fractional decimal places. */
  decimals: number;
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
