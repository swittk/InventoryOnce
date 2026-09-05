import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  createInventoryOnce,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
  type InventoryOnce,
  type InventoryOnceCountResult,
  type InventoryOnceEventResult,
  type InventoryOncePolicyBatchResult,
  type InventoryOnceTransferResult,
  type InventoryWorldState,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
  repairInventoryMigrationManifests,
  resumeInventoryMigrationManifest,
} from "../src/migrations-api.js";
import {
  InventoryStorageWriteStage,
  repairInventoryDurableOperations,
  type InventoryDurableStorage,
  type InventoryStorageFailpoint,
} from "../src/storage-api.js";
import {
  abstractInventoryState,
  abstractMigrationState,
  abstractOperationResult,
  abstractPrimaryBalance,
  assertAbstractCountInvariants,
  assertAbstractInventoryInvariants,
  assertAbstractMigrationInvariants,
  assertAbstractReservationInvariants,
  assertStateResultRefinement,
} from "./formal-implementation-abstraction.js";
import {
  clockAt,
  createTabletCatalog,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded trace identities executed by this suite; scripts/audit-formal-implementation-conformance.mjs discovers this declaration from source. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-RECEIVE-MANY-PUBLISH-REPLAY",
  "TRACE-ISSUE-MANY-FEFO-SHORTFALL",
  "TRACE-TRANSFER-MANY-FEFO-ATOMIC",
  "TRACE-COUNT-ABSOLUTE-OBSERVATION-MOVEMENT",
  "TRACE-MIGRATION-PLAN-PUBLISH-REPAIR",
] as const;

void FORMAL_IMPLEMENTATION_TRACE_IDS;

/** Inputs accepted by one reusable memory/Mongo/SQLite refinement factory. */
export interface InventoryFormalStorageRefinementFactoryInput {
  /** Namespace isolated from every other refinement case. */
  readonly namespaceId: string;
  /** Optional deterministic physical-write crash injection. */
  readonly failpoint?: InventoryStorageFailpoint;
}

/** Adapter factory used by the exact same executable refinement suite. */
export type InventoryFormalStorageRefinementFactory = (
  input: InventoryFormalStorageRefinementFactoryInput
) => InventoryDurableStorage | Promise<InventoryDurableStorage>;

/** Four production-critical commands and every concrete observation in their trace. */
export interface InventoryFormalCriticalTrace {
  /** Fully published world after the complete trace. */
  readonly world: InventoryWorldState;
  /** First/replayed native receipt results. */
  readonly receive: readonly [
    InventoryOnceEventResult,
    InventoryOnceEventResult
  ];
  /** First/replayed native policy issue results. */
  readonly issue: readonly [
    InventoryOncePolicyBatchResult,
    InventoryOncePolicyBatchResult
  ];
  /** First/replayed native policy transfer results. */
  readonly transfer: readonly [
    InventoryOncePolicyBatchResult,
    InventoryOncePolicyBatchResult
  ];
  /** First/replayed native absolute-count results. */
  readonly count: readonly [InventoryOnceCountResult, InventoryOnceCountResult];
}

/** Fixed lot expiries make FEFO source choice independent of object iteration order. */
const earlyExpiry = "2027-01-01T00:00:00.000Z";
/** Later lot expiry leaves one distinct bucket for the final absolute count. */
const lateExpiry = "2028-01-01T00:00:00.000Z";

/** Build the real public façade over one supplied durable adapter. */
function createRefinementInventory(
  storage: InventoryDurableStorage
): InventoryOnce {
  return createInventoryOnce({
    catalog: createTabletCatalog(),
    storage,
    clock: clockAt(time3),
  });
}

/** Require one world plus all independent abstract invariants. */
function assertWorld(world: InventoryWorldState): void {
  assertAbstractInventoryInvariants(world);
  assertAbstractReservationInvariants(world.reservations);
  assertAbstractCountInvariants(world.counts);
}

/** Run one operation, prove its atomic state/result step, then prove exact replay stutters. */
async function runAndReplay<
  TResult extends
    | InventoryOnceEventResult
    | InventoryOncePolicyBatchResult
    | InventoryOnceCountResult
    | InventoryOnceTransferResult
>(
  inventory: InventoryOnce,
  command: () => Promise<TResult>,
  expectedNewRevisionDelta = 1
): Promise<readonly [TResult, TResult]> {
  const before = await inventory.read.world();
  const first = await command();
  const afterFirst = await inventory.read.world();
  assertStateResultRefinement(
    before,
    afterFirst,
    first,
    expectedNewRevisionDelta
  );
  const replayBefore = await inventory.read.world();
  const replayed = await command();
  const replayAfter = await inventory.read.world();
  assertStateResultRefinement(replayBefore, replayAfter, replayed);
  expect(replayed.replayed).toBe(true);
  expect(abstractOperationResult(replayed)).toEqual({
    ...abstractOperationResult(first),
    replayed: true,
  });
  return [first, replayed];
}

/** Execute the four production-critical native calls as one bounded refinement trace. */
export async function runInventoryFormalCriticalTrace(
  storage: InventoryDurableStorage,
  suffix: string,
  decoration: Readonly<Record<string, string>> = {}
): Promise<InventoryFormalCriticalTrace> {
  const inventory = createRefinementInventory(storage);
  const receiveCommand = {
    operationId: `formal-receive-${suffix}`,
    occurredAt: time0,
    ...(decoration.receiveReason === undefined
      ? {}
      : { reason: decoration.receiveReason }),
    metadata: decoration,
    lines: [
      {
        to: loosePosition("store", { lotId: "FORMAL-EARLY" }),
        amount: stockAmount("5", "piece"),
        lot: { expiresAt: earlyExpiry },
      },
      {
        to: loosePosition("store", { lotId: "FORMAL-LATE" }),
        amount: stockAmount("4", "piece"),
        lot: { expiresAt: lateExpiry },
      },
    ],
  };
  const receive = await runAndReplay(inventory, () =>
    inventory.stock.receiveMany(receiveCommand)
  );
  expect(receive[0].event.stockEffects).toHaveLength(2);
  expect(
    abstractPrimaryBalance(
      await inventory.read.world(),
      "item-a",
      "store",
      "piece"
    )
  ).toBe(String(9));

  const issueCommand = {
    operationId: `formal-issue-${suffix}`,
    occurredAt: time1,
    ...(decoration.issueReason === undefined
      ? {}
      : { reason: decoration.issueReason }),
    metadata: decoration,
    requests: [
      {
        requestId: "formal-issue-line",
        groupId: "formal-issue-group",
        selector: inventoryStockSelector("item-a", { locationIds: ["store"] }),
        amount: stockAmount("2", "piece"),
        method: InventoryAllocationMethod.Fefo,
      },
    ],
  };
  const issue = await runAndReplay(inventory, () =>
    inventory.stock.issueManyByPolicy(issueCommand)
  );
  expect(issue[0].allocations).toHaveLength(1);
  expect(issue[0].allocations[0]?.lines[0]?.position.lotId).toBe(
    "FORMAL-EARLY"
  );
  expect(issue[0].allocations[0]?.lines[0]?.allocatedPrimary.amountMinor).toBe(
    2
  );
  expect(
    abstractPrimaryBalance(
      await inventory.read.world(),
      "item-a",
      "store",
      "piece"
    )
  ).toBe(String(7));

  const transferCommand = {
    operationId: `formal-transfer-${suffix}`,
    occurredAt: time2,
    ...(decoration.transferReason === undefined
      ? {}
      : { reason: decoration.transferReason }),
    metadata: decoration,
    toLocationId: "room",
    requests: [
      {
        requestId: "formal-transfer-line",
        groupId: "formal-transfer-group",
        selector: inventoryStockSelector("item-a", { locationIds: ["store"] }),
        amount: stockAmount("3", "piece"),
        method: InventoryAllocationMethod.Fefo,
      },
    ],
  };
  const transfer = await runAndReplay(inventory, () =>
    inventory.stock.transferManyByPolicy(transferCommand)
  );
  expect(transfer[0].allocations[0]?.lines[0]?.position.lotId).toBe(
    "FORMAL-EARLY"
  );
  expect(transfer[0].event.stockEffects).toHaveLength(2);
  expect(
    abstractPrimaryBalance(
      await inventory.read.world(),
      "item-a",
      "store",
      "piece"
    )
  ).toBe(String(4));
  expect(
    abstractPrimaryBalance(
      await inventory.read.world(),
      "item-a",
      "room",
      "piece"
    )
  ).toBe(String(3));

  const countCommand = {
    countId: `formal-count-${suffix}`,
    operationId: `formal-count-${suffix}`,
    itemRevisionId: "item-a-v2",
    selector: inventoryStockSelector("item-a", {
      locationIds: ["store"],
      lotIds: ["FORMAL-LATE"],
    }),
    observedMeasurements: {
      primary: { axisId: "pieces", quantity: parseQuantity("3", "piece") },
      independent: [],
    },
    occurredAt: time2,
    reason: decoration.countReason ?? "Bounded formal count observation",
    metadata: decoration,
  };
  const count = await runAndReplay(
    inventory,
    () => inventory.counts.replaceAbsolute(countCommand),
    3
  );
  expect(count[0].count.status).toBe("completed");
  expect(
    count[0].event?.stockEffects[0]?.measurementsDelta.primary.quantity
      .amountMinor
  ).toBe(-1);

  const world = await inventory.read.world();
  assertWorld(world);
  expect(abstractPrimaryBalance(world, "item-a", "store", "piece")).toBe(
    String(3)
  );
  expect(abstractPrimaryBalance(world, "item-a", "room", "piece")).toBe(
    String(3)
  );
  const snapshot = await inventory.read.snapshot();
  expect(snapshot.worldRevision).toBe(world.revision);
  const summary = snapshot.summary(inventoryStockSelector("item-a"));
  expect(summary.revisions[0]?.total.primary.quantity.amountMinor).toBe(6);
  return { world, receive, issue, transfer, count };
}

/** Build one deterministic migration for memory/Mongo/SQLite state refinement. */
function createFormalRefinementMigration(
  migrationId: string,
  balance = "5"
): {
  /** Catalog used to compile the migration plan. */
  readonly catalog: ReturnType<typeof createTabletCatalog>;
  /** Deterministic migration plan used by adapter refinement checks. */
  readonly plan: ReturnType<typeof defineInventoryMigration>;
} {
  const catalog = createTabletCatalog();
  const plan = defineInventoryMigration({
    catalog,
    declaration: {
      migrationId,
      sourceSystem: "formal-refinement-source",
      cutoverAt: time0,
      openingStock: [
        {
          openingId: `${migrationId}:opening`,
          position: loosePosition("migration-store", {
            lotId: `${migrationId}:lot`,
          }),
          amount: stockAmount(balance, "piece"),
          itemRevisionId: "item-a-v2",
          lot: { manufacturedAt: time0, expiresAt: time3 },
          source: {
            sourceType: "formal-refinement-row",
            sourceId: `${migrationId}:row`,
          },
        },
      ],
    },
  });
  return { catalog, plan };
}

/** Prove one rejected command leaves every abstract published component unchanged. */
async function expectRejectedStateUnchanged(
  inventory: InventoryOnce,
  command: () => Promise<unknown>,
  message: string
): Promise<void> {
  const before = await inventory.read.world();
  await expect(command()).rejects.toThrow(message);
  const after = await inventory.read.world();
  expect(abstractInventoryState(after)).toEqual(abstractInventoryState(before));
  expect(after.reservations).toEqual(before.reservations);
  expect(after.counts).toEqual(before.counts);
}

/** Create one deterministic failpoint that fires exactly once for one operation/stage. */
function oneShotFailure(
  operationId: string,
  stage: InventoryStorageWriteStage,
  timing: "before" | "after"
): {
  /** Failpoint callback injected into the storage adapter. */
  readonly failpoint: InventoryStorageFailpoint;
  /** Report whether this one-shot failpoint has fired. */
  readonly fired: () => boolean;
} {
  let fired = false;
  return {
    failpoint: ({
      operationId: candidate,
      stage: candidateStage,
      timing: candidateTiming,
    }) => {
      if (
        !fired &&
        candidate === operationId &&
        candidateStage === stage &&
        candidateTiming === timing
      ) {
        fired = true;
        throw new Error(`formal crash ${operationId} ${stage} ${timing}`);
      }
    },
    fired: () => fired,
  };
}

/** Register the identical state/result/failpoint refinement suite for one adapter. */
export function runInventoryFormalStorageRefinementSuite(
  label: string,
  factory: InventoryFormalStorageRefinementFactory
): void {
  describe(`formal implementation refinement — ${label}`, () => {
    it("refines the four production-critical calls, exact retries, and public reads", async () => {
      const storage = await factory({ namespaceId: `${label}-critical-trace` });
      const trace = await runInventoryFormalCriticalTrace(
        storage,
        `${label}-critical`
      );
      expect(trace.world.revision).toBe(6);
      expect(trace.world.projection.lastRecordSequence).toBe(4);
      expect(trace.receive[1].replayed).toBe(true);
      expect(trace.issue[1].replayed).toBe(true);
      expect(trace.transfer[1].replayed).toBe(true);
      expect(trace.count[1].replayed).toBe(true);
    });

    it("rejects changed intent and shortfall without an abstract state change", async () => {
      const storage = await factory({ namespaceId: `${label}-rejection` });
      await runInventoryFormalCriticalTrace(storage, `${label}-rejection`);
      const inventory = createRefinementInventory(storage);
      await expectRejectedStateUnchanged(
        inventory,
        () =>
          inventory.stock.issueManyByPolicy({
            operationId: `formal-issue-${label}-rejection`,
            occurredAt: time1,
            requests: [
              {
                requestId: "formal-issue-line",
                groupId: "formal-issue-group",
                selector: inventoryStockSelector("item-a", {
                  locationIds: ["store"],
                }),
                amount: stockAmount("1", "piece"),
                method: InventoryAllocationMethod.Fefo,
              },
            ],
          }),
        "changed intent"
      );
      await expectRejectedStateUnchanged(
        inventory,
        () =>
          inventory.stock.issueManyByPolicy({
            operationId: `formal-shortfall-${label}`,
            occurredAt: time3,
            requests: [
              {
                requestId: "too-large",
                selector: inventoryStockSelector("item-a", {
                  locationIds: ["store"],
                }),
                amount: stockAmount("100", "piece"),
                method: InventoryAllocationMethod.Fifo,
              },
            ],
          }),
        "shortfall"
      );
    });

    it("proves audit decoration is observational rather than physical state", async () => {
      const plainStorage = await factory({
        namespaceId: `${label}-plain-decoration`,
      });
      const decoratedStorage = await factory({
        namespaceId: `${label}-rich-decoration`,
      });
      const plain = await runInventoryFormalCriticalTrace(
        plainStorage,
        `${label}-metamorphic`
      );
      const decorated = await runInventoryFormalCriticalTrace(
        decoratedStorage,
        `${label}-metamorphic`,
        {
          receiveReason: "received from a documented supplier",
          issueReason: "dispensed through a documented workflow",
          transferReason: "moved for a documented workflow",
          countReason: "counted by a documented operator",
          arbitraryAuditTag: "ignored-by-conservation",
        }
      );
      expect(abstractInventoryState(decorated.world)).toEqual(
        abstractInventoryState(plain.world)
      );
      expect(decorated.world.reservations).toEqual(plain.world.reservations);
      expect(
        abstractPrimaryBalance(decorated.world, "item-a", "store", "piece")
      ).toBe(String(3));
    });

    it("refines migration dry-run, atomic publication, replay, and changed-plan refusal", async () => {
      const storage = await factory({ namespaceId: `${label}-migration` });
      const { catalog, plan } = createFormalRefinementMigration(
        `formal-refinement-migration-${label}`
      );
      assertAbstractMigrationInvariants(plan);
      const base = await storage.readWorld();
      const dryRun = dryRunInventoryMigration({
        catalog,
        plan,
        targetWorld: base,
      });
      assertAbstractMigrationInvariants(dryRun);
      const published = await applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun,
        clock: clockAt(time3),
      });
      assertWorld(published);
      expect(abstractInventoryState(published)).toEqual(
        abstractInventoryState(dryRun.resultWorld)
      );
      expect(abstractMigrationState(dryRun).result?.worldRevision).toBe(
        published.revision
      );
      const replayed = await applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun,
        clock: clockAt(time3),
      });
      expect(abstractInventoryState(replayed)).toEqual(
        abstractInventoryState(published)
      );
      const changed = createFormalRefinementMigration(plan.migrationId, "6");
      const changedDryRun = dryRunInventoryMigration({
        catalog: changed.catalog,
        plan: changed.plan,
        targetWorld: base,
      });
      const beforeChanged = await storage.readWorld();
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
        abstractInventoryState(beforeChanged)
      );
    });

    it("repairs selected migration crashes before and after publication", async () => {
      const cases = [
        {
          stage: InventoryStorageWriteStage.MigrationWorld,
          timing: "after" as const,
          publishedAtFailure: false,
        },
        {
          stage: InventoryStorageWriteStage.MigrationPublishWorld,
          timing: "after" as const,
          publishedAtFailure: true,
        },
        {
          stage: InventoryStorageWriteStage.MigrationCompactManifest,
          timing: "before" as const,
          publishedAtFailure: true,
        },
      ];
      for (const failureCase of cases) {
        const migrationId = `formal-migration-${label}-${failureCase.stage}`;
        const crash = oneShotFailure(
          migrationId,
          failureCase.stage,
          failureCase.timing
        );
        const storage = await factory({
          namespaceId: `${label}-${failureCase.stage}`,
          failpoint: crash.failpoint,
        });
        const { catalog, plan } = createFormalRefinementMigration(migrationId);
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
        ).rejects.toThrow("formal crash");
        expect(crash.fired()).toBe(true);
        const visibleAfterFailure = await storage.readWorld();
        if (failureCase.publishedAtFailure) {
          expect(abstractInventoryState(visibleAfterFailure)).toEqual(
            abstractInventoryState(dryRun.resultWorld)
          );
        } else {
          expect(abstractInventoryState(visibleAfterFailure)).toEqual(
            abstractInventoryState(base)
          );
        }
        await repairInventoryMigrationManifests({ storage });
        const manifest = await storage.readMigrationManifest(migrationId);
        if (manifest?.state === "applying") {
          await resumeInventoryMigrationManifest(storage, migrationId);
        }
        const finalWorld = await storage.readWorld();
        assertWorld(finalWorld);
        expect(abstractInventoryState(finalWorld)).toEqual(
          abstractInventoryState(dryRun.resultWorld)
        );
        expect((await storage.readMigrationManifest(migrationId))?.state).toBe(
          "completed"
        );
      }
    });

    it("repairs a receiveMany failure before publication", async () => {
      const receiveOperationId = `formal-fail-receive-${label}`;
      const receiveCrash = oneShotFailure(
        receiveOperationId,
        InventoryStorageWriteStage.Projection,
        "after"
      );
      const receiveStorage = await factory({
        namespaceId: `${label}-fail-receive`,
        failpoint: receiveCrash.failpoint,
      });
      const receiveInventory = createRefinementInventory(receiveStorage);
      const receiveCommand = {
        operationId: receiveOperationId,
        occurredAt: time0,
        lines: [
          {
            to: loosePosition("store", { lotId: "FAIL-RECEIVE" }),
            amount: stockAmount("5", "piece"),
          },
        ],
      };
      const receiveBefore = await receiveInventory.read.world();
      await expect(
        receiveInventory.stock.receiveMany(receiveCommand)
      ).rejects.toThrow("formal crash");
      expect(receiveCrash.fired()).toBe(true);
      expect(
        abstractInventoryState(await receiveInventory.read.world())
      ).toEqual(abstractInventoryState(receiveBefore));
      await repairInventoryDurableOperations({ storage: receiveStorage });
      const receiveAfter = await receiveInventory.read.world();
      assertWorld(receiveAfter);
      expect(
        abstractPrimaryBalance(receiveAfter, "item-a", "store", "piece")
      ).toBe(String(5));
      expect(
        (await receiveInventory.stock.receiveMany(receiveCommand)).replayed
      ).toBe(true);
    });

    it("repairs an issueManyByPolicy failure before publication", async () => {
      const issueOperationId = `formal-fail-issue-${label}`;
      const issueCrash = oneShotFailure(
        issueOperationId,
        InventoryStorageWriteStage.Receipt,
        "after"
      );
      const issueStorage = await factory({
        namespaceId: `${label}-fail-issue`,
        failpoint: issueCrash.failpoint,
      });
      const issueInventory = createRefinementInventory(issueStorage);
      await issueInventory.stock.receiveMany({
        operationId: `formal-fail-issue-seed-${label}`,
        occurredAt: time0,
        lines: [
          {
            to: loosePosition("store", { lotId: "FAIL-ISSUE" }),
            amount: stockAmount("5", "piece"),
          },
        ],
      });
      const issueCommand = {
        operationId: issueOperationId,
        occurredAt: time1,
        requests: [
          {
            requestId: "fail-issue-line",
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
        ],
      };
      const issueBefore = await issueInventory.read.world();
      await expect(
        issueInventory.stock.issueManyByPolicy(issueCommand)
      ).rejects.toThrow("formal crash");
      expect(issueCrash.fired()).toBe(true);
      expect(abstractInventoryState(await issueInventory.read.world())).toEqual(
        abstractInventoryState(issueBefore)
      );
      await repairInventoryDurableOperations({ storage: issueStorage });
      const issueAfter = await issueInventory.read.world();
      assertWorld(issueAfter);
      expect(
        abstractPrimaryBalance(issueAfter, "item-a", "store", "piece")
      ).toBe(String(3));
      expect(
        (await issueInventory.stock.issueManyByPolicy(issueCommand)).replayed
      ).toBe(true);
    });

    it("repairs a transferManyByPolicy failure after publication", async () => {
      const transferOperationId = `formal-fail-transfer-${label}`;
      const transferCrash = oneShotFailure(
        transferOperationId,
        InventoryStorageWriteStage.PublishWorld,
        "after"
      );
      const transferStorage = await factory({
        namespaceId: `${label}-fail-transfer`,
        failpoint: transferCrash.failpoint,
      });
      const transferInventory = createRefinementInventory(transferStorage);
      await transferInventory.stock.receiveMany({
        operationId: `formal-fail-transfer-seed-${label}`,
        occurredAt: time0,
        lines: [
          {
            to: loosePosition("store", { lotId: "FAIL-TRANSFER" }),
            amount: stockAmount("5", "piece"),
          },
        ],
      });
      const transferCommand = {
        operationId: transferOperationId,
        occurredAt: time1,
        toLocationId: "room",
        requests: [
          {
            requestId: "fail-transfer-line",
            selector: inventoryStockSelector("item-a", {
              locationIds: ["store"],
            }),
            amount: stockAmount("2", "piece"),
            method: InventoryAllocationMethod.Fifo,
          },
        ],
      };
      await expect(
        transferInventory.stock.transferManyByPolicy(transferCommand)
      ).rejects.toThrow("formal crash");
      expect(transferCrash.fired()).toBe(true);
      const transferVisibleAfterCrash = await transferInventory.read.world();
      expect(
        abstractPrimaryBalance(
          transferVisibleAfterCrash,
          "item-a",
          "store",
          "piece"
        )
      ).toBe(String(3));
      expect(
        abstractPrimaryBalance(
          transferVisibleAfterCrash,
          "item-a",
          "room",
          "piece"
        )
      ).toBe(String(2));
      await repairInventoryDurableOperations({ storage: transferStorage });
      const transferAfter = await transferInventory.read.world();
      assertWorld(transferAfter);
      expect(
        abstractPrimaryBalance(transferAfter, "item-a", "store", "piece")
      ).toBe(String(3));
      expect(
        abstractPrimaryBalance(transferAfter, "item-a", "room", "piece")
      ).toBe(String(2));
      expect(
        (await transferInventory.stock.transferManyByPolicy(transferCommand))
          .replayed
      ).toBe(true);
    });

    it("repairs a replaceAbsolute count failure after publication", async () => {
      const countOperationId = `formal-fail-count-${label}`;
      const countCrash = oneShotFailure(
        `${countOperationId}:reconcile`,
        InventoryStorageWriteStage.PublishWorld,
        "after"
      );
      const countStorage = await factory({
        namespaceId: `${label}-fail-count`,
        failpoint: countCrash.failpoint,
      });
      const countInventory = createRefinementInventory(countStorage);
      await countInventory.stock.receiveMany({
        operationId: `formal-fail-count-seed-${label}`,
        occurredAt: time0,
        lines: [
          {
            to: loosePosition("store", { lotId: "FAIL-COUNT" }),
            amount: stockAmount("5", "piece"),
          },
        ],
      });
      const countCommand = {
        countId: countOperationId,
        operationId: countOperationId,
        itemRevisionId: "item-a-v2",
        selector: inventoryStockSelector("item-a", {
          locationIds: ["store"],
          lotIds: ["FAIL-COUNT"],
        }),
        observedMeasurements: {
          primary: { axisId: "pieces", quantity: parseQuantity("3", "piece") },
          independent: [],
        },
        occurredAt: time2,
        reason: "Selected failpoint count",
      };
      await expect(
        countInventory.counts.replaceAbsolute(countCommand)
      ).rejects.toThrow("formal crash");
      expect(countCrash.fired()).toBe(true);
      const countVisibleAfterCrash = await countInventory.read.world();
      expect(
        abstractPrimaryBalance(
          countVisibleAfterCrash,
          "item-a",
          "store",
          "piece"
        )
      ).toBe(String(3));
      await repairInventoryDurableOperations({ storage: countStorage });
      const countAfter = await countInventory.read.world();
      assertWorld(countAfter);
      expect(
        abstractPrimaryBalance(countAfter, "item-a", "store", "piece")
      ).toBe(String(3));
      const countReplay = await countInventory.counts.replaceAbsolute(
        countCommand
      );
      expect(countReplay.replayed).toBe(true);
      expect(countReplay.count.status).toBe("completed");
    });
  });
}
