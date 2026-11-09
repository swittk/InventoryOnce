# Prospective item-definition revision transitions

InventoryOnce retains every immutable item-definition revision. Publishing a new active revision does not change earlier receipts or current stock buckets. Applications can now preview and perform an explicit **prospective revision transition** for existing stock, without falsely recording production or physical transformation.

## Example: 100 pieces become 10 boxes

1. Define and publish an item revision with primary unit "piece". Receive 100 pieces.
2. Append a new immutable item revision with primary unit "box"; publish it and make it active.
3. Ask for a read-only plan with the exact equivalence **10 piece = 1 box**.
4. Display every converted stock position and every blocker. Commit only if the preview is applicable.

The application-facing calls are:

~~~ts
const preview = await inventory.stock.planRevisionTransition({
  itemId: "box",
  fromRevisionId: "box-piece-v1",
  toRevisionId: "box-box-v2",
  conversion: { sourceAmount: "10", targetAmount: "1" },
});
if (!preview.applicable) {
  throw new Error("Resolve the preview blockers before approval.");
}
const receipt = await inventory.stock.transitionRevision({
  operationId: "approve-unit-transition",
  occurredAtEpochMs: conversionAt,
  plan: preview,
  reason: "Current stock is handled in ten-piece boxes.",
});
~~~

Use defineScalarInventoryItem or defineInventoryItem to construct the second definition; extendInventoryCatalog, publishInventoryCatalogExtension or inventory.catalog.publish retains the old revision and activates the new definition.

## Guaranteed behavior

The source revision and original receipt history survive unchanged. The new event is a distinct revision-transition kind with exact unit-equivalence evidence, not a Transformation event or new genealogy.

The complete reviewed world is fenced by world revision; stale previews fail and must be regenerated. All conversion amounts are exact finite-decimal rationals without floating-point rounding. Operator IDs freeze unchanged retry intent. A transition is one complete durable atomic event; earlier item/lot/serial identity, direct placement, ownership/custody/status/qualified dimensions and independently measured axes are preserved. FIFO positive-layer age is carried to converted positions. Compatible individually identified physical holders retain their embodiment and descendants. A partial selector allows phased rollouts in which v1 and v2 stock coexist.

## Explicit blockers

- The new target definition must be the already published active revision.
- The exact conversion must terminate within supported quantity scale/safe integer bounds; each serialized unit must remain exactly **one** primary target unit.
- New tracking requirements cannot invent missing lots/serials or discard existing ones; incompatible qualified dimensions block.
- An intact package still references its old package revision. Unpack or explicitly reconcile such stock first; do not silently rewrite old package definitions.
- Detached/missing whereabouts, active transfer lifecycles and their stock, current reservations, and open physical counts on the old item revision must be resolved. A count in Started or Observed state blocks the transition; a Completed or Abandoned count does not.
- Independently measured axes must have matching identity, unit and requirement. Additional explicit measured-axis conversion is not inferred.
- Negative deficits and nonpositive stock positions cannot be silently converted.

All blockers are typed preview results; there is no force flag for an invalid conversion.

## Prospective transition versus a historical mistake

This prospective operation changes the definition of existing stock *from now on*. It does not mean an old receipt was originally entered correctly. To correct a past erroneous receipt or action, use the established append-only correction and historical-repair APIs. Do not conflate current stock redefinition with retroactively changing past business facts.

A genuinely misrecorded original receipt can also be corrected directly,
rather than transitioning current stock. For example, after publishing the
actual target revision, use `stock.correct({ correctsEventId, reason,
replaceWith: plans => plans.receive({ itemRevisionId: "box-box-v2",
amount: stockAmount("10", "box"), ... }) })` when the earlier receipt
incorrectly asserted 100 pieces but the physical truth was always 10 boxes.
The original root remains in the retained event history; correction replay
checks subsequent dependent history and rejects incoherent downstream effects.
A previously recorded revision-transition event likewise has a dedicated
`plans.revisionTransition({ occurredAtEpochMs, plan })` replacement method,
using the previously reviewed exact plan rather than signed journal legs.

The typed `stock.recordHistorical` assertion-planner contract deliberately does
**not** expose `revisionTransition`. A revision transition is a current-stock
accounting decision against a reviewed published world, not a missing physical
fact to insert into earlier effective history. InventoryOnce does not add a
runtime guard for callers that bypass the public TypeScript contract. Historical
mistakes should be expressed as the actual missing/correct physical assertions;
an already-recorded transition itself can still be corrected append-only with
`stock.correct`.

## Assurance scope

The executable test suite covers exact 100→10 conversion, phasing by lot, historical retention, FIFO continuity, serialized holders, active reservations, stale previews, changed retries and critical blockers. The finite TLA+ RevisionTransition model checks common-basis conservation, immutable original receipt truth, world-fenced preview, dependency blockers and at-most-once atomic conversion. Open-count gating and completed/abandoned lifecycle behavior are exercised by the public API regression suite; the finite model covers reservation/transfer blockers but does not model count lifecycle states. The bounded model does not prove all TypeScript, adapter or external application cases.
