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

/** Build one exact measured transformation line. */
function line(
  lineId: string,
  itemRevisionId: string,
  amount: string,
  unit: string
) {
  return {
    lineId,
    itemRevisionId,
    amount: scalarInventoryMeasurements("stock", parseQuantity(amount, unit)),
  };
}

/** Build one immutable reusable transformation definition. */
function transformation(
  transformationId: string,
  revisionId: string,
  input: ReturnType<typeof line>,
  output: ReturnType<typeof line>
): InventoryTransformationDefinitionRevision {
  return { transformationId, revisionId, inputs: [input], outputs: [output] };
}

describe("reusable physical transformation definitions", () => {
  it("keeps chains and alternate recipes first-class without parent/child identities", async () => {
    const bottle = form("med-a:bottle", "bottle");
    const openedMl = form("med-a:opened-ml", "mL");
    const syringe = form("med-a:syringe", "syringe");
    const bottleToMlV1 = transformation(
      "open-bottle",
      "open-bottle:v1",
      line("bottle-in", bottle.revisionId, "1", "bottle"),
      line("ml-out", openedMl.revisionId, "100", "mL")
    );
    const bottleToMlV2 = transformation(
      "open-bottle",
      "open-bottle:v2",
      line("bottle-in", bottle.revisionId, "1", "bottle"),
      line("ml-out", openedMl.revisionId, "95", "mL")
    );
    const mlToSyringe = transformation(
      "fill-syringe",
      "fill-syringe:v1",
      line("ml-in", openedMl.revisionId, "5", "mL"),
      line("syringe-out", syringe.revisionId, "1", "syringe")
    );
    const bottleToSyringe = transformation(
      "direct-fill",
      "direct-fill:v1",
      line("bottle-in", bottle.revisionId, "1", "bottle"),
      line("syringe-out", syringe.revisionId, "20", "syringe")
    );
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
        (row) => row.transformationId
      )
    ).toEqual(["direct-fill", "open-bottle"]);
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
    const definition = transformation(
      "open-bottle",
      "open-bottle:v1",
      line("bottle-in", bottle.revisionId, "2", "bottle"),
      line("ml-out", openedMl.revisionId, "200", "mL")
    );
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
      occurredAt: time0,
      to: { itemId: "med-a", locationId: "room-a" },
      itemRevisionId: bottle.revisionId,
      amount: stockAmount("3", "bottle"),
    });

    const before = (await storage.readWorld()).revision;
    const plan = await inventory.transformations.plan({
      transformationRevisionId: definition.revisionId,
      selectorsByInputLine: {
        "bottle-in": { itemId: "med-a", locationIds: ["room-a"] },
      },
    });
    expect(plan).toMatchObject({ worldRevision: before, applicable: true });
    expect(plan.inputs[0]).toMatchObject({
      itemRevisionId: bottle.revisionId,
      sufficient: true,
    });
    expect(plan.inputs[0]?.positions).toHaveLength(1);
    expect((await storage.readWorld()).revision).toBe(before);

    const unavailable = await inventory.transformations.plan({
      transformationRevisionId: definition.revisionId,
      selectorsByInputLine: {
        "bottle-in": { itemId: "med-a", locationIds: ["room-b"] },
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

    const first = transformation(
      "open-bottle",
      "open-bottle:v1",
      line("in", bottle.revisionId, "1", "bottle"),
      line("out", openedMl.revisionId, "100", "mL")
    );
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
          { ...first, outputs: [line("out", openedMl.revisionId, "99", "mL")] },
        ],
      })
    ).toThrow("cannot be redefined");
  });
});
