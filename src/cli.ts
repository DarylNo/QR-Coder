#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { renderSvg } from './style/render-svg.js';
import { renderPng } from './style/raster.js';
import { PRESETS } from './presets.js';
import { FIELDS, groupedFields } from './api/schema.js';
import { designFromQuery } from './api/query.js';

const USAGE = `qr-coder — generate customized QR codes

Usage:
  qr-coder <data> [options]

Options:
  -o, --out <file>        Write to a file; the extension picks the format
      --format <svg|png>  Output format when no file extension says otherwise
      --scale <n>         PNG resolution multiplier (0.25-8)
      --preset <id>       Start from a preset, then apply any overrides
      --list-presets      Print the available presets
      --list-settings     Print every design setting
  -h, --help              Show this message

Any design setting may be passed as a flag using its dotted path:
  qr-coder "https://example.com" --dots.type=extra-rounded --dots.color='#1d4ed8' \\
    --cornersDot.type=dot --background.round=0.1 -o code.svg

Gradients take their stops as offset:colour pairs:
  qr-coder "https://example.com" --dots.gradient.type=linear \\
    --dots.gradient.colorStops='0:#f97316,1:#db2777' -o code.svg
`;

// Writing to a closed pipe (`qr-coder ... | head`) is a normal way to exit.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (argv.includes('--list-presets')) {
    for (const preset of PRESETS) {
      process.stdout.write(`${preset.id.padEnd(14)} ${preset.name} — ${preset.description}\n`);
    }
    return 0;
  }

  if (argv.includes('--list-settings')) {
    for (const { group, fields } of groupedFields()) {
      process.stdout.write(`\n${group}\n`);
      for (const field of fields) {
        const range =
          field.values ? ` (${field.values.join(' | ')})`
          : field.min !== undefined || field.max !== undefined ? ` (${field.min ?? '-'}..${field.max ?? '-'})`
          : '';
        process.stdout.write(`  --${field.path}${range}\n      ${field.description}\n`);
      }
    }
    return 0;
  }

  const params = new URLSearchParams();
  let data: string | undefined;
  let out: string | undefined;
  let format: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === '-o' || argument === '--out') {
      out = argv[++i];
      continue;
    }
    if (argument.startsWith('--')) {
      const separator = argument.indexOf('=');
      const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
      const value = separator === -1 ? (argv[++i] ?? '') : argument.slice(separator + 1);
      if (key === 'format') format = value;
      else if (key === 'scale' || key === 'preset') params.set(key, value);
      else params.set(key, value);
      continue;
    }
    if (data === undefined) data = argument;
    else throw new Error(`Unexpected argument "${argument}"`);
  }

  if (data === undefined && !params.has('data')) throw new Error('No data given. Run with --help for usage.');
  if (data !== undefined) params.set('data', data);

  const design = designFromQuery(params);
  const resolvedFormat = format ?? (out?.endsWith('.png') ? 'png' : 'svg');
  if (resolvedFormat !== 'svg' && resolvedFormat !== 'png') {
    throw new Error('--format must be "svg" or "png"');
  }

  const scale = params.has('scale') ? Number(params.get('scale')) : 1;

  if (resolvedFormat === 'png') {
    const { png, meta } = await renderPng(design, { scale });
    if (!out) throw new Error('PNG output needs --out, since it cannot be written to the terminal');
    await writeFile(out, png);
    reportWarnings(meta.warnings);
    process.stderr.write(`Wrote ${out} (version ${meta.version}, level ${meta.errorCorrectionLevel})\n`);
    return 0;
  }

  const { svg, meta } = renderSvg({ ...design, pretty: true });
  if (out) {
    await writeFile(out, svg, 'utf8');
    reportWarnings(meta.warnings);
    process.stderr.write(`Wrote ${out} (version ${meta.version}, level ${meta.errorCorrectionLevel})\n`);
  } else {
    process.stdout.write(`${svg}\n`);
    reportWarnings(meta.warnings);
  }
  return 0;
}

function reportWarnings(warnings: string[]): void {
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

export { FIELDS };
