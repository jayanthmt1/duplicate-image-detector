'use strict';

const { assertImage } = require('../image');

// Alpha-composite one sample onto white: c * a + 255 * (1 - a), rounded.
const overWhite = (c, a) => ((c * a + 255 * (255 - a) + 127) / 255) | 0;

// ITU-R BT.601 luma in 16-bit fixed point (weights sum to 65536).
const luma = (r, g, b) => (19595 * r + 38470 * g + 7471 * b + 32768) >> 16;

/** Flatten transparency onto white. Returns a 1-channel or 3-channel image. */
function flatten(img) {
  assertImage(img);
  const { width, height, channels, data } = img;
  if (channels === 1 || channels === 3) return img;
  const n = width * height;
  if (channels === 2) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = overWhite(data[2 * i], data[2 * i + 1]);
    return { width, height, channels: 1, data: out };
  }
  const out = new Uint8Array(n * 3);
  for (let i = 0, s = 0, o = 0; i < n; i++, s += 4, o += 3) {
    const a = data[s + 3];
    if (a === 255) {
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2];
    } else {
      out[o] = overWhite(data[s], a); out[o + 1] = overWhite(data[s + 1], a); out[o + 2] = overWhite(data[s + 2], a);
    }
  }
  return { width, height, channels: 3, data: out };
}

/** Grayscale (1 channel), with transparency flattened onto white first. */
function toGray(img) {
  assertImage(img);
  const { width, height, channels, data } = img;
  const n = width * height;
  if (channels === 1) return img;
  const out = new Uint8Array(n);
  if (channels === 2) {
    for (let i = 0; i < n; i++) out[i] = overWhite(data[2 * i], data[2 * i + 1]);
  } else if (channels === 3) {
    for (let i = 0, s = 0; i < n; i++, s += 3) out[i] = luma(data[s], data[s + 1], data[s + 2]);
  } else {
    for (let i = 0, s = 0; i < n; i++, s += 4) {
      const a = data[s + 3];
      out[i] = a === 255
        ? luma(data[s], data[s + 1], data[s + 2])
        : luma(overWhite(data[s], a), overWhite(data[s + 1], a), overWhite(data[s + 2], a));
    }
  }
  return { width, height, channels: 1, data: out };
}

/**
 * Calls fn(rowBytes) once per row with the row as RGB (3 bytes per pixel), transparency
 * flattened onto white. This is the canonical pixel form used by pixelSha.
 */
function forEachRgbRow(img, fn) {
  assertImage(img);
  const { width, height, channels, data } = img;
  const row = new Uint8Array(width * 3);
  for (let y = 0; y < height; y++) {
    const base = y * width * channels;
    if (channels === 3) {
      fn(data.subarray(base, base + width * 3));
      continue;
    }
    for (let x = 0, o = 0; x < width; x++, o += 3) {
      const s = base + x * channels;
      if (channels === 1) {
        row[o] = row[o + 1] = row[o + 2] = data[s];
      } else if (channels === 2) {
        row[o] = row[o + 1] = row[o + 2] = overWhite(data[s], data[s + 1]);
      } else {
        const a = data[s + 3];
        row[o] = overWhite(data[s], a);
        row[o + 1] = overWhite(data[s + 1], a);
        row[o + 2] = overWhite(data[s + 2], a);
      }
    }
    fn(row);
  }
}

module.exports = { flatten, toGray, forEachRgbRow, luma, overWhite };
