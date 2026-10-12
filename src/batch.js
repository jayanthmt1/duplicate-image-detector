'use strict';

// Batch fingerprinting on worker threads. A pool runs one job per worker at a time; the rest wait
// in the caller's queue, so a large batch never floods the machine. Inputs may be file paths
// (each worker reads its own file, which keeps memory low), encoded buffers or raw images.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { fingerprint } = require('./fingerprint');

const DEFAULT_WORKERS = 2;
const WORKER_FILE = path.join(__dirname, 'worker.js');

function maxWorkers() {
  const n = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, n);
}

function runInline(input, opts) {
  return fingerprint(typeof input === 'string' ? fs.readFileSync(input) : input, opts);
}

/**
 * A pool of fingerprinting workers. workers: default 2, capped at the number of CPUs;
 * 0 runs everything on the calling thread.
 *   const pool = createPool({ workers: 2 });
 *   const fp = await pool.fingerprint('/path/a.png', { preset: 'lineart' });
 *   await pool.close();
 */
function createPool({ workers = DEFAULT_WORKERS } = {}) {
  if (!Number.isInteger(workers) || workers < 0) throw new RangeError('workers must be a non-negative integer');
  const size = Math.min(workers, maxWorkers());
  const idle = [];
  const all = [];
  const waiting = [];
  const jobs = new Map();
  let nextId = 1;
  let closed = false;

  function settle(w, msg) {
    const job = jobs.get(msg.id);
    jobs.delete(msg.id);
    w.job = null;
    if (msg.error) {
      const e = new Error(msg.error);
      job.reject(e);
    } else job.resolve(msg.fp);
    dispatch(w);
  }

  function spawn() {
    const w = new Worker(WORKER_FILE);
    w.job = null;
    w.on('message', (msg) => settle(w, msg));
    w.on('error', (err) => {
      // A crashed worker fails its job and is replaced.
      if (w.job) {
        const job = jobs.get(w.job);
        jobs.delete(w.job);
        job.reject(err);
      }
      const i = all.indexOf(w);
      if (i >= 0) all.splice(i, 1);
      if (!closed) dispatch(spawn());
    });
    w.unref();
    all.push(w);
    return w;
  }

  function dispatch(w) {
    if (closed) return;
    const job = waiting.shift();
    if (!job) {
      idle.push(w);
      return;
    }
    w.job = job.id;
    w.ref();
    w.postMessage({ id: job.id, input: job.input, opts: job.opts });
  }

  for (let i = 0; i < size; i++) idle.push(spawn());

  return {
    size,
    fingerprint(input, opts = {}) {
      if (closed) return Promise.reject(new Error('pool is closed'));
      if (!size) {
        try {
          return Promise.resolve(runInline(input, opts));
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return new Promise((resolve, reject) => {
        const id = nextId++;
        jobs.set(id, { resolve, reject });
        waiting.push({ id, input, opts });
        const w = idle.pop();
        if (w) dispatch(w);
      });
    },
    async close() {
      closed = true;
      for (const job of waiting) jobs.get(job.id)?.reject(new Error('pool closed'));
      waiting.length = 0;
      await Promise.all(all.map((w) => w.terminate()));
    },
  };
}

/**
 * Fingerprint many inputs with a pool. Returns results in input order: { fp } or { error }.
 * options: workers (default 2), onResult(index, result) for streaming, onProgress(done, total).
 * `items` may be an array or any iterable; only `workers` items are in flight at a time.
 */
async function fingerprintMany(items, opts = {}, { workers = DEFAULT_WORKERS, onResult, onProgress } = {}) {
  const pool = createPool({ workers });
  const list = Array.isArray(items) ? items : [...items];
  const results = new Array(list.length);
  let next = 0;
  let done = 0;
  const lanes = Math.max(1, pool.size);
  try {
    await Promise.all(Array.from({ length: lanes }, async () => {
      while (next < list.length) {
        const i = next++;
        let r;
        try {
          r = { fp: await pool.fingerprint(list[i], opts) };
        } catch (e) {
          r = { error: e.message };
        }
        results[i] = r;
        done++;
        if (onResult) onResult(i, r);
        if (onProgress) onProgress(done, list.length);
      }
    }));
  } finally {
    await pool.close();
  }
  return results;
}

module.exports = { createPool, fingerprintMany, DEFAULT_WORKERS };
