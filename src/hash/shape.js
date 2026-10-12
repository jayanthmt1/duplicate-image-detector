'use strict';

// Shape features: chamfer distance between ink maps, and an edge-orientation histogram grid.

const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { nibble } = require('./bits');
const { dsin, dcos, PI } = require('../detmath');
const { vectorSimilarity } = require('./signature');

const HEX = '0123456789abcdef';
const INF = 1e20;

// ---------------------------------------------------------------- distance transform
// Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions" (2012): exact squared
// Euclidean distance via the lower envelope of parabolas, one dimension at a time.

function dt1d(f, n, d, v, z) {
  // f holds 0 or INF (finite), so every intersection s is finite and stops at z[0] = -Infinity.
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let r = v[k];
    let s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    while (s <= z[k]) {
      k--;
      r = v[k];
      s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest ink pixel of a mask
 * { width, height, data } (1 = ink). Returns a Float64Array; INF (1e20) where there is no ink.
 */
function distanceTransform(mask) {
  const { width: W, height: H, data } = mask;
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const out = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = data[i] ? 0 : INF;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = out[y * W + x];
    dt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    dt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = d[x] >= INF / 2 ? INF : d[x];
  }
  return out;
}

// ---------------------------------------------------------------- chamfer

function hexToMask(hex) {
  const n = hex.length * 4;
  const size = Math.round(Math.sqrt(n));
  const data = new Uint8Array(n);
  for (let i = 0; i < hex.length; i++) {
    const v = nibble(hex[i]);
    data[4 * i] = (v >> 3) & 1; data[4 * i + 1] = (v >> 2) & 1; data[4 * i + 2] = (v >> 1) & 1; data[4 * i + 3] = v & 1;
  }
  return { width: size, height: size, data };
}

/** size x size ink map (cell average gray below `threshold` is ink), as hex. */
function inkMapHex(img, size, threshold = 240) {
  const g = resize(toGray(img), size, size).data;
  let hex = '';
  for (let i = 0; i < g.length; i += 4) {
    hex += HEX[((g[i] < threshold) << 3) | ((g[i + 1] < threshold) << 2) | ((g[i + 2] < threshold) << 1) | (g[i + 3] < threshold)];
  }
  return hex;
}

const chamferMap = (img) => inkMapHex(img, 64);

// Mean distance (in cells, capped at `cap`) from each ink cell of a to the nearest ink of b.
function directed(a, dtB, cap) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (!a.data[i]) continue;
    const d = Math.sqrt(dtB[i]);
    sum += d < cap ? d : cap;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Symmetric truncated chamfer distance between two ink maps (hex), in cells, turned into a
 * similarity 1 / (1 + d): 1 = every ink cell of each map lies on ink of the other.
 */
function chamferSimilarity(hexA, hexB, cap = 8) {
  if (hexA.length !== hexB.length) throw new RangeError('ink map sizes differ');
  const a = hexToMask(hexA);
  const b = hexToMask(hexB);
  const inkA = a.data.some((x) => x);
  const inkB = b.data.some((x) => x);
  if (!inkA || !inkB) return inkA === inkB ? 1 : 0;
  const d = (directed(a, distanceTransform(b), cap) + directed(b, distanceTransform(a), cap)) / 2;
  return 1 / (1 + d);
}

/** Chamfer similarity of two images (after converting to 64 x 64 ink maps). */
function chamfer(imgA, imgB) {
  return chamferSimilarity(chamferMap(imgA), chamferMap(imgB));
}

// ---------------------------------------------------------------- edge-orientation histogram

const BINS = 8;
const GRID = 4;
const EDGE_SIZE = 128;
// Unit vectors at the bin boundaries 22.5, 45, ..., 157.5 degrees (deterministic sin/cos).
const BOUNDS = Array.from({ length: BINS - 1 }, (_, i) => {
  const t = ((i + 1) * PI) / BINS;
  return [dcos(t), dsin(t)];
});

/**
 * Edge-orientation histogram grid: Sobel gradients on a 128 x 128 version of the image, each
 * gradient's |gx| + |gy| added to one of 8 orientation bins (0-180 degrees) in one of 4 x 4 cells.
 * All 128 values are scaled so the largest is 255. Returned as 256 hex digits.
 */
function edgeHistogram(img) {
  const g = resize(toGray(img), EDGE_SIZE, EDGE_SIZE).data;
  const S = EDGE_SIZE;
  const hist = new Float64Array(GRID * GRID * BINS);
  const cell = S / GRID;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const tl = g[i - S - 1], tc = g[i - S], tr = g[i - S + 1];
      const ml = g[i - 1], mr = g[i + 1];
      const bl = g[i + S - 1], bc = g[i + S], br = g[i + S + 1];
      let gx = tr + 2 * mr + br - tl - 2 * ml - bl;
      let gy = bl + 2 * bc + br - tl - 2 * tc - tr;
      const mag = Math.abs(gx) + Math.abs(gy);
      if (!mag) continue;
      // Fold the direction into [0, 180).
      if (gy < 0 || (gy === 0 && gx < 0)) {
        gx = -gx;
        gy = -gy;
      }
      let bin = 0;
      for (const [c, s] of BOUNDS) if (gy * c - gx * s > 0) bin++;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      hist[(cy * GRID + cx) * BINS + bin] += mag;
    }
  }
  let max = 0;
  for (const v of hist) if (v > max) max = v;
  let hex = '';
  for (const v of hist) {
    const q = max ? Math.floor((2 * v * 255 + max) / (2 * max)) : 0;
    hex += HEX[q >> 4] + HEX[q & 15];
  }
  return hex;
}

function edgeSimilarity(a, b) {
  const bytes = (h) => {
    const out = new Uint8Array(h.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = (nibble(h[2 * i]) << 4) | nibble(h[2 * i + 1]);
    return out;
  };
  return vectorSimilarity(bytes(a), bytes(b));
}

module.exports = { distanceTransform, chamfer, chamferMap, chamferSimilarity, edgeHistogram, edgeSimilarity };
