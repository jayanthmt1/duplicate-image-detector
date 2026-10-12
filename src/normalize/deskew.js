'use strict';

// Skew estimation by projection profile: rotate the ink points by candidate angles and keep the
// angle whose horizontal projection is most peaked (sum of squared row counts). Text lines and
// horizontal rules give sharp peaks when level.

const { dsin, dcos, degToRad } = require('../detmath');

const MAX_POINTS = 60000;

function profileScore(xs, ys, n, angle, W, H) {
  const t = degToRad(angle);
  const s = dsin(t);
  const c = dcos(t);
  const off = Math.ceil((Math.abs(s) * W) / 2) + 2;
  const bins = new Int32Array(H + 2 * off + 2);
  for (let i = 0; i < n; i++) {
    const y = Math.floor(-xs[i] * s + ys[i] * c) + off;
    bins[y]++;
  }
  let score = 0;
  for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
  return score;
}

/**
 * Estimate the clockwise skew of the content in degrees, within +/- maxAngle. Rotating the image
 * by the negative of the result levels it. Returns 0 when there is too little ink.
 */
function estimateSkew(mask, { maxAngle = 5, step = 0.5, fine = 0.1 } = {}) {
  const { width: W, height: H, data } = mask;
  let count = 0;
  for (let i = 0; i < data.length; i++) count += data[i];
  if (count < 50) return 0;
  const stride = Math.max(1, Math.ceil(count / MAX_POINTS));
  const n = Math.ceil(count / stride);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let k = 0;
  let seen = 0;
  const cx = W / 2;
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    if (seen++ % stride) continue;
    const x = i % W;
    xs[k] = x - cx;
    ys[k] = (i - x) / W;
    k++;
  }
  const levels = Math.round(maxAngle / step);
  let best = 0;
  let bestScore = profileScore(xs, ys, k, 0, W, H);
  for (let i = -levels; i <= levels; i++) {
    if (!i) continue;
    const a = i * step;
    const sc = profileScore(xs, ys, k, a, W, H);
    if (sc > bestScore || (sc === bestScore && Math.abs(a) < Math.abs(best))) {
      bestScore = sc;
      best = a;
    }
  }
  const coarse = best;
  const fl = Math.round(step / fine);
  for (let i = -fl; i <= fl; i++) {
    if (!i) continue;
    const a = Math.round((coarse + i * fine) * 1000) / 1000;
    if (Math.abs(a) > maxAngle) continue;
    const sc = profileScore(xs, ys, k, a, W, H);
    if (sc > bestScore || (sc === bestScore && Math.abs(a) < Math.abs(best))) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}

module.exports = { estimateSkew };
