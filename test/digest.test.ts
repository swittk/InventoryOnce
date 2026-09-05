import { describe, expect, it } from "vitest";

import { inventoryMetadataValueFingerprint } from "../src/canonical.js";
import { inventorySha256 } from "../src/digest.js";
import { inventoryProjectionDigest } from "../src/integrity.js";
import { stockAmount } from "../src/index.js";
import type { InventoryMetadataValue } from "../src/model.js";
import type { InventoryProjectionState } from "../src/projection.js";
import { createTestInventory, loosePosition, time0 } from "./test-fixtures.js";

describe("inventory metadata fingerprint", () => {
  it("rejects undefined array elements just like undefined object properties", () => {
    const malformed: InventoryMetadataValue[] = [];
    malformed.length = 1;
    expect(() => inventoryMetadataValueFingerprint(malformed)).toThrow(
      /must not contain undefined/i
    );
  });
});

describe("inventorySha256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "สวัสดี InventoryOnce",
      "5bebf12a7f7a884bc001b0d729eaa4fd461e2d42c9f275a03555157655f55b3e",
    ],
  ] as const)(
    "matches the SHA-256 known-answer vector for %j",
    (value, expected) => {
      expect(inventorySha256(value)).toBe(expected);
    }
  );
});

/** Mirror the pre-transfer projection digest layout to guard durable-head upgrade compatibility. */
function legacyProjectionDigest(projection: InventoryProjectionState): string {
  /** Canonically order one keyed projection family exactly as the legacy digest did. */
  const rows = <T>(values: Readonly<Record<string, T>>): readonly string[] => {
    const keys = Object.keys(values);
    keys.sort();
    return keys.map((key) => JSON.stringify([key, values[key]]));
  };
  return inventorySha256(
    JSON.stringify([
      projection.lastRecordSequence,
      rows(projection.positions),
      rows(projection.positionIdsByItemId),
      rows(projection.positionIdsByItemRevisionId),
      rows(projection.positionIdsByContainerIdentity),
      rows(projection.positiveLayerStartedAtByPositionId),
      rows(projection.positivePositionIdBySerialIdentity),
      rows(projection.containers),
      rows(projection.containerRootEventIdByIdentity),
      rows(projection.lots),
      rows(projection.lotIdentitiesByItemId),
      rows(projection.lotRootEventIdByIdentity),
      rows(projection.events),
      rows(projection.eventIdsBySequence),
      rows(projection.eventIdByOperationId),
      rows(projection.correctionEventIdByCorrectedEventId),
      rows(projection.traceability.relations),
      rows(
        projection.traceability.containmentChildContainerIdsByParentNodeIdentity
      ),
    ])
  );
}

describe("projection digest upgrade compatibility", () => {
  it("keeps pre-transfer worlds on the exact legacy content root", async () => {
    const inventory = createTestInventory();
    await inventory.stock.receive({
      operationId: "legacy-digest-receipt",
      occurredAt: time0,
      to: loosePosition("legacy-store", { lotId: "LEGACY-LOT" }),
      amount: stockAmount("3", "piece"),
    });
    const world = await inventory.read.world();
    expect(Object.keys(world.projection.transfers ?? {})).toHaveLength(0);
    expect(inventoryProjectionDigest(world.projection)).toBe(
      legacyProjectionDigest(world.projection)
    );
  });
});
