import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  combineInventoryPolicyBatchRequestGroups,
  defineInventoryPolicyBatchRequestGroup,
  inventoryPolicyBatchAllocationLinesByReference,
  inventoryStockSelector,
  parseQuantity,
  stockAmount,
  type InventoryOncePolicyBatchRequest,
} from "../src/index.js";
import { createTabletCatalog } from "./test-fixtures.js";

/** Build one standalone native policy request used to prove grouped conservation. */
function request(
  requestId: string,
  amount: string,
): InventoryOncePolicyBatchRequest {
  return {
    requestId,
    selector: inventoryStockSelector("item-a", {
      itemRevisionIds: ["item-a-v2"],
      locationIds: ["store"],
    }),
    amount: stockAmount(amount, "piece"),
    itemRevisionId: "item-a-v2",
    method: InventoryAllocationMethod.Fifo,
  };
}

describe("policy request groups and allocation reads", () => {
  it("freezes one application reference while proving child requests conserve the parent", () => {
    const catalog = createTabletCatalog();
    const group = defineInventoryPolicyBatchRequestGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("24", "piece"),
      reference: "application-line-a",
      requests: [request("request-a", "10"), request("request-b", "14")],
    });
    const set = combineInventoryPolicyBatchRequestGroups([group]);
    expect(set.requests.map((entry) => entry.requestId)).toEqual([
      "request-a",
      "request-b",
    ]);
    expect(set.referenceByRequestId.get("request-a")).toBe(
      "application-line-a"
    );
    const lineA = {
      position: {
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        locationId: "store",
      },
      positionIdentity: "allocation-position-a",
      amount: stockAmount("10", "piece"),
      allocatedPrimary: parseQuantity("10", "piece"),
      layerStartedAtEpochMs: 10,
    };
    const lineB = {
      position: {
        itemId: "item-a",
        itemRevisionId: "item-a-v2",
        locationId: "store",
      },
      positionIdentity: "allocation-position-b",
      amount: stockAmount("14", "piece"),
      allocatedPrimary: parseQuantity("14", "piece"),
      layerStartedAtEpochMs: 20,
    };
    const allocations = inventoryPolicyBatchAllocationLinesByReference(
      [
        { requestId: "request-a", lines: [lineA] },
        { requestId: "request-b", lines: [lineB] },
      ],
      set.referenceByRequestId
    );
    expect(allocations.get("application-line-a")).toEqual([lineA, lineB]);
  });

  it("rejects mismatched group totals, duplicate request ids, and unknown allocation evidence", () => {
    const catalog = createTabletCatalog();
    expect(() =>
      defineInventoryPolicyBatchRequestGroup({
        catalog,
        itemId: "item-a",
        expectedItemRevisionId: "item-a-v2",
        expectedAmount: stockAmount("24", "piece"),
        reference: "application-line-a",
        requests: [request("request-a", "23")],
      })
    ).toThrow("must exactly equal the parent quantity");
    expect(() =>
      defineInventoryPolicyBatchRequestGroup({
        catalog,
        itemId: "item-a",
        expectedItemRevisionId: "item-a-v2",
        expectedAmount: stockAmount("1", "piece"),
        reference: "wrong-selector",
        requests: [
          {
            ...request("wrong-selector-request", "1"),
            selector: inventoryStockSelector("other-item"),
          },
        ],
      })
    ).toThrow("belongs to another item");
    const groupA = defineInventoryPolicyBatchRequestGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("1", "piece"),
      reference: "a",
      requests: [request("same-request", "1")],
    });
    const groupB = defineInventoryPolicyBatchRequestGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("1", "piece"),
      reference: "b",
      requests: [request("same-request", "1")],
    });
    expect(() =>
      combineInventoryPolicyBatchRequestGroups([groupA, groupB])
    ).toThrow("repeats requestId");
    expect(() =>
      inventoryPolicyBatchAllocationLinesByReference(
        [{ requestId: "unknown", lines: [] }],
        groupA.referenceByRequestId
      )
    ).toThrow("returned unknown request");
  });
});
