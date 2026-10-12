'use strict';

// Tiny rasteriser for tests: black strokes on a white 1-channel canvas.

function canvas(width, height, value = 255) {
  return { width, height, channels: 1, data: new Uint8Array(width * height).fill(value) };
}

function dot(img, x, y, r, v = 0) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xx = Math.round(x) + dx;
      const yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < img.width && yy < img.height) img.data[yy * img.width + xx] = v;
    }
  }
}

function line(img, x0, y0, x1, y1, r = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) dot(img, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r);
}

function rect(img, x0, y0, x1, y1, r = 1) {
  line(img, x0, y0, x1, y0, r);
  line(img, x1, y0, x1, y1, r);
  line(img, x1, y1, x0, y1, r);
  line(img, x0, y1, x0, y0, r);
}

function circle(img, cx, cy, radius, r = 1) {
  const n = Math.ceil(radius * 8);
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    dot(img, cx + radius * Math.cos(t), cy + radius * Math.sin(t), r);
  }
}

/** A diagram with a few shapes; `variant` changes the layout. */
function diagram(width = 160, height = 120, variant = 0) {
  const img = canvas(width, height);
  const k = variant + 1;
  rect(img, 15 + 3 * k, 15, width * 0.55, height * 0.6);
  circle(img, width * 0.7, height * 0.45, Math.min(width, height) * (0.12 + 0.02 * (k % 3)));
  line(img, 10, height - 15, width - 10 - 5 * k, 20 + 4 * k);
  if (variant % 2) line(img, width * 0.2, height * 0.8, width * 0.9, height * 0.85);
  return img;
}

/** Horizontal "text lines" of words with varied widths and ragged line ends, like a page. */
function textPage(width = 300, height = 220) {
  const img = canvas(width, height);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let y = 25, row = 0; y < height - 20; y += 18, row++) {
    const end = width - 30 - Math.floor(rnd() * (row % 3 === 2 ? 150 : 40));
    for (let x = 20; x < end; ) {
      const w = 4 + Math.floor(rnd() * 22);
      line(img, x, y, Math.min(end, x + w), y, 1);
      x += w + 6;
    }
  }
  return img;
}

module.exports = { canvas, dot, line, rect, circle, diagram, textPage };
