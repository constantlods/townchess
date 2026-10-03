import { parentPort } from 'node:worker_threads';
import { search, type SearchOptions } from '@hc/engine';

/** Engine worker: one search per message, off the server's event loop. */
parentPort!.on('message', (m: { id: number; fen: string; opts: SearchOptions }) => {
  let move: ReturnType<typeof search> = null;
  try { move = search(m.fen, m.opts); } catch (e) { console.error('[ai] search threw on', m.fen, e); move = null; }
  parentPort!.postMessage({ id: m.id, move });
});
