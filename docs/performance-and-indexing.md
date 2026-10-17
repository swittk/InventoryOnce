# Performance and indexing contract

InventoryOnce is intended for very large retained ledgers and warehouses. Historical repair is opt-in; applications that never use it must not pay history-replay cost on ordinary current reads or writes.

## Hard contracts

1. Current `positions`, `summary`, `availability`, placement, reservation, and ordinary movement paths never replay historical repair.
2. Normal operation cost must not grow with the number of unrelated historical repairs or unrelated retained events.
3. An exact whereabouts-cohort read scales with that cohort's current positions, not every position for its item or warehouse.
4. Indexed event queries scale with matching index rows plus page size. A deliberately broad unfiltered history query may scan its requested durable sequence range.
5. Correction/historical-repair planning loads a transitive **resource dependency component**, not the complete ledger, when the adapter exposes the optional event-query capability.
6. A state-dependent plan is fenced by exact published world revision and event-journal head before adapter-native publication.
7. Unsupported or stale fast-path shapes fall back to the existing canonical coordinator; they never weaken validation.

## Rebuildable indexes

Indexes are projections, never independent physical truth. The reference implementation maintains:

- current position IDs by item, item revision, direct placement, and whereabouts cohort;
- positive serialized position and FIFO-layer provenance;
- placement parent/children and embodiment bindings;
- event sequence by whereabouts cohort;
- event sequence by public query resource, embedded assertion kind, and correction root; and
- narrow dependency keys for serials, fungible item-revision/location pools, lots, transfers, topology, traceability, assertion IDs, and root events.

All indexes are rebuildable from retained events/current projection and are covered by corruption/differential tests.

## Optional adapter capabilities

The base `InventoryDurableStorage` contract remains unchanged. Existing adapters continue to work.

An adapter may additionally expose:

- segmented current-position reads and stock-event publication;
- segmented placement reads/publication; and
- `InventoryEventQueryStorageCapability` for indexed public event pages and internal resource-key pages.

Without the event-query capability, pure/kernel planning uses the complete retained-history fallback. A production adapter claiming giant-scale historical planning should implement the optional capability and pass the same conformance and scale tests.

## Dependency closure

The planner starts from the corrected root/replacement or new/omitted historical assertions. It asks the adapter for events sharing narrow dependency keys, then expands until no newly loaded event contributes a new key.

The key design deliberately avoids item-wide coupling for serialized stock. Fungible stock is coupled at the item-revision/direct-placement/whereabouts pool because those events can affect deficit and quantity feasibility. Metadata/topology providers are joined separately so a serial at a busy location does not pull every co-located stock event.

The event-journal head returned by every indexed page must equal the projection head used by the planner. A mismatch causes canonical fallback/replanning instead of a stale repair.

## Segmented publication

The reference adapter can publish eligible correction/repair envelopes without cloning the canonical world when all of these hold:

- deficit policy is `Reject`;
- exact world revision and journal-head fences match;
- current delta is stock-only (or zero-delta audit evidence);
- effects are non-serialized;
- no metadata, topology, traceability, transfer lifecycle, catalogue, reservation/count, or FIFO-provenance replacement is involved.

Everything else uses the existing coordinator unchanged. Exact retries and applying-operation recovery remain coordinator authority.

## Enforced benchmarks

`test/historical-repair-scale.test.ts` constructs 1,000- and 10,000-event warehouses before timing runtime operations. It verifies:

- exact indexed event reads remain effectively independent of 10x unrelated history;
- correction planning loads a constant-size dependency component;
- first stock-only correction publication bypasses canonical `storage.begin`; and
- elapsed ratios stay within conservative CI-safe bounds.

The current reference run at implementation time observed approximately:

- exact retained-event read: ~0.03 ms at both 1,000 and 10,000 events;
- correction planning: ~0.5 ms with a one-event dependency component at both scales; and
- 10,000-event first correction publication: ~1.4 ms through segmented publication.

These numbers are diagnostic, not universal production promises. Structural no-scan/no-coordinator assertions are the primary regression guards; wall-clock ratios catch accidental algorithmic regressions.

## Broad work remains explicit

A full unfiltered warehouse audit, export, or canonical rebuild is allowed to be proportional to requested history. It must be called explicitly and must never be hidden inside an ordinary current read/write.
## Stable retained-event pagination

`read.events` continuations are opaque stable-snapshot cursors. The first page freezes the visible journal head; later appends do not enter that traversal. A cursor is bound to the normalized filters and ascending/descending direction, while page size may change. Indexed adapters should stream broad pages in the requested direction and intersect the smallest indexed candidate sets for scoped pages rather than materializing every durable sequence.

## Same-time historical assertions

Historical replay orders assertions by physical occurrence time, then durable repair-envelope order, then caller order inside one atomic bundle. This preserves append-only evidence order and lets a same-time `markMissing` followed by `place(outputOf(...))` remain deterministic without sorting user intent by arbitrary assertion identity. Explicit `afterEventId` remains the fail-closed escape hatch when one retained event must be the exact ordering anchor.
