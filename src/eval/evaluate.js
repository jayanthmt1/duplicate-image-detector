'use strict';

// Evaluation harness. Given labelled pairs, it reports for each method and preset the share of
// "same" pairs matched when the threshold is set so that at most `targetFalseRate` of the
// calibration pairs (random pairs by default) match.

const { fingerprintDetailed, METHODS, compare } = require('../fingerprint');
const { toGray } = require('../ops/color');
const { resize } = require('../ops/resize');
const { ssim } = require('../ssim');

const RATE_GRID = [0, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1];
const SSIM_SIZE = 128;

const isFingerprint = (x) => x && typeof x === 'object' && 'v' in x && 'preset' in x && !('data' in x);

function toPair(p) {
  if (Array.isArray(p)) return { a: p[0], b: p[1], kind: undefined };
  if (p && 'a' in p && 'b' in p) return p;
  throw new TypeError('a pair must be [a, b] or { a, b, kind? }');
}

/** Threshold for one method: count(neg >= t) <= floor(rate * n), with t as low as possible. */
function pickThreshold(negScores, allScores, rate) {
  const neg = [...negScores].sort((x, y) => y - x);
  const k = Math.floor(rate * neg.length + 1e-9);
  if (k >= neg.length) {
    let lo = Infinity;
    for (const v of allScores) if (v < lo) lo = v;
    return lo;
  }
  const cutoff = neg[k]; // must stay below the threshold
  let t = Infinity;
  for (const s of allScores) if (s > cutoff && s < t) t = s;
  return t; // Infinity: nothing can match
}

const rateOf = (scores, t) => (scores.length ? scores.filter((s) => s >= t).length / scores.length : null);

/**
 * sets: { same: Pair[], different?: Pair[], random?: Pair[] }, a pair being [a, b] or { a, b, kind }.
 * a and b are encoded files, raw images, or fingerprints (then presets are taken from them).
 * opts: methods, presets, targetFalseRate (0.01), calibrateOn ('random' | 'different' | 'both'),
 *       imageMethods (['ssim'] to also score SSIM on normalised images), normalize, onProgress.
 */
function evaluate(sets, opts = {}) {
  const same = (sets.same || []).map(toPair);
  const different = (sets.different || []).map(toPair);
  const random = (sets.random || []).map(toPair);
  if (!same.length) throw new Error('evaluate needs at least one "same" pair');
  const target = opts.targetFalseRate ?? 0.01;
  const calibrateOn = opts.calibrateOn ?? (random.length ? 'random' : 'different');
  const calib = calibrateOn === 'random' ? random : calibrateOn === 'different' ? different : [...random, ...different];
  if (!calib.length) throw new Error(`no "${calibrateOn}" pairs to set the threshold on`);
  const methods = opts.methods ?? Object.keys(METHODS).filter((m) => m !== 'fileSha');
  const presets = opts.presets ?? ['none'];
  const imageMethods = opts.imageMethods ?? [];
  for (const m of imageMethods) if (m !== 'ssim') throw new Error(`unknown image method '${m}'`);

  // Fingerprint every distinct item once per preset.
  const cache = new Map();
  let done = 0;
  const items = new Set();
  for (const p of [...same, ...different, ...random]) { items.add(p.a); items.add(p.b); }
  function get(item, preset) {
    let per = cache.get(item);
    if (!per) cache.set(item, (per = {}));
    if (per[preset]) return per[preset];
    let entry;
    if (isFingerprint(item)) {
      entry = { fp: item, small: null };
    } else {
      const r = fingerprintDetailed(item, {
        methods, preset, normalize: opts.normalize, keepNormalized: imageMethods.length > 0, maxPixels: opts.maxPixels,
      });
      entry = { fp: r.fp, small: r.normalized ? resize(toGray(r.normalized), SSIM_SIZE, SSIM_SIZE) : null };
    }
    per[preset] = entry;
    done++;
    if (opts.onProgress) opts.onProgress(done, items.size * presets.length);
    return entry;
  }

  const results = [];
  for (const preset of presets) {
    const scoreSet = (pairs) => pairs.map((p) => {
      const ea = get(p.a, preset);
      const eb = get(p.b, preset);
      const c = compare(ea.fp, eb.fp);
      const row = {};
      for (const m of methods) row[m] = c[m] === undefined || c[m] === null ? null : +c[m];
      if (imageMethods.includes('ssim')) row.ssim = ea.small && eb.small ? ssim(ea.small, eb.small, { size: SSIM_SIZE }) : null;
      return row;
    });
    const S = scoreSet(same);
    const D = scoreSet(different);
    const R = scoreSet(random);
    const presetLabel = get(same[0].a, preset).fp.preset;
    for (const m of [...methods, ...imageMethods]) {
      const col = (rows) => rows.map((r) => r[m]).filter((v) => v !== null && v !== undefined);
      const s = col(S);
      const d = col(D);
      const r = col(R);
      if (!s.length) continue;
      const neg = calibrateOn === 'random' ? r : calibrateOn === 'different' ? d : [...r, ...d];
      if (!neg.length) continue;
      const all = [...s, ...d, ...r];
      const t = pickThreshold(neg, all, target);
      const matched = s.filter((v) => v >= t).length;
      const byKind = {};
      same.forEach((p, i) => {
        if (p.kind === undefined || S[i][m] === null) return;
        const k = (byKind[p.kind] ||= { matched: 0, total: 0 });
        k.total++;
        if (S[i][m] >= t) k.matched++;
      });
      const fm = (scores) => ({ count: scores.filter((v) => v >= t).length, total: scores.length, rate: rateOf(scores, t) });
      results.push({
        method: m,
        preset: presetLabel,
        recall: matched / s.length,
        matched,
        total: s.length,
        threshold: Number.isFinite(t) ? t : null,
        falseMatches: { random: fm(r), different: fm(d) },
        byKind: Object.keys(byKind).length ? byKind : undefined,
        table: RATE_GRID.map((rate) => {
          const tt = pickThreshold(neg, all, rate);
          return {
            targetRate: rate,
            threshold: Number.isFinite(tt) ? tt : null,
            recall: rateOf(s, tt),
            randomRate: rateOf(r, tt),
            differentRate: rateOf(d, tt),
          };
        }),
      });
    }
  }
  results.sort((x, y) => y.recall - x.recall || x.method.localeCompare(y.method));
  return {
    targetFalseRate: target,
    calibrateOn,
    counts: { same: same.length, different: different.length, random: random.length },
    results,
  };
}

const pct = (v) => (v === null || v === undefined ? '-' : `${(100 * v).toFixed(1)}%`);
const num = (v) => (v === null || v === undefined ? '-' : (Math.round(v * 1000) / 1000).toString());

/** Plain-text report of an evaluate() result. */
function formatReport(res, { kinds = true } = {}) {
  const lines = [];
  lines.push(`Pairs: ${res.counts.same} same, ${res.counts.different} different, ${res.counts.random} random. ` +
    `Threshold set so at most ${pct(res.targetFalseRate)} of ${res.calibrateOn} pairs match.`);
  lines.push('');
  const rows = [['method', 'preset', 'same matched', 'threshold', 'random FM', 'different FM']];
  for (const r of res.results) {
    rows.push([r.method, r.preset, `${r.matched}/${r.total} (${pct(r.recall)})`, num(r.threshold),
      r.falseMatches.random.total ? `${r.falseMatches.random.count}/${r.falseMatches.random.total}` : '-',
      r.falseMatches.different.total ? `${r.falseMatches.different.count}/${r.falseMatches.different.total}` : '-']);
  }
  lines.push(...table(rows));
  if (kinds && res.results.some((r) => r.byKind)) {
    const kindNames = [...new Set(res.results.flatMap((r) => Object.keys(r.byKind || {})))];
    lines.push('', 'Same pairs matched, by variant kind:');
    const kr = [['method', 'preset', ...kindNames]];
    for (const r of res.results) {
      if (!r.byKind) continue;
      kr.push([r.method, r.preset, ...kindNames.map((k) => (r.byKind[k] ? pct(r.byKind[k].matched / r.byKind[k].total) : '-'))]);
    }
    lines.push(...table(kr));
  }
  return lines.join('\n');
}

function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r, j) => {
    const line = r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd();
    return j === 0 ? `${line}\n${w.map((n) => '-'.repeat(n)).join('  ')}` : line;
  });
}

module.exports = { evaluate, formatReport, pickThreshold };
