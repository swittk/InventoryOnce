import {
  assertInventoryIdentity,
  inventoryStockPositionIdentity,
  type InventoryQualifiedDimension,
  type InventoryStockPositionKey,
  type ItemId,
} from "./model.js";

/** How one optional stock identity is matched when omission would otherwise mean broad. */
export enum InventoryOptionalIdentityConstraintKind {
  /** Match any position where this identity exists. */
  Present = "present",
  /** Match only positions where this identity is missing. */
  Absent = "absent",
  /** Match one identity from an explicit non-empty allowed set. */
  Allowed = "allowed",
}

/** Explicit presence/absence/value constraint for one optional stock identity. */
export interface InventoryOptionalIdentityConstraint {
  /** Present, absent, or one allowed set. */
  readonly kind: InventoryOptionalIdentityConstraintKind;
  /** Required only for Allowed; forbidden for Present/Absent. */
  readonly valueIds?: readonly string[];
}

/** One qualified-dimension constraint inside a broad stock selector. */
export interface InventoryQualifiedDimensionConstraint {
  /** Dimension id being constrained. */
  readonly dimensionId: string;
  /** Present, absent, or one allowed set; omitted means Allowed for old value-list callers. */
  readonly kind?: InventoryOptionalIdentityConstraintKind;
  /** Required for Allowed; forbidden for Present/Absent. */
  readonly valueIds?: readonly string[];
}

/**
 * Declarative eligible-stock scope used by queries, reservations, counts, and allocation.
 * Omitted dimensions remain deliberately broad and can be refined later.
 */
export interface InventoryStockSelector {
  /** Required item identity; one selector never mixes unrelated items. */
  readonly itemId: ItemId;
  /** Allowed frozen item revisions, or every compatible retained revision when omitted. */
  readonly itemRevisionIds?: readonly string[];
  /** Allowed locations, or every location when omitted. */
  readonly locationIds?: readonly string[];
  /** Explicit lot presence/absence/allowed-set constraint. */
  readonly lot?: InventoryOptionalIdentityConstraint;
  /** Allowed lots shorthand, or every lot/no-lot position when omitted. */
  readonly lotIds?: readonly string[];
  /** Explicit serial presence/absence/allowed-set constraint. */
  readonly serial?: InventoryOptionalIdentityConstraint;
  /** Allowed serials shorthand, or every serial/no-serial position when omitted. */
  readonly serialIds?: readonly string[];
  /** Explicit package-revision presence/absence/allowed-set constraint. */
  readonly packagingRevision?: InventoryOptionalIdentityConstraint;
  /** Allowed exact package revisions shorthand, or every package/loose position when omitted. */
  readonly packagingRevisionIds?: readonly string[];
  /** Explicit container presence/absence/allowed-set constraint. */
  readonly container?: InventoryOptionalIdentityConstraint;
  /** Allowed handling units shorthand, or every container/loose position when omitted. */
  readonly containerIds?: readonly string[];
  /** Explicit status presence/absence/allowed-set constraint. */
  readonly status?: InventoryOptionalIdentityConstraint;
  /** Allowed stock statuses shorthand, or every status when omitted. */
  readonly statusIds?: readonly string[];
  /** Explicit owner presence/absence/allowed-set constraint. */
  readonly owner?: InventoryOptionalIdentityConstraint;
  /** Allowed legal/economic owners shorthand, or every owner when omitted. */
  readonly ownerIds?: readonly string[];
  /** Explicit custodian presence/absence/allowed-set constraint. */
  readonly custodian?: InventoryOptionalIdentityConstraint;
  /** Allowed custodians/possessors shorthand, or every custodian when omitted. */
  readonly custodianIds?: readonly string[];
  /** Explicit disposition-authority presence/absence/allowed-set constraint. */
  readonly dispositionAuthority?: InventoryOptionalIdentityConstraint;
  /** Allowed disposition authorities shorthand, or every authority when omitted. */
  readonly dispositionAuthorityIds?: readonly string[];
  /** Extra dimension constraints; omitted dimensions remain broad. */
  readonly qualifiedDimensions?: readonly InventoryQualifiedDimensionConstraint[];
}

/** Build one normalized selector from an item id plus optional broad/exact constraints. */
export function inventoryStockSelector(
  itemId: ItemId,
  constraints: Omit<InventoryStockSelector, "itemId"> = {}
): InventoryStockSelector {
  return normalizeInventoryStockSelector({ itemId, ...constraints });
}

/** Build one selector matching every retained stock position for one item. */
export function everythingInInventoryStockSelector(
  itemId: ItemId
): InventoryStockSelector {
  return inventoryStockSelector(itemId);
}

/** Return a normalized copy whose arrays are sorted, unique, and non-empty. */
export function normalizeInventoryStockSelector(
  selector: InventoryStockSelector
): InventoryStockSelector {
  assertInventoryIdentity(selector.itemId, "Selector itemId");
  const itemRevisionIds = normalizeOptionalIdentitySet(
    selector.itemRevisionIds,
    "itemRevisionIds"
  );
  const locationIds = normalizeOptionalIdentitySet(
    selector.locationIds,
    "locationIds"
  );
  const lot = normalizeOptionalIdentityConstraint(
    selector.lot,
    selector.lotIds,
    "lot"
  );
  const serial = normalizeOptionalIdentityConstraint(
    selector.serial,
    selector.serialIds,
    "serial"
  );
  const packagingRevision = normalizeOptionalIdentityConstraint(
    selector.packagingRevision,
    selector.packagingRevisionIds,
    "packagingRevision"
  );
  const container = normalizeOptionalIdentityConstraint(
    selector.container,
    selector.containerIds,
    "container"
  );
  const status = normalizeOptionalIdentityConstraint(
    selector.status,
    selector.statusIds,
    "status"
  );
  const owner = normalizeOptionalIdentityConstraint(
    selector.owner,
    selector.ownerIds,
    "owner"
  );
  const custodian = normalizeOptionalIdentityConstraint(
    selector.custodian,
    selector.custodianIds,
    "custodian"
  );
  const dispositionAuthority = normalizeOptionalIdentityConstraint(
    selector.dispositionAuthority,
    selector.dispositionAuthorityIds,
    "dispositionAuthority"
  );
  const qualifiedDimensions = normalizeQualifiedDimensionSelectors(
    selector.qualifiedDimensions
  );
  return {
    itemId: selector.itemId,
    ...(itemRevisionIds === undefined ? {} : { itemRevisionIds }),
    ...(locationIds === undefined ? {} : { locationIds }),
    ...(lot === undefined ? {} : { lot }),
    ...(serial === undefined ? {} : { serial }),
    ...(packagingRevision === undefined ? {} : { packagingRevision }),
    ...(container === undefined ? {} : { container }),
    ...(status === undefined ? {} : { status }),
    ...(owner === undefined ? {} : { owner }),
    ...(custodian === undefined ? {} : { custodian }),
    ...(dispositionAuthority === undefined ? {} : { dispositionAuthority }),
    ...(qualifiedDimensions === undefined ? {} : { qualifiedDimensions }),
  };
}

/** Return whether one exact stock position is eligible under a broad selector. */
export function inventoryStockPositionMatchesSelector(
  position: InventoryStockPositionKey,
  rawSelector: InventoryStockSelector
): boolean {
  return inventoryStockPositionMatchesNormalizedSelector(
    position,
    normalizeInventoryStockSelector(rawSelector)
  );
}

/** Match one position against a selector already normalized once by a bounded caller loop. */
export function inventoryStockPositionMatchesNormalizedSelector(
  position: InventoryStockPositionKey,
  selector: InventoryStockSelector
): boolean {
  if (position.itemId !== selector.itemId) return false;
  if (!optionalSetMatches(selector.itemRevisionIds, position.itemRevisionId))
    return false;
  if (!optionalSetMatches(selector.locationIds, position.locationId))
    return false;
  if (!optionalIdentityConstraintMatches(selector.lot, position.lotId))
    return false;
  if (!optionalIdentityConstraintMatches(selector.serial, position.serialId))
    return false;
  if (
    !optionalIdentityConstraintMatches(
      selector.packagingRevision,
      position.packagingRevisionId
    )
  )
    return false;
  if (
    !optionalIdentityConstraintMatches(selector.container, position.containerId)
  )
    return false;
  if (!optionalIdentityConstraintMatches(selector.status, position.statusId))
    return false;
  if (!optionalIdentityConstraintMatches(selector.owner, position.ownerId))
    return false;
  if (
    !optionalIdentityConstraintMatches(selector.custodian, position.custodianId)
  )
    return false;
  if (
    !optionalIdentityConstraintMatches(
      selector.dispositionAuthority,
      position.dispositionAuthorityId
    )
  )
    return false;
  return qualifiedDimensionsMatch(
    position.qualifiedDimensions,
    selector.qualifiedDimensions
  );
}

/** Stable deterministic selector identity for idempotency and durable claims. */
export function inventoryStockSelectorIdentity(
  selector: InventoryStockSelector
): string {
  return JSON.stringify(normalizeInventoryStockSelector(selector));
}

/** Require an exact position to be inside one declared selector. */
export function assertPositionInsideSelector(
  position: InventoryStockPositionKey,
  selector: InventoryStockSelector
): void {
  if (!inventoryStockPositionMatchesSelector(position, selector)) {
    throw new Error(
      `Stock position ${inventoryStockPositionIdentity(
        position
      )} is outside the declared selector.`
    );
  }
}

/** Normalize one optional identity set while preserving omission as broad matching. */
function normalizeOptionalIdentitySet(
  values: readonly string[] | undefined,
  label: string
): readonly string[] | undefined {
  return values === undefined ? undefined : normalizeIdentitySet(values, label);
}

/** Normalize one explicit optional identity rule or its old allowed-list shorthand. */
function normalizeOptionalIdentityConstraint(
  constraint: InventoryOptionalIdentityConstraint | undefined,
  shorthandValueIds: readonly string[] | undefined,
  label: string
): InventoryOptionalIdentityConstraint | undefined {
  if (constraint !== undefined && shorthandValueIds !== undefined) {
    throw new Error(
      `Selector ${label} cannot use both a constraint and its Ids shorthand.`
    );
  }
  if (constraint === undefined) {
    const valueIds = normalizeOptionalIdentitySet(
      shorthandValueIds,
      `${label}Ids`
    );
    return valueIds === undefined
      ? undefined
      : { kind: InventoryOptionalIdentityConstraintKind.Allowed, valueIds };
  }
  if (constraint.kind === InventoryOptionalIdentityConstraintKind.Allowed) {
    if (constraint.valueIds === undefined) {
      throw new Error(`Selector ${label} Allowed constraint needs valueIds.`);
    }
    return {
      kind: constraint.kind,
      valueIds: normalizeIdentitySet(constraint.valueIds, `${label}.valueIds`),
    };
  }
  if (constraint.valueIds !== undefined) {
    throw new Error(
      `Selector ${label} ${constraint.kind} constraint must omit valueIds.`
    );
  }
  return { kind: constraint.kind };
}

/** Sort, deduplicate, and validate one selector identity set. */
function normalizeIdentitySet(
  values: readonly string[],
  label: string
): readonly string[] {
  if (values.length === 0) {
    throw new Error(`Selector ${label} must be omitted instead of empty.`);
  }
  const normalized = [...values];
  normalized.sort();
  const unique: string[] = [];
  let previous: string | undefined;
  for (const value of normalized) {
    assertInventoryIdentity(value, `Selector ${label} identity`);
    if (value !== previous) unique.push(value);
    previous = value;
  }
  return unique;
}

/** Normalize qualified-dimension constraints and reject duplicate dimension ids. */
function normalizeQualifiedDimensionSelectors(
  selectors: readonly InventoryQualifiedDimensionConstraint[] | undefined
): readonly InventoryQualifiedDimensionConstraint[] | undefined {
  if (selectors === undefined) return undefined;
  if (selectors.length === 0) {
    throw new Error("qualifiedDimensions must be omitted instead of empty.");
  }
  const normalized: InventoryQualifiedDimensionConstraint[] = [];
  for (const selector of selectors) {
    assertInventoryIdentity(
      selector.dimensionId,
      "Qualified dimension selector dimensionId"
    );
    const kind =
      selector.kind ?? InventoryOptionalIdentityConstraintKind.Allowed;
    const constraint = normalizeOptionalIdentityConstraint(
      {
        kind,
        ...(selector.valueIds === undefined
          ? {}
          : { valueIds: selector.valueIds }),
      },
      undefined,
      `qualifiedDimensions.${selector.dimensionId}`
    );
    if (constraint === undefined) {
      throw new Error(
        "Qualified dimension constraint normalization returned no constraint."
      );
    }
    normalized.push({ dimensionId: selector.dimensionId, ...constraint });
  }
  normalized.sort(compareQualifiedDimensionSelector);
  let previousDimensionId: string | undefined;
  for (const selector of normalized) {
    if (selector.dimensionId === previousDimensionId) {
      throw new Error(
        `Duplicate qualified dimension selector '${selector.dimensionId}'.`
      );
    }
    previousDimensionId = selector.dimensionId;
  }
  return normalized;
}

/** Return whether one optional exact value belongs to an optional allowed set. */
function optionalSetMatches(
  allowed: readonly string[] | undefined,
  value: string | undefined
): boolean {
  if (allowed === undefined) return true;
  if (value === undefined) return false;
  return allowed.includes(value);
}

/** Return whether one optional value obeys an explicit presence/absence/value rule. */
function optionalIdentityConstraintMatches(
  constraint:
    | Pick<InventoryQualifiedDimensionConstraint, "kind" | "valueIds">
    | undefined,
  value: string | undefined
): boolean {
  if (constraint === undefined) return true;
  const kind =
    constraint.kind ?? InventoryOptionalIdentityConstraintKind.Allowed;
  if (kind === InventoryOptionalIdentityConstraintKind.Absent) {
    return value === undefined;
  }
  if (kind === InventoryOptionalIdentityConstraintKind.Present) {
    return value !== undefined;
  }
  return value !== undefined && (constraint.valueIds ?? []).includes(value);
}

/** Return whether every qualified-dimension selector matches the exact position values. */
function qualifiedDimensionsMatch(
  dimensions: readonly InventoryQualifiedDimension[] | undefined,
  selectors: readonly InventoryQualifiedDimensionConstraint[] | undefined
): boolean {
  if (selectors === undefined) return true;
  const valueByDimension = new Map<string, string>();
  for (const dimension of dimensions ?? []) {
    valueByDimension.set(dimension.dimensionId, dimension.valueId);
  }
  for (const selector of selectors) {
    const actual = valueByDimension.get(selector.dimensionId);
    if (!optionalIdentityConstraintMatches(selector, actual)) return false;
  }
  return true;
}

/** Sort qualified-dimension selectors by stable dimension identity. */
function compareQualifiedDimensionSelector(
  left: InventoryQualifiedDimensionConstraint,
  right: InventoryQualifiedDimensionConstraint
): number {
  return left.dimensionId.localeCompare(right.dimensionId);
}

/** Return whether `narrower` can only match positions already matched by `broader`. */
export function inventoryStockSelectorIsSubset(
  narrower: InventoryStockSelector,
  broader: InventoryStockSelector
): boolean {
  const normalizedNarrower = normalizeInventoryStockSelector(narrower);
  const normalizedBroader = normalizeInventoryStockSelector(broader);
  if (normalizedNarrower.itemId !== normalizedBroader.itemId) return false;
  if (
    !optionalSetIsSubset(
      normalizedNarrower.itemRevisionIds,
      normalizedBroader.itemRevisionIds
    )
  )
    return false;
  if (
    !optionalSetIsSubset(
      normalizedNarrower.locationIds,
      normalizedBroader.locationIds
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.lot,
      normalizedBroader.lot
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.serial,
      normalizedBroader.serial
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.packagingRevision,
      normalizedBroader.packagingRevision
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.container,
      normalizedBroader.container
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.status,
      normalizedBroader.status
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.owner,
      normalizedBroader.owner
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.custodian,
      normalizedBroader.custodian
    )
  )
    return false;
  if (
    !optionalIdentityConstraintIsSubset(
      normalizedNarrower.dispositionAuthority,
      normalizedBroader.dispositionAuthority
    )
  )
    return false;
  return qualifiedSelectorIsSubset(
    normalizedNarrower.qualifiedDimensions,
    normalizedBroader.qualifiedDimensions
  );
}

/** Return whether one optional allowed set is no broader than another optional set. */
function optionalSetIsSubset(
  narrower: readonly string[] | undefined,
  broader: readonly string[] | undefined
): boolean {
  if (broader === undefined) return true;
  if (narrower === undefined) return false;
  for (const value of narrower) {
    if (!broader.includes(value)) return false;
  }
  return true;
}

/** Return whether one explicit optional-identity rule cannot escape another rule. */
function optionalIdentityConstraintIsSubset(
  narrower:
    | Pick<InventoryQualifiedDimensionConstraint, "kind" | "valueIds">
    | undefined,
  broader:
    | Pick<InventoryQualifiedDimensionConstraint, "kind" | "valueIds">
    | undefined
): boolean {
  if (broader === undefined) return true;
  if (narrower === undefined) return false;
  const broaderKind =
    broader.kind ?? InventoryOptionalIdentityConstraintKind.Allowed;
  const narrowerKind =
    narrower.kind ?? InventoryOptionalIdentityConstraintKind.Allowed;
  if (broaderKind === InventoryOptionalIdentityConstraintKind.Absent) {
    return narrowerKind === InventoryOptionalIdentityConstraintKind.Absent;
  }
  if (broaderKind === InventoryOptionalIdentityConstraintKind.Present) {
    return narrowerKind !== InventoryOptionalIdentityConstraintKind.Absent;
  }
  if (narrowerKind !== InventoryOptionalIdentityConstraintKind.Allowed)
    return false;
  return optionalSetIsSubset(narrower.valueIds, broader.valueIds);
}

/** Return whether every broader qualified constraint is preserved/narrowed. */
function qualifiedSelectorIsSubset(
  narrower: readonly InventoryQualifiedDimensionConstraint[] | undefined,
  broader: readonly InventoryQualifiedDimensionConstraint[] | undefined
): boolean {
  if (broader === undefined) return true;
  if (narrower === undefined) return false;
  const narrowerByDimension = new Map<
    string,
    InventoryQualifiedDimensionConstraint
  >();
  for (const selector of narrower) {
    narrowerByDimension.set(selector.dimensionId, selector);
  }
  for (const broadConstraint of broader) {
    const narrowConstraint = narrowerByDimension.get(
      broadConstraint.dimensionId
    );
    if (narrowConstraint === undefined) return false;
    if (!optionalIdentityConstraintIsSubset(narrowConstraint, broadConstraint))
      return false;
  }
  return true;
}
