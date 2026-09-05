# QR-Coder

A QR code service with custom logos, custom dot shapes, and control over every
design setting — including drawing your logo out of the code's own modules.

Use it three ways: a **web playground** with live preview, an **HTTP API**, or a
**Node library** (also usable in the browser). The QR encoder is written from
scratch with no runtime dependencies, so nothing about the symbol is opaque —
the renderer knows which modules are finder patterns, alignment patterns and
data, and styles each of them independently.

```bash
npm install
npm run serve          # http://localhost:3000
```

## What you can change

| Area | Settings |
| --- | --- |
| **Modules** | 14 shapes (`square`, `rounded`, `extra-rounded`, `classy`, `classy-rounded`, `dot`, `diamond`, `star`, `plus`, `cross`, `heart`, `vertical-line`, `horizontal-line`, `random-dot`), colour, opacity, scale, gradient |
| **Finder patterns** | 8 ring shapes, any module shape for the centres, separate colours and gradients, and per-corner overrides |
| **Alignment patterns** | Drawn module by module or as a solid ring, with their own shape and colour |
| **Logo** | Data URI or URL, size, clear margin, plate colour, square/rounded/circle clipping, opacity, and automatic removal of the modules underneath |
| **Emblem** | A shape made *from the modules themselves* — circle, square, diamond, heart, or any traced image — either tinted into the pattern or inked as a solid silhouette |
| **Background** | Colour or gradient, opacity, corner rounding, or fully transparent |
| **Caption** | Text above or below the code, with font family, size, weight, letter spacing and colour |
| **Canvas** | Width, height, padding, quiet zone, square or circular crop, rotation |
| **Encoding** | Error correction level, symbol version, mask pattern, encoding mode, UTF-8 ECI |

Gradients are linear or radial with any number of colour stops, and can be
applied separately to the modules, the finder rings, the finder centres, the
alignment patterns and the background.

`GET /api/schema` returns this list as JSON, including ranges and defaults.

## Logos made out of the code

A logo does not have to sit on top of the code. An **emblem** is a shape formed
from the modules themselves, in one of two styles:

- **`tint`** recolours the modules that fall inside the shape. The encoded data
  is untouched, so the symbol stays exactly as scannable as it was — this style
  costs nothing.
- **`ink`** forces those modules dark and clears a ring around them, so the shape
  reads as a solid silhouette. This overwrites real codewords, which the error
  correction has to absorb.

```ts
renderSvg({
  data: 'https://example.com',
  encoding: { errorCorrectionLevel: 'H' },
  emblem: { shape: 'heart', size: 0.3, style: 'ink', color: '#db2777' },
});
```

Any image can become one. `imageToGrid` samples it down to a module bitmap —
using its transparency or its darkness, whichever carries the shape — and the
result goes straight into `emblem.grid`:

```ts
import { imageToGrid, renderSvg } from 'qr-coder';

const grid = await imageToGrid(logoDataUri, { modules: 11 });
renderSvg({
  data: 'https://example.com',
  encoding: { errorCorrectionLevel: 'H' },
  emblem: { shape: 'grid', grid, style: 'ink', color: '#1d4ed8' },
});
```

It runs in the browser on a canvas and in Node through `@resvg/resvg-js`. The
playground has it wired to a file picker: upload a logo and it is traced into
the code in front of you.

Grids can also be written by hand, which makes them easy to pass in a URL —
rows separated by `|`:

```
/api/qr?data=hello&encoding.errorCorrectionLevel=H
       &emblem.shape=grid&emblem.style=ink&emblem.grid=.%23%23.|%23%23%23%23|.%23%23.
```

### Knowing what it costs

Anything drawn over the modules — an inked emblem, or the area a logo hides — is
a read error the error correction has to repair. Every render reports exactly
how much of that budget is spent:

```ts
const { meta } = renderSvg({ /* ... */ });
meta.errorBudget;
// { damagedCodewords: 25, worstBlockDamage: 7, correctablePerBlock: 8, withinBudget: true }
```

The figures are counted per error correction block from the real codeword
layout, not estimated from the area covered, and the test suite checks that
`withinBudget` agrees with whether the rendered image actually decodes. When it
does not fit, you get a warning saying so — and raising the error correction
level or shrinking the shape is what fixes it.

## HTTP API

### `GET /api/qr`

Every setting is a query parameter; nesting uses dots.

```
/api/qr?data=https://example.com
       &dots.type=extra-rounded
       &dots.color=%230f172a
       &cornersDot.type=dot
       &background.round=0.1
       &width=512
       &format=svg
```

Gradient stops are written as `offset:colour` pairs:

```
/api/qr?data=hello&dots.gradient.type=linear&dots.gradient.rotation=45
       &dots.gradient.colorStops=0:%23f97316,1:%23db2777
```

Transport parameters, separate from the design: `format` (`svg` or `png`),
`scale` (PNG resolution multiplier, 0.25–8), `preset`, `download`, `pretty`.

### `POST /api/qr`

Send the design as JSON. `preset` names a starting point that your fields
override.

```bash
curl -X POST http://localhost:3000/api/qr \
  -H 'Content-Type: application/json' \
  -d '{
    "preset": "sunset",
    "data": "https://example.com",
    "width": 512,
    "encoding": { "errorCorrectionLevel": "H" },
    "image": { "src": "data:image/png;base64,...", "size": 0.24, "background": "#ffffff" }
  }' > qr.svg
```

### Other routes

| Route | Purpose |
| --- | --- |
| `GET /` | The playground |
| `GET /api/presets` | Built-in designs |
| `GET /api/schema` | Every setting, grouped, with types, ranges and defaults |
| `GET /health` | Liveness check |

Responses carry `X-QR-Version`, `X-QR-Error-Correction`, `X-QR-Mask`,
`X-QR-Modules`, and `X-QR-Warnings` when a design may not scan well.

Errors come back as JSON with a message naming the offending setting: `400` for
an invalid design, `422` when the payload cannot fit the requested symbol,
`429` when rate limited.

## Library

```ts
import { renderSvg, renderPng } from 'qr-coder';

const { svg, meta } = renderSvg({
  data: 'https://example.com',
  width: 512,
  dots: { type: 'classy-rounded', gradient: {
    type: 'linear', rotation: 45,
    colorStops: [{ offset: 0, color: '#0ea5e9' }, { offset: 1, color: '#0f172a' }],
  }},
  cornersSquare: { type: 'extra-rounded', color: '#0f172a' },
  cornersDot: { type: 'dot', color: '#0ea5e9' },
  image: { src: logoDataUri, size: 0.22, background: '#ffffff' },
  encoding: { errorCorrectionLevel: 'H' },
});

console.log(meta.version, meta.warnings);

const { png } = await renderPng({ data: 'https://example.com' }, { scale: 2 });
```

`renderSvg` is dependency-free and runs in the browser as well as in Node.
`renderPng` needs the optional `@resvg/resvg-js` dependency; without it, render
SVG and rasterize wherever you prefer.

## CLI

```bash
npx qr-coder "https://example.com" --dots.type=extra-rounded \
  --dots.color='#1d4ed8' --cornersDot.type=dot -o code.svg

npx qr-coder "https://example.com" --preset=sunset --format=png --scale=2 -o code.png

npx qr-coder --list-presets
npx qr-coder --list-settings
```

Any design setting works as a flag using its dotted path. With no `-o`, the SVG
goes to stdout.

## Keeping codes scannable

Decoration costs decoder margin. Every render reports `meta.warnings` (and the
`X-QR-Warnings` header) when the design is likely to cause trouble:

- a logo or emblem overwriting more codewords than the error correction can repair
- a symbol close enough to that limit to leave no margin for print damage
- module scales that leave gaps a scanner reads as light modules
- modules rendered smaller than 2px
- colours whose contrast against the background falls below 4:1
- a quiet zone narrower than the standard 4 modules
- finder shapes that stray from the 1:1:3:1:1 ratio scanners look for

Two defaults protect the parts of the symbol scanners rely on: sparse module
shapes (stars, diamonds, hearts) still get a solid alignment pattern, and finder
centres fall back to a solid shape. Both can be overridden explicitly.

The warnings are advice, not restrictions — every setting stays available.

## Development

```bash
npm run build      # compile to dist/
npm test           # unit, render and API tests
npm run typecheck
npm start          # serve dist/ on PORT (default 3000)
```

Environment variables: `PORT`, `HOST`, `QR_RATE_LIMIT` (requests per minute per
client, `0` disables), `QR_CORS_ORIGIN`, `QR_PUBLIC_DIR`.

### How it is verified

- **Encoder**: every generated matrix is compared module for module against the
  `qrcode` reference library across all four error correction levels, all eight
  mask patterns, and versions 1–40 including capacity-filling payloads.
- **Renderer**: each module shape, finder shape and preset is rasterized and
  decoded back at five output sizes, so a style that would not scan fails the
  build.
- **Error budget**: inked emblems are grown past the recovery limit and the
  reported budget is checked against whether the image still decodes, so the
  number the service quotes is the number that matters.
- **Service**: the API is exercised over real HTTP, including validation
  failures, rate limiting and path traversal attempts.

### Layout

```
src/core/     QR encoding: Reed-Solomon, segmentation, matrix layout, masking,
              and the per-module codeword map the error budget is measured with
src/style/    Design resolution, shape geometry, SVG rendering, emblems,
              image tracing, contrast checks
src/api/      HTTP service, field schema, query parsing
public/       The playground
test/         Encoder, render and API tests
```

## Licence

MIT
