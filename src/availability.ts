import { compareInventoryIdentityText } from "./ordering.js";
import type {
  InventoryCatalog,
  InventoryItemDefinitionRevision,
} from "./catalog.js";
import {
  applyInventoryRecordedDeficitBurden,
  inventoryRecordedDeficitPoolSelector,
  inventoryPositionDeficitMeasurements,
  inventoryPositionIsDeficit,
} from "./deficits.js";
import {
  addInventoryMeasurements,
  inventoryMeasurement,
  inventoryMeasurementAt,
  inventoryMeasurementVector,
  subtractInventoryMeasurements,
  type InventoryIndependentMeasurementInput,
  type InventoryMeasurementVector,
} from "./measurements.js";
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
import { inventoryPlacementSubtreeNodeIds } from "./placement.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import {
  addQuantity,
  compareQuantity,
  parseQuantity,
  subtractQuantity,
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
  type InventoryOptionalIdentityConstraint,
  type InventoryStockSelector,
} from "./selectors.js";
import {
  inventoryPositionEffectiveUseByEpochMs,
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
  let physicalOnHand = zeroInventoryMeasurementsForItem(item);
  let usablePhysicalOnHand = zeroInventoryMeasurementsForItem(item);
  let expiredOnHand = zeroInventoryMeasurementsForItem(item);
  let exactlyAllocatedUsable = zeroQuantity(reservationAxis.unit);
  let exactlyAllocatedExpired = zeroQuantity(reservationAxis.unit);
  const placementNodeIds = availabilityPoolPlacementNodeIds(
    projection,
    selector,
    revisionId
  );
  const deficitPoolSelector = inventoryRecordedDeficitPoolSelector(
    selector,
    revisionId,
    placementNodeIds
  );
  const poolPositions = [
    ...findInventoryPositions(projection, deficitPoolSelector),
  ];
  const reservationIndex = indexAvailabilityReservations({
    activeReservations,
    projection,
    selector,
    positions,
    revisionId,
    unit: reservationAxis.unit,
    atEpochMs,
  });
  const poolReservationIndex = indexAvailabilityReservations({
    activeReservations,
    projection,
    selector: deficitPoolSelector,
    positions: poolPositions,
    revisionId,
    unit: reservationAxis.unit,
    atEpochMs,
  });
  const pendingPositions: MutableInventoryPositionAvailability[] = [];

  for (const position of positions) {
    const isDeficit = inventoryPositionIsDeficit(position);
    const deficitMeasurements = inventoryPositionDeficitMeasurements(position);
    const expired =
      !isDeficit && inventoryPositionIsExpiredAt(projection, position.key, atEpochMs);
    const ordinarilyUsable =
      position.key.placementNodeId !== undefined &&
      position.key.transferId === undefined &&
      !expired;
    if (!isDeficit) {
      physicalOnHand = addInventoryMeasurements(
        physicalOnHand,
        position.measurements
      );
      if (expired) {
        expiredOnHand = addInventoryMeasurements(
          expiredOnHand,
          position.measurements
        );
      } else if (ordinarilyUsable) {
        usablePhysicalOnHand = addInventoryMeasurements(
          usablePhysicalOnHand,
          position.measurements
        );
      }
    }
    const exactAllocations =
      reservationIndex.exactAllocationsByPositionIdentity.get(
        inventoryStockPositionIdentity(position.key)
      ) ?? {
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
      : nonNegativeQuantityDifference(
          positiveCapacity,
          exactAllocations.quantity
        );
    if (expired) {
      exactlyAllocatedExpired = addQuantity(
        exactlyAllocatedExpired,
        exactAllocations.quantity
      );
    } else {
      exactlyAllocatedUsable = addQuantity(
        exactlyAllocatedUsable,
        exactAllocations.quantity
      );
    }
    const effectiveUseByEpochMs = inventoryPositionEffectiveUseByEpochMs(
      projection,
      position.key
    );
    pendingPositions.push({
      position,
      ...(effectiveUseByEpochMs === undefined ? {} : { effectiveUseByEpochMs }),
      expired,
      exactlyAllocated: exactAllocations.quantity,
      exactAllocationReservationIds: exactAllocations.reservationIds,
      isDeficit,
      ...(deficitMeasurements === undefined ? {} : { deficitMeasurements }),
      rawUnallocatedUsablePhysical: rawUnallocated,
    });
  }

  const positiveCapacityLines: Array<{
    /** Exact positive stock position carrying allocation capacity. */
    readonly position: InventoryStockPosition["key"];
    /** Positive capacity remaining after exact reservation evidence. */
    readonly capacity: Quantity;
  }> = [];
  for (const position of poolPositions) {
    if (inventoryPositionIsDeficit(position)) continue;
    if (
      position.key.transferId !== undefined ||
      position.key.placementNodeId === undefined
    ) {
      continue;
    }
    if (inventoryPositionIsExpiredAt(projection, position.key, atEpochMs)) continue;
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
      poolReservationIndex.exactAllocationsByPositionIdentity.get(
        inventoryStockPositionIdentity(position.key)
      ) ?? {
        quantity: zeroQuantity(reservationAxis.unit),
        reservationIds: [],
      };
    const rawUnallocated = nonNegativeQuantityDifference(
      physicalCapacity,
      exactAllocations.quantity
    );
    if (rawUnallocated.amountMinor <= 0) continue;
    positiveCapacityLines.push({
      position: position.key,
      capacity: rawUnallocated,
    });
  }
  const burden = applyInventoryRecordedDeficitBurden({
    projection,
    itemRevisionId: revisionId,
    axisId: reservationAxis.axisId,
    unit: reservationAxis.unit,
    placementNodeIds,
    lines: positiveCapacityLines,
  });
  const deficit = availabilitySelectedDeficitBurdenMeasurements({
    projection,
    item,
    placement: selector.placement,
    placementNodeIds,
    poolPositions,
    selectedPositions: positions,
    atEpochMs,
    usableOnly: false,
  });
  const usableDeficit = availabilitySelectedDeficitBurdenMeasurements({
    projection,
    item,
    placement: selector.placement,
    placementNodeIds,
    poolPositions,
    selectedPositions: positions,
    atEpochMs,
    usableOnly: true,
  });
  const onHand = subtractInventoryMeasurements(physicalOnHand, deficit);
  const usableOnHand = subtractInventoryMeasurements(
    usablePhysicalOnHand,
    usableDeficit
  );
  let unallocatedUsablePhysical = zeroQuantity(reservationAxis.unit);
  const positionSummaries: InventoryPositionAvailability[] = [];
  for (const pending of pendingPositions) {
    const identity = inventoryStockPositionIdentity(pending.position.key);
    const adjusted =
      burden.capacityByPositionIdentity.get(identity) ??
      zeroQuantity(
        reservationAxis.unit,
        pending.rawUnallocatedUsablePhysical.decimals
      );
    unallocatedUsablePhysical = addQuantity(
      unallocatedUsablePhysical,
      adjusted
    );
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
    expiredOnHand,
    reservationAxisId: reservationAxis.axisId,
    exactlyAllocatedUsable,
    exactlyAllocatedExpired,
    unallocatedUsablePhysical,
    unbackedExactlyAllocated: reservationIndex.unbacked.quantity,
    unbackedReservationIds: reservationIndex.unbacked.reservationIds,
    broadRequested: reservationIndex.broadRequested,
    broadReservationIds: reservationIndex.broadReservationIds,
    positions: positionSummaries,
  };
}

/** Private position row retained until pool-level deficit burden is known. */
interface MutableInventoryPositionAvailability
  extends Omit<InventoryPositionAvailability, "unallocatedUsablePhysical"> {
  /** Positive claim-adjusted capacity before direct-placement-pool deficit burden. */
  readonly rawUnallocatedUsablePhysical: Quantity;
}

/** Resolve every direct-placement pool selected for this item revision. */
function availabilityPoolPlacementNodeIds(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector,
  _revisionId: ItemRevisionId
): readonly string[] {
  if (selector.placementNodeIds !== undefined) return selector.placementNodeIds;
  if (selector.withinPlacementNodeIds === undefined) return [];
  const placementNodeIds = new Set<string>();
  for (const rootNodeId of selector.withinPlacementNodeIds) {
    for (const nodeId of inventoryPlacementSubtreeNodeIds(
      projection.placement,
      rootNodeId
    )) {
      placementNodeIds.add(nodeId);
    }
  }
  const ordered = [...placementNodeIds];
  ordered.sort();
  return ordered;
}

/** Inputs for attributing one direct-placement-pool deficit to a selected physical subset. */
interface AvailabilitySelectedDeficitBurdenInput {
  /** Current signed physical projection. */
  readonly projection: InventoryProjectionState;
  /** Exact item revision and all configured measurement axes. */
  readonly item: InventoryItemDefinitionRevision;
  /** Explicit normalized placement presence/absence constraint. */
  readonly placement: InventoryOptionalIdentityConstraint | undefined;
  /** Direct-placement pools owning the deficit. */
  readonly placementNodeIds: readonly string[];
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
 * A selector that explicitly includes the deficit row still sees the full signed liability.
 */
function availabilitySelectedDeficitBurdenMeasurements({
  projection,
  item,
  placement,
  placementNodeIds,
  poolPositions,
  selectedPositions,
  atEpochMs,
  usableOnly,
}: AvailabilitySelectedDeficitBurdenInput): InventoryMeasurementVector {
  if (selectedPositions.some(inventoryPositionIsDeficit)) {
    return availabilityPoolDeficitMeasurements(
      projection,
      item,
      placementNodeIds,
      placement
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
      projection,
      itemRevisionId: item.revisionId,
      placementNodeIds,
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
        projection,
        itemRevisionId: item.revisionId,
        placementNodeIds,
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
  /** Current signed physical projection. */
  readonly projection: InventoryProjectionState;
  /** Exact item revision owning the axis. */
  readonly itemRevisionId: ItemRevisionId;
  /** Direct-placement pools owning the deficit. */
  readonly placementNodeIds: readonly string[];
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
  projection,
  itemRevisionId,
  placementNodeIds,
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
    if (
      usableOnly &&
      (position.key.placementNodeId === undefined ||
        position.key.transferId !== undefined ||
        inventoryPositionIsExpiredAt(projection, position.key, atEpochMs))
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
    const identity = inventoryStockPositionIdentity(position.key);
    capacityByPositionIdentity.set(identity, capacity);
    lines.push({ position: position.key, capacity });
  }
  const burden = applyInventoryRecordedDeficitBurden({
    projection,
    itemRevisionId,
    axisId,
    unit,
    placementNodeIds,
    lines,
  });
  let selectedBurden = zeroQuantity(unit);
  for (const identity of selectedPositionIds) {
    const capacity = capacityByPositionIdentity.get(identity);
    const adjusted = burden.capacityByPositionIdentity.get(identity);
    if (capacity === undefined || adjusted === undefined) continue;
    selectedBurden = addQuantity(
      selectedBurden,
      subtractQuantity(capacity, adjusted)
    );
  }
  return selectedBurden;
}

/** Sum deficits in selected placement pools, preserving the unconstrained wildcard. */
function availabilityPoolDeficitMeasurements(
  projection: InventoryProjectionState,
  item: InventoryItemDefinitionRevision,
  placementNodeIds: readonly string[],
  placement: InventoryOptionalIdentityConstraint | undefined
): InventoryMeasurementVector {
  const selectedLocations = new Set(placementNodeIds);
  // Explicit absence/presence cannot be inferred from an empty placement-node set.
  const absentOnly =
    placement?.kind === InventoryOptionalIdentityConstraintKind.Absent;
  const presentOnly =
    placement?.kind === InventoryOptionalIdentityConstraintKind.Present;
  let deficit = zeroInventoryMeasurementsForItem(item);
  for (const positionIdentity of inventorySparseRecordValue(
    projection.positionIdsByItemRevisionId,
    item.revisionId
  ) ?? []) {
    const position = projection.positions[positionIdentity];
    if (position === undefined) {
      throw new Error(
        `Inventory availability index references missing position '${positionIdentity}'.`
      );
    }
    const nodeId = position.key.placementNodeId;
    if (
      (absentOnly && nodeId !== undefined) ||
      (presentOnly && nodeId === undefined) ||
      (placementNodeIds.length > 0 &&
        (nodeId === undefined || !selectedLocations.has(nodeId)))
    ) continue;
    const measurements = inventoryPositionDeficitMeasurements(position);
    if (measurements === undefined) continue;
    deficit = addInventoryMeasurements(deficit, measurements);
  }
  return deficit;
}

/** Exact allocation total and contributing reservation identities for one position. */
interface ExactAllocationSummary {
  /** Exact sum on the item reservation axis. */
  readonly quantity: Quantity;
  /** Active reservation identities contributing to the sum. */
  readonly reservationIds: readonly string[];
}

/** Mutable exact-allocation accumulator used only while building one read index. */
interface MutableExactAllocationSummary {
  /** Exact running quantity. */
  quantity: Quantity;
  /** Contributing reservation identities without duplicates. */
  readonly reservationIds: Set<string>;
}

/** Revision-local claim index used by one availability summary. */
interface AvailabilityReservationIndex {
  /** Exact allocations keyed by exact physical position identity. */
  readonly exactAllocationsByPositionIdentity: ReadonlyMap<
    string,
    ExactAllocationSummary
  >;
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
 * Build exact/broad/unbacked claim facts in one reservation/allocation pass.
 * This keeps availability O(positions + reservations + allocations), apart from one cached
 * selected-position scan per distinct broad selector.
 */
function indexAvailabilityReservations({
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
  const mutableByPositionIdentity = new Map<
    string,
    MutableExactAllocationSummary
  >();
  let unbackedQuantity = zeroQuantity(unit);
  const unbackedReservationIds = new Set<string>();
  let broadRequested = zeroQuantity(unit);
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
        broadRequested = addQuantity(broadRequested, reservation.requested);
      }
      continue;
    }

    let contributesUnbacked = false;
    for (const allocation of allocations) {
      const identity = inventoryStockPositionIdentity(allocation.position);
      if (selectedPositionIdentities.has(identity)) {
        const current = mutableByPositionIdentity.get(identity) ?? {
          quantity: zeroQuantity(unit),
          reservationIds: new Set<string>(),
        };
        current.quantity = addQuantity(current.quantity, allocation.quantity);
        current.reservationIds.add(reservation.reservationId);
        mutableByPositionIdentity.set(identity, current);
        continue;
      }
      if (
        projection.positions[identity] === undefined &&
        inventoryStockPositionMatchesNormalizedSelector(
          allocation.position,
          normalizedSelector,
          projection.placement
        )
      ) {
        unbackedQuantity = addQuantity(unbackedQuantity, allocation.quantity);
        contributesUnbacked = true;
      }
    }
    if (contributesUnbacked) {
      unbackedReservationIds.add(reservation.reservationId);
    }
  }

  const exactAllocationsByPositionIdentity = new Map<
    string,
    ExactAllocationSummary
  >();
  for (const [identity, summary] of mutableByPositionIdentity) {
    exactAllocationsByPositionIdentity.set(identity, {
      quantity: summary.quantity,
      reservationIds: [...summary.reservationIds].sort(),
    });
  }
  broadReservationIds.sort();
  return {
    exactAllocationsByPositionIdentity,
    unbacked: {
      quantity: unbackedQuantity,
      reservationIds: [...unbackedReservationIds].sort(),
    },
    broadRequested,
    broadReservationIds,
  };
}

/** Return exact non-negative physical capacity after exact allocations. */
function nonNegativeQuantityDifference(
  physical: Quantity,
  allocated: Quantity
): Quantity {
  if (compareQuantity(physical, allocated) <= 0) {
    return zeroQuantity(
      physical.unit,
      Math.max(physical.decimals, allocated.decimals)
    );
  }
  return subtractQuantity(physical, allocated);
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
