# InventoryOnce formal foundations

InventoryOnce is not supposed to model only the features Shinebright happens to need today. The formal layer defines the inventory world that future APIs and adapters must refine.

## Research inputs

The model deliberately combines several mature lines of work instead of copying one ERP schema.

- **SAP EWM quant semantics**: stock identity is a product plus independent stock dimensions such as location/HU, batch, owner, party entitled to dispose, and stock type; physical and available quantities are different views. InventoryOnce retains those distinctions but models physical topology generically as direct placement plus node ancestry instead of separate hardcoded location/HU classes.
- **Microsoft Dynamics reservation hierarchies**: a claim can exist at a less-specific level and later become bound to a placement/batch/handling identity. Therefore a reservation is a constraint over eligible stock, not necessarily a pointer to one exact stock row at creation time.
- **Oracle WMS/LPN semantics**: reservations may bind whole handling units or individual lots inside them; moving an LPN moves its physical ancestry without inventing a second stock class. This argues for generic placement nodes plus claims over exact identities/scopes.
- **GS1 EPCIS 2.0 / CBV**: reversible aggregation/disaggregation, durable association, irreversible transformation, observation, disposition, ownership, possession, location, and business-transfer context are distinct concepts. InventoryOnce should preserve these distinctions and be able to export/import compatible traceability facts without making EPCIS its internal database schema.
- **GS1 GTIN Management / Healthcare GTIN Allocation**: changing declared net count or the members of a predefined assortment creates a newly identified trade-item/package configuration. Existing physical packs cannot be reinterpreted by editing today's definition.
- **Versioned BOM/change-control practice**: heterogeneous component vectors are retained revisions/effective changes, not mutable expansion recipes applied retroactively. Opening/decomposition must use the exact composition revision attached to the physical pack.
- **REA (Resource-Event-Agent)** and ISO/IEC 15944-4: durable business truth is naturally expressed as resources changed by events with participating agents/parties and commitments. InventoryOnce uses the same direction: physical resource facts/events first, reports/projections second.
- **Petri nets / multiset rewriting / resource semantics**: inventory is fundamentally a resource-sensitive transition system. Internal moves rewrite where/how resources are classified; transformation consumes inputs and produces outputs; arbitrary duplication/deletion is illegal unless an explicit external or transformation cause exists.
- **Escrow transactions (O'Neil), invariant confluence (Bailis et al.), bounded counters / Just-Right Consistency**: non-negative availability is an invariant that determines where coordination is required. A future distributed/offline InventoryOnce should allocate decrement/reservation rights explicitly instead of either globally locking everything or silently overselling.
- **TLA+ refinement**: finite model checking is not the end claim. Durable adapters should refine abstract inventory state machines; safety, liveness/fairness where meaningful, and explicit refinement mappings are the long-term target.

## The abstract inventory world

The deepest model is not `InventoryStock`, `Substock`, a SQL row, or a package. It is:

1. **Resource identity**: item plus optional lot/serial and traceability identity.
2. **Orthogonal current dimensions**: direct placement, whereabouts state, owner, possessor/custodian, status/disposition, packaging revision, and application-defined qualified dimensions.
3. **Placement topology**: generic nodes with one optional direct parent and explicit acceptance policy. A node may represent any application-defined physical thing or place without kernel category behavior.
4. **Quantity vector**: one required primary axis plus optional independent measured axes. Fixed-UOM conversion and catch-weight/dual-UOM are different cases.
5. **Claims**: commitments/reservations over eligible, ordinarily usable resources, possibly less specific than the eventual pick.
6. **Association graph**: reversible installation/relationship truth independent of physical placement.
7. **Genealogy graph**: irreversible consume/produce relation from transformations.
8. **Events**: explicit causes that place, detach, mark missing, relabel, associate, transform, receive, issue, count/reconcile, or correct prior assertions.
9. **Parties/agents**: actor, owner, possessor, source/destination party, and other business context stay distinguishable.

Current balances are projections of committed event/resource truth.

## Long-term invariant families

### Resource conservation and causal creation/destruction

Internal movement, ownership/custody/status changes, packing, unpacking, and placement-node moves cannot change the physical quantity vector. External receipt/issue and transformation may change per-item totals, but every increase/decrease must be attributed to an explicit event leg.

### Dimension independence

A verb changes only the dimensions it names. A direct-placement transfer cannot silently change owner, lot, status, package revision, custody, whereabouts state, or qualified dimensions. Moving an ancestor changes one parent edge and cannot rewrite descendant stock. Ownership transfer need not imply physical movement. In-transit stock remains real stock.

### Placement topology, embodiment, and unresolved whereabouts

Direct placement is one stock-position dimension; placement-node parentage is a separate topology. Every placed node has at most one direct parent, parents must accept placement, and ancestry is acyclic. Standalone nodes such as rooms, shelves, and bays need no inventory resource. Moving a standalone ancestor changes only that node's parent edge. Descendant stock retains its direct anchor and exact identity while its resolved ancestry changes.

Fungible quantity cannot own placement topology because no exact physical unit exists for descendants to depend on. One exact physical unit may be individualized into one live serial resource, and that serial may uniquely embody one placement node. While active, the serial resource is the authority for the embodied node's parent and lifetime: moving the node moves the resource atomically, and moving/detaching/placing the resource derives the node topology. One serial cannot embody several nodes, one embodied node cannot outlive its live serial, and a generic reclassification cannot fabricate or switch embodiment.

An embodied resource cannot be issued, scrapped, transformed away, or de-individualized while direct stock or child nodes depend on it. Emptying may move direct contents to another room/node without rewriting nested descendants. Once empty, destruction retires the serial/node pair; de-individualization returns one physical unit to generic quantity and also retires the old current identities. Later individualization must use a fresh identity unless append-only correction targets the exact mistaken retirement event and restores that retained physical identity.

Stock may temporarily have no direct placement only through an explicit whereabouts lifecycle. Detach preserves quantity, last-known placement, time, actor/source provenance, and one stable kernel-owned cohort identity. Marking missing does not destroy stock; placing it resolves the current uncertainty; issue and scrap remain distinct terminal physical meanings. Detached/missing stock contributes to accounted on-hand truth but cannot satisfy ordinary reservations or automatic FIFO/FEFO selection until placed again. When such stock embodies a node, the node becomes unplaced/missing through the same resource truth rather than a second topology authority.

### Quantity-vector correctness

Primary units and independent secondary measures are never collapsed through an assumed fixed ratio. Fixed package definitions freeze exact conversions. Catch-weight/dual-UOM stock may carry an independently measured axis whose value changes only through explicit measured movement/adjustment.

### Signed deficit truth is not allocatable stock

A clinic may physically dispense before a receipt is entered. Under explicit Record policy, that fact is represented as a signed durable deficit, not as fabricated stock and not as migration corruption. Allocation capacity is derived only from positive eligible physical positions; the deficit reduces availability/net truth but cannot itself satisfy an issue, reservation, or transfer. Reject policy remains unchanged and stutters on shortage. Later receipts do not silently erase the earlier deficit event; reconciliation requires an explicit subsequent physical or correction fact.

### Claim feasibility

All active claims must have at least one feasible non-overlapping assignment to eligible, known-placed on-hand resources. Refining a broad claim may narrow its eligible set but may not make the set of all claims infeasible. Consumption happens at most once.

### Heterogeneous compositions and read-only collections

A homogeneous package revision has one exact fixed-content vector for one item revision. A heterogeneous
kit/calendar pack instead has an immutable composition revision whose output lines may name several
items and quantities. Opening one physical pack is an explicit atomic decomposition/transformation:
it consumes the exact source package revision and produces exactly that revision's frozen component
vector. Publishing or activating a later composition cannot change old unopened packs, completed
operations, retries, genealogy, or reports.

Composition correction is append-only too. A bad prior definition/opening assertion remains retained;
a correction or superseding current head may explain what callers should use now, but it cannot rewrite
the old source revision, output vector, or durable retry intent. `CorrectionHistory` owns the general
partial-write/current-head refinement. A composition implementation must add an executable companion
showing its definition/opening rows follow that same retained-old-fact rule.

Read collections such as “same brand” or “All OCPs” are intentionally weaker. They are immutable,
revisioned membership/taxonomy views over exact item revisions (and potentially nested retained
collections). They may provide exact member breakdowns and compatible-measure roll-ups, but membership
alone never means mutual substitution, therapeutic equivalence, or a right to fulfill one member with
another. That stronger meaning belongs to a fungibility pool or application policy.

### Fungibility, supersession, and substitution

A rebrand or definition change of the same resource remains one stable item with immutable item/package
revisions. Different item identities may be counted or fulfilled together only through an explicit,
immutable fungibility-pool revision whose members map exact measurement axes into one exact common
basis. Pool totals are derived views; transfers and issues retain the selected member's real item
identity. Existing claims freeze their pool revision so a later membership/conversion publication cannot
reinterpret them.

Mutual fungibility is deliberately narrower than one-way supersession, preferred-substitute ordering,
formula/BOM substitution, or clinical therapeutic equivalence. Mature systems treat those as dated,
contextual rules rather than an unconditional item merge. InventoryOnce keeps those policy decisions
outside physical truth while retaining enough exact member/pool identity for a caller to implement them
without rewriting stock history.

### Association and genealogy

Physical grouping is placement topology, not a traceability alias. Association is separately modeled for installation/relationship truth that does not define where stock is. Transformation consumes input identity and creates append-only output genealogy; consumed identities do not remain active. Association and genealogy retain their own structural invariants and cannot silently change placement.

### Physical-count correctness

A cycle count is an observation against a defined snapshot/scope, not `SET balance = counted`. Reconciliation must preserve legitimate movements recorded between snapshot, observation, and finalization; otherwise a late count can erase a real transfer.

### Durable operation visibility

Partial database writes are never committed inventory truth. Same operation identity freezes one intent. Completed multi-leg operations expose every leg together. Retry/repair converges exactly once.

### Coordination boundary

The package should explicitly classify operations as coordination-free, locally escrowable, or globally coordinating based on invariants. Receipts are often monotone; decrements and overlapping claims are not automatically so. This decision belongs to the storage/concurrency contract, not application guesswork.

## Formal-method stack

No single notation is forced to do every job.

- **TLA+/TLC**: temporal protocols, retries, concurrent claims, in-transit workflows, count/reconcile races, durable visibility, liveness/fairness.
- **Finite resource/multiset models**: conservation, transformation, package/measure algebra, and dimension-preserving rewrites. TLA+ can encode these small models directly; Petri-net/multiset-rewrite literature is the semantic guide.
- **Graph/property checks**: placement parentage/capability/acyclicity, association, serial uniqueness, genealogy and traceability. Bounded relational checking (Alloy-style reasoning) is appropriate even if implemented initially as TLA+ invariants plus exhaustive TypeScript generators.
- **Invariant-confluence/escrow analysis**: documented proof obligations for distributed/offline adapters, deciding exactly which operations require coordination.
- **Executable refinement/property tests**: every abstract invariant must have a real TypeScript companion. Durable adapters additionally need before/after failpoints at every physical write boundary.

## Registered mature-system model suite

The formal runner executes the model suite exported by `scripts/formal-models.mjs` as release evidence; that registry is the source of truth for suite membership and count. The mature-system obligations highlighted below are already registered and checked; each claimed modeled behavior has companion executable refinement, property, or failure-injection evidence. The generated gap ledger records fields, state/result surfaces, and other boundaries that remain explicitly unmodeled. Future scope is limited to behavior explicitly called out as unmodeled below, such as distributed partition/merge behavior:

- `CompositionRevision`: exact heterogeneous package generations, revision-pinned opening, transfer preservation, idempotent intent, and component-vector conservation.
- `CollectionView`: retained read-only group membership and exact member breakdowns without physical merging or substitution authority.
- `FungibilityPool`: exact revisioned mutual interchangeability without item merging or claim reinterpretation, including placement-scoped claims and reservation-safe member transfers.
- `ResourceDimensions`: direct placement, detached/missing whereabouts, owner, custody, and status are orthogonal; internal rewrites conserve resources and preserve lifecycle identity.
- `ReservationScope`: broad claims, later refinement/allocation, global feasibility, and exclusion of unplaced stock from ordinary capacity.
- `PlacementGraph`: standalone and serial-embodied placement topology; one-parent/cycle/acceptance safety; generic↔unique conservation; one-to-one embodiment; resource-parent agreement; empty-before-retirement; fresh identity after de-individualization; and ancestor moves that preserve descendant direct anchors.
- `TraceabilityGraph`: association vs irreversible transformation/genealogy, independent of placement.
- `PhysicalCount`: snapshot/observation/reconciliation in the presence of legitimate concurrent movements.
- `DualMeasure`: primary quantity plus independent catch-weight/secondary measurement.
- `InventoryOperation`: durable idempotent all-or-nothing visibility.
- `PackagingIdentity`: revision-frozen whole-package constraints.
- `DistributedRights`: allocated decrement/reservation rights and free-right transfer, checking rights-to-stock backing, physical accounting, and consumption bounds. Partition/merge behavior is not yet modeled.
- `CorrectionHistory`: immutable event correction/supersession with partial correction writes hidden until the logical correction is complete.
- `DurableTransferRefinement`: the concrete crash-separated transfer protocol must implement an abstract atomic transfer under an explicit refinement mapping.
- `RepairLiveness`: under weak fairness, pending repair work eventually reaches a terminal completed/aborted state.

The reference durable protocol now freezes a complete next-world plan at begin and has an executable before/after failpoint suite. Before any production database adapter becomes authority, that adapter must pass the same conformance suite and document how its real transaction/publication behavior maps to the abstract operation/resource model.

## Primary references behind these choices

This is intentionally a mixed bibliography: warehouse standards say which distinctions exist in real mature systems; formal-method work says how to reason about them without copying one vendor schema.

- Leslie Lamport, _Specifying Systems_; _Proving Safety Properties_; _Computation and State Machines_; TLA+ lectures on liveness/fairness and implementation with refinement mappings.
- Peter Bailis et al., _Coordination Avoidance in Database Systems_, PVLDB 2014/2015 — invariant confluence as the criterion for when coordination is necessary.
- Patrick O'Neil, _The Escrow Transactional Method_, ACM TODS 1986 — allocation of numeric rights so local transactions can preserve global bounds without serializing every operation.
- Marc Shapiro et al., _Just-Right Consistency: Reconciling Availability and Safety_, 2018 — CRDT/escrow-style techniques and synchronization chosen from application invariants.
- William E. McCarthy, _The REA Accounting Model: A Generalized Framework for Accounting Systems in a Shared Data Environment_, 1982, plus ISO/IEC 15944-4 — resources/events/agents/commitments as durable enterprise facts instead of report-shaped storage.
- GS1 EPCIS 2.0 / Core Business Vocabulary — event time versus record time; aggregation/disaggregation; association; transformation genealogy; ownership, possession and location context; immutable correction/error-declaration practice.
- GS1 GTIN Management Standard and GS1 Healthcare GTIN Allocation Rules — declared net-count and predefined-assortment changes require newly identified trade-item/package configurations instead of reinterpretation of prior stock.
- SAP BOM change-number/version practice — component-vector changes are controlled retained BOM changes/alternatives rather than one timeless mutable recipe.
- SAP EWM quant/stock-key semantics — independent batch, location/HU, owner/party-entitled and stock-type dimensions.
- Microsoft Dynamics 365 reservation hierarchies and catch-weight warehousing — deferred reservation specificity and independently measured handling/weight quantities.
- SAP product interchangeability/supersession and Microsoft Dynamics item-substitution plan groups — mutual interchangeability, dated supersession, and context/priority substitution are different semantics rather than one generic item merge.
- HL7 FHIR MedicationKnowledge — ingredient, strength, dose form, intended route, and packaging are separate medication knowledge facts; a clinic must not infer therapeutic interchangeability from inventory identity alone.
- Oracle WMS LPN reservation/handling-unit semantics — reservations over whole handling units and lot-qualified contents.
- Coloured Petri Net and multiset-rewriting literature — resource-sensitive discrete-event semantics and exhaustive finite-state analysis.
- Alloy/relational-modeling literature — bounded structural checking for graph-shaped identities, placement parentage and object-centric event relationships.

These references are design input, not claims that InventoryOnce is API-compatible with any one system or standard. Where a standard gives a transport/event vocabulary, InventoryOnce should preserve enough distinctions to map cleanly without adopting that standard as its internal persistence schema.

## Implemented consequences in the current core

The current TypeScript contracts now embody several direct consequences of these foundations:

- **Published definitions are retained facts.** Catalogue revisions are immutable, publications carry
  their exact snapshots, active pointers move only to retained revisions, and later catalogues must
  preserve prior meaning.
- **Reclassification is a multiset-conserving operation.** Split/merge/relot/direct-placement/status changes
  are one atomic event and conserve every item and exact package bucket. Packaging conversion remains
  an explicit `pack`/`unpack` operation.
- **Expiry is eligibility, not disappearance.** Lot expiry and placement-ancestry use-by make stock unusable for
  ordinary allocation/consumption but never silently delete quantity. Physical stock, usable stock,
  expired stock, exact allocation, broad demand, and shortage are reported separately.
- **A placement node is not a unit of measure.** Package revisions describe exact fixed contents;
  standalone nodes identify places, while an inventory holder node is explicitly embodied by one live
  serialized resource. Fungible quantity cannot own children, and retired serial/node identities cannot
  silently become current again.
- **Individualization is reversible but identity-aware.** Exactly one generic physical unit may become one
  current serial and optional placement-capable node. Once empty, de-individualization conserves quantity
  back into the generic pool while retaining and retiring the old identity in history; later
  individualization receives a fresh identity unless correction reverses the exact mistaken retirement.
- **Correction is append-only.** Quantity discrepancies use movement-safe count reconciliation; wrong
  historical assertions, lot metadata, and placement-node metadata use retained correction chains.
- **Migration is an interpretation proof boundary.** Typed source queries produce normal opening and
  traceability facts; ambiguity blocks; dry-run binds the plan to an exact target content root; the
  whole batch publishes atomically and can be repaired without rereading legacy storage.

These implementation claims remain narrower than the future distributed-rights model. No current
production adapter should claim coordination-free offline safety until it implements and tests the
escrow-rights protocol described by `DistributedRights`.

## Legacy-writer admission and cutover fencing

Authoritative cutover uses one atomic authority-control row. Every legacy
physical writer must first add an exact `(writerToken, attemptToken)` admission.
The cutover fence may be claimed only when the active-writer set is empty, and
writer admission is rejected once that fence is present. This closes the
writer-first/fence-first race that a read-then-write mode flag cannot close.

Application workflows hold an outer token across all of their line-level stock
changes. Individual ledger mutations retain their own narrower tokens, while
trusted stock/lot trigger sub-writes reuse the outer ownership instead of
inventing nested source-row writers. Direct Parse edits to stock, lot, substock,
or substock-lot rows acquire trigger-scoped admission across their database
write and after-trigger reconciliation.

A failed database write after successful admission intentionally leaves a
visible token. Cutover remains blocked until repair can prove whether the source
write committed and then releases that exact attempt. Wall-clock expiry alone
is not proof and is therefore not part of the safety model.

## Code-to-model refinement foundation

The formal state is not inferred informally from class names. `scripts/formal-implementation-surface.cjs` enumerates the exported callable/method/field surface using the TypeScript compiler, and `scripts/generate-formal-implementation-assurance.py` assigns each discovered member one explicit correspondence entry. The audit rejects additions, removals, renamed fields, unknown invariant names, unknown TLA variables, missing executable projection helpers, and unlinked gaps.

The refinement relation is organized around independent projections:

- `abstractInventoryState` — retained catalog digest, exact buckets, lots/placement nodes, serial embodiment/retirement, topology, committed events, and published revision;
- `abstractOperationResult` — operation identity, event/receipt revision, replay, allocations, reservation/count result;
- `abstractReservationState`, `abstractCountState`, and `abstractTraceabilityState` — the books/graphs represented by their dedicated models;
- `abstractMigrationState` — diagnostics, frozen operation set, target publication, manifest status, and repair/abort result;
- `abstractAuthorityState` — monotonic mode/revision, certification, admitted writers, mismatch/fence/source/target evidence, projection status, and exact legacy-cutover versus greenfield provenance.

A field that contributes to conserved or lifecycle truth must name one of these executable helpers and at least one literal variable in a registered TLA module. A field excluded as price, currency, display configuration, audit-only evidence, or unsupported future scope must instead carry an explicit exclusion relation and no TLA-variable claim.

Bounded trace replay is the executable bridge from actions to implementations. Each trace has a maximum abstract step count, facade calls, model/invariant set, state projection, result refinement, retry relation, rejection relation, adapter set, failpoints, evidence marker, and linked gaps. This standalone repository executes the memory reference implementation and its broader finite metamorphic corpus. Mongo/SQLite adapter checks and the exact four-call Shinebright seam are required downstream integration evidence, not tests executed by this repository.

## Implementation refinement foundation

A formal action is considered connected to implementation only when the generated public API/field ledger names real TLA symbols, the bidirectional map names the concrete extractor/result relation, and executable evidence observes the real facade post-state through the public published-snapshot API. Completed replay must stutter; changed intent must reject and stutter; crash recovery may finish a previously frozen durable publication and therefore refines the durable publication/repair models instead of the replay action. Missing classification or executable evidence is an explicit gap, never implicit coverage.

## Authoritative opening snapshots

A reviewed opening snapshot may supersede unfinished legacy workflow state without inventing its historical outcome. The formal boundary is a typed source disposition, not an inventory mutation: it preserves the source row as audit evidence, contributes no physical event, cannot alter current snapshot truth, and becomes permanently non-resumable once the writer fence is held. True quantity algebra or unit-identity ambiguity remains blocking evidence rather than being hidden behind snapshot supersession.
