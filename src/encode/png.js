'use strict';

// Minimal PNG writer for debugging and tests: 8-bit, no interlacing, filter "Up" on every row.

const zlib = require('zlib');
const { assertImage } = require('../image');
const { crc32 } = require('../crc32');
const { SIGNATURE } = require('../decode/png');

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function encodePng(img) {
  assertImage(img);
  const { width, height, channels, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = COLOR_TYPE[channels];
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 2;
    const r = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) raw[o + 1 + i] = data[r + i] - (y ? data[r - rowBytes + i] : 0);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { encodePng };
