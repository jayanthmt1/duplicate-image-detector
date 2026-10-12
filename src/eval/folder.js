'use strict';

// Evaluate methods and presets on a folder of images using synthetic variants. Each accepted image
// is paired with its variants ("same") and with variants of other images ("random"). Exact
// duplicates among the originals are skipped so random pairs really differ. Only fingerprints are
// kept in memory.

const fs = require('fs');
const path = require('path');
const { decode } = require('../decode');
const { pixelSha } = require('../hash/sha');
const { limitSize } = require('../ops/resize');
const { fingerprint, ALL_METHODS } = require('../fingerprint');
const { evaluate } = require('./evaluate');
const { variants, VARIANT_KINDS } = require('./variants');
const { prng } = require('../detmath');

const IMAGE_FILE = /\.(png|jpe?g|gif|bmp)$/i;

/** Image files under the given files/folders, sorted. */
function listImages(paths) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
    } else if (IMAGE_FILE.test(p)) out.push(p);
  };
  for (const p of [].concat(paths)) walk(p);
  return out.sort();
}

/**
 * options: limit (300), randomPairs (3000), seed (1), minSide (64), presets, methods, kinds,
 * normalize, targetFalseRate (0.01), onProgress(done, limit).
 * Returns the evaluate() result for all presets, plus `images` (how many were used).
 */
function evaluateFolder(paths, opts = {}) {
  const limit = opts.limit ?? 300;
  const randomPairs = opts.randomPairs ?? 3000;
  const seed = opts.seed ?? 1;
  const minSide = opts.minSide ?? 64;
  const presets = opts.presets ?? ['none', 'photo', 'lineart', 'scan'];
  const methods = opts.methods ?? ALL_METHODS.filter((m) => m !== 'fileSha');
  const kinds = opts.kinds ?? VARIANT_KINDS;
  const rnd = prng(seed);

  const files = listImages(paths);
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }

  const seen = new Set();
  const data = [];
  for (const file of files) {
    if (data.length >= limit) break;
    let img;
    try {
      img = decode(fs.readFileSync(file));
    } catch {
      continue;
    }
    if (Math.min(img.width, img.height) < minSide) continue;
    const px = pixelSha(img);
    if (seen.has(px)) continue;
    seen.add(px);
    img = limitSize(img, 1024);
    const fpAll = (x) => Object.fromEntries(presets.map((p) => [p, fingerprint(x, { preset: p, methods, normalize: opts.normalize })]));
    data.push({
      file,
      orig: fpAll(img),
      vars: variants(img, { kinds, seed: seed * 7919 + data.length }).map((v) => ({ kind: v.kind, fp: fpAll(v.image) })),
    });
    if (opts.onProgress) opts.onProgress(data.length, limit);
  }
  if (data.length < 2) throw new Error('need at least 2 usable images');

  const pairs = [];
  for (let k = 0; k < randomPairs; k++) {
    const i = Math.floor(rnd() * data.length);
    let j = Math.floor(rnd() * (data.length - 1));
    if (j >= i) j++;
    pairs.push([i, j, Math.floor(rnd() * data[j].vars.length)]);
  }

  let merged = null;
  for (const p of presets) {
    const same = data.flatMap((d) => d.vars.map((v) => ({ a: d.orig[p], b: v.fp[p], kind: v.kind })));
    const random = pairs.map(([i, j, v]) => ({ a: data[i].orig[p], b: data[j].vars[v].fp[p], kind: data[j].vars[v].kind }));
    const res = evaluate({ same, random }, { methods, targetFalseRate: opts.targetFalseRate ?? 0.01 });
    merged = merged ? { ...res, results: merged.results.concat(res.results) } : res;
  }
  merged.results.sort((x, y) => y.recall - x.recall || x.method.localeCompare(y.method));
  merged.images = data.length;
  return merged;
}

module.exports = { evaluateFolder, listImages, IMAGE_FILE };
