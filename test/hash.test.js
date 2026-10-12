'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { fixture, manifest } = require('./helpers/util');

const m = manifest();

test('hamming and hammingSimilarity', () => {
  assert.equal(ic.hamming('0000', '0000'), 0);
  assert.equal(ic.hamming('ffff', '0000'), 16);
  assert.equal(ic.hamming('a5', 'A4'), 1);
  assert.equal(ic.hammingSimilarity('ff00', 'ff0f'), 1 - 4 / 16);
  assert.throws(() => ic.hamming('00', '000'), RangeError);
  assert.throws(() => ic.hamming('zz', '00'), TypeError);
});

test('dhash64: a left-to-right darkening gradient sets every bit; a flat image sets none', () => {
  const w = 90;
  const h = 40;
  const grad = { width: w, height: h, channels: 1, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grad.data[y * w + x] = 255 - Math.floor((x * 255) / (w - 1));
  assert.equal(ic.dhash64(grad), 'ffffffffffffffff');
  const flat = { width: 10, height: 10, channels: 3, data: new Uint8Array(300).fill(128) };
  assert.equal(ic.dhash64(flat), '0000000000000000');
  assert.equal(ic.dhash(grad, 16, 16).length, 64);
});

test('pixelSha is the same for every PNG encoding of the same picture', () => {
  const values = new Set(m.samePicture.map((f) => ic.fingerprint(fixture(f)).pixelSha));
  assert.equal(values.size, 1);
  const fileShas = new Set(m.samePicture.map((f) => ic.fingerprint(fixture(f)).fileSha));
  assert.equal(fileShas.size, m.samePicture.length);
});

test('pixelSha ignores the colour hidden under fully transparent pixels', () => {
  const a = { width: 2, height: 1, channels: 4, data: Uint8Array.from([10, 20, 30, 0, 0, 0, 0, 255]) };
  const b = { width: 2, height: 1, channels: 4, data: Uint8Array.from([99, 99, 99, 0, 0, 0, 0, 255]) };
  const c = { width: 2, height: 1, channels: 3, data: Uint8Array.from([255, 255, 255, 0, 0, 0]) };
  assert.equal(ic.pixelSha(a), ic.pixelSha(b));
  assert.equal(ic.pixelSha(a), ic.pixelSha(c));
});

test('pixelSha depends on the image size, not just the bytes', () => {
  const data = new Uint8Array(12).fill(7);
  assert.notEqual(
    ic.pixelSha({ width: 4, height: 1, channels: 3, data }),
    ic.pixelSha({ width: 2, height: 2, channels: 3, data }),
  );
});

// Pinned values: if one of these changes, the fingerprint output changed and FINGERPRINT_VERSION
// must be bumped.
test('golden fingerprints (version 1)', () => {
  assert.equal(ic.FINGERPRINT_VERSION, 1);
  const golden = {
    'same-gray8.png': {
      pixelSha: '46a350294cda727ae26e4b198853cbbf1154a5c8b7166f0f0392158e189b2755',
      dhash64: 'a1c6bc99b3c98800',
    },
    'photo420.jpg': {
      pixelSha: 'b850aa1b17380c787d061b142bcec2ca491e96a0108ce992a267f63db92f59f8',
      dhash64: '35bac4c5c3453223',
    },
    'rgba8.png': {
      pixelSha: 'c79c17cc5dfa7f1d452780b57bd47ed2014623c92121e14d79f52f7b6c263b30',
      dhash64: '04a919391834a603',
    },
  };
  for (const [file, want] of Object.entries(golden)) {
    const fp = ic.fingerprint(fixture(file), { methods: ['pixelSha', 'dhash64'] });
    assert.equal(fp.pixelSha, want.pixelSha, file);
    assert.equal(fp.dhash64, want.dhash64, file);
  }
});
