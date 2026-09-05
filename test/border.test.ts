import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg } from '../src/style/render-svg.js';
import { resolveDesign } from '../src/style/defaults.js';
import { BORDER_STYLES } from '../src/style/types.js';
import { SCAN_WIDTHS, decodeScore } from './helpers.js';

const PAYLOAD = 'https://example.com/qr-coder';

test('every border style renders and stays scannable', () => {
  for (const style of BORDER_STYLES) {
    const { svg } = renderSvg({
      data: PAYLOAD,
      width: 500,
      border: { width: 10, style, color: '#1d4ed8', gap: 8 },
    });
    assert.match(svg, /<path fill="none" stroke=/, `the ${style} border drew no stroke`);
    assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length, `the ${style} border broke decoding`);
  }
});

test('no border is drawn by default', () => {
  const { svg } = renderSvg({ data: PAYLOAD, width: 400 });
  assert.ok(!svg.includes('stroke='), 'a stroke appeared without a border being asked for');
});

test('the border and its gap take space from the code, not from the canvas', () => {
  const plain = renderSvg({ data: PAYLOAD, width: 400 });
  const framed = renderSvg({ data: PAYLOAD, width: 400, border: { width: 12, gap: 10 } });

  assert.equal(framed.meta.width, plain.meta.width, 'the canvas size should not change');
  assert.ok(
    framed.meta.modulePixelSize < plain.meta.modulePixelSize,
    'the symbol should shrink to make room for the frame',
  );
  // 12px of border plus 10px of gap on each side leaves 356px of the 400.
  const expected = (400 - (12 + 10) * 2) / (framed.meta.moduleCount + 8);
  assert.ok(Math.abs(framed.meta.modulePixelSize - expected) < 0.001, 'the frame inset is not exact');
});

test('a border that leaves no room reports why', () => {
  assert.throws(
    () => renderSvg({ data: PAYLOAD, width: 64, border: { width: 30, gap: 10 } }),
    /border, margin and caption leave no room/i,
  );
});

test('the border rounds with the background unless told otherwise', () => {
  const matched = resolveDesign({ data: 'x', background: { round: 0.4 }, border: { width: 6 } });
  assert.equal(matched.border.radius, 0.4);

  const separate = resolveDesign({ data: 'x', background: { round: 0.4 }, border: { width: 6, radius: 0 } });
  assert.equal(separate.border.radius, 0);
});

test('the border colour follows the modules unless told otherwise', () => {
  const inherited = resolveDesign({ data: 'x', dots: { color: '#123456' }, border: { width: 4 } });
  assert.equal(inherited.border.color, '#123456');
});

test('a caption band fills the width inside the border', () => {
  const { svg } = renderSvg({
    data: PAYLOAD,
    width: 500,
    border: { width: 8, color: '#1d4ed8', radius: 0.1, gap: 6 },
    caption: { text: 'SCAN ME', color: '#ffffff', background: '#1d4ed8' },
  });
  assert.ok(svg.includes('fill="#1d4ed8"'), 'the band was not painted');
  assert.ok(svg.includes('SCAN ME'));
  assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length);
});

test('a top caption band sits above the code', () => {
  const { svg } = renderSvg({
    data: PAYLOAD,
    width: 500,
    caption: { text: 'SCAN ME', position: 'top', background: '#0f172a', color: '#ffffff' },
  });
  assert.ok(svg.includes('SCAN ME'));
  assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length);
});

test('a gradient border is drawn with the gradient as its stroke', () => {
  const { svg } = renderSvg({
    data: PAYLOAD,
    width: 500,
    border: {
      width: 12,
      gap: 6,
      gradient: {
        type: 'linear',
        rotation: 45,
        colorStops: [
          { offset: 0, color: '#f97316' },
          { offset: 1, color: '#db2777' },
        ],
      },
    },
  });
  assert.ok(svg.includes('linearGradient'));
  assert.match(svg, /stroke="url\(#/);
  assert.equal(decodeScore(svg, PAYLOAD), SCAN_WIDTHS.length);
});

test('invalid borders are rejected', () => {
  const cases: [unknown, RegExp][] = [
    [{ data: 'x', border: { width: -1 } }, /border\.width must be between/],
    [{ data: 'x', border: { width: 9999 } }, /border\.width must be between/],
    [{ data: 'x', border: { width: 4, style: 'groove' } }, /border\.style must be one of/],
    [{ data: 'x', border: { width: 4, radius: 2 } }, /border\.radius must be between/],
    [{ data: 'x', border: { width: 4, color: 'red"/><script>' } }, /not a valid colour/],
    [{ data: 'x', caption: { text: 'hi', background: 'nope"/><script>' } }, /not a valid colour/],
  ];
  for (const [design, pattern] of cases) {
    assert.throws(() => resolveDesign(design as never), pattern, `expected ${String(pattern)}`);
  }
});
