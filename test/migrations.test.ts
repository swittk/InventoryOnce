import { describe, expect, it } from "vitest";
import {
  InventoryMigrationPlanStatus,
  InventoryMigrationDiagnosticCode,
  InventoryMigrationDiagnosticSeverity,
  applyInventoryMigrationPlan,
  createInventoryLegacyQueryReader,
  createInventoryMigrationPlanFromPlugin,
  createInventoryMigrationPlanFromSourcePlugin,
  defineInventoryLegacyQuery,
  defineInventoryMigration,
  defineInventoryMigrationPlugin,
  defineInventoryMigrationSourcePlugin,
  dryRunInventoryMigration,
  inventoryMigrationPositionsMatch,
  inventoryMigrationProblem,
  inventoryMigrationSnapshotSupersededDisposition,
  readAllInventoryLegacyQuery,
  resumeInventoryMigrationManifest,
  type InventoryMigrationDeclaration,
  type InventoryMigrationDryRun,
  type InventoryMigrationPlan,
  InventoryMigrationSourceDispositionKind,
} from "../src/migrations-api.js";
import {
  InventoryTraceabilityNodeKind,
  InventoryTraceabilityRelationAction,
  InventoryTraceabilityRelationKind,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  type InventoryCatalog,
  parseQuantity,
  scalarInventoryMeasurements,
  stockAmount,
} from "../src/index.js";
import {
  InventoryMigrationManifestState,
  InventoryStorageWriteStage,
  createInMemoryInventoryDurableStorage,
  type InventoryDurableStorage,
} from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  time0,
  time3,
} from "./test-fixtures.js";
import {
  abstractInventoryState,
  abstractMigrationState,
} from "./formal-implementation-abstraction.js";

/** Machine-declared trace binding snapshot dispositions to migration/fence refinement. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-SNAPSHOT-SUPERSEDED-WORKFLOW",
] as const;

void FORMAL_IMPLEMENTATION_TRACE_IDS;

/** One typed legacy stock row owned by the test application query. */
interface LegacyStockRow {
  /** Stable source row identity. */
  readonly id: string;
  /** Legacy location identity. */
  readonly locationId: string;
  /** Exact plain-decimal legacy balance. */
  readonly balance: string;
}

/** One typed legacy item-definition row owned by a complete source plugin. */
interface LegacyItemDefinitionRow {
  /** Stable legacy item identity. */
  readonly id: string;
  /** Physical base unit retained by the old system. */
  readonly unit: string;
}

/** One migration adapter boundary and crash side covered by the atomic-cutover matrix. */
interface MigrationStorageFailureCase {
  /** Physical migration write boundary. */
  readonly stage: InventoryStorageWriteStage;
  /** Side of the write where the test throws once. */
  readonly timing: "before" | "after";
}

/** Every migration freeze/stage/publish/compact boundary on both crash sides. */
const migrationStorageFailureCases: readonly MigrationStorageFailureCase[] = [
  { stage: InventoryStorageWriteStage.MigrationBegin, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationBegin, timing: "after" },
  { stage: InventoryStorageWriteStage.MigrationWorld, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationWorld, timing: "after" },
  { stage: InventoryStorageWriteStage.MigrationComplete, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationPublishWorld, timing: "before" },
  { stage: InventoryStorageWriteStage.MigrationPublishWorld, timing: "after" },
  {
    stage: InventoryStorageWriteStage.MigrationCompactManifest,
    timing: "before",
  },
  {
    stage: InventoryStorageWriteStage.MigrationCompactManifest,
    timing: "after",
  },
  { stage: InventoryStorageWriteStage.MigrationComplete, timing: "after" },
];

/** Both crash sides around the terminal unpublished-migration abort write. */
const migrationAbortFailureTimings: readonly ("before" | "after")[] = [
  "before",
  "after",
];

/** Return whether this migration crash side happens after its one world cut became visible. */
function migrationFailurePublishesWorld(
  failureCase: MigrationStorageFailureCase
): boolean {
  if (failureCase.stage === InventoryStorageWriteStage.MigrationPublishWorld) {
    return failureCase.timing === "after";
  }
  if (failureCase.stage === InventoryStorageWriteStage.MigrationCompactManifest)
    return true;
  return (
    failureCase.stage === InventoryStorageWriteStage.MigrationComplete &&
    failureCase.timing === "after"
  );
}

/** Bind one compiled migration to the exact currently published target before apply. */
async function reviewMigrationForStorage(
  catalog: InventoryCatalog,
  storage: InventoryDurableStorage,
  plan: InventoryMigrationPlan
): Promise<InventoryMigrationDryRun> {
  return dryRunInventoryMigration({
    catalog,
    plan,
    targetWorld: await storage.readWorld(),
  });
}

/** Build one typed paged query and expose how many source reads occurred. */
function createLegacyStockQuery(): {
  /** Reusable typed legacy query. */
  readonly query: ReturnType<typeof defineInventoryLegacyQuery<LegacyStockRow>>;
  /** Return current source read count. */
  readonly readCount: () => number;
} {
  let reads = 0;
  const rows: readonly LegacyStockRow[] = [
    { id: "legacy-1", locationId: "store-a", balance: "2" },
    { id: "legacy-2", locationId: "store-b", balance: "3" },
  ];
  const query = defineInventoryLegacyQuery<LegacyStockRow>({
    queryId: "legacy-stock",
    /** Return one cursor-indexed page without exposing this storage shape to InventoryOnce. */
    readPage: ({ cursor, limit }) => {
      const start = cursor === undefined ? 0 : Number(cursor);
      const page = rows.slice(start, start + limit);
      const next = start + page.length;
      reads += 1;
      return Promise.resolve({
        rows: page,
        ...(next >= rows.length ? {} : { nextCursor: String(next) }),
      });
    },
  });
  return { query, readCount: () => reads };
}

describe("typed migration query/plugin, dry-run, apply, and compatibility reuse", () => {
  it("lets one source plugin derive both catalogue and opening facts from typed queries", async () => {
    const itemRows: readonly LegacyItemDefinitionRow[] = [
      { id: "legacy-item-a", unit: "piece" },
    ];
    const stockRows: readonly LegacyStockRow[] = [
      { id: "legacy-stock-a", locationId: "store", balance: "4" },
    ];
    const itemQuery = defineInventoryLegacyQuery<LegacyItemDefinitionRow>({
      queryId: "legacy-item-definitions",
      /** Return the complete one-page item definition fixture. */
      readPage: () => Promise.resolve({ rows: itemRows }),
    });
    const stockQuery = defineInventoryLegacyQuery<LegacyStockRow>({
      queryId: "legacy-stock-for-source-plugin",
      /** Return the complete one-page stock fixture. */
      readPage: () => Promise.resolve({ rows: stockRows }),
    });
    const plugin = defineInventoryMigrationSourcePlugin({
      pluginId: "complete-legacy-source-v1",
      /** Reconstruct the native catalogue and opening declaration from the same typed reader. */
      createBundle: async (reader) => {
        const [legacyItems, legacyStock] = await Promise.all([
          reader.readAll(itemQuery),
          reader.readAll(stockQuery),
        ]);
        const legacyItem = legacyItems[0];
        if (legacyItem === undefined)
          throw new Error("Legacy item fixture disappeared.");
        const item = defineScalarInventoryItem({
          itemId: legacyItem.id,
          revisionId: `${legacyItem.id}-v1`,
          axisId: "pieces",
          unit: legacyItem.unit,
        });
        const catalog = defineInventoryCatalog({
          itemRevisions: [item],
          activeItemRevisionIds: { [item.itemId]: item.revisionId },
        });
        return {
          catalog,
          declaration: {
            migrationId: "complete-source-migration",
            sourceSystem: "complete-legacy-source",
            cutoverAt: time0,
            openingStock: legacyStock.map((row) => ({
              openingId: row.id,
              position: {
                itemId: item.itemId,
                locationId: row.locationId,
              },
              amount: stockAmount(row.balance, legacyItem.unit),
              itemRevisionId: item.revisionId,
              source: { sourceType: stockQuery.queryId, sourceId: row.id },
            })),
          },
        };
      },
    });

    const compiled = await createInventoryMigrationPlanFromSourcePlugin({
      plugin,
    });
    expect(compiled.catalog.activeItem("legacy-item-a").revisionId).toBe(
      "legacy-item-a-v1"
    );
    expect(compiled.plan.status).toBe(InventoryMigrationPlanStatus.Ready);
    expect(compiled.plan.events).toHaveLength(1);
    const dryRunPositions = Object.values(
      dryRunInventoryMigration({
        catalog: compiled.catalog,
        plan: compiled.plan,
        targetWorld: await createInMemoryInventoryDurableStorage().readWorld(),
      }).resultWorld.projection.positions
    );
    expect(dryRunPositions).toHaveLength(1);
    expect(dryRunPositions[0]).toMatchObject({
      key: {
        itemId: "legacy-item-a",
        itemRevisionId: "legacy-item-a-v1",
        locationId: "store",
      },
      measurements: {
        primary: { quantity: { amountMinor: 4, unit: "piece" } },
      },
    });
  });

  it("retains snapshot-superseded rows without translating or resuming them", async () => {
    const catalog = createTabletCatalog();
    const disposition = inventoryMigrationSnapshotSupersededDisposition({
      dispositionId: "snapshot-superseded:pending:row-a",
      source: {
        sourceType: "InventoryStockPendingOp",
        sourceId: "row-a",
      },
      snapshotAt: time0,
      reason: "Current opening snapshot supersedes this unresolved row.",
      evidence: {
        workflowState: "pending",
        itemId: "item-a",
        locationId: "store",
        amount: -1,
        amountUnit: "piece",
      },
    });
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "snapshot-disposition-migration",
        sourceSystem: "legacy-snapshot",
        cutoverAt: time0,
        openingStock: [
          {
            openingId: "opening-a",
            position: { itemId: "item-a", locationId: "store" },
            amount: stockAmount("3", "piece"),
            itemRevisionId: "item-a-v2",
            source: { sourceType: "InventoryStock", sourceId: "stock-a" },
          },
        ],
        sourceDispositions: [disposition],
      },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Ready);
    expect(plan.events).toHaveLength(1);
    expect(plan.sourceDispositions).toEqual([
      expect.objectContaining({
        dispositionId: "snapshot-superseded:pending:row-a",
        kind: InventoryMigrationSourceDispositionKind.SnapshotSupersededDoNotReplay,
        source: {
          sourceType: "InventoryStockPendingOp",
          sourceId: "row-a",
        },
      }),
    ]);
    expect(abstractMigrationState(plan).sourceDispositions).toEqual([
      expect.objectContaining({
        dispositionId: "snapshot-superseded:pending:row-a",
        kind: InventoryMigrationSourceDispositionKind.SnapshotSupersededDoNotReplay,
      }),
    ]);

    const samePhysicalWithoutDisposition = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "snapshot-disposition-migration",
        sourceSystem: "legacy-snapshot",
        cutoverAt: time0,
        openingStock: [
          {
            openingId: "opening-a",
            position: { itemId: "item-a", locationId: "store" },
            amount: stockAmount("3", "piece"),
            itemRevisionId: "item-a-v2",
            source: { sourceType: "InventoryStock", sourceId: "stock-a" },
          },
        ],
      },
    });
    expect(samePhysicalWithoutDisposition.planDigest).not.toBe(plan.planDigest);

    const storage = createInMemoryInventoryDurableStorage();
    const dryRun = await reviewMigrationForStorage(catalog, storage, plan);
    expect(abstractMigrationState(dryRun).sourceDispositions).toEqual(
      abstractMigrationState(plan).sourceDispositions
    );
    const world = await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    expect(Object.values(world.projection.events)).toHaveLength(1);
    expect(abstractInventoryState(world)).toEqual(
      expect.objectContaining({ worldRevision: world.revision })
    );
    expect(JSON.stringify(world.projection.events)).not.toContain("row-a");
    const manifest = await storage.readMigrationManifest(plan.migrationId);
    expect(manifest).toMatchObject({
      state: InventoryMigrationManifestState.Completed,
      sourceDispositions: plan.sourceDispositions,
      operationIds: [plan.events[0]?.operationId],
    });
    expect(manifest?.plan).toBeUndefined();
    expect(abstractMigrationState(manifest!).sourceDispositions).toEqual(
      abstractMigrationState(plan).sourceDispositions
    );
    expect(
      await resumeInventoryMigrationManifest(storage, plan.migrationId)
    ).toEqual(manifest);
  });

  it("blocks invalid or duplicate snapshot dispositions rather than guessing", () => {
    const catalog = createTabletCatalog();
    const disposition = inventoryMigrationSnapshotSupersededDisposition({
      dispositionId: "duplicate-row",
      source: { sourceType: "InventoryMutation", sourceId: "row-a" },
      snapshotAt: time3,
      reason: "Wrong snapshot time for this migration.",
    });
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "invalid-disposition-migration",
        sourceSystem: "legacy-snapshot",
        cutoverAt: time0,
        openingStock: [],
        sourceDispositions: [disposition, disposition],
      },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Blocked);
    expect(plan.events).toEqual([]);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: InventoryMigrationDiagnosticSeverity.Error,
          source: { sourceType: "InventoryMutation", sourceId: "row-a" },
        }),
      ])
    );
  });

  it("reuses the same bounded typed query for migration and temporary compatibility reads", async () => {
    const catalog = createTabletCatalog();
    const source = createLegacyStockQuery();
    const plugin = defineInventoryMigrationPlugin({
      pluginId: "legacy-stock-v1",
      /** Translate typed legacy rows into side-effect-free opening facts. */
      createDeclaration: async (
        reader
      ): Promise<InventoryMigrationDeclaration> => {
        const rows = await reader.readAll(source.query);
        return {
          migrationId: "migration-1",
          sourceSystem: "legacy-test-store",
          cutoverAt: time0,
          openingStock: rows.map((row) => ({
            openingId: row.id,
            position: { itemId: "item-a", locationId: row.locationId },
            amount: stockAmount(row.balance, "piece"),
            itemRevisionId: "item-a-v2",
            source: { sourceType: source.query.queryId, sourceId: row.id },
          })),
        };
      },
    });
    const plan = await createInventoryMigrationPlanFromPlugin({
      catalog,
      plugin,
      queryReadOptions: { pageSize: 1 },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Ready);
    expect(plan.events).toHaveLength(2);
    expect(plan.events[0]?.metadata).toMatchObject({
      migrationId: "migration-1",
      migrationSource: {
        sourceType: "legacy-stock",
        sourceId: "legacy-1",
      },
    });
    expect(source.readCount()).toBe(2);
    const storage = createInMemoryInventoryDurableStorage();
    const targetWorld = await storage.readWorld();
    const dryRun = dryRunInventoryMigration({ catalog, plan, targetWorld });
    expect(
      Object.values(dryRun.resultWorld.projection.positions)
        .map((row) => row.measurements.primary.quantity.amountMinor)
        .sort((left, right) => left - right)
    ).toEqual([2, 3]);
    expect(
      inventoryMigrationPositionsMatch({
        catalog,
        plan,
        targetWorld,
        expected: [
          {
            position: {
              itemId: "item-a",
              itemRevisionId: "item-a-v2",
              locationId: "store-a",
            },
            measurements: scalarInventoryMeasurements(
              "pieces",
              parseQuantity("2", "piece")
            ),
          },
          {
            position: {
              itemId: "item-a",
              itemRevisionId: "item-a-v2",
              locationId: "store-b",
            },
            measurements: scalarInventoryMeasurements(
              "pieces",
              parseQuantity("3", "piece")
            ),
          },
        ],
      })
    ).toBe(true);

    const compatibilityRows = await createInventoryLegacyQueryReader({
      pageSize: 1,
    }).readAll(source.query);
    expect(compatibilityRows).toHaveLength(2);
    expect(source.readCount()).toBe(4);

    const applied = await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    expect(applied.projection.lastRecordSequence).toBe(2);
    const replayed = await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    expect(replayed.revision).toBe(applied.revision);
  });

  it("blocks ambiguous declarations and broken paging instead of guessing or looping", async () => {
    const catalog = createTabletCatalog();
    const plugin = defineInventoryMigrationPlugin({
      pluginId: "ambiguous-legacy",
      /** Return one explicit blocking problem and no invented stock fact. */
      createDeclaration: () =>
        Promise.resolve({
          migrationId: "blocked-migration",
          sourceSystem: "legacy-test-store",
          cutoverAt: time0,
          openingStock: [],
          diagnostics: [
            inventoryMigrationProblem(
              "One child row could mean a package or a separate stock position.",
              { sourceType: "legacy-child", sourceId: "child-1" },
              "Classify the physical meaning before migration."
            ),
          ],
        }),
    });
    const plan = await createInventoryMigrationPlanFromPlugin({
      catalog,
      plugin,
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Blocked);
    const blockedTarget =
      await createInMemoryInventoryDurableStorage().readWorld();
    expect(() =>
      dryRunInventoryMigration({
        catalog,
        plan,
        targetWorld: blockedTarget,
      })
    ).toThrow("Blocked inventory migration");

    const loopingQuery = defineInventoryLegacyQuery<LegacyStockRow>({
      queryId: "looping-query",
      /** Return the same cursor forever to prove the reader fails closed. */
      readPage: () => Promise.resolve({ rows: [], nextCursor: "same" }),
    });
    await expect(
      readAllInventoryLegacyQuery(loopingQuery, {
        pageSize: 1,
        maxPages: 3,
        maxRows: 3,
      })
    ).rejects.toThrow("repeated cursor");
  });

  it("blocks a combined graph failure before apply writes anything", () => {
    const catalog = createTabletCatalog();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "migration-cycle",
        sourceSystem: "legacy-test-store",
        cutoverAt: time0,
        openingStock: [],
        traceabilityChanges: [
          {
            changeId: "a-in-b",
            change: {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from: { kind: InventoryTraceabilityNodeKind.Container, id: "a" },
              to: { kind: InventoryTraceabilityNodeKind.Container, id: "b" },
            },
            source: { sourceType: "legacy-edge", sourceId: "a-in-b" },
          },
          {
            changeId: "b-in-a",
            change: {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from: { kind: InventoryTraceabilityNodeKind.Container, id: "b" },
              to: { kind: InventoryTraceabilityNodeKind.Container, id: "a" },
            },
            source: { sourceType: "legacy-edge", sourceId: "b-in-a" },
          },
        ],
      },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Blocked);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "joint-semantic-conflict" }),
      ])
    );
  });

  it("keeps a whole migration invisible until publish and resumes from its frozen batch plan", async () => {
    const catalog = createTabletCatalog();
    const openingStock: InventoryMigrationDeclaration["openingStock"] = [
      {
        openingId: "first",
        position: { itemId: "item-a", locationId: "store-a" },
        amount: stockAmount("2", "piece"),
        itemRevisionId: "item-a-v2",
        source: { sourceType: "legacy-stock", sourceId: "first" },
      },
      {
        openingId: "second",
        position: { itemId: "item-a", locationId: "store-b" },
        amount: stockAmount("3", "piece"),
        itemRevisionId: "item-a-v2",
        source: { sourceType: "legacy-stock", sourceId: "second" },
      },
    ];
    const declaration: InventoryMigrationDeclaration = {
      migrationId: "migration-resume",
      sourceSystem: "legacy-test-store",
      cutoverAt: time0,
      openingStock,
    };
    const plan = defineInventoryMigration({ catalog, declaration });
    let stoppedBeforePublish = false;
    const storage = createInMemoryInventoryDurableStorage({
      /** Fail after the complete batch is frozen/staged but before any migrated stock becomes visible. */
      failpoint: ({ stage, timing }) => {
        if (
          !stoppedBeforePublish &&
          stage === InventoryStorageWriteStage.MigrationPublishWorld &&
          timing === "before"
        ) {
          stoppedBeforePublish = true;
          throw new Error("Stop before migration publish.");
        }
      },
    });
    const baseWorld = await storage.readWorld();
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: baseWorld,
    });
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("Stop before migration publish");
    expect((await storage.readWorld()).revision).toBe(baseWorld.revision);
    const applyingManifest = await storage.readMigrationManifest(
      "migration-resume"
    );
    expect(applyingManifest).toMatchObject({
      state: InventoryMigrationManifestState.Applying,
      worldWritten: true,
      worldPublished: false,
      operationIds: [
        expect.stringContaining(":first"),
        expect.stringContaining(":second"),
      ],
    });
    expect(applyingManifest?.plan).toBeDefined();

    await resumeInventoryMigrationManifest(storage, "migration-resume");
    const resumed = await storage.readWorld();
    expect(resumed.revision).toBe(baseWorld.revision + 1);
    expect(Object.values(resumed.projection.positions)).toHaveLength(2);
    expect(
      await storage.readMigrationManifest("migration-resume")
    ).toMatchObject({
      state: InventoryMigrationManifestState.Completed,
      worldPublished: true,
      operationIds: [
        expect.stringContaining(":first"),
        expect.stringContaining(":second"),
      ],
    });

    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun: { ...dryRun, baseRevision: dryRun.baseRevision + 1 },
        clock: clockAt(time3),
      })
    ).rejects.toThrow("different reviewed target base");
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun: { ...dryRun, baseWorldRoot: `${dryRun.baseWorldRoot}-changed` },
        clock: clockAt(time3),
      })
    ).rejects.toThrow("different reviewed target base");

    const removedOpeningPlan = defineInventoryMigration({
      catalog,
      declaration: { ...declaration, openingStock: openingStock.slice(0, 1) },
    });
    const removedDryRun = dryRunInventoryMigration({
      catalog,
      plan: removedOpeningPlan,
      targetWorld: baseWorld,
    });
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: removedOpeningPlan,
        dryRun: removedDryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed whole plan");

    const addedOpeningPlan = defineInventoryMigration({
      catalog,
      declaration: {
        ...declaration,
        openingStock: [
          ...openingStock,
          {
            openingId: "third",
            position: { itemId: "item-a", locationId: "store-c" },
            amount: stockAmount("1", "piece"),
            itemRevisionId: "item-a-v2",
            source: { sourceType: "legacy-stock", sourceId: "third" },
          },
        ],
      },
    });
    const addedDryRun = dryRunInventoryMigration({
      catalog,
      plan: addedOpeningPlan,
      targetWorld: baseWorld,
    });
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: addedOpeningPlan,
        dryRun: addedDryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed whole plan");
  });

  it.each(migrationStorageFailureCases)(
    "repairs one atomic migration cut after $timing $stage failure",
    async ({ stage, timing }) => {
      const catalog = createTabletCatalog();
      const plan = defineInventoryMigration({
        catalog,
        declaration: {
          migrationId: "migration-cutover-failpoint",
          sourceSystem: "legacy-cutover-test",
          cutoverAt: time0,
          openingStock: [
            {
              openingId: "row-a",
              position: { itemId: "item-a", locationId: "store-a" },
              amount: stockAmount("2", "piece"),
              itemRevisionId: "item-a-v2",
              source: { sourceType: "legacy-stock", sourceId: "row-a" },
            },
            {
              openingId: "row-b",
              position: { itemId: "item-a", locationId: "store-b" },
              amount: stockAmount("3", "piece"),
              itemRevisionId: "item-a-v2",
              source: { sourceType: "legacy-stock", sourceId: "row-b" },
            },
          ],
        },
      });
      let failed = false;
      const storage = createInMemoryInventoryDurableStorage({
        /** Throw once on the exact migration write side named by this matrix row. */
        failpoint: (context) => {
          if (!failed && context.stage === stage && context.timing === timing) {
            failed = true;
            throw new Error(`Injected migration ${timing} ${stage} failure.`);
          }
        },
      });
      const baseWorld = await storage.readWorld();
      const dryRun = dryRunInventoryMigration({
        catalog,
        plan,
        targetWorld: baseWorld,
      });
      await expect(
        applyInventoryMigrationPlan({
          catalog,
          storage,
          plan,
          dryRun,
          clock: clockAt(time3),
        })
      ).rejects.toThrow("Injected migration");

      const worldAfterFailure = await storage.readWorld();
      const publishedBeforeFailureReturned = migrationFailurePublishesWorld({
        stage,
        timing,
      });
      expect(worldAfterFailure.revision).toBe(
        publishedBeforeFailureReturned ? 1 : 0
      );
      const manifestAfterFailure = await storage.readMigrationManifest(
        plan.migrationId
      );
      if (manifestAfterFailure === undefined) {
        expect(stage).toBe(InventoryStorageWriteStage.MigrationBegin);
        expect(timing).toBe("before");
        await applyInventoryMigrationPlan({
          catalog,
          storage,
          plan,
          dryRun,
          clock: clockAt(time3),
        });
      } else if (
        manifestAfterFailure.state === InventoryMigrationManifestState.Applying
      ) {
        await resumeInventoryMigrationManifest(storage, plan.migrationId);
      }

      const published = await storage.readWorld();
      expect(published.revision).toBe(1);
      expect(Object.values(published.projection.positions)).toHaveLength(2);
      expect(
        await storage.readMigrationManifest(plan.migrationId)
      ).toMatchObject({
        state: InventoryMigrationManifestState.Completed,
        worldWritten: true,
        worldPublished: true,
      });
      expect(
        (await storage.readMigrationManifest(plan.migrationId))?.plan
      ).toBeUndefined();
      await applyInventoryMigrationPlan({
        catalog,
        storage,
        plan,
        dryRun,
        clock: clockAt(time3),
      });
      expect((await storage.readWorld()).revision).toBe(1);
    }
  );

  it.each(migrationAbortFailureTimings)(
    "keeps an unpublished migration hidden and abortable after %s abort failure",
    async (timing) => {
      const catalog = createTabletCatalog();
      const plan = defineInventoryMigration({
        catalog,
        declaration: {
          migrationId: `migration-abort-${timing}`,
          sourceSystem: "legacy-abort-test",
          cutoverAt: time0,
          openingStock: [
            {
              openingId: "row-one",
              position: { itemId: "item-a", locationId: "store" },
              amount: stockAmount("1", "piece"),
              itemRevisionId: "item-a-v2",
              source: { sourceType: "legacy-stock", sourceId: "row-one" },
            },
          ],
        },
      });
      let stoppedAfterBegin = false;
      let stoppedAtAbort = false;
      const storage = createInMemoryInventoryDurableStorage({
        /** Leave the batch applying, then throw once on the selected abort side. */
        failpoint: (context) => {
          if (
            !stoppedAfterBegin &&
            context.stage === InventoryStorageWriteStage.MigrationBegin &&
            context.timing === "after"
          ) {
            stoppedAfterBegin = true;
            throw new Error("Stop migration after begin.");
          }
          if (
            !stoppedAtAbort &&
            context.stage === InventoryStorageWriteStage.MigrationAbort &&
            context.timing === timing
          ) {
            stoppedAtAbort = true;
            throw new Error(`Stop ${timing} migration abort.`);
          }
        },
      });
      const dryRun = await reviewMigrationForStorage(catalog, storage, plan);
      await expect(
        applyInventoryMigrationPlan({
          catalog,
          storage,
          plan,
          dryRun,
          clock: clockAt(time3),
        })
      ).rejects.toThrow("Stop migration after begin");

      await expect(
        storage.abortMigrationManifest(plan.migrationId)
      ).rejects.toThrow(`Stop ${timing} migration abort`);
      expect((await storage.readWorld()).revision).toBe(0);
      expect(
        (await storage.readMigrationManifest(plan.migrationId))?.state
      ).toBe(InventoryMigrationManifestState.Aborted);
      const aborted = await storage.abortMigrationManifest(plan.migrationId);
      expect(aborted.state).toBe(InventoryMigrationManifestState.Aborted);
      expect(aborted.plan).toBeUndefined();
      await expect(
        resumeInventoryMigrationManifest(storage, plan.migrationId)
      ).rejects.toThrow("cannot be resumed");
      expect((await storage.readWorld()).revision).toBe(0);
    }
  );

  it("blocks cross-row traceability conflicts during compilation and names the bad source row", () => {
    const catalog = createTabletCatalog();
    const from = { kind: InventoryTraceabilityNodeKind.Container, id: "child" };
    const to = { kind: InventoryTraceabilityNodeKind.Container, id: "parent" };
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "joint-conflict",
        sourceSystem: "legacy-graph",
        cutoverAt: time0,
        openingStock: [],
        traceabilityChanges: [
          {
            changeId: "edge-one",
            change: {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from,
              to,
            },
            source: { sourceType: "legacy-edge", sourceId: "row-one" },
          },
          {
            changeId: "edge-two",
            change: {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from,
              to,
            },
            source: { sourceType: "legacy-edge", sourceId: "row-two" },
          },
        ],
      },
    });

    expect(plan.status).toBe(InventoryMigrationPlanStatus.Blocked);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: InventoryMigrationDiagnosticCode.JointSemanticConflict,
        source: { sourceType: "legacy-edge", sourceId: "row-two" },
      })
    );
  });

  it("checks the frozen plan digest and full target replay before the first migration write", async () => {
    const catalog = createTabletCatalog();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "digest-plan",
        sourceSystem: "legacy-stock",
        cutoverAt: time0,
        openingStock: [
          {
            openingId: "opening-one",
            position: { itemId: "item-a", locationId: "store" },
            amount: stockAmount("1", "piece"),
            itemRevisionId: "item-a-v2",
            source: { sourceType: "legacy-stock", sourceId: "row-one" },
          },
        ],
      },
    });
    const changedPlan = {
      ...plan,
      events: plan.events.map((event) => ({
        ...event,
        sourceReference: "changed|after-review",
      })),
    };
    const storage = createInMemoryInventoryDurableStorage();
    const reviewedPlan = await reviewMigrationForStorage(
      catalog,
      storage,
      plan
    );
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: changedPlan,
        dryRun: reviewedPlan,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed after compilation");
    expect((await storage.readWorld()).revision).toBe(0);
    expect(
      await storage.readOperation(plan.events[0]?.operationId ?? "missing")
    ).toBeUndefined();

    const changedDiagnosticsPlan: InventoryMigrationPlan = {
      ...plan,
      diagnostics: [
        {
          severity: InventoryMigrationDiagnosticSeverity.Warning,
          code: "review-note-changed",
          message:
            "This warning was added after the operator reviewed the plan.",
        },
      ],
    };
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: changedDiagnosticsPlan,
        dryRun: reviewedPlan,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed after compilation");
    expect((await storage.readWorld()).revision).toBe(0);

    const graphPlan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "target-preflight",
        sourceSystem: "legacy-graph",
        cutoverAt: time0,
        openingStock: [],
        traceabilityChanges: [
          {
            changeId: "same-edge",
            change: {
              action: InventoryTraceabilityRelationAction.Add,
              kind: InventoryTraceabilityRelationKind.Containment,
              from: {
                kind: InventoryTraceabilityNodeKind.Container,
                id: "child",
              },
              to: {
                kind: InventoryTraceabilityNodeKind.Container,
                id: "parent",
              },
            },
            source: { sourceType: "legacy-edge", sourceId: "same-edge" },
          },
        ],
      },
    });
    const graphDryRun = await reviewMigrationForStorage(
      catalog,
      storage,
      graphPlan
    );
    const targetInventory = createTestInventory(storage, catalog);
    await targetInventory.traceability.aggregate({
      operationId: "native-edge",
      occurredAt: time0,
      from: { kind: InventoryTraceabilityNodeKind.Container, id: "child" },
      to: { kind: InventoryTraceabilityNodeKind.Container, id: "parent" },
    });
    await expect(
      applyInventoryMigrationPlan({
        catalog,
        storage,
        plan: graphPlan,
        dryRun: graphDryRun,
        clock: clockAt(time3),
      })
    ).rejects.toThrow("changed after the reviewed dry-run");
    expect((await storage.readWorld()).revision).toBe(1);
    expect(
      await storage.readOperation(graphPlan.events[0]?.operationId ?? "missing")
    ).toBeUndefined();
  });
});
