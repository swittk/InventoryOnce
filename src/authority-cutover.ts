import {
  InventoryAuthorityActivationKind,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
  type InventoryAuthorityControlPort,
  type InventoryAuthorityState,
} from "./authority.js";
import { inventoryIntentFingerprint } from "./canonical.js";
import { inventorySha256 } from "./digest.js";
import type { InventoryClock } from "./coordinator.js";
import { inventoryWorldContentRoots } from "./integrity.js";
import { inventoryMigrationSourceDispositionFingerprint } from "./migration-evidence.js";
import type { InventoryMigrationSourcePlan } from "./migration-plugin.js";
import {
  createInventoryMigrationManifestBeginInput,
  inventoryMigrationPlanDigest,
} from "./migration-prepare.js";
import {
  InventoryMigrationPlanStatus,
  applyInventoryMigrationPlan,
  dryRunInventoryMigration,
} from "./migrations.js";
import {
  InventoryMigrationManifestState,
  type BeginInventoryMigrationManifestInput,
  type InventoryDurableStorage,
} from "./storage.js";
import { emptyInventoryWorldState, type InventoryWorldState } from "./world.js";

/** Inputs for one portable fail-closed legacy-to-InventoryOnce authority cutover. */
export interface CutoverInventoryAuthorityInput {
  /** Native executable authority state machine. */
  readonly authority: InventoryAuthorityControlPort;
  /** Durable inventory storage receiving the migration target world. */
  readonly storage: InventoryDurableStorage;
  /** A world-backed cutover has exactly one target. */
  readonly openingTarget?: never;
  /** Stable durable migration identity. */
  readonly migrationId: string;
  /** Stable fence/retry token for this cutover. */
  readonly fenceToken: string;
  /** Explicit operator/deployment authorization; exact retries must reuse it. */
  readonly authorizationId: string;
  /** Exact adapter-conformance certification accepted by this deployment. */
  readonly adapterCertificationDigest: string;
  /** Optional canonical source time; retries prefer retained DualRun time, then certification/fence evidence. */
  readonly cutoverAtEpochMs?: number;
  /** Monotonic application source revision bound into DualRun/fence evidence. */
  readonly sourceRevision?: number;
  /** Compile one complete application-specific legacy source at the supplied frozen time. */
  readonly compileSource: (
    cutoverAtEpochMs: number,
  ) => Promise<InventoryMigrationSourcePlan>;
  /** Wait until every admitted legacy writer has released after the fence wins. */
  readonly drainLegacyWriters: () => Promise<void>;
  /** Durable certification/activation clock. */
  readonly clock: InventoryClock;
}

/** Published opening facts that can be checked without reading the target world. */
export interface InventoryPublishedOpeningEvidence {
  /** Exact migration whose source was fenced. */
  readonly migrationId: string;
  /** SHA-256 over the compiled source plan digest. */
  readonly sourcePlanHash: string;
  /** Core's digest over the complete frozen native plan including its catalogue and recorded times. */
  readonly durablePlanDigest: string;
  /** Exact content root of the opened stock, catalogue and journal. */
  readonly targetWorldRoot: string;
  /** Single published target revision, starting from empty. */
  readonly revision: number;
}

/** Storage boundary for one indexed opening under the existing publication head. */
export interface InventoryIndexedOpeningTarget {
  /** Read proof from the already-published head. A claimed but incomplete opening has no visible proof. */
  readLegacyOpeningEvidence(migrationId: string): Promise<InventoryPublishedOpeningEvidence | undefined>;
  /** Atomically publish or join the exact frozen opening, and finish an interrupted exact retry. */
  publishLegacyOpening(input: BeginInventoryMigrationManifestInput): Promise<InventoryPublishedOpeningEvidence>;
}

/** Run the existing authority cutover with a target that never materializes its persisted world. */
export type CutoverIndexedInventoryAuthorityInput = Omit<CutoverInventoryAuthorityInput, "storage" | "openingTarget"> & {
  /** The sole target receiving and proving the opening publication. */
  readonly openingTarget: InventoryIndexedOpeningTarget;
  /** An indexed cutover cannot choose a separate world-backed target. */
  readonly storage?: never;
};

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
  /** A world-backed bootstrap uses one target. */
  readonly emptyTarget?: never;
  /** Exact adapter certification accepted by this deployment. */
  readonly adapterCertificationDigest: string;
  /** Explicit operator/deployment authorization for greenfield authority. */
  readonly authorizationId: string;
  /** Durable certification/activation clock. */
  readonly clock: InventoryClock;
}

/** Indexed storage can prove its initial head without building an inventory world. */
export interface InventoryUnclaimedGreenfieldTarget {
  /** True only at the original, unclaimed head. A staged publication or nonzero revision is not empty. */
  isUnclaimedGreenfieldTarget(): Promise<boolean>;
}

/** Bootstrap the same authority from an indexed head whose original stock namespace is vacant. */
export type BootstrapIndexedGreenfieldInventoryAuthorityInput = Omit<
  BootstrapGreenfieldInventoryAuthorityInput, "storage" | "emptyTarget"
> & {
  /** The indexed store that owns this namespace. */
  readonly emptyTarget: InventoryUnclaimedGreenfieldTarget;
  /** An indexed bootstrap cannot select another physical target. */
  readonly storage?: never;
};

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
  /** Read and verify only the selected target's completed opening. */
  readonly readCompletedTarget: ReadCompletedInventoryCutoverTarget;
  /** Exact migration identity requested by this outer cutover. */
  readonly migrationId: string;
  /** Exact fence identity requested by this outer cutover. */
  readonly fenceToken: string;
  /** Exact deployment authorization requested by this outer cutover. */
  readonly authorizationId: string;
  /** Exact adapter certification requested by this outer cutover. */
  readonly certificationDigest: string;
  /** Optional caller-fixed cutover time. */
  readonly explicitCutoverAtEpochMs: number | undefined;
  /** Exact source revision requested by this outer cutover. */
  readonly sourceRevision: number;
  /** Application source compiler used to independently revalidate completion. */
  readonly compileSource: CutoverInventoryAuthorityInput["compileSource"];
}

/** Durable target evidence retained by a completed migration manifest. */
interface CompletedInventoryCutoverTargetEvidence {
  /** Exact content root of the migration world that became visible. */
  readonly targetWorldRoot: string;
  /** Exact revision of the migration world that became visible. */
  readonly targetWorldRevision: number;
}

/** Check the completed target against the independently compiled source and retained fence time. */
type ReadCompletedInventoryCutoverTarget = (
  compiled: InventoryMigrationSourcePlan,
  authority: InventoryAuthorityState,
) => Promise<CompletedInventoryCutoverTargetEvidence>;

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
    input.explicitCutoverAtEpochMs !== undefined &&
    authority.dualRunStartedAtEpochMs !== input.explicitCutoverAtEpochMs
  ) {
    throw new Error(
      "InventoryOnce authoritative cutover time differs from this retry.",
    );
  }
  const cutoverAtEpochMs = resolveInventoryCutoverAtEpochMs(
    input.explicitCutoverAtEpochMs,
    authority,
  );
  const compiled = await input.compileSource(cutoverAtEpochMs);
  assertInventoryMigrationReady(compiled);
  assertInventoryCutoverSourceMatchesRequest(
    compiled,
    input.migrationId,
    cutoverAtEpochMs,
  );
  const sourceRoot = inventoryMigrationSourceRoot(compiled);
  assertInventoryDualRunSource(
    authority,
    compiled,
    sourceRoot,
    input.sourceRevision,
    cutoverAtEpochMs,
  );
  const durableTarget = await input.readCompletedTarget(compiled, authority);
  const retained = inventoryAuthorityCutoverResult(authority);
  assertInventoryCutoverResultMatches(retained, {
    authorizationId: input.authorizationId,
    fenceToken: input.fenceToken,
    certificationDigest: input.certificationDigest,
    sourceRevision: input.sourceRevision,
    cutoverAtEpochMs,
    sourceRoot,
    sourcePlanDigest: compiled.plan.planDigest,
    sourceCatalogDigest: compiled.catalog.digest,
    targetWorldRoot: durableTarget.targetWorldRoot,
    targetWorldRevision: durableTarget.targetWorldRevision,
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
export async function bootstrapGreenfieldInventoryAuthority(
  input: BootstrapGreenfieldInventoryAuthorityInput | BootstrapIndexedGreenfieldInventoryAuthorityInput,
): Promise<BootstrapGreenfieldInventoryAuthorityResult> {
  const {
    authority: authorityControl,
    storage,
    emptyTarget,
    adapterCertificationDigest: rawCertificationDigest,
    authorizationId: rawAuthorizationId,
    clock,
  } = input;
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
      certifiedAtEpochMs: clock.nowEpochMs(),
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
  // An indexed namespace can prove revision-zero vacancy from its only publication head.
  let targetWorldRoot: string;
  if (emptyTarget === undefined) {
    targetWorldRoot = assertExactEmptyGreenfieldTarget(await storage.readWorld());
  } else {
    if (!await emptyTarget.isUnclaimedGreenfieldTarget()) {
      throw new Error("InventoryOnce greenfield authority requires an unclaimed empty indexed head.");
    }
    targetWorldRoot = inventoryWorldContentRoots(emptyInventoryWorldState()).world;
  }
  const activated = await authorityControl.activateGreenfield({
    authorizationId,
    certificationDigest,
    targetWorldRoot,
    targetWorldRevision: 0,
    activatedAtEpochMs: clock.nowEpochMs(),
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
export async function cutoverInventoryAuthority(
  input: CutoverInventoryAuthorityInput | CutoverIndexedInventoryAuthorityInput,
): Promise<CutoverInventoryAuthorityResult> {
  const {
    authority: authorityControl,
    storage,
    openingTarget,
    migrationId: rawMigrationId,
    fenceToken: rawFenceToken,
    authorizationId: rawAuthorizationId,
    adapterCertificationDigest: rawCertificationDigest,
    cutoverAtEpochMs: explicitCutoverAtEpochMs,
    sourceRevision = 0,
    compileSource,
    drainLegacyWriters,
    clock,
  } = input;
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
  /** The selected adapter proves the opening independently of the authority row. */
  const readCompletedTarget: ReadCompletedInventoryCutoverTarget = async (compiled, observed) => {
    if (openingTarget !== undefined) {
      // Authority already binds the exact target root and activation time. Compare the
      // independent published proof against that retained root without replaying the opening.
      assertInventoryMigrationPlanDigest(compiled.plan);
      const proof = await readIndexedInventoryOpeningProof(openingTarget, compiled.plan);
      return { targetWorldRoot: proof.targetWorldRoot, targetWorldRevision: proof.revision };
    }
    const dryRun = dryRunInventoryMigration({
      catalog: compiled.catalog, plan: compiled.plan, targetWorld: emptyInventoryWorldState(),
    });
    return assertCompletedInventoryCutoverManifest(
      await storage.readMigrationManifest(migrationId), compiled, dryRun, migrationId,
    );
  };
  const resolveConcurrentCompletion = /** Replay an already-completed concurrent cutover only when it matches this exact attempt. */ (
    observed: InventoryAuthorityState,
  ): Promise<CutoverInventoryAuthorityResult | undefined> =>
    completedInventoryCutoverResult({
      authority: observed,
      readCompletedTarget,
      migrationId,
      fenceToken,
      authorizationId,
      certificationDigest,
      explicitCutoverAtEpochMs,
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
      certifiedAtEpochMs: clock.nowEpochMs(),
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
  const cutoverAtEpochMs = resolveInventoryCutoverAtEpochMs(explicitCutoverAtEpochMs, authority);
  const first = await compileSource(cutoverAtEpochMs);
  assertInventoryMigrationReady(first);
  assertInventoryCutoverSourceMatchesRequest(first, migrationId, cutoverAtEpochMs);
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
      startedAtEpochMs: cutoverAtEpochMs,
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
      cutoverAtEpochMs,
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
    startedAtEpochMs: clock.nowEpochMs(),
    sourceRoot,
    sourceRevision,
  });
  acceptAuthorityPortState(authorityStream, fenced, "fence claim");
  if (fenced.mode === InventoryAuthorityMode.Authoritative) {
    const durableTarget = await readCompletedTarget(first, fenced);
    const retained = inventoryAuthorityCutoverResult(fenced);
    assertInventoryCutoverResultMatches(retained, {
      authorizationId,
      fenceToken,
      certificationDigest,
      sourceRevision,
      cutoverAtEpochMs,
      sourceRoot,
      sourcePlanDigest: first.plan.planDigest,
      sourceCatalogDigest: first.catalog.digest,
      targetWorldRoot: durableTarget.targetWorldRoot,
      targetWorldRevision: durableTarget.targetWorldRevision,
    });
    return retained;
  }
  assertInventoryFenceEvidenceMatches(fenced, {
    authorizationId,
    fenceToken,
    certificationDigest,
    sourceRevision,
    cutoverAtEpochMs,
    sourceRoot,
    sourcePlanDigest: first.plan.planDigest,
    sourceCatalogDigest: first.catalog.digest,
  });
  // The world-backed adapter can retain an explicitly aborted manifest. Indexed claims always finish.
  const manifest = storage === undefined ? undefined : await storage.readMigrationManifest(migrationId);
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
  const second = await compileSource(cutoverAtEpochMs);
  assertInventoryMigrationReady(second);
  assertInventoryCutoverSourceMatchesRequest(second, migrationId, cutoverAtEpochMs);
  assertSameInventoryMigrationSource(first, second);
  const target = openingTarget === undefined
    ? await publishWorldBackedInventoryOpening(storage, manifest, second, clock)
    : await publishIndexedInventoryOpening(openingTarget, second, fenced);
  const { targetWorldRoot, targetWorldRevision } = target;
  const activated = await authorityControl.activate({
    fenceToken,
    sourcePlanDigest: second.plan.planDigest,
    sourceCatalogDigest: second.catalog.digest,
    sourceRoot,
    targetWorldRoot,
    targetWorldRevision,
    activatedAtEpochMs: clock.nowEpochMs(),
  });
  const result = inventoryAuthorityCutoverResult(activated);
  assertInventoryCutoverResultMatches(result, {
    authorizationId,
    fenceToken,
    certificationDigest,
    sourceRevision,
    cutoverAtEpochMs,
    sourceRoot,
    sourcePlanDigest: second.plan.planDigest,
    sourceCatalogDigest: second.catalog.digest,
    targetWorldRoot,
    targetWorldRevision,
  });
  acceptAuthorityPortState(authorityStream, activated, "legacy activation");
  return result;
}

/** Publish the reviewed opening through the existing world-backed migration adapter. */
async function publishWorldBackedInventoryOpening(
  storage: InventoryDurableStorage,
  manifest: Awaited<ReturnType<InventoryDurableStorage["readMigrationManifest"]>>,
  compiled: InventoryMigrationSourcePlan,
  clock: InventoryClock,
): Promise<CompletedInventoryCutoverTargetEvidence> {
  const targetBefore = await storage.readWorld();
  if (manifest === undefined) assertEmptyInventoryAuthorityTarget(targetBefore);
  const dryRun = dryRunInventoryMigration({
    catalog: compiled.catalog,
    plan: compiled.plan,
    targetWorld: manifest === undefined ? targetBefore : emptyInventoryWorldState(),
  });
  const target = await applyInventoryMigrationPlan({ ...compiled, storage, dryRun, clock });
  return { targetWorldRoot: inventoryWorldContentRoots(target).world, targetWorldRevision: target.revision };
}

/** Rebuild the exact opening accepted by this fence, including one record time across processes. */
function freezeIndexedInventoryOpening(
  compiled: InventoryMigrationSourcePlan,
  authority: InventoryAuthorityState,
): BeginInventoryMigrationManifestInput {
  assertInventoryMigrationPlanDigest(compiled.plan);
  const recordedAtEpochMs = authority.fenceStartedAtEpochMs;
  requireCutoverEpochMilliseconds(recordedAtEpochMs, "indexed opening fence time");
  return createInventoryMigrationManifestBeginInput(
    compiled.catalog, emptyInventoryWorldState(), compiled.plan, recordedAtEpochMs,
  );
}

/** Read proof from the published head before allowing activation to cross the writer fence. */
async function publishIndexedInventoryOpening(
  target: InventoryIndexedOpeningTarget,
  compiled: InventoryMigrationSourcePlan,
  authority: InventoryAuthorityState,
): Promise<CompletedInventoryCutoverTargetEvidence> {
  const frozen = freezeIndexedInventoryOpening(compiled, authority);
  await target.publishLegacyOpening(frozen);
  const proof = await readIndexedInventoryOpeningProof(target, compiled.plan);
  // Before activation, the new opening must still match every frozen field, including its durable event times.
  if (
    proof.durablePlanDigest !== frozen.plan.durablePlanDigest ||
    proof.targetWorldRoot !== frozen.plan.nextRoots.world
  ) {
    throw new Error("InventoryOnce cutover has no matching published indexed opening.");
  }
  return { targetWorldRoot: proof.targetWorldRoot, targetWorldRevision: proof.revision };
}

/** Read one indexed opening proof for the exact current source plan. */
async function readIndexedInventoryOpeningProof(
  target: InventoryIndexedOpeningTarget,
  plan: InventoryMigrationSourcePlan["plan"],
): Promise<InventoryPublishedOpeningEvidence> {
  const proof = await target.readLegacyOpeningEvidence(plan.migrationId);
  if (
    proof === undefined ||
    proof.migrationId !== plan.migrationId ||
    proof.sourcePlanHash !== inventorySha256(plan.planDigest) ||
    proof.revision !== 1
  ) {
    throw new Error("InventoryOnce cutover has no matching published indexed opening.");
  }
  return proof;
}

/** Verify that the reviewed source commitment covers the compiled contents. */
function assertInventoryMigrationPlanDigest(plan: InventoryMigrationSourcePlan["plan"]): void {
  if (inventoryMigrationPlanDigest(plan) !== plan.planDigest) {
    throw new Error("Inventory migration plan changed after compilation.");
  }
}

/** Reuse one durable timestamp across retries and concurrent process contenders. */
function resolveInventoryCutoverAtEpochMs(
  explicit: number | undefined,
  authority: InventoryAuthorityState,
): number {
  if (explicit !== undefined) {
    requireCutoverEpochMilliseconds(explicit, "cutoverAtEpochMs");
    return explicit;
  }
  const retained =
    authority.dualRunStartedAtEpochMs ??
    authority.adapterCertifiedAtEpochMs ??
    authority.fenceStartedAtEpochMs;
  requireCutoverEpochMilliseconds(retained, "retained cutoverAtEpochMs");
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
  cutoverAtEpochMs: number,
): void {
  if (
    authority.sourceRoot !== sourceRoot ||
    authority.sourceRevision !== sourceRevision ||
    authority.sourcePlanDigest !== compiled.plan.planDigest ||
    authority.sourceCatalogDigest !== compiled.catalog.digest ||
    authority.dualRunStartedAtEpochMs !== cutoverAtEpochMs
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
  cutoverAtEpochMs: number,
): void {
  if (
    compiled.plan.migrationId !== migrationId ||
    compiled.plan.cutoverAtEpochMs !== cutoverAtEpochMs
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
): CompletedInventoryCutoverTargetEvidence {
  if (
    manifest === undefined ||
    manifest.state !== InventoryMigrationManifestState.Completed ||
    manifest.migrationId !== migrationId ||
    manifest.planDigest !== compiled.plan.planDigest ||
    manifest.baseRevision !== dryRun.baseRevision ||
    manifest.baseWorldRoot !== dryRun.baseWorldRoot ||
    inventoryIntentFingerprint(
      manifest.sourceDispositions.map(
        inventoryMigrationSourceDispositionFingerprint,
      ),
    ) !==
      inventoryIntentFingerprint(
        compiled.plan.sourceDispositions.map(
          inventoryMigrationSourceDispositionFingerprint,
        ),
      ) ||
    !manifest.worldWritten ||
    !manifest.worldPublished ||
    typeof manifest.targetWorldRoot !== "string" ||
    manifest.targetWorldRoot.length === 0 ||
    manifest.targetWorldRoot.trim() !== manifest.targetWorldRoot ||
    !Number.isSafeInteger(manifest.targetWorldRevision) ||
    manifest.targetWorldRevision !== manifest.baseRevision + 1 ||
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
  return {
    targetWorldRoot: manifest.targetWorldRoot,
    targetWorldRevision: manifest.targetWorldRevision,
  };
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
      next.adapterCertifiedAtEpochMs !== previous.adapterCertifiedAtEpochMs)
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
      next.dualRunStartedAtEpochMs !== previous.dualRunStartedAtEpochMs
    ) {
      throw new Error(`InventoryOnce ${label} rewrote retained source evidence.`);
    }
  }
  if (previous.fenceToken.length !== 0) {
    if (
      next.fenceToken !== previous.fenceToken ||
      next.fenceStartedAtEpochMs !== previous.fenceStartedAtEpochMs
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
          candidate.recordedAtEpochMs === earlier.recordedAtEpochMs,
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
      next.activatedAtEpochMs !== previous.activatedAtEpochMs
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
  readonly cutoverAtEpochMs?: number;
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
    state.fenceStartedAtEpochMs === null ||
    state.adapterCertificationDigest.length === 0 ||
    state.adapterCertifiedAtEpochMs === null ||
    state.sourceRoot.length === 0 ||
    !Number.isSafeInteger(state.sourceRevision) ||
    state.sourceRevision < 0 ||
    state.sourcePlanDigest.length === 0 ||
    state.sourceCatalogDigest.length === 0 ||
    state.dualRunStartedAtEpochMs === null ||
    state.dualRunMismatchEvidence.length !== 0 ||
    state.targetWorldRoot.length === 0 ||
    !Number.isSafeInteger(state.targetWorldRevision) ||
    state.targetWorldRevision < 0 ||
    state.activatedAtEpochMs === null
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
    [state.fenceStartedAtEpochMs, "fence startedAtEpochMs"],
    [state.adapterCertifiedAtEpochMs, "adapter certifiedAtEpochMs"],
    [state.dualRunStartedAtEpochMs, "dual-run startedAtEpochMs"],
    [state.activatedAtEpochMs, "activatedAtEpochMs"],
  ] as const) {
    requireCutoverEpochMilliseconds(value, label);
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
    (expected.cutoverAtEpochMs !== undefined &&
      state.dualRunStartedAtEpochMs !== expected.cutoverAtEpochMs) ||
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
    state.fenceStartedAtEpochMs === null ||
    state.sourceRoot !== expected.sourceRoot ||
    state.sourceRevision !== expected.sourceRevision ||
    state.sourcePlanDigest !== expected.sourcePlanDigest ||
    state.sourceCatalogDigest !== expected.sourceCatalogDigest ||
    state.dualRunStartedAtEpochMs !== expected.cutoverAtEpochMs ||
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
    [state.fenceStartedAtEpochMs, "fence startedAtEpochMs"],
    [state.adapterCertifiedAtEpochMs, "adapter certifiedAtEpochMs"],
    [state.dualRunStartedAtEpochMs, "dual-run startedAtEpochMs"],
  ] as const) {
    requireCutoverEpochMilliseconds(value, label);
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
    state.adapterCertifiedAtEpochMs === null ||
    state.targetWorldRoot !== canonicalEmptyRoot ||
    state.targetWorldRevision !== 0 ||
    state.sourceRoot.length !== 0 ||
    state.sourceRevision !== 0 ||
    state.sourcePlanDigest.length !== 0 ||
    state.sourceCatalogDigest.length !== 0 ||
    state.dualRunStartedAtEpochMs !== null ||
    state.dualRunMismatchEvidence.length !== 0 ||
    state.fenceToken.length !== 0 ||
    state.fenceStartedAtEpochMs !== null ||
    state.activatedAtEpochMs === null
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
    [state.adapterCertifiedAtEpochMs, "greenfield adapter certifiedAtEpochMs"],
    [state.activatedAtEpochMs, "greenfield activatedAtEpochMs"],
  ] as const) {
    requireCutoverEpochMilliseconds(value, label);
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

/** Require one present numeric cutover instant; zero is valid, null is absent. */
function requireCutoverEpochMilliseconds(value: number | null, label: string): asserts value is number {
  if (value === null || !Number.isSafeInteger(value)) {
    throw new Error(`InventoryOnce cutover ${label} must be safe-integer epoch milliseconds.`);
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
