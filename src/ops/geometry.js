'use strict';

const { assertImage } = require('../image');
const { dsin, dcos, degToRad } = require('../detmath');

/** Copy the rectangle (x, y, width, height); it must lie inside the image. */
function crop(img, x, y, width, height) {
  assertImage(img);
  const { width: W, height: H, channels: ch, data } = img;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > W || y + height > H) {
    throw new RangeError(`crop rectangle ${x},${y} ${width}x${height} is outside the ${W}x${H} image`);
  }
  const out = new Uint8Array(width * height * ch);
  for (let r = 0; r < height; r++) {
    const s = ((y + r) * W + x) * ch;
    out.set(data.subarray(s, s + width * ch), r * width * ch);
  }
  return { width, height, channels: ch, data: out };
}

/** Add borders. `background` is one value per channel (or one number for all); default white/opaque. */
function pad(img, { top = 0, right = 0, bottom = 0, left = 0, background = 255 } = {}) {
  assertImage(img);
  const { width: W, height: H, channels: ch, data } = img;
  const width = W + left + right;
  const height = H + top + bottom;
  const bg = Array.isArray(background) ? background : new Array(ch).fill(background);
  const out = new Uint8Array(width * height * ch);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < ch; c++) out[i * ch + c] = bg[c];
  for (let r = 0; r < H; r++) out.set(data.subarray(r * W * ch, (r + 1) * W * ch), ((top + r) * width + left) * ch);
  return { width, height, channels: ch, data: out };
}

/** Pad the short side so the image is square, content centred. */
function padToSquare(img, background = 255) {
  const { width: W, height: H } = img;
  if (W === H) return img;
  const d = Math.abs(W - H);
  const a = d >> 1;
  const b = d - a;
  return W > H ? pad(img, { top: a, bottom: b, background }) : pad(img, { left: a, right: b, background });
}

/**
 * Rotate clockwise by `degrees` (any angle) with bilinear interpolation. The canvas grows to hold
 * the whole result; uncovered areas get `background` (default white).
 */
function rotate(img, degrees, { background = 255 } = {}) {
  assertImage(img);
  const { width: W, height: H, channels: ch, data } = img;
  const t = degToRad(degrees);
  const cos = dcos(t);
  const sin = dsin(t);
  const ow = Math.max(1, Math.ceil(Math.abs(W * cos) + Math.abs(H * sin) - 1e-9));
  const oh = Math.max(1, Math.ceil(Math.abs(W * sin) + Math.abs(H * cos) - 1e-9));
  const bg = Array.isArray(background) ? background : new Array(ch).fill(background);
  const out = new Uint8Array(ow * oh * ch);
  const cx = W / 2;
  const cy = H / 2;
  const ocx = ow / 2;
  const ocy = oh / 2;
  const ONE = 1 << 16;
  const ONE2 = ONE * ONE;
  const rowStride = W * ch;
  for (let y = 0; y < oh; y++) {
    const dy = y + 0.5 - ocy;
    for (let x = 0; x < ow; x++) {
      const dx = x + 0.5 - ocx;
      // Inverse mapping: source position of this output pixel's centre.
      const sx = dx * cos + dy * sin + cx - 0.5;
      const sy = -dx * sin + dy * cos + cy - 0.5;
      const o = (y * ow + x) * ch;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= W || y0 >= H) {
        for (let c = 0; c < ch; c++) out[o + c] = bg[c];
        continue;
      }
      const fx = Math.round((sx - x0) * ONE);
      const fy = Math.round((sy - y0) * ONE);
      const w00 = (ONE - fx) * (ONE - fy);
      const w10 = fx * (ONE - fy);
      const w01 = (ONE - fx) * fy;
      const w11 = fx * fy;
      const s = y0 * rowStride + x0 * ch;
      if (x0 >= 0 && y0 >= 0 && x0 + 1 < W && y0 + 1 < H) {
        for (let c = 0; c < ch; c++) {
          const i = s + c;
          out[o + c] = Math.floor((data[i] * w00 + data[i + ch] * w10 + data[i + rowStride] * w01 + data[i + rowStride + ch] * w11 + ONE2 / 2) / ONE2);
        }
        continue;
      }
      // Edge pixels: neighbours outside the image take the background value.
      const in00 = x0 >= 0 && y0 >= 0;
      const in10 = x0 + 1 < W && y0 >= 0;
      const in01 = x0 >= 0 && y0 + 1 < H;
      const in11 = x0 + 1 < W && y0 + 1 < H;
      for (let c = 0; c < ch; c++) {
        const i = s + c;
        const p00 = in00 ? data[i] : bg[c];
        const p10 = in10 ? data[i + ch] : bg[c];
        const p01 = in01 ? data[i + rowStride] : bg[c];
        const p11 = in11 ? data[i + rowStride + ch] : bg[c];
        out[o + c] = Math.floor((p00 * w00 + p10 * w10 + p01 * w01 + p11 * w11 + ONE2 / 2) / ONE2);
      }
    }
  }
  return { width: ow, height: oh, channels: ch, data: out };
}

/**
 * Remove borders whose pixels are all within `tolerance` of the background (the median of the
 * four corner pixels). Works on 1-channel images. Returns the image unchanged if all is border.
 */
function trimBorder(img, tolerance = 16) {
  assertImage(img);
  if (img.channels !== 1) throw new TypeError('trimBorder expects a 1-channel image');
  const { width: W, height: H, data } = img;
  const corners = [data[0], data[W - 1], data[(H - 1) * W], data[H * W - 1]].sort((a, b) => a - b);
  const bg = (corners[1] + corners[2]) >> 1;
  const off = (i) => Math.abs(data[i] - bg) > tolerance;
  let top = 0;
  let bottom = H - 1;
  let left = 0;
  let right = W - 1;
  const rowHas = (y) => { for (let x = 0; x < W; x++) if (off(y * W + x)) return true; return false; };
  const colHas = (x, y0, y1) => { for (let y = y0; y <= y1; y++) if (off(y * W + x)) return true; return false; };
  while (top < H && !rowHas(top)) top++;
  if (top === H) return img;
  while (!rowHas(bottom)) bottom--;
  while (!colHas(left, top, bottom)) left++;
  while (!colHas(right, top, bottom)) right--;
  return crop(img, left, top, right - left + 1, bottom - top + 1);
}

module.exports = { crop, pad, padToSquare, rotate, trimBorder };
