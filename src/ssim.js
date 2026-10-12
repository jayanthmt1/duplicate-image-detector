'use strict';

// SSIM (Wang et al. 2004) between two images, for verifying a candidate pair, not for search.
// Both images are converted to gray and resized to size x size first; windows are 8x8 with
// stride 4. Returns the mean SSIM (1 = identical).

const { toGray } = require('./ops/color');
const { resize } = require('./ops/resize');

function ssim(imgA, imgB, { size = 128, window = 8, stride = 4 } = {}) {
  const a = resize(toGray(imgA), size, size).data;
  const b = resize(toGray(imgB), size, size).data;
  const C1 = 2.55 * 2.55;
  const C2 = 7.65 * 7.65;
  const n = window * window;
  let total = 0;
  let count = 0;
  for (let y = 0; y + window <= size; y += stride) {
    for (let x = 0; x + window <= size; x += stride) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < window; j++) {
        for (let i = 0; i < window; i++) {
          const p = (y + j) * size + x + i;
          const va = a[p];
          const vb = b[p];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return total / count;
}

module.exports = { ssim };
