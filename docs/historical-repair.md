# Historical repair

InventoryOnce normally records events in the order they become durable and projects current truth from those retained events. Historical repair is an **opt-in additive capability** for evidence learned later about something that physically occurred earlier.

Applications that never call `stock.planCorrection`, `stock.planHistorical`, `stock.recordHistorical`, or `read.events` keep the same API, event meanings, current-state reads, durable storage contract, and ordinary performance path.

## Use the existing verb first

Historical repair does not create a second inventory vocabulary. Each embedded assertion is built from the same physical verbs already used by correction replacement plans:

- `receive`, `issue`, `transfer`, `detach`, `place`, and `markMissing`;
- status/owner/custodian/disposition/dimension reclassification;
- individualize/deindividualize, pack/unpack, transform, and scrap;
- placement and traceability assertions; and
- explicit count-adjustment evidence.

Use the ordinary API when the fact is being recorded normally. Use historical repair only when the system learns later that an assertion belongs earlier in effective physical history.

## Correction planning

`stock.planCorrection(input)` accepts the same input as `stock.correct(input)` and runs the same historical replay engine without writing anything.

```ts
const plan = await inventory.stock.planCorrection({
  operationId: "correct-receipt-17",
  occurredAtEpochMs: learnedAt,
  correctsEventId: receipt.event.eventId,
  reason: "The delivery contained five pieces, not ten.",
  replaceWith: plans =>
    plans.receive({
      occurredAtEpochMs: originalReceiptTime,
      to: originalPosition,
      amount: stockAmount("5", "piece"),
    }),
});

if (!plan.valid) {
  // plan.conflict is structured; no inventory state changed.
}
```

A valid plan exposes the exact uncommitted correction event, the published world revision used for planning, affected event identities, affected whereabouts cohorts, and any newly exposed historical deficit intervals. `stock.correct` recalculates the plan against the current published revision before committing.

New correction events retain their full replacement assertion. That lets later historical repair recompute effective history rather than stacking a stale current-state delta. Legacy correction envelopes remain readable; if a connected late repair requires replacement evidence they do not contain, planning fails closed and asks the caller to supersede/restate that correction first.

## Atomic historical assertion bundles

Use `stock.planHistorical` and `stock.recordHistorical` when newly discovered facts need to be inserted into effective history without rewriting durable history.

```ts
const repair = {
  operationId: "cart-loss-audit-17",
  occurredAtEpochMs: learnedAt,
  reason: "Two pieces fell from the cart and were returned before later issue.",
  assertions: [
    {
      assertionId: "cart-missing-two",
      assert: plans =>
        plans.markMissing({
          occurredAtEpochMs: missingAt,
          from: { itemId: "item-a", placementNodeId: "store" },
          amount: stockAmount("2", "piece"),
        }),
    },
    {
      assertionId: "cart-found-two",
      assert: plans =>
        plans.place({
          occurredAtEpochMs: foundAt,
          from: plans.outputOf("cart-missing-two"),
          into: "store",
          amount: stockAmount("2", "piece"),
        }),
    },
  ],
};

const planned = await inventory.stock.planHistorical(repair);
if (planned.valid) await inventory.stock.recordHistorical(repair);
```

The bundle is all-or-nothing. `inputOf(assertionId, index?)` and `outputOf(assertionId, index?)` safely reference earlier assertion effects without exposing or allowing callers to forge kernel-owned whereabouts identities.

Every assertion has a stable `assertionId`. A later repair may remove an earlier active assertion from latest effective history with `omittedAssertionIds`; it does not delete the earlier repair event. Removing an earlier assertion and adding its replacement in one bundle provides explicit append-only supersession without a second repair-level state machine. Changed retry intent under the same operation ID rejects.

### Ordering

- `occurredAtEpochMs` is the physical/effective time of the embedded assertion.
- The repair envelope's `recordedAtEpochMs` and `recordSequence` remain when the system learned and durably stored the evidence.
- Earlier physical time replays first.
- When several assertions share one physical time, earlier durable repair envelopes replay first and assertions inside one atomic bundle retain caller order.
- `afterEventId` may anchor an assertion after one exact retained/effective event when same-time ordering must be explicit.
- A missing anchor rejects; InventoryOnce never invents causality.

## What replay does and does not reinterpret

Replay uses the event-kind-specific behavior already used by corrections:

- exact stock effects stay exact;
- fungible negative history is permitted only under `InventoryDeficitPolicy.Record`;
- a negative serialized identity is always a hard conflict;
- placement-topology source edges are rebased onto corrected earlier topology;
- reversible traceability removals that become redundant are dropped;
- embodied placement continues to derive from the one live serialized stock row.

A failed plan changes no current truth. The caller can add another assertion/correction to the same bundle, or use existing count reconciliation to establish present physical reality without repairing old history.

## Missing, scrap, deficit, and count are different

| Meaning | Existing/new operation |
| --- | --- |
| The physical resource still exists, but its whereabouts became unknown | historical/current `markMissing` |
| The resource was later found | historical/current `place` from the missing cohort |
| The resource was destroyed/discarded | `scrap` |
| More fungible stock left than accounted inflow supports | recorded deficit, never fake missing stock |
| Current physical quantity is now known even if old history remains unexplained | existing count observe/reconcile or `replaceAbsolute` |
| Earlier event assertion was wrong | existing `stock.correct`, optionally planned first |

A historical deficit interval can begin and later be covered. It remains typed audit evidence on the correction/repair impact while current availability reports the current covered state. Deficit is non-physical and non-allocatable; it is not converted to missing inventory.

## Metadata boundary in v1

Historical repair v1 does not create, remove, or alter lot or placement-node metadata masters. Assert required metadata first through the existing `lots` or `placement` APIs, then repair physical/graph history. This keeps retained metadata ownership and its correction APIs unambiguous.

## Reading retained history

`read.events(query)` returns retained event envelopes in requested durable order. Filters include item, item revision, item-scoped serial/lot, placement, whereabouts cohort, event kind, correction root, occurrence time, recorded time, and durable sequence.

Use `direction: InventoryEventQueryDirection.Descending` for newest-first investigation. `nextCursor` is the preferred continuation: it freezes the first page's journal head and binds the filters plus direction, so concurrent appends never leak into later pages and a cursor cannot be reused with another query. The legacy ascending `afterRecordSequence` field remains available for simple callers.

Historical-repair envelopes remain the durable event returned by the query. Embedded assertions participate in kind/time/resource matching, so a search for the affected serial or missing cohort finds the envelope without pretending those assertions were independently durable rows.

`read.whereaboutsHistory()` also understands historical-repair evidence and reports `historically-repaired` together with derived missing/placed/issued/scrapped lifecycle actions.

## Explicit non-features

The core does not add acknowledgement, dismissal, review workflow, notification preferences, approval policy, or a mutable discrepancy state machine. Applications decide how to present, approve, or suppress information. InventoryOnce retains and validates physical evidence.
