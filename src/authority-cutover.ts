import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
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
  /** Stable fence/retry token for this cutover. */
  readonly fenceToken: string;
  /** Explicit operator/deployment authorization; exact retries must reuse it. */
  readonly authorizationId: string;
  /** Exact adapter-conformance certification accepted by this deployment. */
  readonly adapterCertificationDigest: string;
  /** Optional canonical source time; retries prefer retained DualRun time, then certification/fence evidence. */
  readonly cutoverAt?: string;
  /** Monotonic application source revision bound into DualRun/fence evidence. */
  readonly sourceRevision?: number;
  /** Compile one complete application-specific legacy source at the supplied frozen time. */
  readonly compileSource: (
    cutoverAt: string,
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
  /** Explicit retained operator/deployment authorization for this legacy cutover. */
  readonly authorizationId: string;
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

/** Normalized evidence needed to join one concurrent completed legacy cutover. */
interface CompletedInventoryCutoverValidationInput {
  /** Authority state returned by the latest port observation. */
  readonly authority: InventoryAuthorityState;
  /** Durable inventory storage containing the independently completed migration. */
  readonly storage: InventoryDurableStorage;
  /** Exact migration identity requested by this outer cutover. */
  readonly migrationId: string;
  /** Exact fence identity requested by this outer cutover. */
  readonly fenceToken: string;
  /** Exact deployment authorization requested by this outer cutover. */
  readonly authorizationId: string;
  /** Exact adapter certification requested by this outer cutover. */
  readonly certificationDigest: string;
  /** Optional caller-fixed cutover time. */
  readonly explicitCutoverAt: string | undefined;
  /** Exact source revision requested by this outer cutover. */
  readonly sourceRevision: number;
  /** Application source compiler used to independently revalidate completion. */
  readonly compileSource: CutoverInventoryAuthorityInput["compileSource"];
}

/** Join only an already-authoritative state that independently proves this exact cutover request. */
async function completedInventoryCutoverResult(
  input: CompletedInventoryCutoverValidationInput,
): Promise<CutoverInventoryAuthorityResult | undefined> {
  const authority = input.authority;
  if (authority.mode !== InventoryAuthorityMode.Authoritative) return undefined;
  if (authority.fenceToken !== input.fenceToken) {
    throw new Error(
      "InventoryOnce is already authoritative under another fence token.",
    );
  }
  if (authority.cutoverAuthorizationId !== input.authorizationId) {
    throw new Error(
      "InventoryOnce authoritative cutover authorization differs from this retry.",
    );
  }
  if (authority.adapterCertificationDigest !== input.certificationDigest) {
    throw new Error(
      "InventoryOnce cutover certification differs from durable evidence.",
    );
  }
  if (authority.sourceRevision !== input.sourceRevision) {
    throw new Error(
      "InventoryOnce authoritative source revision differs from this retry.",
    );
  }
  if (
    input.explicitCutoverAt !== undefined &&
    authority.dualRunStartedAt !== input.explicitCutoverAt
  ) {
    throw new Error(
      "InventoryOnce authoritative cutover time differs from this retry.",
    );
  }
  const cutoverAt = resolveInventoryCutoverAt(
    input.explicitCutoverAt,
    authority,
  );
  const compiled = await input.compileSource(cutoverAt);
  assertInventoryMigrationReady(compiled);
  assertInventoryCutoverSourceMatchesRequest(
    compiled,
    input.migrationId,
    cutoverAt,
  );
  const sourceRoot = inventoryMigrationSourceRoot(compiled);
  assertInventoryDualRunSource(
    authority,
    compiled,
    sourceRoot,
    input.sourceRevision,
    cutoverAt,
  );
  const dryRun = dryRunInventoryMigration({
    catalog: compiled.catalog,
    plan: compiled.plan,
    targetWorld: emptyInventoryWorldState(),
  });
  const manifest = await input.storage.readMigrationManifest(input.migrationId);
  assertCompletedInventoryCutoverManifest(
    manifest,
    compiled,
    dryRun,
    input.migrationId,
  );
  const retained = inventoryAuthorityCutoverResult(authority);
  assertInventoryCutoverResultMatches(retained, {
    authorizationId: input.authorizationId,
    fenceToken: input.fenceToken,
    certificationDigest: input.certificationDigest,
    sourceRevision: input.sourceRevision,
    cutoverAt,
    sourceRoot,
    sourcePlanDigest: compiled.plan.planDigest,
    sourceCatalogDigest: compiled.catalog.digest,
    targetWorldRoot: inventoryWorldContentRoots(dryRun.resultWorld).world,
    targetWorldRevision: dryRun.resultWorld.revision,
  });
  return retained;
}

/** Join only an already-authoritative Greenfield state proving this exact bootstrap request. */
function completedGreenfieldBootstrapResult(
  authority: InventoryAuthorityState,
  authorizationId: string,
  certificationDigest: string,
): BootstrapGreenfieldInventoryAuthorityResult | undefined {
  if (authority.mode !== InventoryAuthorityMode.Authoritative) return undefined;
  const retained = inventoryAuthorityGreenfieldResult(authority);
  assertGreenfieldBootstrapMatches(
    retained,
    authorizationId,
    certificationDigest,
    inventoryWorldContentRoots(emptyInventoryWorldState()).world,
  );
  return retained;
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
    "greenfield adapterCertificationDigest",
  );
  const authorizationId = requireCutoverText(
    rawAuthorizationId,
    "greenfield authorizationId",
  );
  let authority = await authorityControl.read();
  const authorityStream = establishAuthorityPortStream(
    authority,
    "greenfield initial read",
  );
  {
    const completed = completedGreenfieldBootstrapResult(
      authority,
      authorizationId,
      certificationDigest,
    );
    if (completed !== undefined) return completed;
  }
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    const certified = await authorityControl.certifyAdapter({
      certificationDigest,
      certifiedAt: clock.now(),
    });
    acceptAuthorityPortState(authorityStream, certified, "greenfield certification");
    authority = certified;
    const completed = completedGreenfieldBootstrapResult(
      authority,
      authorizationId,
      certificationDigest,
    );
    if (completed !== undefined) return completed;
  }
  if (
    authority.mode !== InventoryAuthorityMode.Legacy &&
    authority.mode !== InventoryAuthorityMode.Shadow
  ) {
    throw new Error(
      `InventoryOnce greenfield authority cannot start from mode '${authority.mode}'.`,
    );
  }
  if (authority.adapterCertificationDigest !== certificationDigest) {
    throw new Error(
      "InventoryOnce greenfield authority certification differs from durable evidence.",
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
    certificationDigest,
    targetWorldRoot,
  );
  acceptAuthorityPortState(authorityStream, activated, "greenfield activation");
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
  authorizationId: rawAuthorizationId,
  adapterCertificationDigest: rawCertificationDigest,
  cutoverAt: explicitCutoverAt,
  sourceRevision = 0,
  compileSource,
  drainLegacyWriters,
  clock,
}: CutoverInventoryAuthorityInput): Promise<CutoverInventoryAuthorityResult> {
  const migrationId = requireCutoverText(rawMigrationId, "migrationId");
  const fenceToken = requireCutoverText(rawFenceToken, "fenceToken");
  const authorizationId = requireCutoverText(
    rawAuthorizationId,
    "authorizationId",
  );
  const certificationDigest = requireCutoverText(
    rawCertificationDigest,
    "adapterCertificationDigest",
  );
  requireNonnegativeSafeInteger(sourceRevision, "sourceRevision");

  let authority = await authorityControl.read();
  const authorityStream = establishAuthorityPortStream(authority, "cutover initial read");
  const resolveConcurrentCompletion = /** Replay an already-completed concurrent cutover only when it matches this exact attempt. */ (
    observed: InventoryAuthorityState,
  ): Promise<CutoverInventoryAuthorityResult | undefined> =>
    completedInventoryCutoverResult({
      authority: observed,
      storage,
      migrationId,
      fenceToken,
      authorizationId,
      certificationDigest,
      explicitCutoverAt,
      sourceRevision,
      compileSource,
    });
  {
    const completed = await resolveConcurrentCompletion(authority);
    if (completed !== undefined) return completed;
  }
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    const certified = await authorityControl.certifyAdapter({
      certificationDigest,
      certifiedAt: clock.now(),
    });
    acceptAuthorityPortState(authorityStream, certified, "cutover certification");
    authority = certified;
    const completed = await resolveConcurrentCompletion(authority);
    if (completed !== undefined) return completed;
  }
  // Retries may resume after certification transitions, so bind every attempt to the durable adapter evidence.
  if (authority.adapterCertificationDigest !== certificationDigest) {
    throw new Error(
      "InventoryOnce cutover certification differs from durable evidence.",
    );
  }
  if (
    authority.cutoverAuthorizationId.length !== 0 &&
    authority.cutoverAuthorizationId !== authorizationId
  ) {
    throw new Error(
      "InventoryOnce legacy cutover authorization differs from durable evidence.",
    );
  }
  {
    const authorized = await authorityControl.authorizeCutover({ authorizationId });
    acceptAuthorityPortState(authorityStream, authorized, "cutover authorization");
    authority = authorized;
    const completed = await resolveConcurrentCompletion(authority);
    if (completed !== undefined) return completed;
  }
  const cutoverAt = resolveInventoryCutoverAt(explicitCutoverAt, authority);
  const first = await compileSource(cutoverAt);
  assertInventoryMigrationReady(first);
  assertInventoryCutoverSourceMatchesRequest(first, migrationId, cutoverAt);
  const sourceRoot = inventoryMigrationSourceRoot(first);
  if (authority.mode === InventoryAuthorityMode.Legacy) {
    const shadow = await authorityControl.enterShadow({ certificationDigest });
    acceptAuthorityPortState(authorityStream, shadow, "Shadow transition");
    authority = shadow;
    const completed = await resolveConcurrentCompletion(authority);
    if (completed !== undefined) return completed;
  }
  if (authority.mode === InventoryAuthorityMode.Shadow) {
    const dualRun = await authorityControl.enterDualRun({
      sourceRoot,
      sourceRevision,
      sourcePlanDigest: first.plan.planDigest,
      sourceCatalogDigest: first.catalog.digest,
      startedAt: cutoverAt,
    });
    acceptAuthorityPortState(authorityStream, dualRun, "DualRun transition");
    authority = dualRun;
    const completed = await resolveConcurrentCompletion(authority);
    if (completed !== undefined) return completed;
  }
  if (authority.mode === InventoryAuthorityMode.DualRun) {
    assertInventoryDualRunSource(
      authority,
      first,
      sourceRoot,
      sourceRevision,
      cutoverAt,
    );
  } else if (authority.mode === InventoryAuthorityMode.Fencing) {
    if (
      authority.sourceRoot !== sourceRoot ||
      authority.sourceRevision !== sourceRevision
    ) {
      throw new Error(
        "InventoryOnce fenced source evidence differs from this retry.",
      );
    }
  } else {
    throw new Error(
      `InventoryOnce cannot cut over from mode '${authority.mode}'.`,
    );
  }

  if (authority.activeLegacyWriters.length !== 0) {
    throw new Error(
      "InventoryOnce cannot claim the cutover fence while legacy writers remain active.",
    );
  }
  if (authority.dualRunMismatchEvidence.length !== 0) {
    throw new Error(
      "InventoryOnce cannot claim the cutover fence while DualRun mismatch evidence remains.",
    );
  }
  if (
    authority.mode === InventoryAuthorityMode.Fencing &&
    (authority.fenceToken !== fenceToken ||
      authority.cutoverAuthorizationId !== authorizationId)
  ) {
    throw new Error(
      "InventoryOnce retained fence ownership belongs to another cutover request.",
    );
  }

  const fenced = await authorityControl.claimFence({
    fenceToken,
    startedAt: clock.now(),
    sourceRoot,
    sourceRevision,
  });
  acceptAuthorityPortState(authorityStream, fenced, "fence claim");
  // Fence ownership is already durable. Resolve migration state before entering any path that may release it.
  const manifest = await storage.readMigrationManifest(migrationId);
  const fenceReturnedAuthoritative =
    fenced.mode === InventoryAuthorityMode.Authoritative;
  if (fenceReturnedAuthoritative) {
    const dryRun = dryRunInventoryMigration({
      catalog: first.catalog,
      plan: first.plan,
      targetWorld: emptyInventoryWorldState(),
    });
    assertCompletedInventoryCutoverManifest(
      manifest,
      first,
      dryRun,
      migrationId,
    );
    const retained = inventoryAuthorityCutoverResult(fenced);
    assertInventoryCutoverResultMatches(retained, {
      authorizationId,
      fenceToken,
      certificationDigest,
      sourceRevision,
      cutoverAt,
      sourceRoot,
      sourcePlanDigest: first.plan.planDigest,
      sourceCatalogDigest: first.catalog.digest,
      targetWorldRoot: inventoryWorldContentRoots(dryRun.resultWorld).world,
      targetWorldRevision: dryRun.resultWorld.revision,
    });
    return retained;
  }
  assertInventoryFenceEvidenceMatches(fenced, {
    authorizationId,
    fenceToken,
    certificationDigest,
    sourceRevision,
    cutoverAt,
    sourceRoot,
    sourcePlanDigest: first.plan.planDigest,
    sourceCatalogDigest: first.catalog.digest,
  });
  if (manifest?.state === InventoryMigrationManifestState.Aborted) {
    throw new Error(
      "The InventoryOnce migration identity was previously aborted.",
    );
  }
  // Once the shared fence is durable, never release it automatically from one
  // cutover attempt. Same-token retries intentionally join that fence, and a
  // peer can publish migration state after any local manifest observation. No
  // cross-store read can atomically prove that release is still safe. Failures
  // therefore retain fencing for an exact retry; explicit administrative
  // release remains a separate operation after the caller has quiesced peers.
  await drainLegacyWriters();
  const second = await compileSource(cutoverAt);
  assertInventoryMigrationReady(second);
  assertInventoryCutoverSourceMatchesRequest(second, migrationId, cutoverAt);
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
  const result = inventoryAuthorityCutoverResult(activated);
  assertInventoryCutoverResultMatches(result, {
    authorizationId,
    fenceToken,
    certificationDigest,
    sourceRevision,
    cutoverAt,
    sourceRoot,
    sourcePlanDigest: second.plan.planDigest,
    sourceCatalogDigest: second.catalog.digest,
    targetWorldRoot,
    targetWorldRevision: targetAfter.revision,
  });
  acceptAuthorityPortState(authorityStream, activated, "legacy activation");
  return result;
}

/** Reuse one durable timestamp across retries and concurrent process contenders. */
function resolveInventoryCutoverAt(
  explicit: string | undefined,
  authority: InventoryAuthorityState,
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
  compiled: InventoryMigrationSourcePlan,
): string {
  return `${compiled.catalog.digest}:${compiled.plan.planDigest}`;
}

/** Reject a changed source under an already durable DualRun checkpoint. */
function assertInventoryDualRunSource(
  authority: InventoryAuthorityState,
  compiled: InventoryMigrationSourcePlan,
  sourceRoot: string,
  sourceRevision: number,
  cutoverAt: string,
): void {
  if (
    authority.sourceRoot !== sourceRoot ||
    authority.sourceRevision !== sourceRevision ||
    authority.sourcePlanDigest !== compiled.plan.planDigest ||
    authority.sourceCatalogDigest !== compiled.catalog.digest ||
    authority.dualRunStartedAt !== cutoverAt
  ) {
    throw new Error(
      "InventoryOnce DualRun source evidence differs from this cutover.",
    );
  }
}

/** Require a compiled source callback to remain bound to this exact cutover request. */
function assertInventoryCutoverSourceMatchesRequest(
  compiled: InventoryMigrationSourcePlan,
  migrationId: string,
  cutoverAt: string,
): void {
  if (
    compiled.plan.migrationId !== migrationId ||
    compiled.plan.cutoverAt !== cutoverAt
  ) {
    throw new Error(
      "InventoryOnce cutover source migration identity/time differs from this request.",
    );
  }
}

/** Require completed durable migration evidence to independently support one authoritative retry. */
function assertCompletedInventoryCutoverManifest(
  manifest: Awaited<
    ReturnType<InventoryDurableStorage["readMigrationManifest"]>
  >,
  compiled: InventoryMigrationSourcePlan,
  dryRun: ReturnType<typeof dryRunInventoryMigration>,
  migrationId: string,
): void {
  if (
    manifest === undefined ||
    manifest.state !== InventoryMigrationManifestState.Completed ||
    manifest.migrationId !== migrationId ||
    manifest.planDigest !== compiled.plan.planDigest ||
    manifest.baseRevision !== dryRun.baseRevision ||
    manifest.baseWorldRoot !== dryRun.baseWorldRoot ||
    JSON.stringify(manifest.sourceDispositions) !==
      JSON.stringify(compiled.plan.sourceDispositions) ||
    !manifest.worldWritten ||
    !manifest.worldPublished ||
    manifest.operationIds.length !== compiled.plan.events.length
  ) {
    throw new Error(
      "InventoryOnce authoritative cutover has no matching completed migration manifest.",
    );
  }
  for (let index = 0; index < manifest.operationIds.length; index += 1) {
    const expectedOperationId = compiled.plan.events[index]?.operationId;
    if (
      expectedOperationId === undefined ||
      manifest.operationIds[index] !== expectedOperationId
    ) {
      throw new Error(
        "InventoryOnce authoritative cutover has no matching completed migration manifest.",
      );
    }
  }
}

/** Reject a blocked source compilation before any target write. */
function assertInventoryMigrationReady(
  compiled: InventoryMigrationSourcePlan,
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
    }`,
  );
}

/** Require two complete source reads under the fence to match exactly. */
function assertSameInventoryMigrationSource(
  first: InventoryMigrationSourcePlan,
  second: InventoryMigrationSourcePlan,
): void {
  if (
    first.plan.planDigest !== second.plan.planDigest ||
    first.catalog.digest !== second.catalog.digest
  ) {
    throw new Error(
      "InventoryOnce cutover source changed while fenced; repair the remaining writer and retry.",
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
      "InventoryOnce authority target is not empty and has no matching migration manifest.",
    );
  }
}

/** One observed authority stream identity/revision used to reject arbitrary-port rewind or stream swaps. */
interface AuthorityPortStreamObservation {
  /** Stable authority namespace that every observed port state must retain. */
  readonly namespaceId: string;
  /** Highest durable authority revision accepted on this stream so far. */
  revision: number;
  /** Last accepted authority state used to enforce retained-lineage monotonicity. */
  state: InventoryAuthorityState;
}

/** Validate the state-shape facts that remain true across legal concurrent projector updates. */
function assertAuthorityPortStateEnvelope(
  state: InventoryAuthorityState,
  label: string,
): void {
  requireRetainedCutoverText(state.namespaceId, `${label} namespaceId`);
  requireNonnegativeSafeInteger(state.revision, `${label} authority revision`);
  requireNonnegativeSafeInteger(
    state.compatibilityProjectionWorldRevision,
    `${label} compatibility projection revision`,
  );

  if (state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Failed) {
    requireRetainedCutoverText(
      state.compatibilityProjectionError,
      `${label} compatibility projection error`,
    );
    if (state.compatibilityProjectionError.length > 2000) {
      throw new Error(
        `InventoryOnce ${label} compatibility projection error exceeds its durable bound.`,
      );
    }
  } else if (
    state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Current ||
    state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Lagging
  ) {
    if (state.compatibilityProjectionError.length !== 0) {
      throw new Error(
        `InventoryOnce ${label} non-failed compatibility projection cannot retain an error.`,
      );
    }
  } else {
    throw new Error(`InventoryOnce ${label} has an unknown compatibility projection status.`);
  }

  if (
    state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Lagging &&
    state.compatibilityProjectionWorldRevision !== 0
  ) {
    throw new Error(
      `InventoryOnce ${label} lagging compatibility projection must remain at revision zero.`,
    );
  }

  if (state.mode !== InventoryAuthorityMode.Authoritative) {
    if (state.activationKind !== InventoryAuthorityActivationKind.None) {
      throw new Error(`InventoryOnce ${label} cannot retain activation provenance before authority.`);
    }
    if (
      state.compatibilityProjectionStatus !== InventoryCompatibilityProjectionStatus.Lagging ||
      state.compatibilityProjectionWorldRevision !== 0
    ) {
      throw new Error(
        `InventoryOnce ${label} pre-authority state cannot retain compatibility projection progress.`,
      );
    }
  } else {
    if (state.activationKind === InventoryAuthorityActivationKind.None) {
      throw new Error(`InventoryOnce ${label} authoritative state is missing activation provenance.`);
    }
    if (
      state.activationKind === InventoryAuthorityActivationKind.Greenfield &&
      state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Lagging
    ) {
      throw new Error(
        `InventoryOnce ${label} greenfield authority cannot return legacy-cutover lagging projection state.`,
      );
    }
  }
}

/** Establish the durable stream identity before any orchestration transition is trusted. */
function establishAuthorityPortStream(
  state: InventoryAuthorityState,
  label: string,
): AuthorityPortStreamObservation {
  assertAuthorityPortStateEnvelope(state, label);
  return {
    namespaceId: state.namespaceId,
    revision: state.revision,
    state: structuredClone(state),
  };
}

/** Preserve every already-observed durable fact that no accepted controller transition may rewrite. */
function assertAuthorityPortRetainedLineage(
  previous: InventoryAuthorityState,
  next: InventoryAuthorityState,
  label: string,
): void {
  if (
    next.compatibilityProjectionWorldRevision <
      previous.compatibilityProjectionWorldRevision ||
    (previous.mode === InventoryAuthorityMode.Authoritative &&
      previous.compatibilityProjectionStatus !==
        InventoryCompatibilityProjectionStatus.Lagging &&
      next.compatibilityProjectionStatus ===
        InventoryCompatibilityProjectionStatus.Lagging)
  ) {
    throw new Error(`InventoryOnce ${label} regressed compatibility projection history.`);
  }
  if (
    previous.adapterCertificationDigest.length !== 0 &&
    (next.adapterCertificationDigest !== previous.adapterCertificationDigest ||
      next.adapterCertifiedAt !== previous.adapterCertifiedAt)
  ) {
    throw new Error(`InventoryOnce ${label} rewrote retained adapter certification.`);
  }
  if (
    previous.cutoverAuthorizationId.length !== 0 &&
    next.cutoverAuthorizationId !== previous.cutoverAuthorizationId
  ) {
    throw new Error(`InventoryOnce ${label} rewrote retained cutover authorization.`);
  }
  if (
    previous.greenfieldAuthorizationId.length !== 0 &&
    next.greenfieldAuthorizationId !== previous.greenfieldAuthorizationId
  ) {
    throw new Error(`InventoryOnce ${label} rewrote retained greenfield authorization.`);
  }
  if (previous.sourceRoot.length !== 0) {
    if (
      next.sourceRoot !== previous.sourceRoot ||
      next.sourceRevision !== previous.sourceRevision ||
      next.sourcePlanDigest !== previous.sourcePlanDigest ||
      next.sourceCatalogDigest !== previous.sourceCatalogDigest ||
      next.dualRunStartedAt !== previous.dualRunStartedAt
    ) {
      throw new Error(`InventoryOnce ${label} rewrote retained source evidence.`);
    }
  }
  if (previous.fenceToken.length !== 0) {
    if (
      next.fenceToken !== previous.fenceToken ||
      next.fenceStartedAt !== previous.fenceStartedAt
    ) {
      throw new Error(`InventoryOnce ${label} rewrote retained fence ownership.`);
    }
  }
  for (const earlier of previous.dualRunMismatchEvidence) {
    if (
      !next.dualRunMismatchEvidence.some(
        /** Match one later mismatch row to the exact earlier retained evidence identity. */
        (candidate) =>
          candidate.commandId === earlier.commandId &&
          candidate.legacyIntentDigest === earlier.legacyIntentDigest &&
          candidate.authoritativeIntentDigest === earlier.authoritativeIntentDigest &&
          candidate.recordedAt === earlier.recordedAt,
      )
    ) {
      throw new Error(`InventoryOnce ${label} erased retained mismatch evidence.`);
    }
  }
  if (previous.activationKind !== InventoryAuthorityActivationKind.None) {
    if (
      next.activationKind !== previous.activationKind ||
      next.targetWorldRoot !== previous.targetWorldRoot ||
      next.targetWorldRevision !== previous.targetWorldRevision ||
      next.activatedAt !== previous.activatedAt
    ) {
      throw new Error(`InventoryOnce ${label} rewrote retained activation evidence.`);
    }
  }
}

/** Require every consumed port return to stay on one stream and preserve observed durable lineage. */
function acceptAuthorityPortState(
  stream: AuthorityPortStreamObservation,
  state: InventoryAuthorityState,
  label: string,
): void {
  assertAuthorityPortStateEnvelope(state, label);
  if (state.namespaceId !== stream.namespaceId) {
    throw new Error(`InventoryOnce ${label} switched authority namespace.`);
  }
  if (state.revision < stream.revision) {
    throw new Error(`InventoryOnce ${label} rewound authority revision.`);
  }
  assertAuthorityPortRetainedLineage(stream.state, state, label);
  stream.revision = state.revision;
  stream.state = structuredClone(state);
}

/** Expected retained evidence for one exact cutover attempt or retry. */
interface ExpectedInventoryCutoverEvidence {
  /** Authorization identity required to own this exact cutover attempt. */
  readonly authorizationId: string;
  /** Fence token required to match retained writer-fence ownership. */
  readonly fenceToken: string;
  /** Certified adapter digest required by the retained authority record. */
  readonly certificationDigest: string;
  /** Source revision whose compiled snapshot is being activated. */
  readonly sourceRevision: number;
  /** Optional explicit cutover timestamp when the caller fixed one. */
  readonly cutoverAt?: string;
  /** Optional source snapshot root once compilation has completed. */
  readonly sourceRoot?: string;
  /** Optional source migration plan digest once compilation has completed. */
  readonly sourcePlanDigest?: string;
  /** Optional source catalog digest once compilation has completed. */
  readonly sourceCatalogDigest?: string;
  /** Optional target world root once target publication has completed. */
  readonly targetWorldRoot?: string;
  /** Optional target world revision once target publication has completed. */
  readonly targetWorldRevision?: number;
}

/** Require one retained authority identity/digest to already be normalized. */
function requireRetainedCutoverText(value: string, label: string): void {
  if (requireCutoverText(value, label) !== value) {
    throw new Error(`InventoryOnce retained ${label} is not canonical.`);
  }
}

/** Return exact evidence for an idempotent already-authoritative state. */
export function inventoryAuthorityCutoverResult(
  state: InventoryAuthorityState,
): CutoverInventoryAuthorityResult {
  assertAuthorityPortStateEnvelope(state, "retained legacy cutover");
  if (
    state.mode !== InventoryAuthorityMode.Authoritative ||
    state.activationKind !== InventoryAuthorityActivationKind.LegacyCutover ||
    state.cutoverAuthorizationId.length === 0 ||
    state.greenfieldAuthorizationId.length !== 0 ||
    state.activeLegacyWriters.length !== 0 ||
    state.fenceToken.length === 0 ||
    state.fenceStartedAt.length === 0 ||
    state.adapterCertificationDigest.length === 0 ||
    state.adapterCertifiedAt.length === 0 ||
    state.sourceRoot.length === 0 ||
    !Number.isSafeInteger(state.sourceRevision) ||
    state.sourceRevision < 0 ||
    state.sourcePlanDigest.length === 0 ||
    state.sourceCatalogDigest.length === 0 ||
    state.dualRunStartedAt.length === 0 ||
    state.dualRunMismatchEvidence.length !== 0 ||
    state.targetWorldRoot.length === 0 ||
    !Number.isSafeInteger(state.targetWorldRevision) ||
    state.targetWorldRevision < 0 ||
    state.activatedAt.length === 0
  ) {
    throw new Error(
      "InventoryOnce authoritative state is missing valid cutover evidence.",
    );
  }
  for (const [value, label] of [
    [state.cutoverAuthorizationId, "cutover authorizationId"],
    [state.fenceToken, "fenceToken"],
    [state.adapterCertificationDigest, "adapterCertificationDigest"],
    [state.sourceRoot, "sourceRoot"],
    [state.sourcePlanDigest, "sourcePlanDigest"],
    [state.sourceCatalogDigest, "sourceCatalogDigest"],
    [state.targetWorldRoot, "targetWorldRoot"],
  ] as const) {
    requireRetainedCutoverText(value, label);
  }
  for (const [value, label] of [
    [state.fenceStartedAt, "fence startedAt"],
    [state.adapterCertifiedAt, "adapter certifiedAt"],
    [state.dualRunStartedAt, "dual-run startedAt"],
    [state.activatedAt, "activatedAt"],
  ] as const) {
    requireRetainedCutoverText(value, label);
    requireCanonicalCutoverTime(value, label);
  }
  return {
    authority: state,
    authorizationId: state.cutoverAuthorizationId,
    sourcePlanDigest: state.sourcePlanDigest,
    sourceCatalogDigest: state.sourceCatalogDigest,
    targetWorldRoot: state.targetWorldRoot,
    targetWorldRevision: state.targetWorldRevision,
  };
}

/** Require one returned authoritative result to belong to this exact cutover request. */
function assertInventoryCutoverResultMatches(
  result: CutoverInventoryAuthorityResult,
  expected: ExpectedInventoryCutoverEvidence,
): void {
  const state = result.authority;
  if (
    result.authorizationId !== expected.authorizationId ||
    state.fenceToken !== expected.fenceToken ||
    state.adapterCertificationDigest !== expected.certificationDigest ||
    state.sourceRevision !== expected.sourceRevision ||
    (expected.cutoverAt !== undefined &&
      state.dualRunStartedAt !== expected.cutoverAt) ||
    (expected.sourceRoot !== undefined &&
      state.sourceRoot !== expected.sourceRoot) ||
    (expected.sourcePlanDigest !== undefined &&
      result.sourcePlanDigest !== expected.sourcePlanDigest) ||
    (expected.sourceCatalogDigest !== undefined &&
      result.sourceCatalogDigest !== expected.sourceCatalogDigest) ||
    (expected.targetWorldRoot !== undefined &&
      result.targetWorldRoot !== expected.targetWorldRoot) ||
    (expected.targetWorldRevision !== undefined &&
      result.targetWorldRevision !== expected.targetWorldRevision)
  ) {
    throw new Error(
      "InventoryOnce authoritative cutover evidence differs from this request.",
    );
  }
}

/** Require the arbitrary authority port to return the exact fence it was asked to claim. */
function assertInventoryFenceEvidenceMatches(
  state: InventoryAuthorityState,
  expected: Omit<
    ExpectedInventoryCutoverEvidence,
    "targetWorldRoot" | "targetWorldRevision"
  >,
): void {
  if (
    state.mode !== InventoryAuthorityMode.Fencing ||
    state.activationKind !== InventoryAuthorityActivationKind.None ||
    state.cutoverAuthorizationId !== expected.authorizationId ||
    state.greenfieldAuthorizationId.length !== 0 ||
    state.adapterCertificationDigest !== expected.certificationDigest ||
    state.activeLegacyWriters.length !== 0 ||
    state.dualRunMismatchEvidence.length !== 0 ||
    state.fenceToken !== expected.fenceToken ||
    state.fenceStartedAt.length === 0 ||
    state.sourceRoot !== expected.sourceRoot ||
    state.sourceRevision !== expected.sourceRevision ||
    state.sourcePlanDigest !== expected.sourcePlanDigest ||
    state.sourceCatalogDigest !== expected.sourceCatalogDigest ||
    state.dualRunStartedAt !== expected.cutoverAt ||
    state.targetWorldRoot.length !== 0 ||
    state.targetWorldRevision !== 0
  ) {
    throw new Error(
      "InventoryOnce authority port returned fence evidence that differs from this cutover.",
    );
  }
  for (const [value, label] of [
    [state.cutoverAuthorizationId, "cutover authorizationId"],
    [state.fenceToken, "fenceToken"],
    [state.adapterCertificationDigest, "adapterCertificationDigest"],
    [state.sourceRoot, "sourceRoot"],
    [state.sourcePlanDigest, "sourcePlanDigest"],
    [state.sourceCatalogDigest, "sourceCatalogDigest"],
  ] as const) {
    requireRetainedCutoverText(value, label);
  }
  for (const [value, label] of [
    [state.fenceStartedAt, "fence startedAt"],
    [state.adapterCertifiedAt, "adapter certifiedAt"],
    [state.dualRunStartedAt, "dual-run startedAt"],
  ] as const) {
    requireRetainedCutoverText(value, label);
    requireCanonicalCutoverTime(value, label);
  }
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
      "InventoryOnce greenfield authority requires the exact canonical revision-zero empty world.",
    );
  }
  return actual.world;
}

/** Return validated retained greenfield activation evidence after ordinary restart. */
export function inventoryAuthorityGreenfieldResult(
  state: InventoryAuthorityState,
): BootstrapGreenfieldInventoryAuthorityResult {
  assertAuthorityPortStateEnvelope(state, "retained greenfield authority");
  const canonicalEmptyRoot = inventoryWorldContentRoots(
    emptyInventoryWorldState(),
  ).world;
  if (
    state.mode !== InventoryAuthorityMode.Authoritative ||
    state.activationKind !== InventoryAuthorityActivationKind.Greenfield ||
    state.cutoverAuthorizationId.length !== 0 ||
    state.greenfieldAuthorizationId.length === 0 ||
    state.activeLegacyWriters.length !== 0 ||
    state.adapterCertificationDigest.length === 0 ||
    state.adapterCertifiedAt.length === 0 ||
    state.targetWorldRoot !== canonicalEmptyRoot ||
    state.targetWorldRevision !== 0 ||
    state.sourceRoot.length !== 0 ||
    state.sourceRevision !== 0 ||
    state.sourcePlanDigest.length !== 0 ||
    state.sourceCatalogDigest.length !== 0 ||
    state.dualRunStartedAt.length !== 0 ||
    state.dualRunMismatchEvidence.length !== 0 ||
    state.fenceToken.length !== 0 ||
    state.fenceStartedAt.length !== 0 ||
    state.activatedAt.length === 0
  ) {
    throw new Error(
      "InventoryOnce authoritative state does not contain valid greenfield evidence.",
    );
  }
  requireRetainedCutoverText(
    state.greenfieldAuthorizationId,
    "greenfield authorizationId",
  );
  requireRetainedCutoverText(
    state.adapterCertificationDigest,
    "greenfield adapterCertificationDigest",
  );
  for (const [value, label] of [
    [state.adapterCertifiedAt, "greenfield adapter certifiedAt"],
    [state.activatedAt, "greenfield activatedAt"],
  ] as const) {
    requireRetainedCutoverText(value, label);
    requireCanonicalCutoverTime(value, label);
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
  certificationDigest: string,
  targetWorldRoot: string,
): void {
  if (
    result.authorizationId !== authorizationId ||
    result.authority.adapterCertificationDigest !== certificationDigest ||
    result.targetWorldRoot !== targetWorldRoot ||
    result.targetWorldRevision !== 0
  ) {
    throw new Error(
      "InventoryOnce authoritative state does not match this greenfield bootstrap.",
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
      `InventoryOnce cutover ${label} must be canonical UTC ISO time.`,
    );
  }
}

/** Require one non-negative safe integer source revision. */
function requireNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `InventoryOnce cutover ${label} must be a non-negative safe integer.`,
    );
  }
}
