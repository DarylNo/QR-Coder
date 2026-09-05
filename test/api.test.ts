import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer, isEntryPoint } from '../src/api/server.js';
import { decodeSvg } from './helpers.js';

// Tests run from a separate build directory, so the playground is pointed at
// the repository copy rather than the one next to the compiled server.
const PUBLIC_DIR = join(process.cwd(), 'public');
const PAYLOAD = 'https://example.com/qr-coder';

/** Start the service on an ephemeral port for the duration of `run`. */
async function withServer(run: (base: string) => Promise<void>, options = {}): Promise<void> {
  const server = createServer({ publicDir: PUBLIC_DIR, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /api/qr renders an SVG described by query parameters', async () => {
  await withServer(async (base) => {
    const response = await fetch(
      `${base}/api/qr?data=${encodeURIComponent('https://example.com/a')}` +
        '&dots.type=extra-rounded&dots.color=%230f172a&width=400&cornersDot.type=dot',
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(response.headers.get('x-qr-error-correction'), 'M');
    assert.ok(Number(response.headers.get('x-qr-modules')) >= 21);
    const svg = await response.text();
    assert.equal(decodeSvg(svg, 600), 'https://example.com/a');
  });
});

test('GET /api/qr renders PNG', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/qr?data=hello&format=png&scale=2&width=200`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'not a PNG signature');
  });
});

test('POST /api/qr accepts a JSON design and a preset to build on', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset: 'sunset',
        data: 'https://example.com/b',
        width: 420,
        dots: { type: 'classy-rounded' },
      }),
    });
    assert.equal(response.status, 200);
    const svg = await response.text();
    // The preset's gradient survives, but the module shape override wins.
    assert.ok(svg.includes('linearGradient'));
    assert.equal(decodeSvg(svg, 640), 'https://example.com/b');
  });
});

test('gradient stops can be written inline in a query string', async () => {
  await withServer(async (base) => {
    const query = new URLSearchParams({
      data: 'gradient test',
      'dots.gradient.type': 'linear',
      'dots.gradient.rotation': '45',
      'dots.gradient.colorStops': '0:#f97316,1:#db2777',
    });
    const response = await fetch(`${base}/api/qr?${query}`);
    assert.equal(response.status, 200);
    const svg = await response.text();
    assert.ok(svg.includes('#f97316') && svg.includes('#db2777'));
  });
});

test('warnings are reported in a response header', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/qr?data=hi&quietZone=0`);
    const warnings = JSON.parse(response.headers.get('x-qr-warnings') ?? '[]') as string[];
    assert.ok(warnings.some((warning) => /quiet zone/i.test(warning)), warnings.join(' | '));
    await response.text();
  });
});

test('invalid requests answer with 400 and an explanation', async () => {
  await withServer(async (base) => {
    const cases = [
      ['/api/qr', /data is required/],
      ['/api/qr?data=hi&dots.type=triangle', /dots\.type must be one of/],
      ['/api/qr?data=hi&nonsense=1', /Unknown design setting/],
      ['/api/qr?data=hi&format=tiff', /format must be/],
      ['/api/qr?data=hi&width=9', /width must be between/],
      ['/api/qr?data=hi&preset=nope', /Unknown preset/],
    ] as const;
    for (const [path, pattern] of cases) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400, `expected 400 for ${path}`);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, pattern);
    }
  });
});

test('a payload that cannot fit reports 422 rather than 400', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/qr?data=${'9'.repeat(4000)}&encoding.errorCorrectionLevel=H`);
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { error: string }).error, /too long/i);
  });
});

test('malformed JSON bodies are rejected', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /not valid JSON/);
  });
});

test('metadata endpoints describe the service', async () => {
  await withServer(async (base) => {
    const health = (await (await fetch(`${base}/health`)).json()) as { status: string; presets: number };
    assert.equal(health.status, 'ok');
    assert.ok(health.presets > 0);

    const presets = (await (await fetch(`${base}/api/presets`)).json()) as { presets: { id: string }[] };
    assert.ok(presets.presets.some((preset) => preset.id === 'sunset'));

    const schema = (await (await fetch(`${base}/api/schema`)).json()) as {
      groups: { group: string; fields: { path: string }[] }[];
    };
    const paths = schema.groups.flatMap((group) => group.fields.map((field) => field.path));
    for (const expected of ['data', 'dots.type', 'cornersSquare.type', 'image.src', 'encoding.mask']) {
      assert.ok(paths.includes(expected), `schema is missing ${expected}`);
    }
  });
});

test('the playground and library are served as static files', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /<title>QR-Coder/);

    const script = await fetch(`${base}/lib/style/render-svg.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    await script.text();
  });
});

test('path traversal is refused', async () => {
  await withServer(async (base) => {
    for (const path of ['/../package.json', '/lib/../../package.json', '/%2e%2e/package.json']) {
      const response = await fetch(`${base}${path}`);
      assert.ok(response.status === 403 || response.status === 404, `${path} returned ${response.status}`);
      const body = await response.text();
      assert.ok(!body.includes('"devDependencies"'), `${path} leaked a file outside the served roots`);
    }
  });
});

test('the rate limiter rejects a burst once the window is used up', async () => {
  await withServer(
    async (base) => {
      const first = await fetch(`${base}/api/health`);
      assert.equal(first.status, 200);
      await first.text();
      const second = await fetch(`${base}/api/health`);
      assert.equal(second.status, 200);
      await second.text();
      const third = await fetch(`${base}/api/health`);
      assert.equal(third.status, 429);
      assert.ok(Number(third.headers.get('retry-after')) >= 0);
      await third.text();
    },
    { rateLimit: 2 },
  );
});

test('unsupported methods and unknown paths are handled', async () => {
  await withServer(async (base) => {
    const put = await fetch(`${base}/api/qr`, { method: 'PUT' });
    assert.equal(put.status, 405);
    await put.text();

    const missing = await fetch(`${base}/nope.html`);
    assert.equal(missing.status, 404);
    await missing.text();

    const preflight = await fetch(`${base}/api/qr`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  });
});

test('an emblem can be described entirely in a query string', async () => {
  await withServer(async (base) => {
    const query = new URLSearchParams({
      data: PAYLOAD,
      width: '500',
      'encoding.errorCorrectionLevel': 'H',
      'emblem.shape': 'grid',
      'emblem.grid': '.##.|####|####|.##.',
      'emblem.style': 'ink',
      'emblem.color': '#059669',
    });
    const response = await fetch(`${base}/api/qr?${query}`);
    assert.equal(response.status, 200);
    const svg = await response.text();
    assert.ok(svg.includes('#059669'));
    assert.equal(decodeSvg(svg, 700), PAYLOAD);
  });
});

test('an emblem that overruns the error budget still renders, with a warning header', async () => {
  await withServer(async (base) => {
    const response = await fetch(
      `${base}/api/qr?data=${encodeURIComponent(PAYLOAD)}&encoding.errorCorrectionLevel=L` +
        '&emblem.shape=circle&emblem.size=0.5&emblem.style=ink',
    );
    assert.equal(response.status, 200);
    const warnings = JSON.parse(response.headers.get('x-qr-warnings') ?? '[]') as string[];
    assert.ok(
      warnings.some((warning) => /more of the symbol than it can recover/i.test(warning)),
      warnings.join(' | '),
    );
    await response.text();
  });
});

test('the entry-point guard recognises the path Node was given', () => {
  const posix = '/home/daryl/QR-Coder/dist/api/server.js';
  assert.equal(isEntryPoint(pathToFileURL(posix).href, posix), true);
  assert.equal(isEntryPoint(pathToFileURL(posix).href, '/somewhere/else/server.js'), false);
  assert.equal(isEntryPoint(pathToFileURL(posix).href, undefined), false);

  // Paths needing percent-encoding are where naive `file://` concatenation
  // first goes wrong, on every platform.
  const spaced = '/home/daryl/My Projects/QR-Coder/dist/api/server.js';
  assert.equal(isEntryPoint(pathToFileURL(spaced).href, spaced), true);
  assert.notEqual(pathToFileURL(spaced).href, `file://${spaced}`);
});

test('running the server module directly starts it listening', async () => {
  // `npm start` runs the module as the entry point, which is a different code
  // path from createServer() and the one that silently did nothing before.
  //
  // The copy into a directory whose name contains a space is the point of the
  // test: that is where building the entry URL by concatenation stops matching
  // `import.meta.url`, on every platform rather than only on Windows.
  const root = await mkdtemp(join(tmpdir(), 'qr coder '));
  await cp(join(process.cwd(), 'dist-test', 'src'), join(root, 'src'), { recursive: true });
  const entry = join(root, 'src', 'api', 'server.js');
  const port = 3100 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', QR_PUBLIC_DIR: PUBLIC_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const started = await Promise.race([
      new Promise<string>((resolve) => {
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('listening')) resolve(output);
        });
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('the server never reported that it was listening')), 10_000),
      ),
      new Promise<never>((_resolve, reject) =>
        child.on('exit', (code) => reject(new Error(`the server exited with code ${code} instead of listening`))),
      ),
    ]);
    assert.match(started, /listening on http/);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { status: string }).status, 'ok');
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test('a border can be described in a query string', async () => {
  await withServer(async (base) => {
    const query = new URLSearchParams({
      data: PAYLOAD,
      width: '500',
      'border.width': '10',
      'border.style': 'dashed',
      'border.color': '#059669',
      'border.gap': '8',
      'caption.text': 'SCAN ME',
      'caption.background': '#059669',
      'caption.color': '#ffffff',
    });
    const response = await fetch(`${base}/api/qr?${query}`);
    assert.equal(response.status, 200);
    const svg = await response.text();
    assert.match(svg, /stroke-dasharray/);
    assert.ok(svg.includes('SCAN ME'));
    assert.equal(decodeSvg(svg, 700), PAYLOAD);
  });
});
