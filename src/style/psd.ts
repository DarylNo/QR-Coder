/**
 * Layered Photoshop export.
 *
 * Each part of the drawing — the background plate, the modules, the finder
 * patterns, a logo, a caption, a border — is rasterized on its own transparent
 * canvas and written as a separate PSD layer, so the design arrives in
 * Photoshop as something that can still be taken apart rather than a flat
 * picture of itself.
 */

import type { QrDesign, RenderMeta } from './types.js';
import { renderLayers } from './render-svg.js';

export interface PsdOptions {
  /** Multiplier applied to the design's pixel size, for high-resolution output. */
  scale?: number;
  /** Resolution written into the file, in pixels per inch. */
  dpi?: number;
  /** Flatten everything into a single layer instead of keeping them separate. */
  flatten?: boolean;
}

export interface PsdResult {
  psd: Uint8Array;
  meta: RenderMeta;
  /** Names of the layers written, in bottom-to-top order. */
  layerNames: string[];
}

interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Photoshop's own ceiling; beyond it the file cannot be opened. */
const MAX_SIDE = 30_000;

export async function renderPsd(design: QrDesign, options: PsdOptions = {}): Promise<PsdResult> {
  const { svg, meta, layers, width, height } = renderLayers(design);
  const scale = Math.min(8, Math.max(0.25, options.scale ?? 1));
  const dpi = Math.min(2400, Math.max(1, Math.round(options.dpi ?? 72)));

  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));
  if (pixelWidth > MAX_SIDE || pixelHeight > MAX_SIDE) {
    throw new Error(
      `A ${pixelWidth}x${pixelHeight} PSD is beyond Photoshop's ${MAX_SIDE} pixel limit; reduce the scale.`,
    );
  }

  const [{ Resvg }, { writePsd }] = await Promise.all([loadResvg(), loadAgPsd()]);

  const rasterize = (document: string): Bitmap => {
    const rendered = new Resvg(document, {
      fitTo: { mode: 'width', value: pixelWidth },
      font: { loadSystemFonts: true },
    }).render();
    return {
      width: rendered.width,
      height: rendered.height,
      data: new Uint8ClampedArray(rendered.pixels),
    };
  };

  const composite = rasterize(svg);
  const children = options.flatten
    ? [{ name: 'QR code', imageData: composite }]
    : layers.map((layer) => ({ name: layer.name, imageData: rasterize(layer.content) }));

  const file = writePsd({
    width: composite.width,
    height: composite.height,
    children,
    // The flattened copy is what every other application shows, and what
    // Photoshop falls back to when it cannot read the layer data.
    imageData: composite,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: 'PPI',
        verticalResolution: dpi,
        verticalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        heightUnit: 'Inches',
      },
    },
  });

  return {
    psd: new Uint8Array(file),
    meta,
    layerNames: children.map((child) => child.name),
  };
}

async function loadResvg(): Promise<typeof import('@resvg/resvg-js')> {
  try {
    return await import('@resvg/resvg-js');
  } catch {
    throw new Error(
      'PSD output requires the optional dependency "@resvg/resvg-js". ' +
        'Install it, or request SVG output instead.',
    );
  }
}

async function loadAgPsd(): Promise<typeof import('ag-psd')> {
  try {
    return await import('ag-psd');
  } catch {
    throw new Error('PSD output requires the "ag-psd" dependency. Install it, or request SVG output instead.');
  }
}
