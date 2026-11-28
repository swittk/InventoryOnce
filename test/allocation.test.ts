import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  MAXIMUM_EXACT_ALLOCATION_STATES,
  allocateInventory,
  compareInventoryAllocationCandidates,
  compareQuantity,
  parseQuantity,
  type InventoryAllocationCandidate,
  type InventoryStockPositionKey,
} from "../src/kernel.js";
import {
  InventoryDeficitPolicy,
  InventoryMeasurementAxisRole,
  InventoryMeasurementRequirement,
  InventoryTrackingRequirement,
  createInventoryOnce,
  defineInventoryCatalog,
  defineInventoryItem,
  defineInventoryPackaging,
  inventoryMeasurementVector,
  inventoryStockSelector,
  measuredStockAmount,
  packageAmount,
  stockAmount,
  unitCode,
} from "../src/index.js";
import { createInMemoryInventoryDurableStorage } from "../src/storage-api.js";
import { allocateInventoryUpTo, allocateWorkingInventory, type InventoryAllocation } from "../src/allocation.js";
import { quantityWholeMultipleCount } from "../src/quantity.js";
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
  it("agrees with independent exact enumeration for measured and relaxed picks", () => {
    /** Each tuple gives primary capacity, legal increment, and per-piece measures on two axes. */
    const scenarios = [
      { rows: [[4, 1, 0, 0], [1, 1, 1, 0], [1, 1, 0, 1]], request: [3, 1, 1] },
      { rows: [[3, 1, 0, 0], [1, 1, 1, 1], [1, 1, 0, 1]], request: [3, 1, 1] },
      { rows: [[2, 2, 0, 0], [1, 1, 1, 1]], request: [2, 1, 1] },
      { rows: [[2, 2, 0, 0], [1, 1, 2, 1]], request: [2, 1, 1] },
      { rows: [[1, 1, 1, 0], [1, 1, 0, 1]], request: [4, 2, 2] },
      { rows: [[2, 2, 0, 0], [1, 1, 1, 1], [2, 1, 0, 0]], request: [3, 1, 1] },
      { rows: [[2, 2, 1, 1], [2, 1, 0, 0]], request: [3, 1, 1] },
    ] as const;
    for (const { rows, request: [primary, firstAxis, secondAxis] } of scenarios) {
      /** Exhaust every small integer assignment independently of the production pruning rules. */
      const enumerate = (partial: boolean, relaxed: boolean, constrained = true) => {
        let best: { picks: number[]; total: number } | undefined;
        const visit = (index: number, picks: number[], total: number, first: number, second: number): void => {
          const row = rows[index];
          if (row === undefined) {
            const full = total === primary;
            if ((!full && !partial) || total > primary) return;
            if (constrained && (first > firstAxis || second > secondAxis ||
                (full && (first !== firstAxis || second !== secondAxis)))) return;
            if (best === undefined || total > best.total) best = { picks, total };
            return;
          }
          const [capacity, increment, firstPerPiece, secondPerPiece] = row;
          const step = relaxed && firstPerPiece === 0 && secondPerPiece === 0 ? 1 : increment;
          // Visiting amounts in descending order makes the first equal total the FIFO winner.
          for (let take = capacity - capacity % step; take >= 0; take -= step) {
            visit(index + 1, [...picks, take], total + take, first + take * firstPerPiece, second + take * secondPerPiece);
          }
        };
        visit(0, [], 0, 0, 0);
        return best;
      };
      const candidates = rows.map(([capacity, increment, first, second], index) => candidate({
        lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: {
          available: parseQuantity(String(capacity), "piece"),
          ...(increment === 1 ? {} : { allocationIncrement: parseQuantity(String(increment), "piece") }),
        },
      }));
      const rowsByPosition = new Map(candidates.map((entry, index) => [entry.position, rows[index]!]));
      const input = {
        requested: parseQuantity(String(primary), "piece"), candidates,
        method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
        /** Match all requested axes for full picks and avoid overshoot for partial picks. */
        acceptAllocations: (allocations: readonly InventoryAllocation[]) => {
          let total = 0, first = 0, second = 0;
          for (const { position, quantity } of allocations) {
            const measured = rowsByPosition.get(position);
            if (measured === undefined) throw new Error("Unknown oracle position.");
            const take = quantity.amountMinor;
            if (measured[1] > 1 && (measured[2] !== 0 || measured[3] !== 0) && take % measured[1] !== 0) return false;
            total += take;
            first += take * measured[2];
            second += take * measured[3];
          }
          return first <= firstAxis && second <= secondAxis &&
            (total < primary || (first === firstAxis && second === secondAxis));
        },
      };
      for (const partial of [false, true]) {
        const expected = enumerate(partial, false);
        const relaxed = enumerate(partial, true);
        const result = partial ? allocateInventoryUpTo(input) : allocateWorkingInventory(input);
        expect(result.allocations).toEqual(
          (expected?.picks ?? []).flatMap((take, index) =>
            take === 0
              ? []
              : [{ position: candidates[index]!.position, quantity: parseQuantity(String(take), "piece") }],
          ),
        );
        expect(result.shortfall).toEqual(parseQuantity(String(primary - (expected?.total ?? 0)), "piece"));
        const incrementBlocked = relaxed !== undefined && (partial && expected?.total !== primary
          ? relaxed.total > (expected?.total ?? 0)
          : JSON.stringify(relaxed.picks) !== JSON.stringify(expected?.picks));
        expect(result.incrementBlockedStock).toBe(incrementBlocked);
        expect(result.allocationConstraintBlockedStock).toBe(expected === undefined && enumerate(false, false, false) !== undefined);
      }
    }
  });

  it.each([false, true])("accepts a small greedy pick from a large pool (predicate %s)", (predicate) => {
    const available = parseQuantity("1", "piece");
    const candidates = Array.from({ length: 5_001 }, (_, index) =>
      candidate({ lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3, extra: { available } })
    );
    expect(allocateInventory({
      requested: available, candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
      ...(predicate ? { acceptAllocations: () => true } : {}),
    })).toMatchObject({
      allocations: [{ position: { lotId: "0" }, quantity: available }],
      shortfall: parseQuantity("0", "piece"),
    });
  });

  it("reports an increment that rounded an otherwise exact greedy pick", () => {
    const candidates = [
      candidate({ lotId: "early", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
        extra: { available: parseQuantity("4", "piece"), allocationIncrement: parseQuantity("2", "piece") } }),
      candidate({ lotId: "late", receivedAtEpochMs: time1, expiresAtEpochMs: time3,
        extra: { available: parseQuantity("1", "piece") } }),
    ];
    expect(allocateInventory({
      requested: parseQuantity("3", "piece"), candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    })).toMatchObject({
      allocations: [
        { position: { lotId: "early" }, quantity: parseQuantity("2", "piece") },
        { position: { lotId: "late" }, quantity: parseQuantity("1", "piece") },
      ],
      shortfall: parseQuantity("0", "piece"),
      incrementBlockedStock: true,
    });
  });

  it("keeps a valid package allocation when a relaxed trial cannot build its amounts", () => {
    const candidates = ["2", "3"].map((lotId, index) => {
      const capacity = parseQuantity(lotId, "piece");
      return candidate({
        lotId, receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: { available: capacity, allocationIncrement: capacity },
      });
    });
    expect(allocateInventory({
      requested: parseQuantity("3", "piece"), candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
      acceptAllocations: (allocations) => allocations.every((line) =>
        quantityWholeMultipleCount(line.quantity, parseQuantity(line.position.lotId ?? "0", "piece")) > 0
      ),
    })).toMatchObject({
      allocations: [{ position: { lotId: "3" }, quantity: parseQuantity("3", "piece") }],
      shortfall: parseQuantity("0", "piece"), incrementBlockedStock: false,
    });
  });

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
    expect(result.allocations).toMatchObject([{ position: { lotId: "partial" }, quantity: parseQuantity(picked, "piece") }]);
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
    expect(result.allocations).toMatchObject([{ position: { lotId: "counted" }, quantity: parseQuantity("2", "piece") }]);
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
    expect(result.allocations).toEqual(candidates.map(({ position, available }) => ({ position, quantity: available })));
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
    expect(result.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["divisible", parseQuantity("100.000001", "kg")], ["incremented", parseQuantity("1.000000", "kg")],
    ]);
    expect(result.shortfall).toEqual(parseQuantity("1.999999", "kg"));
  });

  it("skips a fine primary gap between whole suffix sums with divisible stock", () => {
    const rows = [["2.963254", false], ["1.447908", false], ["0.9", true], ["0.3", true], ["0.1", false]] as const;
    const candidates = rows.map(([amount, whole], index) => {
      const available = parseQuantity(amount, "piece");
      return candidate({ lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: { available, ...(whole ? { allocationIncrement: available } : {}) } });
    });
    const pick = allocateInventory({ requested: parseQuantity("5.412524", "piece"), candidates,
      method: InventoryAllocationMethod.Fifo, nowEpochMs: time2 });
    expect(pick.shortfall).toEqual(parseQuantity("0.000000", "piece"));
    expect(pick.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["0", parseQuantity("2.963254", "piece")], ["1", parseQuantity("1.249270", "piece")],
      ["2", parseQuantity("0.900000", "piece")], ["3", parseQuantity("0.300000", "piece")],
    ]);
  });

  it.each(["exact", "best", "partial"])("skips gaps between reachable whole suffix sums for an %s search", (mode) => {
    const candidates = ["200000", "250000", "250001"].map((value, index) => {
      const available = parseQuantity(value, "piece");
      return candidate({
        lotId: String(index), receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: { available, ...(index === 0 ? {} : { allocationIncrement: available }) },
      });
    });
    const input = {
      requested: parseQuantity("500001", "piece"), candidates, method: InventoryAllocationMethod.Fifo, nowEpochMs: time2,
    };
    const result = mode === "exact" ? allocateInventory(input) : allocateInventoryUpTo({
      ...input, assessIncrementBlockage: false,
      /** Permit the exact suffix or require the best earlier partial witness. */
      acceptAllocations: (lines) => mode === "best" || lines[0]?.position.lotId === "0",
    });
    expect(result.allocations.map((line) => [line.position.lotId, line.quantity])).toEqual(mode !== "partial"
      ? [["1", parseQuantity("250000", "piece")], ["2", parseQuantity("250001", "piece")]]
      : [["0", parseQuantity("200000", "piece")], ["2", parseQuantity("250001", "piece")]]);
    expect(result.shortfall).toEqual(parseQuantity(mode === "partial" ? "50000" : "0", "piece"));
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
    expect(result.allocations.map((line) => [line.position.lotId, line.quantity]))
      .toEqual(unitRow
        ? [["early", parseQuantity("200002", "piece")], ["unit", parseQuantity("1", "piece")]]
        : [["early", parseQuantity("200002", "piece")]]);
  });

  it.each([
    { fraction: "0.1", whole: false, blocked: false },
    { fraction: "0.1", whole: true, blocked: false },
    { fraction: "1", whole: true, blocked: false },
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
    expect(result).toMatchObject({
      allocations: [], shortfall: requested, incrementBlockedStock: blocked, allocationConstraintBlockedStock: false,
    });
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
    expect(result.allocations).toMatchObject([
      { position: { lotId: "early" }, quantity: fractional },
      { position: { lotId: "large" }, quantity: parseQuantity("9007199254740990", "kg") },
      { position: { lotId: "last" }, quantity: parseQuantity("0.899999", "kg") },
    ]);
    expect(result.shortfall).toEqual(parseQuantity("0", "kg"));
  });

  it.each([
    { increment: undefined, picked: "1.000000", missing: "9007199254740990" },
    { increment: "0.000008", picked: "1.000000", missing: "9007199254740990" },
    { increment: "0.000003", picked: undefined, missing: "9007199254740991" },
  ])("skips terminal picks with unstorable shortfalls at increment $increment", ({ increment, picked, missing }) => {
    const fracCandidate = candidate({
      lotId: "fractional", receivedAtEpochMs: time0, expiresAtEpochMs: time3,
      extra: {
        available: parseQuantity("1.999999", "kg"),
        ...(increment === undefined ? {} : { allocationIncrement: parseQuantity(increment, "kg") }),
      },
    });
    const result = allocateInventoryUpTo({
      requested: parseQuantity("9007199254740991", "kg"),
      candidates: [fracCandidate],
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(result.allocations).toEqual(
      picked === undefined ? [] : [{ position: fracCandidate.position, quantity: parseQuantity(picked, "kg") }],
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
    expect(result.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["early", parseQuantity("0.100000", "kg")], ["last", parseQuantity("1.900000", "kg")],
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

  it("preserves exact and partial picks and relaxed diagnostics across pruned whole rows", () => {
    const retained = [4, 3, 3].map((pieces, index) => {
      const amount = parseQuantity(String(pieces), "piece");
      return candidate({ lotId: `retained-${index}`, receivedAtEpochMs: time0 + index, expiresAtEpochMs: time3,
        extra: { available: amount, allocationIncrement: amount } });
    });
    const oversized = parseQuantity("7.000", "piece");
    const padding = Array.from({ length: 4_998 }, (_, index) => candidate({
      lotId: `oversized-${index}`, receivedAtEpochMs: time1 + index, expiresAtEpochMs: time3,
      extra: { available: oversized, allocationIncrement: oversized },
    }));
    const input = { candidates: [...retained, ...padding], method: InventoryAllocationMethod.Fifo, nowEpochMs: time2 };
    const exact = allocateInventory({ ...input, requested: parseQuantity("6", "piece") });
    expect(exact.allocations.map(({ position, quantity }) => [position.lotId, quantity])).toEqual([
      ["retained-1", parseQuantity("3.000", "piece")], ["retained-2", parseQuantity("3.000", "piece")],
    ]);
    expect(exact.shortfall).toEqual(parseQuantity("0", "piece"));
    expect(exact.incrementBlockedStock).toBe(true);
    const partial = allocateInventoryUpTo({ ...input, requested: parseQuantity("5", "piece") });
    expect(partial.allocations.map(({ position, quantity }) => [position.lotId, quantity]))
      .toEqual([["retained-0", parseQuantity("4.000", "piece")]]);
    expect(partial.shortfall).toEqual(parseQuantity("1.000", "piece"));
    expect(partial.incrementBlockedStock).toBe(true);
    const unavailable = allocateInventory({ ...input, requested: parseQuantity("1", "piece") });
    expect(unavailable).toMatchObject({ allocations: [], shortfall: parseQuantity("1", "piece"), incrementBlockedStock: true });
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

  it("retains multi-increment whole-row suffix sums for single-axis measured witness search", async () => {
    const item = defineInventoryItem({
      itemId: "measured-liquid",
      revisionId: "measured-liquid-v1",
      tracking: {
        lot: InventoryTrackingRequirement.Optional,
        serial: InventoryTrackingRequirement.Forbidden,
      },
      qualifiedDimensions: [],
      reservationAxisId: "mass",
      primaryAxis: {
        axisId: "mass",
        role: InventoryMeasurementAxisRole.Primary,
        unit: unitCode("kg"),
        requirement: InventoryMeasurementRequirement.Required,
      },
      independentAxes: [
        {
          axisId: "vol",
          role: InventoryMeasurementAxisRole.Independent,
          unit: unitCode("l"),
          requirement: InventoryMeasurementRequirement.Optional,
        },
      ],
    });
    const pkg2 = defineInventoryPackaging(
      {
        revisionId: "pkg-2kg",
        itemId: "measured-liquid",
        itemRevisionId: "measured-liquid-v1",
        packageUnit: unitCode("jug"),
        fixedContents: inventoryMeasurementVector(
          { axisId: "mass", quantity: parseQuantity("2", "kg") },
          [{ axisId: "vol", quantity: parseQuantity("0.5", "l") }],
        ),
      },
      item,
    );
    const pkg3 = defineInventoryPackaging(
      {
        revisionId: "pkg-3kg",
        itemId: "measured-liquid",
        itemRevisionId: "measured-liquid-v1",
        packageUnit: unitCode("drum"),
        fixedContents: inventoryMeasurementVector(
          { axisId: "mass", quantity: parseQuantity("3.000001", "kg") },
          [{ axisId: "vol", quantity: parseQuantity("0.5", "l") }],
        ),
      },
      item,
    );
    const catalog = defineInventoryCatalog({
      itemRevisions: [item],
      activeItemRevisionIds: { "measured-liquid": item.revisionId },
      packagingRevisions: [pkg2, pkg3],
    });
    const inventory = createInventoryOnce({
      catalog,
      storage: createInMemoryInventoryDurableStorage(),
      deficitPolicy: InventoryDeficitPolicy.Record,
      clock: { nowEpochMs: () => time3 },
    });
    const bin = { itemId: "measured-liquid", placementNodeId: "bin" };
    await inventory.stock.receive({
      operationId: "suffix-multi-r1",
      occurredAtEpochMs: time0,
      to: { ...bin, lotId: "loose-lot" },
      amount: stockAmount("5", "kg"),
    });
    await inventory.stock.receive({
      operationId: "suffix-multi-r2",
      occurredAtEpochMs: time1,
      to: { ...bin, lotId: "jug-lot" },
      amount: packageAmount(2, "pkg-2kg"),
    });
    await inventory.stock.receive({
      operationId: "suffix-multi-r3",
      occurredAtEpochMs: time2,
      to: { ...bin, lotId: "drum-lot" },
      amount: packageAmount(2, "pkg-3kg"),
    });
    const transferred = await inventory.stock.transferByPolicy({
      operationId: "suffix-multi-transfer",
      occurredAtEpochMs: time3,
      selector: inventoryStockSelector("measured-liquid", { placementNodeIds: ["bin"] }),
      toPlacementNodeId: "out",
      method: InventoryAllocationMethod.Fifo,
      amount: measuredStockAmount("10.000002", "kg", [{ axisId: "vol", value: "1", unit: "l" }]),
    });
    expect(transferred.event.stockEffects).toHaveLength(4);
    for (const [placement, sign] of [["bin", "-"], ["out", ""]] as const) {
      const loose = transferred.event.stockEffects.find(
        /** Identify the loose source debit or destination credit. */
        ({ position }) => position.placementNodeId === placement && position.lotId === "loose-lot",
      );
      const drum = transferred.event.stockEffects.find(
        /** Identify the matching whole-drum movement. */
        ({ position }) => position.placementNodeId === placement && position.lotId === "drum-lot",
      );
      if (loose === undefined || drum === undefined) throw new Error(`Missing measured movement at '${placement}'.`);
      const [volume] = drum.measurementsDelta.independent;
      if (volume === undefined) throw new Error(`Missing drum volume at '${placement}'.`);
      expect(loose.position.packagingRevisionId).toBeUndefined();
      expect(loose.measurementsDelta.independent).toEqual([]);
      expect(drum.position.packagingRevisionId).toBe(pkg3.revisionId);
      expect(compareQuantity(loose.measurementsDelta.primary.quantity, parseQuantity(sign + "4", "kg"))).toBe(0);
      expect(compareQuantity(drum.measurementsDelta.primary.quantity, parseQuantity(sign + "6.000002", "kg"))).toBe(0);
      expect(drum.measurementsDelta.independent).toHaveLength(1);
      expect(volume.axisId).toBe("vol");
      expect(compareQuantity(volume.quantity, parseQuantity(sign + "1", "l"))).toBe(0);
    }
    expect(transferred.event.unwitnessedStockMovements).toBeUndefined();
  });

  it("clears incrementBlockedStock on greedy fallback when assessIncrementBlockage is false", () => {
    const greedyPool = Array.from({ length: 15 }, (_, index) =>
      candidate({
        lotId: `greedy-${index}`,
        receivedAtEpochMs: time0 + index,
        expiresAtEpochMs: time3,
        extra: {
          available: parseQuantity("2000", "piece"),
          allocationIncrement: parseQuantity("3", "piece"),
        },
      }),
    );
    const defaultResult = allocateWorkingInventory({
      requested: parseQuantity("5000", "piece"),
      candidates: greedyPool,
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
    });
    expect(defaultResult.allocations).toEqual([
      { position: greedyPool[0]!.position, quantity: parseQuantity("1998", "piece") },
      { position: greedyPool[1]!.position, quantity: parseQuantity("1998", "piece") },
      { position: greedyPool[2]!.position, quantity: parseQuantity("1002", "piece") },
    ]);
    expect(defaultResult.shortfall).toEqual(parseQuantity("2", "piece"));
    expect(defaultResult.incrementBlockedStock).toBe(true);

    const disabledResult = allocateWorkingInventory({
      requested: parseQuantity("5000", "piece"),
      candidates: greedyPool,
      method: InventoryAllocationMethod.Fifo,
      nowEpochMs: time2,
      assessIncrementBlockage: false,
    });
    expect(disabledResult.allocations).toEqual(defaultResult.allocations);
    expect(disabledResult.shortfall).toEqual(parseQuantity("2", "piece"));
    expect(disabledResult.incrementBlockedStock).toBe(false);
  });

});
