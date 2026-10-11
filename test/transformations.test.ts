import { describe, expect, it } from "vitest";
import {
  createInventoryOnce,
  defineInventoryCatalog,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  parseQuantity,
  scalarInventoryMeasurements,
  stockAmount,
  type InventoryTransformationDefinitionRevision,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { time0 } from "./test-fixtures.js";

/** Machine-audited trace for retained transformation reads and one-world planning. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-TRANSFORMATION-DEFINITION-READ-PLAN",
] as const;

void FORMAL_IMPLEMENTATION_TRACE_IDS;

/** Build one scalar physical form revision for the same stable medication identity. */
function form(revisionId: string, unit: string) {
  return defineScalarInventoryItem({
    itemId: "med-a",
    revisionId,
    axisId: "stock",
    unit,
  });
}

/** Named inputs for one exact measured transformation line. */
interface TransformationLineInput {
  /** Stable line identity. */
  readonly lineId: string;
  /** Exact immutable item revision consumed or produced. */
  readonly itemRevisionId: string;
  /** Exact scalar amount text. */
  readonly amount: string;
  /** Exact scalar unit. */
  readonly unit: string;
}

/** Build one exact measured transformation line. */
function line({
  lineId,
  itemRevisionId,
  amount,
  unit,
}: TransformationLineInput) {
  return {
    lineId,
    itemRevisionId,
    amount: scalarInventoryMeasurements("stock", parseQuantity(amount, unit)),
  };
}

/** Named inputs for one immutable reusable transformation definition. */
interface TransformationDefinitionInput {
  /** Stable transformation identity. */
  readonly transformationId: string;
  /** Exact immutable transformation revision identity. */
  readonly revisionId: string;
  /** Exact input line for this test recipe. */
  readonly input: ReturnType<typeof line>;
  /** Exact output line for this test recipe. */
  readonly output: ReturnType<typeof line>;
}

/** Build one immutable reusable transformation definition. */
function transformation({
  transformationId,
  revisionId,
  input,
  output,
}: TransformationDefinitionInput): InventoryTransformationDefinitionRevision {
  return { transformationId, revisionId, inputs: [input], outputs: [output] };
}

describe("reusable physical transformation definitions", () => {
  it("keeps chains and alternate recipes first-class without parent/child identities", async () => {
    const bottle = form("med-a:bottle", "bottle");
    const openedMl = form("med-a:opened-ml", "mL");
    const syringe = form("med-a:syringe", "syringe");
    const bottleToMlV1 = transformation({
      transformationId: "open-bottle",
      revisionId: "open-bottle:v1",
      input: line({ lineId: "bottle-in", itemRevisionId: bottle.revisionId, amount: "1", unit: "bottle" }),
      output: line({ lineId: "ml-out", itemRevisionId: openedMl.revisionId, amount: "100", unit: "mL" }),
    });
    const bottleToMlV2 = transformation({
      transformationId: "open-bottle",
      revisionId: "open-bottle:v2",
      input: line({
        lineId: "bottle-in",
        itemRevisionId: bottle.revisionId,
        amount: "1",
        unit: "bottle",
      }),
      output: line({ lineId: "ml-out", itemRevisionId: openedMl.revisionId, amount: "95", unit: "mL" }),
    });
    const mlToSyringe = transformation({
      transformationId: "fill-syringe",
      revisionId: "fill-syringe:v1",
      input: line({ lineId: "ml-in", itemRevisionId: openedMl.revisionId, amount: "5", unit: "mL" }),
      output: line({ lineId: "syringe-out", itemRevisionId: syringe.revisionId, amount: "1", unit: "syringe" }),
    });
    const bottleToSyringe = transformation({
      transformationId: "direct-fill",
      revisionId: "direct-fill:v1",
      input: line({
        lineId: "bottle-in",
        itemRevisionId: bottle.revisionId,
        amount: "1",
        unit: "bottle",
      }),
      output: line({ lineId: "syringe-out", itemRevisionId: syringe.revisionId, amount: "20", unit: "syringe" }),
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [bottle, openedMl, syringe],
      activeItemRevisionIds: { "med-a": bottle.revisionId },
      transformationRevisions: [
        bottleToMlV1,
        bottleToMlV2,
        mlToSyringe,
        bottleToSyringe,
      ],
      activeTransformationRevisionIds: {
        "open-bottle": bottleToMlV2.revisionId,
        "fill-syringe": mlToSyringe.revisionId,
        "direct-fill": bottleToSyringe.revisionId,
      },
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
    });

    expect((await inventory.catalog.activeItem("med-a")).revisionId).toBe(
      bottle.revisionId
    );
    expect(
      (await inventory.catalog.itemRevisionsForItem("med-a")).map(
        /** Project one retained form to its exact immutable revision identity. */
        (row) => row.revisionId
      )
    ).toEqual([bottle.revisionId, openedMl.revisionId, syringe.revisionId]);
    expect(
      (await inventory.catalog.itemRevision(openedMl.revisionId)).primaryAxis
        .unit
    ).toBe("mL");
    expect(
      (await inventory.transformations.activeDefinition("open-bottle"))
        .revisionId
    ).toBe("open-bottle:v2");
    expect(
      (await inventory.transformations.definition(bottleToMlV1.revisionId))
        .revisionId
    ).toBe("open-bottle:v1");
    expect(
      (await inventory.transformations.definitionsForItem("med-a")).map(
        (row) => row.revisionId
      )
    ).toEqual([
      "direct-fill:v1",
      "fill-syringe:v1",
      "open-bottle:v1",
      "open-bottle:v2",
    ]);
    expect(
      (await inventory.transformations.fromRevision(bottle.revisionId)).map(
        (row) => row.revisionId
      )
    ).toEqual(["direct-fill:v1", "open-bottle:v2"]);
    expect(
      (await inventory.transformations.toRevision(syringe.revisionId)).map(
        (row) => row.transformationId
      )
    ).toEqual(["direct-fill", "fill-syringe"]);
    expect(
      (
        await inventory.transformations.betweenRevisions(
          openedMl.revisionId,
          syringe.revisionId
        )
      ).map((row) => row.transformationId)
    ).toEqual(["fill-syringe"]);
  });

  it("previews exact source quantity from one coherent world without writing", async () => {
    const bottle = form("med-a:bottle", "bottle");
    const openedMl = form("med-a:opened-ml", "mL");
    const definition = transformation({
      transformationId: "open-bottle",
      revisionId: "open-bottle:v1",
      input: line({ lineId: "bottle-in", itemRevisionId: bottle.revisionId, amount: "2", unit: "bottle" }),
      output: line({ lineId: "ml-out", itemRevisionId: openedMl.revisionId, amount: "200", unit: "mL" }),
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [bottle, openedMl],
      activeItemRevisionIds: { "med-a": bottle.revisionId },
      transformationRevisions: [definition],
      activeTransformationRevisionIds: { "open-bottle": definition.revisionId },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({ catalog, storage });
    await inventory.stock.receive({
      operationId: "receive-bottles",
      occurredAtEpochMs: time0,
      to: { itemId: "med-a", placementNodeId: "room-a" },
      itemRevisionId: bottle.revisionId,
      amount: stockAmount("3", "bottle"),
    });

    const before = (await storage.readWorld()).revision;
    const plan = await inventory.transformations.plan({
      transformationRevisionId: definition.revisionId,
      selectorsByInputLine: {
        "bottle-in": { itemId: "med-a", placementNodeIds: ["room-a"] },
      },
    });
    expect(plan).toMatchObject({ worldRevision: before, applicable: true });
    expect(plan.inputs[0]).toMatchObject({
      itemRevisionId: bottle.revisionId,
      sufficient: true,
    });
    expect(plan.inputs[0]?.positions).toHaveLength(1);
    expect(plan.inputs[0]?.required).toEqual(
      scalarInventoryMeasurements("stock", parseQuantity("2", "bottle"))
    );
    expect(plan.inputs[0]?.available).toEqual(
      scalarInventoryMeasurements("stock", parseQuantity("3", "bottle"))
    );
    expect((await storage.readWorld()).revision).toBe(before);

    const unavailable = await inventory.transformations.plan({
      transformationRevisionId: definition.revisionId,
      selectorsByInputLine: {
        "bottle-in": { itemId: "med-a", placementNodeIds: ["room-b"] },
      },
    });
    expect(unavailable.applicable).toBe(false);
    expect(unavailable.inputs[0]?.positions).toHaveLength(0);
  });

  it("retains immutable historical recipes and keeps old empty-catalog digests stable", () => {
    const bottle = form("med-a:bottle", "bottle");
    const openedMl = form("med-a:opened-ml", "mL");
    const base = defineInventoryCatalog({
      itemRevisions: [bottle, openedMl],
      activeItemRevisionIds: { "med-a": bottle.revisionId },
    });
    const explicitEmpty = defineInventoryCatalog({
      itemRevisions: [bottle, openedMl],
      activeItemRevisionIds: { "med-a": bottle.revisionId },
      transformationRevisions: [],
      activeTransformationRevisionIds: {},
    });
    expect(explicitEmpty.digest).toBe(base.digest);

    const first = transformation({
      transformationId: "open-bottle",
      revisionId: "open-bottle:v1",
      input: line({ lineId: "in", itemRevisionId: bottle.revisionId, amount: "1", unit: "bottle" }),
      output: line({ lineId: "out", itemRevisionId: openedMl.revisionId, amount: "100", unit: "mL" }),
    });
    const extended = extendInventoryCatalog({
      catalog: base,
      transformationRevisions: [first],
      activeTransformationRevisionIds: { "open-bottle": first.revisionId },
    });
    expect(extended.transformationRevision(first.revisionId)).toEqual(first);
    expect(() =>
      extendInventoryCatalog({
        catalog: extended,
        transformationRevisions: [
          { ...first, outputs: [line({ lineId: "out", itemRevisionId: openedMl.revisionId, amount: "99", unit: "mL" })] },
        ],
      })
    ).toThrow("cannot be redefined");
  });
});
