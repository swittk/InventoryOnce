/** Largest absolute digit allowed in a stored quantity. */
export const MAXIMUM_STORED_QUANTITY_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** Keep the original scale unless exact trailing zeros must be removed. */
export function storableQuantityScale(minor: bigint, decimals: number): number | undefined {
  while (minor > MAXIMUM_STORED_QUANTITY_MINOR || minor < -MAXIMUM_STORED_QUANTITY_MINOR) {
    if (decimals === 0 || minor % 10n !== 0n) return undefined;
    minor /= 10n;
    decimals -= 1;
  }
  return decimals;
}
