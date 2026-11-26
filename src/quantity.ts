/** Exact physical-quantity arithmetic. InventoryOnce never uses epsilon comparisons. */
import { leastCommonWorkingQuantityMultiple, quantityGreatestCommonDivisor, storableQuantityDigits } from "./quantity-storage.js";

declare const unitCodeBrand: unique symbol;

/** Largest decimal scale accepted for one durable physical quantity. */
export const MAXIMUM_QUANTITY_DECIMALS = 18;

/** Validated opaque unit identity. UCUM codes are recommended but not required. */
export type UnitCode = string & {
  /** Compile-time marker preventing unchecked strings from becoming unit codes. */
  readonly [unitCodeBrand]: "unit-code";
};

/** JSON-friendly exact finite-decimal physical quantity. */
export interface Quantity {
  /** Signed safe integer containing every significant digit. */
  readonly amountMinor: number;
  /** Number of decimal places represented by `amountMinor`. */
  readonly decimals: number;
  /** Explicit physical unit; InventoryOnce never guesses one. */
  readonly unit: UnitCode;
}

/** Unchecked JSON-friendly fields accepted by the exact quantity constructor. */
export interface QuantityInput {
  /** Signed integer containing every significant digit. */
  readonly amountMinor: number;
  /** Number of digits represented after the decimal point. */
  readonly decimals: number;
  /** Unit text validated by the constructor. */
  readonly unit: string;
}

/** Positive exact conversion ratio expressed as target units per source unit. */
export interface QuantityRatio {
  /** Positive integer on top of the reduced conversion ratio. */
  readonly numerator: number;
  /** Positive integer on the bottom of the reduced conversion ratio. */
  readonly denominator: number;
}

/** Validate one non-empty unit code without imposing an application vocabulary. */
export function unitCode(value: string): UnitCode {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("Quantity unit must not be empty.");
  return normalized as UnitCode;
}

/** Validate an exact quantity without inferring its scale or unit. */
export function quantity(input: QuantityInput): Quantity {
  assertSafeInteger(input.amountMinor, "Quantity amountMinor");
  assertDecimals(input.decimals);
  return {
    amountMinor: input.amountMinor,
    decimals: input.decimals,
    unit: unitCode(input.unit),
  };
}

/** Parse plain decimal text exactly without exponent notation or binary floating-point math. */
export function parseQuantity(value: string, unit: string): Quantity {
  const normalized = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("Quantity text must be a plain decimal number.");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2];
  const fraction = match[3] ?? "";
  if (!whole || fraction.length > MAXIMUM_QUANTITY_DECIMALS) {
    throw new Error("Quantity text has too many decimal places.");
  }
  const digitText = `${whole}${fraction}`;
  const significantDigits = digitText.replace(/^0+/u, "") || "0";
  if (significantDigits.length > String(Number.MAX_SAFE_INTEGER).length) {
    throw new Error("Quantity text exceeds the safe integer storage range.");
  }
  const digits = BigInt(significantDigits) * sign;
  return quantity({
    amountMinor: safeNumber(digits, "Quantity text"),
    decimals: fraction.length,
    unit,
  });
}

/** Render one exact finite-decimal quantity as plain text without exponent notation. */
export function quantityToDecimalString(value: Quantity): string {
  const negative = value.amountMinor < 0;
  const absoluteDigits = String(Math.abs(value.amountMinor)).padStart(value.decimals + 1, "0");
  if (value.decimals === 0) return `${negative ? "-" : ""}${absoluteDigits}`;
  const wholeEnd = absoluteDigits.length - value.decimals;
  const whole = absoluteDigits.slice(0, wholeEnd);
  const fraction = absoluteDigits.slice(wholeEnd);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Create exact zero in an explicitly named unit and scale. */
export function zeroQuantity(unit: string, decimals = 0): Quantity {
  return quantity({ amountMinor: 0, decimals, unit });
}

/** Require a strictly positive quantity before it becomes a real stock movement/count. */
export function positiveQuantity(value: Quantity, label = "Quantity"): Quantity {
  if (value.amountMinor <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

/** Require two quantities to name exactly the same physical unit. */
export function assertSameUnit(left: Quantity, right: Quantity): void {
  if (left.unit !== right.unit) throw new Error("Quantity units must match.");
}

/** Compare same-unit exact quantities after aligning their decimal scales. */
export function compareQuantity(left: Quantity, right: Quantity): -1 | 0 | 1 {
  assertSameUnit(left, right);
  const decimals = Math.max(left.decimals, right.decimals);
  const leftInteger = integerAtDecimals(left, decimals);
  const rightInteger = integerAtDecimals(right, decimals);
  if (leftInteger < rightInteger) return -1;
  if (leftInteger > rightInteger) return 1;
  return 0;
}

/** Return whether two same-unit quantities have the same exact numeric value. */
export function quantityEq(left: Quantity, right: Quantity): boolean {
  return left.unit === right.unit && compareQuantity(left, right) === 0;
}

/** Add two exact same-unit quantities without discarding decimal digits. */
export function addQuantity(left: Quantity, right: Quantity): Quantity {
  assertSameUnit(left, right);
  const decimals = Math.max(left.decimals, right.decimals);
  return quantityAtStorableScale(
    integerAtDecimals(left, decimals) + integerAtDecimals(right, decimals),
    decimals, left.unit, "Quantity addition",
  );
}

/** Subtract two exact same-unit quantities without discarding decimal digits. */
export function subtractQuantity(left: Quantity, right: Quantity): Quantity {
  assertSameUnit(left, right);
  const decimals = Math.max(left.decimals, right.decimals);
  return quantityAtStorableScale(
    integerAtDecimals(left, decimals) - integerAtDecimals(right, decimals),
    decimals, left.unit, "Quantity subtraction",
  );
}

/** Store an exact arithmetic result without discarding any significant digits. */
function quantityAtStorableScale(minor: bigint, decimals: number, unit: UnitCode, label: string): Quantity {
  const stored = storableQuantityDigits(minor, decimals);
  if (stored === undefined) throw new Error(`${label} exceeds the safe integer storage range.`);
  return quantity({ ...stored, unit });
}

/** Flip the sign of one exact quantity without changing its unit/scale. */
export function negateQuantity(value: Quantity): Quantity {
  return quantity({
    amountMinor: -value.amountMinor,
    decimals: value.decimals,
    unit: value.unit,
  });
}

/** Multiply one exact quantity by a safe whole number without floating-point math. */
export function multiplyQuantityByWholeNumber(
  value: Quantity,
  multiplier: number,
): Quantity {
  assertSafeInteger(multiplier, "Quantity whole-number multiplier");
  return quantityAtStorableScale(
    BigInt(value.amountMinor) * BigInt(multiplier),
    value.decimals,
    value.unit,
    "Quantity whole-number multiplication",
  );
}

/** Multiply by an exact positive target-unit-per-source-unit factor. */
export function multiplyQuantityByFactor(
  value: Quantity,
  factor: Quantity,
): Quantity {
  positiveQuantity(factor, "Quantity factor");
  const decimals = value.decimals + factor.decimals;
  assertDecimals(decimals);
  return quantity({
    amountMinor: safeNumber(
      BigInt(value.amountMinor) * BigInt(factor.amountMinor),
      "Quantity factor multiplication",
    ),
    decimals,
    unit: factor.unit,
  });
}

/** Return whether a same-unit quantity is an exact whole-number multiple of another positive quantity. */
export function quantityIsWholeMultipleOf(
  value: Quantity,
  oneWholeUnit: Quantity,
): boolean {
  assertSameUnit(value, oneWholeUnit);
  positiveQuantity(oneWholeUnit, "Whole-unit quantity");
  const decimals = Math.max(value.decimals, oneWholeUnit.decimals);
  const valueInteger = integerAtDecimals(value, decimals);
  const wholeUnitInteger = integerAtDecimals(oneWholeUnit, decimals);
  return valueInteger % wholeUnitInteger === 0n;
}

/** Return the exact non-negative whole-number multiple or fail when the ratio is fractional. */
export function quantityWholeMultipleCount(
  value: Quantity,
  oneWholeUnit: Quantity,
): number {
  assertSameUnit(value, oneWholeUnit);
  positiveQuantity(oneWholeUnit, "Whole-unit quantity");
  if (value.amountMinor < 0) throw new Error("Whole-unit quantity value must not be negative.");
  const decimals = Math.max(value.decimals, oneWholeUnit.decimals);
  const valueInteger = integerAtDecimals(value, decimals);
  const wholeUnitInteger = integerAtDecimals(oneWholeUnit, decimals);
  if (valueInteger % wholeUnitInteger !== 0n) {
    throw new Error("Quantity is not a whole-number multiple of the requested unit.");
  }
  return safeNumber(valueInteger / wholeUnitInteger, "Whole-unit quantity count");
}

/** Return the least positive exact common multiple at the closest storable scale. */
export function leastCommonQuantityMultiple(
  left: Quantity,
  right: Quantity,
): Quantity {
  assertSameUnit(left, right);
  positiveQuantity(left, "Left quantity multiple");
  positiveQuantity(right, "Right quantity multiple");
  const multiple = leastCommonWorkingQuantityMultiple(left, right);
  return quantityAtStorableScale(
    BigInt(multiple.amountMinor), multiple.decimals, multiple.unit, "Least common quantity multiple",
  );
}

/** Validate and reduce one positive safe-integer conversion ratio. */
export function quantityRatio(numerator: number, denominator = 1): QuantityRatio {
  assertSafeInteger(numerator, "Quantity ratio numerator");
  assertSafeInteger(denominator, "Quantity ratio denominator");
  if (numerator <= 0 || denominator <= 0) {
    throw new Error("Quantity conversion ratio must be positive.");
  }
  const divisor = quantityGreatestCommonDivisor(BigInt(numerator), BigInt(denominator));
  return {
    numerator: safeNumber(BigInt(numerator) / divisor, "Quantity ratio numerator"),
    denominator: safeNumber(BigInt(denominator) / divisor, "Quantity ratio denominator"),
  };
}

/** Convert exactly through a rational ratio and reject non-terminating decimal results. */
export function convertQuantityExact(
  value: Quantity,
  targetUnit: string,
  ratio: QuantityRatio,
): Quantity {
  const checkedRatio = quantityRatio(ratio.numerator, ratio.denominator);
  return exactFractionQuantity(
    BigInt(value.amountMinor) * BigInt(checkedRatio.numerator),
    powerOfTen(value.decimals) * BigInt(checkedRatio.denominator),
    targetUnit,
    "Quantity conversion",
  );
}

/**
 * Convert by one exact reference equivalence such as `1 old tablet = 2 dose-equivalents`.
 * The source value must use the source-reference unit; no floating-point ratio is introduced.
 */
export function convertQuantityByReferenceExact(
  value: Quantity,
  sourceReference: Quantity,
  targetReference: Quantity,
): Quantity {
  assertSameUnit(value, sourceReference);
  positiveQuantity(sourceReference, "Source reference quantity");
  positiveQuantity(targetReference, "Target reference quantity");
  const numerator =
    BigInt(value.amountMinor) *
    BigInt(targetReference.amountMinor) *
    powerOfTen(sourceReference.decimals);
  const denominator =
    powerOfTen(value.decimals) *
    powerOfTen(targetReference.decimals) *
    BigInt(sourceReference.amountMinor);
  return exactFractionQuantity(
    numerator,
    denominator,
    targetReference.unit,
    "Reference quantity conversion",
  );
}

/** Convert one exact rational number to a finite-decimal quantity or fail closed. */
function exactFractionQuantity(
  rawNumerator: bigint,
  rawDenominator: bigint,
  targetUnit: string,
  label: string,
): Quantity {
  if (rawDenominator <= 0n) {
    throw new Error(`${label} denominator must be positive.`);
  }
  let numerator = rawNumerator;
  let denominator = rawDenominator;
  const divisor = quantityGreatestCommonDivisor(abs(numerator), denominator);
  numerator /= divisor;
  denominator /= divisor;

  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) {
    throw new Error(`${label} has a non-terminating decimal result.`);
  }
  const decimals = Math.max(twos, fives);
  assertDecimals(decimals);
  const scaled =
    numerator *
    (2n ** BigInt(decimals - twos)) *
    (5n ** BigInt(decimals - fives));
  return quantity({
    amountMinor: safeNumber(scaled, label),
    decimals,
    unit: targetUnit,
  });
}

/** Convert one quantity's digits to a larger requested decimal scale without rounding. */
export function integerAtDecimals(
  value: Quantity,
  targetDecimals: number,
): bigint {
  assertDecimals(targetDecimals);
  if (targetDecimals < value.decimals) {
    throw new Error("Target decimals cannot remove exact quantity digits.");
  }
  return BigInt(value.amountMinor) * powerOfTen(targetDecimals - value.decimals);
}

/** Return a non-negative bigint without converting through floating point. */
function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Return ten to one validated non-negative decimal power. */
function powerOfTen(power: number): bigint {
  assertDecimals(power);
  return 10n ** BigInt(power);
}

/** Return one bigint as a public safe integer or fail instead of losing digits. */
export function safeNumber(value: bigint, label: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`${label} exceeds the safe integer storage range.`);
  }
  return converted;
}

/** Reject fractional/unsafe integer inputs used by exact quantity storage. */
function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
}

/** Reject invalid or impractically large decimal scales. */
function assertDecimals(decimals: number): void {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > MAXIMUM_QUANTITY_DECIMALS
  ) {
    throw new Error(
      `Quantity decimals must be an integer from 0 through ${MAXIMUM_QUANTITY_DECIMALS}.`,
    );
  }
}
