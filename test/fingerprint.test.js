'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { fixture, manifest } = require('./helpers/util');

const m = manifest();

test('fingerprint returns plain, versioned values', () => {
  const fp = ic.fingerprint(fixture('same-gray8.png'));
  assert.deepEqual(Object.keys(fp), ['v', 'preset', 'w', 'h', 'fileSha', 'pixelSha', 'dhash64']);
  assert.equal(fp.v, ic.FINGERPRINT_VERSION);
  assert.equal(fp.preset, 'none');
  assert.deepEqual([fp.w, fp.h], [97, 61]);
  assert.match(fp.fileSha, /^[0-9a-f]{64}$/);
  assert.match(fp.pixelSha, /^[0-9a-f]{64}$/);
  assert.match(fp.dhash64, /^[0-9a-f]{16}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(fp)), fp);
});

test('fingerprint accepts Uint8Array, ArrayBuffer and raw pixels', () => {
  const buf = fixture('same-gray8.png');
  const u8 = new Uint8Array(buf);
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const a = ic.fingerprint(buf);
  assert.deepEqual(ic.fingerprint(u8), a);
  assert.deepEqual(ic.fingerprint(ab), a);
  const raw = ic.fingerprint(ic.decode(buf));
  assert.equal(raw.fileSha, undefined);
  assert.equal(raw.pixelSha, a.pixelSha);
  assert.equal(raw.dhash64, a.dhash64);
});

test('fingerprint computes only the requested methods', () => {
  const fp = ic.fingerprint(fixture('c420.jpg'), { methods: ['dhash64'] });
  assert.deepEqual(Object.keys(fp), ['v', 'preset', 'w', 'h', 'dhash64']);
  assert.throws(() => ic.fingerprint(fixture('c420.jpg'), { methods: ['blockhash'] }), /unknown method/);
  assert.throws(() => ic.fingerprint(fixture('c420.jpg'), { preset: 'sketch' }), /unknown preset/);
});

test('fingerprint uses the upright (EXIF-oriented) image', () => {
  const a = ic.fingerprint(fixture('orient1.jpg'));
  const six = ic.fingerprint(fixture('orient6.jpg'));
  assert.deepEqual([six.w, six.h], [a.h, a.w]);
});

test('compare: exact methods give booleans, bit hashes give similarity', () => {
  const png = ic.fingerprint(fixture('same-gray8.png'));
  const rgb = ic.fingerprint(fixture('same-rgb16.png'));
  const jpg = ic.fingerprint(fixture(m.lineJpeg));
  const other = ic.fingerprint(fixture('photo420.jpg'));
  assert.deepEqual(ic.compare(png, rgb), { fileSha: false, pixelSha: true, dhash64: 1 });
  const pj = ic.compare(png, jpg);
  assert.equal(pj.pixelSha, false);
  assert.ok(pj.dhash64 >= 0.9, `same drawing as JPEG: ${pj.dhash64}`);
  assert.ok(ic.compare(png, other).dhash64 < 0.75);
  assert.deepEqual(ic.compare(png, { v: 1, preset: 'none', w: 1, h: 1 }), {});
});

test('compare refuses fingerprints of different versions and skips different presets', () => {
  const a = ic.fingerprint(fixture('same-gray8.png'));
  assert.throws(() => ic.compare(a, { ...a, v: 999 }), /versions differ/);
  assert.equal(ic.compare(a, { ...a, preset: 'other' }).dhash64, null);
  assert.equal(ic.compare(a, { ...a, preset: 'other' }).pixelSha, true);
});

test('ESM entry exports the same API', async () => {
  const esm = await import('../index.mjs');
  assert.equal(esm.fingerprint, ic.fingerprint);
  assert.equal(esm.default, ic);
  for (const k of Object.keys(ic)) assert.ok(k in esm, `ESM is missing ${k}`);
});
