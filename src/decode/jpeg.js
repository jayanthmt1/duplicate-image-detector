'use strict';

// JPEG decoder: baseline, extended sequential and progressive Huffman, 8-bit precision.
// Handles interleaved and non-interleaved scans, any sampling factors, restart markers,
// grayscale, YCbCr, RGB, Adobe CMYK/YCCK, and reads the EXIF orientation tag.
// Every step uses integer arithmetic, so output is identical on every machine.
// Progressive JPEG (spectral selection and successive approximation) keeps all coefficients
// until the last scan, then dequantizes and transforms once.

const { checkDimensions, DEFAULT_MAX_PIXELS } = require('../image');
const { readExifOrientation } = require('./exif');

// Zigzag position -> natural (row-major) position.
const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// ---------------------------------------------------------------- Huffman tables

const LOOKAHEAD = 9;

function buildHuffman(counts, symbols) {
  // counts[l] = number of codes of length l (1..16). Canonical code assignment.
  const lookup = new Uint16Array(1 << LOOKAHEAD); // (length << 8) | symbol, 0 = not in table
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let l = 1; l <= 16; l++) {
    valptr[l] = k;
    mincode[l] = code;
    for (let i = 0; i < counts[l]; i++) {
      if (l <= LOOKAHEAD) {
        const shift = LOOKAHEAD - l;
        const base = code << shift;
        for (let f = 0; f < 1 << shift; f++) lookup[base + f] = (l << 8) | symbols[k];
      }
      code++;
      k++;
    }
    maxcode[l] = counts[l] ? code - 1 : -1;
    code <<= 1;
  }
  maxcode[17] = 0x7fffffff; // sentinel: stop at length 17
  return { lookup, maxcode, valptr, mincode, symbols };
}

// ---------------------------------------------------------------- integer IDCT
// Separable 8x8 inverse DCT after Loeffler, Ligtenberg and Moschytz, with 13-bit fixed-point
// constants and 2 extra bits of precision between passes.

const CONST_BITS = 13;
const PASS1_BITS = 2;
const F_0_298 = 2446;
const F_0_390 = 3196;
const F_0_541 = 4433;
const F_0_765 = 6270;
const F_0_899 = 7373;
const F_1_175 = 9633;
const F_1_501 = 12299;
const F_1_847 = 15137;
const F_1_961 = 16069;
const F_2_053 = 16819;
const F_2_562 = 20995;
const F_3_072 = 25172;

const ws = new Int32Array(64);

// coef: dequantized coefficients in natural order. Writes 8x8 samples into out at (offset, stride).
function idct8x8(coef, out, offset, stride) {
  const s1 = CONST_BITS - PASS1_BITS;
  const r1 = 1 << (s1 - 1);
  // Pass 1: columns.
  for (let c = 0; c < 8; c++) {
    const d0 = coef[c], d1 = coef[8 + c], d2 = coef[16 + c], d3 = coef[24 + c];
    const d4 = coef[32 + c], d5 = coef[40 + c], d6 = coef[48 + c], d7 = coef[56 + c];
    if ((d1 | d2 | d3 | d4 | d5 | d6 | d7) === 0) {
      const dc = d0 << PASS1_BITS;
      for (let r = 0; r < 8; r++) ws[r * 8 + c] = dc;
      continue;
    }
    let z1 = (d2 + d6) * F_0_541;
    const t2e = z1 - d6 * F_1_847;
    const t3e = z1 + d2 * F_0_765;
    const t0e = (d0 + d4) << CONST_BITS;
    const t1e = (d0 - d4) << CONST_BITS;
    const t10 = t0e + t3e, t13 = t0e - t3e, t11 = t1e + t2e, t12 = t1e - t2e;

    let z3 = d7 + d3, z4 = d5 + d1;
    const z5 = (z3 + z4) * F_1_175;
    z1 = (d7 + d1) * -F_0_899;
    const z2 = (d5 + d3) * -F_2_562;
    z3 = z3 * -F_1_961 + z5;
    z4 = z4 * -F_0_390 + z5;
    const t0 = d7 * F_0_298 + z1 + z3;
    const t1 = d5 * F_2_053 + z2 + z4;
    const t2 = d3 * F_3_072 + z2 + z3;
    const t3 = d1 * F_1_501 + z1 + z4;

    ws[c] = (t10 + t3 + r1) >> s1;
    ws[56 + c] = (t10 - t3 + r1) >> s1;
    ws[8 + c] = (t11 + t2 + r1) >> s1;
    ws[48 + c] = (t11 - t2 + r1) >> s1;
    ws[16 + c] = (t12 + t1 + r1) >> s1;
    ws[40 + c] = (t12 - t1 + r1) >> s1;
    ws[24 + c] = (t13 + t0 + r1) >> s1;
    ws[32 + c] = (t13 - t0 + r1) >> s1;
  }
  // Pass 2: rows. Remove both scalings and the factor 8, add 128, clamp.
  const s2 = CONST_BITS + PASS1_BITS + 3;
  const r2 = (1 << (s2 - 1)) + (128 << s2);
  for (let r = 0; r < 8; r++) {
    const b = r * 8;
    const d0 = ws[b], d1 = ws[b + 1], d2 = ws[b + 2], d3 = ws[b + 3];
    const d4 = ws[b + 4], d5 = ws[b + 5], d6 = ws[b + 6], d7 = ws[b + 7];
    const o = offset + r * stride;
    if ((d1 | d2 | d3 | d4 | d5 | d6 | d7) === 0) {
      let v = ((d0 + (1 << (PASS1_BITS + 2))) >> (PASS1_BITS + 3)) + 128;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      for (let i = 0; i < 8; i++) out[o + i] = v;
      continue;
    }
    let z1 = (d2 + d6) * F_0_541;
    const t2e = z1 - d6 * F_1_847;
    const t3e = z1 + d2 * F_0_765;
    const t0e = (d0 + d4) << CONST_BITS;
    const t1e = (d0 - d4) << CONST_BITS;
    const t10 = t0e + t3e, t13 = t0e - t3e, t11 = t1e + t2e, t12 = t1e - t2e;

    let z3 = d7 + d3, z4 = d5 + d1;
    const z5 = (z3 + z4) * F_1_175;
    z1 = (d7 + d1) * -F_0_899;
    const z2 = (d5 + d3) * -F_2_562;
    z3 = z3 * -F_1_961 + z5;
    z4 = z4 * -F_0_390 + z5;
    const t0 = d7 * F_0_298 + z1 + z3;
    const t1 = d5 * F_2_053 + z2 + z4;
    const t2 = d3 * F_3_072 + z2 + z3;
    const t3 = d1 * F_1_501 + z1 + z4;

    out[o] = clamp((t10 + t3 + r2) >> s2);
    out[o + 7] = clamp((t10 - t3 + r2) >> s2);
    out[o + 1] = clamp((t11 + t2 + r2) >> s2);
    out[o + 6] = clamp((t11 - t2 + r2) >> s2);
    out[o + 2] = clamp((t12 + t1 + r2) >> s2);
    out[o + 5] = clamp((t12 - t1 + r2) >> s2);
    out[o + 3] = clamp((t13 + t0 + r2) >> s2);
    out[o + 4] = clamp((t13 - t0 + r2) >> s2);
  }
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ---------------------------------------------------------------- scan decoding

// scan: { ss, se, ah, al } spectral selection and successive approximation (progressive only).
function decodeScan(buf, pos, frame, scanComps, restartInterval, scan) {
  let bitBuf = 0;
  let bitCnt = 0;
  let p = pos;
  const end = buf.length;

  function fill() {
    while (bitCnt <= 16) {
      let byte = 0;
      if (p < end) {
        byte = buf[p];
        if (byte === 0xff) {
          const next = p + 1 < end ? buf[p + 1] : 0xd9;
          if (next === 0x00) p += 2;
          else byte = 0; // a marker: stop consuming and feed zero bits
        } else p++;
      }
      bitBuf = ((bitBuf << 8) | byte) & 0xffffff;
      bitCnt += 8;
    }
  }

  function getBits(n) {
    if (bitCnt < n) fill();
    bitCnt -= n;
    return (bitBuf >> bitCnt) & ((1 << n) - 1);
  }

  function decodeHuff(t) {
    if (bitCnt < 16) fill();
    const look = t.lookup[(bitBuf >> (bitCnt - LOOKAHEAD)) & ((1 << LOOKAHEAD) - 1)];
    if (look) {
      bitCnt -= look >> 8;
      return look & 0xff;
    }
    let l = LOOKAHEAD + 1;
    let code = (bitBuf >> (bitCnt - l)) & ((1 << l) - 1);
    while (code > t.maxcode[l]) {
      l++;
      if (l > 16) {
        bitCnt -= 16;
        return 0; // corrupt data: treat as end of block
      }
      code = (bitBuf >> (bitCnt - l)) & ((1 << l) - 1);
    }
    bitCnt -= l;
    return t.symbols[t.valptr[l] + code - t.mincode[l]];
  }

  function extend(v, s) {
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
  }

  // ---- baseline: decode, dequantize and IDCT straight into the component plane
  const coef = new Int32Array(64);
  function baselineBlock(comp, row, col) {
    coef.fill(0);
    const q = comp.qt;
    const t = decodeHuff(comp.dc);
    if (t) comp.pred += extend(getBits(t), t);
    coef[0] = comp.pred * q[0];
    const ac = comp.ac;
    for (let k = 1; k < 64; ) {
      const rs = decodeHuff(ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      const z = ZIGZAG[k];
      coef[z] = extend(getBits(s), s) * q[z];
      k++;
    }
    idct8x8(coef, comp.plane, row * 8 * comp.stride + col * 8, comp.stride);
  }

  // ---- progressive: accumulate quantized coefficients in comp.coefs
  let eobrun = 0;
  const { ss, se, ah, al } = scan;
  const p1 = 1 << al;
  const m1 = -1 << al;

  function dcFirst(comp, row, col) {
    const b = (row * comp.bw + col) * 64;
    const t = decodeHuff(comp.dc);
    if (t) comp.pred += extend(getBits(t), t);
    comp.coefs[b] = comp.pred * (1 << al);
  }

  function dcRefine(comp, row, col) {
    if (getBits(1)) comp.coefs[(row * comp.bw + col) * 64] |= p1;
  }

  function acFirst(comp, row, col) {
    if (eobrun > 0) {
      eobrun--;
      return;
    }
    const b = (row * comp.bw + col) * 64;
    const c = comp.coefs;
    for (let k = ss; k <= se; k++) {
      const rs = decodeHuff(comp.ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          eobrun = (1 << r) - 1;
          if (r) eobrun += getBits(r);
          break;
        }
        k += 15;
        continue;
      }
      k += r;
      if (k > 63) break;
      c[b + ZIGZAG[k]] = extend(getBits(s), s) * p1;
    }
  }

  function acRefine(comp, row, col) {
    const b = (row * comp.bw + col) * 64;
    const c = comp.coefs;
    let k = ss;
    if (eobrun === 0) {
      for (; k <= se; k++) {
        const rs = decodeHuff(comp.ac);
        let s = rs & 15;
        let r = rs >> 4;
        if (s) {
          s = getBits(1) ? p1 : m1;
        } else if (r !== 15) {
          eobrun = 1 << r;
          if (r) eobrun += getBits(r);
          break; // the rest of this block is handled below
        }
        // Skip r zero coefficients (refining non-zero ones on the way), then place the new one.
        while (k <= se) {
          const z = b + ZIGZAG[k];
          if (c[z] !== 0) {
            if (getBits(1) && (c[z] & p1) === 0) c[z] += c[z] >= 0 ? p1 : m1;
          } else {
            if (r === 0) break;
            r--;
          }
          k++;
        }
        if (s && k <= se) c[b + ZIGZAG[k]] = s;
      }
    }
    if (eobrun > 0) {
      for (; k <= se; k++) {
        const z = b + ZIGZAG[k];
        if (c[z] !== 0 && getBits(1) && (c[z] & p1) === 0) c[z] += c[z] >= 0 ? p1 : m1;
      }
      eobrun--;
    }
  }

  let block;
  if (!frame.progressive) block = baselineBlock;
  else if (ss === 0) block = ah === 0 ? dcFirst : dcRefine;
  else block = ah === 0 ? acFirst : acRefine;

  function resetForRestart() {
    bitBuf = 0;
    bitCnt = 0;
    eobrun = 0;
    // Find the RSTn marker; skip anything before it.
    while (p + 1 < end && !(buf[p] === 0xff && buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7)) {
      if (buf[p] === 0xff && buf[p + 1] !== 0x00 && buf[p + 1] !== 0xff) return; // some other marker
      p++;
    }
    if (p + 1 < end) p += 2;
    for (const c of scanComps) c.pred = 0;
  }

  for (const c of scanComps) c.pred = 0;

  if (scanComps.length === 1) {
    // Non-interleaved: one block per MCU, over the component's own block grid.
    const c = scanComps[0];
    const bw = Math.ceil(c.width / 8);
    const bh = Math.ceil(c.height / 8);
    const total = bw * bh;
    for (let n = 0; n < total; n++) {
      if (restartInterval && n > 0 && n % restartInterval === 0) resetForRestart();
      const by = (n / bw) | 0;
      block(c, by, n - by * bw);
    }
  } else {
    const total = frame.mcusX * frame.mcusY;
    for (let n = 0; n < total; n++) {
      if (restartInterval && n > 0 && n % restartInterval === 0) resetForRestart();
      const my = (n / frame.mcusX) | 0;
      const mx = n - my * frame.mcusX;
      for (const c of scanComps) {
        for (let v = 0; v < c.v; v++) {
          for (let h = 0; h < c.h; h++) block(c, my * c.v + v, mx * c.h + h);
        }
      }
    }
  }

  // Move to the next marker that is not a restart marker.
  while (p + 1 < end) {
    if (buf[p] === 0xff) {
      const m = buf[p + 1];
      if (m !== 0x00 && m !== 0xff && !(m >= 0xd0 && m <= 0xd7)) break;
    }
    p++;
  }
  return p;
}

// Progressive frames: dequantize the accumulated coefficients and run the IDCT once.
function finishProgressive(frame, qts) {
  const coef = new Int32Array(64);
  for (const c of frame.comps) {
    const q = qts[c.tq];
    if (!q) throw new Error('JPEG component uses a quantization table that was not defined');
    const blocks = c.bw * c.bh;
    for (let i = 0; i < blocks; i++) {
      const b = i * 64;
      for (let k = 0; k < 64; k++) coef[k] = c.coefs[b + k] * q[k];
      const row = (i / c.bw) | 0;
      const col = i - row * c.bw;
      idct8x8(coef, c.plane, row * 8 * c.stride + col * 8, c.stride);
    }
    c.coefs = null;
  }
}

// ---------------------------------------------------------------- upsampling

function upsample(c, width, height) {
  const fx = c.hmax / c.h;
  const fy = c.vmax / c.v;
  const src = c.plane;
  const sw = c.width;
  const sh = c.height;
  const stride = c.stride;
  if (fx === 1 && fy === 1) {
    if (stride === width) return src.subarray(0, width * height);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) out.set(src.subarray(y * stride, y * stride + width), y * width);
    return out;
  }
  const out = new Uint8Array(width * height);
  if (fx === 2 && fy === 1) {
    // Triangle filter horizontally: 3/4 nearer sample + 1/4 farther sample.
    const row = new Uint8Array(sw * 2);
    for (let y = 0; y < height; y++) {
      const s = y * stride;
      fancyRowH2(src, s, sw, row);
      out.set(row.subarray(0, width), y * width);
    }
    return out;
  }
  if (fx === 2 && fy === 2) {
    const colsum = new Int32Array(sw);
    const row = new Uint8Array(sw * 2);
    for (let y = 0; y < height; y++) {
      const sy = y >> 1;
      let ny = y & 1 ? sy + 1 : sy - 1;
      if (ny < 0) ny = 0;
      if (ny > sh - 1) ny = sh - 1;
      const a = sy * stride;
      const b = ny * stride;
      for (let x = 0; x < sw; x++) colsum[x] = 3 * src[a + x] + src[b + x];
      if (sw === 1) {
        row[0] = (colsum[0] * 4 + 8) >> 4;
        row[1] = (colsum[0] * 4 + 7) >> 4;
      } else {
        row[0] = (colsum[0] * 4 + 8) >> 4;
        row[1] = (colsum[0] * 3 + colsum[1] + 7) >> 4;
        for (let x = 1; x < sw - 1; x++) {
          row[2 * x] = (colsum[x] * 3 + colsum[x - 1] + 8) >> 4;
          row[2 * x + 1] = (colsum[x] * 3 + colsum[x + 1] + 7) >> 4;
        }
        row[2 * sw - 2] = (colsum[sw - 1] * 3 + colsum[sw - 2] + 8) >> 4;
        row[2 * sw - 1] = (colsum[sw - 1] * 4 + 7) >> 4;
      }
      out.set(row.subarray(0, width), y * width);
    }
    return out;
  }
  if (fx === 1 && fy === 2) {
    // Triangle filter vertically.
    for (let y = 0; y < height; y++) {
      const sy = y >> 1;
      const lower = y & 1;
      let ny = lower ? sy + 1 : sy - 1;
      if (ny < 0) ny = 0;
      if (ny > sh - 1) ny = sh - 1;
      const a = sy * stride;
      const b = ny * stride;
      const bias = lower ? 2 : 1;
      const o = y * width;
      for (let x = 0; x < width; x++) out[o + x] = (3 * src[a + x] + src[b + x] + bias) >> 2;
    }
    return out;
  }
  // Any other ratio: replicate the nearest sample.
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * c.v) / c.vmax));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * c.h) / c.hmax));
      out[y * width + x] = src[sy * stride + sx];
    }
  }
  return out;
}

function fancyRowH2(src, s, sw, row) {
  if (sw === 1) {
    row[0] = row[1] = src[s];
    return;
  }
  row[0] = src[s];
  row[1] = (3 * src[s] + src[s + 1] + 2) >> 2;
  for (let x = 1; x < sw - 1; x++) {
    const v = 3 * src[s + x];
    row[2 * x] = (v + src[s + x - 1] + 1) >> 2;
    row[2 * x + 1] = (v + src[s + x + 1] + 2) >> 2;
  }
  row[2 * sw - 2] = (3 * src[s + sw - 1] + src[s + sw - 2] + 1) >> 2;
  row[2 * sw - 1] = src[s + sw - 1];
}

// ---------------------------------------------------------------- colour conversion

function ycc(planes, width, height, out) {
  const [Y, Cb, Cr] = planes;
  const n = width * height;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    const y = Y[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    out[o] = clamp(y + ((91881 * cr + 32768) >> 16));
    out[o + 1] = clamp(y + ((-22554 * cb - 46802 * cr + 32768) >> 16));
    out[o + 2] = clamp(y + ((116130 * cb + 32768) >> 16));
  }
}

function cmyk(planes, width, height, out, transform, inverted) {
  const [P0, P1, P2, K] = planes;
  const n = width * height;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    let c = P0[i], m = P1[i], y = P2[i];
    if (transform === 2) {
      // YCCK: the first three are YCbCr of the (inverted) CMY values.
      const yy = c, cb = m - 128, cr = y - 128;
      c = 255 - clamp(yy + ((91881 * cr + 32768) >> 16));
      m = 255 - clamp(yy + ((-22554 * cb - 46802 * cr + 32768) >> 16));
      y = 255 - clamp(yy + ((116130 * cb + 32768) >> 16));
    }
    let k = K[i];
    if (!inverted) {
      c = 255 - c; m = 255 - m; y = 255 - y; k = 255 - k;
    }
    // Here 255 means "no ink".
    out[o] = ((c * k + 127) / 255) | 0;
    out[o + 1] = ((m * k + 127) / 255) | 0;
    out[o + 2] = ((y * k + 127) / 255) | 0;
  }
}

// ---------------------------------------------------------------- marker parsing

function decodeJpeg(input, opts = {}) {
  const buf = input;
  if (!isJpeg(buf)) throw new Error('not a JPEG file');
  const maxPixels = opts.maxPixels ?? DEFAULT_MAX_PIXELS;

  const qts = [];
  const dcTables = [];
  const acTables = [];
  let frame = null;
  let restartInterval = 0;
  let adobe = null;
  let orientation = 1;
  let scans = 0;

  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1];
    pos += 2;
    if (marker === 0xff) {
      pos--;
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (pos + 2 > buf.length) break;
    const len = buf.readUInt16BE(pos);
    if (len < 2 || pos + len > buf.length) throw new Error(`JPEG segment 0x${marker.toString(16)} is truncated`);
    const seg = buf.subarray(pos + 2, pos + len);
    pos += len;

    switch (marker) {
      case 0xdb: { // DQT
        let i = 0;
        while (i < seg.length) {
          const pq = seg[i] >> 4;
          const tq = seg[i] & 15;
          i++;
          const t = new Int32Array(64);
          for (let k = 0; k < 64; k++) {
            t[ZIGZAG[k]] = pq ? seg.readUInt16BE(i + 2 * k) : seg[i + k];
          }
          i += pq ? 128 : 64;
          qts[tq] = t;
        }
        break;
      }
      case 0xc4: { // DHT
        let i = 0;
        while (i < seg.length) {
          const tc = seg[i] >> 4;
          const th = seg[i] & 15;
          const counts = new Uint8Array(17);
          let total = 0;
          for (let l = 1; l <= 16; l++) {
            counts[l] = seg[i + l];
            total += counts[l];
          }
          const symbols = seg.subarray(i + 17, i + 17 + total);
          i += 17 + total;
          (tc === 0 ? dcTables : acTables)[th] = buildHuffman(counts, symbols);
        }
        break;
      }
      case 0xc0:
      case 0xc1:
      case 0xc2: { // SOF0 baseline, SOF1 extended sequential, SOF2 progressive
        if (frame) throw new Error('JPEG has more than one frame');
        if (seg[0] !== 8) throw new Error(`JPEG sample precision ${seg[0]} is not supported (only 8-bit)`);
        const height = seg.readUInt16BE(1);
        const width = seg.readUInt16BE(3);
        if (height === 0) throw new Error('JPEG with height defined by DNL is not supported');
        checkDimensions(width, height, maxPixels);
        const n = seg[5];
        const comps = [];
        for (let k = 0; k < n; k++) {
          const b = 6 + k * 3;
          comps.push({ id: seg[b], h: seg[b + 1] >> 4 || 1, v: seg[b + 1] & 15 || 1, tq: seg[b + 2] });
        }
        const hmax = Math.max(...comps.map((c) => c.h));
        const vmax = Math.max(...comps.map((c) => c.v));
        const mcusX = Math.ceil(width / (8 * hmax));
        const mcusY = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          c.hmax = hmax;
          c.vmax = vmax;
          c.width = Math.ceil((width * c.h) / hmax);
          c.height = Math.ceil((height * c.v) / vmax);
          c.stride = mcusX * c.h * 8;
          c.plane = new Uint8Array(c.stride * mcusY * c.v * 8);
          c.bw = mcusX * c.h;
          c.bh = mcusY * c.v;
          if (marker === 0xc2) c.coefs = new Int16Array(c.bw * c.bh * 64);
        }
        frame = { width, height, comps, hmax, vmax, mcusX, mcusY, progressive: marker === 0xc2 };
        break;
      }
      case 0xc6:
      case 0xca:
      case 0xce:
        throw new Error('hierarchical or arithmetic-coded progressive JPEG is not supported');
      case 0xc3:
      case 0xc5:
      case 0xc7:
      case 0xc9:
      case 0xcb:
      case 0xcd:
      case 0xcf:
        throw new Error('lossless, hierarchical or arithmetic-coded JPEG is not supported');
      case 0xdd: // DRI
        restartInterval = seg.readUInt16BE(0);
        break;
      case 0xe1: // APP1: Exif
        if (seg.length > 6 && seg.toString('latin1', 0, 6) === 'Exif\0\0') {
          orientation = readExifOrientation(seg.subarray(6)) || orientation;
        }
        break;
      case 0xee: // APP14: Adobe
        if (seg.length >= 12 && seg.toString('latin1', 0, 5) === 'Adobe') adobe = { transform: seg[11] };
        break;
      case 0xda: { // SOS
        if (!frame) throw new Error('JPEG scan before frame header');
        const ns = seg[0];
        const scan = { ss: seg[1 + ns * 2], se: seg[2 + ns * 2], ah: seg[3 + ns * 2] >> 4, al: seg[3 + ns * 2] & 15 };
        const prog = frame.progressive;
        if (prog && (scan.ss > scan.se || scan.se > 63 || (scan.ss === 0 && scan.se !== 0) || (scan.ss > 0 && ns !== 1))) {
          throw new Error('JPEG progressive scan has invalid parameters');
        }
        const needDc = !prog || (scan.ss === 0 && scan.ah === 0);
        const needAc = !prog || scan.ss > 0;
        const scanComps = [];
        for (let k = 0; k < ns; k++) {
          const id = seg[1 + k * 2];
          const tables = seg[2 + k * 2];
          const c = frame.comps.find((x) => x.id === id);
          if (!c) throw new Error(`JPEG scan refers to unknown component ${id}`);
          c.dc = dcTables[tables >> 4];
          c.ac = acTables[tables & 15];
          c.qt = qts[c.tq];
          if ((needDc && !c.dc) || (needAc && !c.ac)) throw new Error('JPEG scan uses a Huffman table that was not defined');
          if (!prog && !c.qt) throw new Error('JPEG component uses a quantization table that was not defined');
          scanComps.push(c);
        }
        pos = decodeScan(buf, pos, frame, scanComps, restartInterval, scan);
        scans++;
        break;
      }
      default:
        break; // APPn, COM and others are skipped
    }
  }

  if (!frame) throw new Error('JPEG has no frame header');
  if (!scans) throw new Error('JPEG has no image data');
  if (frame.progressive) finishProgressive(frame, qts);

  const { width, height, comps } = frame;
  const planes = comps.map((c) => upsample(c, width, height));
  let channels;
  let data;
  if (comps.length === 1) {
    channels = 1;
    data = planes[0];
  } else if (comps.length === 3) {
    channels = 3;
    data = new Uint8Array(width * height * 3);
    const ids = comps.map((c) => c.id).join(',');
    const isRgb = adobe ? adobe.transform === 0 : ids === '82,71,66';
    if (isRgb) {
      const [R, G, B] = planes;
      for (let i = 0, o = 0; i < width * height; i++, o += 3) {
        data[o] = R[i];
        data[o + 1] = G[i];
        data[o + 2] = B[i];
      }
    } else {
      ycc(planes, width, height, data);
    }
  } else if (comps.length === 4) {
    channels = 3;
    data = new Uint8Array(width * height * 3);
    cmyk(planes, width, height, data, adobe ? adobe.transform : 0, !!adobe);
  } else {
    throw new Error(`JPEG with ${comps.length} components is not supported`);
  }

  // A plane returned by upsample may be a view into a larger buffer; copy so data is compact.
  if (data.byteOffset !== 0 || data.buffer.byteLength !== data.length) data = new Uint8Array(data);

  return { width, height, channels, data, orientation };
}

module.exports = { decodeJpeg, isJpeg, idct8x8 };
