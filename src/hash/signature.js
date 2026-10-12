'use strict';

// Vector signatures, stored as hex strings and compared by normalised L2 distance.

const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { nibble } = require('./bits');

const HEX = '0123456789abcdef';

// ---------------------------------------------------------------- Goldberg signature
// H. Chi Wong, M. Bern, D. Goldberg, "An image signature for any kind of image" (ICIP 2002).
// 9x9 grid of patch means inside the content area, each compared with its 8 neighbours, and each
// difference quantised to -2..2 ("much darker" .. "much lighter"). 648 values, packed in base 5.

const GRID = 9;
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Rows/columns between the 5th and 95th percentile of cumulative absolute differences.
function contentRange(sums) {
  const total = sums.reduce((a, b) => a + b, 0);
  if (!total) return [0, sums.length - 1];
  let acc = 0;
  let lo = 0;
  while (lo < sums.length - 1 && (acc += sums[lo]) < total * 0.05) lo++;
  acc = 0;
  let hi = sums.length - 1;
  while (hi > lo && (acc += sums[hi]) < total * 0.05) hi--;
  return [lo, hi];
}

function goldberg(img) {
  const g = toGray(img);
  const { width: W, height: H, data } = g;
  const rowSums = new Array(H).fill(0);
  const colSums = new Array(W).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = data[y * W + x];
      if (x + 1 < W) rowSums[y] += Math.abs(v - data[y * W + x + 1]);
      if (y + 1 < H) colSums[x] += Math.abs(v - data[(y + 1) * W + x]);
    }
  }
  const [y0, y1] = contentRange(rowSums);
  const [x0, x1] = contentRange(colSums);
  const cw = x1 - x0 + 1;
  const chh = y1 - y0 + 1;
  const P = Math.max(2, Math.floor(0.5 + Math.min(cw, chh) / 20));
  const xs = [];
  const ys = [];
  for (let i = 1; i <= GRID; i++) {
    xs.push(x0 + Math.floor((i * cw) / (GRID + 1)));
    ys.push(y0 + Math.floor((i * chh) / (GRID + 1)));
  }
  // Mean gray of the P x P patch around each grid point (clipped to the image).
  const means = new Float64Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const px0 = Math.max(0, xs[i] - (P >> 1));
      const py0 = Math.max(0, ys[j] - (P >> 1));
      const px1 = Math.min(W - 1, px0 + P - 1);
      const py1 = Math.min(H - 1, py0 + P - 1);
      let s = 0;
      for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) s += data[y * W + x];
      means[j * GRID + i] = s / ((px1 - px0 + 1) * (py1 - py0 + 1));
    }
  }
  const diffs = new Float64Array(GRID * GRID * 8);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      NEIGHBOURS.forEach(([dx, dy], k) => {
        const ii = i + dx;
        const jj = j + dy;
        const inside = ii >= 0 && jj >= 0 && ii < GRID && jj < GRID;
        diffs[(j * GRID + i) * 8 + k] = inside ? means[jj * GRID + ii] - means[j * GRID + i] : 0;
      });
    }
  }
  const pos = [];
  const neg = [];
  for (const d of diffs) {
    if (d > 2) pos.push(d);
    else if (d < -2) neg.push(d);
  }
  pos.sort((a, b) => a - b);
  neg.sort((a, b) => a - b);
  const posMid = pos.length ? pos[pos.length >> 1] : Infinity;
  const negMid = neg.length ? neg[(neg.length - 1) >> 1] : -Infinity;
  const values = new Uint8Array(diffs.length);
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    let q = 0;
    if (d > 2) q = d >= posMid ? 2 : 1;
    else if (d < -2) q = d <= negMid ? -2 : -1;
    values[i] = q + 2;
  }
  // Pack three base-5 values per byte (125 < 256).
  let hex = '';
  for (let i = 0; i < values.length; i += 3) {
    const b = values[i] * 25 + values[i + 1] * 5 + values[i + 2];
    hex += HEX[b >> 4] + HEX[b & 15];
  }
  return hex;
}

function unpackGoldberg(hex) {
  const out = new Int8Array((hex.length / 2) * 3);
  for (let i = 0, k = 0; i < hex.length; i += 2) {
    const b = (nibble(hex[i]) << 4) | nibble(hex[i + 1]);
    out[k++] = Math.floor(b / 25) - 2;
    out[k++] = (Math.floor(b / 5) % 5) - 2;
    out[k++] = (b % 5) - 2;
  }
  return out;
}

// ---------------------------------------------------------------- ink density grid

/** Ink density on a size x size grid (0 = paper, 255 = solid ink), one hex byte per cell. */
function inkGrid(img, size = 16) {
  const g = resize(toGray(img), size, size).data;
  let hex = '';
  for (let i = 0; i < g.length; i++) {
    const v = 255 - g[i];
    hex += HEX[v >> 4] + HEX[v & 15];
  }
  return hex;
}

function hexBytes(hex) {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (nibble(hex[2 * i]) << 4) | nibble(hex[2 * i + 1]);
  return out;
}

/** 1 - |a - b| / (|a| + |b|): 1 = identical, 0 = as different as possible. */
function vectorSimilarity(a, b) {
  if (a.length !== b.length) throw new RangeError('signature lengths differ');
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += (a[i] - b[i]) * (a[i] - b[i]);
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) + Math.sqrt(nb);
  return den ? 1 - Math.sqrt(d) / den : 1;
}

const goldbergSimilarity = (a, b) => vectorSimilarity(unpackGoldberg(a), unpackGoldberg(b));
const inkGridSimilarity = (a, b) => vectorSimilarity(hexBytes(a), hexBytes(b));

// ---------------------------------------------------------------- ink map (for overlap)

/** 32x32 bit map: a cell is ink when its average gray is below 240. */
function inkMap(img, size = 32, threshold = 240) {
  const g = resize(toGray(img), size, size).data;
  let hex = '';
  for (let i = 0; i < g.length; i += 4) {
    const v = ((g[i] < threshold) << 3) | ((g[i + 1] < threshold) << 2) | ((g[i + 2] < threshold) << 1) | (g[i + 3] < threshold);
    hex += HEX[v];
  }
  return hex;
}

/**
 * Ink overlap with tolerance: the share of each map's ink cells that have ink in the other map
 * within `tolerance` cells, combined as an F1 score (1 = same, 0 = no overlap).
 */
function inkOverlap(hexA, hexB, tolerance = 1) {
  if (hexA.length !== hexB.length) throw new RangeError('ink map sizes differ');
  const n = hexA.length * 4;
  const size = Math.round(Math.sqrt(n));
  const bits = (hex) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < hex.length; i++) {
      const v = nibble(hex[i]);
      out[4 * i] = (v >> 3) & 1; out[4 * i + 1] = (v >> 2) & 1; out[4 * i + 2] = (v >> 1) & 1; out[4 * i + 3] = v & 1;
    }
    return out;
  };
  const grow = (m) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!m[y * size + x]) continue;
      for (let yy = Math.max(0, y - tolerance); yy <= Math.min(size - 1, y + tolerance); yy++) {
        for (let xx = Math.max(0, x - tolerance); xx <= Math.min(size - 1, x + tolerance); xx++) out[yy * size + xx] = 1;
      }
    }
    return out;
  };
  const a = bits(hexA);
  const b = bits(hexB);
  const ga = grow(a);
  const gb = grow(b);
  let na = 0, nb = 0, ha = 0, hb = 0;
  for (let i = 0; i < n; i++) {
    if (a[i]) { na++; if (gb[i]) ha++; }
    if (b[i]) { nb++; if (ga[i]) hb++; }
  }
  if (!na || !nb) return na === nb ? 1 : 0;
  const p = ha / na;
  const r = hb / nb;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

module.exports = { goldberg, goldbergSimilarity, inkGrid, inkGridSimilarity, inkMap, inkOverlap, vectorSimilarity };
