# InventoryOnce

`@inventoryonce/core` is a framework-free inventory truth package with zero runtime dependencies. It records what physically happened, keeps current stock rebuildable from committed events, and gives normal application code small verb-grouped APIs instead of journal legs, graph deltas, or balance edits.

## Implemented truth

- Every stock position names an immutable item revision. Package-shaped stock also names the exact immutable package revision. Heterogeneous package compositions, read-only collections, and mutual-fungibility pools are separate immutable catalogue revisions. Catalogue construction deep-copies and freezes caller-owned revision values so later alias mutation cannot change replay.
- Item definitions remain immutable, but item configurations can be revised by publishing a newer active definition and explicitly transitioning current stock with the exact `stock.planRevisionTransition` / `stock.transitionRevision` workflow; historical receipts are not rewritten. See [prospective item-revision transitions](docs/item-revision-transitions.md).
- Quantity is an exact vector: one primary stock axis plus independently measured axes such as actual weight. No epsilon math or guessed unit conversion is used.
- Event `occurredAtEpochMs` is the real-world time as safe-integer epoch milliseconds. Durable `recordedAtEpochMs` and `recordSequence` say when and where the fact was stored.
- A stock position has one optional **direct placement node**. Placement nodes are generic application identities: the kernel does not know or special-case rooms, shelves, boxes, trolleys, vehicles, people, or any other domain noun.
- A node may accept direct placement and may itself be placed beneath another accepting node. A standalone room/shelf/bay needs no inventory stock. A node representing a cabinet/trolley/tote may instead be **embodied by one live serialized inventory resource**; its parent and lifetime are then derived from that resource, while descendants retain their direct anchors.
- Fungible quantity cannot own placement children. `stock.individualize(...)` splits exactly one physical unit into a new serial and can atomically make that instance a placement-capable node. Once empty, `stock.deindividualize(...)` merges it back into fungible stock and permanently retires the old current serial/node identity; a later unit receives a fresh identity. Exact correction of the mistaken retirement event is the only normal way to revive that identity.
- Intentionally detached or genuinely missing stock remains conserved/accounted inventory with a kernel-owned whereabouts lifecycle, last-known placement, times, actor/source provenance, and append-only outcome history. It is not ordinary usable/reservable/automatically allocatable stock until placed again. `issue` means it left the inventory world; `scrap` means it was destroyed.
- Placement, association, and transformation genealogy are different structures with different invariants. Placement has one parent and no cycles; association is reversible relationship truth; genealogy is append-only production lineage.
- Corrections append a delta and point to the retained root event. They never edit or delete earlier events. `stock.planCorrection(...)` runs the same replay without writing; new corrections retain their replacement assertion so later historical repair can recompute current truth rather than stack a stale delta.
- Late-discovered historical facts are opt-in. `stock.planHistorical(...)` / `stock.recordHistorical(...)` atomically replay existing physical verbs at their occurrence time while retaining one append-only repair envelope at the durable record time. Applications that never call these methods keep the same normal API and hot path.
- `read.events(...)` provides indexed, paginated retained-event history. Embedded historical assertions participate in resource/kind/time matching without becoming independent durable records.
- Broad reservations are checked together. Divisible rows use exact max-flow; a merged row containing many equal intact packages/serial pieces stays one integer-capacity group instead of one search node per piece. Allocation may bind a claim to exact positions later, but it cannot bind part of one intact package or serial row.
- Count work is snapshot → observation → reconcile. One count is frozen to one item revision and record sequence. Reconciliation applies only the discrepancy that existed at observation time, so later legitimate movement stays intact. `counts.replaceAbsolute(...)` is the one-call exact-bucket convenience built on the same lifecycle.

There is no `Substock` type and no second container/location authority. A place is a standalone placement node; an inventoried physical holder is one placement node explicitly embodied by one live serial resource. Stock, package, lot, status, owner, custodian, disposition authority, and configured extra dimensions remain independent facts, while embodiment is the enforced bridge between unique stock identity and topology.

## Normal API

Create a retained catalogue, provide a durable storage adapter, then use physical verbs:

```ts
const itemV1 = defineScalarInventoryItem({
  itemId: "item-a",
  revisionId: "item-a-v1",
  axisId: "pieces",
  unit: "piece",
});

const box20 = defineScalarInventoryPackaging({
  revisionId: "item-a-box-20-v1",
  item: itemV1,
  packageUnit: "box",
  contains: "20",
});

const catalog = defineInventoryCatalog({
  itemRevisions: [itemV1],
  activeItemRevisionIds: { "item-a": itemV1.revisionId },
  packagingRevisions: [box20],
});

const inventory = createInventoryOnce({ catalog, storage });

await inventory.catalog.publish({
  operationId: "publish-item-a-v1",
  occurredAtEpochMs: catalogueApprovedAtEpochMs,
});

await inventory.placement.define({
  operationId: "define-carrier-a",
  occurredAtEpochMs: setupAtEpochMs,
  nodeId: "carrier-a",
  placementNode: {
    category: "application-defined-storage-unit",
    acceptsPlacement: true,
  },
});

await inventory.stock.receive({
  operationId: delivery.id,
  occurredAtEpochMs: delivery.receivedAtEpochMs,
  to: {
    itemId: "item-a",
    placementNodeId: "carrier-a",
    lotId: delivery.lotId,
  },
  amount: packageAmount(3, "item-a-box-20-v1"),
});

// One topology event moves the carrier and everything already beneath it.
await inventory.placement.move({
  operationId: "move-carrier-a",
  occurredAtEpochMs: movedAtEpochMs,
  nodeId: "carrier-a",
  into: "room-2",
  destination: { acceptsPlacement: true },
});

// Partial stock can be taken out without pretending it left inventory.
const detached = await inventory.stock.detach({
  operationId: "take-one-package-out",
  occurredAtEpochMs: takenAtEpochMs,
  from: {
    itemId: "item-a",
    placementNodeId: "carrier-a",
    lotId: delivery.lotId,
  },
  amount: packageAmount(1, "item-a-box-20-v1"),
});

// Use this detach's kernel-owned cohort identity, not the first unresolved stock
// elsewhere in the warehouse.
const detachedWhereaboutsId = detached.event.stockEffects.find(
  (effect) => effect.position.whereaboutsId !== undefined
)?.position.whereaboutsId;
if (detachedWhereaboutsId === undefined) {
  throw new Error("Detach did not create a whereabouts cohort.");
}
const [unresolved] = (await inventory.read.whereabouts({
  whereaboutsIds: [detachedWhereaboutsId],
})).flatMap((lifecycle) => lifecycle.currentPositions);
if (unresolved !== undefined) {
  await inventory.stock.place({
    operationId: "put-package-on-shelf",
    occurredAtEpochMs: placedAtEpochMs,
    from: unresolved.key,
    into: "shelf-c13",
    amount: packageAmount(1, "item-a-box-20-v1"),
  });
}
```

A fungible physical holder can become unique and placement-capable without application-side graph bookkeeping:

```ts
await inventory.stock.receive({
  operationId: "receive-cabinets",
  occurredAtEpochMs,
  to: { itemId: "cabinet", placementNodeId: "store" },
  amount: stockAmount("20", "piece"),
});

await inventory.stock.receive({
  operationId: "receive-kit",
  occurredAtEpochMs,
  to: { itemId: "kit", placementNodeId: "store" },
  amount: stockAmount("1", "piece"),
});

await inventory.stock.individualize({
  operationId: "individualize-cabinet-17",
  occurredAtEpochMs,
  from: { itemId: "cabinet", placementNodeId: "store" },
  amount: stockAmount("1", "piece"),
  serialId: "CAB-17",
  asPlacementNode: {
    category: "cabinet",
    acceptsPlacement: true,
  },
});

await inventory.stock.transfer({
  operationId: "put-kit-in-cabinet-17",
  occurredAtEpochMs,
  from: { itemId: "kit", placementNodeId: "store" },
  toPlacementNodeId: "CAB-17",
  amount: stockAmount("1", "piece"),
});

// This moves cabinet stock to room-2; topology follows the resource automatically.
await inventory.placement.move({
  operationId: "move-cabinet-17",
  occurredAtEpochMs,
  nodeId: "CAB-17",
  into: "room-2",
});

// Empty all direct stock and child nodes before retirement or de-individualization.
await inventory.placement.moveContents({
  operationId: "empty-cabinet-17",
  occurredAtEpochMs,
  nodeId: "CAB-17",
  into: "room-2",
});

await inventory.stock.deindividualize({
  operationId: "return-cabinet-17-to-generic-pool",
  occurredAtEpochMs,
  from: {
    itemId: "cabinet",
    serialId: "CAB-17",
    placementNodeId: "room-2",
  },
  amount: stockAmount("1", "piece"),
});
```

The old `CAB-17` serial/node remains in retained history but cannot receive stock or be silently reused. Another cabinet may later be individualized under a fresh identity such as `CAB-42`.

The façade groups are:

- `catalog`: publish the complete retained item/package/composition/collection/fungibility revision set before commands use an appended revision.
- `compositions`: read exact/active heterogeneous package definitions and atomically open whole exact source packages into their frozen output vectors.
- `transformations`: define, preview, and run reusable revision-frozen physical transformations.
- `collections`: read exact/active “same brand”, “All OCPs”, or other taxonomy revisions; summarize exact members and only explicitly declared scalar roll-ups.
- `fungibility`: summarize explicit mutual-substitution pools and issue/transfer/scrap exact member rows through one frozen pool revision.
- `stock`: receive, issue, transfer, detach, place, mark missing, individualize/de-individualize physical units, change independent dimensions, pack, unpack, transform, scrap, and correct.
- `placement`: define/correct standalone or embodied nodes, move/unplace one node, evacuate direct contents, and explicitly issue/scrap/re-status all current subtree contents when that is the physical action.
- `lots`: define and append-only correct item-scoped lot metadata.
- `transfers`: prepare, dispatch, partially/fully receive, or release one time-separated physical transfer.
- `reservations`: reserve, refine, allocate, release, expire, and consume.
- `counts`: replace one exact absolute bucket or use the longer start/observe/reconcile/abandon lifecycle.
- `traceability`: associate and disassociate; transformation genealogy comes from `stock.transform`.
- `read`: coherent snapshots, positions, whereabouts/history, summaries, availability, allocation previews, placement topology, catalogue revisions, events, reservations, counts, and feasibility.

The same `operationId` always freezes the same complete intent. An exact retry returns the earlier result. A changed retry fails before planning or writing.

### Placement and whereabouts semantics

For a standalone place, `placement.move({ nodeId, into })` changes only the node's direct parent. For an embodied node, the same call moves its unique stock instance and derives the node parent from that stock placement atomically. InventoryOnce discovers the current parent inside the durable planning fence, checks optional `expectedParent`, target capability, embodiment ownership, one-parent ownership, and cycles. Descendant stock retains the same exact position identities and direct anchors.

An embodied resource cannot be issued, scrapped, transformed away, or de-individualized while its node has direct stock or child nodes. `placement.moveContents({ nodeId, into })` evacuates every direct stock row and direct child node as one event; nested descendants remain under their immediate child. Once empty, destruction retires the node with the resource, while de-individualization returns one unit to fungible stock and retires the old serial/node identity. Rebuildable parent/child, direct-stock, serial, and embodiment indexes accelerate these checks without becoming another source of physical truth.

On indexed storage, moving direct contents reads the source's exact rows and immediate child bindings plus the destination's ancestry. Stock, independently moved child edges, and edges driven by embodied serials publish together in the same event and revision.

`stock.detach(...)` removes an exact quantity from its known direct placement while keeping it in current inventory. `stock.markMissing(...)` records that the unresolved cohort is genuinely missing. `stock.place(...)` gives detached/missing stock a new known direct placement. InventoryOnce derives and preserves the lifecycle identity; callers do not invent graph edges or cohort IDs.

`read.whereabouts()` returns current unresolved lifecycles with origin provenance. `read.whereaboutsHistory()` also returns resolved lifecycles, including later placement, issue, scrap, count adjustment, correction, or historical-repair events. Broad on-hand reporting includes unresolved stock as accounted truth, while ordinary usable availability, reservations, and FIFO/FEFO picking exclude it until placement is known again.

### Corrections and late historical evidence

Normal applications keep using the existing verbs. Historical capabilities are additive and do not run on ordinary current reads/writes.

```ts
const correction = await inventory.stock.planCorrection({
  operationId: "correct-receipt",
  occurredAtEpochMs: learnedAt,
  correctsEventId: receipt.event.eventId,
  reason: "The receipt contained five pieces.",
  replaceWith: plans => plans.receive({
    occurredAtEpochMs: originalReceiptAt,
    to: originalPosition,
    amount: stockAmount("5", "piece"),
  }),
});
```

For evidence learned late, one repair may assert several existing physical verbs atomically. `outputOf(...)` safely carries kernel-owned cohort identity from an earlier assertion:

```ts
await inventory.stock.recordHistorical({
  operationId: "cart-loss-audit",
  occurredAtEpochMs: learnedAt,
  reason: "Two pieces were missing and later recovered.",
  assertions: [
    {
      assertionId: "missing-two",
      assert: plans => plans.markMissing({
        occurredAtEpochMs: missingAt,
        from: sourcePosition,
        amount: stockAmount("2", "piece"),
      }),
    },
    {
      assertionId: "found-two",
      assert: plans => plans.place({
        occurredAtEpochMs: foundAt,
        from: plans.outputOf("missing-two"),
        into: "store",
        amount: stockAmount("2", "piece"),
      }),
    },
  ],
});
```

Fungible under-accounting may become a typed recorded-deficit interval only under `InventoryDeficitPolicy.Record`; serialized negative identity is always rejected. Present-time physical truth remains the existing count lifecycle. See [`docs/historical-repair.md`](docs/historical-repair.md) and [`docs/performance-and-indexing.md`](docs/performance-and-indexing.md).

Retained history is paged with `read.events(...)`. Use its opaque `nextCursor` for a stable traversal that excludes concurrent appends; set `direction: InventoryEventQueryDirection.Descending` for newest-first investigation. Equal-time assertions inside one repair retain caller order, while `afterEventId` supplies an explicit anchor when needed.

## Package and measurement truth

Human package text is not identity. These two rows must never merge:

```text
(item-a-v1, store, package=item-a-box-20-v1) -> 40 piece
(item-a-v2, store, package=item-a-box-24-v1) -> 48 piece
```

Moving intact package stock requires `packageAmount` for that exact revision and a whole package count. An application that already normalized its human unit vocabulary may use `inventoryAmountFromUnit(...)` to resolve that unit against one exact item revision; ambiguous package labels fail closed. `assertInventoryAmountSum(...)` proves a declared child/lot split exactly equals its parent after package resolution instead of rebuilding measurement arithmetic in the adapter. Homogeneous opening uses `stock.unpack`; creating intact packages uses `stock.pack`. A package containing several unlike resources uses an immutable heterogeneous composition and `inventory.compositions.open(...)` instead.

For catch-weight or similar stock, define a primary axis plus independent axes and use `measuredStockAmount`. Primary count controls position existence and normal reservations. Independent values move/adjust only when explicitly measured.

## Revision-frozen heterogeneous compositions

A calendar pack, kit, tray, or assortment containing unlike resources is not a scalar unit conversion.
It has one exact immutable composition revision attached to one exact source packaging revision:

```text
brand-x-calendar-pack-v1
  -> 21 active-A tablet
  ->  7 placebo-A tablet

brand-x-calendar-pack-v2
  -> 20 active-A tablet
  ->  5 active-B tablet
  ->  3 placebo-B tablet
```

The newer active pointer does not reinterpret old unopened stock. Transfer preserves the exact source
package revision, and opening asks the catalogue for the composition attached to that revision:

```ts
await inventory.compositions.open({
  operationId: opening.id,
  occurredAtEpochMs: opening.occurredAtEpochMs,
  from: {
    itemId: "brand-x-pack",
    placementNodeId: "store",
    lotId: "LOT-OLD",
    packagingRevisionId: "brand-x-calendar-pack-v1",
  },
  packageCount: 1,
});
```

That one event consumes one intact v1 pack and produces exactly 21 active-A plus 7 placebo-A tablets,
even when v2 is currently active. Several packs scale the full vector exactly. Opening always preserves
the source package direct placement, status, owner, custodian, and disposition authority; moving or changing
those facts is a separate explicit operation. Each frozen output definition also declares one lot policy:
`none`, strict source-lot inheritance, source-lot inheritance when present, or an explicit output lot.
The opening call may supply only the identities required by that frozen policy plus output serial,
direct placement, qualified dimensions, metadata, and genealogy. Unknown placement fields are rejected even for
plain JavaScript callers, so opening cannot hide a transfer or reclassification. Composition output
definitions may themselves produce exact packaged items, but package-to-package composition cycles are
rejected.

Composition opening is an ordinary atomic transformation underneath the façade. The event retains exact
source/output item and package revisions plus the frozen composition revision as audit evidence. The
same operation ID cannot reopen the pack with another count, placement, or composition intent.

## Revision-frozen read-only collections

Collections answer UI/reporting questions such as “same brand” or “All OCPs”. They retain exact member
item revisions and may nest exact retained collection revisions. Membership does **not** mean that one
member may fulfill another member's demand.

```text
Brand X view v1
  - Brand X old formulation
  - Brand X new formulation

All OCPs view v2
  - Brand X view v1
  - Brand Y
  - Generic Z
```

`inventory.collections.summary(...)` returns every exact member row, including zero rows under a
placement/status/owner scope. A single total is returned only when the collection revision explicitly
defines compatible reference conversions, for example one `pack` from each member contributing one
`pack-count`. Member contributions remain visible beside the total. Changing the active collection
revision never changes retained v1 membership or its historical/read semantics.

Use a collection to _show/count together_. Use a fungibility pool only when members may actually
substitute for one another according to an exact common-basis conversion.

## Revision-frozen mutual fungibility

Different item identities are never merged merely because a clinic wants to count or fulfill them
together. Define an immutable pool revision with exact member item revisions and one exact reference
equivalence into a common basis:

```ts
const brandPoolV1 = defineScalarInventoryFungibilityPool({
  poolId: "medication-a-brand-pool",
  revisionId: "medication-a-brand-pool-v1",
  basisAxisId: "dose-equivalent",
  basisUnit: "dose-equivalent",
  members: [
    { item: oldBrand },
    { item: newBrand },
    { item: doubleStrength, poolQuantity: "2" },
  ],
});
```

`inventory.fungibility.summary(...)` derives a common-basis view while retaining the exact member
positions. `plan`, `issue`, `transfer`, and `scrap` require the exact `fungibilityRevisionId`; they never
resolve an active pointer during retry. A later publication may make v2 active without changing v1 or an
operation already pinned to v1.

Automatic pool allocation currently requires each member mapping to use that member revision's primary
axis. Each member reference is also an allocation quantum: one double-strength piece mapped to two
equivalents cannot be silently split to satisfy one equivalent. Intact package, serial, and independently
measured rows may impose another quantum; InventoryOnce uses their exact least-common quantity multiple,
so incompatible package/reference ratios cannot produce fractional packages. Independent-axis
or otherwise unusual mappings remain valid for exact summaries, but callers must supply explicit
measured movement lines instead of asking the allocator to guess a split.

Pool allocation searches FIFO/FEFO candidates across members. The reservation-aware preview simulates
source removal and transfer arrivals against claims active at the selected reservation time. Ordinary
physical commands prefer a complete assignment that preserves those claims at durable record time and
use the physical assignment when no claim-preserving assignment can fill the report. Physical use-by
is evaluated at event occurrence time.
The emitted event still names the actual selected item revision, package, lot, serial, and direct placement; the
pool revision/common-basis quantities are retained as audit evidence, not as synthetic pooled stock.

Exact allocation search has a deterministic 100,000-state safety ceiling. Adversarial or unusually large
constraint combinations fail closed instead of consuming unbounded CPU; applications can use explicit
measured lines or a domain-specific indexed planner for those cases.

A pool means explicit **mutual interchangeability** only. Rebrand history of one physical resource should
normally remain one stable item with immutable item/package revisions. One-way supersession, preferred
substitute ordering, formula/BOM alternatives, and clinical therapeutic equivalence are contextual
application policies and are not silently converted into InventoryOnce fungibility.

## Recorded deficits for late or missing receipts

`InventoryDeficitPolicy.Reject` remains the fail-closed default: a policy issue with insufficient allocatable stock rejects atomically and publishes no event.

A clinic may explicitly configure `InventoryDeficitPolicy.Record`. In that mode, an ordinary FIFO/FEFO issue allocates only real positive stock, then records any genuine shortfall as one signed Issue effect at an explicit deficit position. The deficit:

- is durable physical truth and contributes to signed on-hand/net reporting;
- is returned as exact `InventoryOnceEventResult.deficit` evidence on first execution and exact replay;
- never appears as an allocation candidate or usable physical stock;
- remains visible after later receipts until an explicit correction/count/business action resolves the liability;
- retains the same operation identity, changed-intent rejection, publication, repair, and audit semantics as every other InventoryOnce operation.

In Record mode, a reported transfer may contain both a witnessed part and an unwitnessed shortage. The witnessed part retains its real position identity, source FIFO age, and line evidence. `event.unwitnessedStockMovements` identifies the exact signed source and unlabelled arrival for the remainder. It carries no lot, serial, source-age or cost evidence. Policy scrap keeps the reported reason and records its unwitnessed quantity at an unlabelled signed source. When witnessed and unwitnessed quantities share an exact row, the stock effect is their total and any line evidence applies to the witnessed remainder after subtracting the typed unwitnessed portion. The existing tracking and intact-package requirements still apply.

An unlabelled debit settles against the balance at the same exact position. If five unlabelled pieces are on hand and the report has two unwitnessed pieces, three remain at the source and the event still records both unwitnessed pieces. A witnessed arrival can also pay down a negative destination balance. Its FIFO age applies to any positive stock that remains at the destination.

Structured transfer lifecycle stages require physical source stock during historical replay. A proposed correction that removes that backing stock returns an `invalid-history` conflict that identifies the lifecycle failure.

Migration may therefore preserve coherent clinic truth such as positive tracked lots plus a negative `__untracked__` row when their signed sum equals the parent balance. A negative opening is not synthesized as a receipt: it compiles to an explicit Issue deficit event. Unit identity, algebra, and unresolved workflow rows still fail closed.

## Reservations after physical loss

Ordinary issues, transfers, reclassifications, cart moves, counts, corrections, and scrap record what happened even when claims become or remain short. Policy recording prefers unallocated stock when it can fill the request. Claims and exact allocation evidence stay in place. Explicit reserve, refine, and allocate still require feasible claims, and consumption still requires the exact recorded fulfillment.

Call `inventory.read.reservationFeasibility()` after those operations. It checks current published stock against claims active at the authority clock time. Pass an exact time as `inventory.read.reservationFeasibility(at)` to use reservation creation, expiry, and terminal-status intervals at that time; this does not rewind the stock projection. It returns each competing item/axis group with exact `requested`, maximum `fulfillable`, and `shortage` quantities plus the affected reservation IDs. Lifecycle commands cannot be dated before creation/an earlier lifecycle change or after their durable record time. Late physical truth must come through scrap, count reconciliation, or correction instead of backdating the current claim book.

## Rebuildable performance indexes

Indexed adapters can serve ordinary FIFO/FEFO planning and stock summaries from the selected physical
pools at one published revision. A batch plans its requests in order and commits one event and one
receipt. Current exact holds, lot expiry, ancestor use-by and FIFO origins stay with the affected
positions. Repeating an operation returns its frozen allocation evidence, even after the chosen stock
has moved. The `/storage` helper `readInventoryScopedStockAvailability` exposes exact physical,
expired, deficit and held capacity for a selected item revision. The scale measurements for scoped
availability cover that helper. The public `inventory.read.availability` report reads the full published
world so it can include broad and unbacked claims and global feasibility.


Correctness does not require hot reads to replay or scan the complete journal. The projection rebuilds
and durably publishes several derived indexes with the same world revision:

- exact position identities by stable item and immutable item revision; exact-revision selectors use the narrower revision index directly;
- current uninterrupted positive-layer start time by exact position for FIFO;
- current positive position by item-scoped serial identity.

Normal item/collection reads therefore inspect only that item's positions. Reservation feasibility uses
revision-local positions. FIFO/FEFO planning reads the projected layer timestamp and current lot/placement-ancestry
use-by instead of replaying all events once per candidate. Serial uniqueness is refreshed only for serials
touched by the atomic event. The indexes are included in content-root/conformance checks and are rebuilt
from the immutable event stream in replay tests, so they remain cache/projection truth rather than a
second mutable authority.

Sorting and flow/search work still scales with the selected candidate/claim set. Exact reservation and
fungibility search retain deterministic safety ceilings and fail closed on adversarially large constrained
assignments rather than hiding an unbounded operation behind a convenient API. Application adapters can freeze one public read snapshot and derive every physical view from the same
published world without reaching through kernel reducers or projection indexes:

```ts
const snapshot = await inventory.read.snapshot();
const summary = snapshot.summary(selector);
const availability = snapshot.availability(selector, at);
const packages = snapshot.packagingRevisions({ itemId });
const lots = snapshot.lots(itemId);
const placementNodes = snapshot.placementNodes();
const ancestry = snapshot.placementAncestry("carrier-a");
```

The snapshot also exposes collection/fungibility summaries, composition revisions, allocation previews,
events, reservations, counts, and reservation feasibility. Every method is synchronous after the one
published-world read and reports the same `worldRevision`. Application code may then decorate those native
facts with names, pricing policy, organization scope, permissions, or transport DTOs without repeating
inventory arithmetic or issuing N+1 inventory reads.

The deterministic projection-index tests exercise a fixed 32-candidate run through positive-layer reset,
direct-placement transfer, a same-quantity backdated correction, full event rebuild, and FIFO planning with the
retained event records made unreadable. This is a guard against history replay in the candidate loop, not
a flaky wall-clock benchmark.

## Durable storage protocol

`@inventoryonce/core/storage` contains the adapter contract, coordinator, generic repair functions, failpoint vocabulary, and reference in-memory adapter.

Before `begin`, the pure planner computes and validates the complete next world: optional committed event, projection, reservation book, count book, and receipt. `begin` atomically says whether this caller created the row or found an exact retry, and freezes that full plan under one operation ID and base world revision. Event/projection/reservation/count/receipt writes may happen separately, but staged values stay invisible. `complete` publishes the full world revision at once.

Because the complete plan is durable while an operation is applying, `repairInventoryDurableOperations` can finish it without the original command planner. Completion first publishes the world head, then retains the small receipt and optional event needed for exact retry while dropping the full repair plan. A crash between those writes leaves a visible world plus an applying plan that repair only needs to compact. Abort first atomically claims the same publication fence; only the abort claimant may write terminal abort history, while a publication compare-and-set requires that no abort claim exists. Abort is terminal and drops the same heavy values while publishing none of them. The reusable conformance suite injects failures immediately before and after Begin/Event/Projection/Reservations/Counts/Receipt/PublishWorld/CompactOperation/Complete/ClaimAbort/Abort and the corresponding migration boundaries over stock, catalogue-only, lot-master-only, placement-node-master-only, placement-only, traceability-only, reservation, count, reservation-consume, and count-reconcile plans. It compares the repaired world to the plan's exact content roots, checks normal public reads and terminal compaction, and proves broken adapters that drop catalogue/projection/book rows or required projection indexes are caught.

The included memory adapter is the executable reference, not a production database adapter. A real adapter must pass the same conformance/failpoint suite and provide its advertised atomic or repairable publication guarantee.

Low-level `/storage` delta appliers consume planner-produced or adapter-conformant protocol records. They are deliberately not a second application-input validation layer: adapter conformance establishes those cross-field semantics once, and the appliers enforce only the structural/base-book invariants needed for durable publication. Hand-building a semantically invalid delta is implementer misuse, not a supported kernel input that the reducer must revalidate.

## Migrations

`@inventoryonce/core/migrations` lets application code declare typed bounded legacy queries. A declaration plugin may receive a catalogue owned elsewhere and return side-effect-free opening/traceability facts. A complete source plugin may instead reconstruct both the frozen native catalogue and the declaration from those same typed reads; this is the appropriate boundary when legacy item/package definitions are themselves part of the migration.

`createInventoryMigrationPlanFromSourcePlugin(...)` returns `{ catalog, plan }`. It still performs no writes: plugin code owns application-specific queries and translation, while InventoryOnce compiles the returned native bundle through ordinary catalogue, event, projection, graph, and diagnostic invariants. The same named query declarations remain reusable for compatibility reads.

Compilation replays the full ordered event set through the real projection/graph rules; a cross-row conflict blocks the whole plan before apply. Dry-run does not write target storage. Durable apply freezes one manifest containing the full plan digest, ordered operation IDs, exact reviewed target root, and complete next-world batch. It stages that whole batch invisibly, publishes it in one world revision, then drops the heavy repair plan. The adapter suite crashes before and after MigrationBegin/MigrationWorld/MigrationPublishWorld/MigrationCompactManifest/MigrationComplete/MigrationAbort and requires planner-free repair or safe terminal abort at every cut. An exact retry resumes the frozen batch; adding, removing, or changing rows under the same migration ID fails closed. The same typed query reader can be reused for temporary legacy/native compatibility reads so the legacy query is not rewritten in two places.

## Export boundaries

- Package root: grouped façade, catalogue/amount/measurement/selector values, and read-result types.
- `/kernel`: event builders, reducers, exact placement/allocation/feasibility/count/correction/traceability machinery.
- `/storage`: durable plan/storage/coordinator/repair contract.
- `/migrations`: typed legacy query/plugin, dry-run, comparison, and durable apply contract.

The root deliberately does not export event constructors, projection reducers, durable writes, or migration application machinery.

## Code-to-model implementation conformance

The formal models are connected to the real public TypeScript surface by a generated coverage ledger and executable refinement traces. Run:

```sh
pnpm conformance:generate
pnpm assurance
pnpm conformance:check
```

The audit enumerates every public API and semantic field, validates every referenced TLA symbol, requires executable witnesses for state/result refinements or emits an explicit gap, and includes the migration/storage machinery. Bounded traces in this standalone repository execute the real facade against the memory reference adapter. Downstream integrations must verify their Mongo/SQLite adapters and the application calls for receipt, issue, transfer, and absolute count. See `formal/IMPLEMENTATION_CONFORMANCE.md`.

## Formal boundary and future work

`pnpm formal` checks bounded TLA+ models for generic placement topology, ancestor-move stability, detached/missing resource dimensions, heterogeneous composition revisions, read-only collection views, explicit revision-frozen fungibility, broad reservations (including unavailable unplaced stock and shortage after ordinary physical recording), association/genealogy meanings, movement-safe counts, dual measurements, distributed rights, correction history, complete-plan durable publication, refinement, repair liveness, and package identity.

The composition and collection models were committed before their TypeScript surfaces. `CompositionRevision`
uses the exact 21+7 and 20+5+3 generations and proves revision-pinned opening, transfer preservation,
idempotent intent, exact reports, and component-potential conservation. `CollectionView` proves retained
member views preserve item identity and grant no substitution authority. Executable companions cover
catalogue publication/retention, opening, exact member/roll-up summaries, cycles, alias mutation, retry,
and index-local reads.

The fungibility model was likewise committed before the TypeScript surface. The current implementation has
executable companions for revisioned definitions, exact common-basis summaries, reservation-aware
FIFO/FEFO selection, and issue/transfer/scrap events that retain member identity. Broad reservations
whose own claim is directly denominated in a fungibility-pool basis remain a modeled future extension;
current pool movements retain the existing item-reservation book and its exact item claims. One-way/priority/clinical substitution remains outside mutual fungibility.

Most single-authority semantics above now have TypeScript companions. `DistributedRights` remains a future design constraint for offline/multi-writer stock. The TLA+ models are bounded state machines, not a proof of arbitrary TypeScript or arbitrary database code. See `formal/README.md`, `formal/FOUNDATIONS.md`, and `formal/TOOLING.md` for the exact claims.

Required local gates are `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm formal`. When `.nvmrc` exists, run every listed `pnpm` command with that Node version; only when `.nvmrc` is absent use a Node version permitted by `package.json#engines`.

## Authority cutover admission

InventoryOnce does not treat `mode === "authoritative"` as a sufficient write
fence. A host application must use atomic writer admission around every legacy
physical workflow and claim the cutover fence only after the active writer set
is empty. A host adapter must apply equivalent writer admission at every legacy
write boundary, such as whole workflows, line-level mutation ledgers, and direct
source triggers. Once the fence is claimed, further legacy source writes must fail closed.

Crashed admissions remain explicit repair work. The generic core deliberately
does not prescribe a timeout that could erase a writer whose database outcome
is unknown.

## Formal implementation assurance gate

The package ships a mechanical code-to-model correspondence gate in addition to TLC:

```sh
pnpm assurance:generate  # regenerate exact API, field, trace, and gap manifests
pnpm assurance           # audit the current source against those manifests
pnpm formal              # run every registered bounded TLA+ model
```

The assurance audit includes the `/migrations` surface and every public input/output field. It requires executable state/result abstraction, bounded real-facade traces, retry/rejection semantics, and the memory reference-adapter/failpoint evidence owned by this repository. Downstream integrations must verify Mongo/SQLite adapter conformance and their calls to `receiveMany`, `issueManyByPolicy`, `transferManyByPolicy`, and `counts.replaceAbsolute`. See `formal/IMPLEMENTATION_CONFORMANCE.md` and `formal/implementation-conformance/FORMAL_COVERAGE_GAPS.json` for the exact claims and remaining bounds.

## Opening-snapshot workflow disposition

Opening-snapshot migration treats the current `InventoryStock` and lot state as physical authority at the frozen snapshot time. Legacy pending or started workflow rows whose historical outcome is unknown are retained as typed `snapshot-superseded-do-not-replay` audit evidence rather than guessed as completed or aborted. A disposition contributes no physical event, is part of the reviewed plan digest, survives durable applying and terminal manifest compaction, rejects changed-disposition retry, and cannot later resume after the legacy writer fence. Algebraic disagreement or unresolved unit identity still blocks migration.
