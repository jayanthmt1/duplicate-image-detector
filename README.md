# duplicate-image-detector

[![npm version](https://img.shields.io/npm/v/duplicate-image-detector.svg)](https://www.npmjs.com/package/duplicate-image-detector)
[![license: MIT](https://img.shields.io/npm/l/duplicate-image-detector.svg)](LICENSE)
[![node](https://img.shields.io/node/v/duplicate-image-detector.svg)](https://www.npmjs.com/package/duplicate-image-detector)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Find duplicate and near-duplicate images in Node.js. It fingerprints each image with perceptual hashes (dHash, aHash, pHash) and compares the fingerprints. That finds the same picture across PNG, JPEG, GIF and BMP files, at different sizes, with extra margins, on grey scanned paper or slightly rotated.

- **Zero dependencies:** pure JavaScript, with no native add-ons, WASM, AI or network calls. Node.js 18 or later.
- **Deterministic:** the same image gives the same fingerprint on every machine.
- **Tuned for line art:** diagrams, equations, chemical structures, charts, scanned book pages and exam questions. It also works on photos.
- **Exact and near matches:** `pixelSha` says when two files hold identical pixels. Perceptual hashes rank likely duplicates for a person to review.

## Install

```bash
npm install duplicate-image-detector
```

## Quick start

Find duplicates in a folder from the command line:

```bash
npx duplicate-image-detector dupes ./images
```

Or from code:

```js
const did = require('duplicate-image-detector');   // or: import did from 'duplicate-image-detector'
const fs = require('fs');

const opts = { preset: 'scan', methods: ['pixelSha', 'dhash64', 'ahash64'] };
const a = did.fingerprint(fs.readFileSync('a.png'), opts);
const b = did.fingerprint(fs.readFileSync('b.jpg'), opts);

did.compare(a, b);
// { pixelSha: false, dhash64: 0.94, ahash64: 0.97 }   1 = identical, about 0.5 = unrelated
```

To search a stored collection for the closest matches to a new image, see [Searching a collection](#searching-a-collection).

## Features

| Area | What's there |
|---|---|
| Decoders | PNG (all colour types and depths, palette, tRNS, Adam7, 16-bit); JPEG baseline, extended and **progressive** (any sampling, restarts, multi-scan, gray/YCbCr/RGB/CMYK, EXIF orientation), bit-exact with libjpeg-turbo; **GIF** (first frame: LZW, interlacing, transparency, frame offsets); **BMP** (1/4/8/16/24/32-bit, RLE4/RLE8, bit fields, alpha, top-down); raw pixels |
| Operations | grayscale, flatten, resize, crop, pad, rotate (EXIF + any angle), Gaussian blur, median, min/max |
| Normalisation | presets `none`, `photo`, `lineart`, `scan`: Otsu/Sauvola, background removal, speckle removal, trim, deskew, Zhang–Suen thinning |
| Fingerprints | `fileSha`, `pixelSha`, `ahash64`, `dhash64`, `dhash256`, `phash64`, `goldberg`, `ink16`, `inkmap32`, **`chamfer64`**, **`edgehist`** |
| Compare | equality, Hamming, normalised L2, ink overlap with tolerance, **chamfer distance** (Felzenszwalb–Huttenlocher distance transform), SSIM |
| Search | **`nearestByHamming` / `createHammingIndex`** (brute force, exact), `findDuplicates`, `bandKeys`, `findCommonBands` |
| Batches | **`fingerprintMany` / `createPool`**: worker threads, 2 by default, one job per worker in flight |
| Evaluation | harness, synthetic variant generator, `evaluateFolder` |
| CLI | **`duplicate-image-detector fingerprint | compare | dupes | eval`** |

## Use

```js
const ic = require('duplicate-image-detector');    // or: import ic from 'duplicate-image-detector'

const fp = ic.fingerprint(buffer, {
  preset: 'scan',
  methods: ['fileSha', 'pixelSha', 'dhash64', 'ahash64'],
  maxPixels: 20_000_000,                 // for untrusted uploads; see "Limits and safety"
});
// { v: 1, preset: 'scan', w: 97, h: 61, fileSha: '…', pixelSha: '…', dhash64: '…', ahash64: '…' }

ic.compare(fpA, fpB);   // { fileSha: false, pixelSha: true, dhash64: 0.95, ahash64: 0.97 }
ic.nearestByHamming(fp.dhash64, bank, { k: 5, minSimilarity: 0.78 });   // see "Searching a collection"

ic.fingerprint({ width, height, channels: 4, data });  // bring your own decoder
ic.encodePng(ic.normalize(ic.decode(buffer), 'lineart'));  // see what the hashes see
```

`fileSha` and `pixelSha` are always computed from the file and the decoded pixels. The preset only affects the perceptual methods. Overrides go in `normalize: { … }` and are recorded in `fp.preset`, for example `lineart(size=128)`. `compare` returns `null` for perceptual methods when the presets differ.

## Presets

| preset | what it does | use for |
|---|---|---|
| `none` (default) | grayscale at full size | compatibility; photos you don't want altered |
| `photo` | grayscale, long side ≤ 1024, trim flat borders | ordinary pictures |
| `lineart` | ≤ 1024, Otsu ink mask, drop specks, trim to the ink, stretch to 256×256 keeping thin lines | digital diagrams, equations, structures |
| `scan` | `lineart` plus paper-shade removal, Sauvola thresholding and deskew (±5°) | **recommended for exam line art**, scanned or digital (best on real pairs, below) |

Use **one preset for a whole collection**: `compare` returns `null` for perceptual methods across presets, so a backfill and later uploads must use the same one.

The defaults were chosen by measurement (see below):

- **Stretching** the trimmed ink to the square grid beat padding it to a square, because padding leaves rows of the hash grid empty.
- A **3×3 median denoise** erased one-pixel lines, so it's off by default (`denoise: true` enables it).
- **Stroke normalisation** (thin, then redraw at a fixed width) gave no measurable gain, so it's opt-in with `stroke: 'normalize'`.

## Methods

| method | size | compared by |
|---|---|---|
| `fileSha`, `pixelSha` | 64 hex | equality. `pixelSha` is the canonical RGB of the decoded pixels, the **safe exact match** across PNG encodings |
| `ahash64`, `dhash64`, `phash64` | 16 hex | Hamming similarity |
| `dhash256` | 64 hex | Hamming similarity |
| `goldberg` | 432 hex | normalised L2 (Wong, Bern & Goldberg image signature) |
| `ink16` | 512 hex | normalised L2 (16×16 ink density grid) |
| `inkmap32` | 256 hex | ink overlap F1 with 1-cell tolerance |
| `chamfer64` | 1024 hex | symmetric truncated chamfer distance on a 64×64 ink map, as 1 / (1 + d) |
| `edgehist` | 256 hex | normalised L2 (4×4 cells × 8 edge orientations) |
| `ssim` (function) | — | for verifying a candidate pair, not for search |

## How well it works

### Real pairs

26 real "same picture" pairs from an exam-question bank, 104 pairs of different questions (look-alike figures) and 600 random pairs. The threshold is set so at most 1% of random pairs (6 of 600) match. The images are private and not included in this package.

| Preset + method | Same pictures (of 26) | Different questions matched (of 104) | Random false matches (of 600) |
|---|---|---|---|
| `scan` + `ahash64` | 19 | 5 | 6 |
| `lineart` + `dhash64` | 17 | 6 | 6 |
| `lineart` + `ahash64` | 17 | 5 | 6 |
| `scan` + `dhash64` | 16 | 6 | 0 |
| `scan` + `phash64` | 15 | 2 | 0 |
| `lineart` + `phash64` | 14 | 3 | 0 |
| `scan` + `chamfer64` | 14 | 4 | 5 |
| `none` + `dhash64` | 14 | 2 | 0 |
| `none` + `phash64` | 9 | 4 | 0 |
| `none` + `pixelSha` | 1 | 2 | 0 |

**Recommendation:** the `scan` preset with `dhash64` and `ahash64`. `phash64` finds fewer same pictures but matches fewer look-alike figures, so it is a reasonable third signal. `chamfer64` did well on synthetic edits but not on real pairs. The sample is small (26 pairs), so a difference of one or two pairs is not meaningful. Some "different question" matches may be the same figure reused by another question, which is a correct image match; that is why image similarity must be combined with the question text.

### Synthetic edits

`scripts/eval-folder.js` takes any folder of images and pairs each one with 11 synthetic edits ("same"). It also builds 4,000 pairs of different images ("random"). It then reports the share of same pairs matched when the threshold lets through at most 1% of random pairs.

The runs below used two independent samples of 300 private exam-question images. The two samples agreed within about 1 point.

| method | `none` | `photo` | `lineart` | `scan` |
|---|---|---|---|---|
| `phash64` | 93–94% | 91–92% | 99.0–99.3% | 99.1–99.3% |
| `dhash64` | 85–86% | 87% | 98.6–98.8% | 98.7–98.9% |
| `ahash64` | 91% | 92% | 99.2–99.3% | 99.3–99.6% |
| `inkmap32` | 75% | 79% | 99.4–99.8% | 99.5% |
| `goldberg` | 85–86% | 85–87% | 97–98% | 97–98% |
| `chamfer64` | — | — | 99.6% | 99.6% |
| `edgehist` | — | — | 98.8% | 98.7% |

(`chamfer64` and `edgehist` were added in milestone 3 and measured on sample 1 only.) The synthetic results favoured `phash64` and `chamfer64`; the real pairs did not confirm either as the best. Choose methods by the real-pair table.

By edit, `none` fails on added margins (≈26%). `lineart` fixes margins but drops on rotation (90–96%) and on scan-like edits (95–99%). `scan` levels rotation (≈100%) at a cost of about 5–10 ms more per image.

### What the numbers mean

- Near-match scores **rank candidates for human review**. They are never an automatic decision. Only `fileSha`/`pixelSha` are safe for automatic decisions.
- A 1% false-match rate is **per pair**. A query against 180,000 images at that threshold can return around 1,800 unrelated candidates. Take the top few with `nearestByHamming` and let other information (such as accompanying text) and a reviewer decide.
- The random pairs don't include "hard negatives": different figures from the same topic, which look alike. To measure those, pass labelled `different` pairs to `evaluate`.

To evaluate on real labelled pairs:

```js
const res = ic.evaluate(
  { same: [[bufA, bufB], …], different: [[bufC, bufD], …], random: [[…], …] },
  { presets: ['lineart', 'scan'], targetFalseRate: 0.01, imageMethods: ['ssim'] },
);
console.log(ic.formatReport(res));   // matched share, threshold, false matches, per-kind breakdown
```

```bash
node scripts/eval-folder.js ~/images --limit 300 --presets lineart,scan --normalize '{"square":true}'
```

## Command line

```bash
npx duplicate-image-detector fingerprint ./bank --preset scan --methods fileSha,pixelSha,dhash64,ahash64 --out bank.jsonl
npx duplicate-image-detector compare a.png b.jpg
npx duplicate-image-detector dupes ./bank --json dupes.json          # scan + dhash64 >= 0.78 by default
npx duplicate-image-detector eval ./sample --limit 300 --presets lineart,scan
```

`fingerprint` writes one JSON line per image, in input order. `dupes` prints exact groups (identical pixels across formats) and near-duplicate candidates for review. Up to 20,000 images it compares every pair; above that it narrows the search with band keys (`--search all` forces the exact search). Every command takes `--max-pixels N`.

## Batches

```js
const results = await ic.fingerprintMany(filePaths, { preset: 'scan', methods: ['fileSha', 'pixelSha', 'dhash64', 'ahash64'] }, {
  workers: 2,                         // default 2, capped at the CPU count; 0 = no threads
  onResult: (i, r) => save(filePaths[i], r.fp ?? r.error),
});
```

Pass file paths rather than buffers for big batches, so each worker reads its own file. Only one image per worker is in memory at a time. On a laptop, 3,000 mostly small question images took 4.3 s with 2 workers and the `lineart` preset (≈700 images/s, 159 MB of memory). With `scan`, larger images or a single thread it is slower. Measure on the machine that will run the backfill; an estimate of 30–40 minutes single-threaded for 180k images is reasonable. Run large backfills on a server rather than a laptop.

## Searching a collection

For collections up to about a million images, compare the query with every stored hash. It is exact at any threshold, and fast enough: 180,000 64-bit hashes take 1.4 MB (8 bytes each) and about 1 ms per query.

```js
// Build once (e.g. at startup) from stored fingerprints, then query per upload.
const index = ic.createHammingIndex(bank.map((row) => ({ id: row.id, hash: row.dhash64 })));
const top = index.nearest(fp.dhash64, { k: 10, minSimilarity: 0.78 });
// [{ index, id, distance: 3, similarity: 0.953 }, …] best first

ic.nearestByHamming(fp.dhash64, hashes, { k: 10 });   // one-off search without keeping an index
```

Band keys (next section) cannot do this job at realistic thresholds. Copies of the same picture can differ in 14–20 of 64 bits, while 8 bands only guarantee finding pairs within 7 bits. Use band keys only when the collection is too large to scan, or as a quick first pass.

## Database keys (multi-index hashing)

For very large collections, or when the database must do the filtering, `bandKeys` cuts a hash into *m* bands. Any two hashes that differ in at most *m − 1* bits share at least one band key. To find candidates, look up each key, then rank the candidates by similarity on the full hash. Use the threshold that `evaluate` reports for your data.

Near-blank images all produce the same hash and swamp the common keys. Run `findCommonBands` over the stored keys and skip the keys it returns at query time.

**MongoDB** (multikey index):

```js
doc.imgKeys = ic.bandKeys(fp.dhash64, { bands: 8, prefix: 'd64:' });   // 8 bands -> within 7 bits
// db.images.createIndex({ imgKeys: 1 })
// db.images.find({ imgKeys: { $in: ic.bandKeys(query.dhash64, { bands: 8, prefix: 'd64:' }) } })
```

**DynamoDB** (one item per band key):

```js
for (const key of ic.bandKeys(fp.dhash64, { bands: 8 })) {
  // PutItem { pk: `D64#${key}`, sk: imageId, dhash64: fp.dhash64 }
}
// Exact matches: PutItem { pk: `PIX#${fp.pixelSha}`, sk: imageId }
```

The trade-off: more bands find matches at larger distances but give shorter keys, so each lookup returns more candidates. At the measured `dhash64` threshold of 0.78, pairs can differ in up to 14 of 64 bits; no practical band count guarantees finding those. Prefer the brute-force search above whenever the collection fits in memory.

## Determinism

Fingerprints use integer and fixed-point arithmetic. Where floating point is needed, only + − × ÷ √ are used, which IEEE-754 makes identical everywhere. `Math.sin`, `Math.cos` and `Math.exp` are avoided because engines may differ in the last bit; deterministic versions are in `src/detmath.js`.

The tests pin a digest of the complete fingerprint for every preset and method. If an output changes, `FINGERPRINT_VERSION` must be bumped.

## Limits and safety

- Images are refused when larger than `maxPixels`. The default is 100,000,000 pixels, which is about 400 MB once decoded to RGBA. **For untrusted uploads on a server, pass `maxPixels: 20_000_000` or lower**, which caps a decode at about 80 MB. Exam figures are far smaller than either limit.
- PNG data that inflates beyond the size in its header is rejected.
- Gamma and ICC colour profiles are ignored on purpose, for determinism.
- Output is always 8 bits per sample. 16-bit PNG samples are rounded.

## Development

```bash
npm test             # node:test, no dependencies
npm run bench        # per-preset timing on a synthetic 1000x750 diagram (or pass files)
npm run fixtures     # regenerate test/fixtures (needs ImageMagick 7, libjpeg-turbo, Pillow)
npm run eval -- <folder> [options]   # synthetic-variant evaluation of a folder
```

Test fixtures are drawn from primitives by `scripts/make-fixtures.js` and written by independent encoders (ImageMagick, libjpeg-turbo, Pillow). Their reference pixels come from independent decoders: ImageMagick for PNG, GIF and BMP, and `djpeg -dct int` for JPEG. The JPEG decoder, including progressive, matches libjpeg-turbo bit for bit.

There are two deliberate differences from ImageMagick:
- **BMP 16-bit channels** are expanded by bit replication (5 bits: `v << 3 | v >> 2`), as browsers do.
- **32-bit BI_RGB BMPs** use their fourth byte as alpha unless it is zero everywhere.

Timing on a laptop for a 1000×750 diagram, single thread, decode included:

| preset | default methods | all methods |
|---|---|---|
| `none` | 4–14 ms | 12–24 ms |
| `lineart` | 10–18 ms | 11–18 ms |
| `scan` | 17–25 ms | 17–27 ms |

The slowest case is dominated by decoding a 16-bit gray+alpha PNG (9 ms).
