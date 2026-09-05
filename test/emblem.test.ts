import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg } from '../src/style/render-svg.js';
import { resolveDesign } from '../src/style/defaults.js';
import { buildEmblem, trimGrid } from '../src/style/emblem.js';
import { imageToGrid, pixelsToGrid } from '../src/style/image-grid.js';
import { encodeQr } from '../src/core/matrix.js';
import { SCAN_WIDTHS, decodeScore, decodeSvg } from './helpers.js';

const PAYLOAD = 'https://example.com/qr-coder';

/** A blue disc with a white triangle cut out of it. */
const LOGO_SVG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="30" fill="#1d4ed8"/>' +
      '<path d="M20 44 L32 16 L44 44 Z" fill="#fff"/>' +
      '<rect x="26" y="36" width="12" height="5" fill="#1d4ed8"/></svg>',
  ).toString('base64');

test('a tinted emblem leaves the encoded symbol untouched', () => {
  const plain = renderSvg({ data: PAYLOAD, width: 500 });
  const tinted = renderSvg({
    data: PAYLOAD,
    width: 500,
    emblem: { shape: 'heart', size: 0.4, style: 'tint', color: '#db2777' },
  });

  assert.equal(tinted.meta.errorBudget.damagedCodewords, 0);
  assert.ok(tinted.meta.errorBudget.withinBudget);
  assert.equal(tinted.meta.mask, plain.meta.mask);
  assert.equal(decodeScore(tinted.svg, PAYLOAD), SCAN_WIDTHS.length);
  assert.ok(tinted.svg.includes('#db2777'), 'the tint colour is missing from the output');
});

test('every built-in emblem shape tints and inks scannably', () => {
  for (const shape of ['circle', 'square', 'diamond', 'heart'] as const) {
    const tint = renderSvg({
      data: PAYLOAD,
      width: 500,
      emblem: { shape, size: 0.35, style: 'tint', color: '#dc2626' },
    });
    assert.equal(decodeScore(tint.svg, PAYLOAD), SCAN_WIDTHS.length, `tinted ${shape} failed to decode`);

    const ink = renderSvg({
      data: PAYLOAD,
      width: 500,
      encoding: { errorCorrectionLevel: 'H' },
      emblem: { shape, size: 0.2, style: 'ink', color: '#1d4ed8' },
    });
    assert.ok(ink.meta.errorBudget.withinBudget, `inked ${shape} exceeded the error budget`);
    assert.equal(decodeScore(ink.svg, PAYLOAD), SCAN_WIDTHS.length, `inked ${shape} failed to decode`);
  }
});

/**
 * The error budget is only worth reporting if it predicts reality, so this
 * walks an inked emblem past the recovery limit and checks that the symbol
 * decodes exactly while the budget says it should.
 */
test('the reported error budget predicts whether the symbol still decodes', () => {
  for (const errorCorrectionLevel of ['Q', 'H'] as const) {
    for (const size of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5]) {
      const { svg, meta } = renderSvg({
        data: PAYLOAD,
        width: 600,
        encoding: { errorCorrectionLevel },
        emblem: { shape: 'circle', size, style: 'ink' },
      });
      const decoded = decodeSvg(svg, 800) === PAYLOAD;
      assert.equal(
        decoded,
        meta.errorBudget.withinBudget,
        `level ${errorCorrectionLevel} at size ${size}: budget said ` +
          `${meta.errorBudget.withinBudget ? 'fine' : 'too much'} ` +
          `(${meta.errorBudget.worstBlockDamage}/${meta.errorBudget.correctablePerBlock}) ` +
          `but the symbol ${decoded ? 'decoded' : 'did not decode'}`,
      );
    }
  }
});

test('an emblem beyond the recovery limit is reported', () => {
  const { meta } = renderSvg({
    data: PAYLOAD,
    width: 500,
    encoding: { errorCorrectionLevel: 'L' },
    emblem: { shape: 'circle', size: 0.5, style: 'ink' },
  });
  assert.equal(meta.errorBudget.withinBudget, false);
  assert.ok(
    meta.warnings.some((warning) => /more of the symbol than it can recover/i.test(warning)),
    meta.warnings.join(' | '),
  );
});

test('an emblem never overwrites a function pattern', () => {
  const symbol = encodeQr(PAYLOAD, { errorCorrectionLevel: 'H' });
  const { meta } = renderSvg({
    data: PAYLOAD,
    width: 500,
    encoding: { errorCorrectionLevel: 'H' },
    // Large enough to reach the finder patterns in the corners.
    emblem: { shape: 'square', size: 1, style: 'ink' },
  });
  assert.ok(
    meta.warnings.some((warning) => /left untouched, so the shape is clipped/i.test(warning)),
    meta.warnings.join(' | '),
  );
  // The finder patterns still have to be intact for a scanner to find the code.
  const finder = symbol.modules[0]!.slice(0, 7);
  assert.deepEqual(finder, [true, true, true, true, true, true, true]);
});

test('a tinted emblem in the module colour is flagged as invisible', () => {
  const { meta } = renderSvg({
    data: PAYLOAD,
    dots: { color: '#0f172a' },
    emblem: { shape: 'circle', style: 'tint', color: '#0f172a' },
  });
  assert.ok(meta.warnings.some((warning) => /not be visible/i.test(warning)), meta.warnings.join(' | '));
});

test('a grid emblem draws the bitmap it is given', () => {
  const grid = ['.####.', '######', '######', '.####.'];
  const { svg, meta } = renderSvg({
    data: PAYLOAD,
    width: 500,
    encoding: { errorCorrectionLevel: 'H' },
    emblem: { shape: 'grid', grid, style: 'ink', color: '#059669' },
  });
  assert.ok(meta.errorBudget.withinBudget);
  assert.ok(svg.includes('#059669'));
  assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length);
});

test('grid emblems accept newline and pipe separated strings', () => {
  const fromPipes = resolveDesign({ data: 'x', emblem: { shape: 'grid', grid: '.##.|####|.##.' } });
  const fromLines = resolveDesign({ data: 'x', emblem: { shape: 'grid', grid: '.##.\n####\n.##.' } });
  assert.deepEqual(fromPipes.emblem.grid, ['.##.', '####', '.##.']);
  assert.deepEqual(fromLines.emblem.grid, fromPipes.emblem.grid);
});

test('grid emblems are trimmed to the shape they contain', () => {
  assert.deepEqual(trimGrid(['......', '..##..', '..##..', '......']), ['##', '##']);
  assert.deepEqual(trimGrid(['....', '....']), []);
});

test('emblem geometry covers the modules the shape encloses', () => {
  const circle = buildEmblem(33, { shape: 'circle', size: 0.5, halo: 1 });
  assert.ok(circle.moduleCount > 0);
  // The centre is inside every centred shape; the far corner never is.
  assert.equal(circle.inside[16]![16], true);
  assert.equal(circle.inside[0]![0], false);
  // The halo hugs the shape without overlapping it.
  assert.equal(circle.halo[16]![16], false);
  assert.ok(circle.halo.some((row) => row.some(Boolean)));
});

test('invalid emblems are rejected', () => {
  const cases: [unknown, RegExp][] = [
    [{ data: 'x', emblem: { shape: 'grid' } }, /emblem\.grid is required/],
    [{ data: 'x', emblem: { shape: 'grid', grid: ['....'] } }, /does not contain any filled cells/],
    [{ data: 'x', emblem: { shape: 'octagon' } }, /emblem\.shape must be one of/],
    [{ data: 'x', emblem: { style: 'engrave' } }, /emblem\.style must be one of/],
    [{ data: 'x', emblem: { size: 2 } }, /emblem\.size must be between/],
    [{ data: 'x', emblem: { grid: [1, 2] } }, /emblem\.grid must be an array of strings/],
  ];
  for (const [design, pattern] of cases) {
    assert.throws(() => resolveDesign(design as never), pattern, `expected ${String(pattern)}`);
  }
});

test('an image traces into a module grid', async () => {
  const grid = await imageToGrid(LOGO_SVG, { modules: 15 });
  assert.ok(grid.length > 0 && grid.length <= 15);
  assert.ok(grid.every((row) => row.length === grid[0]!.length), 'rows are ragged');
  assert.ok(grid.some((row) => row.includes('#')), 'nothing was traced');
  // The disc reaches the middle rows, and the cut-out keeps the interior open.
  assert.ok(grid[Math.floor(grid.length / 2)]!.startsWith('#'));
  assert.ok(grid.slice(2, -2).some((row) => row.slice(1, -1).includes('.')), 'the cut-out was lost');
});

test('a traced logo renders as an emblem that still scans', async () => {
  const grid = await imageToGrid(LOGO_SVG, { modules: 11 });
  const { svg, meta } = renderSvg({
    data: PAYLOAD,
    width: 600,
    encoding: { errorCorrectionLevel: 'H' },
    emblem: { shape: 'grid', grid, style: 'ink', color: '#1d4ed8' },
  });
  assert.ok(meta.errorBudget.withinBudget, JSON.stringify(meta.errorBudget));
  assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length);
});

test('tracing reads transparency or darkness, whichever carries the shape', () => {
  const side = 8;
  const pixels = new Uint8Array(side * side * 4);
  const set = (x: number, y: number, [r, g, b, a]: [number, number, number, number]): void => {
    const offset = (y * side + x) * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  };

  // An opaque white square on a transparent field: only alpha describes it.
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) set(x, y, [255, 255, 255, 255]);
  const silhouette = pixelsToGrid({ pixels, width: side, height: side }, { modules: 8 });
  assert.deepEqual(silhouette, ['####', '####', '####', '####']);

  // A black square on an opaque white field: only darkness describes it.
  const opaque = new Uint8Array(side * side * 4).fill(255);
  const setOpaque = (x: number, y: number, value: number): void => {
    const offset = (y * side + x) * 4;
    opaque[offset] = value;
    opaque[offset + 1] = value;
    opaque[offset + 2] = value;
  };
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) setOpaque(x, y, 0);
  const printed = pixelsToGrid({ pixels: opaque, width: side, height: side }, { modules: 8 });
  assert.deepEqual(printed, ['####', '####', '####', '####']);

  const inverted = pixelsToGrid({ pixels: opaque, width: side, height: side }, { modules: 8, invert: true });
  assert.ok(inverted.length > 0);
  assert.ok(inverted[0]!.includes('#'), 'inverting should fill the light area instead');
});
