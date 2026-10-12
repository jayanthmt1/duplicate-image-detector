'use strict';

// PNG decoder: all colour types and bit depths, palette, tRNS transparency, Adam7 interlacing.
// Output is always 8 bits per sample. 16-bit samples are rounded (v / 257). Gamma and colour
// profile chunks are ignored on purpose so the output is the same on every machine.

const zlib = require('zlib');
const { checkDimensions, DEFAULT_MAX_PIXELS } = require('../image');
const { crc32 } = require('../crc32');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ADAM7 = [
  // [xStart, yStart, xStep, yStep]
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

const SAMPLES_PER_PIXEL = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const VALID_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function isPng(buf) {
  return buf.length >= 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

function readChunks(buf, checkCrc) {
  if (!isPng(buf)) throw new Error('not a PNG file');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let sawEnd = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + len;
    if (end + 4 > buf.length) throw new Error(`PNG truncated inside ${type} chunk`);
    if (checkCrc && crc32(buf.subarray(pos + 4, end)) !== buf.readUInt32BE(end)) {
      throw new Error(`PNG CRC mismatch in ${type} chunk`);
    }
    const body = buf.subarray(start, end);
    if (type === 'IHDR') {
      if (len < 13) throw new Error('PNG IHDR too short');
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      };
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    pos = end + 4;
  }
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  if (!idat.length) throw new Error('PNG has no IDAT chunk');
  void sawEnd; // a missing IEND is tolerated
  return { ihdr, palette, trns, idat };
}

function validateHeader(h) {
  const depths = VALID_DEPTHS[h.colorType];
  if (!depths) throw new Error(`PNG colour type ${h.colorType} is invalid`);
  if (!depths.includes(h.bitDepth)) {
    throw new Error(`PNG bit depth ${h.bitDepth} is invalid for colour type ${h.colorType}`);
  }
  if (h.compression !== 0 || h.filter !== 0) throw new Error('PNG uses an unknown compression or filter method');
  if (h.interlace !== 0 && h.interlace !== 1) throw new Error(`PNG interlace method ${h.interlace} is invalid`);
}

// Sizes of the reduced images for each pass (one pass when not interlaced).
function passes(h) {
  if (h.interlace === 0) return [{ xs: 0, ys: 0, dx: 1, dy: 1, w: h.width, h: h.height }];
  return ADAM7.map(([xs, ys, dx, dy]) => ({
    xs, ys, dx, dy,
    w: h.width > xs ? Math.ceil((h.width - xs) / dx) : 0,
    h: h.height > ys ? Math.ceil((h.height - ys) / dy) : 0,
  }));
}

function unfilter(raw, offset, w, h, rowBytes, bpp) {
  // Returns the unfiltered rows of one pass as one contiguous array (no filter bytes).
  const out = new Uint8Array(rowBytes * h);
  let src = offset;
  for (let y = 0; y < h; y++) {
    const ft = raw[src++];
    const row = y * rowBytes;
    const prev = row - rowBytes;
    switch (ft) {
      case 0:
        out.set(raw.subarray(src, src + rowBytes), row);
        break;
      case 1:
        for (let i = 0; i < rowBytes; i++) {
          out[row + i] = raw[src + i] + (i >= bpp ? out[row + i - bpp] : 0);
        }
        break;
      case 2:
        if (y === 0) out.set(raw.subarray(src, src + rowBytes), row);
        else for (let i = 0; i < rowBytes; i++) out[row + i] = raw[src + i] + out[prev + i];
        break;
      case 3:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? out[row + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          out[row + i] = raw[src + i] + ((a + b) >> 1);
        }
        break;
      case 4:
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? out[row + i - bpp] : 0;
          const b = y > 0 ? out[prev + i] : 0;
          const c = i >= bpp && y > 0 ? out[prev + i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out[row + i] = raw[src + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        break;
      default:
        throw new Error(`PNG row uses unknown filter type ${ft}`);
    }
    src += rowBytes;
  }
  return out;
}

// 16-bit -> 8-bit with rounding; equal to Math.round(v / 257).
const to8 = (v) => ((v * 255 + 32767) / 65535) | 0;

function outputChannels(colorType, hasTrns) {
  switch (colorType) {
    case 0: return hasTrns ? 2 : 1;
    case 2: return hasTrns ? 4 : 3;
    case 3: return hasTrns ? 4 : 3;
    case 4: return 2;
    default: return 4;
  }
}

function decodePng(input, opts = {}) {
  const buf = input;
  const { ihdr, palette, trns, idat } = readChunks(buf, !!opts.checkCrc);
  validateHeader(ihdr);
  const { width, height, bitDepth: depth, colorType } = ihdr;
  checkDimensions(width, height, opts.maxPixels ?? DEFAULT_MAX_PIXELS);

  if (colorType === 3 && !palette) throw new Error('PNG palette image has no PLTE chunk');
  const hasTrns = !!trns && (colorType === 0 || colorType === 2 || colorType === 3);
  const channels = outputChannels(colorType, hasTrns);
  const spp = SAMPLES_PER_PIXEL[colorType];
  const bitsPerPixel = spp * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);

  const ps = passes(ihdr);
  let expected = 0;
  for (const p of ps) if (p.w && p.h) expected += p.h * (1 + Math.ceil((p.w * bitsPerPixel) / 8));

  let raw;
  try {
    raw = zlib.inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat), { maxOutputLength: Math.max(expected, 1) });
  } catch (e) {
    if (e instanceof RangeError) throw new Error('PNG image data is larger than its header says');
    throw new Error(`PNG image data could not be inflated: ${e.message}`);
  }
  if (raw.length < expected) throw new Error('PNG image data is truncated');

  const out = new Uint8Array(width * height * channels);

  // Transparent colour key from tRNS (raw sample values, before scaling).
  let keyGray = -1;
  let keyR = -1, keyG = -1, keyB = -1;
  let palAlpha = null;
  if (hasTrns) {
    if (colorType === 0 && trns.length >= 2) keyGray = trns.readUInt16BE(0);
    if (colorType === 2 && trns.length >= 6) {
      keyR = trns.readUInt16BE(0); keyG = trns.readUInt16BE(2); keyB = trns.readUInt16BE(4);
    }
    if (colorType === 3) palAlpha = trns;
  }
  const palCount = palette ? Math.floor(palette.length / 3) : 0;
  const grayScale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;

  let offset = 0;
  for (const p of ps) {
    if (!p.w || !p.h) continue;
    const rowBytes = Math.ceil((p.w * bitsPerPixel) / 8);
    const rows = unfilter(raw, offset, p.w, p.h, rowBytes, bpp);
    offset += p.h * (1 + rowBytes);

    // Fast path: not interlaced, 8-bit, no conversion needed.
    if (ihdr.interlace === 0 && depth === 8 && !hasTrns && colorType !== 3) {
      out.set(rows);
      continue;
    }

    for (let j = 0; j < p.h; j++) {
      const y = p.ys + j * p.dy;
      const r0 = j * rowBytes;
      for (let i = 0; i < p.w; i++) {
        const x = p.xs + i * p.dx;
        const o = (y * width + x) * channels;
        if (colorType === 0 || colorType === 3) {
          let v;
          if (depth === 16) v = (rows[r0 + 2 * i] << 8) | rows[r0 + 2 * i + 1];
          else if (depth === 8) v = rows[r0 + i];
          else {
            const bit = i * depth;
            v = (rows[r0 + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
          }
          if (colorType === 0) {
            out[o] = depth === 16 ? to8(v) : depth < 8 ? v * grayScale : v;
            if (hasTrns) out[o + 1] = v === keyGray ? 0 : 255;
          } else {
            if (v < palCount) {
              out[o] = palette[v * 3];
              out[o + 1] = palette[v * 3 + 1];
              out[o + 2] = palette[v * 3 + 2];
            } // out-of-range index stays black
            if (hasTrns) out[o + 3] = palAlpha && v < palAlpha.length ? palAlpha[v] : 255;
          }
        } else if (depth === 8) {
          const s = r0 + i * spp;
          for (let c = 0; c < spp; c++) out[o + c] = rows[s + c];
          if (hasTrns) {
            out[o + 3] = rows[s] === keyR && rows[s + 1] === keyG && rows[s + 2] === keyB ? 0 : 255;
          }
        } else {
          const s = r0 + i * spp * 2;
          const r = (rows[s] << 8) | rows[s + 1];
          for (let c = 0; c < spp; c++) out[o + c] = to8((rows[s + 2 * c] << 8) | rows[s + 2 * c + 1]);
          if (hasTrns) {
            const g = (rows[s + 2] << 8) | rows[s + 3];
            const b = (rows[s + 4] << 8) | rows[s + 5];
            out[o + 3] = r === keyR && g === keyG && b === keyB ? 0 : 255;
          }
        }
      }
    }
  }

  return { width, height, channels, data: out };
}

module.exports = { decodePng, isPng, SIGNATURE };
