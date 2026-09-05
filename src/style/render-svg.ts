import { ModuleRegion, assessDamage, encodeQr, type QrSymbol } from '../core/matrix.js';
import { buildEmblem, type EmblemGeometry } from './emblem.js';
import type {
  Gradient,
  QrDesign,
  RenderMeta,
  RenderResult,
  ResolvedCornerDot,
  ResolvedCornerSquare,
  ResolvedDesign,
  ResolvedFill,
} from './types.js';
import { isSparseDotType, resolveDesign } from './defaults.js';
import { escapeXml, num } from './sanitize.js';
import { MIN_SCAN_CONTRAST, contrastRatio } from './contrast.js';
import {
  createRandom,
  cornerSquarePath,
  modulePath,
  roundedRectPath,
  type Neighbors,
  type Radii,
} from './shapes.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Collects gradient definitions and hands back the `url(#id)` to reference. */
class Defs {
  private readonly entries: string[] = [];
  private counter = 0;

  constructor(private readonly prefix: string) {}

  /** Resolve a fill to an SVG paint value, registering a gradient if needed. */
  paint(fill: ResolvedFill, box: Box): string {
    if (!fill.gradient) return fill.color;
    const id = `${this.prefix}-g${this.counter++}`;
    this.entries.push(gradientElement(id, fill.gradient, box));
    return `url(#${id})`;
  }

  add(element: string): void {
    this.entries.push(element);
  }

  render(): string[] {
    return this.entries;
  }
}

function gradientElement(id: string, gradient: Gradient, box: Box): string {
  const stops = gradient.colorStops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map(
      (stop) =>
        `<stop offset="${num(stop.offset)}" stop-color="${stop.color}"` +
        `${stop.opacity === undefined ? '' : ` stop-opacity="${num(stop.opacity)}"`}/>`,
    )
    .join('');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  if (gradient.type === 'radial') {
    const radius = Math.max(box.width, box.height) / 2;
    return (
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${num(cx)}" cy="${num(cy)}" r="${num(radius)}">${stops}</radialGradient>`
    );
  }

  const radians = ((gradient.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Half the projection of the box onto the gradient axis, so the ramp spans it.
  const half = (Math.abs(box.width * cos) + Math.abs(box.height * sin)) / 2;
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${num(cx - cos * half)}" y1="${num(cy - sin * half)}" ` +
    `x2="${num(cx + cos * half)}" y2="${num(cy + sin * half)}">${stops}</linearGradient>`
  );
}

function fillAttributes(paint: string, opacity: number): string {
  return `fill="${paint}"${opacity < 1 ? ` fill-opacity="${num(opacity)}"` : ''}`;
}

/** Short, stable id prefix so several inlined QR codes never collide. */
function idPrefix(design: ResolvedDesign): string {
  const source = JSON.stringify(design);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `qr${(hash >>> 0).toString(36)}`;
}

export function renderSvg(design: QrDesign): RenderResult {
  const resolved = resolveDesign(design);
  const symbol = encodeQr(resolved.data, {
    errorCorrectionLevel: resolved.encoding.errorCorrectionLevel,
    version: resolved.encoding.version,
    minVersion: resolved.encoding.minVersion,
    mask: resolved.encoding.mask,
    mode: resolved.encoding.mode,
    utf8Eci: resolved.encoding.utf8Eci,
  });

  const { width, height, margin, quietZone } = resolved;
  const captionHeight = resolved.caption.text ? resolved.caption.fontSize * 1.35 + resolved.caption.gap : 0;
  const modulesAcross = symbol.size + quietZone * 2;
  // The border sits at the edge of the canvas, so everything inside it — the
  // margin, the symbol and the caption — starts after its thickness and gap.
  const frameInset = resolved.border.width > 0 ? resolved.border.width + resolved.border.gap : 0;
  const inset = margin + frameInset;
  const availableWidth = width - inset * 2;
  const availableHeight = height - inset * 2 - captionHeight;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error(
      'The border, margin and caption leave no room for the QR code; increase the width or height, ' +
        'or reduce them.',
    );
  }

  const modulePixelSize = Math.min(availableWidth, availableHeight) / modulesAcross;
  const drawnSize = modulePixelSize * modulesAcross;
  const originX = inset + (availableWidth - drawnSize) / 2;
  const originY =
    inset + (availableHeight - drawnSize) / 2 + (resolved.caption.position === 'top' ? captionHeight : 0);
  const gridX = originX + quietZone * modulePixelSize;
  const gridY = originY + quietZone * modulePixelSize;
  const symbolBox: Box = {
    x: gridX,
    y: gridY,
    width: symbol.size * modulePixelSize,
    height: symbol.size * modulePixelSize,
  };

  const hidden = logoMask(symbol, resolved);
  const emblem = resolved.emblem.enabled ? applyEmblem(symbol, resolved) : null;
  const modules = emblem?.modules ?? symbol.modules;
  const grid = buildDataGrid(symbol, modules, resolved, hidden, emblem?.geometry ?? null);

  const defs = new Defs(idPrefix(resolved));
  const body: string[] = [];

  // Background plate.
  if (resolved.background.color !== 'none' || resolved.background.gradient) {
    const box: Box = { x: 0, y: 0, width, height };
    const radius = (resolved.background.round * Math.min(width, height)) / 2;
    body.push(
      `<path ${fillAttributes(defs.paint(resolved.background, box), resolved.background.opacity)} ` +
        `d="${roundedRectPath(0, 0, width, height, [radius, radius, radius, radius])}"/>`,
    );
  }

  const symbolParts: string[] = [];

  // Data modules (everything except the finder patterns and, optionally, the
  // alignment patterns) drawn as one path per fill.
  const dataPath = renderDataModules(grid, symbol.size, gridX, gridY, modulePixelSize, resolved);
  if (dataPath) {
    symbolParts.push(
      `<path ${fillAttributes(defs.paint(resolved.dots, symbolBox), resolved.dots.opacity)} d="${dataPath}"/>`,
    );
  }

  // The emblem's modules, drawn in their own colour on top of the data path.
  if (emblem) {
    const emblemGrid = buildEmblemGrid(symbol, modules, resolved, hidden, emblem.geometry);
    const emblemDesign: ResolvedDesign =
      resolved.emblem.dotType === 'inherit'
        ? resolved
        : { ...resolved, dots: { ...resolved.dots, type: resolved.emblem.dotType } };
    const path = renderDataModules(emblemGrid, symbol.size, gridX, gridY, modulePixelSize, emblemDesign);
    if (path) {
      symbolParts.push(
        `<path ${fillAttributes(defs.paint(resolved.emblem, symbolBox), resolved.emblem.opacity)} d="${path}"/>`,
      );
    }
  }

  // Alignment patterns, when styled as miniature eyes.
  if (resolved.alignment.type !== 'as-data') {
    const alignmentPath = symbol.alignments
      .map(({ x, y }) => {
        const px = gridX + (x - 2) * modulePixelSize;
        const py = gridY + (y - 2) * modulePixelSize;
        const ring = cornerSquarePath(
          resolved.alignment.type as Exclude<typeof resolved.alignment.type, 'as-data'>,
          px,
          py,
          modulePixelSize * 5,
          modulePixelSize,
        );
        const centre = modulePath(
          resolved.alignment.centerType,
          gridX + x * modulePixelSize,
          gridY + y * modulePixelSize,
          modulePixelSize,
        );
        return ring + centre;
      })
      .join('');
    if (alignmentPath) {
      symbolParts.push(
        `<path fill-rule="evenodd" ` +
          `${fillAttributes(defs.paint(resolved.alignment, symbolBox), resolved.alignment.opacity)} ` +
          `d="${alignmentPath}"/>`,
      );
    }
  }

  // Finder patterns: the 7x7 ring and the 3x3 centre, each stylable per corner.
  symbolParts.push(...renderFinders(symbol, resolved, defs, gridX, gridY, modulePixelSize, symbolBox));

  let symbolGroup = symbolParts.join('');
  if (resolved.rotation % 360 !== 0) {
    const cx = originX + drawnSize / 2;
    const cy = originY + drawnSize / 2;
    symbolGroup = `<g transform="rotate(${num(resolved.rotation)} ${num(cx)} ${num(cy)})">${symbolGroup}</g>`;
  }
  if (resolved.shape === 'circle') {
    const clipId = `${idPrefix(resolved)}-clip`;
    defs.add(
      `<clipPath id="${clipId}"><circle cx="${num(originX + drawnSize / 2)}" ` +
        `cy="${num(originY + drawnSize / 2)}" r="${num(drawnSize / 2)}"/></clipPath>`,
    );
    symbolGroup = `<g clip-path="url(#${clipId})">${symbolGroup}</g>`;
  }
  body.push(symbolGroup);

  // Logo.
  if (resolved.image.src) {
    body.push(renderImage(resolved, symbolBox, modulePixelSize));
  }

  // Caption, on an optional band that fills the width inside the border.
  if (resolved.caption.text) {
    if (resolved.caption.background !== 'none') {
      const bandTop =
        resolved.caption.position === 'top' ? frameInset : height - frameInset - captionHeight;
      const outerRadius = (resolved.border.radius * Math.min(width, height)) / 2;
      const bandRadius = Math.max(0, outerRadius - frameInset);
      const corners: Radii =
        resolved.caption.position === 'top'
          ? [bandRadius, bandRadius, 0, 0]
          : [0, 0, bandRadius, bandRadius];
      body.push(
        `<path fill="${resolved.caption.background}" ` +
          `d="${roundedRectPath(frameInset, bandTop, width - frameInset * 2, captionHeight, corners)}"/>`,
      );
    }
    const baseline =
      resolved.caption.position === 'top'
        ? inset + resolved.caption.fontSize
        : originY + drawnSize + resolved.caption.gap + resolved.caption.fontSize * 0.85;
    body.push(
      `<text x="${num(width / 2)}" y="${num(baseline)}" text-anchor="middle" ` +
        `font-family="${resolved.caption.fontFamily}" font-size="${num(resolved.caption.fontSize)}" ` +
        `font-weight="${resolved.caption.fontWeight}" ` +
        `${resolved.caption.letterSpacing ? `letter-spacing="${num(resolved.caption.letterSpacing)}" ` : ''}` +
        `fill="${resolved.caption.color}">${escapeXml(resolved.caption.text)}</text>`,
    );
  }

  // The border is drawn last so it sits above the background, the caption band
  // and anything that reaches the edge.
  if (resolved.border.width > 0) {
    body.push(...renderBorder(resolved, defs, width, height));
  }

  const defsBlock = defs.render();
  const separator = resolved.pretty ? '\n  ' : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" ` +
    `role="img" aria-label="${escapeXml(qrLabel(resolved.data))}">` +
    (defsBlock.length ? `${separator}<defs>${defsBlock.join('')}</defs>` : '') +
    separator +
    body.join(separator) +
    (resolved.pretty ? '\n' : '') +
    `</svg>`;

  // Everything drawn over the modules — the logo's cleared area and any inked
  // emblem — is a read error the error correction has to absorb.
  const damage = assessDamage(symbol, [...hidden.modules, ...(emblem?.changed ?? [])]);

  const meta: RenderMeta = {
    version: symbol.version,
    errorCorrectionLevel: symbol.ecc,
    mask: symbol.mask,
    mode: symbol.mode,
    moduleCount: symbol.size,
    modulePixelSize,
    width,
    height,
    logoCoverage: hidden.coverage,
    errorBudget: damage,
    warnings: collectWarnings(resolved, symbol, modulePixelSize, hidden, emblem, damage),
  };

  return { svg, meta };
}

/**
 * The frame around the whole image. Strokes are centred on their path, so each
 * line is inset by half its own thickness to keep it inside the canvas.
 */
function renderBorder(design: ResolvedDesign, defs: Defs, width: number, height: number): string[] {
  const { width: thickness, style, radius, dash } = design.border;
  const box: Box = { x: 0, y: 0, width, height };
  const paint = defs.paint(design.border, box);
  const opacity = design.border.opacity < 1 ? ` stroke-opacity="${num(design.border.opacity)}"` : '';

  const line = (lineWidth: number, centreInset: number, extra = ''): string => {
    const outerRadius = (radius * Math.min(width, height)) / 2;
    const cornerRadius = Math.max(0, outerRadius - centreInset);
    const path = roundedRectPath(
      centreInset,
      centreInset,
      width - centreInset * 2,
      height - centreInset * 2,
      [cornerRadius, cornerRadius, cornerRadius, cornerRadius],
    );
    return `<path fill="none" stroke="${paint}" stroke-width="${num(lineWidth)}"${opacity}${extra} d="${path}"/>`;
  };

  switch (style) {
    case 'solid':
      return [line(thickness, thickness / 2)];
    case 'dashed': {
      const length = dash || thickness * 3;
      return [line(thickness, thickness / 2, ` stroke-dasharray="${num(length)} ${num(length * 0.6)}"`)];
    }
    case 'dotted': {
      const spacing = dash || thickness * 2;
      // A zero-length dash with round caps draws a dot of the stroke's width.
      return [line(thickness, thickness / 2, ` stroke-linecap="round" stroke-dasharray="0 ${num(spacing)}"`)];
    }
    case 'double': {
      // Two lines of a quarter the thickness, at its outer and inner edges.
      const lineWidth = thickness / 4;
      return [line(lineWidth, lineWidth / 2), line(lineWidth, thickness - lineWidth / 2)];
    }
  }
}

function qrLabel(data: string): string {
  const trimmed = data.length > 60 ? `${data.slice(0, 57)}...` : data;
  return `QR code for ${trimmed}`;
}

interface LogoMask {
  covers(x: number, y: number): boolean;
  /** The modules the logo hides, which the error correction has to make up for. */
  modules: { x: number; y: number }[];
  coverage: number;
}

const NO_LOGO: LogoMask = { covers: () => false, modules: [], coverage: 0 };

/** Modules that fall underneath the logo, including its clear margin. */
function logoMask(symbol: QrSymbol, design: ResolvedDesign): LogoMask {
  if (!design.image.src || !design.image.hideBackgroundDots) return NO_LOGO;

  const half = (design.image.size * symbol.size) / 2 + design.image.margin;
  const centre = symbol.size / 2;
  const circular = design.image.shape === 'circle';
  const covers = (x: number, y: number): boolean => {
    const dx = x + 0.5 - centre;
    const dy = y + 0.5 - centre;
    return circular ? Math.hypot(dx, dy) <= half : Math.abs(dx) <= half && Math.abs(dy) <= half;
  };

  const modules: { x: number; y: number }[] = [];
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) if (covers(x, y)) modules.push({ x, y });
  }
  return { covers, modules, coverage: modules.length / symbol.size ** 2 };
}

interface EmblemState {
  geometry: EmblemGeometry;
  /** The module values to draw, with an inked emblem already stamped in. */
  modules: boolean[][];
  /** Modules whose value the emblem changed. */
  changed: { x: number; y: number }[];
  /** Emblem modules that landed on a function pattern and had to be left alone. */
  blocked: number;
}

/**
 * Work out which modules form the emblem and, when it is inked, stamp the shape
 * into a copy of the matrix. Function patterns are never overwritten: scanners
 * locate the symbol with them, so a shape crossing one is clipped instead.
 */
function applyEmblem(symbol: QrSymbol, design: ResolvedDesign): EmblemState {
  const geometry = buildEmblem(symbol.size, {
    shape: design.emblem.shape,
    size: design.emblem.size,
    halo: design.emblem.halo,
    ...(design.emblem.grid.length ? { grid: design.emblem.grid } : {}),
  });

  if (design.emblem.style === 'tint') {
    return { geometry, modules: symbol.modules, changed: [], blocked: 0 };
  }

  const modules = symbol.modules.map((row) => [...row]);
  const changed: { x: number; y: number }[] = [];
  let blocked = 0;

  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      const inShape = geometry.inside[y]![x]!;
      const inHalo = geometry.halo[y]![x]!;
      if (!inShape && !inHalo) continue;
      if (symbol.regions[y]![x] !== ModuleRegion.Data) {
        if (inShape) blocked++;
        continue;
      }
      const wanted = inShape;
      if (modules[y]![x] === wanted) continue;
      modules[y]![x] = wanted;
      changed.push({ x, y });
    }
  }

  return { geometry, modules, changed, blocked };
}

/** Should this module be drawn by the regular dot renderer? */
function isDrawableModule(
  symbol: QrSymbol,
  modules: boolean[][],
  design: ResolvedDesign,
  hidden: LogoMask,
  x: number,
  y: number,
): boolean {
  if (!modules[y]![x]) return false;
  const region = symbol.regions[y]![x]!;
  if (region === ModuleRegion.Finder || region === ModuleRegion.Separator) return false;
  if (design.alignment.type !== 'as-data' && region === ModuleRegion.Alignment) return false;
  return !hidden.covers(x, y);
}

/** Dark modules that the dot renderer is responsible for drawing. */
function buildDataGrid(
  symbol: QrSymbol,
  modules: boolean[][],
  design: ResolvedDesign,
  hidden: LogoMask,
  emblem: EmblemGeometry | null,
): boolean[][] {
  return modules.map((row, y) =>
    row.map(
      (_dark, x) =>
        isDrawableModule(symbol, modules, design, hidden, x, y) && !(emblem?.inside[y]![x] ?? false),
    ),
  );
}

/** The emblem's own modules, drawn separately so they can carry their own fill. */
function buildEmblemGrid(
  symbol: QrSymbol,
  modules: boolean[][],
  design: ResolvedDesign,
  hidden: LogoMask,
  emblem: EmblemGeometry,
): boolean[][] {
  return modules.map((row, y) =>
    row.map(
      (_dark, x) => emblem.inside[y]![x]! && isDrawableModule(symbol, modules, design, hidden, x, y),
    ),
  );
}

function renderDataModules(
  grid: boolean[][],
  size: number,
  gridX: number,
  gridY: number,
  pitch: number,
  design: ResolvedDesign,
): string {
  const { type, scale } = design.dots;
  const inset = (pitch * (1 - scale)) / 2;
  const drawn = pitch * scale;

  if (type === 'horizontal-line' || type === 'vertical-line') {
    return renderLines(grid, size, gridX, gridY, pitch, inset, drawn, type === 'horizontal-line');
  }

  const random = createRandom(design.dots.randomSeed);
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!grid[y]![x]) continue;
      const neighbors: Neighbors = {
        top: Boolean(grid[y - 1]?.[x]),
        bottom: Boolean(grid[y + 1]?.[x]),
        left: Boolean(grid[y]![x - 1]),
        right: Boolean(grid[y]![x + 1]),
      };
      const jitter = type === 'random-dot' ? 0.55 + random() * 0.45 : 1;
      parts.push(
        modulePath(type, gridX + x * pitch + inset, gridY + y * pitch + inset, drawn, neighbors, jitter),
      );
    }
  }
  return parts.join('');
}

/** Merge runs of adjacent modules into single bars for the line dot styles. */
function renderLines(
  grid: boolean[][],
  size: number,
  gridX: number,
  gridY: number,
  pitch: number,
  inset: number,
  drawn: number,
  horizontal: boolean,
): string {
  const parts: string[] = [];
  for (let major = 0; major < size; major++) {
    let start = -1;
    for (let minor = 0; minor <= size; minor++) {
      const filled = minor < size && Boolean(horizontal ? grid[major]![minor] : grid[minor]![major]);
      if (filled && start === -1) start = minor;
      if (!filled && start !== -1) {
        const length = (minor - start) * pitch - (pitch - drawn);
        const radius = drawn / 2;
        const x = horizontal ? gridX + start * pitch + inset : gridX + major * pitch + inset;
        const y = horizontal ? gridY + major * pitch + inset : gridY + start * pitch + inset;
        parts.push(
          horizontal
            ? roundedRectPath(x, y, length, drawn, [radius, radius, radius, radius])
            : roundedRectPath(x, y, drawn, length, [radius, radius, radius, radius]),
        );
        start = -1;
      }
    }
  }
  return parts.join('');
}

function renderFinders(
  symbol: QrSymbol,
  design: ResolvedDesign,
  defs: Defs,
  gridX: number,
  gridY: number,
  pitch: number,
  symbolBox: Box,
): string[] {
  const parts: string[] = [];
  for (const finder of symbol.finders) {
    const square: ResolvedCornerSquare = design.cornersSquare.corners[finder.corner] ?? design.cornersSquare;
    const dot: ResolvedCornerDot = design.cornersDot.corners[finder.corner] ?? design.cornersDot;
    const x = gridX + finder.x * pitch;
    const y = gridY + finder.y * pitch;

    parts.push(
      `<path fill-rule="evenodd" ${fillAttributes(defs.paint(square, symbolBox), square.opacity)} ` +
        `d="${cornerSquarePath(square.type, x, y, pitch * 7, pitch)}"/>`,
    );
    parts.push(
      `<path ${fillAttributes(defs.paint(dot, symbolBox), dot.opacity)} ` +
        `d="${modulePath(dot.type, x + pitch * 2, y + pitch * 2, pitch * 3)}"/>`,
    );
  }
  return parts;
}

function renderImage(design: ResolvedDesign, symbolBox: Box, pitch: number): string {
  const size = design.image.size * symbolBox.width;
  const x = symbolBox.x + (symbolBox.width - size) / 2;
  const y = symbolBox.y + (symbolBox.height - size) / 2;
  const parts: string[] = [];

  if (design.image.background !== 'none') {
    const pad = design.image.margin * pitch;
    const plateSize = size + pad * 2;
    const px = x - pad;
    const py = y - pad;
    const radius =
      design.image.shape === 'circle'
        ? plateSize / 2
        : design.image.shape === 'rounded'
          ? (design.image.round * plateSize) / 2
          : 0;
    parts.push(
      `<path fill="${design.image.background}" ` +
        `d="${roundedRectPath(px, py, plateSize, plateSize, [radius, radius, radius, radius])}"/>`,
    );
  }

  const clip =
    design.image.shape === 'square'
      ? ''
      : ` clip-path="inset(0 round ${num(design.image.shape === 'circle' ? size / 2 : (design.image.round * size) / 2)}px)"`;

  parts.push(
    `<image href="${escapeXml(design.image.src!)}" x="${num(x)}" y="${num(y)}" ` +
      `width="${num(size)}" height="${num(size)}" ` +
      `preserveAspectRatio="${design.image.preserveAspectRatio}"` +
      `${design.image.opacity < 1 ? ` opacity="${num(design.image.opacity)}"` : ''}${clip}/>`,
  );

  return parts.join('');
}

/**
 * Flag parts of the design that a scanner would struggle to separate from the
 * background. Gradients are skipped: their contrast varies across the symbol.
 */
function contrastWarnings(design: ResolvedDesign): string[] {
  if (design.background.gradient) return [];
  const background = design.background.color;
  const checks: [string, string, boolean][] = [
    ['module', design.dots.color, Boolean(design.dots.gradient)],
    ['finder pattern', design.cornersSquare.color, Boolean(design.cornersSquare.gradient)],
    ['finder centre', design.cornersDot.color, Boolean(design.cornersDot.gradient)],
  ];
  for (const [corner, override] of Object.entries(design.cornersSquare.corners)) {
    checks.push([`${corner} finder pattern`, override.color, Boolean(override.gradient)]);
  }
  for (const [corner, override] of Object.entries(design.cornersDot.corners)) {
    checks.push([`${corner} finder centre`, override.color, Boolean(override.gradient)]);
  }

  const warnings: string[] = [];
  for (const [label, color, hasGradient] of checks) {
    if (hasGradient) continue;
    const ratio = contrastRatio(color, background);
    if (ratio !== null && ratio < MIN_SCAN_CONTRAST) {
      warnings.push(
        `The ${label} (${color}) only reach a contrast ratio of ${ratio.toFixed(1)}:1 against the ` +
          `background (${background}). Scanners need at least ${MIN_SCAN_CONTRAST}:1.`,
      );
    }
  }
  return warnings;
}

function collectWarnings(
  design: ResolvedDesign,
  symbol: QrSymbol,
  modulePixelSize: number,
  hidden: LogoMask,
  emblem: EmblemState | null,
  damage: ReturnType<typeof assessDamage>,
): string[] {
  const warnings: string[] = [];

  if (!damage.withinBudget) {
    const source =
      hidden.modules.length && emblem?.changed.length
        ? 'The logo and the emblem together overwrite'
        : emblem?.changed.length
          ? 'The emblem overwrites'
          : 'The logo hides';
    warnings.push(
      `${source} more of the symbol than it can recover: the worst-hit error correction block loses ` +
        `${damage.worstBlockDamage} codewords but only ${damage.correctablePerBlock} can be repaired at ` +
        `level ${symbol.ecc}. Make it smaller, or raise the error correction level.`,
    );
  } else if (damage.worstBlockDamage > damage.correctablePerBlock * 0.8) {
    warnings.push(
      `The symbol is close to its recovery limit: ${damage.worstBlockDamage} of ` +
        `${damage.correctablePerBlock} repairable codewords are already used in the worst-hit block, ` +
        'leaving little margin for print damage or a poor camera.',
    );
  }
  if (emblem?.blocked) {
    warnings.push(
      `${emblem.blocked} of the emblem's modules fall on a finder, alignment or timing pattern and were ` +
        'left untouched, so the shape is clipped. Move it or make it smaller.',
    );
  }
  if (design.emblem.enabled && design.emblem.style === 'tint' && design.emblem.color === design.dots.color &&
      !design.emblem.gradient && !design.dots.gradient) {
    warnings.push(
      'The emblem is tinted the same colour as the modules, so it will not be visible. ' +
        'Give emblem.color a different colour, or use emblem.style "ink".',
    );
  }
  if (design.quietZone < 4) {
    warnings.push('A quiet zone of at least 4 modules is recommended; scanners may struggle without it.');
  }
  if (modulePixelSize < 2) {
    warnings.push(
      `Each module is only ${modulePixelSize.toFixed(2)}px. Increase the width or reduce the payload.`,
    );
  }
  // Shapes that already sit inside their cell lose contrast as soon as they are
  // shrunk further, so they get a stricter threshold than the boxy shapes.
  const inscribed = design.dots.type === 'dot' || isSparseDotType(design.dots.type);
  const minSafeScale = inscribed ? 1 : 0.9;
  if (design.dots.scale < minSafeScale) {
    warnings.push(
      `A module scale of ${design.dots.scale} with "${design.dots.type}" modules leaves gaps that strict ` +
        `decoders read as light modules. Use ${minSafeScale} or above for this shape.`,
    );
  }
  if (design.shape === 'circle' && design.quietZone < 6) {
    warnings.push('Circular cropping cuts the corners of the quiet zone; use a quiet zone of 6 or more.');
  }
  if (isSparseDotType(design.dots.type) && design.alignment.type === 'as-data' && symbol.version > 1) {
    warnings.push(
      `Module shape "${design.dots.type}" leaves the alignment patterns broken up, which some decoders ` +
        'cannot locate. Set alignment.type to a solid shape such as "square".',
    );
  }
  const finderTypes = new Set([
    design.cornersSquare.type,
    ...Object.values(design.cornersSquare.corners).map((corner) => corner.type),
  ]);
  if (finderTypes.has('diamond')) {
    warnings.push(
      'Diamond finder patterns break the 1:1:3:1:1 ratio scanners look for and fail with strict ' +
        'decoders. Use square, rounded or extra-rounded finders unless you have tested yours.',
    );
  }
  if (finderTypes.has('dot') || finderTypes.has('classy') || finderTypes.has('classy-rounded')) {
    warnings.push(
      'Round and classy finder patterns leave less margin for strict decoders than square ones. ' +
        'Print them large and test before a wide rollout.',
    );
  }
  const centreTypes = [design.cornersDot.type, ...Object.values(design.cornersDot.corners).map((c) => c.type)];
  if (centreTypes.some((type) => isSparseDotType(type) && type !== 'diamond')) {
    warnings.push(
      'The finder centres use a shape that does not fill their 3x3 block, which many scanners ' +
        'will not recognise. Prefer square, dot or rounded centres.',
    );
  }
  if (design.background.color === design.dots.color && !design.dots.gradient && !design.background.gradient) {
    warnings.push('The module colour matches the background colour, so the code will be invisible.');
  }
  warnings.push(...contrastWarnings(design));
  return warnings;
}
