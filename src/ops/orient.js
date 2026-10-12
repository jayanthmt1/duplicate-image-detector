'use strict';

const { assertImage } = require('../image');

/**
 * Apply an EXIF orientation (1..8) so the image is upright.
 * 2 mirror, 3 rotate 180, 4 flip, 5 transpose, 6 rotate 90 clockwise, 7 transverse, 8 rotate 90 anticlockwise.
 */
function applyOrientation(img, orientation) {
  assertImage(img);
  if (!orientation || orientation === 1) return img;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new RangeError('orientation must be an integer from 1 to 8');
  }
  const { width: W, height: H, channels: ch, data } = img;
  const swap = orientation >= 5;
  const ow = swap ? H : W;
  const oh = swap ? W : H;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let sx, sy;
      switch (orientation) {
        case 2: sx = W - 1 - x; sy = y; break;
        case 3: sx = W - 1 - x; sy = H - 1 - y; break;
        case 4: sx = x; sy = H - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = H - 1 - x; break;
        case 7: sx = W - 1 - y; sy = H - 1 - x; break;
        default: sx = W - 1 - y; sy = x; break; // 8
      }
      const s = (sy * W + sx) * ch;
      const o = (y * ow + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = data[s + c];
    }
  }
  return { width: ow, height: oh, channels: ch, data: out };
}

module.exports = { applyOrientation };
