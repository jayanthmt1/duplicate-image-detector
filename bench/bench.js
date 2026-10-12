'use strict';

// Times fingerprinting per file and preset, single thread.
//   node bench/bench.js [files...]
// With no files, a synthetic 1000x750 line diagram is generated and encoded as PNG.

const fs = require('fs');
const ic = require('..');

function synthetic(width = 1000, height = 750) {
  const data = new Uint8Array(width * height).fill(255);
  const dot = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) data[yy * width + xx] = 0;
    }
  };
  for (let k = 0; k < 40; k++) {
    const x0 = (k * 97) % width, y0 = (k * 61) % height, x1 = (k * 389) % width, y1 = (k * 211) % height;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) dot(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n));
  }
  return ic.encodePng({ width, height, channels: 1, data });
}

const inputs = process.argv.length > 2
  ? process.argv.slice(2).map((f) => [f, fs.readFileSync(f)])
  : [['synthetic 1000x750 gray PNG', synthetic()]];

const time = (fn, runs) => {
  for (let i = 0; i < 3; i++) fn();
  const t = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) fn();
  return Number(process.hrtime.bigint() - t) / runs / 1e6;
};

for (const [name, buf] of inputs) {
  const img = ic.decode(buf);
  console.log(`${name} (${img.width}x${img.height}, ${img.channels} ch, ${(buf.length / 1024).toFixed(0)} KB)`);
  console.log(`  decode ${time(() => ic.decode(buf), 20).toFixed(1)} ms`);
  for (const preset of ic.PRESETS) {
    const norm = time(() => ic.normalize(img, preset), 10);
    const m1 = time(() => ic.fingerprint(buf, { preset }), 10);
    const all = time(() => ic.fingerprint(buf, { preset, methods: ic.METHODS }), 10);
    console.log(`  ${preset.padEnd(8)} normalise ${norm.toFixed(1)} ms | fingerprint (default methods) ${m1.toFixed(1)} ms | all methods ${all.toFixed(1)} ms`);
  }
}
