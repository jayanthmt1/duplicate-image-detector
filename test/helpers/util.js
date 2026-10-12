'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIX = path.join(__dirname, '..', 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIX, name));
fixture.path = (name) => path.join(FIX, name);
const manifest = () => JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Expand any image to RGBA bytes (no flattening), like `magick x -depth 8 rgba:-`. */
function toRgba(img) {
  const { width, height, channels, data } = img;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const o = i * 4;
    if (channels <= 2) {
      out[o] = out[o + 1] = out[o + 2] = data[s];
      out[o + 3] = channels === 2 ? data[s + 1] : 255;
    } else {
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2];
      out[o + 3] = channels === 4 ? data[s + 3] : 255;
    }
  }
  return out;
}

/** Parse binary PGM (P5) or PPM (P6) with maxval 255. */
function readPnm(buf) {
  const tokens = [];
  let i = 0;
  while (tokens.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i++;
    if (buf[i] === 0x23) { while (buf[i] !== 0x0a) i++; continue; }
    let t = '';
    while (!/\s/.test(String.fromCharCode(buf[i]))) t += String.fromCharCode(buf[i++]);
    tokens.push(t);
  }
  i++;
  const [magic, w, h, max] = tokens;
  if (max !== '255') throw new Error('only maxval 255');
  const channels = magic === 'P5' ? 1 : 3;
  const width = +w;
  const height = +h;
  return { width, height, channels, data: new Uint8Array(buf.subarray(i, i + width * height * channels)) };
}

function diffStats(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(`shape differs: ${a.width}x${a.height}x${a.channels} vs ${b.width}x${b.height}x${b.channels}`);
  }
  let max = 0;
  let sum = 0;
  let over1 = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > max) max = d;
    if (d > 1) over1++;
    sum += d;
  }
  return { max, mean: sum / a.data.length, over1Share: over1 / a.data.length };
}

module.exports = { FIX, fixture, manifest, sha, toRgba, readPnm, diffStats };
