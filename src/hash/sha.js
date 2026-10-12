'use strict';

const crypto = require('crypto');
const { forEachRgbRow } = require('../ops/color');

/** SHA-256 of the raw file bytes, as lowercase hex. */
function fileSha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * SHA-256 of the decoded pixels in canonical form: 8-bit RGB with transparency flattened onto
 * white, preceded by a small header with the size. Gray, palette, RGB, RGBA and 16-bit encodings
 * of the same picture give the same value.
 */
function pixelSha(img) {
  const h = crypto.createHash('sha256');
  const header = Buffer.alloc(12);
  header.write('icp1', 0, 'latin1');
  header.writeUInt32BE(img.width, 4);
  header.writeUInt32BE(img.height, 8);
  h.update(header);
  forEachRgbRow(img, (row) => h.update(row));
  return h.digest('hex');
}

module.exports = { fileSha, pixelSha };
