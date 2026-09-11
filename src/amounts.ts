import { assertInventoryAmountKind } from "./stock-amount-rules.js";
import {
  assertMeasurementsMatchItem,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
  type InventoryPackagingDefinitionRevision,
} from "./catalog.js";
import {
  addInventoryMeasurements,
  inventoryMeasurement,
  inventoryMeasurementVector,
  inventoryMeasurementsEqual,
  multiplyInventoryMeasurementsByWholeNumber,
  positiveInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurement,
  type InventoryMeasurementVector,
} from "./measurements.js";
import type { ItemId, ItemRevisionId } from "./model.js";
import {
  parseQuantity,
  quantityToDecimalString,
  quantityWholeMultipleCount,
} from "./quantity.js";

/** Exact plain-decimal amount on one independently measured item axis. */
export interface InventoryIndependentAmountInput {
  /** Item-defined independent axis identity. */
  readonly axisId: string;
  /** Exact plain-decimal text; exponent/binary-float input is intentionally absent. */
  readonly value: string;
  /** Physical unit expected by the item definition. */
  readonly unit: string;
}

/** Whether one public amount is direct item measurement or an exact whole package count. */
export enum InventoryAmountKind {
  /** Caller supplied primary plus optional independent item measurements. */
  Measured = "measured",
  /** Caller supplied a whole count of one exact frozen package revision. */
  Package = "package",
}

/** Direct item-axis amount accepted by commands. */
export interface InventoryMeasuredAmount {
  /** Discriminator for direct item measurements. */
  readonly kind: InventoryAmountKind.Measured;
  /** Exact primary-axis amount text. */
  readonly primaryValue: string;
  /** Primary physical unit. */
  readonly primaryUnit: string;
  /** Independently measured axes such as actual catch weight. */
  readonly independent: readonly InventoryIndependentAmountInput[];
}

/** Whole count of one exact frozen package revision accepted by commands. */
export interface InventoryPackageAmount {
  /** Discriminator for exact package count. */
  readonly kind: InventoryAmountKind.Package;
  /** Positive safe whole package count. */
  readonly count: number;
  /** Exact immutable package revision; human unit text alone is never enough. */
  readonly packagingRevisionId: string;
  /** Independently observed axes not fixed by the package definition. */
  readonly independent: readonly InventoryIndependentAmountInput[];
}

/** Public amount accepted by receipt/issue/transfer/reclassification commands. */
export type InventoryAmount = InventoryMeasuredAmount | InventoryPackageAmount;

/** One exact amount interpreted through a retained item revision. */
export interface InventoryRevisionAmountLine {
  /** Frozen item revision governing this amount. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact measured or intact-package amount. */
  readonly amount: InventoryAmount;
}

/** Inputs for resolving one human-facing primary/package unit into native amount identity. */
export interface InventoryAmountFromUnitInput {
  /** Retained catalogue containing the exact item/package revisions. */
  readonly catalog: InventoryCatalog;
  /** Stable item identity expected to own the selected revision. */
  readonly itemId: ItemId;
  /** Exact immutable item revision used to interpret the unit. */
  readonly itemRevisionId: ItemRevisionId;
  /** Positive exact plain-decimal amount text. */
  readonly value: string;
  /** Exact normalized primary or package unit. */
  readonly unit: string;
  /** Independently observed axes not fixed by an intact package. */
  readonly independent?: readonly InventoryIndependentAmountInput[];
}

/** Inputs for proving several exact amount lines equal one parent amount. */
export interface AssertInventoryAmountSumInput {
  /** Retained catalogue resolving every exact revision and package. */
  readonly catalog: InventoryCatalog;
  /** Stable item identity shared by the parent and every child line. */
  readonly itemId: ItemId;
  /** Frozen revision governing the parent amount. */
  readonly expectedItemRevisionId: ItemRevisionId;
  /** Exact parent amount that child lines must conserve. */
  readonly expectedAmount: InventoryAmount;
  /** Non-empty child lines whose resolved measurement vectors are summed exactly. */
  readonly lines: readonly InventoryRevisionAmountLine[];
  /** Optional context prepended to invariant failures. */
  readonly label?: string;
}

/** Fully resolved exact amount plus frozen package evidence used by event builders. */
export interface ResolvedInventoryAmount {
  /** Exact item measurement vector used by inventory truth. */
  readonly measurements: InventoryMeasurementVector;
  /** Exact package revision while the moved stock remains intact. */
  readonly packaging?: InventoryPackagingDefinitionRevision;
  /** Original whole package count when package-shaped input was used. */
  readonly packageCount?: number;
}

/** Build a direct primary-only stock amount from exact decimal text. */
export function stockAmount(
  value: string,
  unit: string
): InventoryMeasuredAmount {
  parseQuantity(value, unit);
  return {
    kind: InventoryAmountKind.Measured,
    primaryValue: value,
    primaryUnit: unit,
    independent: [],
  };
}

/** Build direct primary plus independently measured stock axes. */
export function measuredStockAmount(
  primaryValue: string,
  primaryUnit: string,
  independent: readonly InventoryIndependentAmountInput[]
): InventoryMeasuredAmount {
  parseQuantity(primaryValue, primaryUnit);
  validateIndependentAmountInputs(independent);
  return {
    kind: InventoryAmountKind.Measured,
    primaryValue,
    primaryUnit,
    independent: [...independent],
  };
}

/** Convert one exact positive measurement vector into normal public measured-amount input. */
export function inventoryMeasuredAmountFromVector(
  measurements: InventoryMeasurementVector
): InventoryMeasuredAmount {
  positiveInventoryMeasurements(measurements, "Inventory measured amount");
  const independent: InventoryIndependentAmountInput[] = [];
  for (const measured of measurements.independent) {
    independent.push({
      axisId: measured.axisId,
      value: quantityToDecimalString(measured.quantity),
      unit: measured.quantity.unit,
    });
  }
  return measuredStockAmount(
    quantityToDecimalString(measurements.primary.quantity),
    measurements.primary.quantity.unit,
    independent
  );
}

/** Build a positive whole count of one exact package revision. */
export function packageAmount(
  count: number,
  packagingRevisionId: string,
  independent: readonly InventoryIndependentAmountInput[] = []
): InventoryPackageAmount {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error("Package count must be a positive safe integer.");
  }
  if (packagingRevisionId.trim().length === 0) {
    throw new Error("Package amount needs an exact packagingRevisionId.");
  }
  validateIndependentAmountInputs(independent);
  return {
    kind: InventoryAmountKind.Package,
    count,
    packagingRevisionId,
    independent: [...independent],
  };
}

/** Resolve one normalized primary/package unit to exact measured or package identity. */
export function inventoryAmountFromUnit({
  catalog,
  itemId,
  itemRevisionId,
  value,
  unit,
  independent = [],
}: InventoryAmountFromUnitInput): InventoryAmount {
  const item = catalog.itemRevision(itemRevisionId);
  if (item.itemId !== itemId) {
    throw new Error(
      `Inventory revision '${itemRevisionId}' does not belong to '${itemId}'.`
    );
  }
  const normalizedUnit = unit.trim();
  if (normalizedUnit.length === 0) {
    throw new Error("Inventory amount unit must not be empty.");
  }
  if (item.primaryAxis.unit === normalizedUnit) {
    const amount = measuredStockAmount(value, normalizedUnit, independent);
    resolveInventoryAmount(catalog, item, amount);
    return amount;
  }
  const matches = catalog.packagingRevisions.filter(
    /** Resolve only one package unit inside this exact item revision. */
    (packaging) =>
      packaging.itemId === itemId &&
      packaging.itemRevisionId === itemRevisionId &&
      packaging.packageUnit === normalizedUnit
  );
  if (matches.length > 1) {
    throw new Error(
      `Inventory unit '${normalizedUnit}' matches multiple package revisions for exact item revision '${itemRevisionId}'.`
    );
  }
  const packaging = matches[0];
  if (packaging === undefined) {
    throw new Error(
      `Inventory unit '${normalizedUnit}' is not the primary unit or one exact package of item revision '${itemRevisionId}'.`
    );
  }
  const count = quantityWholeMultipleCount(
    parseQuantity(value, normalizedUnit),
    parseQuantity("1", normalizedUnit)
  );
  const amount = packageAmount(count, packaging.revisionId, independent);
  resolveInventoryAmount(catalog, item, amount);
  return amount;
}

/** Prove child amount lines exactly conserve one parent amount after package resolution. */
export function assertInventoryAmountSum({
  catalog,
  itemId,
  expectedItemRevisionId,
  expectedAmount,
  lines,
  label = "Inventory amount lines",
}: AssertInventoryAmountSumInput): void {
  if (lines.length === 0) {
    throw new Error(`${label} need at least one line.`);
  }
  const expectedItem = catalog.itemRevision(expectedItemRevisionId);
  if (expectedItem.itemId !== itemId) {
    throw new Error(
      `Inventory revision '${expectedItemRevisionId}' does not belong to '${itemId}'.`
    );
  }
  const expected = resolveInventoryAmount(
    catalog,
    expectedItem,
    expectedAmount
  ).measurements;
  let actual = zeroInventoryMeasurements(expected);
  for (const line of lines) {
    const item = catalog.itemRevision(line.itemRevisionId);
    if (item.itemId !== itemId) {
      throw new Error(
        `Inventory amount revision '${line.itemRevisionId}' belongs to another item.`
      );
    }
    actual = addInventoryMeasurements(
      actual,
      resolveInventoryAmount(catalog, item, line.amount).measurements
    );
  }
  if (!inventoryMeasurementsEqual(actual, expected)) {
    throw new Error(
      `${label} must exactly equal the parent quantity after native package resolution.`
    );
  }
}

/** Resolve one public amount against the exact active/frozen catalogue definitions. */
export function resolveInventoryAmount(
  catalog: InventoryCatalog,
  item: InventoryItemDefinitionRevision,
  amount: InventoryAmount
): ResolvedInventoryAmount {
  assertInventoryAmountKind(amount);
  if (amount.kind === InventoryAmountKind.Measured) {
    const measurements = createMeasuredVector(item, amount);
    positiveInventoryMeasurements(measurements, "Inventory amount");
    assertMeasurementsMatchItem(item, measurements, true);
    return { measurements };
  }
  const packaging = catalog.packagingRevision(amount.packagingRevisionId);
  if (
    packaging.itemId !== item.itemId ||
    packaging.itemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Package amount does not belong to the selected item revision."
    );
  }
  const fixed = multiplyInventoryMeasurementsByWholeNumber(
    packaging.fixedContents,
    amount.count
  );
  const independent = [...fixed.independent];
  const fixedAxes = new Set<string>();
  for (const measured of fixed.independent) fixedAxes.add(measured.axisId);
  for (const input of amount.independent) {
    if (fixedAxes.has(input.axisId)) {
      throw new Error(
        `Package revision '${packaging.revisionId}' already fixes axis '${input.axisId}'.`
      );
    }
    independent.push(
      inventoryMeasurement(input.axisId, parseQuantity(input.value, input.unit))
    );
  }
  const measurements = inventoryMeasurementVector(fixed.primary, independent);
  positiveInventoryMeasurements(measurements, "Package amount");
  assertMeasurementsMatchItem(item, measurements, true);
  return { measurements, packaging, packageCount: amount.count };
}

/** Turn one direct public amount into item-axis measurements. */
function createMeasuredVector(
  item: InventoryItemDefinitionRevision,
  amount: InventoryMeasuredAmount
): InventoryMeasurementVector {
  const primary = inventoryMeasurement(
    item.primaryAxis.axisId,
    parseQuantity(amount.primaryValue, amount.primaryUnit)
  );
  const independent: InventoryMeasurement[] = [];
  for (const input of amount.independent) {
    independent.push(
      inventoryMeasurement(input.axisId, parseQuantity(input.value, input.unit))
    );
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Validate one public independent-axis list before it is stored in an amount value. */
function validateIndependentAmountInputs(
  inputs: readonly InventoryIndependentAmountInput[]
): void {
  const seenAxes = new Set<string>();
  for (const input of inputs) {
    if (input.axisId.trim().length === 0) {
      throw new Error("Independent amount axisId must not be empty.");
    }
    if (seenAxes.has(input.axisId)) {
      throw new Error(`Duplicate independent amount axis '${input.axisId}'.`);
    }
    seenAxes.add(input.axisId);
    parseQuantity(input.value, input.unit);
  }
}
