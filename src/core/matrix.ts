import { reedSolomonEncode } from './galois.js';
import { BitBuffer } from './bit-buffer.js';
import {
  type EccLevel,
  ECC_FORMAT_BITS,
  MAX_VERSION,
  MIN_VERSION,
  alignmentPatternPositions,
  blockLayout,
  dataCapacityBits,
  moduleCount,
  remainderBits,
} from './tables.js';
import {
  type EncodingMode,
  type Segment,
  makeSegment,
  segmentBits,
  selectMode,
  writeSegment,
  writeUtf8Eci,
} from './segments.js';

/** Which structural region a module belongs to; drives per-region styling. */
export enum ModuleRegion {
  Data = 0,
  Finder = 1,
  Separator = 2,
  Timing = 3,
  Alignment = 4,
  Format = 5,
  Version = 6,
  DarkModule = 7,
}

export interface QrSymbol {
  version: number;
  ecc: EccLevel;
  mask: number;
  mode: EncodingMode;
  /** Symbol width/height in modules, excluding the quiet zone. */
  size: number;
  /** `modules[y][x]` is true when the module is dark. */
  modules: boolean[][];
  /** `regions[y][x]` classifies the module for styling purposes. */
  regions: ModuleRegion[][];
  /** Top-left corners of the three finder patterns. */
  finders: { x: number; y: number; corner: 'top-left' | 'top-right' | 'bottom-left' }[];
  /** Centres of the alignment patterns actually drawn in this symbol. */
  alignments: { x: number; y: number }[];
}

export interface EncodeOptions {
  errorCorrectionLevel?: EccLevel;
  /** Force a symbol version (1-40); by default the smallest that fits is used. */
  version?: number | 'auto';
  /** Never produce a symbol smaller than this version. */
  minVersion?: number;
  /** Force a mask pattern (0-7); by default the lowest-penalty mask is used. */
  mask?: number | 'auto';
  /** Force an encoding mode; by default the most compact valid mode is used. */
  mode?: EncodingMode | 'auto';
  /** Prefix the data with an ECI header declaring UTF-8. */
  utf8Eci?: boolean;
}

export function encodeQr(data: string, options: EncodeOptions = {}): QrSymbol {
  if (data.length === 0) throw new Error('Cannot encode empty data');

  const ecc = options.errorCorrectionLevel ?? 'M';
  const mode = options.mode && options.mode !== 'auto' ? options.mode : selectMode(data);
  const segment = makeSegment(data, mode);
  const eciBits = options.utf8Eci ? 12 : 0;

  const version = resolveVersion(segment, ecc, eciBits, options);
  const codewords = buildCodewords(segment, version, ecc, Boolean(options.utf8Eci));

  const requestedMask = options.mask === undefined || options.mask === 'auto' ? null : options.mask;
  if (requestedMask !== null && (requestedMask < 0 || requestedMask > 7 || !Number.isInteger(requestedMask))) {
    throw new Error(`Mask must be an integer 0-7, received ${String(options.mask)}`);
  }

  const { modules, regions, mask } = buildMatrix(version, ecc, codewords, requestedMask);
  const size = moduleCount(version);

  return {
    version,
    ecc,
    mask,
    mode,
    size,
    modules,
    regions,
    finders: [
      { x: 0, y: 0, corner: 'top-left' },
      { x: size - 7, y: 0, corner: 'top-right' },
      { x: 0, y: size - 7, corner: 'bottom-left' },
    ],
    alignments: alignmentCentres(version),
  };
}

/** Centres of alignment patterns, excluding the ones eclipsed by finders. */
export function alignmentCentres(version: number): { x: number; y: number }[] {
  const positions = alignmentPatternPositions(version);
  const last = positions.length - 1;
  const centres: { x: number; y: number }[] = [];
  positions.forEach((y, row) => {
    positions.forEach((x, col) => {
      const inFinder =
        (row === 0 && col === 0) || (row === 0 && col === last) || (row === last && col === 0);
      if (!inFinder) centres.push({ x, y });
    });
  });
  return centres;
}

function resolveVersion(segment: Segment, ecc: EccLevel, eciBits: number, options: EncodeOptions): number {
  const minVersion = clampVersion(options.minVersion ?? MIN_VERSION);

  if (options.version !== undefined && options.version !== 'auto') {
    const forced = options.version;
    if (!Number.isInteger(forced) || forced < MIN_VERSION || forced > MAX_VERSION) {
      throw new Error(`Version must be an integer ${MIN_VERSION}-${MAX_VERSION}, received ${String(forced)}`);
    }
    if (segmentBits(segment, forced) + eciBits > dataCapacityBits(forced, ecc)) {
      throw new Error(
        `Data does not fit in version ${forced} at error correction level ${ecc}. ` +
          `Use a higher version, a lower error correction level, or less data.`,
      );
    }
    return forced;
  }

  for (let version = minVersion; version <= MAX_VERSION; version++) {
    if (segmentBits(segment, version) + eciBits <= dataCapacityBits(version, ecc)) return version;
  }
  throw new Error(
    `Data is too long for a QR code at error correction level ${ecc} ` +
      `(${segment.charCount} characters in ${segment.mode} mode).`,
  );
}

function clampVersion(version: number): number {
  return Math.min(MAX_VERSION, Math.max(MIN_VERSION, Math.trunc(version)));
}

/** Build the final interleaved codeword stream (data + error correction). */
function buildCodewords(segment: Segment, version: number, ecc: EccLevel, utf8Eci: boolean): Uint8Array {
  const layout = blockLayout(version, ecc);
  const capacityBits = layout.dataCodewords * 8;

  const buffer = new BitBuffer();
  if (utf8Eci) writeUtf8Eci(buffer);
  writeSegment(buffer, segment, version);

  // Terminator, then pad to a byte boundary, then alternating pad codewords.
  buffer.put(0, Math.min(4, capacityBits - buffer.length));
  buffer.put(0, (8 - (buffer.length % 8)) % 8);
  const bytes = Array.from(buffer.toBytes());
  for (let pad = 0xec; bytes.length < layout.dataCodewords; pad ^= 0xec ^ 0x11) bytes.push(pad);

  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let block = 0; block < layout.blockCount; block++) {
    const length = layout.shortBlockDataLength + (block < layout.shortBlockCount ? 0 : 1);
    const dataBlock = Uint8Array.from(bytes.slice(offset, offset + length));
    offset += length;
    dataBlocks.push(dataBlock);
    eccBlocks.push(reedSolomonEncode(dataBlock, layout.eccPerBlock));
  }

  const result: number[] = [];
  const longestData = layout.shortBlockDataLength + 1;
  for (let i = 0; i < longestData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]!);
  }
  for (let i = 0; i < layout.eccPerBlock; i++) {
    for (const block of eccBlocks) result.push(block[i]!);
  }
  return Uint8Array.from(result);
}

interface MatrixBuild {
  modules: boolean[][];
  regions: ModuleRegion[][];
  mask: number;
}

function buildMatrix(version: number, ecc: EccLevel, codewords: Uint8Array, forcedMask: number | null): MatrixBuild {
  const size = moduleCount(version);
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const regions: ModuleRegion[][] = Array.from({ length: size }, () =>
    new Array<ModuleRegion>(size).fill(ModuleRegion.Data),
  );
  /** True where a module belongs to a function pattern and must not be masked. */
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const set = (x: number, y: number, dark: boolean, region: ModuleRegion): void => {
    modules[y]![x] = dark;
    regions[y]![x] = region;
    reserved[y]![x] = true;
  };

  // Finder patterns and their separators.
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ] as const) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        if (!inside) {
          set(x, y, false, ModuleRegion.Separator);
          continue;
        }
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(x, y, ring !== 2, ModuleRegion.Finder);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    set(i, 6, dark, ModuleRegion.Timing);
    set(6, i, dark, ModuleRegion.Timing);
  }

  // Alignment patterns.
  for (const { x: cx, y: cy } of alignmentCentres(version)) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, ring !== 1, ModuleRegion.Alignment);
      }
    }
  }

  // Reserve the format information areas and set the always-dark module.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      set(i, 8, false, ModuleRegion.Format);
      set(8, i, false, ModuleRegion.Format);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false, ModuleRegion.Format);
    set(8, size - 1 - i, false, ModuleRegion.Format);
  }
  set(8, size - 8, true, ModuleRegion.DarkModule);

  // Version information (versions 7 and up).
  if (version >= 7) {
    const bits = versionInformationBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, dark, ModuleRegion.Version);
      set(b, a, dark, ModuleRegion.Version);
    }
  }

  placeCodewords(modules, reserved, codewords, version, size);

  const mask = forcedMask ?? chooseMask(modules, reserved, size, ecc);
  applyMask(modules, reserved, size, mask);
  drawFormatInformation(modules, size, ecc, mask);

  return { modules, regions, mask };
}

/** Walk the symbol in the standard two-column zigzag, writing data bits. */
function placeCodewords(
  modules: boolean[][],
  reserved: boolean[][],
  codewords: Uint8Array,
  version: number,
  size: number,
): void {
  const totalBits = codewords.length * 8 + remainderBits(version);
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // The vertical timing pattern column is skipped.
    for (let step = 0; step < size; step++) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - step : step;
      for (let col = 0; col < 2; col++) {
        const x = right - col;
        if (reserved[y]![x]) continue;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >>> 3] ?? 0;
          modules[y]![x] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        }
        bitIndex++;
      }
    }
  }
}

export function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error(`Unknown mask pattern ${mask}`);
  }
}

function applyMask(modules: boolean[][], reserved: boolean[][], size: number, mask: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (reserved[y]![x]) continue;
      if (maskCondition(mask, x, y)) modules[y]![x] = !modules[y]![x];
    }
  }
}

function chooseMask(modules: boolean[][], reserved: boolean[][], size: number, ecc: EccLevel): number {
  let best = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, reserved, size, mask);
    drawFormatInformation(modules, size, ecc, mask);
    const penalty = maskPenalty(modules, size);
    applyMask(modules, reserved, size, mask); // Masking is an involution; this undoes it.
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = mask;
    }
  }
  return best;
}

/** Sum of the four penalty rules from the specification. */
export function maskPenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let runColor = false;
      let runLength = 0;
      for (let j = 0; j < size; j++) {
        const dark = horizontal ? modules[i]![j]! : modules[j]![i]!;
        if (dark === runColor) {
          runLength++;
          if (runLength === 5) penalty += 3;
          else if (runLength > 5) penalty += 1;
        } else {
          runColor = dark;
          runLength = 1;
        }
      }
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const first = modules[y]![x]!;
      if (
        first === modules[y]![x + 1] &&
        first === modules[y + 1]![x] &&
        first === modules[y + 1]![x + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with a four-module light margin.
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      let matchA = true;
      let matchB = true;
      let matchAv = true;
      let matchBv = true;
      for (let k = 0; k < 11; k++) {
        const horizontal = modules[i]![j + k]!;
        const vertical = modules[j + k]![i]!;
        if (horizontal !== patternA[k]) matchA = false;
        if (horizontal !== patternB[k]) matchB = false;
        if (vertical !== patternA[k]) matchAv = false;
        if (vertical !== patternB[k]) matchBv = false;
      }
      if (matchA) penalty += 40;
      if (matchB) penalty += 40;
      if (matchAv) penalty += 40;
      if (matchBv) penalty += 40;
    }
  }

  // Rule 4: deviation of the dark module ratio from 50%.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y]![x]) dark++;
  const total = size * size;
  const steps = Math.abs(Math.ceil((dark * 100) / total / 5) - 10);
  penalty += steps * 10;

  return penalty;
}

function drawFormatInformation(modules: boolean[][], size: number, ecc: EccLevel, mask: number): void {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;

  const put = (x: number, y: number, bit: number): void => {
    modules[y]![x] = ((bits >>> bit) & 1) === 1;
  };

  // First copy: wrapped around the top-left finder pattern.
  for (let i = 0; i <= 5; i++) put(8, i, i);
  put(8, 7, 6);
  put(8, 8, 7);
  put(7, 8, 8);
  for (let i = 9; i < 15; i++) put(14 - i, 8, i);

  // Second copy: split between the bottom-left and top-right finder patterns.
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, i);

  modules[size - 8]![8] = true;
}

function versionInformationBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}
