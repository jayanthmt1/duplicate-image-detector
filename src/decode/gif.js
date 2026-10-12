'use strict';

// GIF decoder: first frame only. LZW, interlacing, global and local colour tables, transparency
// (Graphic Control Extension). The first frame is placed on the logical screen; anything it does
// not cover is transparent. Output is RGB when every pixel is opaque, otherwise RGBA.

const { checkDimensions, DEFAULT_MAX_PIXELS } = require('../image');

function isGif(buf) {
  if (buf.length < 6) return false;
  const sig = buf.toString('latin1', 0, 6);
  return sig === 'GIF87a' || sig === 'GIF89a';
}

function skipSubBlocks(buf, p) {
  while (p < buf.length) {
    const n = buf[p++];
    if (n === 0) break;
    p += n;
  }
  return p;
}

// LZW decode into `out` (palette indices); returns the number of pixels written.
function lzw(data, minSize, out) {
  if (minSize < 1 || minSize > 11) throw new Error(`GIF LZW code size ${minSize} is invalid`);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const first = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }
  let codeSize = minSize + 1;
  let next = clear + 2;
  let prev = -1;
  let o = 0;
  const n = out.length;
  let bits = 0;
  let nbits = 0;
  let pos = 0;

  const emit = (code) => {
    const len = length[code];
    let end = o + len;
    let c = code;
    // Write the string backwards; anything past the end of the image is dropped.
    for (let i = end - 1; i >= o; i--) {
      if (i < n) out[i] = suffix[c];
      c = prefix[c];
    }
    o = end > n ? n : end;
  };

  while (o < n) {
    while (nbits < codeSize && pos < data.length) {
      bits |= data[pos++] << nbits;
      nbits += 8;
    }
    if (nbits < codeSize) break; // out of data
    const code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    nbits -= codeSize;

    if (code === clear) {
      codeSize = minSize + 1;
      next = clear + 2;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) break; // corrupt
      emit(code);
      prev = code;
      continue;
    }
    if (code > next || (code === next && next >= 4096)) break; // corrupt
    if (next < 4096) {
      // New entry: previous string + first char of the current one (or of prev when code == next).
      prefix[next] = prev;
      suffix[next] = code < next ? first[code] : first[prev];
      first[next] = first[prev];
      length[next] = length[prev] + 1;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    emit(code);
    prev = code;
  }
  return o;
}

function decodeGif(input, opts = {}) {
  const buf = input;
  if (!isGif(buf)) throw new Error('not a GIF file');
  if (buf.length < 13) throw new Error('GIF is truncated');
  let screenW = buf.readUInt16LE(6);
  let screenH = buf.readUInt16LE(8);
  const flags = buf[10];
  let p = 13;
  let globalTable = null;
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1));
    globalTable = buf.subarray(p, p + size);
    p += size;
  }
  let transparent = -1;

  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9 && buf[p] >= 4) {
        const packed = buf[p + 1];
        transparent = packed & 1 ? buf[p + 4] : -1;
      }
      p = skipSubBlocks(buf, p);
      continue;
    }
    if (b !== 0x2c) throw new Error(`GIF has an unknown block 0x${b.toString(16)}`);

    // Image descriptor: the first frame.
    if (p + 9 > buf.length) throw new Error('GIF is truncated');
    const left = buf.readUInt16LE(p);
    const top = buf.readUInt16LE(p + 2);
    const w = buf.readUInt16LE(p + 4);
    const h = buf.readUInt16LE(p + 6);
    const f = buf[p + 8];
    p += 9;
    let table = globalTable;
    if (f & 0x80) {
      const size = 3 * (1 << ((f & 7) + 1));
      table = buf.subarray(p, p + size);
      p += size;
    }
    if (!table) throw new Error('GIF frame has no colour table');
    const interlaced = !!(f & 0x40);
    if (!w || !h) throw new Error('GIF frame is empty');
    // Screens of 0x0 or smaller than the frame grow to hold it.
    screenW = Math.max(screenW, left + w);
    screenH = Math.max(screenH, top + h);
    checkDimensions(screenW, screenH, opts.maxPixels ?? DEFAULT_MAX_PIXELS);

    const minSize = buf[p++];
    const chunks = [];
    while (p < buf.length) {
      const n = buf[p++];
      if (n === 0) break;
      chunks.push(buf.subarray(p, p + n));
      p += n;
    }
    const indices = new Uint8Array(w * h);
    lzw(Buffer.concat(chunks), minSize, indices); // short data leaves index 0

    // Row order for interlaced frames: 0,8,16..; 4,12..; 2,6..; 1,3..
    const rows = new Int32Array(h);
    if (interlaced) {
      let r = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows[r++] = y;
    } else {
      for (let y = 0; y < h; y++) rows[y] = y;
    }

    const colours = table.length / 3;
    const covers = left === 0 && top === 0 && w === screenW && h === screenH;
    let hasTransparent = !covers;
    if (!hasTransparent && transparent >= 0) {
      for (let i = 0; i < indices.length; i++) if (indices[i] === transparent) { hasTransparent = true; break; }
    }
    const ch = hasTransparent ? 4 : 3;
    const out = new Uint8Array(screenW * screenH * ch);
    for (let r = 0; r < h; r++) {
      const y = top + rows[r];
      if (y >= screenH) continue;
      for (let x = 0; x < w; x++) {
        const xx = left + x;
        if (xx >= screenW) continue;
        const idx = indices[r * w + x];
        const o = (y * screenW + xx) * ch;
        if (idx === transparent) continue; // stays 0,0,0,0
        if (idx < colours) {
          out[o] = table[idx * 3];
          out[o + 1] = table[idx * 3 + 1];
          out[o + 2] = table[idx * 3 + 2];
        }
        if (ch === 4) out[o + 3] = 255;
      }
    }
    return { width: screenW, height: screenH, channels: ch, data: out };
  }
  throw new Error('GIF has no image');
}

module.exports = { decodeGif, isGif };
