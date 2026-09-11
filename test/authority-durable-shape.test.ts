import { describe, expect, it } from "vitest";

import {
  createInventoryAuthorityControl,
  InventoryAuthorityActivationKind,
  InventoryAuthorityCreateResult,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
  type InventoryAuthorityDocument,
  type InventoryAuthorityFields,
  type InventoryAuthorityStateStore,
} from "../src/authority.js";

const time0 = "2030-01-01T00:00:00.000Z";
const time1 = "2030-01-01T00:00:01.000Z";
const time2 = "2030-01-01T00:00:02.000Z";

/** Mutable in-memory authority row used to probe the real public read/parser path. */
class MutableAuthorityStore implements InventoryAuthorityStateStore {
  /** Current durable row, exposed only so the test can inject one persisted shape. */
  document: InventoryAuthorityDocument | undefined;

  /** Seed an optional pre-existing durable row. */
  constructor(document?: InventoryAuthorityDocument) {
    this.document = document;
  }

  /** Schema declaration is irrelevant to this row-only test store. */
  ensure(_fields: InventoryAuthorityFields): Promise<void> {
    return Promise.resolve();
  }

  /** Read the current durable row. */
  read(): Promise<InventoryAuthorityDocument | undefined> {
    return Promise.resolve(this.document);
  }

  /** Create the namespace row once. */
  create(
    document: InventoryAuthorityDocument
  ): Promise<InventoryAuthorityCreateResult> {
    if (this.document !== undefined)
      return Promise.resolve(InventoryAuthorityCreateResult.Existing);
    this.document = { ...document };
    return Promise.resolve(InventoryAuthorityCreateResult.Created);
  }

  /** Merge a replacement only when every expected scalar still matches. */
  compareAndSet(
    expected: InventoryAuthorityDocument,
    replacement: InventoryAuthorityDocument
  ): Promise<boolean> {
    if (this.document === undefined) return Promise.resolve(false);
    for (const key of Object.keys(expected)) {
      if (this.document[key] !== expected[key]) return Promise.resolve(false);
    }
    this.document = { ...this.document, ...replacement };
    return Promise.resolve(true);
  }
}

/** One finite semantic class in the durable AuthorityControl state-shape census. */
interface DurableShapeCase {
  /** Durable authority phase under test. */
  readonly mode: InventoryAuthorityMode;
  /** Retained provenance of activation. */
  readonly activationKind: InventoryAuthorityActivationKind;
  /** Durable compatibility projection phase. */
  readonly projectionStatus: InventoryCompatibilityProjectionStatus;
  /** Whether the certification digest/time bundle is present. */
  readonly certified: boolean;
  /** Whether legacy cutover authorization is present. */
  readonly cutoverAuthorized: boolean;
  /** Whether greenfield authorization is present. */
  readonly greenfieldAuthorized: boolean;
  /** Whether an admitted legacy writer is retained. */
  readonly activeWriter: boolean;
  /** Whether the entire source snapshot evidence bundle is present. */
  readonly sourceBound: boolean;
  /** Whether one unresolved DualRun mismatch exists. */
  readonly mismatchPresent: boolean;
  /** Whether fence identity and start time are both retained. */
  readonly fenceBound: boolean;
  /** Whether activation target and time are both retained. */
  readonly targetBound: boolean;
  /** Whether the retained target world revision is nonzero. */
  readonly targetRevisionNonzero: boolean;
  /** Whether the compatibility projection revision is nonzero. */
  readonly projectionRevisionNonzero: boolean;
}

/** Build one canonical typed durable row for a semantic state-shape class. */
function durableRow(
  base: InventoryAuthorityDocument,
  shape: DurableShapeCase
): InventoryAuthorityDocument {
  const mismatch = shape.mismatchPresent
    ? [
        {
          commandId: "command-a",
          legacyIntentDigest: "legacy-a",
          authoritativeIntentDigest: "native-b",
          recordedAt: time1,
        },
      ]
    : [];
  return {
    ...base,
    revision: 10,
    mode: shape.mode,
    activationKind: shape.activationKind,
    cutoverAuthorizationId: shape.cutoverAuthorized ? "cutover-a" : "",
    greenfieldAuthorizationId: shape.greenfieldAuthorized ? "greenfield-a" : "",
    activeLegacyWritersJson: shape.activeWriter
      ? '[{"writerToken":"writer-a","attemptToken":"attempt-a"}]'
      : "[]",
    adapterCertificationDigest: shape.certified ? "adapter-a" : "",
    adapterCertifiedAt: shape.certified ? time0 : "",
    sourceRoot: shape.sourceBound ? "source-root" : "",
    sourceRevision: shape.sourceBound ? 7 : 0,
    sourcePlanDigest: shape.sourceBound ? "source-plan" : "",
    sourceCatalogDigest: shape.sourceBound ? "source-catalog" : "",
    dualRunStartedAt: shape.sourceBound ? time1 : "",
    dualRunMismatchEvidenceJson: JSON.stringify(mismatch),
    fenceToken: shape.fenceBound ? "fence-a" : "",
    fenceStartedAt: shape.fenceBound ? time2 : "",
    targetWorldRoot: shape.targetBound ? "target-root" : "",
    targetWorldRevision: shape.targetRevisionNonzero ? 1 : 0,
    activatedAt: shape.targetBound ? time2 : "",
    compatibilityProjectionWorldRevision: shape.projectionRevisionNonzero ? 1 : 0,
    compatibilityProjectionStatus: shape.projectionStatus,
    compatibilityProjectionError:
      shape.projectionStatus === InventoryCompatibilityProjectionStatus.Failed
        ? "projection-failed"
        : "",
  };
}

/** Independent phase oracle for field combinations the real controller can persist. */
function reachableDurableShape(shape: DurableShapeCase): boolean {
  const authoritative = shape.mode === InventoryAuthorityMode.Authoritative;
  const legacyActivation =
    authoritative &&
    shape.activationKind === InventoryAuthorityActivationKind.LegacyCutover;
  const greenfieldActivation =
    authoritative &&
    shape.activationKind === InventoryAuthorityActivationKind.Greenfield;

  if (authoritative === (shape.activationKind === InventoryAuthorityActivationKind.None))
    return false;
  if (shape.greenfieldAuthorized !== greenfieldActivation) return false;
  if (shape.mode !== InventoryAuthorityMode.Legacy && !shape.certified) return false;

  const sourceRequired =
    shape.mode === InventoryAuthorityMode.DualRun ||
    shape.mode === InventoryAuthorityMode.Fencing ||
    legacyActivation;
  if (shape.sourceBound !== sourceRequired) return false;
  const fenceRequired = shape.mode === InventoryAuthorityMode.Fencing || legacyActivation;
  if (shape.fenceBound !== fenceRequired) return false;
  if (shape.targetBound !== authoritative) return false;
  if (!shape.targetBound && shape.targetRevisionNonzero) return false;
  if (greenfieldActivation && shape.targetRevisionNonzero) return false;

  if (
    shape.activeWriter &&
    (shape.mode === InventoryAuthorityMode.Fencing || authoritative)
  )
    return false;
  if (shape.mismatchPresent && shape.mode !== InventoryAuthorityMode.DualRun)
    return false;
  if (
    (shape.mode === InventoryAuthorityMode.Fencing || legacyActivation) &&
    !shape.cutoverAuthorized
  )
    return false;
  if (greenfieldActivation && shape.cutoverAuthorized) return false;

  if (!authoritative) {
    if (shape.projectionStatus !== InventoryCompatibilityProjectionStatus.Lagging)
      return false;
    if (shape.projectionRevisionNonzero) return false;
  }
  if (
    shape.projectionStatus === InventoryCompatibilityProjectionStatus.Lagging &&
    shape.projectionRevisionNonzero
  )
    return false;
  if (
    greenfieldActivation &&
    shape.projectionStatus === InventoryCompatibilityProjectionStatus.Lagging
  )
    return false;
  return true;
}

/** Convert one integer mask into the ten independent boolean census dimensions. */
function shapeFromMask(
  mode: InventoryAuthorityMode,
  activationKind: InventoryAuthorityActivationKind,
  projectionStatus: InventoryCompatibilityProjectionStatus,
  mask: number
): DurableShapeCase {
  /** Read one stable boolean dimension from the finite mask. */
  const bit = (index: number): boolean => (mask & (1 << index)) !== 0;
  return {
    mode,
    activationKind,
    projectionStatus,
    certified: bit(0),
    cutoverAuthorized: bit(1),
    greenfieldAuthorized: bit(2),
    activeWriter: bit(3),
    sourceBound: bit(4),
    mismatchPresent: bit(5),
    fenceBound: bit(6),
    targetBound: bit(7),
    targetRevisionNonzero: bit(8),
    projectionRevisionNonzero: bit(9),
  };
}

/** Return one shape known to satisfy the independent phase oracle. */
function validShape(
  mode: InventoryAuthorityMode,
  activationKind: InventoryAuthorityActivationKind,
  projectionStatus = InventoryCompatibilityProjectionStatus.Lagging
): DurableShapeCase {
  const authoritative = mode === InventoryAuthorityMode.Authoritative;
  const legacyActivation =
    authoritative && activationKind === InventoryAuthorityActivationKind.LegacyCutover;
  const greenfieldActivation =
    authoritative && activationKind === InventoryAuthorityActivationKind.Greenfield;
  return {
    mode,
    activationKind,
    projectionStatus,
    certified: mode !== InventoryAuthorityMode.Legacy,
    cutoverAuthorized: mode === InventoryAuthorityMode.Fencing || legacyActivation,
    greenfieldAuthorized: greenfieldActivation,
    activeWriter: false,
    sourceBound:
      mode === InventoryAuthorityMode.DualRun ||
      mode === InventoryAuthorityMode.Fencing ||
      legacyActivation,
    mismatchPresent: false,
    fenceBound: mode === InventoryAuthorityMode.Fencing || legacyActivation,
    targetBound: authoritative,
    targetRevisionNonzero: legacyActivation,
    projectionRevisionNonzero: false,
  };
}

describe("InventoryAuthorityControl durable state shape", () => {
  it("accepts exactly the phase-consistent semantic classes in the complete finite shape census", async () => {
    const store = new MutableAuthorityStore();
    const authority = createInventoryAuthorityControl({
      store,
      namespaceId: "durable-shape:primary",
    });
    await authority.read();
    const base = store.document;
    if (base === undefined) throw new Error("Authority initialization did not create a row.");

    /** Number of semantic classes accepted by both the independent oracle and real parser. */
    let accepted = 0;
    /** Number of semantic classes rejected by both the independent oracle and real parser. */
    let rejected = 0;
    for (const mode of Object.values(InventoryAuthorityMode)) {
      for (const activationKind of Object.values(InventoryAuthorityActivationKind)) {
        for (const projectionStatus of Object.values(
          InventoryCompatibilityProjectionStatus
        )) {
          for (let mask = 0; mask < 1 << 10; mask += 1) {
            const shape = shapeFromMask(
              mode,
              activationKind,
              projectionStatus,
              mask
            );
            store.document = durableRow(base, shape);
            let resolved = true;
            try {
              await authority.read();
            } catch {
              resolved = false;
            }
            const expected = reachableDurableShape(shape);
            if (resolved !== expected) {
              throw new Error(
                `Durable shape mismatch: ${JSON.stringify({ shape, resolved, expected })}`
              );
            }
            if (resolved) accepted += 1;
            else rejected += 1;
          }
        }
      }
    }
    expect(accepted + rejected).toBe(46_080);
    expect(accepted).toBe(35);
    expect(rejected).toBe(46_045);
  }, 90_000);

  it("preserves legacy-cutover activation inference for pre-field authoritative rows", async () => {
    const store = new MutableAuthorityStore();
    const authority = createInventoryAuthorityControl({
      store,
      namespaceId: "durable-shape-legacy-compat:primary",
    });
    await authority.read();
    const base = store.document;
    if (base === undefined) throw new Error("Authority initialization did not create a row.");
    const withActivationKind = durableRow(
      base,
      validShape(
        InventoryAuthorityMode.Authoritative,
        InventoryAuthorityActivationKind.LegacyCutover
      )
    );
    const { activationKind: _removedActivationKind, ...preFieldRow } =
      withActivationKind;
    store.document = preFieldRow;
    await expect(authority.read()).resolves.toMatchObject({
      mode: InventoryAuthorityMode.Authoritative,
      activationKind: InventoryAuthorityActivationKind.LegacyCutover,
      cutoverAuthorizationId: "cutover-a",
      sourceRoot: "source-root",
      fenceToken: "fence-a",
      targetWorldRoot: "target-root",
    });
  });

  it("rejects malformed canonical evidence inside otherwise reachable phase shapes", async () => {
    const store = new MutableAuthorityStore();
    const authority = createInventoryAuthorityControl({
      store,
      namespaceId: "durable-shape-malformed:primary",
    });
    await authority.read();
    const base = store.document;
    if (base === undefined) throw new Error("Authority initialization did not create a row.");

    const legacy = durableRow(
      base,
      validShape(
        InventoryAuthorityMode.Legacy,
        InventoryAuthorityActivationKind.None
      )
    );
    const dualRun = durableRow(
      base,
      validShape(
        InventoryAuthorityMode.DualRun,
        InventoryAuthorityActivationKind.None
      )
    );
    const authoritative = durableRow(
      base,
      validShape(
        InventoryAuthorityMode.Authoritative,
        InventoryAuthorityActivationKind.LegacyCutover
      )
    );
    const projectionFailed = {
      ...authoritative,
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Failed,
      compatibilityProjectionError: "projection-failed",
    };

    // Every malformed row below changes one semantic dimension of an independently accepted phase fixture.
    for (const validRow of [legacy, dualRun, authoritative, projectionFailed]) {
      store.document = validRow;
      await expect(authority.read()).resolves.toBeDefined();
    }
    const rejectedRows: readonly InventoryAuthorityDocument[] = [
      { ...legacy, adapterCertifiedAt: time0 },
      { ...legacy, sourceRevision: 9 },
      { ...dualRun, sourceCatalogDigest: "" },
      { ...dualRun, sourceRoot: " source-root " },
      { ...authoritative, fenceStartedAt: "2030-01-01" },
      { ...authoritative, activatedAt: "2030-01-01" },
      {
        ...authoritative,
        compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
        compatibilityProjectionError: "stale-error",
      },
      { ...projectionFailed, compatibilityProjectionError: " " },
      { ...projectionFailed, compatibilityProjectionError: "x".repeat(2001) },
      {
        ...dualRun,
        dualRunMismatchEvidenceJson: JSON.stringify([
          {
            commandId: "",
            legacyIntentDigest: "legacy-a",
            authoritativeIntentDigest: "native-b",
            recordedAt: time1,
          },
        ]),
      },
      {
        ...dualRun,
        dualRunMismatchEvidenceJson: JSON.stringify([
          {
            commandId: "command-a",
            legacyIntentDigest: "legacy-a",
            authoritativeIntentDigest: "native-b",
            recordedAt: "2030-01-01",
          },
        ]),
      },
      {
        ...dualRun,
        dualRunMismatchEvidenceJson: JSON.stringify([
          {
            commandId: "command-a",
            legacyIntentDigest: "legacy-a",
            authoritativeIntentDigest: "native-b",
            recordedAt: time1,
          },
          {
            commandId: "command-a",
            legacyIntentDigest: "legacy-c",
            authoritativeIntentDigest: "native-d",
            recordedAt: time2,
          },
        ]),
      },
    ];

    const expectedReasons = [
      "adapter certification digest/time must be retained together",
      "cannot retain a source revision without complete source evidence",
      "source evidence must be retained as one complete bundle",
      "sourceRoot is not stored in canonical trimmed form",
      "fence startedAt must be canonical UTC ISO time",
      "activatedAt must be canonical UTC ISO time",
      "non-failed compatibility projection cannot retain an error",
      "compatibility projection error must not be empty",
      "compatibility projection error exceeds its durable bound",
      "mismatch commandId must not be empty",
      "mismatch recordedAt must be canonical UTC ISO time",
      "mismatch evidence repeats command",
    ];
    expect(expectedReasons).toHaveLength(rejectedRows.length);
    for (const [index, row] of rejectedRows.entries()) {
      const reason = expectedReasons[index];
      if (reason === undefined) throw new Error("Malformed authority case has no discriminating assertion.");
      store.document = row;
      await expect(authority.read()).rejects.toThrow(reason);
    }
  });

  it("preserves real controller trajectories through every durable phase", async () => {
    const store = new MutableAuthorityStore();
    const authority = createInventoryAuthorityControl({
      store,
      namespaceId: "durable-shape-trajectory:primary",
    });
    await expect(authority.read()).resolves.toMatchObject({
      mode: InventoryAuthorityMode.Legacy,
    });
    await expect(
      authority.authorizeCutover({ authorizationId: "cutover-a" })
    ).resolves.toMatchObject({ mode: InventoryAuthorityMode.Legacy });
    await authority.certifyAdapter({ certificationDigest: "adapter-a", certifiedAt: time0 });
    await expect(
      authority.enterShadow({ certificationDigest: "adapter-a" })
    ).resolves.toMatchObject({ mode: InventoryAuthorityMode.Shadow });
    await authority.enterDualRun({
      sourceRoot: "source-root",
      sourceRevision: 7,
      sourcePlanDigest: "source-plan",
      sourceCatalogDigest: "source-catalog",
      startedAt: time1,
    });
    await expect(
      authority.admitLegacyWriter({
        writerToken: "writer-a",
        attemptToken: "attempt-a",
      })
    ).resolves.toMatchObject({ admittedLegacyWriter: true });
    await authority.releaseLegacyWriter({
      writerToken: "writer-a",
      attemptToken: "attempt-a",
    });
    await expect(
      authority.claimFence({ fenceToken: "fence-a", startedAt: time2 })
    ).resolves.toMatchObject({ mode: InventoryAuthorityMode.Fencing });
    await expect(authority.releaseFence("fence-a")).resolves.toMatchObject({
      mode: InventoryAuthorityMode.DualRun,
    });
    await authority.claimFence({ fenceToken: "fence-a", startedAt: time2 });
    await expect(
      authority.activate({
        fenceToken: "fence-a",
        sourcePlanDigest: "source-plan",
        sourceCatalogDigest: "source-catalog",
        targetWorldRoot: "target-root",
        targetWorldRevision: 1,
        activatedAt: time2,
      })
    ).resolves.toMatchObject({
      mode: InventoryAuthorityMode.Authoritative,
      activationKind: InventoryAuthorityActivationKind.LegacyCutover,
    });
    await expect(
      authority.markCompatibilityProjectionFailed({
        worldRevision: 2,
        error: "projection failed",
      })
    ).resolves.toMatchObject({
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Failed,
    });
    await expect(
      authority.markCompatibilityProjectionApplied({ worldRevision: 2 })
    ).resolves.toMatchObject({
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
    });

    const mismatchStore = new MutableAuthorityStore();
    const mismatchAuthority = createInventoryAuthorityControl({
      store: mismatchStore,
      namespaceId: "durable-shape-mismatch:primary",
    });
    await mismatchAuthority.certifyAdapter({ certificationDigest: "adapter-a", certifiedAt: time0 });
    await mismatchAuthority.enterShadow({ certificationDigest: "adapter-a" });
    await mismatchAuthority.enterDualRun({
      sourceRoot: "source-root",
      sourceRevision: 7,
      sourcePlanDigest: "source-plan",
      sourceCatalogDigest: "source-catalog",
      startedAt: time1,
    });
    await expect(
      mismatchAuthority.recordDualRunMismatch({
        commandId: "command-a",
        legacyIntentDigest: "legacy-a",
        authoritativeIntentDigest: "native-b",
        recordedAt: time2,
      })
    ).resolves.toMatchObject({ mode: InventoryAuthorityMode.DualRun });

    const greenfieldStore = new MutableAuthorityStore();
    const greenfield = createInventoryAuthorityControl({
      store: greenfieldStore,
      namespaceId: "durable-shape-greenfield:primary",
    });
    await greenfield.certifyAdapter({ certificationDigest: "adapter-a", certifiedAt: time0 });
    await expect(
      greenfield.activateGreenfield({
        authorizationId: "greenfield-a",
        certificationDigest: "adapter-a",
        targetWorldRoot: "empty-root",
        targetWorldRevision: 0,
        activatedAt: time1,
      })
    ).resolves.toMatchObject({
      activationKind: InventoryAuthorityActivationKind.Greenfield,
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Current,
    });
    await expect(
      greenfield.markCompatibilityProjectionFailed({
        worldRevision: 1,
        error: "projection failed",
      })
    ).resolves.toMatchObject({
      compatibilityProjectionStatus: InventoryCompatibilityProjectionStatus.Failed,
    });
  });
});
