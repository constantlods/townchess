/// <reference lib="webworker" />
// Generates procedural textures and SDF meshes off the main thread.
import { GEN, setTexScale } from './textures';
import { GEO, serializeGeo } from './geometry';
import '../scene/handRig';
import '../scene/hands';
import '../scene/pieces';
import '../scene/opponent';

self.onmessage = (e: MessageEvent) => {
  const { id, job } = e.data as { id: number; job: { kind: 'tex' | 'geo'; name: string; args: never[]; scale: number } };
  try {
    if (job.kind === 'tex') {
      setTexScale(job.scale);
      const raw = GEN[job.name](...job.args);
      (self as unknown as Worker).postMessage({ id, raw }, [raw.albedo.buffer, raw.normal.buffer, raw.rough.buffer]);
    } else {
      const g = serializeGeo(GEO[job.name](...job.args));
      const transfer: ArrayBuffer[] = Object.values(g.attrs).map((a) => a.array.buffer as ArrayBuffer);
      if (g.index) transfer.push(g.index.buffer as ArrayBuffer);
      (self as unknown as Worker).postMessage({ id, raw: g }, transfer);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
