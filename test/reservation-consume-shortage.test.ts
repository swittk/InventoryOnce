import { describe, expect, it, vi } from "vitest";
import * as reservationSemantics from "../src/reservations.js";

import {
  InventoryEventKind,
  InventoryDeficitPolicy,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryReservationFeasibilityStatus,
  InventoryReservationStatus,
  InventoryTrackingRequirement,
  defineInventoryCatalog,
  defineInventoryItem,
  measuredStockAmount,
  parseQuantity,
  stockAmount,
  unitCode,
  type InventoryCatalog,
  type InventoryOnce,
} from "../src/index.js";
import {
  createInventoryIssueEvent,
  inventoryEventIdForOperation,
  markInventoryReservationConsumed,
} from "../src/kernel.js";
import {
  commitInventoryOperation,
  createInMemoryInventoryDurableStorage,
  type InMemoryInventoryDurableStorage,
} from "../src/storage-api.js";
import {
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Original ReservationScope survivor shapes represented by the Consume32 red. */
type ConsumeShortageShape =
  | "allocated-lost-token"
  | "unallocated-out-of-scope"
  | "unallocated-contending";

/** Real public runtime after one physical loss makes c1 short and leaves c2 allocated. */
interface ConsumeShortageFixture {
  /** Application-facing authority used for the real Consume call. */
  readonly inventory: InventoryOnce;
  /** Reference durable adapter used to inspect atomic publication and replay. */
  readonly storage: InMemoryInventoryDurableStorage;
  /** Frozen catalogue also used by low-level mutation controls. */
  readonly catalog: InventoryCatalog;
}

/** Reproduce one distinct Consume32 survivor shape entirely through public TypeScript. */
async function createConsumeShortageFixture(
  shape: ConsumeShortageShape,
  secondClaimExpiresAt?: string
): Promise<ConsumeShortageFixture> {
  const catalog = createTabletCatalog();
  const storage = createInMemoryInventoryDurableStorage();
  let recordedAt = time1;
  const inventory = createTestInventory(storage, catalog, {
    /** Expose a mutable durable clock for the recorded-time expiry control. */
    now: () => recordedAt,
  });
  await inventory.stock.receiveMany({
    operationId: `consume-shortage:${shape}:receive`,
    occurredAt: time0,
    lines: [
      { to: loosePosition("u1"), amount: stockAmount("1", "piece") },
      { to: loosePosition("u2"), amount: stockAmount("1", "piece") },
    ],
  });
  const firstLocations =
    shape === "unallocated-contending" ? ["u1", "u2"] : ["u1"];
  await inventory.reservations.reserve({
    reservationId: "c1",
    operationId: `consume-shortage:${shape}:reserve:c1`,
    itemRevisionId: "item-a-v2",
    selector: { itemId: "item-a", locationIds: firstLocations },
    requested: parseQuantity("1", "piece"),
    createdAt: time1,
  });
  await inventory.reservations.reserve({
    reservationId: "c2",
    operationId: `consume-shortage:${shape}:reserve:c2`,
    itemRevisionId: "item-a-v2",
    selector: { itemId: "item-a", locationIds: ["u2"] },
    requested: parseQuantity("1", "piece"),
    createdAt: time1,
    ...(secondClaimExpiresAt === undefined
      ? {}
      : { expiresAt: secondClaimExpiresAt }),
  });
  if (shape === "allocated-lost-token") {
    await inventory.reservations.allocate({
      reservationId: "c1",
      operationId: `consume-shortage:${shape}:allocate:c1`,
      occurredAt: time1,
      allocations: [
        {
          position: { ...loosePosition("u1"), itemRevisionId: "item-a-v2" },
          quantity: parseQuantity("1", "piece"),
        },
      ],
    });
  }
  await inventory.reservations.allocate({
    reservationId: "c2",
    operationId: `consume-shortage:${shape}:allocate:c2`,
    occurredAt: time1,
    allocations: [
      {
        position: { ...loosePosition("u2"), itemRevisionId: "item-a-v2" },
        quantity: parseQuantity("1", "piece"),
      },
    ],
  });
  await inventory.stock.scrap({
    operationId: `consume-shortage:${shape}:loss:u1`,
    occurredAt: time1,
    from: loosePosition("u1"),
    amount: stockAmount("1", "piece"),
    reason: "The formal u1 token was physically lost.",
  });
  if (secondClaimExpiresAt === undefined) {
    expect(
      (await inventory.read.reservationFeasibility(time1)).status
    ).toBe(InventoryReservationFeasibilityStatus.Shortage);
  }
  recordedAt = time3;
  return { inventory, storage, catalog };
}

/** Create an item whose independently measured weight is its reservation axis. */
function createWeightReservationCatalog(): InventoryCatalog {
  const item = defineInventoryItem({
    itemId: "weight-item",
    revisionId: "weight-item-v1",
    primaryAxis: {
      axisId: "pieces",
      role: InventoryMeasurementAxisRole.Primary,
      unit: unitCode("piece"),
      requirement: InventoryMeasurementRequirement.Required,
    },
    independentAxes: [
      {
        axisId: "weight",
        role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("kg"),
        requirement: InventoryMeasurementRequirement.Required,
      },
    ],
    reservationAxisId: "weight",
    tracking: {
      lot: InventoryTrackingRequirement.Forbidden,
      serial: InventoryTrackingRequirement.Forbidden,
    },
    qualifiedDimensions: [],
  });
  return defineInventoryCatalog({
    itemRevisions: [item],
    activeItemRevisionIds: { "weight-item": "weight-item-v1" },
    packagingRevisions: [],
  });
}

describe("reservation consumption through an existing shortage", () => {
  it("uses only one feasibility calculation for an ordinary feasible consume", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "consume-feasible:receive", occurredAt: time0,
      to: loosePosition("u1"), amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "c1", operationId: "consume-feasible:reserve",
      itemRevisionId: "item-a-v2", selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"), createdAt: time1,
    });
    await inventory.reservations.allocate({
      reservationId: "c1", operationId: "consume-feasible:allocate", occurredAt: time1,
      allocations: [{ position: { ...loosePosition("u1"), itemRevisionId: "item-a-v2" },
        quantity: parseQuantity("1", "piece") }],
    });
    // Count the real imported inspector, not a fake return or a wall-clock threshold.
    const inspector = vi.spyOn(reservationSemantics, "inspectInventoryReservationFeasibility");
    try {
      await inventory.reservations.consumeAllocated({
        reservationId: "c1", operationId: "consume-feasible:consume", occurredAt: time2,
      });
      expect(inspector).toHaveBeenCalledTimes(1);
    } finally {
      inspector.mockRestore();
    }
  });

  it("keeps distinct revision-scoped shortages separate for the same item and axis", async () => {
    const inventory = createTestInventory();
    // Each receipt must select its exact revision at the public command boundary.
    const revisions = ["item-a-v1", "item-a-v2"];
    for (const [index, revision] of revisions.entries()) {
      const location = `lost-${index}`;
      await inventory.stock.receive({
        operationId: `revision-group:receive:${index}`, occurredAt: time0,
        to: loosePosition(location), amount: stockAmount("1", "piece"),
        itemRevisionId: revision,
      });
      await inventory.reservations.reserve({
        reservationId: `short-${index}`, operationId: `revision-group:reserve:${index}`,
        itemRevisionId: revision,
        selector: { itemId: "item-a", itemRevisionIds: [revision], locationIds: [location] },
        requested: parseQuantity("1", "piece"), createdAt: time1,
      });
    }
    await inventory.stock.receive({
      operationId: "revision-group:receive:consume", occurredAt: time1,
      to: loosePosition("u2"), amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "consume", operationId: "revision-group:reserve:consume",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", itemRevisionIds: ["item-a-v2"], locationIds: ["u2"] },
      requested: parseQuantity("1", "piece"), createdAt: time1,
    });
    await inventory.reservations.allocate({
      reservationId: "consume", operationId: "revision-group:allocate", occurredAt: time1,
      allocations: [{ position: { ...loosePosition("u2"), itemRevisionId: "item-a-v2" },
        quantity: parseQuantity("1", "piece") }],
    });
    for (const [index, revision] of revisions.entries()) {
      await inventory.stock.scrap({
        operationId: `revision-group:loss:${index}`, occurredAt: time2,
        from: loosePosition(`lost-${index}`), itemRevisionId: revision,
        amount: stockAmount("1", "piece"), reason: "Physical loss in this revision scope.",
      });
    }
    await inventory.reservations.consumeAllocated({
      reservationId: "consume", operationId: "revision-group:consume", occurredAt: time2,
    });
    const report = await inventory.read.reservationFeasibility(time2);
    expect(report.groups).toHaveLength(2);
    expect(report.groups.map((group) => ({ ids: group.reservationIds, shortage: group.shortage })))
      .toEqual([
        { ids: ["short-0"], shortage: parseQuantity("1", "piece") },
        { ids: ["short-1"], shortage: parseQuantity("1", "piece") },
      ]);
  });

  it("accepts all three distinct Consume32 survivor shapes and freezes retry intent", async () => {
    const shapes: readonly ConsumeShortageShape[] = [
      "allocated-lost-token",
      "unallocated-out-of-scope",
      "unallocated-contending",
    ];
    for (const shape of shapes) {
      const { inventory } = await createConsumeShortageFixture(shape);
      const command = {
        reservationId: "c2",
        operationId: `consume-shortage:${shape}:consume:c2`,
        occurredAt: time1,
      };
      const consumed = await inventory.reservations.consumeAllocated(command);
      const after = await inventory.read.world();

      expect(consumed).toMatchObject({
        replayed: false,
        reservation: {
          reservationId: "c2",
          status: InventoryReservationStatus.Consumed,
        },
        event: { kind: InventoryEventKind.Issue },
      });
      expect(consumed.event?.stockEffects).toHaveLength(1);
      expect(consumed.event?.stockEffects[0]).toMatchObject({
        measurementsDelta: { primary: { quantity: { amountMinor: -1 } } },
        metadata: { reservationId: "c2" },
      });
      expect(
        (await inventory.read.reservationFeasibility(time1)).groups[0]
      ).toMatchObject({
        reservationIds: ["c1"],
        shortage: { amountMinor: 1, unit: "piece" },
      });

      const replayed = await inventory.reservations.consumeAllocated(command);
      expect(replayed).toEqual({ ...consumed, replayed: true });
      expect(await inventory.read.world()).toEqual(after);
      await expect(
        inventory.reservations.consumeAllocated({
          ...command,
          occurredAt: time2,
        })
      ).rejects.toThrow("retried with changed intent");
    }
  });

  it("atomically consumes every line of a multi-position allocation without worsening shortage", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "consume-shortage:many:receive",
      occurredAt: time0,
      lines: ["u1", "u2", "u3"].map(
        /** Give every formal token one exact piece. */
        (locationId) => ({
          to: loosePosition(locationId),
          amount: stockAmount("1", "piece"),
        })
      ),
    });
    await inventory.reservations.reserve({
      reservationId: "c1",
      operationId: "consume-shortage:many:reserve:c1",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", locationIds: ["u1"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "c2",
      operationId: "consume-shortage:many:reserve:c2",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", locationIds: ["u2", "u3"] },
      requested: parseQuantity("2", "piece"),
      createdAt: time1,
    });
    await inventory.reservations.allocate({
      reservationId: "c2",
      operationId: "consume-shortage:many:allocate:c2",
      occurredAt: time1,
      allocations: ["u2", "u3"].map(
        /** Bind each half of c2's exact request to one token. */
        (locationId) => ({
          position: {
            ...loosePosition(locationId),
            itemRevisionId: "item-a-v2",
          },
          quantity: parseQuantity("1", "piece"),
        })
      ),
    });
    await inventory.stock.scrap({
      operationId: "consume-shortage:many:loss:u1",
      occurredAt: time2,
      from: loosePosition("u1"),
      amount: stockAmount("1", "piece"),
      reason: "The only stock eligible for c1 was lost.",
    });

    const consumed = await inventory.reservations.consumeAllocated({
      reservationId: "c2",
      operationId: "consume-shortage:many:consume:c2",
      occurredAt: time2,
    });

    expect(consumed.event?.stockEffects).toHaveLength(2);
    expect(
      (await inventory.read.reservationFeasibility(time2)).groups[0]
    ).toMatchObject({ reservationIds: ["c1"], shortage: { amountMinor: 1 } });
  });

  it("uses exact independent reservation-axis quantities in the same closure rule", async () => {
    const catalog = createWeightReservationCatalog();
    const inventory = createTestInventory(undefined, catalog);
    /** Build one exact loose position for the independent-axis fixture. */
    const position = (locationId: string) => ({
      itemId: "weight-item",
      itemRevisionId: "weight-item-v1",
      locationId,
    });
    const amount = measuredStockAmount("1", "piece", [
      { axisId: "weight", value: "1.25", unit: "kg" },
    ]);
    await inventory.stock.receiveMany({
      operationId: "consume-shortage:weight:receive",
      occurredAt: time0,
      lines: [
        { to: position("u1"), amount },
        { to: position("u2"), amount },
      ],
    });
    const claims: readonly ("c1" | "c2")[] = ["c1", "c2"];
    for (const claim of claims) {
      const locationId = claim === "c1" ? "u1" : "u2";
      await inventory.reservations.reserve({
        reservationId: claim,
        operationId: `consume-shortage:weight:reserve:${claim}`,
        itemRevisionId: "weight-item-v1",
        selector: { itemId: "weight-item", locationIds: [locationId] },
        requested: parseQuantity("1.25", "kg"),
        createdAt: time1,
      });
      await inventory.reservations.allocate({
        reservationId: claim,
        operationId: `consume-shortage:weight:allocate:${claim}`,
        occurredAt: time1,
        allocations: [
          { position: position(locationId), quantity: parseQuantity("1.25", "kg") },
        ],
      });
    }
    await inventory.stock.scrap({
      operationId: "consume-shortage:weight:loss:u1",
      occurredAt: time2,
      from: position("u1"),
      amount,
      reason: "The independently measured u1 stock was lost.",
    });

    const consumed = await inventory.reservations.consume({
      reservationId: "c2",
      operationId: "consume-shortage:weight:consume:c2",
      occurredAt: time2,
      fulfillment: [{ from: position("u2"), amount }],
    });

    expect(consumed.event?.stockEffects[0]?.measurementsDelta.independent[0])
      .toMatchObject({
        axisId: "weight",
        quantity: { amountMinor: -125, decimals: 2, unit: "kg" },
      });
    expect(
      (await inventory.read.reservationFeasibility(time2)).groups[0]?.shortage
    ).toMatchObject({ amountMinor: 125, decimals: 2, unit: "kg" });
  });

  it("rejects backdated consumption when record-time expiry makes surviving shortage worse", async () => {
    const { inventory, storage } = await createConsumeShortageFixture(
      "unallocated-contending",
      time2
    );
    const before = await inventory.read.world();
    expect(
      (await inventory.read.reservationFeasibility(time3)).status
    ).toBe(InventoryReservationFeasibilityStatus.Feasible);

    await expect(
      inventory.reservations.consumeAllocated({
        reservationId: "c2",
        operationId: "consume-shortage:expired-at-record-time",
        occurredAt: time1,
      })
    ).rejects.toThrow("cannot all be fulfilled simultaneously");

    expect(await inventory.read.world()).toEqual(before);
    expect(
      await storage.readOperation("consume-shortage:expired-at-record-time")
    ).toBeUndefined();
  });

  it("rejects a Consume delta whose claimed event is not its same-operation Issue", async () => {
    const { inventory, storage, catalog } =
      await createConsumeShortageFixture("unallocated-out-of-scope");
    const before = await inventory.read.world();
    const operationId = "consume-shortage:forged-event-link";

    await expect(
      commitInventoryOperation({
        catalog,
        storage,
        operationId,
        intentFingerprint: "consume-shortage:forged-event-link:v1",
        clock: { now: () => time3 },
        deficitPolicy: InventoryDeficitPolicy.Reject,
        /** Pair one real Issue with a Consume row that names another event. */
        plan: ({ world }) => ({
          event: createInventoryIssueEvent({
            catalog,
            operationId,
            occurredAt: time2,
            from: loosePosition("u2"),
            amount: stockAmount("1", "piece"),
            metadata: { reservationId: "c2" },
          }),
          reservationResult: markInventoryReservationConsumed({
            book: world.reservations,
            operationId,
            reservationId: "c2",
            consumptionEventId: "different-consumption-event",
            occurredAt: time2,
          }),
          reservationId: "c2",
        }),
      })
    ).rejects.toThrow("exact same-operation Issue event");

    expect(await inventory.read.world()).toEqual(before);
    expect(await storage.readOperation(operationId)).toBeUndefined();
  });

  it("accepts a Consume lifecycle snapshot with equivalent reservation key order", async () => {
    const { storage, catalog } =
      await createConsumeShortageFixture("unallocated-out-of-scope");
    const operationId = "consume-shortage:reordered-reservation-after";

    await expect(
      commitInventoryOperation({
        catalog,
        storage,
        operationId,
        intentFingerprint: "consume-shortage:reordered-reservation-after:v1",
        clock: { now: () => time3 },
        deficitPolicy: InventoryDeficitPolicy.Reject,
        /** Materialize the retained lifecycle snapshot independently with reversed field insertion order. */
        plan: ({ world }) => {
          const allocated = world.reservations.reservations.c2?.allocations[0];
          if (allocated === undefined) {
            throw new Error("Reordered lifecycle fixture lost its frozen allocation.");
          }
          const issue = createInventoryIssueEvent({
            catalog,
            operationId,
            occurredAt: time2,
            from: allocated.position,
            amount: stockAmount("1", "piece"),
            metadata: { reservationId: "c2" },
          });
          const event = {
            ...issue,
            stockEffects: issue.stockEffects.map((effect) => ({
              ...effect,
              metadata: { reservationId: "c2" },
            })),
          };
          const consumed = markInventoryReservationConsumed({
            book: world.reservations,
            operationId,
            reservationId: "c2",
            consumptionEventId: inventoryEventIdForOperation(operationId),
            occurredAt: time2,
          });
          const operation = consumed.book.operations[operationId];
          if (operation === undefined) {
            throw new Error("Reordered lifecycle fixture lost its Consume operation.");
          }
          const retained = operation.reservationAfter;
          const reservationAfter = {
            ...(retained.consumptionEventId === undefined
              ? {}
              : { consumptionEventId: retained.consumptionEventId }),
            lastChangedAt: retained.lastChangedAt,
            ...(retained.statusAt === undefined ? {} : { statusAt: retained.statusAt }),
            allocations: retained.allocations,
            status: retained.status,
            ...(retained.metadata === undefined ? {} : { metadata: retained.metadata }),
            ...(retained.actorId === undefined ? {} : { actorId: retained.actorId }),
            ...(retained.sourceReference === undefined
              ? {}
              : { sourceReference: retained.sourceReference }),
            ...(retained.allowExpiredStock === undefined
              ? {}
              : { allowExpiredStock: retained.allowExpiredStock }),
            ...(retained.expiresAt === undefined ? {} : { expiresAt: retained.expiresAt }),
            createdAt: retained.createdAt,
            requested: retained.requested,
            selector: retained.selector,
            itemRevisionId: retained.itemRevisionId,
            operationId: retained.operationId,
            reservationId: retained.reservationId,
          };
          return {
            event,
            reservationResult: {
              ...consumed,
              book: {
                ...consumed.book,
                operations: {
                  ...consumed.book.operations,
                  [operationId]: { ...operation, reservationAfter },
                },
              },
            },
            reservationId: "c2",
          };
        },
      })
    ).resolves.toMatchObject({ replayed: false });
  });

  it("rejects a Consume operation whose retained reservationAfter differs from its row", async () => {
    const { inventory, storage, catalog } =
      await createConsumeShortageFixture("unallocated-out-of-scope");
    const before = await inventory.read.world();
    const operationId = "consume-shortage:forged-reservation-after";

    await expect(
      commitInventoryOperation({
        catalog,
        storage,
        operationId,
        intentFingerprint: "consume-shortage:forged-reservation-after:v1",
        clock: { now: () => time3 },
        deficitPolicy: InventoryDeficitPolicy.Reject,
        /** Preserve the visible row while corrupting its append-only lifecycle snapshot. */
        plan: ({ world }) => {
          const event = createInventoryIssueEvent({
            catalog,
            operationId,
            occurredAt: time2,
            from: loosePosition("u2"),
            amount: stockAmount("1", "piece"),
            metadata: { reservationId: "c2" },
          });
          const consumed = markInventoryReservationConsumed({
            book: world.reservations,
            operationId,
            reservationId: "c2",
            consumptionEventId: inventoryEventIdForOperation(operationId),
            occurredAt: time2,
          });
          const operation = consumed.book.operations[operationId];
          if (operation === undefined) {
            throw new Error("Forged lifecycle fixture lost its Consume operation.");
          }
          return {
            event,
            reservationResult: {
              ...consumed,
              book: {
                ...consumed.book,
                operations: {
                  ...consumed.book.operations,
                  [operationId]: {
                    ...operation,
                    reservationAfter: {
                      ...operation.reservationAfter,
                      lastChangedAt: time1,
                    },
                  },
                },
              },
            },
            reservationId: "c2",
          };
        },
      })
    ).rejects.toThrow("exact lifecycle evidence");

    expect(await inventory.read.world()).toEqual(before);
    expect(await storage.readOperation(operationId)).toBeUndefined();
  });
});
