import { describe, expect, it } from "vitest";
import {
  InventoryAllocationMethod,
  combineInventoryAmountLineGroups,
  combineInventoryPolicyBatchRequestGroups,
  defineInventoryAmountLineGroup,
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
      placementNodeIds: ["store"],
    }),
    amount: stockAmount(amount, "piece"),
    itemRevisionId: "item-a-v2",
    method: InventoryAllocationMethod.Fifo,
  };
}

describe("policy request groups and allocation reads", () => {
  it("preserves generic amount-line subtype behavior while copying only the grouping arrays", () => {
    const catalog = createTabletCatalog();
    const applicationSymbol = Symbol("application-line");
    class ApplicationAmountLine {
      readonly itemRevisionId = "item-a-v2";
      readonly amount = stockAmount("1", "piece");
      readonly callback = () => "called";
      readonly [applicationSymbol] = "symbol-value";
      #privateValue = "private-value";

      /** Read application-owned private state that InventoryOnce must not erase. */
      privateValue(): string {
        return this.#privateValue;
      }
    }
    const line = new ApplicationAmountLine();
    const inputLines = [line];
    const amountGroup = defineInventoryAmountLineGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("1", "piece"),
      lines: inputLines,
    });
    const combinedAmounts = combineInventoryAmountLineGroups([amountGroup]);

    expect(amountGroup).not.toBe(inputLines);
    expect(amountGroup[0]).toBe(line);
    expect(combinedAmounts[0]).toBe(line);
    expect(amountGroup[0]?.callback()).toBe("called");
    expect(amountGroup[0]?.[applicationSymbol]).toBe("symbol-value");
    expect(amountGroup[0]?.privateValue()).toBe("private-value");
  });

  it("owns policy request fields without requiring structural application extensions to be cloneable", () => {
    const catalog = createTabletCatalog();
    const callerPlacementNodeIds = ["store"];
    const mutableRequest = {
      requestId: "request-owned",
      selector: inventoryStockSelector("item-a", {
        itemRevisionIds: ["item-a-v2"],
        placementNodeIds: callerPlacementNodeIds,
      }),
      amount: stockAmount("1", "piece"),
      itemRevisionId: "item-a-v2",
      method: InventoryAllocationMethod.Fifo,
      applicationCallback: () => "opaque-application-value",
    };
    const policyGroup = defineInventoryPolicyBatchRequestGroup({
      catalog,
      itemId: "item-a",
      expectedItemRevisionId: "item-a-v2",
      expectedAmount: stockAmount("1", "piece"),
      reference: "application-owned",
      requests: [mutableRequest],
    });
    const combinedPolicy = combineInventoryPolicyBatchRequestGroups([policyGroup]);

    expect(policyGroup.requests[0]).not.toBe(mutableRequest);
    expect(combinedPolicy.requests[0]).not.toBe(policyGroup.requests[0]);
    mutableRequest.requestId = "mutated-request";
    callerPlacementNodeIds[0] = "other-location";
    expect(mutableRequest.applicationCallback()).toBe("opaque-application-value");
    expect(policyGroup.requests[0]?.requestId).toBe("request-owned");
    expect(combinedPolicy.requests[0]?.requestId).toBe("request-owned");
    expect(policyGroup.requests[0]?.selector.placementNodeIds).toEqual(["store"]);
    expect(combinedPolicy.requests[0]?.selector.placementNodeIds).toEqual(["store"]);
    expect(policyGroup.referenceByRequestId.get("request-owned")).toBe(
      "application-owned"
    );
  });

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
        placementNodeId: "store",
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
        placementNodeId: "store",
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
