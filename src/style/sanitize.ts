/**
 * Every value that reaches the SVG output passes through here. The renderer is
 * driven by untrusted input (query strings, JSON request bodies), so colours,
 * URLs and text are validated rather than merely escaped.
 */

const NAMED_COLOR = /^[a-z]{3,20}$/i;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z%.,\s/+-]{1,80}\)$/i;

export class DesignError extends Error {
  override name = 'DesignError';
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      default: return '&quot;';
    }
  });
}

/** Accept CSS colour syntax we can safely inline; reject anything else. */
export function sanitizeColor(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new DesignError(`${field} must be a colour string`);
  const color = value.trim();
  if (HEX_COLOR.test(color) || NAMED_COLOR.test(color) || FUNCTIONAL_COLOR.test(color)) return color;
  throw new DesignError(`${field} is not a valid colour: ${JSON.stringify(value).slice(0, 60)}`);
}

/**
 * Only `data:` images and http(s) URLs may be embedded. `javascript:` and other
 * active schemes are rejected outright.
 */
export function sanitizeImageSrc(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new DesignError(`${field} must be a string`);
  const src = value.trim();
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml|avif);base64,[a-z0-9+/=\s]+$/i.test(src)) return src;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(src)) return src;
  throw new DesignError(`${field} must be a data:image/* URI or an http(s) URL`);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function requireNumber(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new DesignError(`${field} must be a number`);
  }
  if (parsed < min || parsed > max) {
    throw new DesignError(`${field} must be between ${min} and ${max}, received ${parsed}`);
  }
  return parsed;
}

export function requireOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new DesignError(`${field} must be one of: ${allowed.join(', ')}`);
}

/** Trim a number for SVG output, dropping trailing zeroes. */
export function num(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
