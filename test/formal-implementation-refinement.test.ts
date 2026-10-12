import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryAuthorityMode,
  InventoryDeficitPolicy,
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationKind,
  createInventoryAuthorityControl,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import type { InventoryTraceabilityState } from "../src/traceability.js";
import type { InventoryPlacementState } from "../src/placement.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
  inventoryMigrationSnapshotSupersededDisposition,
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
  assertAbstractReservationInvariants,
  assertAbstractCountInvariants,
  assertAbstractMigrationInvariants,
  assertAbstractPlacementInvariants,
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
      cutoverAtEpochMs: time0,
      openingStock: [
        {
          openingId: "formal-opening",
          position: loosePosition("migration-store", {
            lotId: "FORMAL-MIGRATION-LOT",
          }),
          amount: stockAmount(balance, "piece"),
          itemRevisionId: "item-a-v2",
          lot: { manufacturedAtEpochMs: time0, expiresAtEpochMs: time3 },
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
      placementNodeId: "store",
      qualifiedDimensions: [
        { dimensionId: "zone", valueId: "B" },
        { dimensionId: "temperature", valueId: "cold" },
      ],
    };
    const right = {
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      placementNodeId: "store",
      qualifiedDimensions: [
        { dimensionId: "temperature", valueId: "cold" },
        { dimensionId: "zone", valueId: "B" },
      ],
    };
    expect(abstractPositionIdentity(left)).toBe(abstractPositionIdentity(right));

    const placement: InventoryPlacementState = {
      relationByNodeId: {
        SAME: {
          nodeId: "SAME",
          parentNodeId: "SAME",
          createdByEventId: "semantic-self-cycle-event",
        },
      },
      childNodeIdsByParentNodeId: { SAME: ["SAME"] },
    };
    expect(() => assertAbstractPlacementInvariants(placement)).toThrow(
      "cannot parent itself"
    );
  });

  it("distinguishes a retired embodied placement node from the same live node in the executable abstraction", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "abstract-retirement-receive",
      occurredAtEpochMs: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.individualize({
      operationId: "abstract-retirement-individualize",
      occurredAtEpochMs: time1,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
      serialId: "ABSTRACT-CABINET",
      asPlacementNode: {
        category: "cabinet",
        acceptsPlacement: true,
      },
    });
    const liveWorld = await inventory.read.world();
    const liveNode = liveWorld.projection.placementNodes["ABSTRACT-CABINET"];
    if (liveNode === undefined) {
      throw new Error("Expected the serialized cabinet's active node.");
    }
    const incorrectlyRetiredWorld = {
      ...liveWorld,
      projection: {
        ...liveWorld.projection,
        placementNodes: {
          ...liveWorld.projection.placementNodes,
          "ABSTRACT-CABINET": {
            ...liveNode,
            retiredByEventId: "forged-retirement",
          },
        },
      },
    };
    const live = abstractInventoryState(liveWorld);
    const incorrectlyRetired = abstractInventoryState(incorrectlyRetiredWorld);
    expect(live.placementNodes).not.toEqual(incorrectlyRetired.placementNodes);
    expect(incorrectlyRetired.placementNodes).toContainEqual(
      expect.objectContaining({
        identity: "ABSTRACT-CABINET",
        retiredByEventId: "forged-retirement",
      })
    );
  });

  it("rejects corrupted placement indexes and traceability graph shape", () => {
    const validPlacement: InventoryPlacementState = {
      relationByNodeId: {
        "formal-child": {
          nodeId: "formal-child",
          parentNodeId: "formal-parent",
          createdByEventId: "formal-placement-event",
        },
      },
      childNodeIdsByParentNodeId: {
        "formal-parent": ["formal-child"],
      },
    };
    expect(() => assertAbstractPlacementInvariants(validPlacement)).not.toThrow();
    expect(() =>
      assertAbstractPlacementInvariants({
        ...validPlacement,
        relationByNodeId: {
          "wrong-child-key": validPlacement.relationByNodeId["formal-child"]!,
        },
      })
    ).toThrow("dictionary key");
    expect(() =>
      assertAbstractPlacementInvariants({
        ...validPlacement,
        childNodeIdsByParentNodeId: {
          "wrong-parent": ["wrong-child"],
        },
      })
    ).toThrow("Placement child index");
    expect(() =>
      assertAbstractPlacementInvariants({
        relationByNodeId: {
          A: {
            nodeId: "A",
            parentNodeId: "B",
            createdByEventId: "placement-a",
          },
          B: {
            nodeId: "B",
            parentNodeId: "A",
            createdByEventId: "placement-b",
          },
        },
        childNodeIdsByParentNodeId: { A: ["B"], B: ["A"] },
      })
    ).toThrow("placement graph contains a cycle");

    const nodeIdentity = (node: {
      readonly kind: InventoryTraceabilityNodeKind;
      readonly id: string;
      readonly itemId?: string;
    }): string => JSON.stringify([node.kind, node.itemId ?? null, node.id]);
    const relationIdentity = (relation: {
      readonly kind: InventoryTraceabilityRelationKind;
      readonly from: Parameters<typeof nodeIdentity>[0];
      readonly to: Parameters<typeof nodeIdentity>[0];
    }): string =>
      JSON.stringify([
        relation.kind,
        nodeIdentity(relation.from),
        nodeIdentity(relation.to),
      ]);
    const serialA = {
      kind: InventoryTraceabilityNodeKind.Serial,
      id: "formal-serial-a",
    };
    const serialB = {
      kind: InventoryTraceabilityNodeKind.Serial,
      id: "formal-serial-b",
    };
    const genealogyAB = {
      kind: InventoryTraceabilityRelationKind.Genealogy,
      from: serialA,
      to: serialB,
      createdByEventId: "formal-genealogy-a",
    };
    const genealogyBA = {
      ...genealogyAB,
      from: serialB,
      to: serialA,
      createdByEventId: "formal-genealogy-b",
    };
    expect(() =>
      assertAbstractTraceabilityInvariants({
        relations: {
          [relationIdentity(genealogyAB)]: genealogyAB,
          [relationIdentity(genealogyBA)]: genealogyBA,
        },
      })
    ).toThrow("genealogy graph contains a cycle");
  });

  it("binds current traceability provenance to committed event history", async () => {
    const inventory = createTestInventory();
    await inventory.traceability.associate({
      operationId: "formal-provenance-associate",
      occurredAtEpochMs: time0,
      from: {
        kind: InventoryTraceabilityNodeKind.PlacementNode,
        id: "formal-provenance-child",
      },
      to: {
        kind: InventoryTraceabilityNodeKind.PlacementNode,
        id: "formal-provenance-parent",
      },
    });
    const world = await inventory.read.world();
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    const entry = Object.entries(world.projection.traceability.relations)[0];
    if (entry === undefined) throw new Error("Expected retained traceability relation.");
    const [identity, relation] = entry;
    const corrupted = {
      ...world,
      projection: {
        ...world.projection,
        traceability: {
          ...world.projection.traceability,
          relations: {
            [identity]: { ...relation, createdByEventId: "missing-event" },
          },
        },
      },
    };
    expect(() => assertAbstractInventoryInvariants(corrupted)).toThrow(
      "missing creating event"
    );
  });

  it("preserves special metadata keys in the independent formal abstraction", () => {
    const catalog = createTabletCatalog();
    const evidence = JSON.parse(
      '{"__proto__":{"__proto__":"formal-special-key"},"ordinary":"kept"}'
    ) as Record<string, unknown>;
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "formal-special-key-migration",
        sourceSystem: "formal-special-key-source",
        cutoverAtEpochMs: time0,
        openingStock: [],
        sourceDispositions: [
          inventoryMigrationSnapshotSupersededDisposition({
            dispositionId: "formal-special-key-row",
            source: { sourceType: "legacy", sourceId: "row" },
            snapshotAtEpochMs: time0,
            reason: "Retain exact audit evidence.",
            evidence: evidence as never,
          }),
        ],
      },
    });
    const abstracted = abstractMigrationState(plan);
    const disposition = abstracted.sourceDispositions[0];
    const retainedEvidence = disposition?.evidence as
      | Readonly<Record<string, unknown>>
      | undefined;
    expect(Object.prototype.hasOwnProperty.call(retainedEvidence, "__proto__"))
      .toBe(true);
    const nested = retainedEvidence?.["__proto__"] as
      | Readonly<Record<string, unknown>>
      | undefined;
    expect(Object.prototype.hasOwnProperty.call(nested, "__proto__")).toBe(true);
    expect(nested?.["__proto__"]).toBe("formal-special-key");
    expect(retainedEvidence?.ordinary).toBe("kept");
  });

  it("replays every bounded receive/issue/transfer trace against arithmetic invariants", async () => {
    for (const received of [4, 5]) {
      for (const issued of [1, 2]) {
        for (const transferred of [1, 2]) {
          const suffix = `${received}-${issued}-${transferred}`;
          const inventory = createTestInventory();
          const receiveCommand = {
            operationId: `bounded-receive-${suffix}`,
            occurredAtEpochMs: time0,
            to: loosePosition("store", { lotId: `BOUNDED-${suffix}` }),
            amount: stockAmount(String(received), "piece"),
          };
          let before = await inventory.read.world();
          const receive = await inventory.stock.receive(receiveCommand);
          let after = await inventory.read.world();
          assertStateResultRefinement(before, after, receive);

          const issueCommand = {
            operationId: `bounded-issue-${suffix}`,
            occurredAtEpochMs: time1,
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
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
            occurredAtEpochMs: time2,
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
            }),
            amount: stockAmount(String(transferred), "piece"),
            method: InventoryAllocationMethod.Fifo,
            toPlacementNodeId: "room",
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
      placementNodeIds: ["store"],
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
      occurredAtEpochMs: time0,
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
          placementNodeId: "store",
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
      occurredAtEpochMs: time0,
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
      occurredAtEpochMs: time1,
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
      occurredAtEpochMs: time2,
      selector: inventoryStockSelector("item-a", {
        placementNodeIds: ["store"],
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
        occurredAtEpochMs: time0,
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
      certifiedAtEpochMs: time0,
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
        startedAtEpochMs: time1,
      })
    );
    states.push(
      await authority.authorizeCutover({
        authorizationId: "formal-cutover-authorization",
      })
    );
    await authority.recordDualRunMismatch({
      commandId: "formal-mismatch",
      legacyIntentDigest: "legacy-intent",
      authoritativeIntentDigest: "native-intent",
      recordedAtEpochMs: time2,
    });
    const afterMismatch = await authority.read();
    await expect(
      authority.claimFence({ fenceToken: "blocked-fence", startedAtEpochMs: time2 })
    ).rejects.toThrow("mismatch evidence");
    expect(await authority.read()).toEqual(afterMismatch);

    const cleanAuthority = createInventoryAuthorityControl({
      store: new TestInventoryAuthorityStore(),
      namespaceId: "formal-authority-clean:primary",
    });
    await cleanAuthority.certifyAdapter({
      certificationDigest: "formal-adapter-certification",
      certifiedAtEpochMs: time0,
    });
    await cleanAuthority.enterShadow({
      certificationDigest: "formal-adapter-certification",
    });
    await cleanAuthority.enterDualRun({
      sourceRoot: "formal-source-root",
      sourceRevision: 7,
      sourcePlanDigest: "formal-source-plan",
      sourceCatalogDigest: "formal-source-catalog",
      startedAtEpochMs: time1,
    });
    await cleanAuthority.authorizeCutover({
      authorizationId: "formal-clean-cutover-authorization",
    });
    states.push(
      await cleanAuthority.claimFence({
        fenceToken: "formal-fence",
        startedAtEpochMs: time2,
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
      activatedAtEpochMs: time3,
    });
    states.push(activated);
    for (const state of states) assertAbstractAuthorityInvariants(state);
    expect(states.map((state) => abstractAuthorityState(state).mode)).toEqual([
      InventoryAuthorityMode.Legacy,
      InventoryAuthorityMode.Shadow,
      InventoryAuthorityMode.DualRun,
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
        activatedAtEpochMs: time3,
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
    const repairedManifest = repaired[0];
    if (repairedManifest === undefined) {
      throw new Error("Expected one repaired migration manifest.");
    }
    assertAbstractMigrationInvariants(repairedManifest);
    const published = await storage.readWorld();
    expect(abstractInventoryState(published)).toEqual(
      abstractInventoryState(dryRun.resultWorld)
    );
    expect(
      (await storage.readMigrationManifest("formal-migration"))?.state
    ).toBe("completed");
  });
});


describe("independent projection index bijections", () => {
  it("rejects primary dictionary keys that disagree with independently derived identities", async () => {
    const inventory = createTestInventory();
    await inventory.lots.define({
      operationId: "primary-key-lot",
      occurredAtEpochMs: time0,
      itemId: "item-a",
      lotId: "primary-key-lot",
      lot: { expiresAtEpochMs: time3 },
    });
    await inventory.placement.define({
      operationId: "primary-key-placement-node",
      occurredAtEpochMs: time0,
      nodeId: "primary-key-placement-node",
      placementNode: { category: "tray", useByEpochMs: time3 },
    });
    await inventory.stock.receive({
      operationId: "primary-key-position",
      occurredAtEpochMs: time0,
      to: loosePosition("A"),
      amount: stockAmount("1", "piece"),
    });
    const world = await inventory.read.world();
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    const p = world.projection;
    const positionEntry = Object.entries(p.positions)[0];
    const lotEntry = Object.entries(p.lots)[0];
    const placementNodeEntry = Object.entries(p.placementNodes)[0];
    if (positionEntry === undefined || lotEntry === undefined || placementNodeEntry === undefined) {
      throw new Error("Expected position, lot, and placement-node fixtures for primary-key controls.");
    }
    const [positionIdentity, position] = positionEntry;
    const wrongPositionIdentity = "wrong-position-identity";
    const replaceMember = (values: readonly string[]): readonly string[] =>
      values.map((value) => value === positionIdentity ? wrongPositionIdentity : value);
    const positionProjection = {
      ...p,
      positions: { [wrongPositionIdentity]: position },
      positionIdsByItemId: Object.fromEntries(Object.entries(p.positionIdsByItemId).map(([key, values]) => [key, replaceMember(values)])),
      positionIdsByItemRevisionId: Object.fromEntries(Object.entries(p.positionIdsByItemRevisionId).map(([key, values]) => [key, replaceMember(values)])),
      positionIdsByPlacementNodeId: Object.fromEntries(Object.entries(p.positionIdsByPlacementNodeId).map(([key, values]) => [key, replaceMember(values)])),
      positiveLayerStartedAtEpochMsByPositionId: {
        [wrongPositionIdentity]: p.positiveLayerStartedAtEpochMsByPositionId[positionIdentity] ?? time0,
      },
      positivePositionIdBySerialIdentity: Object.fromEntries(Object.entries(p.positivePositionIdBySerialIdentity).map(([key, value]) => [key, value === positionIdentity ? wrongPositionIdentity : value])),
    };
    const [lotIdentity, lot] = lotEntry;
    const wrongLotIdentity = "wrong-lot-identity";
    const lotProjection = {
      ...p,
      lots: { [wrongLotIdentity]: lot },
      lotIdentitiesByItemId: Object.fromEntries(Object.entries(p.lotIdentitiesByItemId).map(([key, values]) => [key, values.map((value) => value === lotIdentity ? wrongLotIdentity : value)])),
    };
    const [, placementNode] = placementNodeEntry;
    const placementNodeProjection = {
      ...p,
      placementNodes: { "wrong-placement-node-identity": placementNode },
    };
    for (const projection of [
      positionProjection,
      lotProjection,
      placementNodeProjection,
    ]) {
      expect(() => assertAbstractInventoryInvariants({ ...world, projection })).toThrow(/dictionary key disagrees with its primary identity/u);
    }
  });

  it("rejects surplus sequence and operation index rows on an otherwise honest published world", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "index-control", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("1", "piece") });
    const world = await inventory.read.world();
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    for (const projection of [
      { ...world.projection, eventIdsBySequence: { ...world.projection.eventIdsBySequence, "999": "missing" } },
      { ...world.projection, eventIdByOperationId: { ...world.projection.eventIdByOperationId, orphan: "missing" } },
    ]) {
      expect(() => assertAbstractInventoryInvariants({ ...world, projection })).toThrow("Event indexes retain entries without a published event");
    }
  });
});


describe("all projection secondary-index domains", () => {
  it("rejects orphan entries across independently derivable sibling indexes", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "index-domains", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("1", "piece") });
    const world = await inventory.read.world(), p = world.projection;
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    // Every corruption must reach its own index check rather than piggyback on an unrelated rejection.
    const variants = [
      [{ ...p, positionIdsByItemId: { ...p.positionIdsByItemId, orphan: [] } }, /Item position index/u],
      [{ ...p, positionIdsByItemRevisionId: { ...p.positionIdsByItemRevisionId, orphan: [] } }, /Revision position index/u],
      [{ ...p, positionIdsByPlacementNodeId: { ...p.positionIdsByPlacementNodeId, orphan: [] } }, /Direct placement position index/u],
      [{ ...p, positivePositionIdBySerialIdentity: { ...p.positivePositionIdBySerialIdentity, orphan: "missing" } }, /Positive serial index/u],
      [{ ...p, positiveLayerStartedAtEpochMsByPositionId: { ...p.positiveLayerStartedAtEpochMsByPositionId, orphan: 0 } }, /Positive layer index/u],
      [{ ...p, lotIdentitiesByItemId: { ...p.lotIdentitiesByItemId, orphan: [] } }, /Item lot index/u],
      [{ ...p, lotRootEventIdByIdentity: { ...p.lotRootEventIdByIdentity, orphan: "missing" } }, /Lot root ownership index/u],
      [{ ...p, placementNodeRootEventIdByNodeId: { ...p.placementNodeRootEventIdByNodeId, orphan: "missing" } }, /Placement-node root ownership index/u],
      [{ ...p, correctionEventIdByCorrectedEventId: { ...p.correctionEventIdByCorrectedEventId, orphan: "missing" } }, /Current correction index/u],
    ] as const;
    for (const [projection, diagnostic] of variants) expect.soft(() => assertAbstractInventoryInvariants({ ...world, projection })).toThrow(diagnostic);
  });
});

describe("operation-result refinement authority", () => {
  it("rejects returned event, reservation, count, and transfer payloads that disagree with published truth", async () => {
    {
      const inventory = createTestInventory();
      const before = await inventory.read.world();
      const result = await inventory.stock.receive({
        operationId: "result-event-authority",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          event: { ...result.event, occurredAtEpochMs: time1 },
        })
      ).toThrow("Result event disagrees with published event truth");
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "result-reservation-seed",
        occurredAtEpochMs: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      });
      const before = await inventory.read.world();
      const result = await inventory.reservations.reserve({
        reservationId: "result-reservation",
        operationId: "result-reservation:create",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["store"] },
        requested: parseQuantity("1", "piece"),
        createdAtEpochMs: time1,
      });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          reservation: {
            ...result.reservation,
            reservationId: "wrong-reservation",
          },
        })
      ).toThrow("Result reservation disagrees with published reservation truth");
    }

    {
      const inventory = createTestInventory();
      const before = await inventory.read.world();
      const result = await inventory.counts.start({
        countId: "result-count",
        operationId: "result-count:start",
        itemRevisionId: "item-a-v2",
        selector: { itemId: "item-a", placementNodeIds: ["store"] },
        startedAtEpochMs: time0,
      });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          count: { ...result.count, countId: "wrong-count" },
        })
      ).toThrow("Result count disagrees with published count truth");
    }

    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "result-transfer-seed",
        occurredAtEpochMs: time0,
        to: loosePosition("A"),
        amount: stockAmount("1", "piece"),
      });
      const before = await inventory.read.world();
      const result = await inventory.transfers.prepare({
        operationId: "result-transfer:prepare",
        occurredAtEpochMs: time1,
        transferId: "result-transfer",
        transitPlacementNodeId: "TRANSIT",
        destinationPlacementNodeId: "B",
        lines: [
          {
            lineId: "line",
            from: loosePosition("A"),
            amount: stockAmount("1", "piece"),
          },
        ],
      });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          transfer: { ...result.transfer, transferId: "wrong-transfer" },
        })
      ).toThrow("Result transfer disagrees with published transfer truth");
    }
  });

  it("binds receipt selectors and lifecycle operation identity to the returned result kind", async () => {
    {
      const inventory = createTestInventory();
      await inventory.stock.receive({ operationId: "result-receipt-reservation-seed", occurredAtEpochMs: time0, to: loosePosition("store"), amount: stockAmount("2", "piece") });
      const before = await inventory.read.world();
      const result = await inventory.reservations.reserve({ reservationId: "result-receipt-reservation", operationId: "result-receipt-reservation:create", itemRevisionId: "item-a-v2", selector: { itemId: "item-a", placementNodeIds: ["store"] }, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1 });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      const mutations = [
        [{ ...result.receipt, operationId: "forged-operation" }, /operation identity disagrees with reservation lifecycle truth/u],
        [{ ...result.receipt, eventId: "forged-event" }, /event selector disagrees/u],
        [{ ...result.receipt, countId: "forged-count" }, /count selector disagrees/u],
      ] as const;
      for (const [receipt, diagnostic] of mutations) expect.soft(() => assertStateResultRefinement(before, after, { ...result, receipt })).toThrow(diagnostic);
    }

    {
      const inventory = createTestInventory();
      const before = await inventory.read.world();
      const result = await inventory.counts.start({ countId: "result-receipt-count", operationId: "result-receipt-count:start", itemRevisionId: "item-a-v2", selector: { itemId: "item-a" }, startedAtEpochMs: time0 });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      const mutations = [
        [{ ...result.receipt, operationId: "forged-operation" }, /operation identity disagrees with count lifecycle truth/u],
        [{ ...result.receipt, eventId: "forged-event" }, /event selector disagrees/u],
        [{ ...result.receipt, reservationId: "forged-reservation" }, /reservation selector disagrees/u],
      ] as const;
      for (const [receipt, diagnostic] of mutations) expect.soft(() => assertStateResultRefinement(before, after, { ...result, receipt })).toThrow(diagnostic);
    }

    {
      const inventory = createTestInventory();
      const before = await inventory.read.world();
      const result = await inventory.stock.receive({ operationId: "result-receipt-event", occurredAtEpochMs: time0, to: loosePosition("store"), amount: stockAmount("1", "piece") });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      for (const [receipt, diagnostic] of [
        [{ ...result.receipt, reservationId: "forged-reservation" }, /reservation selector disagrees/u],
        [{ ...result.receipt, countId: "forged-count" }, /count selector disagrees/u],
      ] as const) expect.soft(() => assertStateResultRefinement(before, after, { ...result, receipt })).toThrow(diagnostic);
    }
  });

  it("rejects policy allocation, grouping, and deficit results that disagree with immutable event evidence", async () => {
    {
      const inventory = createTestInventory();
      await inventory.stock.receive({
        operationId: "result-policy-seed",
        occurredAtEpochMs: time0,
        to: loosePosition("store", { lotId: "RESULT-POLICY" }),
        amount: stockAmount("5", "piece"),
      });
      const before = await inventory.read.world();
      const result = await inventory.stock.issueManyByPolicy({
        operationId: "result-policy",
        occurredAtEpochMs: time1,
        requests: [
          {
            requestId: "a",
            groupId: "group",
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
          {
            requestId: "b",
            groupId: "group",
            selector: inventoryStockSelector("item-a", {
              placementNodeIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
        ],
      });
      const after = await inventory.read.world();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          allocations: [
            { ...result.allocations[0]!, requestId: "wrong-request" },
            ...result.allocations.slice(1),
          ],
        })
      ).toThrow("Policy allocations disagree with immutable event evidence");
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          allocationGroups: [],
        })
      ).toThrow("Policy allocation groups disagree with exact allocations");
    }

    {
      const inventory = createTestInventory(
        createInMemoryInventoryDurableStorage(),
        createTabletCatalog(),
        clockAt(),
        InventoryDeficitPolicy.Record
      );
      const before = await inventory.read.world();
      const result = await inventory.stock.issueByPolicy({
        operationId: "result-deficit",
        occurredAtEpochMs: time0,
        selector: inventoryStockSelector("item-a", { placementNodeIds: ["store"] }),
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
      });
      const after = await inventory.read.world();
      const deficit = result.deficit;
      if (deficit === undefined) throw new Error("Expected recorded deficit.");
      expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
      expect(() =>
        assertStateResultRefinement(before, after, {
          ...result,
          deficit: {
            ...deficit,
            primary: {
              ...deficit.primary,
              amountMinor: deficit.primary.amountMinor + 1,
            },
          },
        })
      ).toThrow("Result deficit disagrees with immutable event evidence");
    }
  });
});


describe("systemic producer-result falsification", () => {
  it("rejects finite but incorrect stock quantity and layer time independently", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "oracle-stock", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("1", "piece") });
    const world = await inventory.read.world();
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    const entry = Object.entries(world.projection.positions)[0];
    if (entry === undefined) throw new Error("Expected the producer's stock row.");
    const [id, position] = entry;
    const wrongQuantity = { ...position, measurements: { ...position.measurements, primary: { ...position.measurements.primary, quantity: parseQuantity("2", "piece") } } };
    expect.soft(() => assertAbstractInventoryInvariants({ ...world, projection: { ...world.projection, positions: { ...world.projection.positions, [id]: wrongQuantity } } })).toThrow(/stock quantity differs from committed effects/u);
    expect.soft(() => assertAbstractInventoryInvariants({ ...world, projection: { ...world.projection, positiveLayerStartedAtEpochMsByPositionId: { ...world.projection.positiveLayerStartedAtEpochMsByPositionId, [id]: time0 + 1 } } })).toThrow(/Positive layer history index/u);
  });

  it("rejects reservation and count operations whose row is only inherited", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "oracle-book-stock", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("2", "piece") });
    await inventory.reservations.reserve({ reservationId: "oracle-claim", operationId: "oracle-reserve", itemRevisionId: "item-a-v2", selector: { itemId: "item-a" }, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1 });
    await inventory.counts.start({ countId: "oracle-count", operationId: "oracle-count-start", itemRevisionId: "item-a-v2", selector: { itemId: "item-a" }, startedAtEpochMs: time1 });
    const world = await inventory.read.world();
    expect(() => assertAbstractReservationInvariants(world.reservations)).not.toThrow();
    expect(() => assertAbstractCountInvariants(world.counts)).not.toThrow();
    const reservationOperation = world.reservations.operations["oracle-reserve"];
    const countOperation = world.counts.operations["oracle-count-start"];
    if (reservationOperation === undefined || countOperation === undefined) throw new Error("Expected both producer lifecycle operations.");
    expect.soft(() => assertAbstractReservationInvariants({ reservations: { ...world.reservations.reservations }, operations: { ...world.reservations.operations, "oracle-reserve": { ...reservationOperation, reservationId: "toString" } } })).toThrow(/Reservation operation lost/u);
    expect.soft(() => assertAbstractCountInvariants({ counts: { ...world.counts.counts }, operations: { ...world.counts.operations, "oracle-count-start": { ...countOperation, countId: "constructor" } } })).toThrow(/Count operation lost/u);
  });

  it("rejects producer allocation total and selector corruption", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({ operationId: "oracle-allocation-stock", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("2", "piece") });
    await inventory.reservations.reserve({ reservationId: "oracle-allocation", operationId: "oracle-allocation-reserve", itemRevisionId: "item-a-v2", selector: { itemId: "item-a", placementNodeIds: ["A"] }, requested: parseQuantity("1", "piece"), createdAtEpochMs: time1 });
    const position = (await inventory.read.positions({ itemId: "item-a" }))[0];
    if (position === undefined) throw new Error("Expected real stock for allocation.");
    await inventory.reservations.allocate({ reservationId: "oracle-allocation", operationId: "oracle-allocate", occurredAtEpochMs: time1, allocations: [{ position: position.key, quantity: parseQuantity("1", "piece") }] });
    const book = (await inventory.read.world()).reservations;
    expect(() => assertAbstractReservationInvariants(book)).not.toThrow();
    const reservation = book.reservations["oracle-allocation"];
    const allocation = reservation?.allocations[0];
    if (reservation === undefined || allocation === undefined) throw new Error("Expected the actual allocated producer record.");
    for (const changed of [{ ...allocation, quantity: parseQuantity("2", "piece") }, { ...allocation, position: { ...allocation.position, placementNodeId: "B" } }]) {
      expect.soft(() => assertAbstractReservationInvariants({ ...book, reservations: { ...book.reservations, [reservation.reservationId]: { ...reservation, allocations: [changed] } } })).toThrow(/Reservation allocation (?:total differs|lies outside)/u);
    }
  });

  it("binds the result receipt record time to its committed event", async () => {
    const inventory = createTestInventory();
    const before = await inventory.read.world();
    const result = await inventory.stock.receive({ operationId: "oracle-receipt", occurredAtEpochMs: time0, to: loosePosition("A"), amount: stockAmount("1", "piece") });
    const after = await inventory.read.world();
    expect(() => assertStateResultRefinement(before, after, result)).not.toThrow();
    expect(() => assertStateResultRefinement(before, after, { ...result, receipt: { ...result.receipt, recordedAtEpochMs: result.receipt.recordedAtEpochMs + 1 } })).toThrow(/receipt record time disagrees/u);
    expect(() => assertStateResultRefinement(before, after, { ...result, event: { ...result.event, metadata: { oracleForgedField: "not in committed event" } } })).toThrow(/Result event disagrees/u);
  });
});
