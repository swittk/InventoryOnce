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
import { MAXIMUM_STORED_QUANTITY_MINOR, storableQuantityScale } from "./quantity-storage.js";

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

/** Maximum recursive exact-search depth before callers must narrow the candidate set. */
const MAXIMUM_EXACT_ALLOCATION_DEPTH = 5_000;

/** Pick FIFO/FEFO stock without inventing synthetic lots or hiding expiry/shortfall policy. */
export function allocateInventory(input: AllocateInventoryInput): InventoryAllocationResult {
  return allocateInventoryCandidates(input, false);
}

/** Find the largest accepted witness, including a partial witness for measured recording. */
export function allocateInventoryUpTo(input: AllocateInventoryInput): InventoryAllocationResult {
  return allocateInventoryCandidates(input, true);
}

/** Share the ordered, bounded search without changing the public full-plan constraint. */
function allocateInventoryCandidates({
  requested,
  candidates,
  method,
  nowEpochMs,
  allowExpired = false,
  acceptAllocations,
}: AllocateInventoryInput, acceptPartial: boolean): InventoryAllocationResult {
  positiveQuantity(requested, "Requested allocation");
  assertInventoryEpochMilliseconds(nowEpochMs, "allocation now");
  let expiredStockWasExcluded = false;
  const eligible: InventoryAllocationCandidate[] = [];
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
    left: InventoryAllocationCandidate,
    right: InventoryAllocationCandidate
  ): number => compareInventoryAllocationCandidates(left, right, method);
  eligible.sort(compareEligibleCandidates);

  // Greedy rounding can strand a remainder even when later package sizes fill the whole request.
  const assignment = searchInventoryAllocations({
    requested,
    candidates: eligible,
    ...(acceptAllocations === undefined ? {} : { acceptAllocations }),
    acceptPartial,
  });
  if (assignment !== undefined) {
    return {
      allocations: assignment.allocations,
      shortfall: assignment.shortfall,
      expiredStockWasExcluded,
      incrementBlockedStock: assignment.shortfall.amountMinor > 0
        ? partialAllocationHasBlockedIncrement(eligible, assignment)
        : eligible.some(
            /** Only an indivisible increment can make an exact-plan deviation increment-driven. */
            (candidate) => candidate.allocationIncrement !== undefined
          ) &&
          exactAllocationsDoNotFollowGreedyPrefix(requested, eligible, assignment.allocations),
      allocationConstraintBlockedStock: false,
    };
  }

  if (acceptAllocations !== undefined) {
    const unconstrainedExact = searchInventoryAllocations({
      requested,
      candidates: eligible,
      acceptPartial: false,
    });
    let incrementBlockedStock = false;
    if (unconstrainedExact === undefined) {
      /** Capacity still needed to cover the request before applying increments. */
      const uncovered: InventoryAllocationDigits = {
        minor: BigInt(requested.amountMinor),
        decimals: requested.decimals,
      };
      for (const candidate of eligible) {
        subtractInventoryAllocationDigits(uncovered, BigInt(candidate.available.amountMinor), candidate.available.decimals);
        if (uncovered.minor <= 0n) {
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

  /** Intermediate remainders need extra digits even when all returned amounts fit. */
  const remaining: InventoryAllocationDigits = {
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
      incrementBlockedStock: partialAllocationHasBlockedIncrement(eligible, storable),
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

/** Distinguish an exhausted row from remaining stock that cannot supply one legal increment. */
function partialAllocationHasBlockedIncrement(
  candidates: readonly InventoryAllocationCandidate[],
  assignment: InventoryAllocationAssignment
): boolean {
  const allocated = new Map<string, Quantity>();
  for (const line of assignment.allocations) {
    allocated.set(inventoryStockPositionIdentity(line.position), line.quantity);
  }
  for (const candidate of candidates) {
    const increment = candidate.allocationIncrement;
    if (increment === undefined) continue;
    const used = allocated.get(inventoryStockPositionIdentity(candidate.position));
    if (used !== undefined && compareQuantity(candidate.available, used) === 0) continue;
    const decimals = Math.max(candidate.available.decimals, used?.decimals ?? 0, increment.decimals);
    const unpicked = integerAtDecimals(candidate.available, decimals) -
      (used === undefined ? 0n : integerAtDecimals(used, decimals));
    if (compareQuantity(assignment.shortfall, increment) < 0 || unpicked < integerAtDecimals(increment, decimals)) {
      return true;
    }
  }
  return false;
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
  readonly candidates: readonly InventoryAllocationCandidate[];
  /** Extra exact evidence a complete or partial assignment must satisfy. */
  readonly acceptAllocations?: AllocateInventoryInput["acceptAllocations"];
  /** Whether a coherent assignment can leave part of the request unwitnessed. */
  readonly acceptPartial: boolean;
}

/** Find the largest allowed assignment, breaking quantity ties by FIFO/FEFO order. */
function searchInventoryAllocations({
  requested, candidates, acceptAllocations, acceptPartial,
}: SearchInventoryAllocationsInput): InventoryAllocationAssignment | undefined {
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
    const capacity = capacityMinor[index] ?? 0n;
    const increment = incrementMinor[index] ?? 1n;
    // Stock below the next whole increment cannot improve a suffix assignment.
    suffixCapacity[index] =
      (suffixCapacity[index + 1] ?? 0n) + capacity - capacity % increment;
  }
  if (!acceptPartial && (suffixCapacity[0] ?? 0n) < requestedMinor) return undefined;
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
  /** Best coherent result so far. Equal quantities keep the first policy choice. */
  let bestAssignment: InventoryAllocationAssignment | undefined;
  let bestRemainingMinor = requestedMinor + 1n;

  /** Search larger amounts from earlier rows first, giving deterministic FIFO/FEFO preference. */
  const findExactSuffix = (index: number, remainingMinor: bigint): boolean => {
    const complete = remainingMinor === 0n;
    if (complete || index >= candidates.length) {
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
      return complete;
    }
    const capacityFromHere = suffixCapacity[index] ?? 0n;
    if (acceptPartial ? remainingMinor - capacityFromHere >= bestRemainingMinor : capacityFromHere < remainingMinor) {
      return false;
    }
    const state = `${index}:${remainingMinor}`;
    if (acceptAllocations === undefined && failedStates.has(state))
      return false;
    const capacity = capacityMinor[index] ?? 0n;
    const increment = incrementMinor[index] ?? 1n;
    const maximum = capacity < remainingMinor ? capacity : remainingMinor;
    const laterCapacity = suffixCapacity[index + 1] ?? 0n;
    const terminalPartial = acceptPartial && index === candidates.length - 1;
    let take = (maximum / increment) * increment;
    while (take >= 0n) {
      if (storableQuantityScale(take, decimals) === undefined ||
          (terminalPartial && storableQuantityScale(remainingMinor - take, decimals) === undefined)) {
        // Skip impossible storage digits before they consume the bounded search budget.
        const next = largestStorableAllocationTake({
          limit: take,
          increment,
          ...(terminalPartial ? { remaining: remainingMinor } : {}),
        });
        if (next === undefined) break;
        take = next;
      }
      // Lower choices cannot make up an uncovered amount or improve the best partial witness.
      const unfillable = remainingMinor - take - laterCapacity;
      if (acceptPartial ? unfillable >= bestRemainingMinor : unfillable > 0n) break;
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

  findExactSuffix(0, requestedMinor);
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
  /** Amount still requested when the remaining shortfall must also fit storage. */
  readonly remaining?: bigint;
}

/** Find the largest exact allowed pick, including the final shortfall when requested. */
function largestStorableAllocationTake({ limit, increment, remaining }: StorableAllocationTakeInput): bigint | undefined {
  while (limit >= 0n) {
    const takeFactor = allocationStorageFactor(limit);
    const shortfallFactor = remaining === undefined ? 1n : allocationStorageFactor(remaining - limit);
    // Descending past either boundary changes the scale requirement, so solve one range at a time.
    const takeFloor = takeFactor === 1n ? 0n : MAXIMUM_STORED_QUANTITY_MINOR * (takeFactor / 10n) + 1n;
    const shortfallFloor = remaining === undefined ? 0n : remaining - MAXIMUM_STORED_QUANTITY_MINOR * shortfallFactor;
    const floor = takeFloor > shortfallFloor ? takeFloor : shortfallFloor;
    const stride = takeFactor === 1n ? increment
      : (increment / allocationModularCoefficients(increment, takeFactor).divisor) * takeFactor;
    const take = largestAllocationMultipleWithRemainder({ limit, stride, remaining: remaining ?? 0n, factor: shortfallFactor });
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
  const scale = storableQuantityScale(digits, decimals);
  if (scale === undefined) return undefined;
  const minor = scale === decimals ? digits : digits / (10n ** BigInt(decimals - scale));
  return quantity({ amountMinor: Number(minor), decimals: scale, unit });
}

/** Enforce the storage range for an amount that must be returned. */
function inventoryAllocationQuantityAtStorableScale(
  digits: bigint, decimals: number, unit: Quantity["unit"], label: string
): Quantity {
  const value = inventoryAllocationQuantityIfStorable(digits, decimals, unit);
  if (value === undefined) throw new Error(`${label} exceeds the safe integer storage range.`);
  return value;
}

/** Temporary exact digits on the allocation's common unit. */
interface InventoryAllocationDigits {
  /** Signed digits before the storage range is applied. */
  minor: bigint;
  /** Decimal places used by the digits. */
  decimals: number;
}

/** Greedy selection at its natural scale before writing the result. */
interface GreedyInventoryAllocationChoice extends InventoryAllocationDigits {
  /** Whether an indivisible increment prevented taking the full available amount. */
  readonly incrementBlocked: boolean;
}

/** Subtract a selection on a shared exact scale without narrowing an intermediate remainder. */
function subtractInventoryAllocationDigits(
  remaining: InventoryAllocationDigits,
  pickedMinor: bigint,
  pickedDecimals: number
): void {
  const decimals = Math.max(remaining.decimals, pickedDecimals);
  remaining.minor = remaining.minor * (10n ** BigInt(decimals - remaining.decimals)) -
    pickedMinor * (10n ** BigInt(decimals - pickedDecimals));
  remaining.decimals = decimals;
}

/** Take the largest allowed amount from one ordered candidate and advance the exact remainder. */
function takeGreedyInventoryAllocation(
  remaining: InventoryAllocationDigits,
  candidate: InventoryAllocationCandidate
): GreedyInventoryAllocationChoice {
  const increment = candidate.allocationIncrement;
  const comparisonDecimals = Math.max(remaining.decimals, candidate.available.decimals, increment?.decimals ?? 0);
  const pending = remaining.minor * (10n ** BigInt(comparisonDecimals - remaining.decimals));
  const available = integerAtDecimals(candidate.available, comparisonDecimals);
  const takeAvailable = available <= pending;
  const maximum = takeAvailable ? available : pending;
  const quantum = increment === undefined ? 1n : integerAtDecimals(increment, comparisonDecimals);
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
      quantity: inventoryAllocationQuantityAtStorableScale(
        amountMinor, decimals, candidate.available.unit, "Exact allocation quantity"
      ),
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
  /** A prefix can exceed the storage scale even when the whole allocation is exact. */
  const remaining: InventoryAllocationDigits = {
    minor: BigInt(requested.amountMinor),
    decimals: requested.decimals,
  };
  for (const candidate of candidates) {
    if (remaining.minor === 0n) break;
    const greedy = takeGreedyInventoryAllocation(remaining, candidate);
    const exact = allocatedByPosition.get(inventoryStockPositionIdentity(candidate.position));
    const decimals = Math.max(greedy.decimals, exact?.decimals ?? 0);
    const greedyMinor = greedy.minor * (10n ** BigInt(decimals - greedy.decimals));
    if (greedyMinor !== (exact === undefined ? 0n : integerAtDecimals(exact, decimals))) return true;
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
