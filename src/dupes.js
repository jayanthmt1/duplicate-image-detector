'use strict';

// Duplicate finding over a set of fingerprints: exact groups by pixelSha, then near candidates by
// bit-hash similarity. Up to `maxAllPairs` images every pair is compared (exact, finds matches at
// any threshold); above that, band keys narrow the candidates first (fast, but only guaranteed to
// find pairs within bands - 1 bits).

const { bandKeys, findCommonBands } = require('./bands');
const { METHODS } = require('./fingerprint');
const { createHammingIndex } = require('./nearest');
const { groupDuplicates } = require('./match');

const DEFAULT_METHOD = 'dhash64';
// 50 of 64 bits agree (at most 14 differ): the 1% false-match cut measured for dhash64 with the
// lineart and scan presets. Near matches are candidates for review, never automatic decisions.
const DEFAULT_THRESHOLD = 0.78;
const DEFAULT_MAX_ALL_PAIRS = 20000;

function bandPairs(reps, method, def, threshold, opts) {
  const bands = opts.bands ?? 8;
  const keysOf = reps.map((it) => bandKeys(it.fp[method], { bands }));
  const skipped = opts.skipCommon === false ? [] : findCommonBands(keysOf, { maxShare: opts.maxShare ?? 0.01, minCount: 3 });
  const skip = new Set(skipped.map((s) => s.key));
  const buckets = new Map();
  keysOf.forEach((keys, i) => {
    for (const k of keys) {
      if (skip.has(k)) continue;
      const b = buckets.get(k);
      if (b) b.push(i);
      else buckets.set(k, [i]);
    }
  });
  const seen = new Set();
  const near = [];
  for (const b of buckets.values()) {
    for (let x = 0; x < b.length; x++) {
      for (let y = x + 1; y < b.length; y++) {
        const i = b[x];
        const j = b[y];
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = reps[i];
        const B = reps[j];
        if (A.fp.preset !== B.fp.preset) continue;
        const s = def.compare(A.fp[method], B.fp[method]);
        if (s >= threshold) near.push({ a: A.id, b: B.id, similarity: s });
      }
    }
  }
  return { near, skipped };
}

function allPairs(reps, method, threshold) {
  // Compare within each preset only (fingerprints from different presets are not comparable).
  const byPreset = new Map();
  for (const it of reps) {
    const g = byPreset.get(it.fp.preset);
    if (g) g.push(it);
    else byPreset.set(it.fp.preset, [it]);
  }
  const near = [];
  for (const group of byPreset.values()) {
    const index = createHammingIndex(group.map((it) => ({ id: it.id, hash: it.fp[method] })));
    for (const p of index.pairs({ minSimilarity: threshold })) near.push({ a: p.a, b: p.b, similarity: p.similarity });
  }
  return near;
}

/**
 * items: [{ id, fp }]. options:
 *   method     bit-hash method (default 'dhash64'; also ahash64, dhash256, phash64)
 *   threshold  similarity for a near candidate (default 0.78)
 *   search     'auto' (default: 'all' up to maxAllPairs images, else 'bands'), 'all' or 'bands'
 *   maxAllPairs (default 20000); bands (default 8), skipCommon (default true), maxShare (0.01)
 *              apply to the band search only.
 * Returns { exact: [[id, ...]], near: [{ a, b, similarity }] (best first), clusters: [[id, ...]],
 *           search, skippedKeys }. `clusters` joins exact groups and near pairs transitively
 *           (largest first), one entry per group of images that are all connected by matches.
 */
function findDuplicates(items, opts = {}) {
  const method = opts.method ?? DEFAULT_METHOD;
  const def = METHODS[method];
  if (!def || def.kind !== 'bits') throw new Error(`dupes needs a bit-hash method (ahash64, dhash64, dhash256, phash64), not '${method}'`);
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  if (items.length && !items.some((it) => it.fp && it.fp[method])) {
    throw new Error(`none of the fingerprints contain ${method}; include it in fingerprint methods or pass { method }`);
  }

  // Exact groups.
  const byPixel = new Map();
  for (const it of items) {
    if (!it.fp.pixelSha) continue;
    const g = byPixel.get(it.fp.pixelSha);
    if (g) g.push(it.id);
    else byPixel.set(it.fp.pixelSha, [it.id]);
  }
  const exact = [...byPixel.values()].filter((g) => g.length > 1);
  // One representative per exact group for the near search.
  const exactOf = new Set();
  for (const g of exact) for (const id of g.slice(1)) exactOf.add(id);
  const reps = items.filter((it) => it.fp[method] && !exactOf.has(it.id));

  const mode = opts.search ?? 'auto';
  if (!['auto', 'all', 'bands'].includes(mode)) throw new Error(`search must be 'auto', 'all' or 'bands', not '${mode}'`);
  const search = mode === 'auto' ? (reps.length <= (opts.maxAllPairs ?? DEFAULT_MAX_ALL_PAIRS) ? 'all' : 'bands') : mode;

  let near;
  let skippedKeys = [];
  if (search === 'all') near = allPairs(reps, method, threshold);
  else ({ near, skipped: skippedKeys } = bandPairs(reps, method, def, threshold, opts));

  near.sort((p, q) => q.similarity - p.similarity || String(p.a).localeCompare(String(q.a)) || String(p.b).localeCompare(String(q.b)));
  const clusters = groupDuplicates(near, exact);
  return { exact, near, clusters, search, skippedKeys };
}

module.exports = { findDuplicates, DEFAULT_METHOD, DEFAULT_THRESHOLD };
