'use strict';

// Deterministic maths. Math.sin, Math.cos and Math.exp are "implementation-approximated" in
// JavaScript and may differ in the last bit between engines or versions. Fingerprints must not,
// so these use only + - * / (correctly rounded IEEE-754 operations, identical everywhere).

const PI = 3.141592653589793;
const HALF_PI = PI / 2;
const TWO_PI = 2 * PI;

function dsin(x) {
  x -= Math.round(x / TWO_PI) * TWO_PI; // now in [-pi, pi]
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x; // now in [-pi/2, pi/2]
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 12; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const dcos = (x) => dsin(x + HALF_PI);

function dexp(x) {
  let k = 0;
  while (x > 0.5 || x < -0.5) {
    x /= 2;
    k++;
  }
  let term = 1;
  let sum = 1;
  for (let n = 1; n < 20; n++) {
    term *= x / n;
    sum += term;
  }
  for (let i = 0; i < k; i++) sum *= sum;
  return sum;
}

const degToRad = (d) => (d * PI) / 180;

// Small seeded PRNG (mulberry32); Math.imul is exact 32-bit integer multiplication.
function prng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { PI, dsin, dcos, dexp, degToRad, prng };
