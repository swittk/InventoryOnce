import { positionHasUnfixedIndependentMeasuredContents as hasUnfixedIndependentMeasuredContents } from "./stock-amount-rules.js";
import {
  allocateWorkingInventory,
  inventoryAllocationCandidateCapacity,
  InventoryAllocationMethod,
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
  subtractInventoryMeasurements,
  zeroInventoryMeasurements,
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
  inventoryAllocationPoolFromWorld,
  inventoryAmountForPrimaryAllocation,
  prepareInventoryPolicyAllocationPool,
} from "./picking.js";
import {
  findInventoryPositions,
  type InventoryProjectionState,
} from "./projection.js";
import {
  InventoryReservationFeasibilityStatus,
  inspectInventoryReservationFeasibility,
} from "./reservations.js";
import {
  compareQuantity,
  convertQuantityByReferenceExact,
  integerAtDecimals,
  positiveQuantity,
  quantity,
  type Quantity,
} from "./quantity.js";
import {
  addExactQuantityDigits,
  compareWorkingQuantities,
  leastCommonWorkingQuantityMultiple,
  materializeInventoryWorkingQuantity,
  storableQuantityDigits,
  workingQuantityAtDecimals,
  type ExactQuantityDigits,
  type InventoryWorkingQuantity,
} from "./quantity-storage.js";
import {
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
  /** True when intact package/serial increments blocked the requested split. */
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

/** Prefer rows without independent-axis holds before falling back to all physical stock. */
export function planInventoryFungibilityRecordingAllocation(
  input: PlanInventoryFungibilityAllocationInput
): InventoryFungibilityAllocationPlan {
  return planInventoryFungibilityAllocationWithHolds(input, true);
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
  /** Indivisible member stock left over after enforcing the combined pool increment. */
  let discardedIndivisibleCapacity = false;
  // Remember whether any active member reservation remained broad rather than position-bound.
  let unallocatedReservationsPresent = false;

  for (const member of definition.members) {
    const item = catalog.itemRevision(member.itemRevisionId);
    if (member.measurementAxisId !== item.primaryAxis.axisId) {
      throw new Error(
        `Automatic fungibility allocation requires member '${member.itemRevisionId}' to use its primary axis; select exact measured lines for independent-axis fungibility.`
      );
    }
    const selector = selectorForFungibilityMember(item, normalizedScope);
    const selection = { item, selector };
    const { candidateResult, deficitAdjusted } = prepareInventoryPolicyAllocationPool({
      catalog,
      selection,
      pool: inventoryAllocationPoolFromWorld(world, selection, reservationAtEpochMs),
      method,
      atEpochMs,
      reservationAtEpochMs,
      allowExpiredLots,
      allowAllocatedStock,
      ...(recording && !allowAllocatedStock ? { recordingAttempt: "prefer-unheld" } : {}),
    });
    expiredStockWasExcluded =
      expiredStockWasExcluded || deficitAdjusted.expiredStockWasExcluded;
    unallocatedReservationsPresent =
      unallocatedReservationsPresent ||
      candidateResult.unallocatedReservationsPresent;
    // Convert each eligible row separately. The sum is needed only by the common-basis allocator.
    for (const source of deficitAdjusted.candidates) {
      const capacity = inventoryAllocationCandidateCapacity(source);
      incrementBlockedStock ||= capacity.incrementBlockedStock;
      if (capacity.quantity.amountMinor === 0) continue;
      const discardedCapacity = addFungibilityCandidate({
        catalog,
        world,
        member,
        item,
        source,
        memberAvailable: capacity.quantity,
        candidates,
        evidenceByPosition,
      });
      discardedIndivisibleCapacity ||= discardedCapacity;
    }
  }

  /** Cache the baseline only if a physical recording trial leaves some claim short. */
  let earlierShortages: Map<string, Quantity> | undefined;
  /** Find each group's shortage under the same claim book and authority time. */
  const readEarlierShortages = (): ReadonlyMap<string, Quantity> => {
    if (earlierShortages !== undefined) return earlierShortages;
    earlierShortages = new Map();
    const before = inspectInventoryReservationFeasibility({
      catalog, projection: world.projection, book: world.reservations, atEpochMs: reservationAtEpochMs,
    });
    for (const group of before.groups) {
      const first = group.reservationIds[0];
      if (first !== undefined) earlierShortages.set(first, group.shortage);
    }
    return earlierShortages;
  };
  const allocated = allocateWorkingInventory({
    requested,
    candidates,
    method,
    nowEpochMs: atEpochMs,
    allowExpired: true,
    ...(allowAllocatedStock
      ? {}
      : {
          /** Prefer complete assignments that preserve claim capacity. */
          acceptAllocations: (
            allocations: readonly InventoryAllocation[]
          ): boolean =>
            fungibilityAllocationsPreserveReservations({
              catalog,
              world,
              reservationAtEpochMs,
              reservationEffect,
              allocations,
              evidenceByPosition,
              ...(recording ? { readEarlierShortages } : {}),
            }),
        }),
  });
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
  return {
    definition,
    scope: normalizedScope,
    requested,
    lines,
    shortfall: allocated.shortfall,
    expiredStockWasExcluded,
    incrementBlockedStock:
      incrementBlockedStock || allocated.incrementBlockedStock ||
      (discardedIndivisibleCapacity && allocated.shortfall.amountMinor > 0 && !allocated.allocationConstraintBlockedStock),
    allocationConstraintBlockedStock:
      allocated.allocationConstraintBlockedStock,
    unallocatedReservationsPresent,
  };
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

/** Inputs for checking one complete pool allocation against every active item claim. */
interface FungibilityReservationPreservationInput {
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
  /** Physical recording can retain a pre-existing shortage without increasing it. */
  readonly readEarlierShortages?: () => ReadonlyMap<string, Quantity>;
}

/** Check feasibility, allowing physical reports that preserve existing claim capacity. */
function fungibilityAllocationsPreserveReservations({
  catalog,
  world,
  reservationAtEpochMs,
  reservationEffect,
  allocations,
  evidenceByPosition,
  readEarlierShortages,
}: FungibilityReservationPreservationInput): boolean {
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
    const memberQuantity = convertQuantityByReferenceExact(
      allocation.quantity,
      evidence.member.poolQuantity,
      evidence.member.memberQuantity
    );
    const amount = inventoryAmountForPrimaryAllocation({
      catalog,
      itemRevisionId: evidence.item.revisionId,
      position: evidence.position,
      allocatedPrimary: memberQuantity,
    });
    const resolved = resolveInventoryAmount(catalog, evidence.item, amount);
    const nextMeasurements = subtractInventoryMeasurements(
      current.measurements,
      resolved.measurements
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
    if (
      reservationEffect.kind ===
      InventoryFungibilityReservationEffectKind.Transfer
    ) {
      const toPlacementNodeId = reservationEffect.toPlacementNodeId;
      if (toPlacementNodeId === undefined) {
        throw new Error(
          "Fungibility transfer reservation effect lost destination."
        );
      }
      const {
        whereaboutsId,
        whereaboutsState,
        lastPlacementNodeId,
        detachedAtEpochMs,
        missingAtEpochMs,
        ...placedSource
      } = current.key;
      const destinationKey = normalizeInventoryStockPositionKey({
        ...placedSource,
        placementNodeId: toPlacementNodeId,
      });
      const destinationIdentity =
        inventoryStockPositionIdentity(destinationKey);
      const destination = positions[destinationIdentity];
      const destinationMeasurements =
        destination?.measurements ??
        zeroInventoryMeasurements(resolved.measurements);
      positions[destinationIdentity] = {
        key: destinationKey,
        measurements: addInventoryMeasurements(
          destinationMeasurements,
          resolved.measurements
        ),
      };
      if (destination === undefined) {
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
        addFungibilitySimulationIndex(
          positionIdsByPlacementNodeId,
          toPlacementNodeId,
          destinationIdentity
        );
      }
    }
  }
  const projection: InventoryProjectionState = {
    ...world.projection,
    positions,
    positionIdsByItemId,
    positionIdsByItemRevisionId,
    positionIdsByPlacementNodeId,
  };
  const after = inspectInventoryReservationFeasibility({
    catalog, projection, book: world.reservations, atEpochMs: reservationAtEpochMs,
  });
  if (after.status === InventoryReservationFeasibilityStatus.Feasible) return true;
  if (readEarlierShortages === undefined) return false;
  const before = readEarlierShortages();
  // Group membership is unchanged because the claim book and time stay fixed.
  for (const group of after.groups) {
    if (group.shortage.amountMinor === 0) continue;
    const first = group.reservationIds[0];
    const earlier = first === undefined ? undefined : before.get(first);
    if (earlier === undefined || compareQuantity(group.shortage, earlier) > 0) return false;
  }
  return true;
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
  /** Current published world containing the exact source position. */
  readonly world: InventoryWorldState;
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
  /** Mutable evidence map owned by the current planning call. */
  readonly evidenceByPosition: Map<
    string,
    InventoryFungibilityCandidateEvidence
  >;
}

/** Register the exact common-basis picks and report any discarded indivisible capacity. */
function addFungibilityCandidate({
  catalog,
  world,
  member,
  item,
  source,
  memberAvailable,
  candidates,
  evidenceByPosition,
}: AddFungibilityCandidateInput): boolean {
  const identity = inventoryStockPositionIdentity(source.position);
  const position = world.projection.positions[identity];
  if (position === undefined) {
    throw new Error(
      "Fungibility member candidate disappeared from the reviewed world."
    );
  }
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
  const discardedCapacity = source.allocationIncrement !== undefined && availableDigits % incrementDigits !== 0n;
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
  evidenceByPosition.set(identity, {
    member,
    item,
    position,
    source,
  });
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
