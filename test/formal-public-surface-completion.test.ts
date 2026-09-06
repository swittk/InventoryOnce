import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryAuthorityMode,
  InventoryCompatibilityProjectionStatus,
  InventoryEventKind,
  InventoryTraceabilityNodeKind,
  createInventoryAuthorityControl,
  everythingInInventoryStockSelector,
  inventoryMeasuredAmountFromVector,
  inventoryMeasurement,
  inventoryMeasurementVector,
  parseQuantity,
  readPublishedInventorySnapshot,
  stockAmount,
  subtractInventoryMeasurements,
} from "../src/index.js";
import {
  abandonInventoryCount,
  allocateInventoryReservation,
  completeInventoryCount,
  createInventoryCompositionOpenEvent,
  createInventoryCorrectionEvent,
  createInventoryCountReconciliationPlan,
  createInventoryIssueManyEvent,
  createInventoryReservation,
  createInventoryScrapManyEvent,
  createInventoryTransferManyEvent,
  expireInventoryReservation,
  markInventoryReservationConsumed,
  observeInventoryCount,
  releaseInventoryReservation,
  startInventoryCount,
} from "../src/kernel.js";
import { inventoryMigrationProblem } from "../src/migrations-api.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  createTestInventory,
  loosePosition,
  TestInventoryAuthorityStore,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-discovered direct/call-chain completion witness for every formerly unresolved API. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-PUBLIC-SURFACE-CALLGRAPH-COMPLETION",
] as const;

/** Require a synchronous low-level validator to reject malformed public input with a deliberate Error. */
function expectMalformedInputRejected(action: () => unknown): void {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) {
    throw new Error("Malformed-input validator did not throw an Error.");
  }
  expect(failure.message.length).toBeGreaterThan(0);
}

/** Require an asynchronous façade validator to reject malformed input with a deliberate Error. */
async function expectMalformedAsyncInputRejected(
  action: () => Promise<unknown>
): Promise<void> {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) {
    throw new Error("Malformed-input façade did not reject with an Error.");
  }
  expect(failure.message.length).toBeGreaterThan(0);
}

describe("remaining public implementation surfaces", () => {
  it("executes every previously indirect pure and low-level kernel entry", () => {
    const left = inventoryMeasurementVector(
      inventoryMeasurement("pieces", parseQuantity("4", "piece")),
      []
    );
    const right = inventoryMeasurementVector(
      inventoryMeasurement("pieces", parseQuantity("1", "piece")),
      []
    );
    expect(
      subtractInventoryMeasurements(left, right).primary.quantity.amountMinor
    ).toBe(3);
    expect(inventoryMeasuredAmountFromVector(left)).toEqual({
      kind: "measured",
      primaryValue: "4",
      primaryUnit: "piece",
      independent: [],
    });
    expect(everythingInInventoryStockSelector("item-a")).toEqual({
      itemId: "item-a",
    });
    expect(
      inventoryMigrationProblem(
        "Ambiguous row",
        { sourceType: "legacy", sourceId: "row-1" },
        "Resolve the unit"
      )
    ).toEqual(
      expect.objectContaining({
        message: "Ambiguous row",
        resolution: "Resolve the unit",
      })
    );

    // `as never` deliberately bypasses typed inputs to exercise runtime validators; this applies to the malformed-input blocks below.
    expectMalformedInputRejected(() => abandonInventoryCount({} as never));
    expectMalformedInputRejected(() =>
      allocateInventoryReservation({} as never)
    );
    expectMalformedInputRejected(() => completeInventoryCount({} as never));
    expectMalformedInputRejected(() =>
      createInventoryCompositionOpenEvent({} as never)
    );
    expectMalformedInputRejected(() =>
      createInventoryCorrectionEvent({} as never)
    );
    expectMalformedInputRejected(() =>
      createInventoryCountReconciliationPlan({} as never)
    );
    expectMalformedInputRejected(() =>
      createInventoryIssueManyEvent({} as never)
    );
    expectMalformedInputRejected(() => createInventoryReservation({} as never));
    expectMalformedInputRejected(() =>
      createInventoryScrapManyEvent({} as never)
    );
    expectMalformedInputRejected(() =>
      createInventoryTransferManyEvent({} as never)
    );
    expectMalformedInputRejected(() => expireInventoryReservation({} as never));
    expectMalformedInputRejected(() =>
      markInventoryReservationConsumed({} as never)
    );
    expectMalformedInputRejected(() => observeInventoryCount({} as never));
    expectMalformedInputRejected(() =>
      releaseInventoryReservation({} as never)
    );
    expectMalformedInputRejected(() => startInventoryCount({} as never));
  });

  it("executes the remaining authority release and projection-status transitions", async () => {
    const authority = createInventoryAuthorityControl({
      store: new TestInventoryAuthorityStore(),
      namespaceId: "surface-completion:primary",
    });
    await authority.certifyAdapter({
      certificationDigest: "surface-completion-certification",
      certifiedAt: time0,
    });
    const admitted = await authority.admitLegacyWriter({
      writerToken: "surface-writer",
      attemptToken: "surface-attempt",
    });
    expect(admitted.admittedLegacyWriter).toBe(true);
    const released = await authority.releaseLegacyWriter({
      writerToken: "surface-writer",
      attemptToken: "surface-attempt",
    });
    expect(released.activeLegacyWriters).toEqual([]);

    const activated = await authority.activateGreenfield({
      authorizationId: "surface-greenfield-authorization",
      certificationDigest: "surface-completion-certification",
      targetWorldRoot: "surface-empty-world-root",
      targetWorldRevision: 0,
      activatedAt: time1,
    });
    expect(activated.mode).toBe(InventoryAuthorityMode.Authoritative);
    const failed = await authority.markCompatibilityProjectionFailed({
      worldRevision: 0,
      error: "Synthetic projection failure for direct public execution.",
    });
    expect(failed.compatibilityProjectionStatus).toBe(
      InventoryCompatibilityProjectionStatus.Failed,
    );
    const applied = await authority.markCompatibilityProjectionApplied({
      worldRevision: 0,
    });
    expect(applied.compatibilityProjectionStatus).toBe(
      InventoryCompatibilityProjectionStatus.Current,
    );
    expect(applied.compatibilityProjectionError).toBe("");
  });

  it("executes every remaining snapshot and point-read implementation", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    const received = await inventory.stock.receive({
      operationId: "surface-snapshot-receipt",
      occurredAt: time0,
      to: loosePosition("surface-store", {
        lotId: "SURFACE-LOT",
        containerId: "SURFACE-CONTAINER",
      }),
      amount: stockAmount("2", "piece"),
      lot: { expiresAt: time3 },
      container: { containerType: "tray" },
    });
    const snapshot = await readPublishedInventorySnapshot(storage, time2);
    expect(snapshot.positions({ itemId: "item-a" })).toHaveLength(1);
    expect(
      snapshot.availability(
        { itemId: "item-a", locationIds: ["surface-store"] },
        time2
      ).revisions[0]?.onHand.primary.quantity.amountMinor
    ).toBe(2);
    expect(
      snapshot.planAllocation({
        selector: { itemId: "item-a", locationIds: ["surface-store"] },
        amount: stockAmount("1", "piece"),
        method: InventoryAllocationMethod.Fifo,
        at: time2,
      }).lines[0]?.allocatedPrimary.amountMinor
    ).toBe(1);
    expect(
      snapshot.container("SURFACE-CONTAINER")?.definition.containerId
    ).toBe("SURFACE-CONTAINER");
    expect(snapshot.lot("item-a", "SURFACE-LOT")?.definition.lotId).toBe(
      "SURFACE-LOT"
    );
    expect(snapshot.compositionRevisionsForItem("item-a")).toEqual([]);
    expect(snapshot.event(received.event.eventId)?.eventId).toBe(
      received.event.eventId
    );
    expect(snapshot.reservation("missing-reservation")).toBeUndefined();
    expect(snapshot.count("missing-count")).toBeUndefined();
    expect(snapshot.reservationFeasibility(time2).groups).toEqual([]);
    expectMalformedInputRejected(() => snapshot.collectionSummary({} as never));
    expectMalformedInputRejected(() => snapshot.fungibilitySummary({} as never));

    expect((await inventory.read.event(received.event.eventId))?.eventId).toBe(
      received.event.eventId
    );
    expect(
      await inventory.read.reservation("missing-reservation")
    ).toBeUndefined();
  });

  it("executes the remaining fail-closed facade mutation implementations", async () => {
    const inventory = createTestInventory();
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.issueMany({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.transferMany({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.scrapMany({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.clearStatus({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.clearOwner({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.clearCustodian({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.clearDispositionAuthority({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.stock.clearQualifiedDimension({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.fungibility.scrap({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.reservations.expire({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.counts.abandon({} as never)
    );
    await expectMalformedAsyncInputRejected(() =>
      inventory.traceability.disassociate({} as never)
    );
    expect((await inventory.read.world()).revision).toBe(0);
  });
});
