'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { prng } = require('../src/detmath');
const { popcount32 } = require('../src/nearest');

const randomHex = (r, digits) => Array.from({ length: digits }, () => Math.floor(r() * 16).toString(16)).join('');

test('popcount32 counts bits of any 32-bit value', () => {
  for (const [v, n] of [[0, 0], [1, 1], [0xffffffff, 32], [0x80000000, 1], [0x0f0f0f0f, 16], [-1, 32]]) assert.equal(popcount32(v), n);
});

test('nearestByHamming equals a brute-force scan (64 and 256 bits)', () => {
  const r = prng(21);
  for (const digits of [16, 64]) {
    const hashes = Array.from({ length: 500 }, () => randomHex(r, digits));
    for (let t = 0; t < 20; t++) {
      const q = randomHex(r, digits);
      const brute = hashes
        .map((h, i) => ({ index: i, distance: ic.hamming(q, h) }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, 7);
      const got = ic.nearestByHamming(q, hashes, { k: 7 });
      assert.deepEqual(got.map((x) => [x.index, x.distance]), brute.map((x) => [x.index, x.distance]));
      assert.equal(got[0].similarity, 1 - got[0].distance / (digits * 4));
    }
  }
});

test('nearestByHamming: minSimilarity, ids, ties and k', () => {
  const bank = [
    { id: 'x', hash: 'ffffffffffffffff' },
    { id: 'y', hash: 'fffffffffffffff0' }, // 4 bits off
    { id: 'z', hash: 'fffffffffffffff0' }, // same distance as y: earlier position wins
    { id: 'w', hash: '0000000000000000' },
  ];
  const q = 'ffffffffffffffff';
  assert.deepEqual(ic.nearestByHamming(q, bank, { k: 2 }).map((x) => x.id), ['x', 'y']);
  assert.deepEqual(ic.nearestByHamming(q, bank, { k: 10, minSimilarity: 0.9 }).map((x) => x.id), ['x', 'y', 'z']);
  assert.deepEqual(ic.nearestByHamming(q, bank, { minSimilarity: 1 }).map((x) => x.id), ['x']);
  assert.deepEqual(ic.nearestByHamming(q, ['0f', 'ff'].map((h) => h.repeat(8)), { k: 1 })[0], { index: 1, id: 1, distance: 0, similarity: 1 });
  assert.deepEqual(ic.nearestByHamming(q, [], { k: 3 }), []);
});

test('createHammingIndex: reuse for many queries, all pairs, and validation', () => {
  const index = ic.createHammingIndex(['ffffffffffffffff', 'fffffffffffffff0', '0000000000000000']);
  assert.equal(index.size, 3);
  assert.equal(index.bits, 64);
  assert.equal(index.bytes, 24);
  assert.deepEqual(index.pairs({ minSimilarity: 0.9 }), [{ a: 0, b: 1, distance: 4, similarity: 0.9375 }]);
  assert.equal(index.nearest('0000000000000000', { k: 1 })[0].index, 2);
  assert.throws(() => index.nearest('ff'), /64-bit hash/);
  assert.throws(() => ic.createHammingIndex(['ffff', 'ff']), /multiple of 8 hex digits|32-bit hash/);
  assert.throws(() => ic.createHammingIndex(['zzzzzzzzzzzzzzzz']), /invalid hex/);
});

test('real fingerprints: the margin copy is the nearest match', () => {
  const { diagram } = require('./helpers/draw');
  const fp = (img) => ic.fingerprint(img, { preset: 'scan', methods: ['dhash64'] }).dhash64;
  const bank = [0, 1, 2, 3, 4, 5].map((v) => ({ id: `fig${v}`, hash: fp(diagram(160, 120, v)) }));
  const query = fp(ic.pad(diagram(160, 120, 2), { top: 25, right: 12 }));
  assert.equal(ic.nearestByHamming(query, bank, { k: 1 })[0].id, 'fig2');
});
