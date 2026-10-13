# InventoryOnce formal models

The formal suite is a forward design constitution plus implementation-level evidence for the InventoryOnce TypeScript core. It separates:

1. **safety** — bad inventory states are unreachable;
2. **refinement** — crash-separated durable behavior maps to the intended atomic operation;
3. **liveness** — pending repair eventually terminates under explicit fairness assumptions;
4. **future constraints** — mature semantic families may be modeled before every production adapter implements them.

Run every registered model/property with:

```bash
source ~/.nvm/nvm.sh
if [[ -f .nvmrc ]]; then nvm use; else nvm use 22; fi
pnpm formal
```

The runner pins `tla2tools.jar`, uses collision-safe metadata directories, retains failed-state metadata, and content-addresses successful proofs. It currently checks **27 positive models**, **21 deliberately invalid mutation configurations**, and **one positive reachability witness**. A mutation check passes only when TLC finds the exact named invariant violation.

## Registered TLC checks

### Implemented semantics and executable companions

| Model | Formal responsibility | TypeScript evidence |
| --- | --- | --- |
| `CatalogPublication` | retained revision sets only grow; active pointers name retained revisions; published snapshots remain replayable; one operation identity freezes one publication | catalogue publication/retention tests and intent fingerprints |
| `ReclassificationConservation` | split, merge, relot, status/direct-placement changes conserve quantity per item and exact package bucket | reclassification tests and event-shape guards |
| `UseByReservation` | normal allocation/consumption excludes expired resources; explicit allow-expired policy stays distinct; time or physical loss may create visible shortage | availability, policy, and reservation tests |
| `ResourceDimensions` | direct placement, owner, custody, status, transit, and detached/missing whereabouts remain orthogonal; detach/place/missing conserve quantity and stable lifecycle identity | whereabouts, transfer, availability, correction, and count tests |
| `ReservationScope` | broad claims can narrow/bind while all active claims remain feasible; unplaced stock is accounted but unavailable; ordinary detach cannot strand an exact allocation | reservation/whereabouts feasibility tests plus bad-detach mutation |
| `ReservationScopeAllocationReplacement` | replacing exact allocation preserves the globally feasible claim book rather than transiently double-allocating | reservation allocation replacement tests |
| `PlacementGraph` | standalone and serial-embodied nodes; one-parent/acceptance/acyclicity; generic↔unique conservation; one-to-one embodiment; resource-parent agreement; empty-before-retirement; retired-identity non-revival; and ancestor moves that preserve descendant direct stock anchors | cabinet lifecycle/correction/contents tests, embodied move scale regression, and desynchronization/nonempty-retirement mutations |
| `TraceabilityAssociation` | reversible association remains independent from physical placement and transformation genealogy | association/correction tests |
| `TraceabilityGraph` | irreversible production genealogy is acyclic and one physical identity cannot be produced twice | transformation/traceability tests plus duplicate-production mutation |
| `PhysicalCount` | snapshot → observation → discrepancy reconciliation preserves legitimate movements during counting | count lifecycle and absolute-count tests |
| `InventoryOperation` | Begin freezes stock, catalogue, lot, placement-node, traceability, reservation, and count roots; staged writes stay hidden; publication changes every root atomically | storage conformance/failpoint suite |
| `PublishedHeadCAS` | only one writer may claim a published base revision; stale work cannot overwrite the winner; repair eventually clears a claimed fence under weak fairness | durable begin validators/materializers and storage conformance |
| `ReservationSafety` | one exact reservation cannot be overallocated, consumed twice, or replayed with changed intent | reservation tests and façade fingerprints |
| `PackagingIdentity` | exact package revisions remain separate even with equal scalar counts; direct-placement movement preserves revision identity and whole-package quanta | catalogue/stock/package tests |
| `DurableTransferRefinement` | crash-separated writes stutter until completion and refine one abstract atomic transfer | storage conformance and `AbstractTransfer` mapping |
| `TransferLifecycle` | prepare, dispatch, partial/full receive, completion, and release conserve one isolated transfer | transfer lifecycle tests and isolation mutation |
| `RepairLiveness` | under weak fairness a pending frozen plan eventually publishes/compacts or aborts before publication | generic operation/migration repair tests |
| `CorrectionHistory` | original history persists; incomplete correction storage cannot replace current truth; completion advances current meaning atomically | correction tests and retained-current-head indexes |
| `HistoricalRepair` | late assertions publish all-or-nothing, preserve original evidence, reject serialized conflicts, and expose permitted fungible deficits | historical-repair/event-query/scale tests plus segmented failover paths |
| `AuthorityWriterFence` | cutover fencing cannot overlap admitted legacy writers; activation provenance remains exact | authority/cutover tests |
| `SnapshotSupersededWorkflow` | snapshot-superseded source rows remain audit evidence, create no physical event or guessed outcome, and cannot resume after the fence | migration/storage refinement plus four mutations |
| `RecordedDeficit` | Record mode keeps genuine shortfall as signed non-allocatable liability while Reject mode stutters; replay preserves the frozen shortfall | policy, migration, projection, and replay tests |
| `ImplementationConformance` | bounded state/result correspondence for representative public calls and generated API/field/trace/gap evidence | generated assurance plus executable refinement tests |

### Mature-system constraints retained by the core

| Model | Design constraint |
| --- | --- |
| `CompositionRevision` | exact heterogeneous package generations coexist across placements; transfer preserves source revision; opening produces its revision-frozen vector at the source direct placement; durable retry intent and component conservation survive active-pointer changes |
| `CollectionView` | immutable taxonomy/group revisions retain exact member identity and never authorize substitution |
| `FungibilityPool` | mutual interchangeability is an explicit immutable pool revision; member identity never merges; placement-scoped claims and member movements remain reservation-safe |
| `DualMeasure` | primary handling count and independently measured quantity are separate exact axes |
| `DistributedRights` | escrow free/held rights back remaining physical stock and constrain future offline/distributed implementations |

`AbstractTransfer` is imported by `DurableTransferRefinement`; it is an abstract specification rather than a separate runner entry.

## Latest bounded exploration sizes

The exact seed and fingerprint values vary by run. The latest complete run explored:

| Model/property | Generated states | Distinct states | Complete graph depth |
| --- | ---: | ---: | ---: |
| `AuthorityWriterFence` | 12,393,407 | 2,594,448 | 35 |
| `PublishedHeadCAS` | 4,284 | 1,871 | 24 |
| `CompositionRevision` | 33,441 | 6,688 | 10 |
| `CollectionView` | 13,123 | 1,458 | 9 |
| `FungibilityPool` | 1,337,922 | 113,054 | 14 |
| `CatalogPublication` | 88,723 | 52,552 | 5 |
| `ReclassificationConservation` | 34,201 | 900 | 7 |
| `UseByReservation` | 1,810 | 558 | 11 |
| `ResourceDimensions` | 180,145 | 12,816 | 14 |
| `ReservationScope` | 3,701 | 788 | 7 |
| `ReservationScopeAllocationReplacement` | 2,361 | 548 | 7 |
| `PlacementGraph` | 87,339,921 | 20,116 | 16 |
| `TraceabilityAssociation` | 49,153 | 4,096 | 13 |
| `TraceabilityGraph` | 1,729 | 320 | 10 |
| `PhysicalCount` | 5,272 | 1,794 | 16 |
| `DualMeasure` | 213 | 43 | 7 |
| `DistributedRights` | 351 | 70 | 7 |
| `CorrectionHistory` | 8 | 7 | 6 |
| `HistoricalRepair` | 10,387 | 913 | 9 |
| `DurableTransferRefinement` | 7 | 6 | 5 |
| `TransferLifecycle` | 4,321 | 929 | 7 |
| `RepairLiveness` | 540 | 265 | 13 |
| `RecordedDeficit` | 21,342 | 2,313 | 8 |
| `SnapshotSupersededWorkflow` | 162 | 75 | 10 |
| `InventoryOperation` | 22,689 | 3,889 | 11 |
| `ImplementationConformance` | 172,510 | 6,481 | 5 |
| `ReservationSafety` | 41 | 25 | 5 |
| `PackagingIdentity` | 6,001 | 995 | 17 |

All reachable states in those finite configurations were checked by TLC.

The 22 negative controls cover four snapshot-supersession violations, cross-transfer receipt, correction-history erasure, partial historical-repair publication, split durable publication, four use-by/reservation failures, reservation detach that strands an allocation, detach incorrectly becoming issue, unstable whereabouts identity, placement cycle, rejecting placement target, descendant rewrite during ancestor movement, embodied-resource/node parent desynchronization, nonempty embodiment termination, duplicate genealogy production, and implementation-conformance result-delta mismatch. The positive reachability witness separately proves that a nonzero frozen snapshot state is reachable. Negative controls are not folded into the positive state counts.

## What the claims mean

A passing model means the modeled finite state machine satisfies the configured invariants or temporal
properties. It does **not** automatically prove arbitrary TypeScript, a future Parse adapter, network
transport, or an unbounded deployment.

InventoryOnce therefore uses a layered evidence stack:

```text
standards and mature-system semantics
                ↓
abstract TLA+ safety/liveness/refinement
                ↓
real TypeScript executable behavior tests
                ↓
storage-adapter conformance
                ↓
before/after every-write failpoint injection
                ↓
application adapter and integration tests
```

A new production storage adapter must satisfy the storage contract and conformance/failure suite. A
future distributed adapter must satisfy the rights/coordination assumptions it claims rather than
borrowing the `DistributedRights` result as marketing.

## Model notes

### Heterogeneous composition revisions and grouping views

`CompositionRevision` uses the motivating calendar-pack generations directly: one exact v1 pack opens
into 21 active-A plus 7 placebo-P units, while one exact v2 pack opens into 20 active-A, 5 active-B,
and 3 placebo-C units. The finite configuration has two physical packs of each revision, two placements,
and four durable opening identities. TLC explores active-pointer changes, arbitrary unopened-pack
transfers, independent opening order, and exact retries rather than one scripted sequence.

Every physical pack permanently retains its exact package revision, which points to one exact immutable
composition revision. Opening consumes exactly one pack token, freezes its package/composition/placement/
output intent under one operation identity, and adds exactly that composition's vector at the pack's
current placement. A retry transition exists only when every frozen field matches; a changed pack,
package revision, composition revision, or placement has no accepted transition. The active composition
pointer is never consulted for opening arithmetic.

The configured invariants check the registered v1/v2 vector fields explicitly, then check non-negative bounded types, intact-plus-opened source conservation per
revision, one completed operation per opened pack, at most one opening contribution per operation ID,
exact loose production from completed v1/v2 operations, exact production at each recorded opening
placement, component potential conservation, and separate active-A/active-B/placebo-P/placebo-C buckets.
The model has no synthetic `tablet` resource bucket. Its `report` variable is constrained to the exact
derived physical view after every transfer/open and cannot drive a physical transition. The temporal
property `CompletedOperationIntentNeverChanges` checks that completed durable intent remains append-only
across later steps. This is a temporal safety claim only; the model makes no fairness or eventual-opening
claim.

The TypeScript companion now implements this contract: immutable composition revisions live in the
retained catalogue, exact source-package lookup selects the frozen vector, and the public open operation
accepts only the exact source position and whole package count—not caller-supplied component arithmetic.
One normal atomic transformation consumes the exact source package and produces every declared component
together; durable intent fingerprints reject changed retries. `composition.test.ts`, catalogue-publication
tests, storage conformance, and replay/index tests provide executable refinement evidence. The bounded TLC
result still does not prove an arbitrary future database adapter or an unbounded deployment; read/grouping
views remain derived and cannot write physical truth.

Composition-specific correction is deliberately not duplicated in this state machine. The registered
`CorrectionHistory` model covers append-only correction/supersession visibility. The additional
composition obligation is explicit: correcting a wrong assertion must retain the old composition,
source-pack fact, and completed opening fact, then append/supersede current meaning; it must never edit a
prior vector so an old pack or retry opens through newer meaning.

This follows mature trade-item/BOM practice: a changed declared count or predefined assortment is a
new identified trade-item/package configuration, while BOM/component changes are versioned rather than
retroactively applied to existing stock. InventoryOnce therefore treats heterogeneous opening as a
revision-pinned decomposition/transformation, not as a mutable `box` conversion.

`CollectionView` separately models read-only taxonomy. A retained “same brand” view and two retained
“All OCPs” revisions report exact member-item buckets. Moving the active view pointer changes only which
revision the UI chooses by default; it never merges physical identity or grants fungibility. Any scalar
roll-up requires an explicitly compatible measure or basis outside the membership relation itself.

### Append-only historical repair

`HistoricalRepair` models an application learning several earlier physical assertions after later inventory events already exist. The repair either publishes every assertion as one new visible revision or publishes none. Original durable evidence remains retained. A serialized conflict cannot publish; Reject mode cannot publish a signed deficit; Record mode retains the exact requested deficit rather than silently manufacturing missing stock. Same-time assertions retain caller order inside their atomic repair bundle.

The TypeScript implementation refines this with `stock.planHistorical`, `stock.recordHistorical`, `stock.planCorrection`, typed historical-deficit intervals, stable embedded assertion identities, optional durable anchors, indexed dependency-cone replay, and exact world/journal fencing. Existing normal APIs remain unchanged. `counts.reconcile` remains the mechanism for establishing present physical reality without repairing older history.

`HistoricalRepairPartialPublishMutation` deliberately exposes only one assertion from a two-assertion bundle; `HistoricalRepairIsAtomic` must reject it. `HistoricalRepairReverseBundleOrderMutation` publishes a two-assertion bundle in reverse caller order; `SameTimeBundleOrderIsPreserved` must reject it.

### Placement embodiment and reversible individualization

`PlacementGraph` keeps standalone places and inventory-embodied holders distinct without reintroducing a second container authority. Rooms/shelves/bays are ordinary standalone nodes. A cabinet/trolley/tote may instead be embodied by one live serialized resource. The resource placement is authoritative for the node parent; moving it cannot rewrite descendant direct anchors. A fungible quantity cannot embody anything because it has no stable physical identity.

The finite model conserves a fixed total of generic plus active unique resources. `Individualize` removes one generic unit and activates a fresh serial; `Embody` binds that serial one-to-one with a node whose current parent agrees with the serial placement. `DeindividualizeEmbodied` requires zero direct stock, zero child nodes, and zero other active-resource contents before returning one generic unit and retiring both current identities. Normal transitions never revive retired serials or nodes. Append-only correction of a mistaken terminal assertion is tested executable behavior outside that ordinary lifecycle transition system.

Two deliberate mutations independently prove the bridge is real rather than convention: one moves an embodied resource without its node and violates `EmbodiedResourceTracksNodeParent`; the other terminates a nonempty embodiment and violates `EmbodimentTerminationRequiresEmptyNode`. The TypeScript companion additionally rejects duplicate embodiment, missing embodied serials, nonempty scrap/de-individualization, stock placed into retired nodes, and silent old-ID reuse. `placement.moveContents` supplies the one-call evacuation path before retirement.

### Fungibility versus substitution

`FungibilityPool` models only explicit **mutual interchangeability** under one immutable pool revision.
Every member retains its exact item identity; a pool is a derived common-basis view and an eligible
fulfillment scope, not a stock merge or item reclassification. One revision deliberately gives a member
a two-to-one basis weight, while an older revision excludes that member. Claims freeze the exact pool
revision used when created, so changing the active pointer cannot reinterpret an allocation. One claim
is store-only while another may be fulfilled across placements. Direct pool issue and direct-placement transfer
may use only unallocated tokens and must leave all existing scoped claims feasible; exactly allocated
tokens cannot move underneath their claim.

The model intentionally does not make one-way supersession, priority substitution, or clinical
therapeutic equivalence implicit. Those require an explicit caller policy that selects a retained pool
revision or exact substitute; normal stock events continue to record the item actually moved or issued.

### Recorded deficits

`RecordedDeficit.tla` distinguishes allocatable physical stock from a signed recorded liability. Its bounded operation model covers Record and Reject issue modes, receipts after a deficit, frozen operation intent/result shortfall, exact replay, and changed-intent rejection. Checked invariants require signed net to equal physical minus deficit and bound every issue physical decrement by the pre-step available capacity, so recorded deficit cannot fund allocation; they also preserve Reject-mode shortage stutter and require replay to return the frozen shortfall without changing truth.

Executable refinement in the TypeScript façade reconstructs `InventoryOnceEventResult.deficit` from immutable event metadata/effects and checks it after restart with the memory reference adapter. Migration uses the same signed Issue semantics for coherent negative `__untracked__` rows rather than inventing opening receipts. Mongo/SQLite adapter checks belong to the backend/data slice.

### Published-head compare-and-swap

`PublishedHeadCAS` isolates the production storage-adapter obligation that an in-memory mutex cannot prove.
Two writers read the same published revision, independently freeze exact next-world plans, and race to
Begin. A compare-and-swap claim on the published head permits at most one winner; the loser becomes stale
and cannot publish over that winner. Exact retry of the winning operation stutters, `Publish` advances
the visible revision, `WriteCompletedHistory` later persists completed history, and weak fairness checks that a successfully claimed fence eventually
repairs and clears. Prepared-but-unclaimed attempts intentionally carry no scheduler-progress claim. The bounded exploration result is reported once in the generated-state table above; keep that table as the authoritative PublishedHeadCAS run record.

The model is an adapter contract, not evidence that Parse, SQL, or another document store already provides
that compare-and-swap. Each production adapter must implement the same atomic head claim and pass the
InventoryOnce conformance/failpoint matrix against its real persistence backend.

### Catalogue publication

A publication records a complete retained snapshot. Later catalogues may add immutable revisions or
change active pointers, but must retain every earlier published revision and its meaning. Exact retry is
stuttering; changed intent is not an enabled publication transition.

### Conserved reclassification

The model explores movement, one-to-many split, and many-to-one merge. Every item total and exact
package-bucket total is invariant. Therefore a generic reclassification cannot secretly turn an intact
box into loose stock; that requires explicit pack/unpack semantics.

### Use-by and claims

Use-by is time-dependent eligibility, not quantity destruction. Advancing time or recording physical
loss can make an active reservation short. The model requires the reported shortage to equal current
truth. Ordinary allocation and consumption preserve evidence that the resource was usable at the time;
an explicit allow-expired claim is modeled separately.

### Refinement and liveness

`DurableTransferRefinement` maps lower-level partial durable writes to abstract stuttering and maps only
world publication to the atomic transfer. `InventoryOperation` and `RepairLiveness` keep later
operation-row compaction separate: a crash after publication is repaired by compaction and can never
turn into abort. `RepairLiveness` adds weak fairness; without such a scheduler assumption, safety alone
would not imply eventual repair.

See [`FOUNDATIONS.md`](FOUNDATIONS.md) for semantic/research influences and [`TOOLING.md`](TOOLING.md)
for why TLC remains mandatory and when Apalache, Alloy, or a theorem prover might add value.

### AuthorityWriterFence.tla

Models the atomic race between an admitted legacy physical writer and the
InventoryOnce cutover fence. The active writer set and fence cannot overlap:
a writer admitted first prevents the fence, while a fence claimed first rejects
new legacy writers. An explicit one-way operator authorization must also occur
before a fence can be claimed, so ordinary inventory traffic cannot infer first
cutover. Exact attempt tokens prevent two concurrent executions from sharing one
logical writer identity. A leaked/crashed writer token deliberately blocks cutover;
this model makes no false liveness claim that an operator-free timeout can prove the
abandoned legacy write is safe to forget.

## Implementation correspondence and executable refinement

TLC establishes properties of the bounded abstract machines in this directory. Production assurance also requires an explicit correspondence relation from the exported TypeScript surface to those machines. The repository therefore generates and audits four core correspondence manifests in `formal/implementation-conformance/`:

- `API_ASSURANCE.json`: every mechanically discovered public root, `/storage`, `/migrations`, `/kernel`, authority-port, and façade method, with model/invariant, input abstraction, state projection, result, retry, rejection, adapter evidence, and gap links;
- `FIELD_CLASSIFICATION.json`: every semantic input/output field, mapped to an executable abstraction helper and exact qualified TLA state variable, or explicitly excluded as application decoration, observational evidence, or unsupported scope;
- `TRACE_REPLAY_ASSURANCE.json`: finitely bounded real-facade traces covering receive, issue, transfer, count, transformation definition reads/planning, migration publication/repair, authority transitions, and metamorphic state/result replay;
- `FORMAL_COVERAGE_GAPS.json`: the complete nonclaim/gap ledger. An API or field cannot silently omit its gaps.

The same pipeline also generates `CALL_CHAIN_ASSURANCE.json` for compiler-resolved execution witnesses and publishes `EXECUTABLE_ASSURANCE_REPORT.json` as the state-bound executable/full-formal certificate.

Run:

```sh
source ~/.nvm/nvm.sh
if [ -f .nvmrc ]; then nvm use; else nvm use 22; fi  # fallback must satisfy package.json#engines
pnpm assurance:generate
pnpm assurance
```

`assurance:generate` re-discovers the current compiler surface; it does not read a hand-maintained `/tmp` inventory. `assurance` requires exact key equality, validates every referenced TLC model/invariant and TLA variable, confirms executable abstraction helpers and evidence files, and checks the kernel plus memory reference adapter. A later backend/data slice must add its own database trace evidence without making this kernel slice depend on absent application code.

The executable abstraction in `test/formal-implementation-abstraction.ts` is intentionally lossy only where the formal claim is lossy. It removes names, prices, currencies, presentation configuration, and other application decoration, while retaining catalog meaning, exact measurement vectors, position identity, events, reservations, counts, authority provenance, operation intent, publication roots, and retry/result evidence. Refinement tests compare independent abstract state/result values rather than invoking the reducer under test to compute their expected answer.

### Authority provenance

First authority is one of two disjoint modeled transitions:

1. **legacy cutover** — certified adapter, explicit cutover authorization, drained writer fence, two stable source compilations, durable migration publication, and retained source/target evidence;
2. **greenfield** — certified adapter, explicit greenfield deployment authorization, no admitted writer, and the exact canonical revision-zero empty world. It records `activationKind = greenfield` and cannot fabricate a source root, migration plan/catalog digest, mismatch history, or fence token.

The authority code rejects configurations containing both authorization modes. `AuthorityWriterFence` models that exclusion and checks `ActivationProvenanceIsExact`, `GreenfieldCannotFabricateLegacyEvidence`, and the activation-versus-writer race. The memory tests exercise exact replay, nonempty-target rejection, and the activation-versus-writer compare-and-set race. Backend Mongo/SQLite proof is not claimed in this slice.

### Nonclaim

This bridge does **not** turn bounded TLC checking into a proof of arbitrary TypeScript, Node.js, Parse Server, MongoDB, SQLite, operating-system, or deployment behavior. This slice uses strict type checking, executable refinement, deterministic trace replay, memory-adapter conformance, failpoint repair tests, and the explicit gap list. Later application adapters need their own tests. A passing gate means the checked code and evidence satisfy the declared correspondence; it does not erase the listed bounds or unsupported domains.

## ImplementationConformance and generated refinement audit

`ImplementationConformance.tla` is the bounded state/result model for representative façade calls, completed replay, and changed-intent rejection. The public TypeScript mapping, migration checks, bidirectional variable/action refinement, executable evidence, and explicit gaps are described in `IMPLEMENTATION_CONFORMANCE.md` and checked by `pnpm conformance:check`.
