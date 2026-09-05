import type { QrDesign } from './style/types.js';

/** Ready-made designs, used by the playground and the `/api/presets` route. */
export interface Preset {
  id: string;
  name: string;
  description: string;
  design: Omit<QrDesign, 'data'>;
}

export const PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Plain black squares — maximum compatibility with older scanners.',
    design: {
      dots: { type: 'square', color: '#000000' },
      background: { color: '#ffffff' },
    },
  },
  {
    id: 'rounded-ink',
    name: 'Rounded Ink',
    description: 'Softly rounded modules with matching finder patterns.',
    design: {
      dots: { type: 'extra-rounded', color: '#111827' },
      cornersSquare: { type: 'extra-rounded', color: '#111827' },
      cornersDot: { type: 'dot', color: '#111827' },
      background: { color: '#ffffff', round: 0.08 },
    },
  },
  {
    id: 'dotted',
    name: 'Dotted',
    description: 'Circular modules with a circular centre in each eye.',
    design: {
      dots: { type: 'dot', color: '#0f172a' },
      cornersSquare: { type: 'extra-rounded', color: '#0f172a' },
      cornersDot: { type: 'dot', color: '#0f172a' },
      background: { color: '#ffffff' },
    },
  },
  {
    id: 'sunset',
    name: 'Sunset Gradient',
    description: 'Diagonal gradient across the modules with contrasting eyes.',
    design: {
      dots: {
        type: 'rounded',
        gradient: {
          type: 'linear',
          rotation: 45,
          colorStops: [
            { offset: 0, color: '#f97316' },
            { offset: 1, color: '#db2777' },
          ],
        },
      },
      cornersSquare: { type: 'extra-rounded', color: '#7c2d12' },
      cornersDot: { type: 'dot', color: '#db2777' },
      background: { color: '#fff7ed', round: 0.1 },
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Radial',
    description: 'Radial gradient from a deep centre outwards.',
    design: {
      dots: {
        type: 'classy-rounded',
        gradient: {
          type: 'radial',
          colorStops: [
            { offset: 0, color: '#0ea5e9' },
            { offset: 1, color: '#0f172a' },
          ],
        },
      },
      cornersSquare: { type: 'classy-rounded', color: '#0f172a' },
      cornersDot: { type: 'dot', color: '#0ea5e9' },
      background: { color: '#f8fafc' },
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Light modules on a dark plate — still scannable thanks to the inverted contrast.',
    design: {
      dots: { type: 'rounded', color: '#e2e8f0' },
      cornersSquare: { type: 'rounded', color: '#38bdf8' },
      cornersDot: { type: 'dot', color: '#38bdf8' },
      background: { color: '#0b1120', round: 0.12 },
    },
  },
  {
    id: 'diamonds',
    name: 'Diamonds',
    description: 'Diamond modules with diamond eyes for a faceted look.',
    design: {
      dots: { type: 'diamond', color: '#4c1d95', scale: 0.95 },
      cornersSquare: { type: 'diamond', color: '#4c1d95' },
      cornersDot: { type: 'diamond', color: '#7c3aed' },
      background: { color: '#faf5ff' },
    },
  },
  {
    id: 'pinstripe',
    name: 'Pinstripe',
    description: 'Vertical runs of modules merged into continuous bars.',
    design: {
      dots: { type: 'vertical-line', color: '#065f46' },
      cornersSquare: { type: 'extra-rounded', color: '#065f46' },
      cornersDot: { type: 'dot', color: '#10b981' },
      background: { color: '#ecfdf5' },
    },
  },
  {
    id: 'starfield',
    name: 'Starfield',
    description: 'Star modules at high error correction so the pattern stays readable.',
    design: {
      encoding: { errorCorrectionLevel: 'H' },
      dots: { type: 'star', color: '#1e293b' },
      cornersSquare: { type: 'extra-rounded', color: '#b45309' },
      cornersDot: { type: 'rounded', color: '#1e293b' },
      background: { color: '#fffbeb' },
    },
  },
  {
    id: 'badge',
    name: 'Scan Me Badge',
    description: 'Circular crop, rounded plate and a caption underneath.',
    design: {
      shape: 'circle',
      quietZone: 6,
      dots: { type: 'extra-rounded', color: '#1d4ed8' },
      cornersSquare: { type: 'dot', color: '#1d4ed8' },
      cornersDot: { type: 'dot', color: '#f97316' },
      background: { color: '#eff6ff', round: 1 },
      caption: { text: 'SCAN ME', color: '#1d4ed8', letterSpacing: 2 },
    },
  },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
