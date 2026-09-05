import { compareInventoryIdentityText } from "./ordering.js";
import { assertCanonicalInventoryTime } from "./events.js";
import {
  inventoryStockPositionIdentity,
  type InventoryStockPositionKey,
} from "./model.js";
import {
  addQuantity,
  compareQuantity,
  integerAtDecimals,
  positiveQuantity,
  quantity,
  safeNumber,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";

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
  readonly receivedAt: string;
  /** Expiry/use-by time when this stock can become unusable. */
  readonly expiresAt?: string;
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
  readonly now: string;
  /** Explicit override allowing expired stock to be allocated. */
  readonly allowExpired?: boolean;
  /** Optional whole-plan predicate used to reject allocations that violate external claims. */
  readonly acceptAllocations?: (
    allocations: readonly InventoryAllocation[]
  ) => boolean;
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
  /** True when an exact physical assignment existed but the whole-plan acceptance rule rejected it. */
  readonly allocationConstraintBlockedStock: boolean;
}

/** Maximum exact-allocation search choices before callers must narrow the candidate set. */
export const MAXIMUM_EXACT_ALLOCATION_STATES = 100_000;

/** Maximum recursive exact-search depth before callers must narrow the candidate set. */
const MAXIMUM_EXACT_ALLOCATION_DEPTH = 5_000;

/** Pick FIFO/FEFO stock without inventing synthetic lots or hiding expiry/shortfall policy. */
export function allocateInventory({
  requested,
  candidates,
  method,
  now,
  allowExpired = false,
  acceptAllocations,
}: AllocateInventoryInput): InventoryAllocationResult {
  positiveQuantity(requested, "Requested allocation");
  assertCanonicalInventoryTime(now, "allocation now");
  let expiredStockWasExcluded = false;
  const eligible: InventoryAllocationCandidate[] = [];
  for (const candidate of candidates) {
    validateAllocationCandidate(candidate, requested);
    const expired =
      candidate.expiresAt !== undefined && candidate.expiresAt <= now;
    if (expired && !allowExpired) {
      expiredStockWasExcluded = true;
      continue;
    }
    eligible.push(candidate);
  }
  /** Keep the caller's chosen FIFO/FEFO method inside this one sort. */
  const compareEligibleCandidates = (
    left: InventoryAllocationCandidate,
    right: InventoryAllocationCandidate
  ): number => compareInventoryAllocationCandidates(left, right, method);
  eligible.sort(compareEligibleCandidates);

  // Greedy rounding can strand a remainder even when later package sizes fill the whole request.
  const exactAllocations = createExactAllocationsIfPossible(
    requested,
    eligible,
    acceptAllocations
  );
  if (exactAllocations !== undefined) {
    return {
      allocations: exactAllocations,
      shortfall: zeroQuantity(requested.unit, requested.decimals),
      expiredStockWasExcluded,
      incrementBlockedStock:
        eligible.some(
          /** Only an indivisible increment can make an exact-plan deviation increment-driven. */
          (candidate) => candidate.allocationIncrement !== undefined
        ) &&
        exactAllocationsDoNotFollowGreedyPrefix(
          requested,
          eligible,
          exactAllocations
        ),
      allocationConstraintBlockedStock: false,
    };
  }

  if (acceptAllocations !== undefined) {
    const unconstrainedExact = createExactAllocationsIfPossible(
      requested,
      eligible,
      undefined
    );
    let incrementBlockedStock = false;
    if (unconstrainedExact === undefined) {
      let eligibleCapacity = zeroQuantity(requested.unit, requested.decimals);
      for (const candidate of eligible) {
        eligibleCapacity = addQuantity(eligibleCapacity, candidate.available);
        if (compareQuantity(eligibleCapacity, requested) >= 0) {
          incrementBlockedStock = true;
          break;
        }
      }
    }
    return {
      allocations: [],
      shortfall: requested,
      expiredStockWasExcluded,
      incrementBlockedStock,
      allocationConstraintBlockedStock: unconstrainedExact !== undefined,
    };
  }

  let remaining = requested;
  let incrementBlockedStock = false;
  const allocations: InventoryAllocation[] = [];
  for (const candidate of eligible) {
    if (
      compareQuantity(
        remaining,
        zeroQuantity(remaining.unit, remaining.decimals)
      ) <= 0
    ) {
      break;
    }
    const maximum =
      compareQuantity(candidate.available, remaining) <= 0
        ? candidate.available
        : remaining;
    const allocated =
      candidate.allocationIncrement === undefined
        ? maximum
        : floorQuantityToIncrement(maximum, candidate.allocationIncrement);
    if (compareQuantity(allocated, maximum) < 0) {
      incrementBlockedStock = true;
    }
    if (
      compareQuantity(
        allocated,
        zeroQuantity(allocated.unit, allocated.decimals)
      ) <= 0
    ) {
      incrementBlockedStock = true;
      continue;
    }
    allocations.push({ position: candidate.position, quantity: allocated });
    remaining = subtractQuantity(remaining, allocated);
  }
  return {
    allocations,
    shortfall: remaining,
    expiredStockWasExcluded,
    incrementBlockedStock,
    allocationConstraintBlockedStock: false,
  };
}

/** Find a full exact assignment while preferring earlier FIFO/FEFO rows at every choice. */
function createExactAllocationsIfPossible(
  requested: Quantity,
  candidates: readonly InventoryAllocationCandidate[],
  acceptAllocations: AllocateInventoryInput["acceptAllocations"]
): readonly InventoryAllocation[] | undefined {
  let decimals = requested.decimals;
  for (const candidate of candidates) {
    decimals = Math.max(decimals, candidate.available.decimals);
    if (candidate.allocationIncrement !== undefined) {
      decimals = Math.max(decimals, candidate.allocationIncrement.decimals);
    }
  }
  const requestedMinor = integerAtDecimals(requested, decimals);
  const capacityMinor = candidates.map(
    /** Put every candidate capacity on one exact integer scale for the bounded search. */
    (candidate) => integerAtDecimals(candidate.available, decimals)
  );
  const incrementMinor = candidates.map(
    /** Divisible rows use the smallest exact digit on the shared scale. */
    (candidate) =>
      candidate.allocationIncrement === undefined
        ? 1n
        : integerAtDecimals(candidate.allocationIncrement, decimals)
  );
  const suffixCapacity: bigint[] = new Array(candidates.length + 1).fill(0n);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    suffixCapacity[index] =
      (suffixCapacity[index + 1] ?? 0n) + (capacityMinor[index] ?? 0n);
  }
  if ((suffixCapacity[0] ?? 0n) < requestedMinor) return undefined;
  if (candidates.length > MAXIMUM_EXACT_ALLOCATION_DEPTH) {
    throw new Error(
      "Exact allocation exceeded its safe search bound; narrow the candidates or request."
    );
  }

  /** Chosen shared-scale amount for each sorted candidate. */
  const chosenMinor = new Array<bigint>(candidates.length).fill(0n);
  /** Failed index/remainder pairs already exhausted by the bounded search. */
  const failedStates = new Set<string>();
  let exploredChoices = 0;

  /** Search larger amounts from earlier rows first, giving deterministic FIFO/FEFO preference. */
  const findExactSuffix = (index: number, remainingMinor: bigint): boolean => {
    if (remainingMinor === 0n) {
      return (
        acceptAllocations === undefined ||
        acceptAllocations(
          materializeExactAllocations(candidates, chosenMinor, decimals)
        )
      );
    }
    if (index >= candidates.length) return false;
    if ((suffixCapacity[index] ?? 0n) < remainingMinor) return false;
    const state = `${index}:${remainingMinor}`;
    if (acceptAllocations === undefined && failedStates.has(state))
      return false;
    const capacity = capacityMinor[index] ?? 0n;
    const increment = incrementMinor[index] ?? 1n;
    const maximum = capacity < remainingMinor ? capacity : remainingMinor;
    let take = (maximum / increment) * increment;
    while (take >= 0n) {
      exploredChoices += 1;
      if (exploredChoices > MAXIMUM_EXACT_ALLOCATION_STATES) {
        throw new Error(
          "Exact allocation exceeded its safe search bound; narrow the candidates or request."
        );
      }
      chosenMinor[index] = take;
      if (findExactSuffix(index + 1, remainingMinor - take)) return true;
      if (take === 0n) break;
      take -= increment;
    }
    chosenMinor[index] = 0n;
    if (acceptAllocations === undefined) failedStates.add(state);
    return false;
  };

  if (!findExactSuffix(0, requestedMinor)) return undefined;
  return materializeExactAllocations(candidates, chosenMinor, decimals);
}

/** Convert one exact shared-scale choice vector into normal allocation rows. */
function materializeExactAllocations(
  candidates: readonly InventoryAllocationCandidate[],
  chosenMinor: readonly bigint[],
  decimals: number
): readonly InventoryAllocation[] {
  const allocations: InventoryAllocation[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const amountMinor = chosenMinor[index] ?? 0n;
    const candidate = candidates[index];
    if (amountMinor === 0n || candidate === undefined) continue;
    allocations.push({
      position: candidate.position,
      quantity: quantity({
        amountMinor: safeNumber(
          amountMinor,
          "Exact allocation quantity"
        ),
        decimals,
        unit: candidate.available.unit,
      }),
    });
  }
  return allocations;
}

/** Return whether full exact allocation had to skip an earlier greedy increment choice. */
function exactAllocationsDoNotFollowGreedyPrefix(
  requested: Quantity,
  candidates: readonly InventoryAllocationCandidate[],
  allocations: readonly InventoryAllocation[]
): boolean {
  const allocatedByPosition = new Map<string, Quantity>();
  for (const allocation of allocations) {
    allocatedByPosition.set(
      inventoryStockPositionIdentity(allocation.position),
      allocation.quantity
    );
  }
  let remaining = requested;
  for (const candidate of candidates) {
    if (
      compareQuantity(
        remaining,
        zeroQuantity(remaining.unit, remaining.decimals)
      ) <= 0
    )
      break;
    const maximum =
      compareQuantity(candidate.available, remaining) <= 0
        ? candidate.available
        : remaining;
    const greedy =
      candidate.allocationIncrement === undefined
        ? maximum
        : floorQuantityToIncrement(maximum, candidate.allocationIncrement);
    const exact =
      allocatedByPosition.get(
        inventoryStockPositionIdentity(candidate.position)
      ) ?? zeroQuantity(requested.unit, requested.decimals);
    if (compareQuantity(greedy, exact) !== 0) return true;
    remaining = subtractQuantity(remaining, greedy);
  }
  return false;
}

/** Validate one candidate's exact units, times, priority, and optional increment. */
function validateAllocationCandidate(
  candidate: InventoryAllocationCandidate,
  requested: Quantity
): void {
  positiveQuantity(
    candidate.available,
    "Allocation candidate available quantity"
  );
  if (candidate.available.unit !== requested.unit) {
    throw new Error("Allocation candidate unit must match requested unit.");
  }
  assertCanonicalInventoryTime(candidate.receivedAt, "candidate receivedAt");
  if (candidate.expiresAt !== undefined) {
    assertCanonicalInventoryTime(candidate.expiresAt, "candidate expiresAt");
  }
  if (
    candidate.priority !== undefined &&
    !Number.isSafeInteger(candidate.priority)
  ) {
    throw new Error("Allocation candidate priority must be a safe integer.");
  }
  if (candidate.allocationIncrement !== undefined) {
    positiveQuantity(candidate.allocationIncrement, "Allocation increment");
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
  const priorityOrder = (left.priority ?? 0) - (right.priority ?? 0);
  if (priorityOrder !== 0) return priorityOrder;
  if (method === InventoryAllocationMethod.Fefo) {
    const expiryOrder = compareOptionalExpiry(left.expiresAt, right.expiresAt);
    if (expiryOrder !== 0) return expiryOrder;
  }
  const receiptOrder = compareInventoryIdentityText(left.receivedAt, right.receivedAt);
  if (receiptOrder !== 0) return receiptOrder;
  if (method === InventoryAllocationMethod.Fifo) {
    const expiryOrder = compareOptionalExpiry(left.expiresAt, right.expiresAt);
    if (expiryOrder !== 0) return expiryOrder;
  }
  return compareInventoryIdentityText(inventoryStockPositionIdentity(left.position), inventoryStockPositionIdentity(right.position));
}

/** Compare expiry times with no-expiry candidates sorted last. */
function compareOptionalExpiry(
  left: string | undefined,
  right: string | undefined
): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareInventoryIdentityText(left, right);
}

/** Round one exact same-unit quantity down to a whole number of one increment. */
function floorQuantityToIncrement(
  value: Quantity,
  increment: Quantity
): Quantity {
  if (value.unit !== increment.unit) {
    throw new Error("Allocation quantity and increment units must match.");
  }
  const decimals = Math.max(value.decimals, increment.decimals);
  const valueMinor = integerAtDecimals(value, decimals);
  const incrementMinor = integerAtDecimals(increment, decimals);
  const wholeMinor = (valueMinor / incrementMinor) * incrementMinor;
  return quantity({
    amountMinor: safeNumber(
      wholeMinor,
      "Rounded allocation quantity"
    ),
    decimals,
    unit: value.unit,
  });
}
