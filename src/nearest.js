'use strict';

// Brute-force nearest-neighbour search over bit hashes. Hashes are packed into 32-bit words
// (a 64-bit hash takes 8 bytes, so 180k hashes take about 1.4 MB) and compared with a popcount.
// Unlike band keys, this finds every match at any threshold: at realistic thresholds two copies
// of a picture can differ in 14-20 of 64 bits, far beyond what 8 bands guarantee (7 bits).

const { nibble } = require('./hash/bits');

function popcount32(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

function packInto(hex, words, out, offset) {
  if (typeof hex !== 'string' || hex.length !== words * 8) {
    throw new TypeError(`expected a ${words * 32}-bit hash (${words * 8} hex digits), got ${JSON.stringify(hex)}`);
  }
  for (let w = 0; w < words; w++) {
    let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 4) | nibble(hex[w * 8 + i]);
    out[offset + w] = v >>> 0;
  }
}

function maxDistance(bits, minSimilarity) {
  return Math.floor(bits * (1 - minSimilarity) + 1e-9);
}

/**
 * Pack hashes for repeated searches. `hashes` is an array of hex strings or of { id, hash }.
 * All hashes must have the same length, a multiple of 32 bits (dhash64 and dhash256 both are).
 */
function createHammingIndex(hashes) {
  const list = Array.from(hashes);
  const hexOf = (h) => (typeof h === 'string' ? h : h && h.hash);
  const ids = list.map((h, i) => (typeof h === 'string' ? i : h.id ?? i));
  const first = list.length ? hexOf(list[0]) : null;
  const words = first ? first.length / 8 : 2;
  if (!Number.isInteger(words) || words < 1) throw new TypeError('hash length must be a multiple of 8 hex digits');
  const bits = words * 32;
  const packed = new Uint32Array(list.length * words);
  list.forEach((h, i) => packInto(hexOf(h), words, packed, i * words));

  function distanceAt(i, q, limit) {
    let d = 0;
    const o = i * words;
    for (let w = 0; w < words; w++) {
      d += popcount32((packed[o + w] ^ q[w]) | 0);
      if (d > limit) return d;
    }
    return d;
  }

  return {
    size: list.length,
    bits,
    bytes: packed.byteLength,
    /**
     * The k most similar hashes to `query` with similarity >= minSimilarity, best first
     * (ties by position). Returns [{ index, id, distance, similarity }].
     */
    nearest(query, { k = 10, minSimilarity = 0 } = {}) {
      const q = new Uint32Array(words);
      packInto(query, words, q, 0);
      let limit = maxDistance(bits, minSimilarity);
      const best = []; // sorted by (distance, index)
      for (let i = 0; i < list.length; i++) {
        const d = distanceAt(i, q, limit);
        if (d > limit) continue;
        let j = best.length;
        while (j > 0 && best[j - 1].distance > d) j--;
        if (j >= k) continue;
        best.splice(j, 0, { index: i, distance: d });
        if (best.length > k) best.pop();
        if (best.length === k) limit = best[k - 1].distance; // later equal distances lose the tie
      }
      return best.map(({ index, distance }) => ({ index, id: ids[index], distance, similarity: 1 - distance / bits }));
    },
    /** Every pair (i < j) with similarity >= minSimilarity: [{ a, b, distance, similarity }] by index. */
    pairs({ minSimilarity = 0.8 } = {}) {
      const limit = maxDistance(bits, minSimilarity);
      const out = [];
      const q = new Uint32Array(words);
      for (let i = 0; i < list.length; i++) {
        for (let w = 0; w < words; w++) q[w] = packed[i * words + w];
        for (let j = i + 1; j < list.length; j++) {
          const d = distanceAt(j, q, limit);
          if (d <= limit) out.push({ a: ids[i], b: ids[j], distance: d, similarity: 1 - d / bits });
        }
      }
      return out;
    },
  };
}

/**
 * One-off search: the k hashes most similar to `query` (hex), best first.
 * For repeated queries build the index once with createHammingIndex.
 *   nearestByHamming(fp.dhash64, bank.map((r) => ({ id: r.id, hash: r.dhash64 })), { k: 5, minSimilarity: 0.78 })
 */
function nearestByHamming(query, hashes, opts) {
  return createHammingIndex(hashes).nearest(query, opts);
}

module.exports = { createHammingIndex, nearestByHamming, popcount32 };
