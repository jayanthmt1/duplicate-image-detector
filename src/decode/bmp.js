'use strict';

// BMP decoder: core (OS/2 1.x), INFO and V2-V5 headers; 1/4/8-bit palettes, RLE4 and RLE8,
// 16 and 32-bit bit fields, 24-bit, 32-bit with or without alpha, bottom-up and top-down rows.
// 32-bit BI_RGB: the fourth byte is alpha unless it is zero everywhere (then it is padding),
// which matches what browsers and common encoders (e.g. Pillow) do.

const { checkDimensions, DEFAULT_MAX_PIXELS } = require('../image');

function isBmp(buf) {
  return buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d;
}

// Bit-field channel: shift and size from a mask. Values are expanded to 8 bits by bit
// replication (5 bits: v << 3 | v >> 2), as browsers do; wider fields keep their top 8 bits.
function field(mask) {
  if (!mask) return null;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  let bits = 0;
  while ((mask >>> (shift + bits)) & 1) bits++;
  const table = new Uint8Array(bits <= 8 ? 1 << bits : 0);
  for (let v = 0; v < table.length; v++) {
    let x = 0;
    for (let filled = 0; filled < 8; filled += bits) x = (x << bits) | v;
    table[v] = (x >>> (Math.ceil(8 / bits) * bits - 8)) & 255;
  }
  return { mask, shift, bits, table };
}
function take(f, v) {
  if (!f) return 0;
  const x = (v & f.mask) >>> f.shift;
  return f.bits <= 8 ? f.table[x] : (x >>> (f.bits - 8)) & 255;
}

// True when any pixel of a 32-bit BI_RGB image has a non-zero fourth byte.
function usesAlphaByte(buf, offset, width, height) {
  const end = Math.min(buf.length, offset + width * height * 4);
  for (let i = offset + 3; i < end; i += 4) if (buf[i]) return true;
  return false;
}

function decodeBmp(input, opts = {}) {
  const buf = input;
  if (!isBmp(buf)) throw new Error('not a BMP file');
  const dataOffset = buf.readUInt32LE(10);
  const hsize = buf.readUInt32LE(14);
  let width;
  let height;
  let bpp;
  let compression = 0;
  let colorsUsed = 0;
  let paletteEntry = 4;
  if (hsize === 12) {
    width = buf.readUInt16LE(18);
    height = buf.readInt16LE(20);
    bpp = buf.readUInt16LE(24);
    paletteEntry = 3;
  } else if (hsize >= 40) {
    if (buf.length < 14 + 40) throw new Error('BMP is truncated');
    width = buf.readInt32LE(18);
    height = buf.readInt32LE(22);
    bpp = buf.readUInt16LE(28);
    compression = buf.readUInt32LE(30);
    colorsUsed = buf.readUInt32LE(46);
  } else {
    throw new Error(`BMP header size ${hsize} is not supported`);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0) throw new Error(`BMP size ${width}x${height} is invalid`);
  checkDimensions(width, height, opts.maxPixels ?? DEFAULT_MAX_PIXELS);
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(`BMP bit depth ${bpp} is not supported`);
  if (![0, 1, 2, 3, 6].includes(compression)) throw new Error(`BMP compression ${compression} is not supported`);

  // Bit fields: in the header for V2+ (size >= 52), after a 40-byte header otherwise.
  let masks = null;
  let tableStart = 14 + hsize;
  if (compression === 3 || compression === 6) {
    const at = hsize >= 52 ? 54 : 14 + hsize;
    const n = compression === 6 || hsize >= 56 ? 4 : 3;
    masks = [];
    for (let i = 0; i < n; i++) masks.push(buf.readUInt32LE(at + 4 * i));
    if (hsize < 52) tableStart += 4 * n;
  }

  let palette = null;
  if (bpp <= 8) {
    const count = colorsUsed || 1 << bpp;
    palette = new Uint8Array(256 * 3);
    for (let i = 0; i < Math.min(count, 256); i++) {
      const o = tableStart + i * paletteEntry;
      if (o + 2 >= buf.length) break;
      palette[i * 3] = buf[o + 2];
      palette[i * 3 + 1] = buf[o + 1];
      palette[i * 3 + 2] = buf[o];
    }
  }

  let fields = null;
  let alpha = false;
  if (bpp === 16 || bpp === 32) {
    let m = masks;
    if (!m) m = bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0xff0000, 0x00ff00, 0x0000ff, usesAlphaByte(buf, dataOffset, width, height) ? 0xff000000 : 0];
    fields = m.map(field);
    alpha = !!fields[3];
  }
  const ch = alpha ? 4 : 3;
  const out = new Uint8Array(width * height * ch);
  const rowOut = (y) => (topDown ? y : height - 1 - y) * width * ch;

  if (compression === 1 || compression === 2) {
    // RLE8 / RLE4: rows bottom-up; skipped pixels keep palette entry 0.
    if (!palette) throw new Error('BMP RLE without a palette');
    const idx = new Uint8Array(width * height);
    let p = dataOffset;
    let x = 0;
    let y = 0;
    const put = (v) => {
      if (x < width && y < height) idx[y * width + x] = v;
      x++;
    };
    const rle4 = compression === 2;
    while (p + 1 < buf.length && y < height) {
      const a = buf[p++];
      const b = buf[p++];
      if (a > 0) {
        for (let i = 0; i < a; i++) put(rle4 ? (i & 1 ? b & 15 : b >> 4) : b);
      } else if (b === 0) {
        x = 0;
        y++;
      } else if (b === 1) {
        break;
      } else if (b === 2) {
        x += buf[p++];
        y += buf[p++];
      } else {
        const bytes = rle4 ? (b + 1) >> 1 : b;
        for (let i = 0; i < b; i++) put(rle4 ? (i & 1 ? buf[p + (i >> 1)] & 15 : buf[p + (i >> 1)] >> 4) : buf[p + i]);
        p += bytes + (bytes & 1);
      }
    }
    for (let yy = 0; yy < height; yy++) {
      const o = (height - 1 - yy) * width * ch;
      for (let xx = 0; xx < width; xx++) {
        const v = idx[yy * width + xx];
        out[o + xx * 3] = palette[v * 3];
        out[o + xx * 3 + 1] = palette[v * 3 + 1];
        out[o + xx * 3 + 2] = palette[v * 3 + 2];
      }
    }
    return { width, height, channels: 3, data: out };
  }

  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (dataOffset + stride * (height - 1) + Math.ceil((width * bpp) / 8) > buf.length) throw new Error('BMP is truncated');
  for (let y = 0; y < height; y++) {
    const s = dataOffset + y * stride;
    const o = rowOut(y);
    for (let x = 0; x < width; x++) {
      const d = o + x * ch;
      if (bpp <= 8) {
        const bit = x * bpp;
        const v = (buf[s + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        out[d] = palette[v * 3];
        out[d + 1] = palette[v * 3 + 1];
        out[d + 2] = palette[v * 3 + 2];
      } else if (bpp === 24) {
        out[d] = buf[s + x * 3 + 2];
        out[d + 1] = buf[s + x * 3 + 1];
        out[d + 2] = buf[s + x * 3];
      } else {
        const v = bpp === 16 ? buf.readUInt16LE(s + x * 2) : buf.readUInt32LE(s + x * 4);
        out[d] = take(fields[0], v);
        out[d + 1] = take(fields[1], v);
        out[d + 2] = take(fields[2], v);
        if (alpha) out[d + 3] = take(fields[3], v);
      }
    }
  }
  return { width, height, channels: ch, data: out };
}

module.exports = { decodeBmp, isBmp };
