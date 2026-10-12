# InventoryOnce formal implementation conformance

This file is generated from the exact TypeScript surface plus the checked API, field, and gap manifests.

Use the repository `.nvmrc` when one exists; otherwise run the assurance command with a Node version permitted by `package.json#engines`. Edit only checked source/manifests, run `pnpm assurance:generate` when generated evidence must change, then run `pnpm assurance --write-report`.

Surface SHA-256: `ad931c990b39a6dfb7d1f7a014e59f07d61b554624cc230ed2b92b5cd9a0b37f`

## Mechanically covered surface

- Grouped façade/read methods: 130
- Authority-port methods: 14
- Durable-storage-port methods: 17
- Public exported class methods: 71
- Root callable exports: 100
- Storage callable exports: 23
- Migration callable exports: 15
- Kernel callable exports: 167
- Reachable public data types: 399
- Classified public fields: 2480
- Input-reachable fields: 2148
- Output-reachable fields: 891
- Callback-argument-reachable fields: 365
- Callback-result-reachable fields: 433
- Callable-field overload signatures: 11
- Optional fields: 1034
- Explicit undefined-union fields: 2
- Explicit nullable fields: 6
- Public call/construct overload signatures: 537
- Directly executed public APIs: 202
- Public APIs exercised through tested internal call chains: 331
- Explicit-gap public APIs: 4
- Unreferenced public APIs: 0
- Explicit recursive type edges: 3
- Silently truncated types: 0

Any added/removed method, callable export, class method, type field, field type, or declaration location fails the audit until the checked correspondence is updated.

## Assurance families

| Family | API entries | Formal models | Status | Gaps |
|---|---:|---|---|---|
| allocation-helper | 6 | ReservationScope, ReservationSafety, UseByReservation, PlacementGraph, PackagingIdentity, FungibilityPool, ResourceDimensions | covered | — |
| authority-control | 31 | AuthorityWriterFence | covered | — |
| authority-cutover | 4 | AuthorityWriterFence, CatalogPublication, PublishedHeadCAS, RepairLiveness, SnapshotSupersededWorkflow | covered | GAP-LEGACY-SOURCE-INTERPRETATION |
| catalog-definition | 76 | CatalogPublication, PackagingIdentity, CompositionRevision, CollectionView, FungibilityPool | covered | GAP-HASH-COLLISION-ASSUMPTION |
| catalog-publication | 7 | CatalogPublication, InventoryOperation, PublishedHeadCAS, RepairLiveness | covered | GAP-HASH-COLLISION-ASSUMPTION, GAP-DB-IMPLEMENTATION-UNBOUNDED |
| collection-read | 4 | CollectionView | covered | — |
| composition-open | 3 | CompositionRevision, PackagingIdentity, ReclassificationConservation, DualMeasure, TraceabilityGraph, InventoryOperation | covered | — |
| composition-read | 3 | CompositionRevision | covered | — |
| correction | 2 | CorrectionHistory, InventoryOperation, PublishedHeadCAS | covered | GAP-COUNT-CORRECTION-HISTORY-REPLAY |
| count | 11 | PhysicalCount, InventoryOperation, PublishedHeadCAS, ResourceDimensions | covered | GAP-COUNT-CORRECTION-HISTORY-REPLAY |
| dimension-reclassification | 29 | ResourceDimensions, ReclassificationConservation, InventoryOperation, PlacementGraph | covered | — |
| durable-protocol | 43 | InventoryOperation, PublishedHeadCAS, RepairLiveness, DurableTransferRefinement, SnapshotSupersededWorkflow | covered | GAP-DB-IMPLEMENTATION-UNBOUNDED, GAP-PRODUCTION-STORAGE-SCALE-GC, GAP-HASH-COLLISION-ASSUMPTION |
| external-plugin-boundary | 4 | CatalogPublication | explicit-gap | GAP-EXTERNAL-MIGRATION-CALLBACKS, GAP-LEGACY-SOURCE-INTERPRETATION |
| facade-construction | 2 | InventoryOperation | covered | GAP-EXTERNAL-CLOCK, GAP-DB-IMPLEMENTATION-UNBOUNDED |
| fungibility-movement | 3 | FungibilityPool, ReservationScope, ReservationSafety, UseByReservation, InventoryOperation, PublishedHeadCAS | covered | GAP-FUNGIBILITY-EXACT-SEARCH-BOUND |
| fungibility-read | 12 | FungibilityPool, UseByReservation | covered | GAP-FUNGIBILITY-EXACT-SEARCH-BOUND |
| identity-normalization | 22 | ResourceDimensions, PlacementGraph, TraceabilityGraph, SnapshotSupersededWorkflow | covered | — |
| lot-command | 3 | UseByReservation, CorrectionHistory, InventoryOperation | covered | — |
| migration-definition | 8 | CatalogPublication, PlacementGraph, TraceabilityGraph, ReclassificationConservation, SnapshotSupersededWorkflow, CompositionRevision | covered | GAP-LEGACY-SOURCE-INTERPRETATION, GAP-EXTERNAL-MIGRATION-CALLBACKS |
| migration-publication | 3 | CatalogPublication, InventoryOperation, PublishedHeadCAS, RepairLiveness, PlacementGraph, TraceabilityGraph, SnapshotSupersededWorkflow | covered | GAP-LEGACY-SOURCE-INTERPRETATION, GAP-DB-IMPLEMENTATION-UNBOUNDED |
| operation-result-helper | 11 | InventoryOperation, PublishedHeadCAS | covered | — |
| packaging-reclassification | 4 | PackagingIdentity, ReclassificationConservation, DualMeasure, InventoryOperation | covered | — |
| placement-command | 18 | PlacementGraph, ResourceDimensions, UseByReservation, CorrectionHistory, InventoryOperation | covered | — |
| pure-exact-value | 90 | DualMeasure, PackagingIdentity | covered | — |
| read-current | 34 | PublishedHeadCAS, ResourceDimensions, PlacementGraph, UseByReservation, ReservationScope, CollectionView, FungibilityPool, CorrectionHistory | covered | — |
| read-snapshot | 23 | PublishedHeadCAS, PlacementGraph | covered | GAP-DB-IMPLEMENTATION-UNBOUNDED |
| reservation | 19 | ReservationSafety, ReservationScope, UseByReservation, InventoryOperation | covered | — |
| scrap | 5 | InventoryOperation, PackagingIdentity, DualMeasure, ReservationSafety, UseByReservation | covered | — |
| stock-issue | 4 | InventoryOperation, PackagingIdentity, DualMeasure, ReservationSafety, UseByReservation | covered | — |
| stock-policy-issue | 2 | InventoryOperation, ReservationScope, ReservationSafety, UseByReservation, PackagingIdentity, RecordedDeficit, FungibilityPool | covered | — |
| stock-policy-transfer | 2 | ResourceDimensions, PlacementGraph, DurableTransferRefinement, ReservationScope, ReservationSafety, UseByReservation, InventoryOperation, FungibilityPool | covered | — |
| stock-receipt | 5 | InventoryOperation, PublishedHeadCAS, PackagingIdentity, DualMeasure, ResourceDimensions, PlacementGraph | covered | — |
| stock-transfer | 2 | ResourceDimensions, PlacementGraph, DurableTransferRefinement, InventoryOperation, PackagingIdentity | covered | — |
| storage-integrity | 14 | InventoryOperation, PublishedHeadCAS | covered | GAP-HASH-COLLISION-ASSUMPTION |
| traceability | 8 | TraceabilityGraph, TraceabilityAssociation, InventoryOperation | covered | GAP-GRAPH-ADVERSARIAL-SEARCH |
| transfer-lifecycle | 11 | TransferLifecycle, ResourceDimensions, ReservationSafety, InventoryOperation, DurableTransferRefinement, PublishedHeadCAS, PackagingIdentity, FungibilityPool | covered | — |
| transformation | 2 | TraceabilityGraph, ReclassificationConservation, DualMeasure, InventoryOperation | covered | GAP-GRAPH-ADVERSARIAL-SEARCH |
| transformation-read | 7 | CatalogPublication, PublishedHeadCAS, ReclassificationConservation, DualMeasure | covered | — |

## Field classification

| Classification | Fields |
|---|---:|
| abstract-semantic | 1181 |
| application decoration | 5 |
| identity/retry-semantic | 717 |
| observational/audit-only | 560 |
| unsupported/unmodelled | 17 |

## Kernel reference-adapter seam

The finite refinement suite runs the core façade against the memory reference adapter. Mongo/SQLite adapter and Shinebright application-call evidence belong to downstream integration repositories and are not executed here.

| Kernel call | Family | Required evidence |
|---|---|---|
| `inventory.counts.replaceAbsolute` | count | memory + all operation failpoints |
| `inventory.stock.receiveMany` | stock-receipt | memory + all operation failpoints |
| `inventory.stock.issueManyByPolicy` | stock-policy-issue | memory + all operation failpoints |
| `inventory.stock.transferManyByPolicy` | stock-policy-transfer | memory + all operation failpoints |

## Explicit gaps and non-claims

| Gap | Status | Production impact | Required mitigation |
|---|---|---|---|
| GAP-APPLICATION-DECORATION | outside-physical-authority | Human descriptions, UI labels, pricing, currency, threshold policy, and other application decoration are deliberately outside conserved physical models. | Keep decoration separate from physical selection/quantity and prove it cannot mutate authoritative state. |
| GAP-ARBITRARY-AUDIT-METADATA | observational-only | Arbitrary JSON-safe audit/application metadata is not represented in resource-conservation models. | Metamorphic tests must prove audit-only changes preserve abstract physical state; changed retry intent under one operation identity remains fail-closed. |
| GAP-BROAD-RESERVATION-DENSE-GRAPH | bounded-adversarial-performance-caveat | Exact-position reservations use the sparse linear fast path, but truly broad competing claims still require a bounded max-flow graph over eligible claims and positions. The implementation fails closed at configured claim, position, edge, and indivisible-search ceilings rather than promising unbounded latency. | Keep current hard ceilings and diagnostics, monitor broad-claim cardinality in production, partition unusually broad scopes, and add a specialized solver only if measured clinic workloads approach the bounds. |
| GAP-COUNT-CORRECTION-HISTORY-REPLAY | bounded-history-performance-caveat | Observation-time count reconciliation and retained-root correction must reconstruct occurrence-sensitive physical history. The implementation now traverses the durable sequence index and uses a private linear replay builder, but latency and memory still grow with retained event history rather than remaining constant-time. | Keep the 500-to-2,000-event near-linear replay regression, measure event-history length on real clinics, and preserve exact occurrence-time replay until any checkpoint or segmented-history protocol is formally specified as occurrence-time complete and backed by refinement evidence. |
| GAP-DB-IMPLEMENTATION-UNBOUNDED | downstream-adapter-obligation | This standalone core executes the memory reference adapter only. Mongo/SQLite conformance and failpoint schedules are downstream integration evidence and still cannot prove every database/driver/runtime behavior. | Each production adapter must pin supported versions, run its own CAS/uniqueness/private-class/failpoint/conformance suite in downstream CI, and fail closed on unsupported guarantees. |
| GAP-DISTRIBUTED-RIGHTS-NOT-IMPLEMENTED | unsupported-production-capability | The DistributedRights model does not imply offline or partition-tolerant multiwriter decrement/reservation safety in current adapters. | Use one coordinating authoritative stream. Do not advertise offline/multiwriter stock until escrow/right-transfer code and adapter refinement tests exist. |
| GAP-EXTERNAL-CLOCK | environment-assumption | Canonical time validation is tested, but correctness assumes the injected clock supplies canonical UTC instants and trusted monotonic record sequencing where required. | Validate every persisted time, distinguish occurrence from record time, and use database recordSequence/CAS rather than wall-clock expiry for safety. |
| GAP-EXTERNAL-MIGRATION-CALLBACKS | application-boundary | InventoryOnce cannot formally prove arbitrary application-owned query, bundle, or declaration callbacks. | Bound query paging, require deterministic plugin output, retain source provenance, run the produced declaration through normal validation, and separately test each production plugin. |
| GAP-EXTERNAL-POLICY-CALLBACKS | explicit-public-kernel-boundary | Public low-level allocation/catalog callbacks can encode arbitrary application policy that is not represented by the finite TLA state machines. | Production application code should prefer declarative grouped APIs; callback output must pass exact validators and dedicated application tests, and callbacks must be deterministic for retry. |
| GAP-FUNGIBILITY-EXACT-SEARCH-BOUND | bounded-combinatorial-performance-caveat | Fungibility allocation uses exact bounded integer search with reservation-feasibility acceptance. Hypothetical states now use sparse overlays and do not clone unrelated projection rows, but adversarial candidate/increment combinations may still explore up to the configured 100,000 search-state ceiling and then fail closed. | Keep the hard search-state ceiling and sparse-overlay regression, monitor real pool candidate cardinality/package increments, partition unusually broad pools/scopes, and add a specialized optimizer only if measured clinic workloads approach the bound. |
| GAP-GRAPH-ADVERSARIAL-SEARCH | bounded-graph-performance-caveat | Placement topology, association, and genealogy replay use bounded graph walks. Independent broad histories remain near-linear, but adding one structural edge must still prove parent/ancestor or genealogy reachability invariants. Very deep placement chains or dense genealogy DAGs can therefore exceed linear time. | Keep the 250-to-1,000-edge replay regressions and the ancestor-move scale regression, measure real topology depth/density, and add bounded ancestor/topological indexes or explicit safety ceilings before supporting very large industrial graphs. |
| GAP-HASH-COLLISION-ASSUMPTION | cryptographic-assumption | Content roots and intent digests assume collision resistance of the selected hash and canonical encoding. | Keep canonical encoding tests, immutable blob verification, and fail closed on digest/root mismatch. |
| GAP-HISTORICAL-RESERVATION-RECONSTRUCTION-SCAN | bounded-history-performance-caveat | Historical as-of reservation reads reconstruct lifecycle state from retained reservation operations. Current/live reads and exact feasibility are indexed, but very long historical operation books can make retrospective reports scale with retained claim history. | Measure historical-report workloads on real clinics, retain paging/retention observability, and introduce reservation checkpoints or lifecycle snapshots before unbounded history makes retrospective reads operationally expensive. |
| GAP-JAVASCRIPT-RUNTIME | tested-not-proved | Executable refinement evidence runs the real TypeScript/JavaScript implementation but is not a machine-checked semantic proof of the JavaScript runtime. | Use strict TypeScript, exact arithmetic, exhaustive finite traces, mutation/retry tests, and supported Node versions. |
| GAP-LEGACY-SOURCE-INTERPRETATION | blocks-clinic-cutover-until-replayed | The generic migration machinery proves deterministic compilation/publication, not that one clinic's ambiguous legacy rows were interpreted correctly. | Replay each real clinic snapshot, review every blocker/assumption, compare roots and operational reports, and obtain explicit cutover approval. |
| GAP-PRODUCTION-STORAGE-SCALE-GC | production-scale-caveat | The current adapter stores complete content-addressed world snapshots and lacks accepted production GC/segmentation evidence at broad scale. | Measure write amplification/retention on real clinic workloads and approve safe GC, segmentation, or checkpointing before broad production scale. |
| GAP-TEST-FAILPOINT-HOOK | test-only-unmodelled-input | Failure-injection callbacks are test controls, not production inventory semantics. | Classify them unsupported/unmodelled and use them only to exercise modeled crash boundaries. |
| GAP-TLC-BOUNDED-DOMAINS | accepted-release-limit | Every TLC result is finite-domain model checking, not a theorem over arbitrary identities, quantities, traces, TypeScript, or databases. | Keep exact model constants/counts in reports and pair each claimed model with executable refinement/property tests. |

## Proof boundary

The audit proves correspondence completeness and executes finite refinement/conformance evidence. TLC remains bounded model checking; JavaScript and database engines are tested, not theorem-proved. Migration publication/replay does not prove one clinic's legacy interpretation. Distributed/offline multiwriter rights remain unsupported. Arbitrary audit metadata and application decoration are excluded from conserved physical state and tested metamorphically.
