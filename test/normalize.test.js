'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { binarizeOtsu, binarizeSauvola, removeBackground } = require('../src/normalize/binarize');
const { removeSpeckles, inkBox, thin, dilate, poolMask } = require('../src/normalize/morph');
const { diagram, textPage, canvas, line } = require('./helpers/draw');

const mask = (w, h, ones) => {
  const data = new Uint8Array(w * h);
  for (const i of ones) data[i] = 1;
  return { width: w, height: h, data };
};
const count = (m) => m.data.reduce((a, b) => a + b, 0);

test('Otsu separates ink from paper and reports flat images', () => {
  const c = diagram();
  const t = ic.otsuThreshold(c);
  assert.ok(t >= 0 && t < 255);
  assert.equal(ic.otsuThreshold(canvas(10, 10)), -1);
  assert.equal(count(binarizeOtsu(canvas(10, 10))), 0);
});

test('background removal and Sauvola recover ink on shaded paper', () => {
  const c = textPage();
  const ink = count(binarizeOtsu(c));
  // Darken the paper with a strong left-to-right gradient.
  const shaded = { ...c, data: c.data.map((v, i) => Math.round((v * (140 + (100 * (i % c.width)) / c.width)) / 255)) };
  const flat = removeBackground(shaded);
  const paper = flat.data.filter((v) => v >= 240).length / flat.data.length;
  assert.ok(paper > 0.85, `paper share ${paper}`);
  const s = binarizeSauvola(flat);
  assert.ok(Math.abs(count(s) - ink) / ink < 0.15, `sauvola ${count(s)} vs ${ink}`);
});

test('speckle removal, ink box, thinning, dilation and pooling', () => {
  const m = mask(10, 10, [11, 55, 56, 65, 66]);
  const clean = removeSpeckles(m, 3);
  assert.equal(count(clean), 4);
  assert.deepEqual(inkBox(clean), { x: 5, y: 5, width: 2, height: 2 });
  assert.equal(inkBox(mask(3, 3, [])), null);

  const bar = mask(20, 9, []);
  for (let y = 3; y <= 5; y++) for (let x = 2; x <= 17; x++) bar.data[y * 20 + x] = 1;
  const sk = thin(bar);
  for (let x = 4; x <= 15; x++) assert.equal(sk.data[3 * 20 + x] + sk.data[4 * 20 + x] + sk.data[5 * 20 + x], 1, `column ${x}`);
  assert.equal(count(dilate(mask(5, 5, [12]), 1)), 9);

  // A one-pixel line survives a 4x shrink.
  const big = mask(100, 100, Array.from({ length: 100 }, (_, x) => 37 * 100 + x));
  const small = poolMask(big, 25);
  assert.equal(count(small), 25);
});

test('estimateSkew finds a small rotation of text lines', () => {
  const page = textPage(320, 240);
  for (const angle of [-3, 2.5, 4]) {
    const rotated = ic.rotate(page, angle);
    const est = ic.estimateSkew(binarizeOtsu(rotated));
    assert.ok(Math.abs(est - angle) <= 0.3, `rotated ${angle}, estimated ${est}`);
  }
  assert.equal(ic.estimateSkew(binarizeOtsu(page)), 0);
});

test('lineart output ignores margins exactly', () => {
  const d = diagram(150, 100);
  const padded = ic.pad(d, { top: 30, left: 7, right: 50, bottom: 3 });
  assert.deepEqual(ic.normalize(padded, 'lineart'), ic.normalize(d, 'lineart'));
  const n = ic.normalize(d, 'lineart');
  assert.deepEqual([n.width, n.height, n.channels], [256, 256, 1]);
  assert.ok(n.data.every((v) => v === 0 || v === 255));
});

test('lineart: blank images give a blank square; options are validated', () => {
  const n = ic.normalize(canvas(40, 30), 'lineart', undefined, { details: true });
  assert.equal(n.details.blank, true);
  assert.ok(n.image.data.every((v) => v === 255));
  assert.throws(() => ic.normalize(canvas(4, 4), 'nope'), /unknown preset/);
  assert.throws(() => ic.normalize(canvas(4, 4), 'lineart', { colour: 1 }), /unknown normalise option/);
  const ns = ic.normalize(diagram(), 'lineart', { square: false, size: 64, stroke: 'normalize' });
  assert.deepEqual([ns.width, ns.height], [64, 64]);
});

test('scan preset levels a skewed, shaded page', () => {
  const page = textPage(320, 240);
  const skewed = ic.rotate(page, 3);
  const shaded = { ...skewed, data: skewed.data.map((v) => Math.round(v * 0.82)) };
  const { details } = ic.normalize(shaded, 'scan', undefined, { details: true });
  assert.ok(Math.abs(details.skew - 3) <= 0.3, `skew ${details.skew}`);
  const a = ic.fingerprint(page, { preset: 'scan', methods: ['dhash64'] });
  const b = ic.fingerprint(shaded, { preset: 'scan', methods: ['dhash64'] });
  assert.ok(ic.compare(a, b).dhash64 >= 0.85, `similarity ${ic.compare(a, b).dhash64}`);
});

test('photo preset trims flat borders and limits the size', () => {
  const c = canvas(2000, 1000);
  line(c, 300, 300, 1700, 700, 5);
  const n = ic.normalize(c, 'photo');
  assert.ok(Math.max(n.width, n.height) <= 1024);
  assert.ok(n.width < 800);
});
