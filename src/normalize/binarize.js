'use strict';

// Binarisation of 1-channel images. Results are masks: { width, height, data } with 1 = ink.

const { resize } = require('../ops/resize');

/** Otsu's threshold on a 1-channel image: pixels <= t are ink. Returns -1 for a flat image. */
function otsuThreshold(img, minContrast = 32) {
  const { data } = img;
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let lo = 0;
  let hi = 255;
  while (lo < 255 && !hist[lo]) lo++;
  while (hi > 0 && !hist[hi]) hi--;
  if (hi - lo < minContrast) return -1;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let t = -1;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const d = sumB / wB - (sum - sumB) / wF;
    const between = wB * wF * d * d;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

function binarizeOtsu(img, opts = {}) {
  const t = otsuThreshold(img, opts.minContrast);
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  if (t >= 0) for (let i = 0; i < out.length; i++) out[i] = data[i] <= t ? 1 : 0;
  return { width, height, data: out, threshold: t };
}

/**
 * Sauvola local thresholding: ink where p <= m * (1 + k * (s / R - 1)), with m and s the mean and
 * standard deviation over a window. A pixel must also be darker than `maxInk` (default 200), so
 * flat paper never turns into ink.
 */
function binarizeSauvola(img, { window, k = 0.2, R = 128, maxInk = 200 } = {}) {
  const { width: W, height: H, data } = img;
  const w = window ?? Math.max(15, (Math.round(Math.max(W, H) / 40) | 1));
  const r = w >> 1;
  // Integral images of values and squares (exact integers in doubles).
  const S = new Float64Array((W + 1) * (H + 1));
  const Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < W; x++) {
      const v = data[y * W + x];
      rs += v;
      rq += v * v;
      const i = (y + 1) * (W + 1) + x + 1;
      S[i] = S[i - W - 1] + rs;
      Q[i] = Q[i - W - 1] + rq;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const v = data[y * W + x];
      if (v > maxInk) continue;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const a = y1 * (W + 1) + x1;
      const b = y0 * (W + 1) + x1;
      const c = y1 * (W + 1) + x0;
      const d = y0 * (W + 1) + x0;
      const sum = S[a] - S[b] - S[c] + S[d];
      const sq = Q[a] - Q[b] - Q[c] + Q[d];
      const m = sum / n;
      const s = Math.sqrt(Math.max(0, sq / n - m * m));
      if (v <= m * (1 + k * (s / R - 1))) out[y * W + x] = 1;
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * Remove uneven paper shading: estimate the background as the bright (90th percentile) level of
 * each block, smooth it by bilinear enlargement, and divide it out so paper becomes white.
 */
function removeBackground(img, { block } = {}) {
  const { width: W, height: H, data } = img;
  const b = block ?? Math.max(16, Math.round(Math.max(W, H) / 16));
  const gw = Math.max(1, Math.round(W / b));
  const gh = Math.max(1, Math.round(H / b));
  const grid = new Uint8Array(gw * gh);
  const hist = new Int32Array(256);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * H) / gh);
    const y1 = Math.floor(((gy + 1) * H) / gh);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * W) / gw);
      const x1 = Math.floor(((gx + 1) * W) / gw);
      hist.fill(0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[data[y * W + x]]++;
      const n = (y1 - y0) * (x1 - x0);
      const target = Math.floor(n * 0.9);
      let acc = 0;
      let v = 0;
      while (v < 255 && (acc += hist[v]) <= target) v++;
      grid[gy * gw + gx] = v;
    }
  }
  const bg = resize({ width: gw, height: gh, channels: 1, data: grid }, W, H).data;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    const g = Math.max(1, bg[i]);
    const v = Math.floor((data[i] * 255 + (g >> 1)) / g);
    out[i] = v > 255 ? 255 : v;
  }
  return { width: W, height: H, channels: 1, data: out };
}

module.exports = { otsuThreshold, binarizeOtsu, binarizeSauvola, removeBackground };
