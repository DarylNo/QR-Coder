import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderPsd } from '../src/style/psd.js';
import { renderLayers } from '../src/style/render-svg.js';
import { PRESETS } from '../src/presets.js';

const require = createRequire(import.meta.url);
const agPsd = require('ag-psd') as typeof import('ag-psd');
const jsQR = require('jsqr').default as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

// ag-psd's reader allocates pixel buffers through a canvas; a plain object does
// the same job in Node, and only the tests ever read a PSD back.
agPsd.initializeCanvas(
  () => {
    throw new Error('a real canvas is never needed here');
  },
  (width: number, height: number) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

const PAYLOAD = 'https://example.com/qr-coder';

function parse(psd: Uint8Array): import('ag-psd').Psd {
  const buffer = psd.buffer.slice(psd.byteOffset, psd.byteOffset + psd.byteLength) as ArrayBuffer;
  return agPsd.readPsd(buffer, { useImageData: true, skipThumbnail: true });
}

/** Composite an RGBA layer over white, the way a viewer would. */
function overWhite(image: { width: number; height: number; data: ArrayLike<number> }): Uint8ClampedArray {
  const flat = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i++) {
    const alpha = image.data[i * 4 + 3]! / 255;
    for (let channel = 0; channel < 3; channel++) {
      flat[i * 4 + channel] = image.data[i * 4 + channel]! * alpha + 255 * (1 - alpha);
    }
    flat[i * 4 + 3] = 255;
  }
  return flat;
}

test('a PSD carries one layer per part of the design', async () => {
  const framed = PRESETS.find((preset) => preset.id === 'framed')!.design;
  const { psd, layerNames } = await renderPsd({ data: PAYLOAD, width: 400, ...framed });

  assert.deepEqual(layerNames, ['Background', 'Modules', 'Finder patterns', 'Caption', 'Border']);
  const parsed = parse(psd);
  assert.deepEqual(parsed.children?.map((child) => child.name), layerNames);
  // Every layer must actually carry pixels, or Photoshop shows an empty row.
  for (const child of parsed.children ?? []) {
    const data = child.imageData;
    assert.ok(data, `layer "${child.name}" has no pixel data`);
    const opaque = [...data.data].filter((_value, index) => index % 4 === 3 && data.data[index]! > 8).length;
    assert.ok(opaque > 0, `layer "${child.name}" is completely transparent`);
  }
});

test('the layer list follows what the design actually contains', async () => {
  const plain = await renderPsd({ data: PAYLOAD, width: 300 });
  assert.deepEqual(plain.layerNames, ['Background', 'Modules', 'Finder patterns']);

  const withEmblem = await renderPsd({
    data: PAYLOAD,
    width: 300,
    encoding: { errorCorrectionLevel: 'H' },
    emblem: { shape: 'heart', size: 0.3, style: 'ink', color: '#db2777' },
  });
  assert.ok(withEmblem.layerNames.includes('Emblem'));
});

test('the flattened composite still scans', async () => {
  const framed = PRESETS.find((preset) => preset.id === 'framed')!.design;
  const { psd } = await renderPsd({ data: PAYLOAD, width: 500, ...framed }, { scale: 1.5 });
  const composite = parse(psd).imageData;
  assert.ok(composite, 'the PSD has no composite image');
  assert.equal(jsQR(overWhite(composite), composite.width, composite.height)?.data, PAYLOAD);
});

test('scale and DPI are honoured', async () => {
  const { psd } = await renderPsd({ data: PAYLOAD, width: 200 }, { scale: 2, dpi: 300 });
  const parsed = parse(psd);
  assert.equal(parsed.width, 400);
  assert.equal(parsed.height, 400);
  assert.equal(parsed.imageResources?.resolutionInfo?.horizontalResolution, 300);
  assert.equal(parsed.imageResources?.resolutionInfo?.verticalResolution, 300);
});

test('flattening collapses the design to a single layer', async () => {
  const framed = PRESETS.find((preset) => preset.id === 'framed')!.design;
  const { psd, layerNames } = await renderPsd({ data: PAYLOAD, width: 300, ...framed }, { flatten: true });
  assert.deepEqual(layerNames, ['QR code']);
  assert.equal(parse(psd).children?.length, 1);
});

test('a PSD beyond Photoshop\'s size limit is refused', async () => {
  await assert.rejects(
    () => renderPsd({ data: PAYLOAD, width: 4096 }, { scale: 8 }),
    /beyond Photoshop's 30000 pixel limit/,
  );
});

test('layers stack back into the flat rendering', () => {
  const framed = PRESETS.find((preset) => preset.id === 'framed')!.design;
  const { svg, layers } = renderLayers({ data: PAYLOAD, width: 400, ...framed });
  assert.ok(layers.length > 1);
  for (const layer of layers) {
    assert.match(layer.content, /^<svg /);
    assert.match(layer.content, /<\/svg>$/);
  }
  // Each fragment appears in the flat drawing, so nothing is invented or lost.
  const stripped = layers.map((layer) => layer.content.replace(/^<svg[^>]*>(?:<defs>.*?<\/defs>)?/, '').replace(/<\/svg>$/, ''));
  for (const fragment of stripped) {
    for (const path of fragment.match(/ d="[^"]+"/g) ?? []) {
      assert.ok(svg.includes(path), 'a layer drew something the flat rendering does not have');
    }
  }
});
