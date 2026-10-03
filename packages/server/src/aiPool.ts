import { Worker } from 'node:worker_threads';
import os from 'node:os';
import type { SearchOptions } from '@hc/engine';

type Move = { from: string; to: string; promotion?: string } | null;
interface Job { id: number; fen: string; opts: SearchOptions; resolve: (m: Move) => void }

/**
 * Small pool of engine worker threads. Searches never run on the event loop that serves sockets and clocks.
 * Size defaults to (cores - 1), capped at 4; a queue absorbs bursts. The pool is lazy: no threads until first use.
 */
export class AiPool {
  private workers: { w: Worker; busy: Job | null }[] = [];
  private queue: Job[] = [];
  private nextId = 1;

  constructor(private size = Math.max(1, Math.min(4, os.availableParallelism() - 1))) {}

  search(fen: string, opts: SearchOptions): Promise<Move> {
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, fen, opts, resolve });
      this.pump();
    });
  }

  private spawn() {
    const w = new Worker(new URL('./aiWorker.mjs', import.meta.url));
    const slot = { w, busy: null as Job | null };
    w.on('message', (msg: { id: number; move: Move }) => {
      const job = slot.busy;
      slot.busy = null;
      if (job && job.id === msg.id) job.resolve(msg.move);
      this.pump();
    });
    w.on('error', (e) => {
      console.error('[ai] engine worker failed', e);
      slot.busy?.resolve(null);
      this.workers = this.workers.filter((s) => s !== slot);
      this.pump();
    });
    w.unref();
    this.workers.push(slot);
    return slot;
  }

  private pump() {
    while (this.queue.length) {
      let slot = this.workers.find((s) => !s.busy);
      if (!slot && this.workers.length < this.size) slot = this.spawn();
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.busy = job;
      slot.w.postMessage({ id: job.id, fen: job.fen, opts: job.opts });
    }
  }

  get pending() { return this.queue.length + this.workers.filter((s) => s.busy).length; }

  close() {
    for (const s of this.workers) void s.w.terminate();
    this.workers = [];
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
  }
}
