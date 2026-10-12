/** Objects whose complete reachable graph has been proved deeply immutable. */
const inventoryDeeplyImmutableObjects = new WeakSet<object>();

/** Return whether one exact object already has a trusted deep-immutability proof. */
export function inventoryObjectIsKnownDeeplyImmutable(value: object): boolean {
  return inventoryDeeplyImmutableObjects.has(value);
}

/** Mark one frozen object after its complete reachable child graph has been proved immutable. */
export function markInventoryObjectDeeplyImmutable(value: object): void {
  if (!Object.isFrozen(value)) {
    throw new Error("Inventory deep-immutable marking requires a frozen object.");
  }
  inventoryDeeplyImmutableObjects.add(value);
}

/** Prove one recursively frozen graph immutable, reusing earlier trusted object proofs. */
export function inventoryObjectIsDeeplyImmutable(value: object): boolean {
  if (inventoryObjectIsKnownDeeplyImmutable(value)) return true;
  if (!Object.isFrozen(value)) return false;
  const visited: object[] = [];
  const pending: object[] = [value];
  const inspecting = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (
      current === undefined ||
      inventoryObjectIsKnownDeeplyImmutable(current) ||
      inspecting.has(current)
    ) {
      continue;
    }
    if (!Object.isFrozen(current)) return false;
    inspecting.add(current);
    visited.push(current);
    for (const child of Object.values(current)) {
      if (
        child !== null &&
        typeof child === "object" &&
        !inventoryObjectIsKnownDeeplyImmutable(child)
      ) {
        pending.push(child);
      }
    }
  }
  for (const current of visited) markInventoryObjectDeeplyImmutable(current);
  return true;
}

/** Private copy-on-write ancestry used to derive immutable record roots from changed keys only. */
export interface InventorySparseRecordLineage<T> {
  /** Immediate source record cloned into this record. */
  readonly base: Readonly<Record<string, T>>;
  /** Exact own keys changed after cloning, including deletions. */
  readonly changedKeys: ReadonlySet<string>;
  /** Monotonic mutation revision, including repeated writes to one changed key. */
  readonly revision: number;
}

/** Mutable private lineage retained only for live in-process copy-on-write records. */
interface MutableInventorySparseRecordLineage<T> {
  /** Immediate source record cloned into this record. */
  readonly base: Readonly<Record<string, T>>;
  /** Mutable changed-key set updated by the safe record mutation helpers. */
  readonly changedKeys: Set<string>;
  /** Monotonic mutation revision, including repeated writes to one changed key. */
  revision: number;
}

/** Record object -> immediate copy-on-write ancestry; never serialized or persisted. */
const inventorySparseRecordLineageByRecord = new WeakMap<
  object,
  MutableInventorySparseRecordLineage<unknown>
>();

/** Private lineage for one canonical sorted unique identity-set array. */
export interface InventorySortedIdentitySetLineage {
  /** Immediate sorted unique identity set used to construct this array. */
  readonly base: readonly string[];
  /** Identities added relative to the immediate base. */
  readonly added: ReadonlySet<string>;
  /** Identities removed relative to the immediate base. */
  readonly removed: ReadonlySet<string>;
}

/** Array object -> exact sorted-set copy-on-write ancestry; never persisted. */
const inventorySortedIdentitySetLineageByArray = new WeakMap<
  object,
  InventorySortedIdentitySetLineage
>();

/** Apply exact membership changes and retain private lineage for incremental value hashing. */
export function updateInventorySortedIdentitySet(
  base: readonly string[],
  desiredMembership: ReadonlyMap<string, boolean>
): readonly string[] {
  if (desiredMembership.size === 0) return base;
  const baseSet = new Set(base);
  const next = new Set(base);
  for (const [identity, present] of desiredMembership) {
    if (present) next.add(identity);
    else next.delete(identity);
  }
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const [identity, present] of desiredMembership) {
    const existed = baseSet.has(identity);
    if (present && !existed) added.add(identity);
    if (!present && existed) removed.add(identity);
  }
  if (added.size === 0 && removed.size === 0) return base;
  const ordered = [...next];
  ordered.sort();
  Object.freeze(ordered);
  inventorySortedIdentitySetLineageByArray.set(ordered, {
    base,
    added,
    removed,
  });
  return ordered;
}

/** Return private sorted-identity-set ancestry when this array was updated in-process. */
export function inventorySortedIdentitySetLineage(
  value: readonly unknown[]
): InventorySortedIdentitySetLineage | undefined {
  return inventorySortedIdentitySetLineageByArray.get(value);
}

/** Create one prototype-free sparse record for arbitrary application-defined string keys. */
export function createInventorySparseRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Return whether an arbitrary-key sparse record owns one exact key. */
export function inventorySparseRecordHas(
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Read one own sparse-record entry without accepting inherited Object.prototype properties. */
export function inventorySparseRecordValue<T>(
  record: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  return inventorySparseRecordHas(record, key) ? record[key] : undefined;
}

/** Define one own enumerable sparse-record entry without invoking the legacy __proto__ setter. */
export function setInventorySparseRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const lineage = inventorySparseRecordLineageByRecord.get(record);
  if (lineage !== undefined) {
    lineage.changedKeys.add(key);
    lineage.revision += 1;
  }
}

/** Delete one own sparse-record entry while preserving copy-on-write root lineage. */
export function deleteInventorySparseRecordValue<T>(
  record: Record<string, T>,
  key: string
): boolean {
  if (!inventorySparseRecordHas(record, key)) return false;
  const deleted = Reflect.deleteProperty(record, key);
  if (!deleted) {
    throw new Error(`Inventory sparse record could not delete key '${key}'.`);
  }
  const lineage = inventorySparseRecordLineageByRecord.get(record);
  if (lineage !== undefined) {
    lineage.changedKeys.add(key);
    lineage.revision += 1;
  }
  return true;
}

/** Copy every own sparse-record entry into a fresh prototype-free record. */
export function cloneInventorySparseRecord<T>(
  record: Readonly<Record<string, T>>
): Record<string, T> {
  const clone = createInventorySparseRecord<T>();
  for (const [key, value] of Object.entries(record)) {
    Object.defineProperty(clone, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  inventorySparseRecordLineageByRecord.set(clone, {
    base: record,
    changedKeys: new Set<string>(),
    revision: 0,
  });
  return clone;
}

/** Return private copy-on-write ancestry for one record when it was cloned in this process. */
export function inventorySparseRecordLineage<T>(
  record: Readonly<Record<string, T>>
): InventorySparseRecordLineage<T> | undefined {
  return inventorySparseRecordLineageByRecord.get(record) as
    | InventorySparseRecordLineage<T>
    | undefined;
}


/** Detach one JSON-friendly retained fact without losing own-only dictionary prototypes. */
export function cloneInventoryRetainedData<T>(value: T): T {
  const cloned = structuredClone(value);
  restoreRetainedSparsePrototypes(value, cloned, new WeakSet<object>());
  return cloned;
}

/** Restore null-prototype dictionaries after platform cloning; shared subgraphs are visited once. */
function restoreRetainedSparsePrototypes(
  source: unknown,
  cloned: unknown,
  visited: WeakSet<object>
): void {
  if (source === null || typeof source !== "object" || cloned === null || typeof cloned !== "object" || visited.has(source)) return;
  visited.add(source);
  if (Object.getPrototypeOf(source) === null) Object.setPrototypeOf(cloned, null);
  for (const key of Object.keys(source)) {
    restoreRetainedSparsePrototypes(Reflect.get(source, key), Reflect.get(cloned, key), visited);
  }
}
