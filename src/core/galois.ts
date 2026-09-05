/**
 * Arithmetic in GF(256) with the QR Code primitive polynomial 0x11D, plus the
 * Reed-Solomon error correction encoder built on top of it.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

/** Multiply two field elements. */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * Generator polynomial for `degree` error correction codewords, as coefficients
 * in descending order with the leading 1 omitted.
 */
export function generatorPolynomial(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly.subarray(1);
}

/** Compute the `degree` Reed-Solomon error correction codewords for `data`. */
export function reedSolomonEncode(data: Uint8Array, degree: number): Uint8Array {
  const generator = generatorPolynomial(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let i = 0; i < degree; i++) {
      remainder[i] = remainder[i]! ^ gfMul(generator[i]!, factor);
    }
  }
  return remainder;
}
