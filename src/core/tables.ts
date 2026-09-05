/** Static tables from ISO/IEC 18004 (QR Code specification). */

export const ECC_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type EccLevel = (typeof ECC_LEVELS)[number];

/** Row index used by the tables below. */
export const ECC_ORDER: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

/** Two-bit value written into the format information block. */
export const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Error correction codewords per block, indexed [eccLevel][version]. */
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  // 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Number of error correction blocks, indexed [eccLevel][version]. */
const ECC_BLOCK_COUNT: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Centre coordinates of alignment patterns for each version. */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = moduleCount(version);
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const tail: number[] = [];
  for (let pos = size - 7; tail.length < count - 1; pos -= step) tail.unshift(pos);
  return [6, ...tail];
}

/** Width and height of the symbol, in modules. */
export function moduleCount(version: number): number {
  return version * 4 + 17;
}

/** Total number of modules usable for data and error correction codewords. */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignmentCount = Math.floor(version / 7) + 2;
    modules -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Total codewords (data + error correction) available at a version. */
export function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

/** Number of remainder bits that are left unused after the final codeword. */
export function remainderBits(version: number): number {
  return rawDataModules(version) % 8;
}

export interface BlockLayout {
  /** Error correction codewords per block. */
  eccPerBlock: number;
  /** Total number of blocks. */
  blockCount: number;
  /** Number of blocks holding `shortBlockDataLength` data codewords. */
  shortBlockCount: number;
  /** Data codewords in a short block; long blocks hold one more. */
  shortBlockDataLength: number;
  /** Total data codewords across all blocks. */
  dataCodewords: number;
}

export function blockLayout(version: number, ecc: EccLevel): BlockLayout {
  const row = ECC_ORDER[ecc];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[row]![version]!;
  const blockCount = ECC_BLOCK_COUNT[row]![version]!;
  const dataCodewords = totalCodewords(version) - eccPerBlock * blockCount;
  const shortBlockDataLength = Math.floor(dataCodewords / blockCount);
  const longBlockCount = dataCodewords % blockCount;
  return {
    eccPerBlock,
    blockCount,
    shortBlockCount: blockCount - longBlockCount,
    shortBlockDataLength,
    dataCodewords,
  };
}

/** Data capacity in bits at a given version and error correction level. */
export function dataCapacityBits(version: number, ecc: EccLevel): number {
  return blockLayout(version, ecc).dataCodewords * 8;
}
