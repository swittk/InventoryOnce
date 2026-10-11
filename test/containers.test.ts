import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  InventoryEventKind,
  InventoryReservationFeasibilityStatus,
  defineScalarInventoryItem,
  extendInventoryCatalog,
  packageAmount,
  parseQuantity,
  stockAmount,
} from "../src/index.js";
import {
  applyInventoryMigrationPlan,
  defineInventoryMigration,
  dryRunInventoryMigration,
} from "../src/migrations-api.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import {
  clockAt,
  createTabletCatalog,
  createTestInventory,
  loosePosition,
  time0,
  time1,
  time2,
  time3,
} from "./test-fixtures.js";

/** Machine-audited bounded operation-family trace identities. */
export const FORMAL_IMPLEMENTATION_TRACE_IDS = [
  "TRACE-PLACEMENT-COMMAND-ATOMIC",
] as const;

/** Node use-by after opening but before the later test authority time. */
const shortUseBy = 1787563800000;
/** Corrected node use-by later than all test authority times. */
const longUseBy = 1798761600000;
/** Source lot expiry later than the short placement-specific use-by. */
const lotExpiryEpochMs = 1830297600000;

/** Add a second item so subtree tests prove heterogeneous stock remains exact. */
function createHeterogeneousPlacementCatalog() {
  const catalog = createTabletCatalog();
  const instrument = defineScalarInventoryItem({
    itemId: "item-b",
    revisionId: "item-b-v1",
    unit: "piece",
    axisId: "pieces",
  });
  return extendInventoryCatalog({
    catalog,
    itemRevisions: [instrument],
    activeItemRevisionIds: { "item-b": instrument.revisionId },
  });
}

/** Return current scalar item-a stock anchored directly at one exact node. */
async function quantityAtNode(
  inventory: ReturnType<typeof createTestInventory>,
  nodeId: string
): Promise<number> {
  const positions = await inventory.read.positions({
    itemId: "item-a",
    placementNodeIds: [nodeId],
  });
  let total = 0;
  for (const position of positions) {
    total += position.measurements.primary.quantity.amountMinor;
  }
  return total;
}

describe("generic placement topology", () => {
  it("moves one ancestor without rewriting heterogeneous descendant stock rows", async () => {
    const catalog = createHeterogeneousPlacementCatalog();
    const inventory = createTestInventory(undefined, catalog);
    await inventory.stock.receiveMany({
      operationId: "receive-placement-subtree",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("PALLET-1", {
            lotId: "OUTER-LOT",
            ownerId: "clinic",
          }),
          amount: stockAmount("3", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          placementNode: { category: "pallet" },
        },
        {
          to: loosePosition("CARTON-1", {
            lotId: "INNER-LOT",
            ownerId: "clinic",
          }),
          amount: packageAmount(30, "item-a-box-20-v1"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
          placementNode: { category: "carton" },
        },
        {
          to: {
            itemId: "item-b",
            placementNodeId: "CARTON-1",
            lotId: "INSTRUMENT-LOT",
            serialId: "INSTRUMENT-001",
            ownerId: "clinic",
          },
          amount: stockAmount("1", "piece"),
          lot: { expiresAtEpochMs: lotExpiryEpochMs },
        },
      ],
    });
    await inventory.placement.move({
      operationId: "place-pallet-in-store",
      occurredAtEpochMs: time1,
      nodeId: "PALLET-1",
      into: "store",
    });
    await inventory.placement.move({
      operationId: "place-carton-on-pallet",
      occurredAtEpochMs: time1,
      nodeId: "CARTON-1",
      into: "PALLET-1",
    });

    const packagedPosition = (
      await inventory.read.positions({
        itemId: "item-a",
        placementNodeIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      })
    )[0];
    if (packagedPosition === undefined) {
      throw new Error("Expected nested package stock.");
    }
    await inventory.reservations.reserve({
      reservationId: "exact-carton-packages",
      operationId: "reserve-carton-packages",
      itemRevisionId: "item-a-v1",
      selector: {
        itemId: "item-a",
        placementNodeIds: ["CARTON-1"],
        packagingRevisionIds: ["item-a-box-20-v1"],
      },
      requested: parseQuantity("600", "piece"),
      createdAtEpochMs: time1,
    });
    await inventory.reservations.allocate({
      operationId: "allocate-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time1,
      allocations: [
        {
          position: packagedPosition.key,
          quantity: parseQuantity("600", "piece"),
        },
      ],
    });

    const beforeKeys = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ].map((position) => position.key);
    const moved = await inventory.placement.move({
      operationId: "move-pallet-to-room",
      occurredAtEpochMs: time2,
      nodeId: "PALLET-1",
      into: "room",
      expectedParent: "store",
    });
    expect(moved.event.kind).toBe(InventoryEventKind.Placement);
    expect(moved.event.stockEffects).toEqual([]);
    expect(moved.event.placementChanges).toEqual([
      {
        nodeId: "PALLET-1",
        fromParentNodeId: "store",
        toParentNodeId: "room",
      },
    ]);
    const afterPositions = [
      ...(await inventory.read.positions({ itemId: "item-a" })),
      ...(await inventory.read.positions({ itemId: "item-b" })),
    ];
    expect(afterPositions.map((position) => position.key)).toEqual(beforeKeys);
    expect(await inventory.read.placementAncestry("CARTON-1")).toEqual([
      "CARTON-1",
      "PALLET-1",
      "room",
    ]);
    expect(
      await inventory.read.positions({
        itemId: "item-a",
        withinPlacementNodeIds: ["room"],
      })
    ).toHaveLength(2);
    expect(
      await inventory.read.positions({
        itemId: "item-b",
        withinPlacementNodeIds: ["room"],
      })
    ).toHaveLength(1);

    await expect(
      inventory.placement.changeContentsStatus({
        operationId: "blocked-subtree-status",
        occurredAtEpochMs: time2,
        nodeId: "PALLET-1",
        toStatusId: "quarantine",
      })
    ).rejects.toThrow("exact reservation bindings");
    await inventory.reservations.release({
      operationId: "release-carton-packages",
      reservationId: "exact-carton-packages",
      occurredAtEpochMs: time2,
    });
    await inventory.placement.changeContentsStatus({
      operationId: "quarantine-subtree",
      occurredAtEpochMs: time2,
      nodeId: "PALLET-1",
      toStatusId: "quarantine",
    });
    expect(
      [
        ...(await inventory.read.positions({ itemId: "item-a" })),
        ...(await inventory.read.positions({ itemId: "item-b" })),
      ].every((position) => position.key.statusId === "quarantine")
    ).toBe(true);
    await inventory.placement.clearContentsStatus({
      operationId: "clear-subtree-status",
      occurredAtEpochMs: time3,
      nodeId: "PALLET-1",
    });
    expect(
      [
        ...(await inventory.read.positions({ itemId: "item-a" })),
        ...(await inventory.read.positions({ itemId: "item-b" })),
      ].every((position) => position.key.statusId === undefined)
    ).toBe(true);
  });

  it("enforces optimistic parents, one parent, target policy, and acyclic topology", async () => {
    const inventory = createTestInventory();
    await inventory.placement.move({
      operationId: "place-a-in-b",
      occurredAtEpochMs: time0,
      nodeId: "A",
      into: "B",
      expectedParent: null,
    });
    await inventory.placement.move({
      operationId: "place-b-in-c",
      occurredAtEpochMs: time0,
      nodeId: "B",
      into: "C",
    });
    await expect(
      inventory.placement.move({
        operationId: "cycle-c-in-a",
        occurredAtEpochMs: time1,
        nodeId: "C",
        into: "A",
      })
    ).rejects.toThrow("cycle");
    await expect(
      inventory.placement.move({
        operationId: "wrong-parent-a",
        occurredAtEpochMs: time1,
        nodeId: "A",
        into: "D",
        expectedParent: "C",
      })
    ).rejects.toThrow("expected parent");
    await inventory.placement.define({
      operationId: "define-closed-node",
      occurredAtEpochMs: time1,
      nodeId: "CLOSED",
      placementNode: { category: "sealed", acceptsPlacement: false },
    });
    await expect(
      inventory.placement.move({
        operationId: "place-into-closed",
        occurredAtEpochMs: time1,
        nodeId: "A",
        into: "CLOSED",
      })
    ).rejects.toThrow("does not accept direct placement");
    await inventory.placement.unplace({
      operationId: "unplace-a",
      occurredAtEpochMs: time2,
      nodeId: "A",
      expectedParent: "B",
    });
    expect(await inventory.read.placementParent("A")).toBeUndefined();
    expect(await inventory.read.placementChildren("B")).toEqual([]);
  });

  it("issues and scraps all positive stock in one placement subtree", async () => {
    const issuedInventory = createTestInventory();
    await issuedInventory.stock.receiveMany({
      operationId: "receive-subtree-to-issue",
      occurredAtEpochMs: time0,
      lines: [
        {
          to: loosePosition("TRAY", { lotId: "ISSUE-A" }),
          amount: stockAmount("2", "piece"),
        },
        {
          to: loosePosition("CHILD", { lotId: "ISSUE-B" }),
          amount: stockAmount("1", "piece"),
        },
      ],
    });
    await issuedInventory.placement.move({
      operationId: "child-in-tray",
      occurredAtEpochMs: time0,
      nodeId: "CHILD",
      into: "TRAY",
    });
    const issued = await issuedInventory.placement.issueContents({
      operationId: "issue-tray-contents",
      occurredAtEpochMs: time1,
      nodeId: "TRAY",
      destinationPartyId: "patient",
    });
    expect(issued.event.kind).toBe(InventoryEventKind.Issue);
    expect(await issuedInventory.read.positions({ itemId: "item-a" })).toEqual(
      []
    );

    const scrappedInventory = createTestInventory();
    await scrappedInventory.stock.receive({
      operationId: "receive-subtree-to-scrap",
      occurredAtEpochMs: time0,
      to: loosePosition("SCRAP-NODE"),
      amount: stockAmount("2", "piece"),
    });
    await scrappedInventory.reservations.reserve({
      reservationId: "broad-scrap-claim",
      operationId: "reserve-before-subtree-scrap",
      itemRevisionId: "item-a-v2",
      selector: { itemId: "item-a" },
      requested: parseQuantity("1", "piece"),
      createdAtEpochMs: time1,
    });
    const scrapped = await scrappedInventory.placement.scrapContents({
      operationId: "scrap-node-contents",
      occurredAtEpochMs: time2,
      nodeId: "SCRAP-NODE",
      reason: "The physical contents were destroyed.",
    });
    expect(scrapped.event.kind).toBe(InventoryEventKind.Scrap);
    expect((await scrappedInventory.read.reservationFeasibility()).status).toBe(
      InventoryReservationFeasibilityStatus.Shortage
    );
  });

  it("inherits the earliest use-by from placement ancestry", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "receive-in-child-node",
      occurredAtEpochMs: time0,
      to: loosePosition("OPEN-VIAL", { lotId: "LOT-ANCESTRY" }),
      amount: stockAmount("5", "piece"),
      lot: { expiresAtEpochMs: lotExpiryEpochMs },
      placementNode: { category: "opened-vial" },
    });
    await inventory.placement.define({
      operationId: "define-short-fridge",
      occurredAtEpochMs: time0,
      nodeId: "FRIDGE",
      placementNode: { category: "cold-storage", useByEpochMs: shortUseBy },
    });
    await inventory.placement.move({
      operationId: "vial-in-fridge",
      occurredAtEpochMs: time0,
      nodeId: "OPEN-VIAL",
      into: "FRIDGE",
    });
    const preview = await inventory.read.planAllocation({
      selector: {
        itemId: "item-a",
        withinPlacementNodeIds: ["FRIDGE"],
      },
      amount: stockAmount("1", "piece"),
      method: InventoryAllocationMethod.Fefo,
      atEpochMs: time2,
    });
    expect(preview.expiredStockWasExcluded).toBe(true);
    expect(preview.lines).toEqual([]);
    expect(preview.shortfall.amountMinor).toBe(1);
  });

  it("corrects, omits, restores, and orders generic node metadata append-only", async () => {
    const inventory = createTestInventory();
    const identifiers = JSON.parse(
      '{"__proto__":"NODE-PROTO","barcode":"NODE-001"}'
    ) as Record<string, string>;
    const defined = await inventory.placement.define({
      operationId: "define-node-z",
      occurredAtEpochMs: time0,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        identifiers,
        openedAtEpochMs: time0,
        useByEpochMs: shortUseBy,
      },
    });
    await inventory.placement.define({
      operationId: "define-node-a",
      occurredAtEpochMs: time0,
      nodeId: "A-NODE",
      placementNode: { category: "ordinary" },
    });
    const projectedIdentifiers = (
      await inventory.read.placementNode("Z-NODE")
    )?.definition.identifiers;
    expect(Object.prototype.hasOwnProperty.call(projectedIdentifiers, "__proto__"))
      .toBe(true);
    expect(projectedIdentifiers?.["__proto__"]).toBe("NODE-PROTO");
    await inventory.placement.correct({
      operationId: "correct-node-z-use-by",
      occurredAtEpochMs: time1,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        identifiers,
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The protocol supplied the wrong use-by.",
    });
    expect(
      (await inventory.read.placementNode("Z-NODE"))?.definition.useByEpochMs
    ).toBe(longUseBy);
    await inventory.placement.correct({
      operationId: "omit-node-z-metadata",
      occurredAtEpochMs: time2,
      nodeId: "Z-NODE",
      reason: "The node metadata assertion was wrong.",
    });
    expect(await inventory.read.placementNode("Z-NODE")).toBeUndefined();
    await expect(
      inventory.placement.define({
        operationId: "cannot-redefine-removed-node",
        occurredAtEpochMs: time2,
        nodeId: "Z-NODE",
        placementNode: { useByEpochMs: longUseBy },
      })
    ).rejects.toThrow("removed by correction");
    await inventory.placement.correct({
      operationId: "restore-node-z-metadata",
      occurredAtEpochMs: time3,
      nodeId: "Z-NODE",
      placementNode: {
        category: "prepared",
        openedAtEpochMs: time0,
        useByEpochMs: longUseBy,
      },
      reason: "The physical node was confirmed.",
    });
    expect(
      (await inventory.read.placementNodes()).map(
        (projected) => projected.definition.nodeId
      )
    ).toEqual(["A-NODE", "Z-NODE"]);
    expect(defined.event.kind).toBe(InventoryEventKind.PlacementNodeMetadata);
  });

  it("carries placement-node masters through reviewed migration opening facts", async () => {
    const catalog = createTabletCatalog();
    const storage = createInMemoryInventoryDurableStorage();
    const plan = defineInventoryMigration({
      catalog,
      declaration: {
        migrationId: "legacy-placement-opening",
        sourceSystem: "legacy-inventory",
        cutoverAtEpochMs: time0,
        openingStock: [
          {
            openingId: "legacy-opened-vial",
            position: loosePosition("LEGACY-VIAL", {
              lotId: "LEGACY-LOT",
            }),
            amount: stockAmount("4", "piece"),
            itemRevisionId: "item-a-v2",
            lot: { expiresAtEpochMs: lotExpiryEpochMs },
            placementNode: {
              category: "opened-vial",
              openedAtEpochMs: time0,
              useByEpochMs: longUseBy,
            },
            source: {
              sourceType: "InventoryStockSubstock",
              sourceId: "legacy-child-1",
            },
          },
        ],
      },
    });
    const dryRun = dryRunInventoryMigration({
      catalog,
      plan,
      targetWorld: await storage.readWorld(),
    });
    await applyInventoryMigrationPlan({
      catalog,
      storage,
      plan,
      dryRun,
      clock: clockAt(time3),
    });
    const inventory = createTestInventory(storage, catalog);
    expect(
      (await inventory.read.placementNode("LEGACY-VIAL"))?.definition
    ).toMatchObject({
      category: "opened-vial",
      openedAtEpochMs: time0,
      useByEpochMs: longUseBy,
    });
    expect(await quantityAtNode(inventory, "LEGACY-VIAL")).toBe(4);
  });
});
