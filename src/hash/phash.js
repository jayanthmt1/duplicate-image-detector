'use strict';

// Perceptual hash: shrink to 32x32, 2-D DCT, keep the 8x8 lowest frequencies after the DC row and
// column (u, v = 1..8), and set a bit for each coefficient above their median.
// The DCT uses integer cosines (scaled by 2^14), so every sum is an exact integer.

const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { bitsToHex } = require('./bits');
const { dcos, PI } = require('../detmath');

const N = 32;
const COS = []; // COS[u][n] for u = 1..8
for (let u = 1; u <= 8; u++) {
  const row = new Int32Array(N);
  for (let n = 0; n < N; n++) row[n] = Math.round(dcos((PI * (2 * n + 1) * u) / (2 * N)) * 16384);
  COS.push(row);
}

function phash64(img) {
  const g = resize(toGray(img), N, N).data;
  // Rows: R[y][u] = sum_x g[y][x] * cos_u(x)
  const R = new Float64Array(N * 8);
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < 8; u++) {
      const c = COS[u];
      let acc = 0;
      for (let x = 0; x < N; x++) acc += g[y * N + x] * c[x];
      R[y * 8 + u] = acc;
    }
  }
  // Columns: D[v][u] = sum_y R[y][u] * cos_v(y)   (|D| < 2^53, exact)
  const D = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    const c = COS[v];
    for (let u = 0; u < 8; u++) {
      let acc = 0;
      for (let y = 0; y < N; y++) acc += R[y * 8 + u] * c[y];
      D[v * 8 + u] = acc;
    }
  }
  const sorted = Array.from(D).sort((a, b) => a - b);
  const twiceMedian = sorted[31] + sorted[32];
  const bits = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bits[i] = 2 * D[i] > twiceMedian ? 1 : 0;
  return bitsToHex(bits);
}

module.exports = { phash64 };
