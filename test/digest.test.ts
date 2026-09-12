import { describe, expect, it } from "vitest";

import { inventoryMetadataValueFingerprint } from "../src/canonical.js";
import { inventorySha256 } from "../src/digest.js";
import type { InventoryMetadataValue } from "../src/model.js";

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
  const sha256Vectors: readonly (readonly [string, string])[] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["a".repeat(55), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"],
    ["a".repeat(56), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "01234567890123456789012345678901234567890123456789012345678901234567890123456789",
      "af1909413b96cbb29927b3a67f3a8879c801a37be383e5f9b31df5fa8d10fa2b",
    ],
    [
      "สวัสดี InventoryOnce",
      "5bebf12a7f7a884bc001b0d729eaa4fd461e2d42c9f275a03555157655f55b3e",
    ],
  ];

  it.each(sha256Vectors)(
    "matches the SHA-256 known-answer vector for %j",
    (value, expected) => {
      expect(inventorySha256(value)).toBe(expected);
    }
  );
});
