import { ModuleRegion, encodeQr, type QrSymbol } from '../core/matrix.js';
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
} from './shapes.js';

/** Share of the codewords each error correction level can afford to lose. */
const ECC_RECOVERY: Record<string, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

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
  const availableWidth = width - margin * 2;
  const availableHeight = height - margin * 2 - captionHeight;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error('The margin and caption leave no room for the QR code; increase width or height.');
  }

  const modulePixelSize = Math.min(availableWidth, availableHeight) / modulesAcross;
  const drawnSize = modulePixelSize * modulesAcross;
  const originX = margin + (availableWidth - drawnSize) / 2;
  const originY =
    margin + (availableHeight - drawnSize) / 2 + (resolved.caption.position === 'top' ? captionHeight : 0);
  const gridX = originX + quietZone * modulePixelSize;
  const gridY = originY + quietZone * modulePixelSize;
  const symbolBox: Box = {
    x: gridX,
    y: gridY,
    width: symbol.size * modulePixelSize,
    height: symbol.size * modulePixelSize,
  };

  const hidden = logoMask(symbol, resolved);
  const grid = buildDataGrid(symbol, resolved, hidden);

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

  // Caption.
  if (resolved.caption.text) {
    const baseline =
      resolved.caption.position === 'top'
        ? margin + resolved.caption.fontSize
        : originY + drawnSize + resolved.caption.gap + resolved.caption.fontSize * 0.85;
    body.push(
      `<text x="${num(width / 2)}" y="${num(baseline)}" text-anchor="middle" ` +
        `font-family="${resolved.caption.fontFamily}" font-size="${num(resolved.caption.fontSize)}" ` +
        `font-weight="${resolved.caption.fontWeight}" ` +
        `${resolved.caption.letterSpacing ? `letter-spacing="${num(resolved.caption.letterSpacing)}" ` : ''}` +
        `fill="${resolved.caption.color}">${escapeXml(resolved.caption.text)}</text>`,
    );
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
    warnings: collectWarnings(resolved, symbol, modulePixelSize, hidden.coverage),
  };

  return { svg, meta };
}

function qrLabel(data: string): string {
  const trimmed = data.length > 60 ? `${data.slice(0, 57)}...` : data;
  return `QR code for ${trimmed}`;
}

interface LogoMask {
  covers(x: number, y: number): boolean;
  coverage: number;
}

/** Modules that fall underneath the logo, including its clear margin. */
function logoMask(symbol: QrSymbol, design: ResolvedDesign): LogoMask {
  if (!design.image.src || !design.image.hideBackgroundDots) {
    return { covers: () => false, coverage: 0 };
  }
  const half = (design.image.size * symbol.size) / 2 + design.image.margin;
  const centre = symbol.size / 2;
  const circular = design.image.shape === 'circle';
  const coverage = Math.min(1, ((half * 2) ** 2 * (circular ? Math.PI / 4 : 1)) / symbol.size ** 2);
  return {
    coverage,
    covers(x, y) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      return circular ? Math.hypot(dx, dy) <= half : Math.abs(dx) <= half && Math.abs(dy) <= half;
    },
  };
}

/** Dark modules that the dot renderer is responsible for drawing. */
function buildDataGrid(symbol: QrSymbol, design: ResolvedDesign, hidden: LogoMask): boolean[][] {
  const styledAlignment = design.alignment.type !== 'as-data';
  return symbol.modules.map((row, y) =>
    row.map((dark, x) => {
      if (!dark) return false;
      const region = symbol.regions[y]![x]!;
      if (region === ModuleRegion.Finder || region === ModuleRegion.Separator) return false;
      if (styledAlignment && region === ModuleRegion.Alignment) return false;
      return !hidden.covers(x, y);
    }),
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
  logoCoverage: number,
): string[] {
  const warnings: string[] = [];
  const recovery = ECC_RECOVERY[symbol.ecc] ?? 0.15;

  if (logoCoverage > recovery) {
    warnings.push(
      `The logo hides about ${Math.round(logoCoverage * 100)}% of the symbol but error correction level ` +
        `${symbol.ecc} only recovers ${Math.round(recovery * 100)}%. Use a smaller logo or a higher level.`,
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
