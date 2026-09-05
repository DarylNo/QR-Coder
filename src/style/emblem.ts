/**
 * An emblem is a shape formed from the QR code's own modules, rather than an
 * image pasted on top of them. Two ways of doing it:
 *
 * - `tint` recolours the modules that fall inside the shape. Nothing about the
 *   encoded data changes, so the symbol stays exactly as scannable as it was.
 * - `ink` forces those modules dark and clears a ring around them, so the shape
 *   reads as a solid silhouette. That overwrites real codewords, which the
 *   error correction has to absorb.
 */

export const EMBLEM_SHAPES = ['circle', 'square', 'diamond', 'heart', 'grid'] as const;
export type EmblemShape = (typeof EMBLEM_SHAPES)[number];

export const EMBLEM_STYLES = ['tint', 'ink'] as const;
export type EmblemStyle = (typeof EMBLEM_STYLES)[number];

export interface EmblemGeometry {
  /** `inside[y][x]` is true for modules that form the shape. */
  inside: boolean[][];
  /** Modules cleared around an inked shape so its outline stays readable. */
  halo: boolean[][];
  /** Number of modules the shape covers. */
  moduleCount: number;
}

/** Characters that mark a filled cell in a `grid` emblem. */
const FILLED = new Set(['#', '1', 'X', 'x', '*', '@', '█']);

export interface EmblemInput {
  shape: EmblemShape;
  size: number;
  halo: number;
  grid?: string[];
}

/** Is the point inside the unit shape, in coordinates running -1..1? */
function insideUnitShape(shape: Exclude<EmblemShape, 'grid'>, u: number, v: number): boolean {
  switch (shape) {
    case 'circle':
      return u * u + v * v <= 1;
    case 'square':
      return Math.abs(u) <= 1 && Math.abs(v) <= 1;
    case 'diamond':
      return Math.abs(u) + Math.abs(v) <= 1;
    case 'heart': {
      // The implicit heart curve, with v flipped because y grows downwards.
      const y = -v * 1.15;
      const x = u * 1.15;
      const t = x * x + y * y - 1;
      return t * t * t - x * x * y * y * y <= 0;
    }
  }
}

export function buildEmblem(symbolSize: number, emblem: EmblemInput): EmblemGeometry {
  const inside: boolean[][] = Array.from({ length: symbolSize }, () =>
    new Array<boolean>(symbolSize).fill(false),
  );

  if (emblem.shape === 'grid') {
    const rows = emblem.grid ?? [];
    const height = rows.length;
    const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
    const offsetX = Math.round((symbolSize - width) / 2);
    const offsetY = Math.round((symbolSize - height) / 2);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        if (!FILLED.has(rows[row]![column] ?? ' ')) continue;
        const x = offsetX + column;
        const y = offsetY + row;
        if (x >= 0 && y >= 0 && x < symbolSize && y < symbolSize) inside[y]![x] = true;
      }
    }
  } else {
    const centre = symbolSize / 2;
    const half = (symbolSize * emblem.size) / 2;
    for (let y = 0; y < symbolSize; y++) {
      for (let x = 0; x < symbolSize; x++) {
        const u = (x + 0.5 - centre) / half;
        const v = (y + 0.5 - centre) / half;
        if (insideUnitShape(emblem.shape, u, v)) inside[y]![x] = true;
      }
    }
  }

  return {
    inside,
    halo: dilate(inside, symbolSize, emblem.halo),
    moduleCount: inside.reduce((total, row) => total + row.filter(Boolean).length, 0),
  };
}

/** Modules within `radius` of the shape but not part of it. */
function dilate(inside: boolean[][], size: number, radius: number): boolean[][] {
  const halo: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  if (radius <= 0) return halo;

  const reach = Math.ceil(radius);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside[y]![x]) continue;
      let touching = false;
      for (let dy = -reach; dy <= reach && !touching; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          if (inside[y + dy]?.[x + dx]) {
            touching = true;
            break;
          }
        }
      }
      halo[y]![x] = touching;
    }
  }
  return halo;
}

/** Trim a `grid` emblem to its filled bounds, so it centres predictably. */
export function trimGrid(rows: string[]): string[] {
  let top = 0;
  let bottom = rows.length - 1;
  const filled = (row: string): boolean => [...row].some((character) => FILLED.has(character));
  while (top <= bottom && !filled(rows[top]!)) top++;
  while (bottom >= top && !filled(rows[bottom]!)) bottom--;
  if (top > bottom) return [];

  const body = rows.slice(top, bottom + 1);
  let left = Infinity;
  let right = -1;
  for (const row of body) {
    for (let column = 0; column < row.length; column++) {
      if (!FILLED.has(row[column]!)) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
    }
  }
  return body.map((row) => row.slice(left, right + 1).padEnd(right - left + 1, ' '));
}
