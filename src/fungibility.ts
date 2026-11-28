import { positionHasUnfixedIndependentMeasuredContents as hasUnfixedIndependentMeasuredContents } from "./stock-amount-rules.js";
import {
  allocateWorkingInventory,
  compareWorkingAllocationCandidates,
  inventoryAllocationCandidateCapacity,
  InventoryAllocationMethod,
  InventoryExactAllocationLimitError,
  type InventoryAllocation,
  type InventoryWorkingAllocationCandidate,
} from "./allocation.js";
import {
  resolveInventoryAmount,
  type InventoryAmount,
} from "./amounts.js";
import {
  type InventoryCatalog,
  type InventoryFungibilityMemberDefinition,
  type InventoryFungibilityPoolDefinitionRevision,
  type InventoryFungibilityRevisionId,
  type InventoryItemDefinitionRevision,
} from "./catalog.js";
import { assertInventoryEpochMilliseconds } from "./events.js";
import { compareInventoryIdentityText } from "./ordering.js";
import {
  addInventoryMeasurements,
  inventoryMeasurementAt,
  inventoryMeasurementsAreZero,
  scalarInventoryMeasurements,
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryStockPosition,
  type InventoryStockPositionKey,
  type ItemRevisionId,
} from "./model.js";
import {
  createInventorySparseRecord,
  inventorySparseRecordHas,
  inventorySparseRecordValue,
  setInventorySparseRecordValue,
} from "./sparse-record.js";
import {
  assertInventoryPolicyCanPickAroundIndependentHold,
  inventoryAllocationPoolSelector,
  inventoryAmountForPrimaryAllocation,
  inventoryStockPoolRowsFromProjection,
  prepareInventoryPolicyAllocationPool,
} from "./picking.js";
import { type InventoryPlacementState } from "./placement.js";
import { inventoryMeasurementChangeFitsStorage } from "./measurement-totals.js";
import {
  findInventoryPositions,
  type InventoryProjectionState,
} from "./projection.js";
import { InventoryReservationFeasibilityLimitError } from "./reservation-feasibility-limit.js";
import {
  InventoryReservationFeasibilityStatus,
  inspectInventoryReservationFeasibility,
  inventoryReservationsAt,
  type InventoryReservation,
  type InventoryReservationBook,
} from "./reservations.js";
import {
  compareQuantity,
  convertQuantityByReferenceExact,
  integerAtDecimals,
  MAXIMUM_QUANTITY_DECIMALS,
  positiveQuantity,
  quantity,
  quantityIsWholeMultipleOf,
  type Quantity,
} from "./quantity.js";
import {
  addExactQuantityDigits,
  compareWorkingQuantities,
  inventoryQuantityChangeFitsStorage,
  InventoryQuantityRepresentationError,
  leastCommonWorkingQuantityMultiple,
  materializeInventoryWorkingQuantity,
  quantityGreatestCommonDivisor,
  storableQuantityDigits,
  workingQuantityAtDecimals,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
  inventoryStockPositionMatchesNormalizedSelector,
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";
import type { InventoryWorldState } from "./world.js";

/** Common position dimensions applied independently to every exact pool member item. */
export type InventoryFungibilityScope = Omit<
  InventoryStockSelector,
  "itemId" | "itemRevisionIds"
>;

/** How a candidate allocation changes claim capacity during reservation-safe planning. */
export enum InventoryFungibilityReservationEffectKind {
  /** Selected stock leaves the eligible physical world, as with issue or scrap. */
  Deplete = "deplete",
  /** Selected stock moves to another direct placement while retaining every other dimension. */
  Transfer = "transfer",
}

/** Claim-feasibility effect used by one pure fungibility allocation preview. */
export interface InventoryFungibilityReservationEffect {
  /** Deplete or direct-placement-transfer semantics. */
  readonly kind: InventoryFungibilityReservationEffectKind;
  /** Required destination for Transfer and forbidden for Deplete. */
  readonly toPlacementNodeId?: string;
}

/** Normalize one common pool scope through the same selector rules used by ordinary stock. */
export function normalizeInventoryFungibilityScope(
  scope: InventoryFungibilityScope
): InventoryFungibilityScope {
  const normalized = normalizeInventoryStockSelector({
    ...scope,
    itemId: "inventoryonce-fungibility-scope",
  });
  const { itemId, itemRevisionIds, ...result } = normalized;
  void itemId;
  void itemRevisionIds;
  return result;
}

/** Stable common-scope identity used by idempotent fungibility operations. */
export function inventoryFungibilityScopeIdentity(
  scope: InventoryFungibilityScope
): string {
  return JSON.stringify(normalizeInventoryFungibilityScope(scope));
}

/** Exact contribution of one retained member revision to one pool summary. */
export interface InventoryFungibilityMemberSummary {
  /** Exact member definition used for conversion. */
  readonly member: InventoryFungibilityMemberDefinition;
  /** Stable physical item identity behind this exact revision. */
  readonly itemId: string;
  /** Signed net member-axis quantity: physical stock minus recorded deficit. */
  readonly memberQuantity: Quantity;
  /** Positive physical member-axis quantity across selected positions. */
  readonly physicalMemberQuantity: Quantity;
  /** Positive recorded-deficit magnitude on the member axis. */
  readonly deficitMemberQuantity: Quantity;
  /** Signed net common-basis contribution. */
  readonly poolQuantity: Quantity;
  /** Positive physical common-basis contribution. */
  readonly physicalPoolQuantity: Quantity;
  /** Positive deficit common-basis contribution. */
  readonly deficitPoolQuantity: Quantity;
  /** Exact underlying positions; member identity is never replaced by pool identity. */
  readonly positions: readonly InventoryStockPosition[];
}

/** Derived revision-frozen common-basis view over exact member stock. */
export interface InventoryFungibilitySummary {
  /** Exact immutable pool revision used for every conversion. */
  readonly definition: InventoryFungibilityPoolDefinitionRevision;
  /** Common dimensions applied to each exact member selector. */
  readonly scope: InventoryFungibilityScope;
  /** Signed net common-basis quantity across all member positions. */
  readonly total: Quantity;
  /** Positive physical common-basis quantity. */
  readonly physicalTotal: Quantity;
  /** Positive recorded-deficit magnitude in the common basis. */
  readonly deficitTotal: Quantity;
  /** Member breakdown sorted by exact item revision identity. */
  readonly members: readonly InventoryFungibilityMemberSummary[];
}

/** Inputs for deriving one exact pool summary from current physical truth. */
export interface SummarizeInventoryFungibilityInput {
  /** Frozen retained catalogue containing the exact pool/member revisions. */
  readonly catalog: InventoryCatalog;
  /** Current rebuildable physical stock projection. */
  readonly projection: InventoryProjectionState;
  /** Exact pool revision; active pointers are resolved before durable operations. */
  readonly fungibilityRevisionId: InventoryFungibilityRevisionId;
  /** Optional common stock dimensions such as placement/status/owner. */
  readonly scope?: InventoryFungibilityScope;
}

/** Summarize one pool without merging or rewriting member item identities. */
export function summarizeInventoryFungibility({
  catalog,
  projection,
  fungibilityRevisionId,
  scope = {},
}: SummarizeInventoryFungibilityInput): InventoryFungibilitySummary {
  const definition = catalog.fungibilityRevision(fungibilityRevisionId);
  const normalizedScope = normalizeInventoryFungibilityScope(scope);
  /** Pool totals stay wide until every member contributes. */
  const total: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const physicalTotal: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const deficitTotal: ExactQuantityDigits = { minor: 0n, decimals: 0 };
  const members: InventoryFungibilityMemberSummary[] = [];
  for (const member of definition.members) {
    const item = catalog.itemRevision(member.itemRevisionId);
    const selector = selectorForFungibilityMember(item, normalizedScope);
    const positions = selectedFungibilityPositions(projection, selector);
    /** Separate signed, physical, and deficit measures for this exact member. */
    const memberTotal: ExactQuantityDigits = { minor: 0n, decimals: 0 };
    const physicalMember: ExactQuantityDigits = { minor: 0n, decimals: 0 };
    const deficitMember: ExactQuantityDigits = { minor: 0n, decimals: 0 };
    for (const position of positions) {
      const measured = inventoryMeasurementAt(
        position.measurements,
        member.measurementAxisId,
        member.memberQuantity.unit
      );
      const minor = BigInt(measured.amountMinor);
      addExactQuantityDigits(memberTotal, minor, measured.decimals);
      if (minor < 0n) addExactQuantityDigits(deficitMember, -minor, measured.decimals);
      else addExactQuantityDigits(physicalMember, minor, measured.decimals);
    }
    const memberQuantity = storeFungibilityTotal(memberTotal, member.memberQuantity.unit);
    const physicalMemberQuantity = storeFungibilityTotal(physicalMember, member.memberQuantity.unit);
    const deficitMemberQuantity = storeFungibilityTotal(deficitMember, member.memberQuantity.unit);
    const poolQuantity = convertQuantityByReferenceExact(
      memberQuantity,
      member.memberQuantity,
      member.poolQuantity
    );
    const physicalPoolQuantity = convertQuantityByReferenceExact(
      physicalMemberQuantity,
      member.memberQuantity,
      member.poolQuantity
    );
    const deficitPoolQuantity = convertQuantityByReferenceExact(
      deficitMemberQuantity,
      member.memberQuantity,
      member.poolQuantity
    );
    addExactQuantityDigits(total, BigInt(poolQuantity.amountMinor), poolQuantity.decimals);
    addExactQuantityDigits(physicalTotal, BigInt(physicalPoolQuantity.amountMinor), physicalPoolQuantity.decimals);
    addExactQuantityDigits(deficitTotal, BigInt(deficitPoolQuantity.amountMinor), deficitPoolQuantity.decimals);
    members.push({
      member,
      itemId: item.itemId,
      memberQuantity,
      physicalMemberQuantity,
      deficitMemberQuantity,
      poolQuantity,
      physicalPoolQuantity,
      deficitPoolQuantity,
      positions,
    });
  }
  members.sort(
    /** Keep the public member breakdown in exact item-revision identity order. */
    (left, right) =>
      compareInventoryIdentityText(
        left.member.itemRevisionId,
        right.member.itemRevisionId
      )
  );
  return {
    definition,
    scope: normalizedScope,
    total: storeFungibilityTotal(total, definition.basisUnit),
    physicalTotal: storeFungibilityTotal(physicalTotal, definition.basisUnit),
    deficitTotal: storeFungibilityTotal(deficitTotal, definition.basisUnit),
    members,
  };
}

/** Store a completed pool or member total at its exact representable scale. */
function storeFungibilityTotal({ minor, decimals }: ExactQuantityDigits, unit: Quantity["unit"]): Quantity {
  const stored = storableQuantityDigits(minor, decimals);
  if (stored === undefined) throw new Error("Fungibility total exceeds the safe integer storage range.");
  return quantity({ ...stored, unit });
}

/** Exact selected member line produced by common-basis allocation. */
export interface InventoryFungibilityAllocationLine {
  /** Exact member item revision whose physical stock was selected. */
  readonly itemRevisionId: ItemRevisionId;
  /** Exact physical source position retained in the eventual stock event. */
  readonly position: InventoryStockPositionKey;
  /** Normal public member amount accepted by issue/transfer/scrap commands. */
  readonly amount: InventoryAmount;
  /** Exact selected amount on the member measurement axis. */
  readonly memberQuantity: Quantity;
  /** Exact common-basis contribution of this selected line. */
  readonly poolQuantity: Quantity;
  /** Time this exact position entered its current uninterrupted positive layer. */
  readonly layerStartedAtEpochMs: number;
  /** Effective lot/placement-ancestry use-by used by FEFO when known. */
  readonly expiresAtEpochMs?: number;
}

/** Exact deterministic allocation of one common-basis pool request. */
export interface InventoryFungibilityAllocationPlan {
  /** Exact immutable pool revision used for all conversions. */
  readonly definition: InventoryFungibilityPoolDefinitionRevision;
  /** Common position dimensions applied independently to every member. */
  readonly scope: InventoryFungibilityScope;
  /** Exact requested common-basis quantity. */
  readonly requested: Quantity;
  /** Exact selected member lines in FIFO/FEFO order. */
  readonly lines: readonly InventoryFungibilityAllocationLine[];
  /** Exact common-basis quantity not fulfilled. */
  readonly shortfall: Quantity;
  /** True when otherwise-positive expired member stock was excluded. */
  readonly expiredStockWasExcluded: boolean;
  /** True when exact pool reference or physical stock increments limited the allocation. */
  readonly incrementBlockedStock: boolean;
  /** True when an exact member assignment existed but current claims rejected it. */
  readonly allocationConstraintBlockedStock: boolean;
  /** True when broad member-item claims remain protected only by final feasibility checking. */
  readonly unallocatedReservationsPresent: boolean;
}

/** Inputs for previewing or durably planning one cross-item pool allocation. */
export interface PlanInventoryFungibilityAllocationInput {
  /** Frozen catalogue containing exact pool/member/package definitions. */
  readonly catalog: InventoryCatalog;
  /** Fully published world used for physical stock and active claims. */
  readonly world: InventoryWorldState;
  /** Exact pool revision; an active pointer must be resolved before the operation starts. */
  readonly fungibilityRevisionId: InventoryFungibilityRevisionId;
  /** Exact requested quantity in the pool basis unit. */
  readonly requested: Quantity;
  /** FIFO or FEFO ordering applied globally across member positions. */
  readonly method: InventoryAllocationMethod;
  /** Physical authority time for lot/placement-ancestry use-by checks. */
  readonly atEpochMs: number;
  /** Claim-book authority time; defaults to `at` for pure previews. */
  readonly reservationAtEpochMs?: number;
  /** How selected stock should affect claim feasibility; defaults to depletion. */
  readonly reservationEffect?: InventoryFungibilityReservationEffect;
  /** Optional common stock dimensions such as one source direct placement. */
  readonly scope?: InventoryFungibilityScope;
  /** Explicit override permitting expired member stock. */
  readonly allowExpiredLots?: boolean;
  /** Physical-truth override allowing exact allocated rows to remain candidates. */
  readonly allowAllocatedStock?: boolean;
}

/** Private evidence tying one pool candidate back to its member and exact stock line. */
interface InventoryFungibilityCandidateEvidence {
  /** Exact pool member conversion. */
  readonly member: InventoryFungibilityMemberDefinition;
  /** Exact item revision behind this member. */
  readonly item: InventoryItemDefinitionRevision;
  /** Current exact physical position. */
  readonly position: InventoryStockPosition;
  /** Single-item policy evidence used for ordering and use-by. */
  readonly source: InventoryWorkingAllocationCandidate;
}

/** Plan cross-item FIFO/FEFO allocation while every selected line retains real item identity. */
export function planInventoryFungibilityAllocation(
  input: PlanInventoryFungibilityAllocationInput
): InventoryFungibilityAllocationPlan {
  return planInventoryFungibilityAllocationWithHolds(input, false);
}

/** Prefer a pick that preserves claim capacity before falling back to physical stock. */
export function planInventoryFungibilityRecordingAllocation(
  input: PlanInventoryFungibilityAllocationInput
): InventoryFungibilityAllocationPlan {
  if (input.allowAllocatedStock) return planInventoryFungibilityAllocationWithHolds(input, true);
  try {
    const preferred = planInventoryFungibilityAllocationWithHolds(input, true);
    if (preferred.shortfall.amountMinor === 0) return preferred;
  } catch (error) {
    // Either advisory search can run out of budget before it finds a claim-preserving pick.
    if (!(error instanceof InventoryReservationFeasibilityLimitError) &&
        !(error instanceof InventoryExactAllocationLimitError)) throw error;
  }
  return planInventoryFungibilityAllocationWithHolds({ ...input, allowAllocatedStock: true }, true);
}

/** Plan against the same exact members while applying the recording-specific hold preference. */
function planInventoryFungibilityAllocationWithHolds({
  catalog,
  world,
  fungibilityRevisionId,
  requested,
  method,
  atEpochMs,
  reservationAtEpochMs = atEpochMs,
  reservationEffect = {
    kind: InventoryFungibilityReservationEffectKind.Deplete,
  },
  scope = {},
  allowExpiredLots = false,
  allowAllocatedStock = false,
}: PlanInventoryFungibilityAllocationInput, recording: boolean): InventoryFungibilityAllocationPlan {
  assertInventoryEpochMilliseconds(atEpochMs, "fungibility allocation authority time");
  assertInventoryEpochMilliseconds(
    reservationAtEpochMs,
    "fungibility allocation reservation authority time"
  );
  validateFungibilityReservationEffect(reservationEffect);
  const definition = catalog.fungibilityRevision(fungibilityRevisionId);
  const normalizedScope = normalizeInventoryFungibilityScope(scope);
  positiveQuantity(requested, "Fungibility allocation request");
  if (requested.unit !== definition.basisUnit) {
    throw new Error(
      `Fungibility allocation request must use basis unit '${definition.basisUnit}'.`
    );
  }
  // Common-basis candidates retained across all member planning passes.
  const candidates: InventoryWorkingAllocationCandidate[] = [];
  // Per-position member evidence retained to map allocator output back to source identity.
  const evidenceByPosition = new Map<
    string,
    InventoryFungibilityCandidateEvidence
  >();
  // Remember whether any member excluded otherwise-positive expired stock.
  let expiredStockWasExcluded = false;
  // Remember whether any member was blocked by intact package or serial increments.
  let incrementBlockedStock = false;
  /** Member stock left over after enforcing the combined pool and physical increments. */
  let discardedIncrementCapacity = false;
  /** Reuse the scoped member capacity only if a shortfall needs an increment diagnosis. */
  const memberStock: FungibilityMemberStock[] = [];
  // Remember whether any active member reservation remained broad rather than position-bound.
  let unallocatedReservationsPresent = false;
  /** A selected member may require explicit lines if unheld stock cannot fill the request. */
  let selectedIndependentHold = false;
  /** One timed snapshot indexed by member revision for preparation and feasibility. */
  const claimsByRevision = new Map<string, InventoryReservation[]>();
  /** Defer claim reconstruction until a member actually needs preparation. */
  let indexedClaims = false;

  for (const member of definition.members) {
    const item = catalog.itemRevision(member.itemRevisionId);
    if (member.measurementAxisId !== item.primaryAxis.axisId) {
      throw new Error(
        `Automatic fungibility allocation requires member '${member.itemRevisionId}' to use its primary axis; select exact measured lines for independent-axis fungibility.`
      );
    }
    const selector = selectorForFungibilityMember(item, normalizedScope);
    const selection = { item, selector };
    const positions = inventoryStockPoolRowsFromProjection(
      world.projection, inventoryAllocationPoolSelector(selection)
    );
    if (!recording) {
      // The signed pool already applies subtree selection. Check the remaining scope before reading member holds.
      const { withinPlacementNodeIds: _withinPlacementNodeIds, ...directSelector } = selector;
      if (!positions.some(
        /** Only matching positive physical stock can contribute preview picks. */
        ({ position }) => position.key.transferId === undefined && position.key.placementNodeId !== undefined &&
          position.measurements.primary.quantity.amountMinor > 0 &&
          inventoryStockPositionMatchesNormalizedSelector(position.key, directSelector)
      )) continue;
    }
    if (!indexedClaims) {
      indexedClaims = true;
      const memberRevisionIds = new Set<string>();
      for (const poolMember of definition.members) memberRevisionIds.add(poolMember.itemRevisionId);
      for (const reservation of inventoryReservationsAt(world.reservations, reservationAtEpochMs)) {
        if (!memberRevisionIds.has(reservation.itemRevisionId)) continue;
        const claims = claimsByRevision.get(reservation.itemRevisionId);
        if (claims === undefined) claimsByRevision.set(reservation.itemRevisionId, [reservation]);
        else claims.push(reservation);
      }
    }
    const { candidateResult, deficitAdjusted } = prepareInventoryPolicyAllocationPool({
      catalog,
      selection,
      pool: { positions, reservations: claimsByRevision.get(member.itemRevisionId) ?? [] },
      method,
      atEpochMs,
      reservationAtEpochMs,
      allowExpiredLots,
      allowAllocatedStock,
    });
    expiredStockWasExcluded =
      expiredStockWasExcluded || deficitAdjusted.expiredStockWasExcluded;
    unallocatedReservationsPresent =
      unallocatedReservationsPresent ||
      candidateResult.unallocatedReservationsPresent;
    selectedIndependentHold ||= candidateResult.selectedIndependentHold;
    memberStock.push({ member, candidates: deficitAdjusted.candidates });
    // Convert each eligible row separately. The sum is needed only by the common-basis allocator.
    for (const source of deficitAdjusted.candidates) {
      const identity = inventoryStockPositionIdentity(source.position);
      const position = world.projection.positions[identity];
      if (position === undefined) {
        throw new Error(
          "Fungibility member candidate disappeared from the reviewed world."
        );
      }
      // Record evidence even when capacity rounds down to zero so increment diagnostics can check claim feasibility.
      evidenceByPosition.set(identity, { member, item, position, source });
      const capacity = inventoryAllocationCandidateCapacity(source);
      incrementBlockedStock ||= capacity.incrementBlockedStock;
      if (capacity.quantity.amountMinor === 0) continue;
      const discardedCapacity = addFungibilityCandidate({
        catalog,
        position,
        member,
        item,
        source,
        memberAvailable: capacity.quantity,
        candidates,
      });
      discardedIncrementCapacity ||= discardedCapacity;
    }
  }

  /** Cache claim shortage baselines by the revision sets tried during allocation. */
  const earlierShortagesByRevisionSet = new Map<string, ReadonlyMap<string, Quantity>>();
  /** Find shortages in the same revision scope, claim book, and authority time as the trial. */
  const readEarlierShortages = (
    itemRevisionIds: ReadonlySet<string>,
    book: InventoryReservationBook
  ): ReadonlyMap<string, Quantity> => {
    const revisionSetKey = JSON.stringify([...itemRevisionIds].sort());
    const cached = earlierShortagesByRevisionSet.get(revisionSetKey);
    if (cached !== undefined) return cached;
    const earlierShortages = new Map<string, Quantity>();
    const before = inspectInventoryReservationFeasibility({
      catalog, projection: world.projection, book, atEpochMs: reservationAtEpochMs,
    });
    for (const group of before.groups) {
      const first = group.reservationIds[0];
      if (first !== undefined) earlierShortages.set(first, group.shortage);
    }
    earlierShortagesByRevisionSet.set(revisionSetKey, earlierShortages);
    return earlierShortages;
  };
  /** Track claims only when this plan needs to preserve their current capacity. */
  const preservesClaims = !allowAllocatedStock && claimsByRevision.size > 0;
  /** A transfer also needs to materialize its destination balance. */
  const simulatesDestination = reservationEffect.kind === InventoryFungibilityReservationEffectKind.Transfer;
  /** Test a trial before publication, rejecting only expected exact storage-range failures. */
  const createAcceptAllocations = (allowMeasuredSplitForAdvisory: boolean) =>
    /** Keep legal source and destination balances and, when requested, existing claim capacity. */
    (allocations: readonly InventoryAllocation[]): boolean => {
      try {
        return preservesClaims || simulatesDestination
          ? fungibilityAllocationFitsProjection({
              catalog, world, reservationAtEpochMs, reservationEffect, allocations,
              evidenceByPosition, claimsByRevision, readEarlierShortages, preservesClaims,
              allowMeasuredSplitForAdvisory,
            })
          : fungibilityIssueBalancesAreStorable({ catalog, allocations, evidenceByPosition });
      } catch (error) {
        if (error instanceof InventoryQuantityRepresentationError) return false;
        throw error;
      }
    };
  const acceptAllocations = createAcceptAllocations(false);
  /** Only broad claims need a simulated advisory split when testing physical increments. */
  const acceptAdvisoryAllocations = preservesClaims
    ? createAcceptAllocations(true)
    : acceptAllocations;
  const allocated = allocateWorkingInventory({
    requested,
    candidates,
    method,
    nowEpochMs: atEpochMs,
    allowExpired: true,
    diagnosePhysicalShortfall: true,
    acceptAllocations,
  });
  if (!recording) assertInventoryPolicyCanPickAroundIndependentHold(selectedIndependentHold, allocated.shortfall);
  const lines: InventoryFungibilityAllocationLine[] = [];
  for (const allocation of allocated.allocations) {
    const identity = inventoryStockPositionIdentity(allocation.position);
    const evidence = evidenceByPosition.get(identity);
    if (evidence === undefined) {
      throw new Error(
        "Fungibility allocation result references a missing member candidate."
      );
    }
    const memberQuantity = convertQuantityByReferenceExact(
      allocation.quantity,
      evidence.member.poolQuantity,
      evidence.member.memberQuantity
    );
    lines.push({
      itemRevisionId: evidence.item.revisionId,
      position: allocation.position,
      amount: inventoryAmountForPrimaryAllocation({
        catalog,
        itemRevisionId: evidence.item.revisionId,
        position: evidence.position,
        allocatedPrimary: memberQuantity,
      }),
      memberQuantity,
      poolQuantity: allocation.quantity,
      layerStartedAtEpochMs: evidence.source.receivedAtEpochMs,
      ...(evidence.source.expiresAtEpochMs === undefined
        ? {}
        : { expiresAtEpochMs: evidence.source.expiresAtEpochMs }),
    });
  }
  const completedDiagnostic = {
    requested, method, atEpochMs, memberStock, candidates,
    allocations: allocated.allocations, acceptAllocations,
    unallocatedReservationsPresent,
  };
  const incrementBlockage = allocated.shortfall.amountMinor === 0
    ? allocated.incrementBlockedStock ||
      (discardedIncrementCapacity && discardedCapacityImprovesFungibilityPlan(completedDiagnostic)) ||
      (incrementBlockedStock && discardedCapacityImprovesFungibilityPlan({
        ...completedDiagnostic,
        acceptAllocations: acceptAdvisoryAllocations,
        checkPhysicalIncrements: true,
      }))
    : (incrementBlockedStock || allocated.incrementBlockedStock || discardedIncrementCapacity) &&
      !allocated.allocationConstraintBlockedStock &&
      fungibilityRawCapacityCoversRequest(requested, memberStock);
  return {
    definition,
    scope: normalizedScope,
    requested,
    lines,
    shortfall: allocated.shortfall,
    expiredStockWasExcluded,
    incrementBlockedStock: incrementBlockage,
    allocationConstraintBlockedStock:
      allocated.allocationConstraintBlockedStock,
    unallocatedReservationsPresent,
  };
}

/** One member and its eligible physical capacity before applying indivisible increments. */
interface FungibilityMemberStock {
  /** Frozen reference quantities for converting this member to the pool basis. */
  readonly member: InventoryFungibilityMemberDefinition;
  /** Scoped capacities after applying holds, expiry and signed deficits. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
}

/** Inputs for testing discarded reference capacity without changing an accepted plan. */
interface FungibilityIncrementDiagnosticInput {
  /** Exact pool quantity needed by the completed plan. */
  readonly requested: Quantity;
  /** Original stock selection policy. */
  readonly method: InventoryAllocationMethod;
  /** Original lot eligibility time. */
  readonly atEpochMs: number;
  /** Eligible native quantities before dropping below-reference capacity. */
  readonly memberStock: readonly FungibilityMemberStock[];
  /** The original legal pool candidates. */
  readonly candidates: readonly InventoryWorkingAllocationCandidate[];
  /** The accepted complete allocation. */
  readonly allocations: readonly InventoryAllocation[];
  /** The original claim-preservation condition. */
  readonly acceptAllocations: (allocations: readonly InventoryAllocation[]) => boolean;
  /** Whether any unallocated broad claim requires running the full claim predicate during diagnostic trials. */
  readonly unallocatedReservationsPresent: boolean;
  /** Whether to also test relaxing row-local indivisible remainders when earlier rows were blocked. */
  readonly checkPhysicalIncrements?: boolean;
}

/** Prove that a discarded fraction admits an earlier complete plan in policy order. */
function discardedCapacityImprovesFungibilityPlan({
  requested, method, atEpochMs, memberStock, candidates, allocations, acceptAllocations,
  unallocatedReservationsPresent, checkPhysicalIncrements = false,
}: FungibilityIncrementDiagnosticInput): boolean {
  const last = allocations.at(-1);
  if (last === undefined) return false;
  /** Candidate capacity after relaxing the selected increment, keyed by exact position reference. */
  const rawByPosition = new Map<InventoryStockPositionKey, InventoryWorkingAllocationCandidate>();
  for (const candidate of candidates) rawByPosition.set(candidate.position, candidate);
  const lastCandidate = rawByPosition.get(last.position);
  if (lastCandidate === undefined) return false;
  /** Whether earlier relaxed capacity could improve on the last accepted pick. */
  let earlierCapacityIncreased = false;
  for (const { member, candidates: sources } of memberStock) {
    for (const source of sources) {
      const raw = representableFungibilityDiagnosticCandidate(source, member, checkPhysicalIncrements);
      if (raw === undefined) continue;
      const legal = rawByPosition.get(source.position);
      rawByPosition.set(source.position, raw);
      if (compareWorkingAllocationCandidates(raw, lastCandidate, method) <= 0 &&
          (legal === undefined || compareWorkingQuantities(raw.available, legal.available) > 0)) earlierCapacityIncreased = true;
    }
  }
  if (!earlierCapacityIncreased) return false;
  // Relaxed physical trials without broad claims only test the earlier raw capacity.
  const diagnosticAccept = checkPhysicalIncrements && !unallocatedReservationsPresent
    ? undefined
    : acceptAllocations;
  const diagnostic: Parameters<typeof allocateWorkingInventory>[0] = {
    requested, candidates: [...rawByPosition.values()], method, nowEpochMs: atEpochMs, allowExpired: true, assessIncrementBlockage: false,
    ...(diagnosticAccept === undefined ? {} : { acceptAllocations: diagnosticAccept }),
  };
  try {
    const alternate = allocateWorkingInventory(diagnostic);
    if (alternate.shortfall.amountMinor !== 0) return false;
    // Both complete plans are in policy order. The first differing pick determines their order.
    for (let index = 0; index < allocations.length; index += 1) {
      const actual = allocations[index];
      const proposed = alternate.allocations[index];
      if (actual === undefined || proposed === undefined) return false;
      if (actual.position !== proposed.position) {
        const actualCandidate = rawByPosition.get(actual.position);
        const proposedCandidate = rawByPosition.get(proposed.position);
        return actualCandidate !== undefined && proposedCandidate !== undefined &&
          compareWorkingAllocationCandidates(proposedCandidate, actualCandidate, method) < 0;
      }
      const comparison = compareQuantity(proposed.quantity, actual.quantity);
      if (comparison !== 0) return comparison > 0;
    }
    return false;
  } catch (error) {
    // An unproven advisory flag cannot invalidate the accepted physical plan.
    if (error instanceof InventoryExactAllocationLimitError || error instanceof InventoryReservationFeasibilityLimitError) return false;
    throw error;
  }
}

/** Enumerate exactly convertible picks with or without enforcing physical indivisible row increments. */
function representableFungibilityDiagnosticCandidate(
  source: InventoryWorkingAllocationCandidate,
  { memberQuantity, poolQuantity }: InventoryFungibilityMemberDefinition,
  relaxPhysicalIncrements: boolean
): InventoryWorkingAllocationCandidate | undefined {
  const decimals = Math.max(MAXIMUM_QUANTITY_DECIMALS, source.allocationIncrement?.decimals ?? 0);
  const memberReference = integerAtDecimals(memberQuantity, decimals);
  const poolReference = integerAtDecimals(poolQuantity, decimals);
  const divisor = quantityGreatestCommonDivisor(memberReference, poolReference);
  const memberStep = memberReference / divisor;
  const physicalStep = relaxPhysicalIncrements || source.allocationIncrement === undefined
    ? 1n : workingQuantityAtDecimals(source.allocationIncrement, decimals);
  // A native pick must be a multiple of the conversion grid (and its physical increment unless testing increment blockage).
  const nativeStep = (memberStep / quantityGreatestCommonDivisor(memberStep, physicalStep)) * physicalStep;
  const capacity = relaxPhysicalIncrements
    ? source.available
    : inventoryAllocationCandidateCapacity(source).quantity;
  const availableSteps = workingQuantityAtDecimals(capacity, decimals) / nativeStep;
  if (availableSteps === 0n) return undefined;
  const poolStep = (nativeStep / memberStep) * (poolReference / divisor);
  return {
    position: source.position,
    receivedAtEpochMs: source.receivedAtEpochMs,
    ...(source.expiresAtEpochMs === undefined ? {} : { expiresAtEpochMs: source.expiresAtEpochMs }),
    // The maximum is a whole number of exact steps no greater than actual available stock.
    available: { unit: poolQuantity.unit, decimals, amountMinor: poolStep * availableSteps },
    allocationIncrement: { unit: poolQuantity.unit, decimals, amountMinor: poolStep },
  };
}

/** Check whether actual eligible capacity would cover the request if every row were divisible. */
function fungibilityRawCapacityCoversRequest(requested: Quantity, memberStock: readonly FungibilityMemberStock[]): boolean {
  /** Exact pool remainder. Member reference ratios need not terminate in decimal. */
  let remainingNumerator = BigInt(requested.amountMinor);
  let remainingDenominator = 10n ** BigInt(requested.decimals);
  for (const { member: { memberQuantity, poolQuantity }, candidates } of memberStock) {
    /** All eligible digits on this member's native measurement axis. */
    const available: ExactQuantityDigits = { minor: 0n, decimals: 0 };
    for (const { available: capacity } of candidates) {
      addExactQuantityDigits(available, BigInt(capacity.amountMinor), capacity.decimals);
    }
    if (available.minor === 0n) continue;
    const poolNumerator = available.minor * BigInt(poolQuantity.amountMinor) * 10n ** BigInt(memberQuantity.decimals);
    const poolDenominator = BigInt(memberQuantity.amountMinor) * 10n ** BigInt(available.decimals + poolQuantity.decimals);
    remainingNumerator = remainingNumerator * poolDenominator - poolNumerator * remainingDenominator;
    if (remainingNumerator <= 0n) return true;
    remainingDenominator *= poolDenominator;
    const divisor = quantityGreatestCommonDivisor(remainingNumerator, remainingDenominator);
    remainingNumerator /= divisor;
    remainingDenominator /= divisor;
  }
  return false;
}

/** Validate deplete/transfer claim effects before any exact search begins. */
function validateFungibilityReservationEffect(
  effect: InventoryFungibilityReservationEffect
): void {
  if (effect.kind === InventoryFungibilityReservationEffectKind.Deplete) {
    if (effect.toPlacementNodeId !== undefined) {
      throw new Error(
        "Depleting fungibility allocation cannot name a destination."
      );
    }
    return;
  }
  if (
    effect.toPlacementNodeId === undefined ||
    effect.toPlacementNodeId.trim().length === 0
  ) {
    throw new Error(
      "Transfer fungibility allocation needs a destination placement node."
    );
  }
}

/** Inputs for simulating one exact pool allocation against stock and active claims. */
interface FungibilityProjectionTrialInput {
  /** Frozen retained catalogue used by amount resolution and feasibility checks. */
  readonly catalog: InventoryCatalog;
  /** Current published world before the hypothetical pool issue/transfer. */
  readonly world: InventoryWorldState;
  /** Claim-book authority time used for reservation lifecycle rules. */
  readonly reservationAtEpochMs: number;
  /** How selected stock changes physical claim capacity. */
  readonly reservationEffect: InventoryFungibilityReservationEffect;
  /** Complete candidate allocation being considered by the exact allocator. */
  readonly allocations: readonly InventoryAllocation[];
  /** Evidence tying each common-basis candidate to its real member position. */
  readonly evidenceByPosition: ReadonlyMap<
    string,
    InventoryFungibilityCandidateEvidence
  >;
  /** Claim rows indexed by exact member revision at the trial's reservation authority time. */
  readonly claimsByRevision: ReadonlyMap<string, readonly InventoryReservation[]>;
  /** Baseline at the same authority time and within the same changed revisions. */
  readonly readEarlierShortages: (
    itemRevisionIds: ReadonlySet<string>,
    book: InventoryReservationBook
  ) => ReadonlyMap<string, Quantity>;
  /** Whether to check claim capacity after the physical movement is found to be storable. */
  readonly preservesClaims: boolean;
  /** Whether advisory increment counterfactuals may deduct primary quantity on unfixed measured splits when claims remain unaffected. */
  readonly allowMeasuredSplitForAdvisory?: boolean;
}

/** Check exact source and destination balances before comparing any existing claim shortage. */
function fungibilityAllocationFitsProjection({
  catalog,
  world,
  reservationAtEpochMs,
  reservationEffect,
  allocations,
  evidenceByPosition,
  claimsByRevision,
  readEarlierShortages,
  preservesClaims,
  allowMeasuredSplitForAdvisory = false,
}: FungibilityProjectionTrialInput): boolean {
  const positions = createFungibilitySparseRecordOverlay(
    world.projection.positions
  );
  const positionIdsByItemId = createFungibilitySparseRecordOverlay(
    world.projection.positionIdsByItemId
  );
  const positionIdsByItemRevisionId = createFungibilitySparseRecordOverlay(
    world.projection.positionIdsByItemRevisionId
  );
  const positionIdsByPlacementNodeId = createFungibilitySparseRecordOverlay(
    world.projection.positionIdsByPlacementNodeId
  );
  /** Only these revisions can gain or lose capacity in this allocation trial. */
  const changedItemRevisionIds = new Set<string>();
  for (const allocation of allocations) {
    const identity = inventoryStockPositionIdentity(allocation.position);
    const evidence = evidenceByPosition.get(identity);
    if (evidence === undefined) {
      throw new Error(
        "Fungibility reservation check references a missing candidate evidence row."
      );
    }
    const current = positions[identity];
    if (current === undefined) return false;
    changedItemRevisionIds.add(current.key.itemRevisionId);
    const memberQuantity = convertQuantityByReferenceExact(
      allocation.quantity,
      evidence.member.poolQuantity,
      evidence.member.memberQuantity
    );
    const destinationKey = transferDestinationPositionKey(
      current.key,
      reservationEffect
    );
    const movedMeasurements = resolveFungibilityReservationTrialMeasurements({
      catalog,
      item: evidence.item,
      position: evidence.position,
      positionKey: current.key,
      positionIdentity: identity,
      currentMeasurements: current.measurements,
      destinationKey,
      memberQuantity,
      claimsForRevision: claimsByRevision.get(current.key.itemRevisionId) ?? [],
      placement: world.projection.placement,
      allowMeasuredSplitForAdvisory,
    });
    if (movedMeasurements === undefined) return false;
    const nextMeasurements = subtractInventoryMeasurements(
      current.measurements,
      movedMeasurements
    );
    if (inventoryMeasurementsAreZero(nextMeasurements)) {
      delete positions[identity];
      removeFungibilitySimulationIndex(
        positionIdsByItemId,
        current.key.itemId,
        identity
      );
      removeFungibilitySimulationIndex(
        positionIdsByItemRevisionId,
        current.key.itemRevisionId,
        identity
      );
      if (current.key.placementNodeId !== undefined) {
        removeFungibilitySimulationIndex(
          positionIdsByPlacementNodeId,
          current.key.placementNodeId,
          identity
        );
      }
    } else {
      positions[identity] = {
        key: current.key,
        measurements: nextMeasurements,
      };
    }
    if (destinationKey !== undefined) {
      const destinationIdentity =
        inventoryStockPositionIdentity(destinationKey);
      const destination = positions[destinationIdentity];
      const destinationMeasurements =
        destination?.measurements ??
        zeroInventoryMeasurements(movedMeasurements);
      positions[destinationIdentity] = {
        key: destinationKey,
        measurements: addInventoryMeasurements(
          destinationMeasurements,
          movedMeasurements
        ),
      };
      if (destination === undefined) {
        const toPlacementNodeId = destinationKey.placementNodeId;
        addFungibilitySimulationIndex(
          positionIdsByItemId,
          destinationKey.itemId,
          destinationIdentity
        );
        addFungibilitySimulationIndex(
          positionIdsByItemRevisionId,
          destinationKey.itemRevisionId,
          destinationIdentity
        );
        if (toPlacementNodeId !== undefined) {
          addFungibilitySimulationIndex(
            positionIdsByPlacementNodeId,
            toPlacementNodeId,
            destinationIdentity
          );
        }
      }
    }
  }
  if (!preservesClaims) return true;
  const projection: InventoryProjectionState = {
    ...world.projection,
    positions,
    positionIdsByItemId,
    positionIdsByItemRevisionId,
    positionIdsByPlacementNodeId,
  };
  /** Use the same resolved claim rows before and after, restricted to the stock revisions that moved. */
  const reservations = createInventorySparseRecord<InventoryReservation>();
  for (const revisionId of changedItemRevisionIds) {
    for (const reservation of claimsByRevision.get(revisionId) ?? []) {
      setInventorySparseRecordValue(reservations, reservation.reservationId, reservation);
    }
  }
  const book: InventoryReservationBook = {
    reservations,
    /** The rows already reflect their lifecycle history at the comparison time. */
    operations: createInventorySparseRecord(),
  };
  const after = inspectInventoryReservationFeasibility({
    catalog, projection, book, atEpochMs: reservationAtEpochMs,
  });
  if (after.status === InventoryReservationFeasibilityStatus.Feasible) return true;
  const before = readEarlierShortages(changedItemRevisionIds, book);
  // Group membership is unchanged because the claim book and time stay fixed.
  for (const group of after.groups) {
    if (group.shortage.amountMinor === 0) continue;
    const first = group.reservationIds[0];
    const earlier = first === undefined ? undefined : before.get(first);
    if (earlier === undefined || compareQuantity(group.shortage, earlier) > 0) return false;
  }
  return true;
}

/** Inputs for resolving exact or advisory-split measurements moved in a trial pick. */
interface FungibilityReservationTrialMeasurementInput {
  /** Catalogue used to validate legal partial allocations. */
  readonly catalog: InventoryCatalog;
  /** Exact item revision definition for the moved row. */
  readonly item: InventoryItemDefinitionRevision;
  /** Physical source row from the initial planning snapshot. */
  readonly position: InventoryStockPosition;
  /** Normalized key of the source row being updated. */
  readonly positionKey: InventoryStockPositionKey;
  /** Normalized identity string of the source row being updated. */
  readonly positionIdentity: string;
  /** Current simulated measurements remaining on the source row. */
  readonly currentMeasurements: InventoryMeasurementVector;
  /** Optional normalized destination key for Transfer simulations. */
  readonly destinationKey: InventoryStockPositionKey | undefined;
  /** Member primary quantity being moved in this trial allocation line. */
  readonly memberQuantity: Quantity;
  /** Active claims indexed to the moved position's exact item revision. */
  readonly claimsForRevision: readonly InventoryReservation[];
  /** Placement graph used when matching subtree-scoped claim selectors. */
  readonly placement: InventoryPlacementState;
  /** Whether advisory increment counterfactuals may deduct primary quantity on unfixed measured splits when safe. */
  readonly allowMeasuredSplitForAdvisory: boolean;
}

/** Inputs for checking the physical balance of a claim-free issue. */
interface FungibilityIssueBalanceInput {
  /** Catalogue that resolves the selected item and package measurements. */
  readonly catalog: InventoryCatalog;
  /** Candidate pool allocations returned by working-stock picking. */
  readonly allocations: readonly InventoryAllocation[];
  /** Exact member and position evidence for each candidate. */
  readonly evidenceByPosition: ReadonlyMap<string, InventoryFungibilityCandidateEvidence>;
}

/** Check exact movement and remaining source balances without simulating a claim book. */
function fungibilityIssueBalancesAreStorable({
  catalog,
  allocations,
  evidenceByPosition,
}: FungibilityIssueBalanceInput): boolean {
  for (const allocation of allocations) {
    const evidence = evidenceByPosition.get(inventoryStockPositionIdentity(allocation.position));
    if (evidence === undefined) {
      throw new Error("Fungibility issue trial references a missing candidate evidence row.");
    }
    const memberQuantity = convertQuantityByReferenceExact(
      allocation.quantity,
      evidence.member.poolQuantity,
      evidence.member.memberQuantity
    );
    if (evidence.position.key.packagingRevisionId === undefined && evidence.item.independentAxes.length === 0) {
      const onHand = evidence.position.measurements.primary.quantity;
      if (!inventoryQuantityChangeFitsStorage(onHand, memberQuantity, -1)) return false;
      continue;
    }
    const moved = resolveFungibilityMovementMeasurements(catalog, evidence.item, evidence.position, memberQuantity);
    if (!inventoryMeasurementChangeFitsStorage(evidence.position.measurements, moved, -1)) return false;
  }
  return true;
}

/** Resolve the same exact stock amount that the completed fungibility plan will record. */
function resolveFungibilityMovementMeasurements(
  catalog: InventoryCatalog,
  item: InventoryItemDefinitionRevision,
  position: InventoryStockPosition,
  memberQuantity: Quantity
): InventoryMeasurementVector {
  const amount = inventoryAmountForPrimaryAllocation({
    catalog,
    itemRevisionId: item.revisionId,
    position,
    allocatedPrimary: memberQuantity,
  });
  return resolveInventoryAmount(catalog, item, amount).measurements;
}

/** Relax only the identified physical increment when testing an advisory counterfactual. */
function resolveFungibilityReservationTrialMeasurements({
  catalog,
  item,
  position,
  positionKey,
  positionIdentity,
  currentMeasurements,
  destinationKey,
  memberQuantity,
  claimsForRevision,
  placement,
  allowMeasuredSplitForAdvisory,
}: FungibilityReservationTrialMeasurementInput): InventoryMeasurementVector | undefined {
  if (allowMeasuredSplitForAdvisory &&
      compareWorkingQuantities(memberQuantity, currentMeasurements.primary.quantity) < 0) {
    const packaging = position.key.packagingRevisionId === undefined
      ? undefined
      : catalog.packagingRevision(position.key.packagingRevisionId);
    const splitsPackage = packaging !== undefined && !quantityIsWholeMultipleOf(
      memberQuantity, packaging.fixedContents.primary.quantity
    );
    if (splitsPackage || hasUnfixedIndependentMeasuredContents(position, item, packaging)) {
      // An unfixed-axis claim needs exact split measurements even during an advisory trial.
      if (
        item.reservationAxisId !== item.primaryAxis.axisId &&
        fungibilityClaimsTouchPosition(
          claimsForRevision, positionKey, positionIdentity, destinationKey, placement
        )
      ) {
        return undefined;
      }
      return scalarInventoryMeasurements(item.primaryAxis.axisId, memberQuantity);
    }
  }
  return resolveFungibilityMovementMeasurements(catalog, item, position, memberQuantity);
}

/** Return whether any active claim matches the moved position or destination directly or by selector. */
function fungibilityClaimsTouchPosition(
  claims: readonly InventoryReservation[],
  positionKey: InventoryStockPositionKey,
  positionIdentity: string,
  destinationKey: InventoryStockPositionKey | undefined,
  placement: InventoryPlacementState
): boolean {
  const destinationIdentity = destinationKey === undefined
    ? undefined
    : inventoryStockPositionIdentity(destinationKey);
  for (const reservation of claims) {
    if (
      inventoryStockPositionMatchesNormalizedSelector(
        positionKey,
        reservation.selector,
        placement
      ) ||
      (destinationKey !== undefined &&
        inventoryStockPositionMatchesNormalizedSelector(
          destinationKey,
          reservation.selector,
          placement
        ))
    ) {
      return true;
    }
    for (const allocation of reservation.allocations) {
      const allocatedIdentity = inventoryStockPositionIdentity(
        allocation.position
      );
      if (
        allocatedIdentity === positionIdentity ||
        allocatedIdentity === destinationIdentity
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Return the placed destination key for a Transfer claim effect, or undefined for depletion effects. */
function transferDestinationPositionKey(
  sourceKey: InventoryStockPositionKey,
  reservationEffect: InventoryFungibilityReservationEffect
): InventoryStockPositionKey | undefined {
  if (
    reservationEffect.kind !==
    InventoryFungibilityReservationEffectKind.Transfer
  ) {
    return undefined;
  }
  const toPlacementNodeId = reservationEffect.toPlacementNodeId;
  if (toPlacementNodeId === undefined) {
    throw new Error(
      "Fungibility transfer reservation effect lost destination."
    );
  }
  const {
    whereaboutsId: _whereaboutsId,
    whereaboutsState: _whereaboutsState,
    lastPlacementNodeId: _lastPlacementNodeId,
    detachedAtEpochMs: _detachedAtEpochMs,
    missingAtEpochMs: _missingAtEpochMs,
    ...placedSource
  } = sourceKey;
  return normalizeInventoryStockPositionKey({
    ...placedSource,
    placementNodeId: toPlacementNodeId,
  });
}

/**
 * Create one tombstone-aware sparse what-if overlay. Reservation feasibility reads exact rows
 * through projection indexes, so hypothetical search choices need not clone unrelated records.
 */
function createFungibilitySparseRecordOverlay<T>(
  base: Readonly<Record<string, T>>
): Record<string, T> {
  const overrides = new Map<string, T | undefined>();
  return new Proxy(createInventorySparseRecord<T>(), {
    /** Read an overridden/tombstoned value or fall through to the immutable base record. */
    get(_target, property): T | undefined {
      if (typeof property !== "string") return undefined;
      return overrides.has(property)
        ? overrides.get(property)
        : inventorySparseRecordValue(base, property);
    },
    /** Expose virtual base/override rows as own properties to sparse-record helpers. */
    getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
      if (typeof property !== "string") return undefined;
      const value = overrides.has(property)
        ? overrides.get(property)
        : inventorySparseRecordValue(base, property);
      return value === undefined
        ? undefined
        : {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          };
    },
    /** Retain one safe data-property write made through the sparse-record setter. */
    defineProperty(_target, property, descriptor): boolean {
      if (typeof property !== "string" || !("value" in descriptor)) return false;
      overrides.set(property, descriptor.value as T);
      return true;
    },
    /** Retain only the changed what-if row. */
    set(_target, property, value): boolean {
      if (typeof property !== "string") return false;
      overrides.set(property, value as T);
      return true;
    },
    /** Tombstone one inherited row so direct indexed reads see it as absent. */
    deleteProperty(_target, property): boolean {
      if (typeof property !== "string") return false;
      overrides.set(property, undefined);
      return true;
    },
    /** Preserve exact indexed membership checks across base and overrides. */
    has(_target, property): boolean {
      if (typeof property !== "string") return false;
      return overrides.has(property)
        ? overrides.get(property) !== undefined
        : inventorySparseRecordHas(base, property);
    },
  });
}

/** Add one exact what-if position identity to a sorted sparse index overlay. */
function addFungibilitySimulationIndex(
  index: Record<string, readonly string[]>,
  groupId: string,
  positionId: string
): void {
  const current = inventorySparseRecordValue(index, groupId) ?? [];
  if (current.includes(positionId)) return;
  const next = [...current, positionId];
  next.sort();
  setInventorySparseRecordValue(index, groupId, next);
}

/** Remove one exact what-if position identity from a sparse index overlay. */
function removeFungibilitySimulationIndex(
  index: Record<string, readonly string[]>,
  groupId: string,
  positionId: string
): void {
  const current = inventorySparseRecordValue(index, groupId);
  if (current === undefined) return;
  const next = current.filter(
    /** Keep every other exact what-if position in the group. */
    (candidate) => candidate !== positionId
  );
  if (next.length === 0) delete index[groupId];
  else setInventorySparseRecordValue(index, groupId, next);
}

/** Inputs for registering one exact member candidate in common-basis units. */
interface AddFungibilityCandidateInput {
  /** Frozen catalogue containing package definitions. */
  readonly catalog: InventoryCatalog;
  /** Current published source position for package-increment inspection. */
  readonly position: InventoryStockPosition;
  /** Exact member conversion. */
  readonly member: InventoryFungibilityMemberDefinition;
  /** Exact member item revision. */
  readonly item: InventoryItemDefinitionRevision;
  /** Signed-pool candidate carrying ordering and use-by evidence. */
  readonly source: InventoryWorkingAllocationCandidate;
  /** Largest storable legal pick from this one member position. */
  readonly memberAvailable: Quantity;
  /** Mutable candidate array owned by the current planning call. */
  readonly candidates: InventoryWorkingAllocationCandidate[];
}

/** Register exact common-basis picks and report any capacity discarded by their increment. */
function addFungibilityCandidate({
  catalog,
  position,
  member,
  item,
  source,
  memberAvailable,
  candidates,
}: AddFungibilityCandidateInput): boolean {
  const memberIncrement = fungibilityMemberAllocationIncrement({
    catalog,
    position,
    member,
    item,
    memberAvailable,
  });
  // Compare wide digits first. An increment larger than the row never needs to be stored.
  const decimals = Math.max(memberAvailable.decimals, memberIncrement.decimals);
  const availableDigits = integerAtDecimals(memberAvailable, decimals);
  const incrementDigits = workingQuantityAtDecimals(memberIncrement, decimals);
  const increments = availableDigits / incrementDigits;
  // Even loose stock can leave a remainder below one pool reference.
  const discardedCapacity = availableDigits % incrementDigits !== 0n;
  if (increments === 0n) return discardedCapacity;
  const allocationIncrement = convertQuantityByReferenceExact(
    materializeInventoryWorkingQuantity(memberIncrement, "Fungibility member increment"), member.memberQuantity, member.poolQuantity,
  );
  // The reservation trial needs a real physical pick. Preserve this bound when it equals the member increment.
  const keepIncrementForAcceptance = source.allocationIncrement !== undefined &&
    compareWorkingQuantities(source.allocationIncrement, memberIncrement) === 0;
  const candidate: InventoryWorkingAllocationCandidate = {
    position: source.position,
    available: {
      ...allocationIncrement,
      amountMinor: BigInt(allocationIncrement.amountMinor) * increments,
    },
    receivedAtEpochMs: source.receivedAtEpochMs,
    ...(source.expiresAtEpochMs === undefined
      ? {}
      : { expiresAtEpochMs: source.expiresAtEpochMs }),
    allocationIncrement,
    ...(keepIncrementForAcceptance ? { keepIncrementForAcceptance: true } : {}),
  };
  candidates.push(candidate);
  return discardedCapacity;
}

/** Find the smallest member pick that preserves physical increments and converts to whole pool references. */
function fungibilityMemberAllocationIncrement(input: {
  /** Frozen catalogue containing the exact package revision. */
  readonly catalog: InventoryCatalog;
  /** Current exact physical position. */
  readonly position: InventoryStockPosition;
  /** Exact pool member conversion/reference quantum. */
  readonly member: InventoryFungibilityMemberDefinition;
  /** Exact member item revision. */
  readonly item: InventoryItemDefinitionRevision;
  /** Member-side capacity of this source position. */
  readonly memberAvailable: Quantity;
}): InventoryWorkingQuantity {
  if (
    input.position.key.serialId !== undefined ||
    positionHasUnfixedIndependentMeasuredContents(
      input.catalog,
      input.position,
      input.item
    )
  ) {
    return leastCommonWorkingQuantityMultiple(
      input.member.memberQuantity,
      input.memberAvailable
    );
  }
  const packagingRevisionId = input.position.key.packagingRevisionId;
  if (packagingRevisionId === undefined) {
    return input.member.memberQuantity;
  }
  const packaging = input.catalog.packagingRevision(packagingRevisionId);
  const onePackageMemberQuantity = inventoryMeasurementAt(
    packaging.fixedContents,
    input.member.measurementAxisId,
    input.member.memberQuantity.unit
  );
  return leastCommonWorkingQuantityMultiple(
    input.member.memberQuantity,
    onePackageMemberQuantity
  );
}

/** Return whether safe automatic allocation must preserve a measured axis not fixed by packaging. */
function positionHasUnfixedIndependentMeasuredContents(
  catalog: InventoryCatalog,
  position: InventoryStockPosition,
  item: InventoryItemDefinitionRevision
): boolean {
  const packagingRevisionId = position.key.packagingRevisionId;
  const packaging = packagingRevisionId === undefined
    ? undefined
    : catalog.packagingRevision(packagingRevisionId);
  return hasUnfixedIndependentMeasuredContents(position, item, packaging);
}

/** Build one exact member selector from common orthogonal dimensions. */
function selectorForFungibilityMember(
  item: InventoryItemDefinitionRevision,
  scope: InventoryFungibilityScope
): InventoryStockSelector {
  return normalizeInventoryStockSelector({
    ...scope,
    itemId: item.itemId,
    itemRevisionIds: [item.revisionId],
  });
}

/** Return matching exact positions in deterministic identity order. */
function selectedFungibilityPositions(
  projection: InventoryProjectionState,
  selector: InventoryStockSelector
): readonly InventoryStockPosition[] {
  return findInventoryPositions(projection, selector);
}
