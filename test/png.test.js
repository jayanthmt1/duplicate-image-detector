'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const ic = require('..');
const { fixture, manifest, sha, toRgba } = require('./helpers/util');

const m = manifest();

test('PNG fixtures cover every colour type, bit depth and interlacing', () => {
  const seen = new Set(m.png.map((p) => `${p.ihdr.colorType}/${p.ihdr.bitDepth}`));
  for (const combo of ['0/1', '0/2', '0/4', '0/8', '0/16', '2/8', '2/16', '3/1', '3/2', '3/4', '3/8', '4/8', '4/16', '6/8', '6/16']) {
    assert.ok(seen.has(combo), `missing fixture for colour type/depth ${combo}`);
  }
  assert.ok(m.png.some((p) => p.ihdr.interlace === 1));
});

for (const p of m.png) {
  test(`PNG ${p.file} decodes to the same pixels as ImageMagick`, () => {
    const img = ic.decode(fixture(p.file));
    assert.equal(sha(toRgba(img)), p.rgbaSha);
  });
}

test('PNG output channels follow the colour type and transparency', () => {
  const ch = (f) => ic.decode(fixture(f)).channels;
  assert.equal(ch('gray8.png'), 1);
  assert.equal(ch('gray8-trns.png'), 2);
  assert.equal(ch('rgb8.png'), 3);
  assert.equal(ch('rgb8-trns.png'), 4);
  assert.equal(ch('pal8.png'), 3);
  assert.equal(ch('pal8-trns.png'), 4);
  assert.equal(ch('ga16.png'), 2);
  assert.equal(ch('rgba16.png'), 4);
});

test('encodePng round-trips 1 to 4 channels', () => {
  for (let channels = 1; channels <= 4; channels++) {
    const width = 13;
    const height = 7;
    const data = new Uint8Array(width * height * channels).map((_, i) => (i * 37 + 11) & 255);
    const out = ic.decode(ic.encodePng({ width, height, channels, data }));
    assert.deepEqual(out, { width, height, channels, data });
  }
});

test('PNG errors are clear', () => {
  const good = fixture('rgb8.png');
  assert.throws(() => ic.decodePng(Buffer.from('not a png at all')), /not a PNG/);
  assert.throws(() => ic.decode(good.subarray(0, 60)), /truncated/);
  const badCrc = Buffer.from(good);
  badCrc[20] ^= 0xff; // inside IHDR data
  assert.throws(() => ic.decode(badCrc, { checkCrc: true }), /CRC/);
  assert.throws(() => ic.decode(good, { maxPixels: 100 }), /maxPixels/);
});

test('PNG whose data inflates to more than the header allows is rejected', () => {
  const img = { width: 4, height: 4, channels: 1, data: new Uint8Array(16) };
  const png = ic.encodePng(img);
  // Replace IDAT with a stream that is far too long.
  const bomb = zlib.deflateSync(Buffer.alloc(1 << 20));
  const idatPos = png.indexOf('IDAT') - 4;
  const len = png.readUInt32BE(idatPos);
  const head = png.subarray(0, idatPos);
  const tail = png.subarray(idatPos + 12 + len);
  const chunk = Buffer.alloc(12 + bomb.length);
  chunk.writeUInt32BE(bomb.length, 0);
  chunk.write('IDAT', 4, 'latin1');
  bomb.copy(chunk, 8);
  assert.throws(() => ic.decode(Buffer.concat([head, chunk, tail])), /larger than its header/);
});
