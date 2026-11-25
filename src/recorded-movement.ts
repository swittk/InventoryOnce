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
import { negateInventoryMeasurements } from "./measurements.js";
import {
  addInventoryMeasurementTotals,
  materializeInventoryMeasurementTotals,
  type InventoryMeasurementTotals,
} from "./measurement-totals.js";
import { inventoryStockPositionIdentity } from "./model.js";

/** Original posting plus working totals only when additional portions share its identity. */
interface ReportedPosting {
  /** First posting, retaining position and optional witnessed metadata. */
  readonly effect: InventoryStockEffect;
  /** Wide totals created on the first merge. */
  combined?: InventoryMeasurementTotals;
  /** Whole package count when supplied by every merged part. */
  packageCount: bigint | undefined;
}

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
  const effects = new Map<string, ReportedPosting>();
  let eventId = witnessed?.eventId;
  const unwitnessedStockMovements: InventoryUnwitnessedStockMovement[] = [];
  for (const effect of witnessed?.stockEffects ?? []) {
    addReportedPosting(effects, effect);
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
      addReportedPosting(effects, effect);
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
      stockEffects: Array.from(effects.values(), materializeReportedPosting),
      positiveLayerProvenanceTransfers: witnessed?.positiveLayerProvenanceTransfers ?? [],
      traceabilityChanges: [],
      unwitnessedStockMovements,
    },
  });
}

/** Accumulate same-direction portions without storing an intermediate posting. */
function addReportedPosting(effects: Map<string, ReportedPosting>, effect: InventoryStockEffect): void {
  const id = inventoryStockPositionIdentity(effect.position);
  const current = effects.get(id);
  const count = effect.evidence?.packageCount;
  if (current === undefined) {
    effects.set(id, { effect, packageCount: count === undefined ? undefined : BigInt(count) });
    return;
  }
  const first = current.effect.measurementsDelta;
  if ((first.primary.quantity.amountMinor < 0) !== (effect.measurementsDelta.primary.quantity.amountMinor < 0)) {
    throw new Error("An unwitnessed movement cannot merge opposing changes at one stock position.");
  }
  if (current.combined === undefined) {
    current.combined = new Map();
    addInventoryMeasurementTotals(current.combined, first);
  }
  addInventoryMeasurementTotals(current.combined, effect.measurementsDelta);
  current.packageCount = current.packageCount === undefined || count === undefined
    ? undefined
    : current.packageCount + BigInt(count);
}

/** Keep witnessed metadata and store only the final signed sum and evidence. */
function materializeReportedPosting({ effect, combined, packageCount }: ReportedPosting): InventoryStockEffect {
  if (combined === undefined) return effect;
  const measurementsDelta = materializeInventoryMeasurementTotals(combined, effect.measurementsDelta.primary.axisId);
  return {
    ...effect,
    measurementsDelta,
    evidence: {
      transactedMeasurements: measurementsDelta.primary.quantity.amountMinor < 0 ? negateInventoryMeasurements(measurementsDelta) : measurementsDelta,
      ...(effect.position.packagingRevisionId === undefined
        ? {}
        : { packagingRevisionId: effect.position.packagingRevisionId }),
      ...(packageCount === undefined ? {} : { packageCount: String(packageCount) }),
    },
  };
}
