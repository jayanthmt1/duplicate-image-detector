'use strict';

const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { bitsToHex } = require('./bits');

/** Average hash: shrink to 8x8, one bit per cell, 1 when the cell is brighter than the mean. */
function ahash64(img) {
  const g = resize(toGray(img), 8, 8).data;
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += g[i];
  const bits = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bits[i] = g[i] * 64 > sum ? 1 : 0;
  return bitsToHex(bits);
}

module.exports = { ahash64 };
