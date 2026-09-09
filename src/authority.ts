/** Scalar values retained by the portable InventoryOnce authority state store. */
export type InventoryAuthorityScalar = string | number | boolean | null;

/** One flat durable authority-state document. */
export type InventoryAuthorityDocument = Readonly<
  Record<string, InventoryAuthorityScalar>
>;

/** Portable schema field kinds needed by an authority-state adapter. */
export type InventoryAuthorityFieldKind = "String" | "Number" | "Boolean";

/** Flat schema requested when one authority state row is initialized. */
export type InventoryAuthorityFields = Readonly<
  Record<string, InventoryAuthorityFieldKind>
>;

/** Result of idempotently creating one authority state row. */
export enum InventoryAuthorityCreateResult {
  /** This call created the row. */
  Created = "created",
  /** The row already existed. */
  Existing = "existing",
}

/**
 * Minimal portable row-scoped store for the executable authority FSM.
 * Applications bind database class/key details outside InventoryOnce.
 */
export interface InventoryAuthorityStateStore {
  /** Ensure durable scalar fields exist before the row is used. */
  ensure(fields: InventoryAuthorityFields): Promise<void>;
  /** Read the current primary-stored row. */
  read(): Promise<InventoryAuthorityDocument | undefined>;
  /** Idempotently create the initial row. */
  create(
    document: InventoryAuthorityDocument
  ): Promise<InventoryAuthorityCreateResult>;
  /** Atomically patch fields only when every expected scalar still matches. */
  compareAndSet(
    expected: InventoryAuthorityDocument,
    replacement: InventoryAuthorityDocument
  ): Promise<boolean>;
}

/** Maximum optimistic CAS retries under concurrent writer admission/release. */
const AUTHORITY_CAS_RETRY_LIMIT = 64;

/** Ledger allowed to accept new physical inventory mutations. */
export enum InventoryAuthorityMode {
  /** Existing Parse rows remain physical truth. */
  Legacy = "legacy",
  /** The source is being read and checked while legacy still owns writes. */
  Shadow = "shadow",
  /** Both command paths are checked while legacy still owns writes. */
  DualRun = "dual-run",
  /** New physical writes are blocked during stable-source cutover. */
  Fencing = "fencing",
  /** InventoryOnce is physical truth; Parse rows are compatibility projection. */
  Authoritative = "authoritative",
}

/** Durable provenance for how one stream first became authoritative. */
export enum InventoryAuthorityActivationKind {
  /** No authority activation has occurred. */
  None = "none",
  /** Existing source truth was fenced, migrated, and activated. */
  LegacyCutover = "legacy-cutover",
  /** A certified revision-zero empty world was explicitly activated. */
  Greenfield = "greenfield",
}

/** Compatibility projection state saved with authoritative control. */
export enum InventoryCompatibilityProjectionStatus {
  /** The legacy compatibility rows match the published InventoryOnce world. */
  Current = "current",
  /** A published world is newer than the last successful compatibility write. */
  Lagging = "lagging",
  /** The last compatibility write failed and needs the repair endpoint. */
  Failed = "failed",
}

/** One admitted legacy writer attempt that must finish before fencing. */
export interface InventoryLegacyWriterAdmission {
  /** Stable physical mutation/source identity. */
  readonly writerToken: string;
  /** Unique process/attempt identity preventing concurrent reuse of one writer token. */
  readonly attemptToken: string;
}

/** Result of atomically routing one mutation at the authority boundary. */
export interface InventoryWriterAdmissionResult {
  /** Durable mode observed or established by this admission attempt. */
  readonly mode: InventoryAuthorityMode;
  /** True only when this exact attempt owns one legacy writer admission. */
  readonly admittedLegacyWriter: boolean;
  /** Complete durable authority state after the admission decision. */
  readonly state: InventoryAuthorityState;
}

/** Durable authority state for one clinic inventory stream. */
export interface InventoryAuthorityState {
  /** Stable clinic/stream namespace. */
  readonly namespaceId: string;
  /** Monotonic compare-and-set revision. */
  readonly revision: number;
  /** Current physical authority. */
  readonly mode: InventoryAuthorityMode;
  /** Exact first-activation provenance; None before authority. */
  readonly activationKind: InventoryAuthorityActivationKind;
  /** Explicit operator/deployment authorization retained for legacy cutover. */
  readonly cutoverAuthorizationId: string;
  /** Explicit deployment authorization retained only for greenfield activation. */
  readonly greenfieldAuthorizationId: string;
  /** Canonically sorted active legacy writer attempts. */
  readonly activeLegacyWriters: readonly InventoryLegacyWriterAdmission[];
  /** Digest of the adapter certification run accepted before Shadow mode. */
  readonly adapterCertificationDigest: string;
  /** Canonical time at which the adapter certification was accepted. */
  readonly adapterCertifiedAt: string;
  /** Complete source root checked before DualRun and again under the fence. */
  readonly sourceRoot: string;
  /** Source revision represented by sourceRoot. */
  readonly sourceRevision: number;
  /** Canonical time DualRun started. */
  readonly dualRunStartedAt: string;
  /** Canonically ordered mismatch evidence; non-empty evidence blocks fencing. */
  readonly dualRunMismatchEvidence: readonly InventoryDualRunMismatchEvidence[];
  /** Stable cutover retry identity. */
  readonly fenceToken: string;
  /** Canonical time the source write fence started. */
  readonly fenceStartedAt: string;
  /** Exact accepted source migration plan digest. */
  readonly sourcePlanDigest: string;
  /** Exact accepted source catalogue digest. */
  readonly sourceCatalogDigest: string;
  /** Exact published InventoryOnce world root. */
  readonly targetWorldRoot: string;
  /** Exact published InventoryOnce world revision. */
  readonly targetWorldRevision: number;
  /** Canonical time authority activated. */
  readonly activatedAt: string;
  /** Last published world revision written to legacy compatibility rows. */
  readonly compatibilityProjectionWorldRevision: number;
  /** Current compatibility projector condition. */
  readonly compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus;
  /** Last projector error, if the status is Failed. */
  readonly compatibilityProjectionError: string;
}

/** Inputs for accepting one real adapter certification result. */
export interface CertifyInventoryAdapterInput {
  /** Stable digest emitted by the adapter conformance/certification run. */
  readonly certificationDigest: string;
  /** Canonical time at which certification completed. */
  readonly certifiedAt: string;
}

/** Inputs for moving a certified legacy stream into Shadow mode. */
export interface EnterInventoryShadowInput {
  /** Certification digest that must already be stored on this stream. */
  readonly certificationDigest: string;
}

/** Inputs for moving a shadowed stream into DualRun mode. */
export interface EnterInventoryDualRunInput {
  /** Complete source root read by the shadow source compiler. */
  readonly sourceRoot: string;
  /** Source revision represented by sourceRoot. */
  readonly sourceRevision: number;
  /** Exact source migration plan digest for the shadow read. */
  readonly sourcePlanDigest: string;
  /** Exact source catalogue digest for the shadow read. */
  readonly sourceCatalogDigest: string;
  /** Canonical time DualRun started. */
  readonly startedAt: string;
}

/** One mismatch record that prevents a source fence from being claimed. */
export interface RecordInventoryDualRunMismatchInput {
  /** Stable command identity that disagreed. */
  readonly commandId: string;
  /** Intent digest seen by the legacy path. */
  readonly legacyIntentDigest: string;
  /** Intent/result digest seen by the InventoryOnce path. */
  readonly authoritativeIntentDigest: string;
  /** Canonical time the mismatch was recorded. */
  readonly recordedAt: string;
}

/** Inputs for explicitly authorizing one legacy-source authority cutover. */
export interface AuthorizeInventoryCutoverInput {
  /** Stable operator/deployment authorization identity; exact retries must reuse it. */
  readonly authorizationId: string;
}

/** Inputs for one namespace-isolated authority control. */
export interface CreateInventoryAuthorityControlInput {
  /** Portable row-scoped compare-and-set storage. */
  readonly store: InventoryAuthorityStateStore;
  /** Stable inventory stream namespace. */
  readonly namespaceId: string;
}

/** Inputs for atomically admitting one legacy physical writer. */
export interface AdmitLegacyInventoryWriterInput {
  /** Stable physical mutation/source identity. */
  readonly writerToken: string;
  /** Unique process/attempt identity. */
  readonly attemptToken: string;
}

/** Inputs for releasing one exact legacy writer admission. */
export interface ReleaseLegacyInventoryWriterInput {
  /** Stable physical mutation/source identity. */
  readonly writerToken: string;
  /** Unique process/attempt identity that currently owns the admission. */
  readonly attemptToken: string;
}

/** Inputs for claiming the legacy source write fence. */
export interface ClaimInventoryAuthorityFenceInput {
  /** Stable retry identity for this cutover. */
  readonly fenceToken: string;
  /** Canonical fence claim time. */
  readonly startedAt: string;
  /** Optional source-root assertion from the caller; current durable root is always checked. */
  readonly sourceRoot?: string;
  /** Optional source-revision assertion from the caller. */
  readonly sourceRevision?: number;
}

/** Inputs for activating InventoryOnce after migration publication. */
export interface ActivateInventoryAuthorityInput {
  /** Token currently owning the write fence. */
  readonly fenceToken: string;
  /** Exact stable source migration plan digest. */
  readonly sourcePlanDigest: string;
  /** Exact stable source catalogue digest. */
  readonly sourceCatalogDigest: string;
  /** Exact published target world root. */
  readonly targetWorldRoot: string;
  /** Exact published target world revision. */
  readonly targetWorldRevision: number;
  /** Complete source root checked under the fence. */
  readonly sourceRoot?: string;
  /** Canonical activation time. */
  readonly activatedAt: string;
}

/** Inputs for explicitly activating a certified empty greenfield stream. */
export interface ActivateGreenfieldInventoryAuthorityInput {
  /** Explicit operator/deployment authorization for creating authority without legacy source truth. */
  readonly authorizationId: string;
  /** Exact adapter certification digest already retained on the stream. */
  readonly certificationDigest: string;
  /** Exact content root of the verified revision-zero empty world. */
  readonly targetWorldRoot: string;
  /** Greenfield activation can bind only revision zero. */
  readonly targetWorldRevision: 0;
  /** Canonical activation time. */
  readonly activatedAt: string;
}

/** Inputs for recording one successful compatibility projection. */
export interface MarkInventoryCompatibilityProjectionInput {
  /** Published InventoryOnce world revision now visible in legacy rows. */
  readonly worldRevision: number;
}

/** Inputs for recording one failed compatibility projection. */
export interface MarkInventoryCompatibilityProjectionFailureInput {
  /** Published InventoryOnce world revision whose compatibility write failed. */
  readonly worldRevision: number;
  /** Plain bounded error retained for the admin repair screen. */
  readonly error: string;
}

/** Executable authority-control contract used by applications and crash-injection tests. */
export interface InventoryAuthorityControlPort {
  /** Read current durable authority state. */
  read(): Promise<InventoryAuthorityState>;
  /** Persist the adapter certification accepted before Shadow mode. */
  certifyAdapter(
    input: CertifyInventoryAdapterInput
  ): Promise<InventoryAuthorityState>;
  /** Move certified legacy control into read-only Shadow mode. */
  enterShadow(
    input: EnterInventoryShadowInput
  ): Promise<InventoryAuthorityState>;
  /** Bind one complete source root and enter DualRun. */
  enterDualRun(
    input: EnterInventoryDualRunInput
  ): Promise<InventoryAuthorityState>;
  /** Retain one deterministic DualRun mismatch that blocks fencing. */
  recordDualRunMismatch(
    input: RecordInventoryDualRunMismatchInput
  ): Promise<InventoryAuthorityState>;
  /** Durably authorize a legacy-source cutover before fence ownership can be claimed. */
  authorizeCutover(
    input: AuthorizeInventoryCutoverInput
  ): Promise<InventoryAuthorityState>;
  /** Atomically route and admit one legacy writer attempt when allowed. */
  admitLegacyWriter(
    input: AdmitLegacyInventoryWriterInput
  ): Promise<InventoryWriterAdmissionResult>;
  /** Release the exact attempt that owns one writer admission. */
  releaseLegacyWriter(
    input: ReleaseLegacyInventoryWriterInput
  ): Promise<InventoryAuthorityState>;
  /** Claim the legacy source write fence. */
  claimFence(
    input: ClaimInventoryAuthorityFenceInput
  ): Promise<InventoryAuthorityState>;
  /** Activate InventoryOnce with exact source and target evidence. */
  activate(
    input: ActivateInventoryAuthorityInput
  ): Promise<InventoryAuthorityState>;
  /** Activate a certified revision-zero empty stream without fabricating legacy migration evidence. */
  activateGreenfield(
    input: ActivateGreenfieldInventoryAuthorityInput
  ): Promise<InventoryAuthorityState>;
  /** Release an unpublished fence while preserving monotonic authority. */
  releaseFence(fenceToken: string): Promise<InventoryAuthorityState>;
  /** Record one successful compatibility projection. */
  markCompatibilityProjectionApplied(
    input: MarkInventoryCompatibilityProjectionInput
  ): Promise<InventoryAuthorityState>;
  /** Record one failed compatibility projection for explicit repair. */
  markCompatibilityProjectionFailed(
    input: MarkInventoryCompatibilityProjectionFailureInput
  ): Promise<InventoryAuthorityState>;
}

/** Create one durable authority-control state machine. */
export function createInventoryAuthorityControl(
  input: CreateInventoryAuthorityControlInput
): InventoryAuthorityControl {
  return new InventoryAuthorityControl(input.store, input.namespaceId);
}

/** Durable compare-and-set authority state machine. */
export class InventoryAuthorityControl
  implements InventoryAuthorityControlPort
{
  /** Portable row-scoped compare-and-set storage. */
  private readonly store: InventoryAuthorityStateStore;
  /** Stable inventory stream namespace. */
  private readonly namespaceId: string;
  /** Shared row initialization. */
  private readonly ready: Promise<void>;

  /** Bind one stable inventory stream. */
  constructor(store: InventoryAuthorityStateStore, namespaceId: string) {
    this.namespaceId = requireText(namespaceId, "namespaceId");
    this.store = store;
    this.ready = this.initialize();
    // Observe boot-time storage failure immediately while preserving the rejected promise for callers.
    void this.ready.catch(
      /** Observe the rejection without converting the stored ready promise. */
      () => undefined
    );
  }

  /** Read the current primary-stored state. */
  async read(): Promise<InventoryAuthorityState> {
    await this.ready;
    const row = await this.store.read();
    if (row === undefined)
      throw new Error("InventoryOnce authority control row is missing.");
    return parseState(row, this.namespaceId);
  }

  /** Persist one adapter certification before the stream can enter Shadow mode. */
  async certifyAdapter(
    input: CertifyInventoryAdapterInput
  ): Promise<InventoryAuthorityState> {
    const certificationDigest = requireText(
      input.certificationDigest,
      "certificationDigest"
    );
    const certifiedAt = requireCanonicalTime(input.certifiedAt, "certifiedAt");
    const current = await this.read();
    if (current.mode !== InventoryAuthorityMode.Legacy) {
      if (current.adapterCertificationDigest === certificationDigest)
        return current;
      throw new Error(
        "InventoryOnce adapter certification is only accepted before Shadow mode."
      );
    }
    if (
      current.adapterCertificationDigest !== "" &&
      current.adapterCertificationDigest !== certificationDigest
    ) {
      throw new Error(
        "InventoryOnce adapter certification cannot be replaced for this namespace."
      );
    }
    if (current.adapterCertificationDigest === certificationDigest)
      return current;
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.Legacy,
        activeLegacyWritersJson: serializeActiveWriters(
          current.activeLegacyWriters
        ),
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        adapterCertificationDigest: certificationDigest,
        adapterCertifiedAt: certifiedAt,
      }
    );
    const next = await this.read();
    if (!changed && next.adapterCertificationDigest !== certificationDigest) {
      throw new Error(
        "InventoryOnce adapter certification CAS lost to another transition."
      );
    }
    return next;
  }

  /** Move certified legacy control into Shadow without changing physical writes. */
  async enterShadow(
    input: EnterInventoryShadowInput
  ): Promise<InventoryAuthorityState> {
    const certificationDigest = requireText(
      input.certificationDigest,
      "certificationDigest"
    );
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.Shadow) {
      if (current.adapterCertificationDigest === certificationDigest)
        return current;
      throw new Error(
        "InventoryOnce Shadow state has different adapter certification."
      );
    }
    if (current.mode !== InventoryAuthorityMode.Legacy) {
      throw new Error("InventoryOnce Shadow mode must follow Legacy mode.");
    }
    if (current.adapterCertificationDigest !== certificationDigest) {
      throw new Error(
        "InventoryOnce Shadow mode requires the accepted adapter certification."
      );
    }
    if (current.activeLegacyWriters.length !== 0) {
      throw new Error(
        "InventoryOnce Shadow mode cannot start while legacy writers are active."
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.Legacy,
        activeLegacyWritersJson: "[]",
      },
      { revision: nextInventoryAuthorityRevision(current.revision), mode: InventoryAuthorityMode.Shadow }
    );
    const next = await this.read();
    if (!changed && next.mode !== InventoryAuthorityMode.Shadow) {
      throw new Error(
        "InventoryOnce Shadow transition CAS lost to another transition."
      );
    }
    return next;
  }

  /** Move Shadow control into DualRun only with a complete source-root record. */
  async enterDualRun(
    input: EnterInventoryDualRunInput
  ): Promise<InventoryAuthorityState> {
    const sourceRoot = requireText(input.sourceRoot, "sourceRoot");
    const sourcePlanDigest = requireText(
      input.sourcePlanDigest,
      "sourcePlanDigest"
    );
    const sourceCatalogDigest = requireText(
      input.sourceCatalogDigest,
      "sourceCatalogDigest"
    );
    const startedAt = requireCanonicalTime(
      input.startedAt,
      "DualRun startedAt"
    );
    requireSafeNonNegativeInteger(input.sourceRevision, "sourceRevision");
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.DualRun) {
      if (
        current.sourceRoot === sourceRoot &&
        current.sourceRevision === input.sourceRevision &&
        current.sourcePlanDigest === sourcePlanDigest &&
        current.sourceCatalogDigest === sourceCatalogDigest
      )
        return current;
      throw new Error(
        "InventoryOnce DualRun state has different source evidence."
      );
    }
    if (current.mode !== InventoryAuthorityMode.Shadow) {
      throw new Error("InventoryOnce DualRun mode must follow Shadow mode.");
    }
    if (current.activeLegacyWriters.length !== 0) {
      throw new Error(
        "InventoryOnce DualRun mode cannot start while legacy writers are active."
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.Shadow,
        activeLegacyWritersJson: "[]",
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        mode: InventoryAuthorityMode.DualRun,
        sourceRoot,
        sourceRevision: input.sourceRevision,
        sourcePlanDigest,
        sourceCatalogDigest,
        dualRunStartedAt: startedAt,
        dualRunMismatchEvidenceJson: "[]",
      }
    );
    const next = await this.read();
    if (!changed && next.mode !== InventoryAuthorityMode.DualRun) {
      throw new Error(
        "InventoryOnce DualRun transition CAS lost to another transition."
      );
    }
    return next;
  }

  /** Append exact mismatch evidence; any such evidence blocks the source fence. */
  async recordDualRunMismatch(
    input: RecordInventoryDualRunMismatchInput
  ): Promise<InventoryAuthorityState> {
    const commandId = requireText(input.commandId, "commandId");
    const legacyIntentDigest = requireText(
      input.legacyIntentDigest,
      "legacyIntentDigest"
    );
    const authoritativeIntentDigest = requireText(
      input.authoritativeIntentDigest,
      "authoritativeIntentDigest"
    );
    const recordedAt = requireCanonicalTime(
      input.recordedAt,
      "mismatch recordedAt"
    );
    for (let attempt = 0; attempt < AUTHORITY_CAS_RETRY_LIMIT; attempt += 1) {
      const current = await this.read();
      if (current.mode !== InventoryAuthorityMode.DualRun) {
        throw new Error(
          "InventoryOnce mismatch evidence can only be recorded in DualRun mode."
        );
      }
      const evidence = current.dualRunMismatchEvidence;
      if (
        evidence.some(
          /** Return whether this command already owns retained mismatch evidence. */
          (entry) => entry.commandId === commandId
        )
      )
        return current;
      const nextEvidence = [
        ...evidence,
        {
          commandId,
          legacyIntentDigest,
          authoritativeIntentDigest,
          recordedAt,
        },
      ].sort(compareMismatchEvidence);
      const changed = await this.store.compareAndSet(
        {
          revision: current.revision,
          mode: InventoryAuthorityMode.DualRun,
          dualRunMismatchEvidenceJson: serializeMismatchEvidence(
            current.dualRunMismatchEvidence
          ),
        },
        {
          revision: nextInventoryAuthorityRevision(current.revision),
          dualRunMismatchEvidenceJson: serializeMismatchEvidence(nextEvidence),
        }
      );
      if (changed) return this.read();
    }
    throw new Error(
      "InventoryOnce DualRun mismatch evidence CAS exceeded its retry bound."
    );
  }

  /** Durably authorize one legacy-source cutover with exact retry semantics. */
  async authorizeCutover(
    input: AuthorizeInventoryCutoverInput
  ): Promise<InventoryAuthorityState> {
    const authorizationId = requireText(
      input.authorizationId,
      "cutover authorizationId"
    );
    for (let attempt = 0; attempt < AUTHORITY_CAS_RETRY_LIMIT; attempt += 1) {
      const current = await this.read();
      if (current.greenfieldAuthorizationId.length !== 0) {
        throw new Error(
          "InventoryOnce legacy cutover cannot reuse greenfield authorization."
        );
      }
      if (current.cutoverAuthorizationId.length !== 0) {
        if (current.cutoverAuthorizationId === authorizationId) return current;
        throw new Error(
          "InventoryOnce legacy cutover authorization differs from durable evidence."
        );
      }
      if (
        current.mode !== InventoryAuthorityMode.Legacy &&
        current.mode !== InventoryAuthorityMode.Shadow &&
        current.mode !== InventoryAuthorityMode.DualRun
      ) {
        throw new Error(
          "InventoryOnce legacy cutover authorization must precede fence ownership."
        );
      }
      const changed = await this.store.compareAndSet(
        {
          revision: current.revision,
          mode: current.mode,
          cutoverAuthorizationId: "",
          greenfieldAuthorizationId: "",
        },
        {
          revision: nextInventoryAuthorityRevision(current.revision),
          cutoverAuthorizationId: authorizationId,
        }
      );
      if (changed) return this.read();
    }
    throw new Error(
      "InventoryOnce legacy cutover authorization exceeded its CAS retry bound."
    );
  }

  /** Atomically route and, in legacy mode, admit one exact writer attempt. */
  async admitLegacyWriter(
    input: AdmitLegacyInventoryWriterInput
  ): Promise<InventoryWriterAdmissionResult> {
    const writerToken = requireText(input.writerToken, "writerToken");
    const attemptToken = requireText(input.attemptToken, "attemptToken");
    for (let attempt = 0; attempt < AUTHORITY_CAS_RETRY_LIMIT; attempt += 1) {
      const current = await this.read();
      if (current.mode === InventoryAuthorityMode.Authoritative) {
        return {
          mode: current.mode,
          admittedLegacyWriter: false,
          state: current,
        };
      }
      if (current.mode === InventoryAuthorityMode.Fencing) {
        throw new Error(
          `InventoryOnce cutover '${current.fenceToken}' currently owns the legacy write fence.`
        );
      }
      const existing = current.activeLegacyWriters.find(
        /** Find the current attempt owning this stable writer identity. */
        (writer) => writer.writerToken === writerToken
      );
      if (existing !== undefined) {
        if (existing.attemptToken !== attemptToken) {
          throw new Error(
            `Legacy inventory writer '${writerToken}' is already active under another attempt.`
          );
        }
        return {
          mode: current.mode,
          admittedLegacyWriter: true,
          state: current,
        };
      }
      const nextWriters = normalizeActiveWriters([
        ...current.activeLegacyWriters,
        { writerToken, attemptToken },
      ]);
      const changed = await this.store.compareAndSet(
        {
          revision: current.revision,
          mode: current.mode,
          activeLegacyWritersJson: serializeActiveWriters(
            current.activeLegacyWriters
          ),
        },
        {
          revision: nextInventoryAuthorityRevision(current.revision),
          activeLegacyWritersJson: serializeActiveWriters(nextWriters),
        }
      );
      if (changed) {
        const next = await this.read();
        return {
          mode: next.mode,
          admittedLegacyWriter: true,
          state: next,
        };
      }
    }
    throw new Error(
      "InventoryOnce legacy writer admission exceeded its CAS retry bound."
    );
  }

  /** Release only the exact attempt that owns one legacy writer admission. */
  async releaseLegacyWriter(
    input: ReleaseLegacyInventoryWriterInput
  ): Promise<InventoryAuthorityState> {
    const writerToken = requireText(input.writerToken, "writerToken");
    const attemptToken = requireText(input.attemptToken, "attemptToken");
    for (let attempt = 0; attempt < AUTHORITY_CAS_RETRY_LIMIT; attempt += 1) {
      const current = await this.read();
      const existing = current.activeLegacyWriters.find(
        /** Find the current attempt owning this stable writer identity. */
        (writer) => writer.writerToken === writerToken
      );
      if (existing === undefined) return current;
      if (existing.attemptToken !== attemptToken) {
        throw new Error(
          `Legacy inventory writer '${writerToken}' is owned by another attempt.`
        );
      }
      if (
        current.mode !== InventoryAuthorityMode.Legacy &&
        current.mode !== InventoryAuthorityMode.Shadow &&
        current.mode !== InventoryAuthorityMode.DualRun
      ) {
        throw new Error(
          "InventoryOnce authority state is inconsistent: a non-legacy mode retains a writer admission."
        );
      }
      const nextWriters = current.activeLegacyWriters.filter(
        /** Remove exactly the released stable writer identity. */
        (writer) => writer.writerToken !== writerToken
      );
      const changed = await this.store.compareAndSet(
        {
          revision: current.revision,
          mode: current.mode,
          activeLegacyWritersJson: serializeActiveWriters(
            current.activeLegacyWriters
          ),
        },
        {
          revision: nextInventoryAuthorityRevision(current.revision),
          activeLegacyWritersJson: serializeActiveWriters(nextWriters),
        }
      );
      if (changed) return this.read();
    }
    throw new Error(
      "InventoryOnce legacy writer release exceeded its CAS retry bound."
    );
  }

  /** Claim the source write fence idempotently. */
  async claimFence(
    input: ClaimInventoryAuthorityFenceInput
  ): Promise<InventoryAuthorityState> {
    const token = requireText(input.fenceToken, "fenceToken");
    const startedAt = requireCanonicalTime(input.startedAt, "fence startedAt");
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.Authoritative) {
      if (current.fenceToken === token) return current;
      throw new Error(
        "InventoryOnce is already authoritative under another cutover token."
      );
    }
    if (current.mode === InventoryAuthorityMode.Fencing) {
      if (current.fenceToken === token) return current;
      throw new Error(
        "Another InventoryOnce cutover already owns the write fence."
      );
    }
    if (current.mode !== InventoryAuthorityMode.DualRun) {
      throw new Error("InventoryOnce source fence must follow DualRun mode.");
    }
    if (current.cutoverAuthorizationId.length === 0) {
      throw new Error(
        "InventoryOnce source fence requires explicit durable cutover authorization."
      );
    }
    if (current.dualRunMismatchEvidence.length !== 0) {
      throw new Error(
        "InventoryOnce source fence is blocked by unresolved DualRun mismatch evidence."
      );
    }
    if (current.sourceRoot.length === 0) {
      throw new Error(
        "InventoryOnce source fence requires a complete source root."
      );
    }
    if (
      input.sourceRoot !== undefined &&
      input.sourceRoot !== current.sourceRoot
    ) {
      throw new Error(
        "InventoryOnce source fence source root differs from DualRun evidence."
      );
    }
    if (
      input.sourceRevision !== undefined &&
      input.sourceRevision !== current.sourceRevision
    ) {
      throw new Error(
        "InventoryOnce source fence source revision differs from DualRun evidence."
      );
    }
    if (current.activeLegacyWriters.length !== 0) {
      throw new Error(
        `InventoryOnce cutover cannot claim the source fence while legacy writers are active: ${formatActiveWriterTokens(
          current.activeLegacyWriters
        )}.`
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.DualRun,
        cutoverAuthorizationId: current.cutoverAuthorizationId,
        fenceToken: "",
        activeLegacyWritersJson: "[]",
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        mode: InventoryAuthorityMode.Fencing,
        fenceToken: token,
        fenceStartedAt: startedAt,
        sourcePlanDigest: current.sourcePlanDigest,
        sourceCatalogDigest: current.sourceCatalogDigest,
        targetWorldRoot: "",
        targetWorldRevision: 0,
        activatedAt: "",
      }
    );
    const next = await this.read();
    if (!changed) {
      if (
        next.mode === InventoryAuthorityMode.Fencing &&
        next.fenceToken === token
      )
        return next;
      if (
        (next.mode === InventoryAuthorityMode.Legacy ||
          next.mode === InventoryAuthorityMode.Shadow ||
          next.mode === InventoryAuthorityMode.DualRun) &&
        next.activeLegacyWriters.length !== 0
      ) {
        throw new Error(
          `InventoryOnce cutover cannot claim the source fence while legacy writers are active: ${formatActiveWriterTokens(
            next.activeLegacyWriters
          )}.`
        );
      }
      throw new Error(
        "InventoryOnce authority fence CAS lost to another transition."
      );
    }
    return next;
  }

  /** Activate InventoryOnce only with stable source and published target evidence. */
  async activate(
    input: ActivateInventoryAuthorityInput
  ): Promise<InventoryAuthorityState> {
    const token = requireText(input.fenceToken, "fenceToken");
    const sourcePlanDigest = requireText(
      input.sourcePlanDigest,
      "sourcePlanDigest"
    );
    const sourceCatalogDigest = requireText(
      input.sourceCatalogDigest,
      "sourceCatalogDigest"
    );
    const targetWorldRoot = requireText(
      input.targetWorldRoot,
      "targetWorldRoot"
    );
    const activatedAt = requireCanonicalTime(input.activatedAt, "activatedAt");
    if (
      !Number.isSafeInteger(input.targetWorldRevision) ||
      input.targetWorldRevision < 0
    ) {
      throw new Error(
        "InventoryOnce target world revision must be a non-negative safe integer."
      );
    }
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.Authoritative) {
      assertActivationMatches(current, input);
      return current;
    }
    if (
      current.mode !== InventoryAuthorityMode.Fencing ||
      current.fenceToken !== token
    ) {
      throw new Error(
        "InventoryOnce activation does not own the current write fence."
      );
    }
    if (current.cutoverAuthorizationId.length === 0) {
      throw new Error(
        "InventoryOnce activation is missing durable legacy-cutover authorization."
      );
    }
    if (current.activeLegacyWriters.length !== 0) {
      throw new Error(
        "InventoryOnce activation cannot retain legacy writer admissions."
      );
    }
    if (
      current.adapterCertificationDigest.length === 0 ||
      current.sourceRoot.length === 0
    ) {
      throw new Error(
        "InventoryOnce activation is missing adapter certification or source-root evidence."
      );
    }
    if (current.dualRunMismatchEvidence.length !== 0) {
      throw new Error(
        "InventoryOnce activation is blocked by unresolved DualRun mismatch evidence."
      );
    }
    if (
      sourcePlanDigest !== current.sourcePlanDigest ||
      sourceCatalogDigest !== current.sourceCatalogDigest
    ) {
      throw new Error(
        "InventoryOnce activation source plan/catalog differs from DualRun evidence."
      );
    }
    if (
      input.sourceRoot !== undefined &&
      input.sourceRoot !== current.sourceRoot
    ) {
      throw new Error(
        "InventoryOnce activation source root differs from fenced evidence."
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.Fencing,
        fenceToken: token,
        activeLegacyWritersJson: "[]",
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        mode: InventoryAuthorityMode.Authoritative,
        activationKind: InventoryAuthorityActivationKind.LegacyCutover,
        greenfieldAuthorizationId: "",
        sourcePlanDigest,
        sourceCatalogDigest,
        targetWorldRoot,
        targetWorldRevision: input.targetWorldRevision,
        activatedAt,
        compatibilityProjectionWorldRevision: 0,
        compatibilityProjectionStatus:
          InventoryCompatibilityProjectionStatus.Lagging,
        compatibilityProjectionError: "",
      }
    );
    const next = await this.read();
    if (!changed) {
      if (next.mode === InventoryAuthorityMode.Authoritative) {
        assertActivationMatches(next, input);
        return next;
      }
      throw new Error(
        "InventoryOnce authority activation CAS lost to another transition."
      );
    }
    return next;
  }

  /** Activate a certified revision-zero empty stream without legacy source fiction. */
  async activateGreenfield(
    input: ActivateGreenfieldInventoryAuthorityInput
  ): Promise<InventoryAuthorityState> {
    const authorizationId = requireText(
      input.authorizationId,
      "greenfield authorizationId"
    );
    const certificationDigest = requireText(
      input.certificationDigest,
      "greenfield certificationDigest"
    );
    const targetWorldRoot = requireText(
      input.targetWorldRoot,
      "greenfield targetWorldRoot"
    );
    const activatedAt = requireCanonicalTime(
      input.activatedAt,
      "greenfield activatedAt"
    );
    if (input.targetWorldRevision !== 0) {
      throw new Error(
        "InventoryOnce greenfield activation requires target world revision zero."
      );
    }
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.Authoritative) {
      assertGreenfieldActivationMatches(current, input);
      return current;
    }
    if (
      current.mode !== InventoryAuthorityMode.Legacy &&
      current.mode !== InventoryAuthorityMode.Shadow
    ) {
      throw new Error(
        "InventoryOnce greenfield activation must start from Legacy or Shadow mode."
      );
    }
    if (current.activeLegacyWriters.length !== 0) {
      throw new Error(
        `InventoryOnce greenfield activation cannot proceed while legacy writers are active: ${formatActiveWriterTokens(
          current.activeLegacyWriters
        )}.`
      );
    }
    if (
      current.adapterCertificationDigest !== certificationDigest ||
      current.adapterCertifiedAt.length === 0
    ) {
      throw new Error(
        "InventoryOnce greenfield activation requires the exact retained adapter certification."
      );
    }
    if (
      current.cutoverAuthorizationId.length !== 0 ||
      current.sourceRoot.length !== 0 ||
      current.sourcePlanDigest.length !== 0 ||
      current.sourceCatalogDigest.length !== 0 ||
      current.dualRunStartedAt.length !== 0 ||
      current.dualRunMismatchEvidence.length !== 0 ||
      current.fenceToken.length !== 0 ||
      current.fenceStartedAt.length !== 0
    ) {
      throw new Error(
        "InventoryOnce greenfield activation cannot reuse legacy source, migration, mismatch, or fence evidence."
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: current.mode,
        activeLegacyWritersJson: "[]",
        adapterCertificationDigest: certificationDigest,
        cutoverAuthorizationId: "",
        sourceRoot: "",
        sourcePlanDigest: "",
        sourceCatalogDigest: "",
        fenceToken: "",
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        mode: InventoryAuthorityMode.Authoritative,
        activationKind: InventoryAuthorityActivationKind.Greenfield,
        greenfieldAuthorizationId: authorizationId,
        targetWorldRoot,
        targetWorldRevision: 0,
        activatedAt,
        compatibilityProjectionWorldRevision: 0,
        compatibilityProjectionStatus:
          InventoryCompatibilityProjectionStatus.Current,
        compatibilityProjectionError: "",
      }
    );
    const next = await this.read();
    if (!changed) {
      if (next.mode === InventoryAuthorityMode.Authoritative) {
        assertGreenfieldActivationMatches(next, input);
        return next;
      }
      if (next.activeLegacyWriters.length !== 0) {
        throw new Error(
          `InventoryOnce greenfield activation lost to an admitted legacy writer: ${formatActiveWriterTokens(
            next.activeLegacyWriters
          )}.`
        );
      }
      throw new Error(
        "InventoryOnce greenfield authority activation CAS lost to another transition."
      );
    }
    return next;
  }

  /** Release an unpublished fence; authoritative state is irreversible here. */
  async releaseFence(fenceToken: string): Promise<InventoryAuthorityState> {
    const token = requireText(fenceToken, "fenceToken");
    const current = await this.read();
    if (current.mode === InventoryAuthorityMode.Legacy) return current;
    if (current.mode === InventoryAuthorityMode.Authoritative) {
      throw new Error(
        "Authoritative InventoryOnce cannot be reverted by fence release."
      );
    }
    if (current.fenceToken !== token) {
      throw new Error(
        "InventoryOnce fence release token does not own the fence."
      );
    }
    const changed = await this.store.compareAndSet(
      {
        revision: current.revision,
        mode: InventoryAuthorityMode.Fencing,
        fenceToken: token,
        activeLegacyWritersJson: "[]",
      },
      {
        revision: nextInventoryAuthorityRevision(current.revision),
        mode: InventoryAuthorityMode.DualRun,
        fenceToken: "",
        fenceStartedAt: "",
      }
    );
    const next = await this.read();
    if (!changed && next.mode !== InventoryAuthorityMode.DualRun) {
      throw new Error("InventoryOnce fence release CAS failed.");
    }
    return next;
  }

  /** Record one successful compatibility projection without changing physical authority. */
  async markCompatibilityProjectionApplied(
    input: MarkInventoryCompatibilityProjectionInput
  ): Promise<InventoryAuthorityState> {
    requireSafeNonNegativeInteger(
      input.worldRevision,
      "compatibility projection worldRevision"
    );
    return this.updateProjectionState({
      compatibilityProjectionWorldRevision: input.worldRevision,
      compatibilityProjectionStatus:
        InventoryCompatibilityProjectionStatus.Current,
      compatibilityProjectionError: "",
    });
  }

  /** Record a projector failure so an admin repair can retry the same world. */
  async markCompatibilityProjectionFailed(
    input: MarkInventoryCompatibilityProjectionFailureInput
  ): Promise<InventoryAuthorityState> {
    requireSafeNonNegativeInteger(
      input.worldRevision,
      "compatibility projection worldRevision"
    );
    const error = requireText(
      input.error,
      "compatibility projection error"
    ).slice(0, 2000);
    return this.updateProjectionState({
      compatibilityProjectionWorldRevision: input.worldRevision,
      compatibilityProjectionStatus:
        InventoryCompatibilityProjectionStatus.Failed,
      compatibilityProjectionError: error,
    });
  }

  /** CAS one projector status field while preserving the authoritative cutover evidence. */
  private async updateProjectionState(
    patch: Pick<
      InventoryAuthorityState,
      | "compatibilityProjectionWorldRevision"
      | "compatibilityProjectionStatus"
      | "compatibilityProjectionError"
    >
  ): Promise<InventoryAuthorityState> {
    for (let attempt = 0; attempt < AUTHORITY_CAS_RETRY_LIMIT; attempt += 1) {
      const current = await this.read();
      if (current.mode !== InventoryAuthorityMode.Authoritative) {
        throw new Error(
          "Compatibility projection status requires Authoritative mode."
        );
      }
      if (
        patch.compatibilityProjectionWorldRevision <
        current.compatibilityProjectionWorldRevision
      ) {
        return current;
      }
      const changed = await this.store.compareAndSet(
        {
          revision: current.revision,
          mode: InventoryAuthorityMode.Authoritative,
        },
        {
          revision: nextInventoryAuthorityRevision(current.revision),
          compatibilityProjectionWorldRevision:
            patch.compatibilityProjectionWorldRevision,
          compatibilityProjectionStatus: patch.compatibilityProjectionStatus,
          compatibilityProjectionError: patch.compatibilityProjectionError,
        }
      );
      if (changed) return this.read();
    }
    throw new Error(
      "InventoryOnce compatibility projection status CAS exceeded its retry bound."
    );
  }

  /** Ensure the durable class and default legacy row exist. */
  private async initialize(): Promise<void> {
    await this.store.ensure({
      namespaceId: "String",
      revision: "Number",
      mode: "String",
      activationKind: "String",
      cutoverAuthorizationId: "String",
      greenfieldAuthorizationId: "String",
      activeLegacyWritersJson: "String",
      fenceToken: "String",
      fenceStartedAt: "String",
      sourcePlanDigest: "String",
      sourceCatalogDigest: "String",
      targetWorldRoot: "String",
      targetWorldRevision: "Number",
      activatedAt: "String",
      adapterCertificationDigest: "String",
      adapterCertifiedAt: "String",
      sourceRoot: "String",
      sourceRevision: "Number",
      dualRunStartedAt: "String",
      dualRunMismatchEvidenceJson: "String",
      compatibilityProjectionWorldRevision: "Number",
      compatibilityProjectionStatus: "String",
      compatibilityProjectionError: "String",
    });
    const initial = stateDocument({
      namespaceId: this.namespaceId,
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
      compatibilityProjectionStatus:
        InventoryCompatibilityProjectionStatus.Lagging,
      compatibilityProjectionError: "",
    });
    const result = await this.store.create(initial);
    if (result === InventoryAuthorityCreateResult.Existing) {
      const row = await this.store.read();
      if (row === undefined || row.namespaceId !== this.namespaceId) {
        throw new Error(
          "InventoryOnce authority row identity does not match its namespace."
        );
      }
    }
  }
}

/** Convert one typed state into the flat durable document contract. */
function stateDocument(
  state: InventoryAuthorityState
): InventoryAuthorityDocument {
  return {
    namespaceId: state.namespaceId,
    revision: state.revision,
    mode: state.mode,
    activationKind: state.activationKind,
    cutoverAuthorizationId: state.cutoverAuthorizationId,
    greenfieldAuthorizationId: state.greenfieldAuthorizationId,
    activeLegacyWritersJson: serializeActiveWriters(state.activeLegacyWriters),
    fenceToken: state.fenceToken,
    fenceStartedAt: state.fenceStartedAt,
    sourcePlanDigest: state.sourcePlanDigest,
    sourceCatalogDigest: state.sourceCatalogDigest,
    targetWorldRoot: state.targetWorldRoot,
    targetWorldRevision: state.targetWorldRevision,
    activatedAt: state.activatedAt,
    adapterCertificationDigest: state.adapterCertificationDigest,
    adapterCertifiedAt: state.adapterCertifiedAt,
    sourceRoot: state.sourceRoot,
    sourceRevision: state.sourceRevision,
    dualRunStartedAt: state.dualRunStartedAt,
    dualRunMismatchEvidenceJson: serializeMismatchEvidence(
      state.dualRunMismatchEvidence
    ),
    compatibilityProjectionWorldRevision:
      state.compatibilityProjectionWorldRevision,
    compatibilityProjectionStatus: state.compatibilityProjectionStatus,
    compatibilityProjectionError: state.compatibilityProjectionError,
  };
}

/** Parse and validate one durable authority row. */
function parseState(
  row: InventoryAuthorityDocument,
  expectedNamespaceId: string
): InventoryAuthorityState {
  const namespaceId = requireString(row, "namespaceId");
  if (namespaceId !== expectedNamespaceId) {
    throw new Error(
      "InventoryOnce authority namespace does not match its row."
    );
  }
  const mode = requireMode(row);
  const activationKind = requireActivationKind(row, mode);
  const cutoverAuthorizationId = optionalString(row, "cutoverAuthorizationId");
  const greenfieldAuthorizationId = optionalString(
    row,
    "greenfieldAuthorizationId"
  );
  const activeLegacyWriters = parseActiveWriters(
    requireString(row, "activeLegacyWritersJson")
  );
  if (
    (mode === InventoryAuthorityMode.Fencing ||
      mode === InventoryAuthorityMode.Authoritative) &&
    activeLegacyWriters.length !== 0
  ) {
    throw new Error(
      "InventoryOnce fenced/authoritative state cannot retain legacy writer admissions."
    );
  }
  if (
    mode === InventoryAuthorityMode.Authoritative &&
    activationKind === InventoryAuthorityActivationKind.None
  ) {
    throw new Error(
      "InventoryOnce authoritative state must retain explicit activation provenance."
    );
  }
  if (
    mode !== InventoryAuthorityMode.Authoritative &&
    activationKind !== InventoryAuthorityActivationKind.None
  ) {
    throw new Error(
      "InventoryOnce non-authoritative state cannot retain completed activation provenance."
    );
  }
  if (cutoverAuthorizationId.length !== 0 && greenfieldAuthorizationId.length !== 0) {
    throw new Error(
      "InventoryOnce authority cannot retain both legacy-cutover and greenfield authorization."
    );
  }
  if (
    (mode === InventoryAuthorityMode.Fencing ||
      (mode === InventoryAuthorityMode.Authoritative &&
        activationKind === InventoryAuthorityActivationKind.LegacyCutover)) &&
    cutoverAuthorizationId.length === 0
  ) {
    throw new Error(
      "InventoryOnce fenced/legacy-authoritative state is missing cutover authorization."
    );
  }
  if (
    activationKind === InventoryAuthorityActivationKind.Greenfield &&
    greenfieldAuthorizationId.length === 0
  ) {
    throw new Error(
      "InventoryOnce greenfield authority is missing deployment authorization."
    );
  }
  if (
    activationKind !== InventoryAuthorityActivationKind.Greenfield &&
    greenfieldAuthorizationId.length !== 0
  ) {
    throw new Error(
      "InventoryOnce non-greenfield authority cannot retain greenfield authorization."
    );
  }
  const state: InventoryAuthorityState = {
    namespaceId,
    revision: requireNonNegativeInteger(row, "revision"),
    mode,
    activationKind,
    cutoverAuthorizationId,
    greenfieldAuthorizationId,
    activeLegacyWriters,
    fenceToken: requireString(row, "fenceToken"),
    fenceStartedAt: requireString(row, "fenceStartedAt"),
    sourcePlanDigest: requireString(row, "sourcePlanDigest"),
    sourceCatalogDigest: requireString(row, "sourceCatalogDigest"),
    targetWorldRoot: requireString(row, "targetWorldRoot"),
    targetWorldRevision: requireNonNegativeInteger(row, "targetWorldRevision"),
    activatedAt: requireString(row, "activatedAt"),
    adapterCertificationDigest: requireString(
      row,
      "adapterCertificationDigest"
    ),
    adapterCertifiedAt: requireString(row, "adapterCertifiedAt"),
    sourceRoot: requireString(row, "sourceRoot"),
    sourceRevision: requireNonNegativeInteger(row, "sourceRevision"),
    dualRunStartedAt: requireString(row, "dualRunStartedAt"),
    dualRunMismatchEvidence: parseMismatchEvidence(
      requireString(row, "dualRunMismatchEvidenceJson")
    ),
    compatibilityProjectionWorldRevision: requireNonNegativeInteger(
      row,
      "compatibilityProjectionWorldRevision"
    ),
    compatibilityProjectionStatus: requireProjectionStatus(row),
    compatibilityProjectionError: requireString(
      row,
      "compatibilityProjectionError"
    ),
  };
  assertInventoryAuthorityDurableStateReachable(state);
  return state;
}

/** Reject durable field combinations that no InventoryAuthorityControl transition can persist. */
function assertInventoryAuthorityDurableStateReachable(
  state: InventoryAuthorityState
): void {
  /** Whether adapter certification has been durably accepted. */
  const adapterCertified = state.adapterCertificationDigest.length !== 0;
  if (adapterCertified !== (state.adapterCertifiedAt.length !== 0)) {
    throw new Error(
      "InventoryOnce authority adapter certification digest/time must be retained together."
    );
  }
  if (adapterCertified) {
    requireCanonicalStoredText(
      state.adapterCertificationDigest,
      "adapterCertificationDigest"
    );
    requireCanonicalStoredTime(state.adapterCertifiedAt, "adapterCertifiedAt");
  }
  if (state.cutoverAuthorizationId.length !== 0)
    requireCanonicalStoredText(
      state.cutoverAuthorizationId,
      "cutoverAuthorizationId"
    );
  if (state.greenfieldAuthorizationId.length !== 0)
    requireCanonicalStoredText(
      state.greenfieldAuthorizationId,
      "greenfieldAuthorizationId"
    );

  /** Source evidence is written atomically when Shadow becomes DualRun. */
  const sourceParts = [
    state.sourceRoot,
    state.sourcePlanDigest,
    state.sourceCatalogDigest,
    state.dualRunStartedAt,
  ];
  /** Number of fields present in the atomic source-evidence bundle. */
  let sourcePartCount = 0;
  for (const value of sourceParts) {
    if (value.length !== 0) sourcePartCount += 1;
  }
  if (sourcePartCount !== 0 && sourcePartCount !== sourceParts.length) {
    throw new Error(
      "InventoryOnce authority source evidence must be retained as one complete bundle."
    );
  }
  const sourceBound = sourcePartCount === sourceParts.length;
  if (sourceBound) {
    requireCanonicalStoredText(state.sourceRoot, "sourceRoot");
    requireCanonicalStoredText(state.sourcePlanDigest, "sourcePlanDigest");
    requireCanonicalStoredText(state.sourceCatalogDigest, "sourceCatalogDigest");
    requireCanonicalStoredTime(state.dualRunStartedAt, "DualRun startedAt");
  } else if (state.sourceRevision !== 0) {
    throw new Error(
      "InventoryOnce authority cannot retain a source revision without complete source evidence."
    );
  }

  /** Fence token and start time are created and released as one pair. */
  const fenceTokenPresent = state.fenceToken.length !== 0;
  const fenceTimePresent = state.fenceStartedAt.length !== 0;
  if (fenceTokenPresent !== fenceTimePresent) {
    throw new Error(
      "InventoryOnce authority fence token/time must be retained together."
    );
  }
  const fenceBound = fenceTokenPresent && fenceTimePresent;
  if (fenceBound) {
    requireCanonicalStoredText(state.fenceToken, "fenceToken");
    requireCanonicalStoredTime(state.fenceStartedAt, "fence startedAt");
  }

  /** Activation target root and time are published together. */
  const targetRootPresent = state.targetWorldRoot.length !== 0;
  const activatedAtPresent = state.activatedAt.length !== 0;
  if (targetRootPresent !== activatedAtPresent) {
    throw new Error(
      "InventoryOnce authority target root/activation time must be retained together."
    );
  }
  const targetBound = targetRootPresent && activatedAtPresent;
  if (targetBound) {
    requireCanonicalStoredText(state.targetWorldRoot, "targetWorldRoot");
    requireCanonicalStoredTime(state.activatedAt, "activatedAt");
  } else if (state.targetWorldRevision !== 0) {
    throw new Error(
      "InventoryOnce authority cannot retain a target revision before activation."
    );
  }

  if (state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Failed) {
    requireCanonicalStoredText(
      state.compatibilityProjectionError,
      "compatibility projection error"
    );
    if (state.compatibilityProjectionError.length > 2000) {
      throw new Error(
        "InventoryOnce compatibility projection error exceeds its durable bound."
      );
    }
  } else if (state.compatibilityProjectionError.length !== 0) {
    throw new Error(
      "InventoryOnce non-failed compatibility projection cannot retain an error."
    );
  }
  if (
    state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Lagging &&
    state.compatibilityProjectionWorldRevision !== 0
  ) {
    throw new Error(
      "InventoryOnce lagging compatibility projection must remain at revision zero until first projection."
    );
  }

  /** DualRun is the only phase in which unresolved mismatch evidence can exist. */
  if (
    state.mode !== InventoryAuthorityMode.DualRun &&
    state.dualRunMismatchEvidence.length !== 0
  ) {
    throw new Error(
      "InventoryOnce authority can retain DualRun mismatch evidence only in DualRun mode."
    );
  }

  /** Every phase after Legacy descends from one accepted adapter certification. */
  if (state.mode !== InventoryAuthorityMode.Legacy && !adapterCertified) {
    throw new Error(
      "InventoryOnce non-legacy authority state is missing adapter certification."
    );
  }

  const legacyActivation =
    state.mode === InventoryAuthorityMode.Authoritative &&
    state.activationKind === InventoryAuthorityActivationKind.LegacyCutover;
  const greenfieldActivation =
    state.mode === InventoryAuthorityMode.Authoritative &&
    state.activationKind === InventoryAuthorityActivationKind.Greenfield;
  const sourceRequired =
    state.mode === InventoryAuthorityMode.DualRun ||
    state.mode === InventoryAuthorityMode.Fencing ||
    legacyActivation;
  if (sourceBound !== sourceRequired) {
    throw new Error(
      "InventoryOnce authority source evidence does not match its durable phase."
    );
  }
  const fenceRequired = state.mode === InventoryAuthorityMode.Fencing || legacyActivation;
  if (fenceBound !== fenceRequired) {
    throw new Error(
      "InventoryOnce authority fence evidence does not match its durable phase."
    );
  }
  if (targetBound !== (state.mode === InventoryAuthorityMode.Authoritative)) {
    throw new Error(
      "InventoryOnce authority target evidence does not match its durable phase."
    );
  }

  if (state.mode !== InventoryAuthorityMode.Authoritative) {
    if (
      state.compatibilityProjectionStatus !== InventoryCompatibilityProjectionStatus.Lagging ||
      state.compatibilityProjectionWorldRevision !== 0
    ) {
      throw new Error(
        "InventoryOnce pre-authority state cannot retain compatibility projection progress."
      );
    }
  } else if (
    greenfieldActivation &&
    state.compatibilityProjectionStatus === InventoryCompatibilityProjectionStatus.Lagging
  ) {
    throw new Error(
      "InventoryOnce greenfield authority cannot enter the legacy-cutover lagging projection state."
    );
  }

  if (
    (state.mode === InventoryAuthorityMode.Fencing || legacyActivation) &&
    state.cutoverAuthorizationId.length === 0
  ) {
    throw new Error(
      "InventoryOnce fenced/legacy-authoritative state is missing cutover authorization."
    );
  }
  if (greenfieldActivation) {
    if (state.cutoverAuthorizationId.length !== 0 || !adapterCertified) {
      throw new Error(
        "InventoryOnce greenfield authority cannot retain legacy cutover evidence."
      );
    }
    if (state.targetWorldRevision !== 0) {
      throw new Error(
        "InventoryOnce greenfield authority must retain target world revision zero."
      );
    }
  }
}

/** Require one persisted text field to already equal the writer-side trimmed form. */
function requireCanonicalStoredText(value: string, label: string): string {
  const normalized = requireText(value, label);
  if (normalized !== value) {
    throw new Error(
      `InventoryOnce authority ${label} is not stored in canonical trimmed form.`
    );
  }
  return value;
}

/** Require one persisted timestamp to already equal the writer-side canonical UTC form. */
function requireCanonicalStoredTime(value: string, label: string): string {
  const normalized = requireCanonicalTime(value, label);
  if (normalized !== value) {
    throw new Error(
      `InventoryOnce authority ${label} is not stored in canonical UTC form.`
    );
  }
  return value;
}

/** Read explicit activation provenance, inferring legacy cutover for pre-field authoritative rows. */
function requireActivationKind(
  row: InventoryAuthorityDocument,
  mode: InventoryAuthorityMode
): InventoryAuthorityActivationKind {
  const raw = row.activationKind;
  if (raw === undefined) {
    return mode === InventoryAuthorityMode.Authoritative
      ? InventoryAuthorityActivationKind.LegacyCutover
      : InventoryAuthorityActivationKind.None;
  }
  if (
    raw !== InventoryAuthorityActivationKind.None &&
    raw !== InventoryAuthorityActivationKind.LegacyCutover &&
    raw !== InventoryAuthorityActivationKind.Greenfield
  ) {
    throw new Error(
      `Unknown InventoryOnce authority activation kind '${String(raw)}'.`
    );
  }
  return raw;
}

/** Read one optional durable string, defaulting a newly introduced field for old rows. */
function optionalString(
  row: InventoryAuthorityDocument,
  field: string
): string {
  const value = row[field];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error(
      `InventoryOnce authority field '${field}' must be a string when present.`
    );
  }
  return value;
}

/** Require one supported authority mode. */
function requireMode(row: InventoryAuthorityDocument): InventoryAuthorityMode {
  const value = requireString(row, "mode");
  if (
    value !== InventoryAuthorityMode.Legacy &&
    value !== InventoryAuthorityMode.Shadow &&
    value !== InventoryAuthorityMode.DualRun &&
    value !== InventoryAuthorityMode.Fencing &&
    value !== InventoryAuthorityMode.Authoritative
  ) {
    throw new Error(`Unknown InventoryOnce authority mode '${value}'.`);
  }
  return value;
}

/** One durable mismatch record retained until an operator repairs DualRun. */
export interface InventoryDualRunMismatchEvidence {
  /** Stable command identity. */
  readonly commandId: string;
  /** Legacy intent/result digest. */
  readonly legacyIntentDigest: string;
  /** InventoryOnce intent/result digest. */
  readonly authoritativeIntentDigest: string;
  /** Canonical mismatch time. */
  readonly recordedAt: string;
}

/** Parse canonical mismatch evidence and reject malformed durable state. */
function parseMismatchEvidence(
  value: string
): readonly InventoryDualRunMismatchEvidence[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("InventoryOnce DualRun mismatch evidence JSON is invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "InventoryOnce DualRun mismatch evidence must be an array."
    );
  }
  const evidence: InventoryDualRunMismatchEvidence[] = [];
  /** Commands are idempotent mismatch identities and may appear at most once. */
  const seenCommandIds = new Set<string>();
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("commandId" in entry) ||
      !("legacyIntentDigest" in entry) ||
      !("authoritativeIntentDigest" in entry) ||
      !("recordedAt" in entry) ||
      typeof entry.commandId !== "string" ||
      typeof entry.legacyIntentDigest !== "string" ||
      typeof entry.authoritativeIntentDigest !== "string" ||
      typeof entry.recordedAt !== "string"
    ) {
      throw new Error(
        "InventoryOnce DualRun mismatch evidence entry is invalid."
      );
    }
    const commandId = requireCanonicalStoredText(
      entry.commandId,
      "mismatch commandId"
    );
    if (seenCommandIds.has(commandId)) {
      throw new Error(
        `InventoryOnce DualRun mismatch evidence repeats command '${commandId}'.`
      );
    }
    seenCommandIds.add(commandId);
    evidence.push({
      commandId,
      legacyIntentDigest: requireCanonicalStoredText(
        entry.legacyIntentDigest,
        "mismatch legacyIntentDigest"
      ),
      authoritativeIntentDigest: requireCanonicalStoredText(
        entry.authoritativeIntentDigest,
        "mismatch authoritativeIntentDigest"
      ),
      recordedAt: requireCanonicalStoredTime(
        entry.recordedAt,
        "mismatch recordedAt"
      ),
    });
  }
  const normalized = [...evidence].sort(compareMismatchEvidence);
  if (JSON.stringify(normalized) !== value) {
    throw new Error(
      "InventoryOnce DualRun mismatch evidence is not canonical."
    );
  }
  return normalized;
}

/** Serialize mismatch evidence in one canonical durable order. */
function serializeMismatchEvidence(
  evidence: readonly InventoryDualRunMismatchEvidence[]
): string {
  return JSON.stringify([...evidence].sort(compareMismatchEvidence));
}

/** Locale-independent lexicographic code-unit ordering for durable canonical serializers. */
function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Sort mismatch evidence by stable command identity and time. */
function compareMismatchEvidence(
  left: InventoryDualRunMismatchEvidence,
  right: InventoryDualRunMismatchEvidence
): number {
  const commandOrder = compareCanonicalText(left.commandId, right.commandId);
  return commandOrder === 0
    ? compareCanonicalText(left.recordedAt, right.recordedAt)
    : commandOrder;
}

/** Require one safe non-negative integer used for a source revision. */
function requireSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `InventoryOnce authority ${label} must be a non-negative safe integer.`
    );
  }
}

/** Return the next durable authority revision without ever publishing an unreadable number. */
function nextInventoryAuthorityRevision(revision: number): number {
  requireSafeNonNegativeInteger(revision, "revision");
  const nextRevision = revision + 1;
  requireSafeNonNegativeInteger(nextRevision, "next revision");
  return nextRevision;
}

/** Require one supported compatibility projection status. */
function requireProjectionStatus(
  row: InventoryAuthorityDocument
): InventoryCompatibilityProjectionStatus {
  const value = requireString(row, "compatibilityProjectionStatus");
  if (
    value !== InventoryCompatibilityProjectionStatus.Current &&
    value !== InventoryCompatibilityProjectionStatus.Lagging &&
    value !== InventoryCompatibilityProjectionStatus.Failed
  ) {
    throw new Error(
      `Unknown InventoryOnce compatibility projection status '${value}'.`
    );
  }
  return value;
}

/** Normalize and sort active writer attempts while rejecting duplicate writer identities. */
function normalizeActiveWriters(
  writers: readonly InventoryLegacyWriterAdmission[]
): readonly InventoryLegacyWriterAdmission[] {
  const normalized: InventoryLegacyWriterAdmission[] = [];
  const seen = new Set<string>();
  for (const writer of writers) {
    const writerToken = requireText(writer.writerToken, "writerToken");
    const attemptToken = requireText(writer.attemptToken, "attemptToken");
    if (seen.has(writerToken)) {
      throw new Error(
        `InventoryOnce authority repeats legacy writer token '${writerToken}'.`
      );
    }
    seen.add(writerToken);
    normalized.push({ writerToken, attemptToken });
  }
  normalized.sort(compareActiveWriters);
  return normalized;
}

/** Canonical durable JSON for one active writer set. */
function serializeActiveWriters(
  writers: readonly InventoryLegacyWriterAdmission[]
): string {
  return JSON.stringify(normalizeActiveWriters(writers));
}

/** Parse and require canonical durable active-writer JSON. */
function parseActiveWriters(
  value: string
): readonly InventoryLegacyWriterAdmission[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("InventoryOnce active legacy writer JSON is invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "InventoryOnce active legacy writer JSON must be an array."
    );
  }
  const writers: InventoryLegacyWriterAdmission[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("writerToken" in entry) ||
      !("attemptToken" in entry) ||
      typeof entry.writerToken !== "string" ||
      typeof entry.attemptToken !== "string"
    ) {
      throw new Error("InventoryOnce active legacy writer entry is invalid.");
    }
    writers.push({
      writerToken: entry.writerToken,
      attemptToken: entry.attemptToken,
    });
  }
  const normalized = normalizeActiveWriters(writers);
  if (JSON.stringify(normalized) !== value) {
    throw new Error(
      "InventoryOnce active legacy writer JSON is not canonical."
    );
  }
  return normalized;
}

/** Sort active writer attempts by stable writer then attempt identity. */
function compareActiveWriters(
  left: InventoryLegacyWriterAdmission,
  right: InventoryLegacyWriterAdmission
): number {
  const writerOrder = compareCanonicalText(left.writerToken, right.writerToken);
  return writerOrder === 0
    ? compareCanonicalText(left.attemptToken, right.attemptToken)
    : writerOrder;
}

/** Render active stable writer identities for fail-closed cutover diagnostics. */
function formatActiveWriterTokens(
  writers: readonly InventoryLegacyWriterAdmission[]
): string {
  return writers
    .map(
      /** Render only the stable writer identity, never the attempt token. */
      (writer) => writer.writerToken
    )
    .join(", ");
}

/** Verify an idempotent activation attempt matches durable evidence. */
function assertActivationMatches(
  current: InventoryAuthorityState,
  input: ActivateInventoryAuthorityInput
): void {
  if (
    current.activationKind !== InventoryAuthorityActivationKind.LegacyCutover ||
    current.cutoverAuthorizationId.length === 0 ||
    current.greenfieldAuthorizationId.length !== 0 ||
    current.fenceToken !== input.fenceToken.trim() ||
    current.sourcePlanDigest !== input.sourcePlanDigest.trim() ||
    current.sourceCatalogDigest !== input.sourceCatalogDigest.trim() ||
    current.targetWorldRoot !== input.targetWorldRoot.trim() ||
    current.targetWorldRevision !== input.targetWorldRevision ||
    (input.sourceRoot !== undefined && current.sourceRoot !== input.sourceRoot)
  ) {
    throw new Error(
      "InventoryOnce authoritative state differs from activation evidence."
    );
  }
}

/** Verify an idempotent greenfield activation matches exact durable evidence. */
function assertGreenfieldActivationMatches(
  current: InventoryAuthorityState,
  input: ActivateGreenfieldInventoryAuthorityInput
): void {
  if (
    current.activationKind !== InventoryAuthorityActivationKind.Greenfield ||
    current.cutoverAuthorizationId.length !== 0 ||
    current.greenfieldAuthorizationId !== input.authorizationId.trim() ||
    current.adapterCertificationDigest !== input.certificationDigest.trim() ||
    current.targetWorldRoot !== input.targetWorldRoot.trim() ||
    current.targetWorldRevision !== 0 ||
    current.sourceRoot.length !== 0 ||
    current.sourcePlanDigest.length !== 0 ||
    current.sourceCatalogDigest.length !== 0 ||
    current.fenceToken.length !== 0
  ) {
    throw new Error(
      "InventoryOnce greenfield authoritative state differs from activation evidence."
    );
  }
}

/** Require one non-empty identity/digest. */
function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`InventoryOnce authority ${label} must not be empty.`);
  }
  return normalized;
}

/** Require one canonical UTC ISO instant. */
function requireCanonicalTime(value: string, label: string): string {
  const normalized = requireText(value, label);
  const parsed = new Date(normalized);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== normalized
  ) {
    throw new Error(
      `InventoryOnce authority ${label} must be canonical UTC ISO time.`
    );
  }
  return normalized;
}

/** Read one required string field. */
function requireString(row: InventoryAuthorityDocument, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new Error(
      `InventoryOnce authority field '${field}' must be a string.`
    );
  }
  return value;
}

/** Read one required non-negative safe integer field. */
function requireNonNegativeInteger(
  row: InventoryAuthorityDocument,
  field: string
): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `InventoryOnce authority field '${field}' must be a non-negative safe integer.`
    );
  }
  return value;
}

/** Require one exact authority mode before an application may enter a gated operation. */
export function requireInventoryAuthorityMode<TMode extends string>(
  actual: TMode,
  required: TMode,
  operation = "Inventory operation"
): void {
  if (actual !== required) {
    throw new Error(
      `${operation} requires authority mode '${required}', current mode is '${actual}'.`
    );
  }
}
