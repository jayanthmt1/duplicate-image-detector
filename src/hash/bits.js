'use strict';

const HEX = '0123456789abcdef';

/** Pack an array of 0/1 values into hex, most significant bit first. Length must be a multiple of 4. */
function bitsToHex(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) {
    s += HEX[(bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]];
  }
  return s;
}

const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function nibble(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  throw new TypeError(`invalid hex digit '${ch}'`);
}

/** Number of differing bits between two equal-length hex hashes. */
function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') throw new TypeError('hashes must be hex strings');
  if (a.length !== b.length) throw new RangeError(`hash lengths differ (${a.length} vs ${b.length} hex digits)`);
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT4[nibble(a[i]) ^ nibble(b[i])];
  return d;
}

/** 1 - hamming / bits: 1 means identical, about 0.5 means unrelated. */
function hammingSimilarity(a, b) {
  return 1 - hamming(a, b) / (a.length * 4);
}

module.exports = { bitsToHex, hamming, hammingSimilarity, nibble };
