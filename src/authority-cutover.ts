import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityMode,
  type InventoryAuthorityControlPort,
  type InventoryAuthorityState,
} from "./authority.js";
import type { InventoryClock } from "./coordinator.js";
import { inventoryWorldContentRoots } from "./integrity.js";
import type { InventoryMigrationSourcePlan } from "./migration-plugin.js";
import {
  InventoryMigrationPlanStatus,
  applyInventoryMigrationPlan,
  dryRunInventoryMigration,
} from "./migrations.js";
import {
  InventoryMigrationManifestState,
  type InventoryDurableStorage,
} from "./storage.js";
import { emptyInventoryWorldState, type InventoryWorldState } from "./world.js";

/** Inputs for one portable fail-closed legacy-to-InventoryOnce authority cutover. */
export interface CutoverInventoryAuthorityInput {
  /** Native executable authority state machine. */
  readonly authority: InventoryAuthorityControlPort;
  /** Durable inventory storage receiving the migration target world. */
  readonly storage: InventoryDurableStorage;
  /** Stable durable migration identity. */
  readonly migrationId: string;
  /** Stable fence/retry token authorized by the application. */
  readonly fenceToken: string;
  /** Exact adapter-conformance certification accepted by this deployment. */
  readonly adapterCertificationDigest: string;
  /** Optional canonical source time; retries prefer retained DualRun time, then certification/fence evidence. */
  readonly cutoverAt?: string;
  /** Monotonic application source revision bound into DualRun/fence evidence. */
  readonly sourceRevision?: number;
  /** Compile one complete application-specific legacy source at the supplied frozen time. */
  readonly compileSource: (
    cutoverAt: string
  ) => Promise<InventoryMigrationSourcePlan>;
  /** Wait until every admitted legacy writer has released after the fence wins. */
  readonly drainLegacyWriters: () => Promise<void>;
  /** Durable certification/activation clock. */
  readonly clock: InventoryClock;
}

/** Exact source/target evidence accepted by the native authority switch. */
export interface CutoverInventoryAuthorityResult {
  /** Final durable authority state. */
  readonly authority: InventoryAuthorityState;
  /** Exact source migration plan digest. */
  readonly sourcePlanDigest: string;
  /** Exact reconstructed source catalogue digest. */
  readonly sourceCatalogDigest: string;
  /** Exact published target world root. */
  readonly targetWorldRoot: string;
  /** Exact published target world revision. */
  readonly targetWorldRevision: number;
}

/** Inputs for explicitly establishing authority over a genuinely empty deployment. */
export interface BootstrapGreenfieldInventoryAuthorityInput {
  /** Native executable authority state machine. */
  readonly authority: InventoryAuthorityControlPort;
  /** Durable inventory storage whose current published world must be exactly empty. */
  readonly storage: InventoryDurableStorage;
  /** Exact adapter certification accepted by this deployment. */
  readonly adapterCertificationDigest: string;
  /** Explicit operator/deployment authorization for greenfield authority. */
  readonly authorizationId: string;
  /** Durable certification/activation clock. */
  readonly clock: InventoryClock;
}

/** Exact evidence retained by one greenfield authority bootstrap. */
export interface BootstrapGreenfieldInventoryAuthorityResult {
  /** Final durable authority state. */
  readonly authority: InventoryAuthorityState;
  /** Explicit retained deployment authorization. */
  readonly authorizationId: string;
  /** Exact revision-zero empty-world content root bound at activation. */
  readonly targetWorldRoot: string;
  /** Always zero for initial greenfield authority. */
  readonly targetWorldRevision: 0;
}

/**
 * Certify and atomically activate one genuinely empty stream without legacy-source fiction.
 * Exact retries after later native publications use the retained activation evidence.
 */
export async function bootstrapGreenfieldInventoryAuthority({
  authority: authorityControl,
  storage,
  adapterCertificationDigest: rawCertificationDigest,
  authorizationId: rawAuthorizationId,
  clock,
}: BootstrapGreenfieldInventoryAuthorityInput): Promise<BootstrapGreenfieldInventoryAuthorityResult> {
  const certificationDigest = requireCutoverText(
    rawCertificationDigest,
    "greenfield adapterCertificationDigest"
  );
  const authorizationId = requireCutoverText(
    rawAuthorizationId,
    "greenfield authorizationId"
  );
  let authority = await authorityControl.read();
  if (authority.mode === InventoryAuthorityMode.Authoritative) {
    const retained = inventoryAuthorityGreenfieldResult(authority);
    assertGreenfieldBootstrapMatches(
      retained,
      authorizationId,
      certificationDigest
    );
    return retained;
  }
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    authority = await authorityControl.certifyAdapter({
      certificationDigest,
      certifiedAt: clock.now(),
    });
  }
  if (
    authority.mode !== InventoryAuthorityMode.Legacy &&
    authority.mode !== InventoryAuthorityMode.Shadow
  ) {
    throw new Error(
      `InventoryOnce greenfield authority cannot start from mode '${authority.mode}'.`
    );
  }
  if (authority.adapterCertificationDigest !== certificationDigest) {
    throw new Error(
      "InventoryOnce greenfield authority certification differs from durable evidence."
    );
  }
  const target = await storage.readWorld();
  const targetWorldRoot = assertExactEmptyGreenfieldTarget(target);
  const activated = await authorityControl.activateGreenfield({
    authorizationId,
    certificationDigest,
    targetWorldRoot,
    targetWorldRevision: 0,
    activatedAt: clock.now(),
  });
  const result = inventoryAuthorityGreenfieldResult(activated);
  assertGreenfieldBootstrapMatches(
    result,
    authorizationId,
    certificationDigest
  );
  return result;
}

/**
 * Certify, shadow, dual-run, fence, double-read, migrate, and activate one authority stream.
 * Applications own authorization, source compilation, and writer-drain implementations.
 */
export async function cutoverInventoryAuthority({
  authority: authorityControl,
  storage,
  migrationId: rawMigrationId,
  fenceToken: rawFenceToken,
  adapterCertificationDigest: rawCertificationDigest,
  cutoverAt: explicitCutoverAt,
  sourceRevision = 0,
  compileSource,
  drainLegacyWriters,
  clock,
}: CutoverInventoryAuthorityInput): Promise<CutoverInventoryAuthorityResult> {
  const migrationId = requireCutoverText(rawMigrationId, "migrationId");
  const fenceToken = requireCutoverText(rawFenceToken, "fenceToken");
  const certificationDigest = requireCutoverText(
    rawCertificationDigest,
    "adapterCertificationDigest"
  );
  requireNonnegativeSafeInteger(sourceRevision, "sourceRevision");

  let authority = await authorityControl.read();
  if (authority.mode === InventoryAuthorityMode.Authoritative) {
    if (authority.fenceToken !== fenceToken) {
      throw new Error(
        "InventoryOnce is already authoritative under another fence token."
      );
    }
    return inventoryAuthorityCutoverResult(authority);
  }
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    authority = await authorityControl.certifyAdapter({
      certificationDigest,
      certifiedAt: clock.now(),
    });
  }
  const cutoverAt = resolveInventoryCutoverAt(explicitCutoverAt, authority);
  const first = await compileSource(cutoverAt);
  assertInventoryMigrationReady(first);
  const sourceRoot = inventoryMigrationSourceRoot(first);
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    authority = await authorityControl.enterShadow({ certificationDigest });
  }
  if (authority.mode === InventoryAuthorityMode.Shadow) {
    authority = await authorityControl.enterDualRun({
      sourceRoot,
      sourceRevision,
      sourcePlanDigest: first.plan.planDigest,
      sourceCatalogDigest: first.catalog.digest,
      startedAt: cutoverAt,
    });
  }
  if (authority.mode === InventoryAuthorityMode.DualRun) {
    assertInventoryDualRunSource(authority, first, sourceRoot, sourceRevision);
  } else if (authority.mode === InventoryAuthorityMode.Fencing) {
    if (
      authority.sourceRoot !== sourceRoot ||
      authority.sourceRevision !== sourceRevision
    ) {
      throw new Error(
        "InventoryOnce fenced source evidence differs from this retry."
      );
    }
  } else {
    throw new Error(
      `InventoryOnce cannot cut over from mode '${authority.mode}'.`
    );
  }

  await authorityControl.claimFence({
    fenceToken,
    startedAt: clock.now(),
    sourceRoot,
    sourceRevision,
  });
  let durableMigrationExists = false;
  try {
    const manifest = await storage.readMigrationManifest(migrationId);
    durableMigrationExists = manifest !== undefined;
    if (manifest?.state === InventoryMigrationManifestState.Aborted) {
      throw new Error(
        "The InventoryOnce migration identity was previously aborted."
      );
    }
    await drainLegacyWriters();
    const second = await compileSource(cutoverAt);
    assertInventoryMigrationReady(second);
    assertSameInventoryMigrationSource(first, second);
    const targetBefore = await storage.readWorld();
    if (manifest === undefined)
      assertEmptyInventoryAuthorityTarget(targetBefore);
    const dryRun = dryRunInventoryMigration({
      catalog: second.catalog,
      plan: second.plan,
      targetWorld:
        manifest === undefined ? targetBefore : emptyInventoryWorldState(),
    });
    durableMigrationExists = true;
    const targetAfter = await applyInventoryMigrationPlan({
      catalog: second.catalog,
      storage,
      plan: second.plan,
      dryRun,
      clock,
    });
    const targetWorldRoot = inventoryWorldContentRoots(targetAfter).world;
    const activated = await authorityControl.activate({
      fenceToken,
      sourcePlanDigest: second.plan.planDigest,
      sourceCatalogDigest: second.catalog.digest,
      sourceRoot,
      targetWorldRoot,
      targetWorldRevision: targetAfter.revision,
      activatedAt: clock.now(),
    });
    return {
      authority: activated,
      sourcePlanDigest: second.plan.planDigest,
      sourceCatalogDigest: second.catalog.digest,
      targetWorldRoot,
      targetWorldRevision: targetAfter.revision,
    };
  } catch (error) {
    if (!durableMigrationExists) {
      await authorityControl.releaseFence(fenceToken);
    }
    throw error;
  }
}

/** Reuse one durable timestamp across retries and concurrent process contenders. */
function resolveInventoryCutoverAt(
  explicit: string | undefined,
  authority: InventoryAuthorityState
): string {
  if (explicit !== undefined) {
    requireCanonicalCutoverTime(explicit, "cutoverAt");
    return explicit;
  }
  const retained =
    authority.dualRunStartedAt ||
    authority.adapterCertifiedAt ||
    authority.fenceStartedAt;
  requireCanonicalCutoverTime(retained, "retained cutoverAt");
  return retained;
}

/** Stable complete source identity bound into DualRun and the final fence. */
function inventoryMigrationSourceRoot(
  compiled: InventoryMigrationSourcePlan
): string {
  return `${compiled.catalog.digest}:${compiled.plan.planDigest}`;
}

/** Reject a changed source under an already durable DualRun checkpoint. */
function assertInventoryDualRunSource(
  authority: InventoryAuthorityState,
  compiled: InventoryMigrationSourcePlan,
  sourceRoot: string,
  sourceRevision: number
): void {
  if (
    authority.sourceRoot !== sourceRoot ||
    authority.sourceRevision !== sourceRevision ||
    authority.sourcePlanDigest !== compiled.plan.planDigest ||
    authority.sourceCatalogDigest !== compiled.catalog.digest
  ) {
    throw new Error(
      "InventoryOnce DualRun source evidence differs from this cutover."
    );
  }
}

/** Reject a blocked source compilation before any target write. */
function assertInventoryMigrationReady(
  compiled: InventoryMigrationSourcePlan
): void {
  if (compiled.plan.status === InventoryMigrationPlanStatus.Ready) return;
  const errorMessages: string[] = [];
  for (const diagnostic of compiled.plan.diagnostics) {
    if (diagnostic.severity === "error") {
      errorMessages.push(diagnostic.message);
    }
  }
  const errors = errorMessages.join("; ");
  throw new Error(
    `InventoryOnce cutover source migration is blocked${
      errors.length === 0 ? "." : `: ${errors}`
    }`
  );
}

/** Require two complete source reads under the fence to match exactly. */
function assertSameInventoryMigrationSource(
  first: InventoryMigrationSourcePlan,
  second: InventoryMigrationSourcePlan
): void {
  if (
    first.plan.planDigest !== second.plan.planDigest ||
    first.catalog.digest !== second.catalog.digest
  ) {
    throw new Error(
      "InventoryOnce cutover source changed while fenced; repair the remaining writer and retry."
    );
  }
}

/** Require an unused authoritative stream before its first migration manifest. */
function assertEmptyInventoryAuthorityTarget(world: InventoryWorldState): void {
  if (
    world.revision !== 0 ||
    Object.keys(world.projection.events).length !== 0 ||
    Object.keys(world.projection.positions).length !== 0 ||
    Object.keys(world.reservations.reservations).length !== 0 ||
    Object.keys(world.counts.counts).length !== 0
  ) {
    throw new Error(
      "InventoryOnce authority target is not empty and has no matching migration manifest."
    );
  }
}

/** Return exact evidence for an idempotent already-authoritative state. */
export function inventoryAuthorityCutoverResult(
  state: InventoryAuthorityState
): CutoverInventoryAuthorityResult {
  if (
    state.sourcePlanDigest.length === 0 ||
    state.sourceCatalogDigest.length === 0 ||
    state.targetWorldRoot.length === 0 ||
    state.targetWorldRevision < 0
  ) {
    throw new Error(
      "InventoryOnce authoritative state is missing cutover evidence."
    );
  }
  return {
    authority: state,
    sourcePlanDigest: state.sourcePlanDigest,
    sourceCatalogDigest: state.sourceCatalogDigest,
    targetWorldRoot: state.targetWorldRoot,
    targetWorldRevision: state.targetWorldRevision,
  };
}

/** Require the complete published target to equal the canonical revision-zero empty world. */
function assertExactEmptyGreenfieldTarget(world: InventoryWorldState): string {
  const expected = inventoryWorldContentRoots(emptyInventoryWorldState());
  const actual = inventoryWorldContentRoots(world);
  if (
    world.revision !== 0 ||
    actual.world !== expected.world ||
    actual.catalog !== expected.catalog ||
    actual.projection !== expected.projection ||
    actual.reservations !== expected.reservations ||
    actual.counts !== expected.counts
  ) {
    throw new Error(
      "InventoryOnce greenfield authority requires the exact canonical revision-zero empty world."
    );
  }
  return actual.world;
}

/** Return validated retained greenfield activation evidence after ordinary restart. */
export function inventoryAuthorityGreenfieldResult(
  state: InventoryAuthorityState
): BootstrapGreenfieldInventoryAuthorityResult {
  if (
    state.mode !== InventoryAuthorityMode.Authoritative ||
    state.activationKind !== InventoryAuthorityActivationKind.Greenfield ||
    state.greenfieldAuthorizationId.length === 0 ||
    state.adapterCertificationDigest.length === 0 ||
    state.targetWorldRoot.length === 0 ||
    state.targetWorldRevision !== 0 ||
    state.sourceRoot.length !== 0 ||
    state.sourcePlanDigest.length !== 0 ||
    state.sourceCatalogDigest.length !== 0 ||
    state.fenceToken.length !== 0
  ) {
    throw new Error(
      "InventoryOnce authoritative state does not contain valid greenfield evidence."
    );
  }
  return {
    authority: state,
    authorizationId: state.greenfieldAuthorizationId,
    targetWorldRoot: state.targetWorldRoot,
    targetWorldRevision: 0,
  };
}

/** Require an explicit first-bootstrap request to match retained greenfield evidence. */
function assertGreenfieldBootstrapMatches(
  result: BootstrapGreenfieldInventoryAuthorityResult,
  authorizationId: string,
  certificationDigest: string
): void {
  if (
    result.authorizationId !== authorizationId ||
    result.authority.adapterCertificationDigest !== certificationDigest
  ) {
    throw new Error(
      "InventoryOnce authoritative state does not match this greenfield bootstrap."
    );
  }
}

/** Require one non-empty portable cutover identity/digest. */
function requireCutoverText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`InventoryOnce cutover ${label} must not be empty.`);
  }
  return normalized;
}

/** Require one canonical UTC ISO cutover instant. */
function requireCanonicalCutoverTime(value: string, label: string): void {
  const normalized = requireCutoverText(value, label);
  const parsed = new Date(normalized);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== normalized
  ) {
    throw new Error(
      `InventoryOnce cutover ${label} must be canonical UTC ISO time.`
    );
  }
}

/** Require one non-negative safe integer source revision. */
function requireNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `InventoryOnce cutover ${label} must be a non-negative safe integer.`
    );
  }
}
