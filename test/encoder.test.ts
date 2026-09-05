import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeQr } from '../src/core/matrix.js';
import { ECC_LEVELS, blockLayout, moduleCount, totalCodewords } from '../src/core/tables.js';

const require = createRequire(import.meta.url);
// The reference implementation is a dev dependency used purely to validate our own encoder.
const reference = require('qrcode') as typeof import('qrcode');

/**
 * Render `text` with the reference encoder, pinned to a single segment of `mode`
 * so that it matches our encoder's segmentation (the reference library splits
 * mixed-content strings into several segments; we always emit one).
 */
function referenceMatrix(text: string, ecc: string, mode: string, version?: number): boolean[][] {
  const qr = reference.create([{ data: text, mode }], {
    errorCorrectionLevel: ecc as 'L',
    ...(version ? { version } : {}),
  });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(Boolean(data[y * size + x]));
    rows.push(row);
  }
  return rows;
}

const SAMPLES = [
  'https://example.com',
  'HELLO WORLD',
  '1234567890',
  'a',
  'Grüße aus München — QR ✅',
  'x'.repeat(120),
  'https://example.com/a/fairly/long/path?with=query&and=more#fragment',
  '9'.repeat(300),
  'MAILTO:SOMEONE@EXAMPLE.COM',
  JSON.stringify({ id: 42, name: 'test', nested: { a: [1, 2, 3] } }),
];

test('matrices match the reference encoder across data and error correction levels', () => {
  for (const sample of SAMPLES) {
    for (const ecc of ECC_LEVELS) {
      const ours = encodeQr(sample, { errorCorrectionLevel: ecc });
      const theirs = referenceMatrix(sample, ecc, ours.mode);
      assert.equal(ours.size, theirs.length, `size mismatch for ${JSON.stringify(sample)} / ${ecc}`);
      assert.deepEqual(ours.modules, theirs, `module mismatch for ${JSON.stringify(sample)} / ${ecc}`);
    }
  }
});

test('matrices match the reference encoder at forced versions', () => {
  for (const version of [1, 2, 6, 7, 8, 14, 25, 26, 27, 32, 40]) {
    for (const ecc of ECC_LEVELS) {
      // Short enough to fit version 1 at every error correction level.
      const payload = 'A1B2C'.repeat(2);
      const ours = encodeQr(payload, { errorCorrectionLevel: ecc, version });
      const theirs = referenceMatrix(payload, ecc, ours.mode, version);
      assert.deepEqual(ours.modules, theirs, `mismatch at version ${version} / ${ecc}`);
    }
  }
});

test('matrices match the reference encoder for payloads that fill the symbol', () => {
  for (const version of [5, 10, 20, 30, 40]) {
    for (const ecc of ECC_LEVELS) {
      // Fill the symbol to within a few codewords of its capacity.
      const capacityBytes = blockLayout(version, ecc).dataCodewords - 3;
      const payload = 'The quick brown fox. '.repeat(200).slice(0, capacityBytes);
      const ours = encodeQr(payload, { errorCorrectionLevel: ecc, version });
      assert.equal(ours.version, version);
      assert.deepEqual(
        ours.modules,
        referenceMatrix(payload, ecc, ours.mode, version),
        `mismatch for a full version ${version} / ${ecc} symbol`,
      );
    }
  }
});

test('symbol geometry follows the specification', () => {
  assert.equal(moduleCount(1), 21);
  assert.equal(moduleCount(40), 177);
  assert.equal(totalCodewords(1), 26);
  assert.equal(totalCodewords(40), 3706);
  // Byte-mode capacities published in ISO/IEC 18004 Table 7.
  assert.equal(blockLayout(1, 'L').dataCodewords, 19);
  assert.equal(blockLayout(1, 'H').dataCodewords, 9);
  assert.equal(blockLayout(40, 'L').dataCodewords, 2956);
  assert.equal(blockLayout(40, 'H').dataCodewords, 1276);
});

test('the smallest fitting version is selected automatically', () => {
  assert.equal(encodeQr('x'.repeat(17), { errorCorrectionLevel: 'L' }).version, 1);
  assert.equal(encodeQr('x'.repeat(18), { errorCorrectionLevel: 'L' }).version, 2);
  assert.equal(encodeQr('1234567', { errorCorrectionLevel: 'H' }).mode, 'numeric');
  assert.equal(encodeQr('HELLO', { errorCorrectionLevel: 'H' }).mode, 'alphanumeric');
  assert.equal(encodeQr('hello', { errorCorrectionLevel: 'H' }).mode, 'byte');
});

test('over-long payloads and impossible versions are rejected', () => {
  assert.throws(() => encodeQr('x'.repeat(3000), { errorCorrectionLevel: 'H' }), /too long/i);
  assert.throws(() => encodeQr('x'.repeat(100), { version: 1 }), /does not fit/i);
  assert.throws(() => encodeQr(''), /empty/i);
});

test('every mask pattern produces a decodable-shaped symbol', () => {
  for (let mask = 0; mask < 8; mask++) {
    const symbol = encodeQr('https://example.com', { mask });
    assert.equal(symbol.mask, mask);
    // The dark module below the top-left format block is mandatory.
    assert.equal(symbol.modules[symbol.size - 8]![8], true);
  }
});
