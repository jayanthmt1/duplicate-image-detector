'use strict';

// Resize with area averaging when shrinking an axis and bilinear interpolation when enlarging.
// Each axis gets a list of integer taps, and the result is computed with exact integer sums
// (held in doubles, which are exact below 2^53) and one rounding at the end. No floating-point
// rounding is involved, so the output is the same everywhere.

const { assertImage } = require('../image');

// Taps for one axis: for output index i, source indices start[i] .. start[i]+count[i]-1 with
// integer weights; every output's weights sum to `denom`.
function axisTaps(src, dst) {
  const start = new Int32Array(dst);
  const count = new Int32Array(dst);
  const weights = [];
  const offsets = new Int32Array(dst);
  if (dst === src) {
    for (let i = 0; i < dst; i++) {
      start[i] = i; count[i] = 1; offsets[i] = i; weights.push(1);
    }
    return { start, count, offsets, weights: Int32Array.from(weights), denom: 1 };
  }
  if (dst < src) {
    // Output i covers [i*src, (i+1)*src) in units where source pixel j covers [j*dst, (j+1)*dst).
    for (let i = 0; i < dst; i++) {
      const lo = i * src;
      const hi = lo + src;
      const j0 = Math.floor(lo / dst);
      const j1 = Math.ceil(hi / dst) - 1;
      start[i] = j0;
      count[i] = j1 - j0 + 1;
      offsets[i] = weights.length;
      for (let j = j0; j <= j1; j++) {
        weights.push(Math.min(hi, (j + 1) * dst) - Math.max(lo, j * dst));
      }
    }
    return { start, count, offsets, weights: Int32Array.from(weights), denom: src };
  }
  // Enlarge: centre-aligned bilinear. Source position for output i is ((2i+1)*src - dst) / (2*dst).
  const d2 = 2 * dst;
  for (let i = 0; i < dst; i++) {
    const num = (2 * i + 1) * src - dst;
    offsets[i] = weights.length;
    if (num <= 0) {
      start[i] = 0; count[i] = 1; weights.push(d2);
      continue;
    }
    const j = Math.floor(num / d2);
    const frac = num - j * d2;
    if (j >= src - 1) {
      start[i] = src - 1; count[i] = 1; weights.push(d2);
    } else if (frac === 0) {
      start[i] = j; count[i] = 1; weights.push(d2);
    } else {
      start[i] = j; count[i] = 2; weights.push(d2 - frac, frac);
    }
  }
  return { start, count, offsets, weights: Int32Array.from(weights), denom: d2 };
}

// Exact floor(n / d) for non-negative integers held in doubles (guards against the quotient
// rounding up to the next integer).
function idiv(n, d) {
  let q = Math.floor(n / d);
  if (q * d > n) q--;
  else if ((q + 1) * d <= n) q++;
  return q;
}

/** Resize to exactly width x height (aspect ratio is not kept). Works for any channel count. */
function resize(img, width, height) {
  assertImage(img);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('resize: width and height must be positive integers');
  }
  const { width: sw, height: sh, channels: ch, data } = img;
  if (sw === width && sh === height) return { width, height, channels: ch, data: new Uint8Array(data) };

  const tx = axisTaps(sw, width);
  const ty = axisTaps(sh, height);

  // Horizontal pass: integer sums, one row of the intermediate per source row.
  const mid = new Float64Array(width * sh * ch);
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * ch;
    const rowOut = y * width * ch;
    for (let x = 0; x < width; x++) {
      const s0 = tx.start[x];
      const n = tx.count[x];
      const w0 = tx.offsets[x];
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let k = 0; k < n; k++) acc += tx.weights[w0 + k] * data[rowIn + (s0 + k) * ch + c];
        mid[rowOut + x * ch + c] = acc;
      }
    }
  }

  // Vertical pass and the single rounding: floor((2*sum + D) / (2*D)).
  const D = tx.denom * ty.denom;
  const out = new Uint8Array(width * height * ch);
  const rowLen = width * ch;
  const acc = new Float64Array(rowLen);
  for (let y = 0; y < height; y++) {
    acc.fill(0);
    const s0 = ty.start[y];
    const n = ty.count[y];
    const w0 = ty.offsets[y];
    for (let k = 0; k < n; k++) {
      const w = ty.weights[w0 + k];
      const r = (s0 + k) * rowLen;
      for (let i = 0; i < rowLen; i++) acc[i] += w * mid[r + i];
    }
    const o = y * rowLen;
    for (let i = 0; i < rowLen; i++) out[o + i] = idiv(2 * acc[i] + D, 2 * D);
  }
  return { width, height, channels: ch, data: out };
}

/** Shrink (never enlarge) so the long side is at most maxSide, keeping the aspect ratio. */
function limitSize(img, maxSide) {
  const { width, height } = img;
  const long = Math.max(width, height);
  if (long <= maxSide) return img;
  const w = Math.max(1, Math.round((width * maxSide) / long));
  const h = Math.max(1, Math.round((height * maxSide) / long));
  return resize(img, w, h);
}

module.exports = { resize, limitSize, axisTaps };
