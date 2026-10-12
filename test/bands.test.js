'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHex(r, nibbles) {
  let s = '';
  for (let i = 0; i < nibbles; i++) s += Math.floor(r() * 16).toString(16);
  return s;
}

function flipBits(hex, positions) {
  const n = hex.split('').map((c) => parseInt(c, 16));
  for (const p of positions) n[p >> 2] ^= 8 >> (p & 3);
  return n.map((v) => v.toString(16)).join('');
}

test('bandKeys splits a 64-bit hash into 4 x 16-bit keys by default', () => {
  assert.deepEqual(ic.bandKeys('a3f109cc12345678'), ['0:a3f1', '1:09cc', '2:1234', '3:5678']);
  assert.deepEqual(ic.bandKeys('a3f109cc12345678', { prefix: 'd64:' })[0], 'd64:0:a3f1');
});

test('bandKeys handles bands that do not fall on hex boundaries', () => {
  // 64 bits in 5 bands: 13, 13, 13, 13, 12 bits.
  const keys = ic.bandKeys('ffffffffffffffff', { bands: 5 });
  assert.deepEqual(keys, ['0:1fff', '1:1fff', '2:1fff', '3:1fff', '4:fff']);
  assert.equal(ic.bandKeys('ffffffffffffffff', { bitsPerBand: 8 }).length, 8);
  assert.equal(ic.bandKeys('ffffffffffffffff', { bitsPerBand: 10 }).length, 7);
  assert.throws(() => ic.bandKeys('ff', { bands: 9 }), RangeError);
  assert.throws(() => ic.bandKeys('ff', { bands: 2, bitsPerBand: 4 }), TypeError);
});

test('pigeonhole: hashes within bands-1 bits always share a band key', () => {
  const r = rng(42);
  for (const bands of [2, 4, 5, 8]) {
    for (let trial = 0; trial < 300; trial++) {
      const a = randomHex(r, 16);
      const flips = new Set();
      const d = Math.floor(r() * bands); // 0 .. bands-1
      while (flips.size < d) flips.add(Math.floor(r() * 64));
      const b = flipBits(a, flips);
      assert.equal(ic.hamming(a, b), d);
      const ka = new Set(ic.bandKeys(a, { bands }));
      assert.ok(ic.bandKeys(b, { bands }).some((k) => ka.has(k)), `bands=${bands} d=${d}`);
    }
  }
});

test('findCommonBands flags keys shared by too many images', () => {
  const r = rng(7);
  const items = [];
  for (let i = 0; i < 1000; i++) items.push(ic.bandKeys(randomHex(r, 16)));
  for (let i = 0; i < 30; i++) items.push(ic.bandKeys('0000000000000000')); // near-blank images
  const common = ic.findCommonBands(items, { maxShare: 0.01 });
  assert.deepEqual(common.map((c) => c.key).sort(), ['0:0000', '1:0000', '2:0000', '3:0000']);
  assert.equal(common[0].count, 30);
  // Works on generators too.
  function* gen() { yield* items; }
  assert.equal(ic.findCommonBands(gen(), { maxShare: 0.01 }).length, 4);
});
