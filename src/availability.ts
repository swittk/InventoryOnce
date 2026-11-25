import { compareInventoryIdentityText } from "./ordering.js";
import type {
  InventoryCatalog,
  InventoryItemDefinitionRevision,
} from "./catalog.js";
import {
  applyInventoryWorkingDeficitBurdenToPositions,
  inventoryRecordedDeficitPoolSelector,
  inventoryPositionDeficitMeasurements,
  inventoryPositionIsDeficit,
  type InventoryWorkingDeficitCapacityLine,
} from "./deficits.js";
import {
  inventoryMeasurement,
  inventoryMeasurementAt,
  inventoryMeasurementVector,
  subtractInventoryMeasurements,
  type InventoryIndependentMeasurementInput,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  addInventoryMeasurementTotals,
  inventoryMeasurementTotalsFromVector,
  materializeInventoryMeasurementTotals,
} from "./measurement-totals.js";
import { zeroInventoryMeasurementsForItem } from "./measurement-schema.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
  type ItemRevisionId,
} from "./model.js";
import {
  findInventoryPositions,
  type InventoryProjectionState,
} from "./projection.js";
import { inventoryStockPoolRowsFromProjection } from "./picking.js";
import {
  addExactQuantityDigits,
  compareWorkingQuantities,
  materializeInventoryWorkingQuantity,
  subtractWorkingQuantity,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
  type InventoryScopedStockPool,
} from "./stock-scope.js";
import {
  compareQuantity,
  parseQuantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  inspectInventoryReservationFeasibility,
  inventoryReservationIsActiveAt,
  inventoryReservationsAt,
  type InventoryReservation,
  type InventoryReservationBook,
  type InventoryReservationFeasibilityReport,
} from "./reservations.js";
import {
  inventoryStockPositionMatchesNormalizedSelector,
  inventoryStockPositionMatchesSelector,
  inventoryStockSelectorIdentity,
  normalizeInventoryStockSelector,
  InventoryOptionalIdentityConstraintKind,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  inventoryPositionIsExpiredAt,
} from "./usability.js";

/** Exact physical/claim availability facts for one stock position. */
export interface InventoryPositionAvailability {
  /** Exact current stock position. */
  readonly position: InventoryStockPosition;
  /** Earliest lot expiry or placement-ancestry use-by when known. */
  readonly effectiveUseByEpochMs?: number;
  /** True when this position is unusable at the requested authority time. */
  readonly expired: boolean;
  /** Exact active allocations on this item's reservation axis. */
  readonly exactlyAllocated: Quantity;
  /** Active reservation identities contributing to `exactlyAllocated`. */
  readonly exactAllocationReservationIds: readonly string[];
  /** True when this signed row is explicit deficit rather than physical stock. */
  readonly isDeficit: boolean;
  /** Positive magnitude of this row's recorded deficit, when applicable. */
  readonly deficitMeasurements?: InventoryMeasurementVector;
  /** Exact usable reservation-axis capacity not bound to exact allocations or deficit. */
  readonly unallocatedUsablePhysical: Quantity;
}

/** Revision-safe availability summary that never merges incompatible item definitions. */
export interface InventoryAvailabilityRevisionSummary {
  /** Stable item identity. */
  readonly itemId: string;
  /** Exact retained item definition revision. */
  readonly itemRevisionId: ItemRevisionId;
  /** Signed net truth: positive physical stock minus recorded deficit. */
  readonly onHand: InventoryMeasurementVector;
  /** Positive accounted stock, including expired and unresolved whereabouts. */
  readonly physicalOnHand: InventoryMeasurementVector;
  /** Positive magnitude of every recorded deficit in this revision/scope. */
  readonly deficit: InventoryMeasurementVector;
  /** Signed usable truth: non-expired physical stock minus usable deficit burden. */
  readonly usableOnHand: InventoryMeasurementVector;
  /** Positive deficit burden assigned across usable physical rows. */
  readonly usableDeficit: InventoryMeasurementVector;
  /** Positive known-placed, non-transfer, non-expired physical stock only. */
  readonly usablePhysicalOnHand: InventoryMeasurementVector;
  /** Positive physical measurements past lot/placement-ancestry use-by. */
  readonly expiredOnHand: InventoryMeasurementVector;
  /** Item-defined axis on which reservations compete. */
  readonly reservationAxisId: string;
  /** Exact active allocations on usable positions. */
  readonly exactlyAllocatedUsable: Quantity;
  /** Exact active allocations now pointing at expired positions. */
  readonly exactlyAllocatedExpired: Quantity;
  /** Usable reservation-axis physical capacity left after exact allocations only. */
  readonly unallocatedUsablePhysical: Quantity;
  /** Exact active allocations whose selected physical position no longer exists. */
  readonly unbackedExactlyAllocated: Quantity;
  /** Active reservations with at least one allocation whose selected position is absent. */
  readonly unbackedReservationIds: readonly string[];
  /** Exact sum of active broad/unallocated claim requests touching this selected pool. */
  readonly broadRequested: Quantity;
  /** Active broad/unallocated claims touching at least one selected physical position. */
  readonly broadReservationIds: readonly string[];
  /** Exact position facts sorted by deterministic position identity. */
  readonly positions: readonly InventoryPositionAvailability[];
}

/** Truthful availability result for one broad selector at one authority time. */
export interface InventoryAvailabilitySummary {
  /** Normalized selector used by this read. */
  readonly selector: InventoryStockSelector;
  /** Authority time used for use-by and reservation lifecycle checks. */
  readonly atEpochMs: number;
  /** Revision-safe physical/claim summaries. */
  readonly revisions: readonly InventoryAvailabilityRevisionSummary[];
  /** Global claim-feasibility report; shortages are not hidden behind a single scalar. */
  readonly reservationFeasibility: InventoryReservationFeasibilityReport;
}

/** Inputs for computing one availability summary from current published truth. */
export interface SummarizeInventoryAvailabilityInput {
  /** Frozen catalogue defining measurement/reservation axes. */
  readonly catalog: InventoryCatalog;
  /** Current physical/event/lot/placement projection. */
  readonly projection: InventoryProjectionState;
  /** Current reservation lifecycle book. */
  readonly reservations: InventoryReservationBook;
  /** Broad or exact stock scope. */
  readonly selector: InventoryStockSelector;
  /** Authority time for expiry and claim lifecycle. */
  readonly atEpochMs: number;
}

/** Compute truthful physical/claim availability without pretending broad claims are exact allocations. */
export function summarizeInventoryAvailability({
  catalog,
  projection,
  reservations,
  selector: rawSelector,
  atEpochMs,
}: SummarizeInventoryAvailabilityInput): InventoryAvailabilitySummary {
  const selector = normalizeInventoryStockSelector(rawSelector);
  const positionsByRevision = selectedPositionsByRevision(projection, selector);
  /** Active claim rows reconstructed at the requested authority time. */
  const activeReservations: InventoryReservation[] = [];
  for (const reservation of inventoryReservationsAt(reservations, atEpochMs)) {
    if (inventoryReservationIsActiveAt(reservation, atEpochMs)) {
      activeReservations.push(reservation);
    }
  }
  const revisionIds = selectedRevisionIds(
    catalog,
    selector,
    positionsByRevision
  );
  const revisions: InventoryAvailabilityRevisionSummary[] = [];
  for (const revisionId of revisionIds) {
    revisions.push(
      summarizeAvailabilityRevision({
        catalog,
        projection,
        selector,
        positions: positionsByRevision.get(revisionId) ?? [],
        activeReservations,
        revisionId,
        atEpochMs,
      })
    );
  }
  return {
    selector,
    atEpochMs,
    revisions,
    reservationFeasibility: inspectInventoryReservationFeasibility({
      catalog,
      projection,
      book: reservations,
      atEpochMs,
    }),
  };
}

/** Group selected physical positions by exact frozen item revision. */
function selectedPositionsByRevision(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector
): ReadonlyMap<ItemRevisionId, InventoryStockPosition[]> {
  const positionsByRevision = new Map<
    ItemRevisionId,
    InventoryStockPosition[]
  >();
  for (const position of findInventoryPositions(projection, selector)) {
    const positions =
      positionsByRevision.get(position.key.itemRevisionId) ?? [];
    positions.push(position);
    positionsByRevision.set(position.key.itemRevisionId, positions);
  }
  return positionsByRevision;
}

/** Return requested/physical revisions in deterministic order, retaining active zero stock. */
function selectedRevisionIds(
  catalog: InventoryCatalog,
  selector: InventoryStockSelector,
  positionsByRevision: ReadonlyMap<ItemRevisionId, InventoryStockPosition[]>
): readonly ItemRevisionId[] {
  const revisionIds = new Set<ItemRevisionId>();
  for (const revisionId of selector.itemRevisionIds ?? []) {
    const item = catalog.itemRevision(revisionId);
    if (item.itemId !== selector.itemId) {
      throw new Error(
        `Availability selector item '${selector.itemId}' cannot include revision '${revisionId}'.`
      );
    }
    revisionIds.add(revisionId);
  }
  for (const revisionId of positionsByRevision.keys())
    revisionIds.add(revisionId);
  if (selector.itemRevisionIds === undefined) {
    revisionIds.add(catalog.activeItem(selector.itemId).revisionId);
  }
  const ordered = [...revisionIds];
  ordered.sort();
  return ordered;
}

/** Inputs for building one exact revision availability summary. */
interface SummarizeAvailabilityRevisionInput {
  /** Frozen catalogue defining measurement/reservation axes. */
  readonly catalog: InventoryCatalog;
  /** Current physical/event/lot/placement projection. */
  readonly projection: InventoryProjectionState;
  /** Normalized read selector. */
  readonly selector: InventoryStockSelector;
  /** Selected current positions for this revision. */
  readonly positions: readonly InventoryStockPosition[];
  /** Active claim rows reconstructed at the authority time. */
  readonly activeReservations: readonly InventoryReservation[];
  /** Exact frozen item revision. */
  readonly revisionId: ItemRevisionId;
  /** Authority time for expiry and claim lifecycle. */
  readonly atEpochMs: number;
}

/** Build one exact revision summary from physical positions and active claim rows. */
function summarizeAvailabilityRevision({
  catalog,
  projection,
  selector,
  positions,
  activeReservations,
  revisionId,
  atEpochMs,
}: SummarizeAvailabilityRevisionInput): InventoryAvailabilityRevisionSummary {
  const item = catalog.itemRevision(revisionId);
  const reservationAxis = catalog.measurementAxis(item, item.reservationAxisId);
  const reservationIndex = availabilityClaimTotals({
    activeReservations,
    projection,
    selector,
    positions,
    revisionId,
    unit: reservationAxis.unit,
    atEpochMs,
  });
  const signedRows = inventoryStockPoolRowsFromProjection(
    projection,
    inventoryRecordedDeficitPoolSelector(selector, revisionId)
  );
  return {
    ...summarizeInventoryPhysicalAvailability({
      catalog, selector, item, atEpochMs,
      pool: { positions: signedRows, reservations: activeReservations },
    }),
    unbackedExactlyAllocated: reservationIndex.unbacked.quantity,
    unbackedReservationIds: reservationIndex.unbacked.reservationIds,
    broadRequested: reservationIndex.broadRequested,
    broadReservationIds: reservationIndex.broadReservationIds,
  };
}

/** Physical availability includes holds on indexed rows without requiring global claim feasibility. */
export type InventoryPhysicalAvailabilityRevisionSummary = Omit<
  InventoryAvailabilityRevisionSummary,
  "unbackedExactlyAllocated" | "unbackedReservationIds" | "broadRequested" | "broadReservationIds"
>;

/** Exact physical availability reduction over one complete indexed or canonical pool. */
interface SummarizeInventoryPhysicalAvailabilityInput {
  /** Retained catalogue defining the reservation axis. */
  readonly catalog: InventoryCatalog;
  /** Frozen definition of the item revision in this pool. */
  readonly item: InventoryItemDefinitionRevision;
  /** Normalized filters within the pool, including lot, placement, and ownership. */
  readonly selector: InventoryStockSelector;
  /** Complete signed pool and real current claim evidence. */
  readonly pool: InventoryScopedStockPool;
  /** Authority time for physical expiry and claim activity. */
  readonly atEpochMs: number;
}

/** Reduce the same physical, expiry, exact-hold and deficit facts for both availability reads. */
export function summarizeInventoryPhysicalAvailability({
  catalog,
  item,
  selector,
  pool,
  atEpochMs,
}: SummarizeInventoryPhysicalAvailabilityInput): InventoryPhysicalAvailabilityRevisionSummary {
  const reservationAxis = catalog.measurementAxis(item, item.reservationAxisId);
  const revisionId = item.revisionId;
  const zero = zeroInventoryMeasurementsForItem(item);
  /** Report subtotals can be wider than their exact final values. */
  const physicalTotals = inventoryMeasurementTotalsFromVector(zero);
  const usableTotals = inventoryMeasurementTotalsFromVector(zero);
  const expiredTotals = inventoryMeasurementTotalsFromVector(zero);
  /** Held quantities for selected usable and expired rows. */
  const usableHeld: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const expiredHeld: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  /** Complete signed rows, ordered before attribution so the same lot bears the same deficit. */
  const poolPositions: InventoryStockPosition[] = [];
  /** Filtered physical rows to report after pool-wide deficit attribution. */
  const positions: InventoryStockPosition[] = [];
  /** Presence and expiry evidence for every exact row in the pool. */
  const useBy = new Map<string, number | undefined>();
  // The signed pool retains the report's subtree constraint.
  const { withinPlacementNodeIds: _withinPlacementNodeIds, ...stockSelector } = selector;
  for (const row of pool.positions) {
    const { position } = row;
    poolPositions.push(position);
    useBy.set(inventoryStockPositionIdentity(position.key), row.effectiveUseByEpochMs);
    if (inventoryStockPositionMatchesNormalizedSelector(position.key, stockSelector)) positions.push(position);
  }
  const exactHolds = indexScopedAvailabilityHolds(pool, useBy, item, reservationAxis.unit, atEpochMs);
  const pendingPositions: MutableInventoryPositionAvailability[] = [];

  for (const position of positions) {
    const isDeficit = inventoryPositionIsDeficit(position);
    const deficitMeasurements = inventoryPositionDeficitMeasurements(position);
    const id = inventoryStockPositionIdentity(position.key);
    const effectiveUseByEpochMs = useBy.get(id);
    const expired = !isDeficit && effectiveUseByEpochMs !== undefined && effectiveUseByEpochMs <= atEpochMs;
    const ordinarilyUsable =
      position.key.placementNodeId !== undefined &&
      position.key.transferId === undefined &&
      !expired;
    if (!isDeficit) {
      addInventoryMeasurementTotals(physicalTotals, position.measurements);
      if (expired) {
        addInventoryMeasurementTotals(expiredTotals, position.measurements);
      } else if (ordinarilyUsable) {
        addInventoryMeasurementTotals(usableTotals, position.measurements);
      }
    }
    const exactAllocations =
      exactHolds.get(id) ?? {
        quantity: zeroQuantity(reservationAxis.unit),
        reservationIds: [],
      };
    const physicalCapacity = inventoryMeasurementAt(
      position.measurements,
      reservationAxis.axisId,
      reservationAxis.unit
    );
    const positiveCapacity =
      !isDeficit &&
      compareQuantity(
        physicalCapacity,
        zeroQuantity(reservationAxis.unit, physicalCapacity.decimals)
      ) > 0
        ? physicalCapacity
        : zeroQuantity(reservationAxis.unit, physicalCapacity.decimals);
    const rawUnallocated = !ordinarilyUsable
      ? zeroQuantity(reservationAxis.unit)
      : unheldWorkingCapacity(
          positiveCapacity,
          exactAllocations.quantity
        );
    const held = exactAllocations.quantity;
    if (expired) addExactQuantityDigits(expiredHeld, BigInt(held.amountMinor), held.decimals);
    else if (!isDeficit && ordinarilyUsable) {
      addExactQuantityDigits(usableHeld, BigInt(held.amountMinor), held.decimals);
    }
    pendingPositions.push({
      position,
      ...(effectiveUseByEpochMs === undefined ? {} : { effectiveUseByEpochMs }),
      expired,
      exactlyAllocated: materializeInventoryWorkingQuantity(held, "Inventory allocated quantity"),
      exactAllocationReservationIds: exactAllocations.reservationIds,
      isDeficit,
      ...(deficitMeasurements === undefined ? {} : { deficitMeasurements }),
      rawUnallocatedUsablePhysical: rawUnallocated,
    });
  }

  /** Exact usable capacity in the entire direct-placement pool before narrowing the read. */
  const positiveCapacityLines: InventoryWorkingDeficitCapacityLine[] = [];
  for (const position of poolPositions) {
    if (inventoryPositionIsDeficit(position)) continue;
    if (
      position.key.transferId !== undefined ||
      position.key.placementNodeId === undefined
    ) {
      continue;
    }
    const id = inventoryStockPositionIdentity(position.key);
    const expiry = useBy.get(id);
    if (expiry !== undefined && expiry <= atEpochMs) continue;
    const physicalCapacity = inventoryMeasurementAt(
      position.measurements,
      reservationAxis.axisId,
      reservationAxis.unit
    );
    if (
      compareQuantity(
        physicalCapacity,
        zeroQuantity(reservationAxis.unit, physicalCapacity.decimals)
      ) <= 0
    ) {
      continue;
    }
    const exactAllocations =
      exactHolds.get(id) ?? {
        quantity: zeroQuantity(reservationAxis.unit),
        reservationIds: [],
      };
    const rawUnallocated = unheldWorkingCapacity(
      physicalCapacity,
      exactAllocations.quantity
    );
    if (rawUnallocated.amountMinor <= 0n) continue;
    positiveCapacityLines.push({
      position: position.key,
      capacity: rawUnallocated,
    });
  }
  const burden = applyInventoryWorkingDeficitBurdenToPositions({
    positions: poolPositions,
    itemRevisionId: revisionId,
    axisId: reservationAxis.axisId,
    unit: reservationAxis.unit,
    placementNodeIds: [],
    lines: positiveCapacityLines,
  });
  const deficit = availabilitySelectedDeficitBurdenMeasurements({
    useBy,
    item,
    selector,
    poolPositions,
    selectedPositions: positions,
    atEpochMs,
    usableOnly: false,
  });
  const usableDeficit = availabilitySelectedDeficitBurdenMeasurements({
    useBy,
    item,
    selector,
    poolPositions,
    selectedPositions: positions,
    atEpochMs,
    usableOnly: true,
  });
  const primaryAxisId = item.primaryAxis.axisId;
  const physicalOnHand = materializeInventoryMeasurementTotals(physicalTotals, primaryAxisId);
  const usablePhysicalOnHand = materializeInventoryMeasurementTotals(usableTotals, primaryAxisId);
  const onHand = subtractInventoryMeasurements(physicalOnHand, deficit);
  const usableOnHand = subtractInventoryMeasurements(
    usablePhysicalOnHand,
    usableDeficit
  );
  /** Accumulate only selected position capacities before returning their total. */
  const unallocatedUsablePhysical: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const positionSummaries: InventoryPositionAvailability[] = [];
  for (const pending of pendingPositions) {
    const identity = inventoryStockPositionIdentity(pending.position.key);
    const capacity =
      burden.capacityByPositionIdentity.get(identity) ??
      zeroQuantity(
        reservationAxis.unit,
        pending.rawUnallocatedUsablePhysical.decimals
      );
    const adjusted = materializeInventoryWorkingQuantity(capacity, "Inventory available quantity");
    addExactQuantityDigits(unallocatedUsablePhysical, BigInt(adjusted.amountMinor), adjusted.decimals);
    const { rawUnallocatedUsablePhysical: _raw, ...publicPosition } = pending;
    positionSummaries.push({
      ...publicPosition,
      unallocatedUsablePhysical: adjusted,
    });
  }

  return {
    itemId: item.itemId,
    itemRevisionId: item.revisionId,
    onHand,
    physicalOnHand,
    deficit,
    usableOnHand,
    usableDeficit,
    usablePhysicalOnHand,
    expiredOnHand: materializeInventoryMeasurementTotals(expiredTotals, primaryAxisId),
    reservationAxisId: reservationAxis.axisId,
    exactlyAllocatedUsable: materializeInventoryWorkingQuantity({
      amountMinor: usableHeld.minor, decimals: usableHeld.decimals, unit: reservationAxis.unit,
    }, "Inventory usable allocated quantity"),
    exactlyAllocatedExpired: materializeInventoryWorkingQuantity({
      amountMinor: expiredHeld.minor, decimals: expiredHeld.decimals, unit: reservationAxis.unit,
    }, "Inventory expired allocated quantity"),
    unallocatedUsablePhysical: materializeInventoryWorkingQuantity({
      amountMinor: unallocatedUsablePhysical.minor,
      decimals: unallocatedUsablePhysical.decimals,
      unit: reservationAxis.unit,
    }, "Inventory available quantity"),
    positions: positionSummaries,
  };
}

/** Private position row retained until pool-level deficit burden is known. */
interface MutableInventoryPositionAvailability
  extends Omit<InventoryPositionAvailability, "unallocatedUsablePhysical"> {
  /** Positive claim-adjusted capacity before direct-placement-pool deficit burden. */
  readonly rawUnallocatedUsablePhysical: InventoryWorkingQuantity;
}

/** Inputs for attributing one direct-placement-pool deficit to a selected physical subset. */
interface AvailabilitySelectedDeficitBurdenInput {
  /** Effective use-by indexed by exact stock identity. */
  readonly useBy: ReadonlyMap<string, number | undefined>;
  /** Exact item revision and all configured measurement axes. */
  readonly item: InventoryItemDefinitionRevision;
  /** Normalized selector; placement and whereabouts scope recorded deficit rows. */
  readonly selector: InventoryStockSelector;
  /** Deterministically ordered positive/negative positions in the whole pool. */
  readonly poolPositions: readonly InventoryStockPosition[];
  /** Exact positions selected by the caller. */
  readonly selectedPositions: readonly InventoryStockPosition[];
  /** Authority time used when only usable physical rows may carry burden. */
  readonly atEpochMs: number;
  /** True when expired rows must not back this availability view. */
  readonly usableOnly: boolean;
}

/**
 * Attribute one pool's deficit once across its positive rows, then report only the selected share.
 * Signed on-hand includes selected deficit rows. Usable on-hand includes only burden assigned to usable stock.
 */
function availabilitySelectedDeficitBurdenMeasurements({
  useBy,
  item,
  selector,
  poolPositions,
  selectedPositions,
  atEpochMs,
  usableOnly,
}: AvailabilitySelectedDeficitBurdenInput): InventoryMeasurementVector {
  if (!usableOnly && selectedPositions.some(inventoryPositionIsDeficit)) {
    return availabilityPoolDeficitMeasurements(
      poolPositions,
      item,
      selector
    );
  }
  const selectedPositionIds = new Set(
    selectedPositions.map(
      /** Convert one selected row to its collision-free physical identity. */
      (position) => inventoryStockPositionIdentity(position.key)
    )
  );
  const primary = inventoryMeasurement(
    item.primaryAxis.axisId,
    availabilitySelectedDeficitAxisBurden({
      useBy,
      itemRevisionId: item.revisionId,
          poolPositions,
      selectedPositionIds,
      axisId: item.primaryAxis.axisId,
      unit: item.primaryAxis.unit,
      atEpochMs,
      usableOnly,
    })
  );
  const independent: InventoryIndependentMeasurementInput[] = [];
  for (const axis of item.independentAxes) {
    independent.push({
      axisId: axis.axisId,
      quantity: availabilitySelectedDeficitAxisBurden({
        useBy,
        itemRevisionId: item.revisionId,
              poolPositions,
        selectedPositionIds,
        axisId: axis.axisId,
        unit: axis.unit,
        atEpochMs,
        usableOnly,
      }),
    });
  }
  return inventoryMeasurementVector(primary, independent);
}

/** Inputs for attributing one measurement axis of recorded deficit. */
interface AvailabilitySelectedDeficitAxisBurdenInput {
  /** Effective use-by indexed by exact stock identity. */
  readonly useBy: ReadonlyMap<string, number | undefined>;
  /** Exact item revision owning the axis. */
  readonly itemRevisionId: ItemRevisionId;
  /** Whole deterministic positive/negative position pool. */
  readonly poolPositions: readonly InventoryStockPosition[];
  /** Exact positive positions selected by the caller. */
  readonly selectedPositionIds: ReadonlySet<string>;
  /** Measurement axis being attributed. */
  readonly axisId: string;
  /** Exact unit of this axis. */
  readonly unit: Quantity["unit"];
  /** Authority time used for usable-only filtering. */
  readonly atEpochMs: number;
  /** True when expired rows may not carry deficit burden. */
  readonly usableOnly: boolean;
}

/** Attribute one signed deficit axis without creating synthetic lot history. */
function availabilitySelectedDeficitAxisBurden({
  useBy,
  itemRevisionId,
  poolPositions,
  selectedPositionIds,
  axisId,
  unit,
  atEpochMs,
  usableOnly,
}: AvailabilitySelectedDeficitAxisBurdenInput): Quantity {
  const capacityByPositionIdentity = new Map<string, Quantity>();
  const lines: Array<{
    /** Exact positive stock position carrying this axis capacity. */
    readonly position: InventoryStockPosition["key"];
    /** Positive axis capacity eligible to absorb deficit burden. */
    readonly capacity: Quantity;
  }> = [];
  for (const position of poolPositions) {
    if (inventoryPositionIsDeficit(position)) continue;
    const identity = inventoryStockPositionIdentity(position.key);
    const expiry = useBy.get(identity);
    if (
      usableOnly &&
      (position.key.placementNodeId === undefined ||
        position.key.transferId !== undefined ||
        (expiry !== undefined && expiry <= atEpochMs))
    ) {
      continue;
    }
    const capacity = inventoryMeasurementAt(
      position.measurements,
      axisId,
      unit
    );
    if (compareQuantity(capacity, zeroQuantity(unit, capacity.decimals)) <= 0) {
      continue;
    }
    capacityByPositionIdentity.set(identity, capacity);
    lines.push({ position: position.key, capacity });
  }
  const burden = applyInventoryWorkingDeficitBurdenToPositions({
    positions: poolPositions,
    itemRevisionId,
    axisId,
    unit,
    placementNodeIds: [],
    lines,
  });
  /** The adjusted capacity can be wide even when the charge assigned to this row fits. */
  const selectedBurden: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  for (const identity of selectedPositionIds) {
    const capacity = capacityByPositionIdentity.get(identity);
    const adjusted = burden.capacityByPositionIdentity.get(identity);
    if (capacity === undefined || adjusted === undefined) continue;
    const absorbed = subtractWorkingQuantity(capacity, adjusted);
    addExactQuantityDigits(selectedBurden, BigInt(absorbed.amountMinor), absorbed.decimals);
  }
  return materializeInventoryWorkingQuantity(
    { amountMinor: selectedBurden.minor, decimals: selectedBurden.decimals, unit }, "Inventory selected deficit"
  );
}

/** Sum deficits in selected placement/whereabouts pools without narrowing by lot or owner. */
function availabilityPoolDeficitMeasurements(
  poolPositions: readonly InventoryStockPosition[],
  item: InventoryItemDefinitionRevision,
  selector: InventoryStockSelector
): InventoryMeasurementVector {
  // Explicit absence/presence cannot be inferred from an empty placement-node set.
  const absentOnly =
    selector.placement?.kind === InventoryOptionalIdentityConstraintKind.Absent;
  const presentOnly =
    selector.placement?.kind === InventoryOptionalIdentityConstraintKind.Present;
  // A cohort-scoped read may share a revision with thousands of unrelated
  // cohorts; the allowed IDs are indexed once, not linearly searched per row.
  const whereabouts = selector.whereabouts;
  const allowedWhereaboutsIds =
    whereabouts?.kind === InventoryOptionalIdentityConstraintKind.Allowed
      ? new Set(whereabouts.valueIds)
      : undefined;
  /** Keep every selected deficit axis exact until the summary is returned. */
  const deficit = inventoryMeasurementTotalsFromVector(zeroInventoryMeasurementsForItem(item));
  for (const position of poolPositions) {
    const nodeId = position.key.placementNodeId;
    if (
      (absentOnly && nodeId !== undefined) ||
      (presentOnly && nodeId === undefined)
    ) continue;
    const measurements = inventoryPositionDeficitMeasurements(position);
    if (measurements === undefined) continue;
    // Cohort checks are needed only for negative rows. Keep ordinary
    // positive stock rows on the existing cheap placement/deficit path.
    const { whereaboutsId, whereaboutsState } = position.key;
    if (
      (whereabouts?.kind === InventoryOptionalIdentityConstraintKind.Absent &&
        whereaboutsId !== undefined) ||
      (whereabouts?.kind === InventoryOptionalIdentityConstraintKind.Present &&
        whereaboutsId === undefined) ||
      (allowedWhereaboutsIds !== undefined &&
        (whereaboutsId === undefined ||
          !allowedWhereaboutsIds.has(whereaboutsId))) ||
      (selector.whereaboutsStates !== undefined &&
        (whereaboutsState === undefined ||
          !selector.whereaboutsStates.includes(whereaboutsState)))
    ) continue;
    addInventoryMeasurementTotals(deficit, measurements);
  }
  return materializeInventoryMeasurementTotals(deficit, item.primaryAxis.axisId);
}

/** Exact allocation total and contributing reservation identities for one position. */
interface ExactAllocationSummary {
  /** Exact sum on the item reservation axis. */
  readonly quantity: Quantity;
  /** Active reservation identities contributing to the sum. */
  readonly reservationIds: readonly string[];
}

/** Hold quantity for a pool row before deciding whether the read returns that row. */
interface WorkingExactAllocationSummary extends Omit<ExactAllocationSummary, "quantity"> {
  /** Full-precision hold on the reservation axis. */
  readonly quantity: InventoryWorkingQuantity;
}

/** Mutable exact-allocation accumulator used only while building one read index. */
interface MutableExactAllocationSummary {
  /** Exact running quantity. */
  readonly quantity: ExactQuantityDigits;
  /** Contributing reservation identities without duplicates. */
  readonly reservationIds: Set<string>;
}

/** Sum real exact holds once across the complete affected pool. */
function indexScopedAvailabilityHolds(
  pool: InventoryScopedStockPool,
  positions: ReadonlyMap<string, number | undefined>,
  item: InventoryItemDefinitionRevision,
  unit: Quantity["unit"],
  atEpochMs: number
): ReadonlyMap<string, WorkingExactAllocationSummary> {
  /** Mutable quantities and unique claim IDs accumulated per exact position. */
  const totals = new Map<string, MutableExactAllocationSummary>();
  for (const reservation of pool.reservations) {
    if (reservation.itemRevisionId !== item.revisionId ||
        !inventoryReservationIsActiveAt(reservation, atEpochMs)) continue;
    for (const allocation of reservation.allocations) {
      const id = inventoryStockPositionIdentity(allocation.position);
      if (!positions.has(id)) continue;
      const current = totals.get(id) ?? {
        quantity: { minor: 0n, decimals: 0 },
        reservationIds: new Set<string>(),
      };
      addExactQuantityDigits(current.quantity, BigInt(allocation.quantity.amountMinor), allocation.quantity.decimals);
      current.reservationIds.add(reservation.reservationId);
      totals.set(id, current);
    }
  }
  /** The returned quantities and deterministically sorted claim IDs. */
  const holds = new Map<string, WorkingExactAllocationSummary>();
  for (const [id, total] of totals) {
    holds.set(id, {
      quantity: { amountMinor: total.quantity.minor, decimals: total.quantity.decimals, unit },
      reservationIds: [...total.reservationIds].sort(),
    });
  }
  return holds;
}

/** Revision-local claim index used by one availability summary. */
interface AvailabilityReservationIndex {
  /** Exact allocations whose selected physical position no longer exists. */
  readonly unbacked: ExactAllocationSummary;
  /** Exact requested quantity of broad claims touching this read scope. */
  readonly broadRequested: Quantity;
  /** Broad reservation identities touching this read scope. */
  readonly broadReservationIds: readonly string[];
}

/** Inputs for indexing one revision's active claims exactly once. */
interface IndexAvailabilityReservationsInput {
  /** Active reservation rows reconstructed at the requested authority time. */
  readonly activeReservations: readonly InventoryReservation[];
  /** Current published projection. */
  readonly projection: InventoryProjectionState;
  /** Normalized read selector. */
  readonly selector: InventoryStockSelector;
  /** Selected current positions for this revision. */
  readonly positions: readonly InventoryStockPosition[];
  /** Exact frozen item revision. */
  readonly revisionId: ItemRevisionId;
  /** Reservation-axis unit. */
  readonly unit: Quantity["unit"];
  /** Authority time used for broad-claim expiry eligibility. */
  readonly atEpochMs: number;
}

/**
 * Build broad and unbacked claim facts for the explicit global availability report.
 * This keeps availability O(positions + reservations + allocations), apart from one cached
 * selected-position scan per distinct broad selector.
 */
function availabilityClaimTotals({
  activeReservations,
  projection,
  selector,
  positions,
  revisionId,
  unit,
  atEpochMs,
}: IndexAvailabilityReservationsInput): AvailabilityReservationIndex {
  const normalizedSelector = normalizeInventoryStockSelector(selector);
  const selectedPositionIdentities = new Set(
    positions.map(
      /** Convert one selected position to its exact immutable identity. */
      (position) => inventoryStockPositionIdentity(position.key)
    )
  );
  /** Exact allocations without a selected physical row. */
  const unbackedQuantity: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const unbackedReservationIds = new Set<string>();
  /** Total active broad demand touching the current read. */
  const broadRequested: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const broadReservationIds: string[] = [];
  const broadSelectorTouches = new Map<string, boolean>();

  for (const reservation of activeReservations) {
    if (reservation.itemRevisionId !== revisionId) continue;
    const allocations = reservation.allocations;
    if (allocations.length === 0) {
      const touchIdentity = `${inventoryStockSelectorIdentity(
        reservation.selector
      )}|allowExpired=${reservation.allowExpiredStock === true}`;
      let touches = broadSelectorTouches.get(touchIdentity);
      if (touches === undefined) {
        touches = reservationTouchesPositions(
          reservation,
          projection,
          positions,
          atEpochMs
        );
        broadSelectorTouches.set(touchIdentity, touches);
      }
      if (touches) {
        broadReservationIds.push(reservation.reservationId);
        addExactQuantityDigits(broadRequested, BigInt(reservation.requested.amountMinor), reservation.requested.decimals);
      }
      continue;
    }

    let contributesUnbacked = false;
    for (const allocation of allocations) {
      const identity = inventoryStockPositionIdentity(allocation.position);
      if (selectedPositionIdentities.has(identity)) continue;
      if (
        projection.positions[identity] === undefined &&
        inventoryStockPositionMatchesNormalizedSelector(
          allocation.position,
          normalizedSelector,
          projection.placement
        )
      ) {
        addExactQuantityDigits(unbackedQuantity, BigInt(allocation.quantity.amountMinor), allocation.quantity.decimals);
        contributesUnbacked = true;
      }
    }
    if (contributesUnbacked) {
      unbackedReservationIds.add(reservation.reservationId);
    }
  }

  broadReservationIds.sort();
  return {
    unbacked: {
      quantity: materializeInventoryWorkingQuantity({
        amountMinor: unbackedQuantity.minor, decimals: unbackedQuantity.decimals, unit,
      }, "Inventory unbacked allocation total"),
      reservationIds: [...unbackedReservationIds].sort(),
    },
    broadRequested: materializeInventoryWorkingQuantity({
      amountMinor: broadRequested.minor, decimals: broadRequested.decimals, unit,
    }, "Inventory broad reservation total"),
    broadReservationIds,
  };
}

/** Keep physical capacity after exact allocations non-negative and full precision. */
function unheldWorkingCapacity(
  physical: Quantity,
  allocated: InventoryWorkingQuantity
): InventoryWorkingQuantity {
  if (compareWorkingQuantities(physical, allocated) <= 0) {
    return zeroQuantity(
      physical.unit,
      Math.max(physical.decimals, allocated.decimals)
    );
  }
  return subtractWorkingQuantity(physical, allocated);
}

/** Return whether one broad claim can use at least one selected current position. */
function reservationTouchesPositions(
  reservation: InventoryReservation,
  projection: InventoryProjectionState,
  positions: readonly InventoryStockPosition[],
  atEpochMs: number
): boolean {
  const normalizedSelector = normalizeInventoryStockSelector(reservation.selector);
  for (const position of positions) {
    if (
      !inventoryStockPositionMatchesNormalizedSelector(
        position.key,
        normalizedSelector,
        projection.placement
      )
    ) {
      continue;
    }
    if (
      reservation.allowExpiredStock !== true &&
      inventoryPositionIsExpiredAt(projection, position.key, atEpochMs)
    ) {
      continue;
    }
    return true;
  }
  return false;
}
