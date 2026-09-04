import type {
  InventoryMetadata,
  InventoryMetadataValue,
} from "./model.js";

/** One collision-free intent-fingerprint value. Objects stay outside this shape so field order cannot leak in. */
export type InventoryIntentFingerprintValue =
  | null
  | boolean
  | number
  | string
  | readonly InventoryIntentFingerprintValue[];

/** Encode one normalized typed array without delimiter collisions or missing/empty-value ambiguity. */
export function inventoryIntentFingerprint(
  values: readonly InventoryIntentFingerprintValue[],
): string {
  assertFiniteInventoryIntentFingerprintNumbers(values);
  return JSON.stringify(values);
}

/** Stable key-sorted fingerprint for optional JSON-safe metadata. */
export function inventoryMetadataFingerprint(
  metadata: InventoryMetadata | undefined,
): string {
  if (metadata === undefined) return "";
  const keys = Object.keys(metadata);
  keys.sort();
  let result = "{";
  for (const key of keys) {
    const value = metadata[key];
    if (value === undefined) throw new Error("Inventory metadata must not contain undefined.");
    result += `${JSON.stringify(key)}:${inventoryMetadataValueFingerprint(value)},`;
  }
  return `${result}}`;
}

/** Stable recursive fingerprint for one JSON-safe metadata value. */
export function inventoryMetadataValueFingerprint(
  value: InventoryMetadataValue,
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Inventory metadata numbers must be finite.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (isInventoryMetadataArray(value)) {
    let result = "[";
    for (const child of value) {
      result += `${inventoryMetadataValueFingerprint(child)},`;
    }
    return `${result}]`;
  }
  return inventoryMetadataFingerprint(value);
}

/** Narrow one recursive JSON-safe metadata value to its array form. */
function isInventoryMetadataArray(
  value: InventoryMetadataValue,
): value is readonly InventoryMetadataValue[] {
  return Array.isArray(value);
}

/** Reject the one JSON number shape that would silently stringify as null. */
function assertFiniteInventoryIntentFingerprintNumbers(
  values: readonly InventoryIntentFingerprintValue[],
): void {
  for (const value of values) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Inventory intent fingerprint numbers must be finite.");
    }
    if (Array.isArray(value)) {
      assertFiniteInventoryIntentFingerprintNumbers(value);
    }
  }
}
