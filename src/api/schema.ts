import { ECC_LEVELS } from '../core/tables.js';
import { BORDER_STYLES, CORNER_SQUARE_TYPES, DOT_TYPES } from '../style/types.js';
import { EMBLEM_SHAPES, EMBLEM_STYLES } from '../style/emblem.js';
import { LIMITS } from '../style/defaults.js';

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'color' | 'enum';

export interface FieldSchema {
  /** Dotted path into the design object, e.g. `dots.type`. */
  path: string;
  type: FieldType;
  description: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  group: string;
}

const ECC_VALUES = ECC_LEVELS;

/**
 * Every design setting the service accepts. Drives query-string coercion, the
 * `/api/schema` endpoint and the controls in the playground.
 */
export const FIELDS: FieldSchema[] = [
  { path: 'data', type: 'string', group: 'Content', description: 'The payload encoded into the QR code.' },
  { path: 'width', type: 'number', group: 'Canvas', min: LIMITS.minSize, max: LIMITS.maxSize, default: 320, description: 'Output width in pixels.' },
  { path: 'height', type: 'number', group: 'Canvas', min: LIMITS.minSize, max: LIMITS.maxSize, default: 320, description: 'Output height in pixels; defaults to the width.' },
  { path: 'margin', type: 'number', group: 'Canvas', min: 0, max: LIMITS.maxMargin, default: 0, description: 'Padding in pixels between the background edge and the symbol.' },
  { path: 'quietZone', type: 'number', group: 'Canvas', min: 0, max: LIMITS.maxQuietZone, default: 4, description: 'Light border around the symbol, measured in modules. Four is the standard minimum.' },
  { path: 'shape', type: 'enum', group: 'Canvas', values: ['square', 'circle'], default: 'square', description: 'Clip the symbol to a square or a circle.' },
  { path: 'rotation', type: 'number', group: 'Canvas', min: -360, max: 360, default: 0, description: 'Rotate the symbol by this many degrees.' },

  { path: 'encoding.errorCorrectionLevel', type: 'enum', group: 'Encoding', values: ECC_VALUES, default: 'M', description: 'Error correction level. Higher levels survive more damage and leave room for a larger logo.' },
  { path: 'encoding.version', type: 'integer', group: 'Encoding', min: 1, max: 40, description: 'Force a symbol version (1-40). Defaults to the smallest that fits.' },
  { path: 'encoding.minVersion', type: 'integer', group: 'Encoding', min: 1, max: 40, default: 1, description: 'Never generate a symbol smaller than this version.' },
  { path: 'encoding.mask', type: 'integer', group: 'Encoding', min: 0, max: 7, description: 'Force a mask pattern (0-7). Defaults to the lowest-penalty mask.' },
  { path: 'encoding.mode', type: 'enum', group: 'Encoding', values: ['numeric', 'alphanumeric', 'byte'], description: 'Force an encoding mode. Defaults to the most compact one the payload allows.' },
  { path: 'encoding.utf8Eci', type: 'boolean', group: 'Encoding', default: false, description: 'Prefix the payload with an ECI header declaring UTF-8.' },

  { path: 'dots.type', type: 'enum', group: 'Modules', values: DOT_TYPES, default: 'square', description: 'Shape drawn for each dark module.' },
  { path: 'dots.color', type: 'color', group: 'Modules', default: '#000000', description: 'Module colour.' },
  { path: 'dots.opacity', type: 'number', group: 'Modules', min: 0, max: 1, default: 1, description: 'Module opacity.' },
  { path: 'dots.scale', type: 'number', group: 'Modules', min: 0.1, max: 1, default: 1, description: 'Module size as a fraction of the grid pitch; below 1 leaves gaps.' },
  { path: 'dots.randomSeed', type: 'integer', group: 'Modules', min: 0, default: 1, description: 'Seed for the random-dot shape, so output stays reproducible.' },
  { path: 'dots.gradient.type', type: 'enum', group: 'Modules', values: ['linear', 'radial'], description: 'Apply a gradient across the modules instead of a flat colour.' },
  { path: 'dots.gradient.rotation', type: 'number', group: 'Modules', min: -360, max: 360, default: 0, description: 'Angle of a linear module gradient, in degrees.' },
  { path: 'dots.gradient.colorStops', type: 'string', group: 'Modules', description: 'Gradient stops. In a query string: `0:#f97316,1:#db2777`.' },

  { path: 'cornersSquare.type', type: 'enum', group: 'Finder patterns', values: CORNER_SQUARE_TYPES, description: 'Shape of the 7x7 ring in each corner. Defaults to a shape matching the module style.' },
  { path: 'cornersSquare.color', type: 'color', group: 'Finder patterns', description: 'Colour of the finder rings; defaults to the module colour.' },
  { path: 'cornersSquare.gradient.type', type: 'enum', group: 'Finder patterns', values: ['linear', 'radial'], description: 'Gradient across the finder rings.' },
  { path: 'cornersSquare.gradient.rotation', type: 'number', group: 'Finder patterns', min: -360, max: 360, description: 'Angle of the finder ring gradient.' },
  { path: 'cornersSquare.gradient.colorStops', type: 'string', group: 'Finder patterns', description: 'Finder ring gradient stops.' },

  { path: 'cornersDot.type', type: 'enum', group: 'Finder patterns', values: DOT_TYPES, description: 'Shape of the 3x3 centre in each corner.' },
  { path: 'cornersDot.color', type: 'color', group: 'Finder patterns', description: 'Colour of the finder centres.' },
  { path: 'cornersDot.gradient.type', type: 'enum', group: 'Finder patterns', values: ['linear', 'radial'], description: 'Gradient across the finder centres.' },
  { path: 'cornersDot.gradient.rotation', type: 'number', group: 'Finder patterns', min: -360, max: 360, description: 'Angle of the finder centre gradient.' },
  { path: 'cornersDot.gradient.colorStops', type: 'string', group: 'Finder patterns', description: 'Finder centre gradient stops.' },

  { path: 'alignment.type', type: 'enum', group: 'Alignment patterns', values: ['as-data', ...CORNER_SQUARE_TYPES], description: 'Draw the alignment patterns module by module, or as a solid ring.' },
  { path: 'alignment.centerType', type: 'enum', group: 'Alignment patterns', values: DOT_TYPES, description: 'Shape of the single centre module of each alignment pattern.' },
  { path: 'alignment.color', type: 'color', group: 'Alignment patterns', description: 'Colour of the alignment patterns.' },

  { path: 'background.color', type: 'color', group: 'Background', default: '#ffffff', description: 'Background colour; use `none` for transparency.' },
  { path: 'background.opacity', type: 'number', group: 'Background', min: 0, max: 1, default: 1, description: 'Background opacity.' },
  { path: 'background.round', type: 'number', group: 'Background', min: 0, max: 1, default: 0, description: 'Corner rounding of the background plate.' },
  { path: 'background.gradient.type', type: 'enum', group: 'Background', values: ['linear', 'radial'], description: 'Gradient across the background.' },
  { path: 'background.gradient.rotation', type: 'number', group: 'Background', min: -360, max: 360, description: 'Angle of the background gradient.' },
  { path: 'background.gradient.colorStops', type: 'string', group: 'Background', description: 'Background gradient stops.' },

  { path: 'border.width', type: 'number', group: 'Border', min: 0, max: LIMITS.maxBorderWidth, default: 0, description: 'Border thickness in pixels. Zero draws no border.' },
  { path: 'border.color', type: 'color', group: 'Border', description: 'Border colour; defaults to the module colour.' },
  { path: 'border.style', type: 'enum', group: 'Border', values: BORDER_STYLES, default: 'solid', description: 'Border line style.' },
  { path: 'border.radius', type: 'number', group: 'Border', min: 0, max: 1, description: 'Corner rounding of the border; defaults to the background rounding. Use 1 on a square canvas for a circular frame.' },
  { path: 'border.gap', type: 'number', group: 'Border', min: 0, max: LIMITS.maxMargin, default: 0, description: 'Space in pixels between the border and everything inside it.' },
  { path: 'border.opacity', type: 'number', group: 'Border', min: 0, max: 1, default: 1, description: 'Border opacity.' },
  { path: 'border.dash', type: 'number', group: 'Border', min: 0.5, max: 200, description: 'Dash length for the dashed and dotted styles; defaults to a multiple of the width.' },
  { path: 'border.gradient.type', type: 'enum', group: 'Border', values: ['linear', 'radial'], description: 'Gradient along the border.' },
  { path: 'border.gradient.rotation', type: 'number', group: 'Border', min: -360, max: 360, description: 'Angle of the border gradient.' },
  { path: 'border.gradient.colorStops', type: 'string', group: 'Border', description: 'Border gradient stops.' },

  { path: 'image.src', type: 'string', group: 'Logo', description: 'Logo as a data:image/* URI or an http(s) URL.' },
  { path: 'image.size', type: 'number', group: 'Logo', min: 0.05, max: 0.5, default: 0.25, description: 'Logo width as a fraction of the symbol width.' },
  { path: 'image.margin', type: 'number', group: 'Logo', min: 0, max: 10, default: 1, description: 'Clear space kept around the logo, in modules.' },
  { path: 'image.hideBackgroundDots', type: 'boolean', group: 'Logo', default: true, description: 'Remove the modules behind the logo instead of drawing over them.' },
  { path: 'image.background', type: 'color', group: 'Logo', default: 'none', description: 'Plate drawn beneath the logo; `none` disables it.' },
  { path: 'image.shape', type: 'enum', group: 'Logo', values: ['square', 'circle', 'rounded'], default: 'square', description: 'Shape of the logo clip and its plate.' },
  { path: 'image.round', type: 'number', group: 'Logo', min: 0, max: 1, default: 0.25, description: 'Corner rounding when the logo shape is `rounded`.' },
  { path: 'image.opacity', type: 'number', group: 'Logo', min: 0, max: 1, default: 1, description: 'Logo opacity.' },

  { path: 'emblem.shape', type: 'enum', group: 'Emblem', values: EMBLEM_SHAPES, default: 'circle', description: 'Shape drawn out of the code\'s own modules. `grid` takes an explicit bitmap in emblem.grid.' },
  { path: 'emblem.style', type: 'enum', group: 'Emblem', values: EMBLEM_STYLES, default: 'tint', description: '`tint` recolours the modules inside the shape and changes nothing else; `ink` forces them dark so the shape reads solid, at the cost of error correction.' },
  { path: 'emblem.size', type: 'number', group: 'Emblem', min: 0.05, max: 1, default: 0.24, description: 'Width of a built-in shape as a fraction of the symbol width.' },
  { path: 'emblem.grid', type: 'string', group: 'Emblem', description: 'Bitmap for a `grid` emblem: rows of `#` and `.`, separated by `|` or newlines.' },
  { path: 'emblem.halo', type: 'number', group: 'Emblem', min: 0, max: 6, default: 1, description: 'Modules cleared around an inked shape so its outline reads. Ignored when tinting.' },
  { path: 'emblem.color', type: 'color', group: 'Emblem', description: 'Emblem colour; defaults to the module colour.' },
  { path: 'emblem.opacity', type: 'number', group: 'Emblem', min: 0, max: 1, default: 1, description: 'Emblem opacity.' },
  { path: 'emblem.dotType', type: 'enum', group: 'Emblem', values: DOT_TYPES, description: 'Module shape used inside the emblem; defaults to the regular module shape.' },
  { path: 'emblem.gradient.type', type: 'enum', group: 'Emblem', values: ['linear', 'radial'], description: 'Gradient across the emblem.' },
  { path: 'emblem.gradient.rotation', type: 'number', group: 'Emblem', min: -360, max: 360, description: 'Angle of the emblem gradient.' },
  { path: 'emblem.gradient.colorStops', type: 'string', group: 'Emblem', description: 'Emblem gradient stops.' },

  { path: 'caption.text', type: 'string', group: 'Caption', description: 'Text drawn above or below the symbol.' },
  { path: 'caption.position', type: 'enum', group: 'Caption', values: ['bottom', 'top'], default: 'bottom', description: 'Caption placement.' },
  { path: 'caption.color', type: 'color', group: 'Caption', description: 'Caption colour; defaults to the module colour.' },
  { path: 'caption.background', type: 'color', group: 'Caption', default: 'none', description: 'Band painted behind the caption, filling the width inside the border.' },
  { path: 'caption.fontFamily', type: 'string', group: 'Caption', description: 'CSS font stack for the caption.' },
  { path: 'caption.fontSize', type: 'number', group: 'Caption', min: 4, max: 400, description: 'Caption font size in pixels.' },
  { path: 'caption.fontWeight', type: 'enum', group: 'Caption', values: ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'], default: '600', description: 'Caption font weight.' },
  { path: 'caption.letterSpacing', type: 'number', group: 'Caption', min: -20, max: 40, default: 0, description: 'Caption letter spacing in pixels.' },
  { path: 'caption.gap', type: 'number', group: 'Caption', min: 0, max: 200, default: 8, description: 'Space between the symbol and the caption, in pixels.' },
];

export const FIELDS_BY_PATH = new Map(FIELDS.map((field) => [field.path, field]));

export function groupedFields(): { group: string; fields: FieldSchema[] }[] {
  const groups: { group: string; fields: FieldSchema[] }[] = [];
  for (const field of FIELDS) {
    const existing = groups.find((entry) => entry.group === field.group);
    if (existing) existing.fields.push(field);
    else groups.push({ group: field.group, fields: [field] });
  }
  return groups;
}
