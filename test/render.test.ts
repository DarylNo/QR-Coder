import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg } from '../src/style/render-svg.js';
import { resolveDesign } from '../src/style/defaults.js';
import { DesignError } from '../src/style/sanitize.js';
import { CORNER_SQUARE_TYPES, DOT_TYPES } from '../src/style/types.js';
import { PRESETS } from '../src/presets.js';
import { SCAN_WIDTHS, decodeScore, decodeSvg } from './helpers.js';

const URL_PAYLOAD = 'https://example.com/qr-coder?ref=test';

/**
 * Finder shapes that trade decoder margin for looks. They are offered on
 * purpose, but only the square-ish shapes are held to the strict standard.
 */
const LENIENT_FINDERS = new Set(['dot', 'classy', 'classy-rounded', 'diamond']);

test('every module shape decodes at every sample size', () => {
  for (const type of DOT_TYPES) {
    const { svg } = renderSvg({ data: URL_PAYLOAD, width: 400, dots: { type } });
    assert.equal(
      decodeScore(svg, URL_PAYLOAD),
      SCAN_WIDTHS.length,
      `module shape "${type}" failed to decode at one or more sizes`,
    );
  }
});

test('finder shapes render and the square-based ones decode reliably', () => {
  for (const type of CORNER_SQUARE_TYPES) {
    const { svg, meta } = renderSvg({ data: URL_PAYLOAD, width: 400, cornersSquare: { type } });
    assert.match(svg, /^<svg /);
    if (LENIENT_FINDERS.has(type)) {
      assert.ok(meta.warnings.length > 0, `finder shape "${type}" should warn about decoder margin`);
    } else {
      assert.equal(
        decodeScore(svg, URL_PAYLOAD),
        SCAN_WIDTHS.length,
        `finder shape "${type}" failed to decode at one or more sizes`,
      );
    }
  }
});

test('module scale, quiet zone and error correction variations decode', () => {
  for (const scale of [0.9, 0.95, 1]) {
    for (const errorCorrectionLevel of ['L', 'M', 'Q', 'H'] as const) {
      const { svg } = renderSvg({
        data: URL_PAYLOAD,
        width: 500,
        quietZone: 4,
        dots: { type: 'rounded', scale },
        encoding: { errorCorrectionLevel },
      });
      assert.equal(decodeSvg(svg, 600), URL_PAYLOAD, `scale ${scale} at level ${errorCorrectionLevel}`);
    }
  }
});

test('thinned modules are flagged as a scanning risk', () => {
  const { meta } = renderSvg({ data: URL_PAYLOAD, dots: { scale: 0.7 } });
  assert.ok(meta.warnings.some((warning) => /module scale/i.test(warning)), meta.warnings.join(' | '));
});

test('gradients, captions, circular cropping and rotation stay scannable', () => {
  const designs = [
    {
      dots: {
        type: 'rounded' as const,
        gradient: {
          type: 'linear' as const,
          rotation: 45,
          colorStops: [
            { offset: 0, color: '#f97316' },
            { offset: 1, color: '#7c3aed' },
          ],
        },
      },
    },
    {
      dots: {
        type: 'square' as const,
        gradient: {
          type: 'radial' as const,
          colorStops: [
            { offset: 0, color: '#0ea5e9' },
            { offset: 1, color: '#0f172a' },
          ],
        },
      },
    },
    { shape: 'circle' as const, quietZone: 6 },
    { caption: { text: 'SCAN ME', letterSpacing: 2 } },
    { rotation: 90 },
    { rotation: 180 },
    { background: { color: '#0b1120' }, dots: { color: '#e2e8f0' } },
  ];

  for (const [index, design] of designs.entries()) {
    const { svg } = renderSvg({ data: URL_PAYLOAD, width: 500, ...design });
    assert.equal(decodeSvg(svg, 700), URL_PAYLOAD, `design ${index} failed to decode`);
  }
});

test('a centred logo leaves the payload recoverable', () => {
  // A 1x1 red pixel is enough to prove the modules underneath are cleared.
  const src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { svg, meta } = renderSvg({
    data: URL_PAYLOAD,
    width: 500,
    encoding: { errorCorrectionLevel: 'H' },
    image: { src, size: 0.22, margin: 1, background: '#ffffff' },
  });
  assert.equal(decodeSvg(svg, 700), URL_PAYLOAD);
  assert.ok(meta.logoCoverage > 0 && meta.logoCoverage < 0.2);
  assert.deepEqual(meta.warnings, []);
});

test('an oversized logo is reported as a warning', () => {
  const src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { meta } = renderSvg({
    data: URL_PAYLOAD,
    width: 500,
    encoding: { errorCorrectionLevel: 'L' },
    image: { src, size: 0.5, margin: 4 },
  });
  assert.ok(meta.warnings.some((warning) => /logo hides/i.test(warning)), meta.warnings.join(' | '));
});

test('every preset decodes', () => {
  for (const preset of PRESETS) {
    const { svg } = renderSvg({ data: URL_PAYLOAD, width: 500, ...preset.design });
    assert.equal(
      decodeScore(svg, URL_PAYLOAD),
      SCAN_WIDTHS.length,
      `preset "${preset.id}" failed to decode at one or more sizes`,
    );
  }
});

test('metadata describes the generated symbol', () => {
  const { meta } = renderSvg({
    data: 'HELLO',
    width: 300,
    encoding: { errorCorrectionLevel: 'Q', version: 4, mask: 2 },
  });
  assert.equal(meta.version, 4);
  assert.equal(meta.errorCorrectionLevel, 'Q');
  assert.equal(meta.mask, 2);
  assert.equal(meta.mode, 'alphanumeric');
  assert.equal(meta.moduleCount, 33);
  assert.equal(meta.width, 300);
  assert.equal(meta.modulePixelSize, 300 / (33 + 8));
});

test('rendering is deterministic', () => {
  const design = { data: URL_PAYLOAD, dots: { type: 'random-dot' as const, randomSeed: 7 } };
  assert.equal(renderSvg(design).svg, renderSvg(design).svg);
  const other = renderSvg({ ...design, dots: { type: 'random-dot' as const, randomSeed: 8 } }).svg;
  assert.notEqual(renderSvg(design).svg, other);
});

test('untrusted input cannot break out of the SVG', () => {
  const { svg } = renderSvg({
    data: '<script>alert(1)</script>',
    caption: { text: '</text><script>alert(1)</script>' },
  });
  assert.ok(!svg.includes('<script'), 'script tag leaked into the SVG');
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('invalid designs are rejected with a helpful message', () => {
  const cases: [unknown, RegExp][] = [
    [{ data: '' }, /data is required/],
    [{ data: 'x', dots: { color: 'red"/><script>' } }, /not a valid colour/],
    [{ data: 'x', dots: { type: 'triangle' } }, /dots\.type must be one of/],
    [{ data: 'x', image: { src: 'javascript:alert(1)' } }, /image\.src must be/],
    [{ data: 'x', width: 10 }, /width must be between/],
    [{ data: 'x', width: 100000 }, /width must be between/],
    [{ data: 'x', encoding: { version: 41 } }, /encoding\.version must be between/],
    [{ data: 'x', encoding: { mask: 9 } }, /encoding\.mask must be between/],
    [{ data: 'x', dots: { gradient: { colorStops: [{ offset: 0, color: 'red' }] } } }, /at least two stops/],
    [{ data: 'x'.repeat(5000) }, /at most/],
  ];
  for (const [design, pattern] of cases) {
    assert.throws(() => resolveDesign(design as never), pattern, `expected ${String(pattern)}`);
    assert.throws(() => renderSvg(design as never), DesignError);
  }
});

test('colour formats accepted by the validator', () => {
  for (const color of ['#fff', '#ffffff', '#ffffffcc', 'rebeccapurple', 'rgb(10, 20, 30)', 'hsl(200 50% 40%)']) {
    assert.doesNotThrow(() => resolveDesign({ data: 'x', dots: { color } }));
  }
});

test('per-corner overrides colour each finder independently', () => {
  const { svg } = renderSvg({
    data: URL_PAYLOAD,
    width: 400,
    cornersSquare: {
      color: '#111111',
      corners: {
        'top-right': { color: '#ff0000' },
        'bottom-left': { color: '#0000ff', type: 'dot' },
      },
    },
  });
  assert.ok(svg.includes('#ff0000'), 'top-right override missing');
  assert.ok(svg.includes('#0000ff'), 'bottom-left override missing');
  assert.equal(decodeSvg(svg, 700), URL_PAYLOAD);
});

test('long payloads at large versions still decode', () => {
  const payload = `https://example.com/${'segment/'.repeat(40)}`;
  const { svg, meta } = renderSvg({ data: payload, width: 900, dots: { type: 'rounded' } });
  assert.ok(meta.version >= 10, `expected a large symbol, got version ${meta.version}`);
  assert.equal(decodeSvg(svg, 900), payload);
});

test('low-contrast palettes are flagged', () => {
  const { meta } = renderSvg({
    data: URL_PAYLOAD,
    dots: { color: '#f59e0b' },
    background: { color: '#ffffff' },
  });
  assert.ok(
    meta.warnings.some((warning) => /contrast ratio/i.test(warning)),
    meta.warnings.join(' | '),
  );
});

test('a plain default design produces no warnings', () => {
  assert.deepEqual(renderSvg({ data: URL_PAYLOAD }).meta.warnings, []);
});
