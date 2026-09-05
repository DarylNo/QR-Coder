import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSvg } from '../style/render-svg.js';
import { renderPng } from '../style/raster.js';
import { DesignError } from '../style/sanitize.js';
import type { QrDesign, RenderMeta } from '../style/types.js';
import { PRESETS } from '../presets.js';
import { FIELDS, groupedFields } from './schema.js';
import { applyPreset, designFromQuery, transportFromQuery } from './query.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
/** The compiled library, served so the playground can render previews locally. */
const DEFAULT_LIB_DIR = fileURLToPath(new URL('../', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  /** Maximum accepted request body size, in bytes. */
  maxBodyBytes?: number;
  /** Requests allowed per client per window; 0 disables rate limiting. */
  rateLimit?: number;
  rateLimitWindowMs?: number;
  /** Value for `Access-Control-Allow-Origin`; omit to disable CORS. */
  corsOrigin?: string;
  /** `Cache-Control` sent with generated images. */
  cacheControl?: string;
  /** Directory served at `/`; defaults to the bundled playground. */
  publicDir?: string;
  /** Directory served at `/lib/`; defaults to the compiled library. */
  libDir?: string;
}

const DEFAULTS: Required<ServerOptions> = {
  maxBodyBytes: 4 * 1024 * 1024,
  rateLimit: 240,
  rateLimitWindowMs: 60_000,
  corsOrigin: '*',
  cacheControl: 'public, max-age=300',
  publicDir: DEFAULT_PUBLIC_DIR,
  libDir: DEFAULT_LIB_DIR,
};

/** Fixed-window rate limiter, adequate for a single-process deployment. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    if (this.limit <= 0) return { allowed: true, retryAfterSeconds: 0 };
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count++;
    return {
      allowed: entry.count <= this.limit,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export function createServer(options: ServerOptions = {}): Server {
  const config = { ...DEFAULTS, ...options };
  const limiter = new RateLimiter(config.rateLimit, config.rateLimitWindowMs);

  return createHttpServer((request, response) => {
    handle(request, response, config, limiter).catch((error: unknown) => {
      sendError(response, config, 500, error instanceof Error ? error.message : 'Internal error');
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: Required<ServerOptions>,
  limiter: RateLimiter,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (config.corsOrigin) {
    response.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const client = String(request.socket.remoteAddress ?? 'unknown');
    const { allowed, retryAfterSeconds } = limiter.check(client);
    if (!allowed) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      sendError(response, config, 429, 'Too many requests. Slow down and try again shortly.');
      return;
    }
  }

  switch (url.pathname) {
    case '/health':
    case '/api/health':
      sendJson(response, config, 200, { status: 'ok', presets: PRESETS.length, settings: FIELDS.length });
      return;

    case '/api/presets':
      sendJson(response, config, 200, { presets: PRESETS });
      return;

    case '/api/schema':
      sendJson(response, config, 200, { groups: groupedFields() });
      return;

    case '/api/qr':
      await handleRender(request, response, config, url);
      return;

    default:
      if (request.method !== 'GET') {
        sendError(response, config, 405, `${request.method} is not allowed on ${url.pathname}`);
        return;
      }
      await (url.pathname.startsWith('/lib/')
        ? serveFrom(config.libDir, url.pathname.slice('/lib/'.length), response, config)
        : serveFrom(config.publicDir, url.pathname === '/' ? 'index.html' : url.pathname.slice(1), response, config));
  }
}

async function handleRender(
  request: IncomingMessage,
  response: ServerResponse,
  config: Required<ServerOptions>,
  url: URL,
): Promise<void> {
  let design: QrDesign;
  let transport: ReturnType<typeof transportFromQuery>;

  try {
    if (request.method === 'POST') {
      const body = await readJsonBody(request, config.maxBodyBytes);
      const merged = applyPreset(body);
      design = merged as unknown as QrDesign;
      const params = new URLSearchParams(url.search);
      for (const key of ['format', 'scale', 'download', 'pretty']) {
        const value = merged[key];
        if (value !== undefined && !params.has(key)) params.set(key, String(value));
      }
      transport = transportFromQuery(params);
    } else if (request.method === 'GET') {
      design = designFromQuery(url.searchParams);
      transport = transportFromQuery(url.searchParams);
    } else {
      sendError(response, config, 405, `${request.method} is not allowed on /api/qr`);
      return;
    }
  } catch (error) {
    sendError(response, config, 400, error instanceof Error ? error.message : 'Invalid request');
    return;
  }

  try {
    if (transport.format === 'png') {
      const { png, meta } = await renderPng(design, { scale: transport.scale });
      writeImageHeaders(response, config, meta, 'image/png', transport.download ? 'qr-code.png' : null);
      response.end(Buffer.from(png));
      return;
    }
    const { svg, meta } = renderSvg({ ...design, pretty: transport.pretty });
    writeImageHeaders(response, config, meta, 'image/svg+xml; charset=utf-8', transport.download ? 'qr-code.svg' : null);
    response.end(svg);
  } catch (error) {
    const status = error instanceof DesignError ? 400 : 422;
    sendError(response, config, status, error instanceof Error ? error.message : 'Could not render the design');
  }
}

function writeImageHeaders(
  response: ServerResponse,
  config: Required<ServerOptions>,
  meta: RenderMeta,
  contentType: string,
  downloadName: string | null,
): void {
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', config.cacheControl);
  // Render details travel in headers so image responses stay directly usable.
  response.setHeader('X-QR-Version', String(meta.version));
  response.setHeader('X-QR-Error-Correction', meta.errorCorrectionLevel);
  response.setHeader('X-QR-Mask', String(meta.mask));
  response.setHeader('X-QR-Modules', String(meta.moduleCount));
  if (meta.warnings.length) {
    response.setHeader('X-QR-Warnings', JSON.stringify(meta.warnings));
  }
  if (downloadName) {
    response.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  }
  response.writeHead(200);
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new DesignError(`Request body exceeds ${maxBytes} bytes`);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) throw new DesignError('A JSON body is required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DesignError('The request body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DesignError('The request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function serveFrom(
  root: string,
  relative: string,
  response: ServerResponse,
  config: Required<ServerOptions>,
): Promise<void> {
  const base = root.endsWith(sep) ? root : root + sep;
  const resolved = join(base, normalize(relative.replace(/^\/+/, '')));
  if (!resolved.startsWith(base)) {
    sendError(response, config, 403, 'Forbidden');
    return;
  }

  try {
    const file = await readFile(resolved);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(file);
  } catch {
    sendError(response, config, 404, `Not found: ${relative}`);
  }
}

function sendJson(response: ServerResponse, config: Required<ServerOptions>, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? config.cacheControl : 'no-store',
  });
  response.end(payload);
}

function sendError(response: ServerResponse, config: Required<ServerOptions>, status: number, message: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  sendJson(response, config, status, { error: message });
}

/**
 * True when this module is the file Node was asked to run.
 *
 * `process.argv[1]` is a native filesystem path, so it has to be converted with
 * `pathToFileURL` rather than concatenated onto `file://`: concatenation leaves
 * out the percent-encoding `import.meta.url` carries (any path containing a
 * space stops matching) and mangles Windows paths completely, turning
 * `C:\dir\server.js` into `file://C:\dir\server.js` instead of
 * `file:///C:/dir/server.js`. Either way the comparison silently fails and the
 * server never starts.
 */
export function isEntryPoint(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href;
}

/** Start the service when this module is executed directly. */
if (isEntryPoint(import.meta.url, process.argv[1])) {
  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';
  createServer({
    ...(process.env['QR_RATE_LIMIT'] ? { rateLimit: Number(process.env['QR_RATE_LIMIT']) } : {}),
    ...(process.env['QR_CORS_ORIGIN'] ? { corsOrigin: process.env['QR_CORS_ORIGIN'] } : {}),
    ...(process.env['QR_PUBLIC_DIR'] ? { publicDir: process.env['QR_PUBLIC_DIR'] } : {}),
  }).listen(port, host, () => {
    console.log(`QR-Coder listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
}
