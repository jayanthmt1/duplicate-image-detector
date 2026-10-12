#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ic = require('..');
const { listImages, evaluateFolder } = require('../src/eval/folder');
const { findDuplicates, DEFAULT_METHOD, DEFAULT_THRESHOLD } = require('../src/dupes');

const HELP = `duplicate-image-detector: fingerprint and compare images (exact and near duplicates)

Usage:
  duplicate-image-detector fingerprint <files or folders...> [--preset P] [--methods a,b] [--workers N] [--out file.jsonl]
                               [--max-pixels N]
      One JSON line per image: { "file": ..., "v": 1, "preset": ..., ... } or { "file": ..., "error": ... }.
  duplicate-image-detector compare <a> <b> [--preset scan] [--methods a,b]
      Similarity per method (exact methods: true/false).
  duplicate-image-detector dupes <files or folders...> [--preset scan] [--method dhash64] [--threshold 0.78]
                         [--search auto|all|bands] [--workers N] [--json out.json]
      Exact duplicate groups (same pixels) and near-duplicate candidates for review.
      Up to 20,000 images every pair is compared; above that, band keys narrow the search.
  duplicate-image-detector eval <folder> [--limit 300] [--random 3000] [--presets none,photo,lineart,scan]
                        [--methods a,b] [--kinds k1,k2] [--min-side 64] [--seed 1] [--rate 0.01]
                        [--normalize '{"square":true}'] [--json out.json]
      Synthetic-variant evaluation: share of same pairs matched at the target false-match rate.

Presets: ${ic.PRESETS.join(', ')}
Methods: ${ic.METHODS.join(', ')}
Images:  PNG, JPEG (baseline + progressive), GIF (first frame), BMP
Limits:  --max-pixels N refuses larger images (library default 100,000,000; use about
         20,000,000 or lower for untrusted uploads)
`;

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) args[a.slice(2, eq)] = a.slice(eq + 1);
      else args[a.slice(2)] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const int = (s, d) => (s === undefined ? d : parseInt(String(s).replace(/[_,]/g, ''), 10));
const progress = (label) => (done, total) => {
  if (process.stderr.isTTY) process.stderr.write(`\r${label} ${done}/${total}`);
  if (done === total && process.stderr.isTTY) process.stderr.write('\n');
};

async function cmdFingerprint(a) {
  const files = listImages(a._);
  if (!files.length) throw new Error('no images found');
  const opts = { preset: a.preset, methods: list(a.methods), maxPixels: int(a['max-pixels']) };
  const out = a.out ? fs.createWriteStream(a.out) : process.stdout;
  // Write in input order as results arrive.
  const pending = new Map();
  let next = 0;
  const flush = () => {
    while (pending.has(next)) {
      const r = pending.get(next);
      pending.delete(next);
      out.write(JSON.stringify({ file: files[next], ...(r.fp || { error: r.error }) }) + '\n');
      next++;
    }
  };
  await ic.fingerprintMany(files, opts, {
    workers: int(a.workers, 2),
    onResult: (i, r) => {
      pending.set(i, r);
      flush();
    },
    onProgress: a.out ? progress('fingerprinted') : undefined,
  });
  if (a.out) await new Promise((res) => out.end(res));
}

function cmdCompare(a) {
  if (a._.length !== 2) throw new Error('compare needs exactly two images');
  const opts = { preset: a.preset ?? 'scan', methods: list(a.methods) ?? ic.METHODS, maxPixels: int(a['max-pixels']) };
  const [fa, fb] = a._.map((f) => ic.fingerprint(fs.readFileSync(f), opts));
  const c = ic.compare(fa, fb);
  console.log(JSON.stringify({ preset: fa.preset, ...c }, null, 2));
}

async function cmdDupes(a) {
  const files = listImages(a._);
  if (files.length < 2) throw new Error('need at least two images');
  const method = a.method ?? DEFAULT_METHOD;
  const threshold = a.threshold === undefined ? DEFAULT_THRESHOLD : Number(a.threshold);
  const opts = { preset: a.preset ?? 'scan', methods: ['pixelSha', method], maxPixels: int(a['max-pixels']) };
  const results = await ic.fingerprintMany(files, opts, { workers: int(a.workers, 2), onProgress: progress('fingerprinted') });
  const items = [];
  const errors = [];
  results.forEach((r, i) => (r.fp ? items.push({ id: files[i], fp: r.fp }) : errors.push({ file: files[i], error: r.error })));
  const res = findDuplicates(items, {
    method,
    threshold,
    search: a.search,
    bands: int(a.bands, 8),
  });
  if (a.json) fs.writeFileSync(a.json, JSON.stringify({ ...res, errors }, null, 2));
  const rel = (f) => path.relative(process.cwd(), f);
  console.log(`${items.length} images, preset ${opts.preset}, ${method}, ${res.search === 'all' ? 'every pair compared' : 'band-key search'}`);
  console.log(`\nExact duplicates (identical pixels): ${res.exact.length} groups`);
  for (const g of res.exact.slice(0, 50)) console.log(`  ${g.map(rel).join('  =  ')}`);
  if (res.exact.length > 50) console.log(`  ... ${res.exact.length - 50} more`);
  console.log(`\nNear-duplicate candidates (similarity >= ${threshold}, for human review): ${res.near.length}`);
  for (const p of res.near.slice(0, 100)) console.log(`  ${p.similarity.toFixed(3)}  ${rel(p.a)}  ~  ${rel(p.b)}`);
  if (res.near.length > 100) console.log(`  ... ${res.near.length - 100} more (use --json for all)`);
  const multi = res.clusters.filter((c) => c.length > 2).length;
  console.log(`\nClusters (images connected by exact or near matches): ${res.clusters.length}${multi ? `, ${multi} with 3 or more images` : ''}`);
  for (const c of res.clusters.slice(0, 20)) console.log(`  [${c.length}] ${c.map(rel).join('  ')}`);
  if (res.clusters.length > 20) console.log(`  ... ${res.clusters.length - 20} more (use --json for all)`);
  if (res.skippedKeys.length) console.log(`\nSkipped ${res.skippedKeys.length} over-common band keys (e.g. near-blank images).`);
  if (errors.length) console.log(`\n${errors.length} files could not be read (see --json).`);
}

function cmdEval(a) {
  if (!a._.length) throw new Error('eval needs a folder');
  const res = evaluateFolder(a._, {
    limit: int(a.limit, 300),
    randomPairs: int(a.random, 3000),
    seed: int(a.seed, 1),
    minSide: int(a['min-side'], 64),
    presets: list(a.presets),
    methods: list(a.methods),
    kinds: list(a.kinds),
    normalize: a.normalize ? JSON.parse(a.normalize) : undefined,
    targetFalseRate: a.rate === undefined ? 0.01 : Number(a.rate),
    onProgress: progress('images'),
  });
  console.log(`${res.images} images from ${a._.join(', ')}\n`);
  console.log(ic.formatReport(res));
  if (a.json) fs.writeFileSync(a.json, JSON.stringify(res, null, 2));
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (a.version) return console.log(require('../package.json').version);
  const cmd = a._.shift();
  if (!cmd || a.help || cmd === 'help') return console.log(HELP);
  switch (cmd) {
    case 'fingerprint': return cmdFingerprint(a);
    case 'compare': return cmdCompare(a);
    case 'dupes': return cmdDupes(a);
    case 'eval': return cmdEval(a);
    default: throw new Error(`unknown command '${cmd}' (try --help)`);
  }
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
