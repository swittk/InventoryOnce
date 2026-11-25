import { InventoryAmountKind, type InventoryAmount } from "./amounts.js";
import {
  InventoryCompositionOutputAmountKind,
  InventoryMeasurementRequirement,
  type InventoryCompositionOutputDefinition,
  type InventoryItemDefinitionRevision,
  type InventoryPackagingDefinitionRevision,
} from "./catalog.js";
import type { InventoryStockPosition } from "./model.js";
import { inventoryMeasurementAt } from "./measurements.js";

/** Reject unsupported wire discriminators before any amount-specific catalogue lookup or durable planning. */
export function assertInventoryAmountKind(amount: InventoryAmount): void {
  if (
    amount === null || typeof amount !== "object" || Array.isArray(amount) ||
    (amount.kind !== InventoryAmountKind.Measured && amount.kind !== InventoryAmountKind.Package)
  ) {
    throw new Error("Inventory amount kind is invalid.");
  }
}

/** Reject malformed composition amount discriminators before normalized catalogue rows erase their input shape. */
export function assertInventoryCompositionAmountKind(amount: InventoryCompositionOutputDefinition["amount"]): void {
  if (
    amount === null || typeof amount !== "object" || Array.isArray(amount) ||
    (amount.kind !== InventoryCompositionOutputAmountKind.Measured && amount.kind !== InventoryCompositionOutputAmountKind.Package)
  ) {
    throw new Error("Inventory composition output amount kind is invalid.");
  }
}

/** Return whether automatic primary allocation would lose an unfixed independent measurement. */
export function positionHasUnfixedIndependentMeasuredContents(
  position: InventoryStockPosition,
  item: InventoryItemDefinitionRevision,
  packaging?: InventoryPackagingDefinitionRevision
): boolean {
  return itemHasUnfixedIndependentMeasuredContents(item, packaging,
    /** A nonzero optional axis must be preserved just like a required one. */
    (axis) => inventoryMeasurementAt(position.measurements, axis.axisId, axis.unit).amountMinor !== 0,
  );
}

/** Test the same independent-axis rule against stored or working measurements. */
export function itemHasUnfixedIndependentMeasuredContents(
  item: InventoryItemDefinitionRevision,
  packaging: InventoryPackagingDefinitionRevision | undefined,
  axisIsNonzero: (axis: InventoryItemDefinitionRevision["independentAxes"][number]) => boolean,
): boolean {
  for (const axis of item.independentAxes) {
    if (
      packaging?.fixedContents.independent.some(
        /** Match one package-fixed independent axis by exact axis identity. */
        (measured) => measured.axisId === axis.axisId
      ) === true
    ) {
      continue;
    }
    if (
      axis.requirement === InventoryMeasurementRequirement.Required ||
      axisIsNonzero(axis)
    ) {
      return true;
    }
  }
  return false;
}
