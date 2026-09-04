import type { InventoryItemDefinitionRevision } from "./catalog.js";
import {
  inventoryMeasurement,
  inventoryMeasurementVector,
  type InventoryIndependentMeasurementInput,
  type InventoryMeasurementVector,
} from "./measurements.js";
import { parseQuantity } from "./quantity.js";

/** Build exact zero across every configured measurement axis of one item revision. */
export function zeroInventoryMeasurementsForItem(
  item: InventoryItemDefinitionRevision
): InventoryMeasurementVector {
  const independent: InventoryIndependentMeasurementInput[] = [];
  for (const axis of item.independentAxes) {
    independent.push({
      axisId: axis.axisId,
      quantity: parseQuantity("0", axis.unit),
    });
  }
  return inventoryMeasurementVector(
    inventoryMeasurement(
      item.primaryAxis.axisId,
      parseQuantity("0", item.primaryAxis.unit)
    ),
    independent
  );
}
