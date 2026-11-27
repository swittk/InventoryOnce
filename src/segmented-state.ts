import type { InMemoryInventorySegmentedPlacementStore } from "./segmented-placement.js";
import { candidateSubtreePositionIds } from "./stock-scope.js";
import { assertInventoryActiveSerialQuantity } from "./stock-amount-rules.js";
import { assertInventoryStockAgeOverride, captureConservedPositiveLayerStarts, inventoryConservedArrivalCanSettleDeficit } from "./stock-age.js";
import { inventoryIntentFingerprint } from "./canonical.js";
import type { InventoryCatalogSnapshot } from "./catalog.js";
import { inventorySha256 } from "./digest.js";
import {
  addInventoryMeasurements,
  assertInventoryMeasurementsFollowPrimarySign,
  inventoryMeasurementsAreZero,
  inventoryMeasurementsFingerprint,
  nonNegativeInventoryMeasurements,
  zeroInventoryMeasurements,
} from "./measurements.js";
import { InventoryDeficitPolicy } from "./projection.js";
import {
  inventorySerialIdentity,
  inventoryStockPositionIdentity,
  type InventoryStockPosition,
} from "./model.js";
import {
  InventoryEventKind,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
} from "./events.js";
import {
  cloneInventoryRetainedData,
  createInventorySparseRecord,
  setInventorySparseRecordValue,
} from "./sparse-record.js";
import {
  InventoryOptionalIdentityConstraintKind,
  inventoryStockPositionMatchesNormalizedSelector,
  normalizeInventoryStockSelector,
  type InventoryOptionalIdentityConstraint,
  type InventoryStockSelector,
} from "./selectors.js";

/** Resolve fallback subtree membership once per traversed parent edge. */
function inventorySegmentedNodeIsInSubtree(
  nodeId: string,
  placement: InMemoryInventorySegmentedPlacementStore,
  membership: Map<string, boolean>
): boolean {
  const alreadySelected = membership.get(nodeId);
  if (alreadySelected !== undefined) return alreadySelected;
  /** Uncached nodes whose answers come from the next known ancestor. */
  const visited: string[] = [];
  let current: string | undefined = nodeId;
  let selected = false;
  while (current !== undefined) {
    const cached = membership.get(current);
    if (cached !== undefined) {
      selected = cached;
      break;
    }
    visited.push(current);
    current = placement.parentNodeId(current);
  }
  for (const node of visited) membership.set(node, selected);
  return selected;
}

/** Adapter-local segmented reads may be synchronous in-process or asynchronous for remote databases. */
export type InventorySegmentedResult<T> = T | Promise<T>;

/** Atomic exact stock-effect application against one fenced position-segment revision. */
export interface ApplyInventorySegmentedStockEffectsInput {
  /** Segment revision the semantic event was planned against. */
  readonly expectedRevision: number;
  /** Next published revision after applying the event. */
  readonly nextRevision: number;
  /** Committed event whose signed effects and FIFO origins publish together. */
  readonly event: InventoryCommittedEvent;
  /** Whether this command may leave a signed physical deficit. */
  readonly deficitPolicy: InventoryDeficitPolicy;
}

/** Inputs for one adapter-native stock or direct-contents event commit. */
export interface CommitInventorySegmentedStockEventInput {
  /** Exact retained catalogue snapshot used to validate this event. */
  readonly catalog: InventoryCatalogSnapshot;
  /** Stable operation/idempotency identity. */
  readonly operationId: string;
  /** Frozen semantic intent fingerprint. */
  readonly intentFingerprint: string;
  /** Durable record time selected by the InventoryOnce clock. */
  readonly recordedAtEpochMs: number;
  /** Optional exact published world revision used to derive a state-dependent event. */
  readonly expectedWorldRevision?: number;
  /** Optional exact event-journal head used to derive a state-dependent event. */
  readonly expectedRecordSequence?: number;
  /** Whether this command may leave a signed physical deficit. */
  readonly deficitPolicy: InventoryDeficitPolicy;
  /** Domain-validated stock or direct-contents placement event draft. */
  readonly event: InventoryEventDraft;
}

/** Result of one adapter-native stock or direct-contents event commit or replay. */
export interface CommitInventorySegmentedStockEventResult {
  /** Exact published world revision for this operation. */
  readonly worldRevision: number;
  /** Durable record time frozen with the operation. */
  readonly recordedAtEpochMs: number;
  /** Committed event retained for result/replay/materialization. */
  readonly event: InventoryCommittedEvent;
  /** True when the exact operation identity already committed earlier. */
  readonly replayed: boolean;
}

/** Optional storage capability for one stock or direct-contents event without whole-world materialization. */
export interface InventorySegmentedStockEventCommitCapability {
  /**
   * Commit stock effects and direct-contents placement changes as one atomic event.
   * A direct-contents placement event may contain only child placement changes.
   * Return undefined without publishing any part when the event needs the canonical whole-world coordinator.
   */
  commitSegmentedStockEvent(
    input: CommitInventorySegmentedStockEventInput
  ): InventorySegmentedResult<CommitInventorySegmentedStockEventResult | undefined>;
}

/** Return whether storage exposes the optional segmented stock commit capability. */
export function inventoryStorageSupportsSegmentedStockEventCommit(
  value: unknown
): value is InventorySegmentedStockEventCommitCapability {
  if (value === null || typeof value !== "object") return false;
  return typeof Reflect.get(value, "commitSegmentedStockEvent") === "function";
}

/** Canonical flat materialization of the hot position/index segment for proof and export. */
export interface InventoryPositionSegmentMaterialization {
  /** Current non-zero stock rows keyed by exact position identity. */
  readonly positions: Readonly<Record<string, InventoryStockPosition>>;
  /** Exact position identities grouped by stable item identity. */
  readonly positionIdsByItemId: Readonly<Record<string, readonly string[]>>;
  /** Exact position identities grouped by immutable item revision. */
  readonly positionIdsByItemRevisionId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Exact position identities grouped by direct placement node. */
  readonly positionIdsByPlacementNodeId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Exact position identities grouped by unresolved whereabouts cohort. */
  readonly positionIdsByWhereaboutsId: Readonly<
    Record<string, readonly string[]>
  >;
  /** Positive exact position by item-scoped serial identity. */
  readonly positivePositionIdBySerialIdentity: Readonly<Record<string, string>>;
}

/** One atomic set of exact position removals/upserts against a fenced segment revision. */
export interface ApplyInventorySegmentedPositionDeltaInput {
  /** Segment revision the semantic planner read. */
  readonly expectedRevision: number;
  /** Next published global/segment revision after this atomic delta. */
  readonly nextRevision: number;
  /** Exact position identities that must currently exist and be removed. */
  readonly removePositionIds?: readonly string[];
  /** Complete current rows to insert or replace by their deterministic identities. */
  readonly upsertPositions?: readonly InventoryStockPosition[];
  /** Exact FIFO starts for changed positive rows, including provenance-only corrections. */
  readonly positiveLayerStarts?: ReadonlyMap<string, number>;
}

/** Result of one atomic segmented position delta. */
export interface ApplyInventorySegmentedPositionDeltaResult {
  /** New segment revision after successful commit. */
  readonly revision: number;
  /** Exact identities removed from the segment. */
  readonly removedPositionIds: readonly string[];
  /** Exact identities inserted/replaced in the segment. */
  readonly upsertedPositionIds: readonly string[];
}

/** Inputs for one exact source-row -> destination-row transactional replacement. */
export interface ReplaceInventorySegmentedPositionInput {
  /** Segment revision the caller planned against. */
  readonly expectedRevision: number;
  /** Exact current source position identity. */
  readonly fromPositionId: string;
  /** Complete replacement row after the semantic movement/reclassification. */
  readonly to: InventoryStockPosition;
}

/** Result of one exact segmented position replacement. */
export interface ReplaceInventorySegmentedPositionResult {
  /** New segment revision after successful commit. */
  readonly revision: number;
  /** Exact source identity removed. */
  readonly fromPositionId: string;
  /** Exact destination identity inserted. */
  readonly toPositionId: string;
}

/** Read-only indexed hot-state view that planners can use without materializing one whole world. */
export interface InventorySegmentedPositionReader {
  /** Current atomic segment revision used as an optimistic transaction fence. */
  revision(): InventorySegmentedResult<number>;
  /** Authenticated root of the exact current position rows without materializing them. */
  contentRoot(): InventorySegmentedResult<string>;
  /** Read one exact stock row by deterministic position identity. */
  position(
    positionId: string
  ): InventorySegmentedResult<InventoryStockPosition | undefined>;
  /** Read the one active positive serialized row when present. */
  positivePositionBySerial(
    itemId: string,
    serialId: string
  ): InventorySegmentedResult<InventoryStockPosition | undefined>;
  /** Enumerate current exact positions for one item through the retained item index. */
  positionsByItem(
    itemId: string
  ): InventorySegmentedResult<readonly InventoryStockPosition[]>;
  /** Enumerate current exact positions for one item revision through the retained revision index. */
  positionsByItemRevision(
    itemRevisionId: string
  ): InventorySegmentedResult<readonly InventoryStockPosition[]>;
  /** Enumerate current exact positions anchored directly at one placement node. */
  positionsByPlacement(
    placementNodeId: string
  ): InventorySegmentedResult<readonly InventoryStockPosition[]>;
  /**
   * Execute one direct-position selector using adapter-native indexes.
   * Return undefined when the selector needs placement ancestry unavailable to this segment.
   */
  queryPositions(
    selector: InventoryStockSelector
  ): InventorySegmentedResult<readonly InventoryStockPosition[] | undefined>;
  /** Explicitly materialize the canonical flat position/index view for export and proof. */
  materialize(): InventorySegmentedResult<InventoryPositionSegmentMaterialization>;
}

/** Optional storage capability exposing indexed hot-state reads to kernel planners. */
export interface InventorySegmentedPositionStorageCapability {
  /** Read the current position segment at its published revision. */
  readPositionSegment(): InventorySegmentedResult<InventorySegmentedPositionReader>;
}

/** Return whether one storage object exposes the optional segmented position read capability. */
export function inventoryStorageSupportsSegmentedPositions(
  value: unknown
): value is InventorySegmentedPositionStorageCapability {
  if (value === null || typeof value !== "object") return false;
  return typeof Reflect.get(value, "readPositionSegment") === "function";
}

/** Result of one coherent segmented read attempt across one stable published revision. */
export interface InventorySegmentedPositionSnapshotRead<Result> {
  /** True only when revision stayed unchanged for the complete read callback. */
  readonly coherent: boolean;
  /** Callback result when one coherent attempt succeeded. */
  readonly value?: Result;
}

/**
 * Read one logical result across a single segmented revision.
 * Async adapters may retry when publication interleaves; callers can fall back after bounded attempts.
 */
export async function readInventorySegmentedPositionSnapshot<Result>(
  storage: InventorySegmentedPositionStorageCapability,
  read: (
    segment: InventorySegmentedPositionReader
  ) => InventorySegmentedResult<Result>,
  maxAttempts = 3
): Promise<InventorySegmentedPositionSnapshotRead<Result>> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error(
      "Inventory segmented snapshot maxAttempts must be a positive safe integer."
    );
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const segment = await storage.readPositionSegment();
    const beforeRevision = await segment.revision();
    const value = await read(segment);
    const afterRevision = await segment.revision();
    if (beforeRevision === afterRevision) {
      return { coherent: true, value };
    }
  }
  return { coherent: false };
}

/** Indexed mutable position store that database adapters can implement transactionally. */
export interface InventorySegmentedPositionStore
  extends InventorySegmentedPositionReader {
  /** Atomically apply one storage-neutral position delta and update only touched indexes/roots. */
  applyDelta(
    input: ApplyInventorySegmentedPositionDeltaInput
  ): InventorySegmentedResult<ApplyInventorySegmentedPositionDeltaResult>;
  /** Apply one validated event's signed effects using retained FIFO starts for conserved source layers. */
  applyStockEffects(
    input: ApplyInventorySegmentedStockEffectsInput
  ): InventorySegmentedResult<ApplyInventorySegmentedPositionDeltaResult>;
  /** Atomically replace one exact row and update every position index touched by that row. */
  replaceExactPosition(
    input: ReplaceInventorySegmentedPositionInput
  ): InventorySegmentedResult<ReplaceInventorySegmentedPositionResult>;
  /** Materialize the canonical flat position/index view only when export or proof requests it. */
  materialize(): InventoryPositionSegmentMaterialization;
}

/** Inputs for constructing the reference segmented position store. */
export interface CreateInMemoryInventorySegmentedPositionStoreInput {
  /** Initial current positions; duplicates by exact identity are rejected. */
  readonly positions?: readonly InventoryStockPosition[];
  /** Retained FIFO starts from the initial projection, required for seeded layers used as conserved sources. */
  readonly positiveLayerStarts?: Readonly<Record<string, number>>;
  /** Initial segment revision, normally inherited from the published inventory revision. */
  readonly revision?: number;
}

/** Optimistic stale-revision failure for segmented position transactions. */
export class InventorySegmentRevisionConflictError extends Error {
  /** Revision expected by the caller. */
  readonly expectedRevision: number;
  /** Revision currently published by the segment. */
  readonly actualRevision: number;

  /** Build one retryable stale-segment error. */
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Inventory position segment changed from revision ${expectedRevision} to ${actualRevision} before commit.`
    );
    this.name = "InventorySegmentRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Compact secondary-index membership: one id stays scalar until a value spans multiple rows. */
type InventorySegmentedCompactMembership = string | Set<string>;

/** One lazily materialized selector candidate set used to choose the narrowest index. */
interface InventorySegmentedCandidate {
  /** Exact candidate cardinality before residual selector filtering. */
  readonly size: number;
  /** Iterate candidate position identities without scanning unrelated rows. */
  readonly identities: () => Iterable<string>;
}

/** Reference indexed position store proving hot updates need not clone one giant world object. */
export class InMemoryInventorySegmentedPositionStore
  implements InventorySegmentedPositionStore
{
  /** Current exact positions by deterministic identity. */
  private readonly positions = new Map<string, InventoryStockPosition>();
  /** Item -> exact position identities. */
  private readonly positionIdsByItemId = new Map<string, Set<string>>();
  /** Item revision -> exact position identities. */
  private readonly positionIdsByItemRevisionId = new Map<string, Set<string>>();
  /** Direct placement -> exact position identities. */
  private readonly positionIdsByPlacementNodeId = new Map<string, Set<string>>();
  /** Lot value -> compact exact position membership. */
  private readonly positionIdsByLotId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Serial value -> compact exact position membership independent of sign. */
  private readonly positionIdsBySerialId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Package revision -> compact exact position membership. */
  private readonly positionIdsByPackagingRevisionId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Status -> compact exact position membership. */
  private readonly positionIdsByStatusId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Owner -> compact exact position membership. */
  private readonly positionIdsByOwnerId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Custodian -> compact exact position membership. */
  private readonly positionIdsByCustodianId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Disposition authority -> compact exact position membership. */
  private readonly positionIdsByDispositionAuthorityId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Whereabouts lifecycle -> compact exact position membership. */
  private readonly positionIdsByWhereaboutsId = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Whereabouts state -> compact exact position membership. */
  private readonly positionIdsByWhereaboutsState = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Qualified dimension/value tuple -> compact exact position membership. */
  private readonly positionIdsByQualifiedDimension = new Map<
    string,
    InventorySegmentedCompactMembership
  >();
  /** Item-scoped serial -> exact positive position identity. */
  private readonly positivePositionIdBySerialIdentity = new Map<string, string>();
  /** Start of the current positive layer for each policy-eligible position. */
  private readonly positiveLayerStarts = new Map<string, number>();
  /** Current optimistic transaction revision. */
  private currentRevision: number;
  /** Order-independent primary 256-bit leaf aggregate. */
  private primaryRootSum = 0n;
  /** Independent secondary 256-bit leaf aggregate. */
  private secondaryRootSum = 0n;

  /** Build one isolated indexed position segment. */
  constructor(input: CreateInMemoryInventorySegmentedPositionStoreInput = {}) {
    const revision = input.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error(
        "Inventory segmented position revision must be a non-negative safe integer."
      );
    }
    this.currentRevision = revision;
    for (const position of input.positions ?? []) {
      const retained = cloneInventoryRetainedData(position);
      const identity = inventoryStockPositionIdentity(retained.key);
      if (this.positions.has(identity)) {
        throw new Error(
          `Duplicate inventory segmented position identity '${identity}'.`
        );
      }
      this.positions.set(identity, retained);
      this.addIndexes(identity, retained);
      this.addRootLeaf(identity, retained);
      const start = input.positiveLayerStarts?.[identity];
      if (start !== undefined) this.positiveLayerStarts.set(identity, start);
    }
  }

  /** Return the current atomic segment revision. */
  revision(): number {
    return this.currentRevision;
  }

  /** Return one constant-size authenticated root over every exact current row. */
  contentRoot(): string {
    return inventorySha256(
      inventoryIntentFingerprint([
        "inventory-position-segment-root-v1",
        this.positions.size,
        inventorySegmentRootHex(this.primaryRootSum),
        inventorySegmentRootHex(this.secondaryRootSum),
      ])
    );
  }

  /** Read one exact row without exposing the store's retained mutable alias. */
  position(positionId: string): InventoryStockPosition | undefined {
    const position = this.positions.get(positionId);
    return position === undefined
      ? undefined
      : cloneInventoryRetainedData(position);
  }

  /** Read one exact positive serialized row through the serial index. */
  positivePositionBySerial(
    itemId: string,
    serialId: string
  ): InventoryStockPosition | undefined {
    const positionId = this.positivePositionIdBySerialIdentity.get(
      inventorySerialIdentity(itemId, serialId)
    );
    return positionId === undefined ? undefined : this.position(positionId);
  }

  /** Read one current positive layer start without consulting the event journal. */
  positiveLayerStart(positionId: string): number | undefined {
    return this.positiveLayerStarts.get(positionId);
  }

  /** Read current rows for one item through the item index. */
  positionsByItem(itemId: string): readonly InventoryStockPosition[] {
    return this.positionsForIds(this.positionIdsByItemId.get(itemId));
  }

  /** Read current rows for one item revision through the revision index. */
  positionsByItemRevision(
    itemRevisionId: string
  ): readonly InventoryStockPosition[] {
    return this.positionsForIds(
      this.positionIdsByItemRevisionId.get(itemRevisionId)
    );
  }

  /** Read current rows for one exact direct placement. */
  positionsByPlacement(
    placementNodeId: string
  ): readonly InventoryStockPosition[] {
    return this.positionsForIds(
      this.positionIdsByPlacementNodeId.get(placementNodeId)
    );
  }

  /** Execute one direct-position selector from the narrowest retained adapter index. */
  queryPositions(
    selector: InventoryStockSelector,
    placement?: InMemoryInventorySegmentedPlacementStore
  ): readonly InventoryStockPosition[] | undefined {
    const normalized = normalizeInventoryStockSelector(selector);
    if (normalized.withinPlacementNodeIds !== undefined && placement === undefined) return undefined;

    let candidate = inventorySegmentedSetCandidate(
      this.positionIdsByItemId.get(normalized.itemId)
    );
    const consider =
      /** Keep the lowest-cardinality usable index candidate seen so far. */
      (next: InventorySegmentedCandidate | undefined): void => {
      if (next !== undefined && next.size < candidate.size) candidate = next;
    };

    consider(
      inventorySegmentedSetIndexCandidate(
        this.positionIdsByItemRevisionId,
        normalized.itemRevisionIds
      )
    );
    consider(
      inventorySegmentedConstraintCandidate(
        this.positionIdsByPlacementNodeId,
        normalized.placement
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByLotId,
        normalized.lot
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsBySerialId,
        normalized.serial
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByPackagingRevisionId,
        normalized.packagingRevision
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByStatusId,
        normalized.status
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByOwnerId,
        normalized.owner
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByCustodianId,
        normalized.custodian
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByDispositionAuthorityId,
        normalized.dispositionAuthority
      )
    );
    consider(
      inventorySegmentedCompactConstraintCandidate(
        this.positionIdsByWhereaboutsId,
        normalized.whereabouts
      )
    );
    if (normalized.whereaboutsStates !== undefined) {
      consider(
        inventorySegmentedCompactIndexCandidate(
          this.positionIdsByWhereaboutsState,
          normalized.whereaboutsStates
        )
      );
    }
    for (const dimension of normalized.qualifiedDimensions ?? []) {
      if (
        dimension.kind !== InventoryOptionalIdentityConstraintKind.Allowed ||
        dimension.valueIds === undefined
      ) {
        continue;
      }
      consider(
        inventorySegmentedCompactIndexCandidate(
          this.positionIdsByQualifiedDimension,
          dimension.valueIds.map(
            /** Bind one qualified value to its dimension before index lookup. */
            (valueId) =>
              inventorySegmentedQualifiedDimensionIdentity(
                dimension.dimensionId,
                valueId
              )
          )
        )
      );
    }

    const subtreeIds = placement === undefined || normalized.withinPlacementNodeIds === undefined
      ? undefined
      : candidateSubtreePositionIds({
          /** Read the local postings without loading full stock rows. */
          positionIds: (nodeId) => {
            const ids = this.positionIdsByPlacementNodeId.get(nodeId);
            return { size: ids?.size ?? 0, ids: ids ?? [] };
          },
          /** Read only the immediate child edges of the visited node. */
          childNodeIds: (nodeId) => placement.childPostings(nodeId),
        }, normalized.withinPlacementNodeIds, candidate.size);
    const ids = subtreeIds ?? [...candidate.identities()].sort();
    const result: InventoryStockPosition[] = [];
    let directSelector = normalized;
    /** Fallback membership, seeded with the requested roots. */
    let subtreeMembership: Map<string, boolean> | undefined;
    if (normalized.withinPlacementNodeIds !== undefined) {
      const { withinPlacementNodeIds, ...remaining } = normalized;
      directSelector = remaining;
      // Subtree postings already prove membership. Only the general item index needs ancestry checks.
      if (subtreeIds === undefined) {
        subtreeMembership = new Map();
        for (const root of withinPlacementNodeIds) subtreeMembership.set(root, true);
      }
    }
    for (const positionId of ids) {
      const position = this.positions.get(positionId);
      if (position === undefined) {
        throw new Error(
          `Inventory segmented selector index references missing position '${positionId}'.`
        );
      }
      if (!inventoryStockPositionMatchesNormalizedSelector(position.key, directSelector)) continue;
      if (subtreeMembership !== undefined && placement !== undefined) {
        const nodeId = position.key.placementNodeId;
        if (nodeId === undefined || !inventorySegmentedNodeIsInSubtree(nodeId, placement, subtreeMembership)) continue;
      }
      result.push(cloneInventoryRetainedData(position));
    }
    return result;
  }

  /** Atomically apply removals/upserts without copying unrelated stock rows. */
  applyDelta(
    input: ApplyInventorySegmentedPositionDeltaInput
  ): ApplyInventorySegmentedPositionDeltaResult {
    this.assertStockWriteRevision(input.expectedRevision, input.nextRevision);
    return this.publishDelta(input);
  }

  /** Check the generation before using current stock to evaluate a planned write. */
  private assertStockWriteRevision(expectedRevision: number, nextRevision: number): void {
    if (expectedRevision !== this.currentRevision) {
      throw new InventorySegmentRevisionConflictError(
        expectedRevision,
        this.currentRevision
      );
    }
    if (
      !Number.isSafeInteger(nextRevision) ||
      nextRevision !== expectedRevision + 1
    ) {
      throw new Error(
        "Inventory segmented position nextRevision must be exactly expectedRevision + 1."
      );
    }
  }

  /** Publish an exact delta after its revision has been checked in this synchronous call. */
  private publishDelta(
    input: ApplyInventorySegmentedPositionDeltaInput
  ): ApplyInventorySegmentedPositionDeltaResult {
    const explicitRemovals = new Set(input.removePositionIds ?? []);
    for (const positionId of explicitRemovals) {
      if (!this.positions.has(positionId)) {
        throw new Error(
          `Unknown inventory segmented source position '${positionId}'.`
        );
      }
    }

    const upserts = new Map<string, InventoryStockPosition>();
    for (const rawPosition of input.upsertPositions ?? []) {
      const position = cloneInventoryRetainedData(rawPosition);
      const positionId = inventoryStockPositionIdentity(position.key);
      if (upserts.has(positionId)) {
        throw new Error(
          `Inventory segmented delta repeats destination position '${positionId}'.`
        );
      }
      upserts.set(positionId, position);
    }

    const touchedIds = new Set<string>(explicitRemovals);
    for (const positionId of upserts.keys()) touchedIds.add(positionId);
    const originals = new Map<string, InventoryStockPosition>();
    for (const positionId of touchedIds) {
      const position = this.positions.get(positionId);
      if (position !== undefined) originals.set(positionId, position);
    }

    const destinationSerialOwners = new Map<string, string>();
    for (const [positionId, position] of upserts) {
      const serialId = position.key.serialId;
      if (
        serialId === undefined ||
        position.measurements.primary.quantity.amountMinor <= 0
      ) {
        continue;
      }
      const serialIdentity = inventorySerialIdentity(
        position.key.itemId,
        serialId
      );
      const duplicate = destinationSerialOwners.get(serialIdentity);
      if (duplicate !== undefined && duplicate !== positionId) {
        throw new Error(
          `Active serial ${serialIdentity} appears in more than one segmented delta destination.`
        );
      }
      destinationSerialOwners.set(serialIdentity, positionId);
      const earlier = this.positivePositionIdBySerialIdentity.get(
        serialIdentity
      );
      if (earlier !== undefined && !touchedIds.has(earlier)) {
        throw new Error(
          `Active serial ${serialIdentity} already belongs to another segmented stock position.`
        );
      }
    }

    for (const [positionId, position] of originals) {
      this.removeIndexes(positionId, position);
      this.removeRootLeaf(positionId, position);
      this.positions.delete(positionId);
    }
    for (const [positionId, position] of upserts) {
      this.positions.set(positionId, position);
      this.addIndexes(positionId, position);
      this.addRootLeaf(positionId, position);
    }

    // Ages belong to the same published generation as their exact stock rows.
    for (const positionId of explicitRemovals) {
      // A same-key positive replacement preserves the uninterrupted layer.
      if (!upserts.has(positionId)) this.positiveLayerStarts.delete(positionId);
    }
    for (const [positionId, position] of upserts) {
      if (position.measurements.primary.quantity.amountMinor <= 0) {
        this.positiveLayerStarts.delete(positionId);
      }
    }
    if (input.positiveLayerStarts !== undefined) {
      for (const [positionId, start] of input.positiveLayerStarts) {
        this.positiveLayerStarts.set(positionId, start);
      }
    }
    this.currentRevision = input.nextRevision;
    const removedPositionIds = [...explicitRemovals];
    removedPositionIds.sort();
    const upsertedPositionIds = [...upserts.keys()];
    upsertedPositionIds.sort();
    return {
      revision: this.currentRevision,
      removedPositionIds,
      upsertedPositionIds,
    };
  }

  /** Apply one validated event's signed stock effects without materializing unrelated rows. */
  applyStockEffects(
    input: ApplyInventorySegmentedStockEffectsInput
  ): ApplyInventorySegmentedPositionDeltaResult {
    this.assertStockWriteRevision(input.expectedRevision, input.nextRevision);
    // Compute the complete changed set before mutating the published index.
    const nextRows = new Map<string, InventoryStockPosition | undefined>();
    /** Validated historical revisions may improve an existing deficit without closing it. */
    const requireNonNegative = input.deficitPolicy === InventoryDeficitPolicy.Reject &&
      input.event.kind !== InventoryEventKind.Correction && input.event.kind !== InventoryEventKind.HistoricalRepair;
    for (const effect of input.event.stockEffects) {
      const positionId = inventoryStockPositionIdentity(effect.position);
      const earlier =
        nextRows.has(positionId)
          ? nextRows.get(positionId)
          : this.positions.get(positionId);
      const baseMeasurements =
        earlier?.measurements ??
        zeroInventoryMeasurements(effect.measurementsDelta);
      const measurements = addInventoryMeasurements(baseMeasurements, effect.measurementsDelta);
      assertInventoryMeasurementsFollowPrimarySign(measurements, `Stock position ${positionId}`);
      if (requireNonNegative) {
        nonNegativeInventoryMeasurements(measurements, `Stock position ${positionId}`);
      }
      nextRows.set(
        positionId,
        inventoryMeasurementsAreZero(measurements)
          ? undefined
          : {
              key: effect.position,
              measurements,
            }
      );
    }

    const positiveLayerStarts = captureConservedPositiveLayerStarts(
      input.event,
      /** Read only the affected source and destination ages at the current revision. */
      (positionId) => this.positiveLayerStarts.get(positionId)
    );
    for (const [positionId, position] of nextRows) {
      const positive = position !== undefined && position.measurements.primary.quantity.amountMinor > 0;
      const serialId = position?.key.serialId;
      if (positive && serialId !== undefined) {
        // Validate the planner-produced event's final stock before publishing either stock or edges.
        assertInventoryActiveSerialQuantity(
          inventorySerialIdentity(position.key.itemId, serialId), position.measurements.primary.quantity
        );
      }
      if (positiveLayerStarts.has(positionId)) {
        if (!positive) {
          if (!inventoryConservedArrivalCanSettleDeficit(input.event)) {
            throw new Error(`Conserved FIFO provenance destination ${positionId} is not positive after its event.`);
          }
          // No live stock remains to carry an age after the exact debit settles.
          positiveLayerStarts.delete(positionId);
        }
      } else if (positive && !this.positiveLayerStarts.has(positionId)) {
        const previousPrimary = this.positions.get(positionId)?.measurements.primary.quantity.amountMinor ?? 0;
        // A receipt that tops up a seeded positive row cannot establish its earlier start.
        if (previousPrimary <= 0) positiveLayerStarts.set(positionId, input.event.occurredAtEpochMs);
      }
    }
    for (const override of input.event.positiveLayerProvenanceOverrides ?? []) {
      const positionId = inventoryStockPositionIdentity(override.position);
      const position = nextRows.has(positionId) ? nextRows.get(positionId) : this.positions.get(positionId);
      const positive = position !== undefined && position.measurements.primary.quantity.amountMinor > 0;
      assertInventoryStockAgeOverride(override.startedAtEpochMs, positive, positionId);
      // An age-only correction belongs to the new revision even without a stock delta.
      if (override.startedAtEpochMs === undefined) positiveLayerStarts.delete(positionId);
      else positiveLayerStarts.set(positionId, override.startedAtEpochMs);
    }
    const removePositionIds: string[] = [];
    const upsertPositions: InventoryStockPosition[] = [];
    for (const [positionId, position] of nextRows) {
      if (position === undefined) removePositionIds.push(positionId);
      else upsertPositions.push(position);
    }
    return this.publishDelta({
      expectedRevision: input.expectedRevision,
      nextRevision: input.nextRevision,
      positiveLayerStarts,
      ...(removePositionIds.length === 0 ? {} : { removePositionIds }),
      ...(upsertPositions.length === 0 ? {} : { upsertPositions }),
    });
  }

  /** Atomically replace one exact row and update only its touched index memberships. */
  replaceExactPosition(
    input: ReplaceInventorySegmentedPositionInput
  ): ReplaceInventorySegmentedPositionResult {
    const toPositionId = inventoryStockPositionIdentity(input.to.key);
    // The delta checks the generation before looking up its removals.
    const result = this.applyDelta({
      expectedRevision: input.expectedRevision,
      nextRevision: input.expectedRevision + 1,
      removePositionIds: [input.fromPositionId],
      upsertPositions: [input.to],
    });
    return {
      revision: result.revision,
      fromPositionId: input.fromPositionId,
      toPositionId,
    };
  }

  /** Materialize the canonical flat hot-position view only on explicit request. */
  materialize(): InventoryPositionSegmentMaterialization {
    const positions = createInventorySparseRecord<InventoryStockPosition>();
    for (const [identity, position] of this.positions) {
      setInventorySparseRecordValue(
        positions,
        identity,
        cloneInventoryRetainedData(position)
      );
    }
    return {
      positions,
      positionIdsByItemId: materializeIdentityIndex(
        this.positionIdsByItemId
      ),
      positionIdsByItemRevisionId: materializeIdentityIndex(
        this.positionIdsByItemRevisionId
      ),
      positionIdsByPlacementNodeId: materializeIdentityIndex(
        this.positionIdsByPlacementNodeId
      ),
      positionIdsByWhereaboutsId: materializeCompactIdentityIndex(
        this.positionIdsByWhereaboutsId
      ),
      positivePositionIdBySerialIdentity: materializeScalarIndex(
        this.positivePositionIdBySerialIdentity
      ),
    };
  }

  /** Read deterministic rows for one exact identity set. */
  private positionsForIds(
    identities: ReadonlySet<string> | undefined
  ): readonly InventoryStockPosition[] {
    if (identities === undefined || identities.size === 0) return [];
    const ordered = [...identities];
    ordered.sort();
    const result: InventoryStockPosition[] = [];
    for (const identity of ordered) {
      const position = this.positions.get(identity);
      if (position === undefined) {
        throw new Error(
          `Inventory segmented index references missing position '${identity}'.`
        );
      }
      result.push(cloneInventoryRetainedData(position));
    }
    return result;
  }

  /** Add every exact index membership for one retained position. */
  private addIndexes(
    positionId: string,
    position: InventoryStockPosition
  ): void {
    addIndexMembership(
      this.positionIdsByItemId,
      position.key.itemId,
      positionId
    );
    addIndexMembership(
      this.positionIdsByItemRevisionId,
      position.key.itemRevisionId,
      positionId
    );
    if (position.key.placementNodeId !== undefined) {
      addIndexMembership(
        this.positionIdsByPlacementNodeId,
        position.key.placementNodeId,
        positionId
      );
    }
    addOptionalCompactIndexMembership(
      this.positionIdsByLotId,
      position.key.lotId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsBySerialId,
      position.key.serialId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByPackagingRevisionId,
      position.key.packagingRevisionId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByStatusId,
      position.key.statusId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByOwnerId,
      position.key.ownerId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByCustodianId,
      position.key.custodianId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByDispositionAuthorityId,
      position.key.dispositionAuthorityId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByWhereaboutsId,
      position.key.whereaboutsId,
      positionId
    );
    addOptionalCompactIndexMembership(
      this.positionIdsByWhereaboutsState,
      position.key.whereaboutsState,
      positionId
    );
    for (const dimension of position.key.qualifiedDimensions ?? []) {
      addCompactIndexMembership(
        this.positionIdsByQualifiedDimension,
        inventorySegmentedQualifiedDimensionIdentity(
          dimension.dimensionId,
          dimension.valueId
        ),
        positionId
      );
    }
    const serialId = position.key.serialId;
    if (serialId !== undefined && position.measurements.primary.quantity.amountMinor > 0) {
      const serialIdentity = inventorySerialIdentity(
        position.key.itemId,
        serialId
      );
      const earlier = this.positivePositionIdBySerialIdentity.get(serialIdentity);
      if (earlier !== undefined && earlier !== positionId) {
        throw new Error(
          `Active serial ${serialIdentity} appears in more than one segmented stock position.`
        );
      }
      this.positivePositionIdBySerialIdentity.set(serialIdentity, positionId);
    }
  }

  /** Remove every exact index membership for one retained position. */
  private removeIndexes(
    positionId: string,
    position: InventoryStockPosition
  ): void {
    removeIndexMembership(
      this.positionIdsByItemId,
      position.key.itemId,
      positionId
    );
    removeIndexMembership(
      this.positionIdsByItemRevisionId,
      position.key.itemRevisionId,
      positionId
    );
    if (position.key.placementNodeId !== undefined) {
      removeIndexMembership(
        this.positionIdsByPlacementNodeId,
        position.key.placementNodeId,
        positionId
      );
    }
    removeOptionalCompactIndexMembership(
      this.positionIdsByLotId,
      position.key.lotId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsBySerialId,
      position.key.serialId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByPackagingRevisionId,
      position.key.packagingRevisionId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByStatusId,
      position.key.statusId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByOwnerId,
      position.key.ownerId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByCustodianId,
      position.key.custodianId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByDispositionAuthorityId,
      position.key.dispositionAuthorityId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByWhereaboutsId,
      position.key.whereaboutsId,
      positionId
    );
    removeOptionalCompactIndexMembership(
      this.positionIdsByWhereaboutsState,
      position.key.whereaboutsState,
      positionId
    );
    for (const dimension of position.key.qualifiedDimensions ?? []) {
      removeCompactIndexMembership(
        this.positionIdsByQualifiedDimension,
        inventorySegmentedQualifiedDimensionIdentity(
          dimension.dimensionId,
          dimension.valueId
        ),
        positionId
      );
    }
    const serialId = position.key.serialId;
    if (serialId !== undefined) {
      const serialIdentity = inventorySerialIdentity(
        position.key.itemId,
        serialId
      );
      if (
        this.positivePositionIdBySerialIdentity.get(serialIdentity) ===
        positionId
      ) {
        this.positivePositionIdBySerialIdentity.delete(serialIdentity);
      }
    }
  }

  /** Add one exact row to the constant-size authenticated segment aggregate. */
  private addRootLeaf(
    positionId: string,
    position: InventoryStockPosition
  ): void {
    const leaf = inventorySegmentPositionLeaf(positionId, position);
    this.primaryRootSum = inventoryNormalizeSegmentRootSum(
      this.primaryRootSum + leaf.primary
    );
    this.secondaryRootSum = inventoryNormalizeSegmentRootSum(
      this.secondaryRootSum + leaf.secondary
    );
  }

  /** Remove one exact row from the constant-size authenticated segment aggregate. */
  private removeRootLeaf(
    positionId: string,
    position: InventoryStockPosition
  ): void {
    const leaf = inventorySegmentPositionLeaf(positionId, position);
    this.primaryRootSum = inventoryNormalizeSegmentRootSum(
      this.primaryRootSum - leaf.primary
    );
    this.secondaryRootSum = inventoryNormalizeSegmentRootSum(
      this.secondaryRootSum - leaf.secondary
    );
  }

  /** Reject introducing one second active position for the destination serial. */
  private assertSerialDestinationIsAvailable(
    sourcePositionId: string,
    destinationPositionId: string,
    destination: InventoryStockPosition
  ): void {
    const serialId = destination.key.serialId;
    if (
      serialId === undefined ||
      destination.measurements.primary.quantity.amountMinor <= 0
    ) {
      return;
    }
    const serialIdentity = inventorySerialIdentity(
      destination.key.itemId,
      serialId
    );
    const earlier = this.positivePositionIdBySerialIdentity.get(serialIdentity);
    if (
      earlier !== undefined &&
      earlier !== sourcePositionId &&
      earlier !== destinationPositionId
    ) {
      throw new Error(
        `Active serial ${serialIdentity} already belongs to another segmented stock position.`
      );
    }
  }
}

/** Build one selector candidate from an existing exact membership set. */
function inventorySegmentedSetCandidate(
  identities: ReadonlySet<string> | undefined
): InventorySegmentedCandidate {
  const retained = identities ?? new Set<string>();
  return {
    size: retained.size,
    identities:
      /** Iterate the retained exact identities without materializing another set. */
      () => retained,
  };
}

/** Count disjoint postings for normalized keys and visit their identities only if selected. */
function inventorySegmentedSetIndexCandidate(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  keys: readonly string[] | undefined
): InventorySegmentedCandidate | undefined {
  if (keys === undefined) return undefined;
  if (keys.length === 1) {
    return inventorySegmentedSetCandidate(index.get(keys[0] ?? ""));
  }
  // Each position belongs to one revision and one direct placement, so these counts do not overlap.
  let size = 0;
  for (const key of keys) size += index.get(key)?.size ?? 0;
  return {
    size,
    /** Enumerate the winning postings before the caller sorts their identities. */
    *identities() {
      for (const key of keys) {
        const posting = index.get(key);
        if (posting !== undefined) yield* posting;
      }
    },
  };
}

/** Build one candidate for an Allowed optional-identity constraint over a set-valued index. */
function inventorySegmentedConstraintCandidate(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  constraint: InventoryOptionalIdentityConstraint | undefined
): InventorySegmentedCandidate | undefined {
  if (
    constraint?.kind !== InventoryOptionalIdentityConstraintKind.Allowed ||
    constraint.valueIds === undefined
  ) {
    return undefined;
  }
  return inventorySegmentedSetIndexCandidate(index, constraint.valueIds);
}

/** Build one candidate from a compact scalar-or-set index across allowed keys. */
function inventorySegmentedCompactIndexCandidate(
  index: ReadonlyMap<string, InventorySegmentedCompactMembership>,
  keys: readonly string[]
): InventorySegmentedCandidate {
  if (keys.length === 1) {
    const membership = index.get(keys[0] ?? "");
    if (membership === undefined) return inventorySegmentedSetCandidate(undefined);
    if (typeof membership === "string") {
      return {
        size: 1,
        identities:
          /** Yield the one compact scalar membership without allocating an index set. */
          () => [membership],
      };
    }
    return inventorySegmentedSetCandidate(membership);
  }
  const union = new Set<string>();
  for (const key of keys) {
    const membership = index.get(key);
    if (membership === undefined) continue;
    if (typeof membership === "string") union.add(membership);
    else for (const identity of membership) union.add(identity);
  }
  return inventorySegmentedSetCandidate(union);
}

/** Build one candidate for an Allowed optional-identity constraint over a compact index. */
function inventorySegmentedCompactConstraintCandidate(
  index: ReadonlyMap<string, InventorySegmentedCompactMembership>,
  constraint: InventoryOptionalIdentityConstraint | undefined
): InventorySegmentedCandidate | undefined {
  if (
    constraint?.kind !== InventoryOptionalIdentityConstraintKind.Allowed ||
    constraint.valueIds === undefined
  ) {
    return undefined;
  }
  return inventorySegmentedCompactIndexCandidate(index, constraint.valueIds);
}

/** Add one exact identity to an adaptive scalar-or-set secondary index. */
function addCompactIndexMembership(
  index: Map<string, InventorySegmentedCompactMembership>,
  groupId: string,
  positionId: string
): void {
  const earlier = index.get(groupId);
  if (earlier === undefined) {
    index.set(groupId, positionId);
    return;
  }
  if (typeof earlier === "string") {
    if (earlier === positionId) return;
    index.set(groupId, new Set([earlier, positionId]));
    return;
  }
  earlier.add(positionId);
}

/** Add one optional identity to an adaptive secondary index when present. */
function addOptionalCompactIndexMembership(
  index: Map<string, InventorySegmentedCompactMembership>,
  groupId: string | undefined,
  positionId: string
): void {
  if (groupId !== undefined) {
    addCompactIndexMembership(index, groupId, positionId);
  }
}

/** Remove one exact identity while collapsing two-or-more membership back to scalar when possible. */
function removeCompactIndexMembership(
  index: Map<string, InventorySegmentedCompactMembership>,
  groupId: string,
  positionId: string
): void {
  const earlier = index.get(groupId);
  if (earlier === undefined) return;
  if (typeof earlier === "string") {
    if (earlier === positionId) index.delete(groupId);
    return;
  }
  earlier.delete(positionId);
  if (earlier.size === 0) {
    index.delete(groupId);
    return;
  }
  if (earlier.size === 1) {
    const only = earlier.values().next().value as string | undefined;
    if (only !== undefined) index.set(groupId, only);
  }
}

/** Remove one optional identity from an adaptive secondary index when present. */
function removeOptionalCompactIndexMembership(
  index: Map<string, InventorySegmentedCompactMembership>,
  groupId: string | undefined,
  positionId: string
): void {
  if (groupId !== undefined) {
    removeCompactIndexMembership(index, groupId, positionId);
  }
}

/** Stable private key for one qualified dimension/value secondary index entry. */
function inventorySegmentedQualifiedDimensionIdentity(
  dimensionId: string,
  valueId: string
): string {
  return JSON.stringify([dimensionId, valueId]);
}

/** Create the reference segmented position store. */
export function createInMemoryInventorySegmentedPositionStore(
  input: CreateInMemoryInventorySegmentedPositionStoreInput = {}
): InMemoryInventorySegmentedPositionStore {
  return new InMemoryInventorySegmentedPositionStore(input);
}

/** Add one identity to one secondary index row. */
function addIndexMembership(
  index: Map<string, Set<string>>,
  groupId: string,
  positionId: string
): void {
  const identities = index.get(groupId) ?? new Set<string>();
  identities.add(positionId);
  index.set(groupId, identities);
}

/** Remove one identity and drop an empty secondary-index row. */
function removeIndexMembership(
  index: Map<string, Set<string>>,
  groupId: string,
  positionId: string
): void {
  const identities = index.get(groupId);
  if (identities === undefined) return;
  identities.delete(positionId);
  if (identities.size === 0) index.delete(groupId);
}

/** Materialize one set-valued index as deterministic sorted arrays. */
function materializeIdentityIndex(
  index: ReadonlyMap<string, ReadonlySet<string>>
): Readonly<Record<string, readonly string[]>> {
  const result = createInventorySparseRecord<readonly string[]>();
  const groups = [...index.keys()];
  groups.sort();
  for (const groupId of groups) {
    const identities = [...(index.get(groupId) ?? [])];
    identities.sort();
    setInventorySparseRecordValue(result, groupId, identities);
  }
  return result;
}

/** Materialize one compact scalar-or-set index as deterministic sorted arrays. */
function materializeCompactIdentityIndex(
  index: ReadonlyMap<string, InventorySegmentedCompactMembership>
): Readonly<Record<string, readonly string[]>> {
  const result = createInventorySparseRecord<readonly string[]>();
  const groups = [...index.keys()];
  groups.sort();
  for (const groupId of groups) {
    const membership = index.get(groupId);
    if (membership === undefined) continue;
    const identities =
      typeof membership === "string" ? [membership] : [...membership].sort();
    setInventorySparseRecordValue(result, groupId, identities);
  }
  return result;
}

/** Materialize one scalar index as a prototype-free own-only record. */
function materializeScalarIndex(
  index: ReadonlyMap<string, string>
): Readonly<Record<string, string>> {
  const result = createInventorySparseRecord<string>();
  const keys = [...index.keys()];
  keys.sort();
  for (const key of keys) {
    const value = index.get(key);
    if (value !== undefined) setInventorySparseRecordValue(result, key, value);
  }
  return result;
}

/** 256-bit modular field used by the order-independent position segment root. */
const inventorySegmentRootModulus = 1n << 256n;

/** Two independent authenticated leaf contributions for one retained stock position. */
interface InventorySegmentRootLeaf {
  /** Primary 256-bit modular contribution. */
  readonly primary: bigint;
  /** Independent secondary 256-bit modular contribution. */
  readonly secondary: bigint;
}

/** Bind one exact position identity and its measurements to two independent leaf hashes. */
function inventorySegmentPositionLeaf(
  positionId: string,
  position: InventoryStockPosition
): InventorySegmentRootLeaf {
  const measurements = inventoryMeasurementsFingerprint(position.measurements);
  return {
    primary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-position-segment-leaf-primary-v1",
            positionId,
            measurements,
          ])
        )
    ),
    secondary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-position-segment-leaf-secondary-v1",
            positionId,
            measurements,
          ])
        )
    ),
  };
}

/** Normalize one signed aggregate into the canonical unsigned 256-bit domain. */
function inventoryNormalizeSegmentRootSum(value: bigint): bigint {
  const normalized = value % inventorySegmentRootModulus;
  return normalized < 0n
    ? normalized + inventorySegmentRootModulus
    : normalized;
}

/** Encode one segment aggregate as exactly 64 lower-case hexadecimal digits. */
function inventorySegmentRootHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
