'use strict';

const { toBuffer } = require('./image');
const { decode } = require('./decode');
const { normalize, presetId, PRESETS: PRESET_TABLE } = require('./normalize');
const { fileSha, pixelSha } = require('./hash/sha');
const { dhash } = require('./hash/dhash');
const { ahash64 } = require('./hash/ahash');
const { phash64 } = require('./hash/phash');
const { goldberg, goldbergSimilarity, inkGrid, inkGridSimilarity, inkMap, inkOverlap } = require('./hash/signature');
const { hammingSimilarity } = require('./hash/bits');
const { chamferMap, chamferSimilarity, edgeHistogram, edgeSimilarity } = require('./hash/shape');

// Bump when any method's output changes for the same input and preset. Adding a new method does
// not change existing outputs and does not need a bump.
const FINGERPRINT_VERSION = 1;

// kind: 'exact' -> compared for equality; anything else -> similarity in [0, 1].
// source: 'file' (raw bytes), 'pixels' (decoded image), 'norm' (preset-normalised image).
const METHODS = {
  fileSha: { kind: 'exact', source: 'file', compute: fileSha },
  pixelSha: { kind: 'exact', source: 'pixels', compute: pixelSha },
  ahash64: { kind: 'bits', source: 'norm', compute: ahash64, compare: hammingSimilarity },
  dhash64: { kind: 'bits', source: 'norm', compute: (img) => dhash(img, 8, 8), compare: hammingSimilarity },
  dhash256: { kind: 'bits', source: 'norm', compute: (img) => dhash(img, 16, 16), compare: hammingSimilarity },
  phash64: { kind: 'bits', source: 'norm', compute: phash64, compare: hammingSimilarity },
  goldberg: { kind: 'signature', source: 'norm', compute: goldberg, compare: goldbergSimilarity },
  ink16: { kind: 'signature', source: 'norm', compute: (img) => inkGrid(img, 16), compare: inkGridSimilarity },
  inkmap32: { kind: 'map', source: 'norm', compute: (img) => inkMap(img, 32), compare: (a, b) => inkOverlap(a, b, 1) },
  chamfer64: { kind: 'map', source: 'norm', compute: chamferMap, compare: (a, b) => chamferSimilarity(a, b) },
  edgehist: { kind: 'signature', source: 'norm', compute: edgeHistogram, compare: edgeSimilarity },
};

const ALL_METHODS = Object.keys(METHODS);
const DEFAULT_METHODS = ['fileSha', 'pixelSha', 'dhash64'];
const PRESETS = Object.keys(PRESET_TABLE);

function isRawImage(input) {
  return input && typeof input === 'object' && !(input instanceof Uint8Array) && !(input instanceof ArrayBuffer) && 'data' in input;
}

/**
 * Fingerprint an image. `input` is an encoded file (Buffer/Uint8Array/ArrayBuffer) or a raw
 * image { width, height, channels, data }. Returns plain values for the caller to store:
 * { v, preset, w, h, ...one entry per method }.
 * Options: methods, preset ('none' | 'photo' | 'lineart' | 'scan'), normalize (preset overrides),
 * plus decode options.
 */
function fingerprint(input, opts = {}) {
  return fingerprintDetailed(input, opts).fp;
}

// Also returns the decoded and normalised images (used by the evaluation harness).
function fingerprintDetailed(input, opts = {}) {
  const methods = opts.methods ?? DEFAULT_METHODS;
  const preset = opts.preset ?? 'none';
  if (!PRESETS.includes(preset)) throw new Error(`unknown preset '${preset}' (available: ${PRESETS.join(', ')})`);
  for (const m of methods) if (!METHODS[m]) throw new Error(`unknown method '${m}' (available: ${ALL_METHODS.join(', ')})`);

  const raw = isRawImage(input);
  const buf = raw ? null : toBuffer(input);
  const img = decode(raw ? input : buf, opts);
  const fp = { v: FINGERPRINT_VERSION, preset: presetId(preset, opts.normalize), w: img.width, h: img.height };

  let norm = null;
  const getNorm = () => norm || (norm = normalize(img, preset, opts.normalize));
  if (opts.keepNormalized) getNorm();
  for (const m of methods) {
    const def = METHODS[m];
    if (def.source === 'file') {
      if (buf) fp[m] = def.compute(buf);
    } else {
      fp[m] = def.compute(def.source === 'pixels' ? img : getNorm());
    }
  }
  return { fp, image: img, normalized: norm };
}

/**
 * Compare two fingerprints method by method. Exact methods give true/false; the others give a
 * similarity from 0 to 1 (1 = identical), or null when the fingerprints used different presets.
 * Only methods present in both are compared.
 */
function compare(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') throw new TypeError('compare expects two fingerprints');
  if (a.v !== b.v) throw new Error(`fingerprint versions differ (${a.v} vs ${b.v}); recompute the older one`);
  const out = {};
  for (const m of ALL_METHODS) {
    if (a[m] === undefined || b[m] === undefined) continue;
    const def = METHODS[m];
    if (def.kind === 'exact') out[m] = a[m] === b[m];
    else out[m] = a.preset === b.preset ? def.compare(a[m], b[m]) : null;
  }
  return out;
}

module.exports = {
  fingerprint, fingerprintDetailed, compare, FINGERPRINT_VERSION, METHODS, ALL_METHODS, DEFAULT_METHODS, PRESETS,
};
