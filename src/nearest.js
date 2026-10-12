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
 * The index grows with add() and shrinks with remove(), without rebuilding.
 * opts.bits sets the hash size for an index that starts empty (otherwise taken from the first hash).
 */
function createHammingIndex(hashes = [], opts = {}) {
  const hexOf = (h) => (typeof h === 'string' ? h : h && h.hash);
  let words = 0;
  let bits = 0;
  let packed = new Uint32Array(0);
  let removed = new Uint8Array(0);
  const ids = [];
  let count = 0; // slots used (including removed ones)
  let live = 0;

  function setWidth(hex) {
    if (typeof hex !== 'string' || hex.length % 8 !== 0 || !hex.length) {
      throw new TypeError('hash length must be a multiple of 8 hex digits');
    }
    words = hex.length / 8;
    bits = words * 32;
  }
  if (opts.bits !== undefined) {
    if (!Number.isInteger(opts.bits) || opts.bits <= 0 || opts.bits % 32) throw new RangeError('bits must be a positive multiple of 32');
    words = opts.bits / 32;
    bits = opts.bits;
  }

  function grow(min, exact = false) {
    let cap = exact ? min : Math.max(16, removed.length);
    while (cap < min) cap *= 2;
    if (cap === removed.length) return;
    const p = new Uint32Array(cap * words);
    p.set(packed);
    packed = p;
    const r = new Uint8Array(cap);
    r.set(removed);
    removed = r;
  }

  function addOne(h) {
    const hex = hexOf(h);
    if (!words) setWidth(hex);
    if (count + 1 > removed.length) grow(count + 1);
    packInto(hex, words, packed, count * words);
    ids.push(typeof h === 'string' || h.id === undefined ? count : h.id);
    count++;
    live++;
    return count - 1;
  }

  const initial = Array.isArray(hashes) ? hashes : Array.from(hashes);
  if (initial.length) {
    if (!words) setWidth(hexOf(initial[0]));
    grow(initial.length, true); // a list is stored exactly; add() grows by doubling
  }
  for (const h of initial) addOne(h);
  // With no hashes and no opts.bits, the size is taken from the first add().

  function distanceAt(i, q, limit) {
    let d = 0;
    const o = i * words;
    for (let w = 0; w < words; w++) {
      d += popcount32((packed[o + w] ^ q[w]) | 0);
      if (d > limit) return d;
    }
    return d;
  }

  function packQuery(query) {
    const q = new Uint32Array(words);
    packInto(query, words, q, 0);
    return q;
  }

  const result = (index, distance) => ({ index, id: ids[index], distance, similarity: 1 - distance / bits });

  return {
    /** Number of hashes in the index (removed ones excluded). */
    get size() {
      return live;
    },
    /** Hash size in bits (64 for an empty index whose size is not known yet). */
    get bits() {
      return bits || 64;
    },
    /** Memory used by the packed hashes: 8 bytes per 64-bit hash (plus spare room after add()). */
    get bytes() {
      return packed.byteLength;
    },
    /** Add a hash (hex string or { id, hash }). Returns its position. */
    add(h) {
      return addOne(h);
    },
    /** Remove every entry with this id. Returns how many were removed. */
    remove(id) {
      let n = 0;
      for (let i = 0; i < count; i++) {
        if (!removed[i] && ids[i] === id) {
          removed[i] = 1;
          live--;
          n++;
        }
      }
      return n;
    },
    /**
     * The k most similar hashes to `query` with similarity >= minSimilarity, best first
     * (ties by position). Returns [{ index, id, distance, similarity }].
     */
    nearest(query, { k = 10, minSimilarity = 0 } = {}) {
      if (!words) return [];
      const q = packQuery(query);
      let limit = maxDistance(bits, minSimilarity);
      const best = []; // sorted by (distance, index)
      for (let i = 0; i < count; i++) {
        if (removed[i]) continue;
        const d = distanceAt(i, q, limit);
        if (d > limit) continue;
        let j = best.length;
        while (j > 0 && best[j - 1].distance > d) j--;
        if (j >= k) continue;
        best.splice(j, 0, { index: i, distance: d });
        if (best.length > k) best.pop();
        if (best.length === k) limit = best[k - 1].distance; // later equal distances lose the tie
      }
      return best.map(({ index, distance }) => result(index, distance));
    },
    /** Every hash with similarity >= minSimilarity to `query`, best first (ties by position). */
    within(query, minSimilarity) {
      if (typeof minSimilarity !== 'number') throw new TypeError('within(query, minSimilarity) needs a similarity');
      if (!words) return [];
      const q = packQuery(query);
      const limit = maxDistance(bits, minSimilarity);
      const out = [];
      for (let i = 0; i < count; i++) {
        if (removed[i]) continue;
        const d = distanceAt(i, q, limit);
        if (d <= limit) out.push(result(i, d));
      }
      return out.sort((a, b) => a.distance - b.distance || a.index - b.index);
    },
    /** Every pair (i < j) with similarity >= minSimilarity: [{ a, b, distance, similarity }] by index. */
    pairs({ minSimilarity = 0.8 } = {}) {
      if (!words) return [];
      const limit = maxDistance(bits, minSimilarity);
      const out = [];
      const q = new Uint32Array(words);
      for (let i = 0; i < count; i++) {
        if (removed[i]) continue;
        for (let w = 0; w < words; w++) q[w] = packed[i * words + w];
        for (let j = i + 1; j < count; j++) {
          if (removed[j]) continue;
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
