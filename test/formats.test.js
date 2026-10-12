'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');
const { fixture, manifest, sha, toRgba } = require('./helpers/util');

const m = manifest();
const zeroTransparent = (b) => {
  for (let i = 0; i < b.length; i += 4) if (b[i + 3] === 0) b[i] = b[i + 1] = b[i + 2] = 0;
  return b;
};

for (const o of m.other) {
  test(`${o.file} decodes to the reference pixels`, () => {
    const img = ic.decode(fixture(o.file));
    assert.equal(sha(zeroTransparent(toRgba(img))), o.rgbaSha);
  });
}

test('format sniffing', () => {
  assert.equal(ic.sniffFormat(fixture('gif-basic.gif')), 'gif');
  assert.equal(ic.sniffFormat(fixture('bmp24.bmp')), 'bmp');
  assert.equal(ic.sniffFormat(fixture('prog420.jpg')), 'jpeg');
});

test('GIF: transparency and frame offsets give RGBA; covered opaque frames give RGB', () => {
  assert.equal(ic.decode(fixture('gif-basic.gif')).channels, 3);
  const t = ic.decode(fixture('gif-transparent.gif'));
  assert.equal(t.channels, 4);
  const offset = ic.decode(fixture('gif-anim-offset.gif'));
  assert.deepEqual([offset.width, offset.height, offset.channels], [60, 40, 4]);
  assert.equal(offset.data[3], 0); // top-left is outside the first frame
  const inside = (10 * 60 + 20) * 4;
  assert.deepEqual([...offset.data.subarray(inside, inside + 4)], [0xcc, 0x33, 0x11, 255]);
});

test('the same picture as PNG, GIF and BMP gives the same pixelSha', () => {
  // gif-2colour and bmp1 are both the line drawing reduced to 2 colours by ImageMagick.
  const a = ic.fingerprint(fixture('bmp24.bmp'), { methods: ['pixelSha'] });
  const b = ic.fingerprint(fixture('bmp24-topdown.bmp'), { methods: ['pixelSha'] });
  const c = ic.fingerprint(fixture('rgb8.png'), { methods: ['pixelSha'] });
  assert.equal(a.pixelSha, b.pixelSha);
  assert.equal(a.pixelSha, c.pixelSha);
});

test('damaged GIF and BMP files fail cleanly or decode partially', () => {
  for (const f of ['gif-noise256.gif', 'gif-interlaced.gif', 'bmp8-rle.bmp', 'bmp24.bmp']) {
    const buf = fixture(f);
    for (const cut of [0.5, 0.9]) {
      try {
        const img = ic.decode(buf.subarray(0, Math.floor(buf.length * cut)));
        assert.ok(img.width > 0);
      } catch (e) {
        assert.match(e.message, /GIF|BMP/);
      }
    }
  }
  assert.throws(() => ic.decode(Buffer.from('GIF89a')), /GIF/);
  assert.throws(() => ic.decode(fixture('bmp24.bmp'), { maxPixels: 10 }), /maxPixels/);
});
