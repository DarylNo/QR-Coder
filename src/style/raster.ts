import type { QrDesign, RenderMeta } from './types.js';
import { renderSvg } from './render-svg.js';

export interface RasterOptions {
  /** Multiplier applied to the design's pixel size, for high-DPI output. */
  scale?: number;
  /** Background painted underneath a transparent design, e.g. `#ffffff`. */
  background?: string;
}

export interface RasterResult {
  png: Uint8Array;
  meta: RenderMeta;
}

/**
 * Rasterize a design to PNG. Requires the optional `@resvg/resvg-js`
 * dependency; SVG output has no such requirement.
 */
export async function renderPng(design: QrDesign, options: RasterOptions = {}): Promise<RasterResult> {
  const { svg, meta } = renderSvg(design);
  const scale = Math.min(8, Math.max(0.25, options.scale ?? 1));

  let Resvg: typeof import('@resvg/resvg-js').Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    throw new Error(
      'PNG output requires the optional dependency "@resvg/resvg-js". ' +
        'Install it with `npm install @resvg/resvg-js`, or request SVG output instead.',
    );
  }

  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(meta.width * scale)) },
    ...(options.background ? { background: options.background } : {}),
    font: { loadSystemFonts: true },
  });
  return { png: renderer.render().asPng(), meta };
}

/** Convenience wrapper returning a `data:` URI for an SVG design. */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
