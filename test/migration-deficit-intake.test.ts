import { describe, expect, it } from "vitest";
import { InventoryMigrationPlanStatus, defineInventoryMigration } from "../src/migrations-api.js";
import { InventoryStockWhereaboutsState, stockAmount, type InventoryStockPositionInput } from "../src/index.js";
import { createTabletCatalog, time0 } from "./test-fixtures.js";

describe("legacy deficit migration lifecycle boundary", () => {
  it("blocks an unplaced deficit carrying an externally selected whereabouts identity", () => {
    // The old declaration type accepts a coherent unplaced position from a plugin.
    const position: InventoryStockPositionInput = {
      itemId: "item-a",
      whereaboutsId: "external-cohort",
      whereaboutsState: InventoryStockWhereaboutsState.Missing,
      lastPlacementNodeId: "room-a",
      detachedAtEpochMs: time0 - 2_000,
      missingAtEpochMs: time0 - 1_000,
    };
    const plan = defineInventoryMigration({
      catalog: createTabletCatalog(),
      declaration: {
        migrationId: "legacy-negative-cohort",
        sourceSystem: "legacy",
        cutoverAtEpochMs: time0,
        openingStock: [],
        deficitStock: [{
          deficitId: "old-shortage",
          // @ts-expect-error Legacy source plugins can still return a broad position at runtime.
          position,
          amount: stockAmount("2", "piece"),
          source: { sourceType: "stock-ledger", sourceId: "negative-row" },
        }],
      },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Blocked);
    expect(plan.diagnostics.some(d => d.message.includes("whereabouts"))).toBe(true);
  });

  it("still accepts a known-placement deficit with preserved source provenance", () => {
    const plan = defineInventoryMigration({
      catalog: createTabletCatalog(),
      declaration: {
        migrationId: "known-placed-deficit",
        sourceSystem: "legacy",
        cutoverAtEpochMs: time0,
        openingStock: [],
        deficitStock: [{
          deficitId: "registered-shortage",
          position: { itemId: "item-a", placementNodeId: "store-a" },
          amount: stockAmount("2", "piece"),
          source: { sourceType: "stock-ledger", sourceId: "negative-row-2" },
        }],
      },
    });
    expect(plan.status).toBe(InventoryMigrationPlanStatus.Ready);
    expect(plan.events[0]?.stockEffects[0]?.position.placementNodeId).toBe("store-a");
  });
});
