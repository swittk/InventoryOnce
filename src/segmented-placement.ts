import { inventoryIntentFingerprint } from "./canonical.js";
import { inventorySha256 } from "./digest.js";
import {
  normalizeInventoryPlacementChange,
  type InventoryPlacementRelation,
  type InventoryPlacementState,
} from "./placement.js";
import {
  createInventorySparseRecord,
  setInventorySparseRecordValue,
} from "./sparse-record.js";

/** Adapter-local placement reads may be synchronous or asynchronous. */
export type InventorySegmentedPlacementResult<T> = T | Promise<T>;

/** Inputs for one fenced direct-parent topology transition. */
export interface ApplyInventorySegmentedPlacementChangeInput {
  /** Placement segment revision the semantic planner read. */
  readonly expectedRevision: number;
  /** New segment revision after this atomic transition. */
  readonly nextRevision: number;
  /** Event establishing the resulting edge. */
  readonly eventId: string;
  /** Node whose direct parent changes. */
  readonly nodeId: string;
  /** Exact earlier parent, or omission when currently root/unplaced. */
  readonly fromParentNodeId?: string;
  /** Exact next parent, or omission when becoming root/unplaced. */
  readonly toParentNodeId?: string;
  /** Required true when a destination exists; semantic metadata validation stays above storage. */
  readonly targetAcceptsPlacement?: boolean;
}

/** Result of one direct-parent transition. */
export interface ApplyInventorySegmentedPlacementChangeResult {
  /** New placement segment revision. */
  readonly revision: number;
  /** Changed node identity. */
  readonly nodeId: string;
  /** New direct parent, or omission when unplaced/root. */
  readonly parentNodeId?: string;
}

/** Canonical flat placement topology materialized for export and proof. */
export type InventorySegmentedPlacementMaterialization = InventoryPlacementState;

/** Read-only indexed placement topology contract for native/database adapters. */
export interface InventorySegmentedPlacementReader {
  /** Current optimistic placement revision. */
  revision(): InventorySegmentedPlacementResult<number>;
  /** Authenticated root over every current direct-parent edge. */
  contentRoot(): InventorySegmentedPlacementResult<string>;
  /** Read one exact direct parent. */
  parentNodeId(nodeId: string): InventorySegmentedPlacementResult<string | undefined>;
  /** Read direct children in deterministic identity order. */
  childNodeIds(nodeId: string): InventorySegmentedPlacementResult<readonly string[]>;
  /** Read one node followed by every direct ancestor. */
  ancestry(nodeId: string): InventorySegmentedPlacementResult<readonly string[]>;
  /** Read one node and every descendant. */
  subtreeNodeIds(nodeId: string): InventorySegmentedPlacementResult<readonly string[]>;
  /** Explicitly materialize the canonical flat placement state. */
  materialize(): InventorySegmentedPlacementResult<InventorySegmentedPlacementMaterialization>;
}

/** Mutable placement topology used inside one adapter-native transaction. */
export interface InventorySegmentedPlacementStore
  extends InventorySegmentedPlacementReader {
  /** Atomically move/unplace one node without copying unrelated topology. */
  applyChange(
    input: ApplyInventorySegmentedPlacementChangeInput
  ): InventorySegmentedPlacementResult<ApplyInventorySegmentedPlacementChangeResult>;
}

/** Inputs for constructing the reference segmented placement store. */
export interface CreateInMemoryInventorySegmentedPlacementStoreInput {
  /** Existing canonical placement state. */
  readonly placement?: InventoryPlacementState;
  /** Existing published revision. */
  readonly revision?: number;
}

/** Retryable stale placement revision failure. */
export class InventoryPlacementSegmentRevisionConflictError extends Error {
  /** Revision expected by the caller. */
  readonly expectedRevision: number;
  /** Current published placement revision. */
  readonly actualRevision: number;

  /** Build one stale-placement transaction error. */
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Inventory placement segment changed from revision ${expectedRevision} to ${actualRevision} before commit.`
    );
    this.name = "InventoryPlacementSegmentRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Reference indexed placement forest proving one-edge moves need not copy the full graph. */
export class InMemoryInventorySegmentedPlacementStore
  implements InventorySegmentedPlacementStore
{
  /** Current direct-parent relation by child node. */
  private readonly relationByNodeId = new Map<string, InventoryPlacementRelation>();
  /** Current direct children by parent node. */
  private readonly childNodeIdsByParentNodeId = new Map<string, Set<string>>();
  /** Published segment revision. */
  private currentRevision: number;
  /** Primary order-independent 256-bit relation aggregate. */
  private primaryRootSum = 0n;
  /** Independent secondary relation aggregate. */
  private secondaryRootSum = 0n;

  /** Build one segmented placement forest from canonical state. */
  constructor(input: CreateInMemoryInventorySegmentedPlacementStoreInput = {}) {
    const revision = input.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error(
        "Inventory segmented placement revision must be a non-negative safe integer."
      );
    }
    this.currentRevision = revision;
    const relations = Object.values(
      input.placement?.relationByNodeId ?? {}
    );
    relations.sort(
      /** Rebuild deterministically by node identity. */
      (left, right) => left.nodeId.localeCompare(right.nodeId)
    );
    for (const relation of relations) {
      if (this.relationByNodeId.has(relation.nodeId)) {
        throw new Error(
          `Duplicate segmented placement relation for '${relation.nodeId}'.`
        );
      }
      if (relation.nodeId === relation.parentNodeId) {
        throw new Error("A placement node cannot be its own direct parent.");
      }
      this.relationByNodeId.set(relation.nodeId, { ...relation });
      addPlacementChild(
        this.childNodeIdsByParentNodeId,
        relation.parentNodeId,
        relation.nodeId
      );
      this.addRootLeaf(relation);
    }
    this.assertWholeForestAcyclic();
  }

  /**
   * Admit one complete imported forest in O(nodes + edges), regardless of
   * nesting depth. Remember every finished parent chain so descendants
   * never rewalk already validated ancestors. Per-move admission below
   * still examines only the changed node's ancestry.
   */
  private assertWholeForestAcyclic(): void {
    const completed = new Set<string>();
    for (const startNodeId of this.relationByNodeId.keys()) {
      if (completed.has(startNodeId)) continue;
      const path = new Set<string>();
      let current: string | undefined = startNodeId;
      while (current !== undefined && !completed.has(current)) {
        if (path.has(current)) {
          throw new Error(
            "Segmented placement graph contains a cycle at '" + current + "'."
          );
        }
        path.add(current);
        current = this.relationByNodeId.get(current)?.parentNodeId;
      }
      for (const nodeId of path) completed.add(nodeId);
    }
  }

  /** Return current segment revision. */
  revision(): number {
    return this.currentRevision;
  }

  /** Return one constant-size authenticated root over direct-parent edges. */
  contentRoot(): string {
    return inventorySha256(
      inventoryIntentFingerprint([
        "inventory-placement-segment-root-v1",
        this.relationByNodeId.size,
        inventoryPlacementRootHex(this.primaryRootSum),
        inventoryPlacementRootHex(this.secondaryRootSum),
      ])
    );
  }

  /** Read one direct parent. */
  parentNodeId(nodeId: string): string | undefined {
    return this.relationByNodeId.get(nodeId)?.parentNodeId;
  }

  /** Read direct children in stable identity order. */
  childNodeIds(nodeId: string): readonly string[] {
    const result = [
      ...(this.childNodeIdsByParentNodeId.get(nodeId) ?? []),
    ];
    result.sort();
    return result;
  }

  /** Read one node and all direct ancestors. */
  ancestry(nodeId: string): readonly string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    let current: string | undefined = nodeId;
    while (current !== undefined) {
      if (visited.has(current)) {
        throw new Error(
          `Segmented placement graph contains a cycle at '${current}'.`
        );
      }
      visited.add(current);
      result.push(current);
      current = this.relationByNodeId.get(current)?.parentNodeId;
    }
    return result;
  }

  /** Read one node plus its descendant subtree without scanning unrelated nodes. */
  subtreeNodeIds(nodeId: string): readonly string[] {
    const result: string[] = [];
    const pending = [nodeId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      if (visited.has(current)) {
        throw new Error(
          `Segmented placement graph contains a cycle at '${current}'.`
        );
      }
      visited.add(current);
      result.push(current);
      const children = this.childNodeIds(current);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) pending.push(child);
      }
    }
    return result;
  }

  /** Atomically change one direct-parent edge and only its two parent child sets. */
  applyChange(
    input: ApplyInventorySegmentedPlacementChangeInput
  ): ApplyInventorySegmentedPlacementChangeResult {
    if (input.expectedRevision !== this.currentRevision) {
      throw new InventoryPlacementSegmentRevisionConflictError(
        input.expectedRevision,
        this.currentRevision
      );
    }
    if (
      !Number.isSafeInteger(input.nextRevision) ||
      input.nextRevision !== input.expectedRevision + 1
    ) {
      throw new Error(
        "Inventory segmented placement nextRevision must equal expectedRevision + 1."
      );
    }
    const change = normalizeInventoryPlacementChange({
      nodeId: input.nodeId,
      ...(input.fromParentNodeId === undefined
        ? {}
        : { fromParentNodeId: input.fromParentNodeId }),
      ...(input.toParentNodeId === undefined
        ? {}
        : { toParentNodeId: input.toParentNodeId }),
    });
    const current = this.relationByNodeId.get(change.nodeId);
    const actualParent = current?.parentNodeId;
    if (actualParent !== change.fromParentNodeId) {
      throw new Error(
        `Placement node '${change.nodeId}' expected parent '${change.fromParentNodeId ?? "<unplaced>"}', not '${actualParent ?? "<unplaced>"}'.`
      );
    }
    if (
      change.toParentNodeId !== undefined &&
      input.targetAcceptsPlacement !== true
    ) {
      throw new Error(
        `Placement node '${change.toParentNodeId}' does not accept direct placement.`
      );
    }

    const replacement =
      change.toParentNodeId === undefined
        ? undefined
        : {
            nodeId: change.nodeId,
            parentNodeId: change.toParentNodeId,
            createdByEventId: input.eventId,
          };
    if (current !== undefined) this.removeRootLeaf(current);
    if (replacement === undefined) {
      this.relationByNodeId.delete(change.nodeId);
    } else {
      this.relationByNodeId.set(change.nodeId, replacement);
    }
    if (change.fromParentNodeId !== undefined) {
      removePlacementChild(
        this.childNodeIdsByParentNodeId,
        change.fromParentNodeId,
        change.nodeId
      );
    }
    if (change.toParentNodeId !== undefined) {
      addPlacementChild(
        this.childNodeIdsByParentNodeId,
        change.toParentNodeId,
        change.nodeId
      );
    }

    try {
      this.assertNoCycle(change.nodeId);
    } catch (error) {
      if (change.toParentNodeId !== undefined) {
        removePlacementChild(
          this.childNodeIdsByParentNodeId,
          change.toParentNodeId,
          change.nodeId
        );
      }
      if (change.fromParentNodeId !== undefined) {
        addPlacementChild(
          this.childNodeIdsByParentNodeId,
          change.fromParentNodeId,
          change.nodeId
        );
      }
      // The candidate replacement root leaf is only added after successful
      // cycle admission below. Removing it here would corrupt the authenticated
      // aggregate on a rejected move (while restoring the correct topology).
      if (current === undefined) {
        this.relationByNodeId.delete(change.nodeId);
      } else {
        this.relationByNodeId.set(change.nodeId, current);
        this.addRootLeaf(current);
      }
      throw error;
    }

    if (replacement !== undefined) this.addRootLeaf(replacement);
    this.currentRevision = input.nextRevision;
    return {
      revision: this.currentRevision,
      nodeId: change.nodeId,
      ...(replacement === undefined
        ? {}
        : { parentNodeId: replacement.parentNodeId }),
    };
  }

  /** Materialize the canonical flat placement state only on explicit request. */
  materialize(): InventoryPlacementState {
    const relationByNodeId =
      createInventorySparseRecord<InventoryPlacementRelation>();
    const childNodeIdsByParentNodeId =
      createInventorySparseRecord<readonly string[]>();

    const nodeIds = [...this.relationByNodeId.keys()];
    nodeIds.sort();
    for (const nodeId of nodeIds) {
      const relation = this.relationByNodeId.get(nodeId);
      if (relation !== undefined) {
        setInventorySparseRecordValue(
          relationByNodeId,
          nodeId,
          { ...relation }
        );
      }
    }
    const parentIds = [...this.childNodeIdsByParentNodeId.keys()];
    parentIds.sort();
    for (const parentNodeId of parentIds) {
      setInventorySparseRecordValue(
        childNodeIdsByParentNodeId,
        parentNodeId,
        this.childNodeIds(parentNodeId)
      );
    }
    return { relationByNodeId, childNodeIdsByParentNodeId };
  }

  /** Reject a cycle along one changed node's parent chain. */
  private assertNoCycle(nodeId: string): void {
    const visited = new Set<string>();
    let current: string | undefined = nodeId;
    while (current !== undefined) {
      if (visited.has(current)) {
        throw new Error(
          `Segmented placement graph contains a cycle at '${current}'.`
        );
      }
      visited.add(current);
      current = this.relationByNodeId.get(current)?.parentNodeId;
    }
  }

  /** Add one relation to the authenticated root aggregate. */
  private addRootLeaf(relation: InventoryPlacementRelation): void {
    const leaf = inventoryPlacementRelationLeaf(relation);
    this.primaryRootSum = normalizePlacementRootSum(
      this.primaryRootSum + leaf.primary
    );
    this.secondaryRootSum = normalizePlacementRootSum(
      this.secondaryRootSum + leaf.secondary
    );
  }

  /** Remove one relation from the authenticated root aggregate. */
  private removeRootLeaf(relation: InventoryPlacementRelation): void {
    const leaf = inventoryPlacementRelationLeaf(relation);
    this.primaryRootSum = normalizePlacementRootSum(
      this.primaryRootSum - leaf.primary
    );
    this.secondaryRootSum = normalizePlacementRootSum(
      this.secondaryRootSum - leaf.secondary
    );
  }
}

/** Build one reference segmented placement store. */
export function createInMemoryInventorySegmentedPlacementStore(
  input: CreateInMemoryInventorySegmentedPlacementStoreInput = {}
): InMemoryInventorySegmentedPlacementStore {
  return new InMemoryInventorySegmentedPlacementStore(input);
}

/** Add one child identity to one parent row. */
function addPlacementChild(
  index: Map<string, Set<string>>,
  parentNodeId: string,
  childNodeId: string
): void {
  const children = index.get(parentNodeId) ?? new Set<string>();
  children.add(childNodeId);
  index.set(parentNodeId, children);
}

/** Remove one child and drop an empty parent row. */
function removePlacementChild(
  index: Map<string, Set<string>>,
  parentNodeId: string,
  childNodeId: string
): void {
  const children = index.get(parentNodeId);
  if (children === undefined) return;
  children.delete(childNodeId);
  if (children.size === 0) index.delete(parentNodeId);
}

/** 256-bit modular field used by the placement segment root. */
const inventoryPlacementRootModulus = 1n << 256n;

/** Bind one exact relation to two independent leaf hashes. */
function inventoryPlacementRelationLeaf(
  relation: InventoryPlacementRelation
): {
  /** Primary authenticated leaf component. */
  readonly primary: bigint;
  /** Independent secondary authenticated leaf component. */
  readonly secondary: bigint;
} {
  const tuple = [
    relation.nodeId,
    relation.parentNodeId,
    relation.createdByEventId,
  ] as const;
  return {
    primary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-placement-segment-leaf-primary-v1",
            tuple,
          ])
        )
    ),
    secondary: BigInt(
      "0x" +
        inventorySha256(
          inventoryIntentFingerprint([
            "inventory-placement-segment-leaf-secondary-v1",
            tuple,
          ])
        )
    ),
  };
}

/** Normalize one signed placement aggregate into the unsigned 256-bit domain. */
function normalizePlacementRootSum(value: bigint): bigint {
  const normalized = value % inventoryPlacementRootModulus;
  return normalized < 0n
    ? normalized + inventoryPlacementRootModulus
    : normalized;
}

/** Encode one placement aggregate as exactly 64 lower-case hexadecimal digits. */
function inventoryPlacementRootHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
