'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { fixture } = require('./helpers/util');
const { diagram, canvas } = require('./helpers/draw');

test('ahash64 and phash64: flat images, self similarity, robustness to resizing', () => {
  const flat = canvas(20, 20, 128);
  assert.equal(ic.ahash64(flat), '0000000000000000');
  const d = diagram(200, 150);
  const small = ic.resize(d, 120, 90);
  for (const h of [ic.ahash64, ic.phash64]) {
    assert.match(h(d), /^[0-9a-f]{16}$/);
    assert.ok(ic.hammingSimilarity(h(d), h(small)) >= 0.9, h.name);
    assert.ok(ic.hammingSimilarity(h(d), h(diagram(200, 150, 3))) < 0.9, `${h.name} different drawing`);
  }
});

test('phash64 sets 32 of 64 bits when coefficients are distinct', () => {
  const bits = ic.hamming(ic.phash64(diagram(200, 150)), '0000000000000000');
  assert.ok(bits >= 28 && bits <= 32, `${bits}`);
});

test('goldberg signature: 648 values packed to 432 hex digits, similar for similar images', () => {
  const d = diagram(200, 150);
  const g = ic.goldberg(d);
  assert.equal(g.length, 432);
  assert.equal(ic.goldbergSimilarity(g, g), 1);
  const blurred = ic.goldberg(ic.gaussianBlur(d, 1));
  const other = ic.goldberg(diagram(200, 150, 4));
  assert.ok(ic.goldbergSimilarity(g, blurred) > ic.goldbergSimilarity(g, other));
  // A blank image has every value 0, stored as 2: each byte is 2*25 + 2*5 + 2 = 62 = 0x3e.
  assert.equal(ic.goldberg(canvas(30, 30)), '3e'.repeat(216));
});

test('ink grid and ink map', () => {
  const d = diagram(160, 120);
  const g = ic.inkGrid(d, 16);
  assert.equal(g.length, 512);
  assert.equal(ic.inkGrid(canvas(10, 10), 4), '00'.repeat(16));
  assert.equal(ic.inkGridSimilarity(g, g), 1);
  const m = ic.inkMap(d);
  assert.equal(m.length, 256);
  assert.equal(ic.inkOverlap(m, m), 1);
  assert.equal(ic.inkOverlap('0'.repeat(256), '0'.repeat(256)), 1);
  assert.equal(ic.inkOverlap(m, '0'.repeat(256)), 0);
  // One cell shift is forgiven with tolerance 1, not with tolerance 0.
  const a = '8' + '0'.repeat(255);
  const b = '4' + '0'.repeat(255);
  assert.equal(ic.inkOverlap(a, b, 1), 1);
  assert.equal(ic.inkOverlap(a, b, 0), 0);
});

test('ssim is 1 for identical images and lower for different ones', () => {
  const d = diagram();
  assert.ok(Math.abs(ic.ssim(d, d) - 1) < 1e-12);
  assert.ok(ic.ssim(d, diagram(160, 120, 3)) < 0.9);
});

test('fingerprint with every method and preset', () => {
  const buf = fixture('same-gray8.png');
  for (const preset of ic.PRESETS) {
    const fp = ic.fingerprint(buf, { preset, methods: ic.METHODS });
    for (const m of ic.METHODS) assert.ok(typeof fp[m] === 'string' && fp[m].length > 0, `${preset} ${m}`);
    const c = ic.compare(fp, fp);
    for (const m of ic.METHODS) assert.ok(c[m] === true || c[m] === 1, `${preset} ${m} self-compare`);
  }
  const custom = ic.fingerprint(buf, { preset: 'lineart', normalize: { stroke: 'normalize', size: 128 }, methods: ['dhash64'] });
  assert.equal(custom.preset, 'lineart(size=128,stroke=normalize)');
  const plain = ic.fingerprint(buf, { preset: 'lineart', methods: ['dhash64'] });
  assert.equal(ic.compare(custom, plain).dhash64, null);
});

// The methods that existed at milestone 2 (later methods are pinned separately below).
const M2_METHODS = ['fileSha', 'pixelSha', 'ahash64', 'dhash64', 'dhash256', 'phash64', 'goldberg', 'ink16', 'inkmap32'];

// Pinned digests of complete fingerprints (all M2 methods) per preset. If one changes, an output
// changed: bump FINGERPRINT_VERSION (or, before any release, update the digest deliberately).
test('golden fingerprints for every preset and method (version 1)', () => {
  const { sha } = require('./helpers/util');
  const golden = {
    'same-gray8.png none': '56e120c9a9c5eddedd173edf542073523e3970476f5d9977d6cdaa048a23a7f0',
    'same-gray8.png photo': '8a3aa13a0e60af5d676bb9001434bb0b71ed21198d547bfdef60ee490ee8e0f8',
    'same-gray8.png lineart': '6dd2dec18d5cc5cd0e545ba08d8e0a25c1fd0dde99d5b05c89b8a69e49f83f7e',
    'same-gray8.png scan': 'b84e828c59af4b16d7427e4175d5219f5f54b64b285544f0fb2fc1435a31002a',
    'photo420.jpg none': 'c69fda89ca5ae475f4e952ed16beb0db712cda047d1eefee5a5fe0ac6ddb4a24',
    'photo420.jpg photo': '77c52072945430795f05934cee8a479a918ca269c6ca8a4fa51919fd618030d8',
    'photo420.jpg lineart': '42d9edbc9a9f8f0c87a68e01747fa269e2778c6e81e54e302d54130129abb09a',
    'photo420.jpg scan': 'e29521fa7bd280a59f9981c5ed10c04f6b4fc8470a8a2903c13332988d2833fd',
    'rgba8.png none': 'd919dcf219b5605205fe42f0fd2bce97977098af76795e81f1d219d2c33ee4fc',
    'rgba8.png photo': 'c141c6f18eada8a7a7319aacb7cbbe15a640df04624dad7e675ff06d5b1e2c84',
    'rgba8.png lineart': 'aa67af535fb9f83e4ddc8db89d786e2583747b8ac0a8a19baa65ed6e23b7c9a9',
    'rgba8.png scan': '2ec4df560e44a0abbecec39753e7d6bdcf86793600a80344eb901a27a5059c05',
  };
  for (const [key, want] of Object.entries(golden)) {
    const [file, preset] = key.split(' ');
    const fp = ic.fingerprint(fixture(file), { preset, methods: M2_METHODS });
    assert.equal(sha(JSON.stringify(fp)), want, key);
  }
});
