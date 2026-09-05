import { describe, expect, it } from "vitest";
import {
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryReservationFeasibilityStatus,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  packageAmount,
  parseQuantity,
  stockAmount,
  unitCode,
  type InventoryMetadataValue,
} from "../src/index.js";
import {
  InventoryDeficitPolicy,
  defineScalarInventoryItem,
  inventoryIntentFingerprint,
  inventoryStockPositionIdentity,
  normalizeInventoryStockPositionKey,
  projectInventoryEvents,
  refineInventoryReservation,
} from "../src/kernel.js";
import { applyInventoryRecordedDeficitBurden } from "../src/deficits.js";
import { createInventoryReservationBookDelta } from "../src/integrity.js";
import {
  InventoryStorageWriteStage,
  createInMemoryInventoryDurableStorage,
  type InventoryDurableStorage,
} from "../src/storage-api.js";
import {
  createTabletCatalog,
  createTestInventory,
  clockAt,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

describe("collision-free retry identity", () => {
  it("canonicalizes an empty qualified-dimension set to the same position identity as omission", () => {
    const base = {
      itemId: "item-a",
      itemRevisionId: "item-a-v2",
      locationId: "store",
    };
    const withEmptyDimensions = { ...base, qualifiedDimensions: [] };
    expect(normalizeInventoryStockPositionKey(withEmptyDimensions)).toEqual(base);
    expect(inventoryStockPositionIdentity(withEmptyDimensions)).toBe(
      inventoryStockPositionIdentity(base)
    );
  });

  it("floors recorded-deficit capacity to exact BigInt allocation increments", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      undefined,
      InventoryDeficitPolicy.Record
    );
    await inventory.stock.issue({
      operationId: "bigint-deficit-floor",
      occurredAt: time0,
      from: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    const position = {
      ...loosePosition("store", { lotId: "BIGINT-FLOOR" }),
      itemRevisionId: "item-a-v2",
    };
    const adjusted = applyInventoryRecordedDeficitBurden({
      projection: (await inventory.read.world()).projection,
      itemRevisionId: "item-a-v2",
      axisId: "pieces",
      unit: unitCode("piece"),
      locationIds: ["store"],
      lines: [
        {
          position,
          capacity: parseQuantity("6", "piece"),
          allocationIncrement: parseQuantity("2", "piece"),
        },
      ],
    });
    expect(
      adjusted.capacityByPositionIdentity.get(
        inventoryStockPositionIdentity(position)
      )?.amountMinor
    ).toBe(4);
    expect(adjusted.uncoveredDeficit.amountMinor).toBe(0);
  });
  it("rejects storage mutation re-entry from an async failpoint instead of deadlocking", async () => {
    let storage: InventoryDurableStorage | undefined;
    let attemptedReentry = false;
    storage = createInMemoryInventoryDurableStorage({
      failpoint: async ({ stage, timing }) => {
        if (
          attemptedReentry ||
          stage !== InventoryStorageWriteStage.Begin ||
          timing !== "before"
        ) {
          return;
        }
        attemptedReentry = true;
        await Promise.resolve();
        if (storage === undefined) throw new Error("Missing failpoint storage.");
        await storage.abort("nested-failpoint-mutation");
      },
    });
    const inventory = createTestInventory(storage);
    await expect(
      inventory.stock.receive({
        operationId: "failpoint-reentry",
        occurredAt: time0,
        to: loosePosition("store"),
        amount: stockAmount("1", "piece"),
      })
    ).rejects.toThrow(
      "Inventory storage failpoint callbacks must not invoke storage mutations."
    );
    expect(attemptedReentry).toBe(true);
    expect((await storage.readWorld()).revision).toBe(0);
  });

  it("keeps delimiter, empty, and null field boundaries distinct", () => {
    expect(inventoryIntentFingerprint(["actor|", "source"]))
      .not.toBe(inventoryIntentFingerprint(["actor", "|source"]));
    expect(inventoryIntentFingerprint(["axis:", "unit"]))
      .not.toBe(inventoryIntentFingerprint(["axis", ":unit"]));
    expect(inventoryIntentFingerprint(["reason", ""]))
      .not.toBe(inventoryIntentFingerprint(["reason", null]));
  });

  it("rejects delimiter-shifted header identities before another world revision is planned", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "delimiter-retry",
      occurredAt: time0,
      actorId: "actor|",
      sourcePartyId: "source",
      destinationPartyId: "destination",
      sourceReference: "fixed-source",
      reason: "fixed-reason",
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });

    await expect(inventory.stock.receive({
      operationId: "delimiter-retry",
      occurredAt: time0,
      actorId: "actor",
      sourcePartyId: "|source",
      destinationPartyId: "destination",
      sourceReference: "fixed-source",
      reason: "fixed-reason",
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    })).rejects.toThrow("changed intent");
    expect((await storage.readWorld()).revision).toBe(1);
  });

  it("rejects delimiter-shifted reservation source and actor identities", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage);
    await inventory.stock.receive({
      operationId: "retry-reservation-stock",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim|one",
      operationId: "delimiter-reservation",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
      sourceReference: "source|",
      actorId: "actor",
    });
    await expect(inventory.reservations.reserve({
      reservationId: "claim|one",
      operationId: "delimiter-reservation",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
      sourceReference: "source",
      actorId: "|actor",
    })).rejects.toThrow("changed intent");
    expect((await storage.readWorld()).revision).toBe(2);
  });
});

describe("durable planner output guards", () => {
  it("rejects a lifecycle planner that changes the frozen expired-stock rule", async () => {
    const catalog = createTabletCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({
      operationId: "receive-for-planner-guard",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("2", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "planner-guard-claim",
      operationId: "create-planner-guard-claim",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    const world = await inventory.read.world();
    const refined = refineInventoryReservation({
      catalog,
      projection: world.projection,
      book: world.reservations,
      operationId: "malicious-refine-output",
      reservationId: "planner-guard-claim",
      selector: { itemId: "item-a", locationIds: ["store"] },
      occurredAt: time2,
    });
    /** Fake planner row that changes a creation-time rule during a later lifecycle action. */
    const changedReservation = {
      ...refined.reservation,
      allowExpiredStock: true,
    };
    /** Fake planner book retaining the real operation evidence but swapping its current row. */
    const changedBook = {
      reservations: {
        ...refined.book.reservations,
        [changedReservation.reservationId]: changedReservation,
      },
      operations: refined.book.operations,
    };
    expect(() => createInventoryReservationBookDelta(
      world.reservations,
      changedBook,
      "malicious-refine-output",
      "planner-guard-claim",
    )).toThrow("changed frozen creation facts");
  });
});

describe("package and serial reservation granularity", () => {
  it("does not call one loose piece feasible when only one intact box-20 exists", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-intact-box",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: packageAmount(1, "item-a-box-20-v1"),
    });
    await expect(inventory.reservations.reserve({
      reservationId: "claim-one-from-box",
      operationId: "reserve-one-from-box",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    })).rejects.toThrow("cannot all be fulfilled");
    expect((await inventory.read.reservationFeasibility()).status).toBe(
      InventoryReservationFeasibilityStatus.Feasible,
    );
  });

  it("accepts and consumes one whole package allocation but rejects a partial package binding", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-whole-box",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: packageAmount(1, "item-a-box-20-v1"),
    });
    await inventory.stock.receive({
      operationId: "receive-one-loose-beside-box",
      occurredAt: time0,
      to: loosePosition("loose-store"),
      itemRevisionId: "item-a-v1",
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "claim-whole-box",
      operationId: "reserve-whole-box",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("20", "piece"),
      createdAt: time1,
    });
    const position = (await inventory.read.positions({
      itemId: "item-a",
      packagingRevisionIds: ["item-a-box-20-v1"],
    }))[0];
    const loose = (await inventory.read.positions({
      itemId: "item-a",
      locationIds: ["loose-store"],
    }))[0];
    if (position === undefined || loose === undefined) {
      throw new Error("Expected intact and loose package-allocation stock.");
    }
    await expect(inventory.reservations.allocate({
      operationId: "allocate-part-box",
      reservationId: "claim-whole-box",
      occurredAt: time1,
      allocations: [
        { position: position.key, quantity: parseQuantity("19", "piece") },
        { position: loose.key, quantity: parseQuantity("1", "piece") },
      ],
    })).rejects.toThrow("whole number of exact packages");
    await inventory.reservations.allocate({
      operationId: "allocate-whole-box",
      reservationId: "claim-whole-box",
      occurredAt: time1,
      allocations: [{ position: position.key, quantity: parseQuantity("20", "piece") }],
    });
    await inventory.reservations.consume({
      operationId: "consume-whole-box",
      reservationId: "claim-whole-box",
      occurredAt: time2,
      fulfillment: [{
        from: position.key,
        amount: packageAmount(1, "item-a-box-20-v1"),
      }],
    });
    expect(await inventory.read.positions({
      itemId: "item-a",
      packagingRevisionIds: ["item-a-box-20-v1"],
    })).toEqual([]);
  });

  it("lets only one competing claim own one package and blocks unpacking its exact allocation", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-competing-box",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: packageAmount(1, "item-a-box-20-v1"),
    });
    await inventory.reservations.reserve({
      reservationId: "first-box-claim",
      operationId: "reserve-first-box",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("20", "piece"),
      createdAt: time1,
    });
    await expect(inventory.reservations.reserve({
      reservationId: "second-box-claim",
      operationId: "reserve-second-box",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("20", "piece"),
      createdAt: time1,
    })).rejects.toThrow("cannot all be fulfilled");
    const position = (await inventory.read.positions({
      itemId: "item-a",
      packagingRevisionIds: ["item-a-box-20-v1"],
    }))[0];
    if (position === undefined) throw new Error("Expected competing package stock.");
    await inventory.reservations.allocate({
      operationId: "allocate-first-box",
      reservationId: "first-box-claim",
      occurredAt: time2,
      allocations: [{ position: position.key, quantity: parseQuantity("20", "piece") }],
    });
    await expect(inventory.stock.unpack({
      operationId: "unpack-allocated-box",
      occurredAt: time2,
      from: position.key,
      packageCount: 1,
    })).rejects.toThrow("cannot all be fulfilled");
  });

  it("defines one serial identity as exactly one primary resource", async () => {
    const inventory = createTestInventory();
    await expect(inventory.stock.receive({
      operationId: "receive-bad-serial",
      occurredAt: time0,
      to: loosePosition("store", { serialId: "serial-one" }),
      amount: stockAmount("2", "piece"),
    })).rejects.toThrow("exactly one primary resource");
    await inventory.stock.receive({
      operationId: "receive-one-serial",
      occurredAt: time0,
      to: loosePosition("store", { serialId: "serial-one" }),
      amount: stockAmount("1", "piece"),
    });
    await expect(inventory.reservations.reserve({
      reservationId: "half-serial",
      operationId: "reserve-half-serial",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", serialIds: ["serial-one"] },
      requested: parseQuantity("0.5", "piece"),
      createdAt: time1,
    })).rejects.toThrow("cannot all be fulfilled");
    await inventory.reservations.reserve({
      reservationId: "whole-serial",
      operationId: "reserve-whole-serial",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a", serialIds: ["serial-one"] },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    const serialPosition = (await inventory.read.positions({
      itemId: "item-a",
      serialIds: ["serial-one"],
    }))[0];
    if (serialPosition === undefined) throw new Error("Expected whole serial stock.");
    await inventory.reservations.allocate({
      operationId: "allocate-whole-serial",
      reservationId: "whole-serial",
      occurredAt: time1,
      allocations: [{ position: serialPosition.key, quantity: parseQuantity("1", "piece") }],
    });
    await inventory.reservations.consume({
      operationId: "consume-whole-serial",
      reservationId: "whole-serial",
      occurredAt: time2,
      fulfillment: [{ from: serialPosition.key, amount: stockAmount("1", "piece") }],
    });
    expect(await inventory.read.positions({ itemId: "item-a" })).toEqual([]);
  });

  it("handles an exact row containing well over twenty intact packages without expanding slots", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-many-boxes",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: packageAmount(50_000, "item-a-box-20-v1"),
    });
    await inventory.reservations.reserve({
      reservationId: "many-box-scope",
      operationId: "reserve-many-box-scope",
      itemRevisionId: "item-a-v1",
      selector: {
        itemId: "item-a",
        itemRevisionIds: ["item-a-v1"],
        locationIds: ["store"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      },
      requested: parseQuantity("1000", "piece"),
      createdAt: time1,
    });
    const availability = await inventory.read.availability({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
      locationIds: ["store"],
      packagingRevisionIds: ["item-a-box-20-v1"],
    });
    expect(availability.reservationFeasibility.status).toBe(
      InventoryReservationFeasibilityStatus.Feasible,
    );
    expect(availability.reservationFeasibility.groups[0]?.fulfillable.amountMinor)
      .toBe(1000);
  });

  it("solves competing broad package claims well above twenty pieces exactly", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receiveMany({
      operationId: "receive-competing-many-boxes",
      occurredAt: time0,
      lines: [
        {
          to: loosePosition("store-a"),
          amount: packageAmount(40, "item-a-box-20-v1"),
        },
        {
          to: loosePosition("store-b"),
          amount: packageAmount(35, "item-a-box-20-v1"),
        },
      ],
    });
    await inventory.reservations.reserve({
      reservationId: "store-a-package-claim",
      operationId: "reserve-store-a-packages",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a", locationIds: ["store-a"] },
      requested: parseQuantity("600", "piece"),
      createdAt: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "broad-package-claim",
      operationId: "reserve-broad-packages",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("900", "piece"),
      createdAt: time1,
    });
    const feasible = await inventory.read.reservationFeasibility();
    expect(feasible.status).toBe(InventoryReservationFeasibilityStatus.Feasible);
    expect(feasible.groups[0]).toMatchObject({
      reservationIds: ["broad-package-claim", "store-a-package-claim"],
      requested: { amountMinor: 1500, unit: "piece" },
      fulfillable: { amountMinor: 1500, unit: "piece" },
      shortage: { amountMinor: 0, unit: "piece" },
    });
    await expect(inventory.reservations.reserve({
      reservationId: "one-package-too-many",
      operationId: "reserve-one-package-too-many",
      itemRevisionId: "item-a-v1",
      selector: { itemId: "item-a" },
      requested: parseQuantity("20", "piece"),
      createdAt: time1,
    })).rejects.toThrow("cannot all be fulfilled");
  });
});

describe("historical reservation authority and one-revision counts", () => {
  it("rejects a physical event dated after its durable record time", async () => {
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage,
      clock: clockAt(time1),
    });
    await expect(inventory.stock.receive({
      operationId: "future-physical-receipt",
      occurredAt: time2,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    })).rejects.toThrow("after its durable recordedAt time");
    expect(await storage.readOperation("future-physical-receipt")).toBeUndefined();
  });

  it("rejects a reservation created after its durable record time", async () => {
    const inventory = createInventoryOnce({
      catalog: createTabletCatalog(),
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time1),
    });
    await expect(inventory.reservations.reserve({
      reservationId: "future-created-claim",
      operationId: "future-created-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time2,
    })).rejects.toThrow("after its durable record time");
  });

  it("rejects out-of-order lifecycle facts and uses creation/terminal intervals", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "historical-stock",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "historical-claim",
      operationId: "historical-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
    });
    await expect(inventory.reservations.refine({
      operationId: "refine-before-create",
      reservationId: "historical-claim",
      selector: { itemId: "item-a", locationIds: ["store"] },
      occurredAt: time0,
    })).rejects.toThrow("before creation");
    await inventory.reservations.release({
      operationId: "historical-release",
      reservationId: "historical-claim",
      occurredAt: time2,
    });
    expect((await inventory.read.reservationFeasibility(time0)).groups).toEqual([]);
    expect((await inventory.read.reservationFeasibility(time1)).groups[0]?.reservationIds)
      .toEqual(["historical-claim"]);
    expect((await inventory.read.reservationFeasibility(time2)).groups).toEqual([]);
    expect((await inventory.read.reservationFeasibility()).groups).toEqual([]);
    await expect(inventory.reservations.refine({
      operationId: "backdated-refine",
      reservationId: "historical-claim",
      selector: { itemId: "item-a", locationIds: ["store"] },
      occurredAt: time1,
    })).rejects.toThrow("no longer active");
  });

  it("stops an otherwise active claim at its declared expiry boundary", async () => {
    const inventory = createTestInventory(
      undefined,
      undefined,
      clockAt(time1),
    );
    await inventory.stock.receive({
      operationId: "expiry-stock",
      occurredAt: time0,
      to: loosePosition("store"),
      amount: stockAmount("1", "piece"),
    });
    await inventory.reservations.reserve({
      reservationId: "expiring-claim",
      operationId: "expiring-reserve",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAt: time1,
      expiresAt: time2,
    });
    expect((await inventory.read.reservationFeasibility(time1)).groups[0]?.reservationIds)
      .toEqual(["expiring-claim"]);
    expect((await inventory.read.reservationFeasibility(time2)).groups).toEqual([]);
  });

  it("narrows item-wide counts to one frozen revision and rejects earlier lifecycle times", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "count-old-revision",
      occurredAt: time0,
      to: loosePosition("store"),
      itemRevisionId: "item-a-v1",
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "count-current-revision",
      occurredAt: time0,
      to: loosePosition("store"),
      itemRevisionId: "item-a-v2",
      amount: stockAmount("1", "piece"),
    });
    const started = await inventory.counts.start({
      countId: "one-revision-count",
      operationId: "one-revision-count-start",
      selector: { itemId: "item-a" },
      startedAt: time1,
    });
    expect(started.count.selector.itemRevisionIds).toEqual(["item-a-v2"]);
    const oldPosition = (await inventory.read.positions({
      itemId: "item-a",
      itemRevisionIds: ["item-a-v1"],
    }))[0];
    if (oldPosition === undefined) throw new Error("Expected old revision stock.");
    await expect(inventory.counts.observe({
      operationId: "observe-old-row",
      countId: "one-revision-count",
      observedAt: time2,
      observations: [{ position: oldPosition.key, measurements: oldPosition.measurements }],
    })).rejects.toThrow("outside the declared selector");
    await expect(inventory.counts.observe({
      operationId: "observe-before-start",
      countId: "one-revision-count",
      observedAt: time0,
      observations: [],
    })).rejects.toThrow("before the count started");
    await inventory.counts.observe({
      operationId: "observe-current-revision",
      countId: "one-revision-count",
      observedAt: time2,
      observations: [],
    });
    await expect(inventory.counts.reconcile({
      operationId: "complete-before-observation",
      countId: "one-revision-count",
      completedAt: time1,
      reason: "Invalid earlier completion.",
    })).rejects.toThrow("before the observation");
  });

  it("does not mix retained revisions with different measurement schemas in one count", async () => {
    const pieceV1 = defineScalarInventoryItem({
      itemId: "mixed-item",
      revisionId: "mixed-item-piece-v1",
      axisId: "pieces",
      unit: "piece",
    });
    const volumeV2 = defineScalarInventoryItem({
      itemId: "mixed-item",
      revisionId: "mixed-item-volume-v2",
      axisId: "volume",
      unit: "mL",
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [pieceV1, volumeV2],
      activeItemRevisionIds: { "mixed-item": volumeV2.revisionId },
      packagingRevisions: [],
    });
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receive({
      operationId: "receive-mixed-old-piece",
      occurredAt: time0,
      to: { itemId: "mixed-item", locationId: "store" },
      itemRevisionId: pieceV1.revisionId,
      amount: stockAmount("1", "piece"),
    });
    await inventory.stock.receive({
      operationId: "receive-mixed-current-volume",
      occurredAt: time0,
      to: { itemId: "mixed-item", locationId: "store" },
      itemRevisionId: volumeV2.revisionId,
      amount: stockAmount("10", "mL"),
    });
    const started = await inventory.counts.start({
      countId: "mixed-schema-count",
      operationId: "mixed-schema-count-start",
      selector: { itemId: "mixed-item" },
      startedAt: time1,
    });
    expect(started.count.selector.itemRevisionIds).toEqual([volumeV2.revisionId]);
    const oldPosition = (await inventory.read.positions({
      itemId: "mixed-item",
      itemRevisionIds: [pieceV1.revisionId],
    }))[0];
    if (oldPosition === undefined) throw new Error("Expected retained piece revision stock.");
    await expect(inventory.counts.observe({
      operationId: "observe-mixed-old-piece",
      countId: "mixed-schema-count",
      observedAt: time2,
      observations: [{ position: oldPosition.key, measurements: oldPosition.measurements }],
    })).rejects.toThrow("outside the declared selector");
  });
});

describe("retained catalogue alias safety", () => {
  it("deep-copies and freezes caller-owned revision/package values before event replay", async () => {
    const primaryAxis = {
      axisId: "pieces",
      role: InventoryMeasurementAxisRole.Primary,
      unit: unitCode("piece"),
      requirement: InventoryMeasurementRequirement.Required,
    };
    const independentAxes: {
      axisId: string;
      role: InventoryMeasurementAxisRole;
      unit: ReturnType<typeof unitCode>;
      requirement: InventoryMeasurementRequirement;
    }[] = [];
    const tracking = {
      lot: InventoryTrackingRequirement.Optional,
      serial: InventoryTrackingRequirement.Optional,
    };
    const qualifiedDimensions = [{ dimensionId: "grade", description: "Grade." }];
    const itemIdentifiers: Record<string, string> = { sku: "sku-one" };
    const itemMetadataTags: InventoryMetadataValue[] = ["original"];
    const itemMetadata = { tags: itemMetadataTags };
    const fixedPrimaryQuantity = {
      amountMinor: 20,
      decimals: 0,
      unit: unitCode("piece"),
    };
    const fixedIndependent: never[] = [];
    const innerPackage = { packagingRevisionId: "inner-one", count: 2 };
    const packageIdentifiers: Record<string, string> = { gtin: "gtin-one" };
    const packageMetadataTags: InventoryMetadataValue[] = ["sealed"];
    const catalog = defineInventoryCatalog({
      itemRevisions: [{
        itemId: "alias-item",
        revisionId: "alias-item-v1",
        primaryAxis,
        independentAxes,
        reservationAxisId: "pieces",
        tracking,
        qualifiedDimensions,
        identifiers: itemIdentifiers,
        metadata: itemMetadata,
      }],
      activeItemRevisionIds: { "alias-item": "alias-item-v1" },
      packagingRevisions: [{
        revisionId: "alias-box-v1",
        itemId: "alias-item",
        itemRevisionId: "alias-item-v1",
        packageUnit: unitCode("box"),
        fixedContents: {
          primary: { axisId: "pieces", quantity: fixedPrimaryQuantity },
          independent: fixedIndependent,
        },
        innerPackage,
        identifiers: packageIdentifiers,
        metadata: { tags: packageMetadataTags },
      }, {
        revisionId: "inner-one",
        itemId: "alias-item",
        itemRevisionId: "alias-item-v1",
        packageUnit: unitCode("inner"),
        fixedContents: {
          primary: {
            axisId: "pieces",
            quantity: { amountMinor: 10, decimals: 0, unit: unitCode("piece") },
          },
          independent: [],
        },
      }],
    });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createTestInventory(storage, catalog);
    const received = await inventory.stock.receive({
      operationId: "alias-receipt",
      occurredAt: time0,
      to: { itemId: "alias-item", locationId: "store" },
      amount: packageAmount(1, "alias-box-v1"),
    });

    primaryAxis.unit = unitCode("poison-piece");
    independentAxes.push({
      axisId: "poison-axis",
      role: InventoryMeasurementAxisRole.Independent,
      unit: unitCode("poison-unit"),
      requirement: InventoryMeasurementRequirement.Optional,
    });
    tracking.serial = InventoryTrackingRequirement.Required;
    qualifiedDimensions[0] = { dimensionId: "poison", description: "Poison." };
    itemIdentifiers.sku = "poison-sku";
    itemMetadataTags.push("poison");
    fixedPrimaryQuantity.amountMinor = 999;
    innerPackage.count = 99;
    packageIdentifiers.gtin = "poison-gtin";
    packageMetadataTags.push("poison");

    expect(catalog.itemRevision("alias-item-v1").primaryAxis.unit).toBe("piece");
    expect(catalog.itemRevision("alias-item-v1").independentAxes).toEqual([]);
    expect(catalog.itemRevision("alias-item-v1").metadata).toEqual({ tags: ["original"] });
    expect(catalog.itemRevision("alias-item-v1").tracking.serial).toBe(
      InventoryTrackingRequirement.Optional
    );
    expect(catalog.itemRevision("alias-item-v1").qualifiedDimensions).toEqual([
      { dimensionId: "grade", description: "Grade." },
    ]);
    expect(catalog.itemRevision("alias-item-v1").identifiers).toEqual({
      sku: "sku-one",
    });
    expect(catalog.packagingRevision("alias-box-v1").identifiers).toEqual({
      gtin: "gtin-one",
    });
    expect(catalog.packagingRevision("alias-box-v1").metadata).toEqual({
      tags: ["sealed"],
    });
    expect(catalog.packagingRevision("alias-box-v1").fixedContents.primary.quantity.amountMinor)
      .toBe(20);
    expect(catalog.packagingRevision("alias-box-v1").innerPackage?.count).toBe(2);
    expect(Object.isFrozen(catalog.packagingRevision("alias-box-v1").fixedContents.primary.quantity))
      .toBe(true);
    expect(Reflect.set(
      catalog.itemRevision("alias-item-v1").primaryAxis,
      "unit",
      unitCode("poison-piece"),
    )).toBe(false);
    expect(Reflect.set(
      catalog.packagingRevision("alias-box-v1").fixedContents.primary.quantity,
      "amountMinor",
      999,
    )).toBe(false);
    const replayed = projectInventoryEvents({
      catalog,
      events: [received.event],
      deficitPolicy: InventoryDeficitPolicy.Reject,
    });
    expect(Object.values(replayed.positions)[0]?.measurements.primary.quantity.amountMinor)
      .toBe(20);
  });
});
