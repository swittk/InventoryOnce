# InventoryOnce agent rules

These rules are non-negotiable for every file under `packages/inventoryonce`. They intentionally mirror the PayMeOnce hardening discipline.

## Runtime
- Before any `pnpm` command, load nvm and use the repository `.nvmrc`.
- Never run pnpm with `CI=true`.
- Never insert `--` between `pnpm test` and a Vitest filter/path.

## Public API
- Normal application code must say what physically happened: receive, issue, transfer, reserve, release, consume reservation, unpack/repack, transform, scrap, reconcile count.
- Do not make applications construct journal legs, calculate balance deltas, choose retry behavior, or directly edit projections.
- Low-level reducers may exist for adapters/tests, but they are not the preferred application API.
- Human package words like `box`, `pack`, `bottle`, or `case` are never enough identity when more than one package definition can exist. Package-shaped stock or commands must name the exact packaging revision or exact container.
- A plain location transfer must preserve item, lot, serial, packaging revision, container, stock status, and owner. If one of those changes, use a verb that says what changed.
- Never recreate `Substock`. A weird legacy child row must become packaging, an ordinary stock position, a container, or transformation output.

## Correctness
- Inventory truth uses exact quantities. No epsilon arithmetic.
- Same idempotency identity must freeze the same intent. Changed retries fail closed.
- Completed transfers and transformations are one logical multi-leg fact; committed truth must never expose half an operation.
- Current balances are projections of committed history and must be rebuildable.
- Package/catalog edits never reinterpret old facts.
- Ambiguous migration data blocks migration; never guess.
- Formal models are release evidence, not marketing. Document exactly what each TLA+ model checks and connect it to executable refinement/failure-injection tests.

## Migration and compatibility plugins
- `/migrations` is declarative adapter plumbing, not a pile of one-off scripts.
- A plugin declares named legacy reads/queries and the typed conversion from those rows into InventoryOnce facts.
- Query functions may know Parse/SQL/application storage. The InventoryOnce migration engine itself must not.
- The same typed legacy read declarations should be reusable for dry-run/backfill and temporary compatibility/parallel-read paths.
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
