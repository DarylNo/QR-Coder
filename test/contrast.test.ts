import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, parseColor } from '../src/style/contrast.js';

test('colour formats resolve to RGB', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#000000'), [0, 0, 0]);
  assert.deepEqual(parseColor('#3366ff'), [51, 102, 255]);
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.deepEqual(parseColor('rgba(10 20 30 / 0.5)'), [10, 20, 30]);
  assert.deepEqual(parseColor('hsl(0, 100%, 50%)'), [255, 0, 0]);
  assert.deepEqual(parseColor('hsl(120 100% 25%)'), [0, 128, 0]);
  assert.deepEqual(parseColor('black'), [0, 0, 0]);
  assert.equal(parseColor('color(display-p3 1 0 0)'), null);
});

test('contrast ratios match the WCAG definition', () => {
  assert.equal(contrastRatio('#000000', '#ffffff')?.toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff')?.toFixed(2), '1.00');
  // Amber on white is the classic "looks great, will not scan" palette.
  assert.ok((contrastRatio('#f59e0b', '#ffffff') ?? 0) < 2.5);
  assert.equal(contrastRatio('not-a-colour-value-here', '#fff'), null);
});
