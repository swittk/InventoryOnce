import type {
  InventoryCatalog,
  InventoryCollectionDefinitionRevision,
  InventoryCollectionRevisionId,
  InventoryCollectionRollupDefinition,
  InventoryCollectionRollupMemberDefinition,
  InventoryItemDefinitionRevision,
} from "./catalog.js";
import { inventoryMeasurementAt } from "./measurements.js";
import type { InventoryProjectionState } from "./projection.js";
import {
  addQuantity,
  convertQuantityByReferenceExact,
  zeroQuantity,
  type Quantity,
} from "./quantity.js";
import {
  summarizeInventoryStock,
  type InventoryStockRevisionSummary,
} from "./read-model.js";
import {
  normalizeInventoryStockSelector,
  type InventoryStockSelector,
} from "./selectors.js";

/** Stock-position scope reusable across every exact member of one collection. */
export type InventoryCollectionStockScope = Omit<
  InventoryStockSelector,
  "itemId" | "itemRevisionIds"
>;

/** Exact physical member row in one read-only collection summary. */
export interface InventoryCollectionMemberSummary {
  /** Stable item identity retained by the member revision. */
  readonly itemId: string;
  /** Exact immutable item revision; collection membership never merges it. */
  readonly itemRevisionId: string;
  /** Normal revision-safe physical summary for this exact member. */
  readonly physical: InventoryStockRevisionSummary;
}

/** One exact member contribution to an explicitly declared scalar roll-up. */
export interface InventoryCollectionRollupContribution {
  /** Exact item revision whose physical amount contributed. */
  readonly itemRevisionId: string;
  /** Exact member measurement axis converted to the roll-up basis. */
  readonly measurementAxisId: string;
  /** Signed net member-axis quantity: physical stock minus recorded deficit. */
  readonly memberQuantity: Quantity;
  /** Positive physical member-axis quantity. */
  readonly physicalMemberQuantity: Quantity;
  /** Positive recorded-deficit magnitude on the member axis. */
  readonly deficitMemberQuantity: Quantity;
  /** Signed net contribution in the read-only roll-up basis. */
  readonly rollupQuantity: Quantity;
  /** Positive physical contribution in the roll-up basis. */
  readonly physicalRollupQuantity: Quantity;
  /** Positive deficit contribution in the roll-up basis. */
  readonly deficitRollupQuantity: Quantity;
}

/** One optional scalar read view explicitly defined by reference conversions. */
export interface InventoryCollectionRollupSummary {
  /** Stable roll-up identity inside the collection revision. */
  readonly rollupId: string;
  /** Semantic basis axis such as `pack-count`. */
  readonly basisAxisId: string;
  /** Signed net total in the declared basis unit. */
  readonly total: Quantity;
  /** Positive physical total in the declared basis unit. */
  readonly physicalTotal: Quantity;
  /** Positive recorded-deficit magnitude in the declared basis unit. */
  readonly deficitTotal: Quantity;
  /** Exact member contributions, preserving underlying identities. */
  readonly contributions: readonly InventoryCollectionRollupContribution[];
}

/** Read-only collection report that never grants substitution/fungibility rights. */
export interface InventoryCollectionSummary {
  /** Exact immutable collection revision used by this report. */
  readonly definition: InventoryCollectionDefinitionRevision;
  /** Shared stock-position scope applied to every exact member. */
  readonly scope: InventoryCollectionStockScope;
  /** Exact member summaries sorted by immutable item revision identity. */
  readonly members: readonly InventoryCollectionMemberSummary[];
  /** Optional explicitly compatible scalar roll-ups. */
  readonly rollups: readonly InventoryCollectionRollupSummary[];
}

/** Inputs for summarizing one retained read-only collection revision. */
export interface SummarizeInventoryCollectionInput {
  /** Frozen catalogue containing the exact collection and item revisions. */
  readonly catalog: InventoryCatalog;
  /** Current exact physical projection. */
  readonly projection: InventoryProjectionState;
  /** Exact retained collection revision; active pointers are not inferred here. */
  readonly collectionRevisionId: InventoryCollectionRevisionId;
  /** Optional shared position scope such as one location/status/owner. */
  readonly scope?: InventoryCollectionStockScope;
}

/** Summarize exact collection members and only the scalar roll-ups explicitly declared compatible. */
export function summarizeInventoryCollection({
  catalog,
  projection,
  collectionRevisionId,
  scope: rawScope = {},
}: SummarizeInventoryCollectionInput): InventoryCollectionSummary {
  const scope = normalizeInventoryCollectionScope(rawScope);
  const definition = catalog.collectionRevision(collectionRevisionId);
  const members: InventoryCollectionMemberSummary[] = [];
  const memberByRevisionId = new Map<
    string,
    InventoryCollectionMemberSummary
  >();
  for (const itemRevisionId of catalog.collectionItemRevisionIds(
    collectionRevisionId
  )) {
    const item = catalog.itemRevision(itemRevisionId);
    const summary = summarizeExactCollectionMember(
      catalog,
      projection,
      item,
      scope
    );
    members.push(summary);
    memberByRevisionId.set(itemRevisionId, summary);
  }
  members.sort(compareCollectionMemberSummary);
  const rollups: InventoryCollectionRollupSummary[] = [];
  for (const rollup of definition.rollups ?? []) {
    rollups.push(summarizeCollectionRollup(rollup, memberByRevisionId));
  }
  rollups.sort(compareCollectionRollupSummary);
  return {
    definition,
    scope,
    members,
    rollups,
  };
}

/** Normalize/copy one shared selector scope without retaining caller-owned arrays or shorthands. */
function normalizeInventoryCollectionScope(
  rawScope: InventoryCollectionStockScope
): InventoryCollectionStockScope {
  const normalized = normalizeInventoryStockSelector({
    ...rawScope,
    itemId: "inventory-once-collection-scope",
  });
  const { itemId, itemRevisionIds, ...scope } = normalized;
  void itemId;
  void itemRevisionIds;
  return scope;
}

/** Build the normal physical summary for one exact collection member revision. */
function summarizeExactCollectionMember(
  catalog: InventoryCatalog,
  projection: InventoryProjectionState,
  item: InventoryItemDefinitionRevision,
  scope: InventoryCollectionStockScope
): InventoryCollectionMemberSummary {
  const summary = summarizeInventoryStock({
    catalog,
    projection,
    selector: {
      ...scope,
      itemId: item.itemId,
      itemRevisionIds: [item.revisionId],
    },
  });
  const physical = summary.revisions[0];
  if (physical === undefined) {
    throw new Error(
      `Inventory collection member '${item.revisionId}' lost its revision-safe zero summary.`
    );
  }
  return {
    itemId: item.itemId,
    itemRevisionId: item.revisionId,
    physical,
  };
}

/** Compute one explicitly declared scalar roll-up while preserving every member contribution. */
function summarizeCollectionRollup(
  rollup: InventoryCollectionRollupDefinition,
  memberByRevisionId: ReadonlyMap<string, InventoryCollectionMemberSummary>
): InventoryCollectionRollupSummary {
  let total = zeroQuantity(rollup.basisUnit);
  let physicalTotal = zeroQuantity(rollup.basisUnit);
  let deficitTotal = zeroQuantity(rollup.basisUnit);
  const contributions: InventoryCollectionRollupContribution[] = [];
  for (const conversion of rollup.members) {
    const contribution = summarizeCollectionRollupMember(
      conversion,
      memberByRevisionId
    );
    total = addQuantity(total, contribution.rollupQuantity);
    physicalTotal = addQuantity(
      physicalTotal,
      contribution.physicalRollupQuantity
    );
    deficitTotal = addQuantity(
      deficitTotal,
      contribution.deficitRollupQuantity
    );
    contributions.push(contribution);
  }
  contributions.sort(compareCollectionRollupContribution);
  return {
    rollupId: rollup.rollupId,
    basisAxisId: rollup.basisAxisId,
    total,
    physicalTotal,
    deficitTotal,
    contributions,
  };
}

/** Convert one exact member's selected physical quantity through its retained reference equivalence. */
function summarizeCollectionRollupMember(
  conversion: InventoryCollectionRollupMemberDefinition,
  memberByRevisionId: ReadonlyMap<string, InventoryCollectionMemberSummary>
): InventoryCollectionRollupContribution {
  const member = memberByRevisionId.get(conversion.itemRevisionId);
  if (member === undefined) {
    throw new Error(
      `Inventory collection roll-up references missing member '${conversion.itemRevisionId}'.`
    );
  }
  const memberQuantity = inventoryMeasurementAt(
    member.physical.total,
    conversion.measurementAxisId,
    conversion.memberQuantity.unit
  );
  const physicalMemberQuantity = inventoryMeasurementAt(
    member.physical.physicalOnHand,
    conversion.measurementAxisId,
    conversion.memberQuantity.unit
  );
  const deficitMemberQuantity = inventoryMeasurementAt(
    member.physical.deficit,
    conversion.measurementAxisId,
    conversion.memberQuantity.unit
  );
  return {
    itemRevisionId: conversion.itemRevisionId,
    measurementAxisId: conversion.measurementAxisId,
    memberQuantity,
    physicalMemberQuantity,
    deficitMemberQuantity,
    rollupQuantity: convertQuantityByReferenceExact(
      memberQuantity,
      conversion.memberQuantity,
      conversion.rollupQuantity
    ),
    physicalRollupQuantity: convertQuantityByReferenceExact(
      physicalMemberQuantity,
      conversion.memberQuantity,
      conversion.rollupQuantity
    ),
    deficitRollupQuantity: convertQuantityByReferenceExact(
      deficitMemberQuantity,
      conversion.memberQuantity,
      conversion.rollupQuantity
    ),
  };
}

/** Sort exact member summaries by immutable item revision identity. */
function compareCollectionMemberSummary(
  left: InventoryCollectionMemberSummary,
  right: InventoryCollectionMemberSummary
): number {
  return left.itemRevisionId.localeCompare(right.itemRevisionId);
}

/** Sort scalar roll-up summaries by stable roll-up identity. */
function compareCollectionRollupSummary(
  left: InventoryCollectionRollupSummary,
  right: InventoryCollectionRollupSummary
): number {
  return left.rollupId.localeCompare(right.rollupId);
}

/** Sort roll-up contributions by exact item revision identity. */
function compareCollectionRollupContribution(
  left: InventoryCollectionRollupContribution,
  right: InventoryCollectionRollupContribution
): number {
  return left.itemRevisionId.localeCompare(right.itemRevisionId);
}
