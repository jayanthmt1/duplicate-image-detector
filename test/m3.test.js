'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const ic = require('..');
const { prng } = require('../src/detmath');
const { fixture, sha, FIX } = require('./helpers/util');
const { diagram, canvas } = require('./helpers/draw');

test('distance transform equals brute force', () => {
  const r = prng(11);
  for (let t = 0; t < 30; t++) {
    const W = 3 + Math.floor(r() * 25);
    const H = 3 + Math.floor(r() * 25);
    const data = new Uint8Array(W * H).map(() => (r() < 0.06 ? 1 : 0));
    data[Math.floor(r() * W * H)] = 1;
    const d = ic.distanceTransform({ width: W, height: H, data });
    for (let i = 0; i < W * H; i++) {
      let best = Infinity;
      for (let j = 0; j < W * H; j++) {
        if (!data[j]) continue;
        const dx = (i % W) - (j % W);
        const dy = Math.floor(i / W) - Math.floor(j / W);
        best = Math.min(best, dx * dx + dy * dy);
      }
      assert.equal(d[i], best);
    }
  }
  const empty = ic.distanceTransform({ width: 4, height: 4, data: new Uint8Array(16) });
  assert.ok(empty.every((v) => v === 1e20));
});

test('chamfer: identical 1, resized close, different lower, blank handling', () => {
  const a = diagram(200, 150);
  assert.equal(ic.chamfer(a, a), 1);
  const resized = ic.chamfer(a, ic.resize(a, 150, 112));
  const other = ic.chamfer(a, diagram(200, 150, 3));
  assert.ok(resized > 0.85 && resized > other + 0.2, `${resized} vs ${other}`);
  assert.equal(ic.chamfer(canvas(20, 20), canvas(30, 30)), 1);
  assert.equal(ic.chamfer(canvas(20, 20), a), 0);
});

test('edge-orientation histogram: horizontal vs vertical lines land in different bins', () => {
  const h = canvas(64, 64);
  const v = canvas(64, 64);
  for (let i = 8; i < 56; i++) {
    for (let k = 30; k < 34; k++) {
      h.data[k * 64 + i] = 0;
      v.data[i * 64 + k] = 0;
    }
  }
  const eh = ic.edgeHistogram(h);
  const ev = ic.edgeHistogram(v);
  assert.equal(eh.length, 256);
  assert.equal(ic.edgeSimilarity(eh, eh), 1);
  // No shared bins: for non-negative vectors that is the minimum similarity, 1 - sqrt(2)/2.
  for (let i = 0; i < 256; i += 2) {
    assert.ok(eh.slice(i, i + 2) === '00' || ev.slice(i, i + 2) === '00', `bin ${i / 2} used by both`);
  }
  assert.ok(Math.abs(ic.edgeSimilarity(eh, ev) - (1 - Math.SQRT2 / 2)) < 1e-12);
  assert.ok(ic.edgeSimilarity(eh, ic.edgeHistogram(ic.resize(h, 100, 100))) > 0.9);
  assert.equal(ic.edgeHistogram(canvas(10, 10)), '00'.repeat(128));
});

test('golden digests for methods added in milestone 3', () => {
  const golden = {
    'same-gray8.png none': 'f513b2fc990dd13ca2ba5c04ec41eacf30d9a1393dade52064cb0b21adea9446',
    'same-gray8.png lineart': 'e3074c5913a9377cec7d5335fe32efffd857d4e0db4211efd270055fcffcbbf8',
    'same-gray8.png scan': 'e9445abe1b1b28723323c895868bc18aadbfe191906ed62ff42a2d9d67ee89b9',
    'photo420.jpg none': 'a8d92a15d5d009652be3fecd80dfe775c6bb9b5932969184a1d34b9c6a0b4c0d',
    'photo420.jpg lineart': '5d9016e1dd031d4dc3db89d6a48c1010f2fd6ff11fc042b847270265eebe90ae',
    'photo420.jpg scan': '6987860ab37275192c81087f7f5fb773046d2a35325917ffdf9b2b39e67686a1',
  };
  for (const [key, want] of Object.entries(golden)) {
    const [file, preset] = key.split(' ');
    assert.equal(sha(JSON.stringify(ic.fingerprint(fixture(file), { preset, methods: ['chamfer64', 'edgehist'] }))), want, key);
  }
});

test('worker pool: same results as inline, in order, with per-item errors', async () => {
  const files = ['same-gray8.png', 'prog420.jpg', 'gif-basic.gif', 'bmp24.bmp', 'c420.jpg'].map((f) => path.join(FIX, f));
  const opts = { preset: 'lineart', methods: ['pixelSha', 'phash64', 'chamfer64'] };
  const inline = files.map((f) => ic.fingerprint(require('fs').readFileSync(f), opts));
  const seen = [];
  const res = await ic.fingerprintMany([...files, 'missing.png', Buffer.from('nope')], opts, {
    workers: 2,
    onResult: (i) => seen.push(i),
  });
  assert.deepEqual(res.slice(0, 5).map((r) => r.fp), inline);
  assert.match(res[5].error, /ENOENT/);
  assert.match(res[6].error, /unrecognised/);
  assert.deepEqual(seen.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  const zero = await ic.fingerprintMany(files.slice(0, 2), opts, { workers: 0 });
  assert.deepEqual(zero.map((r) => r.fp), inline.slice(0, 2));

  const pool = ic.createPool({ workers: 1 });
  assert.equal(pool.size, 1);
  const [a, b] = await Promise.all([pool.fingerprint(files[0], opts), pool.fingerprint(fixture('bmp24.bmp'), opts)]);
  assert.deepEqual([a, b], [inline[0], inline[3]]);
  await pool.close();
  await assert.rejects(pool.fingerprint(files[0]), /closed/);
  assert.throws(() => ic.createPool({ workers: -1 }), RangeError);
});

test('findDuplicates: exact groups by pixels, near pairs by dhash64 (all pairs or band keys)', () => {
  const d = diagram(160, 120);
  const items = [
    { id: 'a', img: d },
    { id: 'a-copy', img: { ...d, data: new Uint8Array(d.data) } },
    { id: 'a-margin', img: ic.pad(d, { top: 20, left: 9 }) },
    { id: 'b', img: diagram(160, 120, 3) },
    { id: 'c', img: diagram(160, 120, 6) },
  ].map(({ id, img }) => ({ id, fp: ic.fingerprint(img, { preset: 'lineart', methods: ['pixelSha', 'dhash64', 'phash64'] }) }));
  const res = ic.findDuplicates(items, { threshold: 0.9 });
  assert.deepEqual(res.exact, [['a', 'a-copy']]);
  assert.deepEqual(res.near.map((p) => [p.a, p.b, p.similarity]), [['a', 'a-margin', 1]]);
  assert.equal(res.search, 'all');
  // The band search finds the same pair here (it differs in 0 bits), and other methods work too.
  assert.deepEqual(ic.findDuplicates(items, { threshold: 0.9, search: 'bands' }).near, res.near);
  assert.deepEqual(ic.findDuplicates(items, { threshold: 0.9, method: 'phash64' }).near.map((p) => [p.a, p.b]), [['a', 'a-margin']]);
  assert.throws(() => ic.findDuplicates(items, { method: 'goldberg' }), /bit-hash/);
  assert.throws(() => ic.findDuplicates(items, { method: 'ahash64' }), /none of the fingerprints contain ahash64/);
  assert.throws(() => ic.findDuplicates(items, { search: 'fast' }), /search must be/);
});

test('command-line tool', () => {
  const bin = path.join(__dirname, '..', 'bin', 'duplicate-image-detector.js');
  const run = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  assert.match(run('--help'), /Usage:/);
  assert.equal(run('--version').trim(), require('../package.json').version);
  const lines = run('fingerprint', fixture.path('same-gray8.png'), fixture.path('bmp24.bmp'), '--preset', 'lineart', '--methods', 'pixelSha,phash64')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].preset, 'lineart');
  assert.match(lines[0].phash64, /^[0-9a-f]{16}$/);
  const cmp = JSON.parse(run('compare', fixture.path('same-gray8.png'), fixture.path('same-rgb16.png'), '--methods', 'pixelSha,dhash64'));
  assert.deepEqual(cmp, { preset: 'scan', pixelSha: true, dhash64: 1 });
  const dupes = run('dupes', fixture.path('same-gray8.png'), fixture.path('same-rgb8.png'), fixture.path('photo420.jpg'));
  assert.match(dupes, /Exact duplicates \(identical pixels\): 1 groups/);
  assert.throws(() => execFileSync(process.execPath, [bin, 'frobnicate'], { stdio: 'pipe' }), /unknown command/);
});
