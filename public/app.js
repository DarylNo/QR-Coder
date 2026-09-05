import { renderSvg } from '/lib/style/render-svg.js';
import { resolveDesign } from '/lib/style/defaults.js';
import { imageToGrid } from '/lib/style/image-grid.js';
import { CORNER_SQUARE_TYPES, DOT_TYPES } from '/lib/style/types.js';
import { PRESETS } from '/lib/presets.js';

const AUTO = '';
const GRADIENT_GROUPS = ['dots', 'cornersSquare', 'background'];
const FINDER_CORNERS = ['top-left', 'top-right', 'bottom-left'];

const stage = document.getElementById('stage');
const metaList = document.getElementById('meta');
const warningsBox = document.getElementById('warnings');
const toast = document.getElementById('toast');

/** Paths the user has explicitly set; everything else inherits its default. */
const touched = new Set();
/** Gradient stops per group, kept outside the DOM so they can be reordered. */
const gradientStops = {
  dots: [{ offset: 0, color: '#f97316' }, { offset: 1, color: '#db2777' }],
  cornersSquare: [{ offset: 0, color: '#1d4ed8' }, { offset: 1, color: '#0f172a' }],
  background: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#e2e8f0' }],
};
let logoSrc = '';
/** Source image and traced module grid for a `grid` emblem. */
let emblemSource = '';
let emblemGrid = [];
let lastRender = null;

/* ------------------------------------------------------------------ setup */

function fillSelect(select, values, { auto = true, autoLabel = 'auto' } = {}) {
  select.replaceChildren();
  if (auto) select.append(new Option(autoLabel, AUTO));
  for (const value of values) select.append(new Option(String(value), String(value)));
}

fillSelect(document.querySelector('[data-path="dots.type"]'), DOT_TYPES, { auto: false });
fillSelect(document.querySelector('[data-path="cornersSquare.type"]'), CORNER_SQUARE_TYPES, { autoLabel: 'match modules' });
fillSelect(document.querySelector('[data-path="cornersDot.type"]'), DOT_TYPES, { autoLabel: 'match modules' });
fillSelect(document.querySelector('[data-path="alignment.type"]'), ['as-data', ...CORNER_SQUARE_TYPES], { autoLabel: 'auto' });
fillSelect(document.querySelector('[data-path="alignment.centerType"]'), DOT_TYPES, { autoLabel: 'auto' });
fillSelect(document.querySelector('[data-path="emblem.dotType"]'), DOT_TYPES, { autoLabel: 'match modules' });
fillSelect(
  document.querySelector('[data-path="encoding.version"]'),
  Array.from({ length: 40 }, (_, index) => index + 1),
  { autoLabel: 'auto (smallest)' },
);
fillSelect(
  document.querySelector('[data-path="encoding.mask"]'),
  Array.from({ length: 8 }, (_, index) => index),
  { autoLabel: 'auto (best)' },
);

for (const group of GRADIENT_GROUPS) renderStops(group);
renderPerCornerControls();
renderPresetButtons();

/** Form state at load, so Reset and preset switching can start from scratch. */
const initialValues = new Map(
  [...document.querySelectorAll('[data-path]')].map((input) => [
    input,
    input.type === 'checkbox' ? input.checked : input.value,
  ]),
);

/* ------------------------------------------------------- design assembly */

function setPath(target, path, value) {
  const segments = path.split('.');
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    node[segment] ??= {};
    node = node[segment];
  }
  node[segments.at(-1)] = value;
}

function readInput(input) {
  const kind = input.dataset.kind;
  if (kind === 'boolean') return input.checked;
  const raw = input.value;
  if (raw === AUTO && (kind === 'numberOrAuto' || kind === 'stringOrAuto' || input.tagName === 'SELECT')) {
    return undefined;
  }
  if (kind === 'number') return Number(raw);
  if (kind === 'numberOrAuto') return Number(raw);
  if (raw === '') return undefined;
  return raw;
}

function collectDesign() {
  const design = { data: document.getElementById('data').value };

  for (const input of document.querySelectorAll('[data-path]')) {
    const path = input.dataset.path;
    // Colours are inherited from the module colour until the user picks one.
    if (input.type === 'color' && !touched.has(path)) continue;
    const value = readInput(input);
    if (value === undefined) continue;
    setPath(design, path, value);
  }

  for (const group of GRADIENT_GROUPS) {
    const enabled = document.querySelector(`[data-gradient-toggle="${group}"]`).checked;
    if (!enabled) {
      if (design[group]) delete design[group].gradient;
      continue;
    }
    setPath(design, `${group}.gradient.colorStops`, gradientStops[group].map((stop) => ({ ...stop })));
  }

  if (document.getElementById('transparent-background').checked) {
    setPath(design, 'background.color', 'none');
  }

  if (logoSrc) {
    setPath(design, 'image.src', logoSrc);
    setPath(
      design,
      'image.background',
      document.getElementById('logo-plate-on').checked ? document.getElementById('logo-plate').value : 'none',
    );
  } else {
    delete design.image;
  }

  if (document.getElementById('emblem-on').checked) {
    if (design.emblem?.shape === 'grid') {
      if (emblemGrid.length) design.emblem.grid = emblemGrid;
      else delete design.emblem.shape; // Fall back to the default shape until an image is traced.
    }
  } else {
    delete design.emblem;
  }

  if (!design.caption?.text) delete design.caption;

  if (document.getElementById('per-corner-toggle').checked) {
    for (const corner of FINDER_CORNERS) {
      const shape = document.querySelector(`[data-corner-type="${corner}"]`);
      const color = document.querySelector(`[data-corner-color="${corner}"]`);
      const override = {};
      if (shape.value) override.type = shape.value;
      if (color.dataset.touched === 'true') override.color = color.value;
      if (Object.keys(override).length) setPath(design, `cornersSquare.corners.${corner}`, override);
    }
  }

  return design;
}

/* ------------------------------------------------------------- rendering */

let frame = 0;
function scheduleRender() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}

function render() {
  for (const output of document.querySelectorAll('[data-output]')) {
    const input = document.querySelector(`[data-path="${output.dataset.output}"]`);
    if (input) output.textContent = input.value;
  }
  for (const element of document.querySelectorAll('[data-visible-when]')) {
    const [path, expected] = element.dataset.visibleWhen.split('=');
    const input = document.querySelector(`[data-path="${path}"]`);
    element.hidden = !input || input.value !== expected;
  }

  const design = collectDesign();
  try {
    const result = renderSvg(design);
    lastRender = { design, ...result };
    stage.classList.remove('error');
    stage.innerHTML = result.svg;
    showMeta(result.meta);
    showWarnings(result.meta.warnings);
    syncInheritedColors(design);
    updateApiSample(design);
  } catch (error) {
    stage.classList.add('error');
    stage.innerHTML = '';
    const box = document.createElement('p');
    box.className = 'stage-error';
    box.textContent = error instanceof Error ? error.message : String(error);
    stage.append(box);
    warningsBox.hidden = true;
  }
}

function showMeta(meta) {
  const entries = [
    ['Version', meta.version],
    ['Level', meta.errorCorrectionLevel],
    ['Mask', meta.mask],
    ['Modules', `${meta.moduleCount}×${meta.moduleCount}`],
    ['Mode', meta.mode],
    ['Module px', meta.modulePixelSize.toFixed(1)],
    ['Repair used', `${meta.errorBudget.worstBlockDamage}/${meta.errorBudget.correctablePerBlock}`],
  ];
  metaList.replaceChildren(
    ...entries.map(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = String(value);
      wrapper.append(term, detail);
      return wrapper;
    }),
  );
}

function showWarnings(warnings) {
  warningsBox.hidden = warnings.length === 0;
  warningsBox.replaceChildren(
    ...warnings.map((warning) => {
      const line = document.createElement('p');
      line.style.margin = '0';
      line.textContent = warning;
      return line;
    }),
  );
}

/** Show inherited colours in their swatches without treating them as explicit. */
function syncInheritedColors(design) {
  let resolved;
  try {
    resolved = resolveDesign(design);
  } catch {
    return;
  }
  const inherited = [
    ['cornersSquare.color', resolved.cornersSquare.color],
    ['cornersDot.color', resolved.cornersDot.color],
    ['alignment.color', resolved.alignment.color],
    ['caption.color', resolved.caption.color],
  ];
  for (const [path, value] of inherited) {
    if (touched.has(path)) continue;
    const input = document.querySelector(`[data-path="${path}"]`);
    if (input && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
  }
}

/* --------------------------------------------------------------- widgets */

function renderStops(group) {
  const container = document.querySelector(`[data-stops="${group}"]`);
  container.replaceChildren();
  gradientStops[group].forEach((stop, index) => {
    const row = document.createElement('div');
    row.className = 'stop-row';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = stop.color;
    color.addEventListener('input', () => {
      gradientStops[group][index].color = color.value;
      scheduleRender();
    });

    const offset = document.createElement('input');
    offset.type = 'range';
    offset.min = '0';
    offset.max = '1';
    offset.step = '0.01';
    offset.value = String(stop.offset);
    offset.setAttribute('aria-label', `Stop ${index + 1} position`);
    offset.addEventListener('input', () => {
      gradientStops[group][index].offset = Number(offset.value);
      scheduleRender();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost';
    remove.textContent = '−';
    remove.title = 'Remove this stop';
    remove.disabled = gradientStops[group].length <= 2;
    remove.addEventListener('click', () => {
      gradientStops[group].splice(index, 1);
      renderStops(group);
      scheduleRender();
    });

    row.append(color, offset, remove);
    container.append(row);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ghost';
  add.textContent = '+ Add stop';
  add.disabled = gradientStops[group].length >= 12;
  add.addEventListener('click', () => {
    gradientStops[group].push({ offset: 0.5, color: '#38bdf8' });
    renderStops(group);
    scheduleRender();
  });
  container.append(add);
}

function renderPerCornerControls() {
  const body = document.getElementById('per-corner-body');
  body.replaceChildren();
  for (const corner of FINDER_CORNERS) {
    const row = document.createElement('div');
    row.className = 'corner-row';

    const label = document.createElement('span');
    label.textContent = corner.replace('-', ' ');

    const shape = document.createElement('select');
    shape.dataset.cornerType = corner;
    fillSelect(shape, CORNER_SQUARE_TYPES, { autoLabel: 'inherit' });
    shape.addEventListener('input', scheduleRender);

    const color = document.createElement('input');
    color.type = 'color';
    color.value = '#0f172a';
    color.dataset.cornerColor = corner;
    color.dataset.touched = 'false';
    color.addEventListener('input', () => {
      color.dataset.touched = 'true';
      scheduleRender();
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ghost';
    clear.textContent = '↺';
    clear.title = 'Inherit the shared colour again';
    clear.addEventListener('click', () => {
      color.dataset.touched = 'false';
      shape.value = AUTO;
      scheduleRender();
    });

    row.append(label, shape, color, clear);
    body.append(row);
  }
}

function renderPresetButtons() {
  const container = document.getElementById('presets');
  container.replaceChildren();
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.name;
    button.title = preset.description;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      for (const other of container.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      applyPreset(preset.design);
    });
    container.append(button);
  }
}

function resetForm() {
  for (const [input, value] of initialValues) {
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  touched.clear();
  for (const color of document.querySelectorAll('[data-corner-color]')) color.dataset.touched = 'false';
  for (const shape of document.querySelectorAll('[data-corner-type]')) shape.value = AUTO;
  for (const group of GRADIENT_GROUPS) {
    document.querySelector(`[data-gradient-toggle="${group}"]`).checked = false;
    document.querySelector(`[data-gradient="${group}"] .gradient-body`).hidden = true;
  }
  document.getElementById('per-corner-toggle').checked = false;
  document.getElementById('per-corner-body').hidden = true;
  document.getElementById('emblem-on').checked = false;
}

/** Load a preset's values into the controls so they stay editable. */
function applyPreset(design) {
  resetForm();
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key === 'colorStops' && Array.isArray(value)) {
        const group = prefix.split('.')[0];
        gradientStops[group] = value.map((stop) => ({ ...stop }));
        document.querySelector(`[data-gradient-toggle="${group}"]`).checked = true;
        document.querySelector(`[data-gradient="${group}"] .gradient-body`).hidden = false;
        renderStops(group);
        continue;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path);
        continue;
      }
      if (prefix === 'emblem') document.getElementById('emblem-on').checked = true;
      const input = document.querySelector(`[data-path="${path}"]`);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
      touched.add(path);
      if (path === 'background.color' && value === 'none') {
        document.getElementById('transparent-background').checked = true;
      }
    }
  };
  walk(design, '');
  scheduleRender();
}

/* --------------------------------------------------------------- exports */

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function toPngBlob(svg, width, height, scale) {
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The browser could not rasterize this design.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function flattenForQuery(design, prefix = '', params = new URLSearchParams()) {
  for (const [key, value] of Object.entries(design)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === 'colorStops' && Array.isArray(value)) {
      params.set(path, value.map((stop) => `${stop.offset}:${stop.color}`).join(','));
    } else if (key === 'grid' && Array.isArray(value)) {
      params.set(path, value.join('|'));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenForQuery(value, path, params);
    } else if (value !== undefined) {
      params.set(path, String(value));
    }
  }
  return params;
}

function updateApiSample(design) {
  const body = JSON.stringify(design, null, 2);
  document.getElementById('api-sample').textContent =
    `# HTTP\ncurl -X POST ${location.origin}/api/qr \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}' > qr.svg\n\n` +
    `// Node\nimport { renderSvg } from 'qr-coder';\nconst { svg, meta } = renderSvg(${body});`;
}

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    notify(message);
  } catch {
    notify('Copying needs clipboard permission in this browser.');
  }
}

/* ---------------------------------------------------------------- events */

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset?.path) touched.add(target.dataset.path);
  if (target.closest('.controls') || target.id === 'data') scheduleRender();
});

for (const group of GRADIENT_GROUPS) {
  const toggle = document.querySelector(`[data-gradient-toggle="${group}"]`);
  toggle.addEventListener('change', () => {
    document.querySelector(`[data-gradient="${group}"] .gradient-body`).hidden = !toggle.checked;
    scheduleRender();
  });
}

const perCornerToggle = document.getElementById('per-corner-toggle');
perCornerToggle.addEventListener('change', () => {
  document.getElementById('per-corner-body').hidden = !perCornerToggle.checked;
  scheduleRender();
});

const emblemToggle = document.getElementById('emblem-on');
emblemToggle.addEventListener('change', () => {
  // Without an explicit colour the emblem inherits the module colour, which
  // would make a tinted one invisible; start from the swatch's own value.
  if (emblemToggle.checked) touched.add('emblem.color');
  scheduleRender();
});

async function traceEmblem() {
  if (!emblemSource) return;
  const detail = Number(document.getElementById('emblem-detail').value);
  try {
    emblemGrid = await imageToGrid(emblemSource, {
      modules: detail,
      invert: document.getElementById('emblem-invert').checked,
    });
  } catch (error) {
    emblemGrid = [];
    notify(error instanceof Error ? error.message : 'The image could not be traced.');
  }
  const preview = document.getElementById('emblem-preview');
  preview.hidden = emblemGrid.length === 0;
  preview.textContent = emblemGrid.join('\n');
  scheduleRender();
}

document.getElementById('emblem-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    emblemSource = String(reader.result);
    emblemToggle.checked = true;
    touched.add('emblem.color');
    document.querySelector('[data-path="emblem.shape"]').value = 'grid';
    document.querySelector('[data-path="emblem.style"]').value = 'ink';
    touched.add('emblem.shape');
    touched.add('emblem.style');

    // An inked shape spends error correction, and the default level rarely has
    // enough to spare. Raise it once, visibly, rather than rendering something
    // that cannot be scanned.
    const level = document.querySelector('[data-path="encoding.errorCorrectionLevel"]');
    if (level.value === 'L' || level.value === 'M') {
      level.value = 'H';
      touched.add('encoding.errorCorrectionLevel');
      notify('Raised error correction to H so the traced shape still scans.');
    }
    await traceEmblem();
  };
  reader.readAsDataURL(file);
});

document.getElementById('emblem-detail').addEventListener('input', (event) => {
  document.getElementById('emblem-detail-out').textContent = event.target.value;
  traceEmblem();
});
document.getElementById('emblem-invert').addEventListener('change', traceEmblem);

document.getElementById('logo-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    notify('Pick an image under 1.5 MB — it is embedded directly in the QR code.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    logoSrc = String(reader.result);
    document.getElementById('logo-url').value = '';
    scheduleRender();
  };
  reader.readAsDataURL(file);
});

document.getElementById('logo-url').addEventListener('input', (event) => {
  logoSrc = event.target.value.trim();
  scheduleRender();
});

document.getElementById('logo-clear').addEventListener('click', () => {
  logoSrc = '';
  document.getElementById('logo-file').value = '';
  document.getElementById('logo-url').value = '';
  scheduleRender();
});

document.getElementById('download-svg').addEventListener('click', () => {
  if (!lastRender) return;
  download(new Blob([lastRender.svg], { type: 'image/svg+xml' }), 'qr-code.svg');
});

document.getElementById('download-png').addEventListener('click', async () => {
  if (!lastRender) return;
  const scale = Number(document.getElementById('png-scale').value);
  const { meta, svg, design } = lastRender;
  try {
    download(await toPngBlob(svg, meta.width, meta.height, scale), 'qr-code.png');
  } catch {
    // A remote logo taints the canvas; fall back to rendering on the server.
    const response = await fetch(`/api/qr?format=png&scale=${scale}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(design),
    });
    if (!response.ok) {
      notify('PNG export failed. Download the SVG instead.');
      return;
    }
    download(await response.blob(), 'qr-code.png');
  }
});

document.getElementById('copy-svg').addEventListener('click', () => {
  if (lastRender) copy(lastRender.svg, 'SVG copied to the clipboard.');
});

document.getElementById('copy-json').addEventListener('click', () => {
  if (lastRender) copy(JSON.stringify(lastRender.design, null, 2), 'Design JSON copied.');
});

document.getElementById('copy-curl').addEventListener('click', () => {
  if (!lastRender) return;
  const body = JSON.stringify(lastRender.design);
  copy(
    `curl -X POST ${location.origin}/api/qr -H 'Content-Type: application/json' -d '${body}' > qr.svg`,
    'cURL command copied.',
  );
});

document.getElementById('copy-url').addEventListener('click', () => {
  if (!lastRender) return;
  const design = structuredClone(lastRender.design);
  let note = 'Image URL copied.';
  if (design.image?.src?.startsWith('data:') && design.image.src.length > 1200) {
    delete design.image;
    note = 'Image URL copied — the uploaded logo was left out because it is too large for a URL.';
  }
  copy(`${location.origin}/api/qr?${flattenForQuery(design)}`, note);
});

document.getElementById('reset').addEventListener('click', () => {
  resetForm();
  logoSrc = '';
  emblemSource = '';
  emblemGrid = [];
  document.getElementById('emblem-file').value = '';
  document.getElementById('emblem-preview').hidden = true;
  document.getElementById('logo-file').value = '';
  document.getElementById('logo-url').value = '';
  for (const button of document.querySelectorAll('.presets button')) button.setAttribute('aria-pressed', 'false');
  scheduleRender();
});

render();
