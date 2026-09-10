import assert from "node:assert/strict";
import { test } from "vitest";
import {
  bootstrapGreenfieldInventoryAuthority,
  cutoverInventoryAuthority,
} from "../src/authority-cutover.js";
import {
  InventoryAuthorityCreateResult,
  InventoryAuthorityMode,
  createInventoryAuthorityControl,
  type InventoryAuthorityDocument,
  type InventoryAuthorityStateStore,
} from "../src/authority.js";
import { inventoryCatalogFromSnapshot } from "../src/catalog.js";
import { inventoryWorldContentRoots } from "../src/integrity.js";
import { defineInventoryMigration } from "../src/migrations.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage.js";
import { emptyInventoryWorldState } from "../src/world.js";

const time = "2030-01-01T00:00:00.000Z";
/** Compile the fixed empty migration source used by each authority race case. */
function compiled(migrationId = "m", cutoverAt = time) {
  const catalog = inventoryCatalogFromSnapshot(emptyInventoryWorldState().catalog);
  return {
    catalog,
    plan: defineInventoryMigration({
      catalog,
      declaration: { migrationId, sourceSystem: "s", cutoverAt, openingStock: [] },
    }),
  };
}
/** Create a CAS store that injects one peer completion at a selected transition. */
function hookedStore() {
  /** Current durable authority row shared by both competing controls. */
  let row: Record<string, unknown> | undefined;
  /** Predicate selecting the replacement that fires the peer hook. */
  let predicate: ((row: InventoryAuthorityDocument) => boolean) | undefined;
  /** One peer action injected when the selected replacement is observed. */
  let hook: (() => Promise<void>) | undefined;
  /** Reentrancy guard preventing the injected peer transition from recursively firing itself. */
  let inside = false;
  const store: InventoryAuthorityStateStore = {
    ensure: async () => {},
    read: async () => row === undefined ? undefined : structuredClone(row) as InventoryAuthorityDocument,
    create: async (document) => {
      if (row !== undefined) return InventoryAuthorityCreateResult.Existing;
      row = structuredClone(document);
      return InventoryAuthorityCreateResult.Created;
    },
    compareAndSet: async (expected, replacement) => {
      if (row === undefined) return false;
      for (const [key, value] of Object.entries(expected)) if (row[key] !== value) return false;
      row = { ...row, ...structuredClone(replacement) };
      if (!inside && hook !== undefined && predicate?.(row as InventoryAuthorityDocument)) {
        inside = true;
        try { await hook(); } finally { inside = false; }
      }
      return true;
    },
  };
  return {
    store,
    on(predicateNext: (row: InventoryAuthorityDocument) => boolean, hookNext: () => Promise<void>) {
      predicate = predicateNext;
      hook = hookNext;
    },
  };
}

/** Legacy cutover checkpoint where the peer completion is injected. */
type Phase = "cert" | "auth" | "shadow" | "dual" | "fence";
/** Durable-row predicate corresponding to each injectable legacy cutover checkpoint. */
const phasePredicate: Record<Phase, (r: InventoryAuthorityDocument) => boolean> = {
  cert: r => r.mode === InventoryAuthorityMode.Legacy && r.revision === 1 && r.adapterCertificationDigest === "cert",
  auth: r => r.mode === InventoryAuthorityMode.Legacy && r.revision === 2 && r.cutoverAuthorizationId === "auth",
  shadow: r => r.mode === InventoryAuthorityMode.Shadow && r.revision === 3,
  dual: r => r.mode === InventoryAuthorityMode.DualRun && r.revision === 4,
  fence: r => r.mode === InventoryAuthorityMode.Fencing && r.revision === 5 && r.fenceToken === "f",
};

/** Run one legacy cutover race with either matching or foreign peer evidence. */
async function legacyCase(phase: Phase, foreign: boolean) {
  const shared = hookedStore();
  const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
  const secondary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
  await primary.read(); await secondary.read();
  const storage = createInMemoryInventoryDurableStorage();
  /** Number of peer hooks attempted; only the first may execute the injected cutover. */
  let injected = 0;
  shared.on(phasePredicate[phase], async () => {
    if (injected++) return;
    const authorizationId = foreign && phase === "cert" ? "other-auth" : "auth";
    const fenceToken = foreign ? "other-fence" : "f";
    await cutoverInventoryAuthority({
      authority: secondary,
      storage,
      migrationId: "m",
      fenceToken,
      authorizationId,
      adapterCertificationDigest: "cert",
      cutoverAt: time,
      compileSource: async () => compiled(),
      drainLegacyWriters: async () => {},
      clock: { now: () => time },
    });
  });
  let result: Awaited<ReturnType<typeof cutoverInventoryAuthority>> | undefined;
  let error: Error | undefined;
  try {
    result = await cutoverInventoryAuthority({
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
  } catch (e) { error = e as Error; }
  assert.equal(injected > 0, true, `${phase}/${foreign}: hook did not fire`);
  if (foreign) {
    assert(error, `${phase}: foreign completion unexpectedly joined`);
    return { phase, foreign, outcome: "rejected", error: error.message };
  }
  assert.ifError(error);
  assert(result);
  assert.equal(result.authority.mode, InventoryAuthorityMode.Authoritative);
  assert.equal(result.authorizationId, "auth");
  assert.equal(result.authority.fenceToken, "f");
  return { phase, foreign, outcome: "joined", revision: result.authority.revision };
}

/** Run one greenfield bootstrap race with either matching or foreign peer evidence. */
async function greenfieldCase(foreign: boolean) {
  const shared = hookedStore();
  const primary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
  const secondary = createInventoryAuthorityControl({ store: shared.store, namespaceId: "ns" });
  await primary.read(); await secondary.read();
  /** Number of peer hooks attempted; only the first may execute the injected activation. */
  let injected = 0;
  shared.on(phasePredicate.cert, async () => {
    if (injected++) return;
    await secondary.activateGreenfield({
      authorizationId: foreign ? "other-green" : "green",
      certificationDigest: "cert",
      targetWorldRoot: inventoryWorldContentRoots(emptyInventoryWorldState()).world,
      targetWorldRevision: 0,
      activatedAt: time,
    });
  });
  let result: Awaited<ReturnType<typeof bootstrapGreenfieldInventoryAuthority>> | undefined;
  let error: Error | undefined;
  try {
    result = await bootstrapGreenfieldInventoryAuthority({
      authority: primary,
      storage: createInMemoryInventoryDurableStorage(),
      adapterCertificationDigest: "cert",
      authorizationId: "green",
      clock: { now: () => time },
    });
  } catch (e) { error = e as Error; }
  assert.equal(injected > 0, true);
  if (foreign) {
    assert(error, "foreign greenfield completion unexpectedly joined");
    return { phase: "green-cert", foreign, outcome: "rejected", error: error.message };
  }
  assert.ifError(error); assert(result);
  assert.equal(result.authorizationId, "green");
  return { phase: "green-cert", foreign, outcome: "joined", revision: result.authority.revision };
}

test("R47 exhausts concrete same-request and foreign completion checkpoints", async () => {
  const rows: unknown[] = [];
  rows.push(await greenfieldCase(false));
  rows.push(await greenfieldCase(true));
  for (const phase of ["cert", "auth", "shadow", "dual", "fence"] as const)
    rows.push(await legacyCase(phase, false));
  for (const phase of ["cert", "auth", "shadow", "dual"] as const)
    rows.push(await legacyCase(phase, true));
  assert.equal(rows.length, 11);
});
