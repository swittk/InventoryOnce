# Formal implementation conformance

The TLA+ specifications are not treated as a detached design document. This directory contains a generated, executable code-to-model bridge over every public InventoryOnce entry point, including the migration and durable-storage machinery.

## Mechanical coverage ledger

`implementation-conformance/API_ASSURANCE.json`, `FIELD_CLASSIFICATION.json`, `CALL_CHAIN_ASSURANCE.json`, and `TRACE_REPLAY_ASSURANCE.json` are generated or checked from the real TypeScript program by `scripts/generate-formal-implementation-assurance.py` and `scripts/audit-formal-implementation-conformance.mjs`.

The generator:

1. derives every public entry point from `package.json` exports and the root/kernel/storage/migration/conformance entry modules;
2. asks the TypeScript checker for every exported symbol and its real public type;
3. recursively enumerates input, output, value, overload, array, map, index-signature, optional, nullable, and recursive semantic fields;
4. maps every API and field to actual TLA modules and actual variables/operators/invariants/properties;
5. attaches executable evidence files to state/action/result rows;
6. emits an explicit generated gap for every unclassified surface or state/result row without executable evidence; and
7. fails instead of silently truncating a large type graph.

`pnpm conformance:generate` rewrites the current surface ledgers and audits them. `pnpm conformance:check` runs the executable implementation-refinement gate.

## Bidirectional refinement

`implementation-refinement-map.json` maps every variable and action in `ImplementationConformance.tla` back to the concrete TypeScript extractor or facade result. Its test rejects an added formal variable/action without a concrete relation and rejects a concrete proof row whose TLA symbol no longer exists.

The bounded implementation model covers four representative physical facade verbs:

- `stock.receiveMany`;
- `stock.issueManyByPolicy`;
- `stock.transferManyByPolicy`; and
- `counts.replaceAbsolute`.

It also distinguishes two retry meanings:

- a retry of an already completed operation is the `Replay` visible-state stutter; and
- a retry after a crash may complete an already frozen publication, which refines `PublishedHeadCAS`, `DurableTransferRefinement`, and `RepairLiveness` rather than pretending to be a stutter.

The TypeScript trace harness computes an independent abstract transition, executes the real facade, observes the result, then reads the post-state only through `readPublishedInventorySnapshot(...).summary(...)`.

## Migration machinery

`migration-implementation-proof.json` explicitly covers:

- typed source compilation and dry-run with no writes;
- the frozen source/catalogue/plan digest;
- durable staging and one visible published head;
- exact retry and changed-intent rejection;
- planner-free repair and terminal abort; and
- every migration failpoint phase used by the conformance suite.

The source plugin remains application-specific translation. InventoryOnce proves no theorem about arbitrary source queries; it validates the plugin's typed output with the real migration compiler and exercises durable apply/repair/abort against the storage protocol.

## Reference implementation evidence

This kernel/formal slice runs the bounded traces against the reference in-memory durable adapter. The complete storage-conformance suite keeps the exhaustive named operation and migration failpoint matrix.

The Parse/Mongo and Parse/SQLite durable adapters, their restart/index-scale checks, and the Shinebright application seam belong to the backend/data slice. They must run the same public traces and failpoint matrix there; this PR does not claim that evidence before the adapter code exists.

## Assurance boundary and explicit gaps

The generated ledger contains every gap as data. The standing non-claims include:

- bounded TLC is not a proof of arbitrary TypeScript, arbitrary future adapters, or unbounded deployments;
- `DistributedRights` is a future offline/multi-writer constraint, not a claimed production runtime;
- reservations directly denominated in a fungibility-pool basis remain future work;
- production content-addressed world-snapshot retention/write amplification and safe garbage collection or segmentation remain an activation gate; and
- clinic pricing, tax, permissions, organization scope, and UI policy are intentionally outside physical inventory authority.

Any newly unclassified public API/field or any state/result surface lacking executable evidence is added to the generated gap list and fails any policy that requires zero newly generated gaps. Nothing is considered covered merely because it was omitted from a hand-written table.

## Opening-snapshot supersession refinement

`SnapshotSupersededWorkflow.tla` models the migration-only disposition for unfinished legacy workflow rows when a frozen current physical snapshot is authoritative. The concrete refinement requires: no command/event generation from disposed rows; unchanged current physical truth; exact retention in the plan and durable migration manifest; immutable retry identity; durable audit retention after terminal compaction; and impossibility of later workflow resumption after the writer fence. The disposition is not a claim that the old workflow completed or aborted. Four mutation configs let TLC try the forbidden physical event, guessed outcome, resumed row, and changed source revision; the formal gate passes only when the unchanged invariants reject them.
