/**
 * QR-Coder — customizable QR code generation.
 *
 * The encoder in `core/` is a dependency-free implementation of ISO/IEC 18004;
 * the renderer in `style/` turns the resulting module matrix into SVG with full
 * control over shapes, colours, gradients and logo placement.
 */
export { renderSvg } from './style/render-svg.js';
export { renderPng, svgDataUri, type RasterOptions, type RasterResult } from './style/raster.js';
export { resolveDesign, LIMITS } from './style/defaults.js';
export {
  imageToGrid,
  pixelsToGrid,
  type ImageGridOptions,
  type RgbaImage,
} from './style/image-grid.js';
export {
  buildEmblem,
  trimGrid,
  EMBLEM_SHAPES,
  EMBLEM_STYLES,
  type EmblemShape,
  type EmblemStyle,
} from './style/emblem.js';
export { DesignError } from './style/sanitize.js';
export { encodeQr, assessDamage, ModuleRegion, type QrSymbol, type EncodeOptions } from './core/matrix.js';
export { PRESETS, findPreset, type Preset } from './presets.js';
export {
  DOT_TYPES,
  CORNER_SQUARE_TYPES,
  type QrDesign,
  type RenderResult,
  type RenderMeta,
  type DotType,
  type CornerSquareType,
  type CornerDotType,
  type Gradient,
  type ColorStop,
  type EccLevel,
  type EncodingMode,
  type EmblemOptions,
} from './style/types.js';
