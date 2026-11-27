import { compareInventoryIdentityText } from "./ordering.js";
import { assertInventoryEpochMilliseconds } from "./events.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import {
  compareQuantity,
  integerAtDecimals,
  positiveQuantity,
  quantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  addExactQuantityDigits,
  MAXIMUM_STORED_QUANTITY_MINOR,
  storableQuantityDigits,
  storableQuantityScale,
  workingQuantityAtDecimals,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";

/** Supported deterministic automatic stock-picking orders. */
export enum InventoryAllocationMethod {
  /** Oldest-received eligible stock first. */
  Fifo = "fifo",
  /** Earliest-expiring eligible stock first, then receipt time. */
  Fefo = "fefo",
}

/** One exact position available to a deterministic allocation policy. */
export interface InventoryAllocationCandidate {
  /** Exact stock position that would be reserved/issued. */
  readonly position: InventoryStockPositionKey;
  /** Exact currently allocatable quantity on one configured axis. */
  readonly available: Quantity;
  /** Event time this candidate entered its current allocatable layer. */
  readonly receivedAtEpochMs: number;
  /** Expiry/use-by time when this stock can become unusable. */
  readonly expiresAtEpochMs?: number;
  /** Optional lower number chosen before normal FIFO/FEFO ordering. */
  readonly priority?: number;
  /** Optional indivisible allocation quantum, such as one intact package or serial piece. */
  readonly allocationIncrement?: Quantity;
}

/** Inputs for deterministic exact FIFO/FEFO allocation. */
export interface AllocateInventoryInput {
  /** Total requested quantity on the candidate allocation axis. */
  readonly requested: Quantity;
  /** Eligible candidate positions with current free capacity. */
  readonly candidates: readonly InventoryAllocationCandidate[];
  /** FIFO or FEFO ordering. */
  readonly method: InventoryAllocationMethod;
  /** Current canonical time used to exclude expired candidates. */
  readonly nowEpochMs: number;
  /** Explicit override allowing expired stock to be allocated. */
  readonly allowExpired?: boolean;
  /** Optional whole-plan predicate used to reject allocations that violate external claims. */
  readonly acceptAllocations?: (
    allocations: readonly InventoryAllocation[]
  ) => boolean;
}

/** Candidate over stored or unpublished stock balances. The selected line still needs a stored quantity. */
export interface InventoryWorkingAllocationCandidate
  extends Omit<InventoryAllocationCandidate, "available" | "allocationIncrement"> {
  /** Exact free capacity before selecting a storable line. */
  readonly available: InventoryWorkingQuantity;
  /** Exact indivisible increment, including a whole unpublished row. */
  readonly allocationIncrement?: InventoryWorkingQuantity;
  /** Retain the increment when a diagnostic trial must satisfy a predicate that requires it. */
  readonly keepIncrementForAcceptance?: true;
}

/** Shared allocation input whose candidate capacities need not fit the storage limit. */
export interface AllocateWorkingInventoryInput extends Omit<AllocateInventoryInput, "candidates"> {
  /** Eligible stock with exact private or published capacities. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** The reported movement needs a positive primary remainder for an unwitnessed axis. */
  readonly requiresPositiveShortfall?: boolean;
  /** Proven upper limit on primary stock that can fit the measured report. */
  readonly maximumWitnessPrimary?: InventoryWorkingQuantity;
  /** Primary capacity that must remain available for a complete measured witness. */
  readonly fullWitnessPrimaryBudget?: InventoryFullWitnessPrimaryBudget;
  /** Optional proof of which wholly selected measured rows can fit together. */
  readonly wholeMeasuredSubsets?: InventoryWholeMeasuredSubsets;
}

/** A bounded measurement proof used to prune the existing ordered search. */
export interface InventoryWholeMeasuredSubsets {
  /** One distinct bit for each participating whole row. */
  readonly bitsByPosition: ReadonlyMap<InventoryStockPositionKey, number>;
  /** Subsets whose measured totals stay within the report. */
  readonly fitting: ReadonlySet<number>;
}

/** Limit on stock without a reported measurement in a fully witnessed assignment. */
export interface InventoryFullWitnessPrimaryBudget {
  /** Candidate keys that contribute to at least one positively reported independent axis. */
  readonly measuredPositions: ReadonlySet<InventoryStockPositionKey>;
  /** Most primary stock the full witness can pick without contributing to those axes. */
  readonly axisFreeLimit: InventoryWorkingQuantity;
  /** Whole rows proved unable to participate in a complete measured witness at legal increments. */
  readonly completeExclusions?: ReadonlySet<InventoryStockPositionKey>;
}

/** Inputs for selecting a partial witness with an optional primary-increment diagnosis. */
interface AllocateInventoryUpToInput extends AllocateWorkingInventoryInput {
  /** Skip relaxed trials when measured evidence cannot be inferred for a split. */
  readonly assessIncrementBlockage?: boolean;
}

/** One exact position/quantity chosen by automatic allocation. */
export interface InventoryAllocation {
  /** Exact chosen stock position. */
  readonly position: InventoryStockPositionKey;
  /** Exact quantity allocated from that position. */
  readonly quantity: Quantity;
}

/** Exact result of one deterministic allocation attempt. */
export interface InventoryAllocationResult {
  /** Chosen position quantities in deterministic policy order. */
  readonly allocations: readonly InventoryAllocation[];
  /** Quantity the candidates could not satisfy. */
  readonly shortfall: Quantity;
  /** True when expired stock existed but normal expiry safety excluded it. */
  readonly expiredStockWasExcluded: boolean;
  /** True when candidate stock existed but indivisible increments prevented using it. */
  readonly incrementBlockedStock: boolean;
  /** True when the whole-plan rule rejected every allowed assignment despite an exact physical assignment. */
  readonly allocationConstraintBlockedStock: boolean;
}

/** Maximum exact-allocation search choices before callers must narrow the candidate set. */
export const MAXIMUM_EXACT_ALLOCATION_STATES = 100_000;

/** The exact allocator reached its depth or state budget before it could decide the pick. */
export class InventoryExactAllocationLimitError extends Error {}

/** Maximum nested positive choices in an exact search before callers must narrow the candidate set. */
const MAXIMUM_EXACT_ALLOCATION_DEPTH = 5_000;

/** Enumerate subsets of up to three whole-only rows at the end of the candidate list. */
const MAXIMUM_EXACT_WHOLE_SUFFIX_SUMS = 8;

/** Pick FIFO/FEFO stock, requiring a full assignment when a whole-plan predicate is supplied. */
export function allocateInventory(input: AllocateInventoryInput): InventoryAllocationResult {
  return allocateWorkingInventory(input);
}

/** Find the largest accepted witness, keeping the first FIFO/FEFO choice on ties. */
export function allocateInventoryUpTo(input: AllocateInventoryUpToInput): InventoryAllocationResult {
  return allocateInventoryCandidates(input, true);
}

/** Pick from exact working capacities while storing only completed allocation lines. */
export function allocateWorkingInventory(input: AllocateWorkingInventoryInput): InventoryAllocationResult {
  return allocateInventoryCandidates(input, false);
}

/** Share the ordered, bounded search without changing the public full-plan constraint. */
function allocateInventoryCandidates({
  requested,
  candidates,
  method,
  nowEpochMs,
  allowExpired = false,
  acceptAllocations,
  assessIncrementBlockage = true,
  requiresPositiveShortfall = false,
  maximumWitnessPrimary,
  fullWitnessPrimaryBudget,
  wholeMeasuredSubsets,
}: AllocateInventoryUpToInput, acceptPartial: boolean): InventoryAllocationResult {
  positiveQuantity(requested, "Requested allocation");
  assertInventoryEpochMilliseconds(nowEpochMs, "allocation now");
  let expiredStockWasExcluded = false;
  const eligible: InventoryWorkingAllocationCandidate[] = [];
  for (const candidate of candidates) {
    validateAllocationCandidate(candidate, requested);
    const expired =
      candidate.expiresAtEpochMs !== undefined && candidate.expiresAtEpochMs <= nowEpochMs;
    if (expired && !allowExpired) {
      expiredStockWasExcluded = true;
      continue;
    }
    eligible.push(candidate);
  }
  /** Keep the caller's chosen FIFO/FEFO method inside this one sort. */
  const compareEligibleCandidates = (
    left: InventoryWorkingAllocationCandidate,
    right: InventoryWorkingAllocationCandidate
  ): number => compareWorkingAllocationCandidates(left, right, method);
  eligible.sort(compareEligibleCandidates);

  /** Share the accepted assignments and the exact candidate domain with the shortage diagnostic. */
  const searchInput = {
    requested,
    candidates: eligible,
    ...(acceptAllocations === undefined ? {} : { acceptAllocations }),
    ...(wholeMeasuredSubsets === undefined ? {} : { wholeMeasuredSubsets }),
  };
  /** A relaxed exact trial still needs enough primary stock to carry every reported axis. */
  const witnessBudget = fullWitnessPrimaryBudget === undefined ? {} : { fullWitnessPrimaryBudget };
  // Greedy rounding can strand a remainder even when later package sizes fill the whole request.
  const assignment = searchInventoryAllocations({
    ...searchInput, acceptPartial, requiresPositiveShortfall,
    ...(maximumWitnessPrimary === undefined ? {} : { maximumWitnessPrimary }),
    ...witnessBudget,
  });
  if (assignment !== undefined) {
    return {
      allocations: assignment.allocations,
      shortfall: assignment.shortfall,
      expiredStockWasExcluded,
      incrementBlockedStock: assessIncrementBlockage && (assignment.shortfall.amountMinor > 0
        ? partialAllocationHasBlockedIncrement(searchInput, assignment.shortfall)
        : exactAllocationHasBlockedIncrement({ ...searchInput, ...witnessBudget }, assignment.allocations)),
      allocationConstraintBlockedStock: false,
    };
  }

  if (acceptAllocations !== undefined) {
    const unconstrainedExact = searchInventoryAllocations({
      requested,
      candidates: eligible,
      acceptPartial: false,
    });
    // An increment is causal only when relaxing it admits the same whole-plan rule.
    const incrementBlockedStock = assessIncrementBlockage &&
      eligible.some(
        /** A divisible pool cannot have an increment-caused failure. */
        (candidate) => canRelaxAllocationIncrement(candidate, acceptAllocations)
      ) &&
      searchInventoryAllocations({
        ...searchInput, ...witnessBudget, acceptPartial: false, ignoreIncrements: true,
      }) !== undefined;
    return {
      allocations: [],
      shortfall: requested,
      expiredStockWasExcluded,
      incrementBlockedStock,
      allocationConstraintBlockedStock: unconstrainedExact !== undefined,
    };
  }

  /** Intermediate remainders need extra digits even when all returned amounts fit. */
  const remaining: ExactQuantityDigits = {
    minor: BigInt(requested.amountMinor),
    decimals: requested.decimals,
  };
  let incrementBlockedStock = false;
  const allocations: InventoryAllocation[] = [];
  /** A greedy prefix may take an amount that is too precise to store. */
  let greedyPicksFit = true;
  for (const candidate of eligible) {
    if (remaining.minor === 0n) break;
    const choice = takeGreedyInventoryAllocation(remaining, candidate);
    if (choice.incrementBlocked) incrementBlockedStock = true;
    if (choice.minor === 0n) continue;
    const quantity = inventoryAllocationQuantityIfStorable(choice.minor, choice.decimals, requested.unit);
    if (quantity === undefined) {
      greedyPicksFit = false;
      break;
    }
    allocations.push({ position: candidate.position, quantity });
  }
  const shortfall = greedyPicksFit
    ? inventoryAllocationQuantityIfStorable(remaining.minor, remaining.decimals, requested.unit)
    : undefined;
  if (shortfall === undefined) {
    // Preserve the ordinary greedy result when it fits. The bounded search handles other exact splits.
    const storable = searchInventoryAllocations({ requested, candidates: eligible, acceptPartial: true });
    if (storable === undefined) throw new Error("Allocation has no storable result.");
    return {
      allocations: storable.allocations,
      shortfall: storable.shortfall,
      expiredStockWasExcluded,
      incrementBlockedStock: assessIncrementBlockage && partialAllocationHasBlockedIncrement(searchInput, storable.shortfall),
      allocationConstraintBlockedStock: false,
    };
  }
  return {
    allocations,
    shortfall,
    expiredStockWasExcluded,
    incrementBlockedStock,
    allocationConstraintBlockedStock: false,
  };
}

/** Confirm that relaxing increments admits an earlier accepted full plan. */
function exactAllocationHasBlockedIncrement(
  input: Pick<SearchInventoryAllocationsInput, "requested" | "candidates" | "acceptAllocations" | "fullWitnessPrimaryBudget">,
  allocations: readonly InventoryAllocation[]
): boolean {
  if (!input.candidates.some(
    /** Check whether relaxing a row can change a plan the predicate accepts. */
    (candidate) => canRelaxAllocationIncrement(candidate, input.acceptAllocations)
  ) ||
      !exactAllocationsHaveIncrementTrial(input.requested, input.candidates, allocations)) return false;
  const relaxed = searchInventoryAllocations({ ...input, acceptPartial: false, ignoreIncrements: true });
  if (relaxed === undefined) return false;
  /** Search results preserve each original candidate key, including its place in the policy order. */
  const originalPicks = new Map(allocations.map(
    /** Index each selected amount in the original plan. */
    ({ position, quantity }) => [position, quantity]
  ));
  const relaxedPicks = new Map(relaxed.allocations.map(
    /** Index each selected amount after relaxing increments. */
    ({ position, quantity }) => [position, quantity]
  ));
  for (const { position } of input.candidates) {
    const original = originalPicks.get(position);
    const alternative = relaxedPicks.get(position);
    if (original === undefined && alternative === undefined) continue;
    if (original === undefined) return true;
    if (alternative === undefined) return false;
    const comparison = compareQuantity(alternative, original);
    if (comparison !== 0) return comparison > 0;
  }
  return false;
}

/** Report increment blockage only if relaxing increments improves an accepted, storable assignment. */
function partialAllocationHasBlockedIncrement(
  input: Pick<SearchInventoryAllocationsInput, "requested" | "candidates" | "acceptAllocations">,
  shortfall: Quantity
): boolean {
  return shortfall.amountMinor > 0 && input.candidates.some(
    /** Check whether the predicate allows any increment to change. */
    (candidate) => canRelaxAllocationIncrement(candidate, input.acceptAllocations)
  ) && searchInventoryAllocations({
    ...input,
    acceptPartial: true,
    ignoreIncrements: true,
    improveOnShortfall: shortfall,
  }) !== undefined;
}

/** Tell whether a diagnostic can relax an increment under the current acceptance rule. */
function canRelaxAllocationIncrement(
  candidate: InventoryWorkingAllocationCandidate,
  predicate: AllocateInventoryInput["acceptAllocations"],
): boolean {
  return candidate.allocationIncrement !== undefined &&
    (predicate === undefined || !candidate.keepIncrementForAcceptance);
}

/** An accepted exact assignment and the primary amount left unwitnessed. */
interface InventoryAllocationAssignment {
  /** The chosen positions in policy order. */
  readonly allocations: readonly InventoryAllocation[];
  /** The exact primary quantity outside those choices. */
  readonly shortfall: Quantity;
}

/** Ordered candidate search and the policies that govern its result. */
interface SearchInventoryAllocationsInput {
  /** Total requested primary quantity. */
  readonly requested: Quantity;
  /** Eligible candidates in FIFO or FEFO order. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** Extra exact evidence a complete or partial assignment must satisfy. */
  readonly acceptAllocations?: AllocateInventoryInput["acceptAllocations"];
  /** Whether a coherent assignment can leave part of the request unwitnessed. */
  readonly acceptPartial: boolean;
  /** A measured predicate cannot accept zero shortfall. */
  readonly requiresPositiveShortfall?: boolean;
  /** Proven upper limit on primary stock that can fit the measured report. */
  readonly maximumWitnessPrimary?: InventoryWorkingQuantity;
  /** Primary capacity that must remain available for a complete measured witness. */
  readonly fullWitnessPrimaryBudget?: InventoryFullWitnessPrimaryBudget;
  /** Bounded proof that rejects whole-row combinations exceeding a reported measurement. */
  readonly wholeMeasuredSubsets?: InventoryWholeMeasuredSubsets;
  /** Test whether relaxing indivisible increments admits a storable split. */
  readonly ignoreIncrements?: boolean;
  /** Stop a diagnostic trial at the first accepted remainder strictly below this one. */
  readonly improveOnShortfall?: Quantity;
}

/** A whole-measured suffix subtotal on the allocator's shared primary scale. */
interface WholeMeasuredSuffixSum {
  /** Participating measured positions from the bounded proof. */
  readonly mask: number;
  /** Total primary stock supplied by those positions. */
  readonly primary: bigint;
}

/** A positive choice's remaining search state. */
interface InventoryAllocationSearchBranch {
  /** First candidate that can follow the chosen row. */
  readonly firstIndex: number;
  /** Exact unassigned primary digits. */
  readonly remainingMinor: bigint;
  /** Exact selected primary without a reported axis contribution. */
  readonly axisFreePicked: bigint;
  /** Whole measured rows already selected in the prefix. */
  readonly wholeRowsPicked: number;
}

/** Find the largest ordered assignment, keeping the original decimal grid if the search narrows its rows. */
function searchInventoryAllocations(
  input: SearchInventoryAllocationsInput,
  minimumDecimals = input.requested.decimals
): InventoryAllocationAssignment | undefined {
  const {
    requested, candidates: orderedCandidates, acceptAllocations: predicate, acceptPartial, requiresPositiveShortfall = false,
    maximumWitnessPrimary, fullWitnessPrimaryBudget, wholeMeasuredSubsets, ignoreIncrements = false, improveOnShortfall,
  } = input;
  /** Relaxed trials can present fractional packages that a normal predicate cannot represent. */
  const acceptAllocations = predicate === undefined || !ignoreIncrements ? predicate :
    /** Discard an invalid synthetic trial without invalidating the accepted physical plan. */
    (allocations: readonly InventoryAllocation[]): boolean => {
      try {
        return predicate(allocations);
      } catch {
        return false;
      }
    };
  let decimals = minimumDecimals;
  for (const candidate of orderedCandidates) {
    decimals = Math.max(decimals, candidate.available.decimals);
    if (candidate.allocationIncrement !== undefined) {
      decimals = Math.max(decimals, candidate.allocationIncrement.decimals);
    }
  }
  const requestedMinor = integerAtDecimals(requested, decimals);
  /** Working capacities and effective increments on the original shared scale. */
  const capacityMinor: bigint[] = [];
  const incrementMinor: bigint[] = [];
  /** Keep the original ordered array unless a row is forced to zero for this trial. */
  let selectableCandidates: InventoryWorkingAllocationCandidate[] | undefined;
  for (const candidate of orderedCandidates) {
    const capacity = workingQuantityAtDecimals(candidate.available, decimals);
    const increment = candidate.allocationIncrement === undefined ||
      (ignoreIncrements && canRelaxAllocationIncrement(candidate, predicate))
      ? 1n
      : workingQuantityAtDecimals(candidate.allocationIncrement, decimals);
    // A row whose first legal increment cannot fit has no branch other than zero in this search.
    if (capacity < increment || requestedMinor < increment) {
      selectableCandidates ??= orderedCandidates.slice(0, capacityMinor.length);
      continue;
    }
    selectableCandidates?.push(candidate);
    capacityMinor.push(capacity);
    incrementMinor.push(increment);
  }
  const candidates = selectableCandidates ?? orderedCandidates;
  /** Map the proof to policy order. Fractional diagnostic choices are outside this proof. */
  const wholeRowBits = wholeMeasuredSubsets === undefined || ignoreIncrements ? undefined : candidates.map(
    /** A row without a reported whole contribution has no effect on the subset. */
    ({ position }) => wholeMeasuredSubsets.bitsByPosition.get(position) ?? 0
  );
  /** Capacity and common divisibility of all selectable rows at or after each index. */
  const suffixCapacity: bigint[] = new Array(candidates.length + 1).fill(0n);
  const suffixDivisor: bigint[] = new Array(candidates.length + 1).fill(0n);
  /** Capacity sums for suffixes with a few whole rows alongside divisible capacity. */
  const suffixWholeSums: (readonly bigint[] | undefined)[] = [];
  /** Divisible capacity around each stored whole sum, before considering storage divisibility. */
  const suffixWholeDivisibleCapacity: bigint[] = [];
  /** Build the few whole sums until the suffix needs general capacity and divisor bounds. */
  let wholeSums: readonly bigint[] | undefined = [0n];
  /** Rows that can adjust the current whole total by any primary digit. */
  let wholeDivisibleCapacity = 0n;
  /** Fitting primary sums when a suffix contains only whole rows covered by the proof. */
  const measuredSuffixSums: (readonly WholeMeasuredSuffixSum[] | undefined)[] = [];
  /** Build fitting sums until a selectable non-measured row enters the suffix. */
  let measuredSums: readonly WholeMeasuredSuffixSum[] | undefined = wholeRowBits === undefined ? undefined : [{ mask: 0, primary: 0n }];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const capacity = capacityMinor[index] ?? 0n;
    const increment = incrementMinor[index] ?? 1n;
    // Stock below the next whole increment cannot improve a suffix assignment.
    const selectable = capacity - capacity % increment;
    if (wholeSums !== undefined && (wholeSums.length >= 4 || (wholeSums.length > 1 && wholeDivisibleCapacity > 0n))) {
      suffixWholeSums[index + 1] = wholeSums;
      suffixWholeDivisibleCapacity[index + 1] = wholeDivisibleCapacity;
    }
    if (wholeSums !== undefined && selectable !== 0n) {
      if (increment === 1n) {
        wholeDivisibleCapacity += selectable;
      } else {
        wholeSums = selectable === increment && wholeSums.length < MAXIMUM_EXACT_WHOLE_SUFFIX_SUMS
          ? [...wholeSums, ...wholeSums.map(
              /** Include each sum that takes this whole row. */
              (sum) => sum + selectable
            )]
          : undefined;
      }
    }
    if (measuredSums !== undefined) {
      measuredSuffixSums[index + 1] = measuredSums;
      if (selectable !== 0n) {
        const bit = wholeRowBits?.[index] ?? 0;
        if (bit === 0) {
          measuredSums = undefined;
        } else {
          const withRow: WholeMeasuredSuffixSum[] = [];
          for (const sum of measuredSums) {
            const mask = sum.mask | bit;
            if (wholeMeasuredSubsets?.fitting.has(mask)) withRow.push({ mask, primary: sum.primary + selectable });
          }
          measuredSums = [...measuredSums, ...withRow];
        }
      }
    }
    suffixCapacity[index] = (suffixCapacity[index + 1] ?? 0n) + selectable;
    const laterDivisor = suffixDivisor[index + 1] ?? 0n;
    suffixDivisor[index] = selectable === 0n ? laterDivisor :
      laterDivisor === 0n ? increment :
      increment === 1n || laterDivisor === 1n ? 1n :
      allocationModularCoefficients(increment, laterDivisor).divisor;
  }
  /** Proven lower bound on the primary remainder. */
  let minimumShortfallMinor = 0n;
  const divisor = suffixDivisor[0] ?? 0n;
  /** Every nonzero remainder is at least this large on the shared scale. */
  const minimumPositiveShortfallMinor = divisor === 0n ? requestedMinor : requestedMinor % divisor || divisor;
  if (requiresPositiveShortfall) {
    // Selected totals are multiples of the common divisor. Exclude zero for unwitnessed measurements.
    minimumShortfallMinor = minimumPositiveShortfallMinor;
  }
  if (maximumWitnessPrimary !== undefined) {
    // Every witness total is a multiple of the common increment on the search scale.
    const boundDecimals = Math.max(decimals, maximumWitnessPrimary.decimals);
    const bound = workingQuantityAtDecimals(maximumWitnessPrimary, boundDecimals) /
      10n ** BigInt(boundDecimals - decimals);
    const roundedBound = divisor === 0n ? 0n : bound - bound % divisor;
    const remainder = requestedMinor - roundedBound;
    if (remainder > minimumShortfallMinor) minimumShortfallMinor = remainder;
  }
  const totalCapacity = suffixCapacity[0] ?? 0n;
  if (!acceptPartial && (totalCapacity < requestedMinor || minimumShortfallMinor > 0n)) return undefined;
  if (totalCapacity <= requestedMinor) {
    // Taking every legal unit has the smallest possible remainder without a search.
    const remaining = requestedMinor - totalCapacity;
    if (improveOnShortfall !== undefined && remaining >= integerAtDecimals(improveOnShortfall, decimals)) {
      return undefined;
    }
    const shortfall = remaining === 0n
      ? zeroQuantity(requested.unit, requested.decimals)
      : inventoryAllocationQuantityIfStorable(remaining, decimals, requested.unit);
    if (shortfall !== undefined) {
      const wholePicks = capacityMinor.map(
        /** Round each available balance down to its own legal increment. */
        (capacity, index) => capacity - capacity % (incrementMinor[index] ?? 1n)
      );
      if (wholePicks.every(
        /** A private working row can have more digits than a published allocation. */
        (take) => storableQuantityScale(take, decimals) !== undefined
      )) {
        const allocations = materializeExactAllocations(candidates, wholePicks, decimals);
        if (acceptAllocations === undefined || acceptAllocations(allocations)) return { allocations, shortfall };
      }
    }
  }
  // A measured witness that reaches the proven remainder floor is optimal.
  const greedyShortfallMinor = acceptPartial && acceptAllocations !== undefined ? minimumShortfallMinor : 0n;
  const greedyTargetMinor = requestedMinor - greedyShortfallMinor;
  /** Shared-scale limit on axis-free primary stock when filling every reported axis. */
  const axisFreeLimit = fullWitnessPrimaryBudget?.axisFreeLimit;
  const axisFreeLimitMinor = axisFreeLimit === undefined ? undefined :
    workingQuantityAtDecimals(axisFreeLimit, Math.max(decimals, axisFreeLimit.decimals)) /
      10n ** BigInt(Math.max(0, axisFreeLimit.decimals - decimals));
  /** Exclusions apply to legal complete picks. A relaxed diagnostic can change the increments. */
  const completeExclusions = ignoreIncrements ? undefined : fullWitnessPrimaryBudget?.completeExclusions;
  if (greedyTargetMinor > 0n && totalCapacity > greedyTargetMinor) {
    /** The first policy-ordered plan fills the target without backtracking. */
    const picks: bigint[] = [];
    let remaining = greedyTargetMinor;
    /** Whole measured positions already included in the greedy prefix. */
    let wholeRowsPicked = 0;
    /** A partial trial can spend more axis-free stock because it need not fill every axis. */
    let axisFreeRemaining = greedyShortfallMinor === 0n ? axisFreeLimitMinor : undefined;
    for (let index = 0; index < candidates.length && remaining > 0n; index += 1) {
      const capacity = capacityMinor[index] ?? 0n;
      const increment = incrementMinor[index] ?? 1n;
      const candidate = candidates[index];
      const nextWholeRows = wholeRowsPicked | (wholeRowBits?.[index] ?? 0);
      if ((greedyShortfallMinor === 0n && candidate !== undefined && completeExclusions?.has(candidate.position)) ||
          (nextWholeRows !== wholeRowsPicked && !wholeMeasuredSubsets?.fitting.has(nextWholeRows))) {
        picks.push(0n);
        continue;
      }
      const budget = axisFreeRemaining !== undefined && candidate !== undefined &&
        !fullWitnessPrimaryBudget?.measuredPositions.has(candidate.position) ? axisFreeRemaining : undefined;
      let maximum = capacity < remaining ? capacity : remaining;
      if (budget !== undefined && budget < maximum) maximum = budget;
      const take = maximum - maximum % increment;
      if (storableQuantityScale(take, decimals) === undefined) break;
      picks.push(take);
      if (take > 0n) wholeRowsPicked = nextWholeRows;
      remaining -= take;
      if (budget !== undefined) axisFreeRemaining = budget - take;
    }
    if (remaining === 0n) {
      const shortfall = greedyShortfallMinor === 0n
        ? zeroQuantity(requested.unit, requested.decimals)
        : inventoryAllocationQuantityIfStorable(greedyShortfallMinor, decimals, requested.unit);
      if (shortfall !== undefined) {
        const allocations = materializeExactAllocations(candidates, picks, decimals);
        if (acceptAllocations === undefined || acceptAllocations(allocations)) return { allocations, shortfall };
      }
    }
  }
  if (candidates.length > MAXIMUM_EXACT_ALLOCATION_DEPTH && !ignoreIncrements &&
      minimumShortfallMinor === 0n && fullWitnessPrimaryBudget !== undefined && axisFreeLimitMinor !== undefined) {
    const completeCandidates = candidates.filter(
      /** Omit an axis-free row when even its smallest legal pick exceeds the complete witness budget. */
      ({ position }, index) => !completeExclusions?.has(position) &&
        (fullWitnessPrimaryBudget.measuredPositions.has(position) || (incrementMinor[index] ?? 1n) <= axisFreeLimitMinor)
    );
    if (completeCandidates.length <= MAXIMUM_EXACT_ALLOCATION_DEPTH) {
      const complete = searchInventoryAllocations({
        ...input, candidates: completeCandidates, acceptPartial: false,
      }, decimals);
      if (complete !== undefined || !acceptPartial) return complete;
      // The complete search proved that a partial witness is the best possible result.
      return searchInventoryAllocations({ ...input, requiresPositiveShortfall: true }, decimals);
    }
  }
  /** When the remainder cannot fit even the smallest increment, only the current prefix can be accepted. */
  let smallestPick = requestedMinor + 1n;
  for (const increment of incrementMinor) {
    if (increment < smallestPick) smallestPick = increment;
  }

  /** Chosen shared-scale amount for each sorted candidate. */
  const chosenMinor = new Array<bigint>(candidates.length).fill(0n);
  /** Failed index/remainder pairs already exhausted by the bounded search. */
  const failedStates = new Set<string>();
  /** Rows that use the axis-free budget when picked. */
  const axisFreeRows = fullWitnessPrimaryBudget === undefined ? undefined : candidates.map(
    /** Membership is based on the exact candidate key retained during sorting. */
    ({ position }) => !fullWitnessPrimaryBudget.measuredPositions.has(position)
  );
  /** Count trial steps, including jumps that skip a branch. */
  let exploredChoices = 0;
  /** Best coherent result so far. Equal quantities keep the first policy choice. */
  let bestAssignment: InventoryAllocationAssignment | undefined;
  // A smaller remainder must also fit storage. Skip fractional bands that cannot improve the diagnostic.
  let bestRemainingMinor = improveOnShortfall === undefined
    ? requestedMinor + 1n
    : (largestStorableAllocationTake({
        limit: integerAtDecimals(improveOnShortfall, decimals) - 1n, increment: 1n,
      }) ?? 0n) + 1n;

  /** Search in policy order until a smallest possible shortfall or diagnostic improvement is found. */
  function* findExactSuffix({ firstIndex, remainingMinor, axisFreePicked, wholeRowsPicked }: InventoryAllocationSearchBranch):
    Generator<InventoryAllocationSearchBranch, boolean> {
    nextRow: for (let index = firstIndex; ; index += 1) {
      const complete = remainingMinor === 0n;
      const selectableRemaining = remainingMinor - minimumShortfallMinor;
      if (complete || index >= candidates.length || selectableRemaining < smallestPick) {
        if (!complete && (!acceptPartial || remainingMinor >= bestRemainingMinor)) return false;
        // A trial can leave a shortfall that cannot be emitted, even though a later trial fits.
        const shortfall = complete
          ? zeroQuantity(requested.unit, requested.decimals)
          : inventoryAllocationQuantityIfStorable(remainingMinor, decimals, requested.unit);
        if (shortfall === undefined) return false;
        const allocations = materializeExactAllocations(candidates, chosenMinor, decimals);
        if (acceptAllocations !== undefined && !acceptAllocations(allocations)) return false;
        bestRemainingMinor = remainingMinor;
        bestAssignment = { allocations, shortfall };
        return remainingMinor === minimumShortfallMinor || improveOnShortfall !== undefined;
      }
      const capacityFromHere = suffixCapacity[index] ?? 0n;
      const divisorFromHere = suffixDivisor[index] ?? 0n;
      const unavoidableRemainder = divisorFromHere === 0n ? remainingMinor : remainingMinor % divisorFromHere;
      const capacityRemainder = remainingMinor - capacityFromHere;
      const minimumRemainder = capacityRemainder > unavoidableRemainder ? capacityRemainder : unavoidableRemainder;
      if (acceptPartial ? minimumRemainder >= bestRemainingMinor : minimumRemainder > 0n) {
        return false;
      }
      const state = `${index}:${remainingMinor}`;
      if (acceptAllocations === undefined && failedStates.has(state))
        return false;
      const capacity = capacityMinor[index] ?? 0n;
      const increment = incrementMinor[index] ?? 1n;
      const maximum = capacity < selectableRemaining ? capacity : selectableRemaining;
      const laterCapacity = suffixCapacity[index + 1] ?? 0n;
      const laterDivisor = suffixDivisor[index + 1] ?? 0n;
      /** Prefer exact fitting suffix sums when this row can vary across many primary increments. */
      let laterWholeSums = suffixWholeSums[index + 1];
      let laterWholeDivisible = suffixWholeDivisibleCapacity[index + 1] ?? 0n;
      const laterMeasuredSums = measuredSuffixSums[index + 1];
      if (capacity / increment > 1n && laterMeasuredSums !== undefined) {
        const fittingSums: bigint[] = [];
        for (const { mask, primary } of laterMeasuredSums) {
          if (wholeMeasuredSubsets?.fitting.has(wholeRowsPicked | mask)) fittingSums.push(primary);
        }
        laterWholeSums = fittingSums;
        laterWholeDivisible = 0n;
      }
      /** A zero-capacity suffix can only accept a zero pending amount. */
      const exactDivisor = acceptPartial ? undefined : (laterDivisor === 0n ? remainingMinor + 1n : laterDivisor);
      const terminalPartial = acceptPartial && laterCapacity === 0n;
      const axisFree = axisFreeRows?.[index] === true;
      const position = candidates[index]?.position;
      const excludedFromComplete = position !== undefined && completeExclusions?.has(position);
      const nextWholeRows = wholeRowsPicked | (wholeRowBits?.[index] ?? 0);
      let take = (maximum / increment) * increment;
      // Once a whole-row prefix exceeds an axis, smaller primary-only picks cannot make it fit.
      if (nextWholeRows !== wholeRowsPicked && !wholeMeasuredSubsets?.fitting.has(nextWholeRows)) take = 0n;
      while (take >= 0n) {
        exploredChoices += 1;
        if (exploredChoices > MAXIMUM_EXACT_ALLOCATION_STATES) {
          // A diagnostic without a proven improvement must leave the accepted plan usable.
          if (ignoreIncrements) return true;
          throw new InventoryExactAllocationLimitError(
            "Exact allocation exceeded its safe search bound; narrow the candidates or request."
          );
        }
        if (axisFreeLimitMinor !== undefined && (!acceptPartial || bestRemainingMinor <= minimumPositiveShortfallMinor)) {
          // A better result now needs every reported measure. Reserve enough primary capacity for it.
          if (excludedFromComplete) take = 0n;
          const axisFreeRemaining = axisFreeLimitMinor - axisFreePicked;
          if (axisFreeRemaining < 0n) break;
          if (axisFree && take > axisFreeRemaining) take = axisFreeRemaining - axisFreeRemaining % increment;
        }
        if (exactDivisor !== undefined || storableQuantityScale(take, decimals) === undefined ||
            (terminalPartial && storableQuantityScale(remainingMinor - take, decimals) === undefined)) {
          // Exact branches solve the suffix congruence and pick storage divisibility together.
          const next = largestStorableAllocationTake({
            limit: take,
            increment,
            ...(terminalPartial || exactDivisor !== undefined ? { remaining: remainingMinor } : {}),
            ...(exactDivisor === undefined ? {} : { suffixDivisor: exactDivisor }),
          });
          if (next === undefined) break;
          take = next;
        }
        const pending = remainingMinor - take;
        if (pending > laterCapacity && !acceptPartial) break;
        const laterLimit = pending < laterCapacity ? pending : laterCapacity;
        /** Greatest reachable or relaxed suffix amount now, and the first amount worth revisiting. */
        let laterUsable = 0n;
        let nextUsable = laterWholeSums === undefined ? laterCapacity : undefined;
        if (laterWholeSums !== undefined) {
          // The next whole subset may be separated by a gap even after using every divisible digit.
          for (const sum of laterWholeSums) {
            if (sum <= pending) {
              const end = sum + laterWholeDivisible;
              const usable = end < pending ? end : pending;
              if (usable > laterUsable) laterUsable = usable;
            } else if (nextUsable === undefined || sum < nextUsable) {
              nextUsable = sum;
            }
          }
        } else if (acceptPartial && laterDivisor !== 0n) {
          laterUsable = laterLimit - laterLimit % laterDivisor;
          nextUsable = laterUsable + laterDivisor;
        }
        if (acceptPartial) {
          const floor = pending - laterLimit;
          if (!terminalPartial && floor > MAXIMUM_STORED_QUANTITY_MINOR) {
            // This lower bound rises as picks decrease. Jump to where the interval first reaches a storable remainder.
            const factor = allocationStorageFactor(floor);
            const firstStorable = ((floor + factor - 1n) / factor) * factor;
            if (firstStorable >= bestRemainingMinor) break;
            if (firstStorable > pending) {
              const limit = remainingMinor - firstStorable;
              if (limit < 0n) break;
              take = limit - limit % increment;
              continue;
            }
          }
        }
        const cannotImprove = acceptPartial
          ? pending - laterUsable >= bestRemainingMinor
          : laterWholeSums !== undefined && pending !== laterUsable;
        if (cannotImprove) {
          // Decreasing this pick only makes the gap larger until another suffix amount can fit.
          if (nextUsable === undefined || laterUsable === laterCapacity) break;
          const nextLimit = remainingMinor - nextUsable;
          if (nextLimit < 0n) break;
          take = nextLimit - nextLimit % increment;
          continue;
        }
        chosenMinor[index] = take;
        if (take === 0n) {
          // All positive choices are exhausted. The zero choice continues with the same prefix and no new frame.
          if (acceptAllocations === undefined) failedStates.add(state);
          continue nextRow;
        }
        yield { firstIndex: index + 1, remainingMinor: pending,
          axisFreePicked: axisFree ? axisFreePicked + take : axisFreePicked, wholeRowsPicked: nextWholeRows };
        if (acceptPartial && bestRemainingMinor <= minimumRemainder) break;
        take -= increment;
      }
      chosenMinor[index] = 0n;
      if (acceptAllocations === undefined) failedStates.add(state);
      return false;
    }
  }

  /** Pause each positive prefix while its child runs without using the JavaScript call stack. */
  const branches = [findExactSuffix({ firstIndex: 0, remainingMinor: requestedMinor, axisFreePicked: 0n, wholeRowsPicked: 0 })];
  for (let branch = branches.at(-1); branch !== undefined; branch = branches.at(-1)) {
    const next = branch.next();
    if (next.done) {
      if (next.value) break;
      branches.pop();
      continue;
    }
    // The root frame holds no positive choice. Every subsequent frame accounts for one selected row.
    if (branches.length > MAXIMUM_EXACT_ALLOCATION_DEPTH) {
      if (ignoreIncrements) break;
      throw new InventoryExactAllocationLimitError(
        "Exact allocation exceeded its safe search bound; narrow the candidates or request."
      );
    }
    branches.push(findExactSuffix(next.value));
  }
  return bestAssignment;
}

/** Return the smallest power of ten that can bring nonnegative digits into storage range. */
function allocationStorageFactor(minor: bigint): bigint {
  let factor = 1n;
  while (minor > MAXIMUM_STORED_QUANTITY_MINOR * factor) factor *= 10n;
  return factor;
}

/** Bounds for skipping allocation picks that cannot be stored exactly. */
interface StorableAllocationTakeInput {
  /** Greatest shared-scale quantity allowed on the candidate. */
  readonly limit: bigint;
  /** Allowed increment on the same scale. */
  readonly increment: bigint;
  /** Amount still requested when the remainder must fit storage or a suffix divisor. */
  readonly remaining?: bigint;
  /** Required remainder divisor for an exact suffix. */
  readonly suffixDivisor?: bigint;
}

/** Find the largest exact allowed pick, including the final shortfall when requested. */
function largestStorableAllocationTake({ limit, increment, remaining, suffixDivisor }: StorableAllocationTakeInput): bigint | undefined {
  const storeShortfall = remaining !== undefined && suffixDivisor === undefined;
  while (limit >= 0n) {
    const takeFactor = allocationStorageFactor(limit);
    const shortfallFactor = storeShortfall ? allocationStorageFactor(remaining - limit) : 1n;
    // Descending past either boundary changes the scale requirement, so solve one range at a time.
    const takeFloor = takeFactor === 1n ? 0n : MAXIMUM_STORED_QUANTITY_MINOR * (takeFactor / 10n) + 1n;
    const shortfallFloor = storeShortfall ? remaining - MAXIMUM_STORED_QUANTITY_MINOR * shortfallFactor : 0n;
    const floor = takeFloor > shortfallFloor ? takeFloor : shortfallFloor;
    const stride = takeFactor === 1n ? increment
      : (increment / allocationModularCoefficients(increment, takeFactor).divisor) * takeFactor;
    const take = largestAllocationMultipleWithRemainder({
      limit, stride, remaining: remaining ?? 0n, factor: suffixDivisor ?? shortfallFactor,
    });
    if (take !== undefined && take >= floor) return take;
    limit = floor - 1n;
  }
  return undefined;
}

/** Exact divisor and coefficient relating a stride to a required modulus. */
interface AllocationModularCoefficients {
  /** Greatest common divisor of the stride and the modulus. */
  readonly divisor: bigint;
  /** Factor multiplying the stride in the integer combination equal to the divisor. */
  readonly coefficient: bigint;
}

/** Find the greatest common divisor and the stride's coefficient using Euclidean division. */
function allocationModularCoefficients(stride: bigint, modulus: bigint): AllocationModularCoefficients {
  let divisor = modulus;
  let remainder = stride % modulus;
  let coefficient = 0n;
  let nextCoefficient = 1n;
  while (remainder !== 0n) {
    const quotient = divisor / remainder;
    const rest = divisor % remainder;
    divisor = remainder;
    remainder = rest;
    const next = coefficient - quotient * nextCoefficient;
    coefficient = nextCoefficient;
    nextCoefficient = next;
  }
  return { divisor, coefficient };
}

/** Bounds for choosing a whole stride with an exact remainder. */
interface AllocationMultipleWithRemainderInput {
  /** Greatest permitted pick. */
  readonly limit: bigint;
  /** Multiple each valid pick must use. */
  readonly stride: bigint;
  /** Amount left to allocate before this pick. */
  readonly remaining: bigint;
  /** Divisor the leftover quantity must satisfy. */
  readonly factor: bigint;
}

/** Find the greatest allowed multiple leaving a shortfall divisible by the storage factor. */
function largestAllocationMultipleWithRemainder({
  limit, stride, remaining, factor,
}: AllocationMultipleWithRemainderInput): bigint | undefined {
  if (factor === 1n) return limit - (limit % stride);
  const { divisor, coefficient } = allocationModularCoefficients(stride, factor);
  if (remaining % divisor !== 0n) return undefined;
  const modulus = factor / divisor;
  const signedOffset = (coefficient * (remaining / divisor)) % modulus;
  const offset = (signedOffset < 0n ? signedOffset + modulus : signedOffset) * stride;
  if (offset > limit) return undefined;
  const period = modulus * stride;
  return offset + ((limit - offset) / period) * period;
}

/** Materialize a trial amount only when it fits the storage range exactly. */
export function inventoryAllocationQuantityIfStorable(
  digits: bigint, decimals: number, unit: Quantity["unit"]
): Quantity | undefined {
  const stored = storableQuantityDigits(digits, decimals);
  return stored === undefined ? undefined : quantity({ ...stored, unit });
}

/** Capacity and increment evidence for one exact stock row. */
interface InventoryAllocationCandidateCapacity {
  /** Greatest legal storable pick at this row. */
  readonly quantity: Quantity;
  /** Whether rounding excluded any available stock. */
  readonly incrementBlockedStock: boolean;
}

/** Narrow one row to its largest publishable capacity while respecting its increment. */
export function inventoryAllocationCandidateCapacity(
  candidate: InventoryWorkingAllocationCandidate
): InventoryAllocationCandidateCapacity {
  const { available, allocationIncrement } = candidate;
  const decimals = Math.max(available.decimals, allocationIncrement?.decimals ?? 0);
  const limit = workingQuantityAtDecimals(available, decimals);
  const increment = allocationIncrement === undefined ? 1n : workingQuantityAtDecimals(allocationIncrement, decimals);
  const take = largestStorableAllocationTake({ limit, increment }) ?? 0n;
  return {
    quantity: inventoryAllocationQuantityAtStorableScale(take, decimals, available.unit, "Allocation row capacity"),
    incrementBlockedStock: limit % increment !== 0n,
  };
}

/** Enforce the storage range for an amount that must be returned. */
function inventoryAllocationQuantityAtStorableScale(
  digits: bigint, decimals: number, unit: Quantity["unit"], label: string
): Quantity {
  const value = inventoryAllocationQuantityIfStorable(digits, decimals, unit);
  if (value === undefined) throw new Error(`${label} exceeds the safe integer storage range.`);
  return value;
}

/** Greedy selection at its natural scale before writing the result. */
interface GreedyInventoryAllocationChoice extends ExactQuantityDigits {
  /** Whether an indivisible increment prevented taking the full available amount. */
  readonly incrementBlocked: boolean;
}

/** Subtract a selection on a shared exact scale without narrowing an intermediate remainder. */
function subtractInventoryAllocationDigits(
  remaining: ExactQuantityDigits,
  pickedMinor: bigint,
  pickedDecimals: number
): void {
  addExactQuantityDigits(remaining, -pickedMinor, pickedDecimals);
}

/** Take the largest allowed amount from one ordered candidate and advance the exact remainder. */
function takeGreedyInventoryAllocation(
  remaining: ExactQuantityDigits,
  candidate: InventoryWorkingAllocationCandidate
): GreedyInventoryAllocationChoice {
  const increment = candidate.allocationIncrement;
  const comparisonDecimals = Math.max(remaining.decimals, candidate.available.decimals, increment?.decimals ?? 0);
  const pending = remaining.minor * (10n ** BigInt(comparisonDecimals - remaining.decimals));
  const available = workingQuantityAtDecimals(candidate.available, comparisonDecimals);
  const takeAvailable = available <= pending;
  const maximum = takeAvailable ? available : pending;
  const quantum = increment === undefined ? 1n : workingQuantityAtDecimals(increment, comparisonDecimals);
  const taken = maximum - maximum % quantum;
  /** Keep the normal scale of the limiting quantity and any increment used to round it. */
  const decimals = Math.max(
    takeAvailable ? candidate.available.decimals : remaining.decimals,
    increment?.decimals ?? 0
  );
  const minor = taken / (10n ** BigInt(comparisonDecimals - decimals));
  if (minor > 0n) subtractInventoryAllocationDigits(remaining, minor, decimals);
  return { minor, decimals, incrementBlocked: taken < maximum };
}

/** Convert one exact shared-scale choice vector into normal allocation rows. */
function materializeExactAllocations(
  candidates: readonly InventoryWorkingAllocationCandidate[],
  chosenMinor: readonly bigint[],
  decimals: number
): readonly InventoryAllocation[] {
  const allocations: InventoryAllocation[] = [];
  for (let index = 0; index < chosenMinor.length; index += 1) {
    const amountMinor = chosenMinor[index] ?? 0n;
    const candidate = candidates[index];
    if (amountMinor === 0n || candidate === undefined) continue;
    allocations.push({
      position: candidate.position,
      quantity: inventoryAllocationQuantityAtStorableScale(
        amountMinor, decimals, candidate.available.unit, "Exact allocation quantity"
      ),
    });
  }
  return allocations;
}

/** Check whether rounding or backtracking might have skipped a better divisible plan. */
function exactAllocationsHaveIncrementTrial(
  requested: Quantity,
  candidates: readonly InventoryWorkingAllocationCandidate[],
  allocations: readonly InventoryAllocation[]
): boolean {
  const allocatedByPosition = new Map<string, Quantity>();
  for (const allocation of allocations) {
    allocatedByPosition.set(
      inventoryStockPositionIdentity(allocation.position),
      allocation.quantity
    );
  }
  /** A prefix can exceed the storage scale even when the whole allocation is exact. */
  const remaining: ExactQuantityDigits = {
    minor: BigInt(requested.amountMinor),
    decimals: requested.decimals,
  };
  for (const candidate of candidates) {
    if (remaining.minor === 0n) break;
    const greedy = takeGreedyInventoryAllocation(remaining, candidate);
    if (greedy.incrementBlocked) return true;
    const exact = allocatedByPosition.get(inventoryStockPositionIdentity(candidate.position));
    const decimals = Math.max(greedy.decimals, exact?.decimals ?? 0);
    const greedyMinor = greedy.minor * (10n ** BigInt(decimals - greedy.decimals));
    if (greedyMinor !== (exact === undefined ? 0n : integerAtDecimals(exact, decimals))) return true;
  }
  return false;
}

/** Validate one candidate's exact units, times, priority, and optional increment. */
function validateAllocationCandidate(
  candidate: InventoryWorkingAllocationCandidate,
  requested: Quantity
): void {
  if (candidate.available.amountMinor <= 0n) {
    throw new Error("Allocation candidate available quantity must be greater than zero.");
  }
  if (candidate.available.unit !== requested.unit) {
    throw new Error("Allocation candidate unit must match requested unit.");
  }
  assertInventoryEpochMilliseconds(candidate.receivedAtEpochMs, "candidate receivedAtEpochMs");
  if (candidate.expiresAtEpochMs !== undefined) {
    assertInventoryEpochMilliseconds(candidate.expiresAtEpochMs, "candidate expiresAtEpochMs");
  }
  if (
    candidate.priority !== undefined &&
    !Number.isSafeInteger(candidate.priority)
  ) {
    throw new Error("Allocation candidate priority must be a safe integer.");
  }
  if (candidate.allocationIncrement !== undefined) {
    if (candidate.allocationIncrement.amountMinor <= 0n) {
      throw new Error("Allocation increment must be greater than zero.");
    }
    if (candidate.allocationIncrement.unit !== requested.unit) {
      throw new Error("Allocation increment unit must match requested unit.");
    }
  }
}

/** Compare two candidates by explicit priority, policy dates, then exact position identity. */
export function compareInventoryAllocationCandidates(
  left: InventoryAllocationCandidate,
  right: InventoryAllocationCandidate,
  method: InventoryAllocationMethod
): number {
  return compareWorkingAllocationCandidates(left, right, method);
}

/** Compare published and unpublished candidates by the same policy order. */
export function compareWorkingAllocationCandidates(
  left: InventoryWorkingAllocationCandidate,
  right: InventoryWorkingAllocationCandidate,
  method: InventoryAllocationMethod
): number {
  const priorityOrder = (left.priority ?? 0) - (right.priority ?? 0);
  if (priorityOrder !== 0) return priorityOrder;
  if (method === InventoryAllocationMethod.Fefo) {
    const expiryOrder = compareOptionalExpiry(left.expiresAtEpochMs, right.expiresAtEpochMs);
    if (expiryOrder !== 0) return expiryOrder;
  }
  const receiptOrder = (left.receivedAtEpochMs < right.receivedAtEpochMs ? -1 : left.receivedAtEpochMs > right.receivedAtEpochMs ? 1 : 0);
  if (receiptOrder !== 0) return receiptOrder;
  if (method === InventoryAllocationMethod.Fifo) {
    const expiryOrder = compareOptionalExpiry(left.expiresAtEpochMs, right.expiresAtEpochMs);
    if (expiryOrder !== 0) return expiryOrder;
  }
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Compare expiry times with no-expiry candidates sorted last. */
function compareOptionalExpiry(
  left: number | undefined,
  right: number | undefined
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}
