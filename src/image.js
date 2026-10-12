'use strict';

// The in-memory image used everywhere: 8 bits per sample, row-major, channels interleaved.
// channels: 1 = gray, 2 = gray + alpha, 3 = RGB, 4 = RGBA.

const DEFAULT_MAX_PIXELS = 100_000_000;

function createImage(width, height, channels) {
  return { width, height, channels, data: new Uint8Array(width * height * channels) };
}

function assertImage(img, name = 'image') {
  if (!img || typeof img !== 'object') throw new TypeError(`${name} must be an object`);
  const { width, height, channels, data } = img;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError(`${name}: width and height must be positive integers`);
  }
  if (![1, 2, 3, 4].includes(channels)) throw new TypeError(`${name}: channels must be 1, 2, 3 or 4`);
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${name}: data must be a Uint8Array, Uint8ClampedArray or Buffer`);
  }
  if (data.length !== width * height * channels) {
    throw new RangeError(`${name}: data length ${data.length} != width * height * channels (${width * height * channels})`);
  }
  return img;
}

function checkDimensions(width, height, maxPixels = DEFAULT_MAX_PIXELS) {
  if (width <= 0 || height <= 0) throw new Error(`invalid image size ${width}x${height}`);
  if (width * height > maxPixels) {
    throw new RangeError(`image is ${width}x${height}, more than maxPixels (${maxPixels})`);
  }
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new TypeError('expected a Buffer, Uint8Array or ArrayBuffer');
}

module.exports = { DEFAULT_MAX_PIXELS, createImage, assertImage, checkDimensions, toBuffer };
