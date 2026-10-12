'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ic = require('..');

const img = (width, height, channels, values) => ({ width, height, channels, data: Uint8Array.from(values) });

test('toGray uses BT.601 weights and flattens alpha onto white', () => {
  const rgb = img(4, 1, 3, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  assert.deepEqual([...ic.toGray(rgb).data], [76, 150, 29, 255]);
  const rgba = img(3, 1, 4, [0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128]);
  assert.deepEqual([...ic.toGray(rgba).data], [255, 0, 127]);
  const ga = img(2, 1, 2, [0, 0, 100, 255]);
  assert.deepEqual([...ic.toGray(ga).data], [255, 100]);
});

test('flatten drops the alpha channel', () => {
  const out = ic.flatten(img(1, 1, 4, [200, 100, 0, 51]));
  assert.equal(out.channels, 3);
  // c * 0.2 + 255 * 0.8
  assert.deepEqual([...out.data], [244, 224, 204]);
});

test('resize: exact box average when shrinking by an integer factor', () => {
  const src = img(4, 2, 1, [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.deepEqual([...ic.resize(src, 2, 1).data], [25, 45]);
  assert.deepEqual([...ic.resize(src, 1, 1).data], [35]);
});

test('resize: fractional area weights when shrinking 3 -> 2', () => {
  // Output 0 covers source 0 fully and half of source 1: (0*2 + 90*1) / 3 = 30.
  const src = img(3, 1, 1, [0, 90, 180]);
  assert.deepEqual([...ic.resize(src, 2, 1).data], [30, 150]);
});

test('resize: bilinear when enlarging, centre aligned, edges clamped', () => {
  const src = img(2, 1, 1, [0, 100]);
  assert.deepEqual([...ic.resize(src, 4, 1).data], [0, 25, 75, 100]);
});

test('resize: uniform images stay uniform, any size, any channels', () => {
  for (const [w, h] of [[1, 1], [3, 7], [17, 16], [100, 3]]) {
    const out = ic.resize(img(9, 5, 3, new Array(9 * 5 * 3).fill(173)), w, h);
    assert.ok(out.data.every((v) => v === 173));
  }
});

test('resize is the identity at the same size and validates its arguments', () => {
  const src = img(2, 2, 1, [1, 2, 3, 4]);
  assert.deepEqual([...ic.resize(src, 2, 2).data], [1, 2, 3, 4]);
  assert.throws(() => ic.resize(src, 0, 2), RangeError);
  assert.throws(() => ic.resize({ width: 2, height: 2, channels: 1, data: new Uint8Array(3) }, 1, 1), RangeError);
});

test('limitSize keeps aspect and never enlarges', () => {
  const big = { width: 3000, height: 1000, channels: 1, data: new Uint8Array(3_000_000) };
  const out = ic.limitSize(big, 1024);
  assert.deepEqual([out.width, out.height], [1024, 341]);
  const small = img(2, 2, 1, [1, 2, 3, 4]);
  assert.equal(ic.limitSize(small, 1024), small);
});

test('applyOrientation: rotations compose as expected', () => {
  const src = img(3, 2, 1, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...ic.applyOrientation(src, 6).data], [4, 1, 5, 2, 6, 3]); // 90 clockwise
  assert.deepEqual([...ic.applyOrientation(src, 8).data], [3, 6, 2, 5, 1, 4]); // 90 anticlockwise
  assert.deepEqual([...ic.applyOrientation(src, 3).data], [6, 5, 4, 3, 2, 1]);
  assert.deepEqual([...ic.applyOrientation(src, 2).data], [3, 2, 1, 6, 5, 4]);
  const twice = ic.applyOrientation(ic.applyOrientation(src, 6), 6);
  assert.deepEqual(twice, ic.applyOrientation(src, 3));
  assert.equal(ic.applyOrientation(src, 1), src);
});
