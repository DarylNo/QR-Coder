/**
 * Contrast checking for rendered designs. Scanners binarize the image before
 * decoding, so a stylish but low-contrast palette is one of the most common
 * reasons a custom QR code fails to scan.
 */

/** The handful of CSS colour names worth resolving without a full table. */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  yellow: [255, 255, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  rebeccapurple: [102, 51, 153],
  transparent: [255, 255, 255],
};

/** Parse a colour into RGB, or return null when the format is unsupported. */
export function parseColor(value: string): [number, number, number] | null {
  const color = value.trim().toLowerCase();

  const named = NAMED_COLORS[color];
  if (named) return named;

  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const expand = (part: string): number => parseInt(part.repeat(2), 16);
    if (hex.length === 3 || hex.length === 4) {
      return [expand(hex[0]!), expand(hex[1]!), expand(hex[2]!)];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(color);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);

  return null;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, secondary, 0] :
    hue < 120 ? [secondary, chroma, 0] :
    hue < 180 ? [0, chroma, secondary] :
    hue < 240 ? [0, secondary, chroma] :
    hue < 300 ? [secondary, 0, chroma] :
    [chroma, 0, secondary];
  return [Math.round((r + match) * 255), Math.round((g + match) * 255), Math.round((b + match) * 255)];
}

/** WCAG relative luminance. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, or null if either is unparseable. */
export function contrastRatio(foreground: string, background: string): number | null {
  const front = parseColor(foreground);
  const back = parseColor(background);
  if (!front || !back) return null;
  const lighter = Math.max(relativeLuminance(front), relativeLuminance(back));
  const darker = Math.min(relativeLuminance(front), relativeLuminance(back));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Contrast below this fails to survive the binarization step in many scanners.
 * Chosen to sit between the WCAG AA large-text ratio and the much stricter
 * print guidance for barcodes.
 */
export const MIN_SCAN_CONTRAST = 4;
