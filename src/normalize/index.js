'use strict';

// Normalisation presets. Each turns a decoded image into the 1-channel image that the perceptual
// hashes and signatures are computed from.
//
//   none     grayscale only (full size)
//   photo    grayscale, shrink to <= 1024 px, trim flat borders
//   lineart  grayscale, shrink, Otsu ink mask, drop specks, trim to the ink, resample to
//            256 x 256 keeping thin lines; black ink on white
//   scan     like lineart, plus paper-shade removal, Sauvola thresholding and deskew (+/- 5 deg)
//
// Defaults were chosen with scripts/eval-folder.js on 300 exam images x 11 synthetic variants.
// Stretching the trimmed ink to the square grid ("square: false") beat padding it to a square
// (padding leaves rows of the hash grid empty); a 3x3 median ("denoise") erased one-pixel lines;
// stroke normalisation gave no measurable gain.

const { assertImage } = require('../image');
const { toGray } = require('../ops/color');
const { limitSize } = require('../ops/resize');
const { trimBorder, rotate } = require('../ops/geometry');
const { medianFilter } = require('../ops/filter');
const { binarizeOtsu, binarizeSauvola, removeBackground } = require('./binarize');
const { removeSpeckles, inkBox, cropMask, padMaskToSquare, thin, dilate, poolMask, maskToImage } = require('./morph');
const { estimateSkew } = require('./deskew');

const PRESETS = {
  none: {},
  photo: { maxSide: 1024, trimBorder: 16 },
  lineart: {
    maxSide: 1024, background: false, denoise: false, binarize: 'otsu', deskew: false,
    speckle: 3, square: false, size: 256, stroke: 'keep', strokeWidth: 3,
  },
  scan: {
    maxSide: 1024, background: true, denoise: false, binarize: 'sauvola', deskew: true,
    speckle: 'auto', square: false, size: 256, stroke: 'keep', strokeWidth: 3,
  },
};

const KNOWN_OPTIONS = new Set(['maxSide', 'trimBorder', 'background', 'denoise', 'binarize', 'deskew', 'speckle', 'square', 'size', 'stroke', 'strokeWidth']);

function resolve(preset, overrides) {
  if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) {
    throw new Error(`unknown preset '${preset}' (available: ${Object.keys(PRESETS).join(', ')})`);
  }
  for (const k of Object.keys(overrides || {})) if (!KNOWN_OPTIONS.has(k)) throw new Error(`unknown normalise option '${k}'`);
  return { ...PRESETS[preset], ...(overrides || {}) };
}

function binarize(gray, method) {
  if (method === 'sauvola') return binarizeSauvola(gray);
  if (method === 'otsu') return binarizeOtsu(gray);
  throw new Error(`unknown binarisation '${method}'`);
}

/**
 * Normalise an image with a preset. `overrides` changes individual preset options.
 * With { details: true } returns { image, details } where details records what was done.
 */
function normalize(img, preset = 'none', overrides, { details: wantDetails = false } = {}) {
  assertImage(img);
  const o = resolve(preset, overrides);
  const details = { preset };
  let gray = toGray(img);
  if (preset === 'none' && !overrides) return wantDetails ? { image: gray, details } : gray;

  if (o.maxSide) gray = limitSize(gray, o.maxSide);

  if (!o.binarize) {
    if (o.trimBorder !== undefined && o.trimBorder !== false) gray = trimBorder(gray, o.trimBorder);
    details.size = [gray.width, gray.height];
    return wantDetails ? { image: gray, details } : gray;
  }

  if (o.background) gray = removeBackground(gray);
  if (o.denoise) gray = medianFilter(gray, 1);
  let mask = binarize(gray, o.binarize);

  if (o.deskew) {
    const angle = estimateSkew(mask);
    details.skew = angle;
    if (Math.abs(angle) >= 0.2) {
      gray = rotate(gray, -angle);
      mask = binarize(gray, o.binarize);
    }
  }

  const long = Math.max(mask.width, mask.height);
  const speckle = o.speckle === 'auto' ? Math.max(4, Math.round(long / 128)) : o.speckle || 0;
  mask = removeSpeckles(mask, speckle);

  const box = inkBox(mask);
  details.box = box;
  const size = o.size;
  if (!box) {
    const blank = { width: size, height: size, channels: 1, data: new Uint8Array(size * size).fill(255) };
    details.blank = true;
    return wantDetails ? { image: blank, details } : blank;
  }
  mask = cropMask(mask, box);
  if (o.square) mask = padMaskToSquare(mask);
  if (o.stroke === 'normalize') {
    mask = thin(padBorder(mask));
    mask = poolMask(mask, size);
    mask = dilate(mask, Math.max(0, (o.strokeWidth - 1) >> 1));
  } else if (o.stroke === 'keep') {
    mask = poolMask(mask, size);
  } else {
    throw new Error(`unknown stroke option '${o.stroke}' (use 'keep' or 'normalize')`);
  }
  const image = maskToImage(mask);
  return wantDetails ? { image, details } : image;
}

// Thinning leaves the outermost pixels alone, so give the mask a one-pixel paper margin.
function padBorder(mask) {
  const W = mask.width + 2;
  const H = mask.height + 2;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < mask.height; y++) out.set(mask.data.subarray(y * mask.width, (y + 1) * mask.width), (y + 1) * W + 1);
  return { width: W, height: H, data: out };
}

/** Stable text form of preset + overrides, stored in fingerprints. */
function presetId(preset, overrides) {
  if (!overrides || !Object.keys(overrides).length) return preset;
  const keys = Object.keys(overrides).sort();
  return `${preset}(${keys.map((k) => `${k}=${overrides[k]}`).join(',')})`;
}

module.exports = { normalize, presetId, PRESETS, resolve };
