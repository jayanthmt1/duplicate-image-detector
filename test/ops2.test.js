'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { dsin, dcos, dexp, prng } = require('../src/detmath');
const { gaussianKernel } = require('../src/ops/filter');
const { diagram, canvas, line } = require('./helpers/draw');

const img = (width, height, channels, values) => ({ width, height, channels, data: Uint8Array.from(values) });

test('deterministic sin, cos and exp agree with Math to 1e-12', () => {
  for (let x = -10; x <= 10; x += 0.37) {
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-12, `sin ${x}`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-12, `cos ${x}`);
  }
  for (let x = -20; x <= 3; x += 0.41) assert.ok(Math.abs(dexp(x) - Math.exp(x)) / Math.exp(x) < 1e-12, `exp ${x}`);
  const r = prng(5);
  const first = [r(), r(), r()];
  const r2 = prng(5);
  assert.deepEqual([r2(), r2(), r2()], first);
});

test('crop, pad and padToSquare', () => {
  const src = img(3, 2, 1, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...ic.crop(src, 1, 0, 2, 2).data], [2, 3, 5, 6]);
  assert.throws(() => ic.crop(src, 2, 0, 2, 1), RangeError);
  const p = ic.pad(src, { top: 1, left: 1, background: 9 });
  assert.deepEqual([p.width, p.height], [4, 3]);
  assert.deepEqual([...p.data], [9, 9, 9, 9, 9, 1, 2, 3, 9, 4, 5, 6]);
  const sq = ic.padToSquare(src, 0);
  assert.deepEqual([sq.width, sq.height], [3, 3]);
  assert.deepEqual([...sq.data], [1, 2, 3, 4, 5, 6, 0, 0, 0]);
});

test('rotate: 0 degrees is the identity, 90 degrees matches orientation 6', () => {
  const src = diagram(40, 30);
  assert.deepEqual(ic.rotate(src, 0), src);
  const r = ic.rotate(src, 90);
  const o = ic.applyOrientation(src, 6);
  assert.deepEqual([r.width, r.height], [o.width, o.height]);
  let maxDiff = 0;
  for (let i = 0; i < r.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(r.data[i] - o.data[i]));
  assert.ok(maxDiff <= 1, `max difference ${maxDiff}`);
});

test('rotate by a small angle grows the canvas and fills with background', () => {
  const r = ic.rotate(canvas(100, 50, 0), 10);
  assert.ok(r.width > 100 && r.height > 50);
  assert.equal(r.data[0], 255); // corner is uncovered
  assert.equal(r.data[(r.height >> 1) * r.width + (r.width >> 1)], 0);
});

test('trimBorder removes flat margins', () => {
  const c = canvas(50, 40);
  line(c, 10, 12, 30, 20, 0);
  const t = ic.trimBorder(c, 16);
  assert.deepEqual([t.width, t.height], [21, 9]);
  assert.equal(ic.trimBorder(canvas(5, 5)).width, 5); // all background: unchanged
});

test('Gaussian kernel sums to 2^14 and blur keeps flat images flat', () => {
  for (const s of [0.5, 1, 2.3]) assert.equal(gaussianKernel(s).k.reduce((a, b) => a + b, 0), 1 << 14);
  const flat = ic.gaussianBlur(img(6, 5, 3, new Array(90).fill(77)), 1.5);
  assert.ok(flat.data.every((v) => v === 77));
  const edge = ic.gaussianBlur(img(4, 1, 1, [0, 0, 255, 255]), 1);
  assert.ok(edge.data[1] > 0 && edge.data[2] < 255);
});

test('median removes isolated specks; min and max filters grow and shrink dark strokes', () => {
  const c = canvas(9, 9);
  c.data[40] = 0;
  assert.ok(ic.medianFilter(c, 1).data.every((v) => v === 255));
  assert.ok(ic.medianFilter(c, 2).data.every((v) => v === 255));
  const thick = ic.minFilter(c, 1);
  assert.equal(thick.data.filter((v) => v === 0).length, 9);
  assert.ok(ic.maxFilter(thick, 1).data.filter((v) => v === 0).length === 1);
});
