import { describe, expect, it } from "vitest";
import {
  InventoryEventKind,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  packageAmount,
  measuredStockAmount,
  parseQuantity,
  stockAmount,
  unitCode,
  type InventoryCatalog,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { clockAt, time0, time1, time2, time3 } from "./test-fixtures.js";

/** Bound the formal assurance claim to executable tests of the real public transition API. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-ITEM-REVISION-TRANSITION-EXACT",
] as const;

/** Retained revisions and explicit unit identities shared by transition tests. */
function revisionCatalog(): {
  /** Initial physical count definition with optional lot and serial. */
  readonly first: InventoryCatalog;
  /** Complete second catalog with an active new unit. */
  readonly second: InventoryCatalog;
} {
  const firstItem = defineScalarInventoryItem({
    itemId: "box",
    revisionId: "box-count-v1",
    axisId: "count",
    unit: "piece",
  });
  const secondItem = defineScalarInventoryItem({
    itemId: "box",
    revisionId: "box-count-v2",
    axisId: "count",
    unit: "box",
  });
  const first = defineInventoryCatalog({
    itemRevisions: [firstItem],
    activeItemRevisionIds: { box: firstItem.revisionId },
  });
  return {
    first,
    second: extendInventoryCatalog({
      catalog: first,
      itemRevisions: [secondItem],
      activeItemRevisionIds: { box: secondItem.revisionId },
    }),
  };
}

/** Build actual durable worlds on either side of one published change of item definition. */
async function loadedRevisionInventory() {
  const catalogs = revisionCatalog();
  const storage = createInMemoryInventoryDurableStorage();
  const oldInventory = createInventoryOnce({
    catalog: catalogs.first,
    storage,
    clock: clockAt(time3),
  });
  await oldInventory.catalog.publish({
    operationId: "publish-physical-box-v1",
    occurredAtEpochMs: time0,
  });
  const inventory = createInventoryOnce({
    catalog: catalogs.second,
    storage,
    clock: clockAt(time3),
  });
  return { oldInventory, inventory, storage, catalogs };
}

/** Exact meaning of ten source pieces as one new box. */
const tenPieceConversion = {
  /** Old stock quantity known to equal one new box. */
  sourceAmount: "10",
  /** New box count corresponding to ten physical pieces. */
  targetAmount: "1",
};

describe("prospective item-revision transition", () => {
  it("previews then atomically converts 100 pieces to 10 boxes without production genealogy", async () => {
    const { oldInventory, inventory, storage } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-100-pieces-before-edit",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room", lotId: "LOT-A" },
      amount: stockAmount("100", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-box-unit-revision",
      occurredAtEpochMs: time2,
    });
    const request = {
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    };
    const preview = await inventory.stock.planRevisionTransition(request);
    expect(preview.applicable).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]?.sourceMeasurements.primary.quantity).toMatchObject({
      amountMinor: 100, unit: "piece",
    });
    expect(preview.lines[0]?.targetMeasurements.primary.quantity).toMatchObject({
      amountMinor: 10, unit: "box",
    });
    expect((await inventory.read.positions({ itemId: "box" }))).toHaveLength(1);
    const before = (await inventory.read.positions({ itemId: "box" }))[0];
    const firstPositiveAge = (await inventory.read.world()).projection
      .positiveLayerStartedAtEpochMsByPositionId;
    expect(before).toBeDefined();
    const command = {
      operationId: "approve-stock-revision-transition",
      occurredAtEpochMs: time3,
      plan: preview,
      reason: "Physical units were always sold as ten-piece boxes.",
    };
    const applied = await inventory.stock.transitionRevision(command);
    expect(applied.event.kind).toBe(InventoryEventKind.RevisionTransition);
    expect(applied.event.traceabilityChanges).toEqual([]);
    expect(applied.event.revisionTransition).toMatchObject({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
    });
    const after = await inventory.read.positions({ itemId: "box" });
    expect(after).toHaveLength(1);
    expect(after[0]?.key).toMatchObject({
      itemRevisionId: "box-count-v2",
      lotId: "LOT-A",
      placementNodeId: "room",
    });
    expect(after[0]?.measurements.primary.quantity).toMatchObject({
      amountMinor: 10, unit: "box",
    });
    const retainedAge = (await inventory.read.world()).projection
      .positiveLayerStartedAtEpochMsByPositionId;
    expect(Object.values(firstPositiveAge)).toEqual([time1]);
    expect(Object.values(retainedAge)).toEqual([time1]);
    const replay = await inventory.stock.transitionRevision(command);
    expect(replay.replayed).toBe(true);
    expect((await storage.readOperation(command.operationId))?.event?.kind).toBe(
      InventoryEventKind.RevisionTransition
    );
    await expect(
      inventory.stock.transitionRevision({ ...command, reason: "Different reason" })
    ).rejects.toThrow(/different|intent|replay|fingerprint/i);
    expect((await inventory.read.positions({ itemId: "box" }))).toEqual(after);
    // The newly active revision is immediately usable by ordinary stock commands.
    await inventory.stock.issue({
      operationId: "issue-after-unit-redefinition",
      occurredAtEpochMs: time3,
      from: { itemId: "box", placementNodeId: "room", lotId: "LOT-A" },
      amount: stockAmount("3", "box"),
    });
    expect((await inventory.read.positions({ itemId: "box" }))[0]
      ?.measurements.primary.quantity.amountMinor).toBe(7);
    const history = await inventory.read.events({ itemIds: ["box"] });
    expect(history.events.some((event) =>
      event.kind === InventoryEventKind.RevisionTransition)).toBe(true);
  });

  it("refuses a stale reviewed plan after any concurrent published world change", async () => {
    const { oldInventory, inventory, storage } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-stale-source",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room" },
      amount: stockAmount("20", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-stale-target",
      occurredAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    });
    expect(preview.applicable).toBe(true);
    await inventory.stock.receive({
      operationId: "concurrent-receive-after-preview",
      occurredAtEpochMs: time3,
      to: { itemId: "box", placementNodeId: "room-2" },
      amount: stockAmount("1", "box"),
    });
    await expect(inventory.stock.transitionRevision({
      operationId: "reject-stale-revision-preview",
      occurredAtEpochMs: time3,
      plan: preview,
    })).rejects.toThrow(/stale/i);
    expect(await storage.readOperation("reject-stale-revision-preview")).toBeUndefined();
    expect((await inventory.read.positions({
      itemId: "box",
      itemRevisionIds: ["box-count-v1"],
    }))).toHaveLength(1);
  });

  it("allows a selected lot rollout with old and new revisions coexisting honestly", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-old-lot-a", occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "warehouse", lotId: "A" },
      amount: stockAmount("20", "piece"),
    });
    await oldInventory.stock.receive({
      operationId: "receive-old-lot-b", occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "warehouse", lotId: "B" },
      amount: stockAmount("30", "piece"),
    });
    await inventory.catalog.publish({ operationId: "publish-for-phased-revision", occurredAtEpochMs: time2 });
    const request = {
      itemId: "box", fromRevisionId: "box-count-v1", toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
      selector: { itemId: "box", itemRevisionIds: ["box-count-v1"], lotIds: ["A"] },
    };
    const plan = await inventory.stock.planRevisionTransition(request);
    expect(plan.applicable).toBe(true);
    expect(plan.lines).toHaveLength(1);
    await inventory.stock.transitionRevision({
      operationId: "transition-lot-a-only", occurredAtEpochMs: time3,
      plan,
    });
    const versions = await inventory.read.positions({ itemId: "box" });
    expect(versions.map((row) => [row.key.lotId, row.key.itemRevisionId,
      row.measurements.primary.quantity.amountMinor])).toEqual([
        ["B", "box-count-v1", 30],
        ["A", "box-count-v2", 2],
    ]);
    const next = await inventory.stock.planRevisionTransition({
      itemId: "box", fromRevisionId: "box-count-v1", toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    });
    expect(next.applicable).toBe(true);
    await inventory.stock.transitionRevision({
      operationId: "transition-remaining-lot", occurredAtEpochMs: time3, plan: next,
    });
    expect((await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v1"],
    }))).toHaveLength(0);
    expect((await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v2"],
    }))).toHaveLength(2);
    const rerouted = await inventory.stock.planRevisionTransition({
      ...request, selector: { itemId: "box", itemRevisionIds: ["box-count-v1"], lotIds: ["B"] },
    });
    expect(rerouted.applicable).toBe(false);
  });

  it("blocks active claims on an old item revision before accepting a transition", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-stock-to-reserve", occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "warehouse" },
      amount: stockAmount("20", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-reserved-revision", occurredAtEpochMs: time2,
    });
    await inventory.reservations.reserve({
      reservationId: "claim-old-units",
      operationId: "reserve-old-units",
      itemRevisionId: "box-count-v1",
      selector: { itemId: "box", itemRevisionIds: ["box-count-v1"] },
      requested: parseQuantity("5", "piece"),
      createdAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "active-reservation",
    }));
    await inventory.reservations.release({
      operationId: "release-old-units",
      reservationId: "claim-old-units",
      occurredAtEpochMs: time3,
    });
    const released = await inventory.stock.planRevisionTransition(preview.request);
    expect(released.applicable).toBe(true);
  });

  it("blocks started and observed counts but permits abandoned and completed counts", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-counted-old-revision-stock",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "count-room" },
      amount: stockAmount("20", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-revision-before-physical-count",
      occurredAtEpochMs: time2,
    });
    const position = (await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v1"],
    }))[0];
    if (position === undefined) throw new Error("Counted source stock was not received.");
    const request = {
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    };
    const countSelector = {
      itemId: "box",
      itemRevisionIds: ["box-count-v1"],
      placementNodeIds: ["count-room"],
    };
    const previewBeforeCount = await inventory.stock.planRevisionTransition(request);
    expect(previewBeforeCount.applicable).toBe(true);
    await inventory.counts.start({
      countId: "old-revision-count-abandoned",
      operationId: "start-old-revision-count",
      itemRevisionId: "box-count-v1",
      selector: countSelector,
      startedAtEpochMs: time2,
    });
    await expect(inventory.stock.transitionRevision({
      operationId: "reject-stale-before-count-preview",
      occurredAtEpochMs: time3,
      plan: previewBeforeCount,
    })).rejects.toThrow(/stale/i);
    const started = await inventory.stock.planRevisionTransition(request);
    expect(started.applicable).toBe(false);
    expect(started.blockers).toContainEqual(expect.objectContaining({
      code: "active-count",
      message: expect.stringContaining("old-revision-count-abandoned"),
    }));
    await expect(inventory.stock.transitionRevision({
      operationId: "reject-transition-during-started-count",
      occurredAtEpochMs: time3,
      plan: started,
    })).rejects.toThrow(/blocked/i);
    await inventory.counts.observe({
      operationId: "observe-old-revision-count",
      countId: "old-revision-count-abandoned",
      observedAtEpochMs: time2,
      observations: [{
        position: position.key,
        measurements: position.measurements,
      }],
    });
    const observed = await inventory.stock.planRevisionTransition(request);
    expect(observed.applicable).toBe(false);
    expect(observed.blockers).toContainEqual(expect.objectContaining({
      code: "active-count",
      message: expect.stringContaining("old-revision-count-abandoned"),
    }));
    await inventory.counts.abandon({
      operationId: "abandon-old-revision-count",
      countId: "old-revision-count-abandoned",
      occurredAtEpochMs: time3,
      reason: "No longer needed before the definition transition.",
    });
    expect((await inventory.stock.planRevisionTransition(request)).applicable).toBe(true);

    await inventory.counts.start({
      countId: "old-revision-count-completed",
      operationId: "start-old-revision-count-for-completion",
      itemRevisionId: "box-count-v1",
      selector: countSelector,
      startedAtEpochMs: time3,
    });
    await inventory.counts.observe({
      operationId: "observe-old-revision-count-for-completion",
      countId: "old-revision-count-completed",
      observedAtEpochMs: time3,
      observations: [{
        position: position.key,
        measurements: position.measurements,
      }],
    });
    expect((await inventory.stock.planRevisionTransition(request)).blockers)
      .toContainEqual(expect.objectContaining({
        code: "active-count",
        message: expect.stringContaining("old-revision-count-completed"),
      }));
    await inventory.counts.reconcile({
      operationId: "reconcile-old-revision-count",
      countId: "old-revision-count-completed",
      completedAtEpochMs: time3,
      reason: "Observed stock matches the current balance.",
    });
    const completed = await inventory.stock.planRevisionTransition(request);
    expect(completed.applicable).toBe(true);
    expect(completed.blockers).toEqual([]);
    await inventory.stock.transitionRevision({
      operationId: "transition-after-physical-counts-completed",
      occurredAtEpochMs: time3,
      plan: completed,
    });
    expect((await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v1"],
    }))).toHaveLength(0);
  });

  it("blocks a prepared transfer until its old-revision commitment is released", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-prepared-transfer-stock",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room" },
      amount: stockAmount("20", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-before-old-unit-transfer",
      occurredAtEpochMs: time2,
    });
    await inventory.transfers.prepare({
      operationId: "prepare-transfer-of-old-units",
      occurredAtEpochMs: time2,
      transferId: "TR-OLD-UNITS",
      transitPlacementNodeId: "carrier",
      destinationPlacementNodeId: "other-room",
      lines: [{
        lineId: "line-1",
        from: { itemId: "box", placementNodeId: "room" },
        itemRevisionId: "box-count-v1",
        amount: stockAmount("20", "piece"),
      }],
    });
    const request = {
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    };
    const blocked = await inventory.stock.planRevisionTransition(request);
    expect(blocked.applicable).toBe(false);
    expect(blocked.blockers).toContainEqual(expect.objectContaining({
      code: "active-transfer",
    }));
    await inventory.transfers.release({
      operationId: "release-transfer-of-old-units",
      occurredAtEpochMs: time3,
      transferId: "TR-OLD-UNITS",
    });
    const released = await inventory.stock.planRevisionTransition(request);
    expect(released.applicable).toBe(true);
    const receipt = await inventory.stock.transitionRevision({
      operationId: "transition-after-prepared-transfer-release",
      occurredAtEpochMs: time3,
      plan: released,
    });
    expect(receipt.event.kind).toBe(InventoryEventKind.RevisionTransition);
  });

  it("accepts semantically identical reviewed plans regardless of property insertion order", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-reordered-preview-stock",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "reordered-room" },
      amount: stockAmount("20", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-reordered-preview-target",
      occurredAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    });
    if (!preview.applicable || preview.lines[0] === undefined) {
      throw new Error("Expected an applicable revision-transition preview.");
    }
    const sourceLine = preview.lines[0];
    const reorderedPlan = {
      applicable: preview.applicable,
      blockers: preview.blockers,
      lines: [{
        targetMeasurements: {
          independent: [...sourceLine.targetMeasurements.independent],
          primary: {
            quantity: {
              unit: sourceLine.targetMeasurements.primary.quantity.unit,
              decimals: sourceLine.targetMeasurements.primary.quantity.decimals,
              amountMinor: sourceLine.targetMeasurements.primary.quantity.amountMinor,
            },
            axisId: sourceLine.targetMeasurements.primary.axisId,
          },
        },
        sourceMeasurements: {
          independent: [...sourceLine.sourceMeasurements.independent],
          primary: {
            quantity: {
              unit: sourceLine.sourceMeasurements.primary.quantity.unit,
              decimals: sourceLine.sourceMeasurements.primary.quantity.decimals,
              amountMinor: sourceLine.sourceMeasurements.primary.quantity.amountMinor,
            },
            axisId: sourceLine.sourceMeasurements.primary.axisId,
          },
        },
        from: { ...sourceLine.from },
      }],
      evidence: {
        targetUnit: {
          unit: preview.evidence.targetUnit.unit,
          decimals: preview.evidence.targetUnit.decimals,
          amountMinor: preview.evidence.targetUnit.amountMinor,
        },
        sourceUnit: {
          unit: preview.evidence.sourceUnit.unit,
          decimals: preview.evidence.sourceUnit.decimals,
          amountMinor: preview.evidence.sourceUnit.amountMinor,
        },
        selectorIdentity: preview.evidence.selectorIdentity,
        expectedWorldRevision: preview.evidence.expectedWorldRevision,
        toRevisionId: preview.evidence.toRevisionId,
        fromRevisionId: preview.evidence.fromRevisionId,
        itemId: preview.evidence.itemId,
      },
      request: preview.request,
      worldRevision: preview.worldRevision,
    };
    const receipt = await inventory.stock.transitionRevision({
      operationId: "commit-reordered-preview",
      occurredAtEpochMs: time3,
      plan: reorderedPlan,
    });
    expect(receipt.event.kind).toBe(InventoryEventKind.RevisionTransition);
  });

  it("rejects tampered previews and freezes selector intent for retries", async () => {
    const { oldInventory, inventory, storage } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-tamper-a", occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room", lotId: "A" },
      amount: stockAmount("10", "piece"),
    });
    await inventory.catalog.publish({ operationId: "publish-for-tamper", occurredAtEpochMs: time2 });
    const request = {
      itemId: "box", fromRevisionId: "box-count-v1", toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    };
    const original = await inventory.stock.planRevisionTransition(request);
    const manipulated = {
      ...original,
      lines: original.lines.map(
        /** Change the approved target amount without touching the source fact. */
        (line) => ({
          ...line,
          targetMeasurements: {
            ...line.targetMeasurements,
            primary: {
              ...line.targetMeasurements.primary,
              quantity: parseQuantity("99", "box"),
            },
          },
        })
      ),
    };
    await expect(inventory.stock.transitionRevision({
      operationId: "attempt-invented-boxes", occurredAtEpochMs: time3, plan: manipulated,
    })).rejects.toThrow(/equivalence|physical amounts/i);
    expect(await storage.readOperation("attempt-invented-boxes")).toBeUndefined();
    const applied = {
      operationId: "transition-freeze-selector",
      occurredAtEpochMs: time3,
      plan: original,
    };
    await inventory.stock.transitionRevision(applied);
    const altered = {
      ...original,
      evidence: {
        ...original.evidence,
        selectorIdentity: "another-approved-scope",
      },
    };
    await expect(inventory.stock.transitionRevision({
      ...applied,
      plan: altered,
    })).rejects.toThrow(/intent|different|differs|retry|fingerprint|selector/i);
    const changedRequestOnly = {
      ...original,
      request: {
        ...original.request,
        conversion: { sourceAmount: "2", targetAmount: "1" },
      },
    };
    await expect(inventory.stock.transitionRevision({
      ...applied,
      plan: changedRequestOnly,
    })).rejects.toThrow(/approved|ratio|conflicting/i);
    const changedScopeOnly = {
      ...original,
      request: {
        ...original.request,
        selector: { itemId: "box", lotIds: ["A"] },
      },
    };
    await expect(inventory.stock.transitionRevision({
      ...applied,
      plan: changedScopeOnly,
    })).rejects.toThrow(/scope|selector|approved/i);
  });

  it("reports exact blocked conversions rather than rounding 1/3 of a box", async () => {
    const { oldInventory, inventory, storage } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-nondecimal-piece",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room" },
      amount: stockAmount("1", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-nondecimal-target",
      occurredAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: { sourceAmount: "3", targetAmount: "1" },
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers.some((blocker) => blocker.code === "incompatible-position")).toBe(true);
    expect(preview.blockers.some((blocker) => /rounding|decimal/.test(blocker.message))).toBe(true);
    await expect(inventory.stock.transitionRevision({
      operationId: "reject-nondecimal-transition",
      occurredAtEpochMs: time3,
      plan: preview,
    })).rejects.toThrow(/blocked/i);
    expect(await storage.readOperation("reject-nondecimal-transition")).toBeUndefined();
  });

  it("blocks intact packages without silently stealing their frozen package revision", async () => {
    const firstItem = defineScalarInventoryItem({
      itemId: "box", revisionId: "box-old-package", unit: "piece", axisId: "count",
    });
    const secondItem = defineScalarInventoryItem({
      itemId: "box", revisionId: "box-new-package", unit: "piece", axisId: "count",
    });
    const storage = createInMemoryInventoryDurableStorage();
    const firstCatalog = defineInventoryCatalog({
      itemRevisions: [firstItem],
      activeItemRevisionIds: { box: firstItem.revisionId },
      packagingRevisions: [defineScalarInventoryPackaging({
        revisionId: "box-case-10-old", item: firstItem,
        packageUnit: "case", contains: "10",
      })],
    });
    const oldInventory = createInventoryOnce({
      catalog: firstCatalog, storage, clock: clockAt(time3),
    });
    await oldInventory.catalog.publish({ operationId: "publish-old-packaging", occurredAtEpochMs: time0 });
    await oldInventory.stock.receive({
      operationId: "receive-intact-case", occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "warehouse" },
      amount: packageAmount(1, "box-case-10-old"),
    });
    const newCatalog = extendInventoryCatalog({
      catalog: firstCatalog,
      itemRevisions: [secondItem],
      activeItemRevisionIds: { box: secondItem.revisionId },
    });
    const inventory = createInventoryOnce({ catalog: newCatalog, storage, clock: clockAt(time3) });
    await inventory.catalog.publish({ operationId: "publish-new-packaging", occurredAtEpochMs: time2 });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: firstItem.revisionId,
      toRevisionId: secondItem.revisionId,
      conversion: { sourceAmount: "1", targetAmount: "1" },
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers.some((blocker) => blocker.code === "packaged-stock")).toBe(true);
  });

  it("preserves exact catch-weight measurements when the independent axis schema is compatible", async () => {
    const old = defineInventoryItem({
      ...defineScalarInventoryItem({
        itemId: "measured-box", revisionId: "measured-v1",
        axisId: "count", unit: "piece",
      }),
      independentAxes: [{
        axisId: "weight",
        role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("kg"),
        requirement: InventoryMeasurementRequirement.Optional,
      }],
    });
    const newItem = defineInventoryItem({
      ...old,
      revisionId: "measured-v2",
      primaryAxis: { ...old.primaryAxis, unit: unitCode("box") },
    });
    const oldCatalog = defineInventoryCatalog({
      itemRevisions: [old],
      activeItemRevisionIds: { "measured-box": old.revisionId },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const first = createInventoryOnce({
      catalog: oldCatalog, storage, clock: clockAt(time3),
    });
    await first.catalog.publish({ operationId: "publish-measured-v1", occurredAtEpochMs: time0 });
    await first.stock.receive({
      operationId: "receive-measured-old-unit", occurredAtEpochMs: time1,
      to: { itemId: "measured-box", placementNodeId: "weighing-room" },
      amount: measuredStockAmount("100", "piece", [
        { axisId: "weight", value: "12.5", unit: "kg" },
      ]),
    });
    const second = createInventoryOnce({
      catalog: extendInventoryCatalog({
        catalog: oldCatalog,
        itemRevisions: [newItem],
        activeItemRevisionIds: { "measured-box": newItem.revisionId },
      }),
      storage, clock: clockAt(time3),
    });
    await second.catalog.publish({ operationId: "publish-measured-v2", occurredAtEpochMs: time2 });
    const preview = await second.stock.planRevisionTransition({
      itemId: "measured-box",
      fromRevisionId: old.revisionId, toRevisionId: newItem.revisionId,
      conversion: tenPieceConversion,
    });
    expect(preview.applicable).toBe(true);
    expect(preview.lines[0]?.targetMeasurements.independent).toMatchObject([{
      axisId: "weight",
      quantity: { amountMinor: 125, decimals: 1, unit: "kg" },
    }]);
    await second.stock.transitionRevision({
      operationId: "transition-measured-count", occurredAtEpochMs: time3,
      plan: preview,
    });
    expect((await second.read.positions({ itemId: "measured-box" }))[0]?.measurements)
      .toMatchObject({
        primary: { axisId: "count", quantity: { amountMinor: 10, unit: "box" } },
        independent: [{ axisId: "weight", quantity: { amountMinor: 125, unit: "kg" } }],
      });
  });

  it("blocks incompatible independently measured axes instead of inventing physical measurements", async () => {
    const sourceItem = defineScalarInventoryItem({
      itemId: "new-weight", revisionId: "new-weight-v1",
      axisId: "count", unit: "piece",
    });
    const targetItem = defineInventoryItem({
      ...sourceItem,
      revisionId: "new-weight-v2",
      independentAxes: [{
        axisId: "weight",
        role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("kg"),
        requirement: InventoryMeasurementRequirement.Optional,
      }],
    });
    const oldCatalog = defineInventoryCatalog({
      itemRevisions: [sourceItem],
      activeItemRevisionIds: { "new-weight": sourceItem.revisionId },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const oldInventory = createInventoryOnce({
      catalog: oldCatalog, storage, clock: clockAt(time3),
    });
    await oldInventory.catalog.publish({
      operationId: "publish-weight-v1", occurredAtEpochMs: time0,
    });
    await oldInventory.stock.receive({
      operationId: "receive-weightless", occurredAtEpochMs: time1,
      to: { itemId: "new-weight", placementNodeId: "room" },
      amount: stockAmount("10", "piece"),
    });
    const inventory = createInventoryOnce({
      catalog: extendInventoryCatalog({
        catalog: oldCatalog,
        itemRevisions: [targetItem],
        activeItemRevisionIds: { "new-weight": targetItem.revisionId },
      }),
      storage, clock: clockAt(time3),
    });
    await inventory.catalog.publish({
      operationId: "publish-weight-v2", occurredAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "new-weight", fromRevisionId: sourceItem.revisionId,
      toRevisionId: targetItem.revisionId,
      conversion: { sourceAmount: "1", targetAmount: "1" },
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "independent-axes",
    }));
  });

  it("rejects missing required serials instead of minting undocumented identities", async () => {
    const oldItem = defineScalarInventoryItem({
      itemId: "kit", revisionId: "kit-v1", axisId: "count", unit: "piece",
    });
    const newItem = defineScalarInventoryItem({
      itemId: "kit", revisionId: "kit-v2", axisId: "count", unit: "piece",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Required,
      },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const oldCatalog = defineInventoryCatalog({
      itemRevisions: [oldItem], activeItemRevisionIds: { kit: oldItem.revisionId },
    });
    const oldInventory = createInventoryOnce({ catalog: oldCatalog, storage, clock: clockAt(time3) });
    await oldInventory.catalog.publish({ operationId: "publish-serial-old", occurredAtEpochMs: time0 });
    await oldInventory.stock.receive({
      operationId: "receive-unidentified-kits", occurredAtEpochMs: time1,
      to: { itemId: "kit", placementNodeId: "room" },
      amount: stockAmount("2", "piece"),
    });
    const nextCatalog = extendInventoryCatalog({
      catalog: oldCatalog, itemRevisions: [newItem],
      activeItemRevisionIds: { kit: newItem.revisionId },
    });
    const inventory = createInventoryOnce({ catalog: nextCatalog, storage, clock: clockAt(time3) });
    await inventory.catalog.publish({ operationId: "publish-serial-required", occurredAtEpochMs: time2 });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "kit", fromRevisionId: "kit-v1", toRevisionId: "kit-v2",
      conversion: { sourceAmount: "1", targetAmount: "1" },
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers.some((blocker) => /serial/.test(blocker.message))).toBe(true);
  });

  it("preserves one serialized holder and its nested contents across compatible definition edits", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-serial-before-edit",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room", serialId: "BOX-01" },
      amount: stockAmount("1", "piece"),
    });
    await oldInventory.placement.define({
      operationId: "make-holder",
      occurredAtEpochMs: time1,
      nodeId: "physical-box",
      placementNode: {
        category: "movable-holder",
        acceptsPlacement: true,
        embodiedBy: { itemId: "box", serialId: "BOX-01" },
      },
    });
    await oldInventory.stock.receive({
      operationId: "receive-other-stock",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "physical-box" },
      amount: stockAmount("10", "piece"),
    });
    await inventory.catalog.publish({ operationId: "publish-serial-holder-target", occurredAtEpochMs: time2 });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: { sourceAmount: "1", targetAmount: "1" },
    });
    expect(preview.applicable).toBe(true);
    await inventory.stock.transitionRevision({
      operationId: "transition-holder-with-contents",
      occurredAtEpochMs: time3,
      plan: preview,
    });
    expect(await inventory.read.placementParent("physical-box")).toBe("room");
    expect(await inventory.read.placementNode("physical-box")).toMatchObject({
      definition: { embodiedBy: { itemId: "box", serialId: "BOX-01" } },
    });
    expect((await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v1"],
    }))).toHaveLength(0);
    expect((await inventory.read.positions({
      itemId: "box", itemRevisionIds: ["box-count-v2"],
    }))).toHaveLength(2);
  });

  it("blocks a fractional converted serial resource even when the scalar ratio is exact", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-one-serial",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room", serialId: "SERIAL-1" },
      amount: stockAmount("1", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-new-serial-unit",
      occurredAtEpochMs: time2,
    });
    const preview = await inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    });
    expect(preview.applicable).toBe(false);
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "serialized-unit",
    }));
  });

  it("separately corrects a genuinely wrong original receipt instead of claiming a new physical transformation", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    const root = await oldInventory.stock.receive({
      operationId: "mistaken-original-100-pieces",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room" },
      amount: stockAmount("100", "piece"),
    });
    await inventory.catalog.publish({
      operationId: "publish-correct-units-after-error",
      occurredAtEpochMs: time2,
    });
    const correction = await inventory.stock.correct({
      operationId: "fix-original-receipt-unit",
      occurredAtEpochMs: time3,
      correctsEventId: root.event.eventId,
      reason: "The original stock receipt was ten boxes, not 100 pieces.",
      replaceWith: (plans) => plans.receive({
        occurredAtEpochMs: time1,
        to: { itemId: "box", placementNodeId: "room" },
        itemRevisionId: "box-count-v2",
        amount: stockAmount("10", "box"),
      }),
    });
    expect(correction.event.kind).toBe(InventoryEventKind.Correction);
    const after = await inventory.read.positions({ itemId: "box" });
    expect(after).toHaveLength(1);
    expect(after[0]?.key.itemRevisionId).toBe("box-count-v2");
    expect(after[0]?.measurements.primary.quantity).toMatchObject({
      amountMinor: 10, unit: "box",
    });
    const history = await inventory.read.events({ itemIds: ["box"] });
    expect(history.events.some((event) => event.eventId === root.event.eventId)).toBe(true);
    expect(history.events.some((event) => event.kind === InventoryEventKind.RevisionTransition))
      .toBe(false);
  });

  it("does not mistake an already active prospective catalog revision for stock conversion", async () => {
    const { oldInventory, inventory } = await loadedRevisionInventory();
    await oldInventory.stock.receive({
      operationId: "receive-without-publication",
      occurredAtEpochMs: time1,
      to: { itemId: "box", placementNodeId: "room" },
      amount: stockAmount("20", "piece"),
    });
    await expect(inventory.stock.planRevisionTransition({
      itemId: "box",
      fromRevisionId: "box-count-v1",
      toRevisionId: "box-count-v2",
      conversion: tenPieceConversion,
    })).rejects.toThrow(/Unknown inventory item revision 'box-count-v2'/);
  });
});
