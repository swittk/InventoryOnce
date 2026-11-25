import {
  createInventoryScrapEvent,
  createInventoryTransferEvent,
  type InventoryCommandHeader,
  type InventoryScrapLine,
} from "./commands.js";
import type { InventoryCatalog } from "./catalog.js";
import {
  defineInventoryEvent,
  InventoryEventKind,
  type InventoryEventDraft,
  type InventoryStockEffect,
  type InventoryUnwitnessedStockMovement,
} from "./events.js";
import { addInventoryMeasurements, negateInventoryMeasurements } from "./measurements.js";
import { inventoryStockPositionIdentity } from "./model.js";

/** One exact reported portion for which the planner found no witnessed source stock. */
export interface InventoryUnwitnessedMovementLine extends InventoryScrapLine {
  /** Direct arrival placement for a transfer, or omission on destruction. */
  readonly toPlacementNodeId?: string;
}

/** One physical event with optional witnessed effects and explicitly measured unknown portions. */
interface CreateInventoryRecordedMovementInput {
  /** Retained catalogue used by the normal physical event builders. */
  readonly catalog: InventoryCatalog;
  /** Original operation and audit facts, frozen for replay. */
  readonly header: InventoryCommandHeader;
  /** Ordinary physical command whose actual effects are recorded. */
  readonly kind: InventoryEventKind.Transfer | InventoryEventKind.Scrap;
  /** Exact witnessed source event if recorded stock backed part of the command. */
  readonly witnessed: InventoryEventDraft | undefined;
  /** All reported portions without a witnessed lot, serial or original source age. */
  readonly unknown: readonly InventoryUnwitnessedMovementLine[];
}

/** Join witnessed picks and the remaining signed portions in one ordinary transfer or scrap. */
export function createInventoryRecordedMovement({
  catalog, header, kind, witnessed, unknown,
}: CreateInventoryRecordedMovementInput): InventoryEventDraft {
  const effects = new Map<string, InventoryStockEffect>();
  let eventId = witnessed?.eventId;
  const unwitnessedStockMovements: InventoryUnwitnessedStockMovement[] = [];
  for (const effect of witnessed?.stockEffects ?? []) {
    effects.set(inventoryStockPositionIdentity(effect.position), effect);
  }
  for (const line of unknown) {
    const toPlacementNodeId = line.toPlacementNodeId;
    const portion = toPlacementNodeId === undefined
      ? createInventoryScrapEvent({ ...header, ...line, catalog })
      : createInventoryTransferEvent({ ...header, ...line, catalog, toPlacementNodeId });
    eventId ??= portion.eventId;
    let source: InventoryStockEffect | undefined;
    let destination: InventoryStockEffect | undefined;
    for (const effect of portion.stockEffects) {
      if (effect.measurementsDelta.primary.quantity.amountMinor < 0) source = effect;
      else destination = effect;
      const id = inventoryStockPositionIdentity(effect.position);
      const current = effects.get(id);
      effects.set(id, current === undefined ? effect : joinReportedParts(current, effect));
    }
    if (source === undefined) throw new Error("Recorded movement lost its signed source.");
    unwitnessedStockMovements.push({
      from: source.position,
      measurements: negateInventoryMeasurements(source.measurementsDelta),
      ...(destination === undefined ? {} : { to: destination.position }),
    });
  }
  if (eventId === undefined) throw new Error("Recorded movement needs at least one physical portion.");
  return defineInventoryEvent({
    catalog,
    event: {
      ...header,
      eventId,
      kind,
      stockEffects: [...effects.values()],
      positiveLayerProvenanceTransfers: witnessed?.positiveLayerProvenanceTransfers ?? [],
      traceabilityChanges: [],
      unwitnessedStockMovements,
    },
  });
}

/** Keep the witnessed evidence while summing a same-direction unlabelled posting. */
function joinReportedParts(witnessed: InventoryStockEffect, remainder: InventoryStockEffect): InventoryStockEffect {
  const signed = witnessed.measurementsDelta.primary.quantity.amountMinor;
  if ((signed < 0) !== (remainder.measurementsDelta.primary.quantity.amountMinor < 0)) {
    throw new Error("An unwitnessed movement cannot merge opposing changes at one stock position.");
  }
  const measurementsDelta = addInventoryMeasurements(witnessed.measurementsDelta, remainder.measurementsDelta);
  const packageCount = witnessed.evidence?.packageCount;
  return {
    ...witnessed,
    measurementsDelta,
    evidence: {
      transactedMeasurements: signed < 0 ? negateInventoryMeasurements(measurementsDelta) : measurementsDelta,
      ...(witnessed.position.packagingRevisionId === undefined
        ? {}
        : { packagingRevisionId: witnessed.position.packagingRevisionId }),
      ...(packageCount === undefined || remainder.evidence?.packageCount === undefined
        ? {}
        : { packageCount: String(BigInt(packageCount) + BigInt(remainder.evidence.packageCount)) }),
    },
  };
}
