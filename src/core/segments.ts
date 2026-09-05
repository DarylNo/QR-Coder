import { BitBuffer } from './bit-buffer.js';

export type EncodingMode = 'numeric' | 'alphanumeric' | 'byte';

const MODE_INDICATOR: Record<EncodingMode, number> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/** Character count indicator width per mode, by version group. */
const COUNT_BITS: Record<EncodingMode, [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function characterCountBits(mode: EncodingMode, version: number): number {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return COUNT_BITS[mode][group];
}

export function isNumeric(text: string): boolean {
  return text.length > 0 && /^[0-9]*$/.test(text);
}

export function isAlphanumeric(text: string): boolean {
  return text.length > 0 && [...text].every((c) => ALPHANUMERIC_CHARSET.includes(c));
}

/** Pick the most compact mode that can represent `text`. */
export function selectMode(text: string): EncodingMode {
  if (isNumeric(text)) return 'numeric';
  if (isAlphanumeric(text)) return 'alphanumeric';
  return 'byte';
}

export interface Segment {
  mode: EncodingMode;
  /** Number of characters (bytes, for byte mode) the segment encodes. */
  charCount: number;
  /** Bit length of the payload, excluding mode and count indicators. */
  payloadBits: number;
  write(buffer: BitBuffer): void;
}

export function makeSegment(text: string, mode: EncodingMode): Segment {
  switch (mode) {
    case 'numeric': {
      if (!isNumeric(text)) throw new Error('Numeric mode accepts digits 0-9 only');
      const groups = Math.floor(text.length / 3);
      const rest = text.length % 3;
      return {
        mode,
        charCount: text.length,
        payloadBits: groups * 10 + (rest === 0 ? 0 : rest * 3 + 1),
        write(buffer) {
          for (let i = 0; i < text.length; i += 3) {
            const chunk = text.slice(i, i + 3);
            buffer.put(Number(chunk), chunk.length * 3 + 1);
          }
        },
      };
    }
    case 'alphanumeric': {
      if (!isAlphanumeric(text)) throw new Error('Alphanumeric mode accepts 0-9 A-Z and $%*+-./: and space only');
      return {
        mode,
        charCount: text.length,
        payloadBits: Math.floor(text.length / 2) * 11 + (text.length % 2) * 6,
        write(buffer) {
          for (let i = 0; i < text.length; i += 2) {
            const first = ALPHANUMERIC_CHARSET.indexOf(text[i]!);
            if (i + 1 < text.length) {
              buffer.put(first * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]!), 11);
            } else {
              buffer.put(first, 6);
            }
          }
        },
      };
    }
    case 'byte': {
      const bytes = new TextEncoder().encode(text);
      return {
        mode,
        charCount: bytes.length,
        payloadBits: bytes.length * 8,
        write(buffer) {
          for (const byte of bytes) buffer.put(byte, 8);
        },
      };
    }
  }
}

/** Total bits a segment occupies at a given version, including its headers. */
export function segmentBits(segment: Segment, version: number): number {
  return 4 + characterCountBits(segment.mode, version) + segment.payloadBits;
}

export function writeSegment(buffer: BitBuffer, segment: Segment, version: number): void {
  buffer.put(MODE_INDICATOR[segment.mode], 4);
  buffer.put(segment.charCount, characterCountBits(segment.mode, version));
  segment.write(buffer);
}

/** ECI header selecting UTF-8 (assignment number 26). */
export function writeUtf8Eci(buffer: BitBuffer): void {
  buffer.put(0b0111, 4);
  buffer.put(26, 8);
}
