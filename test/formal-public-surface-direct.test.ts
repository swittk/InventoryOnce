import { describe, expect, it } from "vitest";
import {
  InventoryCollectionMemberKind,
  InventoryTraceabilityRelationKind,
  combineInventoryAmountLineGroups,
  convertQuantityExact,
  cutoverInventoryAuthority,
  defineInventoryAmountLineGroup,
  defineInventoryCollection,
  multiplyQuantityByFactor,
  parseQuantity,
  quantityRatio,
  stockAmount,
  type CutoverInventoryAuthorityInput,
} from "../src/index.js";
import {
  emptyInventoryTraceabilityState,
  inventoryTraceabilityRelationsOfKind,
} from "../src/traceability.js";
import {
  createInMemoryInventoryDurableStorage,
  emptyInventoryWorldState,
  materializeInventoryDurableMigrationWorld,
  materializeInventoryDurableOperationWorld,
  validateInventoryDurableOperationBeginInput,
  validateInventoryMigrationManifestBeginInput,
  type BeginInventoryDurableOperationInput,
  type BeginInventoryMigrationManifestInput,
  type InventoryDurableMigrationPlan,
  type InventoryDurableOperationPlan,
} from "../src/storage-api.js";
import { clockAt, createTabletCatalog, time0 } from "./test-fixtures.js";

/** Machine-audited direct public-helper conformance trace. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-PUBLIC-HELPER-DIRECT-EXECUTION",
] as const;

/** Execute one expected-failure helper directly and require the intended message. */
function expectDirectValidationFailure(
  action: () => unknown,
  expectedMessage: string
): void {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) {
    throw new Error("Direct validation helper did not throw an Error.");
  }
  expect(failure.message).toContain(expectedMessage);
}

describe("direct execution of otherwise family-only public helpers", () => {
  it("executes exact quantity conversion and multiplication", () => {
    expect(
      convertQuantityExact(
        parseQuantity("2", "tablet"),
        "dose",
        quantityRatio(3, 2)
      )
    ).toEqual(parseQuantity("3", "dose"));
    expect(
      multiplyQuantityByFactor(
        parseQuantity("2", "tablet"),
        parseQuantity("0.5", "dose")
      )
    ).toEqual(parseQuantity("1.0", "dose"));
  });

  it("defines and combines exact amount-line groups", () => {
    const catalog = createTabletCatalog();
    const line = {
      lineId: "line-a",
      amount: stockAmount("1", "piece"),
      itemRevisionId: "item-a-v2",
    };
    const group = defineInventoryAmountLineGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("1", "piece"),
      lines: [line],
    });
    expect(group).toEqual([line]);
    expect(combineInventoryAmountLineGroups([group, group])).toEqual([
      line,
      line,
    ]);
  });

  it("defines a read-only collection and filters traceability by kind", () => {
    const catalog = createTabletCatalog();
    const collection = defineInventoryCollection({
      definition: {
        collectionId: "collection-a",
        revisionId: "collection-a-v1",
        members: [
          {
            kind: InventoryCollectionMemberKind.ItemRevision,
            revisionId: "item-a-v2",
          },
        ],
      },
      itemRevisions: catalog.itemRevisions,
      collectionRevisions: [],
    });
    expect(collection.members).toEqual([
      {
        kind: InventoryCollectionMemberKind.ItemRevision,
        revisionId: "item-a-v2",
      },
    ]);
    expect(
      inventoryTraceabilityRelationsOfKind(
        emptyInventoryTraceabilityState(),
        InventoryTraceabilityRelationKind.Association
      )
    ).toEqual([]);
  });

  it("executes durable begin/materialization validation helpers directly", () => {
    const base = emptyInventoryWorldState();
    // Empty plan assertions intentionally prove validation fails before any plan field is read.
    expectDirectValidationFailure(
      () =>
        validateInventoryDurableOperationBeginInput({
          operationId: "",
          intentFingerprint: "intent",
          baseRevision: 0,
          recordedAtEpochMs: time0,
          plan: {} as InventoryDurableOperationPlan,
        }),
      "operationId"
    );
    expectDirectValidationFailure(
      () =>
        materializeInventoryDurableOperationWorld(
          base,
          {} as InventoryDurableOperationPlan
        ),
      "base world"
    );
    expectDirectValidationFailure(
      () =>
        validateInventoryMigrationManifestBeginInput({
          migrationId: "",
          planDigest: "plan",
          baseRevision: 0,
          baseWorldRoot: "root",
          operationIds: [],
          sourceDispositions: [],
          plan: {} as InventoryDurableMigrationPlan,
        }),
      "manifest id"
    );
    expectDirectValidationFailure(
      () =>
        materializeInventoryDurableMigrationWorld(
          base,
          {} as InventoryDurableMigrationPlan
        ),
      "exact target world"
    );
  });

  it("invokes portable cutover validation without fabricating a source", async () => {
    // Intentionally bypass typed cutover constraints so runtime validation sees invalid migration/authority input.
    const invalid = {
      authority: undefined,
      storage: createInMemoryInventoryDurableStorage(),
      migrationId: "",
      fenceToken: "fence",
      adapterCertificationDigest: "certification",
      compileSource: async () => {
        throw new Error("compileSource must not run for an empty migrationId");
      },
      drainLegacyWriters: async () => undefined,
      clock: clockAt(),
    } as unknown as CutoverInventoryAuthorityInput;
    await expect(cutoverInventoryAuthority(invalid)).rejects.toThrow(
      "migrationId"
    );
  });
});
