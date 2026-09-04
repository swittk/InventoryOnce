import { describe, expect, it } from "vitest";
import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityCreateResult,
  InventoryAuthorityMode,
  bootstrapGreenfieldInventoryAuthority,
  createInventoryAuthorityControl,
  createInventoryOnce,
  cutoverInventoryAuthority,
  requireInventoryAuthorityMode,
  stockAmount,
  type InventoryAuthorityDocument,
  type InventoryAuthorityFields,
  type InventoryAuthorityStateStore,
} from "../src/index.js";
import { defineInventoryMigration } from "../src/migrations-api.js";
import {
  InventoryStorageWriteStage,
  createInMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
import { createTabletCatalog } from "./test-fixtures.js";

/** Machine-audited bounded trace identities executed by this suite. */
const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-AUTHORITY-GREENFIELD-EMPTY-RACE",
  "TRACE-AUTHORITY-LEGACY-CUTOVER-RACE",
] as const;

void FORMAL_IMPLEMENTATION_TRACE_IDS;

/** Stable certification time. */
const time0 = "2026-08-26T00:00:00.000Z";
/** Stable DualRun/fence time. */
const time1 = "2026-08-26T01:00:00.000Z";
/** Stable activation time. */
const time2 = "2026-08-26T02:00:00.000Z";

/** Shared durable row used by independent controller instances. */
class TestAuthorityDatabase {
  /** Exact schema requested by the controller. */
  fields: InventoryAuthorityFields | undefined;
  /** Current flat authority document. */
  document: InventoryAuthorityDocument | undefined;
}

/** Deterministic row-scoped compare-and-set store for authority tests. */
class TestAuthorityStore implements InventoryAuthorityStateStore {
  /** Shared durable state. */
  private readonly database: TestAuthorityDatabase;

  /** Bind one port to a new or shared row. */
  constructor(database = new TestAuthorityDatabase()) {
    this.database = database;
  }

  /** Create or verify the exact scalar schema. */
  async ensure(fields: InventoryAuthorityFields): Promise<void> {
    if (
      this.database.fields !== undefined &&
      JSON.stringify(this.database.fields) !== JSON.stringify(fields)
    ) {
      throw new Error("Authority test schema changed.");
    }
    this.database.fields ??= structuredClone(fields);
  }

  /** Read an isolated copy of the current row. */
  async read(): Promise<InventoryAuthorityDocument | undefined> {
    return this.database.document === undefined
      ? undefined
      : structuredClone(this.database.document);
  }

  /** Idempotently create the initial row. */
  async create(
    document: InventoryAuthorityDocument
  ): Promise<InventoryAuthorityCreateResult> {
    if (this.database.document !== undefined) {
      return InventoryAuthorityCreateResult.Existing;
    }
    this.database.document = structuredClone(document);
    return InventoryAuthorityCreateResult.Created;
  }

  /** Atomically apply a partial replacement when every expected field matches. */
  async compareAndSet(
    expected: InventoryAuthorityDocument,
    replacement: InventoryAuthorityDocument
  ): Promise<boolean> {
    const current = this.database.document;
    if (current === undefined) return false;
    for (const [field, value] of Object.entries(expected)) {
      if (current[field] !== value) return false;
    }
    this.database.document = { ...current, ...structuredClone(replacement) };
    return true;
  }
}

/** Advance one controller to a mismatch-free DualRun checkpoint. */
async function enterDualRun(
  authority: ReturnType<typeof createInventoryAuthorityControl>
): Promise<void> {
  await authority.certifyAdapter({
    certificationDigest: "adapter-v1",
    certifiedAt: time0,
  });
  await authority.enterShadow({ certificationDigest: "adapter-v1" });
  await authority.enterDualRun({
    sourceRoot: "source-root-1",
    sourceRevision: 1,
    sourcePlanDigest: "source-plan-1",
    sourceCatalogDigest: "source-catalog-1",
    startedAt: time1,
  });
}

describe("portable InventoryOnce authority controller", () => {
  it("moves monotonically through certification, fencing, and activation", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "clinic-a:primary",
    });
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Legacy);
    await enterDualRun(authority);
    expect(
      (
        await authority.claimFence({
          fenceToken: "cutover-a",
          startedAt: time1,
          sourceRoot: "source-root-1",
          sourceRevision: 1,
        })
      ).mode
    ).toBe(InventoryAuthorityMode.Fencing);
    const activated = await authority.activate({
      fenceToken: "cutover-a",
      sourcePlanDigest: "source-plan-1",
      sourceCatalogDigest: "source-catalog-1",
      sourceRoot: "source-root-1",
      targetWorldRoot: "world-root-1",
      targetWorldRevision: 1,
      activatedAt: time2,
    });
    expect(activated.mode).toBe(InventoryAuthorityMode.Authoritative);
    expect(activated.activationKind).toBe(
      InventoryAuthorityActivationKind.LegacyCutover
    );
    expect(activated.compatibilityProjectionWorldRevision).toBe(0);
    await expect(
      authority.activate({
        fenceToken: " cutover-a ",
        sourcePlanDigest: " source-plan-1 ",
        sourceCatalogDigest: " source-catalog-1 ",
        sourceRoot: "source-root-1",
        targetWorldRoot: " world-root-1 ",
        targetWorldRevision: 1,
        activatedAt: time2,
      })
    ).resolves.toEqual(activated);
    await expect(authority.releaseFence("cutover-a")).rejects.toThrow(
      "cannot be reverted"
    );
  });

  it("retains mismatch evidence and refuses to fence past it", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "clinic-mismatch:primary",
    });
    await enterDualRun(authority);
    const mismatched = await authority.recordDualRunMismatch({
      commandId: "command-a",
      legacyIntentDigest: "legacy-a",
      authoritativeIntentDigest: "native-b",
      recordedAt: time2,
    });
    expect(mismatched.dualRunMismatchEvidence).toHaveLength(1);
    await expect(
      authority.claimFence({ fenceToken: "blocked", startedAt: time2 })
    ).rejects.toThrow("mismatch evidence");
  });

  it("activates only an explicitly authorized certified empty greenfield world", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "greenfield:primary",
    });
    const storage = createInMemoryInventoryDurableStorage();
    const input = {
      authority,
      storage,
      adapterCertificationDigest: "adapter-v1",
      authorizationId: "greenfield-deployment-1",
      clock: { now: (): string => time0 },
    };
    const first = await bootstrapGreenfieldInventoryAuthority(input);
    expect(first.targetWorldRevision).toBe(0);
    expect(first.authority).toEqual(
      expect.objectContaining({
        mode: InventoryAuthorityMode.Authoritative,
        activationKind: InventoryAuthorityActivationKind.Greenfield,
        greenfieldAuthorizationId: "greenfield-deployment-1",
        adapterCertificationDigest: "adapter-v1",
        sourceRoot: "",
        sourcePlanDigest: "",
        sourceCatalogDigest: "",
        fenceToken: "",
        targetWorldRevision: 0,
      })
    );
    expect(await bootstrapGreenfieldInventoryAuthority(input)).toEqual(first);
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        ...input,
        authorizationId: "different-deployment",
      })
    ).rejects.toThrow("does not match this greenfield bootstrap");
    await expect(
      authority.activate({
        fenceToken: "fake-fence",
        sourcePlanDigest: "fake-plan",
        sourceCatalogDigest: "fake-catalog",
        targetWorldRoot: first.targetWorldRoot,
        targetWorldRevision: 1,
        activatedAt: time2,
      })
    ).rejects.toThrow("differs from activation evidence");
  });

  it("rejects greenfield bootstrap after any native target publication", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "greenfield-nonempty:primary",
    });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage,
      clock: { now: (): string => time0 },
    });
    await inventory.catalog.publish({
      operationId: "greenfield-nonempty-catalog",
      occurredAt: time0,
    });
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        authority,
        storage,
        adapterCertificationDigest: "adapter-v1",
        authorizationId: "greenfield-deployment-2",
        clock: { now: (): string => time0 },
      })
    ).rejects.toThrow("exact canonical revision-zero empty world");
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Legacy);
  });

  it("atomically resolves a greenfield activation versus legacy-writer admission", async () => {
    const database = new TestAuthorityDatabase();
    const first = createInventoryAuthorityControl({
      store: new TestAuthorityStore(database),
      namespaceId: "greenfield-race:primary",
    });
    const second = createInventoryAuthorityControl({
      store: new TestAuthorityStore(database),
      namespaceId: "greenfield-race:primary",
    });
    await first.certifyAdapter({
      certificationDigest: "adapter-v1",
      certifiedAt: time0,
    });
    const [activation, admission] = await Promise.allSettled([
      first.activateGreenfield({
        authorizationId: "greenfield-race-authorization",
        certificationDigest: "adapter-v1",
        targetWorldRoot: "empty-world-root",
        targetWorldRevision: 0,
        activatedAt: time1,
      }),
      second.admitLegacyWriter({
        writerToken: "legacy-writer",
        attemptToken: "legacy-attempt",
      }),
    ]);
    const state = await first.read();
    expect(admission.status).toBe("fulfilled");
    if (state.mode === InventoryAuthorityMode.Authoritative) {
      expect(activation.status).toBe("fulfilled");
      expect(state.activationKind).toBe(
        InventoryAuthorityActivationKind.Greenfield
      );
      if (admission.status === "fulfilled") {
        expect(admission.value.admittedLegacyWriter).toBe(false);
        expect(admission.value.mode).toBe(InventoryAuthorityMode.Authoritative);
      }
    } else {
      expect(activation.status).toBe("rejected");
      expect(state.mode).toBe(InventoryAuthorityMode.Legacy);
      expect(state.activeLegacyWriters).toEqual([
        { writerToken: "legacy-writer", attemptToken: "legacy-attempt" },
      ]);
      if (admission.status === "fulfilled") {
        expect(admission.value.admittedLegacyWriter).toBe(true);
      }
    }
  });

  it("reuses retained adapter certification time before DualRun exists", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "certification-time-retry:primary",
    });
    const storage = createInMemoryInventoryDurableStorage();
    let now = time0;
    const compiledAt: string[] = [];
    const common = {
      authority,
      storage,
      migrationId: "certification-time-retry-migration",
      fenceToken: "certification-time-retry-fence",
      adapterCertificationDigest: "adapter-v1",
      compileSource: async (cutoverAt: string) => {
        compiledAt.push(cutoverAt);
        throw new Error("Injected pre-DualRun source failure.");
      },
      drainLegacyWriters: (): Promise<void> => Promise.resolve(),
      clock: { now: (): string => now },
    };

    await expect(cutoverInventoryAuthority(common)).rejects.toThrow(
      "Injected pre-DualRun source failure"
    );
    now = time2;
    await expect(cutoverInventoryAuthority(common)).rejects.toThrow(
      "Injected pre-DualRun source failure"
    );

    expect(compiledAt).toEqual([time0, time0]);
    const retained = await authority.read();
    expect(retained.mode).toBe(InventoryAuthorityMode.Legacy);
    expect(retained.adapterCertifiedAt).toBe(time0);
    expect(retained.dualRunStartedAt).toBe("");
  });

  it("keeps the legacy fence after a durable migration exists even when retry drain fails", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "durable-manifest-retry-fence:primary",
    });
    let failMigrationWorld = true;
    const storage = createInMemoryInventoryDurableStorage({
      failpoint: (context) => {
        if (
          failMigrationWorld &&
          context.stage === InventoryStorageWriteStage.MigrationWorld &&
          context.timing === "before"
        ) {
          failMigrationWorld = false;
          throw new Error("Injected staged migration failure.");
        }
      },
    });
    const compileSource = async (cutoverAt: string) => {
      const catalog = createTabletCatalog();
      return {
        catalog,
        plan: defineInventoryMigration({
          catalog,
          declaration: {
            migrationId: "durable-manifest-retry-fence-migration",
            sourceSystem: "durable-manifest-retry-fence-source",
            cutoverAt,
            openingStock: [
              {
                openingId: "durable-manifest-retry-fence-row",
                position: { itemId: "item-a", locationId: "store" },
                amount: stockAmount("1", "piece"),
                itemRevisionId: "item-a-v2",
                source: {
                  sourceType: "legacy-stock",
                  sourceId: "durable-manifest-retry-fence-row",
                },
              },
            ],
          },
        }),
      };
    };
    let failRetryDrain = false;
    const common = {
      authority,
      storage,
      migrationId: "durable-manifest-retry-fence-migration",
      fenceToken: "durable-manifest-retry-fence",
      adapterCertificationDigest: "adapter-v1",
      sourceRevision: 9,
      compileSource,
      drainLegacyWriters: (): Promise<void> =>
        failRetryDrain
          ? Promise.reject(new Error("Injected retry drain failure."))
          : Promise.resolve(),
      clock: { now: (): string => time2 },
    };

    await expect(
      cutoverInventoryAuthority({ ...common, cutoverAt: time1 })
    ).rejects.toThrow("Injected staged migration failure");
    expect(
      await storage.readMigrationManifest(common.migrationId)
    ).toMatchObject({ state: "applying" });
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Fencing);

    failRetryDrain = true;
    await expect(cutoverInventoryAuthority(common)).rejects.toThrow(
      "Injected retry drain failure"
    );
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Fencing);
    await expect(
      authority.admitLegacyWriter({
        writerToken: "blocked-after-durable-manifest",
        attemptToken: "blocked-after-durable-manifest-attempt",
      })
    ).rejects.toThrow("currently owns the legacy write fence");
  });

  it("reuses the durable DualRun cutover time when retry omits the explicit time", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "cutover-time-retry:primary",
    });
    const storage = createInMemoryInventoryDurableStorage();
    const compileSource = async (cutoverAt: string) => {
      const catalog = createTabletCatalog();
      return {
        catalog,
        plan: defineInventoryMigration({
          catalog,
          declaration: {
            migrationId: "cutover-time-retry-migration",
            sourceSystem: "cutover-time-retry-source",
            cutoverAt,
            openingStock: [
              {
                openingId: "cutover-time-retry-row",
                position: { itemId: "item-a", locationId: "store" },
                amount: stockAmount("1", "piece"),
                itemRevisionId: "item-a-v2",
                source: {
                  sourceType: "legacy-stock",
                  sourceId: "cutover-time-retry-row",
                },
              },
            ],
          },
        }),
      };
    };
    let firstDrain = true;
    const common = {
      authority,
      storage,
      migrationId: "cutover-time-retry-migration",
      fenceToken: "cutover-time-retry-fence",
      adapterCertificationDigest: "adapter-v1",
      sourceRevision: 7,
      compileSource,
      drainLegacyWriters: (): Promise<void> => {
        if (firstDrain) {
          firstDrain = false;
          return Promise.reject(new Error("Injected pre-migration drain failure."));
        }
        return Promise.resolve();
      },
      clock: { now: (): string => time2 },
    };

    await expect(
      cutoverInventoryAuthority({ ...common, cutoverAt: time1 })
    ).rejects.toThrow("Injected pre-migration drain failure");
    const retained = await authority.read();
    expect(retained.mode).toBe(InventoryAuthorityMode.DualRun);
    expect(retained.adapterCertifiedAt).toBe(time2);
    expect(retained.dualRunStartedAt).toBe(time1);

    const retried = await cutoverInventoryAuthority(common);
    expect(retried.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    expect(retried.authority.dualRunStartedAt).toBe(time1);
  });

  it("gates application operations on one exact persisted mode", () => {
    requireInventoryAuthorityMode(
      InventoryAuthorityMode.Authoritative,
      InventoryAuthorityMode.Authoritative,
      "Physical command"
    );
    expect(() =>
      requireInventoryAuthorityMode(
        InventoryAuthorityMode.Fencing,
        InventoryAuthorityMode.Authoritative,
        "Physical command"
      )
    ).toThrow("requires authority mode 'authoritative'");
  });
});
