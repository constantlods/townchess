import * as THREE from 'three';

/**
 * A procedural PBR texture set rendered into typed arrays:
 * albedo (sRGB), height (linear, used to derive a normal map) and roughness (linear).
 */
export class TexBuilder {
  readonly albedo: Uint8ClampedArray;
  readonly height: Float32Array;
  readonly rough: Float32Array;
  /** Real pixel size. Generators address pixels in *design* units (designW x designH); `s` = real/design. */
  readonly w: number;
  readonly h: number;
  readonly s: number;
  constructor(designW: number, designH: number, scale = 1) {
    this.s = scale;
    this.w = Math.max(16, Math.round(designW * scale));
    this.h = Math.max(16, Math.round(designH * scale));
    const w = this.w, h = this.h;
    this.albedo = new Uint8ClampedArray(w * h * 4);
    this.height = new Float32Array(w * h);
    this.rough = new Float32Array(w * h).fill(0.7);
    for (let i = 3; i < this.albedo.length; i += 4) this.albedo[i] = 255;
  }

  /** Iterate over every pixel; callback writes into an rgb scratch array. */
  each(fn: (x: number, y: number, i: number) => void) {
    const { w, h } = this;
    const u = 1 / this.s;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x * u, y * u, y * w + x);
  }

  setRGB(i: number, r: number, g: number, b: number) {
    const o = i * 4;
    this.albedo[o] = r; this.albedo[o + 1] = g; this.albedo[o + 2] = b;
  }

  /** Multiply albedo by factor (0..1+) */
  mul(i: number, f: number) {
    const o = i * 4;
    this.albedo[o] *= f; this.albedo[o + 1] *= f; this.albedo[o + 2] *= f;
  }

  /** Alpha-blend a colour over albedo. */
  blend(i: number, r: number, g: number, b: number, a: number) {
    if (a <= 0) return;
    const o = i * 4, ia = 1 - a;
    this.albedo[o] = this.albedo[o] * ia + r * a;
    this.albedo[o + 1] = this.albedo[o + 1] * ia + g * a;
    this.albedo[o + 2] = this.albedo[o + 2] * ia + b * a;
  }

  /** Stamp a soft-edged stroke into the height/albedo (scratches, cracks). */
  stroke(
    pts: [number, number][], width: number,
    fn: (i: number, coverage: number) => void,
  ) {
    const k = this.s;
    width = Math.max(0.75, width * k);
    for (let s = 0; s < pts.length - 1; s++) {
      const x0 = pts[s][0] * k, y0 = pts[s][1] * k, x1 = pts[s + 1][0] * k, y1 = pts[s + 1][1] * k;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1) - width - 1));
      const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + width + 1));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1) - width - 1));
      const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + width + 1));
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
        const px = x0 + t * dx - x, py = y0 + t * dy - y;
        const d = Math.sqrt(px * px + py * py);
        if (d < width) fn(y * this.w + x, 1 - d / width);
      }
    }
  }

  disc(cx: number, cy: number, r: number, fn: (i: number, coverage: number, dx: number, dy: number) => void) {
    cx *= this.s; cy *= this.s; r = Math.max(0.75, r * this.s);
    const minX = Math.max(0, Math.floor(cx - r)), maxX = Math.min(this.w - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r)), maxY = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < r) fn(y * this.w + x, 1 - d / r, dx / r, dy / r);
    }
  }

  /** Build raw RGBA arrays (albedo, tangent-space normal, roughness). `normalStrength` scales the height gradient. */
  buildRaw(normalStrength = 2, wrap = true): RawPBR {
    const { w, h, height } = this;
    const nrm = new Uint8Array(w * h * 4);
    const rgh = new Uint8Array(w * h * 4);
    const at = (x: number, y: number) => {
      if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
      return height[y * w + x];
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Sobel
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br - tl - 2 * l - bl) * normalStrength * this.s;
      const dy = (bl + 2 * b + br - tl - 2 * t - tr) * normalStrength * this.s;
      // flipY=false + UV v increasing with y => tangent-space green follows -dy
      let nx = -dx, ny = dy, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      nrm[i * 4] = (nx * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
      const rv = Math.max(0, Math.min(1, this.rough[i])) * 255;
      // roughnessMap uses the G channel in three.js
      rgh[i * 4] = rv; rgh[i * 4 + 1] = rv; rgh[i * 4 + 2] = rv; rgh[i * 4 + 3] = 255;
    }
    return { w, h, wrap, albedo: new Uint8Array(this.albedo.buffer.slice(0)), normal: nrm, rough: rgh };
  }
}

export interface RawPBR { w: number; h: number; wrap: boolean; albedo: Uint8Array; normal: Uint8Array; rough: Uint8Array }

function dataTex(data: Uint8Array, w: number, h: number, srgb: boolean, wrap: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export function toPBR(r: RawPBR) {
  return {
    map: dataTex(r.albedo, r.w, r.h, true, r.wrap),
    normalMap: dataTex(r.normal, r.w, r.h, false, r.wrap),
    roughnessMap: dataTex(r.rough, r.w, r.h, false, r.wrap),
  };
}

export const hex = (h: string): [number, number, number] => {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
