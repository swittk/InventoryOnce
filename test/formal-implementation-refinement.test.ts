import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryAuthorityMode,
  InventoryDeficitPolicy,
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationKind,
  createInventoryAuthorityControl,
  inventoryStockSelector,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import type { InventoryTraceabilityState } from "../src/traceability.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
  repairInventoryMigrationManifests,
} from "../src/migrations-api.js";
import {
  InventoryStorageWriteStage,
  type InventoryStorageFailpoint,
} from "../src/storage-api.js";
import {
  abstractAuthorityState,
  abstractInventoryState,
  abstractMigrationState,
  abstractOperationResult,
  abstractPositionIdentity,
  abstractPrimaryBalance,
  assertAbstractAuthorityInvariants,
  assertAbstractInventoryInvariants,
  assertAbstractMigrationInvariants,
  assertAbstractTraceabilityInvariants,
  assertStateResultRefinement,
} from "./formal-implementation-abstraction.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  TestInventoryAuthorityStore,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded trace identities executed by this suite. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-BOUNDED-FACADE-METAMORPHIC-CORPUS",
  "TRACE-RECORDED-DEFICIT-REFINEMENT",
] as const;

void FORMAL_IMPLEMENTATION_TRACE_IDS;

/** Build one fixed migration used by publish/replay/failure refinement. */
function createRefinementMigration(balance = "5"): {
  /** Catalog used to compile the migration plan. */
  readonly catalog: ReturnType<typeof createTabletCatalog>;
  /** Deterministic migration plan used by refinement checks. */
  readonly plan: ReturnType<typeof defineInventoryMigration>;
} {
  const catalog = createTabletCatalog();
  const plan = defineInventoryMigration({
    catalog,
    declaration: {
      migrationId: "formal-migration",
      sourceSystem: "formal-legacy-source",
      cutoverAt: time0,
      openingStock: [
        {
          openingId: "formal-opening",
          position: loosePosition("migration-store", {
            lotId: "FORMAL-MIGRATION-LOT",
          }),
          amount: stockAmount(balance, "piece"),
          itemRevisionId: "item-a-v2",
          lot: { manufacturedAt: time0, expiresAt: time3 },
          source: { sourceType: "legacy-row", sourceId: "formal-opening" },
        },
      ],
    },
  });
  return { catalog, plan };
}

describe("formal implementation state/result refinement", () => {
  it("canonicalizes abstraction identities independently of producer ordering", () => {
    const left = {
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      locationId: "store",
      qualifiedDimensions: [
        { dimensionId: "zone", valueId: "B" },
        { dimensionId: "temperature", valueId: "cold" },
      ],
    };
    const right = {
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      locationId: "store",
      qualifiedDimensions: [
        { dimensionId: "temperature", valueId: "cold" },
        { dimensionId: "zone", valueId: "B" },
      ],
    };
    expect(abstractPositionIdentity(left)).toBe(abstractPositionIdentity(right));

    const traceability: InventoryTraceabilityState = {
      relations: {
        "semantic-self-cycle": {
          kind: InventoryTraceabilityRelationKind.Containment,
          from: { kind: InventoryTraceabilityNodeKind.Container, id: "SAME" },
          to: { id: "SAME", kind: InventoryTraceabilityNodeKind.Container },
          createdByEventId: "semantic-self-cycle-event",
        },
      },
      containmentChildContainerIdsByParentNodeIdentity: {},
    };
    expect(() => assertAbstractTraceabilityInvariants(traceability)).toThrow(
      "cycle"
    );
  });
  it("replays every bounded receive/issue/transfer trace against arithmetic invariants", async () => {
    for (const received of [4, 5]) {
      for (const issued of [1, 2]) {
        for (const transferred of [1, 2]) {
          const suffix = `${received}-${issued}-${transferred}`;
          const inventory = createTestInventory();
          const receiveCommand = {
            operationId: `bounded-receive-${suffix}`,
            occurredAt: time0,
            to: loosePosition("store", { lotId: `BOUNDED-${suffix}` }),
            amount: stockAmount(String(received), "piece"),
          };
          let before = await inventory.read.world();
          const receive = await inventory.stock.receive(receiveCommand);
          let after = await inventory.read.world();
          assertStateResultRefinement(before, after, receive);

          const issueCommand = {
            operationId: `bounded-issue-${suffix}`,
            occurredAt: time1,
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount(String(issued), "piece"),
            method: InventoryAllocationMethod.Fifo,
          };
          before = after;
          const issue = await inventory.stock.issueByPolicy(issueCommand);
          after = await inventory.read.world();
          assertStateResultRefinement(before, after, issue);

          const transferCommand = {
            operationId: `bounded-transfer-${suffix}`,
            occurredAt: time2,
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount(String(transferred), "piece"),
            method: InventoryAllocationMethod.Fifo,
            toLocationId: "room",
          };
          before = after;
          const transfer = await inventory.stock.transferByPolicy(
            transferCommand
          );
          after = await inventory.read.world();
          assertStateResultRefinement(before, after, transfer);
          assertAbstractInventoryInvariants(after);
          expect(
            abstractPrimaryBalance(after, "item-a", "store", "piece")
          ).toBe(String(received - issued - transferred));
          expect(abstractPrimaryBalance(after, "item-a", "room", "piece")).toBe(
            String(transferred)
          );
          expect(after.revision).toBe(3);
          expect(after.projection.lastRecordSequence).toBe(3);

          const replayBefore = await inventory.read.world();
          const replayed = await inventory.stock.transferByPolicy(
            transferCommand
          );
          const replayAfter = await inventory.read.world();
          assertStateResultRefinement(replayBefore, replayAfter, replayed);
          expect(replayed.replayed).toBe(true);
          expect(abstractInventoryState(replayAfter)).toEqual(
            abstractInventoryState(replayBefore)
          );
        }
      }
    }
  });

  it("refines recorded deficit as signed non-allocatable truth while Reject stutters", async () => {
    const selector = inventoryStockSelector("item-a", {
      locationIds: ["store"],
    });
    const recordedInventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );

    let before = await recordedInventory.read.world();
    const firstIssue = await recordedInventory.stock.issueByPolicy({
      operationId: "formal-record-deficit-from-empty",
      occurredAt: time0,
      selector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    let after = await recordedInventory.read.world();
    assertStateResultRefinement(before, after, firstIssue);
    expect(firstIssue.deficit).toEqual(
      expect.objectContaining({
        position: expect.objectContaining({
          lotId: "__inventory_deficit__",
          locationId: "store",
        }),
        primary: expect.objectContaining({ amountMinor: 5, unit: "piece" }),
      })
    );
    expect(abstractOperationResult(firstIssue).deficit).toEqual(
      expect.objectContaining({ primary: [5, 0, "piece"] })
    );
    const replayBefore = after;
    const replayedFirstIssue = await recordedInventory.stock.issueByPolicy({
      operationId: "formal-record-deficit-from-empty",
      occurredAt: time0,
      selector,
      amount: stockAmount("5", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    const replayAfter = await recordedInventory.read.world();
    assertStateResultRefinement(replayBefore, replayAfter, replayedFirstIssue);
    expect(replayedFirstIssue.replayed).toBe(true);
    expect(replayedFirstIssue.deficit).toEqual(firstIssue.deficit);
    expect(abstractPrimaryBalance(after, "item-a", "store", "piece")).toBe(
      String(-5)
    );

    let availability = await recordedInventory.read.availability(
      selector,
      time1
    );
    const emptyDeficitRevision = availability.revisions[0];
    expect(emptyDeficitRevision?.onHand.primary.quantity.amountMinor).toBe(-5);
    expect(
      emptyDeficitRevision?.physicalOnHand.primary.quantity.amountMinor
    ).toBe(0);
    expect(emptyDeficitRevision?.deficit.primary.quantity.amountMinor).toBe(5);
    expect(emptyDeficitRevision?.unallocatedUsablePhysical.amountMinor).toBe(0);
    expect(emptyDeficitRevision?.positions).toEqual([
      expect.objectContaining({
        isDeficit: true,
        unallocatedUsablePhysical: expect.objectContaining({ amountMinor: 0 }),
      }),
    ]);

    before = after;
    const receipt = await recordedInventory.stock.receive({
      operationId: "formal-receive-after-recorded-deficit",
      occurredAt: time1,
      to: loosePosition("store", { lotId: "FORMAL-LATE-RECEIPT" }),
      amount: stockAmount("10", "piece"),
    });
    after = await recordedInventory.read.world();
    assertStateResultRefinement(before, after, receipt);
    availability = await recordedInventory.read.availability(selector, time2);
    const coveredDeficitRevision = availability.revisions[0];
    expect(coveredDeficitRevision?.onHand.primary.quantity.amountMinor).toBe(5);
    expect(
      coveredDeficitRevision?.physicalOnHand.primary.quantity.amountMinor
    ).toBe(10);
    expect(coveredDeficitRevision?.deficit.primary.quantity.amountMinor).toBe(
      5
    );
    expect(coveredDeficitRevision?.unallocatedUsablePhysical.amountMinor).toBe(
      5
    );

    before = after;
    const secondIssue = await recordedInventory.stock.issueByPolicy({
      operationId: "formal-issue-through-covered-deficit",
      occurredAt: time2,
      selector: inventoryStockSelector("item-a", {
        locationIds: ["store"],
        lotIds: ["FORMAL-LATE-RECEIPT"],
      }),
      amount: stockAmount("6", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    after = await recordedInventory.read.world();
    assertStateResultRefinement(before, after, secondIssue);
    expect(abstractPrimaryBalance(after, "item-a", "store", "piece")).toBe(
      String(-1)
    );
    availability = await recordedInventory.read.availability(selector, time3);
    const exhaustedRevision = availability.revisions[0];
    expect(exhaustedRevision?.physicalOnHand.primary.quantity.amountMinor).toBe(
      5
    );
    expect(exhaustedRevision?.deficit.primary.quantity.amountMinor).toBe(6);
    expect(exhaustedRevision?.unallocatedUsablePhysical.amountMinor).toBe(0);

    const rejectingInventory = createTestInventory();
    const rejectBefore = await rejectingInventory.read.world();
    await expect(
      rejectingInventory.stock.issueByPolicy({
        operationId: "formal-reject-deficit-from-empty",
        occurredAt: time0,
        selector,
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
      })
    ).rejects.toThrow("shortfall");
    expect(
      abstractInventoryState(await rejectingInventory.read.world())
    ).toEqual(abstractInventoryState(rejectBefore));
  });

  it("refines the authority writer-fence trace and rejects downgrade/mismatch bypass", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestInventoryAuthorityStore(),
      namespaceId: "formal-authority:primary",
    });
    const states = [await authority.read()];
    await authority.certifyAdapter({
      certificationDigest: "formal-adapter-certification",
      certifiedAt: time0,
    });
    states.push(
      await authority.enterShadow({
        certificationDigest: "formal-adapter-certification",
      })
    );
    states.push(
      await authority.enterDualRun({
        sourceRoot: "formal-source-root",
        sourceRevision: 7,
        sourcePlanDigest: "formal-source-plan",
        sourceCatalogDigest: "formal-source-catalog",
        startedAt: time1,
      })
    );
    const beforeMismatch = await authority.read();
    await authority.recordDualRunMismatch({
      commandId: "formal-mismatch",
      legacyIntentDigest: "legacy-intent",
      authoritativeIntentDigest: "native-intent",
      recordedAt: time2,
    });
    await expect(
      authority.claimFence({ fenceToken: "blocked-fence", startedAt: time2 })
    ).rejects.toThrow("mismatch evidence");
    expect((await authority.read()).mode).toBe(beforeMismatch.mode);

    const cleanAuthority = createInventoryAuthorityControl({
      store: new TestInventoryAuthorityStore(),
      namespaceId: "formal-authority-clean:primary",
    });
    await cleanAuthority.certifyAdapter({
      certificationDigest: "formal-adapter-certification",
      certifiedAt: time0,
    });
    await cleanAuthority.enterShadow({
      certificationDigest: "formal-adapter-certification",
    });
    await cleanAuthority.enterDualRun({
      sourceRoot: "formal-source-root",
      sourceRevision: 7,
      sourcePlanDigest: "formal-source-plan",
      sourceCatalogDigest: "formal-source-catalog",
      startedAt: time1,
    });
    states.push(
      await cleanAuthority.claimFence({
        fenceToken: "formal-fence",
        startedAt: time2,
        sourceRoot: "formal-source-root",
        sourceRevision: 7,
      })
    );
    const activated = await cleanAuthority.activate({
      fenceToken: "formal-fence",
      sourcePlanDigest: "formal-source-plan",
      sourceCatalogDigest: "formal-source-catalog",
      sourceRoot: "formal-source-root",
      targetWorldRoot: "formal-target-root",
      targetWorldRevision: 1,
      activatedAt: time3,
    });
    states.push(activated);
    for (const state of states) assertAbstractAuthorityInvariants(state);
    expect(states.map((state) => abstractAuthorityState(state).mode)).toEqual([
      InventoryAuthorityMode.Legacy,
      InventoryAuthorityMode.Shadow,
      InventoryAuthorityMode.DualRun,
      InventoryAuthorityMode.Fencing,
      InventoryAuthorityMode.Authoritative,
    ]);
    expect(
      await cleanAuthority.activate({
        fenceToken: "formal-fence",
        sourcePlanDigest: "formal-source-plan",
        sourceCatalogDigest: "formal-source-catalog",
        sourceRoot: "formal-source-root",
        targetWorldRoot: "formal-target-root",
        targetWorldRevision: 1,
        activatedAt: time3,
      })
    ).toEqual(activated);
    await expect(cleanAuthority.releaseFence("formal-fence")).rejects.toThrow(
      "cannot be reverted"
    );
  });

  it("refines migration compile, dry-run, atomic publish, replay, and changed-plan refusal", async () => {
    const { catalog, plan } = createRefinementMigration();
    assertAbstractMigrationInvariants(plan);
    const storage = createInMemoryInventoryDurableStorage();
    const base = await storage.readWorld();
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: base,
    });
    assertAbstractMigrationInvariants(dryRun);
    expect(abstractMigrationState(dryRun).result?.worldRevision).toBe(1);
    const applied = await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    assertAbstractInventoryInvariants(applied);
    expect(abstractInventoryState(applied)).toEqual(
      abstractInventoryState(dryRun.resultWorld)
    );
    expect(
      abstractPrimaryBalance(applied, "item-a", "migration-store", "piece")
    ).toBe(String(5));
    const replayed = await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    expect(abstractInventoryState(replayed)).toEqual(
      abstractInventoryState(applied)
    );

    const changed = createRefinementMigration("6");
    const changedDryRun = dryRunInventoryMigration({
      catalog: changed.catalog,
      plan: changed.plan,
      targetWorld: base,
    });
    const beforeChangedRetry = await storage.readWorld();
    await expect(
      applyInventoryMigrationPlan({
        catalog: changed.catalog,
        storage,
        plan: changed.plan,
        dryRun: changedDryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed whole plan");
    expect(abstractInventoryState(await storage.readWorld())).toEqual(
      abstractInventoryState(beforeChangedRetry)
    );
  });

  it("replays a frozen migration manifest after a staged-world crash", async () => {
    let failed = false;
    const failpoint: InventoryStorageFailpoint = ({
      stage,
      timing,
      operationId,
    }) => {
      if (
        !failed &&
        operationId === "formal-migration" &&
        stage === InventoryStorageWriteStage.MigrationWorld &&
        timing === "after"
      ) {
        failed = true;
        throw new Error("formal migration staged-world crash");
      }
    };
    const storage = createInMemoryInventoryDurableStorage({ failpoint });
    const { catalog, plan } = createRefinementMigration();
    const base = await storage.readWorld();
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: base,
    });
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("formal migration staged-world crash");
    expect(failed).toBe(true);
    expect(abstractInventoryState(await storage.readWorld())).toEqual(
      abstractInventoryState(base)
    );
    const repaired = await repairInventoryMigrationManifests({ storage });
    expect(repaired).toHaveLength(1);
    assertAbstractMigrationInvariants(repaired[0]!);
    const published = await storage.readWorld();
    expect(abstractInventoryState(published)).toEqual(
      abstractInventoryState(dryRun.resultWorld)
    );
    expect(
      (await storage.readMigrationManifest("formal-migration"))?.state
    ).toBe("completed");
  });
});
