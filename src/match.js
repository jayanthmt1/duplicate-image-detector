'use strict';

// Decision-grade matching: turn two fingerprints into a tier (exact / likely / possible / none)
// with the scores and the reasons behind it, and keep a growable index of a collection that
// answers "which stored images match this new one?" in those terms.

const { FINGERPRINT_VERSION } = require('./fingerprint');
const { hammingSimilarity } = require('./hash/bits');
const { createHammingIndex } = require('./nearest');

// Measured with the `scan` preset on real exam-question images: 26 same-picture pairs,
// 104 different-question look-alike pairs and 600 random pairs.
//   likely:   dhash64 >= 0.80             -> 14 of 26 same, 0 of 600 random, 4 of 104 look-alike
//   possible: dhash64 >= 0.72 or ahash64 >= 0.75
//                                         -> 20 of 26 same, 5 of 600 random (one distinct pair)
// The sample is small; treat these as a starting point and re-measure on your own data.
const DEFAULT_THRESHOLDS = Object.freeze({
  likely: Object.freeze({ dhash64: 0.8 }),
  possible: Object.freeze({ dhash64: 0.72, ahash64: 0.75 }),
});

const TIERS = ['exact', 'likely', 'possible', 'none'];
const TIER_RANK = { exact: 0, likely: 1, possible: 2, none: 3 };
const TIER_METHODS = ['dhash64', 'ahash64'];

function resolveThresholds(t) {
  if (!t) return DEFAULT_THRESHOLDS;
  const out = { likely: { ...DEFAULT_THRESHOLDS.likely, ...(t.likely || {}) }, possible: { ...DEFAULT_THRESHOLDS.possible, ...(t.possible || {}) } };
  for (const tier of ['likely', 'possible']) {
    for (const [m, v] of Object.entries(out[tier])) {
      if (!TIER_METHODS.includes(m)) throw new Error(`thresholds.${tier}.${m}: only ${TIER_METHODS.join(' and ')} can set tiers`);
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new RangeError(`thresholds.${tier}.${m} must be a number from 0 to 1`);
    }
  }
  return out;
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
const bitsAgree = (v) => `${Math.round(v * 64)}/64 bits`;

/**
 * Classify a pair of fingerprints.
 *   exact     identical decoded pixels (pixelSha) - safe for an automatic decision
 *   likely    dhash64 >= thresholds.likely.dhash64 (default 0.80)
 *   possible  dhash64 >= 0.72 or ahash64 >= 0.75 (defaults)
 *   none      otherwise
 * Near tiers are for ranking and human review, never automatic decisions.
 * Returns { tier, scores: { dhash64, ahash64 }, preset, reasons: [...], thresholds }.
 */
function classifyMatch(a, b, opts = {}) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') throw new TypeError('classifyMatch expects two fingerprints');
  if (a.v !== b.v) throw new Error(`fingerprint versions differ (${a.v} vs ${b.v}); recompute the older one`);
  const thresholds = resolveThresholds(opts.thresholds);
  const reasons = [];
  const scores = { dhash64: null, ahash64: null };
  const samePreset = a.preset === b.preset;
  for (const m of TIER_METHODS) {
    if (samePreset && a[m] && b[m]) scores[m] = hammingSimilarity(a[m], b[m]);
  }
  const out = (tier) => ({ tier, scores, preset: samePreset ? a.preset : null, reasons, thresholds });

  if (a.pixelSha && b.pixelSha && a.pixelSha === b.pixelSha) {
    reasons.push('identical pixels (pixelSha)');
    return out('exact');
  }
  if (!samePreset) {
    reasons.push(`different presets (${a.preset} vs ${b.preset}): perceptual hashes are not comparable`);
    return out('none');
  }
  if (scores.dhash64 === null && scores.ahash64 === null) {
    reasons.push('no dhash64 or ahash64 in both fingerprints');
    return out('none');
  }
  const meets = (tier) => Object.entries(thresholds[tier]).filter(([m, t]) => scores[m] !== null && scores[m] >= t);
  const likely = meets('likely');
  if (likely.length) {
    for (const [m, t] of likely) reasons.push(`${m} ${fmt(scores[m])} (${bitsAgree(scores[m])} agree) >= likely ${fmt(t)}`);
    return out('likely');
  }
  const possible = meets('possible');
  if (possible.length) {
    for (const [m, t] of possible) reasons.push(`${m} ${fmt(scores[m])} (${bitsAgree(scores[m])} agree) >= possible ${fmt(t)}`);
    return out('possible');
  }
  for (const m of TIER_METHODS) if (scores[m] !== null) reasons.push(`${m} ${fmt(scores[m])} below possible ${fmt(thresholds.possible[m] ?? 1)}`);
  return out('none');
}

/**
 * A growable index of fingerprints for checking new images against a collection.
 *   const index = createMatchIndex();               // preset is taken from the first fingerprint
 *   for (const row of bank) index.add(row.id, row.fp);
 *   index.query(newFp)  // -> [{ id, tier, scores, reasons }], exact first, then likely, possible
 * Fingerprints need pixelSha and dhash64 (ahash64 optional but recommended), all from one preset.
 */
function createMatchIndex(opts = {}) {
  const thresholds = resolveThresholds(opts.thresholds);
  let preset = opts.preset ?? null;
  const byPixel = new Map();
  const fps = new Map();
  const dIndex = createHammingIndex([], { bits: 64 });
  const aIndex = createHammingIndex([], { bits: 64 });

  function check(fp, what) {
    if (!fp || typeof fp !== 'object') throw new TypeError(`${what}: expected a fingerprint`);
    if (fp.v !== FINGERPRINT_VERSION) throw new Error(`${what}: fingerprint version ${fp.v}, index uses ${FINGERPRINT_VERSION}`);
    if (!fp.dhash64 && !fp.pixelSha) throw new Error(`${what}: fingerprint needs pixelSha and dhash64`);
    if (preset !== null && fp.preset !== preset) {
      throw new Error(`${what}: preset ${fp.preset} does not match the index preset ${preset}; use one preset for the whole collection`);
    }
  }

  function add(id, fp) {
    if (id === undefined || id === null) throw new TypeError('add(id, fp): id is required');
    check(fp, `add(${JSON.stringify(id)})`);
    if (preset === null) preset = fp.preset;
    if (fps.has(id)) remove(id);
    fps.set(id, fp);
    if (fp.pixelSha) {
      const g = byPixel.get(fp.pixelSha);
      if (g) g.push(id);
      else byPixel.set(fp.pixelSha, [id]);
    }
    if (fp.dhash64) dIndex.add({ id, hash: fp.dhash64 });
    if (fp.ahash64) aIndex.add({ id, hash: fp.ahash64 });
  }

  function remove(id) {
    const fp = fps.get(id);
    if (!fp) return false;
    fps.delete(id);
    if (fp.pixelSha) {
      const g = byPixel.get(fp.pixelSha).filter((x) => x !== id);
      if (g.length) byPixel.set(fp.pixelSha, g);
      else byPixel.delete(fp.pixelSha);
    }
    dIndex.remove(id);
    aIndex.remove(id);
    return true;
  }

  const api = {
    get size() {
      return fps.size;
    },
    get preset() {
      return preset;
    },
    thresholds,
    /** Add (or replace) one fingerprint under `id`. */
    add(id, fp) {
      add(id, fp);
      return api;
    },
    /** Add many: an iterable of { id, fp } or [id, fp]. */
    addMany(items) {
      for (const it of items) Array.isArray(it) ? add(it[0], it[1]) : add(it.id, it.fp);
      return api;
    },
    /** Remove `id`. Returns true if it was present. */
    remove,
    has(id) {
      return fps.has(id);
    },
    /**
     * Stored images that match `fp`, best first: exact, then likely, then possible (each by
     * highest score). Options: k (default 10), minTier ('possible' | 'likely' | 'exact'),
     * excludeId (skip this id, e.g. the image itself when re-checking a stored one).
     */
    query(fp, { k = 10, minTier = 'possible', excludeId } = {}) {
      check(fp, 'query');
      if (!(minTier in TIER_RANK) || minTier === 'none') throw new Error(`minTier must be 'exact', 'likely' or 'possible'`);
      const ids = new Set(fp.pixelSha ? byPixel.get(fp.pixelSha) || [] : []);
      // Candidates: every stored hash at or above the lowest threshold of the tiers asked for.
      const tiers = minTier === 'possible' ? ['likely', 'possible'] : minTier === 'likely' ? ['likely'] : [];
      for (const [m, index] of [['dhash64', dIndex], ['ahash64', aIndex]]) {
        const ts = tiers.map((t) => thresholds[t][m]).filter((v) => v !== undefined);
        if (ts.length && fp[m]) for (const hit of index.within(fp[m], Math.min(...ts))) ids.add(hit.id);
      }
      if (excludeId !== undefined) ids.delete(excludeId);
      const out = [];
      for (const id of ids) {
        const c = classifyMatch(fp, fps.get(id), { thresholds });
        if (TIER_RANK[c.tier] <= TIER_RANK[minTier]) out.push({ id, tier: c.tier, scores: c.scores, reasons: c.reasons });
      }
      const best = (r) => Math.max(r.scores.dhash64 ?? 0, r.scores.ahash64 ?? 0);
      out.sort((x, y) => TIER_RANK[x.tier] - TIER_RANK[y.tier] || best(y) - best(x) || String(x.id).localeCompare(String(y.id)));
      return out.slice(0, k);
    },
  };
  return api;
}

/**
 * Group ids into clusters from pairwise matches (union-find): any chain of matches lands in one
 * group. `pairs` is [{ a, b }] or [[a, b]]; `groups` (optional) are already-known groups such as
 * exact duplicates. Returns arrays of ids, largest first; singletons are left out.
 */
function groupDuplicates(pairs = [], groups = []) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) {
      const n = parent.get(x);
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const g of groups) for (let i = 1; i < g.length; i++) union(g[0], g[i]);
  for (const p of pairs) Array.isArray(p) ? union(p[0], p[1]) : union(p.a, p.b);
  const clusters = new Map();
  for (const x of parent.keys()) {
    const r = find(x);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(x);
  }
  return [...clusters.values()]
    .filter((c) => c.length > 1)
    .map((c) => c.sort((x, y) => String(x).localeCompare(String(y))))
    .sort((x, y) => y.length - x.length || String(x[0]).localeCompare(String(y[0])));
}

module.exports = { classifyMatch, createMatchIndex, groupDuplicates, DEFAULT_THRESHOLDS, TIERS };
