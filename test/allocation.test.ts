import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  MAXIMUM_EXACT_ALLOCATION_STATES,
  allocateInventory,
  parseQuantity,
  type InventoryAllocationCandidate,
  type InventoryStockPositionKey,
} from "../src/kernel.js";
import { time0, time1, time2, time3 } from "./test-fixtures.js";

/** Build one revision-qualified allocation candidate with a stable lot identity. */
function candidate(
  lotId: string,
  receivedAt: string,
  expiresAt: string,
  extra: Partial<InventoryAllocationCandidate> = {},
): InventoryAllocationCandidate {
  const position: InventoryStockPositionKey = {
    itemId: "item-a",
    itemRevisionId: "item-a-v2",
    locationId: "store",
    lotId,
  };
  return {
    position,
    available: parseQuantity("5", "piece"),
    receivedAt,
    expiresAt,
    ...extra,
  };
}

describe("FIFO, FEFO, expiry, priority, and allocation increments", () => {
  it("orders FIFO by receipt and FEFO by expiry", () => {
    const oldReceipt = candidate("old", time0, time3);
    const earlyExpiry = candidate("early-expiry", time1, time2);
    const fifo = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [earlyExpiry, oldReceipt],
      method: InventoryAllocationMethod.Fifo,
      now: time1,
    });
    const fefo = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [oldReceipt, earlyExpiry],
      method: InventoryAllocationMethod.Fefo,
      now: time1,
    });
    expect(fifo.allocations[0]?.position.lotId).toBe("old");
    expect(fefo.allocations[0]?.position.lotId).toBe("early-expiry");
  });

  it("applies explicit priority before date order", () => {
    const result = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [
        candidate("normal", time0, time2),
        candidate("priority", time1, time3, { priority: -1 }),
      ],
      method: InventoryAllocationMethod.Fefo,
      now: time1,
    });
    expect(result.allocations[0]?.position.lotId).toBe("priority");
  });

  it("excludes expired stock by default and reports stock blocked by whole increments", () => {
    const expired = candidate("expired", time0, time1);
    const excluded = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [expired],
      method: InventoryAllocationMethod.Fifo,
      now: time1,
    });
    expect(excluded.expiredStockWasExcluded).toBe(true);
    expect(excluded.shortfall.amountMinor).toBe(1);

    const incremented = allocateInventory({
      requested: parseQuantity("5", "piece"),
      candidates: [candidate("pack-sized", time0, time3, {
        allocationIncrement: parseQuantity("2", "piece"),
      })],
      method: InventoryAllocationMethod.Fifo,
      now: time1,
    });
    expect(incremented.allocations[0]?.quantity.amountMinor).toBe(4);
    expect(incremented.shortfall.amountMinor).toBe(1);
    expect(incremented.incrementBlockedStock).toBe(true);

    const explicitlyAllowed = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [expired],
      method: InventoryAllocationMethod.Fifo,
      now: time1,
      allowExpired: true,
    });
    expect(explicitlyAllowed.shortfall.amountMinor).toBe(0);
  });
  it("does not mislabel ordinary constrained shortfall as increment-blocked stock", () => {
    const result = allocateInventory({
      requested: parseQuantity("2", "piece"),
      candidates: [
        candidate("insufficient", time0, time3, {
          available: parseQuantity("1", "piece"),
        }),
      ],
      method: InventoryAllocationMethod.Fifo,
      now: time1,
      acceptAllocations: () => true,
    });
    expect(result.allocations).toEqual([]);
    expect(result.shortfall).toEqual(parseQuantity("2", "piece"));
    expect(result.incrementBlockedStock).toBe(false);
    expect(result.allocationConstraintBlockedStock).toBe(false);
  });

  it("rejects an invalid requested decimal scale before returning shortfall", () => {
    const requested = { ...parseQuantity("1", "piece"), decimals: 19 };
    expect(() =>
      allocateInventory({
        requested,
        candidates: [],
        method: InventoryAllocationMethod.Fifo,
        now: time1,
      }),
    ).toThrow("Quantity decimals must be an integer");
  });

  it("fails with the domain search-bound error before recursive candidate depth can overflow", () => {
    const deepCandidates = Array.from({ length: 7_000 }, (_, index) =>
      candidate(`deep-${index}`, time0, time3, {
        available: parseQuantity("1", "piece"),
        allocationIncrement: parseQuantity("1", "piece"),
      })
    );
    expect(() => allocateInventory({
      requested: parseQuantity("7000", "piece"),
      candidates: deepCandidates,
      method: InventoryAllocationMethod.Fifo,
      now: time2,
    })).toThrow("safe search bound");
  });

  it("fails closed at a bounded exact-search budget instead of looping on adversarial predicates", () => {
    const capacity = String(MAXIMUM_EXACT_ALLOCATION_STATES + 1);
    expect(() => allocateInventory({
      requested: parseQuantity(capacity, "piece"),
      candidates: [
        candidate("rejected-first", time0, time3, {
          available: parseQuantity(capacity, "piece"),
        }),
        candidate("acceptable-second", time1, time3, {
          available: parseQuantity(capacity, "piece"),
        }),
      ],
      method: InventoryAllocationMethod.Fifo,
      now: time2,
      /** Reject every complete allocation using the preferred first row. */
      acceptAllocations: (allocations) => allocations.every(
        /** Keep only plans that entirely avoid the first candidate. */
        (allocation) => allocation.position.lotId !== "rejected-first",
      ),
    })).toThrow("safe search bound");
  });

});
