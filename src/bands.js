'use strict';

// Multi-index hashing. A hash of n bits is cut into m bands. If two hashes differ in at most
// m - 1 bits, at least one band is identical (pigeonhole), so looking up each band key finds
// every candidate within that distance. Callers store the keys in a multikey index and then
// rank candidates with the full hash.

const { nibble } = require('./hash/bits');

const HEX = '0123456789abcdef';

function hexToBits(hex) {
  const bits = new Uint8Array(hex.length * 4);
  for (let i = 0; i < hex.length; i++) {
    const v = nibble(hex[i]);
    bits[4 * i] = (v >> 3) & 1;
    bits[4 * i + 1] = (v >> 2) & 1;
    bits[4 * i + 2] = (v >> 1) & 1;
    bits[4 * i + 3] = v & 1;
  }
  return bits;
}

function bandSizes(nBits, opts) {
  let bands = opts.bands;
  if (opts.bitsPerBand !== undefined) {
    if (!Number.isInteger(opts.bitsPerBand) || opts.bitsPerBand < 1) throw new RangeError('bitsPerBand must be a positive integer');
    if (bands !== undefined) throw new TypeError('give either bands or bitsPerBand, not both');
    bands = Math.ceil(nBits / opts.bitsPerBand);
  }
  if (bands === undefined) bands = 4;
  if (!Number.isInteger(bands) || bands < 1 || bands > nBits) throw new RangeError(`bands must be an integer from 1 to ${nBits}`);
  // Spread the bits as evenly as possible; the first (nBits % bands) bands get one extra bit.
  const base = Math.floor(nBits / bands);
  const extra = nBits % bands;
  return Array.from({ length: bands }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Band keys for a hex hash, e.g. bandKeys("a3f109cc...", { bands: 4 }) -> ["0:a3f1", "1:09cc", ...].
 * Options: bands (default 4) or bitsPerBand, and prefix (prepended to each key, e.g. "d64:").
 */
function bandKeys(hex, opts = {}) {
  if (typeof hex !== 'string' || !hex.length) throw new TypeError('hash must be a non-empty hex string');
  const bits = hexToBits(hex);
  const sizes = bandSizes(bits.length, opts);
  const prefix = opts.prefix ?? '';
  const keys = [];
  let pos = 0;
  for (let b = 0; b < sizes.length; b++) {
    const n = sizes[b];
    // Left-pad the band to a whole number of hex digits.
    const pad = (4 - (n % 4)) % 4;
    let s = '';
    let acc = 0;
    let k = pad;
    for (let i = 0; i < n; i++) {
      acc = (acc << 1) | bits[pos + i];
      k++;
      if (k === 4) {
        s += HEX[acc];
        acc = 0;
        k = 0;
      }
    }
    keys.push(`${prefix}${b}:${s}`);
    pos += n;
  }
  return keys;
}

/**
 * Find band keys shared by too many items (for example near-blank images, which all collide).
 * `items` is any iterable of key arrays (one array per image). Returns keys whose share of items
 * is above maxShare (default 0.001) and whose count is at least minCount (default 2), most
 * common first, as { key, count, share }.
 */
function findCommonBands(items, opts = {}) {
  const maxShare = opts.maxShare ?? 0.001;
  const minCount = opts.minCount ?? 2;
  const counts = new Map();
  let total = 0;
  for (const keys of items) {
    total++;
    for (const k of new Set(keys)) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [];
  for (const [key, count] of counts) {
    const share = count / total;
    if (share > maxShare && count >= minCount) out.push({ key, count, share });
  }
  out.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  return out;
}

module.exports = { bandKeys, findCommonBands, hexToBits };
