#!/usr/bin/env node
'use strict';

// Benchmark: duplicate-image-detector vs other npm packages for finding the same picture.
//
//   node compare.js                       synthetic line-art set (drawn here, no third-party images)
//   node compare.js --bases 120           more base diagrams (default 60)
//   node compare.js --pairs ./my-pairs    also score a folder of real labelled pairs
//   node compare.js --rate 0.01 --json out.json
//
// --pairs layout: <dir>/same/<id>/<a>.(png|jpg) + <b>.(png|jpg)   two copies of one picture
//                 <dir>/different/<id>/<a> + <b>                  look-alike but different (optional)
// Random negatives are built by pairing images from different ids.
//
// Metric (same for every method): pick the similarity threshold at which at most --rate of the
// random negative pairs match (default 1%), then count how many "same picture" pairs match at
// that threshold, and how many look-alike "different" pairs match too (false matches).
// Everything runs in one process, one pair at a time, to keep memory low.

const fs = require('fs');
const path = require('path');
const did = require('../../');

// ------------------------------------------------------------------ args
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const BASES = Number(arg('--bases', 60));
const RATE = Number(arg('--rate', 0.01));
const RANDOM_NEG = Number(arg('--random', 2000));
const PAIRS_DIR = arg('--pairs', null);
const JSON_OUT = arg('--json', null);
const SEED = Number(arg('--seed', 7));

// ------------------------------------------------------------------ seeded RNG
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------------ tiny RGBA image helpers (independent of the package)
const W = 320, H = 220;
const blank = (w = W, h = H, v = 255) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
function setAlphaOpaque(img) { for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; return img; }
function inkAt(img, x, y, a) { // darken pixel towards black by coverage a in [0,1]
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || a <= 0) return;
  const i = (y * img.width + x) * 4;
  for (let c = 0; c < 3; c++) img.data[i + c] = Math.min(img.data[i + c], Math.round(255 * (1 - Math.min(1, a))));
}
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
function strokeSeg(img, ax, ay, bx, by, w) {
  const x0 = Math.floor(Math.min(ax, bx) - w - 1), x1 = Math.ceil(Math.max(ax, bx) + w + 1);
  const y0 = Math.floor(Math.min(ay, by) - w - 1), y1 = Math.ceil(Math.max(ay, by) + w + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) inkAt(img, x, y, w / 2 + 0.5 - segDist(x, y, ax, ay, bx, by));
}
function strokeCircle(img, cx, cy, r, w) {
  for (let y = Math.floor(cy - r - w - 1); y <= cy + r + w + 1; y++)
    for (let x = Math.floor(cx - r - w - 1); x <= cx + r + w + 1; x++) inkAt(img, x, y, w / 2 + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - r));
}

// A random diagram is a list of shapes, so a "sibling" can change exactly one of them.
function randomShapes(r) {
  const n = 4 + Math.floor(r() * 5), shapes = [];
  const P = () => [20 + r() * (W - 40), 20 + r() * (H - 40)];
  for (let k = 0; k < n; k++) {
    const t = Math.floor(r() * 6), w = 1.5 + r() * 2.5;
    if (t === 0) shapes.push({ t: 'line', a: P(), b: P(), w });
    else if (t === 1) { const [x, y] = P(); shapes.push({ t: 'rect', x, y, w2: 20 + r() * 80, h2: 15 + r() * 60, w }); }
    else if (t === 2) { const [x, y] = P(); shapes.push({ t: 'circle', x, y, rad: 8 + r() * 40, w }); }
    else if (t === 3) { const [x, y] = P(); shapes.push({ t: 'zigzag', x, y, n: 3 + Math.floor(r() * 4), step: 8 + r() * 10, amp: 5 + r() * 10, w }); }
    else if (t === 4) shapes.push({ t: 'arrow', a: P(), b: P(), w });
    else { const [x, y] = P(); shapes.push({ t: 'ticks', x, y, n: 3 + Math.floor(r() * 5), gap: 4 + r() * 5, len: 6 + r() * 8, w: 1 + r() }); }
  }
  return shapes;
}
function draw(shapes) {
  const img = blank();
  for (const s of shapes) {
    if (s.t === 'line') strokeSeg(img, ...s.a, ...s.b, s.w);
    else if (s.t === 'rect') { const { x, y, w2, h2, w } = s; strokeSeg(img, x, y, x + w2, y, w); strokeSeg(img, x + w2, y, x + w2, y + h2, w); strokeSeg(img, x + w2, y + h2, x, y + h2, w); strokeSeg(img, x, y + h2, x, y, w); }
    else if (s.t === 'circle') strokeCircle(img, s.x, s.y, s.rad, s.w);
    else if (s.t === 'zigzag') { for (let i = 0; i < s.n; i++) strokeSeg(img, s.x + i * s.step, s.y + (i % 2 ? s.amp : -s.amp), s.x + (i + 1) * s.step, s.y + ((i + 1) % 2 ? s.amp : -s.amp), s.w); }
    else if (s.t === 'arrow') { strokeSeg(img, ...s.a, ...s.b, s.w); const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]); for (const d of [2.6, -2.6]) strokeSeg(img, ...s.b, s.b[0] + 10 * Math.cos(ang + d), s.b[1] + 10 * Math.sin(ang + d), s.w); }
    else if (s.t === 'ticks') { for (let i = 0; i < s.n; i++) strokeSeg(img, s.x + i * s.gap, s.y, s.x + i * s.gap, s.y + s.len, s.w); }
  }
  return setAlphaOpaque(img);
}
function sibling(shapes, r) { // same layout, one shape moved or resized: a different picture that looks alike
  const s = JSON.parse(JSON.stringify(shapes)), k = Math.floor(r() * s.length), sh = s[k], d = 18 + r() * 20;
  if (sh.a) { sh.b[0] = Math.max(10, Math.min(W - 10, sh.b[0] + d)); }
  else if (sh.rad) sh.rad = Math.max(6, sh.rad + (r() < 0.5 ? -d / 2 : d / 2));
  else { sh.x = Math.max(10, Math.min(W - 60, sh.x + d)); }
  return s;
}

// ------------------------------------------------------------------ independent edits ("same picture" variants)
function boxResize(img, w2, h2) {
  const out = blank(w2, h2, 0), sx = img.width / w2, sy = img.height / h2;
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let yy = y0; yy < y1 && yy < img.height; yy++) for (let xx = x0; xx < x1 && xx < img.width; xx++) { const i = (yy * img.width + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += img.data[i + c]; n++; }
    const o = (y * w2 + x) * 4; for (let c = 0; c < 4; c++) out.data[o + c] = acc[c] / (n || 1);
  }
  return out;
}
function map(img, f) { const out = { ...img, data: new Uint8ClampedArray(img.data) }; for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = f(out.data[i + c], i / 4); return out; }
function pad(img, t, l, b, rr) { const out = blank(img.width + l + rr, img.height + t + b); for (let y = 0; y < img.height; y++) out.data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + t) * out.width + l) * 4); return out; }
function crop(img, x, y, w2, h2) { const out = blank(w2, h2); for (let yy = 0; yy < h2; yy++) out.data.set(img.data.subarray(((y + yy) * img.width + x) * 4, ((y + yy) * img.width + x + w2) * 4), yy * w2 * 4); return out; }
function rotate(img, deg) {
  const out = blank(img.width, img.height), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = img.width / 2, cy = img.height / 2;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const sx = c * (x - cx) + s * (y - cy) + cx, sy = -s * (x - cx) + c * (y - cy) + cy, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? 255 : img.data[(yy * img.width + xx) * 4 + ch]);
      out.data[(y * img.width + x) * 4 + ch] = g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
    }
  }
  return out;
}
function boxBlur(img) { const out = { ...img, data: new Uint8ClampedArray(img.data) }; for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += img.data[((y + dy) * img.width + x + dx) * 4 + c]; out.data[(y * img.width + x) * 4 + c] = s / 9; } return out; }
function thicken(img) { const out = { ...img, data: new Uint8ClampedArray(img.data) }; for (let y = 1; y < img.height - 1; y++) for (let x = 1; x < img.width - 1; x++) for (let c = 0; c < 3; c++) { let m = 255; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.min(m, img.data[((y + dy) * img.width + x + dx) * 4 + c]); out.data[(y * img.width + x) * 4 + c] = m; } return out; }
const EDITS = {
  'resize-down': (img) => boxResize(img, Math.round(img.width * 0.55), Math.round(img.height * 0.55)),
  'margin': (img) => pad(img, 24, 40, 12, 18),
  'crop': (img) => crop(img, 6, 5, img.width - 14, img.height - 11),
  'noise': (img, r) => map(img, (v) => v + (r() + r() + r() - 1.5) * 25),
  'grey-background': (img) => map(img, (v, p) => v * 0.78 + 30 + ((p % img.width) / img.width) * 12),
  'blur': (img) => boxBlur(img),
  'rotate-2deg': (img) => rotate(img, 2),
  'thicker-lines': (img) => thicken(img),
  'brightness-contrast': (img) => map(img, (v) => (v - 128) * 0.8 + 140),
  'scan-like': (img, r) => map(boxBlur(rotate(img, 1.2)), (v, p) => v * 0.8 + 28 + (r() - 0.5) * 30),
};

// ------------------------------------------------------------------ data sets
function syntheticSet() {
  const r = rng(SEED), items = [], same = [], different = [];
  for (let b = 0; b < BASES; b++) {
    const shapes = randomShapes(r), base = draw(shapes), id = `b${b}`;
    items.push({ id: `${id}/base`, group: id, img: base });
    for (const [kind, f] of Object.entries(EDITS)) { const v = f(base, r); items.push({ id: `${id}/${kind}`, group: id, img: v }); same.push([`${id}/base`, `${id}/${kind}`, kind]); }
    items.push({ id: `${id}/sibling`, group: `${id}s`, img: draw(sibling(shapes, r)) });
    different.push([`${id}/base`, `${id}/sibling`, 'look-alike sibling']);
  }
  return { name: 'synthetic line art', items, same, different };
}
function folderSet(dir) {
  const items = [], same = [], different = [], ok = (f) => /\.(png|jpe?g)$/i.test(f);
  const read = (kind) => {
    const root = path.join(dir, kind); if (!fs.existsSync(root)) return;
    for (const id of fs.readdirSync(root)) {
      const files = fs.readdirSync(path.join(root, id)).filter(ok).sort(); if (files.length < 2) continue;
      const ids = files.slice(0, 2).map((f) => { const key = `${kind}/${id}/${f}`; items.push({ id: key, group: `${kind}/${id}${kind === 'different' ? '/' + f : ''}`, file: path.join(root, id, f) }); return key; });
      (kind === 'same' ? same : different).push([ids[0], ids[1], kind]);
    }
  };
  read('same'); read('different');
  return { name: `folder ${dir}`, items, same, different };
}
function randomNegatives(set) {
  const r = rng(SEED + 1), out = [], seen = new Set(), n = set.items.length;
  for (let tries = 0; out.length < RANDOM_NEG && tries < RANDOM_NEG * 20; tries++) {
    const a = set.items[Math.floor(r() * n)], b = set.items[Math.floor(r() * n)];
    if (a.group === b.group || a.group.replace(/s$/, '') === b.group.replace(/s$/, '')) continue;
    const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; if (seen.has(k)) continue; seen.add(k); out.push([a.id, b.id]);
  }
  return out;
}

// ------------------------------------------------------------------ encoding / decoding helpers for competitors
const toDidImage = (img) => ({ width: img.width, height: img.height, channels: 4, data: Uint8Array.from(img.data) });
function pngOf(item) { if (!item.png) item.png = item.file ? fs.readFileSync(item.file) : Buffer.from(did.encodePng(toDidImage(item.img))); return item.png; }
function rgbaOf(item) { // neutral decode for packages that need pixels: use the image itself, or pngjs/jpeg-js for files
  if (item.img) return item.img;
  if (!item.rgba) {
    const buf = fs.readFileSync(item.file);
    if (/\.png$/i.test(item.file)) { const { PNG } = require('pngjs'); const p = PNG.sync.read(buf); item.rgba = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) }; }
    else { const j = require('jpeg-js').decode(buf, { useTArray: true, formatAsRGBA: true }); item.rgba = { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data) }; }
  }
  return item.rgba;
}
const hexBits = (hex) => { let s = ''; for (const ch of hex) s += parseInt(ch, 16).toString(2).padStart(4, '0'); return s; };
const hexSim = (a, b) => { const x = hexBits(a), y = hexBits(b); let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++; return 1 - d / x.length; };
const SQ = 256;
const square = (item) => item.sq || (item.sq = boxResize(rgbaOf(item), SQ, SQ));

// ------------------------------------------------------------------ methods (each returns a similarity in [0, 1])
function methods() {
  const list = [];
  for (const preset of ['none', 'lineart', 'scan']) for (const m of ['dhash64', 'ahash64', 'phash64']) {
    // One method per fingerprint call, so the timing column is per method.
    list.push({ name: `duplicate-image-detector ${preset}+${m}`, pkg: 'duplicate-image-detector', prep: (it) => did.fingerprint(pngOf(it), { preset, methods: [m] })[m], sim: hexSim });
  }
  const imageHash = require('image-hash').imageHash;
  list.push({ name: 'image-hash 16 (precise)', pkg: 'image-hash', async: true, prep: (it) => new Promise((res, rej) => imageHash({ data: pngOf(it), ext: it.file && /jpe?g$/i.test(it.file) ? 'image/jpeg' : 'image/png' }, 16, true, (e, h) => (e ? rej(e) : res(h)))), sim: hexSim });
  const imghash = require('imghash');
  list.push({ name: 'imghash 16', pkg: 'imghash', async: true, prep: (it) => imghash.hash(pngOf(it), 16), sim: hexSim });
  const { bmvbhash } = require('blockhash-core');
  list.push({ name: 'blockhash-core 16', pkg: 'blockhash-core', prep: (it) => bmvbhash(rgbaOf(it), 16), sim: hexSim });
  list.push({ name: 'pixelmatch (both resized to 256x256)', pkg: 'pixelmatch', pairwise: true, cmp: async (a, b) => { const pm = (await import('pixelmatch')).default; const A = square(a), B = square(b); return 1 - pm(A.data, B.data, null, SQ, SQ, { threshold: 0.1 }) / (SQ * SQ); } });
  const looksSame = require('looks-same');
  list.push({ name: 'looks-same (both resized to 256x256)', pkg: 'looks-same', pairwise: true, cmp: async (a, b) => { const enc = (it) => it.sqpng || (it.sqpng = Buffer.from(did.encodePng(toDidImage(square(it))))); const r = await looksSame(enc(a), enc(b), { createDiffImage: true }); return 1 - r.differentPixels / r.totalPixels; } });
  return list;
}

// ------------------------------------------------------------------ scoring
async function score(set) {
  const byId = new Map(set.items.map((it) => [it.id, it]));
  const neg = randomNegatives(set), rows = [];
  for (const m of methods()) {
    const t0 = Date.now(); let prepCount = 0;
    const val = new Map();
    const get = async (id) => { if (!val.has(id)) { val.set(id, await m.prep(byId.get(id))); prepCount++; } return val.get(id); };
    const s = async ([a, b]) => (m.pairwise ? m.cmp(byId.get(a), byId.get(b)) : m.sim(await get(a), await get(b)));
    let failed = 0;
    const run = async (pairs) => { const out = []; for (const p of pairs) { try { out.push(await s(p)); } catch (e) { failed++; out.push(-1); } } return out; };
    const sp = await run(set.same), sd = await run(set.different), sn = await run(neg);
    const sorted = [...sn].sort((x, y) => y - x), th = sorted[Math.floor(sorted.length * RATE)] + 1e-9;
    const byKind = {};
    set.same.forEach((p, i) => { const k = p[2]; (byKind[k] ||= [0, 0]); byKind[k][1]++; if (sp[i] >= th) byKind[k][0]++; });
    rows.push({
      method: m.name, pkg: m.pkg,
      samePictures: `${sp.filter((v) => v >= th).length}/${sp.length}`,
      sameRate: sp.filter((v) => v >= th).length / sp.length,
      lookAlikeFalse: set.different.length ? `${sd.filter((v) => v >= th).length}/${sd.length}` : 'n/a',
      randomFalse: `${sn.filter((v) => v >= th).length}/${sn.length}`,
      threshold: +th.toFixed(4), failed,
      msPerItem: +((Date.now() - t0) / Math.max(1, m.pairwise ? set.same.length + set.different.length + neg.length : prepCount)).toFixed(2),
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, [a, n]]) => [k, `${a}/${n}`])),
    });
    process.stderr.write(`  ${m.name}: ${rows.at(-1).samePictures}\n`);
  }
  rows.sort((a, b) => b.sameRate - a.sameRate);
  return { set: set.name, items: set.items.length, same: set.same.length, different: set.different.length, randomNegatives: neg.length, rate: RATE, rows };
}

function print(res) {
  console.log(`\n## ${res.set}: ${res.same} same-picture pairs, ${res.different} look-alike pairs, ${res.randomNegatives} random pairs; threshold = at most ${(res.rate * 100).toFixed(1)}% random false matches\n`);
  console.log('| method | same pictures matched | look-alikes wrongly matched | random wrongly matched | ms per image/pair | errors |');
  console.log('|---|---|---|---|---|---|');
  for (const r of res.rows) console.log(`| ${r.method} | ${r.samePictures} | ${r.lookAlikeFalse} | ${r.randomFalse} | ${r.msPerItem} | ${r.failed} |`);
  const kinds = Object.keys(res.rows[0].byKind);
  if (kinds.length > 1) {
    console.log(`\nBy edit (same pictures matched):\n`);
    console.log(`| method | ${kinds.join(' | ')} |`); console.log(`|---|${kinds.map(() => '---').join('|')}|`);
    for (const r of res.rows) console.log(`| ${r.method} | ${kinds.map((k) => r.byKind[k]).join(' | ')} |`);
  }
}

(async () => {
  const versions = Object.fromEntries(['image-hash', 'imghash', 'blockhash-core', 'looks-same', 'pixelmatch'].map((p) => [p, JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', p, 'package.json'), 'utf8')).version]));
  versions['duplicate-image-detector'] = require('../../package.json').version;
  console.log(`# Duplicate-picture benchmark\n\nNode ${process.version}; packages: ${Object.entries(versions).map(([k, v]) => `${k}@${v}`).join(', ')}`);
  const results = [];
  process.stderr.write(`synthetic set (${BASES} base diagrams)...\n`);
  results.push(await score(syntheticSet()));
  if (PAIRS_DIR) { process.stderr.write(`folder ${PAIRS_DIR}...\n`); results.push(await score(folderSet(PAIRS_DIR))); }
  results.forEach(print);
  console.log([
    '\nNotes:',
    '- Synthetic diagrams and edits are generated by this script, not by the package under test. The edit list leans towards line art and scans, which is the use case this benchmark was written for; run --pairs on your own real pairs before drawing conclusions.',
    '- "Look-alike" pairs are the same layout with one shape moved or resized. They are different pictures, but every image hash is expected to match most of them: pixels alone cannot tell a small edit from a re-export. Callers need other signals (text, metadata) for that.',
    '- pixelmatch and looks-same compare pixels of equal-size images, so both images are resized to 256x256 with the same box filter first; they are built for screenshot regression, not near-duplicate search.',
    '- Hash packages are compared by the Hamming similarity of their own hashes; the threshold for every method is set so the same share of random pairs match.',
  ].join('\n'));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ versions, results }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
