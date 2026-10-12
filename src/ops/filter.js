'use strict';

const { assertImage } = require('../image');
const { dexp } = require('../detmath');

// Integer Gaussian kernel: weights sum to exactly 2^14.
function gaussianKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const f = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = dexp(-(i * i) / (2 * sigma * sigma));
    f.push(v);
    sum += v;
  }
  const ONE = 1 << 14;
  const k = f.map((v) => Math.round((v / sum) * ONE));
  k[r] += ONE - k.reduce((a, b) => a + b, 0);
  return { k, r, shift: 14 };
}

/** Separable Gaussian blur, edges clamped. Any channel count. */
function gaussianBlur(img, sigma = 1) {
  assertImage(img);
  if (!(sigma > 0)) return img;
  const { width: W, height: H, channels: ch, data } = img;
  const { k, r, shift } = gaussianKernel(sigma);
  const half = 1 << (shift - 1);
  const tmp = new Uint8Array(data.length);
  const out = new Uint8Array(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i < 0 ? 0 : x + i >= W ? W - 1 : x + i;
          acc += k[i + r] * data[(y * W + xx) * ch + c];
        }
        tmp[(y * W + x) * ch + c] = (acc + half) >> shift;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i < 0 ? 0 : y + i >= H ? H - 1 : y + i;
          acc += k[i + r] * tmp[(yy * W + x) * ch + c];
        }
        out[(y * W + x) * ch + c] = (acc + half) >> shift;
      }
    }
  }
  return { width: W, height: H, channels: ch, data: out };
}

// Shared square-window filter: `pick` receives the window values (sorted when needed).
function windowFilter(img, radius, kind) {
  assertImage(img);
  const { width: W, height: H, channels: ch, data } = img;
  const out = new Uint8Array(data.length);
  if (kind === 'min' || kind === 'max') {
    // Separable: a square min/max is a row pass then a column pass.
    const better = kind === 'min' ? (a, b) => (a < b ? a : b) : (a, b) => (a > b ? a : b);
    const tmp = new Uint8Array(data.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) {
      let v = data[(y * W + x) * ch + c];
      for (let i = Math.max(0, x - radius); i <= Math.min(W - 1, x + radius); i++) v = better(v, data[(y * W + i) * ch + c]);
      tmp[(y * W + x) * ch + c] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < ch; c++) {
      let v = tmp[(y * W + x) * ch + c];
      for (let i = Math.max(0, y - radius); i <= Math.min(H - 1, y + radius); i++) v = better(v, tmp[(i * W + x) * ch + c]);
      out[(y * W + x) * ch + c] = v;
    }
    return { width: W, height: H, channels: ch, data: out };
  }
  if (radius === 1) {
    // Small windows: insertion-sort up to 9 values.
    const win = new Int32Array(9);
    for (let c = 0; c < ch; c++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let n = 0;
          for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) {
            for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
              const v = data[(yy * W + xx) * ch + c];
              let j = n++;
              while (j > 0 && win[j - 1] > v) { win[j] = win[j - 1]; j--; }
              win[j] = v;
            }
          }
          out[(y * W + x) * ch + c] = win[(n - 1) >> 1];
        }
      }
    }
    return { width: W, height: H, channels: ch, data: out };
  }
  // Larger windows: a 256-bin histogram per window.
  const hist = new Int32Array(256);
  for (let c = 0; c < ch; c++) {
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(H - 1, y + radius);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(W - 1, x + radius);
        hist.fill(0);
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) hist[data[(yy * W + xx) * ch + c]]++;
        const n = (y1 - y0 + 1) * (x1 - x0 + 1);
        const half = (n - 1) >> 1; // lower median for even counts at the edges
        let acc = 0;
        let v = 0;
        while ((acc += hist[v]) <= half) v++;
        out[(y * W + x) * ch + c] = v;
      }
    }
  }
  return { width: W, height: H, channels: ch, data: out };
}

/** Median of the (2r+1)x(2r+1) window. */
const medianFilter = (img, radius = 1) => windowFilter(img, radius, 'median');
/** Minimum of the window (on dark-on-light line art this thickens lines). */
const minFilter = (img, radius = 1) => windowFilter(img, radius, 'min');
/** Maximum of the window (on dark-on-light line art this thins lines). */
const maxFilter = (img, radius = 1) => windowFilter(img, radius, 'max');

module.exports = { gaussianBlur, medianFilter, minFilter, maxFilter, gaussianKernel };
