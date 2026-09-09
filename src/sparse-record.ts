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
