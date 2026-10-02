import * as THREE from 'three';

/** Shared state for asset collection (dry-run) mode. */
export interface Job { kind: 'tex' | 'geo'; name: string; args: unknown[]; scale: number; key: string }

export const collector: { active: boolean; jobs: Map<string, Job> } = { active: false, jobs: new Map() };

export function dummyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  g.computeBoundingBox();
  return g;
}

let dummyTex: THREE.DataTexture | null = null;
export function dummyTexture(): THREE.DataTexture {
  if (!dummyTex) { dummyTex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); dummyTex.needsUpdate = true; }
  return dummyTex;
}
