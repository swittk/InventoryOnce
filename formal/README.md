# InventoryOnce formal models

The formal suite is a forward design constitution plus implementation-level evidence for the
InventoryOnce TypeScript core. It separates:

1. **safety** — bad inventory states are unreachable;
2. **refinement** — crash-separated durable behavior maps to the intended atomic operation;
3. **liveness** — pending repair eventually terminates under explicit fairness assumptions;
4. **future constraints** — mature semantic families modeled before production adapters implement them.

Run every registered model/property with:

```bash
source ~/.nvm/nvm.sh
if [[ -f .nvmrc ]]; then nvm use; else nvm use 22; fi  # fallback must satisfy package.json#engines
pnpm formal
```

The runner uses the package-pinned `tla2tools.jar`, one unique metadata directory per model process, and
keeps a failed model directory so a counterexample can be inspected. It also runs eleven deliberately bad
transitions: four snapshot-supersession mutations, one cross-transfer receive mutation, one correction-history
erasure mutation, one split durable-transfer projection mutation, three use-by/reservation guard mutations, and one
duplicate traceability-production mutation. TLC must reject every one through its named unchanged safety invariant.

## Registered TLC checks

### Implemented semantics and executable companions

| Model                          | Formal responsibility                                                                                                                                                                                                                                                               | TypeScript evidence                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CatalogPublication`           | retained revision sets only grow; active pointers name retained revisions; published snapshots remain replayable; revision meaning never changes; one operation identity freezes one publication                                                                                    | `catalog-publication.test.ts`, catalogue snapshot validation, intent fingerprints                         |
| `ReclassificationConservation` | split, merge, and movement conserve quantity per item and per exact packaging bucket                                                                                                                                                                                                | `reclassification.test.ts`, `createInventoryReclassificationManyEvent`, event-shape guards                |
| `UseByReservation`             | normal allocation/consumption excludes expired resources; time or physical loss may create a visible shortage; explicit allow-expired policy remains distinct                                                                                                                       | `availability.test.ts`, `policy-operations.test.ts`, `reservations-counts.test.ts`                        |
| `InventoryOperation`           | Begin freezes stock, catalogue, lot, container, traceability, reservation, and count roots; staged writes remain hidden; publication changes every root together; later compaction drops only the repair plan and cannot abort the visible world                                    | storage conformance/failpoint suite                                                                       |
| `PublishedHeadCAS`             | two writers may plan from one published head, but only one compare-and-swap Begin may claim that base; stale work cannot publish over the winner; exact retry stutters; committed history and visible revision stay aligned; once a fence is claimed, repair eventually clears it under weak fairness | durable begin validators/materializers, memory conformance tests, and the contract later adapters must meet |
| `ReservationSafety`            | one exact reservation cannot be overallocated, consumed twice, or silently reused with changed lifecycle intent                                                                                                                                                                     | reservation tests and façade fingerprints                                                                 |
| `PackagingIdentity`            | package revisions with the same human word remain distinct and intact package quantities stay whole                                                                                                                                                                                 | catalogue/stock tests and package event validation                                                        |
| `DurableTransferRefinement`    | concrete event/projection/reservation/count/receipt writes stutter until completion, which refines one abstract atomic transfer                                                                                                                                                     | storage conformance suite and `AbstractTransfer` mapping                                                  |
| `TransferLifecycle`            | prepared, dispatched, partial-receipt, completed-receipt, and release transitions conserve one transfer independently; cross-transfer receipt cannot consume another transfer’s in-transit stock                                                                               | `transfer-lifecycle.test.ts`, transfer lifecycle event/projection refinement                              |
| `RepairLiveness`               | under weak fairness, a pending frozen plan eventually publishes/compacts or aborts before publication; repair needs no original planner                                                                                                                                             | generic operation/migration repair tests                                                                  |
| `CorrectionHistory`            | original history persists; incomplete correction storage does not replace current truth; completed correction advances current meaning atomically                                                                                                                                   | correction tests and append-only projection indexes                                                       |
| `PhysicalCount`                | snapshot → observation → discrepancy reconciliation preserves legitimate movements during counting                                                                                                                                                                                  | count lifecycle tests                                                                                     |
| `TraceabilityGraph`            | containment is acyclic; aggregation, association, and irreversible genealogy remain distinct                                                                                                                                                                                        | traceability/correction tests                                                                             |
| `AuthorityWriterFence`         | explicitly authorized cutover fencing cannot overlap admitted legacy physical writers; activation provenance stays exact and greenfield activation cannot fabricate legacy evidence                                                                                                | `authority.test.ts`, authority control/cutover compare-and-set tests                                      |
| `SnapshotSupersededWorkflow`   | migration-only snapshot-superseded legacy workflow rows remain audit evidence, generate no physical event or guessed terminal outcome, and cannot resume after the authoritative snapshot/fence transition                                                                          | migration/storage refinement plus four deliberate mutation configs                                        |
| `RecordedDeficit`              | Record mode keeps genuine shortfall as a signed non-allocatable liability while Reject mode stutters; exact replay preserves the frozen deficit/shortfall and receipts never turn deficit into physical stock                                                                         | policy-operation, migration, projection, and replay tests                                                  |
| `ImplementationConformance`    | bounded state/result correspondence for representative public calls, exact replay, changed-intent rejection, and the generated API/field/trace/gap evidence bridge                                                                                                                  | generated assurance audit plus executable refinement/conformance tests                                     |

### Mature-system constraints ahead of some production adapters

| Model                 | Design constraint                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompositionRevision` | two exact heterogeneous package generations coexist across two locations; transfer preserves source revision; opening consumes one intact pack and produces its revision-frozen vector at that location; durable retry identity, source counts, component totals, distinct item axes, and a derived exact report stay safe across active-pointer changes |
| `CollectionView`      | “same brand” and “all OCPs” are immutable read-only membership revisions; reports retain exact item identity; changing the active view cannot rewrite retained views or authorize substitution                                                                                                                                                           |
| `FungibilityPool`     | mutual interchangeability is an explicit immutable pool revision with exact common-basis weights; underlying item identity never merges; pool totals remain derived views; active-pointer changes cannot reinterpret frozen claims; direct issue preserves claim feasibility                                                                             |
| `ResourceDimensions`  | location, owner, custody/possession, status, and in-transit state are orthogonal; only explicit receipt/issue changes total active resources                                                                                                                                                                                                             |
| `ReservationScope`    | broad claims can narrow and bind while all active claims remain simultaneously feasible; allocated stock cannot fall outside a refined scope; physical loss creates an explicit shortage report                                                                                                                                                          |
| `DualMeasure`         | primary handling count and independently measured quantity are separate exact axes; one scalar unit is not the deepest inventory ontology                                                                                                                                                                                                                |
| `DistributedRights`   | escrow free/held rights back remaining physical stock, giving a formal direction for safe offline/distributed reservation and consumption                                                                                                                                                                                                                |

`AbstractTransfer` is imported by `DurableTransferRefinement`; it is the abstract specification rather
than a separate runner entry.

## Latest bounded exploration sizes

The exact seed/fingerprint values vary by run. The latest complete run explored:

| Model/property                 | Generated states | Distinct states | Complete graph depth |
| ------------------------------ | ---------------: | --------------: | -------------------: |
| `AuthorityWriterFence`         |       12,393,407 |       2,594,448 |                   35 |
| `PublishedHeadCAS`             |            4,284 |           1,871 |                   24 |
| `CompositionRevision`          |           50,849 |           6,688 |                   10 |
| `CollectionView`               |           13,123 |           1,458 |                   10 |
| `FungibilityPool`              |        1,337,922 |         113,054 |                   15 |
| `CatalogPublication`           |           88,723 |          52,552 |                    5 |
| `ReclassificationConservation` |           34,201 |             900 |                    8 |
| `UseByReservation`             |              728 |             278 |                    9 |
| `ResourceDimensions`           |           19,849 |           2,016 |                   12 |
| `ReservationScope`             |            2,101 |             548 |                    7 |
| `TraceabilityGraph`            |          212,193 |           1,036 |                   13 |
| `PhysicalCount`                |            3,268 |           1,134 |                   14 |
| `DualMeasure`                  |              213 |              43 |                    7 |
| `DistributedRights`            |              351 |              70 |                    7 |
| `CorrectionHistory`            |                8 |               7 |                    6 |
| `DurableTransferRefinement`    |                7 |               6 |                    5 |
| `TransferLifecycle`             |            4,321 |             929 |                    8 |
| `RepairLiveness`               |              540 |             265 |                   13 |
| `RecordedDeficit`              |           21,342 |           2,313 |                    9 |
| `SnapshotSupersededWorkflow`   |               54 |              25 |                    8 |
| `InventoryOperation`           |           22,689 |           3,889 |                   12 |
| `ImplementationConformance`    |          390,895 |           6,488 |                    5 |
| `ReservationSafety`            |               41 |              25 |                    5 |
| `PackagingIdentity`            |            1,831 |             383 |                   18 |

All reachable states in those finite configurations were checked by TLC.

The normal safe-model rows above stay the positive system runs. Eleven extra mutation configs cover four
snapshot-supersession violations (resume after disposition, physical disposition event, guessed completed
outcome, and source movement after capture), one cross-transfer receive that violates transfer isolation, one
correction-history erasure, one split durable-transfer projection, three use-by controls (stale shortage report,
expired ordinary allocation, and expired ordinary consumption), and one duplicate traceability production. The
traceability control uses a ghost production counter so a second production of the same set-valued identity is
observable and must violate `ProducedIdentityWasCreatedOnce`. Those runs pass only when TLC finds the exact
expected invariant violation; they are not folded into the safe models' state counts.

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
and 3 placebo-C units. The finite configuration has two physical packs of each revision, two locations,
and four durable opening identities. TLC explores active-pointer changes, arbitrary unopened-pack
transfers, independent opening order, and exact retries rather than one scripted sequence.

Every physical pack permanently retains its exact package revision, which points to one exact immutable
composition revision. Opening consumes exactly one pack token, freezes its package/composition/location/
output intent under one operation identity, and adds exactly that composition's vector at the pack's
current location. A retry transition exists only when every frozen field matches; a changed pack,
package revision, composition revision, or location has no accepted transition. The active composition
pointer is never consulted for opening arithmetic.

The configured invariants check the registered v1/v2 vector fields explicitly, then check non-negative bounded types, intact-plus-opened source conservation per
revision, one completed operation per opened pack, at most one opening contribution per operation ID,
exact loose production from completed v1/v2 operations, exact production at each recorded opening
location, component potential conservation, and separate active-A/active-B/placebo-P/placebo-C buckets.
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

### Fungibility versus substitution

`FungibilityPool` models only explicit **mutual interchangeability** under one immutable pool revision.
Every member retains its exact item identity; a pool is a derived common-basis view and an eligible
fulfillment scope, not a stock merge or item reclassification. One revision deliberately gives a member
a two-to-one basis weight, while an older revision excludes that member. Claims freeze the exact pool
revision used when created, so changing the active pointer cannot reinterpret an allocation. One claim
is store-only while another may be fulfilled across locations. Direct pool issue and location transfer
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
