import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { inventoryMetadataValueFingerprint } from "../src/canonical.js";
import { inventorySha256 } from "../src/digest.js";
import {
  inventoryProjectionDigest,
  inventoryWorldContentRoots,
} from "../src/integrity.js";
import type { InventoryMetadataValue } from "../src/model.js";
import { emptyInventoryProjectionState } from "../src/projection.js";
import {
  cloneInventorySparseRecord,
  deleteInventorySparseRecordValue,
  setInventorySparseRecordValue,
} from "../src/sparse-record.js";
import { emptyInventoryWorldState } from "../src/world.js";

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

  it("matches native SHA with no Node globals and with an older process shim", () => {
    // Execute the actual compiled digest module without native crypto, rather
    // than importing it into Node where the optimized path would hide fallback bugs.
    const source = readFileSync("src/digest.ts", "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    for (const oldRuntime of [false, true]) {
      const exports: { inventorySha256?: typeof inventorySha256 } = {};
      runInNewContext(compiled, {
        exports,
        TextEncoder,
        ...(oldRuntime ? { process: {} } : {}),
      });
      const fallback = exports.inventorySha256;
      if (fallback === undefined) throw new Error("Digest export was not compiled.");
      for (const [value, expected] of sha256Vectors) {
        expect(fallback(value)).toBe(expected);
      }
      for (const value of [
        "\u0000a\u0000b", "\ud800", "\udc00", "🧪คลังยา", "x".repeat(8193),
      ]) {
        expect(fallback(value)).toBe(
          createHash("sha256").update(value, "utf8").digest("hex")
        );
      }
    }
  });

  it.each(sha256Vectors)(
    "matches the SHA-256 known-answer vector for %j",
    (value, expected) => {
      expect(inventorySha256(value)).toBe(expected);
    }
  );
});

describe("inventory sparse-record digest lineage", () => {
  it("matches a full unordered rebuild after changed-key copy-on-write updates", () => {
    const base: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (let index = 0; index < 2_000; index += 1) {
      base[String(index)] = `event-${index}`;
    }
    Object.freeze(base);
    const incremental = cloneInventorySparseRecord(base);
    deleteInventorySparseRecordValue(incremental, "17");
    setInventorySparseRecordValue(incremental, "900", "event-900-replaced");
    setInventorySparseRecordValue(incremental, "2000", "event-2000");

    const rebuilt: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    const entries = Object.entries(incremental);
    entries.reverse();
    for (const [key, value] of entries) rebuilt[key] = value;

    const empty = emptyInventoryProjectionState();
    const incrementalProjection = {
      ...empty,
      eventIdsBySequence: incremental,
      lastRecordSequence: 2_001,
    };
    const rebuiltProjection = {
      ...empty,
      eventIdsBySequence: rebuilt,
      lastRecordSequence: 2_001,
    };
    expect(inventoryProjectionDigest(incrementalProjection)).toBe(
      inventoryProjectionDigest(rebuiltProjection)
    );
  });
});

describe("inventory world digest caching", () => {
  it("does not trust an externally shallow-frozen world for reusable roots", () => {
    const world = emptyInventoryWorldState();
    Object.freeze(world);
    const before = inventoryWorldContentRoots(world);
    expect(
      Reflect.set(world.projection, "lastRecordSequence", 1)
    ).toBe(true);
    const after = inventoryWorldContentRoots(world);
    expect(after.projection).not.toBe(before.projection);
    expect(after.world).not.toBe(before.world);
  });
});
