import type { EccLevel } from '../core/tables.js';
import type { EncodingMode } from '../core/segments.js';

export type { EccLevel, EncodingMode };

/** A stop in a gradient, positioned between 0 and 1. */
export interface ColorStop {
  offset: number;
  color: string;
  opacity?: number;
}

export interface Gradient {
  type: 'linear' | 'radial';
  /** Rotation of a linear gradient in degrees, clockwise from left-to-right. */
  rotation?: number;
  colorStops: ColorStop[];
}

/** A solid colour, a gradient, or both (the gradient wins). */
export interface Fill {
  color?: string;
  gradient?: Gradient;
  opacity?: number;
}

/** Shapes available for individual modules. */
export const DOT_TYPES = [
  'square',
  'rounded',
  'extra-rounded',
  'classy',
  'classy-rounded',
  'dot',
  'diamond',
  'star',
  'plus',
  'cross',
  'heart',
  'vertical-line',
  'horizontal-line',
  'random-dot',
] as const;
export type DotType = (typeof DOT_TYPES)[number];

/** Shapes available for the 7x7 ring of the three finder patterns. */
export const CORNER_SQUARE_TYPES = [
  'square',
  'rounded',
  'extra-rounded',
  'dot',
  'classy',
  'classy-rounded',
  'diamond',
  'leaf',
] as const;
export type CornerSquareType = (typeof CORNER_SQUARE_TYPES)[number];

/** The 3x3 centre of a finder pattern may use any module shape. */
export type CornerDotType = DotType;

export type FinderCorner = 'top-left' | 'top-right' | 'bottom-left';

export interface DotOptions extends Fill {
  type?: DotType;
  /**
   * Module size as a fraction of the grid pitch (0.1-1). Below 1 the modules
   * shrink and gaps appear between them.
   */
  scale?: number;
  /** Seed for the `random-dot` shape, so renders stay reproducible. */
  randomSeed?: number;
}

export interface CornerSquareOptions extends Fill {
  type?: CornerSquareType;
  /** Per-corner overrides, e.g. a differently coloured top-left eye. */
  corners?: Partial<Record<FinderCorner, Omit<CornerSquareOptions, 'corners'>>>;
}

export interface CornerDotOptions extends Fill {
  type?: CornerDotType;
  corners?: Partial<Record<FinderCorner, Omit<CornerDotOptions, 'corners'>>>;
}

export interface AlignmentOptions extends Fill {
  /** `as-data` draws alignment patterns with the regular module shape. */
  type?: 'as-data' | CornerSquareType;
  /** Shape of the single centre module when `type` is not `as-data`. */
  centerType?: CornerDotType;
}

export interface BackgroundOptions extends Fill {
  /** Corner rounding of the background plate, 0 (square) to 1 (fully round). */
  round?: number;
}

export type ImageShape = 'square' | 'circle' | 'rounded';

export interface ImageOptions {
  /** `data:` URI or http(s) URL of the logo to place at the centre. */
  src?: string;
  /** Logo width as a fraction of the symbol width (0.05-0.5). */
  size?: number;
  /** Clear space kept around the logo, in modules. */
  margin?: number;
  /** Remove the modules covered by the logo instead of drawing behind it. */
  hideBackgroundDots?: boolean;
  /** Plate drawn beneath the logo; `none` disables it. */
  background?: string;
  shape?: ImageShape;
  /** Corner rounding when `shape` is `rounded`, 0-1. */
  round?: number;
  opacity?: number;
  /** SVG `preserveAspectRatio` value for the embedded image. */
  preserveAspectRatio?: string;
}

export interface CaptionOptions {
  text?: string;
  position?: 'bottom' | 'top';
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  letterSpacing?: number;
  /** Space between the symbol and the caption, in pixels. */
  gap?: number;
}

export interface EncodingOptions {
  errorCorrectionLevel?: EccLevel;
  version?: number | 'auto';
  minVersion?: number;
  mask?: number | 'auto';
  mode?: EncodingMode | 'auto';
  /** Prefix the payload with an ECI header declaring UTF-8. */
  utf8Eci?: boolean;
}

export interface QrDesign {
  /** The payload encoded into the symbol. */
  data: string;
  width?: number;
  height?: number;
  /** Padding in pixels around the whole drawing, inside the background plate. */
  margin?: number;
  /** Light border around the symbol measured in modules; 4 is the standard. */
  quietZone?: number;
  /** Clip the drawing to a circle instead of a square. */
  shape?: 'square' | 'circle';
  /** Rotate the whole symbol by this many degrees. */
  rotation?: number;
  encoding?: EncodingOptions;
  dots?: DotOptions;
  cornersSquare?: CornerSquareOptions;
  cornersDot?: CornerDotOptions;
  alignment?: AlignmentOptions;
  background?: BackgroundOptions;
  image?: ImageOptions;
  caption?: CaptionOptions;
  /** Pretty-print the SVG output. */
  pretty?: boolean;
}

/** A design with every optional field filled in and validated. */
export interface ResolvedFill {
  color: string;
  gradient?: Gradient;
  opacity: number;
}

export interface ResolvedDots extends ResolvedFill {
  type: DotType;
  scale: number;
  randomSeed: number;
}

export interface ResolvedCornerSquare extends ResolvedFill {
  type: CornerSquareType;
}

export interface ResolvedCornerDot extends ResolvedFill {
  type: CornerDotType;
}

export interface ResolvedAlignment extends ResolvedFill {
  type: 'as-data' | CornerSquareType;
  centerType: CornerDotType;
}

export interface ResolvedBackground extends ResolvedFill {
  round: number;
}

export interface ResolvedImage {
  src?: string;
  size: number;
  margin: number;
  hideBackgroundDots: boolean;
  background: string;
  shape: ImageShape;
  round: number;
  opacity: number;
  preserveAspectRatio: string;
}

export interface ResolvedCaption {
  text: string;
  position: 'bottom' | 'top';
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  letterSpacing: number;
  gap: number;
}

export interface ResolvedEncoding {
  errorCorrectionLevel: EccLevel;
  version: number | 'auto';
  minVersion: number;
  mask: number | 'auto';
  mode: EncodingMode | 'auto';
  utf8Eci: boolean;
}

export interface ResolvedDesign {
  data: string;
  width: number;
  height: number;
  margin: number;
  quietZone: number;
  shape: 'square' | 'circle';
  rotation: number;
  encoding: ResolvedEncoding;
  dots: ResolvedDots;
  cornersSquare: ResolvedCornerSquare & { corners: Partial<Record<FinderCorner, ResolvedCornerSquare>> };
  cornersDot: ResolvedCornerDot & { corners: Partial<Record<FinderCorner, ResolvedCornerDot>> };
  alignment: ResolvedAlignment;
  background: ResolvedBackground;
  image: ResolvedImage;
  caption: ResolvedCaption;
  pretty: boolean;
}

export interface RenderMeta {
  version: number;
  errorCorrectionLevel: EccLevel;
  mask: number;
  mode: EncodingMode;
  /** Symbol width in modules, excluding the quiet zone. */
  moduleCount: number;
  /** Rendered pixel size of one module. */
  modulePixelSize: number;
  width: number;
  height: number;
  /** Fraction of the symbol's modules hidden behind the logo. */
  logoCoverage: number;
  /** Non-fatal advice about scannability. */
  warnings: string[];
}

export interface RenderResult {
  svg: string;
  meta: RenderMeta;
}
