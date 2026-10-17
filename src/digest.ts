/** Optional synchronous native SHA-256 available on supported Node runtimes. */
const inventoryNativeCrypto =
  typeof process !== "undefined" &&
  typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("node:crypto")
    : undefined;

/** Return one lowercase SHA-256 digest using native crypto when available. */
export function inventorySha256(text: string): string {
  if (inventoryNativeCrypto !== undefined) {
    return inventoryNativeCrypto
      .createHash("sha256")
      .update(text, "utf8")
      .digest("hex");
  }
  return inventoryPortableSha256(text);
}

/** Portable SHA-256 fallback for browser/RN/embedded runtimes without synchronous native crypto. */
function inventoryPortableSha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = BigInt(bytes.length) * 8n;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  for (let index = 0; index < 8; index += 1) {
    padded[padded.length - 1 - index] = Number(
      (bitLength >> BigInt(index * 8)) & 0xffn,
    );
  }

  /** Current eight-word SHA-256 state. */
  const hash = [...SHA256_INITIAL_HASH];
  /** Expanded message words for one 512-bit chunk. */
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        (padded[wordOffset] ?? 0) << 24 |
        (padded[wordOffset + 1] ?? 0) << 16 |
        (padded[wordOffset + 2] ?? 0) << 8 |
        (padded[wordOffset + 3] ?? 0)
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const earlier15 = words[index - 15] ?? 0;
      const earlier2 = words[index - 2] ?? 0;
      const smallSigma0 = rotateRight(earlier15, 7) ^
        rotateRight(earlier15, 18) ^ (earlier15 >>> 3);
      const smallSigma1 = rotateRight(earlier2, 17) ^
        rotateRight(earlier2, 19) ^ (earlier2 >>> 10);
      words[index] = (
        (words[index - 16] ?? 0) + smallSigma0 +
        (words[index - 7] ?? 0) + smallSigma1
      ) >>> 0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (
        h + bigSigma1 + choose +
        (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)
      ) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  return hash.map(
    /** Encode one unsigned 32-bit hash word as eight lowercase hex digits. */
    (word) => word.toString(16).padStart(8, "0"),
  ).join("");
}

/** Rotate one unsigned 32-bit word right by a fixed bit count. */
function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 initial hash words from FIPS 180-4. */
const SHA256_INITIAL_HASH: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** SHA-256 round constants from FIPS 180-4. */
const SHA256_ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
