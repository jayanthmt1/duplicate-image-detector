'use strict';

// Operations on ink masks: { width, height, data } with 1 = ink, 0 = paper.

/** Remove 8-connected ink blobs smaller than minArea pixels. Returns a new mask. */
function removeSpeckles(mask, minArea) {
  const { width: W, height: H, data } = mask;
  const out = new Uint8Array(data);
  if (minArea <= 1) return { width: W, height: H, data: out };
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const blob = new Int32Array(minArea);
  for (let start = 0; start < W * H; start++) {
    if (!data[start] || seen[start]) continue;
    let sp = 0;
    let size = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp) {
      const p = stack[--sp];
      if (size < minArea) blob[size] = p;
      size++;
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (data[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    if (size < minArea) for (let i = 0; i < size; i++) out[blob[i]] = 0;
  }
  return { width: W, height: H, data: out };
}

/** Bounding box of the ink, or null when there is none. */
function inkBox(mask) {
  const { width: W, height: H, data } = mask;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) {
      if (data[r + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

function cropMask(mask, { x, y, width, height }) {
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    const s = (y + r) * mask.width + x;
    out.set(mask.data.subarray(s, s + width), r * width);
  }
  return { width, height, data: out };
}

function padMaskToSquare(mask) {
  const { width: W, height: H } = mask;
  if (W === H) return mask;
  const side = Math.max(W, H);
  const ox = (side - W) >> 1;
  const oy = (side - H) >> 1;
  const out = new Uint8Array(side * side);
  for (let r = 0; r < H; r++) out.set(mask.data.subarray(r * W, (r + 1) * W), (oy + r) * side + ox);
  return { width: side, height: side, data: out };
}

/** Zhang-Suen thinning to a one-pixel-wide skeleton. */
function thin(mask) {
  const { width: W, height: H } = mask;
  const d = new Uint8Array(mask.data);
  let cand = [];
  for (let i = 0; i < d.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    if (d[i] && x > 0 && y > 0 && x < W - 1 && y < H - 1) cand.push(i);
  }
  // Border pixels are left alone (the canvas has a margin of paper in practice).
  const remove = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      remove.length = 0;
      const next = [];
      for (const i of cand) {
        if (!d[i]) continue;
        next.push(i);
        const p2 = d[i - W], p3 = d[i - W + 1], p4 = d[i + 1], p5 = d[i + W + 1];
        const p6 = d[i + W], p7 = d[i + W - 1], p8 = d[i - 1], p9 = d[i - W - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (a !== 1) continue;
        if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        remove.push(i);
      }
      for (const i of remove) d[i] = 0;
      if (remove.length) changed = true;
      cand = next;
    }
  }
  return { width: W, height: H, data: d };
}

/** Grow ink by a square of the given radius. */
function dilate(mask, radius) {
  if (radius <= 0) return mask;
  const { width: W, height: H, data } = mask;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!data[y * W + x]) continue;
    for (let i = Math.max(0, x - radius); i <= Math.min(W - 1, x + radius); i++) tmp[y * W + i] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!tmp[y * W + x]) continue;
    for (let i = Math.max(0, y - radius); i <= Math.min(H - 1, y + radius); i++) out[i * W + x] = 1;
  }
  return { width: W, height: H, data: out };
}

/**
 * Resize a mask to size x size keeping thin lines: along an axis that shrinks, a cell is ink if
 * any source pixel it overlaps is ink; along an axis that grows, nearest neighbour.
 */
function poolMask(mask, size) {
  const { width: W, height: H, data } = mask;
  const out = new Uint8Array(size * size);
  const range = (i, src) => {
    if (src > size) return [Math.floor((i * src) / size), Math.ceil(((i + 1) * src) / size) - 1];
    const j = Math.floor(((2 * i + 1) * src) / (2 * size));
    return [j, j];
  };
  const xr = Array.from({ length: size }, (_, i) => range(i, W));
  for (let oy = 0; oy < size; oy++) {
    const [y0, y1] = range(oy, H);
    for (let ox = 0; ox < size; ox++) {
      const [x0, x1] = xr[ox];
      let ink = 0;
      for (let y = y0; y <= y1 && !ink; y++) for (let x = x0; x <= x1; x++) if (data[y * W + x]) { ink = 1; break; }
      out[oy * size + ox] = ink;
    }
  }
  return { width: size, height: size, data: out };
}

/** Mask -> 1-channel image, ink black (0) on white (255). */
function maskToImage(mask) {
  const out = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < out.length; i++) out[i] = mask.data[i] ? 0 : 255;
  return { width: mask.width, height: mask.height, channels: 1, data: out };
}

module.exports = { removeSpeckles, inkBox, cropMask, padMaskToSquare, thin, dilate, poolMask, maskToImage };
