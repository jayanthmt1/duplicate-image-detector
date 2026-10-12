'use strict';

const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { bitsToHex } = require('./bits');

/**
 * Difference hash: shrink the grayscale image to (cols + 1) x rows by area averaging, then one
 * bit per adjacent pair in each row: 1 when the left pixel is brighter than the right one.
 * Bits are row-major, most significant first. dhash64 = 9x8 grid, dhash256 = 17x16 grid.
 */
function dhash(img, cols = 8, rows = 8) {
  const g = resize(toGray(img), cols + 1, rows);
  const d = g.data;
  const bits = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      bits[y * cols + x] = d[y * (cols + 1) + x] > d[y * (cols + 1) + x + 1] ? 1 : 0;
    }
  }
  return bitsToHex(bits);
}

const dhash64 = (img) => dhash(img, 8, 8);

module.exports = { dhash, dhash64 };
