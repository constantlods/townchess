import * as THREE from 'three';
import { collector, dummyGeometry } from './registry';

/** Serialisable geometry (transferable between worker and main thread, storable in IndexedDB). */
export interface RawGeo {
  attrs: Record<string, { array: Float32Array | Uint16Array; itemSize: number }>;
  index: Uint32Array | null;
  groups: { start: number; count: number; materialIndex: number }[];
}

export function serializeGeo(g: THREE.BufferGeometry): RawGeo {
  const attrs: RawGeo['attrs'] = {};
  for (const [k, a] of Object.entries(g.attributes)) {
    const arr = (a as THREE.BufferAttribute).array;
    attrs[k] = { array: arr instanceof Uint16Array ? arr : new Float32Array(arr as ArrayLike<number>), itemSize: a.itemSize };
  }
  return { attrs, index: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : null, groups: g.groups.map((x) => ({ start: x.start, count: x.count, materialIndex: x.materialIndex ?? 0 })) };
}

export function deserializeGeo(r: RawGeo): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(r.attrs)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize));
  if (r.index) g.setIndex(new THREE.BufferAttribute(r.index, 1));
  for (const gr of r.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export const GEO: Record<string, (...a: never[]) => THREE.BufferGeometry> = {};
const memo = new Map<string, THREE.BufferGeometry>();
export const geoKey = (name: string, args: unknown[]) => `${name}:${JSON.stringify(args)}`;

/** Register a procedural geometry builder; returns a memoised accessor (with collection support). */
export function defGeo<A extends unknown[]>(name: string, build: (...a: A) => THREE.BufferGeometry): (...a: A) => THREE.BufferGeometry {
  GEO[name] = build as unknown as (...a: never[]) => THREE.BufferGeometry;
  return (...a: A) => {
    const key = geoKey(name, a);
    let g = memo.get(key);
    if (g) return g;
    if (collector.active) {
      collector.jobs.set('geo|' + key, { kind: 'geo', name, args: a, scale: 1, key });
      return dummyGeometry();
    }
    g = build(...a);
    g.computeBoundingBox();
    memo.set(key, g);
    return g;
  };
}
export const hasGeo = (key: string) => memo.has(key);
export const putGeo = (key: string, raw: RawGeo) => { if (!memo.has(key)) memo.set(key, deserializeGeo(raw)); };
