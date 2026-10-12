'use strict';

// Worker thread for src/batch.js: fingerprints one input per message.

const fs = require('fs');
const { parentPort } = require('worker_threads');
const { fingerprint } = require('./fingerprint');

parentPort.on('message', ({ id, input, opts }) => {
  try {
    const data = typeof input === 'string' ? fs.readFileSync(input) : input;
    parentPort.postMessage({ id, fp: fingerprint(data, opts) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
