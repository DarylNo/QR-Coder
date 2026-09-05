import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
const jsQR = require('jsqr').default as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

/** Rasterize an SVG and read the QR code back out of the pixels. */
export function decodeSvg(svg: string, pixelWidth: number): string | null {
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: pixelWidth },
    background: '#ffffff',
    font: { loadSystemFonts: true },
  }).render();
  return jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height)?.data ?? null;
}

export const SCAN_WIDTHS = [300, 400, 600, 800, 1000] as const;

/** How many of the sample rasterization sizes decode back to `expected`. */
export function decodeScore(svg: string, expected: string): number {
  return SCAN_WIDTHS.filter((width) => decodeSvg(svg, width) === expected).length;
}
