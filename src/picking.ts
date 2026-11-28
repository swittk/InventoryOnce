import { assertInventoryAmountKind, itemHasUnfixedIndependentMeasuredContents } from "./stock-amount-rules.js";
import {
  allocateInventoryUpTo,
  allocateWorkingInventory,
  compareWorkingAllocationCandidates,
  inventoryAllocationQuantityIfStorable,
  InventoryAllocationMethod,
  InventoryExactAllocationLimitError,
  type AllocateWorkingInventoryInput,
  type InventoryAllocation,
  type InventoryAllocationResult,
  type InventoryFullWitnessPrimaryBudget,
  type InventoryWholeMeasuredSubsets,
  type InventoryWorkingAllocationCandidate,
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
  applyInventoryWorkingDeficitBurden,
  inventoryRecordedDeficitPoolSelector,
  type InventorySignedDeficitRow,
} from "./deficits.js";
import { assertInventoryEpochMilliseconds } from "./events.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementAt,
  type InventoryMeasurementVector,
} from "./measurements.js";
import type { InventoryMeasurementTotals } from "./measurement-totals.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
  type ItemRevisionId,
} from "./model.js";
import { findInventoryPositions, type InventoryProjectionState } from "./projection.js";
import {
  addExactQuantityDigits,
  compareWorkingQuantities,
  materializeInventoryWorkingQuantity,
  quantityGreatestCommonDivisor,
  storableQuantityScale,
  subtractWorkingQuantity,
  workingQuantityAtDecimals,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
  inventoryStockPoolRowReader,
  type InventoryScopedStockPool,
  type InventoryScopedStockPosition,
} from "./stock-scope.js";
import {
  compareQuantity,
  MAXIMUM_QUANTITY_DECIMALS,
  positiveQuantity,
  quantity,
  quantityEq,
  quantityToDecimalString,
  quantityWholeMultipleCount,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  inventoryReservationIsActiveAt,
  inventoryReservationsAt,
  type InventoryReservation,
} from "./reservations.js";
import {
  InventoryOptionalIdentityConstraintKind,
  inventoryStockPositionMatchesNormalizedSelector,
  normalizeInventoryStockSelector,
  type InventoryOptionalIdentityConstraint,
  type InventoryStockSelector,
} from "./selectors.js";
import { inventorySparseRecordValue } from "./sparse-record.js";
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
  readonly layerStartedAtEpochMs: number;
  /** Current lot expiry used by FEFO/expiry exclusion when known. */
  readonly expiresAtEpochMs?: number;
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
  /** Existing positive deficit magnitude burdening the selected direct-placement pools. */
  readonly recordedDeficit: Quantity;
  /** Existing deficit still unbacked after all selected positive capacity. */
  readonly uncoveredDeficit: Quantity;
  /** True when otherwise-positive expired lots were excluded. */
  readonly expiredStockWasExcluded: boolean;
  /** True when intact package/serial increments prevented a greedy/full allocation. */
  readonly incrementBlockedStock: boolean;
  /** True when an exact physical assignment was rejected by a whole-plan acceptance rule. */
  readonly allocationConstraintBlockedStock: boolean;
  /** True when this revision has other active broad claims (excluding any supplied reservationId) without exact positions. */
  readonly unallocatedReservationsPresent: boolean;
}

/** Inputs for previewing one allocation against a fully published world. */
export interface PlanInventoryAllocationInput
  extends InventoryAllocationPolicyRequest {
  /** Frozen catalogue used to resolve item/package/axis semantics. */
  readonly catalog: InventoryCatalog;
  /** Fully published world used for physical stock and exact claim allocations. */
  readonly world: InventoryWorldState;
  /** Physical authority time used for lot/placement-ancestry expiry. */
  readonly atEpochMs: number;
  /** Claim-book authority time; defaults to `at` for pure previews. */
  readonly reservationAtEpochMs?: number;
}

/** Plan exact FIFO/FEFO lines using existing holds without mutating storage or inventing stock. */
export function planInventoryAllocation(
  input: PlanInventoryAllocationInput
): InventoryPolicyAllocationPlan {
  const selection = resolveAllocationItemAndSelector(
    input.catalog, input.selector, input.amount, input.itemRevisionId
  );
  return planInventoryAllocationInPool({
    ...input,
    selection,
    pool: inventoryAllocationPoolFromWorld(
      input.world, selection, input.reservationAtEpochMs ?? input.atEpochMs
    ),
  });
}

/** Read the canonical signed pool and claim evidence without copying the projection. */
export function inventoryAllocationPoolFromWorld(
  world: InventoryWorldState,
  selection: ResolvedAllocationSelection,
  reservationAtEpochMs: number
): InventoryScopedStockPool {
  return {
    positions: inventoryStockPoolRowsFromProjection(
      world.projection, inventoryAllocationPoolSelector(selection)
    ),
    reservations: inventoryReservationsAt(world.reservations, reservationAtEpochMs),
  };
}

/** Read exact signed rows and their live policy facts from the canonical indexes. */
export function inventoryStockPoolRowsFromProjection(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector
): readonly InventoryScopedStockPosition[] {
  const rows: InventoryScopedStockPosition[] = [];
  const readRow = inventoryStockPoolRowReader(
    projection,
    /** Capture the projection's direct parent without walking its full ancestry per row. */
    (nodeId) => inventorySparseRecordValue(projection.placement.relationByNodeId, nodeId)?.parentNodeId,
  );
  for (const position of findInventoryPositions(projection, selector)) {
    const layerStartedAtEpochMs = projection.positiveLayerStartedAtEpochMsByPositionId[
      inventoryStockPositionIdentity(position.key)
    ];
    rows.push(readRow(position, layerStartedAtEpochMs));
  }
  return rows;
}

/** Describe the complete signed pools needed before filtering by lot, package, or owner. */
export function inventoryAllocationPoolSelector(
  selection: ResolvedAllocationSelection
): InventoryStockSelector {
  return inventoryRecordedDeficitPoolSelector(selection.selector, selection.item.revisionId);
}

/** The same synchronous policy reducer can use a canonical or indexed pool. */
export interface PlanInventoryAllocationInPoolInput
  extends Omit<PlanInventoryAllocationInput, "world" | "selector" | "itemRevisionId"> {
  /** Resolved exact item revision and request selector. */
  readonly selection: ResolvedAllocationSelection;
  /** Complete signed pool rows and claim states at the requested reservation time. */
  readonly pool: InventoryScopedStockPool;
}

/** One exact unpublished stock position in an ordered policy batch. */
export interface InventoryPolicyWorkingPosition {
  /** Exact signed position receiving the ordered debits. */
  readonly key: InventoryStockPositionKey;
  /** Affected measurement balances before the enclosing event is published. */
  readonly totals: InventoryMeasurementTotals;
}

/** Published policy evidence with either a published or an unpublished balance. */
export interface InventoryPolicyWorkingRow extends Omit<InventoryScopedStockPosition, "position" | "ancestry"> {
  /** Current exact stock row at the current point in the ordered batch. */
  readonly position: InventoryStockPosition | InventoryPolicyWorkingPosition;
}

/** Signed stock and claims read at one fence with ordered balance changes applied. */
export interface InventoryPolicyWorkingPool extends Omit<InventoryScopedStockPool, "positions"> {
  /** Positions over which the policy reducer may plan. */
  readonly positions: readonly InventoryPolicyWorkingRow[];
}

/** Picker input shared by published previews and physical movement planning. */
export interface PlanWorkingInventoryAllocationInput extends Omit<PlanInventoryAllocationInPoolInput, "pool"> {
  /** Complete physical pool with any preceding requests' unpublished debits. */
  readonly pool: InventoryPolicyWorkingPool;
  /** A physical attempt defers measured residuals until the witness plan is chosen. */
  readonly recordingAttempt?: "prefer-unheld" | "all-physical";
  /** Record mode can keep a compatible partial witness and post the measured remainder. */
  readonly allowMeasuredShortfall?: boolean;
}

/** Internal picker result before a caller asks for separately materialized deficit totals. */
export interface InventoryWorkingPolicyAllocationPlan extends Omit<InventoryPolicyAllocationPlan, "recordedDeficit" | "uncoveredDeficit"> {
  /** Exact deficit in the selected pools, retained in working digits while recording. */
  readonly recordedDeficit: InventoryWorkingQuantity;
  /** Exact deficit left after every selected pool contributes capacity. */
  readonly uncoveredDeficit: InventoryWorkingQuantity;
}

/** Plan exact FIFO/FEFO picks over one complete signed stock pool. */
export function planInventoryAllocationInPool(input: PlanInventoryAllocationInPoolInput): InventoryPolicyAllocationPlan {
  const result = planWorkingInventoryAllocation(input);
  return {
    ...result,
    recordedDeficit: materializeInventoryWorkingQuantity(result.recordedDeficit, "Inventory recorded deficit"),
    uncoveredDeficit: materializeInventoryWorkingQuantity(result.uncoveredDeficit, "Inventory uncovered deficit"),
  };
}

/** Plan over private balances without storing temporary capacities or deficit totals. */
export function planWorkingInventoryAllocation({
  catalog,
  selection: selected,
  pool,
  amount,
  method,
  atEpochMs,
  allowExpiredLots = false,
  reservationId,
  allowAllocatedStock = false,
  recordingAttempt,
  allowMeasuredShortfall = false,
  reservationAtEpochMs = atEpochMs,
}: PlanWorkingInventoryAllocationInput): InventoryWorkingPolicyAllocationPlan {
  assertInventoryEpochMilliseconds(atEpochMs, "inventory allocation authority time");
  assertInventoryEpochMilliseconds(
    reservationAtEpochMs,
    "inventory allocation reservation authority time"
  );
  const resolved = resolveInventoryAmount(catalog, selected.item, amount);
  const requestedPrimary = positiveQuantity(
    resolved.measurements.primary.quantity,
    "Inventory allocation request"
  );
  const { candidateResult, deficitAdjusted } = prepareInventoryPolicyAllocationPool({
    catalog, pool, selection: selected, method, atEpochMs, reservationAtEpochMs, allowExpiredLots, allowAllocatedStock,
    ...(reservationId === undefined ? {} : { reservationId }),
  });
  /** Use the same eligible candidates and order for primary and measured selection. */
  const allocationInput: AllocateWorkingInventoryInput = {
    requested: requestedPrimary,
    candidates: deficitAdjusted.candidates,
    method,
    nowEpochMs: atEpochMs,
    // Expired rows were removed before assigning the direct-placement-pool deficit burden.
    allowExpired: true,
  };
  const validateReportedAxes = amount.independent.length > 0;
  const recordingMeasuredMovement = validateReportedAxes && recordingAttempt !== undefined;
  let allocated: InventoryAllocationResult | undefined;
  try {
    allocated = allocateWorkingInventory(allocationInput);
  } catch (error) {
    // A primary-only trial cannot rule out a witness that the measured budget can find.
    if (!validateReportedAxes || !(error instanceof InventoryExactAllocationLimitError)) throw error;
  }
  /** The exact current witnesses at each selected quantity. */
  const buildLines = (allocations: readonly InventoryAllocation[]): InventoryPolicyAllocationLine[] | undefined =>
    inventoryPolicyAllocationLines({
      catalog,
      item: selected.item,
      allocations,
      candidates: deficitAdjusted.byPositionIdentity,
      rows: candidateResult.rowsById,
    });
  let lines = allocated === undefined ? undefined : buildLines(allocated.allocations);
  if (lines === undefined || validateReportedAxes) {
    /** Check all selected axes before accepting a trial as immutable movement evidence. */
    const acceptsLines = (choices: readonly InventoryPolicyAllocationLine[] | undefined): boolean =>
      choices !== undefined && (!validateReportedAxes || inventoryPolicyMovementRemainder({
        catalog, item: selected.item, report: resolved.measurements, lines: choices,
      }) !== undefined);
    const canRecordPartial = recordingMeasuredMovement && allowMeasuredShortfall;
    const needsCompleteMeasuredWitness = validateReportedAxes && !canRecordPartial;
    // A genuine physical shortage may leave no usable witness, including when a whole pick cannot leave a storable remainder.
    const primaryWasFilled = allocated?.shortfall.amountMinor === 0;
    const incrementBlocked = !primaryWasFilled && allocated?.incrementBlockedStock === true;
    // Exhausting the primary search leaves the increment question open. The exact remainder can still prove a split.
    const rawCapacityCoversBlockedRequest = canRecordPartial && (incrementBlocked || allocated === undefined) &&
      policyPrimaryCapacityCoversRequest(allocationInput);
    const canRecordWithoutWitness = canRecordPartial && allocated !== undefined &&
      allocated.shortfall.amountMinor > 0 && !rawCapacityCoversBlockedRequest;
    // A compatible greedy prefix can still leave a larger gap than a different whole assignment.
    const couldImprovePartial = canRecordPartial && incrementBlocked;
    if (couldImprovePartial || (needsCompleteMeasuredWitness && !primaryWasFilled) || (!acceptsLines(lines) &&
      (lines === undefined || primaryWasFilled || canRecordPartial))) {
      const selectable = {
        catalog, report: resolved.measurements, candidates: deficitAdjusted.candidates, rows: candidateResult.rowsById,
      };
      // A row that cannot contribute a legal measured pick cannot join otherwise disjoint axes.
      const measuredCandidates = validateReportedAxes ? selectableMeasuredWitnesses(selectable) : allocationInput.candidates;
      /** Complete movements need primary capacity to carry every reported axis. */
      const bounds = validateReportedAxes ? measuredWitnessBounds({ ...selectable, candidates: measuredCandidates }) : {};
      /** Share the legal measured candidates and bounds across both search modes. */
      const measuredInput: AllocateWorkingInventoryInput = {
        ...allocationInput,
        ...bounds,
        candidates: measuredCandidates,
        /** Keep a witness only when its reported-axis remainder can be recorded exactly. */
        acceptAllocations: (choices) => (choices.length > 0 || canRecordWithoutWitness) && acceptsLines(buildLines(choices)),
      };
      const measured = canRecordPartial
        ? allocateInventoryUpTo({ ...measuredInput, assessIncrementBlockage: false })
        : allocateWorkingInventory(measuredInput);
      if (lines === undefined || needsCompleteMeasuredWitness || measured.allocations.length > 0 || canRecordWithoutWitness) {
        // The original primary assignment distinguishes a measurement constraint from a stock shortage.
        allocated = needsCompleteMeasuredWitness && primaryWasFilled && measured.shortfall.amountMinor > 0
          ? { ...measured, allocationConstraintBlockedStock: true }
          : measured;
        lines = buildLines(measured.allocations);
      }
      // An initially full primary pick also proves that raw capacity covered the request.
      if ((rawCapacityCoversBlockedRequest || (canRecordPartial && primaryWasFilled)) &&
          lines !== undefined && allocated !== undefined && allocated.shortfall.amountMinor > 0) {
        const remainder = inventoryPolicyMovementRemainder({
          catalog, item: selected.item, report: resolved.measurements, lines,
        });
        if (remainder !== undefined && measuredRemainderNeedsSplit({
          candidates: deficitAdjusted.candidates, rows: candidateResult.rowsById, lines, remainder,
        })) {
          allocated = { ...allocated, incrementBlockedStock: true };
        }
      }
    }
  }
  if (lines === undefined || allocated === undefined) throw new Error("Accepted allocation cannot store its measured lines.");
  if (recordingAttempt === undefined) {
    assertInventoryPolicyCanPickAroundIndependentHold(candidateResult.selectedIndependentHold, allocated.shortfall);
  }
  return {
    selector: selected.selector,
    itemRevisionId: selected.item.revisionId,
    requestedPrimary,
    requestedMeasurements: resolved.measurements,
    lines,
    shortfall: allocated.shortfall,
    ...(allocated.shortfall.amountMinor === 0 || recordingMeasuredMovement
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

/** Inputs for bounding each row by the measurements it can witness. */
interface SelectableMeasuredWitnessesInput {
  /** Retained fixed contents for candidates that can be picked by package. */
  readonly catalog: InventoryCatalog;
  /** Measurements that the movement needs to explain. */
  readonly report: InventoryMeasurementVector;
  /** Exact source rows still eligible after scope, holds, expiry, and deficit selection. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** Published or batch-local measurement evidence for those candidates. */
  readonly rows: ReadonlyMap<string, InventoryPolicyWorkingRow>;
}

/** Limit each candidate to legal increments that can fit every reported axis. */
function selectableMeasuredWitnesses({
  catalog, report, candidates, rows,
}: SelectableMeasuredWitnessesInput): readonly InventoryWorkingAllocationCandidate[] {
  const primary = report.primary;
  const selectable: InventoryWorkingAllocationCandidate[] = [];
  for (const candidate of candidates) {
    const { position, available, allocationIncrement } = candidate;
    if (allocationIncrement === undefined) {
      selectable.push(candidate);
      continue;
    }
    if (compareWorkingQuantities(allocationIncrement, primary.quantity) > 0 ||
        compareWorkingQuantities(allocationIncrement, available) > 0) continue;
    const row = rows.get(inventoryStockPositionIdentity(position));
    if (row === undefined) {
      selectable.push(candidate);
      continue;
    }
    const fullPrimary = inventoryPolicyPositionMeasurement(row.position, primary.axisId, primary.quantity.unit);
    if (compareWorkingQuantities(allocationIncrement, fullPrimary) === 0) {
      if (report.independent.every(
        /** A whole-only row must fit every reported independent axis as it stands. */
        ({ axisId, quantity }) => compareWorkingQuantities(
          inventoryPolicyPositionMeasurement(row.position, axisId, quantity.unit), quantity,
        ) <= 0,
      )) selectable.push(candidate);
      continue;
    }
    if (position.packagingRevisionId === undefined) {
      selectable.push(candidate);
      continue;
    }
    const fixed = catalog.packagingRevision(position.packagingRevisionId).fixedContents;
    /** Eligible primary capacity after allowing only whole packages that fit the report. */
    let capped = available;
    for (const { axisId, quantity } of report.independent) {
      const perPackage = inventoryMeasurementAt(fixed, axisId, quantity.unit);
      if (perPackage.amountMinor === 0) continue;
      const decimals = Math.max(quantity.decimals, perPackage.decimals);
      const packages = workingQuantityAtDecimals(quantity, decimals) / workingQuantityAtDecimals(perPackage, decimals);
      const limit = { ...allocationIncrement, amountMinor: BigInt(allocationIncrement.amountMinor) * packages };
      if (compareWorkingQuantities(limit, capped) < 0) capped = limit;
    }
    if (capped.amountMinor > 0) selectable.push(capped === available ? candidate : { ...candidate, available: capped });
  }
  return selectable;
}

/** Conservative limits proved by the reported axes and the available whole measurement increments. */
interface MeasuredWitnessBounds {
  /** The reported quantities cannot all be witnessed, so there must be a positive primary remainder. */
  readonly requiresPositiveShortfall?: boolean;
  /** Upper bound on the primary quantity of any witness. */
  readonly maximumWitnessPrimary?: InventoryWorkingQuantity;
  /** Primary budget for axis-free rows of a complete witness. */
  readonly fullWitnessPrimaryBudget?: InventoryFullWitnessPrimaryBudget;
  /** Complete and partial searches can skip whole-row combinations that exceed a reported axis. */
  readonly wholeMeasuredSubsets?: InventoryWholeMeasuredSubsets;
}

/** Reported axes supported by one selectable row. */
interface MeasuredWitnessRowSupport {
  /** First axis on this row, used to link axes that can share primary stock. */
  readonly firstAxis: number;
  /** Primary digits in the full row with the same measurement ratio as a legal pick. */
  readonly primary: bigint;
  /** Sum of this row's report fractions rounded up to normalized units. */
  normalized: bigint;
}

/** Full-witness reserve for axes that can share measured rows. */
interface MeasuredWitnessAxisGroup {
  /** Largest individual primary requirement in this group. */
  minimumPrimary: bigint;
  /** One normalized unit for each positive axis in the group. */
  normalizedRequired: bigint;
  /** Row giving the highest upper bound on contribution per primary digit. */
  densest?: MeasuredWitnessRowSupport;
}

/** Positive report remainder after an indivisible row supplies part of one axis. */
interface WholeRowAxisRemainder {
  /** Exact candidate that can only contribute its entire measurement. */
  readonly position: InventoryStockPositionKey;
  /** Amount still needed from other rows for a complete witness. */
  readonly remaining: bigint;
}

/** Upper measurement capacity and corresponding primary cost for an axis lower bound. */
interface FiniteAxisCapacity {
  /** Selectable primary stock at legal increments. */
  readonly primary: bigint;
  /** Largest contribution at that stock amount, rounded up when necessary. */
  readonly measured: bigint;
}

/** Check at most 4,096 subsets when every measured contributor can only be picked whole. */
const MAXIMUM_WHOLE_MEASURED_PROOF_ROWS = 12;

/** Exact primary and reported-axis contributions from one indivisible position. */
interface WholeMeasuredProofRow {
  /** Primary stock used when the entire position is picked. */
  readonly primary: bigint;
  /** Positive contributions indexed by the report's independent axes. */
  readonly measured: bigint[];
}

/** What the whole rows alone prove about complete measurement coverage. */
interface WholeMeasuredProof {
  /** Minimum primary required, or undefined if no subset can fill the reported axes. */
  minimumPrimary: bigint | undefined;
  /** Bit for each position appearing in at least one complete subset. */
  participatingRows: number;
  /** Subsets that fit inside the report, including those that leave independent stock unwitnessed. */
  readonly fitting: Set<number>;
}

/** Prove a primary lower bound and which whole rows can appear in any complete witness. */
function proveWholeMeasuredSubsets(
  rows: readonly WholeMeasuredProofRow[], targets: readonly bigint[], requestedPrimary: bigint,
): WholeMeasuredProof {
  const proof: WholeMeasuredProof = { minimumPrimary: undefined, participatingRows: 0, fitting: new Set() };
  /** Remaining measurement on each axis for the current subset. */
  const remaining = [...targets];
  /** Visit only subsets whose positive contributions still fit the report and primary request. */
  const visit = (index: number, primary: bigint, included: number): void => {
    const row = rows[index];
    if (row === undefined) {
      proof.fitting.add(included);
      if (remaining.some(
        /** An exact subset must leave nothing on every reported axis. */
        (amount) => amount !== 0n
      )) return;
      if (proof.minimumPrimary === undefined || primary < proof.minimumPrimary) proof.minimumPrimary = primary;
      proof.participatingRows |= included;
      return;
    }
    visit(index + 1, primary, included);
    if (primary + row.primary > requestedPrimary || row.measured.some(
      /** Further rows can only increase the contribution on an axis. */
      (amount, axis) => amount > (remaining[axis] ?? 0n)
    )) return;
    for (const [axis, amount] of row.measured.entries()) remaining[axis] = (remaining[axis] ?? 0n) - amount;
    visit(index + 1, primary + row.primary, included | (1 << index));
    for (const [axis, amount] of row.measured.entries()) remaining[axis] = (remaining[axis] ?? 0n) + amount;
  };
  visit(0, 0n, 0);
  return proof;
}

/** Lower-bound the primary needed by allowing fractional use of the last stock row. */
function finiteAxisPrimaryBound(requested: bigint, capacity: FiniteAxisCapacity[]): bigint {
  capacity.sort(
    /** Use the least primary per measurement first. */
    (left, right) => {
      const difference = left.primary * right.measured - right.primary * left.measured;
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    }
  );
  let remaining = requested;
  let primary = 0n;
  for (const row of capacity) {
    if (remaining <= row.measured) return primary + (remaining * row.primary + row.measured - 1n) / row.measured;
    remaining -= row.measured;
    primary += row.primary;
  }
  return primary;
}

/** Bound any witness and the measured primary capacity needed for a complete witness. */
function measuredWitnessBounds({
  catalog, report, candidates, rows,
}: SelectableMeasuredWitnessesInput): MeasuredWitnessBounds {
  const primary = report.primary;
  const decimals = MAXIMUM_QUANTITY_DECIMALS;
  const requested = workingQuantityAtDecimals(primary.quantity, decimals);
  /** The tightest limit from all independently reported axes. */
  let maximum = requested;
  /** Each reported axis starts in its own group until a stock row can witness both. */
  const axisGroups = report.independent.map(
    /** Assign each axis its own initial representative. */
    (_, index) => index
  );
  /** Find a group representative without revisiting the full measurement pool. */
  const groupOf = (axis: number): number => {
    let root = axis;
    while (true) {
      const next = axisGroups[root] ?? root;
      if (next === root) break;
      root = next;
    }
    axisGroups[axis] = root;
    return root;
  };
  /** Shared support and combined contribution matter only for a multi-axis report. */
  const supportByPosition = report.independent.length > 1 ? new Map<InventoryStockPositionKey, MeasuredWitnessRowSupport>() : undefined;
  /** Whole measured contributors for a small complete-witness proof. Mixed or larger support uses the general bounds. */
  let wholeProofRows = report.independent.length > 1 ? new Map<InventoryStockPositionKey, WholeMeasuredProofRow>() : undefined;
  /** Subset feasibility transferred to the existing ordered allocation search. */
  let wholeMeasuredSubsets: InventoryWholeMeasuredSubsets | undefined;
  /** Rows that leave an axis remainder below every other row's smallest contribution. */
  let completeExclusions = supportByPosition === undefined ? undefined : new Set<InventoryStockPositionKey>();
  /** Decimal scale for rounding each fraction of an axis's reported quantity upward. */
  const normalizedAxisUnit = supportByPosition === undefined ? 0n : 10n ** BigInt(decimals);
  /** Lower bound for the primary stock that must carry each reported axis. */
  const requiredByAxis: bigint[] = [];
  /** Known absence of a complete witness on at least one reported axis. */
  let requiresPositiveShortfall = false;
  /** Rows supplying at least one positively reported independent axis. */
  const measuredPositions = new Set<InventoryStockPositionKey>();
  for (const [axisIndex, { axisId, quantity }] of report.independent.entries()) {
    const reported = workingQuantityAtDecimals(quantity, decimals);
    /** Capacity that does not consume this axis. */
    let axisFreePrimary = 0n;
    /** Greatest and least primary-to-axis ratios among the rows that carry this measurement. */
    let largestPrimary = 0n;
    let largestMeasured = 1n;
    /** A zero measured denominator means the least ratio has no contributing row yet. */
    let smallestPrimary = 0n;
    let smallestMeasured = 0n;
    /** Selectable contributions tied for the least primary cost on this axis. */
    let bestRatioCapacity = 0n;
    /** Contributions for a finite bound if the best ratio is insufficient. */
    const axisCapacity: FiniteAxisCapacity[] = [];
    /** Gross upper bound and common digit increment for selectable contributions on the axis. */
    let selectableMeasured = 0n;
    let measuredDivisor = 0n;
    /** Smallest positive legal contributions from two distinct positions on this axis. */
    let smallestIncrement: bigint | undefined;
    let secondIncrement: bigint | undefined;
    let smallestIncrementPosition: InventoryStockPositionKey | undefined;
    /** Whole rows leaving a positive remainder that another position must supply. */
    const wholeRowRemainders: WholeRowAxisRemainder[] = [];
    for (const { position, available, allocationIncrement } of candidates) {
      const availablePrimary = workingQuantityAtDecimals(available, decimals);
      const increment = allocationIncrement === undefined ? 1n : workingQuantityAtDecimals(allocationIncrement, decimals);
      const selectablePrimary = availablePrimary - availablePrimary % increment;
      if (selectablePrimary === 0n) continue;
      const row = rows.get(inventoryStockPositionIdentity(position));
      if (row === undefined) return {};
      const axis = inventoryPolicyPositionMeasurement(row.position, axisId, quantity.unit);
      if (BigInt(axis.amountMinor) === 0n) {
        axisFreePrimary += selectablePrimary;
        continue;
      }
      // Measured loose rows are picked whole, and selectable package rows keep their fixed ratio.
      const fullPrimary = inventoryPolicyPositionMeasurement(row.position, primary.axisId, primary.quantity.unit);
      const rowPrimary = workingQuantityAtDecimals(fullPrimary, decimals);
      const rowMeasured = workingQuantityAtDecimals(axis, decimals);
      if (rowPrimary * largestMeasured > largestPrimary * rowMeasured) {
        largestPrimary = rowPrimary;
        largestMeasured = rowMeasured;
      }
      if (reported === 0n) continue;
      measuredPositions.add(position);
      const wholeRow = allocationIncrement !== undefined && compareWorkingQuantities(allocationIncrement, fullPrimary) === 0;
      if (wholeProofRows !== undefined) {
        if (!wholeRow || position.packagingRevisionId !== undefined || rowMeasured < 0n) {
          // A package increment or signed contribution needs the existing general witness bounds.
          wholeProofRows = undefined;
        } else {
          let proofRow = wholeProofRows.get(position);
          if (proofRow === undefined && wholeProofRows.size < MAXIMUM_WHOLE_MEASURED_PROOF_ROWS) {
            proofRow = { primary: rowPrimary, measured: new Array<bigint>(report.independent.length).fill(0n) };
            wholeProofRows.set(position, proofRow);
          }
          if (proofRow === undefined) wholeProofRows = undefined;
          else proofRow.measured[axisIndex] = rowMeasured;
        }
      }
      if (completeExclusions !== undefined) {
        // Round down so an exact contribution from a different position is never ruled out.
        const quantum = allocationIncrement === undefined ? 1n : (rowMeasured * increment / rowPrimary || 1n);
        if (smallestIncrement === undefined || quantum < smallestIncrement) {
          secondIncrement = smallestIncrement;
          smallestIncrement = quantum;
          smallestIncrementPosition = position;
        } else if (secondIncrement === undefined || quantum < secondIncrement) {
          secondIncrement = quantum;
        }
        if (wholeRow && rowMeasured < reported) {
          wholeRowRemainders.push({ position, remaining: reported - rowMeasured });
        }
      }
      if (supportByPosition !== undefined) {
        const support = supportByPosition.get(position);
        // Round up each contribution so the combined density cannot overstate required primary.
        const normalized = (support?.normalized ?? 0n) +
          (rowMeasured * normalizedAxisUnit + reported - 1n) / reported;
        if (support === undefined) supportByPosition.set(position, { firstAxis: axisIndex, primary: rowPrimary, normalized });
        else {
          support.normalized = normalized;
          axisGroups[groupOf(axisIndex)] = groupOf(support.firstAxis);
        }
      }
      const capacityNumerator = selectablePrimary * rowMeasured;
      const legalMeasured = capacityNumerator / rowPrimary;
      const upperMeasured = legalMeasured + (capacityNumerator % rowPrimary === 0n ? 0n : 1n);
      axisCapacity.push({ primary: selectablePrimary, measured: upperMeasured });
      const ratioDifference = rowPrimary * smallestMeasured - smallestPrimary * rowMeasured;
      if (smallestMeasured === 0n || ratioDifference < 0n) {
        smallestPrimary = rowPrimary;
        smallestMeasured = rowMeasured;
        bestRatioCapacity = upperMeasured;
      } else if (ratioDifference === 0n) {
        bestRatioCapacity += upperMeasured;
      }
      // A legal selectable multiple carries the same measurement ratio as the full row.
      selectableMeasured += legalMeasured;
      if (measuredDivisor !== 1n) {
        if (wholeRow) {
          measuredDivisor = quantityGreatestCommonDivisor(measuredDivisor, rowMeasured);
        } else if (allocationIncrement !== undefined && position.packagingRevisionId !== undefined) {
          const fixed = catalog.packagingRevision(position.packagingRevisionId).fixedContents;
          const perPackage = inventoryMeasurementAt(fixed, axisId, quantity.unit);
          // If this axis cannot be attributed to each package, disable the divisibility proof.
          measuredDivisor = perPackage.amountMinor === 0 ? 1n :
            quantityGreatestCommonDivisor(measuredDivisor, workingQuantityAtDecimals(perPackage, decimals));
        } else {
          measuredDivisor = 1n;
        }
      }
    }
    for (const { position, remaining } of wholeRowRemainders) {
      const smallestOther = position === smallestIncrementPosition ? secondIncrement : smallestIncrement;
      // A partial witness can still use the row. Only a complete witness must cover this remainder.
      if (smallestOther === undefined || remaining < smallestOther) completeExclusions?.add(position);
    }
    const limit = axisFreePrimary + reported * largestPrimary / largestMeasured;
    if (limit < maximum) maximum = limit;
    if (reported > selectableMeasured || (measuredDivisor > 1n && reported % measuredDivisor !== 0n)) {
      requiresPositiveShortfall = true;
    }
    if (smallestMeasured !== 0n) {
      requiredByAxis[axisIndex] = (reported * smallestPrimary + smallestMeasured - 1n) / smallestMeasured;
      if (reported > bestRatioCapacity && reported <= selectableMeasured) {
        // The best ratio can cover only part of the report. Fill the rest from finite rows.
        const finite = finiteAxisPrimaryBound(reported, axisCapacity);
        if (finite > requiredByAxis[axisIndex]) requiredByAxis[axisIndex] = finite;
      }
    }
  }
  /** Axes in one group can use the same measured rows. */
  const groups = new Map<number, MeasuredWitnessAxisGroup>();
  for (const [axis, required] of requiredByAxis.entries()) {
    if (required === undefined) continue;
    const root = groupOf(axis);
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, { minimumPrimary: required, normalizedRequired: normalizedAxisUnit });
    } else {
      if (required > group.minimumPrimary) group.minimumPrimary = required;
      group.normalizedRequired += normalizedAxisUnit;
    }
  }
  if (supportByPosition !== undefined) {
    for (const support of supportByPosition.values()) {
      const group = groups.get(groupOf(support.firstAxis));
      if (group === undefined || group.normalizedRequired === normalizedAxisUnit) continue;
      const densest = group.densest;
      if (densest === undefined || support.normalized * densest.primary > densest.normalized * support.primary) {
        group.densest = support;
      }
    }
  }
  /** Distinct groups have disjoint supporting rows, so their primary bounds add. */
  let requiredMeasuredPrimary = 0n;
  for (const { minimumPrimary, normalizedRequired, densest } of groups.values()) {
    // Even shared stock needs enough primary to supply its group's report at the best density.
    const combined = densest === undefined ? 0n :
      (normalizedRequired * densest.primary + densest.normalized - 1n) / densest.normalized;
    requiredMeasuredPrimary += combined > minimumPrimary ? combined : minimumPrimary;
  }
  if (wholeProofRows !== undefined && wholeProofRows.size > 0) {
    const proof = proveWholeMeasuredSubsets([...wholeProofRows.values()], report.independent.map(
      /** Ignore zero axes in this proof. The existing witness rule still validates them. */
      ({ quantity }) => workingQuantityAtDecimals(quantity, decimals)
    ), requested);
    const bitsByPosition = new Map<InventoryStockPositionKey, number>();
    for (const position of wholeProofRows.keys()) {
      const bit = 1 << bitsByPosition.size;
      bitsByPosition.set(position, bit);
      if (proof.minimumPrimary !== undefined && (proof.participatingRows & bit) === 0) {
        completeExclusions ??= new Set();
        completeExclusions.add(position);
      }
    }
    wholeMeasuredSubsets = { bitsByPosition, fitting: proof.fitting };
    if (proof.minimumPrimary === undefined) {
      requiresPositiveShortfall = true;
    } else {
      if (proof.minimumPrimary > requiredMeasuredPrimary) requiredMeasuredPrimary = proof.minimumPrimary;
    }
  }
  requiresPositiveShortfall ||= requiredMeasuredPrimary > requested;
  return {
    requiresPositiveShortfall,
    ...(wholeMeasuredSubsets === undefined ? {} : { wholeMeasuredSubsets }),
    maximumWitnessPrimary: { amountMinor: maximum, decimals, unit: primary.quantity.unit },
    ...(requiresPositiveShortfall || requiredMeasuredPrimary === 0n ? {} : {
      fullWitnessPrimaryBudget: {
        measuredPositions,
        axisFreeLimit: { amountMinor: requested - requiredMeasuredPrimary, decimals, unit: primary.quantity.unit },
        ...(completeExclusions?.size ? { completeExclusions } : {}),
      },
    }),
  };
}

/** Physical policy inputs shared with capacity-only member selection. */
type PrepareInventoryPolicyAllocationPoolInput = Pick<
  PlanWorkingInventoryAllocationInput,
  "catalog" | "pool" | "selection" | "method" | "atEpochMs" | "reservationAtEpochMs" |
  "allowExpiredLots" | "allowAllocatedStock" | "reservationId"
>;

/** Prepare eligible working rows without constructing a request for their combined capacity. */
export function prepareInventoryPolicyAllocationPool({
  catalog, pool, selection, method, atEpochMs, reservationAtEpochMs = atEpochMs,
  allowExpiredLots = false, allowAllocatedStock = false, reservationId,
}: PrepareInventoryPolicyAllocationPoolInput) {
  // The signed pool has already applied the subtree constraint.
  const { withinPlacementNodeIds: _withinPlacementNodeIds, ...stockSelector } = selection.selector;
  const candidateResult = createPolicyAllocationCandidates({
    catalog, pool, item: selection.item, stockSelector, reservationAtEpochMs, allowAllocatedStock,
    stockAtEpochMs: atEpochMs, allowExpiredLots,
    ...(reservationId === undefined ? {} : { reservationId }),
  });
  const deficitAdjusted = applyPolicyAllocationDeficitBurden({
    selector: stockSelector, item: selection.item, method, atEpochMs, allowExpiredLots,
    rowsById: candidateResult.rowsById, poolCandidates: candidateResult.candidates,
  });
  return { candidateResult, deficitAdjusted };
}

/** Accepted whole witnesses and the remaining measured report. */
interface MeasuredRemainderNeedsSplitInput {
  /** Eligible stock after applying the signed pool burden. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** Current stored or batch-local measured rows. */
  readonly rows: ReadonlyMap<string, InventoryPolicyWorkingRow>;
  /** Accepted quantities to subtract from their exact rows before checking for a split. */
  readonly lines: readonly InventoryPolicyAllocationLine[];
  /** Exact measurements still to be explained by the physical report. */
  readonly remainder: InventoryMeasurementVector;
}

/** Detect when remaining eligible stock could cover the exact report only by splitting an increment. */
function measuredRemainderNeedsSplit({
  candidates, rows, lines, remainder,
}: MeasuredRemainderNeedsSplitInput): boolean {
  /** Each exact position contributes at most one accepted witness. */
  const picked = new Map<string, Quantity>();
  for (const { position, allocatedPrimary } of lines) {
    picked.set(inventoryStockPositionIdentity(position), allocatedPrimary);
  }
  const primary = remainder.primary.quantity;
  for (const candidate of candidates) {
    const increment = candidate.allocationIncrement;
    if (increment === undefined || compareWorkingQuantities(increment, primary) <= 0) continue;
    const identity = inventoryStockPositionIdentity(candidate.position);
    const witnessed = picked.get(identity);
    const remaining = witnessed === undefined ? candidate.available : subtractWorkingQuantity(candidate.available, witnessed);
    if (compareWorkingQuantities(remaining, primary) < 0) continue;
    const row = rows.get(identity);
    if (row === undefined) continue;
    const onHand = inventoryPolicyPositionMeasurement(row.position, remainder.primary.axisId, primary.unit);
    // Only fixed-content packages can contribute a partial witness from an increment-bound row.
    // Their remaining packages have the same proportions as the row before the pick.
    const compatible = remainder.independent.every(
      /** Cross-multiply exact digits without assigning weights to individual pieces. */
      ({ axisId, quantity }) => {
        const measured = inventoryPolicyPositionMeasurement(row.position, axisId, quantity.unit);
        return compareWorkingQuantities({
          amountMinor: BigInt(quantity.amountMinor) * BigInt(onHand.amountMinor),
          decimals: quantity.decimals + onHand.decimals,
          unit: quantity.unit,
        }, {
          amountMinor: BigInt(measured.amountMinor) * BigInt(primary.amountMinor),
          decimals: measured.decimals + primary.decimals,
          unit: quantity.unit,
        }) === 0;
      }
    );
    if (compatible) return true;
  }
  return false;
}

/** Check whether all eligible primary stock could cover the report before considering indivisible rows. */
function policyPrimaryCapacityCoversRequest({ requested, candidates }: AllocateWorkingInventoryInput): boolean {
  /** Working primary shortage at the widest scale seen so far. */
  const remaining: ExactQuantityDigits = { minor: BigInt(requested.amountMinor), decimals: requested.decimals };
  for (const { available } of candidates) {
    addExactQuantityDigits(remaining, -BigInt(available.amountMinor), available.decimals);
    if (remaining.minor <= 0n) return true;
  }
  return false;
}

/** Exact selections and their evidence at the planner's published revision. */
interface InventoryPolicyAllocationLinesInput {
  /** Retained item and package definitions. */
  readonly catalog: InventoryCatalog;
  /** Item revision selected for the request. */
  readonly item: InventoryItemDefinitionRevision;
  /** Exact quantities assigned in picking order. */
  readonly allocations: readonly InventoryAllocation[];
  /** Eligible candidates with FIFO origin and expiry. */
  readonly candidates: ReadonlyMap<string, InventoryWorkingAllocationCandidate>;
  /** Current signed stock rows with the exact measurements. */
  readonly rows: ReadonlyMap<string, InventoryPolicyWorkingRow>;
}

/** Materialize exact movement lines from allocations and the frozen source rows. */
function inventoryPolicyAllocationLines({
  catalog, item, allocations, candidates, rows,
}: InventoryPolicyAllocationLinesInput): InventoryPolicyAllocationLine[] | undefined {
  // Final allocation lines assembled from the reviewed candidate/result pairing.
  const lines: InventoryPolicyAllocationLine[] = [];
  for (const allocation of allocations) {
    const positionId = inventoryStockPositionIdentity(allocation.position);
    const candidate = candidates.get(positionId);
    if (candidate === undefined) {
      throw new Error(
        "Inventory allocation result references a missing candidate."
      );
    }
    const currentPosition = rows.get(positionId)?.position;
    if (currentPosition === undefined) {
      throw new Error("Inventory allocation candidate disappeared from its reviewed stock pool.");
    }
    const amount = inventoryAmountForWorkingPrimaryAllocation({
      catalog, itemRevisionId: item.revisionId, position: currentPosition, allocatedPrimary: allocation.quantity,
    });
    // A whole working row can have an independent axis that cannot be used in a durable line.
    if (amount === undefined) return undefined;
    lines.push({
      position: allocation.position,
      amount,
      allocatedPrimary: allocation.quantity,
      layerStartedAtEpochMs: candidate.receivedAtEpochMs,
      ...(candidate.expiresAtEpochMs === undefined
        ? {}
        : { expiresAtEpochMs: candidate.expiresAtEpochMs }),
    });
  }
  return lines;
}

/** Exact reported axes and the witnesses picked for one physical movement. */
interface InventoryPolicyMovementRemainderInput {
  /** Retained amount and package definitions. */
  readonly catalog: InventoryCatalog;
  /** Item revision named by every selected line. */
  readonly item: InventoryItemDefinitionRevision;
  /** Requested primary and explicitly reported or package-fixed independent axes. */
  readonly report: InventoryMeasurementVector;
  /** Picked witnesses whose measurements reduce the report. */
  readonly lines: readonly InventoryPolicyAllocationLine[];
}

/** Return the exact report remainder when the selected witnesses fit every reported axis. */
export function inventoryPolicyMovementRemainder({
  catalog, item, report, lines,
}: InventoryPolicyMovementRemainderInput): InventoryMeasurementVector | undefined {
  const reportedPrimary = report.primary.quantity;
  /** Preserve the primary remainder even when a witness temporarily needs a finer scale. */
  const primaryRemainder: ExactQuantityDigits = { minor: BigInt(reportedPrimary.amountMinor), decimals: reportedPrimary.decimals };
  /** Keep exact running remainders only for axes named by the report or its package. */
  const reported = new Map<string, ExactQuantityDigits>();
  for (const axis of report.independent) {
    reported.set(axis.axisId, {
      minor: BigInt(axis.quantity.amountMinor), decimals: axis.quantity.decimals,
    });
  }
  for (const line of lines) {
    const witness = resolveInventoryAmount(catalog, item, line.amount).measurements;
    const witnessedPrimary = witness.primary.quantity;
    addExactQuantityDigits(primaryRemainder, -BigInt(witnessedPrimary.amountMinor), witnessedPrimary.decimals);
    for (const axis of witness.independent) {
      const remaining = reported.get(axis.axisId);
      if (remaining === undefined) continue;
      const measured = axis.quantity;
      addExactQuantityDigits(remaining, -BigInt(measured.amountMinor), measured.decimals);
      if (remaining.minor < 0n) return undefined;
    }
  }
  // Keep zero values for required axes and reject weight without positive primary stock.
  const independent: InventoryMeasurementVector["independent"][number][] = [];
  for (const axis of report.independent) {
    const remaining = reported.get(axis.axisId);
    if (remaining === undefined) throw new Error("Measured inventory report lost a reported axis.");
    const { minor, decimals } = remaining;
    if (primaryRemainder.minor === 0n && minor !== 0n) return undefined;
    const amount = inventoryAllocationQuantityIfStorable(minor, decimals, axis.quantity.unit);
    if (amount === undefined) return undefined;
    independent.push({ axisId: axis.axisId, quantity: amount });
  }
  const primary = inventoryAllocationQuantityIfStorable(
    primaryRemainder.minor, primaryRemainder.decimals, reportedPrimary.unit
  );
  if (primary === undefined) return undefined;
  return { primary: { axisId: report.primary.axisId, quantity: primary }, independent };
}

/** Item revision and selector after freezing all ambiguous human/package choices. */
export interface ResolvedAllocationSelection {
  /** Exact item revision used by every candidate. */
  readonly item: InventoryItemDefinitionRevision;
  /** Normalized selector narrowed to that revision and optional exact package. */
  readonly selector: InventoryStockSelector;
}

/** Candidate collection plus lookup/evidence needed to materialize public movement lines. */
interface PolicyAllocationCandidates {
  /** Exact physical candidates accepted by the generic allocation algorithm. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** Exact current signed rows, including ancestry and layer evidence. */
  readonly rowsById: ReadonlyMap<string, InventoryPolicyWorkingRow>;
  /** True when at least one active same-revision claim is still broad/unallocated. */
  readonly unallocatedReservationsPresent: boolean;
  /** A selected positive row has an exact hold whose primary share cannot be inferred. */
  readonly selectedIndependentHold: boolean;
}

/** Positive policy candidates after durable deficit has first claim on each direct-placement pool. */
interface DeficitAdjustedPolicyAllocationCandidates {
  /** Remaining positive physical candidates in deterministic policy order. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** Adjusted candidate lookup keyed by exact position identity. */
  readonly byPositionIdentity: ReadonlyMap<
    string,
    InventoryWorkingAllocationCandidate
  >;
  /** Existing deficit magnitude in all selected direct-placement pools. */
  readonly recordedDeficit: InventoryWorkingQuantity;
  /** Existing deficit still unbacked after every eligible pool candidate. */
  readonly uncoveredDeficit: InventoryWorkingQuantity;
  /** True when at least one caller-selected row was removed for expiry policy. */
  readonly expiredStockWasExcluded: boolean;
}

/** Inputs for reducing positive policy candidates by signed recorded deficit. */
interface ApplyPolicyAllocationDeficitBurdenInput {
  /** All signed rows already admitted to the affected placement pools. */
  readonly rowsById: ReadonlyMap<string, InventoryPolicyWorkingRow>;
  /** Direct stock constraints applied after the signed pool pays its deficit once. */
  readonly selector: InventoryStockSelector;
  /** Exact item revision/primary axis. */
  readonly item: InventoryItemDefinitionRevision;
  /** FIFO/FEFO order used to burden positive rows deterministically. */
  readonly method: InventoryAllocationMethod;
  /** Physical authority time used for expiry policy. */
  readonly atEpochMs: number;
  /** Whether expired rows may back deficit and remain allocatable. */
  readonly allowExpiredLots: boolean;
  /** Positive claim-adjusted candidates across the whole direct-placement pool. */
  readonly poolCandidates: readonly InventoryWorkingAllocationCandidate[];
}

/**
 * Pay each direct placement's signed deficit once across its whole eligible revision pool, then apply the
 * caller's lot/package/ownership selector. This blocks exact-lot bypass without charging the same
 * deficit again every time a different exact row is selected.
 */
function applyPolicyAllocationDeficitBurden({
  rowsById,
  selector,
  item,
  method,
  atEpochMs,
  allowExpiredLots,
  poolCandidates,
}: ApplyPolicyAllocationDeficitBurdenInput): DeficitAdjustedPolicyAllocationCandidates {
  // A selector can narrow by lot or owner only after the entire pool bears its deficit.
  const selectedIds = new Set<string>();
  const deficits: InventorySignedDeficitRow[] = [];
  for (const [positionId, row] of rowsById) {
    const signed = inventoryPolicyPositionMeasurement(row.position, item.primaryAxis.axisId, item.primaryAxis.unit);
    if (signed.amountMinor < 0n) deficits.push({ position: row.position.key, signed });
    if (inventoryStockPositionMatchesNormalizedSelector(row.position.key, selector)) {
      selectedIds.add(positionId);
    }
  }
  // Remember whether policy filtering hid otherwise selector-matching expired stock.
  let expiredStockWasExcluded = false;
  // Candidate buffer retained in policy order before direct-placement deficit burden is applied.
  const ordered: InventoryWorkingAllocationCandidate[] = [];
  for (const candidate of poolCandidates) {
    const expired =
      candidate.expiresAtEpochMs !== undefined && candidate.expiresAtEpochMs <= atEpochMs;
    if (expired && !allowExpiredLots) {
      if (selectedIds.has(inventoryStockPositionIdentity(candidate.position))) {
        expiredStockWasExcluded = true;
      }
      continue;
    }
    ordered.push(candidate);
  }
  ordered.sort(
    /** Use the same exact ordering as the eventual allocator. */
    (left, right) => compareWorkingAllocationCandidates(left, right, method)
  );
  const burden = applyInventoryWorkingDeficitBurden({
    deficits,
    itemRevisionId: item.revisionId,
    unit: item.primaryAxis.unit,
    placementNodeIds: [],
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
  // Candidate buffer after selector matching and one-time direct-placement deficit burden.
  const adjusted: InventoryWorkingAllocationCandidate[] = [];
  // Exact lookup used to reconcile allocator output back to the adjusted candidate metadata.
  const byPositionIdentity = new Map<string, InventoryWorkingAllocationCandidate>();
  for (const candidate of ordered) {
    const identity = inventoryStockPositionIdentity(candidate.position);
    if (!selectedIds.has(identity)) continue;
    const available = burden.capacityByPositionIdentity.get(identity);
    if (available === undefined) {
      throw new Error(
        `Inventory deficit adjustment lost policy candidate '${identity}'.`
      );
    }
    if (available.amountMinor <= 0n) {
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

/** Inputs for constructing one exact policy-allocation candidate snapshot. */
interface CreatePolicyAllocationCandidatesInput {
  /** Frozen catalogue. */
  readonly catalog: InventoryCatalog;
  /** Complete signed position pool and relevant claim states. */
  readonly pool: InventoryPolicyWorkingPool;
  /** Exact item revision and reservation axis policy. */
  readonly item: InventoryItemDefinitionRevision;
  /** Direct stock constraints for the requested candidates within the signed pool. */
  readonly stockSelector: InventoryStockSelector;
  /** Claim-book authority time used to reconstruct active reservations. */
  readonly reservationAtEpochMs: number;
  /** Physical authority time used to exclude expired stock. */
  readonly stockAtEpochMs: number;
  /** Whether the policy includes expired stock in its candidates. */
  readonly allowExpiredLots: boolean;
  /** Optional claim whose own binding stays available to its allocator/consumer. */
  readonly reservationId?: string;
  /** Whether exact allocations should remain physically selectable. */
  readonly allowAllocatedStock: boolean;
}

/** Resolve one request to exactly one immutable item revision and optional package revision. */
export function resolveAllocationItemAndSelector(
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
  pool,
  item,
  stockSelector,
  reservationAtEpochMs,
  stockAtEpochMs,
  allowExpiredLots,
  reservationId,
  allowAllocatedStock,
}: CreatePolicyAllocationCandidatesInput): PolicyAllocationCandidates {
  const rowsById = new Map<string, InventoryPolicyWorkingRow>();
  for (const row of pool.positions) {
    rowsById.set(inventoryStockPositionIdentity(row.position.key), row);
  }
  const candidates: InventoryWorkingAllocationCandidate[] = [];
  const reservationSummary = createExactPrimaryReservationSummary({
    reservations: pool.reservations,
    positions: rowsById,
    item,
    stockSelector,
    atEpochMs: reservationAtEpochMs,
    stockAtEpochMs,
    allowExpiredLots,
    ...(reservationId === undefined ? {} : { excludedReservationId: reservationId }),
    allowAllocatedStock,
  });

  for (const [positionIdentity, row] of rowsById) {
    const position = row.position;
    // Prepared, in-transit, detached and missing stock cannot supply an ordinary pick.
    if (position.key.transferId !== undefined || position.key.placementNodeId === undefined) continue;
    const onHand = inventoryPolicyPositionMeasurement(position, item.primaryAxis.axisId, item.primaryAxis.unit);
    if (onHand.amountMinor <= 0n || workingPositionHasNegativeIndependentAxis(position)) continue;
    const exactReserved = reservationSummary.reservedPrimaryByPositionIdentity.get(positionIdentity);
    const available = exactReserved === undefined ? onHand : subtractWorkingQuantity(onHand, exactReserved);
    if (available.amountMinor <= 0n) continue;
    const receivedAtEpochMs =
      row.layerStartedAtEpochMs;
    if (receivedAtEpochMs === undefined) {
      throw new Error(
        `Positive inventory position ${positionIdentity} has no projected positive-layer origin.`
      );
    }
    const expiresAtEpochMs = row.effectiveUseByEpochMs;
    const candidate: InventoryWorkingAllocationCandidate = {
      position: position.key,
      available,
      receivedAtEpochMs,
      ...(expiresAtEpochMs === undefined ? {} : { expiresAtEpochMs }),
      ...allocationIncrementForPosition(catalog, position, item, onHand),
    };
    candidates.push(candidate);
  }
  return {
    candidates,
    rowsById,
    unallocatedReservationsPresent:
      reservationSummary.unallocatedReservationsPresent,
    selectedIndependentHold: reservationSummary.selectedIndependentHold,
  };
}

/** Exclude unpublished batch rows whose independent axes went negative while primary stayed positive. */
function workingPositionHasNegativeIndependentAxis(
  position: InventoryPolicyWorkingRow["position"]
): boolean {
  if ("measurements" in position) return false;
  for (const total of position.totals.values()) {
    if (total.minor < 0n) return true;
  }
  return false;
}

/** Read one exact axis without storing the batch's entire private row. */
export function inventoryPolicyPositionMeasurement(
  position: InventoryPolicyWorkingRow["position"],
  axisId: string,
  unit: Quantity["unit"],
): InventoryWorkingQuantity {
  if ("measurements" in position) return inventoryMeasurementAt(position.measurements, axisId, unit);
  const total = position.totals.get(axisId);
  return total === undefined ? zeroQuantity(unit) : { amountMinor: total.minor, decimals: total.decimals, unit: total.unit };
}

/** Test whether a private or published row must be picked whole to retain its measured axes. */
function policyPositionHasUnfixedContents(
  position: InventoryPolicyWorkingRow["position"],
  item: InventoryItemDefinitionRevision,
  packaging?: ReturnType<InventoryCatalog["packagingRevision"]>,
): boolean {
  return itemHasUnfixedIndependentMeasuredContents(item, packaging,
    /** Optional measured axes matter only when the position actually contains them. */
    (axis) => BigInt(inventoryPolicyPositionMeasurement(position, axis.axisId, axis.unit).amountMinor) !== 0n,
  );
}

/** Exact reservation pressure precomputed once for one revision-frozen policy plan. */
interface ExactPrimaryReservationSummary {
  /** Active exact claim quantity keyed by exact stock-position identity. */
  readonly reservedPrimaryByPositionIdentity: ReadonlyMap<string, InventoryWorkingQuantity>;
  /** True when an active same-revision claim remains broad rather than position-bound. */
  readonly unallocatedReservationsPresent: boolean;
  /** A selected eligible row is wholly withheld because its reservation uses an independent axis. */
  readonly selectedIndependentHold: boolean;
}

/** Inputs for one linear pass over reservation evidence before candidate iteration. */
interface CreateExactPrimaryReservationSummaryInput {
  /** Reservation rows reconstructed at the claim-book authority time. */
  readonly reservations: readonly InventoryReservation[];
  /** Exact signed rows of this selected pool, keyed by position. */
  readonly positions: ReadonlyMap<string, InventoryPolicyWorkingRow>;
  /** Exact item revision whose primary candidates are being planned. */
  readonly item: InventoryItemDefinitionRevision;
  /** Direct stock constraints that determine whether an independent-axis hold can block the pick. */
  readonly stockSelector: InventoryStockSelector;
  /** Claim-book authority time used to decide whether each row still protects stock. */
  readonly atEpochMs: number;
  /** Physical authority time used to exclude expired stock. */
  readonly stockAtEpochMs: number;
  /** Whether this pick includes expired stock. */
  readonly allowExpiredLots: boolean;
  /** Optional reservation whose own binding stays available to its allocator/consumer. */
  readonly excludedReservationId?: string;
  /** Whether exact bindings are deliberately ignored as physical-truth candidates. */
  readonly allowAllocatedStock: boolean;
}

/** Require explicit lines when a selected independent hold may be needed to fill a preview. */
export function assertInventoryPolicyCanPickAroundIndependentHold(selectedIndependentHold: boolean, shortfall: Quantity): void {
  if (selectedIndependentHold && shortfall.amountMinor > 0) {
    throw new Error(
      "Automatic primary-quantity picking cannot subtract an exact reservation on an independent axis; use explicit fulfillment lines."
    );
  }
}

/** Sum every active exact binding once so candidate planning stays O(reservations + allocations + candidates). */
function createExactPrimaryReservationSummary({
  reservations,
  positions,
  item,
  stockSelector,
  atEpochMs,
  stockAtEpochMs,
  allowExpiredLots,
  excludedReservationId,
  allowAllocatedStock,
}: CreateExactPrimaryReservationSummaryInput): ExactPrimaryReservationSummary {
  // Exact primary-axis pressure accumulated once per bound stock position.
  const reservedPrimaryByPositionIdentity = new Map<string, InventoryWorkingQuantity>();
  // Remember whether any active broad claim still needs global feasibility protection.
  let unallocatedReservationsPresent = false;
  /** Defer the explicit-lines error until unheld stock fails to fill a preview. */
  let selectedIndependentHold = false;
  for (const reservation of reservations) {
    if (reservation.reservationId === excludedReservationId) continue;
    if (!inventoryReservationIsActiveAt(reservation, atEpochMs)) continue;
    if (reservation.itemRevisionId !== item.revisionId) continue;
    const allocations = reservation.allocations;
    if (allocations.length === 0) {
      unallocatedReservationsPresent = true;
      continue;
    }
    if (allowAllocatedStock) continue;
    for (const allocation of allocations) {
      const positionIdentity = inventoryStockPositionIdentity(allocation.position);
      const row = positions.get(positionIdentity);
      if (row === undefined) continue;
      if (item.reservationAxisId !== item.primaryAxis.axisId) {
        // The picker will remove expired capacity before applying deficit burden.
        if (!allowExpiredLots && row.effectiveUseByEpochMs !== undefined &&
            row.effectiveUseByEpochMs <= stockAtEpochMs) continue;
        const onHand = inventoryPolicyPositionMeasurement(row.position, item.primaryAxis.axisId, item.primaryAxis.unit);
        // A stranded hold remains a claim, but its depleted row cannot supply a pick.
        if (onHand.amountMinor <= 0n) continue;
        // A binding on a different axis gives no exact primary quantity. Withhold the entire row.
        reservedPrimaryByPositionIdentity.set(positionIdentity, onHand);
        selectedIndependentHold ||= inventoryStockPositionMatchesNormalizedSelector(row.position.key, stockSelector);
        continue;
      }
      const existing = reservedPrimaryByPositionIdentity.get(positionIdentity);
      if (existing === undefined) {
        reservedPrimaryByPositionIdentity.set(positionIdentity, allocation.quantity);
        continue;
      }
      const reserved = { minor: BigInt(existing.amountMinor), decimals: existing.decimals };
      addExactQuantityDigits(reserved, BigInt(allocation.quantity.amountMinor), allocation.quantity.decimals);
      reservedPrimaryByPositionIdentity.set(
        positionIdentity,
        { amountMinor: reserved.minor, decimals: reserved.decimals, unit: existing.unit }
      );
    }
  }
  return {
    reservedPrimaryByPositionIdentity,
    unallocatedReservationsPresent,
    selectedIndependentHold,
  };
}

/** Mark serial, measured, and intact-package rows with the smallest legal automatic issue increment. */
function allocationIncrementForPosition(
  catalog: InventoryCatalog,
  position: InventoryPolicyWorkingRow["position"],
  item: InventoryItemDefinitionRevision,
  capacity: InventoryWorkingQuantity,
): Pick<InventoryWorkingAllocationCandidate, "allocationIncrement" | "keepIncrementForAcceptance"> {
  const packagingRevisionId = position.key.packagingRevisionId;
  const packaging = packagingRevisionId === undefined ? undefined : catalog.packagingRevision(packagingRevisionId);
  if (position.key.serialId !== undefined) {
    // Package counts and unfixed independent contents both require an intact measured serial.
    return packaging !== undefined || policyPositionHasUnfixedContents(position, item)
      ? { allocationIncrement: capacity, keepIncrementForAcceptance: true }
      : { allocationIncrement: capacity };
  }
  if (packaging === undefined) {
    // A measured line cannot assign a fraction of this row's independent quantities.
    return policyPositionHasUnfixedContents(position, item)
      ? { allocationIncrement: capacity, keepIncrementForAcceptance: true }
      : {};
  }
  if (policyPositionHasUnfixedContents(position, item, packaging)) {
    // Package increments alone do not determine its unfixed measured quantities.
    return { allocationIncrement: capacity, keepIncrementForAcceptance: true };
  }
  return {
    /** The amount materializer needs whole package counts even during measured diagnostics. */
    keepIncrementForAcceptance: true,
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
  catalog, itemRevisionId, position, allocatedPrimary,
}: InventoryAmountForPrimaryAllocationInput): InventoryAmount {
  const amount = inventoryAmountForWorkingPrimaryAllocation({ catalog, itemRevisionId, position, allocatedPrimary });
  if (amount === undefined) throw new Error("Selected inventory measurement exceeds the safe integer storage range.");
  return amount;
}

/** Exact line construction over either a published or ordered-batch working row. */
interface InventoryAmountForWorkingPrimaryAllocationInput extends Omit<InventoryAmountForPrimaryAllocationInput, "position"> {
  /** Current exact source and all its measured axes. */
  readonly position: InventoryPolicyWorkingRow["position"];
}

/** Read the selected independent axis when it is about to become durable movement evidence. */
function measuredAllocationAxis(
  position: InventoryPolicyWorkingRow["position"],
  axisId: string,
  unit: Quantity["unit"],
): Quantity | undefined {
  if ("measurements" in position) return inventoryMeasurementAt(position.measurements, axisId, unit);
  const working = inventoryPolicyPositionMeasurement(position, axisId, unit);
  return inventoryAllocationQuantityIfStorable(BigInt(working.amountMinor), working.decimals, unit);
}

/** Build unfixed movement axes from a stored or private working source. */
function inventoryAllocationIndependentAmounts(
  position: InventoryPolicyWorkingRow["position"],
  item: InventoryItemDefinitionRevision,
  takesWholePosition: boolean,
  fixedAxes?: ReadonlySet<string>,
): InventoryIndependentAmountInput[] | undefined {
  const independent: InventoryIndependentAmountInput[] = [];
  for (const axis of item.independentAxes) {
    if (fixedAxes?.has(axis.axisId)) continue;
    const measured = measuredAllocationAxis(position, axis.axisId, axis.unit);
    if (measured === undefined) return undefined;
    if (axis.requirement !== InventoryMeasurementRequirement.Required && measured.amountMinor === 0) {
      // Taking a whole row preserves an observed zero without inventing a missing axis.
      if (!takesWholePosition) continue;
      const stored = "measurements" in position
        ? position.measurements.independent.some(
            /** Match the optional axis by its stored identity. */
            (entry) => entry.axisId === axis.axisId
          )
        : position.totals.has(axis.axisId);
      if (!stored) continue;
    }
    independent.push({ axisId: axis.axisId, value: quantityToDecimalString(measured), unit: measured.unit });
  }
  return independent;
}

/** Construct the same exact public line even if an unused part of the pool exceeds storage scale. */
function inventoryAmountForWorkingPrimaryAllocation({
  catalog,
  itemRevisionId,
  position,
  allocatedPrimary,
}: InventoryAmountForWorkingPrimaryAllocationInput): InventoryAmount | undefined {
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
  const fullPrimary = inventoryPolicyPositionMeasurement(position, item.primaryAxis.axisId, item.primaryAxis.unit);
  const comparedWithFullPosition = compareWorkingQuantities(allocatedPrimary, fullPrimary);
  if (comparedWithFullPosition > 0) {
    throw new Error(
      "Primary allocation exceeds current stock at its exact position."
    );
  }
  const takesWholePosition = comparedWithFullPosition === 0;
  const packagingRevisionId = position.key.packagingRevisionId;
  if (packagingRevisionId !== undefined) {
    const packaging = catalog.packagingRevision(packagingRevisionId);
    if (
      !takesWholePosition &&
      policyPositionHasUnfixedContents(position, item, packaging)
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
    // An exact package multiple can be a valid search trial without fitting a durable measurement.
    if (packageCount > 1) {
      const count = BigInt(packageCount);
      for (const { quantity } of packaging.fixedContents.independent) {
        if (storableQuantityScale(BigInt(quantity.amountMinor) * count, quantity.decimals) === undefined) {
          return undefined;
        }
      }
    }
    // Retain package-fixed axis IDs so only unfixed independent axes repeat their amount.
    const fixedAxes = new Set<string>();
    for (const measured of packaging.fixedContents.independent) {
      fixedAxes.add(measured.axisId);
    }
    const independent = inventoryAllocationIndependentAmounts(position, item, takesWholePosition, fixedAxes);
    return independent === undefined ? undefined : packageAmount(packageCount, packagingRevisionId, independent);
  }

  if (item.independentAxes.length === 0) {
    return stockAmount(
      quantityToDecimalString(allocatedPrimary),
      allocatedPrimary.unit
    );
  }
  if (!takesWholePosition) {
    if (policyPositionHasUnfixedContents(position, item)) {
      throw new Error(
        "Automatic picking cannot proportionally split independently measured stock; select exact measured lines."
      );
    }
    return stockAmount(
      quantityToDecimalString(allocatedPrimary),
      allocatedPrimary.unit
    );
  }
  const independent = inventoryAllocationIndependentAmounts(position, item, takesWholePosition);
  if (independent === undefined) return undefined;
  return measuredStockAmount(
    quantityToDecimalString(allocatedPrimary),
    allocatedPrimary.unit,
    independent
  );
}
