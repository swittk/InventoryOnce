import {
  inventoryCatalogFromSnapshot,
  type InventoryCatalogSnapshot,
} from "./catalog.js";
import {
  InventoryCountOperationKind,
  InventoryCountStatus,
  type InventoryCount,
  type InventoryCountBook,
  type InventoryCountOperation,
} from "./counts.js";
import { inventorySha256 } from "./digest.js";
import { compareInventoryIdentityText } from "./ordering.js";
import type { InventoryCommittedEvent } from "./events.js";
import type { InventoryPlacementState } from "./placement.js";
import type {
  InventoryDeficitPolicy,
  InventoryProjectionState,
} from "./projection.js";
import {
  InventoryReservationOperationKind,
  InventoryReservationStatus,
  type InventoryReservation,
  type InventoryReservationBook,
  type InventoryReservationOperation,
} from "./reservations.js";
import { inventoryStockSelectorIsSubset } from "./selectors.js";
import type { InventoryWorldState } from "./world.js";
import {
  cloneInventorySparseRecord,
  inventoryObjectIsDeeplyImmutable,
  inventorySparseRecordHas,
  inventorySparseRecordLineage,
  inventorySparseRecordValue,
  inventorySortedIdentitySetLineage,
  setInventorySparseRecordValue,
} from "./sparse-record.js";

/** Cached digest of one immutable retained record value. */
const inventoryValueDigestCache = new WeakMap<object, string>();
/** Cached aggregate of one canonical sorted unique identity-set array. */
const inventoryIdentitySetDigestCache = new WeakMap<
  object,
  InventoryRecordDigestAggregate
>();
/** One order-independent authenticated aggregate for an immutable sparse record. */
interface InventoryRecordDigestAggregate {
  /** Number of own record entries included in this aggregate. */
  readonly count: number;
  /** First independently domain-separated 256-bit modular leaf sum. */
  readonly primarySum: bigint;
  /** Second independently domain-separated 256-bit modular leaf sum. */
  readonly secondarySum: bigint;
  /** Final SHA-256 commitment to the count and both modular sums. */
  readonly digest: string;
}

/** One cached record aggregate bound to its copy-on-write mutation revision. */
interface InventoryRecordDigestCacheEntry {
  /** Authenticated aggregate at the cached revision. */
  readonly aggregate: InventoryRecordDigestAggregate;
  /** Sparse-record mutation revision; omitted for immutable non-lineage records. */
  readonly lineageRevision?: number;
}

/** Cached aggregate of immutable records and revisioned copy-on-write records. */
const inventoryRecordDigestCache = new WeakMap<
  object,
  InventoryRecordDigestCacheEntry
>();
/** 256-bit field modulus used only for order-independent record aggregation. */
const inventoryRecordDigestModulus = 1n << 256n;
/** Cached digest of one immutable published catalogue snapshot. */
const inventoryCatalogDigestCache = new WeakMap<object, string>();
/** Cached digest of one immutable published projection object. */
const inventoryProjectionDigestCache = new WeakMap<object, string>();
/** Cached digest of one immutable published reservation book. */
const inventoryReservationDigestCache = new WeakMap<object, string>();
/** Cached digest of one immutable published count book. */
const inventoryCountDigestCache = new WeakMap<object, string>();
/** Cached component roots for one immutable published world object. */
const inventoryWorldRootsCache = new WeakMap<
  object,
  InventoryWorldContentRoots
>();

/** One append-only reservation row/operation change frozen in a compact durable plan. */
export interface InventoryReservationBookDelta {
  /** Current reservation row after the one allowed lifecycle action. */
  readonly reservation: InventoryReservation;
  /** New immutable lifecycle operation appended by this command. */
  readonly operation: InventoryReservationOperation;
}

/** One append-only count row/operation change frozen in a compact durable plan. */
export interface InventoryCountBookDelta {
  /** Current count row after the one allowed lifecycle action. */
  readonly count: InventoryCount;
  /** New immutable lifecycle operation appended by this command. */
  readonly operation: InventoryCountOperation;
}

/** Small content roots proving exactly which base components one plan advances. */
export interface InventoryWorldContentRoots {
  /** Full published world root, including its revision and component roots. */
  readonly world: string;
  /** Durable catalogue-definition root. */
  readonly catalog: string;
  /** Committed event/current-stock/placement/traceability projection root. */
  readonly projection: string;
  /** Current reservation rows plus append-only lifecycle evidence root. */
  readonly reservations: string;
  /** Current count rows plus append-only lifecycle evidence root. */
  readonly counts: string;
}

/** Calculate deterministic SHA-256 roots for one published world snapshot. */
export function inventoryWorldContentRoots(
  world: InventoryWorldState
): InventoryWorldContentRoots {
  const cacheable = inventoryObjectIsDeeplyImmutable(world);
  const cached = cacheable ? inventoryWorldRootsCache.get(world) : undefined;
  if (cached !== undefined) return cached;
  const catalog = inventoryCatalogSnapshotDigest(world.catalog);
  const projection = inventoryProjectionDigest(world.projection);
  const reservations = inventoryReservationBookDigest(world.reservations);
  const counts = inventoryCountBookDigest(world.counts);
  const roots: InventoryWorldContentRoots = {
    catalog,
    projection,
    reservations,
    counts,
    world: inventorySha256(
      canonicalNormalizedJson([
        "inventory-world-components-v2",
        world.revision,
        catalog,
        projection,
        reservations,
        counts,
      ])
    ),
  };
  if (cacheable) inventoryWorldRootsCache.set(world, roots);
  return roots;
}

/** Verify and hash one persisted catalogue snapshot without trusting its digest field. */
export function inventoryCatalogSnapshotDigest(
  snapshot: InventoryCatalogSnapshot
): string {
  const cacheable = inventoryObjectIsDeeplyImmutable(snapshot);
  const cached = cacheable ? inventoryCatalogDigestCache.get(snapshot) : undefined;
  if (cached !== undefined) return cached;
  const digest = inventoryCatalogFromSnapshot(snapshot).digest;
  if (cacheable) inventoryCatalogDigestCache.set(snapshot, digest);
  return digest;
}

/** Hash one event/current-stock/placement/traceability projection in key-sorted row order. */
export function inventoryProjectionDigest(
  projection: InventoryProjectionState
): string {
  const cacheable = inventoryObjectIsDeeplyImmutable(projection);
  const cached = cacheable ? inventoryProjectionDigestCache.get(projection) : undefined;
  if (cached !== undefined) return cached;
  const digest = inventorySha256(
    canonicalNormalizedJson([
      "inventory-projection-components-v2",
      projection.lastRecordSequence,
      inventoryImmutableRecordDigest(projection.positions),
      inventoryImmutableRecordDigest(projection.positionIdsByItemId),
      inventoryImmutableRecordDigest(projection.positionIdsByItemRevisionId),
      inventoryImmutableRecordDigest(projection.positionIdsByPlacementNodeId),
      inventoryImmutableRecordDigest(
        projection.positiveLayerStartedAtEpochMsByPositionId
      ),
      inventoryImmutableRecordDigest(
        projection.positivePositionIdBySerialIdentity
      ),
      inventoryImmutableRecordDigest(projection.placementNodes),
      inventoryImmutableRecordDigest(
        projection.placementNodeIdByEmbodiedSerialIdentity
      ),
      inventoryImmutableRecordDigest(
        projection.placementNodeRootEventIdByNodeId
      ),
      inventoryImmutableRecordDigest(projection.lots),
      inventoryImmutableRecordDigest(projection.lotIdentitiesByItemId),
      inventoryImmutableRecordDigest(projection.lotRootEventIdByIdentity),
      inventoryImmutableRecordDigest(projection.transfers),
      inventoryImmutableRecordDigest(projection.events),
      inventoryImmutableRecordDigest(projection.eventIdsBySequence),
      inventoryImmutableRecordDigest(projection.eventSequencesByWhereaboutsId),
      inventoryImmutableRecordDigest(projection.eventIdByOperationId),
      inventoryImmutableRecordDigest(
        projection.correctionEventIdByCorrectedEventId
      ),
      inventoryImmutableRecordDigest(projection.placement.relationByNodeId),
      inventoryImmutableRecordDigest(
        projection.placement.childNodeIdsByParentNodeId
      ),
      inventoryImmutableRecordDigest(projection.traceability.relations),
    ])
  );
  if (cacheable) inventoryProjectionDigestCache.set(projection, digest);
  return digest;
}

/** Hash the complete reservation book in stable identity order. */
export function inventoryReservationBookDigest(
  book: InventoryReservationBook
): string {
  const cacheable = inventoryObjectIsDeeplyImmutable(book);
  const cached = cacheable ? inventoryReservationDigestCache.get(book) : undefined;
  if (cached !== undefined) return cached;
  const digest = inventorySha256(
    canonicalNormalizedJson([
      "inventory-reservation-components-v2",
      inventoryImmutableRecordDigest(book.reservations),
      inventoryImmutableRecordDigest(book.operations),
    ])
  );
  if (cacheable) inventoryReservationDigestCache.set(book, digest);
  return digest;
}

/** Hash the complete count book in stable identity order. */
export function inventoryCountBookDigest(book: InventoryCountBook): string {
  const cacheable = inventoryObjectIsDeeplyImmutable(book);
  const cached = cacheable ? inventoryCountDigestCache.get(book) : undefined;
  if (cached !== undefined) return cached;
  const digest = inventorySha256(
    canonicalNormalizedJson([
      "inventory-count-components-v2",
      inventoryImmutableRecordDigest(book.counts),
      inventoryImmutableRecordDigest(book.operations),
    ])
  );
  if (cacheable) inventoryCountDigestCache.set(book, digest);
  return digest;
}

/** Hash one immutable sparse record, reusing copy-on-write ancestry by changed key. */
function inventoryImmutableRecordDigest(
  record: Readonly<Record<string, NormalizedJsonComparable>>
): string {
  return inventoryImmutableRecordAggregate(record).digest;
}

/** Derive one authenticated record aggregate from all entries or one immutable base delta. */
function inventoryImmutableRecordAggregate(
  record: Readonly<Record<string, NormalizedJsonComparable>>
): InventoryRecordDigestAggregate {
  const lineage = inventorySparseRecordLineage(record);
  const cacheable = inventoryObjectIsDeeplyImmutable(record);
  const cached = inventoryRecordDigestCache.get(record);
  if (
    cached !== undefined &&
    ((lineage === undefined && cacheable && cached.lineageRevision === undefined) ||
      (lineage !== undefined && cached.lineageRevision === lineage.revision))
  ) {
    return cached.aggregate;
  }
  let count = 0;
  let primarySum = 0n;
  let secondarySum = 0n;
  if (
    lineage !== undefined &&
    inventoryObjectIsDeeplyImmutable(lineage.base)
  ) {
    const base = inventoryImmutableRecordAggregate(lineage.base);
    count = base.count;
    primarySum = base.primarySum;
    secondarySum = base.secondarySum;
    for (const key of lineage.changedKeys) {
      if (inventorySparseRecordHas(lineage.base, key)) {
        const value = Reflect.get(lineage.base, key) as NormalizedJsonComparable;
        const leaf = inventoryRecordLeafAggregate(key, value);
        count -= 1;
        primarySum = inventoryNormalizeRecordDigestSum(
          primarySum - leaf.primary
        );
        secondarySum = inventoryNormalizeRecordDigestSum(
          secondarySum - leaf.secondary
        );
      }
      if (inventorySparseRecordHas(record, key)) {
        const value = Reflect.get(record, key) as NormalizedJsonComparable;
        const leaf = inventoryRecordLeafAggregate(key, value);
        count += 1;
        primarySum = inventoryNormalizeRecordDigestSum(
          primarySum + leaf.primary
        );
        secondarySum = inventoryNormalizeRecordDigestSum(
          secondarySum + leaf.secondary
        );
      }
    }
  } else {
    for (const [key, value] of Object.entries(record)) {
      const leaf = inventoryRecordLeafAggregate(key, value);
      count += 1;
      primarySum = inventoryNormalizeRecordDigestSum(
        primarySum + leaf.primary
      );
      secondarySum = inventoryNormalizeRecordDigestSum(
        secondarySum + leaf.secondary
      );
    }
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Inventory record digest entry count is invalid.");
  }
  const aggregate: InventoryRecordDigestAggregate = {
    count,
    primarySum,
    secondarySum,
    digest: inventorySha256(
      canonicalNormalizedJson([
        "inventory-record-multiset-v1",
        count,
        inventoryRecordDigestHex(primarySum),
        inventoryRecordDigestHex(secondarySum),
      ])
    ),
  };
  if (cacheable || lineage !== undefined) {
    inventoryRecordDigestCache.set(record, {
      aggregate,
      ...(lineage === undefined ? {} : { lineageRevision: lineage.revision }),
    });
  }
  return aggregate;
}

/** Return two independent leaf values binding one exact key to its retained value digest. */
function inventoryRecordLeafAggregate(
  key: string,
  value: NormalizedJsonComparable
): {
  /** First domain-separated 256-bit aggregate leaf. */
  readonly primary: bigint;
  /** Second independently domain-separated 256-bit aggregate leaf. */
  readonly secondary: bigint;
} {
  const valueDigest = inventoryImmutableValueDigest(value);
  return {
    primary: BigInt(
      `0x${inventorySha256(
        canonicalNormalizedJson([
          "inventory-record-leaf-primary-v1",
          key,
          valueDigest,
        ])
      )}`
    ),
    secondary: BigInt(
      `0x${inventorySha256(
        canonicalNormalizedJson([
          "inventory-record-leaf-secondary-v1",
          key,
          valueDigest,
        ])
      )}`
    ),
  };
}

/** Normalize one signed modular sum into the canonical unsigned 256-bit domain. */
function inventoryNormalizeRecordDigestSum(value: bigint): bigint {
  const normalized = value % inventoryRecordDigestModulus;
  return normalized < 0n
    ? normalized + inventoryRecordDigestModulus
    : normalized;
}

/** Encode one 256-bit aggregate value as exactly 64 lower-case hexadecimal digits. */
function inventoryRecordDigestHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** Hash one immutable retained value once so new record roots reuse unchanged large rows. */
function inventoryImmutableValueDigest(
  value: NormalizedJsonComparable
): string {
  if (Array.isArray(value)) {
    const identitySet = inventorySortedIdentitySetAggregate(value);
    if (identitySet !== undefined) return identitySet.digest;
  }
  if (value !== null && typeof value === "object") {
    const cacheable = inventoryObjectIsDeeplyImmutable(value);
    const cached = cacheable ? inventoryValueDigestCache.get(value) : undefined;
    if (cached !== undefined) return cached;
    const digest = inventorySha256(canonicalNormalizedJson(value));
    if (cacheable) inventoryValueDigestCache.set(value, digest);
    return digest;
  }
  return inventorySha256(canonicalNormalizedJson(value));
}

/** Hash one canonical sorted unique identity-set array with optional changed-id lineage. */
function inventorySortedIdentitySetAggregate(
  value: readonly unknown[]
): InventoryRecordDigestAggregate | undefined {
  const lineage = inventorySortedIdentitySetLineage(value);
  const cacheable = inventoryObjectIsDeeplyImmutable(value);
  const cached = cacheable
    ? inventoryIdentitySetDigestCache.get(value)
    : undefined;
  if (cached !== undefined) return cached;
  let count = 0;
  let primarySum = 0n;
  let secondarySum = 0n;
  if (lineage !== undefined) {
    const base = inventorySortedIdentitySetAggregate(lineage.base);
    if (base === undefined) {
      throw new Error(
        "Inventory sorted identity-set lineage base is not canonical."
      );
    }
    count = base.count;
    primarySum = base.primarySum;
    secondarySum = base.secondarySum;
    for (const identity of lineage.removed) {
      const leaf = inventoryIdentitySetLeafAggregate(identity);
      count -= 1;
      primarySum = inventoryNormalizeRecordDigestSum(
        primarySum - leaf.primary
      );
      secondarySum = inventoryNormalizeRecordDigestSum(
        secondarySum - leaf.secondary
      );
    }
    for (const identity of lineage.added) {
      const leaf = inventoryIdentitySetLeafAggregate(identity);
      count += 1;
      primarySum = inventoryNormalizeRecordDigestSum(
        primarySum + leaf.primary
      );
      secondarySum = inventoryNormalizeRecordDigestSum(
        secondarySum + leaf.secondary
      );
    }
  } else {
    let previous: string | undefined;
    for (const child of value) {
      if (
        typeof child !== "string" ||
        (previous !== undefined &&
          compareInventoryIdentityText(previous, child) >= 0)
      ) {
        return undefined;
      }
      const leaf = inventoryIdentitySetLeafAggregate(child);
      count += 1;
      primarySum = inventoryNormalizeRecordDigestSum(
        primarySum + leaf.primary
      );
      secondarySum = inventoryNormalizeRecordDigestSum(
        secondarySum + leaf.secondary
      );
      previous = child;
    }
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Inventory identity-set digest entry count is invalid.");
  }
  const aggregate: InventoryRecordDigestAggregate = {
    count,
    primarySum,
    secondarySum,
    digest: inventorySha256(
      canonicalNormalizedJson([
        "inventory-sorted-identity-set-v1",
        count,
        inventoryRecordDigestHex(primarySum),
        inventoryRecordDigestHex(secondarySum),
      ])
    ),
  };
  if (cacheable) inventoryIdentitySetDigestCache.set(value, aggregate);
  return aggregate;
}

/** Return two independent 256-bit leaf values for one exact identity-set member. */
function inventoryIdentitySetLeafAggregate(identity: string): {
  /** First domain-separated 256-bit identity-set leaf. */
  readonly primary: bigint;
  /** Second independently domain-separated 256-bit identity-set leaf. */
  readonly secondary: bigint;
} {
  return {
    primary: BigInt(
      `0x${inventorySha256(
        canonicalNormalizedJson([
          "inventory-identity-set-leaf-primary-v1",
          identity,
        ])
      )}`
    ),
    secondary: BigInt(
      `0x${inventorySha256(
        canonicalNormalizedJson([
          "inventory-identity-set-leaf-secondary-v1",
          identity,
        ])
      )}`
    ),
  };
}

/** Extract and validate the one legal append-only reservation change in a planner result. */
export function createInventoryReservationBookDelta(
  base: InventoryReservationBook,
  next: InventoryReservationBook,
  operationId: string,
  reservationId: string | undefined,
  placement?: InventoryPlacementState
): InventoryReservationBookDelta | undefined {
  retainEveryReservationOperation(base, next);
  const addedOperationIds = addedRecordKeys(base.operations, next.operations);
  if (addedOperationIds.length === 0) {
    if (!sameJson(base, next) || reservationId !== undefined) {
      throw new Error(
        "Inventory reservation planner changed rows without one new lifecycle operation."
      );
    }
    return undefined;
  }
  if (addedOperationIds.length !== 1 || addedOperationIds[0] !== operationId) {
    throw new Error(
      "Inventory reservation planner must append exactly its own lifecycle operation."
    );
  }
  const operation = inventorySparseRecordValue(next.operations, operationId);
  if (operation === undefined || operation.reservationId !== reservationId) {
    throw new Error(
      "Inventory reservation receipt must name the row changed by its lifecycle operation."
    );
  }
  const reservation = inventorySparseRecordValue(next.reservations, operation.reservationId);
  if (reservation === undefined) {
    throw new Error(
      "Inventory reservation lifecycle operation references a missing row."
    );
  }
  retainUnchangedReservationRows(base, next, operation.reservationId);
  assertAllowedReservationTransition(
    inventorySparseRecordValue(base.reservations, operation.reservationId),
    reservation,
    operation,
    placement
  );
  return { reservation, operation };
}

/** Apply one already-validated reservation delta and recheck it against this exact base book. */
export function applyInventoryReservationBookDelta(
  base: InventoryReservationBook,
  delta: InventoryReservationBookDelta | undefined,
  placement?: InventoryPlacementState
): InventoryReservationBook {
  if (delta === undefined) return base;
  const reservations = cloneInventorySparseRecord(base.reservations);
  setInventorySparseRecordValue(
    reservations,
    delta.reservation.reservationId,
    delta.reservation
  );
  const operations = cloneInventorySparseRecord(base.operations);
  setInventorySparseRecordValue(
    operations,
    delta.operation.operationId,
    delta.operation
  );
  const next: InventoryReservationBook = { reservations, operations };
  createInventoryReservationBookDelta(
    base,
    next,
    delta.operation.operationId,
    delta.reservation.reservationId,
    placement
  );
  return next;
}

/** Extract and validate the one legal append-only count change in a planner result. */
export function createInventoryCountBookDelta(
  base: InventoryCountBook,
  next: InventoryCountBook,
  operationId: string,
  countId: string | undefined
): InventoryCountBookDelta | undefined {
  retainEveryCountOperation(base, next);
  const addedOperationIds = addedRecordKeys(base.operations, next.operations);
  if (addedOperationIds.length === 0) {
    if (!sameJson(base, next) || countId !== undefined) {
      throw new Error(
        "Inventory count planner changed rows without one new lifecycle operation."
      );
    }
    return undefined;
  }
  if (addedOperationIds.length !== 1 || addedOperationIds[0] !== operationId) {
    throw new Error(
      "Inventory count planner must append exactly its own lifecycle operation."
    );
  }
  const operation = inventorySparseRecordValue(next.operations, operationId);
  if (operation === undefined || operation.countId !== countId) {
    throw new Error(
      "Inventory count receipt must name the row changed by its lifecycle operation."
    );
  }
  const count = inventorySparseRecordValue(next.counts, operation.countId);
  if (count === undefined)
    throw new Error(
      "Inventory count lifecycle operation references a missing row."
    );
  retainUnchangedCountRows(base, next, operation.countId);
  assertAllowedCountTransition(
    inventorySparseRecordValue(base.counts, operation.countId),
    count,
    operation
  );
  return { count, operation };
}

/** Apply one already-validated count delta and recheck it against this exact base book. */
export function applyInventoryCountBookDelta(
  base: InventoryCountBook,
  delta: InventoryCountBookDelta | undefined
): InventoryCountBook {
  if (delta === undefined) return base;
  const counts = cloneInventorySparseRecord(base.counts);
  setInventorySparseRecordValue(counts, delta.count.countId, delta.count);
  const operations = cloneInventorySparseRecord(base.operations);
  setInventorySparseRecordValue(
    operations,
    delta.operation.operationId,
    delta.operation
  );
  const next: InventoryCountBook = { counts, operations };
  createInventoryCountBookDelta(
    base,
    next,
    delta.operation.operationId,
    delta.count.countId
  );
  return next;
}

/** Return the exact plan digest covering its base, catalogue, deltas, event, receipt, and next roots. */
export function inventoryDurablePlanDigest(parts: {
  /** Exact base-world content root. */
  readonly baseWorldRoot: string;
  /** Exact retained catalogue root used to validate and replay the plan. */
  readonly catalogRoot: string;
  /** Explicit negative-stock replay policy frozen with the plan. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Optional immutable committed event delta. */
  readonly event?: InventoryCommittedEvent;
  /** Optional single reservation lifecycle delta. */
  readonly reservationDelta?: InventoryReservationBookDelta;
  /** Optional single count lifecycle delta. */
  readonly countDelta?: InventoryCountBookDelta;
  /** Frozen replay receipt. */
  readonly receipt: {
    /** Stable operation identity. */
    readonly operationId: string;
    /** Frozen durable record time. */
    readonly recordedAtEpochMs: number;
    /** Published world revision after this plan. */
    readonly worldRevision: number;
    /** Optional committed event identity. */
    readonly eventId?: string;
    /** Optional changed reservation identity. */
    readonly reservationId?: string;
    /** Optional changed count identity. */
    readonly countId?: string;
  };
  /** Exact roots expected after applying this compact plan. */
  readonly nextRoots: InventoryWorldContentRoots;
}): string {
  return inventorySha256(
    canonicalNormalizedJson([
      parts.baseWorldRoot,
      parts.catalogRoot,
      parts.deficitPolicy,
      parts.event ?? null,
      parts.reservationDelta ?? null,
      parts.countDelta ?? null,
      parts.receipt,
      parts.nextRoots,
    ])
  );
}

/** Hash one complete migration batch plan without storing a duplicate next-world snapshot. */
export function inventoryDurableMigrationPlanDigest(parts: {
  /** Exact target-world content root used for validation. */
  readonly baseWorldRoot: string;
  /** Exact retained catalogue root used to interpret every event. */
  readonly catalogRoot: string;
  /** Explicit negative-stock policy for legacy physical truth. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Complete committed migration event batch in final durable order. */
  readonly events: readonly InventoryCommittedEvent[];
  /** Canonical non-physical source dispositions retained through completion. */
  // Keep the digest primitive structural rather than coupling integrity to migration types.
  readonly sourceDispositions: readonly unknown[];
  /** Exact roots expected after the one visible migration cut. */
  readonly nextRoots: InventoryWorldContentRoots;
}): string {
  return inventorySha256(
    canonicalNormalizedJson([
      parts.baseWorldRoot,
      parts.catalogRoot,
      parts.deficitPolicy,
      parts.events,
      parts.sourceDispositions,
      parts.nextRoots,
    ])
  );
}

/** Keep all earlier immutable reservation operation evidence byte-for-byte equal. */
function retainEveryReservationOperation(
  base: InventoryReservationBook,
  next: InventoryReservationBook
): void {
  for (const [operationId, operation] of Object.entries(base.operations)) {
    if (!sameJson(operation, inventorySparseRecordValue(next.operations, operationId))) {
      throw new Error(
        "Inventory reservation planner deleted or changed append-only operation evidence."
      );
    }
  }
}

/** Keep every reservation row except the row named by the new operation unchanged. */
function retainUnchangedReservationRows(
  base: InventoryReservationBook,
  next: InventoryReservationBook,
  changedReservationId: string
): void {
  for (const [reservationId, reservation] of Object.entries(
    base.reservations
  )) {
    if (reservationId === changedReservationId) continue;
    if (!sameJson(reservation, inventorySparseRecordValue(next.reservations, reservationId))) {
      throw new Error(
        "Inventory reservation planner changed or deleted an unrelated row."
      );
    }
  }
  for (const reservationId of Object.keys(next.reservations)) {
    if (
      reservationId !== changedReservationId &&
      inventorySparseRecordValue(base.reservations, reservationId) === undefined
    ) {
      throw new Error(
        "Inventory reservation planner added a row not named by its lifecycle operation."
      );
    }
  }
}

/** Check the exact status/field shape allowed by each reservation lifecycle operation. */
function assertAllowedReservationTransition(
  base: InventoryReservation | undefined,
  next: InventoryReservation,
  operation: InventoryReservationOperation,
  placement?: InventoryPlacementState
): void {
  if (
    operation.kind !== InventoryReservationOperationKind.Consume &&
    next.consumptionEventId !== undefined
  ) {
    throw new Error(
      "Only reservation consumption may attach a consumption event."
    );
  }
  if (operation.kind === InventoryReservationOperationKind.Create) {
    if (
      base !== undefined ||
      next.status !== InventoryReservationStatus.Active
    ) {
      throw new Error("Reservation create must add one new active row.");
    }
    return;
  }
  if (base === undefined || base.status !== InventoryReservationStatus.Active) {
    throw new Error(
      "Only an existing active reservation can receive another lifecycle operation."
    );
  }
  if (base.consumptionEventId !== undefined) {
    throw new Error(
      "Non-consumed reservation state cannot retain a consumption event."
    );
  }
  if (!sameReservationCreationFacts(base, next)) {
    throw new Error(
      "Reservation lifecycle operation changed frozen creation facts."
    );
  }
  if (operation.kind === InventoryReservationOperationKind.Refine) {
    if (
      next.status !== InventoryReservationStatus.Active ||
      !sameJson(base.allocations, next.allocations) ||
      !inventoryStockSelectorIsSubset(next.selector, base.selector, placement)
    )
      throw new Error(
        "Reservation refine may only narrow its selector and change time."
      );
    return;
  }
  if (operation.kind === InventoryReservationOperationKind.Allocate) {
    if (
      next.status !== InventoryReservationStatus.Active ||
      !sameJson(base.selector, next.selector)
    ) {
      throw new Error(
        "Reservation allocation may only replace exact bindings and change time."
      );
    }
    return;
  }
  if (
    !sameJson(base.selector, next.selector) ||
    !sameJson(base.allocations, next.allocations)
  ) {
    throw new Error(
      "Closing a reservation cannot change its selector or exact bindings."
    );
  }
  const expectedStatus =
    operation.kind === InventoryReservationOperationKind.Release
      ? InventoryReservationStatus.Released
      : operation.kind === InventoryReservationOperationKind.Expire
      ? InventoryReservationStatus.Expired
      : InventoryReservationStatus.Consumed;
  if (next.status !== expectedStatus) {
    throw new Error(
      "Reservation terminal operation and resulting status disagree."
    );
  }
  if (
    operation.kind === InventoryReservationOperationKind.Consume &&
    next.consumptionEventId === undefined
  ) {
    throw new Error("Consumed reservation must attach a consumption event.");
  }
}

/** Compare every reservation creation fact that later lifecycle actions must retain. */
function sameReservationCreationFacts(
  left: InventoryReservation,
  right: InventoryReservation
): boolean {
  return sameJson(
    [
      left.reservationId,
      left.operationId,
      left.itemRevisionId,
      left.requested,
      left.createdAtEpochMs,
      left.expiresAtEpochMs ?? null,
      left.allowExpiredStock ?? false,
      left.sourceReference ?? null,
      left.actorId ?? null,
      left.metadata ?? null,
    ],
    [
      right.reservationId,
      right.operationId,
      right.itemRevisionId,
      right.requested,
      right.createdAtEpochMs,
      right.expiresAtEpochMs ?? null,
      right.allowExpiredStock ?? false,
      right.sourceReference ?? null,
      right.actorId ?? null,
      right.metadata ?? null,
    ]
  );
}

/** Keep all earlier immutable count operation evidence byte-for-byte equal. */
function retainEveryCountOperation(
  base: InventoryCountBook,
  next: InventoryCountBook
): void {
  for (const [operationId, operation] of Object.entries(base.operations)) {
    if (!sameJson(operation, inventorySparseRecordValue(next.operations, operationId))) {
      throw new Error(
        "Inventory count planner deleted or changed append-only operation evidence."
      );
    }
  }
}

/** Keep every count row except the row named by the new operation unchanged. */
function retainUnchangedCountRows(
  base: InventoryCountBook,
  next: InventoryCountBook,
  changedCountId: string
): void {
  for (const [countId, count] of Object.entries(base.counts)) {
    if (countId === changedCountId) continue;
    if (!sameJson(count, inventorySparseRecordValue(next.counts, countId))) {
      throw new Error(
        "Inventory count planner changed or deleted an unrelated row."
      );
    }
  }
  for (const countId of Object.keys(next.counts)) {
    if (countId !== changedCountId && inventorySparseRecordValue(base.counts, countId) === undefined) {
      throw new Error(
        "Inventory count planner added a row not named by its lifecycle operation."
      );
    }
  }
}

/** Check the exact status order and retained fields allowed by each count lifecycle operation. */
function assertAllowedCountTransition(
  base: InventoryCount | undefined,
  next: InventoryCount,
  operation: InventoryCountOperation
): void {
  if (
    operation.kind !== InventoryCountOperationKind.Complete &&
    next.reconciliationEventId !== undefined
  ) {
    throw new Error("Only count completion may attach a reconciliation event.");
  }
  if (
    base !== undefined &&
    base.status !== InventoryCountStatus.Completed &&
    base.reconciliationEventId !== undefined
  ) {
    throw new Error("Non-completed count state cannot retain a reconciliation event.");
  }
  if (operation.kind === InventoryCountOperationKind.Start) {
    if (base !== undefined || next.status !== InventoryCountStatus.Started) {
      throw new Error("Count start must add one new started row.");
    }
    return;
  }
  if (base === undefined || !sameCountStartFacts(base, next)) {
    throw new Error("Count lifecycle operation changed frozen start facts.");
  }
  if (operation.kind === InventoryCountOperationKind.Observe) {
    if (
      base.status !== InventoryCountStatus.Started ||
      next.status !== InventoryCountStatus.Observed
    ) {
      throw new Error(
        "Count observation must move one started row to observed."
      );
    }
    return;
  }
  if (operation.kind === InventoryCountOperationKind.Complete) {
    if (
      base.status !== InventoryCountStatus.Observed ||
      next.status !== InventoryCountStatus.Completed
    ) {
      throw new Error(
        "Count completion must move one observed row to completed."
      );
    }
    if (
      !sameJson(base.observations, next.observations) ||
      base.observedAtEpochMs !== next.observedAtEpochMs ||
      base.observedThroughRecordSequence !== next.observedThroughRecordSequence
    ) {
      throw new Error(
        "Count completion cannot replace the physical observation."
      );
    }
    return;
  }
  if (
    (base.status !== InventoryCountStatus.Started &&
      base.status !== InventoryCountStatus.Observed) ||
    next.status !== InventoryCountStatus.Abandoned
  )
    throw new Error("Count abandon must make one non-terminal row abandoned.");
  if (
    !sameJson(base.observations, next.observations) ||
    base.observedAtEpochMs !== next.observedAtEpochMs ||
    base.observedThroughRecordSequence !== next.observedThroughRecordSequence
  ) {
    throw new Error(
      "Count abandonment cannot replace the physical observation."
    );
  }
}

/** Compare the count fields frozen when the count was opened. */
function sameCountStartFacts(
  left: InventoryCount,
  right: InventoryCount
): boolean {
  return sameJson(
    [
      left.countId,
      left.operationId,
      left.itemRevisionId,
      left.selector,
      left.startedAtEpochMs,
      left.snapshotRecordSequence,
      left.actorId ?? null,
      left.sourceReference ?? null,
    ],
    [
      right.countId,
      right.operationId,
      right.itemRevisionId,
      right.selector,
      right.startedAtEpochMs,
      right.snapshotRecordSequence,
      right.actorId ?? null,
      right.sourceReference ?? null,
    ]
  );
}

/** Return keys present only in the next record in stable identity order. */
function addedRecordKeys<T>(
  base: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>
): string[] {
  const added: string[] = [];
  for (const key of Object.keys(next)) {
    if (inventorySparseRecordValue(base, key) === undefined) added.push(key);
  }
  added.sort();
  return added;
}

/** JSON-safe normalized value compared without relying on object insertion order. */
type NormalizedJsonComparable = object | string | number | boolean | null | undefined;

/** Compare already-normalized typed values exactly without accepting coercion or object-key order. */
function sameJson(left: object, right: object | undefined): boolean {
  return right !== undefined && sameNormalizedJsonValue(left, right);
}

/** Compare one normalized JSON value recursively while preserving array order and ignoring omitted undefined fields. */
function sameNormalizedJsonValue(
  left: NormalizedJsonComparable,
  right: NormalizedJsonComparable
): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameNormalizedJsonValue(left[index], right[index])) return false;
    }
    return true;
  }
  const leftKeys = normalizedJsonObjectKeys(left);
  const rightKeys = normalizedJsonObjectKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftValue = Object.getOwnPropertyDescriptor(left, key)?.value;
    const rightValue = Object.getOwnPropertyDescriptor(right, key)?.value;
    if (!sameNormalizedJsonValue(leftValue, rightValue)) return false;
  }
  return true;
}

/** Return own JSON object keys whose values survive ordinary JSON serialization. */
function normalizedJsonObjectKeys(value: object): string[] {
  const result: string[] = [];
  for (const key of Object.keys(value)) {
    if (Object.getOwnPropertyDescriptor(value, key)?.value !== undefined) result.push(key);
  }
  return result;
}

/** Serialize one normalized JSON value with recursively sorted object keys and ordinary JSON omission semantics. */
function canonicalNormalizedJson(value: NormalizedJsonComparable): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Normalized durable JSON contains an unsupported primitive.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(
      /** Canonicalize one array child without changing its position. */
      (child) => canonicalNormalizedJson(child)
    ).join(",")}]`;
  }
  const keys = normalizedJsonObjectKeys(value);
  keys.sort();
  const fields: string[] = [];
  for (const key of keys) {
    const child = Object.getOwnPropertyDescriptor(value, key)?.value;
    fields.push(`${JSON.stringify(key)}:${canonicalNormalizedJson(child)}`);
  }
  return `{${fields.join(",")}}`;
}

/** Turn one normalized typed record into stable key-sorted rows independent of nested object insertion order. */
function sortedRecordRows<T>(
  values: Readonly<Record<string, T>>
): readonly string[] {
  const keys = Object.keys(values);
  keys.sort();
  const rows: string[] = [];
  for (const key of keys) rows.push(canonicalNormalizedJson([key, values[key]]));
  return rows;
}
