'use strict';

// Dev-only: regenerates test/fixtures with independent encoders/decoders.
// Needs ImageMagick 7 (`magick`) and libjpeg-turbo (`cjpeg`, `djpeg`) on PATH.
// All images are drawn here from primitives, so the fixtures contain no third-party content.
//
//   node scripts/make-fixtures.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'test', 'fixtures');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ic-fixtures-'));
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 28, ...opts });
const magick = (...args) => run('magick', args);
const out = (f) => path.join(OUT, f);
const tmp = (f) => path.join(TMP, f);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const NO_DATES = ['-define', 'png:exclude-chunk=date,time,tIME'];

// ---------------------------------------------------------------- source drawings

// Line art: a diagram with antialiased strokes (gray values only), 97x61.
magick('-size', '97x61', 'xc:white', '-fill', 'none', '-stroke', 'black', '-strokewidth', '2',
  '-draw', 'circle 30,30 30,12', '-draw', 'line 4,56 92,6', '-draw', 'rectangle 55,18 88,50',
  '-strokewidth', '1', '-draw', 'polyline 10,10 20,4 30,10 40,4', '-draw', 'ellipse 70,34 10,6 0,360',
  '-colorspace', 'gray', '-depth', '8', tmp('line.png'));

// Colour drawing with gradients (exercises chroma), 83x57.
magick('-size', '83x57', 'gradient:#ff4020-#2060ff', '-fill', '#ffee00', '-stroke', '#004400', '-strokewidth', '3',
  '-draw', 'circle 25,28 25,10', '-fill', 'none', '-stroke', 'black', '-strokewidth', '2',
  '-draw', 'line 2,2 80,54', '-draw', 'rectangle 50,8 78,30', '-depth', '8', tmp('color.png'));

// RGBA: colour drawing with a transparent hole and a half-transparent band.
magick(tmp('color.png'), '-alpha', 'set', '-region', '20x20+40+20', '-alpha', 'transparent', '+region',
  '-region', '83x8+0+48', '-channel', 'A', '-evaluate', 'set', '50%', '+channel', '+region', tmp('rgba.png'));

// Gray + alpha.
magick(tmp('line.png'), '-alpha', 'set', '-region', '30x15+60+40', '-alpha', 'transparent', '+region',
  '-region', '97x6+0+0', '-channel', 'A', '-evaluate', 'set', '30%', '+channel', '+region', tmp('ga.png'));

const manifest = { png: [], jpeg: [], samePicture: [] };

// ---------------------------------------------------------------- PNG fixtures

function png(name, src, defines, extra = []) {
  const args = [src, ...extra];
  for (const [k, v] of Object.entries(defines)) args.push('-define', `png:${k}=${v}`);
  magick(...args, ...NO_DATES, out(name));
  const rgba = magick(out(name), '-depth', '8', 'rgba:-');
  const buf = fs.readFileSync(out(name));
  const ihdr = { colorType: buf[25], bitDepth: buf[24], interlace: buf[28] };
  manifest.png.push({ file: name, rgbaSha: sha(rgba), ihdr });
  return name;
}

const L = tmp('line.png');
const C = tmp('color.png');
const A = tmp('rgba.png');
const GA = tmp('ga.png');

// Gray, every depth.
// Low depths: posterize first so every level is exactly representable.
for (const d of [1, 2, 4, 8, 16]) png(`gray${d}.png`, L, { 'color-type': 0, 'bit-depth': d }, d < 8 ? ['-posterize', String(1 << d)] : []);
// Palette, every depth.
// ImageMagick will not write 1/2/4-bit palettes reliably, so Pillow writes those (it picks the
// smallest depth that holds the palette). ImageMagick still provides the reference pixels.
for (const [name, colors] of [['pal1.png', 2], ['pal2.png', 4], ['pal4.png', 16]]) {
  run('python3', ['-c', `import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGB').quantize(colors=${colors}, dither=Image.Dither.NONE).save(sys.argv[2])`, C, out(name)]);
  const b = fs.readFileSync(out(name));
  manifest.png.push({ file: name, rgbaSha: sha(magick(out(name), '-depth', '8', 'rgba:-')), ihdr: { colorType: b[25], bitDepth: b[24], interlace: b[28] } });
}
png('pal8.png', C, { 'color-type': 3, 'bit-depth': 8 }, ['-colors', '200']);
// Truecolour, gray+alpha, RGBA.
png('rgb8.png', C, { 'color-type': 2, 'bit-depth': 8 });
png('rgb16.png', C, { 'color-type': 2, 'bit-depth': 16 });
png('ga8.png', GA, { 'color-type': 4, 'bit-depth': 8 });
png('ga16.png', GA, { 'color-type': 4, 'bit-depth': 16 });
png('rgba8.png', A, { 'color-type': 6, 'bit-depth': 8 });
png('rgba16.png', A, { 'color-type': 6, 'bit-depth': 16 });
// tRNS transparency.
png('gray8-trns.png', L, { 'color-type': 0, 'bit-depth': 8 }, ['-transparent', 'white']);
png('rgb8-trns.png', C, { 'color-type': 2, 'bit-depth': 8 }, ['-transparent', '#ffee00']);
// Palette with per-entry alpha (tRNS): ImageMagick drops the alpha here, so Pillow writes it.
run('python3', ['-c', `import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGBA').quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(sys.argv[2])`, A, out('pal8-trns.png')]);
{
  const b = fs.readFileSync(out('pal8-trns.png'));
  if (!b.includes('tRNS')) throw new Error('pal8-trns.png has no tRNS chunk');
  manifest.png.push({ file: 'pal8-trns.png', rgbaSha: sha(magick(out('pal8-trns.png'), '-depth', '8', 'rgba:-')), ihdr: { colorType: b[25], bitDepth: b[24], interlace: b[28] } });
}
// Adam7 interlacing.
for (const [name, src, ct, d, pre = []] of [
  ['i-gray1.png', L, 0, 1, ['-posterize', '2']], ['i-gray4.png', L, 0, 4, ['-posterize', '16']], ['i-gray8.png', L, 0, 8], ['i-pal4.png', C, 3, 4],
  ['i-rgb8.png', C, 2, 8], ['i-rgb16.png', C, 2, 16], ['i-ga8.png', GA, 4, 8], ['i-rgba8.png', A, 6, 8],
  ['i-rgba16.png', A, 6, 16],
]) {
  png(name, src, { 'color-type': ct, 'bit-depth': d }, [...pre, ...(ct === 3 ? ['+dither', '-colors', '4'] : []), '-interlace', 'PNG']);
}
// Tiny images (smaller than some Adam7 passes).
magick('-size', '1x1', 'xc:#336699', '-define', 'png:color-type=2', ...NO_DATES, out('tiny-1x1.png'));
magick('-size', '3x2', 'xc:#336699', '-interlace', 'PNG', '-define', 'png:color-type=6', ...NO_DATES, out('tiny-3x2-i.png'));
for (const f of ['tiny-1x1.png', 'tiny-3x2-i.png']) {
  const b = fs.readFileSync(out(f));
  manifest.png.push({ file: f, rgbaSha: sha(magick(out(f), '-depth', '8', 'rgba:-')), ihdr: { colorType: b[25], bitDepth: b[24], interlace: b[28] } });
}

// The same line drawing stored in different PNG forms: pixelSha must agree.
for (const [name, ct, d, extra] of [
  ['same-gray8.png', 0, 8, []], ['same-gray16.png', 0, 16, []], ['same-rgb8.png', 2, 8, []],
  ['same-rgb16.png', 2, 16, []], ['same-pal8.png', 3, 8, []], ['same-ga8.png', 4, 8, []],
  ['same-rgba8.png', 6, 8, []], ['same-gray8-i.png', 0, 8, ['-interlace', 'PNG']],
]) {
  png(name, L, { 'color-type': ct, 'bit-depth': d }, extra);
  manifest.samePicture.push(name);
}

// ---------------------------------------------------------------- JPEG fixtures

magick(C, tmp('color.ppm'));
magick(L, tmp('line.pgm'));
// A photo-like image for JPEG: plasma plus shapes, 123x91 (not a multiple of 16).
magick('-seed', '7', '-size', '123x91', 'plasma:#ff8040-#2080ff', '-blur', '0x1', '-fill', 'none', '-stroke', 'black',
  '-strokewidth', '2', '-draw', 'circle 60,45 60,15', '-draw', 'line 0,0 122,90', tmp('photo.ppm'));
fs.writeFileSync(tmp('seq.scans'), '0;\n1;\n2;\n');
magick('-size', '7x9', 'gradient:red-blue', tmp('seven.ppm'));

function jpeg(name, src, cjpegArgs, opts = {}) {
  run('cjpeg', [...cjpegArgs, '-outfile', out(name), src]);
  if (opts.expectError) {
    manifest.jpeg.push({ file: name, expectError: opts.expectError });
    return;
  }
  const refName = name.replace(/\.jpg$/, '.ref.pnm');
  run('djpeg', ['-dct', 'int', '-pnm', '-outfile', out(refName), out(name)]);
  manifest.jpeg.push({ file: name, ref: refName, ...(opts.meta || {}) });
}

jpeg('c444.jpg', tmp('color.ppm'), ['-quality', '90', '-sample', '1x1']);
jpeg('c422.jpg', tmp('color.ppm'), ['-quality', '90', '-sample', '2x1']);
jpeg('c420.jpg', tmp('color.ppm'), ['-quality', '90', '-sample', '2x2']);
jpeg('c440.jpg', tmp('color.ppm'), ['-quality', '90', '-sample', '1x2']);
jpeg('c411.jpg', tmp('color.ppm'), ['-quality', '90', '-sample', '4x1']);
jpeg('gray.jpg', tmp('line.pgm'), ['-quality', '85']);
jpeg('gray-q100.jpg', tmp('line.pgm'), ['-quality', '100']);
jpeg('photo420.jpg', tmp('photo.ppm'), ['-quality', '75']);
jpeg('photo420-opt.jpg', tmp('photo.ppm'), ['-quality', '75', '-optimize']);
jpeg('photo420-rst1.jpg', tmp('photo.ppm'), ['-quality', '75', '-restart', '1']);
jpeg('photo420-rst3b.jpg', tmp('photo.ppm'), ['-quality', '75', '-restart', '3B']);
jpeg('photo-q1.jpg', tmp('photo.ppm'), ['-quality', '1']); // 16-bit quantization tables, SOF1
jpeg('photo-q100-444.jpg', tmp('photo.ppm'), ['-quality', '100', '-sample', '1x1']);
jpeg('photo-seq-scans.jpg', tmp('photo.ppm'), ['-quality', '80', '-scans', tmp('seq.scans')]); // non-interleaved
jpeg('photo-rgb.jpg', tmp('photo.ppm'), ['-quality', '90', '-rgb']);
// Progressive: cjpeg's standard script (spectral selection + successive approximation), and a
// custom script with two refinement levels for DC and AC.
fs.writeFileSync(tmp('deep.scans'), [
  '0,1,2: 0-0, 0, 2;', '0: 1-5, 0, 2;', '2: 1-63, 0, 1;', '1: 1-63, 0, 1;', '0: 6-63, 0, 2;',
  '0: 1-63, 2, 1;', '0,1,2: 0-0, 2, 1;', '0,1,2: 0-0, 1, 0;', '2: 1-63, 1, 0;', '1: 1-63, 1, 0;', '0: 1-63, 1, 0;',
].join('\n') + '\n');
jpeg('prog420.jpg', tmp('photo.ppm'), ['-quality', '80', '-progressive']);
jpeg('prog444.jpg', tmp('photo.ppm'), ['-quality', '92', '-progressive', '-sample', '1x1']);
jpeg('prog422-rst.jpg', tmp('photo.ppm'), ['-quality', '75', '-progressive', '-sample', '2x1', '-restart', '2B']);
jpeg('prog-gray.jpg', tmp('line.pgm'), ['-quality', '85', '-progressive']);
jpeg('prog-deep.jpg', tmp('photo.ppm'), ['-quality', '85', '-scans', tmp('deep.scans')]);
jpeg('prog-q100.jpg', tmp('color.ppm'), ['-quality', '100', '-progressive']);
jpeg('prog-tiny.jpg', tmp('seven.ppm'), ['-quality', '90', '-progressive']);
magick('-size', '1x1', 'xc:#336699', tmp('one.ppm'));
jpeg('tiny-1x1.jpg', tmp('one.ppm'), ['-quality', '90']);
jpeg('tiny-7x9.jpg', tmp('seven.ppm'), ['-quality', '90']);

// EXIF orientation 1..8: insert an APP1 Exif segment after SOI of a 4:2:0 file.
function exifApp1(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
const base = fs.readFileSync(out('c420.jpg'));
const ORIENT_OPS = { 1: [], 2: ['-flop'], 3: ['-rotate', '180'], 4: ['-flip'], 5: ['-transpose'], 6: ['-rotate', '90'], 7: ['-transverse'], 8: ['-rotate', '270'] };
for (let o = 1; o <= 8; o++) {
  const name = `orient${o}.jpg`;
  fs.writeFileSync(out(name), Buffer.concat([base.subarray(0, 2), exifApp1(o), base.subarray(2)]));
  const refName = `orient${o}.ref.pnm`;
  magick(out('c420.ref.pnm'), ...ORIENT_OPS[o], out(refName));
  manifest.jpeg.push({ file: name, ref: refName, orientation: o });
}

// Same line drawing as PNG and as JPEG: pixelSha differs, dhash64 should be close.
magick(L, '-quality', '92', out('same-line.jpg'));
manifest.lineJpeg = 'same-line.jpg';

// ---------------------------------------------------------------- GIF and BMP fixtures
// (photo.ppm is created in the JPEG section above.)
// Reference: ImageMagick's first frame on its canvas, RGBA, with fully transparent pixels
// zeroed (their colour is meaningless).
function zeroTransparent(rgba) {
  const b = Buffer.from(rgba);
  for (let i = 0; i < b.length; i += 4) if (b[i + 3] === 0) b[i] = b[i + 1] = b[i + 2] = 0;
  return b;
}
manifest.other = [];
function other(name) {
  const rgba = magick(`${out(name)}[0]`, '-background', 'none', '-flatten', '-depth', '8', 'rgba:-');
  manifest.other.push({ file: name, rgbaSha: sha(zeroTransparent(rgba)) });
}
const pil = (code, ...args) => run('python3', ['-c', `import sys\nfrom PIL import Image\n${code}`, ...args]);

// GIF
magick(C, '-colors', '64', out('gif-basic.gif')); other('gif-basic.gif');
magick(C, '-colors', '64', '-interlace', 'GIF', out('gif-interlaced.gif')); other('gif-interlaced.gif');
// Transparent index (ImageMagick drops it for this input, so Pillow writes it).
pil(`im = Image.open(sys.argv[1]).convert('RGBA')
p = im.convert('RGB').quantize(colors=31)
p.paste(31, (30, 15, 60, 40))
p.save(sys.argv[2], transparency=31, optimize=False)`, C, out('gif-transparent.gif'));
other('gif-transparent.gif');
magick(L, '-colors', '2', out('gif-2colour.gif')); other('gif-2colour.gif');
// 256 colours of noise: the LZW table fills up (12-bit codes, clear codes).
magick('-seed', '3', '-size', '160x120', 'xc:', '+noise', 'Random', '-colors', '256', out('gif-noise256.gif')); other('gif-noise256.gif');
// Two frames; the first is offset on a larger canvas (outside it is transparent).
magick('(', '-size', '30x20', 'xc:#cc3311', '-repage', '60x40+12+7', ')', '(', '-size', '60x40', 'xc:#1133cc', '-repage', '60x40+0+0', ')', out('gif-anim-offset.gif'));
other('gif-anim-offset.gif');
pil(`Image.open(sys.argv[1]).convert('RGB').quantize(colors=100).save(sys.argv[2])`, C, out('gif-pillow.gif')); other('gif-pillow.gif');
pil(`Image.open(sys.argv[1]).convert('RGB').quantize(colors=16).save(sys.argv[2], interlace=True)`, tmp('photo.ppm'), out('gif-pillow-photo.gif')); other('gif-pillow-photo.gif');

// BMP
// -type TrueColor stops ImageMagick from silently writing an 8-bit palette instead.
magick(C, '-type', 'TrueColor', 'BMP3:' + out('bmp24.bmp')); other('bmp24.bmp');
magick(C, '-colors', '200', '-type', 'Palette', 'BMP3:' + out('bmp8.bmp')); other('bmp8.bmp');
magick(C, '-colors', '200', '-type', 'Palette', '-compress', 'RLE', 'BMP3:' + out('bmp8-rle.bmp')); other('bmp8-rle.bmp');
magick(L, '-colors', '2', '-type', 'Palette', 'BMP3:' + out('bmp1.bmp')); other('bmp1.bmp');
magick(A, 'BMP:' + out('bmp32-alpha.bmp')); other('bmp32-alpha.bmp');
// 16-bit: ImageMagick's 5/6-bit to 8-bit rounding differs from the decoder's bit replication
// (v << 3 | v >> 2, as browsers do), so map its values back to their levels and replicate.
const replicate = (v, bits) => {
  let x = 0;
  for (let f = 0; f < 8; f += bits) x = (x << bits) | v;
  return (x >>> (Math.ceil(8 / bits) * bits - 8)) & 255;
};
for (const [name, subtype, bits] of [['bmp16-565.bmp', 'RGB565', [5, 6, 5]], ['bmp16-555.bmp', 'RGB555', [5, 5, 5]]]) {
  magick(tmp('photo.ppm'), '-type', 'TrueColor', '-define', `bmp:subtype=${subtype}`, 'BMP:' + out(name));
  const rgba = Buffer.from(magick(out(name), '-depth', '8', 'rgba:-'));
  for (let i = 0; i < rgba.length; i++) {
    const c = i % 4;
    if (c === 3) continue;
    const max = (1 << bits[c]) - 1;
    rgba[i] = replicate(Math.round((rgba[i] * max) / 255), bits[c]);
  }
  manifest.other.push({ file: name, rgbaSha: sha(rgba) });
}
pil(`Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2])`, tmp('photo.ppm'), out('bmp24-pillow.bmp')); other('bmp24-pillow.bmp');
// ARGB4444: ImageMagick scales 4-bit channels by shifting (15 -> 240); the decoder uses the full
// range (15 -> 255, as browsers do), so the reference rescales ImageMagick's 4-bit values.
magick(A, '-define', 'bmp:subtype=ARGB4444', 'BMP:' + out('bmp16-4444.bmp'));
{
  const rgba = magick(out('bmp16-4444.bmp'), '-depth', '8', 'rgba:-');
  manifest.other.push({ file: 'bmp16-4444.bmp', rgbaSha: sha(zeroTransparent(Buffer.from(rgba.map((v) => (v >> 4) * 17)))) });
}
pil(`Image.open(sys.argv[1]).convert('RGB').quantize(colors=16).save(sys.argv[2])`, C, out('bmp4-pillow.bmp')); other('bmp4-pillow.bmp');
pil(`Image.open(sys.argv[1]).convert('L').save(sys.argv[2])`, L, out('bmp8-gray-pillow.bmp')); other('bmp8-gray-pillow.bmp');
pil(`Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2])`, A, out('bmp32-pillow.bmp')); other('bmp32-pillow.bmp');
// Top-down 24-bit: flip the rows of bmp24.bmp and negate the height.
{
  const b = Buffer.from(fs.readFileSync(out('bmp24.bmp')));
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = b.readInt32LE(22);
  const stride = Math.floor((w * 24 + 31) / 32) * 4;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from(b.subarray(off + y * stride, off + (y + 1) * stride)));
  rows.reverse().forEach((r, y) => r.copy(b, off + y * stride));
  b.writeInt32LE(-h, 22);
  fs.writeFileSync(out('bmp24-topdown.bmp'), b);
  manifest.other.push({ file: 'bmp24-topdown.bmp', rgbaSha: manifest.other.find((x) => x.file === 'bmp24.bmp').rgbaSha });
  if (b.readUInt16LE(28) !== 24) throw new Error('bmp24.bmp is not 24-bit');
}
// RLE4, written by hand (few encoders produce it): a 4x3 image using every escape code.
{
  const pal = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  // Rows are bottom-up. Row 0: run of 4 alternating 1,2. Row 1: absolute 3,1,2 then delta 1,0.
  // Row 2: run 2 of 3, end of bitmap (rest stays index 0).
  const data = Buffer.from([4, 0x12, 0, 0, 0, 3, 0x31, 0x20, 0, 2, 1, 0, 0, 0, 2, 0x33, 0, 1]);
  const head = Buffer.alloc(14 + 40 + 16);
  head.write('BM', 0, 'latin1');
  head.writeUInt32LE(head.length + data.length, 2);
  head.writeUInt32LE(head.length, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(4, 18);
  head.writeInt32LE(3, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(4, 28);
  head.writeUInt32LE(2, 30);
  head.writeUInt32LE(data.length, 34);
  head.writeUInt32LE(4, 46);
  pal.forEach(([r, g, b], i) => { head[54 + i * 4] = b; head[55 + i * 4] = g; head[56 + i * 4] = r; });
  fs.writeFileSync(out('bmp4-rle.bmp'), Buffer.concat([head, data]));
  // Expected, top row first (rows 2, 1, 0).
  const expect = [[3, 3, 0, 0], [3, 1, 2, 0], [1, 2, 1, 2]].flat().map((i) => [...pal[i], 255]).flat();
  manifest.other.push({ file: 'bmp4-rle.bmp', rgbaSha: sha(Buffer.from(expect)) });
}

fs.writeFileSync(out('manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.rmSync(TMP, { recursive: true, force: true });
const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(out(f)).size, 0);
console.log(`wrote ${fs.readdirSync(OUT).length} files, ${(total / 1024).toFixed(0)} KB`);
