# InventoryOnce agent diary

Append-only running notes. Read this before substantial InventoryOnce work.

edit: 2026-08-24 14:27 +0700 — first reusable core slice

- Started `feat/inventoryonce-core` from Shinebright `dev` at `5b67a4a37acd71edb788a7eba802065bf6123dd3` in a sibling worktree.
- Added framework-free `@inventoryonce/core` with exact scaled-integer quantity, stock positions, frozen packaging revisions, containers, multi-leg transactions, FIFO/FEFO allocation, reservations, transformations, replayable projections, and explicit deficit policy.
- Deliberately did not add `Substock`. Existing Shinebright child-stock cases must eventually classify as packaging, ordinary stock positions, containers, or transformation output.
- Initial package gate passed strict TypeScript, build, and 12 tests. Shinebright live inventory paths were not changed yet.

edit: 2026-08-24 14:37 +0700 — first migration-plan slice

- Added `@inventoryonce/core/migrations` with a side-effect-free opening-plan declaration, provenance, blocking diagnostics, and dry-run projection checks.
- This first shape only declares already-interpreted output facts. It does not yet meet the desired plugin shape where applications supply typed legacy queries/readers and InventoryOnce runs/reuses them. Treat that as incomplete, not final migration API.
- Ambiguous legacy `InventoryStockSubstock` meaning blocks migration instead of guessing.
- Gate passed strict TypeScript, build, and 17 tests.

edit: 2026-08-24 14:52 +0700 — package identity and migration-plugin correction

- Human unit text like `box` is not enough identity. The same item can have several box definitions at once or over time. Exact packaging revision must travel with package-shaped stock/commands.
- Corrected the ontology: if remaining physically sealed as packaging revision X matters, that revision is an optional stock-position dimension. Generic quantity still stays in the item stock unit. This lets box-20 and box-24 coexist without collapsing amounts.
- A plain location transfer should preserve lot/serial/package revision/container/status/owner. Unpack, repack, status change, ownership change, or re-containering must be different explicit verbs rather than hidden inside transfer.
- Migration requirement corrected: `/migrations` must support declarative typed source plugins that own application-specific queries/readers and conversion from legacy rows. The same readers should support dry-run/backfill and temporary native-vs-legacy parallel-read compatibility.
- Added package-local `AGENTS.md` because this worktree did not yet inherit the PayMeOnce guardrails. It now requires comments on touched shapes/fields, exact APIs, append-only diary updates, no `--` in test filters, strict typing, validation gates, and eventual formal-model gates.

edit: 2026-08-24 15:14 +0700 — package-revision, migration-plugin, and guardrail hardening

- Corrected package semantics in code: stock quantities stay in the item `stockUnit`, while intact package form is qualified by exact `packagingRevisionId` on the stock position. Human `box` text never identifies durable stock meaning.
- A plain location transfer now preserves lot, serial, packaging revision, container, status, and owner. Packaged movements require frozen package definitions and must move a whole number of that exact package revision; partial package movement must first become an explicit unpack/repack/change-of-form operation.
- Migration opening rows carrying a packaging revision are now checked for the same whole-package invariant, so migration cannot bypass runtime inventory truth.
- Added typed migration query/plugin primitives. Application-owned `readPage` functions may query Parse/SQL/other legacy stores; the same typed query can be reused for migration planning or temporary legacy/native parallel reads. InventoryOnce itself remains storage-agnostic and migration planning remains side-effect-free.
- Added package-local `AGENTS.md` and append-only `AGENT_DIARY.md`, copied the PayMeOnce documentation guard, and brought the entire current source tree up to that guard rather than grandfathering old kernel files.
- Replaced generic `unknown` metadata with recursive JSON-safe `InventoryMetadata`; no source `any`, `unknown` type, or `satisfies` shortcut remains.
- Validation after this slice: strict `pnpm check` passed; full Vitest suite passed 24/24 across 5 files; documentation guard passed; package build passed. Commands used nvm/`.nvmrc` and test filters never used `--`.
- Formal TLA+ models are still not implemented in InventoryOnce. Do not claim formal verification yet. Next hardening work must add the PayMeOnce-style formal runner/models plus executable refinement/failure-injection around idempotency, transfer visibility, reservation lifecycle, and transformation atomicity.

edit: 2026-08-24 15:32 +0700 — formal gate and declarative public API checkpoint

- Added real bounded TLA+ gate with pinned official tools v1.7.4 and SHA-256 verification. `InventoryOperation` checks frozen intent, hidden partial writes, completion requirements, and visible transfer conservation; `ReservationSafety` checks no over-reservation/double-consume and lifecycle/count agreement; `PackagingIdentity` checks total physical quantity plus whole `box-20`/`box-24` package buckets across move/unpack/repack interleavings.
- TLC final gate: InventoryOperation 19 distinct states / depth 6; ReservationSafety 25 / depth 5; PackagingIdentity 383 / depth 19. All passed. Corrected `ReservationSafety.ActiveCount` with explicit parentheses before treating the model as evidence.
- Added executable refinement against the real reducers: small transfer/replay exhaustion, failed multi-input transformation leaves caller state unchanged, competing reservation amount exhaustion, same-word package revision whole-package checks. `pnpm test:hardening` passes.
- Added the first application-facing façade contract. Normal code now uses `stockAmount(...)`, `packageAmount(...)`, `inventory.receive(...)`, `inventory.issue(...)`, `inventory.transfer(...)`, and `inventory.quantityAt(...)`. One `operationId` automatically owns transaction/idempotency identity.
- Exact package revision now travels in the amount (`packageAmount("1", "drug-a-box-20-v1")`) and becomes the packaged stock-position dimension automatically. Same medication may simultaneously hold old/new package revisions both human-named `box` without merging. Plain stock-unit issue does not silently eat intact package stock; partial package issue fails until an explicit unpack/change-of-form verb exists.
- Package root is now deliberately narrow. Reducers/journal/projection/allocation internals moved behind explicit `@inventoryonce/core/kernel`; regression test fails if common low-level footguns leak back into root exports.
- Typed migration source plugin remains storage-agnostic: app-owned `readPage` may literally query Parse/SQL/files; plugin maps typed legacy rows into side-effect-free InventoryOnce declaration. Same query object is reusable for migration and temporary legacy/native parallel reads.
- Current package gate after public API cut: strict `pnpm check` passed; full Vitest 8 files / 32 tests passed including documentation/public-export guards; `pnpm build` passed; `pnpm formal` passed all 3 models. Commands used `.nvmrc`; no `--` test separator.
- Durable production row/store adapter is still not implemented. Therefore formal claim currently covers bounded abstract state machines plus executable real reducer refinement, not crash-separated real database writes. Before production authority, add generic durable storage contract, adapter conformance, and before/after failpoint repair tests for every physical write boundary.

edit: 2026-08-24 16:06 +0700 — mature-system + formal-research foundation pass

- Owner explicitly rejected a formal layer that only mirrors today's Shinebright feature set. Researched mature WMS semantics plus formal methods and promoted the formal directory into a forward design contract. Added `formal/FOUNDATIONS.md` with primary references and a layered proof strategy.
- Mature-system research inputs now include SAP EWM quant/stock-key dimensions; Dynamics reservation hierarchies, catch-weight and consignment ownership; Oracle handling-unit/LPN reservations; GS1 EPCIS aggregation/association/transformation, ownership/possession/location, eventTime/recordTime and append-only error declarations; REA/ISO 15944 resource-event-agent ontology.
- Formal-method research inputs include Lamport/TLA+ refinement and liveness/fairness, O'Neil escrow transactions, Bailis invariant-confluence/coordination avoidance, Just-Right Consistency/bounded counters, Petri-net/multiset resource semantics, and Alloy-style bounded relational checking for graphs.
- Added design-level models: `ResourceDimensions`, `ReservationScope`, `TraceabilityGraph`, `PhysicalCount`, `DualMeasure`, `DistributedRights`, `CorrectionHistory`. These intentionally describe future mature semantics before corresponding TypeScript APIs exist.
- `ReservationScope` immediately found a future-design bug in the first model: after binding claim c1 to u2, narrowing its scope to {u1} was incorrectly considered feasible. Fixed candidate semantics so an allocated token must remain inside the current claim scope and on-hand set. Final TLC: 175 distinct states / depth 7.
- Replaced a pre-ranked traceability nesting shortcut with a bounded actual parent-chain acyclicity condition. Final `TraceabilityGraph` explores 1,052 distinct states / 213,017 generated transitions / depth 13. Aggregation, association and transformation genealogy stay distinct.
- `ResourceDimensions` final TLC: 4,080 distinct states / 33,769 generated / depth 12. Location, owner, custody/possession and status are independent; in-transit is real resource state; only explicit receive/issue changes total active resources.
- `PhysicalCount` final TLC: 1,134 distinct states / depth 14. Count semantics are snapshot -> observation -> discrepancy reconciliation and preserve legitimate movements after snapshot/observation; generic `SET balance = counted` is rejected directionally.
- `DualMeasure` final TLC: 43 distinct states / depth 7. Primary count is conserved while independently measured catch weight varies only through explicit measured movement/adjustment within tolerance. This proves one fixed scalar `stockUnit` cannot be the final deepest generic quantity ontology.
- `DistributedRights` final TLC: 70 distinct states / depth 7. Escrow free/held rights exactly back remaining stock; local reserve/consume and rights transfer cannot oversell. This is the future offline/distributed coordination direction.
- `CorrectionHistory` final TLC: 7 distinct states / depth 6. Original history is never erased; partial error-declaration/corrective-event persistence is logically invisible; completed correction advances current record version atomically. Research also showed durable events need occurrence time separate from record/commit time; current single `occurredAt` must not be frozen as final event ontology.
- Added `AbstractTransfer` + `DurableTransferRefinement`. TLC checks an actual temporal refinement property: crash-separated transaction/source/destination writes refine to stuttering in the abstract atomic transfer until completion. Final 10 distinct lower-level states / depth 6. Future real storage adapters should prove/refine this shape rather than only sharing invariants.
- Added `RepairLiveness` with weak fairness; TLC checks pending work eventually reaches completed or aborted. Final 10 states / depth 5. This makes liveness assumptions explicit instead of pretending safety implies eventual repair.
- Existing implementation-level `InventoryOperation`, `ReservationSafety`, and `PackagingIdentity` remain in the gate. The full formal runner now checks 12 model/property entries plus imported `AbstractTransfer`.
- Final gate after research pass: `.nvmrc` loaded; `pnpm check` passed; full Vitest remains 8 files / 32 tests green including docs/public-export guards; build passed; all 12 formal model/property entries passed. No `--` test separator used.
- Do not claim the new future semantics are implemented. Current TS executable refinement covers today's transfer/exact-reservation/package reducers. Broad reservation scopes, quantity vectors/catch weight, physical count reconciliation, distributed rights, correction/event-time semantics, ownership/custody verbs, and traceability graph APIs still need implementation plus executable companions.
- Before durable/public release, replace the current scalar-only deepest quantity assumption with primary + independent measurement axes and separate real-world event occurrence time from durable record/version time. Keep current scalar facade only as a convenience adapter until that cut is made.

edit: 2026-08-24 18:07 +0700 — complete-plan durable protocol + replacement-suite hardening

- Read every current `src` module, the package rules, and the full diary. Strict source compile initially failed because façade/root exports had drifted from selectors/events/reservation/storage/migration contracts. Fixed the real contracts instead of restoring deleted scalar transaction/package prototypes.
- Finished the grouped root API and narrow package entries: normal root stays declarative; reducers/builders live at `/kernel`; durable plan/storage/coordinator/repair live at `/storage`; typed legacy queries/plans/apply live at `/migrations`. Deleted the dead `test:hardening` script that named removed prototype tests.
- Added exact read-side reservation feasibility reports. Each item/axis group returns active reservation ids plus requested, maximum simultaneously fulfillable, and shortage quantities. Ordinary movement/new claims check feasibility at the physical event time. Count reconciliation, correction, and scrap may publish real physical loss and leave an explicit shortage report.
- Fixed changed-retry holes in reservation consumption and correction fingerprints: source/destination parties, reason, source reference, and metadata now freeze with the operation. Corrections now use their own occurrence time, retain replacement occurrence time as evidence, keep caller metadata, and append/supersede the current correction head without editing the root event.
- New tests found and fixed two real kernel bugs: pack/unpack evidence may name the exact package used for arithmetic while one effect side is intentionally loose; allocation now reports when a partial remainder was blocked by a whole allocation increment.
- Replaced obsolete scalar prototype tests with 8 current test files / 41 tests. Coverage includes retained item/package revisions, primary + independent measurements, every named stock-dimension verb, package history, exact replay/changed retries, broad/global reservation feasibility, allocated-u2 then refine-to-u1 rejection, atomic reservation consumption, physical-loss shortage reporting, movement-safe counts, separate traceability graph meanings, append-only corrections, FIFO/FEFO/expiry/priority/increments, typed migration paging/plugin/dry-run/apply/query reuse/provenance, and root export footgun checks.
- Added reusable durable storage conformance registration plus the reference adapter run. The 14-case matrix injects once immediately before/after Begin, Event, Projection, Reservations, Counts, Receipt, and Complete. It proves staged worlds stay hidden until Complete, complete plans exist after Begin, generic repair finishes without the planner, exact replay commits once, changed intent fails, planner failure creates no row, a pending operation is repaired before the next begin, and abort stays terminal/invisible.
- Replaced `InventoryOperation` with the complete-plan-at-Begin model. Event/projection/reservation/count/receipt repair steps use only the frozen plan; completion publishes exactly it; abort publishes nothing. Reworked `RepairLiveness` around a planner-free generic repair action under weak fairness. Extended `ReservationScope` with explicit physical loss and a report-equals-current-feasibility invariant instead of the false claim that physical truth can never make reservations short.
- Final TLC results: ResourceDimensions 4,080 states/depth 12; ReservationScope 548/depth 7; TraceabilityGraph 1,052/depth 13; PhysicalCount 1,134/depth 14; DualMeasure 43/depth 7; DistributedRights 70/depth 7; CorrectionHistory 7/depth 6; DurableTransferRefinement 10/depth 6; RepairLiveness 196/depth 10; InventoryOperation 131/depth 8; ReservationSafety 25/depth 5; PackagingIdentity 383/depth 18. All passed.
- Rewrote package/formal READMEs to match implemented semantics. Distributed rights remain future-only; the memory adapter is a reference, not a production database claim. No live application inventory path was touched.
- Final Node 22.22.1 gates using `.nvmrc`: `pnpm check` passed; `pnpm test` passed 8 files / 41 tests including the documentation guard; `pnpm build` passed; `pnpm formal` passed every configured model/property. `git diff --check -- packages/inventoryonce` passed. No commit or push was made.

edit: 2026-08-24 18:39 +0700 — deterministic formal runner collision fix

- Deterministic gate round 1 did not find a model bug. TLC used its default second-precision `states/<timestamp>` folder, and another run had already created the same name. The retry failed before checking the first model.
- The formal runner now gives every model process its own PID + UUID metadata folder. Successful runs remove that folder; a real TLC failure keeps its unique folder and prints its path so the counterexample state is still available.
- Found one real test-coverage hole while checking every declared durable write stage: Begin through Complete had before/after failures, but Abort did not. The reusable adapter conformance suite now injects immediately before and after Abort too, checks the exact applying/aborted row state, retries safely, and proves neither side publishes the staged world.
- Kept the complete frozen next-world plan, planner-free repair, hidden staged writes, grouped root API, revision-qualified measurement vectors, broad reservation shortage reports, count observations, append-only corrections, traceability graph, typed migration plugins, and narrow exports unchanged. No scalar prototype path came back.
- Final exact `/tmp/io-run-gates.sh` run passed on Node 22.22.1: strict source/test typecheck; 8 Vitest files / 43 tests including docs and all 16 before/after durable write boundary cases; clean build; all 12 configured TLC model/property checks. `git diff --check -- packages/inventoryonce` passed. No commit or push was made.

edit: 2026-08-24 22:24 +0700 — owner-review material findings fixed

- Removed the fake 20-package reservation ceiling. The exact solver now keeps one integer-capacity group per projected package row instead of expanding one search slot per physical package. It stops as soon as all claims are met and still bounds real assignment-state work. Tests cover 50,000 packages in one exact row and competing broad/exact claims across 75-package rows.
- Added native whole-container `transfer`, `issue`, `scrap`, `changeStatus`, and `clearStatus` verbs. The plan reads exact contents from the fenced world before Begin, follows current child-container -> parent-container containment, requires all current contents to be in one location, preserves every untouched stock dimension and frozen revision, and writes one many-line event.
- Whole-container verbs reject any active exact allocation bound to a row they would move or remove. The caller must release, consume, or reallocate it first. Broad claims are rechecked against the next world; scrap may record real physical loss and expose the resulting shortage. Heterogeneous lot/package/serial/nested-container tests cover that rule.
- Extended reusable storage conformance across before/after Begin, Event, Projection, Reservations, Counts, Receipt, Complete, PublishWorld, CompactOperation, and Abort. Added catalogue-only, lot-master-only, container-master-only, and traceability-only plans with exact content-root and public-read checks. Deliberately broken adapters now prove the suite notices every dropped row/root index.
- Added the same complete before/after stage matrix for MigrationBegin, MigrationWorld, MigrationPublishWorld, MigrationCompactManifest, MigrationComplete, and MigrationAbort. The reviewed migration cut stays hidden before atomic publication, repairs from its frozen complete plan, publishes the exact reviewed roots together, compacts only afterward, and never revives an aborted manifest.
- Extended `InventoryOperation` so atomic publication covers stock, catalogue, lot, container, traceability, reservation, and count roots. Publication and later plan compaction are separate actions; visible publication cannot abort. Regenerated the formal evidence table from the final gate.
- Kept exact revisions, append-only correction, complete-plan-at-Begin repair, atomic reviewed migration cutover, and the narrow declarative public surface. No Substock, Parse, pricing, runtime dependency, or outside-package edit was added.
- Final Node 22.22.1 gates using `.nvmrc`: `pnpm check` passed; full Vitest passed 16 files / 289 tests; `pnpm build` passed; all 15 registered TLC checks passed. Final key TLC sizes: ResourceDimensions 2,016/depth 13; DualMeasure 43/depth 8; RepairLiveness 199/depth 11; InventoryOperation 3,889/depth 11. No commit or push was made.

edit: 2026-08-24 22:31 +0700 — final native review/gate correction

- Fixed three smaller hostile-review holes after the owner findings: availability no longer doubles the earlier exact-allocation total when several usable rows are allocated; durable reservation delta checks now freeze `allowExpiredStock`; compiled migration identity now includes every reviewed diagnostic/source/resolution row.
- Tightened the deliberately broken-adapter check so dropping the traceability event row itself fails conformance, not only dropping its relation/index rows. The full storage suite stays at 194 crash/shape tests.
- Re-ran TLC after the operation model gained catalogue/lot/container/traceability roots. Current exact sizes are ResourceDimensions 2,016/depth 13, DualMeasure 43/depth 7, RepairLiveness 199/depth 11, and InventoryOperation 3,889/depth 11. The earlier 22:24 diary line saying DualMeasure depth 8 was stale output; formal README now says 7.
- Removed the old generated UseByReservation failure-state folder after the fixed model passed. No source/test file was removed.
- Final stable Node 22.22.1 gates using `.nvmrc`: `pnpm check` passed; full Vitest passed 16 files / 289 tests; `pnpm build` passed; all 15 registered TLC checks passed; `git diff --check` passed. Only `packages/inventoryonce` changed; existing root `.chatgpt/` stayed untouched. No commit or push was made.


edit: 2026-08-25 06:09 +0700 — fungibility formalized before implementation

- Checkpointed the previous fully green native operation surface as local commit `c0771bdf6` before adding fungibility semantics.
- Researched mature-system distinctions and rejected a generic "equivalent item" graph. Rebrand/definition history stays under one stable item with immutable revisions; true mutual interchangeability is an explicit pool revision; one-way supersession, priority substitution, BOM/formula substitution, and clinical therapeutic substitution remain separate caller policies.
- Added `FungibilityPool.tla` before any TypeScript fungibility implementation. The bounded model keeps immutable token/item identity, two retained pool revisions, a changed active pointer, exact common-basis weights (including a two-to-one member), broad claims, exact allocations, location transfers, direct pool issue, release, and consumption.
- First TLC invocation failed only because the model used an invalid set-comprehension form. Corrected the specification itself before accepting evidence.
- Final model passed exhaustive finite exploration: 2,046,801 states generated, 163,192 distinct states, depth 15. Invariants prove exact pool reports, per-revision conservation against actual issued tokens, claim revision freezing, member-only allocation, exact basis matching, disjoint allocations, no issued token backing an active claim, and continued global feasibility after normal issue/consume.
- TypeScript fungibility work must now refine this boundary: never merge stock rows/items, require an exact retained pool revision, preserve selected member identity in every event, and keep directed/clinical substitution outside the generic core.

edit: 2026-08-25 06:40 +0700 — executable revision-frozen fungibility refinement

- Implemented the TypeScript companion only after `FungibilityPool.tla` was committed and green. Added immutable pool revisions to retained catalogue construction, snapshots, publication/extension, digest protection, active pointers, and historical lookup. A newer active revision cannot mutate or hide an older exact revision.
- Added exact reference conversion (`memberQuantity <-> poolQuantity`) without floating point. Pool definitions require at least two exact item revisions, exact existing axes/units, positive reference quantities, unique member revisions, and one common basis unit. Scalar helpers cover normal primary-axis cases including 1:1 rebrands and 1-piece -> 2-equivalent strength mappings.
- Added `inventory.fungibility`: exact/active definition reads, common-basis summary, global FIFO/FEFO preview, and revision-pinned issue/transfer/scrap. No synthetic pooled stock exists. Every emitted effect retains the real selected item revision, position, lot, package, serial, container, and physical measurement; pool evidence is retained only as immutable event metadata.
- Automatic allocation uses each member reference as its minimum quantum and keeps stricter package/serial/independent-measurement quanta. It rejects lossy/non-terminating splits, independent-axis automatic guessing, expired stock by default, ambiguous transfer source locations, changed retries, and incomplete allocation.
- A review found that relying only on the final coordinator check could reject a pool operation after greedily choosing an item protected by a broad claim even when another member was free. Extended the exact allocation primitive with an optional whole-assignment predicate. Fungibility allocation now explores deterministic alternatives and accepts only a complete member set whose hypothetical removal leaves the full existing item-reservation book feasible. Added a regression where FIFO prefers old brand, a broad old-brand claim protects it, and the allocator correctly selects new brand.
- Added durable publication coverage: v2 cannot be read or used until its catalogue publication commits; after publication v2 is active while v1 remains usable and retains its original membership.
- Focused and then complete gates passed before this diary checkpoint: strict source/test typecheck; 17 Vitest files / 296 tests before the broad-claim refinement, then focused fungibility/allocation/documentation/publication suites green after refinement; clean build; all 16 configured TLC model/refinement/liveness checks including `FungibilityPool` green. A final complete gate still follows before commit.
- Scope remains explicit: direct pool summaries/movements are implemented and preserve ordinary item reservations. Broad reservations denominated directly in a pool basis are still the formal model's next executable extension, not faked through a single-item reservation. Directed/clinical substitution remains application policy.


edit: 2026-08-25 07:09 +0700 — hostile fungibility edge hardening and scoped-transfer proof

- The read-only hostile review was intentionally stopped after its adversarial exact-search probe made no progress; the probe itself exposed the bounded-search requirement. Confirmed and regression-tested the exact allocator's 100,000-state ceiling so acceptance predicates fail closed instead of exploring unbounded combinations.
- Fixed member/package quantum composition. The allocation quantum is now the exact least-common quantity multiple of the pool member reference and intact-package reference (or whole serial/independently measured position). A 3-piece -> 1.5-equivalent member inside 2-piece packs now rejects 1.5 equivalents and permits the exact 3-equivalent / three-pack movement; no fractional package reaches event construction.
- Separated physical authority time from reservation authority time. Expiry/use-by is evaluated at `occurredAt`; normal operations protect claims at durable `recordedAt`. Changed coordinator final feasibility accordingly, so backdating an ordinary issue/transfer cannot bypass a reservation created before commit. Explicit late physical truth remains on scrap/count/correction paths.
- Added whole-assignment diagnostics: an exact assignment rejected by reservation/operation constraints is no longer mislabeled as an indivisible-package shortfall.
- Added transfer-aware claim simulation. A pool transfer removes the exact source and adds the exact destination before feasibility checking, so broad cross-location claims remain valid while source-location-only claims stay protected and exactly allocated positions remain immovable.
- Strengthened `FungibilityPool.tla` with a store-only claim, a cross-location claim, eligible-location allocation invariants, an allocated-token transfer prohibition, and post-transfer global feasibility. TLC passed exhaustive finite exploration: 1,337,922 generated states, 113,054 distinct states, depth 15.
- Focused strict/type/documentation/allocation/fungibility/reservation hardening suites passed after these corrections. A final complete check/test/build/formal gate follows before the local implementation commit.

edit: 2026-08-25 07:11 +0700 — final fungibility implementation gate

- Final post-review owner gate passed after the exact LCM quantum, bounded-search diagnostic, durable-record-time claim protection, transfer-aware feasibility, and location-scoped formal-model changes.
- Exact final evidence: strict source/test typecheck green; 17 Vitest files / 302 tests green; build green; all 16 registered TLC safety/refinement/liveness checks green. `FungibilityPool` now explores 1,337,922 generated / 113,054 distinct states at depth 15.
- The implementation checkpoint remains package-only and independent of Shinebright/Parse. The next commit begins the read-only Shinebright migration/shadow adapter separately.


edit: 2026-08-25 07:16 +0700 — complete legacy-source migration plugin boundary

- Added `InventoryMigrationSourcePlugin`, which returns one side-effect-free `{ catalog, declaration }` bundle from the same typed bounded legacy queries. This closes the architectural gap where application adapters previously had to reconstruct legacy item/package definitions outside the declarative plugin and pass a catalogue separately.
- Added `defineInventoryMigrationSourcePlugin` and `createInventoryMigrationPlanFromSourcePlugin`. The latter returns `{ catalog, plan }` and compiles the reconstructed bundle through the same normal catalogue/event/migration invariants; it does not write legacy or InventoryOnce storage.
- Preserved the existing declaration-only plugin API for applications whose catalogue is already independently authoritative.
- Added a typed test that derives one item revision/catalogue and opening stock from two named legacy queries, compiles the source plugin, and dry-runs the result into one exact native position. Documentation guard remains enabled.

edit: 2026-08-25 07:16 +0700 — source-plugin final gate

- Final source-plugin gate passed on Node from `.nvmrc`: strict source/test typecheck; 17 Vitest files / 303 tests; clean build; package diff check clean. Formal models were unchanged from the previously green 16-model gate.
- This checkpoint remains InventoryOnce-only. No Parse, Shinebright class, UI, pricing, or legacy database code entered the package.

edit: 2026-08-25 07:28 +0700 — classic Node resolver subpath compatibility

- Added `typesVersions` mappings for `/kernel`, `/storage`, and `/migrations`. This preserves the explicit expert subpaths while allowing consumers still using TypeScript `moduleResolution: "node"` to resolve the same generated declarations without importing package source internals or changing compiler mode globally.
- InventoryOnce strict check/build and Shinebright backend full `tsc --noEmit` passed with a real `@inventoryonce/core/migrations` import.


edit: 2026-08-25 09:36 +0700 — heterogeneous composition and collection views formalized before implementation

- Added `CompositionRevision.tla` before adding any TypeScript composition API. The finite model uses the exact motivating generations: `pack-v1 -> 21 active-A + 7 placebo-A`; `pack-v2 -> 20 active-A + 5 active-B + 3 placebo-B`. It explores cross-location transfer, active-revision changes, opening, and exact idempotent replay while every physical pack retains its immutable revision.
- Composition invariants prove exact component potential across unopened packs plus produced loose components, exact identity-sensitive reports, one completed opening per pack, revision-frozen operation intent, and independence from the mutable active pointer. TLC passed 50,849 generated / 6,688 distinct states at depth 10.
- Added `CollectionView.tla` to separate read-only taxonomy from fungibility. Retained `same brand`, `all OCP v1`, and `all OCP v2` views keep exact item-revision buckets; changing the active view pointer cannot rewrite old views or authorize substitution. TLC passed 13,123 generated / 1,458 distinct states at depth 9.
- The first collection specification used an invalid dependent quantifier; TLC rejected the model before any implementation existed. Rewrote it as nested quantifiers and accepted no evidence until the corrected model passed.
- Grounded the split in GS1 trade-item rules (changed declared count or predefined assortment means a new identified configuration), versioned BOM/change-control practice, EPCIS transformation semantics, and TLA+ safety/refinement discipline. Updated `FOUNDATIONS.md` and the formal README accordingly.
- Full pinned TLA+ 1.7.4 gate passed all 18 registered checks, including the existing 113,054-state fungibility model and durable refinement/liveness suite. No TypeScript composition/view implementation existed at this checkpoint.

edit: 2026-08-25 11:10 +0700 — heterogeneous composition formal-only hardening

- Preserved the existing dirty composition/collection/index/migration work and added no new TypeScript composition API or catalogue type in this phase. Baseline `pnpm check` was already green.
- Focused baseline tests found two unfinished test-only failures. The durable conformance shape now asserts every new stock index plus the containment-child index instead of letting a broken adapter pass accidentally. The Shinebright migration test now accepts the diagnostic's extra provenance note while still requiring the exact error code/source identity.
- Strengthened `CompositionRevision` with separate immutable package and composition revisions, exact v1 `21 active-A + 7 placebo-P`, exact v2 `20 active-A + 5 active-B + 3 placebo-C`, two packs per generation, two locations, transfer/open interleavings, exact per-operation output vectors, exact retry guards, per-revision source conservation, per-location component production, distinct component axes, and a derived-only physical report.
- Added the temporal safety property `CompletedOperationIntentNeverChanges`. The first spelling used a raw action under `[]`; TLC rejected that syntax before generating states. Rewrote it as `[CompletedOperationIntentStaysFrozen]_vars`. This was a spec syntax correction, not a behavioral counterexample.
- Kept composition correction out of the core state machine so it does not blur opening/conservation. Formal docs now state the exact bridge to `CorrectionHistory`: retain the old definition/source/open fact and append or supersede current meaning; never mutate the old vector or durable retry intent.
- Final pinned TLC result for `CompositionRevision`: 50,849 generated states, 6,688 distinct states, complete graph depth 10, no errors. Full `pnpm formal` passed all 18 registered checks.
- Final Node 22.22.1 gates using `.nvmrc`: `pnpm check` passed; focused package Vitest/documentation/conformance passed 6 files / 211 tests; focused backend migration Vitest passed 1 file / 14 tests; `pnpm formal` passed. No commit or push was made.

edit: 2026-08-25 13:18 +0700 — primary-led composition refinement and Shinebright read seam

- Resumed as the sole primary worker after reading the model-routing cost guardrail; terminated the stale unpinned worker/orchestration chain and used no delegated model for this pass.
- Found a formal-to-TypeScript refinement mismatch during direct review: `CompositionRevision` keeps outputs at the package current location, while the first TypeScript placement surface still allowed output location/status/owner/custodian/authority overrides and implicit lot inheritance. Tightened the API so opening preserves those shared source dimensions and rejects undeclared placement fields at runtime, including JavaScript callers.
- Added frozen output lot policies: no lot, strict source-lot inheritance, source-lot inheritance when present, or explicit output lot. Required/forbidden lot tracking is validated in the catalogue; composition digests/snapshots/clones retain the policy. Added regressions for hidden relocation rejection, shared-dimension preservation, strict/optional/explicit lot behavior, and exact explicit output lots.
- The legacy recipe compiler now emits `inherit-source-when-present` explicitly. This preserves manufacturer lot identity when legacy evidence has one while allowing aggregate legacy package rows without inventing a lot. Mutable-current `unitLevels` fallback remains a blocking migration diagnostic.
- Restored root API hygiene: raw collection projection summarization remains on `/kernel`; normal applications use the grouped `inventory.collections.summary(...)` façade.
- Final direct package evidence on Node from `.nvmrc`: `pnpm check` green; 21 Vitest files / 320 tests green; build green; all 18 registered TLC checks green. `CompositionRevision` explored 50,849 generated / 6,688 distinct states at depth 10; `CollectionView` 13,123 / 1,458 at depth 11; `FungibilityPool` 1,337,922 / 113,054 at depth 15.
- Performance evidence remains projection-based: FIFO reads `positiveLayerStartedAtByPositionId`; item/revision/serial/container indexes are rebuilt with the event projection and included in integrity/conformance roots. Proxy-based tests fail if indexed reads enumerate the entire position/event maps.

edit: 2026-08-25 13:40 +0700 — final composition/index/application-read gate

- Completed the formal-first heterogeneous-package refinement from the committed `CompositionRevision` model into the independent TypeScript core. One exact source package revision owns one immutable composition revision; callers open whole packages without supplying component counts, and the normal atomic transformation emits the frozen output vector while preserving shared source dimensions and declared lot policy.
- The exact clinic case is executable and formalized: old generation `21 active-A + 7 placebo-P` and later generation `20 active-A + 5 active-B + 3 placebo-C` coexist, transfer independently, survive active-pointer changes, replay idempotently, and never merge their component identities.
- Read-only collection revisions (`Same Brand`, `All OCPs`) remain taxonomy only. Exact member/revision rows are preserved and scalar display roll-ups require an explicit declared basis. Fungibility remains a separate revision-frozen substitution contract.
- FIFO/FEFO candidate provenance now reads the rebuildable `positiveLayerStartedAtByPositionId` projection index. Item/revision/serial/container and provenance indexes participate in replay/integrity/conformance roots; proxy/stress tests fail if indexed reads enumerate full position/event maps. Hot-path planning is selected-position traversal plus deterministic sorting rather than candidate-by-history replay.
- Added `states/` to the package-local ignore and removed TLC dump artifacts from the worktree; real failures still print their unique dump path during the run.
- Final direct Node 22.22.1 package gate: strict `pnpm check` passed; full Vitest passed 21 files / 321 tests; build passed; all 18 registered TLC safety/refinement/liveness checks passed. Key bounded results: `CompositionRevision` 50,849 generated / 6,688 distinct / depth 10; `CollectionView` 13,123 / 1,458 / depth 11; `FungibilityPool` 1,337,922 / 113,054 / depth 15.
- InventoryOnce still has zero runtime dependencies and no Shinebright/Parse imports. Live Shinebright authority remains outside this checkpoint until a production durable adapter passes the conformance/failpoint suite and cutover has a stable source root/write fence.

edit: 2026-08-25 13:41 +0700 — final primary evidence correction and indexed read refinement

- Correcting the earlier provisional evidence line: the final current package gate is 21 Vitest files / 321 tests, not 320, after adding the immutable-revision-index regression. The final pinned formal run is 18 entries and all passed.
- Exact latest key model evidence: `CompositionRevision` 50,849 generated / 6,688 distinct / depth 10; `CollectionView` 13,123 / 1,458 / depth 9; `FungibilityPool` 1,337,922 / 113,054 / depth 15. The complete current state/depth table was refreshed from `/tmp/inventoryonce-final-gates/package-formal.log`, not copied from an older run.
- `findInventoryPositions` now selects `positionIdsByItemRevisionId` directly for exact revision selectors and unions only the requested revision rows for multi-revision selectors. A proxy regression fails if that path touches the broader item index or enumerates the backing position record.
- Final primary package commands from the current source all passed: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm formal`. Root export guards still keep the raw collection reducer on `/kernel` while normal applications use the grouped collection façade.

edit: 2026-08-25 14:34 +0700 — corrected FIFO provenance and published-head CAS finalization

- A frozen-tree hostile review found two real correctness gaps after the composition/read-model pass. First, a same-quantity correction could change an inbound event's `occurredAt` without changing position measurements, leaving `positiveLayerStartedAtByPositionId` pointed at the superseded history. Second, a Shinebright DTO could combine one published world with a separately extended catalogue cache.
- Added correction-only `positiveLayerProvenanceOverrides` to immutable event truth. Correction planning compares the actual projection with the hypothetical retained-history replay and emits exact per-position replacements even when stock deltas are empty. The reducer validates and applies those replacements after stock effects, and event intent fingerprints include them.
- Added regressions for same-quantity receipt-time correction, superseding correction, omitting an original receipt while a later top-up remains, and correcting a migrated Opening event. FIFO planning now observes the corrected physical layer start in every case without inventing quantity changes.
- Exposed the durable begin validators/materializer needed by external adapters and added `PublishedHeadCAS.tla`. Two writers may freeze plans from one published head, but at most one compare-and-swap Begin can own that base; stale work cannot publish over the winner, exact retry stutters, visible revision/history remain aligned, and weak fairness resolves enabled writers. TLC passed 3,327 generated / 1,277 distinct states at depth 24.
- Updated the formal guide: the heterogeneous composition TypeScript companion is implemented, collections stay read-only, and `PublishedHeadCAS` is explicitly an adapter obligation rather than proof that arbitrary Parse/SQL persistence is atomic.
- Final direct Node 22.22.1 core gate on this corrected tree: strict check passed; 21 Vitest files / 323 tests passed; build passed; all 19 registered TLC safety/refinement/liveness runs passed. Key retained results: CompositionRevision 50,849 generated / 6,688 distinct / depth 10; CollectionView 13,123 / 1,458 / depth 9; FungibilityPool 1,337,922 / 113,054 / depth 15; PublishedHeadCAS 3,327 / 1,277 / depth 24.
- Assurance boundary remains unchanged: each real durable adapter must provide the same compare-and-swap head claim and pass the full conformance/failpoint matrix against its actual backend.


edit: 2026-08-25 14:38 +0700 — final TLC depth correction

- The final clean 19-model rerun regenerated the complete-state depths after the last specification/configuration changes. Correct final values are CompositionRevision 50,849 generated / 6,688 distinct / depth 11 and CollectionView 13,123 / 1,458 / depth 11. The immediately preceding diary checkpoint's depth 10/9 figures were stale earlier-run output; no invariant or implementation changed in this correction.

edit: 2026-08-25 — production durable publication and conserved FIFO provenance final gate

- Finalized the adapter-facing durable protocol around one published-head compare-and-set. `ClaimAbort` / `MigrationClaimAbort` now atomically exclude publication before terminal abort history is written; restart repair completes an abort claim or compacts a published plan without the original planner. `PublishedHeadCAS.tla` passed 4,284 generated / 1,871 distinct states at complete graph depth 24.
- Added immutable `positiveLayerProvenanceTransfers` for genuinely conserved one-to-one movement. Location transfer, exact single-line reclassification, pack, and unpack retain the oldest current FIFO layer. A destination that already contains stock keeps the older of its current layer and the moved layer. Multi-line split/merge/reclassification does not guess lineage from array order and therefore starts a new layer unless a future API names explicit pairs.
- Correction replay, world integrity roots, and rebuilt projections include the provenance changes. Regression tests cover transfer into an existing destination, pack → unpack → status reclassification, same-quantity/backdated correction, full rebuild, and refusal to infer multi-line lineage.
- Final direct Node 22.22.1 package gate at 2026-08-25 17:07 +0700: strict `pnpm check` passed; full Vitest passed 21 files / 327 tests; build passed; every registered TLC safety/refinement/liveness run passed. Key latest results: `PublishedHeadCAS` 4,284 / 1,871 / depth 24; `CompositionRevision` 50,849 / 6,688 / depth 10; `FungibilityPool` 1,337,922 / 113,054 / depth 15; `InventoryOperation` 22,689 / 3,889 / depth 11.
- The reusable core still has zero runtime dependencies and no Shinebright/Parse imports. Production adapter correctness evidence does not remove application-specific source fencing, retention, or storage-layout obligations.


edit: 2026-08-25 primary authority writer-admission wiring

- Removed stale overlapping model workers before editing; the primary architect
  owned the final semantics and validation.
- Registered/checked `AuthorityWriterFence.tla`: atomic legacy-writer admission
  and the cutover fence are mutually exclusive for both writer-first and
  fence-first interleavings. The bounded run explored the configured finite
  state space without invariant or temporal violations.
- Wired Shinebright's existing ledgered `applyStockChange` path through exact
  writer/attempt admission and added outer workflow admission around every
  transitive stock-change entrypoint. A TypeScript AST regression test now
  rejects any future `applyStockChange` call outside that outer boundary.
- Added before/after save and delete admission to InventoryStock,
  InventoryLotBalance, InventoryStockSubstock, and
  InventoryStockSubstockLotBalance. Trusted master-key stock/lot sub-writes may
  reuse an already-held outer workflow token; client-supplied skip flags are not
  trusted without master context.
- Parse trigger context carries direct-write admission to its matching after
  trigger. Validation failures release immediately; a database failure after
  admission leaves a token and blocks cutover until explicit repair.
- Mongo-mode and SQLite-mode authority, Inventory function, and trigger suites
  passed, including writer/fence races, leaked-token blocking, multiple active
  trigger admissions, and structural source-coverage checks. Backend strict
  TypeScript and the complete InventoryOnce check/test/build/formal gates also
  passed during this pass.
- Assurance remains safety-first: no automatic timeout may clear a leaked token,
  and live authoritative mutation replay is still a separate adapter/cutover
  phase rather than being smuggled into this admission pass.


edit: 2026-08-26 00:30 +0700 — native batch package preservation and receipt aggregation

- Hardened `issueManyByPolicy` / `transferManyByPolicy` grouping so repeated requests selecting the same intact-package position remain exact package commands. Grouped lines now retain immutable packaging revision, sum only safe whole package counts, preserve non-package-fixed independent measurements, and reject inconsistent package evidence.
- Made `receiveMany` the owner of duplicate exact-destination aggregation. Duplicate receipt lines become one stock effect keyed by canonical position identity; measurement vectors and safe whole package counts are summed centrally, exact package/lot/container evidence is retained, and conflicting effect metadata rejects the operation before publication. This removed the equivalent conserved-state grouping engine from Shinebright.
- Added regressions for later-request shortfall atomicity, replay-safe per-request allocation evidence, changed-intent rejection, repeated intact-package policy allocations, duplicate packaged receipts, lot metadata retention, and conflicting duplicate receipt metadata with no partial stock.
- Final core gates: strict package check passed; full Vitest passed 21 files / 332 tests; package build passed. The full registered TLA+ suite passed. Key current bounded evidence includes `AuthorityWriterFence` 10,130,490 generated / 2,234,410 distinct / depth 34, `PublishedHeadCAS` 4,284 / 1,871 / depth 24, `CompositionRevision` 50,849 / 6,688 / depth 10, `FungibilityPool` 1,337,922 / 113,054 / depth 14, `InventoryOperation` 22,689 / 3,889 / depth 12, and `PackagingIdentity` 1,831 / 383 / depth 18.
- InventoryOnce remains independent of Shinebright and PayMeOnce. Application adapters may translate business rows and validate their own parent/child consistency, but exact allocation, duplicate-position aggregation, conservation, replay, and package identity belong to the core. No commit or push was made.


edit: 2026-08-26 08:37 +0700 — native amount identity, split conservation, and operation-index read harvest

- Re-certified the landed native absolute-count tree before extending it: strict package check, 21-file package suite, build, backend Mongo/SQLite authority matrices, production build, and the complete registered TLC suite all passed. The formal run explored `AuthorityWriterFence` 10,130,490 generated / 2,234,410 distinct / depth 34; `PublishedHeadCAS` 4,284 / 1,871 / depth 24; `CompositionRevision` 50,849 / 6,688 / depth 11; `FungibilityPool` 1,337,922 / 113,054 / depth 14; `InventoryOperation` 22,689 / 3,889 / depth 12; and `PackagingIdentity` 1,831 / 383 / depth 19.
- Added public `inventoryAmountFromUnit(...)` so an application that has already normalized its unit vocabulary can resolve an exact primary/package amount against one immutable item revision. The native helper owns package-label ambiguity, revision ownership, exact plain-decimal parsing, positive whole-package requirements, independent-axis validation, and final amount resolution.
- Added public `assertInventoryAmountSum(...)` so declared lot/allocation child lines are proven equal to a parent amount after exact package resolution. This moved measurement-vector construction, summation, schema alignment, and exact comparison out of Shinebright.
- Added `findInventoryEventByOperationId(...)`, backed by the rebuildable operation-to-event projection index with integrity checks for missing/mismatched indexed events. Shinebright no longer traverses that index itself to recover replay occurrence time.
- Regressions cover primary/package resolution, fractional package rejection, ambiguous same-label packages within one revision, mixed package/base conservation, mismatch rejection, operation-index lookup, missing operations, and corrupted index evidence. Public-export and documentation guards include the new APIs.
- Final package gate on the frozen tree: strict check passed; full Vitest passed 21 files / 341 tests; build passed; `git diff --check` passed. No formal source changed after the successful formal run. InventoryOnce retains no Shinebright or PayMeOnce runtime imports. No commit or push was made.

edit: 2026-08-26 13:10 +0700 — one published-world read boundary for public inventory views

- Added the public snapshot reader so one storage read freezes world revision, catalogue, stock, reservations, availability time, packages, lots, containers, compositions, collections, and fungibility for every downstream view.
- Shinebright batch reads now map several medication/device identities through that same snapshot. The response and every nested view carry the exact published world revision; app code cannot mix separate world reads inside one table/report response.
- Shared read tests prove one storage read and prove a newer publication cannot leak into an already-open snapshot. InventoryOnce still has no Shinebright types or vocabulary.

edit: 2026-08-26 14:54 +0700 — final read-boundary recertification (no kernel source change in this correction)

- Shinebright's remaining scalar read was switched to the existing public published-snapshot API; no InventoryOnce package logic changed in this correction.
- Re-certified the exact package: strict check, 26 files / 355 tests, build, and the complete registered formal suite. `AuthorityWriterFence` remained 10,130,490 generated / 2,234,410 distinct / depth 34; every model passed.
- The final anti-regrowth audit now proves ordinary app code cannot reconstruct native current reads or use compatibility balance/expiry as authority. Evidence is under `.chatgpt/test-markers/read-report-frontend-final.{green,report,review}`.

edit: 2026-08-27 04:52 +0700 — final formal implementation, index, and production assurance seal

- Exact source certification: 459 public APIs, 2,030 fields, 1,801 callables / 4,717 edges / 32 test roots, 459 tested implementation witnesses, zero unresolved/unreferenced APIs, 24 trace/property rows covering 455 non-gap APIs, four explicit migration-callback gaps.
- Fixed finite 100,000-row Parse paging, alert location-scope N+1, and live reservation history replay.
- Final gates: package 32/388; Mongo 12/281; SQLite 12/281; downstream 2/2; data 77/584; builds; all 21 TLC models. AuthorityWriterFence 10,238,911 / 2,258,576 / 34; ImplementationConformance 390,895 / 6,488 / 5.
- Memory 5,000 positions; Mongo/SQLite 1,000 lots with zero unindexed shapes and no planning DB queries. Desktop's 12 errors match clean dev; touched inventory paths have zero. All 18 gaps enumerated. No reset/stash/rebase/commit/push.

edit: 2026-08-27 07:52 +0700 — first real-clinic immutable migration dry-run

- Used main-repo `clinic-backup-2026-08-27-071258.tar.gz` only as an immutable fixture (SHA-256 `fbc52f347324c3e77c56003c6bbacc994b13669c17c7442b67c8d077abb810c4`). Extracted only `data/parse.archive.gz` and the top-level bundle manifest; none of the 1,852 external file payloads or `files/manifest.jsonl` were extracted or opened.
- Restored the Mongo archive with the repository importer into an isolated SQLite copy, ran a localhost-only Parse process without cloud triggers/authority runtime, and performed source compilation/reconciliation only. No activation or cutover path was imported or invoked; the SQLite database hash stayed `237827dc...c848` before and after.
- The source compiled identically twice and a second fresh-database execution produced eight byte-identical artifacts. Catalogue digest `06187450...100b`; plan digest SHA-256 `6537770e...0580`; source-root SHA-256 `0fb28217...371e`; empty base root `13b92af2...98e`; 144 candidate opening events. The plan is blocked, so no target world root/revision exists.
- Accounted for all current physical rows (131 stock + 185 lot; no substock/recipe rows) and all 570 legacy history/pending rows (239 adjustments, 329 mutations, 2 pending ops). Current results: 120 stock rows represented by exact lots, 5 zero, 6 blocked; 144 lot rows compiled, 35 zero, 5 blocked, 1 additional negative lot unrepresented. Latest saved mutation tails: 84 match current parent, 47 have no saved tail, zero mismatches.
- Canary blockers: 5 negative lot rows, 1 unresolved lot-unit row, 1 negative parent row, 5 parent/lot total mismatches, the paired negative lot under the negative parent, 2 pending ops, and 2 `started` mutations. One pending/+1 mutation pair is a strong 47 ms semantic match; one pending row predates the mutation ledger; one started mutation is orphaned.
- Durable evidence: `.chatgpt/real-clinic-migration/artifacts/canary-report.md`, `canary-summary.json`, exact plan/reconciliation JSON, final digest manifest, and deterministic tarball `clinic-backup-2026-08-27-071258.inventoryonce-dry-run-canary.tar.gz` (`077a4c6b...e4ed`). Focused package/backend migration/type tests remain green under default and SQLite.

edit: 2026-08-27 — Record-deficit semantics and deterministic clinic canary

- Completed `InventoryOnceEventResult.deficit` plus batch result/replay evidence; Reject shortage remains no-publication. Deficit is durable signed truth and never allocation capacity.
- RecordedDeficit now freezes mode/quantity/result shortfall and checks Record, Reject, late receipt, replay, and changed intent: 21,342 / 2,313 / depth 8. All 22 models passed.
- Final assurance: 460 APIs, 2,072 fields, 1,861 callables / 5,010 edges / 32 roots, 460 witnesses, zero unresolved/unreferenced, 25 traces covering 456 non-gap APIs. Package 32/401; Mongo 12/284; SQLite 12/284; data 77/584; builds green.
- The immutable clinic rerun preserves five negative untracked rows as Issue deficits; every former signed mismatch reconciles; all 316 current facts are accounted.
- Canary is blocked only by `JfSxx8Yfc0` and two pending/two started workflow rows. Evidence root `8052b90787da883d0987b3c39b12308cb2905a2d0d0b74942e1e916055f05080`, target root null, package SHA `2c4b5efa78c8019fd79f534b44ba793ce97ab061bf0483526617942077cc2d7c`. No patient payload, activation, cutover, reset, stash, rebase, commit, or push.

edit: 2026-08-28T04:51:25+07:00 — independent pdclinic opening-snapshot canary

- Replayed immutable `pdclinic-backup-2026-08-27-225318.tar.gz` in two isolated read-only SQLite copies. Extracted only `parse.archive.gz` plus the top-level manifest; did not inspect 2,243 external file payloads or their manifest.
- Deterministic ready result: 516 current physical facts, zero blocked/unrepresented facts, 197 events, 195 positions, 22 Record deficits, 11 snapshot-superseded workflow dispositions, target root `eb8af88e9fd0a7d97da79717f413ca49888b413a1017922cddb188703cee0437`.
- Independent stress-test finding: explicit null Parse optional pointers are absence, not a second item identity. Added generic exact-parent fallback for omitted lot item pointers; disagreement still blocks, and final pdclinic used fallback zero times. No new unit mapping was needed.
- Full gates green: package 32/403; backend Mongo 12/288; backend SQLite 12/288; downstream 1/2; data logic 77/584; 23 TLC models; 461 APIs / 2,090 fields / 461 implementation witnesses / zero unresolved.
- Sanitized package `2ef320295c0c49535447dc5c2bd7d0f7e85c9b3496e393ff72d837a1fc31270d`; no activation, cutover, live write, reset, stash, rebase, commit, or push.

edit: 2026-08-30 — PR-01 pass-2 audit repair

- PR-01 had eight backend InventoryOnce specs but none of the backend adapter, authority, migration, or fixture files they import. Removed all eight dangling specs from the kernel/formal slice: authority, durable storage, formal greenfield, formal Shinebright seam, formal storage refinement, index scale, migration, and Parse durable storage.
- A fresh PR-02 restack must restore those eight specs with `inventoryOnceAuthorityTestFixtures.ts`, `inventoryOnceDurableTestFixtures.ts`, the backend `inventoryOnce` implementation tree, and the Mongo/SQLite trace and failpoint evidence. All of that still exists on the backend/data branch; nothing was rewritten or deleted there.
- `SnapshotSupersededWorkflow` keeps the normal safe transition system and unchanged invariants. Four separate mutation configs now try a resumed disposed row, physical disposition event, guessed outcome, and post-capture source advance. TLC must reject each exact bad transition through its named invariant.
- The assurance surface now includes every public transformation read/planning method. One executable trace covers `activeDefinition`, `definition`, `definitionsForItem`, `fromRevision`, `toRevision`, `betweenRevisions`, and `plan` against retained revision and one-published-world guarantees.
- Final gates before commit: package strict types; 34 files / 420 tests; package build; all 23 normal TLC models plus four expected invariant rejections; assurance 497 APIs / 2,134 fields / 497 compiler witnesses / zero unresolved / 25 traces; backend TypeScript; Inventory tests 119/119 on Mongo and 119/119 on SQLite; `git diff --check` clean.

edit: 2026-08-30 — PR-02 backend/data audit repair started

- Work only on `review/inventoryonce-02-backend-data-restacked` in the restacked PR-02 worktree. PR-03 stays untouched and PR-02 does not get merged into PR-01.
- Recheck every attached finding against current code before changing it. Fix valid backend/data bugs without changing the InventoryOnce physical-stock design.
- Keep stable logical `compositionId` across package generations. Keep the single formal greenfield lifecycle trace and the real seam anti-regrowth checks.
- Final proof must rerun package check/test/build/formal, data-logic test/build, backend TypeScript, the full InventoryOnce backend matrix on Mongo and SQLite, formal assurance, and `git diff --check` before commit and push.

edit: 2026-08-30 — PR-02 backend/data audit repair certified

- Fixed the valid backend/data findings without changing the native stock design. Historical source values stay readable but cannot write; composition ids stay stable across generations and now separate different child-form source meanings.
- Removed the dead legacy trigger-admission helper and its three tests. Production still blocks legacy physical writes and admits only SupplyDelivery and InventoryAdjustment through the native bridge.
- Formal assurance is fresh: 497 public APIs, 2,138 fields, 1,941 callables / 5,277 edges / 34 test roots, all 497 APIs witnessed, zero unreferenced or unresolved APIs, 27 bounded traces, and 18 explicit gaps.
- Final gates: package check/build and 34 files / 421 tests; data-logic CJS+ESM build assertions and 81 files / 614 tests; backend strict TypeScript and production build; Mongo 14 files / 304 tests; SQLite 14 files / 304 tests. The fenced backup rehearsal stayed its expected opt-in skip in both database runs.
- All 23 registered TLC models passed. AuthorityWriterFence checked 10,238,911 generated / 2,258,576 distinct states at depth 34, and all four forbidden-transition mutations were rejected by their named invariants. `git diff --check` is clean.

edit: 2026-09-04 — standalone repository export completed

- Exported the InventoryOnce package subtree from Shinebright source commit `eb1cd0f1146832ddd1d08e971cb05ff88e7b4116` (`fix(inventory): preserve strict location and replay guards`) into the standalone repository root. Before standalone-only adjustments, the source subtree and staged standalone tree were byte/mode-identical at tree `e94f5b77aa05866465022df9b57ad5a13c1038e2`.
- Removed only the two Shinebright-owned executable trace declarations `TRACE-REAL-ADAPTER-INDEX-SCALE` and `TRACE-SHINEBRIGHT-FOUR-AUTHORITATIVE-CALLS`. Their Mongo/SQLite adapter and four-call application seam implementations live downstream, so this core must not claim them as locally executable evidence.
- Regenerated standalone assurance after narrowing that evidence boundary: 502 public API entries, 2,239 field entries, 26 standalone bounded traces, 498 traced public APIs, and 18 explicit gaps.
- Standalone export gates passed: strict TypeScript/package assurance checks; 434 tests across 36 files; production build; implementation-conformance generation/audit; the complete registered TLA+ model suite; and every registered forbidden-transition mutation rejected by its intended invariant.


edit: 2026-09-06 01:25 +0700 — standalone PR-01 review-loop assurance refresh

- Preserved the September 4 export checkpoint unchanged and appended the current standalone result instead of rewriting historical evidence. Current assurance reports 508 public API entries, 2,285 fields, 504 traced public APIs, and 19 explicit gaps.
- `pnpm assurance:write` regenerated and audited the implementation-conformance manifests; `pnpm check` passed strict source/test TypeScript plus assurance; `pnpm test` passed 465 tests across 37 files; `pnpm build` passed the production TypeScript build. The package-suite count is one higher than the prior 464-test checkpoint because this review added the missing 55-byte SHA-256 known-answer vector.
- Focused review validation passed 61 tests across `test/catalog-stock.test.ts`, `test/digest.test.ts`, `test/review-hardening.test.ts`, `test/formal-implementation-refinement.test.ts`, and `test/traceability-corrections.test.ts`. A temporary-git-repository harness also proved repository assurance hashing is stable when external symlink target bytes change and changes when the symlink target text itself changes.
