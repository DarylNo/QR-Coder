/**
 * Turns an image into the coarse module grid an `emblem` needs, so a real logo
 * can be drawn out of the QR code's own modules.
 *
 * Runs in the browser (canvas) and in Node (the optional `@resvg/resvg-js`
 * dependency). It is deliberately kept out of the renderer, which stays
 * synchronous and free of both.
 */

import { trimGrid } from './emblem.js';

export interface ImageGridOptions {
  /** Width and height of the sampling square, in modules. */
  modules?: number;
  /** How dark, or how opaque, a module must be to count as filled (0-1). */
  threshold?: number;
  /** Fill the light parts of the image instead of the dark parts. */
  invert?: boolean;
  /**
   * What decides a module: the image's transparency, its darkness, or
   * whichever suits the image (`auto`, the default).
   */
  source?: 'alpha' | 'luminance' | 'auto';
}

/** Pixels sampled per module along each axis before averaging. */
const OVERSAMPLE = 8;

export interface RgbaImage {
  pixels: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Reduce an RGBA bitmap to emblem grid rows. Exposed separately so callers that
 * already have pixels — a canvas, an image decoder — can skip rasterizing.
 */
export function pixelsToGrid(image: RgbaImage, options: ImageGridOptions = {}): string[] {
  const modules = Math.max(3, Math.min(120, Math.round(options.modules ?? 15)));
  const threshold = options.threshold ?? 0.5;
  const cellWidth = image.width / modules;
  const cellHeight = image.height / modules;

  const alpha: number[] = [];
  const luminance: number[] = [];

  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      let alphaSum = 0;
      let luminanceSum = 0;
      let opaqueWeight = 0;
      let samples = 0;

      const startX = Math.floor(column * cellWidth);
      const endX = Math.max(startX + 1, Math.floor((column + 1) * cellWidth));
      const startY = Math.floor(row * cellHeight);
      const endY = Math.max(startY + 1, Math.floor((row + 1) * cellHeight));

      for (let y = startY; y < endY && y < image.height; y++) {
        for (let x = startX; x < endX && x < image.width; x++) {
          const offset = (y * image.width + x) * 4;
          const a = (image.pixels[offset + 3] ?? 0) / 255;
          const r = (image.pixels[offset] ?? 0) / 255;
          const g = (image.pixels[offset + 1] ?? 0) / 255;
          const b = (image.pixels[offset + 2] ?? 0) / 255;
          alphaSum += a;
          // Weighted by alpha, so transparent pixels do not drag the average
          // towards whatever colour happens to sit behind them.
          luminanceSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
          opaqueWeight += a;
          samples++;
        }
      }

      alpha.push(samples ? alphaSum / samples : 0);
      luminance.push(opaqueWeight > 0 ? luminanceSum / opaqueWeight : 1);
    }
  }

  const source = options.source && options.source !== 'auto' ? options.source : chooseSource(alpha, luminance, threshold);

  const rows: string[] = [];
  for (let row = 0; row < modules; row++) {
    let line = '';
    for (let column = 0; column < modules; column++) {
      const index = row * modules + column;
      const filled =
        source === 'alpha'
          ? alpha[index]! >= threshold
          : alpha[index]! >= 0.5 && luminance[index]! <= 1 - threshold;
      line += filled !== Boolean(options.invert) ? '#' : '.';
    }
    rows.push(line);
  }

  return trimGrid(rows);
}

/**
 * Decide whether transparency or darkness describes the image better.
 *
 * A silhouette on a transparent background is best read from its alpha. But a
 * logo with light detail cut into a solid shape — a monogram inside a disc —
 * loses that detail if alpha decides, because the whole disc is opaque. So when
 * the opaque area contains both clearly dark and clearly light regions, the
 * darkness is what carries the shape.
 */
function chooseSource(alpha: number[], luminance: number[], threshold: number): 'alpha' | 'luminance' {
  const opaque = luminance.filter((_value, index) => alpha[index]! >= 0.5);
  if (opaque.length === 0) return 'alpha';
  const dark = opaque.filter((value) => value <= 1 - threshold).length / opaque.length;
  const light = opaque.filter((value) => value > 1 - threshold).length / opaque.length;
  const hasTransparency = alpha.some((value) => value < 0.1);
  if (!hasTransparency) return 'luminance';
  return dark >= 0.15 && light >= 0.15 ? 'luminance' : 'alpha';
}

/**
 * Rasterize an image and reduce it to emblem grid rows. `src` may be a
 * `data:image/*` URI or, in the browser, any URL the page is allowed to read.
 */
export async function imageToGrid(src: string, options: ImageGridOptions = {}): Promise<string[]> {
  const modules = Math.max(3, Math.min(120, Math.round(options.modules ?? 15)));
  const side = modules * OVERSAMPLE;
  const image =
    typeof document === 'undefined' ? await rasterizeWithResvg(src, side) : await rasterizeWithCanvas(src, side);
  return pixelsToGrid(image, { ...options, modules });
}

async function rasterizeWithResvg(src: string, side: number): Promise<RgbaImage> {
  let Resvg: typeof import('@resvg/resvg-js').Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    throw new Error(
      'Converting an image to an emblem grid outside the browser requires the optional dependency ' +
        '"@resvg/resvg-js". Install it, or pass pixels to pixelsToGrid yourself.',
    );
  }

  // Wrapping the source in an SVG lets one rasterizer handle SVG and bitmap
  // logos alike, and letterboxes them into the square the sampler expects.
  const wrapper =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">` +
    `<image href="${escapeAttribute(src)}" x="0" y="0" width="${side}" height="${side}" ` +
    `preserveAspectRatio="xMidYMid meet"/></svg>`;

  const rendered = new Resvg(wrapper, { fitTo: { mode: 'width', value: side } }).render();
  return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
}

async function rasterizeWithCanvas(src: string, side: number): Promise<RgbaImage> {
  const element = new Image();
  element.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('The image could not be loaded.'));
    element.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not provide a 2D canvas context.');

  // Letterbox to match the Node path, so both produce the same grid.
  const scale = Math.min(side / element.width, side / element.height);
  const width = element.width * scale;
  const height = element.height * scale;
  context.drawImage(element, (side - width) / 2, (side - height) / 2, width, height);

  const data = context.getImageData(0, 0, side, side);
  return { pixels: data.data, width: data.width, height: data.height };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
