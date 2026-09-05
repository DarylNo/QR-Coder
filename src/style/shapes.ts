import type { CornerSquareType, DotType } from './types.js';
import { num } from './sanitize.js';

export interface Neighbors {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export const NO_NEIGHBORS: Neighbors = { top: false, right: false, bottom: false, left: false };

/** Corner radii in the order top-left, top-right, bottom-right, bottom-left. */
export type Radii = [number, number, number, number];

export function roundedRectPath(x: number, y: number, w: number, h: number, radii: Radii): string {
  const limit = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, limit))) as Radii;
  return [
    `M${num(x + tl)} ${num(y)}`,
    `H${num(x + w - tr)}`,
    tr ? `A${num(tr)} ${num(tr)} 0 0 1 ${num(x + w)} ${num(y + tr)}` : '',
    `V${num(y + h - br)}`,
    br ? `A${num(br)} ${num(br)} 0 0 1 ${num(x + w - br)} ${num(y + h)}` : '',
    `H${num(x + bl)}`,
    bl ? `A${num(bl)} ${num(bl)} 0 0 1 ${num(x)} ${num(y + h - bl)}` : '',
    `V${num(y + tl)}`,
    tl ? `A${num(tl)} ${num(tl)} 0 0 1 ${num(x + tl)} ${num(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join('');
}

function polygonPath(points: readonly (readonly [number, number])[]): string {
  return `M${points.map(([px, py]) => `${num(px)} ${num(py)}`).join('L')}Z`;
}

/** Radii for a module, opening up only the corners that face empty space. */
export function neighborRadii(type: DotType, size: number, n: Neighbors): Radii {
  const free: Radii = [
    !n.top && !n.left ? 1 : 0,
    !n.top && !n.right ? 1 : 0,
    !n.bottom && !n.right ? 1 : 0,
    !n.bottom && !n.left ? 1 : 0,
  ];
  const scale = (values: Radii): Radii =>
    [free[0] * values[0], free[1] * values[1], free[2] * values[2], free[3] * values[3]] as Radii;

  switch (type) {
    case 'rounded':
      return scale([size * 0.25, size * 0.25, size * 0.25, size * 0.25]);
    case 'extra-rounded':
      return scale([size * 0.5, size * 0.5, size * 0.5, size * 0.5]);
    case 'classy':
      return scale([size * 0.5, 0, size * 0.5, 0]);
    case 'classy-rounded':
      return scale([size * 0.5, size * 0.2, size * 0.5, size * 0.2]);
    default:
      return [0, 0, 0, 0];
  }
}

function starPath(cx: number, cy: number, outer: number, points = 5, innerRatio = 0.5): string {
  const vertices: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : outer * innerRatio;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    vertices.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return polygonPath(vertices);
}

function plusVertices(cx: number, cy: number, half: number, arm: number): [number, number][] {
  return [
    [cx - arm, cy - half], [cx + arm, cy - half], [cx + arm, cy - arm],
    [cx + half, cy - arm], [cx + half, cy + arm], [cx + arm, cy + arm],
    [cx + arm, cy + half], [cx - arm, cy + half], [cx - arm, cy + arm],
    [cx - half, cy + arm], [cx - half, cy - arm], [cx - arm, cy - arm],
  ];
}

function rotateAround(points: [number, number][], cx: number, cy: number, degrees: number, scale = 1): [number, number][] {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(([px, py]) => {
    const dx = (px - cx) * scale;
    const dy = (py - cy) * scale;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number];
  });
}

function heartPath(x: number, y: number, size: number): string {
  const cx = x + size / 2;
  const top = y + size * 0.28;
  const bottom = y + size * 0.95;
  return [
    `M${num(cx)} ${num(bottom)}`,
    `C${num(x - size * 0.05)} ${num(y + size * 0.6)} ${num(x + size * 0.05)} ${num(y)} ${num(cx)} ${num(top)}`,
    `C${num(x + size * 0.95)} ${num(y)} ${num(x + size * 1.05)} ${num(y + size * 0.6)} ${num(cx)} ${num(bottom)}`,
    'Z',
  ].join('');
}

/**
 * Path for a single module. `x`/`y` is the top-left of the drawn shape and
 * `size` its width, both already adjusted for the module scale.
 */
export function modulePath(
  type: DotType,
  x: number,
  y: number,
  size: number,
  neighbors: Neighbors = NO_NEIGHBORS,
  jitter = 1,
): string {
  const cx = x + size / 2;
  const cy = y + size / 2;

  switch (type) {
    case 'square':
    case 'rounded':
    case 'extra-rounded':
    case 'classy':
    case 'classy-rounded':
      return roundedRectPath(x, y, size, size, neighborRadii(type, size, neighbors));
    case 'dot':
      return roundedRectPath(x, y, size, size, [size / 2, size / 2, size / 2, size / 2]);
    case 'random-dot': {
      const radius = (size / 2) * jitter;
      return roundedRectPath(cx - radius, cy - radius, radius * 2, radius * 2, [radius, radius, radius, radius]);
    }
    case 'diamond':
      return polygonPath([
        [cx, y],
        [x + size, cy],
        [cx, y + size],
        [x, cy],
      ]);
    case 'star':
      return starPath(cx, cy, size / 2);
    case 'plus':
      return polygonPath(plusVertices(cx, cy, size / 2, size / 6));
    case 'cross':
      return polygonPath(rotateAround(plusVertices(cx, cy, size / 2, size / 6), cx, cy, 45, Math.SQRT1_2));
    case 'heart':
      return heartPath(x, y, size);
    case 'vertical-line':
    case 'horizontal-line':
      // A lone module of a line style is drawn as a stadium shape; runs of
      // modules are merged by the renderer before reaching this function.
      return roundedRectPath(x, y, size, size, [size / 2, size / 2, size / 2, size / 2]);
  }
}

/**
 * The 7x7 ring of a finder pattern, drawn as a single even-odd path so the
 * centre stays hollow.
 */
export function cornerSquarePath(
  type: CornerSquareType,
  x: number,
  y: number,
  size: number,
  thickness: number,
): string {
  const innerX = x + thickness;
  const innerY = y + thickness;
  const innerSize = size - thickness * 2;

  const ring = (outer: Radii, inner: Radii): string =>
    `${roundedRectPath(x, y, size, size, outer)}${roundedRectPath(innerX, innerY, innerSize, innerSize, inner)}`;

  const uniform = (radius: number): string => {
    const innerRadius = Math.max(0, radius - thickness);
    return ring(
      [radius, radius, radius, radius],
      [innerRadius, innerRadius, innerRadius, innerRadius],
    );
  };

  switch (type) {
    case 'square':
      return uniform(0);
    case 'rounded':
      return uniform(size * 0.22);
    case 'extra-rounded':
      return uniform(size * 0.36);
    case 'dot':
      return uniform(size / 2);
    case 'classy':
      return ring(
        [size / 2, 0, size / 2, 0],
        [innerSize / 2, 0, innerSize / 2, 0],
      );
    case 'classy-rounded':
      return ring(
        [size / 2, size * 0.15, size / 2, size * 0.15],
        [innerSize / 2, innerSize * 0.12, innerSize / 2, innerSize * 0.12],
      );
    case 'leaf':
      return ring(
        [0, size / 2, 0, size / 2],
        [0, innerSize / 2, 0, innerSize / 2],
      );
    case 'diamond': {
      const cx = x + size / 2;
      const cy = y + size / 2;
      const outer = polygonPath([
        [cx, y],
        [x + size, cy],
        [cx, y + size],
        [x, cy],
      ]);
      const half = innerSize / 2;
      const inner = polygonPath([
        [cx, cy - half],
        [cx + half, cy],
        [cx, cy + half],
        [cx - half, cy],
      ]);
      return `${outer}${inner}`;
    }
  }
}

/** Deterministic pseudo-random source so `random-dot` renders reproducibly. */
export function createRandom(seed: number): () => number {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}
