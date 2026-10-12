'use strict';

const { decode, sniffFormat, decodePng, decodeJpeg, decodeGif, decodeBmp } = require('./decode');
const { encodePng } = require('./encode/png');
const { flatten, toGray } = require('./ops/color');
const { resize, limitSize } = require('./ops/resize');
const { applyOrientation } = require('./ops/orient');
const { fileSha, pixelSha } = require('./hash/sha');
const { dhash, dhash64 } = require('./hash/dhash');
const { hamming, hammingSimilarity } = require('./hash/bits');
const { bandKeys, findCommonBands } = require('./bands');
const { fingerprint, compare, FINGERPRINT_VERSION, ALL_METHODS, DEFAULT_METHODS, PRESETS } = require('./fingerprint');
const { crop, pad, padToSquare, rotate, trimBorder } = require('./ops/geometry');
const { gaussianBlur, medianFilter, minFilter, maxFilter } = require('./ops/filter');
const { normalize } = require('./normalize');
const { otsuThreshold } = require('./normalize/binarize');
const { estimateSkew } = require('./normalize/deskew');
const { ahash64 } = require('./hash/ahash');
const { phash64 } = require('./hash/phash');
const { goldberg, goldbergSimilarity, inkGrid, inkGridSimilarity, inkMap, inkOverlap } = require('./hash/signature');
const { ssim } = require('./ssim');
const { distanceTransform, chamfer, chamferSimilarity, edgeHistogram, edgeSimilarity } = require('./hash/shape');
const { evaluate, formatReport } = require('./eval/evaluate');
const { createPool, fingerprintMany } = require('./batch');
const { evaluateFolder, listImages } = require('./eval/folder');
const { findDuplicates } = require('./dupes');
const { createHammingIndex, nearestByHamming } = require('./nearest');
const { variants, makeVariant, makeEvalSet, VARIANT_KINDS } = require('./eval/variants');

module.exports = {
  // decoding
  decode,
  decodePng,
  decodeJpeg,
  decodeGif,
  decodeBmp,
  sniffFormat,
  encodePng,
  // image operations
  flatten,
  toGray,
  resize,
  limitSize,
  applyOrientation,
  crop,
  pad,
  padToSquare,
  rotate,
  trimBorder,
  gaussianBlur,
  medianFilter,
  minFilter,
  maxFilter,
  // normalisation
  normalize,
  otsuThreshold,
  estimateSkew,
  // hashes
  fileSha,
  pixelSha,
  dhash,
  dhash64,
  ahash64,
  phash64,
  goldberg,
  goldbergSimilarity,
  inkGrid,
  inkGridSimilarity,
  inkMap,
  inkOverlap,
  ssim,
  distanceTransform,
  chamfer,
  chamferSimilarity,
  edgeHistogram,
  edgeSimilarity,
  hamming,
  hammingSimilarity,
  // fingerprints
  fingerprint,
  compare,
  FINGERPRINT_VERSION,
  METHODS: ALL_METHODS,
  DEFAULT_METHODS,
  PRESETS,
  createPool,
  fingerprintMany,
  findDuplicates,
  // search
  nearestByHamming,
  createHammingIndex,
  bandKeys,
  findCommonBands,
  // evaluation
  evaluate,
  formatReport,
  evaluateFolder,
  listImages,
  variants,
  makeVariant,
  makeEvalSet,
  VARIANT_KINDS,
};
