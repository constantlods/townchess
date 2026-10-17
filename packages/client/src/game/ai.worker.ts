/// <reference lib="webworker" />
import { search } from '@hc/engine';

self.onmessage = (e: MessageEvent) => {
  const { id, fen, opts } = e.data;
  const move = search(fen, opts);
  (self as unknown as Worker).postMessage({ id, move });
};
