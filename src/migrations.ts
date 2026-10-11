import type { InventoryAmount } from "./amounts.js";
import {
  assertInventoryCatalogRetainsSnapshot,
  inventoryCatalogSnapshot,
  type InventoryCatalog,
} from "./catalog.js";
import {
  inventoryIntentFingerprint,
  inventoryMetadataFingerprint,
  type InventoryIntentFingerprintValue,
} from "./canonical.js";
import { compareInventoryIdentityText } from "./ordering.js";
import { type InventoryClock } from "./coordinator.js";
import {
  inventoryDurableMigrationPlanDigest,
  inventoryWorldContentRoots,
} from "./integrity.js";
import {
  createInventoryIssueEvent,
  createInventoryOpeningEvent,
  createInventoryTraceabilityEvent,
  type InventoryPlacementNodeMetadataInput,
  type InventoryLotMetadataInput,
} from "./commands.js";
import {
  assertInventoryEpochMilliseconds,
  commitInventoryEvent,
  inventoryEventIntentFingerprint,
  type InventoryCommittedEvent,
  type InventoryEventDraft,
  type InventoryTraceabilityRelationChange,
} from "./events.js";
import {
  inventoryMeasurementsEqual,
  type InventoryMeasurementVector,
} from "./measurements.js";
import {
  InventoryMigrationSourceDispositionKind,
  inventoryMigrationSourceDispositionFingerprint,
  type InventoryMigrationSourceDisposition,
  type InventoryMigrationSourceReference,
} from "./migration-evidence.js";
export {
  InventoryMigrationSourceDispositionKind,
  type InventoryMigrationSourceDisposition,
  type InventoryMigrationSourceReference,
} from "./migration-evidence.js";
import {
  inventoryStockPositionIdentity,
  type InventoryMetadata,
  type InventoryStockPositionInput,
  type InventoryStockPositionKey,
} from "./model.js";
import {
  InventoryDeficitPolicy,
  applyInventoryCommittedEvent,
} from "./projection.js";
import {
  InventoryMigrationManifestState,
  type InventoryDurableMigrationPlan,
  type InventoryDurableStorage,
  type InventoryMigrationManifest,
} from "./storage.js";
import { emptyInventoryWorldState, type InventoryWorldState } from "./world.js";

/** Whether one migration diagnostic is informational, suspicious, or blocking. */
export enum InventoryMigrationDiagnosticSeverity {
  /** Non-problem information useful during review. */
  Info = "info",
  /** Suspicious but explicitly non-blocking legacy condition. */
  Warning = "warning",
  /** Problem that blocks dry-run/application. */
  Error = "error",
}

/** Stable generic diagnostic categories emitted by the migration compiler. */
export enum InventoryMigrationDiagnosticCode {
  /** Legacy data has more than one plausible meaning and needs explicit classification. */
  AmbiguousLegacyMeaning = "ambiguous-legacy-meaning",
  /** Two source facts reuse an identity that must be unique. */
  DuplicateIdentity = "duplicate-identity",
  /** One translated fact violates current InventoryOnce invariants. */
  InvalidTranslatedFact = "invalid-translated-fact",
  /** One translated fact references missing catalogue/graph identity. */
  UnresolvedReference = "unresolved-reference",
  /** Individually valid rows conflict when replayed together in declared order. */
  JointSemanticConflict = "joint-semantic-conflict",
}

/** One operator/developer-visible migration planning result. */
export interface InventoryMigrationDiagnostic {
  /** Whether this diagnostic blocks application. */
  readonly severity: InventoryMigrationDiagnosticSeverity;
  /** Stable machine-readable category. */
  readonly code: InventoryMigrationDiagnosticCode | string;
  /** Plain explanation. */
  readonly message: string;
  /** Exact legacy fact responsible when known. */
  readonly source?: InventoryMigrationSourceReference;
  /** Optional explicit action needed to resolve the problem. */
  readonly resolution?: string;
}

/** One canonical opening fact reconstructed from legacy stock. */
export interface InventoryMigrationOpeningStock {
  /** Stable identity inside this migration and its idempotency key. */
  readonly openingId: string;
  /** Exact position before InventoryOnce injects item revision. */
  readonly position: InventoryStockPositionInput;
  /** Direct measurements or exact package count already present. */
  readonly amount: InventoryAmount;
  /** Optional exact retained item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Optional lot metadata for `position.lotId`, reconstructed from the same legacy fact. */
  readonly lot?: InventoryLotMetadataInput;
  /** Optional metadata for `position.placementNodeId`, reconstructed from the same source fact. */
  readonly placementNode?: InventoryPlacementNodeMetadataInput;
  /** Real-world time represented by this opening; defaults to migration cutover time. */
  readonly occurredAtEpochMs?: number;
  /** Required provenance back to the legacy row. */
  readonly source: InventoryMigrationSourceReference;
  /** Extra JSON-safe source/application facts. */
  readonly metadata?: InventoryMetadata;
}

/** One explicit signed deficit reconstructed from coherent legacy negative stock. */
export interface InventoryMigrationDeficitStock {
  /** Stable identity inside this migration and its idempotency key. */
  readonly deficitId: string;
  /** Exact unallocated signed position whose Issue records the deficit. */
  readonly position: InventoryStockPositionInput;
  /** Positive exact magnitude issued from the empty migration target. */
  readonly amount: InventoryAmount;
  /** Optional exact retained item revision; defaults to active/package revision. */
  readonly itemRevisionId?: string;
  /** Real-world time represented by this deficit; defaults to migration cutover time. */
  readonly occurredAtEpochMs?: number;
  /** Required provenance back to the legacy row. */
  readonly source: InventoryMigrationSourceReference;
  /** Extra JSON-safe source/application facts. */
  readonly metadata?: InventoryMetadata;
}

/** One traceability relationship change reconstructed from legacy data. */
export interface InventoryMigrationTraceabilityChange {
  /** Stable identity inside this migration and its idempotency key. */
  readonly changeId: string;
  /** Explicit association/genealogy change. */
  readonly change: InventoryTraceabilityRelationChange;
  /** Real-world occurrence time; defaults to migration cutover time. */
  readonly occurredAtEpochMs?: number;
  /** Required provenance back to the legacy row. */
  readonly source: InventoryMigrationSourceReference;
  /** Extra JSON-safe source/application facts. */
  readonly metadata?: InventoryMetadata;
}

/** Side-effect-free translated declaration produced by one legacy plugin. */
export interface InventoryMigrationDeclaration {
  /** Stable migration/import identity. */
  readonly migrationId: string;
  /** Plain legacy source-system identity. */
  readonly sourceSystem: string;
  /** Optional legacy schema/application version. */
  readonly sourceVersion?: string;
  /** Canonical time represented by the opening snapshot. */
  readonly cutoverAtEpochMs: number;
  /** Canonical positive opening stock facts. */
  readonly openingStock: readonly InventoryMigrationOpeningStock[];
  /** Explicit coherent signed deficits, replayed as ordinary Issue events under Record mode. */
  readonly deficitStock?: readonly InventoryMigrationDeficitStock[];
  /** Optional current traceability relationships reconstructed from legacy rows. */
  readonly traceabilityChanges?: readonly InventoryMigrationTraceabilityChange[];
  /** Non-physical legacy workflow rows retained as immutable do-not-replay audit evidence. */
  readonly sourceDispositions?: readonly InventoryMigrationSourceDisposition[];
  /** Explicit plugin diagnostics, including ambiguous rows. */
  readonly diagnostics?: readonly InventoryMigrationDiagnostic[];
  /** Extra JSON-safe migration metadata. */
  readonly metadata?: InventoryMetadata;
}

/** Whether a compiled migration may be dry-run/applied. */
export enum InventoryMigrationPlanStatus {
  /** Every translated fact is unambiguous and valid. */
  Ready = "ready",
  /** At least one blocking diagnostic must be resolved. */
  Blocked = "blocked",
}

/** Validated deterministic migration plan containing only normal InventoryOnce event intents. */
export interface InventoryMigrationPlan {
  /** Stable migration identity. */
  readonly migrationId: string;
  /** Legacy source-system identity. */
  readonly sourceSystem: string;
  /** Optional legacy schema/application version. */
  readonly sourceVersion?: string;
  /** Snapshot/cutover time. */
  readonly cutoverAtEpochMs: number;
  /** Ready only when no error diagnostic exists. */
  readonly status: InventoryMigrationPlanStatus;
  /** Deterministically ordered opening/traceability event drafts. */
  readonly events: readonly InventoryEventDraft[];
  /** Deterministically ordered source rows that generate no event and can never resume. */
  readonly sourceDispositions: readonly InventoryMigrationSourceDisposition[];
  /** Frozen collision-free digest checked again before the first durable write. */
  readonly planDigest: string;
  /** Every plugin/compiler diagnostic. */
  readonly diagnostics: readonly InventoryMigrationDiagnostic[];
  /** Extra JSON-safe migration metadata. */
  readonly metadata?: InventoryMetadata;
}

/** One exact expected projected stock row used by migration equivalence tests. */
export interface InventoryMigrationExpectedPosition {
  /** Exact revision-qualified stock position. */
  readonly position: InventoryStockPositionKey;
  /** Exact primary plus independent measurements expected there. */
  readonly measurements: InventoryMeasurementVector;
}

/** Inputs for compiling one side-effect-free translated declaration. */
export interface DefineInventoryMigrationInput {
  /** Frozen catalogue used by all translated facts. */
  readonly catalog: InventoryCatalog;
  /** Plugin-produced declaration. */
  readonly declaration: InventoryMigrationDeclaration;
}

/** Build one explicit opening-snapshot supersession without guessing workflow outcome. */
export function inventoryMigrationSnapshotSupersededDisposition(input: {
  /** Stable identity inside this migration. */
  readonly dispositionId: string;
  /** Exact legacy workflow row. */
  readonly source: InventoryMigrationSourceReference;
  /** Canonical opening-snapshot time. */
  readonly snapshotAtEpochMs: number;
  /** Plain reason current snapshot truth supersedes replay. */
  readonly reason: string;
  /** Optional bounded audit evidence. */
  readonly evidence?: InventoryMetadata;
}): InventoryMigrationSourceDisposition {
  return {
    dispositionId: input.dispositionId,
    kind: InventoryMigrationSourceDispositionKind.SnapshotSupersededDoNotReplay,
    source: input.source,
    snapshotAtEpochMs: input.snapshotAtEpochMs,
    reason: input.reason,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
  };
}

/** Explicitly block migration rather than guessing one ambiguous legacy meaning. */
export function inventoryMigrationProblem(
  message: string,
  source?: InventoryMigrationSourceReference,
  resolution?: string
): InventoryMigrationDiagnostic {
  return {
    severity: InventoryMigrationDiagnosticSeverity.Error,
    code: InventoryMigrationDiagnosticCode.AmbiguousLegacyMeaning,
    message,
    ...(source === undefined ? {} : { source }),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

/** Compile translated legacy facts through normal event constructors without writing storage. */
export function defineInventoryMigration({
  catalog,
  declaration,
}: DefineInventoryMigrationInput): InventoryMigrationPlan {
  if (declaration.migrationId.trim().length === 0) {
    throw new Error("Inventory migrationId must not be empty.");
  }
  if (declaration.sourceSystem.trim().length === 0) {
    throw new Error("Inventory migration sourceSystem must not be empty.");
  }
  assertInventoryEpochMilliseconds(
    declaration.cutoverAtEpochMs,
    "inventory migration cutoverAtEpochMs"
  );
  // Normal command builders validate canonical time; this explicit call improves top-level diagnostics.
  const diagnostics = [...(declaration.diagnostics ?? [])];
  const sourceDispositions = normalizeInventoryMigrationSourceDispositions(
    declaration.sourceDispositions ?? [],
    declaration.cutoverAtEpochMs,
    diagnostics
  );
  const events: InventoryEventDraft[] = [];
  /** Exact legacy row behind each compiled event for joint-replay diagnostics. */
  const sourceByOperationId = new Map<
    string,
    InventoryMigrationSourceReference
  >();
  const seenOpeningIds = new Set<string>();
  for (const opening of declaration.openingStock) {
    if (seenOpeningIds.has(opening.openingId)) {
      diagnostics.push(
        duplicateMigrationIdentity("opening", opening.openingId, opening.source)
      );
      continue;
    }
    seenOpeningIds.add(opening.openingId);
    try {
      const event = createInventoryOpeningEvent({
        catalog,
        operationId: migrationOperationId(
          declaration.migrationId,
          "opening",
          opening.openingId
        ),
        occurredAtEpochMs: opening.occurredAtEpochMs ?? declaration.cutoverAtEpochMs,
        to: opening.position,
        amount: opening.amount,
        sourceReference: inventoryIntentFingerprint([
          opening.source.sourceType,
          opening.source.sourceId,
        ]),
        metadata: {
          ...(opening.metadata ?? {}),
          // These keys come from the typed source row and cannot be replaced by caller metadata.
          migrationId: declaration.migrationId,
          migrationSource: migrationSourceMetadata(opening.source),
        },
        ...(opening.itemRevisionId === undefined
          ? {}
          : { itemRevisionId: opening.itemRevisionId }),
        ...(opening.lot === undefined ? {} : { lot: opening.lot }),
        ...(opening.placementNode === undefined
          ? {}
          : { placementNode: opening.placementNode }),
      });
      events.push(event);
      sourceByOperationId.set(event.operationId, opening.source);
    } catch (error) {
      diagnostics.push(
        invalidTranslatedFact(
          `Opening '${opening.openingId}' is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
          opening.source
        )
      );
    }
  }

  const seenDeficitIds = new Set<string>();
  for (const deficit of declaration.deficitStock ?? []) {
    if (seenDeficitIds.has(deficit.deficitId)) {
      diagnostics.push(
        duplicateMigrationIdentity("deficit", deficit.deficitId, deficit.source)
      );
      continue;
    }
    seenDeficitIds.add(deficit.deficitId);
    try {
      const event = createInventoryIssueEvent({
        catalog,
        operationId: migrationOperationId(
          declaration.migrationId,
          "deficit",
          deficit.deficitId
        ),
        occurredAtEpochMs: deficit.occurredAtEpochMs ?? declaration.cutoverAtEpochMs,
        from: deficit.position,
        amount: deficit.amount,
        sourceReference: inventoryIntentFingerprint([
          deficit.source.sourceType,
          deficit.source.sourceId,
        ]),
        metadata: {
          ...(deficit.metadata ?? {}),
          migrationId: declaration.migrationId,
          migrationSource: migrationSourceMetadata(deficit.source),
          inventoryRecordedDeficit: true,
        },
        ...(deficit.itemRevisionId === undefined
          ? {}
          : { itemRevisionId: deficit.itemRevisionId }),
      });
      events.push(event);
      sourceByOperationId.set(event.operationId, deficit.source);
    } catch (error) {
      diagnostics.push(
        invalidTranslatedFact(
          `Deficit '${deficit.deficitId}' is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
          deficit.source
        )
      );
    }
  }

  const seenChangeIds = new Set<string>();
  for (const translated of declaration.traceabilityChanges ?? []) {
    if (seenChangeIds.has(translated.changeId)) {
      diagnostics.push(
        duplicateMigrationIdentity(
          "traceability change",
          translated.changeId,
          translated.source
        )
      );
      continue;
    }
    seenChangeIds.add(translated.changeId);
    try {
      const event = createInventoryTraceabilityEvent({
        catalog,
        operationId: migrationOperationId(
          declaration.migrationId,
          "traceability",
          translated.changeId
        ),
        occurredAtEpochMs: translated.occurredAtEpochMs ?? declaration.cutoverAtEpochMs,
        changes: [translated.change],
        sourceReference: inventoryIntentFingerprint([
          translated.source.sourceType,
          translated.source.sourceId,
        ]),
        metadata: {
          ...(translated.metadata ?? {}),
          // These keys come from the typed source row and cannot be replaced by caller metadata.
          migrationId: declaration.migrationId,
          migrationSource: migrationSourceMetadata(translated.source),
        },
      });
      events.push(event);
      sourceByOperationId.set(event.operationId, translated.source);
    } catch (error) {
      diagnostics.push(
        invalidTranslatedFact(
          `Traceability change '${translated.changeId}' is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
          translated.source
        )
      );
    }
  }
  events.sort(compareMigrationEvent);
  if (!migrationDiagnosticsContainError(diagnostics)) {
    addJointMigrationReplayDiagnostic(
      catalog,
      events,
      declaration.cutoverAtEpochMs,
      sourceByOperationId,
      diagnostics
    );
  }
  diagnostics.sort(compareMigrationDiagnostic);
  const status = migrationDiagnosticsContainError(diagnostics)
    ? InventoryMigrationPlanStatus.Blocked
    : InventoryMigrationPlanStatus.Ready;
  const planWithoutDigest: Omit<InventoryMigrationPlan, "planDigest"> = {
    migrationId: declaration.migrationId,
    sourceSystem: declaration.sourceSystem,
    ...(declaration.sourceVersion === undefined
      ? {}
      : { sourceVersion: declaration.sourceVersion }),
    cutoverAtEpochMs: declaration.cutoverAtEpochMs,
    status,
    events,
    sourceDispositions,
    diagnostics,
    ...(declaration.metadata === undefined
      ? {}
      : { metadata: declaration.metadata }),
  };
  return {
    ...planWithoutDigest,
    planDigest: inventoryMigrationPlanDigest(planWithoutDigest),
  };
}

/** Inputs for replaying one migration against the exact target snapshot apply must fence. */
export interface DryRunInventoryMigrationInput {
  /** Frozen catalogue used by every translated event. */
  readonly catalog: InventoryCatalog;
  /** Compiled ready migration plan. */
  readonly plan: InventoryMigrationPlan;
  /** Exact published target snapshot reviewed before durable apply. */
  readonly targetWorld: InventoryWorldState;
}

/** Review result binding one plan to one exact target base and resulting world. */
export interface InventoryMigrationDryRun {
  /** Exact compiled plan digest reviewed. */
  readonly planDigest: string;
  /** Non-physical source rows retained by this exact reviewed plan. */
  readonly sourceDispositions: readonly InventoryMigrationSourceDisposition[];
  /** Target revision reviewed before the first migration event. */
  readonly baseRevision: number;
  /** Exact target content root reviewed before the first migration event. */
  readonly baseWorldRoot: string;
  /** Expected physical-stock and traceability result of replaying the reviewed migration intent. */
  readonly resultWorld: InventoryWorldState;
}

/** Replay one ready migration against one explicit target snapshot without writing storage. */
export function dryRunInventoryMigration({
  catalog,
  plan,
  targetWorld,
}: DryRunInventoryMigrationInput): InventoryMigrationDryRun {
  if (plan.status !== InventoryMigrationPlanStatus.Ready) {
    throw new Error("Blocked inventory migration cannot be dry-run/applied.");
  }
  assertInventoryCatalogRetainsSnapshot(catalog, targetWorld.catalog);
  const catalogSnapshot = inventoryCatalogSnapshot(catalog);
  /** Reviewed result starts at the same single publication cut used by durable apply. */
  let world: InventoryWorldState = {
    ...targetWorld,
    revision: targetWorld.revision + 1,
    catalog: catalogSnapshot,
  };
  for (const draft of plan.events) {
    const committed = commitInventoryEvent(
      draft,
      plan.cutoverAtEpochMs,
      world.projection.lastRecordSequence + 1
    );
    const projection = applyInventoryCommittedEvent({
      catalog,
      state: world.projection,
      event: committed,
      deficitPolicy: InventoryDeficitPolicy.Record,
    }).state;
    world = {
      revision: targetWorld.revision + 1,
      catalog: catalogSnapshot,
      projection,
      reservations: world.reservations,
      counts: world.counts,
    };
  }
  return {
    planDigest: plan.planDigest,
    sourceDispositions: structuredClone(plan.sourceDispositions),
    baseRevision: targetWorld.revision,
    baseWorldRoot: inventoryWorldContentRoots(targetWorld).world,
    resultWorld: world,
  };
}

/** Inputs for comparing an explicit-target dry-run to expected stock rows. */
export interface InventoryMigrationPositionsMatchInput
  extends DryRunInventoryMigrationInput {
  /** Exact final stock rows expected after replay against the target. */
  readonly expected: readonly InventoryMigrationExpectedPosition[];
}

/** Return whether one explicit-target dry-run equals the expected stock snapshot. */
export function inventoryMigrationPositionsMatch({
  catalog,
  plan,
  targetWorld,
  expected,
}: InventoryMigrationPositionsMatchInput): boolean {
  const world = dryRunInventoryMigration({
    catalog,
    plan,
    targetWorld,
  }).resultWorld;
  if (Object.keys(world.projection.positions).length !== expected.length)
    return false;
  for (const row of expected) {
    const actual =
      world.projection.positions[inventoryStockPositionIdentity(row.position)];
    if (
      actual === undefined ||
      !inventoryMeasurementsEqual(actual.measurements, row.measurements)
    )
      return false;
  }
  return true;
}

/** Inputs for idempotently applying one ready plan through the durable operation protocol. */
export interface ApplyInventoryMigrationPlanInput {
  /** Frozen catalogue used by translated events. */
  readonly catalog: InventoryCatalog;
  /** Durable target storage. */
  readonly storage: InventoryDurableStorage;
  /** Compiled ready plan. */
  readonly plan: InventoryMigrationPlan;
  /** Reviewed dry-run binding this plan to the exact target base. */
  readonly dryRun: InventoryMigrationDryRun;
  /** Durable record-time clock. */
  readonly clock: InventoryClock;
}

/** Freeze and publish one migration batch idempotently as a single visible target cut. */
export async function applyInventoryMigrationPlan({
  catalog,
  storage,
  plan,
  dryRun,
  clock,
}: ApplyInventoryMigrationPlanInput): Promise<InventoryWorldState> {
  if (plan.status !== InventoryMigrationPlanStatus.Ready) {
    throw new Error("Blocked inventory migration cannot be applied.");
  }
  if (inventoryMigrationPlanDigest(plan) !== plan.planDigest) {
    throw new Error("Inventory migration plan changed after compilation.");
  }
  if (dryRun.planDigest !== plan.planDigest) {
    throw new Error(
      "Inventory migration dry-run belongs to a different compiled plan."
    );
  }
  const operationIds = plan.events.map(
    /** Keep the frozen batch in the same deterministic order as the compiled plan. */
    (event) => event.operationId
  );
  const existingManifest = await storage.readMigrationManifest(
    plan.migrationId
  );
  if (existingManifest !== undefined) {
    assertMigrationManifestMatchesPlan(existingManifest, plan, operationIds);
    if (
      existingManifest.baseRevision !== dryRun.baseRevision ||
      existingManifest.baseWorldRoot !== dryRun.baseWorldRoot
    ) {
      throw new Error(
        "Inventory migrationId was retried against a different reviewed target base."
      );
    }
    if (existingManifest.state === InventoryMigrationManifestState.Aborted) {
      throw new Error("Aborted inventory migration identity cannot be reused.");
    }
    if (existingManifest.state === InventoryMigrationManifestState.Applying) {
      await resumeInventoryMigrationManifest(storage, plan.migrationId);
    }
    return storage.readWorld();
  }

  const targetWorld = await storage.readWorld();
  if (
    targetWorld.revision !== dryRun.baseRevision ||
    inventoryWorldContentRoots(targetWorld).world !== dryRun.baseWorldRoot
  ) {
    throw new Error(
      "Inventory migration target changed after the reviewed dry-run."
    );
  }
  const recordedAtEpochMs = clock.nowEpochMs();
  assertInventoryEpochMilliseconds(
    recordedAtEpochMs,
    "inventory migration durable record time"
  );
  // Build and validate every committed event/next root before the Applying fence exists.
  const durablePlan = createDurableInventoryMigrationPlan(
    catalog,
    targetWorld,
    plan,
    recordedAtEpochMs
  );
  await storage.beginMigrationManifest({
    migrationId: plan.migrationId,
    planDigest: plan.planDigest,
    baseRevision: targetWorld.revision,
    baseWorldRoot: durablePlan.baseWorldRoot,
    operationIds,
    sourceDispositions: plan.sourceDispositions,
    plan: durablePlan,
  });
  await resumeInventoryMigrationManifest(storage, plan.migrationId);
  return storage.readWorld();
}

/** Finish one frozen migration batch without the compiled plan, plugin, or legacy reader. */
export async function resumeInventoryMigrationManifest(
  storage: InventoryDurableStorage,
  migrationId: string
): Promise<InventoryMigrationManifest> {
  const manifest = await storage.readMigrationManifest(migrationId);
  if (manifest === undefined)
    throw new Error(`Unknown inventory migration '${migrationId}'.`);
  if (manifest.state === InventoryMigrationManifestState.Completed)
    return manifest;
  if (manifest.state === InventoryMigrationManifestState.Aborted) {
    throw new Error("Aborted inventory migration cannot be resumed.");
  }
  if (manifest.plan === undefined) {
    throw new Error("Applying inventory migration has no frozen repair plan.");
  }
  await storage.writeMigrationWorld(migrationId);
  return storage.completeMigrationManifest(migrationId);
}

/** Inputs for one bounded generic migration-repair pass. */
export interface RepairInventoryMigrationManifestsInput {
  /** Durable adapter containing applying migration batches. */
  readonly storage: InventoryDurableStorage;
  /** Maximum applying migration batches to finish. */
  readonly limit?: number;
}

/** Finish listed migration batches using only their durable frozen plans. */
export async function repairInventoryMigrationManifests({
  storage,
  limit = 100,
}: RepairInventoryMigrationManifestsInput): Promise<
  readonly InventoryMigrationManifest[]
> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(
      "Inventory migration repair limit must be a positive safe integer."
    );
  }
  const applying = await storage.listApplyingMigrationManifests({ limit });
  const completed: InventoryMigrationManifest[] = [];
  for (const manifest of applying) {
    completed.push(
      await resumeInventoryMigrationManifest(storage, manifest.migrationId)
    );
  }
  return completed;
}

/** Replay all compiled rows together so a doomed cross-row plan never becomes Ready. */
function addJointMigrationReplayDiagnostic(
  catalog: InventoryCatalog,
  events: readonly InventoryEventDraft[],
  cutoverAtEpochMs: number,
  sourceByOperationId: ReadonlyMap<string, InventoryMigrationSourceReference>,
  diagnostics: InventoryMigrationDiagnostic[]
): void {
  let world: InventoryWorldState = {
    ...emptyInventoryWorldState(),
    catalog: inventoryCatalogSnapshot(catalog),
  };
  for (const event of events) {
    try {
      const committed = commitInventoryEvent(
        event,
        cutoverAtEpochMs,
        world.projection.lastRecordSequence + 1
      );
      const projection = applyInventoryCommittedEvent({
        catalog,
        state: world.projection,
        event: committed,
        deficitPolicy: InventoryDeficitPolicy.Record,
      }).state;
      world = {
        revision: world.revision + 1,
        catalog: world.catalog,
        projection,
        reservations: world.reservations,
        counts: world.counts,
      };
    } catch (error) {
      const source = sourceByOperationId.get(event.operationId);
      diagnostics.push({
        severity: InventoryMigrationDiagnosticSeverity.Error,
        code: InventoryMigrationDiagnosticCode.JointSemanticConflict,
        message:
          `Translated event '${event.operationId}' conflicts with earlier migration rows: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        ...(source === undefined ? {} : { source }),
        resolution:
          "Fix the named legacy row or its earlier conflicting row, then compile again.",
      });
      return;
    }
  }
}

/** Return whether migration compilation already has a blocking row. */
function migrationDiagnosticsContainError(
  diagnostics: readonly InventoryMigrationDiagnostic[]
): boolean {
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === InventoryMigrationDiagnosticSeverity.Error)
      return true;
  }
  return false;
}

/** Validate, normalize, and deterministically order non-physical source dispositions. */
function normalizeInventoryMigrationSourceDispositions(
  dispositions: readonly InventoryMigrationSourceDisposition[],
  cutoverAtEpochMs: number,
  diagnostics: InventoryMigrationDiagnostic[]
): readonly InventoryMigrationSourceDisposition[] {
  const normalized: InventoryMigrationSourceDisposition[] = [];
  const seen = new Set<string>();
  for (const disposition of dispositions) {
    try {
      const dispositionId = requireMigrationDispositionText(
        disposition.dispositionId,
        "dispositionId"
      );
      if (seen.has(dispositionId)) {
        diagnostics.push(
          duplicateMigrationIdentity(
            "source disposition",
            dispositionId,
            disposition.source
          )
        );
        continue;
      }
      seen.add(dispositionId);
      if (
        disposition.kind !==
        InventoryMigrationSourceDispositionKind.SnapshotSupersededDoNotReplay
      ) {
        throw new Error(
          `unsupported disposition kind '${String(disposition.kind)}'`
        );
      }
      assertInventoryEpochMilliseconds(
        disposition.snapshotAtEpochMs,
        `inventory migration source disposition '${dispositionId}' snapshotAtEpochMs`
      );
      if (disposition.snapshotAtEpochMs !== cutoverAtEpochMs) {
        throw new Error(
          `snapshotAtEpochMs '${disposition.snapshotAtEpochMs}' differs from migration cutoverAtEpochMs '${cutoverAtEpochMs}'`
        );
      }
      const sourceType = requireMigrationDispositionText(
        disposition.source.sourceType,
        "sourceType"
      );
      const sourceId = requireMigrationDispositionText(
        disposition.source.sourceId,
        "sourceId"
      );
      const reason = requireMigrationDispositionText(
        disposition.reason,
        "reason"
      );
      if (disposition.evidence !== undefined) {
        inventoryMetadataFingerprint(disposition.evidence);
      }
      normalized.push({
        dispositionId,
        kind: disposition.kind,
        source: {
          sourceType,
          sourceId,
          ...(disposition.source.note === undefined
            ? {}
            : {
                note: requireMigrationDispositionText(
                  disposition.source.note,
                  "source note"
                ),
              }),
        },
        snapshotAtEpochMs: disposition.snapshotAtEpochMs,
        reason,
        ...(disposition.evidence === undefined
          ? {}
          : { evidence: disposition.evidence }),
      });
    } catch (error) {
      diagnostics.push(
        invalidTranslatedFact(
          `Source disposition '${disposition.dispositionId}' is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
          disposition.source
        )
      );
    }
  }
  normalized.sort(compareInventoryMigrationSourceDisposition);
  return normalized;
}

/** Require one stable source-disposition identity or explanation. */
function requireMigrationDispositionText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return normalized;
}

/** Stable ordering independent of application query return order. */
function compareInventoryMigrationSourceDisposition(
  left: InventoryMigrationSourceDisposition,
  right: InventoryMigrationSourceDisposition
): number {
  return compareInventoryIdentityText(left.dispositionId, right.dispositionId);
}

/** Fingerprint the complete compiled plan so callers cannot swap rows after review. */
function inventoryMigrationPlanDigest(
  plan: Omit<InventoryMigrationPlan, "planDigest"> | InventoryMigrationPlan
): string {
  return inventoryIntentFingerprint([
    plan.migrationId,
    plan.sourceSystem,
    plan.sourceVersion ?? null,
    plan.cutoverAtEpochMs,
    plan.status,
    plan.events.map(inventoryEventIntentFingerprint),
    plan.sourceDispositions.map(inventoryMigrationSourceDispositionFingerprint),
    plan.diagnostics.map(
      /** Keep every reviewed warning/error/source row inside the compiled-plan identity. */
      (diagnostic) => [
        diagnostic.severity,
        diagnostic.code,
        diagnostic.message,
        diagnostic.source === undefined
          ? null
          : [
              diagnostic.source.sourceType,
              diagnostic.source.sourceId,
              diagnostic.source.note ?? null,
            ],
        diagnostic.resolution ?? null,
      ]
    ),
    inventoryMetadataFingerprint(plan.metadata),
  ]);
}

/** Build the complete committed event batch and exact next roots before durable begin. */
function createDurableInventoryMigrationPlan(
  catalog: InventoryCatalog,
  baseWorld: InventoryWorldState,
  plan: InventoryMigrationPlan,
  recordedAtEpochMs: number
): InventoryDurableMigrationPlan {
  let world = baseWorld;
  assertInventoryCatalogRetainsSnapshot(catalog, world.catalog);
  const catalogSnapshot = inventoryCatalogSnapshot(catalog);
  /** Complete committed event batch retained for restart repair. */
  const committedEvents: InventoryCommittedEvent[] = [];
  for (const event of plan.events) {
    try {
      const committed = commitInventoryEvent(
        event,
        recordedAtEpochMs,
        world.projection.lastRecordSequence + 1
      );
      committedEvents.push(committed);
      const projection = applyInventoryCommittedEvent({
        catalog,
        state: world.projection,
        event: committed,
        deficitPolicy: InventoryDeficitPolicy.Record,
      }).state;
      world = {
        // The event stream advances inside one unpublished batch; the world revision advances once.
        revision: baseWorld.revision + 1,
        catalog: catalogSnapshot,
        projection,
        reservations: world.reservations,
        counts: world.counts,
      };
    } catch (error) {
      throw new Error(
        `Migration '${plan.migrationId}' cannot start because '${event.operationId}' fails against current target truth: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const baseWorldRoot = inventoryWorldContentRoots(baseWorld).world;
  const nextWorld: InventoryWorldState = {
    ...world,
    revision: baseWorld.revision + 1,
    catalog: catalogSnapshot,
  };
  const nextRoots = inventoryWorldContentRoots(nextWorld);
  const durablePlanWithoutDigest: Omit<
    InventoryDurableMigrationPlan,
    "durablePlanDigest"
  > = {
    format: "inventoryonce-migration-plan-v1",
    baseWorldRoot,
    catalog: catalogSnapshot,
    catalogRoot: catalogSnapshot.digest,
    deficitPolicy: InventoryDeficitPolicy.Record,
    events: committedEvents,
    sourceDispositions: structuredClone(plan.sourceDispositions),
    nextRoots,
  };
  return {
    ...durablePlanWithoutDigest,
    durablePlanDigest: inventoryDurableMigrationPlanDigest(
      durablePlanWithoutDigest
    ),
  };
}

/** Reject changed compiled rows on completed or applying migration retries. */
function assertMigrationManifestMatchesPlan(
  manifest: InventoryMigrationManifest,
  plan: InventoryMigrationPlan,
  operationIds: readonly string[]
): void {
  if (manifest.planDigest !== plan.planDigest) {
    throw new Error(
      "Inventory migrationId was retried with a changed whole plan."
    );
  }
  if (manifest.operationIds.length !== operationIds.length) {
    throw new Error(
      "Inventory migrationId was retried with a changed whole plan."
    );
  }
  for (let index = 0; index < operationIds.length; index += 1) {
    if (manifest.operationIds[index] !== operationIds[index]) {
      throw new Error(
        "Inventory migrationId was retried with a changed whole plan."
      );
    }
  }
  if (
    inventoryIntentFingerprint(
      manifest.sourceDispositions.map(
        inventoryMigrationSourceDispositionFingerprint
      )
    ) !==
    inventoryIntentFingerprint(
      plan.sourceDispositions.map(
        inventoryMigrationSourceDispositionFingerprint
      )
    )
  ) {
    throw new Error(
      "Inventory migrationId was retried with changed source dispositions."
    );
  }
}

/** Stable migration operation identity qualified by migration/kind/local source identity. */
function migrationOperationId(
  migrationId: string,
  kind: string,
  localId: string
): string {
  if (localId.trim().length === 0) {
    throw new Error(`Inventory migration ${kind} identity must not be empty.`);
  }
  return `inventory:migration:${encodeURIComponent(
    migrationId
  )}:${kind}:${encodeURIComponent(localId)}`;
}

/** JSON-safe metadata form of one exact legacy source pointer. */
function migrationSourceMetadata(
  source: InventoryMigrationSourceReference
): InventoryMetadata {
  if (
    source.sourceType.trim().length === 0 ||
    source.sourceId.trim().length === 0
  ) {
    throw new Error("Inventory migration source type/id must not be empty.");
  }
  return {
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    ...(source.note === undefined ? {} : { note: source.note }),
  };
}

/** Build one blocking duplicate-identity diagnostic. */
function duplicateMigrationIdentity(
  label: string,
  identity: string,
  source?: InventoryMigrationSourceReference
): InventoryMigrationDiagnostic {
  return {
    severity: InventoryMigrationDiagnosticSeverity.Error,
    code: InventoryMigrationDiagnosticCode.DuplicateIdentity,
    message: `Duplicate ${label} identity '${identity}'.`,
    ...(source === undefined ? {} : { source }),
  };
}

/** Build one blocking translated-fact diagnostic. */
function invalidTranslatedFact(
  message: string,
  source?: InventoryMigrationSourceReference
): InventoryMigrationDiagnostic {
  return {
    severity: InventoryMigrationDiagnosticSeverity.Error,
    code: InventoryMigrationDiagnosticCode.InvalidTranslatedFact,
    message,
    ...(source === undefined ? {} : { source }),
  };
}

/** Sort compiled migration events by stable operation identity. */
function compareMigrationEvent(
  left: InventoryEventDraft,
  right: InventoryEventDraft
): number {
  return compareInventoryIdentityText(left.operationId, right.operationId);
}

/** Sort diagnostics by severity/code/source/message for deterministic review output. */
function compareMigrationDiagnostic(
  left: InventoryMigrationDiagnostic,
  right: InventoryMigrationDiagnostic
): number {
  const leftIdentity = [
    left.severity,
    left.code,
    left.source?.sourceType ?? "",
    left.source?.sourceId ?? "",
    left.message,
  ].join("|");
  const rightIdentity = [
    right.severity,
    right.code,
    right.source?.sourceType ?? "",
    right.source?.sourceId ?? "",
    right.message,
  ].join("|");
  return compareInventoryIdentityText(leftIdentity, rightIdentity);
}
