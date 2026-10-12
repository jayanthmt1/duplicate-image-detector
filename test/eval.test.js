'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { pickThreshold } = require('../src/eval/evaluate');
const { diagram } = require('./helpers/draw');

test('pickThreshold allows at most rate * n false matches, as low as possible', () => {
  const neg = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
  const all = [...neg, 0.92, 1];
  assert.equal(pickThreshold(neg, all, 0), 1); // above every negative
  assert.equal(pickThreshold(neg, all, 0.1), 0.92); // one negative (0.95) may match
  assert.equal(pickThreshold(neg, all, 0.2), 0.9);
  // Ties: three negatives at 0.5 cannot be split.
  assert.equal(pickThreshold([0.5, 0.5, 0.5, 0.1], [0.5, 0.5, 0.5, 0.1, 0.7], 0.25), 0.7);
  assert.equal(pickThreshold([0.5], [0.5], 0), Infinity);
});

test('variants are seeded and cover every kind', () => {
  const d = diagram(120, 90);
  const a = ic.variants(d, { seed: 3 });
  const b = ic.variants(d, { seed: 3 });
  assert.deepEqual(a.map((v) => v.kind), ic.VARIANT_KINDS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(ic.variants(d, { seed: 4 }).find((v) => v.kind === 'noise'), a.find((v) => v.kind === 'noise'));
  for (const v of a) assert.ok(v.image.width > 10 && v.image.height > 10, v.kind);
  assert.throws(() => ic.makeVariant(d, 'sepia'), /unknown variant/);
  // "thinner" keeps the strokes (they do not vanish).
  const thin = a.find((v) => v.kind === 'thinner').image;
  assert.ok(thin.data.some((v) => v < 64));
});

test('evaluate: end to end on synthetic diagrams', () => {
  const originals = Array.from({ length: 6 }, (_, i) => diagram(140, 100, i));
  const set = ic.makeEvalSet(originals, { kinds: ['margin', 'resize-down', 'noise'], randomPairs: 60 });
  assert.equal(set.same.length, 18);
  assert.equal(set.random.length, 60);
  const res = ic.evaluate(set, { presets: ['none', 'lineart'], methods: ['pixelSha', 'dhash64', 'ink16'], imageMethods: ['ssim'] });
  assert.deepEqual(res.counts, { same: 18, different: 0, random: 60 });
  assert.equal(res.calibrateOn, 'random');
  assert.equal(res.results.length, 2 * 4);
  for (const r of res.results) {
    assert.ok(r.recall >= 0 && r.recall <= 1);
    assert.ok(r.falseMatches.random.rate <= 0.01 + 1e-9, `${r.method}/${r.preset}`);
    assert.equal(r.table.length, 7);
    assert.deepEqual(Object.keys(r.byKind).sort(), ['margin', 'noise', 'resize-down']);
  }
  const lineDhash = res.results.find((r) => r.method === 'dhash64' && r.preset === 'lineart');
  assert.equal(lineDhash.byKind.margin.matched, 6, 'lineart trims margins away');
  const report = ic.formatReport(res);
  assert.match(report, /same matched/);
  assert.match(report, /by variant kind/);
});

test('evaluate accepts precomputed fingerprints and plain [a, b] pairs', () => {
  const fp = (i) => ic.fingerprint(diagram(100, 80, i), { methods: ['dhash64'] });
  const same = [[fp(0), fp(0)], [fp(1), fp(1)]];
  const random = [[fp(0), fp(1)], [fp(1), fp(2)], [fp(2), fp(3)]];
  const res = ic.evaluate({ same, random }, { methods: ['dhash64'] });
  assert.equal(res.results[0].recall, 1);
  assert.throws(() => ic.evaluate({ same: [] }), /at least one/);
  assert.throws(() => ic.evaluate({ same }), /no "different" pairs/);
});
