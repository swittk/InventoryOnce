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
import {
  InventoryMigrationSourceDispositionKind,
  defineInventoryMigration,
} from "../src/migrations-api.js";
import { InMemoryInventoryDurableStorage } from "../src/storage.js";
import {
  InventoryStorageWriteStage,
  createInMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
import {
  TestInventoryAuthorityStore,
  createTabletCatalog,
} from "./test-fixtures.js";

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

it("accepts equivalent authority schema maps regardless of property insertion order", async () => {
  const store = new TestInventoryAuthorityStore();
  await store.ensure({ mode: "String", revision: "Number" });
  await expect(
    store.ensure({ revision: "Number", mode: "String" }),
  ).resolves.toBeUndefined();
  await expect(
    store.ensure({ revision: "String", mode: "String" }),
  ).rejects.toThrow("Formal authority schema changed");
});

/** Shared durable row used by independent controller instances. */
class TestAuthorityDatabase {
  /** Exact schema requested by the controller. */
  fields: InventoryAuthorityFields | undefined;
  /** Current flat authority document. */
  document: InventoryAuthorityDocument | undefined;
}

/** Adapter fixture that preserves migration meaning while reordering plain-object keys on read. */
class ReorderedMigrationManifestStorage extends InMemoryInventoryDurableStorage {
  /** Return the same typed source dispositions with deliberately different object insertion order. */
  override async readMigrationManifest(migrationId: string) {
    const manifest = await super.readMigrationManifest(migrationId);
    if (manifest === undefined) return undefined;
    return {
      ...manifest,
      sourceDispositions: manifest.sourceDispositions.map((disposition) => ({
        reason: disposition.reason,
        snapshotAt: disposition.snapshotAt,
        source: {
          sourceId: disposition.source.sourceId,
          sourceType: disposition.source.sourceType,
          ...(disposition.source.note === undefined
            ? {}
            : { note: disposition.source.note }),
        },
        kind: disposition.kind,
        dispositionId: disposition.dispositionId,
        ...(disposition.evidence === undefined
          ? {}
          : { evidence: disposition.evidence }),
      })),
    };
  }
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
  it("rejects authority revision exhaustion before publishing an unreadable durable row", async () => {
    const database = new TestAuthorityDatabase();
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(database),
      namespaceId: "revision-exhaustion:primary",
    });
    await authority.read();
    if (database.document === undefined) {
      throw new Error("Authority initialization did not create its durable row.");
    }
    database.document = {
      ...database.document,
      revision: Number.MAX_SAFE_INTEGER,
    };

    await expect(
      authority.certifyAdapter({
        certificationDigest: "adapter-v1",
        certifiedAt: time0,
      })
    ).rejects.toThrow("next revision must be a non-negative safe integer");
    expect(database.document.revision).toBe(Number.MAX_SAFE_INTEGER);
    await expect(authority.read()).resolves.toMatchObject({
      revision: Number.MAX_SAFE_INTEGER,
      mode: InventoryAuthorityMode.Legacy,
    });
  });

  it("observes initialization failure before first use without swallowing it", async () => {
    const failure = new Error("authority initialization failed");
    const store: InventoryAuthorityStateStore = {
      ensure: async () => {
        throw failure;
      },
      read: async () => undefined,
      create: async () => InventoryAuthorityCreateResult.Created,
      compareAndSet: async () => false,
    };
    const authority = createInventoryAuthorityControl({
      store,
      namespaceId: "clinic-init-failure:primary",
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(authority.read()).rejects.toBe(failure);
  });

  it("moves monotonically through certification, fencing, and activation", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "clinic-a:primary",
    });
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Legacy);
    await enterDualRun(authority);
    await expect(
      authority.claimFence({
        fenceToken: "cutover-a",
        startedAt: time1,
        sourceRoot: "source-root-1",
        sourceRevision: 1,
      })
    ).rejects.toThrow("requires explicit durable cutover authorization");
    const authorized = await authority.authorizeCutover({
      authorizationId: "legacy-cutover-a",
    });
    expect(authorized.cutoverAuthorizationId).toBe("legacy-cutover-a");
    await expect(
      authority.authorizeCutover({ authorizationId: "legacy-cutover-a" })
    ).resolves.toEqual(authorized);
    await expect(
      authority.authorizeCutover({ authorizationId: "different-cutover" })
    ).rejects.toThrow("differs from durable evidence");
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

  it("keeps truncated compatibility projection failures canonical and readable", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "projection-failure:primary",
    });
    await enterDualRun(authority);
    await authority.authorizeCutover({ authorizationId: "projection-failure-cutover" });
    await authority.claimFence({
      fenceToken: "projection-failure-fence",
      startedAt: time1,
      sourceRoot: "source-root-1",
      sourceRevision: 1,
    });
    await authority.activate({
      fenceToken: "projection-failure-fence",
      sourcePlanDigest: "source-plan-1",
      sourceCatalogDigest: "source-catalog-1",
      sourceRoot: "source-root-1",
      targetWorldRoot: "world-root-projection-failure",
      targetWorldRevision: 1,
      activatedAt: time2,
    });

    const failed = await authority.markCompatibilityProjectionFailed({
      worldRevision: 1,
      error: `${"x".repeat(1999)} y`,
    });
    expect(failed.compatibilityProjectionError).toBe("x".repeat(1999));
    await expect(authority.read()).resolves.toEqual(failed);
    await expect(
      authority.markCompatibilityProjectionApplied({ worldRevision: 1 })
    ).resolves.toMatchObject({
      compatibilityProjectionWorldRevision: 1,
      compatibilityProjectionError: "",
    });
  });

  it("retains mismatch evidence and refuses to fence past it", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "clinic-mismatch:primary",
    });
    await enterDualRun(authority);
    await authority.authorizeCutover({ authorizationId: "mismatch-cutover" });
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

  it("does not reinterpret retained legacy-cutover authorization as greenfield authority", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "authorization-domain:primary",
    });
    const storage = createInMemoryInventoryDurableStorage();
    await authority.certifyAdapter({
      certificationDigest: "adapter-v1",
      certifiedAt: time0,
    });
    const authorized = await authority.authorizeCutover({
      authorizationId: "legacy-cutover-authorization",
    });
    expect(authorized.cutoverAuthorizationId).toBe(
      "legacy-cutover-authorization"
    );
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        authority,
        storage,
        adapterCertificationDigest: "adapter-v1",
        authorizationId: "greenfield-authorization",
        clock: { now: (): string => time1 },
      })
    ).rejects.toThrow("cannot reuse legacy source");
    expect((await authority.read()).cutoverAuthorizationId).toBe(
      "legacy-cutover-authorization"
    );
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
    /** Mutable test clock advanced to prove retained certification time wins over retry time. */
    let now = time0;
    /** Cutover timestamps actually supplied to compileSource, in call order. */
    const compiledAt: string[] = [];
    const common = {
      authority,
      storage,
      migrationId: "certification-time-retry-migration",
      fenceToken: "certification-time-retry-fence",
      authorizationId: "certification-time-retry-authorization",
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
    expect(retained.cutoverAuthorizationId).toBe(
      "certification-time-retry-authorization"
    );
    expect(retained.dualRunStartedAt).toBe("");
    await expect(
      cutoverInventoryAuthority({
        ...common,
        authorizationId: "different-certification-time-authorization",
      })
    ).rejects.toThrow("authorization differs from durable evidence");
    expect(compiledAt).toEqual([time0, time0]);
  });

  it("keeps the legacy fence after a durable migration exists even when retry drain fails", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "durable-manifest-retry-fence:primary",
    });
    /** Fail only the first staged migration-world write so the durable manifest survives for retry. */
    let failMigrationWorld = true;
    const durableStorage = createInMemoryInventoryDurableStorage({
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
    /** Fail one retry's manifest read after the durable manifest already exists. */
    let failManifestRead = false;
    const storage = new Proxy(durableStorage, {
      /** Bind durable methods normally, except for the deliberate manifest-read failure. */
      get(target, property, receiver) {
        if (property === "readMigrationManifest") {
          return async (migrationId: string) => {
            if (failManifestRead) {
              throw new Error("Injected manifest read failure.");
            }
            return target.readMigrationManifest(migrationId);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
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
    /** Enable drain failure only after durable migration state already exists. */
    let failRetryDrain = false;
    const common = {
      authority,
      storage,
      migrationId: "durable-manifest-retry-fence-migration",
      fenceToken: "durable-manifest-retry-fence",
      authorizationId: "durable-manifest-retry-authorization",
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

    failManifestRead = true;
    await expect(cutoverInventoryAuthority(common)).rejects.toThrow(
      "Injected manifest read failure"
    );
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Fencing);
    failManifestRead = false;

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

  it("retains the shared fence when a same-token contender publishes after a stale no-manifest read", async () => {
    const database = new TestAuthorityDatabase();
    const stale = createInventoryAuthorityControl({
      store: new TestAuthorityStore(database),
      namespaceId: "same-token-stale-release:primary",
    });
    const publisher = createInventoryAuthorityControl({
      store: new TestAuthorityStore(database),
      namespaceId: "same-token-stale-release:primary",
    });
    await stale.read();
    await publisher.read();
    const storage = createInMemoryInventoryDurableStorage();
    const compileSource = async (cutoverAt: string) => {
      const catalog = createTabletCatalog();
      return {
        catalog,
        plan: defineInventoryMigration({
          catalog,
          declaration: {
            migrationId: "same-token-stale-release-migration",
            sourceSystem: "same-token-stale-release-source",
            cutoverAt,
            openingStock: [
              {
                openingId: "same-token-stale-release-row",
                position: { itemId: "item-a", locationId: "store" },
                amount: stockAmount("1", "piece"),
                itemRevisionId: "item-a-v2",
                source: {
                  sourceType: "legacy-stock",
                  sourceId: "same-token-stale-release-row",
                },
              },
            ],
          },
        }),
      };
    };
    let staleObservedNoManifest!: () => void;
    const staleObservedNoManifestPromise = new Promise<void>((resolve) => {
      staleObservedNoManifest = resolve;
    });
    let publisherAtActivate!: () => void;
    const publisherAtActivatePromise = new Promise<void>((resolve) => {
      publisherAtActivate = resolve;
    });
    let allowPublisherActivate!: () => void;
    const publisherActivateGate = new Promise<void>((resolve) => {
      allowPublisherActivate = resolve;
    });
    const delayedPublisher = new Proxy(publisher, {
      get(target, property, receiver) {
        if (property === "activate") {
          return async (input: Parameters<typeof target.activate>[0]) => {
            publisherAtActivate();
            await publisherActivateGate;
            return target.activate(input);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const common = {
      storage,
      migrationId: "same-token-stale-release-migration",
      fenceToken: "same-token-stale-release-fence",
      authorizationId: "same-token-stale-release-authorization",
      adapterCertificationDigest: "adapter-v1",
      sourceRevision: 17,
      cutoverAt: time1,
      compileSource,
      clock: { now: (): string => time2 },
    };

    const staleRun = cutoverInventoryAuthority({
      ...common,
      authority: stale,
      drainLegacyWriters: async () => {
        // This callback begins only after the stale contender has read no manifest.
        staleObservedNoManifest();
        await publisherAtActivatePromise;
      },
    }).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error: error as Error }),
    );
    await staleObservedNoManifestPromise;
    const publisherRun = cutoverInventoryAuthority({
      ...common,
      authority: delayedPublisher,
      drainLegacyWriters: async () => {},
    }).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error: error as Error }),
    );
    const staleResult = await staleRun;
    const stateBeforePublisherActivation = await stale.read();
    const manifestBeforePublisherActivation =
      await storage.readMigrationManifest(common.migrationId);
    allowPublisherActivate();
    const publisherResult = await publisherRun;

    expect(staleResult.error?.message).toContain(
      "authority target is not empty and has no matching migration manifest",
    );
    expect(manifestBeforePublisherActivation?.state).toBe("completed");
    expect(stateBeforePublisherActivation.mode).toBe(
      InventoryAuthorityMode.Fencing,
    );
    expect(publisherResult.error).toBeUndefined();
    expect(publisherResult.value?.authority.mode).toBe(
      InventoryAuthorityMode.Authoritative,
    );
  });

  it("reuses the retained fenced cutover time when retry omits the explicit time", async () => {
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
    /** Fail the first drain only so the successful retry must reuse the retained cutover time. */
    let firstDrain = true;
    const common = {
      authority,
      storage,
      migrationId: "cutover-time-retry-migration",
      fenceToken: "cutover-time-retry-fence",
      authorizationId: "cutover-time-retry-authorization",
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
    expect(retained.mode).toBe(InventoryAuthorityMode.Fencing);
    expect(retained.adapterCertifiedAt).toBe(time2);
    expect(retained.dualRunStartedAt).toBe(time1);

    await expect(
      cutoverInventoryAuthority({
        ...common,
        adapterCertificationDigest: "adapter-v2",
      })
    ).rejects.toThrow(
      "InventoryOnce cutover certification differs from durable evidence."
    );
    expect((await authority.read()).mode).toBe(InventoryAuthorityMode.Fencing);

    const retried = await cutoverInventoryAuthority(common);
    expect(retried.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    expect(retried.authorizationId).toBe("cutover-time-retry-authorization");
    expect(retried.authority.cutoverAuthorizationId).toBe(
      "cutover-time-retry-authorization"
    );
    expect(retried.authority.dualRunStartedAt).toBe(time1);
    const completedManifest = await storage.readMigrationManifest(common.migrationId);
    expect(completedManifest?.targetWorldRoot).toBe(retried.targetWorldRoot);
    expect(completedManifest?.targetWorldRevision).toBe(retried.targetWorldRevision);
    const completedReplay = await cutoverInventoryAuthority(common);
    expect(completedReplay.targetWorldRoot).toBe(retried.targetWorldRoot);
    expect(completedReplay.targetWorldRevision).toBe(retried.targetWorldRevision);
    await expect(
      cutoverInventoryAuthority({
        ...common,
        authorizationId: "changed-cutover-authorization",
      })
    ).rejects.toThrow("authorization differs from this retry");
  });

  it("accepts semantically identical migration dispositions from adapters with different object key order", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestAuthorityStore(),
      namespaceId: "cutover-disposition-order:primary",
    });
    const storage = new ReorderedMigrationManifestStorage();
    const migrationId = "cutover-disposition-order-migration";
    const compileSource = async (cutoverAt: string) => {
      const catalog = createTabletCatalog();
      return {
        catalog,
        plan: defineInventoryMigration({
          catalog,
          declaration: {
            migrationId,
            sourceSystem: "cutover-disposition-order-source",
            cutoverAt,
            openingStock: [],
            sourceDispositions: [
              {
                dispositionId: "pending-legacy-row",
                kind: InventoryMigrationSourceDispositionKind.SnapshotSupersededDoNotReplay,
                source: {
                  sourceType: "legacy-pending",
                  sourceId: "pending-1",
                  note: "snapshot authority",
                },
                snapshotAt: cutoverAt,
                reason: "opening snapshot supersedes pending legacy intent",
                evidence: { sourceRevision: 7, provider: "legacy" },
              },
            ],
          },
        }),
      };
    };

    const result = await cutoverInventoryAuthority({
      authority,
      storage,
      migrationId,
      fenceToken: "cutover-disposition-order-fence",
      authorizationId: "cutover-disposition-order-authorization",
      adapterCertificationDigest: "adapter-v1",
      cutoverAt: time1,
      sourceRevision: 7,
      compileSource,
      drainLegacyWriters: async () => {},
      clock: { now: (): string => time2 },
    });
    expect(result.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    const replay = await cutoverInventoryAuthority({
      authority,
      storage,
      migrationId,
      fenceToken: "cutover-disposition-order-fence",
      authorizationId: "cutover-disposition-order-authorization",
      adapterCertificationDigest: "adapter-v1",
      sourceRevision: 7,
      compileSource,
      drainLegacyWriters: async () => {},
      clock: { now: (): string => time2 },
    });
    expect(replay.targetWorldRoot).toBe(result.targetWorldRoot);
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
