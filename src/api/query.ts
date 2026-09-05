import type { QrDesign } from '../style/types.js';
import { DesignError } from '../style/sanitize.js';
import { FIELDS_BY_PATH } from './schema.js';
import { findPreset } from '../presets.js';

/** Query keys handled by the transport rather than the design itself. */
export const TRANSPORT_KEYS = new Set(['format', 'scale', 'preset', 'download', 'pretty']);

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (next === undefined) node = (node[segment] = {} as Record<string, unknown>);
    else if (typeof next === 'object' && next !== null) node = next as Record<string, unknown>;
    else throw new DesignError(`Conflicting values for "${path}"`);
  }
  node[segments[segments.length - 1]!] = value;
}

/** Parse `0:#f97316,0.5:red,1:#db2777` into gradient stops. */
export function parseColorStops(value: string): { offset: number; color: string }[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index, all) => {
      const separator = entry.indexOf(':');
      if (separator === -1) {
        return { offset: all.length === 1 ? 0 : index / (all.length - 1), color: entry };
      }
      const offset = Number(entry.slice(0, separator));
      if (!Number.isFinite(offset)) throw new DesignError(`Invalid gradient stop offset in "${entry}"`);
      return { offset, color: entry.slice(separator + 1).trim() };
    });
}

function coerce(path: string, raw: string): unknown {
  const field = FIELDS_BY_PATH.get(path);
  if (!field) throw new DesignError(`Unknown design setting "${path}"`);

  if (path.endsWith('colorStops')) return parseColorStops(raw);

  switch (field.type) {
    case 'number':
    case 'integer': {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new DesignError(`"${path}" must be a number, received "${raw}"`);
      return field.type === 'integer' ? Math.trunc(value) : value;
    }
    case 'boolean':
      if (raw === '' || raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      throw new DesignError(`"${path}" must be true or false, received "${raw}"`);
    default:
      return raw;
  }
}

/**
 * Build a design from flat query parameters, where nesting is expressed with
 * dots: `?data=hi&dots.type=rounded&dots.gradient.colorStops=0:red,1:blue`.
 */
export function designFromQuery(params: URLSearchParams): QrDesign {
  const design: Record<string, unknown> = {};

  const presetId = params.get('preset');
  if (presetId) {
    const preset = findPreset(presetId);
    if (!preset) throw new DesignError(`Unknown preset "${presetId}"`);
    Object.assign(design, structuredClone(preset.design));
  }

  for (const [key, value] of params) {
    if (TRANSPORT_KEYS.has(key)) continue;
    assignPath(design, key, coerce(key, value));
  }

  return design as unknown as QrDesign;
}

export interface TransportOptions {
  format: 'svg' | 'png';
  scale: number;
  download: boolean;
  pretty: boolean;
}

export function transportFromQuery(params: URLSearchParams): TransportOptions {
  const format = params.get('format') ?? 'svg';
  if (format !== 'svg' && format !== 'png') {
    throw new DesignError('format must be "svg" or "png"');
  }
  const scaleRaw = params.get('scale');
  const scale = scaleRaw === null ? 1 : Number(scaleRaw);
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 8) {
    throw new DesignError('scale must be a number between 0.25 and 8');
  }
  return {
    format,
    scale,
    download: params.get('download') === 'true' || params.get('download') === '1',
    pretty: params.get('pretty') === 'true' || params.get('pretty') === '1',
  };
}

/** Merge a preset named in a JSON body with the caller's overrides. */
export function applyPreset(body: Record<string, unknown>): Record<string, unknown> {
  const presetId = body['preset'];
  if (typeof presetId !== 'string') return body;
  const preset = findPreset(presetId);
  if (!preset) throw new DesignError(`Unknown preset "${presetId}"`);
  const { preset: _ignored, ...rest } = body;
  return mergeDeep(structuredClone(preset.design) as Record<string, unknown>, rest);
}

function mergeDeep(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ) {
      result[key] = mergeDeep(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
