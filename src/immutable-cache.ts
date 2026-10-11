/** Objects proven deeply immutable by the reference publication boundary. */
const deeplyImmutableInventoryObjects = new WeakSet<object>();

/** Mark one already-frozen object as part of a trusted deeply immutable world graph. */
export function markInventoryObjectDeeplyImmutable(value: object): void {
  if (!Object.isFrozen(value)) {
    throw new Error("Inventory digest caching requires a frozen object.");
  }
  deeplyImmutableInventoryObjects.add(value);
}

/** Return whether the reference publisher proved this exact object deeply immutable. */
export function inventoryObjectIsDeeplyImmutable(value: object): boolean {
  return deeplyImmutableInventoryObjects.has(value);
}
