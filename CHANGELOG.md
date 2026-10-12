# Changelog

Fingerprint format version (`v`) is still 1: no method's output changed between milestones; new
methods were added alongside. The test suite pins digests of every method's output to enforce this.

## 0.5.0 (2026-10-12)

Decision-grade matching for checking uploads against a collection. Fingerprint outputs are unchanged (still `v: 1`), so stored fingerprints remain valid.

- `classifyMatch(a, b)`: a tier (`exact`, `likely`, `possible`, `none`) with the scores, preset, thresholds and plain-language reasons. Default thresholds were measured on real exam-question pairs with the `scan` preset: `likely` = dhash64 ≥ 0.80, `possible` = dhash64 ≥ 0.72 or ahash64 ≥ 0.75.
- `createMatchIndex()`: a growable index (`add`, `addMany`, `remove`, `has`) that returns matching stored images best first (exact, likely, possible). About 2 ms per query over 180,000 images. Rejects fingerprints from a different preset or version.
- `groupDuplicates(pairs, groups)`: clusters via union-find. `findDuplicates` now returns `clusters`, and the CLI `dupes` command prints them.
- `createHammingIndex`: now grows with `add()`, supports `remove(id)` and `within(query, minSimilarity)`, and can start empty (`{ bits: 64 }` or size taken from the first hash).
- README: "Check a new upload against your collection" section and clearer positioning (line art and documents, not consumer photo libraries).

## 0.4.1 (2026-10-12)

- Added repository, homepage and issue links (source now on GitHub). No code changes.

## 0.4.0 — first public release as `duplicate-image-detector` (2026-10-12)

- Published under the MIT licence. The CLI command is `duplicate-image-detector`.

- `nearestByHamming` and `createHammingIndex`: exact brute-force search over bit hashes (8 bytes per 64-bit hash, about 1 ms per query over 180k).
- `findDuplicates` defaults to `dhash64` with threshold 0.78 (was `phash64`, 0.85), following the real-pair results. Up to 20,000 images it compares every pair (`search: 'all'`); above that it uses band keys. It now throws when no fingerprint contains the requested method, instead of returning nothing.
- CLI: `compare` and `dupes` default to the `scan` preset; `dupes` defaults to `dhash64` ≥ 0.78 and takes `--search`; every command takes `--max-pixels`.
- README: real-pair results (26 pairs) next to the synthetic ones, `scan` + `dhash64`/`ahash64` recommended, brute-force search recommended over band keys, `maxPixels` guidance for servers.
- Fingerprint outputs are unchanged (still `v: 1`).

## 0.3.0 — milestone 3 (2026-10-11)

- Progressive JPEG (spectral selection and successive approximation, restarts), bit-exact with libjpeg-turbo.
- GIF decoder (first frame: LZW, interlacing, global/local palettes, transparency, frame offsets).
- BMP decoder (core/INFO/V2–V5 headers, 1/4/8/16/24/32-bit, RLE4/RLE8, bit fields, alpha, top-down).
- `distanceTransform` (Felzenszwalb–Huttenlocher), `chamfer`, and the `chamfer64` method.
- `edgeHistogram` and the `edgehist` method (4×4 cells × 8 orientations).
- `fingerprintMany` / `createPool`: worker-thread batches, 2 workers by default.
- `findDuplicates`: exact groups by pixels, near candidates via band keys.
- `evaluateFolder`, `listImages`, and the CLI (`fingerprint`, `compare`, `dupes`, `eval`).

## 0.2.0 — milestone 2

- Presets `photo`, `lineart`, `scan` (Otsu/Sauvola, background removal, speckle removal, trim, deskew, thinning).
- Methods `ahash64`, `dhash256`, `phash64`, `goldberg`, `ink16`, `inkmap32`; `ssim`.
- Image operations: crop, pad, rotate, Gaussian blur, median, min/max.
- Evaluation harness (`evaluate`, `formatReport`) and synthetic variants (`variants`, `makeEvalSet`).

## 0.1.0 — milestone 1

- PNG decoder (all colour types/depths, palette, tRNS, Adam7) and sequential JPEG decoder.
- `fileSha`, `pixelSha`, `dhash64`, `compare`, `bandKeys`, `findCommonBands`.
