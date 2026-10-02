import { collector, type Job } from './registry';
import { putTex, hasTex } from './textures';
import { putGeo, hasGeo, type RawGeo } from './geometry';
import type { RawPBR } from './canvasTex';

/**
 * Asset pipeline: a dry-run "collect" pass discovers which procedural assets a builder needs,
 * then they are generated in parallel Web Workers and cached in IndexedDB for later visits.
 */
declare const __BUILD_ID__: string;
/** Cache namespace: per production build. In dev the cache is disabled so generator edits show up immediately. */
const VERSION: string | null = import.meta.env.DEV ? null : __BUILD_ID__;
const DB = 'horror-chess-assets';

let dbP: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbP) {
    dbP = new Promise((res) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('raw');
        r.onsuccess = () => {
          res(r.result);
          // drop entries from older builds
          try {
            const st = r.result.transaction('raw', 'readwrite').objectStore('raw');
            const cur = st.openKeyCursor();
            cur.onsuccess = () => { const c = cur.result; if (!c) return; if (!String(c.key).startsWith(VERSION + '|')) st.delete(c.key); c.continue(); };
          } catch { /* ignore */ }
        };
        r.onerror = () => res(null);
      } catch { res(null); }
    });
  }
  return dbP;
}
async function idbGet(key: string): Promise<unknown> {
  if (VERSION === null) return undefined;
  const d = await db();
  if (!d) return undefined;
  return new Promise((res) => {
    try {
      const r = d.transaction('raw').objectStore('raw').get(`${VERSION}|${key}`);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}
async function idbPut(key: string, v: unknown) {
  if (VERSION === null) return;
  const d = await db();
  if (!d) return;
  try { d.transaction('raw', 'readwrite').objectStore('raw').put(v, `${VERSION}|${key}`); } catch { /* quota etc. */ }
}

class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { job: Job; res: (v: unknown) => void; rej: (e: unknown) => void }[] = [];
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: unknown) => void; w: Worker }>();
  private nextId = 1;
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./assetWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.rej(new Error(e.data.error)); else p.res(e.data.raw);
        this.idle.push(w);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  run(job: Job): Promise<unknown> {
    return new Promise((res, rej) => { this.queue.push({ job, res, rej }); this.pump(); });
  }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!, q = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { res: q.res, rej: q.rej, w });
      w.postMessage({ id, job: { kind: q.job.kind, name: q.job.name, args: q.job.args, scale: q.job.scale } });
    }
  }
}

let pool: Pool | null = null;
const getPool = () => (pool ??= new Pool(Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))));

/** Run `build` in collection mode and return the assets it would need. */
export function collect(build: () => void): Job[] {
  collector.active = true;
  collector.jobs.clear();
  try { build(); } finally { collector.active = false; }
  return [...collector.jobs.values()];
}

/** Generate (or load from cache) all jobs. Biggest jobs first for better parallelism. */
export async function runJobs(jobs: Job[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const todo = jobs.filter((j) => (j.kind === 'tex' ? !hasTex(j.key) : !hasGeo(j.key)));
  let done = 0;
  onProgress?.(0, todo.length);
  await Promise.all(todo.map(async (j) => {
    const cacheKey = `${j.kind}|${j.key}`;
    let raw = await idbGet(cacheKey);
    if (!raw) {
      try {
        raw = await getPool().run(j);
        void idbPut(cacheKey, raw);
      } catch (e) {
        console.warn('asset worker failed, generating on main thread', j.name, e);
        raw = null;
      }
    }
    if (raw) {
      if (j.kind === 'tex') putTex(j.key, raw as RawPBR); else putGeo(j.key, raw as RawGeo);
    }
    onProgress?.(++done, todo.length);
  }));
}

/** Convenience: collect + run. */
export async function preload(build: () => void, onProgress?: (d: number, t: number) => void) {
  await runJobs(collect(build), onProgress);
}
