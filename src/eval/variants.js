'use strict';

// Synthetic variants: realistic edits of an image that should still count as "the same picture".
// Used to build evaluation sets from any folder of images. Seeded, so runs are repeatable.

const { assertImage } = require('../image');
const { flatten } = require('../ops/color');
const { resize } = require('../ops/resize');
const { crop, pad, rotate } = require('../ops/geometry');
const { gaussianBlur, minFilter, maxFilter } = require('../ops/filter');
const { prng } = require('../detmath');
const { toGray } = require('../ops/color');
const { binarizeOtsu } = require('../normalize/binarize');
const { thin } = require('../normalize/morph');

// Thinner strokes that never vanish: lighten with a max filter, but keep each stroke's
// one-pixel skeleton at its original darkness.
function thinner(img, r) {
  const lighter = maxFilter(img, r);
  const mask = binarizeOtsu(toGray(img));
  if (mask.threshold < 0) return lighter;
  const skel = thin(mask);
  const ch = img.channels;
  const out = new Uint8Array(lighter.data);
  for (let i = 0; i < skel.data.length; i++) {
    if (skel.data[i]) for (let c = 0; c < ch; c++) out[i * ch + c] = img.data[i * ch + c];
  }
  return { ...lighter, data: out };
}

const VARIANT_KINDS = [
  'resize-down', 'resize-up', 'margin', 'crop', 'noise', 'grey-background',
  'blur', 'rotate', 'thicker', 'thinner', 'scan-like',
];

const between = (rnd, a, b) => a + (b - a) * rnd();

function addNoise(img, rnd, sigma = 10, saltPepper = 0.001) {
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i++) {
    // Irwin-Hall: the sum of 4 uniforms is close to normal (variance 4/12).
    const n = (rnd() + rnd() + rnd() + rnd() - 2) * sigma * Math.sqrt(3);
    const v = Math.round(out[i] + n);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  const px = img.width * img.height;
  const ch = img.channels;
  for (let k = Math.round(px * saltPepper); k > 0; k--) {
    const p = Math.floor(rnd() * px);
    const v = rnd() < 0.5 ? 0 : 255;
    for (let c = 0; c < ch; c++) out[p * ch + c] = v;
  }
  return { ...img, data: out };
}

function greyBackground(img, rnd) {
  const tone = between(rnd, 200, 228);
  const gx = between(rnd, -15, 15);
  const gy = between(rnd, -15, 15);
  const { width: W, height: H, channels: ch } = img;
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = tone + (gx * (x - W / 2)) / W + (gy * (y - H / 2)) / H;
      for (let c = 0; c < ch; c++) {
        const i = (y * W + x) * ch + c;
        out[i] = Math.max(0, Math.min(255, Math.round((img.data[i] * t) / 255)));
      }
    }
  }
  return { ...img, data: out };
}

/** One variant of `img`. `rnd` is a function returning [0, 1); default is seeded from 1. */
function makeVariant(img, kind, rnd = prng(1)) {
  assertImage(img);
  const base = flatten(img);
  const { width: W, height: H } = base;
  const long = Math.max(W, H);
  const strokeR = Math.max(1, Math.round(long / 500));
  switch (kind) {
    case 'resize-down': {
      const s = between(rnd, 0.5, 0.75);
      return resize(base, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
    }
    case 'resize-up': {
      const s = between(rnd, 1.3, 1.7);
      return resize(base, Math.round(W * s), Math.round(H * s));
    }
    case 'margin': {
      const m = () => Math.round(long * between(rnd, 0.03, 0.15));
      return pad(base, { top: m(), right: m(), bottom: m(), left: m() });
    }
    case 'crop': {
      const cx = () => Math.floor(W * between(rnd, 0, 0.04));
      const cy = () => Math.floor(H * between(rnd, 0, 0.04));
      const l = cx(), r = cx(), t = cy(), b = cy();
      if (W - l - r < 2 || H - t - b < 2) return base;
      return crop(base, l, t, W - l - r, H - t - b);
    }
    case 'noise':
      return addNoise(base, rnd);
    case 'grey-background':
      return greyBackground(base, rnd);
    case 'blur':
      return gaussianBlur(base, between(rnd, 0.8, 1.5));
    case 'rotate': {
      const a = between(rnd, 0.5, 3) * (rnd() < 0.5 ? -1 : 1);
      return rotate(base, a);
    }
    case 'thicker':
      return minFilter(base, strokeR);
    case 'thinner':
      return thinner(base, strokeR);
    case 'scan-like': {
      let v = greyBackground(base, rnd);
      v = rotate(v, between(rnd, 0.3, 1.5) * (rnd() < 0.5 ? -1 : 1), { background: v.data[0] });
      v = gaussianBlur(v, 0.7);
      return addNoise(v, rnd, 6, 0.0005);
    }
    default:
      throw new Error(`unknown variant kind '${kind}' (available: ${VARIANT_KINDS.join(', ')})`);
  }
}

/** All requested variants of one image: [{ kind, image }]. */
function variants(img, { kinds = VARIANT_KINDS, seed = 1 } = {}) {
  const rnd = prng(seed);
  return kinds.map((kind) => ({ kind, image: makeVariant(img, kind, rnd) }));
}

/**
 * Build an evaluation set from originals (decoded images, or anything `decode` accepts):
 *   same:   { a: original i, b: variant of i, kind }
 *   random: { a: original i, b: variant of another image j }
 * Variants are made once per image and shared by both sets.
 */
function makeEvalSet(images, { kinds = VARIANT_KINDS, seed = 1, randomPairs = 1000, decode } = {}) {
  const rnd = prng(seed);
  const originals = images.map((x) => (decode ? decode(x) : x));
  const vars = originals.map((img, i) => variants(img, { kinds, seed: seed * 7919 + i }));
  const same = [];
  originals.forEach((img, i) => vars[i].forEach((v) => same.push({ a: img, b: v.image, kind: v.kind })));
  const random = [];
  const n = originals.length;
  if (n >= 2) {
    for (let k = 0; k < randomPairs; k++) {
      const i = Math.floor(rnd() * n);
      let j = Math.floor(rnd() * (n - 1));
      if (j >= i) j++;
      const v = vars[j][Math.floor(rnd() * vars[j].length)];
      random.push({ a: originals[i], b: v.image, kind: v.kind });
    }
  }
  return { same, random };
}

module.exports = { variants, makeVariant, makeEvalSet, VARIANT_KINDS };
