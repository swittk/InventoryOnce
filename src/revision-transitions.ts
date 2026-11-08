import {
  assertPositionMatchesItem,
  inventoryCatalogFromSnapshot,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
} from "./catalog.js";
import type { InventoryRevisionTransitionLine } from "./commands.js";
import type { InventoryRevisionTransitionEvidence } from "./events.js";
import {
  inventoryMeasurement,
  inventoryMeasurementVector,
  inventoryMeasurementsEqual,
  positiveInventoryMeasurements,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  inventoryStockPositionIdentity,
  normalizeInventoryStockPositionKey,
  type InventoryStockPositionKey,
} from "./model.js";
import { findInventoryPositions } from "./projection.js";
import { InventoryCountStatus } from "./counts.js";
import { InventoryReservationStatus } from "./reservations.js";
import { compareQuantity, parseQuantity, positiveQuantity, quantityEq, zeroQuantity } from "./quantity.js";
import { convertInventoryRevisionQuantity } from "./revision-transition-math.js";
import {
  inventoryStockSelectorIdentity,
  type InventoryStockSelector,
} from "./selectors.js";
import { InventoryTransferStatus } from "./transfers.js";
import type { InventoryWorldState } from "./world.js";

/** User-specified equivalence between immutable primary units, not a guessed scale. */
export interface InventoryRevisionTransitionUnitMapping {
  /** Positive quantity in the old frozen item's primary unit. */
  readonly sourceAmount: string;
  /** Positive exactly equivalent quantity in the target item's primary unit. */
  readonly targetAmount: string;
}

/** The domain-independent transition that the operator wants to preview. */
export interface InventoryRevisionTransitionRequest {
  /** Stable item identity retained across revisions. */
  readonly itemId: string;
  /** Frozen revision currently owning the selected stock. */
  readonly fromRevisionId: string;
  /** Published target revision already chosen as this item's active definition. */
  readonly toRevisionId: string;
  /** Explicit exactly equivalent primary quantities. */
  readonly conversion: InventoryRevisionTransitionUnitMapping;
  /** Optional item-scoped filter for partial/batch rollouts. Omission selects every old-revision row. */
  readonly selector?: InventoryStockSelector;
}

/** One precise explanation for why a transition cannot currently be committed. */
export interface InventoryRevisionTransitionBlocker {
  /** Stable category used by a caller to choose the appropriate workflow. */
  readonly code: string;
  /** Human-readable reason including what must be done before retrying. */
  readonly message: string;
  /** Exact source bucket responsible for this blocker when relevant. */
  readonly position?: InventoryStockPositionKey;
}

/** Frozen, exact preview; applications never construct signed event legs. */
export interface InventoryRevisionTransitionPlan {
  /** Published world revision used to prove stock/dependency truth at preview time. */
  readonly worldRevision: number;
  /** Item and conversion intent whose meaning this plan freezes. */
  readonly request: InventoryRevisionTransitionRequest;
  /** Source and target unit definitions proved against retained catalog revisions. */
  readonly evidence: InventoryRevisionTransitionEvidence;
  /** One-to-one current-stock lines; each is a positive full-position measurement vector. */
  readonly lines: readonly InventoryRevisionTransitionLine[];
  /** Nonempty when applying would misinterpret physical identity or active claims. */
  readonly blockers: readonly InventoryRevisionTransitionBlocker[];
  /** True only when there is at least one line and no blockers. */
  readonly applicable: boolean;
}

/** Required invariant for independently measured quantities across one clerical revision change. */
function independentlyMeasuredAxesMatch(
  source: InventoryItemDefinitionRevision,
  target: InventoryItemDefinitionRevision
): boolean {
  if (source.independentAxes.length !== target.independentAxes.length) return false;
  for (let i = 0; i < source.independentAxes.length; i += 1) {
    const from = source.independentAxes[i];
    const to = target.independentAxes[i];
    if (from === undefined || to === undefined ||
      from.axisId !== to.axisId ||
      from.unit !== to.unit ||
      from.requirement !== to.requirement) return false;
  }
  return true;
}

/** Prepare an exact target vector while preserving every measured independent axis. */
function transitionedMeasurements(
  source: InventoryMeasurementVector,
  target: InventoryItemDefinitionRevision,
  evidence: InventoryRevisionTransitionEvidence
): InventoryMeasurementVector {
  positiveInventoryMeasurements(source, "Revision-transition source stock");
  const targetAmount = convertInventoryRevisionQuantity(
    source.primary.quantity,
    evidence.sourceUnit,
    evidence.targetUnit
  );
  return inventoryMeasurementVector(
    inventoryMeasurement(target.primaryAxis.axisId, targetAmount),
    source.independent.map(
      /** Retain the exact physical measurements on all other axes. */
      (value) => ({ axisId: value.axisId, quantity: value.quantity })
    )
  );
}

/** Compute all affected physical rows and explicit blockers before any durable write. */
export function planInventoryRevisionTransition(
  world: InventoryWorldState,
  request: InventoryRevisionTransitionRequest
): InventoryRevisionTransitionPlan {
  const catalog: InventoryCatalog = inventoryCatalogFromSnapshot(world.catalog);
  const sourceItem = catalog.itemRevision(request.fromRevisionId);
  const targetItem = catalog.itemRevision(request.toRevisionId);
  if (
    sourceItem.itemId !== request.itemId ||
    targetItem.itemId !== request.itemId ||
    sourceItem.revisionId === targetItem.revisionId
  ) {
    throw new Error("Revision-transition revisions must be distinct definitions of the same item.");
  }
  if (request.selector !== undefined &&
    (request.selector.itemId !== request.itemId ||
      (request.selector.itemRevisionIds !== undefined &&
        (request.selector.itemRevisionIds.length !== 1 ||
          request.selector.itemRevisionIds[0] !== request.fromRevisionId)))) {
    throw new Error("Revision-transition selector must target the exact source item revision.");
  }
  const selector: InventoryStockSelector = {
    ...request.selector,
    itemId: request.itemId,
    itemRevisionIds: [request.fromRevisionId],
  };
  const evidence: InventoryRevisionTransitionEvidence = {
    itemId: request.itemId,
    expectedWorldRevision: world.revision,
    selectorIdentity: inventoryStockSelectorIdentity(selector),
    fromRevisionId: request.fromRevisionId,
    toRevisionId: request.toRevisionId,
    sourceUnit: parseQuantity(request.conversion.sourceAmount, sourceItem.primaryAxis.unit),
    targetUnit: parseQuantity(request.conversion.targetAmount, targetItem.primaryAxis.unit),
  };
  const lines: InventoryRevisionTransitionLine[] = [];
  const blockers: InventoryRevisionTransitionBlocker[] = [];
  if (catalog.activeItem(request.itemId).revisionId !== request.toRevisionId) {
    blockers.push({
      code: "target-not-active",
      message: "Publish and activate the target item revision before transitioning existing stock.",
    });
  }
  if (!independentlyMeasuredAxesMatch(sourceItem, targetItem)) {
    blockers.push({
      code: "independent-axes",
      message: "Independent measurement axes differ; supply an explicit separate measured-axis correction before transition.",
    });
  }
  positiveQuantity(evidence.sourceUnit, "Revision-transition source-unit ratio");
  positiveQuantity(evidence.targetUnit, "Revision-transition target-unit ratio");
  const positions = findInventoryPositions(world.projection, selector);
  // Open reservations consume the exact old item revision even when their
  // selector remains broad; never silently invalidate their claim bindings.
  for (const claim of Object.values(world.reservations.reservations)) {
    if (claim.itemRevisionId === request.fromRevisionId &&
      claim.status === InventoryReservationStatus.Active) {
      blockers.push({
        code: "active-reservation",
        message: "Release or finish active reservation '" + claim.reservationId +
          "' before transitioning its item revision.",
      });
    }
  }
  // Counts freeze the item revision and observed position identities. Moving
  // those stock rows before reconciliation would strand the count's scope or
  // manufacture a false discrepancy, even when its observation is not complete.
  for (const count of Object.values(world.counts.counts)) {
    if (count.itemRevisionId !== request.fromRevisionId ||
      (count.status !== InventoryCountStatus.Started &&
        count.status !== InventoryCountStatus.Observed)) continue;
    blockers.push({
      code: "active-count",
      message: "Reconcile or abandon open count '" + count.countId +
        "' before changing its item revision.",
    });
  }
  // A prepared/partially received transfer retains source revision and exact
  // measurements. Converting the stock mid-lifecycle would strand its receipt.
  for (const transfer of Object.values(world.projection.transfers)) {
    if (transfer.status === InventoryTransferStatus.Received ||
      transfer.status === InventoryTransferStatus.Released) continue;
    if (transfer.lines.some(
      /** Match the exact retained source revision of any active transfer line. */
      (line) => line.sourcePosition.itemRevisionId === request.fromRevisionId
    )) {
      blockers.push({
        code: "active-transfer",
        message: "Complete or release transfer '" + transfer.transferId +
          "' before changing this item revision.",
      });
    }
  }
  for (const position of positions) {
    const from = position.key;
    if (from.packagingRevisionId !== undefined) {
      blockers.push({
        code: "packaged-stock",
        message: "Unpack or explicitly reconcile this intact package; a new item revision cannot silently reuse its frozen package definition.",
        position: from,
      });
      continue;
    }
    if (from.transferId !== undefined) {
      blockers.push({
        code: "transfer-bound",
        message: "Finish or release this stock transfer before changing its revision.",
        position: from,
      });
      continue;
    }
    if (from.whereaboutsId !== undefined) {
      blockers.push({
        code: "unresolved-whereabouts",
        message: "Resolve the detached or missing stock's whereabouts before changing its revision.",
        position: from,
      });
      continue;
    }
    if (compareQuantity(position.measurements.primary.quantity,
      zeroQuantity(position.measurements.primary.quantity.unit)) <= 0) {
      blockers.push({
        code: "negative-or-zero-stock",
        message: "Resolve signed stock deficits before transitioning this exact position.",
        position: from,
      });
      continue;
    }
    const to = normalizeInventoryStockPositionKey({
      ...from,
      itemRevisionId: request.toRevisionId,
    });
    try {
      assertPositionMatchesItem(targetItem, to);
      if (!independentlyMeasuredAxesMatch(sourceItem, targetItem)) continue;
      const measurements = transitionedMeasurements(position.measurements, targetItem, evidence);
      if (from.serialId !== undefined && !quantityEq(
        measurements.primary.quantity,
        parseQuantity("1", targetItem.primaryAxis.unit)
      )) {
        blockers.push({
          code: "serialized-unit",
          message: "A serialized physical resource must remain exactly one target primary unit; convert other stock separately or choose a compatible unit equivalence.",
          position: from,
        });
        continue;
      }
      lines.push({
        from,
        sourceMeasurements: position.measurements,
        targetMeasurements: measurements,
      });
    } catch (error) {
      blockers.push({
        code: "incompatible-position",
        message: error instanceof Error ? error.message : "This position cannot be represented under the target revision.",
        position: from,
      });
    }
  }
  if (positions.length === 0) {
    blockers.push({
      code: "no-stock",
      message: "There is no source-revision stock to transition; only the catalog active pointer needs to change.",
    });
  }
  return {
    worldRevision: world.revision,
    request,
    evidence,
    lines,
    blockers,
    applicable: blockers.length === 0 && lines.length !== 0,
  };
}

/** Recheck the supplied request against its frozen evidence before checking or replaying an operation.
 * Caller-owned preview objects are not an authorization to change a conversion's intent.
 */
export function assertInventoryRevisionTransitionPlanIntent(
  plan: InventoryRevisionTransitionPlan,
  catalog: InventoryCatalog
): void {
  const request = plan.request;
  const evidence = plan.evidence;
  if (
    plan.worldRevision !== evidence.expectedWorldRevision ||
    request.itemId !== evidence.itemId ||
    request.fromRevisionId !== evidence.fromRevisionId ||
    request.toRevisionId !== evidence.toRevisionId ||
    (request.selector !== undefined && (
      request.selector.itemId !== request.itemId ||
      (request.selector.itemRevisionIds !== undefined &&
        (request.selector.itemRevisionIds.length !== 1 ||
          request.selector.itemRevisionIds[0] !== request.fromRevisionId))
    ))
  ) {
    throw new Error("Revision-transition approved plan and current request have conflicting identities.");
  }
  const selector: InventoryStockSelector = {
    ...request.selector,
    itemId: request.itemId,
    itemRevisionIds: [request.fromRevisionId],
  };
  if (inventoryStockSelectorIdentity(selector) !== evidence.selectorIdentity) {
    throw new Error("Revision-transition request selector differs from the approved conversion scope.");
  }
  const source = catalog.itemRevision(request.fromRevisionId);
  const target = catalog.itemRevision(request.toRevisionId);
  if (
    source.itemId !== request.itemId ||
    target.itemId !== request.itemId ||
    !quantityEq(
      parseQuantity(request.conversion.sourceAmount, source.primaryAxis.unit),
      evidence.sourceUnit
    ) ||
    !quantityEq(
      parseQuantity(request.conversion.targetAmount, target.primaryAxis.unit),
      evidence.targetUnit
    )
  ) {
    throw new Error("Revision-transition request ratio differs from the approved conversion evidence.");
  }
}

/** Compare frozen plans using exact quantity/position semantics rather than display strings. */
export function inventoryRevisionTransitionPlansEqual(
  left: InventoryRevisionTransitionPlan,
  right: InventoryRevisionTransitionPlan
): boolean {
  const leftEvidence = left.evidence;
  const rightEvidence = right.evidence;
  if (
    left.worldRevision !== right.worldRevision ||
    !left.applicable ||
    !right.applicable ||
    left.lines.length !== right.lines.length ||
    leftEvidence.itemId !== rightEvidence.itemId ||
    leftEvidence.fromRevisionId !== rightEvidence.fromRevisionId ||
    leftEvidence.toRevisionId !== rightEvidence.toRevisionId ||
    leftEvidence.expectedWorldRevision !== rightEvidence.expectedWorldRevision ||
    leftEvidence.selectorIdentity !== rightEvidence.selectorIdentity ||
    !quantityEq(leftEvidence.sourceUnit, rightEvidence.sourceUnit) ||
    !quantityEq(leftEvidence.targetUnit, rightEvidence.targetUnit)
  ) {
    return false;
  }
  for (let index = 0; index < left.lines.length; index += 1) {
    const leftLine = left.lines[index];
    const rightLine = right.lines[index];
    if (
      leftLine === undefined ||
      rightLine === undefined ||
      inventoryStockPositionIdentity(leftLine.from) !==
        inventoryStockPositionIdentity(rightLine.from) ||
      !inventoryMeasurementsEqual(
        leftLine.sourceMeasurements,
        rightLine.sourceMeasurements
      ) ||
      !inventoryMeasurementsEqual(
        leftLine.targetMeasurements,
        rightLine.targetMeasurements
      )
    ) {
      return false;
    }
  }
  return true;
}
