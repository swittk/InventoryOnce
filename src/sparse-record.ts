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
}

/** Copy every own sparse-record entry into a fresh prototype-free record. */
export function cloneInventorySparseRecord<T>(
  record: Readonly<Record<string, T>>
): Record<string, T> {
  const clone = createInventorySparseRecord<T>();
  for (const [key, value] of Object.entries(record)) {
    setInventorySparseRecordValue(clone, key, value);
  }
  return clone;
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
