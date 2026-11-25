import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryDeficitPolicy,
  InventoryFungibilityReservationEffectKind,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryReservationFeasibilityStatus,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineScalarInventoryFungibilityPool,
  defineScalarInventoryItem,
  defineScalarInventoryPackaging,
  extendInventoryCatalog,
  inventoryCatalogSnapshot,
  inventoryStockSelector,
  measuredStockAmount,
  packageAmount,
  parseQuantity,
  stockAmount,
  unitCode,
  type InventoryCatalog,
  type InventoryItemDefinitionRevision,
} from "../src/index.js";
import {
  createInMemoryInventoryDurableStorage,
  type InventoryDurableStorage,
} from "../src/storage-api.js";
import { clockAt, time0, time1, time2, time3 } from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-FUNGIBILITY-MOVEMENT-IDENTITY",
] as const;

/** Exact old-brand item revision used by all pool fixtures. */
function oldBrand(): InventoryItemDefinitionRevision {
  return defineScalarInventoryItem({
    itemId: "old-brand",
    revisionId: "old-brand-v1",
    axisId: "pieces",
    unit: "piece",
  });
}

/** Exact new-brand item revision used by all pool fixtures. */
function newBrand(): InventoryItemDefinitionRevision {
  return defineScalarInventoryItem({
    itemId: "new-brand",
    revisionId: "new-brand-v1",
    axisId: "pieces",
    unit: "piece",
  });
}

/** Double-strength member whose one physical piece contributes two pool units. */
function doubleStrength(): InventoryItemDefinitionRevision {
  return defineScalarInventoryItem({
    itemId: "double-strength",
    revisionId: "double-strength-v1",
    axisId: "pieces",
    unit: "piece",
  });
}

/** Build two retained revisions where v2 adds one exact 2:1 member. */
function fungibilityCatalog(
  activeRevisionId = "brand-pool-v2"
): InventoryCatalog {
  const old = oldBrand();
  const newer = newBrand();
  const double = doubleStrength();
  const v1 = defineScalarInventoryFungibilityPool({
    poolId: "brand-pool",
    revisionId: "brand-pool-v1",
    basisAxisId: "dose-equivalent",
    basisUnit: "dose-equivalent",
    members: [{ item: old }, { item: newer }],
  });
  const v2 = defineScalarInventoryFungibilityPool({
    poolId: "brand-pool",
    revisionId: "brand-pool-v2",
    basisAxisId: "dose-equivalent",
    basisUnit: "dose-equivalent",
    members: [
      { item: old },
      { item: newer },
      { item: double, poolQuantity: "2" },
    ],
  });
  return defineInventoryCatalog({
    itemRevisions: [old, newer, double],
    activeItemRevisionIds: {
      "old-brand": old.revisionId,
      "new-brand": newer.revisionId,
      "double-strength": double.revisionId,
    },
    fungibilityRevisions: [v1, v2],
    activeFungibilityRevisionIds: { "brand-pool": activeRevisionId },
  });
}

/** Receive one exact loose member item/lot into a shared test location. */
async function receiveMember(input: {
  /** Inventory façade receiving the member. */
  readonly inventory: ReturnType<typeof createInventoryOnce>;
  /** Stable operation identity. */
  readonly operationId: string;
  /** Stable member item identity. */
  readonly itemId: string;
  /** Exact member item revision. */
  readonly itemRevisionId: string;
  /** Lot identity used by deterministic allocation assertions. */
  readonly lotId: string;
  /** Exact piece count. */
  readonly quantity: string;
  /** Physical occurrence time. */
  readonly occurredAtEpochMs: number;
  /** Optional FEFO expiry. */
  readonly expiresAtEpochMs?: number;
}): Promise<void> {
  await input.inventory.stock.receive({
    operationId: input.operationId,
    occurredAtEpochMs: input.occurredAtEpochMs,
    to: {
      itemId: input.itemId,
      placementNodeId: "store",
      lotId: input.lotId,
    },
    amount: stockAmount(input.quantity, "piece"),
    itemRevisionId: input.itemRevisionId,
    ...(input.expiresAtEpochMs === undefined
      ? {}
      : { lot: { expiresAtEpochMs: input.expiresAtEpochMs } }),
  });
}

describe("revision-frozen mutual-fungibility catalogue", () => {
  it("derives and allocates a storable pool total across mixed-scale rows", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({ catalog, storage: createInMemoryInventoryDurableStorage(), clock: clockAt(time3) });
    for (const { lotId, quantity } of [
      { lotId: "a", quantity: "9007199254740990" }, { lotId: "b", quantity: "0.1" }, { lotId: "c", quantity: "0.9" },
    ]) {
      await receiveMember({ inventory, operationId: `receive-pool-scale-${lotId}`, itemId: "new-brand",
        itemRevisionId: "new-brand-v1", lotId, quantity, occurredAtEpochMs: time0 });
    }
    const scope = { fungibilityRevisionId: "brand-pool-v1", scope: { placementNodeIds: ["store"] } };
    const summary = await inventory.fungibility.summary(scope);
    const total = parseQuantity(String(Number.MAX_SAFE_INTEGER), "dose-equivalent");
    expect(summary.total).toEqual(total);
    expect(summary.physicalTotal).toEqual(total);
    const issue = await inventory.fungibility.issue({ ...scope, operationId: "issue-from-mixed-scale-pool",
      occurredAtEpochMs: time1, requested: parseQuantity("1", "dose-equivalent"), method: InventoryAllocationMethod.Fifo });
    expect(issue.event.stockEffects).toMatchObject([{ position: { lotId: "a" }, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } } }]);
  });

  it("retains old pool revisions while active publication advances independently", () => {
    const old = oldBrand();
    const newer = newBrand();
    const double = doubleStrength();
    const v1 = defineScalarInventoryFungibilityPool({
      poolId: "brand-pool",
      revisionId: "brand-pool-v1",
      basisUnit: "dose-equivalent",
      members: [{ item: old }, { item: newer }],
    });
    const base = defineInventoryCatalog({
      itemRevisions: [old, newer, double],
      activeItemRevisionIds: {
        "old-brand": old.revisionId,
        "new-brand": newer.revisionId,
        "double-strength": double.revisionId,
      },
      fungibilityRevisions: [v1],
      activeFungibilityRevisionIds: { "brand-pool": v1.revisionId },
    });
    const v2 = defineScalarInventoryFungibilityPool({
      poolId: "brand-pool",
      revisionId: "brand-pool-v2",
      basisUnit: "dose-equivalent",
      members: [
        { item: old },
        { item: newer },
        { item: double, poolQuantity: "2" },
      ],
    });
    const extended = extendInventoryCatalog({
      catalog: base,
      fungibilityRevisions: [v2],
      activeFungibilityRevisionIds: { "brand-pool": v2.revisionId },
    });

    expect(extended.activeFungibilityPool("brand-pool").revisionId).toBe(
      "brand-pool-v2"
    );
    expect(extended.fungibilityRevision("brand-pool-v1").members).toHaveLength(
      2
    );
    expect(extended.fungibilityRevision("brand-pool-v2").members).toHaveLength(
      3
    );
    expect(inventoryCatalogSnapshot(extended)).toMatchObject({
      activeFungibilityRevisionIds: { "brand-pool": "brand-pool-v2" },
    });
    expect(extended.digest).not.toBe(base.digest);
  });

  it("rejects vague/single-member/duplicate-member definitions", () => {
    const old = oldBrand();
    expect(() =>
      defineScalarInventoryFungibilityPool({
        poolId: "bad-one-member",
        revisionId: "bad-one-member-v1",
        basisUnit: "equivalent",
        members: [{ item: old }],
      })
    ).toThrow("at least two member item revisions");
    expect(() =>
      defineScalarInventoryFungibilityPool({
        poolId: "bad-duplicate-member",
        revisionId: "bad-duplicate-member-v1",
        basisUnit: "equivalent",
        members: [{ item: old }, { item: old }],
      })
    ).toThrow("repeats item revision");
  });
});

describe("derived pool summaries and exact member movements", () => {
  it("orders summary members by locale-independent exact revision identity", async () => {
    const upper = defineScalarInventoryItem({
      itemId: "identity-upper",
      revisionId: "B",
      axisId: "pieces",
      unit: "piece",
    });
    const lower = defineScalarInventoryItem({
      itemId: "identity-lower",
      revisionId: "a",
      axisId: "pieces",
      unit: "piece",
    });
    const pool = defineScalarInventoryFungibilityPool({
      poolId: "identity-order-pool",
      revisionId: "identity-order-pool-v1",
      basisUnit: "equivalent",
      members: [{ item: lower }, { item: upper }],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [lower, upper],
      activeItemRevisionIds: {
        "identity-lower": lower.revisionId,
        "identity-upper": upper.revisionId,
      },
      fungibilityRevisions: [pool],
      activeFungibilityRevisionIds: {
        "identity-order-pool": pool.revisionId,
      },
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time0),
    });

    const summary = await inventory.fungibility.summary({
      fungibilityRevisionId: pool.revisionId,
    });
    expect(summary.members.map((entry) => entry.member.itemRevisionId)).toEqual([
      "B",
      "a",
    ]);
  });
  it("uses a sparse what-if overlay instead of enumerating unrelated positions", async () => {
    const catalog = fungibilityCatalog();
    const baseStorage = createInMemoryInventoryDurableStorage();
    let positionEnumerations = 0;
    const storage = new Proxy(baseStorage, {
      /** Wrap only published-world reads; every write method remains bound to the real adapter. */
      get(target, property, receiver): unknown {
        if (property === "readWorld") {
          return async (): Promise<
            Awaited<ReturnType<InventoryDurableStorage["readWorld"]>>
          > => {
            const world = await target.readWorld();
            const positions = new Proxy(world.projection.positions, {
              /** A full spread/Object.keys/Object.values would enumerate the whole map. */
              ownKeys(positionTarget): ArrayLike<string | symbol> {
                positionEnumerations += 1;
                return Reflect.ownKeys(positionTarget);
              },
            });
            return {
              ...world,
              projection: { ...world.projection, positions },
            };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as InventoryDurableStorage;
    const inventory = createInventoryOnce({
      catalog,
      storage,
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-sparse-overlay-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "SPARSE-OLD",
      quantity: "2",
      occurredAtEpochMs: time0,
    });
    await receiveMember({
      inventory,
      operationId: "receive-sparse-overlay-new",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "SPARSE-NEW",
      quantity: "2",
      occurredAtEpochMs: time1,
    });
    positionEnumerations = 0;
    const planned = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time3,
    });
    expect(planned.lines).toHaveLength(1);
    expect(positionEnumerations).toBe(0);
  });
  it("reports prepared transfer stock as physical pool truth but never allocates it", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-fungibility-transfer-stock",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "TRANSFER-POOL-LOT",
      quantity: "2",
      occurredAtEpochMs: time0,
    });
    await inventory.transfers.prepare({
      operationId: "prepare-fungibility-transfer-stock",
      occurredAtEpochMs: time1,
      transferId: "POOL-TRANSFER",
      transitPlacementNodeId: "transit",
      destinationPlacementNodeId: "destination",
      lines: [
        {
          lineId: "old-brand-line",
          from: {
            itemId: "old-brand",
            placementNodeId: "store",
            lotId: "TRANSFER-POOL-LOT",
          },
          itemRevisionId: "old-brand-v1",
          amount: stockAmount("2", "piece"),
        },
      ],
    });

    const summary = await inventory.fungibility.summary({
      fungibilityRevisionId: "brand-pool-v1",
      scope: { placementNodeIds: ["store"] },
    });
    expect(summary.physicalTotal.amountMinor).toBe(2);
    const plan = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time3,
    });
    expect(plan.lines).toEqual([]);
    expect(plan.shortfall.amountMinor).toBe(1);
  });

  it("counts old/new/double members in the exact requested revision without merging stock", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-old-three",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "OLD-LOT",
      quantity: "3",
      occurredAtEpochMs: time0,
    });
    await receiveMember({
      inventory,
      operationId: "receive-new-two",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "NEW-LOT",
      quantity: "2",
      occurredAtEpochMs: time1,
    });
    await receiveMember({
      inventory,
      operationId: "receive-double-one",
      itemId: "double-strength",
      itemRevisionId: "double-strength-v1",
      lotId: "DOUBLE-LOT",
      quantity: "1",
      occurredAtEpochMs: time2,
    });

    const v1 = await inventory.fungibility.summary({
      fungibilityRevisionId: "brand-pool-v1",
      scope: { placementNodeIds: ["store"] },
    });
    const v2 = await inventory.fungibility.summary({
      fungibilityRevisionId: "brand-pool-v2",
      scope: { placementNodeIds: ["store"] },
    });
    expect(v1.total).toMatchObject({ amountMinor: 5, unit: "dose-equivalent" });
    expect(v2.total).toMatchObject({ amountMinor: 7, unit: "dose-equivalent" });
    expect(
      v2.members.map(
        /** Preserve exact member identities and their derived pool contributions. */
        (member) => [
          member.member.itemRevisionId,
          member.memberQuantity.amountMinor,
          member.poolQuantity.amountMinor,
        ]
      )
    ).toEqual([
      ["double-strength-v1", 1, 2],
      ["new-brand-v1", 2, 2],
      ["old-brand-v1", 3, 3],
    ]);
    expect(
      (await inventory.read.positions({ itemId: "double-strength" }))[0]?.key
        .itemId
    ).toBe("double-strength");
  });

  it("keeps recorded member deficit out of fungible physical capacity", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    await inventory.stock.issueByPolicy({
      operationId: "record-old-member-deficit",
      occurredAtEpochMs: time0,
      selector: inventoryStockSelector("old-brand", {
        itemRevisionIds: ["old-brand-v1"],
        placementNodeIds: ["store"],
      }),
      itemRevisionId: "old-brand-v1",
      amount: stockAmount("4", "piece"),
      method: InventoryAllocationMethod.Fifo,
    });
    await receiveMember({
      inventory,
      operationId: "receive-old-after-member-deficit",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "OLD-AFTER-DEFICIT",
      quantity: "10",
      occurredAtEpochMs: time1,
    });
    await receiveMember({
      inventory,
      operationId: "receive-new-beside-member-deficit",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "NEW-BESIDE-DEFICIT",
      quantity: "2",
      occurredAtEpochMs: time1,
    });

    const summary = await inventory.fungibility.summary({
      fungibilityRevisionId: "brand-pool-v1",
      scope: { placementNodeIds: ["store"] },
    });
    expect(summary).toMatchObject({
      total: { amountMinor: 8, unit: "dose-equivalent" },
      physicalTotal: { amountMinor: 12, unit: "dose-equivalent" },
      deficitTotal: { amountMinor: 4, unit: "dose-equivalent" },
    });
    expect(summary.members.map((entry) => entry.member.itemRevisionId)).toEqual([
      "new-brand-v1",
      "old-brand-v1",
    ]);
    const oldMemberSummary = summary.members.find(
      /** Read the member whose late receipt is burdened by its own deficit. */
      (member) => member.member.itemRevisionId === "old-brand-v1"
    );
    expect(oldMemberSummary).toMatchObject({
      memberQuantity: { amountMinor: 6 },
      physicalMemberQuantity: { amountMinor: 10 },
      deficitMemberQuantity: { amountMinor: 4 },
    });

    const preview = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("8", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time2,
    });
    expect(
      preview.lines.reduce(
        /** Sum exact common-basis capacity exposed by every chosen member line. */
        (total, line) => total + line.poolQuantity.amountMinor,
        0
      )
    ).toBe(8);
    expect(preview.shortfall.amountMinor).toBe(0);

    const tooLarge = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("9", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time2,
    });
    expect(tooLarge.lines).toEqual([]);
    expect(tooLarge.shortfall.amountMinor).toBe(9);
  });

  it("uses eligible stock when other member placements have an unstorable combined deficit", async () => {
    const inventory = createInventoryOnce({
      catalog: fungibilityCatalog(),
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    for (const { placement, value } of [
      { placement: "missing-large", value: String(Number.MAX_SAFE_INTEGER) },
      { placement: "missing-small", value: "0.1" },
    ]) {
      await inventory.stock.issueByPolicy({
        operationId: placement, occurredAtEpochMs: time0,
        selector: inventoryStockSelector("old-brand", { placementNodeIds: [placement] }),
        itemRevisionId: "old-brand-v1", amount: stockAmount(value, "piece"),
        method: InventoryAllocationMethod.Fifo,
      });
    }
    await receiveMember({
      inventory, operationId: "receive-outside-member-shortage", itemId: "old-brand",
      itemRevisionId: "old-brand-v1", lotId: "LIVE", quantity: "2", occurredAtEpochMs: time1,
    });
    const request = {
      fungibilityRevisionId: "brand-pool-v1", requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
    };
    const preview = await inventory.fungibility.plan({ ...request, atEpochMs: time2 });
    expect(preview.lines).toMatchObject([{
      position: { lotId: "LIVE", placementNodeId: "store" },
      memberQuantity: parseQuantity("1", "piece"),
    }]);
    expect(await inventory.fungibility.issue({
      ...request, operationId: "issue-outside-member-shortage", occurredAtEpochMs: time2,
    })).toMatchObject({
      event: { stockEffects: [{
        position: { lotId: "LIVE", placementNodeId: "store" },
        measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } },
      }] },
    });
  });

  it("selects a storable stock line when the member's total capacity cannot be stored", async () => {
    const inventory = createInventoryOnce({
      catalog: fungibilityCatalog(), storage: createInMemoryInventoryDurableStorage(), clock: clockAt(time3),
      deficitPolicy: InventoryDeficitPolicy.Record,
    });
    for (const { lotId, quantity, occurredAtEpochMs } of [
      { lotId: "OLDER", quantity: String(Number.MAX_SAFE_INTEGER), occurredAtEpochMs: time0 },
      { lotId: "NEWER", quantity: "0.1", occurredAtEpochMs: time1 },
    ]) {
      await receiveMember({
        inventory, operationId: lotId, itemId: "old-brand", itemRevisionId: "old-brand-v1",
        lotId, quantity, occurredAtEpochMs,
      });
    }
    const request = {
      fungibilityRevisionId: "brand-pool-v1", requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
    };
    expect((await inventory.fungibility.plan({ ...request, atEpochMs: time2 })).lines).toMatchObject([{
      position: { lotId: "OLDER" }, memberQuantity: parseQuantity("1", "piece"),
    }]);
    expect((await inventory.fungibility.issue({
      ...request, operationId: "wide-member-capacity", occurredAtEpochMs: time2,
    })).event.stockEffects).toMatchObject([{
      position: { lotId: "OLDER" }, measurementsDelta: { primary: { quantity: parseQuantity("-1", "piece") } },
    }]);
  });

  it("pins operations to the supplied revision even when a newer pool is active", async () => {
    const catalog = fungibilityCatalog("brand-pool-v2");
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-pinned-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "PINNED-OLD",
      quantity: "1",
      occurredAtEpochMs: time0,
      expiresAtEpochMs: 1801440000000,
    });
    await receiveMember({
      inventory,
      operationId: "receive-pinned-new",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "PINNED-NEW",
      quantity: "1",
      occurredAtEpochMs: time1,
      expiresAtEpochMs: 1803859200000,
    });
    await receiveMember({
      inventory,
      operationId: "receive-pinned-double",
      itemId: "double-strength",
      itemRevisionId: "double-strength-v1",
      lotId: "PINNED-DOUBLE",
      quantity: "1",
      occurredAtEpochMs: time2,
      expiresAtEpochMs: 1798761600000,
    });

    expect(
      (await inventory.fungibility.activeDefinition("brand-pool")).revisionId
    ).toBe("brand-pool-v2");
    const command = {
      operationId: "issue-against-frozen-v1",
      occurredAtEpochMs: time3,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fefo,
      scope: { placementNodeIds: ["store"] },
      reason: "Fulfilled against the older reviewed pool contract.",
    };
    const issued = await inventory.fungibility.issue(command);
    const replayed = await inventory.fungibility.issue(command);
    expect(replayed.replayed).toBe(true);
    expect(issued.event.stockEffects).toHaveLength(1);
    expect(issued.event.stockEffects[0]?.position.itemId).toBe("old-brand");
    expect(issued.event.stockEffects[0]?.position.itemId).not.toBe(
      "double-strength"
    );
    expect(issued.event.metadata?.inventoryOnceFungibility).toMatchObject({
      poolId: "brand-pool",
      revisionId: "brand-pool-v1",
      requested: "1",
    });
    expect(
      (await inventory.read.positions({ itemId: "double-strength" }))[0]
        ?.measurements.primary.quantity.amountMinor
    ).toBe(1);
  });

  it("uses exact common-basis ratios while the emitted event retains the chosen member item", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-ratio-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "RATIO-OLD",
      quantity: "2",
      occurredAtEpochMs: time0,
      expiresAtEpochMs: 1809129600000,
    });
    await receiveMember({
      inventory,
      operationId: "receive-ratio-double",
      itemId: "double-strength",
      itemRevisionId: "double-strength-v1",
      lotId: "RATIO-DOUBLE",
      quantity: "1",
      occurredAtEpochMs: time1,
      expiresAtEpochMs: 1798761600000,
    });

    const preview = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v2",
      requested: parseQuantity("2", "dose-equivalent"),
      method: InventoryAllocationMethod.Fefo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time3,
    });
    expect(preview.shortfall.amountMinor).toBe(0);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({
      itemRevisionId: "double-strength-v1",
      memberQuantity: { amountMinor: 1, unit: "piece" },
      poolQuantity: { amountMinor: 2, unit: "dose-equivalent" },
    });

    const issued = await inventory.fungibility.issue({
      operationId: "issue-double-as-two-equivalents",
      occurredAtEpochMs: time3,
      fungibilityRevisionId: "brand-pool-v2",
      requested: parseQuantity("2", "dose-equivalent"),
      method: InventoryAllocationMethod.Fefo,
      scope: { placementNodeIds: ["store"] },
      reason: "One double-strength member satisfies two reviewed equivalents.",
    });
    expect(issued.event.stockEffects[0]?.position).toMatchObject({
      itemId: "double-strength",
      itemRevisionId: "double-strength-v1",
      lotId: "RATIO-DOUBLE",
    });
    expect(
      await inventory.read.positions({ itemId: "double-strength" })
    ).toEqual([]);
    expect(
      (
        await inventory.fungibility.summary({
          fungibilityRevisionId: "brand-pool-v2",
          scope: { placementNodeIds: ["store"] },
        })
      ).total.amountMinor
    ).toBe(2);
  });

  it.each(["1.5", "1"])("uses only exact subsets of loose and intact rows with a %s pool reference",
    async (poolQuantity) => {
    const packaged = defineScalarInventoryItem({
      itemId: "awkward-packaged",
      revisionId: "awkward-packaged-v1",
      axisId: "pieces",
      unit: "piece",
    });
    const alternative = defineScalarInventoryItem({
      itemId: "awkward-alternative",
      revisionId: "awkward-alternative-v1",
      axisId: "pieces",
      unit: "piece",
    });
    const pack2 = defineScalarInventoryPackaging({
      revisionId: "awkward-pack-2-v1",
      item: packaged,
      packageUnit: "pack",
      contains: "2",
    });
    const pool = defineScalarInventoryFungibilityPool({
      poolId: "awkward-pool",
      revisionId: "awkward-pool-v1",
      basisUnit: "equivalent",
      members: [
        {
          item: packaged,
          memberQuantity: "3",
          poolQuantity,
        },
        { item: alternative },
      ],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [packaged, alternative],
      activeItemRevisionIds: {
        [packaged.itemId]: packaged.revisionId,
        [alternative.itemId]: alternative.revisionId,
      },
      packagingRevisions: [pack2],
      fungibilityRevisions: [pool],
      activeFungibilityRevisionIds: { [pool.poolId]: pool.revisionId },
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-two-piece-packs",
      occurredAtEpochMs: time0,
      to: { itemId: packaged.itemId, placementNodeId: "store" },
      amount: packageAmount(4, pack2.revisionId),
    });

    const blocked = await inventory.fungibility.plan({
      fungibilityRevisionId: pool.revisionId,
      requested: parseQuantity(poolQuantity, "equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time1,
    });
    expect(blocked.lines).toEqual([]);
    expect(blocked.shortfall).toEqual(parseQuantity(poolQuantity, "equivalent"));
    expect(blocked.incrementBlockedStock).toBe(true);

    const legal = await inventory.fungibility.plan({
      fungibilityRevisionId: pool.revisionId,
      requested: parseQuantity(poolQuantity === "1" ? "2" : "3", "equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time1,
    });
    expect(legal.lines).toHaveLength(1);
    expect(legal.lines[0]?.amount).toMatchObject({
      count: 3,
      packagingRevisionId: pack2.revisionId,
    });
    expect(legal.lines[0]?.memberQuantity).toEqual(parseQuantity("6", "piece"));
    await inventory.stock.receive({
      operationId: "receive-loose-remainder", occurredAtEpochMs: time0,
      to: { itemId: packaged.itemId, placementNodeId: "loose-store" },
      amount: stockAmount("10", "piece"),
    });
    const loose = await inventory.fungibility.plan({
      fungibilityRevisionId: pool.revisionId,
      requested: parseQuantity(poolQuantity, "equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["loose-store"] },
      atEpochMs: time1,
    });
    expect(loose.lines).toMatchObject([{
      memberQuantity: parseQuantity("3", "piece"),
      poolQuantity: parseQuantity(poolQuantity, "equivalent"),
    }]);
    expect(loose.shortfall).toEqual(parseQuantity(poolQuantity === "1" ? "0" : "0.0", "equivalent"));
  });

  it("splits package-fixed independent measurements consistently with ordinary allocation", async () => {
    const packaged = defineInventoryItem({
      itemId: "fixed-measure-packaged",
      revisionId: "fixed-measure-packaged-v1",
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
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Optional,
      },
      qualifiedDimensions: [],
    });
    const alternative = defineScalarInventoryItem({
      itemId: "fixed-measure-alternative",
      revisionId: "fixed-measure-alternative-v1",
      axisId: "pieces",
      unit: "piece",
    });
    const packagingRevisionId = "fixed-measure-pack-v1";
    const pool = defineScalarInventoryFungibilityPool({
      poolId: "fixed-measure-pool",
      revisionId: "fixed-measure-pool-v1",
      basisUnit: "equivalent",
      members: [{ item: packaged }, { item: alternative }],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [packaged, alternative],
      activeItemRevisionIds: {
        [packaged.itemId]: packaged.revisionId,
        [alternative.itemId]: alternative.revisionId,
      },
      packagingRevisions: [{
        revisionId: packagingRevisionId,
        itemId: packaged.itemId,
        itemRevisionId: packaged.revisionId,
        packageUnit: unitCode("pack"),
        fixedContents: {
          primary: {
            axisId: packaged.primaryAxis.axisId,
            quantity: parseQuantity("2", "piece"),
          },
          independent: [{
            axisId: "weight",
            quantity: parseQuantity("3", "kg"),
          }],
        },
      }],
      fungibilityRevisions: [pool],
      activeFungibilityRevisionIds: { [pool.poolId]: pool.revisionId },
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await inventory.stock.receive({
      operationId: "receive-fixed-measure-packs",
      occurredAtEpochMs: time0,
      to: { itemId: packaged.itemId, placementNodeId: "store" },
      amount: packageAmount(2, packagingRevisionId),
    });

    const ordinary = await inventory.read.planAllocation({
      selector: inventoryStockSelector(packaged.itemId, { placementNodeIds: ["store"] }),
      amount: packageAmount(1, packagingRevisionId),
      method: InventoryAllocationMethod.Fifo,
      atEpochMs: time1,
    });
    expect(ordinary.lines).toHaveLength(1);

    const fungible = await inventory.fungibility.plan({
      fungibilityRevisionId: pool.revisionId,
      requested: parseQuantity("2", "equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time1,
    });
    expect(fungible.lines).toHaveLength(1);
    expect(fungible.lines[0]?.amount).toMatchObject({
      count: 1,
      packagingRevisionId,
    });
    expect(fungible.shortfall.amountMinor).toBe(0);
    expect(fungible.incrementBlockedStock).toBe(false);

    const transferred = await inventory.fungibility.transfer({
      operationId: "transfer-fixed-measure-pack",
      occurredAtEpochMs: time2,
      fungibilityRevisionId: pool.revisionId,
      requested: parseQuantity("2", "equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      toPlacementNodeId: "room",
    });
    expect(transferred.event.stockEffects).toHaveLength(2);
    expect(
      transferred.event.stockEffects.map((effect) => effect.position.packagingRevisionId)
    ).toEqual([packagingRevisionId, packagingRevisionId]);
    expect(
      transferred.event.stockEffects.map((effect) =>
        effect.measurementsDelta.independent.map((entry) => ({
          axisId: entry.axisId,
          amountMinor: entry.quantity.amountMinor,
          unit: entry.quantity.unit,
        }))
      )
    ).toEqual([
      [{ axisId: "weight", amountMinor: 3, unit: "kg" }],
      [{ axisId: "weight", amountMinor: -3, unit: "kg" }],
    ]);
  });

  it("transfers selected member stock without rewriting its item/package/lot identity", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-transfer-new",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "TRANSFER-NEW",
      quantity: "2",
      occurredAtEpochMs: time0,
    });
    const transferred = await inventory.fungibility.transfer({
      operationId: "transfer-fungible-two",
      occurredAtEpochMs: time1,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("2", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      toPlacementNodeId: "room",
    });
    expect(transferred.event.stockEffects).toHaveLength(2);
    expect(
      transferred.event.stockEffects.map(
        /** Verify source and destination retain the same exact member identity. */
        (effect) => [
          effect.position.itemId,
          effect.position.itemRevisionId,
          effect.position.lotId,
          effect.position.placementNodeId,
        ]
      )
    ).toEqual([
      ["new-brand", "new-brand-v1", "TRANSFER-NEW", "room"],
      ["new-brand", "new-brand-v1", "TRANSFER-NEW", "store"],
    ]);
    expect(
      await inventory.read.positions({
        itemId: "new-brand",
        placementNodeIds: ["store"],
      })
    ).toEqual([]);
    expect(
      (
        await inventory.read.positions({
          itemId: "new-brand",
          placementNodeIds: ["room"],
        })
      )[0]?.measurements.primary.quantity.amountMinor
    ).toBe(2);
  });

  it("prefers an unheld member despite an unrelated shortage, then records a held move", async () => {
    const held = defineInventoryItem({
      itemId: "weighed-member", revisionId: "weighed-member-v1",
      primaryAxis: {
        axisId: "pieces", role: InventoryMeasurementAxisRole.Primary,
        unit: unitCode("piece"), requirement: InventoryMeasurementRequirement.Required,
      },
      independentAxes: [{
        axisId: "weight", role: InventoryMeasurementAxisRole.Independent,
        unit: unitCode("kg"), requirement: InventoryMeasurementRequirement.Optional,
      }],
      reservationAxisId: "weight",
      tracking: { lot: InventoryTrackingRequirement.Optional, serial: InventoryTrackingRequirement.Optional },
      qualifiedDimensions: [],
    });
    const unheld = newBrand();
    const unrelated = doubleStrength();
    const pool = defineScalarInventoryFungibilityPool({
      poolId: "weighed-pool", revisionId: "weighed-pool-v1", basisUnit: "equivalent",
      members: [{ item: held }, { item: unheld }],
    });
    const catalog = defineInventoryCatalog({
      itemRevisions: [held, unheld, unrelated],
      activeItemRevisionIds: { [held.itemId]: held.revisionId, [unheld.itemId]: unheld.revisionId, [unrelated.itemId]: unrelated.revisionId },
      fungibilityRevisions: [pool], activeFungibilityRevisionIds: { [pool.poolId]: pool.revisionId },
    });
    const storage = createInMemoryInventoryDurableStorage();
    const inventory = createInventoryOnce({ catalog, storage, clock: clockAt(time3) });
    const source = inventoryStockSelector(held.itemId, { placementNodeIds: ["store"] });
    const requested = parseQuantity("8", "kg");
    await inventory.stock.receive({
      operationId: "receive-weighed-member", occurredAtEpochMs: time0,
      to: { itemId: held.itemId, placementNodeId: "store" },
      amount: measuredStockAmount("4", "piece", [{ axisId: "weight", value: "8", unit: "kg" }]),
    });
    const [position] = await inventory.read.positions(source);
    if (position === undefined) throw new Error("Expected the weighed member position.");
    await inventory.reservations.reserve({
      operationId: "reserve-weighed-member", reservationId: "weighed-hold",
      itemRevisionId: held.revisionId, selector: source, requested, createdAtEpochMs: time1,
    });
    await inventory.reservations.allocate({
      operationId: "allocate-weighed-member", reservationId: "weighed-hold", occurredAtEpochMs: time1,
      allocations: [{ position: position.key, quantity: requested }],
    });
    await receiveMember({ inventory, itemId: unheld.itemId, itemRevisionId: unheld.revisionId,
      lotId: "unheld-member", quantity: "4", operationId: "receive-unheld-member", occurredAtEpochMs: time1 });
    const outside = { itemId: unrelated.itemId, placementNodeId: "elsewhere" };
    const one = stockAmount("1", "piece");
    await inventory.stock.receive({ operationId: "receive-outside-pool", occurredAtEpochMs: time0, to: outside, amount: one });
    await inventory.reservations.reserve({
      operationId: "reserve-outside-pool", reservationId: "outside-pool", itemRevisionId: unrelated.revisionId,
      selector: { itemId: outside.itemId, placementNodeIds: [outside.placementNodeId] },
      requested: parseQuantity("1", "piece"), createdAtEpochMs: time1,
    });
    await inventory.stock.issue({ operationId: "deplete-outside-pool", occurredAtEpochMs: time1, from: outside, amount: one });
    const command = {
      occurredAtEpochMs: time2, fungibilityRevisionId: pool.revisionId, requested: parseQuantity("4", "equivalent"),
      method: InventoryAllocationMethod.Fifo, scope: { placementNodeIds: ["store"] }, toPlacementNodeId: "room",
    };
    const preferred = await inventory.fungibility.transfer({ ...command, operationId: "move-unheld-member" });
    expect(preferred.event.stockEffects.map((effect) => [
      effect.position.itemId, effect.position.placementNodeId, effect.measurementsDelta.primary.quantity,
    ])).toEqual([
      [unheld.itemId, "room", parseQuantity("4", "piece")],
      [unheld.itemId, "store", parseQuantity("-4", "piece")],
    ]);
    expect((await inventory.read.reservationFeasibility(time2)).groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ reservationIds: ["weighed-hold"], shortage: parseQuantity("0", "kg") }),
    ]));
    const physical = await inventory.fungibility.transfer({ ...command, operationId: "move-held-member" });
    expect(physical.event.stockEffects.map((effect) => [
      effect.position.placementNodeId, effect.measurementsDelta.primary.quantity, effect.measurementsDelta.independent[0]?.quantity,
    ])).toEqual([
      ["room", parseQuantity("4", "piece"), parseQuantity("8", "kg")],
      ["store", parseQuantity("-4", "piece"), parseQuantity("-8", "kg")],
    ]);
    expect((await inventory.read.reservationFeasibility(time2)).groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ reservationIds: ["outside-pool"], shortage: parseQuantity("1", "piece") }),
      expect.objectContaining({ reservationIds: ["weighed-hold"], shortage: parseQuantity("8", "kg") }),
    ]));
  });

  it("preserves a broad claim when fungible stock moves into another eligible location", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-transfer-protected-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "TRANSFER-PROTECTED-OLD",
      quantity: "1",
      occurredAtEpochMs: time0,
    });
    await inventory.reservations.reserve({
      reservationId: "cross-location-old-claim",
      operationId: "reserve-cross-location-old",
      itemRevisionId: "old-brand-v1",
      selector: inventoryStockSelector("old-brand", {
        itemRevisionIds: ["old-brand-v1"],
        placementNodeIds: ["store", "room"],
      }),
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });

    const depletedPreview = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time2,
    });
    expect(depletedPreview.lines).toEqual([]);

    const transferPreview = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time2,
      reservationEffect: {
        kind: InventoryFungibilityReservationEffectKind.Transfer,
        toPlacementNodeId: "room",
      },
    });
    expect(transferPreview.lines[0]?.position.itemId).toBe("old-brand");

    await inventory.fungibility.transfer({
      operationId: "transfer-protected-old",
      occurredAtEpochMs: time2,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      toPlacementNodeId: "room",
    });
    expect(
      await inventory.read.positions({
        itemId: "old-brand",
        placementNodeIds: ["store"],
      })
    ).toEqual([]);
    expect(
      (
        await inventory.read.positions({
          itemId: "old-brand",
          placementNodeIds: ["room"],
        })
      )[0]?.measurements.primary.quantity.amountMinor
    ).toBe(1);
    expect((await inventory.read.reservationFeasibility(time3)).status).toBe(
      InventoryReservationFeasibilityStatus.Feasible
    );
  });

  it("publishes a backdated pool issue and retains the later claim as short", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-backdated-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "BACKDATED-OLD",
      quantity: "1",
      occurredAtEpochMs: time0,
    });
    await inventory.reservations.reserve({
      reservationId: "later-old-claim",
      operationId: "reserve-later-old",
      itemRevisionId: "old-brand-v1",
      selector: inventoryStockSelector("old-brand", {
        itemRevisionIds: ["old-brand-v1"],
        placementNodeIds: ["store"],
      }),
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time2,
    });

    await inventory.fungibility.issue({
      operationId: "backdated-pool-issue",
      occurredAtEpochMs: time1,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
    });
    expect(await inventory.read.positions({ itemId: "old-brand" })).toEqual([]);
    expect((await inventory.read.reservationFeasibility(time3)).groups[0]).toMatchObject({
      reservationIds: ["later-old-claim"], shortage: parseQuantity("1", "piece"),
    });
  });

  it("skips a FIFO-preferred member needed by a broad item claim and selects a safe substitute", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-broad-protected-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "BROAD-PROTECTED-OLD",
      quantity: "1",
      occurredAtEpochMs: time0,
    });
    await receiveMember({
      inventory,
      operationId: "receive-broad-free-new",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "BROAD-FREE-NEW",
      quantity: "1",
      occurredAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "broad-old-brand-claim",
      operationId: "reserve-broad-old-brand",
      itemRevisionId: "old-brand-v1",
      selector: inventoryStockSelector("old-brand", {
        itemRevisionIds: ["old-brand-v1"],
        placementNodeIds: ["store"],
      }),
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time2,
    });

    const preview = await inventory.fungibility.plan({
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
      atEpochMs: time3,
    });
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]?.position.itemId).toBe("new-brand");

    const issued = await inventory.fungibility.issue({
      operationId: "issue-around-broad-claim",
      occurredAtEpochMs: time3,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
    });
    expect(issued.event.stockEffects[0]?.position.itemId).toBe("new-brand");
    expect(
      (await inventory.read.positions({ itemId: "old-brand" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(1);
    expect((await inventory.read.reservationFeasibility(time3)).status).toBe(
      InventoryReservationFeasibilityStatus.Feasible
    );
  });

  it("avoids exactly allocated member stock and chooses another fungible member", async () => {
    const catalog = fungibilityCatalog();
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      clock: clockAt(time3),
    });
    await receiveMember({
      inventory,
      operationId: "receive-reserved-old",
      itemId: "old-brand",
      itemRevisionId: "old-brand-v1",
      lotId: "RESERVED-OLD",
      quantity: "1",
      occurredAtEpochMs: time0,
    });
    await receiveMember({
      inventory,
      operationId: "receive-free-new",
      itemId: "new-brand",
      itemRevisionId: "new-brand-v1",
      lotId: "FREE-NEW",
      quantity: "1",
      occurredAtEpochMs: time1,
    });
    await inventory.reservations.reserve({
      reservationId: "old-brand-claim",
      operationId: "reserve-old-brand",
      itemRevisionId: "old-brand-v1",
      selector: inventoryStockSelector("old-brand", {
        itemRevisionIds: ["old-brand-v1"],
        lotIds: ["RESERVED-OLD"],
      }),
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const reserved = (
      await inventory.read.positions({
        itemId: "old-brand",
        lotIds: ["RESERVED-OLD"],
      })
    )[0];
    if (reserved === undefined)
      throw new Error("Reserved old-brand position disappeared.");
    await inventory.reservations.allocate({
      operationId: "allocate-old-brand",
      reservationId: "old-brand-claim",
      allocations: [
        {
          position: reserved.key,
          quantity: parseQuantity("1", "piece"),
        },
      ],
      occurredAtEpochMs: time2,
    });

    const issued = await inventory.fungibility.issue({
      operationId: "issue-free-fungible-member",
      occurredAtEpochMs: time3,
      fungibilityRevisionId: "brand-pool-v1",
      requested: parseQuantity("1", "dose-equivalent"),
      method: InventoryAllocationMethod.Fifo,
      scope: { placementNodeIds: ["store"] },
    });
    expect(issued.event.stockEffects[0]?.position.itemId).toBe("new-brand");
    expect(
      (await inventory.read.positions({ itemId: "old-brand" }))[0]?.measurements
        .primary.quantity.amountMinor
    ).toBe(1);
    expect(await inventory.read.positions({ itemId: "new-brand" })).toEqual([]);
  });
});
