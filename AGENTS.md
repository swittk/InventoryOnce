# InventoryOnce agent rules

These rules are non-negotiable for every file in this standalone repository. They intentionally mirror the PayMeOnce hardening discipline.


## Pre-production rule: one current contract, absolutely no backward compatibility

- **InventoryOnce has NEVER been deployed or consumed by any production application.** No earlier development commit, experiment, type shape, input, event format, storage representation, query cursor, API alias, or in-memory state needs backward compatibility.
- Until an actual product uses a released version in production, every *Once package has exactly ONE current API and durable contract. Replace or delete superseded internal development behavior immediately. Do not retain deprecated aliases, legacy-format replay branches, detection/fallback decoders, duplicate version routes, old payloads, or compatibility shim tests. Do not add tests whose sole purpose is proving removed legacy fields do not exist.
- **Only exception:** explicit adoption of already-existing external product/application data. Keep Parse/SQL/third-party legacy input readers, translated migration evidence, controlled adoption/cutover and temporary external-source parallel reads isolated in migration/authority adapters. This exception does NOT license compatibility with previous InventoryOnce or other *Once development formats.
- Current canonical full-world commits, native segmented commits, materialization for proof/export, immutable item revision semantics, valid historical corrections and deliberate type/domain compatibility are CURRENT architectural features, not backward compatibility. Preserve their behavior and performance; do not delete them merely because a comment calls them "legacy".
- A reviewer suggesting backward compatibility for an unreleased *Once contract is wrong. Check supported current producer reachability, then remove the obsolete code or push back in the original inline thread; never broaden support to satisfy fabricated old-version records. Never add repeated runtime validation of already typed adapter/conformant records.
- Do not introduce new compatibility code just because future clients might exist. Any exception after a genuine production release requires explicit owner approval tied to that actual consumer and version, not speculation.

## Runtime
- Before any `pnpm` command, use the repository `.nvmrc` when present; otherwise use a Node version allowed by `package.json#engines`.
- Never run pnpm with `CI=true`.
- Never insert `--` between `pnpm test` and a Vitest filter/path.

## Public API
- Normal application code must say what physically happened: receive, issue, transfer, reserve, release, consume reservation, unpack/repack, transform, scrap, reconcile count.
- Do not make applications construct journal legs, calculate balance deltas, choose retry behavior, or directly edit projections.
- Low-level reducers may exist for adapters/tests, but they are not the preferred application API.
- Human package words like `box`, `pack`, `bottle`, or `case` are never enough identity when more than one package definition can exist. Package-shaped stock or commands must name the exact packaging revision or exact container.
- A plain location transfer must preserve item, lot, serial, packaging revision, container, stock status, and owner. If one of those changes, use a verb that says what changed.
- Never recreate `Substock`. A weird legacy child row must become packaging, an ordinary stock position, a container, or transformation output.

## Adapter conformance boundary
- Low-level `/storage` deltas and reducer inputs are planner-produced or adapter-conformant protocol records, not arbitrary application payloads.
- Do not duplicate planner semantics inside delta appliers merely to defend against hand-built semantically invalid records. Adapter conformance establishes those cross-field invariants once; repeated validation is correctness-neutral overhead.
- Before accepting a review finding against a low-level delta/reducer boundary, prove either that InventoryOnce itself can produce the bad record through a supported path or that the record still satisfies the adapter conformance contract. Otherwise classify it as implementer misuse/out of contract.
- Never add hot-path scans, guards, clones, or fallback validation solely for a nonconforming adapter/caller. Fix the producer or adapter conformance instead.

## Correctness
- Inventory truth uses exact quantities. No epsilon arithmetic.
- Same idempotency identity must freeze the same intent. Changed retries fail closed.
- Completed transfers and transformations are one logical multi-leg fact; committed truth must never expose half an operation.
- Current balances are projections of committed history and must be rebuildable.
- Package/catalog edits never reinterpret old facts.
- Ambiguous migration data blocks migration; never guess.
- Formal models are release evidence, not marketing. Document exactly what each TLA+ model checks and connect it to executable refinement/failure-injection tests.

## External-data migration and cutover plugins
- `/migrations` is declarative adapter plumbing, not a pile of one-off scripts.
- A plugin declares named legacy reads/queries and the typed conversion from those rows into InventoryOnce facts.
- Query functions may know Parse/SQL/application storage. The InventoryOnce migration engine itself must not.
- Reuse named external-source query declarations only for dry-run/backfill and temporary external-source comparison or parallel reads during a real existing-data cutover. Never add compatibility paths for earlier InventoryOnce development versions.
- Every migrated fact keeps source provenance.
- Migration planning and comparison are side-effect-free. Durable apply is a separate explicit step.

## Comments and docs
- If you touch a file, document every new or changed type/interface/enum/function and every field in touched object shapes.
- Do not use `@param`/`@returns` tag-style JSDoc. Put one direct purpose comment immediately above the declaration or field.
- Add inline comments at weird branches, fail-closed checks, fallback paths, and logic that is not obvious after roughly 20 lines.
- Long-lived locals/maps/flags in non-trivial blocks get a one-line comment where declared.
- Explain behavior in plain programmer language. Avoid management/audit wording.
- Names must say what the thing actually is; do not hide behavior behind vague `data`, `stuff`, `process`, or `handle` names.

## TypeScript
- Strict types are the default.
- No `any`. Avoid `unknown`, downcasts, and assertions unless there is no honest typed alternative; document any unavoidable exception.
- Do not use `satisfies`.
- Prefer named argument interfaces for non-trivial functions and document every field.
- Prefer simple loops/maps over repeated chained full-array walks.
- Keep runtime dependencies at zero unless a dependency clearly improves the generic core enough to justify it.

## Coordination and resume-first worktrees
- Before substantial InventoryOnce work, read both `AGENT_DIARY.md` and the shared `/home/server/Documents/Projects/InventoryOnce-placement-v2/BULLETIN.local.md` when it exists.
- Before creating a new branch or worktree, inspect existing `InventoryOnce*` worktrees for the same scope, including Git status and recent file edits. Treat unfinished same-scope work as resumable even if it was created by a prior session.
- If a same-scope worktree has substantive uncommitted or unmerged work, resume that lane. Do not restart from the base branch merely because the previous session stopped, context was reloaded, or a new session began.
- Create a replacement lane only when the existing lane is demonstrably unsafe/corrupt, has an incompatible base that cannot be reconciled, or the owner explicitly directs a restart. Before doing so, append a bulletin entry marking the old lane `SUPERSEDED` with the exact reason and a salvage/transplant plan for unique source, tests, docs, and findings.
- Every long-lived bulletin claim must identify exact worktree, branch, base SHA, and state (`ACTIVE`, `PAUSED`, `RELEASED`, or `SUPERSEDED`). A new same-scope `ACTIVE` claim is invalid while an earlier lane is still `ACTIVE` or `PAUSED` unless that earlier entry is explicitly superseded.
- Before pausing or ending a substantial session, append a checkpoint with uncommitted state, validation completed, current blocker, and exact next step so another session can resume rather than rediscover or reimplement work.
- Never discard or independently reimplement a substantial unfinished lane without first comparing/salvaging it. Prefer continuation or transplantation over duplicate implementation.

## Long-task diary
- `AGENT_DIARY.md` is append-only running memory for this package.
- Read it before resuming substantial InventoryOnce work.
- Append an entry whenever the plan changes, a real invariant is discovered, a tempting design is rejected, a migration boundary changes, or a meaningful slice finishes.
- Never rewrite old diary entries to make later work look cleaner. Append a correction instead.

## Validation before done
- Run `pnpm check`, `pnpm test`, and `pnpm build` after package logic/API changes.
- Run the documentation guard whenever source changes.
- Once formal models exist, `pnpm formal` is also required for changes touching modeled invariants.
- Report exactly what ran and what did not.
