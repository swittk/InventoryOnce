import { assertInventoryAmountKind, positionHasUnfixedIndependentMeasuredContents } from "./stock-amount-rules.js";
import {
  allocateInventory,
  compareInventoryAllocationCandidates,
  InventoryAllocationMethod,
  type InventoryAllocationCandidate,
} from "./allocation.js";
import {
  InventoryAmountKind,
  measuredStockAmount,
  packageAmount,
  resolveInventoryAmount,
  stockAmount,
  type InventoryAmount,
  type InventoryIndependentAmountInput,
} from "./amounts.js";
import {
  InventoryMeasurementRequirement,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
} from "./catalog.js";
import {
  applyInventoryRecordedDeficitBurden,
  inventoryRecordedDeficitPoolSelector,
} from "./deficits.js";
import { assertCanonicalInventoryTime } from "./events.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementAt,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
  type ItemRevisionId,
} from "./model.js";
import type { InventoryProjectionState } from "./projection.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
import {
  addQuantity,
  compareQuantity,
  positiveQuantity,
  quantityEq,
  quantityToDecimalString,
  quantityWholeMultipleCount,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  inventoryReservationIsActiveAt,
  inventoryReservationsAt,
  type InventoryReservation,
  type InventoryReservationBook,
} from "./reservations.js";
import {
  InventoryOptionalIdentityConstraintKind,
  inventoryStockPositionMatchesNormalizedSelector,
  inventoryStockPositionMatchesSelector,
  normalizeInventoryStockSelector,
  type InventoryOptionalIdentityConstraint,
  type InventoryStockSelector,
} from "./selectors.js";
import { inventoryPositionEffectiveUseBy } from "./usability.js";
import type { InventoryWorldState } from "./world.js";

/** One generic policy request that may be previewed or committed by issue/transfer/scrap helpers. */
export interface InventoryAllocationPolicyRequest {
  /** Eligible stock scope; omitted dimensions remain deliberately broad. */
  readonly selector: InventoryStockSelector;
  /** Exact measured quantity or exact package count requested. */
  readonly amount: InventoryAmount;
  /** Optional exact item revision; defaults to package/active revision. */
  readonly itemRevisionId?: ItemRevisionId;
  /** FIFO or FEFO stock ordering. */
  readonly method: InventoryAllocationMethod;
  /** Explicit override permitting expired lots. */
  readonly allowExpiredLots?: boolean;
  /** Reservation whose own exact allocation must not reduce candidate capacity. */
  readonly reservationId?: string;
  /** Explicit physical-truth override allowing already-allocated positions to remain candidates. */
  readonly allowAllocatedStock?: boolean;
}

/** One exact source chosen by native policy planning. */
export interface InventoryPolicyAllocationLine {
  /** Exact revision-qualified source position. */
  readonly position: InventoryStockPositionKey;
  /** Public amount that can be passed directly to an exact movement command. */
  readonly amount: InventoryAmount;
  /** Exact primary-axis quantity represented by this line. */
  readonly allocatedPrimary: Quantity;
  /** Time this exact position most recently became positive after being empty/negative. */
  readonly layerStartedAt: string;
  /** Current lot expiry used by FEFO/expiry exclusion when known. */
  readonly expiresAt?: string;
}

/** Revision-frozen deterministic FIFO/FEFO allocation result. */
export interface InventoryPolicyAllocationPlan {
  /** Normalized selector narrowed to one exact item revision/package request. */
  readonly selector: InventoryStockSelector;
  /** Frozen item revision used by every line. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact requested primary-axis quantity. */
  readonly requestedPrimary: Quantity;
  /** Exact resolved request across every item-defined measurement axis. */
  readonly requestedMeasurements: InventoryMeasurementVector;
  /** Exact selected lines in policy order. */
  readonly lines: readonly InventoryPolicyAllocationLine[];
  /** Exact primary quantity not fulfilled. */
  readonly shortfall: Quantity;
  /** Normal exact amount that can record this shortfall as an Issue, when nonzero. */
  readonly shortfallAmount?: InventoryAmount;
  /** Existing positive deficit magnitude burdening the selected location pools. */
  readonly recordedDeficit: Quantity;
  /** Existing deficit still unbacked after all selected positive capacity. */
  readonly uncoveredDeficit: Quantity;
  /** True when otherwise-positive expired lots were excluded. */
  readonly expiredStockWasExcluded: boolean;
  /** True when intact package/serial increments prevented a greedy/full allocation. */
  readonly incrementBlockedStock: boolean;
  /** True when an exact physical assignment was rejected by a whole-plan acceptance rule. */
  readonly allocationConstraintBlockedStock: boolean;
  /** True when active broad claims remain protected only by final global feasibility checking. */
  readonly unallocatedReservationsPresent: boolean;
}

/** Inputs for previewing one allocation against a fully published world. */
export interface PlanInventoryAllocationInput
  extends InventoryAllocationPolicyRequest {
  /** Frozen catalogue used to resolve item/package/axis semantics. */
  readonly catalog: InventoryCatalog;
  /** Fully published world used for physical stock and exact claim allocations. */
  readonly world: InventoryWorldState;
  /** Physical authority time used for lot/container expiry. */
  readonly at: string;
  /** Claim-book authority time; defaults to `at` for pure previews. */
  readonly reservationAt?: string;
}

/**
 * Plan exact FIFO/FEFO lines without mutating storage or inventing stock.
 * Broad unallocated claims remain protected by the committing operation's global feasibility check.
 */
export function planInventoryAllocation({
  catalog,
  world,
  selector: rawSelector,
  amount,
  itemRevisionId,
  method,
  at,
  allowExpiredLots = false,
  reservationId,
  allowAllocatedStock = false,
  reservationAt = at,
}: PlanInventoryAllocationInput): InventoryPolicyAllocationPlan {
  assertCanonicalInventoryTime(at, "inventory allocation authority time");
  assertCanonicalInventoryTime(
    reservationAt,
    "inventory allocation reservation authority time"
  );
  const selected = resolveAllocationItemAndSelector(
    catalog,
    rawSelector,
    amount,
    itemRevisionId
  );
  const resolved = resolveInventoryAmount(catalog, selected.item, amount);
  const requestedPrimary = positiveQuantity(
    resolved.measurements.primary.quantity,
    "Inventory allocation request"
  );
  const deficitLocationIds = selectedPolicyLocationIds(
    world.projection,
    selected.selector,
    selected.item.revisionId
  );
  const deficitPoolSelector = inventoryRecordedDeficitPoolSelector(
    selected.selector,
    selected.item.revisionId,
    deficitLocationIds
  );
  const candidateResult = createPolicyAllocationCandidates({
    catalog,
    projection: world.projection,
    reservations: world.reservations,
    selector: deficitPoolSelector,
    item: selected.item,
    at,
    reservationAt,
    ...(reservationId === undefined ? {} : { reservationId }),
    allowAllocatedStock,
  });
  const deficitAdjusted = applyPolicyAllocationDeficitBurden({
    projection: world.projection,
    selector: selected.selector,
    locationIds: deficitLocationIds,
    item: selected.item,
    method,
    at,
    allowExpiredLots,
    poolCandidates: candidateResult.candidates,
  });
  const allocated = allocateInventory({
    requested: requestedPrimary,
    candidates: deficitAdjusted.candidates,
    method,
    now: at,
    // Expired rows were removed before assigning the location-level deficit burden.
    allowExpired: true,
  });
  // Final allocation lines assembled from the reviewed candidate/result pairing.
  const lines: InventoryPolicyAllocationLine[] = [];
  for (const allocation of allocated.allocations) {
    const candidate = deficitAdjusted.byPositionIdentity.get(
      inventoryStockPositionIdentity(allocation.position)
    );
    if (candidate === undefined) {
      throw new Error(
        "Inventory allocation result references a missing candidate."
      );
    }
    const currentPosition =
      world.projection.positions[
        inventoryStockPositionIdentity(allocation.position)
      ];
    if (currentPosition === undefined) {
      throw new Error(
        "Inventory allocation candidate disappeared from the reviewed world."
      );
    }
    lines.push({
      position: allocation.position,
      amount: inventoryAmountForPrimaryAllocation({
        catalog,
        itemRevisionId: selected.item.revisionId,
        position: currentPosition,
        allocatedPrimary: allocation.quantity,
      }),
      allocatedPrimary: allocation.quantity,
      layerStartedAt: candidate.receivedAt,
      ...(candidate.expiresAt === undefined
        ? {}
        : { expiresAt: candidate.expiresAt }),
    });
  }
  return {
    selector: selected.selector,
    itemRevisionId: selected.item.revisionId,
    requestedPrimary,
    requestedMeasurements: resolved.measurements,
    lines,
    shortfall: allocated.shortfall,
    ...(allocated.shortfall.amountMinor === 0
      ? {}
      : {
          shortfallAmount: inventoryAmountForPolicyShortfall({
            catalog,
            item: selected.item,
            requestedAmount: amount,
            requestedMeasurements: resolved.measurements,
            shortfallPrimary: allocated.shortfall,
          }),
        }),
    recordedDeficit: deficitAdjusted.recordedDeficit,
    uncoveredDeficit: deficitAdjusted.uncoveredDeficit,
    expiredStockWasExcluded: deficitAdjusted.expiredStockWasExcluded,
    incrementBlockedStock: allocated.incrementBlockedStock,
    allocationConstraintBlockedStock:
      allocated.allocationConstraintBlockedStock,
    unallocatedReservationsPresent:
      candidateResult.unallocatedReservationsPresent,
  };
}

/** Item revision and selector after freezing all ambiguous human/package choices. */
interface ResolvedAllocationSelection {
  /** Exact item revision used by every candidate. */
  readonly item: InventoryItemDefinitionRevision;
  /** Normalized selector narrowed to that revision and optional exact package. */
  readonly selector: InventoryStockSelector;
}

/** Candidate collection plus lookup/evidence needed to materialize public movement lines. */
interface PolicyAllocationCandidates {
  /** Exact physical candidates accepted by the generic allocation algorithm. */
  readonly candidates: readonly InventoryAllocationCandidate[];
  /** Candidate evidence keyed by exact position identity. */
  readonly byPositionIdentity: ReadonlyMap<
    string,
    InventoryAllocationCandidate
  >;
  /** True when at least one active same-revision claim is still broad/unallocated. */
  readonly unallocatedReservationsPresent: boolean;
}

/** Positive policy candidates after durable deficit has first claim on each location pool. */
interface DeficitAdjustedPolicyAllocationCandidates {
  /** Remaining positive physical candidates in deterministic policy order. */
  readonly candidates: readonly InventoryAllocationCandidate[];
  /** Adjusted candidate lookup keyed by exact position identity. */
  readonly byPositionIdentity: ReadonlyMap<
    string,
    InventoryAllocationCandidate
  >;
  /** Existing deficit magnitude in all selected location pools. */
  readonly recordedDeficit: Quantity;
  /** Existing deficit still unbacked after every eligible pool candidate. */
  readonly uncoveredDeficit: Quantity;
  /** True when at least one caller-selected row was removed for expiry policy. */
  readonly expiredStockWasExcluded: boolean;
}

/** Inputs for reducing positive policy candidates by signed recorded deficit. */
interface ApplyPolicyAllocationDeficitBurdenInput {
  /** Current signed physical projection. */
  readonly projection: InventoryProjectionState;
  /** Exact caller selector applied after the location pool pays its deficit once. */
  readonly selector: InventoryStockSelector;
  /** Location pools owning this request and their deficit. */
  readonly locationIds: readonly string[];
  /** Exact item revision/primary axis. */
  readonly item: InventoryItemDefinitionRevision;
  /** FIFO/FEFO order used to burden positive rows deterministically. */
  readonly method: InventoryAllocationMethod;
  /** Physical authority time used for expiry policy. */
  readonly at: string;
  /** Whether expired rows may back deficit and remain allocatable. */
  readonly allowExpiredLots: boolean;
  /** Positive claim-adjusted candidates across the whole location pool. */
  readonly poolCandidates: readonly InventoryAllocationCandidate[];
}

/**
 * Pay each location's signed deficit once across its whole eligible revision pool, then apply the
 * caller's lot/package/ownership selector. This blocks exact-lot bypass without charging the same
 * deficit again every time a different exact row is selected.
 */
function applyPolicyAllocationDeficitBurden({
  projection,
  selector,
  locationIds,
  item,
  method,
  at,
  allowExpiredLots,
  poolCandidates,
}: ApplyPolicyAllocationDeficitBurdenInput): DeficitAdjustedPolicyAllocationCandidates {
  const normalizedSelector = normalizeInventoryStockSelector(selector);
  // Remember whether policy filtering hid otherwise selector-matching expired stock.
  let expiredStockWasExcluded = false;
  // Candidate buffer retained in policy order before location deficit burden is applied.
  const ordered: InventoryAllocationCandidate[] = [];
  for (const candidate of poolCandidates) {
    const expired =
      candidate.expiresAt !== undefined && candidate.expiresAt <= at;
    if (expired && !allowExpiredLots) {
      if (
        inventoryStockPositionMatchesNormalizedSelector(
          candidate.position,
          normalizedSelector
        )
      ) {
        expiredStockWasExcluded = true;
      }
      continue;
    }
    ordered.push(candidate);
  }
  ordered.sort(
    /** Use the same exact ordering as the eventual allocator. */
    (left, right) => compareInventoryAllocationCandidates(left, right, method)
  );
  const burden = applyInventoryRecordedDeficitBurden({
    projection,
    itemRevisionId: item.revisionId,
    axisId: item.primaryAxis.axisId,
    unit: item.primaryAxis.unit,
    locationIds,
    lines: ordered.map(
      /** Preserve policy order while exposing only positive candidate capacity. */
      (candidate) => ({
        position: candidate.position,
        capacity: candidate.available,
        ...(candidate.allocationIncrement === undefined
          ? {}
          : { allocationIncrement: candidate.allocationIncrement }),
      })
    ),
  });
  // Candidate buffer after selector matching and one-time location deficit burden.
  const adjusted: InventoryAllocationCandidate[] = [];
  // Exact lookup used to reconcile allocator output back to the adjusted candidate metadata.
  const byPositionIdentity = new Map<string, InventoryAllocationCandidate>();
  for (const candidate of ordered) {
    if (
      !inventoryStockPositionMatchesNormalizedSelector(
        candidate.position,
        normalizedSelector
      )
    ) {
      continue;
    }
    const identity = inventoryStockPositionIdentity(candidate.position);
    const available = burden.capacityByPositionIdentity.get(identity);
    if (available === undefined) {
      throw new Error(
        `Inventory deficit adjustment lost policy candidate '${identity}'.`
      );
    }
    if (
      compareQuantity(
        available,
        zeroQuantity(available.unit, available.decimals)
      ) <= 0
    ) {
      continue;
    }
    const value = { ...candidate, available };
    adjusted.push(value);
    byPositionIdentity.set(identity, value);
  }
  return {
    candidates: adjusted,
    byPositionIdentity,
    recordedDeficit: burden.recordedDeficit,
    uncoveredDeficit: burden.uncoveredDeficit,
    expiredStockWasExcluded,
  };
}

/** Resolve every location whose signed pool is selected by this policy request. */
function selectedPolicyLocationIds(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector,
  itemRevisionId: ItemRevisionId
): readonly string[] {
  if (selector.locationIds !== undefined) return selector.locationIds;
  const locationIds = new Set<string>();
  for (const positionIdentity of inventorySparseRecordValue(
    projection.positionIdsByItemRevisionId,
    itemRevisionId
  ) ?? []) {
    const position = projection.positions[positionIdentity];
    if (position === undefined) {
      throw new Error(
        `Inventory policy item-revision index references missing position '${positionIdentity}'.`
      );
    }
    locationIds.add(position.key.locationId);
  }
  const ordered = [...locationIds];
  ordered.sort();
  return ordered;
}

/** Inputs for constructing one exact policy-allocation candidate snapshot. */
interface CreatePolicyAllocationCandidatesInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Current physical/event/lot projection. */
  readonly projection: InventoryProjectionState;
  /** Current reservation lifecycle evidence. */
  readonly reservations: InventoryReservationBook;
  /** Exact revision-frozen eligible stock scope. */
  readonly selector: InventoryStockSelector;
  /** Exact item revision and reservation axis policy. */
  readonly item: InventoryItemDefinitionRevision;
  /** Physical authority time used for expiry evidence. */
  readonly at: string;
  /** Claim-book authority time used to reconstruct active reservations. */
  readonly reservationAt: string;
  /** Optional claim whose own binding stays available to its allocator/consumer. */
  readonly reservationId?: string;
  /** Whether exact allocations should remain physically selectable. */
  readonly allowAllocatedStock: boolean;
}

/** Resolve one request to exactly one immutable item revision and optional package revision. */
function resolveAllocationItemAndSelector(
  catalog: InventoryCatalog,
  rawSelector: InventoryStockSelector,
  amount: InventoryAmount,
  explicitItemRevisionId: ItemRevisionId | undefined
): ResolvedAllocationSelection {
  assertInventoryAmountKind(amount);
  const selector = normalizeInventoryStockSelector(rawSelector);
  const packageRevision =
    amount.kind === InventoryAmountKind.Package
      ? catalog.packagingRevision(amount.packagingRevisionId)
      : undefined;
  const item =
    packageRevision === undefined
      ? explicitItemRevisionId === undefined
        ? catalog.activeItem(selector.itemId)
        : catalog.itemRevision(explicitItemRevisionId)
      : catalog.itemRevision(packageRevision.itemRevisionId);
  if (item.itemId !== selector.itemId) {
    throw new Error(
      "Inventory allocation selector and selected item revision differ."
    );
  }
  if (
    explicitItemRevisionId !== undefined &&
    explicitItemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Inventory allocation explicit item revision differs from package revision."
    );
  }
  if (
    selector.itemRevisionIds !== undefined &&
    !selector.itemRevisionIds.includes(item.revisionId)
  ) {
    throw new Error(
      "Inventory allocation item revision is outside the selector."
    );
  }
  let narrowed: InventoryStockSelector = normalizeInventoryStockSelector({
    ...selector,
    itemRevisionIds: [item.revisionId],
  });
  if (packageRevision !== undefined) {
    if (packageRevision.itemId !== item.itemId) {
      throw new Error("Inventory allocation package belongs to another item.");
    }
    if (
      !optionalIdentityConstraintAllows(
        narrowed.packagingRevision,
        packageRevision.revisionId
      )
    ) {
      throw new Error(
        "Inventory allocation package revision is outside the selector."
      );
    }
    const { packagingRevisionIds, ...withoutOldPackageShorthand } = narrowed;
    void packagingRevisionIds;
    narrowed = normalizeInventoryStockSelector({
      ...withoutOldPackageShorthand,
      packagingRevision: {
        kind: InventoryOptionalIdentityConstraintKind.Allowed,
        valueIds: [packageRevision.revisionId],
      },
    });
  }
  return { item, selector: narrowed };
}

/** Return whether an optional identity constraint permits one exact present value. */
function optionalIdentityConstraintAllows(
  constraint: InventoryOptionalIdentityConstraint | undefined,
  valueId: string
): boolean {
  if (constraint === undefined) return true;
  if (constraint.kind === InventoryOptionalIdentityConstraintKind.Present)
    return true;
  if (constraint.kind === InventoryOptionalIdentityConstraintKind.Absent)
    return false;
  return constraint.valueIds?.includes(valueId) === true;
}

/** Build exact positive candidates after subtracting active exact reservation bindings. */
function createPolicyAllocationCandidates({
  catalog,
  projection,
  reservations,
  selector,
  item,
  at,
  reservationAt,
  reservationId,
  allowAllocatedStock,
}: CreatePolicyAllocationCandidatesInput): PolicyAllocationCandidates {
  const normalizedSelector = normalizeInventoryStockSelector(selector);
  // Positive exact-position candidates retained for the allocation pass.
  const candidates: InventoryAllocationCandidate[] = [];
  // Exact-position lookup shared with the later allocation-result reconciliation pass.
  const byPositionIdentity = new Map<string, InventoryAllocationCandidate>();
  // Reservation book frozen to the same authority time as this candidate plan.
  const historicalReservations = inventoryReservationsAt(
    reservations,
    reservationAt
  );
  // Build exact claim pressure once. Re-scanning every reservation for every candidate is quadratic.
  const reservationSummary = createExactPrimaryReservationSummary({
    reservations: historicalReservations,
    item,
    at: reservationAt,
    ...(reservationId === undefined
      ? {}
      : { excludedReservationId: reservationId }),
    allowAllocatedStock,
  });

  for (const positionIdentity of inventorySparseRecordValue(
    projection.positionIdsByItemRevisionId,
    item.revisionId
  ) ?? []) {
    const position = projection.positions[positionIdentity];
    if (position === undefined) {
      throw new Error(
        `Inventory allocation item-revision index references missing position ${positionIdentity}.`
      );
    }
    // Prepared/in-transit stock is conserved truth but not ordinary allocatable stock.
    if (position.key.transferId !== undefined) continue;
    if (
      !inventoryStockPositionMatchesNormalizedSelector(
        position.key,
        normalizedSelector
      )
    ) {
      continue;
    }
    const onHand = inventoryMeasurementAt(
      position.measurements,
      item.primaryAxis.axisId,
      item.primaryAxis.unit
    );
    if (
      compareQuantity(onHand, zeroQuantity(onHand.unit, onHand.decimals)) <= 0
    )
      continue;
    const exactReserved = allowAllocatedStock
      ? zeroQuantity(item.primaryAxis.unit)
      : reservationSummary.reservedPrimaryByPositionIdentity.get(
          positionIdentity
        ) ?? zeroQuantity(item.primaryAxis.unit);
    const available = subtractQuantity(onHand, exactReserved);
    if (
      compareQuantity(
        available,
        zeroQuantity(available.unit, available.decimals)
      ) <= 0
    )
      continue;
    const receivedAt =
      projection.positiveLayerStartedAtByPositionId[positionIdentity];
    if (receivedAt === undefined) {
      throw new Error(
        `Positive inventory position ${positionIdentity} has no projected positive-layer origin.`
      );
    }
    const expiresAt = inventoryPositionEffectiveUseBy(projection, position.key);
    const candidate: InventoryAllocationCandidate = {
      position: position.key,
      available,
      receivedAt,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...allocationIncrementForPosition(catalog, position, item),
    };
    candidates.push(candidate);
    byPositionIdentity.set(
      inventoryStockPositionIdentity(position.key),
      candidate
    );
  }
  return {
    candidates,
    byPositionIdentity,
    unallocatedReservationsPresent:
      reservationSummary.unallocatedReservationsPresent,
  };
}

/** Exact reservation pressure precomputed once for one revision-frozen policy plan. */
interface ExactPrimaryReservationSummary {
  /** Active exact claim quantity keyed by exact stock-position identity. */
  readonly reservedPrimaryByPositionIdentity: ReadonlyMap<string, Quantity>;
  /** True when an active same-revision claim remains broad rather than position-bound. */
  readonly unallocatedReservationsPresent: boolean;
}

/** Inputs for one linear pass over reservation evidence before candidate iteration. */
interface CreateExactPrimaryReservationSummaryInput {
  /** Reservation rows reconstructed at the claim-book authority time. */
  readonly reservations: readonly InventoryReservation[];
  /** Exact item revision whose primary candidates are being planned. */
  readonly item: InventoryItemDefinitionRevision;
  /** Claim-book authority time used to decide whether each row still protects stock. */
  readonly at: string;
  /** Optional reservation whose own binding stays available to its allocator/consumer. */
  readonly excludedReservationId?: string;
  /** Whether exact bindings are deliberately ignored as physical-truth candidates. */
  readonly allowAllocatedStock: boolean;
}

/** Sum every active exact binding once so candidate planning stays O(reservations + allocations + candidates). */
function createExactPrimaryReservationSummary({
  reservations,
  item,
  at,
  excludedReservationId,
  allowAllocatedStock,
}: CreateExactPrimaryReservationSummaryInput): ExactPrimaryReservationSummary {
  // Exact primary-axis pressure accumulated once per bound stock position.
  const reservedPrimaryByPositionIdentity = new Map<string, Quantity>();
  // Remember whether any active broad claim still needs global feasibility protection.
  let unallocatedReservationsPresent = false;
  for (const reservation of reservations) {
    if (reservation.reservationId === excludedReservationId) continue;
    if (!inventoryReservationIsActiveAt(reservation, at)) continue;
    if (reservation.itemRevisionId !== item.revisionId) continue;
    const allocations = reservation.allocations;
    if (allocations.length === 0) {
      unallocatedReservationsPresent = true;
      continue;
    }
    if (allowAllocatedStock) continue;
    if (item.reservationAxisId !== item.primaryAxis.axisId) {
      throw new Error(
        "Automatic primary-quantity picking cannot subtract an exact reservation on an independent axis; use explicit fulfillment lines."
      );
    }
    for (const allocation of allocations) {
      const positionIdentity = inventoryStockPositionIdentity(
        allocation.position
      );
      const existing =
        reservedPrimaryByPositionIdentity.get(positionIdentity) ??
        zeroQuantity(item.primaryAxis.unit);
      reservedPrimaryByPositionIdentity.set(
        positionIdentity,
        addQuantity(existing, allocation.quantity)
      );
    }
  }
  return {
    reservedPrimaryByPositionIdentity,
    unallocatedReservationsPresent,
  };
}

/** Mark serial, measured, and intact-package rows with the smallest legal automatic issue increment. */
function allocationIncrementForPosition(
  catalog: InventoryCatalog,
  position: InventoryStockPosition,
  item: InventoryItemDefinitionRevision
): Pick<InventoryAllocationCandidate, "allocationIncrement"> {
  const capacity = inventoryMeasurementAt(
    position.measurements,
    item.primaryAxis.axisId,
    item.primaryAxis.unit
  );
  if (position.key.serialId !== undefined)
    return { allocationIncrement: capacity };
  const packagingRevisionId = position.key.packagingRevisionId;
  if (packagingRevisionId === undefined) {
    return positionHasUnfixedIndependentMeasuredContents(position, item)
      ? { allocationIncrement: capacity }
      : {};
  }
  const packaging = catalog.packagingRevision(packagingRevisionId);
  if (positionHasUnfixedIndependentMeasuredContents(position, item, packaging)) {
    return { allocationIncrement: capacity };
  }
  return {
    allocationIncrement: inventoryMeasurementAt(
      packaging.fixedContents,
      item.primaryAxis.axisId,
      item.primaryAxis.unit
    ),
  };
}

/** Inputs for turning one policy shortfall into a normal exact issue amount. */
interface InventoryAmountForPolicyShortfallInput {
  /** Frozen catalogue retaining package definitions. */
  readonly catalog: InventoryCatalog;
  /** Exact item revision selected by policy. */
  readonly item: InventoryItemDefinitionRevision;
  /** Original caller amount. */
  readonly requestedAmount: InventoryAmount;
  /** Exact resolved measurements for the original amount. */
  readonly requestedMeasurements: InventoryMeasurementVector;
  /** Exact positive unfulfilled primary quantity. */
  readonly shortfallPrimary: Quantity;
}

/** Preserve the exact request shape when recording a policy shortfall as durable deficit. */
function inventoryAmountForPolicyShortfall({
  catalog,
  item,
  requestedAmount,
  requestedMeasurements,
  shortfallPrimary,
}: InventoryAmountForPolicyShortfallInput): InventoryAmount {
  positiveQuantity(shortfallPrimary, "Inventory policy shortfall");
  const requestedPrimary = requestedMeasurements.primary.quantity;
  if (quantityEq(shortfallPrimary, requestedPrimary)) return requestedAmount;
  if (requestedAmount.independent.length > 0) {
    throw new Error(
      "Inventory policy cannot split independently measured request shortfall; issue exact measured lines instead."
    );
  }
  if (requestedAmount.kind === InventoryAmountKind.Measured) {
    return stockAmount(
      quantityToDecimalString(shortfallPrimary),
      shortfallPrimary.unit
    );
  }
  const packaging = catalog.packagingRevision(
    requestedAmount.packagingRevisionId
  );
  if (
    packaging.itemId !== item.itemId ||
    packaging.itemRevisionId !== item.revisionId
  ) {
    throw new Error(
      "Inventory policy shortfall package differs from the selected item revision."
    );
  }
  const onePackagePrimary = inventoryMeasurementAt(
    packaging.fixedContents,
    item.primaryAxis.axisId,
    item.primaryAxis.unit
  );
  return packageAmount(
    quantityWholeMultipleCount(shortfallPrimary, onePackagePrimary),
    packaging.revisionId
  );
}

/** Inputs for materializing one exact primary-axis allocation as a normal public amount. */
export interface InventoryAmountForPrimaryAllocationInput {
  /** Frozen catalogue retaining the exact item/package revisions. */
  readonly catalog: InventoryCatalog;
  /** Exact item revision used by the position and quantity. */
  readonly itemRevisionId: ItemRevisionId;
  /** Current exact stock position including independent measurements. */
  readonly position: InventoryStockPosition;
  /** Exact primary-axis quantity selected from the position. */
  readonly allocatedPrimary: Quantity;
}

/** Convert one exact primary allocation into a normal public amount or fail on lossy measured splitting. */
export function inventoryAmountForPrimaryAllocation({
  catalog,
  itemRevisionId,
  position,
  allocatedPrimary,
}: InventoryAmountForPrimaryAllocationInput): InventoryAmount {
  const item = catalog.itemRevision(itemRevisionId);
  if (
    position.key.itemRevisionId !== itemRevisionId ||
    position.key.itemId !== item.itemId
  ) {
    throw new Error(
      "Primary allocation position does not match its exact item revision."
    );
  }
  positiveQuantity(allocatedPrimary, "Primary allocation quantity");
  const fullPrimary = inventoryMeasurementAt(
    position.measurements,
    item.primaryAxis.axisId,
    item.primaryAxis.unit
  );
  if (compareQuantity(allocatedPrimary, fullPrimary) > 0) {
    throw new Error(
      "Primary allocation exceeds current stock at its exact position."
    );
  }
  const takesWholePosition =
    compareQuantity(allocatedPrimary, fullPrimary) === 0;
  const packagingRevisionId = position.key.packagingRevisionId;
  if (packagingRevisionId !== undefined) {
    const packaging = catalog.packagingRevision(packagingRevisionId);
    if (
      !takesWholePosition &&
      positionHasUnfixedIndependentMeasuredContents(position, item, packaging)
    ) {
      throw new Error(
        "Automatic picking cannot split a package position with independently measured contents; select exact measured lines."
      );
    }
    const onePackagePrimary = inventoryMeasurementAt(
      packaging.fixedContents,
      item.primaryAxis.axisId,
      item.primaryAxis.unit
    );
    const packageCount = quantityWholeMultipleCount(
      allocatedPrimary,
      onePackagePrimary
    );
    // Retain package-fixed axis IDs so only unfixed independent axes repeat their amount.
    const fixedAxes = new Set<string>();
    for (const measured of packaging.fixedContents.independent) {
      fixedAxes.add(measured.axisId);
    }
    const independent: InventoryIndependentAmountInput[] = [];
    for (const axis of item.independentAxes) {
      if (fixedAxes.has(axis.axisId)) continue;
      const measured = inventoryMeasurementAt(
        position.measurements,
        axis.axisId,
        axis.unit
      );
      const preservesIndependentMeasurement =
        axis.requirement === InventoryMeasurementRequirement.Required ||
        compareQuantity(
          measured,
          zeroQuantity(axis.unit, measured.decimals)
        ) !== 0;
      if (!preservesIndependentMeasurement) continue;
      independent.push({
        axisId: axis.axisId,
        value: quantityToDecimalString(measured),
        unit: measured.unit,
      });
    }
    return packageAmount(packageCount, packagingRevisionId, independent);
  }

  if (item.independentAxes.length === 0) {
    return stockAmount(
      quantityToDecimalString(allocatedPrimary),
      allocatedPrimary.unit
    );
  }
  if (!takesWholePosition) {
    if (positionHasUnfixedIndependentMeasuredContents(position, item)) {
      throw new Error(
        "Automatic picking cannot proportionally split independently measured stock; select exact measured lines."
      );
    }
    return stockAmount(
      quantityToDecimalString(allocatedPrimary),
      allocatedPrimary.unit
    );
  }
  const independent: InventoryIndependentAmountInput[] = [];
  for (const axis of item.independentAxes) {
    const measured = inventoryMeasurementAt(
      position.measurements,
      axis.axisId,
      axis.unit
    );
    if (
      axis.requirement === InventoryMeasurementRequirement.Required ||
      compareQuantity(measured, zeroQuantity(axis.unit, measured.decimals)) !==
        0
    ) {
      independent.push({
        axisId: axis.axisId,
        value: quantityToDecimalString(measured),
        unit: measured.unit,
      });
    }
  }
  return measuredStockAmount(
    quantityToDecimalString(allocatedPrimary),
    allocatedPrimary.unit,
    independent
  );
}
