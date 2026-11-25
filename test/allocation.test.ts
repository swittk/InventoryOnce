import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  MAXIMUM_EXACT_ALLOCATION_STATES,
  allocateInventory,
  compareInventoryAllocationCandidates,
  parseQuantity,
  type InventoryAllocationCandidate,
  type InventoryStockPositionKey,
} from "../src/kernel.js";
import { allocateInventoryUpTo, allocateWorkingInventory } from "../src/allocation.js";
import { time0, time1, time2, time3 } from "./test-fixtures.js";

/** Named fields for one revision-qualified allocation candidate fixture. */
interface AllocationCandidateInput {
  /** Stable lot identity used by ordering assertions. */
  readonly lotId: string;
  /** Durable receipt time used by FIFO ordering. */
  readonly receivedAtEpochMs: number;
  /** Lot expiry time used by FEFO and expiry filtering. */
  readonly expiresAtEpochMs: number;
  /** Optional candidate fields varied by the individual test. */
  readonly extra?: Partial<InventoryAllocationCandidate>;
}

/** Build one revision-qualified allocation candidate with a stable lot identity. */
function candidate({
  lotId,
  receivedAtEpochMs,
  expiresAtEpochMs,
  extra = {},
}: AllocationCandidateInput): InventoryAllocationCandidate {
  const position: InventoryStockPositionKey = {
    itemId: "item-a",
    itemRevisionId: "item-a-v2",
    placementNodeId: "store",
    lotId,
  };
  return {
    position,
    available: parseQuantity("5", "piece"),
    receivedAtEpochMs,
    expiresAtEpochMs,
    ...extra,
  };
}

describe("FIFO, FEFO, expiry, priority, and allocation increments", () => {
  it.each([false, true])("returns all storable stock when a large pool cannot fill the request (predicate %s)", (predicate) => {
    const available = parseQuantity("1", "piece");
    const candidates = Array.from({ length: 5_001 }, (_, index) =>
      candidate({ lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3, extra: { available } })
    );
    const result = allocateInventoryUpTo({
      requested: parseQuantity("5002", "piece"),
      candidates,
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
      ...(predicate ? {
        /** The measured witness can accept all physically available rows. */
        acceptAllocations: (lines: readonly { position: InventoryStockPositionKey }[]) => lines.length === candidates.length,
      } : {}),
    });
    expect(result.allocations).toEqual(candidates.map(({ position }) => ({ position, quantity: available })));
    expect(result.shortfall).toEqual(available);
    expect(result.incrementBlockedStock).toBe(false);
  });

  it.each([true, false])("reaches a distant intact increment after an early divisible row (partial %s)", (partial) => {
    const available = parseQuantity("250000", "piece");
    const earlier = candidate({
      lotId: "divisible", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
      extra: { available: parseQuantity("200000", "piece") },
    });
    const later = candidate({
      lotId: "intact", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
      extra: { available, allocationIncrement: available },
    });
    const allocate = partial ? allocateInventoryUpTo : allocateInventory;
    const result = allocate({
      requested: parseQuantity("300001", "piece"),
      candidates: [earlier, later],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(result.allocations).toEqual([
      { position: earlier.position, quantity: parseQuantity("50001", "piece") },
      { position: later.position, quantity: available },
    ]);
    expect(result.shortfall).toEqual(parseQuantity("0", "piece"));
  });

  it("orders signed epoch milliseconds numerically and expires inclusively at zero", () => {
    const instants = [10, -1, 2, -11, 0, -2];
    const fifo = allocateInventory({
      requested: parseQuantity("30", "piece"),
      candidates: instants.map((instant) => candidate({ lotId: String(instant), receivedAtEpochMs: instant, expiresAtEpochMs: Number.MAX_SAFE_INTEGER })),
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: 10,
    });
    expect(fifo.allocations.map((line) => line.position.lotId)).toEqual(["-11", "-2", "-1", "0", "2", "10"]);
    const fefo = allocateInventory({
      requested: parseQuantity("30", "piece"),
      candidates: instants.map((instant) => candidate({ lotId: String(instant), receivedAtEpochMs: Number.MIN_SAFE_INTEGER, expiresAtEpochMs: instant })),
      method: InventoryAllocationMethod.Fefo,
      nowEpochMs: Number.MIN_SAFE_INTEGER,
    });
    expect(fefo.allocations.map((line) => line.position.lotId)).toEqual(["-11", "-2", "-1", "0", "2", "10"]);
    const zeroExpiry = candidate({ lotId: "epoch-zero", receivedAtEpochMs: -1, expiresAtEpochMs: 0 });
    expect(allocateInventory({ requested: parseQuantity("1", "piece"), candidates: [zeroExpiry], method: InventoryAllocationMethod.Fefo, nowEpochMs: -1 }).allocations).toHaveLength(1);
    expect(allocateInventory({ requested: parseQuantity("1", "piece"), candidates: [zeroExpiry], method: InventoryAllocationMethod.Fefo, nowEpochMs: 0 }).allocations).toHaveLength(0);
  });

  it("orders FIFO by receipt and FEFO by expiry", () => {
    const oldReceipt = candidate({ lotId: "old", receivedAtEpochMs: time0, expiresAtEpochMs: time3 });
    const earlyExpiry = candidate({ lotId: "early-expiry", receivedAtEpochMs: time1, expiresAtEpochMs: time2 });
    const fifo = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [earlyExpiry, oldReceipt],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
    });
    const fefo = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [oldReceipt, earlyExpiry],
      method: InventoryAllocationMethod.Fefo,
      nowEpochMs: time1,
    });
    expect(fifo.allocations[0]?.position.lotId).toBe("old");
    expect(fefo.allocations[0]?.position.lotId).toBe("early-expiry");
    expect(compareInventoryAllocationCandidates(oldReceipt, earlyExpiry, InventoryAllocationMethod.Fifo)).toBeLessThan(0);
    expect(compareInventoryAllocationCandidates(oldReceipt, earlyExpiry, InventoryAllocationMethod.Fefo)).toBeGreaterThan(0);
  });

  it("applies explicit priority before date order", () => {
    const result = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [
        candidate({ lotId: "normal", receivedAtEpochMs: time0, expiresAtEpochMs: time2 }),
        candidate({ lotId: "priority", receivedAtEpochMs: time1, expiresAtEpochMs: time3, extra: { priority: -1 } }),
      ],
      method: InventoryAllocationMethod.Fefo,
      nowEpochMs: time1,
    });
    expect(result.allocations[0]?.position.lotId).toBe("priority");
  });

  it("excludes expired stock by default and reports stock blocked by whole increments", () => {
    const expired = candidate({ lotId: "expired", receivedAtEpochMs: time0, expiresAtEpochMs: time1 });
    const excluded = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [expired],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
    });
    expect(excluded.expiredStockWasExcluded).toBe(true);
    expect(excluded.shortfall.amountMinor).toBe(1);

    const incremented = allocateInventory({
      requested: parseQuantity("5", "piece"),
      candidates: [candidate({
        lotId: "pack-sized",
        receivedAtEpochMs: time0,
        expiresAtEpochMs: time3,
        extra: { allocationIncrement: parseQuantity("2", "piece") },
      })],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
    });
    expect(incremented.allocations[0]?.quantity.amountMinor).toBe(4);
    expect(incremented.shortfall.amountMinor).toBe(1);
    expect(incremented.incrementBlockedStock).toBe(true);

    const explicitlyAllowed = allocateInventory({
      requested: parseQuantity("1", "piece"),
      candidates: [expired],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
      allowExpired: true,
    });
    expect(explicitlyAllowed.shortfall.amountMinor).toBe(0);
  });
  it("does not mislabel ordinary constrained shortfall as increment-blocked stock", () => {
    const result = allocateInventory({
      requested: parseQuantity("2", "piece"),
      candidates: [
        candidate({
          lotId: "insufficient",
          receivedAtEpochMs: time0,
          expiresAtEpochMs: time3,
          extra: { available: parseQuantity("1", "piece") },
        }),
      ],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
      acceptAllocations: () => true,
    });
    expect(result.allocations).toEqual([]);
    expect(result.shortfall).toEqual(parseQuantity("2", "piece"));
    expect(result.incrementBlockedStock).toBe(false);
    expect(result.allocationConstraintBlockedStock).toBe(false);
  });

  it.each([
    { requested: "3", available: "4", increment: "2", picked: "2", missing: "1", blocked: true },
    { requested: "5", available: "4", increment: "2", picked: "4", missing: "1", blocked: false },
    { requested: "100002", available: "100001", picked: "100001", missing: "1", blocked: false },
    { requested: "9007199254740991", available: "1.0", picked: "1.0", missing: "9007199254740990", blocked: false },
  ])("finds the bounded exact partial pick for $requested from $available", ({
    requested, available, increment, picked, missing, blocked,
  }) => {
    const result = allocateInventoryUpTo({
      requested: parseQuantity(requested, "piece"),
      candidates: [candidate({
        lotId: "partial", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
        extra: {
          available: parseQuantity(available, "piece"),
          ...(increment === undefined ? {} : { allocationIncrement: parseQuantity(increment, "piece") }),
        },
      })],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
      acceptAllocations: () => true,
    });
    expect(result.allocations[0]?.quantity).toEqual(parseQuantity(picked, "piece"));
    expect(result.shortfall).toEqual(parseQuantity(missing, "piece"));
    expect(result.incrementBlockedStock).toBe(blocked);
  });

  it.each([false, true])("attributes a partial shortage to increments only if the relaxed plan is accepted (%s)", (acceptsThree) => {
    const result = allocateInventoryUpTo({
      requested: parseQuantity("3", "piece"),
      candidates: [candidate({
        lotId: "counted", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
        extra: { available: parseQuantity("4", "piece"), allocationIncrement: parseQuantity("2", "piece") },
      })],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time1,
      /** Model an independent constraint on the selected quantity. */
      acceptAllocations: (choices) => acceptsThree || (choices[0]?.quantity.amountMinor ?? 0) <= 2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual([parseQuantity("2", "piece")]);
    expect(result.shortfall).toEqual(parseQuantity("1", "piece"));
    expect(result.incrementBlockedStock).toBe(acceptsThree);
  });

  it("compares an exact greedy prefix without storing its intermediate remainders", () => {
    const requested = parseQuantity("9007199254740991", "kg");
    const candidates = [
      { lotId: "early", amount: "1.1", receivedAtEpochMs: time0 },
      { lotId: "middle", amount: "1.9", receivedAtEpochMs: time1 },
      { lotId: "last", amount: "9007199254740988", receivedAtEpochMs: time2 },
    ].map(({ lotId, amount, receivedAtEpochMs }) => {
      const quantity = parseQuantity(amount, "kg");
      return candidate({
        lotId, receivedAtEpochMs, expiresAtEpochMs: time3,
        extra: { available: quantity, allocationIncrement: quantity },
      });
    });
    const result = allocateInventory({
      requested, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual(candidates.map((row) => row.available));
    expect(result.shortfall).toEqual(parseQuantity("0", "kg"));
    expect(result.incrementBlockedStock).toBe(false);
  });

  it("skips an unstorable exact trial to use a later whole quantity", () => {
    const requested = parseQuantity(String(Number.MAX_SAFE_INTEGER), "kg");
    const fractional = parseQuantity("1.1", "kg");
    const early = candidate({
      lotId: "fractional", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
      extra: { available: fractional, allocationIncrement: fractional },
    });
    const whole = candidate({
      lotId: "whole", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
      extra: { available: requested },
    });
    const result = allocateInventory({
      requested, candidates: [early, whole], method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.allocations).toEqual([{ position: whole.position, quantity: requested }]);
    expect(result.shortfall).toEqual(parseQuantity("0", "kg"));
    expect(result.incrementBlockedStock).toBe(true);
  });

  it("does not blame an unrelated increment for a storage-driven exact FIFO choice", () => {
    const requested = parseQuantity(String(Number.MAX_SAFE_INTEGER), "kg");
    const rows = ["1.1", String(Number.MAX_SAFE_INTEGER), "0.1"];
    const candidates = rows.map((amount, index) => {
      const available = parseQuantity(amount, "kg");
      return candidate({
        lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: { available, ...(index === 2 ? { allocationIncrement: available } : {}) },
      });
    });
    const result = allocateInventory({
      requested, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["0", parseQuantity("1.0", "kg")],
      ["1", parseQuantity(String(Number.MAX_SAFE_INTEGER - 1), "kg")],
    ]);
    expect(result.shortfall).toEqual(parseQuantity("0", "kg"));
    expect(result.incrementBlockedStock).toBe(false);
  });

  it("skips a band of partial picks that cannot leave a storable remainder", () => {
    const requested = parseQuantity(String(Number.MAX_SAFE_INTEGER), "kg");
    const candidates = ["1.800001", "0.000001"].map((amount, index) => candidate({
      lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
      extra: { available: parseQuantity(amount, "kg") },
    }));
    const result = allocateInventoryUpTo({
      requested, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["0", parseQuantity("1.000000", "kg")],
    ]);
    expect(result.shortfall).toEqual(parseQuantity(String(Number.MAX_SAFE_INTEGER - 1), "kg"));
  });

  it("rules out an exact increment residue outside millions of possible picks", () => {
    const requested = parseQuantity("5000000090000000", "piece");
    const candidates = [100_000_001, 100_000_000].map((increment, index) => candidate({
      lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
      extra: {
        available: parseQuantity(String(increment * 50_000_000), "piece"),
        allocationIncrement: parseQuantity(String(increment), "piece"),
      },
    }));
    const result = allocateInventory({
      requested, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
      /** An exact assignment would satisfy this whole-plan constraint. */
      acceptAllocations: () => true,
    });
    expect(result.allocations).toEqual([]);
    expect(result.shortfall).toEqual(requested);
    expect(result.incrementBlockedStock).toBe(true);
    expect(result.allocationConstraintBlockedStock).toBe(false);
  });

  it("bounds a partial search by the capacity allowed by row increments", () => {
    const result = allocateInventoryUpTo({
      requested: parseQuantity("103", "kg"),
      candidates: [
        candidate({ lotId: "divisible", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
          extra: { available: parseQuantity("100.000001", "kg") } }),
        candidate({ lotId: "incremented", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
          extra: { available: parseQuantity("1.5", "kg"), allocationIncrement: parseQuantity("1", "kg") } }),
      ],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual([
      parseQuantity("100.000001", "kg"), parseQuantity("1.000000", "kg"),
    ]);
    expect(result.shortfall).toEqual(parseQuantity("1.999999", "kg"));
  });

  it.each([false, true])("bounds partial search by reachable increment residues with a unit row %s", (unitRow) => {
    const requested = parseQuantity("200003", "piece");
    const whole = parseQuantity("2", "piece");
    const candidates = ["early", "later"].map((lotId, index) => candidate({
      lotId, receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
      extra: { available: parseQuantity("200002", "piece"), allocationIncrement: whole },
    }));
    if (unitRow) candidates.push(candidate({
      lotId: "unit", receivedAtEpochMs: time2, expiresAtEpochMs: time3,
      extra: { available: parseQuantity("1", "piece") },
    }));
    const result = allocateInventoryUpTo({
      requested, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.shortfall).toEqual(parseQuantity(unitRow ? "0" : "1", "piece"));
    expect(result.allocations.map((line) => [line.position.lotId, line.quantity.amountMinor]))
      .toEqual(unitRow ? [["early", 200002], ["unit", 1]] : [["early", 200002]]);
  });

  it.each([
    { fraction: "0.1", whole: false, blocked: false },
    { fraction: "0.1", whole: true, blocked: false },
    { fraction: "1", whole: true, blocked: true },
  ])("attributes an exact-plan failure to increments only when relaxing them helps: %o", ({ fraction, whole, blocked }) => {
    const requested = parseQuantity(String(Number.MAX_SAFE_INTEGER), "kg");
    const base = candidate({ lotId: "early", receivedAtEpochMs: time0, expiresAtEpochMs: time3 });
    const tail = candidate({
      lotId: "later", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
      extra: { available: parseQuantity(fraction, "kg") },
    });
    const result = allocateWorkingInventory({
      requested,
      candidates: [
        {
          ...base,
          available: { ...requested, amountMinor: BigInt(requested.amountMinor) * 10n - 1n, decimals: 1 },
          ...(whole ? { allocationIncrement: parseQuantity("4", "kg") } : {}),
        },
        tail,
      ],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
      // A measured constraint rejects every assignment in these capacity controls.
      acceptAllocations: () => false,
    });
    expect(result).toMatchObject({ incrementBlockedStock: blocked, allocationConstraintBlockedStock: false });
  });

  it("skips unstoreable nonterminal picks without exhausting the choice budget", () => {
    const requested = parseQuantity(String(Number.MAX_SAFE_INTEGER), "kg");
    const fractional = parseQuantity("0.100001", "kg");
    const result = allocateInventory({
      requested,
      candidates: [
        candidate({ lotId: "early", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
          extra: { available: fractional, allocationIncrement: fractional } }),
        candidate({ lotId: "large", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
          extra: { available: requested } }),
        candidate({ lotId: "last", receivedAtEpochMs: time2, expiresAtEpochMs: time3,
          extra: { available: parseQuantity("1", "kg") } }),
      ],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual([
      fractional, parseQuantity("9007199254740990", "kg"), parseQuantity("0.899999", "kg"),
    ]);
    expect(result.shortfall).toEqual(parseQuantity("0", "kg"));
  });

  it.each([
    { increment: undefined, picked: "1.000000", missing: "9007199254740990" },
    { increment: "0.000008", picked: "1.000000", missing: "9007199254740990" },
    { increment: "0.000003", picked: undefined, missing: "9007199254740991" },
  ])("skips terminal picks with unstorable shortfalls at increment $increment", ({ increment, picked, missing }) => {
    const result = allocateInventoryUpTo({
      requested: parseQuantity("9007199254740991", "kg"),
      candidates: [candidate({
        lotId: "fractional", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
        extra: {
          available: parseQuantity("1.999999", "kg"),
          ...(increment === undefined ? {} : { allocationIncrement: parseQuantity(increment, "kg") }),
        },
      })],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual(
      picked === undefined ? [] : [parseQuantity(picked, "kg")],
    );
    expect(result.shortfall).toEqual(parseQuantity(missing, "kg"));
  });

  it("aligns the final pick with the remainder left by a fractional FIFO prefix", () => {
    const early = parseQuantity("0.1", "kg");
    const result = allocateInventoryUpTo({
      requested: parseQuantity("9007199254740991", "kg"),
      candidates: [
        candidate({
          lotId: "early", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
          extra: { available: early, allocationIncrement: early },
        }),
        candidate({
          lotId: "last", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
          extra: { available: parseQuantity("1.999999", "kg"), allocationIncrement: parseQuantity("0.000008", "kg") },
        }),
      ],
      method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    });
    expect(result.allocations.map((line) => line.quantity)).toEqual([
      parseQuantity("0.100000", "kg"), parseQuantity("1.900000", "kg"),
    ]);
    expect(result.shortfall).toEqual(parseQuantity("9007199254740989", "kg"));
  });

  it("rejects an invalid requested decimal scale before returning shortfall", () => {
    const requested = { ...parseQuantity("1", "piece"), decimals: 19 };
    expect(() =>
      allocateInventory({
        requested,
        candidates: [],
        method: InventoryAllocationMethod.Fifo,
        nowEpochMs: time1,
      }),
    ).toThrow("Quantity decimals must be an integer");
  });

  it("fails with the domain search-bound error before recursive candidate depth can overflow", () => {
    const deepCandidates = Array.from({ length: 7_000 }, (_, index) =>
      candidate({
        lotId: `deep-${index}`,
        receivedAtEpochMs: time0,
        expiresAtEpochMs: time3,
        extra: {
          available: parseQuantity("1", "piece"),
          allocationIncrement: parseQuantity("1", "piece"),
        },
      })
    );
    expect(() => allocateInventory({
      requested: parseQuantity("7000", "piece"),
      candidates: deepCandidates,
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
      /** Reject the maximum-capacity witness so a real search is required. */
      acceptAllocations: () => false,
    })).toThrow("safe search bound");
  });

  it("fails closed at a bounded exact-search budget instead of looping on adversarial predicates", () => {
    const capacity = String(MAXIMUM_EXACT_ALLOCATION_STATES + 1);
    expect(() => allocateInventory({
      requested: parseQuantity(capacity, "piece"),
      candidates: [
        candidate({
          lotId: "rejected-first",
          receivedAtEpochMs: time0,
          expiresAtEpochMs: time3,
          extra: { available: parseQuantity(capacity, "piece") },
        }),
        candidate({
          lotId: "acceptable-second",
          receivedAtEpochMs: time1,
          expiresAtEpochMs: time3,
          extra: { available: parseQuantity(capacity, "piece") },
        }),
      ],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
      /** Reject every complete allocation using the preferred first row. */
      acceptAllocations: (allocations) => allocations.every(
        /** Keep only plans that entirely avoid the first candidate. */
        (allocation) => allocation.position.lotId !== "rejected-first",
      ),
    })).toThrow("safe search bound");
  });

});
