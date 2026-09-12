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
import { compareQuantity, zeroQuantity } from "./quantity.js";

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
  for (const axis of item.independentAxes) {
    if (
      packaging?.fixedContents.independent.some(
        /** Match one package-fixed independent axis by exact axis identity. */
        (measured) => measured.axisId === axis.axisId
      ) === true
    ) {
      continue;
    }
    const measured = inventoryMeasurementAt(
      position.measurements,
      axis.axisId,
      axis.unit
    );
    if (
      axis.requirement === InventoryMeasurementRequirement.Required ||
      compareQuantity(measured, zeroQuantity(axis.unit, measured.decimals)) !== 0
    ) {
      return true;
    }
  }
  return false;
}
