import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import * as kernel from "../src/kernel.js";
import * as migrations from "../src/migrations-api.js";
import * as storage from "../src/storage-api.js";

/** Return whether one module namespace exposes a named runtime footgun. */
function hasExport(module: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(module, name);
}

describe("public export boundaries", () => {
  it("keeps normal root usage grouped/declarative and excludes low-level write machinery", () => {
    expect(hasExport(root, "createInventoryOnce")).toBe(true);
    expect(hasExport(root, "createInventoryAuthorityControl")).toBe(true);
    expect(hasExport(root, "InventoryAuthorityMode")).toBe(true);
    expect(hasExport(root, "ensureInventoryScalarCatalogRevision")).toBe(true);
    expect(hasExport(root, "stockAmount")).toBe(true);
    expect(hasExport(root, "packageAmount")).toBe(true);
    expect(hasExport(root, "inventoryAmountFromUnit")).toBe(true);
    expect(hasExport(root, "assertInventoryAmountSum")).toBe(true);
    expect(hasExport(root, "findInventoryEventByOperationId")).toBe(true);
    expect(hasExport(root, "InventoryAuthorityMode")).toBe(true);
    expect(hasExport(root, "requireInventoryAuthorityMode")).toBe(true);
    expect(hasExport(root, "defineInventoryPolicyBatchRequestGroup")).toBe(
      true
    );
    expect(hasExport(root, "combineInventoryPolicyBatchRequestGroups")).toBe(
      true
    );
    expect(
      hasExport(root, "inventoryPolicyBatchAllocationLinesByReference")
    ).toBe(true);
    expect(hasExport(root, "inventoryStockSelector")).toBe(true);
    expect(hasExport(root, "InventoryCompositionOutputAmountKind")).toBe(true);
    expect(hasExport(root, "InventoryCollectionMemberKind")).toBe(true);
    for (const forbidden of [
      "applyInventoryCommittedEvent",
      "commitInventoryOperation",
      "createInventoryReceiptEvent",
      "createInventoryCompositionOpenEvent",
      "summarizeInventoryCollection",
      "InMemoryInventoryDurableStorage",
      "defineInventoryMigration",
      "applyInventoryTransaction",
      "receiptTransaction",
      "emptyInventoryState",
    ]) {
      expect(hasExport(root, forbidden), forbidden).toBe(false);
    }
  });

  it("puts expert kernel, durable storage, and migration plumbing on explicit subpaths", () => {
    expect(hasExport(kernel, "applyInventoryCommittedEvent")).toBe(true);
    expect(hasExport(kernel, "createInventoryCompositionOpenEvent")).toBe(true);
    expect(hasExport(kernel, "createInventoryTransferPrepareEvent")).toBe(true);
    expect(hasExport(kernel, "summarizeInventoryCollection")).toBe(true);
    expect(hasExport(kernel, "commitInventoryOperation")).toBe(false);
    expect(hasExport(storage, "createInMemoryInventoryDurableStorage")).toBe(
      true
    );
    expect(hasExport(storage, "commitInventoryOperation")).toBe(true);
    expect(hasExport(storage, "repairInventoryDurableOperations")).toBe(true);
    expect(hasExport(migrations, "defineInventoryMigrationPlugin")).toBe(true);
    expect(hasExport(migrations, "applyInventoryMigrationPlan")).toBe(true);
  });

  it("publishes only root, kernel, storage, and migrations package entrypoints", () => {
    // JSON.parse returns any; narrow only the manifest keys this test reads, leaving values unknown by design.
    const packageManifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
    ) as { readonly exports?: Readonly<Record<string, unknown>> };
    const entrypoints = Object.keys(packageManifest.exports ?? {}).sort();
    expect(entrypoints).toEqual([
      ".",
      "./kernel",
      "./migrations",
      "./storage",
    ]);
  });
});
