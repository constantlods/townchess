import { AI_LEVELS, type AiLevel } from '@hc/engine';

export { AI_LEVELS, type AiLevel };

/** Promise-based wrapper around the engine worker. */
export class AiClient {
  private worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, (m: { from: string; to: string; promotion?: string } | null) => void>();
  constructor() {
    this.worker.onmessage = (e) => {
      const r = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      r?.(e.data.move);
    };
  }
  think(fen: string, level: AiLevel): Promise<{ from: string; to: string; promotion?: string } | null> {
    return new Promise((res) => {
      const id = this.nextId++;
      this.pending.set(id, res);
      const { maxDepth, timeMs, noise } = AI_LEVELS[level];
      this.worker.postMessage({ id, fen, opts: { maxDepth, timeMs, noise } });
    });
  }
  /** Drop any pending answer (e.g. game ended or reset). */
  cancel() { this.pending.clear(); }
  dispose() { this.worker.terminate(); }
}
