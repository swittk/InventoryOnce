import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  InventoryAuthorityCreateResult,
  InventoryDeficitPolicy,
  type InventoryAuthorityDocument,
  type InventoryAuthorityFields,
  type InventoryAuthorityStateStore,
  type InventoryCatalog,
  type InventoryOnce,
  type InventoryStockPositionInput,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  type InventoryClock,
  type InventoryDurableStorage,
} from "../src/storage-api.js";

/** Stable test occurrence/record time. */
export const time0 = 1787558400000;
/** Stable later test time. */
export const time1 = 1787562000000;
/** Stable still-later test time. */
export const time2 = 1787565600000;
/** Stable final test time. */
export const time3 = 1787569200000;

/** Build retained scalar item/package revisions with both old and current package history. */
export function createTabletCatalog(): InventoryCatalog {
  const itemV1 = defineScalarInventoryItem({
    itemId: "item-a",
    revisionId: "item-a-v1",
    unit: "piece",
    axisId: "pieces",
  });
  const itemV2 = defineScalarInventoryItem({
    itemId: "item-a",
    revisionId: "item-a-v2",
    unit: "piece",
    axisId: "pieces",
    qualifiedDimensions: [
      { dimensionId: "grade", description: "Physical grade bucket." },
    ],
  });
  return defineInventoryCatalog({
    itemRevisions: [itemV1, itemV2],
    activeItemRevisionIds: { "item-a": itemV2.revisionId },
    packagingRevisions: [
      defineScalarInventoryPackaging({
        revisionId: "item-a-box-20-v1",
        item: itemV1,
        packageUnit: "box",
        contains: "20",
      }),
      defineScalarInventoryPackaging({
        revisionId: "item-a-box-24-v1",
        item: itemV2,
        packageUnit: "box",
        contains: "24",
      }),
    ],
  });
}

/** Build a fixed clock so record time is deterministic and separate from occurrence time. */
export function clockAt(recordedAtEpochMs = time3): InventoryClock {
  return {
    /** Return the one test record time. */
    nowEpochMs: () => recordedAtEpochMs,
  };
}

/** Build one façade over a caller-supplied or fresh durable reference adapter. */
export function createTestInventory(
  storage: InventoryDurableStorage = createInMemoryInventoryDurableStorage(),
  catalog: InventoryCatalog = createTabletCatalog(),
  clock: InventoryClock = clockAt(),
  deficitPolicy: InventoryDeficitPolicy = InventoryDeficitPolicy.Reject
): InventoryOnce {
  return createInventoryOnce({ catalog, storage, clock, deficitPolicy });
}

/** Build one ordinary loose-stock command position. */
export function loosePosition(
  locationId: string,
  extra: Omit<InventoryStockPositionInput, "itemId" | "locationId"> = {}
): InventoryStockPositionInput {
  return { itemId: "item-a", locationId, ...extra };
}


/** Shared in-memory authority row used by formal refinement/completion tests. */
export class TestInventoryAuthorityDatabase {
  /** Exact requested scalar schema. */
  fields: InventoryAuthorityFields | undefined;
  /** Current authority document. */
  document: InventoryAuthorityDocument | undefined;
}

/** Deterministic compare-and-set authority store shared by formal implementation suites. */
export class TestInventoryAuthorityStore implements InventoryAuthorityStateStore {
  /** Shared durable row. */
  private readonly database: TestInventoryAuthorityDatabase;

  /** Bind one controller to a shared or fresh row. */
  constructor(database = new TestInventoryAuthorityDatabase()) {
    this.database = database;
  }

  /** Create or verify the scalar schema. */
  async ensure(fields: InventoryAuthorityFields): Promise<void> {
    if (this.database.fields !== undefined) {
      const currentKeys = Object.keys(this.database.fields);
      const nextKeys = Object.keys(fields);
      if (currentKeys.length !== nextKeys.length) {
        throw new Error("Formal authority schema changed.");
      }
      for (const key of currentKeys) {
        if (this.database.fields[key] !== fields[key]) {
          throw new Error("Formal authority schema changed.");
        }
      }
    }
    this.database.fields ??= structuredClone(fields);
  }

  /** Read one isolated document copy. */
  async read(): Promise<InventoryAuthorityDocument | undefined> {
    return this.database.document === undefined
      ? undefined
      : structuredClone(this.database.document);
  }

  /** Create the initial row exactly once. */
  async create(
    document: InventoryAuthorityDocument,
  ): Promise<InventoryAuthorityCreateResult> {
    if (this.database.document !== undefined) {
      return InventoryAuthorityCreateResult.Existing;
    }
    this.database.document = structuredClone(document);
    return InventoryAuthorityCreateResult.Created;
  }

  /** Apply a partial replacement under exact scalar compare-and-set. */
  async compareAndSet(
    expected: InventoryAuthorityDocument,
    replacement: InventoryAuthorityDocument,
  ): Promise<boolean> {
    const current = this.database.document;
    if (current === undefined) return false;
    for (const [field, value] of Object.entries(expected)) {
      if (current[field] !== value) return false;
    }
    this.database.document = { ...current, ...structuredClone(replacement) };
    return true;
  }
}
