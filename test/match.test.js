'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { diagram } = require('./helpers/draw');

// A fingerprint with chosen hashes, so tiers can be tested at exact bit distances.
const flip = (hex, nBits) => {
  const v = hex.split('').map((c) => parseInt(c, 16));
  for (let i = 0; i < nBits; i++) v[i >> 2] ^= 8 >> (i & 3);
  return v.map((x) => x.toString(16)).join('');
};
const BASE_D = '0123456789abcdef';
const BASE_A = 'fedcba9876543210';
const fp = (over = {}) => ({ v: ic.FINGERPRINT_VERSION, preset: 'scan', w: 10, h: 10, pixelSha: 'p0', dhash64: BASE_D, ahash64: BASE_A, ...over });

test('classifyMatch: tiers follow the default thresholds', () => {
  const a = fp();
  assert.equal(ic.classifyMatch(a, fp()).tier, 'exact');
  assert.deepEqual(ic.classifyMatch(a, fp()).reasons, ['identical pixels (pixelSha)']);
  // likely: dhash64 >= 0.80 means at most 12 of 64 bits differ.
  assert.equal(ic.classifyMatch(a, fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 12) })).tier, 'likely');
  assert.equal(ic.classifyMatch(a, fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 13) })).tier, 'possible');
  // possible via dhash64 >= 0.72 (at most 17 bits) or ahash64 >= 0.75 (at most 16 bits).
  assert.equal(ic.classifyMatch(a, fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 17), ahash64: flip(BASE_A, 40) })).tier, 'possible');
  const viaA = ic.classifyMatch(a, fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 30), ahash64: flip(BASE_A, 16) }));
  assert.equal(viaA.tier, 'possible');
  assert.match(viaA.reasons[0], /^ahash64 0\.75 \(48\/64 bits agree\) >= possible 0\.75$/);
  const none = ic.classifyMatch(a, fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 18), ahash64: flip(BASE_A, 17) }));
  assert.equal(none.tier, 'none');
  assert.equal(none.reasons.length, 2);
  assert.equal(none.scores.dhash64, 1 - 18 / 64);
});

test('classifyMatch: custom thresholds, presets, missing hashes, versions', () => {
  const a = fp();
  const b = fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 15) });
  assert.equal(ic.classifyMatch(a, b).tier, 'possible');
  assert.equal(ic.classifyMatch(a, b, { thresholds: { likely: { dhash64: 0.75 } } }).tier, 'likely');
  const other = ic.classifyMatch(a, { ...b, preset: 'lineart' });
  assert.equal(other.tier, 'none');
  assert.match(other.reasons[0], /different presets/);
  assert.equal(ic.classifyMatch(a, { ...b, preset: 'lineart', pixelSha: 'p0' }).tier, 'exact'); // pixels work across presets
  assert.match(ic.classifyMatch({ v: 1, preset: 'scan', pixelSha: 'x' }, { v: 1, preset: 'scan', pixelSha: 'y' }).reasons[0], /no dhash64 or ahash64/);
  assert.throws(() => ic.classifyMatch(a, { ...b, v: 99 }), /versions differ/);
  assert.throws(() => ic.classifyMatch(a, b, { thresholds: { likely: { phash64: 0.9 } } }), /only dhash64 and ahash64/);
  assert.throws(() => ic.classifyMatch(a, b, { thresholds: { possible: { dhash64: 2 } } }), RangeError);
  assert.deepEqual(ic.TIERS, ['exact', 'likely', 'possible', 'none']);
});

test('createMatchIndex: exact first, then likely, then possible; k and minTier', () => {
  const index = ic.createMatchIndex();
  index.add('exact', fp());
  index.add('likely', fp({ pixelSha: 'p1', dhash64: flip(BASE_D, 4) }));
  index.add('likely2', fp({ pixelSha: 'p2', dhash64: flip(BASE_D, 10) }));
  index.add('possible', fp({ pixelSha: 'p3', dhash64: flip(BASE_D, 40), ahash64: flip(BASE_A, 10) }));
  index.add('far', fp({ pixelSha: 'p4', dhash64: flip(BASE_D, 40), ahash64: flip(BASE_A, 40) }));
  assert.equal(index.size, 5);
  assert.equal(index.preset, 'scan');
  const res = index.query(fp());
  assert.deepEqual(res.map((r) => [r.id, r.tier]), [['exact', 'exact'], ['likely', 'likely'], ['likely2', 'likely'], ['possible', 'possible']]);
  assert.deepEqual(index.query(fp(), { k: 2 }).map((r) => r.id), ['exact', 'likely']);
  assert.deepEqual(index.query(fp(), { minTier: 'likely' }).map((r) => r.id), ['exact', 'likely', 'likely2']);
  assert.deepEqual(index.query(fp(), { minTier: 'exact' }).map((r) => r.id), ['exact']);
  assert.deepEqual(index.query(fp(), { excludeId: 'exact', k: 1 }).map((r) => r.id), ['likely']);
  assert.throws(() => index.query(fp(), { minTier: 'none' }), /minTier/);
});

test('createMatchIndex: add replaces, remove, addMany, preset lock and validation', () => {
  const index = ic.createMatchIndex();
  index.addMany([{ id: 1, fp: fp() }, [2, fp({ pixelSha: 'p2' })]]);
  assert.equal(index.size, 2);
  assert.equal(index.query(fp())[0].id, 1);
  index.add(1, fp({ pixelSha: 'p9', dhash64: flip(BASE_D, 50), ahash64: flip(BASE_A, 50) })); // replace
  assert.equal(index.size, 2);
  assert.deepEqual(index.query(fp()).map((r) => r.id), [2]);
  assert.equal(index.remove(2), true);
  assert.equal(index.remove(2), false);
  assert.equal(index.has(2), false);
  assert.deepEqual(index.query(fp()), []);
  assert.throws(() => index.add(3, fp({ preset: 'lineart' })), /one preset for the whole collection/);
  assert.throws(() => index.add(undefined, fp()), /id is required/);
  assert.throws(() => index.add(4, { ...fp(), v: 2 }), /version/);
  assert.throws(() => index.add(5, { v: 1, preset: 'scan' }), /needs pixelSha and dhash64/);
  const { add } = index; // methods work when destructured
  add(6, fp({ pixelSha: 'p6' }));
  assert.equal(index.size, 2);
});

test('createMatchIndex with real fingerprints: a padded copy is found, a different figure ranks lower', () => {
  const make = (img) => ic.fingerprint(img, { preset: 'scan', methods: ['pixelSha', 'dhash64', 'ahash64'] });
  const index = ic.createMatchIndex();
  for (let v = 0; v < 6; v++) index.add(`fig${v}`, make(diagram(160, 120, v)));
  const res = index.query(make(ic.pad(diagram(160, 120, 2), { top: 25, right: 12 })));
  assert.equal(res[0].id, 'fig2');
  assert.equal(res[0].scores.dhash64, 1);
});

test('Hamming index: add grows, remove hides, within returns all matches', () => {
  const index = ic.createHammingIndex([], { bits: 64 });
  assert.equal(index.size, 0);
  for (let i = 0; i < 40; i++) index.add({ id: `h${i}`, hash: flip(BASE_D, i) });
  assert.equal(index.size, 40);
  assert.deepEqual(index.within(BASE_D, 1 - 3 / 64).map((m) => m.id), ['h0', 'h1', 'h2', 'h3']);
  assert.equal(index.remove('h1'), 1);
  assert.equal(index.size, 39);
  assert.deepEqual(index.nearest(BASE_D, { k: 3 }).map((m) => m.id), ['h0', 'h2', 'h3']);
  assert.deepEqual(index.pairs({ minSimilarity: 1 - 1 / 64 }).map((p) => [p.a, p.b]).slice(0, 2), [['h2', 'h3'], ['h3', 'h4']]);
  assert.throws(() => index.within(BASE_D), /needs a similarity/);
  assert.throws(() => ic.createHammingIndex([], { bits: 60 }), /multiple of 32/);
  const lazy = ic.createHammingIndex();
  lazy.add('ffffffffffffffffffffffffffffffff'); // width taken from the first hash: 128 bits
  assert.equal(lazy.bits, 128);
});

test('groupDuplicates and findDuplicates clusters', () => {
  assert.deepEqual(ic.groupDuplicates([{ a: 'b', b: 'c' }, ['c', 'd'], ['x', 'y']], [['a', 'b']]), [['a', 'b', 'c', 'd'], ['x', 'y']]);
  assert.deepEqual(ic.groupDuplicates([]), []);
  const items = [
    { id: 'a', fp: fp() },
    { id: 'a2', fp: fp() },
    { id: 'b', fp: fp({ pixelSha: 'pb', dhash64: flip(BASE_D, 2) }) },
    { id: 'z', fp: fp({ pixelSha: 'pz', dhash64: flip(BASE_D, 40) }) },
  ];
  const res = ic.findDuplicates(items, { threshold: 0.9 });
  assert.deepEqual(res.exact, [['a', 'a2']]);
  assert.deepEqual(res.clusters, [['a', 'a2', 'b']]);
});
