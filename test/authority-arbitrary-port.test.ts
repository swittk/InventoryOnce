import { describe, expect, it } from "vitest";
import {
  bootstrapGreenfieldInventoryAuthority,
  cutoverInventoryAuthority,
} from "../src/authority-cutover.js";
import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityCreateResult,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
  createInventoryAuthorityControl,
  type ActivateInventoryAuthorityInput,
  type InventoryAuthorityControlPort,
  type InventoryAuthorityDocument,
  type InventoryAuthorityState,
  type InventoryAuthorityStateStore,
} from "../src/authority.js";
import { inventoryCatalogFromSnapshot } from "../src/catalog.js";
import { inventoryWorldContentRoots } from "../src/integrity.js";
import { defineInventoryMigration } from "../src/migrations.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage.js";
import { emptyInventoryWorldState } from "../src/world.js";

const time = "2030-01-01T00:00:00.000Z";
/** Build one complete durable authority state with explicit field overrides for malformed-port cases. */
function baseState(
  overrides: Partial<InventoryAuthorityState> = {},
): InventoryAuthorityState {
  return {
    namespaceId: "ns",
    revision: 0,
    mode: InventoryAuthorityMode.Legacy,
    activationKind: InventoryAuthorityActivationKind.None,
    cutoverAuthorizationId: "",
    greenfieldAuthorizationId: "",
    activeLegacyWriters: [],
    fenceToken: "",
    fenceStartedAt: "",
    sourcePlanDigest: "",
    sourceCatalogDigest: "",
    targetWorldRoot: "",
    targetWorldRevision: 0,
    activatedAt: "",
    adapterCertificationDigest: "",
    adapterCertifiedAt: "",
    sourceRoot: "",
    sourceRevision: 0,
    dualRunStartedAt: "",
    dualRunMismatchEvidence: [],
    compatibilityProjectionWorldRevision: 0,
    compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Lagging,
    compatibilityProjectionError: "",
    ...overrides,
  };
}
/** Compile the fixed empty migration source used by authority-port rejection cases. */
function compiled(migrationId = "m", cutoverAt = time) {
  const catalog = inventoryCatalogFromSnapshot(
    emptyInventoryWorldState().catalog,
  );
  return {
    catalog,
    plan: defineInventoryMigration({
      catalog,
      declaration: {
        migrationId,
        sourceSystem: "s",
        cutoverAt,
        openingStock: [],
      },
    }),
  };
}
/** Full authority-control fake used to inject malformed cutover results without weakening port typing. */
type CutoverTestPort = InventoryAuthorityControlPort & {
  /** Compile the fixed source plan used by these cutover assertions. */
  compile(): ReturnType<typeof compiled>;
};

/** Build a complete typed authority-control fake with configurable fence/activation lies. */
function cutoverPort(
  claimMode: InventoryAuthorityMode = InventoryAuthorityMode.Fencing,
  honestActivate = false,
): CutoverTestPort {
  const first = compiled();
  const sourceRoot = `${first.catalog.digest}:${first.plan.planDigest}`;
  let state = baseState();
  const port: CutoverTestPort = {
    read: async () => structuredClone(state),
    certifyAdapter: async () =>
      structuredClone(
        (state = baseState({
          revision: 1,
          adapterCertificationDigest: "cert",
          adapterCertifiedAt: time,
        })),
      ),
    authorizeCutover: async () =>
      structuredClone(
        (state = { ...state, revision: 2, cutoverAuthorizationId: "auth" }),
      ),
    enterShadow: async () =>
      structuredClone(
        (state = {
          ...state,
          revision: 3,
          mode: InventoryAuthorityMode.Shadow,
        }),
      ),
    enterDualRun: async () =>
      structuredClone(
        (state = {
          ...state,
          revision: 4,
          mode: InventoryAuthorityMode.DualRun,
          sourceRoot,
          sourceRevision: 0,
          sourcePlanDigest: first.plan.planDigest,
          sourceCatalogDigest: first.catalog.digest,
          dualRunStartedAt: time,
        }),
      ),
    recordDualRunMismatch: async () => structuredClone(state),
    admitLegacyWriter: async () => ({
      mode: state.mode,
      admittedLegacyWriter: false,
      state: structuredClone(state),
    }),
    releaseLegacyWriter: async () => structuredClone(state),
    claimFence: async () =>
      structuredClone(
        (state = {
          ...state,
          revision: 5,
          mode: claimMode,
          fenceToken: claimMode === InventoryAuthorityMode.Fencing ? "f" : "",
          fenceStartedAt:
            claimMode === InventoryAuthorityMode.Fencing ? time : "",
        }),
      ),
    activate: async (input: ActivateInventoryAuthorityInput) => {
      if (!honestActivate)
        return baseState({
          revision: 999,
          mode: InventoryAuthorityMode.Legacy,
          cutoverAuthorizationId: "BAD",
          sourcePlanDigest: input.sourcePlanDigest,
          sourceCatalogDigest: input.sourceCatalogDigest,
          targetWorldRoot: input.targetWorldRoot,
          targetWorldRevision: input.targetWorldRevision,
        });
      state = {
        ...state,
        revision: state.revision + 1,
        mode: InventoryAuthorityMode.Authoritative,
        activationKind: InventoryAuthorityActivationKind.LegacyCutover,
        greenfieldAuthorizationId: "",
        targetWorldRoot: input.targetWorldRoot,
        targetWorldRevision: input.targetWorldRevision,
        activatedAt: input.activatedAt,
        compatibilityProjectionWorldRevision: 0,
        compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Lagging,
        compatibilityProjectionError: "",
      };
      return structuredClone(state);
    },
    activateGreenfield: async () => structuredClone(state),
    releaseFence: async () => structuredClone(state),
    markCompatibilityProjectionApplied: async () => structuredClone(state),
    markCompatibilityProjectionFailed: async () => structuredClone(state),
    compile: () => compiled(),
  };
  return port;
}

/** Create a CAS store whose replacement hook can inject concurrent authority transitions. */
function createHookedAuthorityStore(): {
  /** Shared durable authority store used by the competing controls. */
  readonly store: InventoryAuthorityStateStore;
  /** Install a hook that fires when an Authoritative replacement is observed. */
  onAuthoritative: (hook: () => Promise<void>) => void;
  /** Install a hook for one caller-supplied replacement predicate. */
  onReplacement: (
    predicate: (replacement: InventoryAuthorityDocument) => boolean,
    hook: () => Promise<void>,
  ) => void;
} {
  let row: Record<string, unknown> | undefined;
  let hook: (() => Promise<void>) | undefined;
  let hookPredicate = (replacement: InventoryAuthorityDocument): boolean =>
    replacement.mode === InventoryAuthorityMode.Authoritative;
  let insideHook = false;
  const store: InventoryAuthorityStateStore = {
    ensure: async () => {},
    read: async () =>
      row === undefined ? undefined : (structuredClone(row) as InventoryAuthorityDocument),
    create: async (document) => {
      if (row !== undefined) return InventoryAuthorityCreateResult.Existing;
      row = structuredClone(document);
      return InventoryAuthorityCreateResult.Created;
    },
    compareAndSet: async (expected, replacement) => {
      if (row === undefined) return false;
      for (const [key, value] of Object.entries(expected)) {
        if (row[key] !== value) return false;
      }
      row = { ...row, ...structuredClone(replacement) };
      // Prevent the injected hook from recursively firing when its own CAS also satisfies hookPredicate.
      if (
        hook !== undefined &&
        !insideHook &&
        hookPredicate(row as InventoryAuthorityDocument)
      ) {
        insideHook = true;
        try {
          await hook();
        } finally {
          insideHook = false;
        }
      }
      return true;
    },
  };
  return {
    store,
    onAuthoritative: (nextHook) => {
      hookPredicate = (replacement) =>
        replacement.mode === InventoryAuthorityMode.Authoritative;
      hook = nextHook;
    },
    onReplacement: (predicate, nextHook) => {
      hookPredicate = predicate;
      hook = nextHook;
    },
  };
}

describe("authority orchestration rejects arbitrary port lies", () => {
  it("rejects a non-fencing state returned by claimFence", async () => {
    const authority = cutoverPort(InventoryAuthorityMode.DualRun);
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("returned fence evidence that differs");
  });

  it("rejects a non-authoritative final activate result", async () => {
    const authority = cutoverPort();
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("missing valid cutover evidence");
  });

  it("rejects a compiled source with a different migration identity or cutover time", async () => {
    const authority = cutoverPort();
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => compiled("OTHER"),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("migration identity/time differs");
    const authority2 = cutoverPort();
    await expect(
      cutoverInventoryAuthority({
        authority: authority2,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => compiled("m", "2030-01-02T00:00:00.000Z"),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("migration identity/time differs");
  });

  it("rejects an authoritative claimFence result without matching completed migration truth", async () => {
    const authority = cutoverPort(InventoryAuthorityMode.Authoritative);
    authority.claimFence = async () =>
      baseState({
        revision: 5,
        mode: InventoryAuthorityMode.Authoritative,
        activationKind: InventoryAuthorityActivationKind.LegacyCutover,
        cutoverAuthorizationId: "auth",
        fenceToken: "f",
        fenceStartedAt: time,
        adapterCertificationDigest: "cert",
        adapterCertifiedAt: time,
        sourceRoot: `${authority.compile().catalog.digest}:${authority.compile().plan.planDigest}`,
        sourceRevision: 0,
        sourcePlanDigest: authority.compile().plan.planDigest,
        sourceCatalogDigest: authority.compile().catalog.digest,
        dualRunStartedAt: time,
        targetWorldRoot: "FAKE",
        targetWorldRevision: 1,
        activatedAt: time,
      });
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("no matching completed migration manifest");
  });

  it("rejects a fabricated historical target on an otherwise real completed retry", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const honest = cutoverPort(InventoryAuthorityMode.Fencing, true);
    const first = await cutoverInventoryAuthority({
      authority: honest,
      storage,
      migrationId: "m",
      fenceToken: "f",
      authorizationId: "auth",
      adapterCertificationDigest: "cert",
      cutoverAt: time,
      compileSource: async () => honest.compile(),
      drainLegacyWriters: async () => {},
      clock: { now: () => time },
    });
    expect(first.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    const fake = {
      ...first.authority,
      targetWorldRoot: "FAKE-HISTORICAL-TARGET",
    };
    let compileCalls = 0;
    const maliciousRetry = cutoverPort();
    maliciousRetry.read = async () => structuredClone(fake);
    await expect(
      cutoverInventoryAuthority({
        authority: maliciousRetry,
        storage,
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => {
          compileCalls += 1;
          return honest.compile();
        },
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("cutover evidence differs from this request");
    expect(compileCalls).toBe(1);
  });

  it("rejects fake retained greenfield evidence before touching storage", async () => {
    let storageCalls = 0;
    const fake = baseState({
      revision: 9,
      mode: InventoryAuthorityMode.Authoritative,
      activationKind: InventoryAuthorityActivationKind.Greenfield,
      cutoverAuthorizationId: "LEGACY",
      greenfieldAuthorizationId: "green",
      adapterCertificationDigest: "cert",
      adapterCertifiedAt: time,
      targetWorldRoot: "FAKE",
      targetWorldRevision: 0,
      activatedAt: time,
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
    });
    const authority = cutoverPort();
    authority.read = async () => structuredClone(fake);
    const storage = createInMemoryInventoryDurableStorage();
    const readWorld = storage.readWorld.bind(storage);
    storage.readWorld = async () => {
      storageCalls += 1;
      return readWorld();
    };
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        authority,
        storage,
        adapterCertificationDigest: "cert",
        authorizationId: "green",
        clock: { now: () => time },
      }),
    ).rejects.toThrow("does not contain valid greenfield evidence");
    expect(storageCalls).toBe(0);
  });

  it("rejects fake greenfield evidence returned after a real empty-world check", async () => {
    let state = baseState();
    const fake = baseState({
      revision: 9,
      mode: InventoryAuthorityMode.Authoritative,
      activationKind: InventoryAuthorityActivationKind.Greenfield,
      cutoverAuthorizationId: "LEGACY",
      greenfieldAuthorizationId: "green",
      adapterCertificationDigest: "cert",
      adapterCertifiedAt: time,
      targetWorldRoot: "FAKE",
      targetWorldRevision: 0,
      activatedAt: time,
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
    });
    const authority = cutoverPort();
    authority.read = async () => structuredClone(state);
    authority.certifyAdapter = async () =>
      structuredClone(
        (state = {
          ...state,
          revision: 1,
          adapterCertificationDigest: "cert",
          adapterCertifiedAt: time,
        }),
      );
    authority.activateGreenfield = async () => structuredClone(fake);
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        adapterCertificationDigest: "cert",
        authorizationId: "green",
        clock: { now: () => time },
      }),
    ).rejects.toThrow("does not contain valid greenfield evidence");
  });

  it("rejects an authority namespace switch after certification", async () => {
    const authority = cutoverPort();
    const certifyAdapter = authority.certifyAdapter;
    authority.certifyAdapter = async (input) => ({
      ...(await certifyAdapter(input)),
      namespaceId: "other-ns",
    });
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("switched authority namespace");
  });

  it("rejects an authority revision rewind after authorization", async () => {
    const authority = cutoverPort();
    const authorizeCutover = authority.authorizeCutover;
    authority.authorizeCutover = async (input) => ({
      ...(await authorizeCutover(input)),
      revision: 0,
    });
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("rewound authority revision");
  });

  it("rejects malformed pre-authority compatibility progress", async () => {
    const authority = cutoverPort();
    const claimFence = authority.claimFence;
    authority.claimFence = async (input) => ({
      ...(await claimFence(input)),
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
      compatibilityProjectionWorldRevision: 1,
    });
    await expect(
      cutoverInventoryAuthority({
        authority,
        storage: createInMemoryInventoryDurableStorage(),
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => authority.compile(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("pre-authority state cannot retain compatibility projection progress");
  });

  it("accepts a real Greenfield activation whose post-CAS read observes a concurrent projector advance", async () => {
    const shared = createHookedAuthorityStore();
    const authority = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const projector = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await authority.read();
    await projector.read();
    let injected = false;
    shared.onAuthoritative(async () => {
      if (injected) return;
      injected = true;
      await projector.markCompatibilityProjectionApplied({ worldRevision: 999 });
    });
    const result = await bootstrapGreenfieldInventoryAuthority({
      authority,
      storage: createInMemoryInventoryDurableStorage(),
      adapterCertificationDigest: "cert",
      authorizationId: "green",
      clock: { now: () => time },
    });
    expect(injected).toBe(true);
    expect(result.authority.compatibilityProjectionStatus).toBe(
      InventoryCompatibilityProjectionStatus.Current,
    );
    expect(result.authority.compatibilityProjectionWorldRevision).toBe(999);
    expect(result.authority.revision).toBeGreaterThanOrEqual(3);
  });

  it("accepts a real legacy activation whose post-CAS read observes a concurrent projector advance", async () => {
    const shared = createHookedAuthorityStore();
    const authority = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const projector = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await authority.read();
    await projector.read();
    let injected = false;
    shared.onAuthoritative(async () => {
      if (injected) return;
      injected = true;
      await projector.markCompatibilityProjectionApplied({ worldRevision: 999 });
    });
    const result = await cutoverInventoryAuthority({
      authority,
      storage: createInMemoryInventoryDurableStorage(),
      migrationId: "m",
      fenceToken: "f",
      authorizationId: "auth",
      adapterCertificationDigest: "cert",
      cutoverAt: time,
      compileSource: async () => compiled(),
      drainLegacyWriters: async () => {},
      clock: { now: () => time },
    });
    expect(injected).toBe(true);
    expect(result.authority.compatibilityProjectionStatus).toBe(
      InventoryCompatibilityProjectionStatus.Current,
    );
    expect(result.authority.compatibilityProjectionWorldRevision).toBe(999);
    expect(result.authority.revision).toBeGreaterThanOrEqual(7);
  });


  it("joins a same-request Greenfield completion observed after certification", async () => {
    const shared = createHookedAuthorityStore();
    const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const completing = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await primary.read();
    await completing.read();
    let injected = false;
    shared.onReplacement(
      (replacement) =>
        replacement.mode === InventoryAuthorityMode.Legacy &&
        replacement.adapterCertificationDigest === "cert" &&
        replacement.revision === 1,
      async () => {
        if (injected) return;
        injected = true;
        await completing.activateGreenfield({
          authorizationId: "green",
          certificationDigest: "cert",
          targetWorldRoot: inventoryWorldContentRoots(emptyInventoryWorldState()).world,
          targetWorldRevision: 0,
          activatedAt: time,
        });
      },
    );
    const result = await bootstrapGreenfieldInventoryAuthority({
      authority: primary,
      storage: createInMemoryInventoryDurableStorage(),
      adapterCertificationDigest: "cert",
      authorizationId: "green",
      clock: { now: () => time },
    });
    expect(injected).toBe(true);
    expect(result.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    expect(result.authority.activationKind).toBe(
      InventoryAuthorityActivationKind.Greenfield,
    );
    expect(result.authorizationId).toBe("green");
  });

  it("rejects a foreign Greenfield completion observed after certification", async () => {
    const shared = createHookedAuthorityStore();
    const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const completing = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await primary.read();
    await completing.read();
    shared.onReplacement(
      (replacement) =>
        replacement.mode === InventoryAuthorityMode.Legacy &&
        replacement.adapterCertificationDigest === "cert" &&
        replacement.revision === 1,
      async () => {
        await completing.activateGreenfield({
          authorizationId: "other-green",
          certificationDigest: "cert",
          targetWorldRoot: inventoryWorldContentRoots(emptyInventoryWorldState()).world,
          targetWorldRevision: 0,
          activatedAt: time,
        });
      },
    );
    await expect(
      bootstrapGreenfieldInventoryAuthority({
        authority: primary,
        storage: createInMemoryInventoryDurableStorage(),
        adapterCertificationDigest: "cert",
        authorizationId: "green",
        clock: { now: () => time },
      }),
    ).rejects.toThrow("does not match this greenfield bootstrap");
  });

  it("joins a same-request legacy completion observed after authorization", async () => {
    const shared = createHookedAuthorityStore();
    const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const completing = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await primary.read();
    await completing.read();
    const storage = createInMemoryInventoryDurableStorage();
    let injected = false;
    shared.onReplacement(
      (replacement) =>
        replacement.mode === InventoryAuthorityMode.Legacy &&
        replacement.cutoverAuthorizationId === "auth" &&
        replacement.revision === 2,
      async () => {
        if (injected) return;
        injected = true;
        await cutoverInventoryAuthority({
          authority: completing,
          storage,
          migrationId: "m",
          fenceToken: "f",
          authorizationId: "auth",
          adapterCertificationDigest: "cert",
          cutoverAt: time,
          compileSource: async () => compiled(),
          drainLegacyWriters: async () => {},
          clock: { now: () => time },
        });
      },
    );
    const result = await cutoverInventoryAuthority({
      authority: primary,
      storage,
      migrationId: "m",
      fenceToken: "f",
      authorizationId: "auth",
      adapterCertificationDigest: "cert",
      cutoverAt: time,
      compileSource: async () => compiled(),
      drainLegacyWriters: async () => {},
      clock: { now: () => time },
    });
    expect(injected).toBe(true);
    expect(result.authority.mode).toBe(InventoryAuthorityMode.Authoritative);
    expect(result.authority.activationKind).toBe(
      InventoryAuthorityActivationKind.LegacyCutover,
    );
    expect(result.authorizationId).toBe("auth");
  });

  it("rejects a foreign legacy completion observed after certification", async () => {
    const shared = createHookedAuthorityStore();
    const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    const completing = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
    await primary.read();
    await completing.read();
    const storage = createInMemoryInventoryDurableStorage();
    shared.onReplacement(
      (replacement) =>
        replacement.mode === InventoryAuthorityMode.Legacy &&
        replacement.adapterCertificationDigest === "cert" &&
        replacement.revision === 1,
      async () => {
        await cutoverInventoryAuthority({
          authority: completing,
          storage,
          migrationId: "m",
          fenceToken: "other-fence",
          authorizationId: "other-auth",
          adapterCertificationDigest: "cert",
          cutoverAt: time,
          compileSource: async () => compiled(),
          drainLegacyWriters: async () => {},
          clock: { now: () => time },
        });
      },
    );
    await expect(
      cutoverInventoryAuthority({
        authority: primary,
        storage,
        migrationId: "m",
        fenceToken: "f",
        authorizationId: "auth",
        adapterCertificationDigest: "cert",
        cutoverAt: time,
        compileSource: async () => compiled(),
        drainLegacyWriters: async () => {},
        clock: { now: () => time },
      }),
    ).rejects.toThrow("already authoritative under another fence token");
  });

});
