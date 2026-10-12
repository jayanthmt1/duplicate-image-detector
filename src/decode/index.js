'use strict';

const { toBuffer, assertImage } = require('../image');
const { decodePng, isPng } = require('./png');
const { decodeJpeg, isJpeg } = require('./jpeg');
const { decodeGif, isGif } = require('./gif');
const { decodeBmp, isBmp } = require('./bmp');
const { applyOrientation } = require('../ops/orient');

function sniffFormat(input) {
  const buf = toBuffer(input);
  if (isPng(buf)) return 'png';
  if (isJpeg(buf)) return 'jpeg';
  if (isGif(buf)) return 'gif';
  if (isBmp(buf)) return 'bmp';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Decode an encoded image (PNG, JPEG, GIF first frame, BMP) to { width, height, channels, data }.
 * A raw image object is validated and returned as is, so callers can plug in their own decoder.
 * JPEG EXIF orientation is applied unless opts.autoOrient === false.
 */
function decode(input, opts = {}) {
  if (input && typeof input === 'object' && 'width' in input && 'data' in input && !(input instanceof Uint8Array)) {
    assertImage(input);
    return { width: input.width, height: input.height, channels: input.channels, data: input.data };
  }
  const buf = toBuffer(input);
  const format = sniffFormat(buf);
  switch (format) {
    case 'png':
      return decodePng(buf, opts);
    case 'gif':
      return decodeGif(buf, opts);
    case 'bmp':
      return decodeBmp(buf, opts);
    case 'jpeg': {
      const { orientation, ...img } = decodeJpeg(buf, opts);
      return opts.autoOrient === false ? img : applyOrientation(img, orientation);
    }
    case null:
      throw new Error('unrecognised image format');
    default:
      throw new Error(`${format.toUpperCase()} decoding is not supported yet`);
  }
}

module.exports = { decode, sniffFormat, decodePng, decodeJpeg, decodeGif, decodeBmp };
