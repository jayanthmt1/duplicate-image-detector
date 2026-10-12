'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { fixture, manifest, readPnm, diffStats } = require('./helpers/util');

const m = manifest();

for (const j of m.jpeg) {
  if (j.expectError) {
    test(`JPEG ${j.file} fails with a clear message`, () => {
      assert.throws(() => ic.decode(fixture(j.file)), new RegExp(j.expectError));
    });
    continue;
  }
  test(`JPEG ${j.file} matches libjpeg-turbo (djpeg -dct int) exactly`, () => {
    const img = ic.decode(fixture(j.file));
    const ref = readPnm(fixture(j.ref));
    const d = diffStats(img, ref);
    assert.equal(d.max, 0, `max difference ${d.max}, mean ${d.mean.toFixed(3)}`);
  });
}

test('EXIF orientation is reported and can be left unapplied', () => {
  const raw = ic.decode(fixture('orient6.jpg'), { autoOrient: false });
  const upright = ic.decode(fixture('orient6.jpg'));
  assert.equal(raw.width, upright.height);
  assert.equal(raw.height, upright.width);
  assert.equal(ic.decodeJpeg(fixture('orient6.jpg')).orientation, 6);
  assert.equal(ic.decodeJpeg(fixture('c420.jpg')).orientation, 1);
});

test('truncated or damaged JPEG data does not hang', () => {
  for (const f of ['photo420.jpg', 'prog420.jpg', 'prog-deep.jpg']) truncate(fixture(f));
});

function truncate(buf) {
  for (const cut of [0.3, 0.6, 0.95]) {
    const part = buf.subarray(0, Math.floor(buf.length * cut));
    try {
      const img = ic.decode(part);
      assert.equal(img.width, 123);
    } catch (e) {
      assert.match(e.message, /JPEG/);
    }
  }
  const noisy = Buffer.from(buf);
  for (let i = 700; i < noisy.length - 2; i += 97) noisy[i] = (noisy[i] * 31 + 7) & 0xff;
  try {
    ic.decode(noisy);
  } catch (e) {
    assert.ok(e instanceof Error);
  }
}

test('JPEG errors are clear', () => {
  assert.throws(() => ic.decodeJpeg(Buffer.from([1, 2, 3, 4])), /not a JPEG/);
  assert.throws(() => ic.decode(fixture('c420.jpg'), { maxPixels: 10 }), /maxPixels/);
  assert.throws(() => ic.decode(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), /WEBP decoding is not supported/);
  assert.throws(() => ic.decode(Buffer.from('hello world')), /unrecognised image format/);
});
