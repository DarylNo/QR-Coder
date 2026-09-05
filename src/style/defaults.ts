import { ECC_LEVELS, MAX_VERSION, MIN_VERSION } from '../core/tables.js';
import { EMBLEM_SHAPES, EMBLEM_STYLES, trimGrid } from './emblem.js';
import {
  BORDER_STYLES,
  CORNER_SQUARE_TYPES,
  DOT_TYPES,
  type CornerDotType,
  type CornerSquareType,
  type DotType,
  type FinderCorner,
  type Gradient,
  type QrDesign,
  type ResolvedCornerDot,
  type ResolvedCornerSquare,
  type ResolvedDesign,
} from './types.js';
import {
  DesignError,
  requireNumber,
  requireOneOf,
  sanitizeColor,
  sanitizeImageSrc,
} from './sanitize.js';

/** Upper bounds that keep a single request from producing an enormous drawing. */
export const LIMITS = {
  minSize: 32,
  maxSize: 4096,
  maxMargin: 512,
  maxQuietZone: 24,
  maxDataLength: 4296,
  maxColorStops: 12,
  maxCaptionLength: 200,
  maxEmblemGridRows: 200,
  maxBorderWidth: 200,
  maxImageBytes: 2 * 1024 * 1024,
} as const;

const FINDER_CORNERS: FinderCorner[] = ['top-left', 'top-right', 'bottom-left'];

const DEFAULT_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Module shapes that leave large gaps inside their cell. Decoders locate the
 * alignment patterns by their solid 5x5 ring, so these shapes get a solid
 * alignment pattern by default rather than being drawn module by module.
 */
export const SPARSE_DOT_TYPES: readonly DotType[] = [
  'diamond',
  'star',
  'plus',
  'cross',
  'heart',
  'random-dot',
];

export function isSparseDotType(type: DotType): boolean {
  return SPARSE_DOT_TYPES.includes(type);
}

/** Finder ring shape that best matches a given module shape. */
function inferCornerSquareType(dotType: DotType): CornerSquareType {
  switch (dotType) {
    case 'rounded': return 'rounded';
    case 'extra-rounded': return 'extra-rounded';
    case 'classy': return 'classy';
    case 'classy-rounded': return 'classy-rounded';
    case 'dot':
    case 'random-dot': return 'dot';
    case 'diamond': return 'diamond';
    default: return 'square';
  }
}

/**
 * Finder centre shape that best matches a given module shape. Scanners check
 * the 3x3 centre as a solid block, so shapes that leave it fragmented fall back
 * to a solid one unless the caller asks for them explicitly.
 */
function inferCornerDotType(dotType: DotType): CornerDotType {
  switch (dotType) {
    case 'vertical-line':
    case 'horizontal-line':
    case 'star':
    case 'plus':
    case 'cross':
    case 'heart': return 'square';
    case 'random-dot': return 'dot';
    default: return dotType;
  }
}

/** Rows of a `grid` emblem, trimmed to the shape they actually contain. */
function readGrid(value: unknown, shape: string): string[] {
  if (value === undefined || value === null) {
    if (shape === 'grid') throw new DesignError('emblem.grid is required when emblem.shape is "grid"');
    return [];
  }
  // A newline-separated string keeps grids writable in a query string, where
  // `|` is easier to type than an encoded line break.
  const rows = typeof value === 'string' ? value.split(/\r?\n|\|/) : value;
  if (!Array.isArray(rows) || rows.some((row) => typeof row !== 'string')) {
    throw new DesignError('emblem.grid must be an array of strings, or a newline-separated string');
  }
  if (rows.length > LIMITS.maxEmblemGridRows) {
    throw new DesignError(`emblem.grid accepts at most ${LIMITS.maxEmblemGridRows} rows`);
  }
  const trimmed = trimGrid(rows as string[]);
  if (trimmed.length === 0) throw new DesignError('emblem.grid does not contain any filled cells');
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(source: Record<string, unknown>, key: string, field: string): Record<string, unknown> {
  const value = source[key];
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new DesignError(`${field} must be an object`);
  return value;
}

function resolveGradient(value: unknown, field: string): Gradient | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new DesignError(`${field} must be an object`);

  const type = requireOneOf(value['type'] ?? 'linear', `${field}.type`, ['linear', 'radial'] as const);
  const rotation = value['rotation'] === undefined ? 0 : requireNumber(value['rotation'], `${field}.rotation`, -360, 360);
  const stops = value['colorStops'];
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new DesignError(`${field}.colorStops must be an array of at least two stops`);
  }
  if (stops.length > LIMITS.maxColorStops) {
    throw new DesignError(`${field}.colorStops accepts at most ${LIMITS.maxColorStops} stops`);
  }

  const colorStops = stops.map((stop, index) => {
    if (!isRecord(stop)) throw new DesignError(`${field}.colorStops[${index}] must be an object`);
    return {
      offset: requireNumber(stop['offset'] ?? index / (stops.length - 1), `${field}.colorStops[${index}].offset`, 0, 1),
      color: sanitizeColor(stop['color'], `${field}.colorStops[${index}].color`),
      ...(stop['opacity'] === undefined
        ? {}
        : { opacity: requireNumber(stop['opacity'], `${field}.colorStops[${index}].opacity`, 0, 1) }),
    };
  });

  return { type, rotation, colorStops };
}

interface FillDefaults {
  color: string;
  opacity?: number;
}

function resolveFill(
  source: Record<string, unknown>,
  field: string,
  defaults: FillDefaults,
): { color: string; gradient?: Gradient; opacity: number } {
  return {
    color: source['color'] === undefined ? defaults.color : sanitizeColor(source['color'], `${field}.color`),
    gradient: resolveGradient(source['gradient'], `${field}.gradient`),
    opacity:
      source['opacity'] === undefined
        ? (defaults.opacity ?? 1)
        : requireNumber(source['opacity'], `${field}.opacity`, 0, 1),
  };
}

/**
 * Validate a caller-supplied design and fill in every default, so the renderer
 * can work with fully specified, already-sanitized values.
 */
export function resolveDesign(input: QrDesign): ResolvedDesign {
  if (!isRecord(input)) throw new DesignError('The design must be an object');
  const raw = input as unknown as Record<string, unknown>;

  const data = raw['data'];
  if (typeof data !== 'string' || data.length === 0) {
    throw new DesignError('data is required and must be a non-empty string');
  }
  if (data.length > LIMITS.maxDataLength) {
    throw new DesignError(`data must be at most ${LIMITS.maxDataLength} characters`);
  }

  const width = raw['width'] === undefined ? 320 : requireNumber(raw['width'], 'width', LIMITS.minSize, LIMITS.maxSize);
  const height = raw['height'] === undefined ? width : requireNumber(raw['height'], 'height', LIMITS.minSize, LIMITS.maxSize);

  const encodingRaw = readRecord(raw, 'encoding', 'encoding');
  const encoding: ResolvedDesign['encoding'] = {
    errorCorrectionLevel: requireOneOf(
      encodingRaw['errorCorrectionLevel'] ?? 'M',
      'encoding.errorCorrectionLevel',
      ECC_LEVELS,
    ),
    version:
      encodingRaw['version'] === undefined || encodingRaw['version'] === 'auto'
        ? 'auto'
        : Math.trunc(requireNumber(encodingRaw['version'], 'encoding.version', MIN_VERSION, MAX_VERSION)),
    minVersion:
      encodingRaw['minVersion'] === undefined
        ? MIN_VERSION
        : Math.trunc(requireNumber(encodingRaw['minVersion'], 'encoding.minVersion', MIN_VERSION, MAX_VERSION)),
    mask:
      encodingRaw['mask'] === undefined || encodingRaw['mask'] === 'auto'
        ? 'auto'
        : Math.trunc(requireNumber(encodingRaw['mask'], 'encoding.mask', 0, 7)),
    mode:
      encodingRaw['mode'] === undefined || encodingRaw['mode'] === 'auto'
        ? 'auto'
        : requireOneOf(encodingRaw['mode'], 'encoding.mode', ['numeric', 'alphanumeric', 'byte'] as const),
    utf8Eci: Boolean(encodingRaw['utf8Eci']),
  };

  const dotsRaw = readRecord(raw, 'dots', 'dots');
  const dotType = requireOneOf(dotsRaw['type'] ?? 'square', 'dots.type', DOT_TYPES);
  const dots: ResolvedDesign['dots'] = {
    type: dotType,
    ...resolveFill(dotsRaw, 'dots', { color: '#000000' }),
    scale: dotsRaw['scale'] === undefined ? 1 : requireNumber(dotsRaw['scale'], 'dots.scale', 0.1, 1),
    randomSeed:
      dotsRaw['randomSeed'] === undefined
        ? 1
        : Math.trunc(requireNumber(dotsRaw['randomSeed'], 'dots.randomSeed', 0, 2 ** 31 - 1)),
  };

  const cornersSquareRaw = readRecord(raw, 'cornersSquare', 'cornersSquare');
  const cornersSquareBase: ResolvedCornerSquare = {
    type: requireOneOf(
      cornersSquareRaw['type'] ?? inferCornerSquareType(dotType),
      'cornersSquare.type',
      CORNER_SQUARE_TYPES,
    ),
    ...resolveFill(cornersSquareRaw, 'cornersSquare', { color: dots.color, opacity: dots.opacity }),
  };

  const cornersDotRaw = readRecord(raw, 'cornersDot', 'cornersDot');
  const cornersDotBase: ResolvedCornerDot = {
    type: requireOneOf(cornersDotRaw['type'] ?? inferCornerDotType(dotType), 'cornersDot.type', DOT_TYPES),
    ...resolveFill(cornersDotRaw, 'cornersDot', { color: cornersSquareBase.color, opacity: dots.opacity }),
  };

  const alignmentRaw = readRecord(raw, 'alignment', 'alignment');
  const alignment: ResolvedDesign['alignment'] = {
    type: requireOneOf(
      alignmentRaw['type'] ?? (isSparseDotType(dotType) ? 'square' : 'as-data'),
      'alignment.type',
      ['as-data', ...CORNER_SQUARE_TYPES] as const,
    ),
    centerType: requireOneOf(
      alignmentRaw['centerType'] ?? (isSparseDotType(dotType) ? 'square' : cornersDotBase.type),
      'alignment.centerType',
      DOT_TYPES,
    ),
    ...resolveFill(alignmentRaw, 'alignment', { color: dots.color, opacity: dots.opacity }),
  };

  const backgroundRaw = readRecord(raw, 'background', 'background');
  const background: ResolvedDesign['background'] = {
    ...resolveFill(backgroundRaw, 'background', { color: '#ffffff' }),
    round: backgroundRaw['round'] === undefined ? 0 : requireNumber(backgroundRaw['round'], 'background.round', 0, 1),
  };

  const borderRaw = readRecord(raw, 'border', 'border');
  const borderWidth =
    borderRaw['width'] === undefined ? 0 : requireNumber(borderRaw['width'], 'border.width', 0, LIMITS.maxBorderWidth);
  const border: ResolvedDesign['border'] = {
    width: borderWidth,
    style: requireOneOf(borderRaw['style'] ?? 'solid', 'border.style', BORDER_STYLES),
    // Matching the background keeps the plate and its frame concentric unless
    // the caller deliberately separates them.
    radius: borderRaw['radius'] === undefined ? background.round : requireNumber(borderRaw['radius'], 'border.radius', 0, 1),
    gap: borderRaw['gap'] === undefined ? 0 : requireNumber(borderRaw['gap'], 'border.gap', 0, LIMITS.maxMargin),
    dash: borderRaw['dash'] === undefined ? 0 : requireNumber(borderRaw['dash'], 'border.dash', 0.5, 200),
    ...resolveFill(borderRaw, 'border', { color: dots.color }),
  };

  const imageRaw = readRecord(raw, 'image', 'image');
  const src = imageRaw['src'] === undefined || imageRaw['src'] === '' ? undefined : sanitizeImageSrc(imageRaw['src'], 'image.src');
  if (src && src.length > LIMITS.maxImageBytes) {
    throw new DesignError('image.src exceeds the maximum embedded image size');
  }
  const image: ResolvedDesign['image'] = {
    ...(src ? { src } : {}),
    size: imageRaw['size'] === undefined ? 0.25 : requireNumber(imageRaw['size'], 'image.size', 0.05, 0.5),
    margin: imageRaw['margin'] === undefined ? 1 : requireNumber(imageRaw['margin'], 'image.margin', 0, 10),
    hideBackgroundDots: imageRaw['hideBackgroundDots'] === undefined ? true : Boolean(imageRaw['hideBackgroundDots']),
    background:
      imageRaw['background'] === undefined || imageRaw['background'] === 'none'
        ? 'none'
        : sanitizeColor(imageRaw['background'], 'image.background'),
    shape: requireOneOf(imageRaw['shape'] ?? 'square', 'image.shape', ['square', 'circle', 'rounded'] as const),
    round: imageRaw['round'] === undefined ? 0.25 : requireNumber(imageRaw['round'], 'image.round', 0, 1),
    opacity: imageRaw['opacity'] === undefined ? 1 : requireNumber(imageRaw['opacity'], 'image.opacity', 0, 1),
    preserveAspectRatio: requireOneOf(
      imageRaw['preserveAspectRatio'] ?? 'xMidYMid meet',
      'image.preserveAspectRatio',
      ['xMidYMid meet', 'xMidYMid slice', 'none'] as const,
    ),
  };

  const emblemRaw = readRecord(raw, 'emblem', 'emblem');
  const emblemGiven = raw['emblem'] !== undefined && raw['emblem'] !== null;
  const emblemShape = requireOneOf(emblemRaw['shape'] ?? 'circle', 'emblem.shape', EMBLEM_SHAPES);
  const emblemGrid = readGrid(emblemRaw['grid'], emblemShape);
  const emblemStyle = requireOneOf(emblemRaw['style'] ?? 'tint', 'emblem.style', EMBLEM_STYLES);
  const emblem: ResolvedDesign['emblem'] = {
    enabled: emblemGiven,
    shape: emblemShape,
    grid: emblemGrid,
    size: emblemRaw['size'] === undefined ? 0.24 : requireNumber(emblemRaw['size'], 'emblem.size', 0.05, 1),
    style: emblemStyle,
    halo: emblemRaw['halo'] === undefined ? (emblemStyle === 'ink' ? 1 : 0) : requireNumber(emblemRaw['halo'], 'emblem.halo', 0, 6),
    dotType:
      emblemRaw['dotType'] === undefined
        ? 'inherit'
        : requireOneOf(emblemRaw['dotType'], 'emblem.dotType', DOT_TYPES),
    ...resolveFill(emblemRaw, 'emblem', { color: dots.color, opacity: dots.opacity }),
  };

  const captionRaw = readRecord(raw, 'caption', 'caption');
  const captionText = captionRaw['text'] === undefined ? '' : String(captionRaw['text']);
  if (captionText.length > LIMITS.maxCaptionLength) {
    throw new DesignError(`caption.text must be at most ${LIMITS.maxCaptionLength} characters`);
  }
  const caption: ResolvedDesign['caption'] = {
    text: captionText,
    position: requireOneOf(captionRaw['position'] ?? 'bottom', 'caption.position', ['bottom', 'top'] as const),
    color: captionRaw['color'] === undefined ? dots.color : sanitizeColor(captionRaw['color'], 'caption.color'),
    background:
      captionRaw['background'] === undefined || captionRaw['background'] === 'none'
        ? 'none'
        : sanitizeColor(captionRaw['background'], 'caption.background'),
    fontFamily: typeof captionRaw['fontFamily'] === 'string' && captionRaw['fontFamily'].length <= 120
      ? captionRaw['fontFamily'].replace(/[<>&"]/g, '')
      : DEFAULT_FONT_STACK,
    fontSize:
      captionRaw['fontSize'] === undefined
        ? Math.max(10, Math.round(width * 0.07))
        : requireNumber(captionRaw['fontSize'], 'caption.fontSize', 4, 400),
    fontWeight: requireOneOf(String(captionRaw['fontWeight'] ?? '600'), 'caption.fontWeight', [
      '100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold',
    ] as const),
    letterSpacing:
      captionRaw['letterSpacing'] === undefined
        ? 0
        : requireNumber(captionRaw['letterSpacing'], 'caption.letterSpacing', -20, 40),
    gap: captionRaw['gap'] === undefined ? 8 : requireNumber(captionRaw['gap'], 'caption.gap', 0, 200),
  };

  const perCornerSquare: Partial<Record<FinderCorner, ResolvedCornerSquare>> = {};
  const perCornerDot: Partial<Record<FinderCorner, ResolvedCornerDot>> = {};
  const cornerOverridesSquare = readRecord(cornersSquareRaw, 'corners', 'cornersSquare.corners');
  const cornerOverridesDot = readRecord(cornersDotRaw, 'corners', 'cornersDot.corners');
  for (const corner of FINDER_CORNERS) {
    const squareOverride = cornerOverridesSquare[corner];
    if (squareOverride !== undefined) {
      const record = isRecord(squareOverride) ? squareOverride : {};
      perCornerSquare[corner] = {
        type: requireOneOf(
          record['type'] ?? cornersSquareBase.type,
          `cornersSquare.corners.${corner}.type`,
          CORNER_SQUARE_TYPES,
        ),
        ...resolveFill(record, `cornersSquare.corners.${corner}`, {
          color: cornersSquareBase.color,
          opacity: cornersSquareBase.opacity,
        }),
      };
    }
    const dotOverride = cornerOverridesDot[corner];
    if (dotOverride !== undefined) {
      const record = isRecord(dotOverride) ? dotOverride : {};
      perCornerDot[corner] = {
        type: requireOneOf(record['type'] ?? cornersDotBase.type, `cornersDot.corners.${corner}.type`, DOT_TYPES),
        ...resolveFill(record, `cornersDot.corners.${corner}`, {
          color: cornersDotBase.color,
          opacity: cornersDotBase.opacity,
        }),
      };
    }
  }

  return {
    data,
    width,
    height,
    margin: raw['margin'] === undefined ? 0 : requireNumber(raw['margin'], 'margin', 0, LIMITS.maxMargin),
    quietZone: raw['quietZone'] === undefined ? 4 : requireNumber(raw['quietZone'], 'quietZone', 0, LIMITS.maxQuietZone),
    shape: requireOneOf(raw['shape'] ?? 'square', 'shape', ['square', 'circle'] as const),
    rotation: raw['rotation'] === undefined ? 0 : requireNumber(raw['rotation'], 'rotation', -360, 360),
    encoding,
    dots,
    cornersSquare: { ...cornersSquareBase, corners: perCornerSquare },
    cornersDot: { ...cornersDotBase, corners: perCornerDot },
    alignment,
    background,
    border,
    image,
    emblem,
    caption,
    pretty: Boolean(raw['pretty']),
  };
}
