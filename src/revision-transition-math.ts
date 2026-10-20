import {
  MAXIMUM_QUANTITY_DECIMALS,
  positiveQuantity,
  quantity,
  type Quantity,
} from "./quantity.js";

/** Compute an exact unit conversion without floating point, guessing, or rounding. */
export function convertInventoryRevisionQuantity(
  current: Quantity,
  sourceUnit: Quantity,
  targetUnit: Quantity,
): Quantity {
  positiveQuantity(current, "Revision-transition source quantity");
  positiveQuantity(sourceUnit, "Revision-transition source-unit ratio");
  positiveQuantity(targetUnit, "Revision-transition target-unit ratio");
  if (current.unit !== sourceUnit.unit) {
    throw new Error("Revision-transition source quantity uses a different unit from the conversion ratio.");
  }

  // (stock / 10^stock.decimals) *
  // (target / 10^target.decimals) / (source / 10^source.decimals).
  const numerator = BigInt(current.amountMinor) *
    BigInt(targetUnit.amountMinor) * (10n ** BigInt(sourceUnit.decimals));
  const denominator = BigInt(sourceUnit.amountMinor) *
    (10n ** BigInt(current.decimals + targetUnit.decimals));
  for (let decimals = 0; decimals <= MAXIMUM_QUANTITY_DECIMALS; decimals += 1) {
    const scaled = numerator * (10n ** BigInt(decimals));
    if (scaled % denominator !== 0n) continue;
    const minor = scaled / denominator;
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Revision-transition result exceeds exact safe-integer quantity range.");
    }
    return quantity({
      amountMinor: Number(minor),
      decimals,
      unit: targetUnit.unit,
    });
  }
  throw new Error("Revision-transition conversion needs rounding or exceeds the supported exact decimal scale.");
}
