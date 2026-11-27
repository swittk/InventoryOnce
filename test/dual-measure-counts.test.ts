import { assertAbstractInventoryInvariants } from "./formal-implementation-abstraction.js";
import { describe, expect, it } from "vitest";

import {
  InventoryDeficitPolicy,
  InventoryEventKind,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  compareQuantity,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineInventoryPackaging,
  inventoryMeasurement,
  inventoryMeasurementAt,
  inventoryMeasurementVector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  unitCode,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";

const occurredAtEpochMs = 1893456000000;
const itemId = "measured-count-item";
const itemRevisionId = "measured-count-item-v1";

/** Define the shared item with primary piece count and independent weight axes. */
function measuredItem() {
  return defineInventoryItem({
    itemId,
    revisionId: itemRevisionId,
    primaryAxis: {
      axisId: "pieces",
      role: InventoryMeasurementAxisRole.Primary,
      unit: unitCode("piece"),
      requirement: InventoryMeasurementRequirement.Required,
    },
    independentAxes: [{
      axisId: "weight",
      role: InventoryMeasurementAxisRole.Independent,
      unit: unitCode("kg"),
      requirement: InventoryMeasurementRequirement.Optional,
    }],
    reservationAxisId: "pieces",
    tracking: {
      lot: InventoryTrackingRequirement.Forbidden,
      serial: InventoryTrackingRequirement.Forbidden,
    },
    qualifiedDimensions: [],
  });
}

/** Build one normalized piece/weight measurement vector for count fixtures. */
function measuredVector(pieces: string, weight: string) {
  return inventoryMeasurementVector(
    { axisId: "pieces", quantity: parseQuantity(pieces, "piece") },
    [{ axisId: "weight", quantity: parseQuantity(weight, "kg") }],
  );
}

/** Create one in-memory InventoryOnce instance with the measured item and optional packaging. */
function inventoryFor(packagingRevisions: ReturnType<typeof defineInventoryPackaging>[] = []) {
  const item = measuredItem();
  const catalog = defineInventoryCatalog({
    itemRevisions: [item],
    activeItemRevisionIds: { [itemId]: itemRevisionId },
    packagingRevisions,
  });
  return createInventoryOnce({
    catalog,
    storage: createInMemoryInventoryDurableStorage(),
    clock: { nowEpochMs: () => occurredAtEpochMs },
  });
}

/** Create two public facades sharing current measured-item truth under different deficit policies. */
function measuredShortageFacades() {
  const catalog = defineInventoryCatalog({
    itemRevisions: [measuredItem()],
    activeItemRevisionIds: { [itemId]: itemRevisionId },
  });
  const storage = createInMemoryInventoryDurableStorage();
  const clock = { nowEpochMs: () => occurredAtEpochMs + 10_000 };
  return {
    recorder: createInventoryOnce({
      catalog, storage, clock, deficitPolicy: InventoryDeficitPolicy.Record,
    }),
    strict: createInventoryOnce({
      catalog, storage, clock, deficitPolicy: InventoryDeficitPolicy.Reject,
    }),
  };
}

/** One positive transaction amount with exact piece and independently measured weight. */
function measuredShortageAmount(pieces: string, weight: string) {
  return measuredStockAmount(pieces, "piece", [
    { axisId: "weight", value: weight, unit: "kg" },
  ]);
}

describe("historical shortages on independently measured stock", () => {
  it.each([
    ["before", 2, 3, "2", "34"],
    ["straddling", 2, 5, "1", "10"],
    ["after", 5, 6, "3", "33"],
    ["omitted", 2, 3, "3", "33"],
  ] as const)("counts only active repair assertions at the observation (%s)", async (mode, issueOffset, receiveOffset, pieces, weight) => {
    const { strict: inventory } = measuredShortageFacades();
    const position = { itemId, itemRevisionId, placementNodeId: "store" };
    const selector = { itemId, placementNodeIds: ["store"] };
    await inventory.stock.receive({
      operationId: "receive", occurredAtEpochMs, to: position, amount: measuredShortageAmount("3", "33"),
    });
    await inventory.counts.start({ operationId: "start", countId: "count", selector, startedAtEpochMs: occurredAtEpochMs });
    await inventory.counts.observe({
      operationId: "observe", countId: "count", observedAtEpochMs: occurredAtEpochMs + 4,
      observations: [{ position, measurements: measuredVector(pieces, weight) }],
    });
    await inventory.stock.recordHistorical({
      operationId: "late-repair", occurredAtEpochMs: occurredAtEpochMs + 7, reason: "Record late issue and receipt.",
      assertions: [
        { assertionId: "late-issue", assert: (plans) => plans.issue({
          occurredAtEpochMs: occurredAtEpochMs + issueOffset, from: position, amount: measuredShortageAmount("2", "23"),
        }) },
        { assertionId: "late-receipt", assert: (plans) => plans.receive({
          occurredAtEpochMs: occurredAtEpochMs + receiveOffset, to: position, amount: measuredShortageAmount("1", "24"),
        }) },
      ],
    });
    if (mode === "omitted") {
      await inventory.stock.recordHistorical({
        operationId: "omit-repair", occurredAtEpochMs: occurredAtEpochMs + 8, reason: "Remove both superseded assertions.",
        assertions: [], omittedAssertionIds: ["late-issue", "late-receipt"],
      });
    }
    const command = { operationId: "reconcile", countId: "count", completedAtEpochMs: occurredAtEpochMs + 9 };
    const result = await inventory.counts.reconcile(command);
    expect(result.event).toBeUndefined();
    expect((await inventory.counts.reconcile(command)).replayed).toBe(true);
    expect((await inventory.read.positions(selector)).map(({ measurements }) => measurements))
      .toEqual([mode === "omitted" ? measuredVector("3", "33") : measuredVector("2", "34")]);
  });

  it("rejects a historical correction deepening weight despite an unchanged piece peak", async () => {
    const { recorder, strict } = measuredShortageFacades();
    const position = { itemId, placementNodeId: "measured-historical-bin" };
    await recorder.stock.issue({
      operationId: "measured-old-issue",
      occurredAtEpochMs,
      from: position,
      amount: measuredShortageAmount("5", "5"),
    });
    const originalReceipt = await recorder.stock.receive({
      operationId: "measured-old-receipt",
      occurredAtEpochMs: occurredAtEpochMs + 1_000,
      to: position,
      amount: measuredShortageAmount("4", "4"),
    });
    await recorder.stock.issue({
      operationId: "measured-later-issue",
      occurredAtEpochMs: occurredAtEpochMs + 2_000,
      from: position,
      amount: measuredShortageAmount("2", "8.25"),
    });
    await recorder.stock.receive({
      operationId: "measured-settling-receipt",
      occurredAtEpochMs: occurredAtEpochMs + 3_000,
      to: position,
      amount: measuredShortageAmount("5", "10.25"),
    });

    const correction = {
      operationId: "measured-reduce-earlier-receipt",
      correctsEventId: originalReceipt.event.eventId,
      occurredAtEpochMs: occurredAtEpochMs + 4_000,
      reason: "Only three pieces and three kilograms were delivered.",
      replaceWith: (plans: Parameters<typeof strict.stock.planCorrection>[0]["replaceWith"] extends
        (plans: infer Plans) => unknown ? Plans : never) =>
        plans.receive({
          occurredAtEpochMs: occurredAtEpochMs + 1_000,
          to: position,
          amount: measuredShortageAmount("3", "3"),
        }),
    };
    // The old primary peak remains five pieces, but weight worsens from 9.25 to 10.25 kg.
    expect(await strict.stock.planCorrection(correction)).toMatchObject({
      valid: false,
      conflict: { code: "negative-stock" },
    });
    await expect(strict.stock.correct(correction)).rejects.toThrow("negative");

    const recordPlan = await recorder.stock.planCorrection({
      ...correction,
      operationId: "measured-record-worsened-weight",
    });
    expect(recordPlan.valid).toBe(true);
    if (!recordPlan.valid) throw new Error(recordPlan.conflict.message);
    expect(recordPlan.impact.deficits).toHaveLength(1);
    expect(recordPlan.impact.deficits[0]?.maximumDeficit.primary.quantity.amountMinor).toBe(5);
    expect(
      inventoryMeasurementAt(
        recordPlan.impact.deficits[0]!.maximumDeficit,
        "weight",
        unitCode("kg"),
      ).amountMinor,
    ).toBe(1025);

    // Worsening the intermediate piece count alone stays within the old peak.
    const safe = await strict.stock.planCorrection({
      ...correction,
      operationId: "measured-correction-preserves-both-peaks",
      replaceWith: (plans) =>
        plans.receive({
          occurredAtEpochMs: occurredAtEpochMs + 1_000,
          to: position,
          amount: measuredShortageAmount("3", "4"),
        }),
    });
    expect(safe.valid).toBe(true);
    if (!safe.valid) throw new Error(safe.conflict.message);
    expect(safe.impact.deficits).toEqual([]);
  });
});

describe("measurement axis identity", () => {
  it("rejects surrounding whitespace instead of creating a second logical axis identity", () => {
    expect(() => inventoryMeasurement("weight ", parseQuantity("5", "kg"))).toThrow(
      "Measurement axisId must not contain surrounding whitespace",
    );
    expect(() => inventoryMeasurementVector(
      { axisId: "pieces", quantity: parseQuantity("1", "piece") },
      [{ axisId: " weight", quantity: parseQuantity("5", "kg") }],
    )).toThrow("Measurement axisId must not contain surrounding whitespace");
  });
});

describe("independent physical count reconciliation", () => {
  it.each([false, true])("reports only whole fulfillable claims after reweighing (canonical: %s)", async (canonical) => {
    const item = defineInventoryItem({
      ...measuredItem(),
      reservationAxisId: "weight",
      tracking: { lot: InventoryTrackingRequirement.Forbidden, serial: InventoryTrackingRequirement.Optional },
    });
    const packaging = defineInventoryPackaging({
      revisionId: "reweighed-box", itemId, itemRevisionId, packageUnit: unitCode("box"),
      fixedContents: inventoryMeasurementVector({ axisId: "pieces", quantity: parseQuantity("24", "piece") }, []),
    }, item);
    const catalog = defineInventoryCatalog({
      itemRevisions: [item], activeItemRevisionIds: { [itemId]: itemRevisionId }, packagingRevisions: [packaging],
    });
    const selector = { itemId, placementNodeIds: ["held"] };
    for (const [shape, pieces, identity] of [
      ["serial", "1", { serialId: "held-serial" }],
      ["package", "24", { packagingRevisionId: packaging.revisionId }],
      ["loose", "2", {}],
    ] as const) {
      for (const [weight, heldFulfillable] of [["2.5", 2.5], ["3", 3], ["4.25", shape === "loose" ? 3 : 0]] as const) {
        for (const broad of [false, true]) {
          // A failpoint routes reference writes through the canonical staged coordinator.
          const storage = createInMemoryInventoryDurableStorage(canonical ? { failpoint: () => undefined } : {});
          const inventory = createInventoryOnce({ catalog, storage, clock: { nowEpochMs: () => occurredAtEpochMs + 10 } });
          const quantity = parseQuantity("3", "kg");
          const amount = shape === "package"
            ? packageAmount(1, packaging.revisionId, [{ axisId: "weight", value: "3", unit: "kg" }])
            : measuredShortageAmount(pieces, "3");
          await inventory.stock.receive({
            operationId: "receive-held", occurredAtEpochMs, to: { itemId, placementNodeId: "held", ...identity }, amount,
          });
          const [position] = await inventory.read.positions(selector);
          if (position === undefined) throw new Error("Expected a measured stock row to allocate.");
          const allocations = [{ position: position.key, quantity }];
          await inventory.reservations.reserve({
            operationId: "reserve-held", reservationId: "held", itemRevisionId, selector, requested: quantity,
            createdAtEpochMs: occurredAtEpochMs + 1,
          });
          await inventory.reservations.allocate({
            operationId: "allocate-held", reservationId: "held", allocations, occurredAtEpochMs: occurredAtEpochMs + 1,
          });
          if (broad) {
            await inventory.stock.receive({
              operationId: "receive-spare", occurredAtEpochMs, to: { itemId, placementNodeId: "spare" },
              amount: measuredShortageAmount("1", "2"),
            });
            await inventory.reservations.reserve({
              operationId: "reserve-spare", reservationId: "spare", itemRevisionId, requested: parseQuantity("2", "kg"),
              selector: { itemId, placementNodeIds: ["spare"] }, createdAtEpochMs: occurredAtEpochMs + 1,
            });
          }
          const claim = await inventory.read.reservation("held");
          expect(claim?.allocations).toEqual(allocations);
          await inventory.counts.replaceAbsolute({
            countId: "reweigh", operationId: "reweigh", itemRevisionId, selector,
            observedMeasurements: measuredVector(pieces, weight), occurredAtEpochMs: occurredAtEpochMs + 2,
          });
          expect(await inventory.read.reservation("held")).toEqual(claim);
          const report = await inventory.read.reservationFeasibility();
          const [group] = report.groups;
          if (group === undefined) throw new Error("Expected the measured claim group.");
          expect(report.groups).toHaveLength(1);
          expect(compareQuantity(group.requested, parseQuantity(broad ? "5" : "3", "kg"))).toBe(0);
          expect(compareQuantity(group.fulfillable, parseQuantity(String(heldFulfillable + (broad ? 2 : 0)), "kg"))).toBe(0);
          expect(compareQuantity(group.shortage, parseQuantity(String(3 - heldFulfillable), "kg"))).toBe(0);
          if (!broad && heldFulfillable === 0) {
            await expect(inventory.reservations.consume({
              operationId: "consume-held", reservationId: "held", occurredAtEpochMs: occurredAtEpochMs + 3,
              fulfillment: [{ from: position.key, amount }],
            })).rejects.toThrow("cannot retain axis 'weight' when primary is zero");
          }
        }
      }
    }
  });

  it("adjusts measured weight while primary piece stock is unchanged", async () => {
    const inventory = inventoryFor();
    await inventory.stock.receive({
      operationId: "measured-loose-receive",
      occurredAtEpochMs,
      to: { itemId, placementNodeId: "loose" },
      amount: measuredStockAmount("2", "piece", [
        { axisId: "weight", value: "20", unit: "kg" },
      ]),
    });

    const adjusted = await inventory.counts.replaceAbsolute({
      countId: "measured-loose-count",
      operationId: "measured-loose-count",
      itemRevisionId,
      selector: { itemId, placementNodeIds: ["loose"] },
      observedMeasurements: measuredVector("2", "21"),
      occurredAtEpochMs,
      reason: "Reweighed unchanged piece stock.",
    });

    expect(adjusted.event?.kind).toBe(InventoryEventKind.CountAdjustment);
    expect(adjusted.event?.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(0);
    expect(
      inventoryMeasurementAt(
        adjusted.event?.stockEffects[0]?.measurementsDelta ?? measuredVector("0", "0"),
        "weight",
        unitCode("kg"),
      ).amountMinor,
    ).toBe(1);
    const [position] = await inventory.read.positions({ itemId, placementNodeIds: ["loose"] });
    expect(position?.measurements.primary.quantity.amountMinor).toBe(2);
    expect(
      position === undefined
        ? undefined
        : inventoryMeasurementAt(position.measurements, "weight", unitCode("kg")).amountMinor,
    ).toBe(21);
  });

  it("allows dynamic package weight adjustment when weight is not fixed package contents", async () => {
    const item = measuredItem();
    const packaging = defineInventoryPackaging({
      revisionId: "dynamic-weight-box-v1",
      itemId,
      itemRevisionId,
      packageUnit: unitCode("box"),
      fixedContents: inventoryMeasurementVector(
        { axisId: "pieces", quantity: parseQuantity("24", "piece") },
        [],
      ),
    }, item);
    const inventory = inventoryFor([packaging]);
    await inventory.stock.receive({
      operationId: "dynamic-package-receive",
      occurredAtEpochMs,
      to: { itemId, placementNodeId: "dynamic-package" },
      amount: packageAmount(1, packaging.revisionId, [
        { axisId: "weight", value: "3", unit: "kg" },
      ]),
    });

    const adjusted = await inventory.counts.replaceAbsolute({
      countId: "dynamic-package-count",
      operationId: "dynamic-package-count",
      itemRevisionId,
      selector: { itemId, placementNodeIds: ["dynamic-package"] },
      observedMeasurements: measuredVector("24", "4"),
      occurredAtEpochMs,
    });

    expect(adjusted.event?.kind).toBe(InventoryEventKind.CountAdjustment);
    expect(
      inventoryMeasurementAt(
        adjusted.event?.stockEffects[0]?.measurementsDelta ?? measuredVector("0", "0"),
        "weight",
        unitCode("kg"),
      ).amountMinor,
    ).toBe(1);
    expect(adjusted.event?.stockEffects[0]?.measurementsDelta.primary.quantity.amountMinor).toBe(0);
  });

  it("rejects changing an independent axis that is part of fixed package contents", async () => {
    const item = measuredItem();
    const packaging = defineInventoryPackaging({
      revisionId: "fixed-weight-box-v1",
      itemId,
      itemRevisionId,
      packageUnit: unitCode("box"),
      fixedContents: measuredVector("24", "3"),
    }, item);
    const inventory = inventoryFor([packaging]);
    await inventory.stock.receive({
      operationId: "fixed-package-receive",
      occurredAtEpochMs,
      to: { itemId, placementNodeId: "fixed-package" },
      amount: packageAmount(1, packaging.revisionId),
    });
    const before = await inventory.read.world();

    await expect(inventory.counts.replaceAbsolute({
      countId: "fixed-package-count",
      operationId: "fixed-package-count",
      itemRevisionId,
      selector: { itemId, placementNodeIds: ["fixed-package"] },
      observedMeasurements: measuredVector("24", "4"),
      occurredAtEpochMs,
    })).rejects.toThrow("does not match the same whole package count");
    expect(await inventory.read.world()).toEqual(before);
  });
});


describe("independent exact-axis assurance", () => {
  it("reconciles both primary and independent axes and rejects omitted or changed weight", async () => {
    const inventory = inventoryFor();
    await inventory.stock.receive({ operationId: "oracle-measured", occurredAtEpochMs, to: { itemId, placementNodeId: "store" }, amount: measuredStockAmount("2", "piece", [{ axisId: "weight", value: "20.25", unit: "kg" }]) });
    await inventory.counts.replaceAbsolute({ countId: "oracle-reweigh", operationId: "oracle-reweigh", itemRevisionId, selector: { itemId, placementNodeIds: ["store"] }, observedMeasurements: measuredVector("2", "21.125"), occurredAtEpochMs, reason: "Physical reweigh." });
    const world = await inventory.read.world();
    expect(() => assertAbstractInventoryInvariants(world)).not.toThrow();
    const entry = Object.entries(world.projection.positions)[0];
    if (entry === undefined) throw new Error("Expected the independently measured producer position.");
    const [identity, position] = entry;
    for (const independent of [[], [{ axisId: "weight", quantity: parseQuantity("21.126", "kg") }]]) {
      expect(() => assertAbstractInventoryInvariants({ ...world, projection: { ...world.projection, positions: { ...world.projection.positions, [identity]: { ...position, measurements: { ...position.measurements, independent } } } } })).toThrow(/Published stock (?:omitted|quantity differs)/u);
    }
    // Numeric equivalence must not be mistaken for a corrupt representation of the same exact quantity.
    const equivalent = [{ axisId: "weight", quantity: parseQuantity("21.1250", "kg") }];
    expect(() => assertAbstractInventoryInvariants({ ...world, projection: { ...world.projection, positions: { ...world.projection.positions, [identity]: { ...position, measurements: { ...position.measurements, independent: equivalent } } } } })).not.toThrow();
  });
});
