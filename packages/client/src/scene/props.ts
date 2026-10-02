import * as THREE from 'three';
import { metalTexture, fabricTexture, type PBRSet } from '../render/textures';
import { mulberry32, Noise2D, clamp01 } from '../render/noise';

/** Reusable procedural props. All dimensions in metres. */

export function pbrMat(t: PBRSet, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, ...opts });
}

export function rustyMetal(seed: number, base = '#4a4a42', rust = 0.6, metalness = 0.7) {
  return pbrMat(metalTexture(seed, base, rust), { metalness });
}

/** Industrial dome desk lamp. Returns the group and the bulb position (local). */
export function industrialLamp(style: 'industrial' | 'exam' | 'banker'): { group: THREE.Group; bulb: THREE.Vector3; aim: THREE.Vector3; bulbMesh: THREE.Mesh; shade: THREE.Mesh } {
  const g = new THREE.Group();
  const iron = rustyMetal(21, style === 'banker' ? '#3a3020' : '#2e3229', 0.55, 0.75);
  const brass = rustyMetal(22, '#8a6a3a', 0.35, 0.9);
  // base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.022, 40), iron);
  base.position.y = 0.011;
  g.add(base);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.02, 20), brass);
  collar.position.y = 0.03;
  g.add(collar);
  // vertical post then a forward-leaning arm (angled toward the board)
  const postH = style === 'exam' ? 0.5 : 0.44;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, postH, 14), brass);
  post.position.y = 0.03 + postH / 2;
  g.add(post);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), iron);
  joint.position.y = 0.03 + postH;
  g.add(joint);
  const armLen = 0.2;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, armLen, 12), brass);
  const armDir = new THREE.Vector3(1, -0.15, 0.25).normalize();
  arm.position.copy(joint.position).addScaledVector(armDir, armLen / 2);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);
  g.add(arm);
  const head = joint.position.clone().addScaledVector(armDir, armLen);
  // shade: lathe dome
  const pts: THREE.Vector2[] = [];
  const R = style === 'banker' ? 0.09 : 0.105;
  pts.push(new THREE.Vector2(0, 0.082));
  pts.push(new THREE.Vector2(0.012, 0.08));
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI * 0.5;
    pts.push(new THREE.Vector2(0.014 + Math.sin(a) * R, 0.07 - (1 - Math.cos(a)) * 0.075));
  }
  pts.push(new THREE.Vector2(R + 0.015, -0.012));
  pts.push(new THREE.Vector2(R + 0.012, -0.016));
  pts.reverse(); // outward-facing normals
  const shadeGeo = new THREE.LatheGeometry(pts, 48);
  const paint = metalTexture(23, style === 'banker' ? '#1f3a26' : style === 'exam' ? '#9a9a90' : '#33382c', 0.5);
  const shadeOut = new THREE.MeshStandardMaterial({ map: paint.map, normalMap: paint.normalMap, roughnessMap: paint.roughnessMap, roughness: 1, metalness: 0.55, side: THREE.FrontSide });
  const shadeIn = new THREE.MeshStandardMaterial({ color: '#e6d8b4', roughness: 0.45, metalness: 0.2, side: THREE.BackSide, emissive: '#ffcf8a', emissiveIntensity: 0.18 });
  const shade = new THREE.Mesh(shadeGeo, shadeOut);
  const shadeInner = new THREE.Mesh(shadeGeo, shadeIn);
  const shadeGroup = new THREE.Group();
  shadeGroup.add(shade, shadeInner);
  shadeGroup.position.copy(head).add(new THREE.Vector3(0.03, -0.035, 0));
  // tilt the shade toward the board
  shadeGroup.rotation.z = 0.5;   // opening tilted toward the board
  shadeGroup.rotation.x = 0.05;  // the bulb peeks out under the rim, the interior stays mostly hidden
  shade.castShadow = true;
  g.add(shadeGroup);
  const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), new THREE.MeshStandardMaterial({ color: '#fff2d0', emissive: '#ffc070', emissiveIntensity: 14 }));
  bulbMesh.position.set(0, 0.0, 0);
  shadeGroup.add(bulbMesh);
  const bulb = new THREE.Vector3();
  shadeGroup.updateMatrix();
  bulb.copy(bulbMesh.position).applyMatrix4(shadeGroup.matrix);
  const aim = new THREE.Vector3(0, -1, 0).applyEuler(shadeGroup.rotation).normalize();
  return { group: g, bulb, aim, bulbMesh, shade };
}

export function tinMug(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const m = rustyMetal(seed + 40, '#6a6656', 0.5, 0.8);
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.036, 0), new THREE.Vector2(0.038, 0.004), new THREE.Vector2(0.040, 0.09), new THREE.Vector2(0.043, 0.094), new THREE.Vector2(0.040, 0.096), new THREE.Vector2(0.037, 0.09), new THREE.Vector2(0.035, 0.008)];
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m);
  body.material.side = THREE.DoubleSide;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0045, 8, 20, Math.PI * 1.1), m);
  handle.position.set(0.045, 0.05, 0);
  handle.rotation.z = -Math.PI * 0.55;
  // dent: squash slightly
  body.scale.set(1, 1, 0.94);
  g.add(body, handle);
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

export function metalBowl(seed = 2): THREE.Group {
  const g = new THREE.Group();
  const m = rustyMetal(seed + 50, '#5a5040', 0.65, 0.8);
  m.side = THREE.DoubleSide;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 0.5; pts.push(new THREE.Vector2(Math.sin(a) * 0.09, 0.05 - Math.cos(a) * 0.05)); }
  pts.push(new THREE.Vector2(0.095, 0.052));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), m);
  g.add(bowl);
  // contents: a few dull objects (old bolts / pills)
  const rnd = mulberry32(seed);
  const cm = new THREE.MeshStandardMaterial({ color: '#4a3e2a', roughness: 0.7, metalness: 0.4 });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.014, 4, 8), cm);
    s.position.set((rnd() - 0.5) * 0.09, 0.012 + rnd() * 0.01, (rnd() - 0.5) * 0.09);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(s);
  }
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

function paperTexture(seed: number, lines: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 340;
  const g = c.getContext('2d')!;
  const n = new Noise2D(seed);
  const img = g.createImageData(256, 340);
  for (let y = 0; y < 340; y++) for (let x = 0; x < 256; x++) {
    const v = n.fbm(x / 40, y / 40, 4);
    const stain = clamp01(n.fbm(x / 80 + 3, y / 80, 3) * 0.9) * 0.6;
    const i = (y * 256 + x) * 4;
    img.data[i] = 168 - stain * 70 + v * 18;
    img.data[i + 1] = 156 - stain * 72 + v * 16;
    img.data[i + 2] = 124 - stain * 70 + v * 12;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (lines) {
    g.fillStyle = 'rgba(40,34,26,0.55)';
    g.font = '11px "Courier Prime", monospace';
    const rnd = mulberry32(seed);
    g.fillText('SUBJECT ' + String(Math.floor(rnd() * 90 + 10)).padStart(3, '0') + ' — OBSERVATION', 18, 30);
    for (let l = 0; l < 22; l++) {
      const w = 60 + rnd() * 160;
      g.fillRect(18, 50 + l * 12, w, 1.5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function paperSheet(seed: number, w = 0.21, h = 0.28): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h, 8, 8);
  const p = geo.attributes.position;
  const rnd = mulberry32(seed);
  const curl = rnd() * 0.01;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.pow(Math.abs(p.getX(i)) / w, 2) * curl + (rnd() - 0.5) * 0.0008);
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: paperTexture(seed, true), roughness: 0.92, side: THREE.DoubleSide }));
  m.receiveShadow = true; m.castShadow = true;
  return m;
}

export function bookStack(seed = 3, count = 4): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry32(seed);
  let y = 0;
  const cols = ['#3a2a1e', '#2e2a22', '#4a2418', '#262a22', '#3a3424'];
  for (let i = 0; i < count; i++) {
    const w = 0.15 + rnd() * 0.05, d = 0.21 + rnd() * 0.05, h = 0.022 + rnd() * 0.02;
    const cloth = fabricTexture(60 + i, cols[i % cols.length], 0.4);
    const cover = pbrMat(cloth, { color: '#ffffff' });
    const pages = new THREE.MeshStandardMaterial({ color: '#8a7a5a', roughness: 0.95 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [pages, cover, cover, cover, pages, pages]);
    b.position.set((rnd() - 0.5) * 0.02, y + h / 2, (rnd() - 0.5) * 0.02);
    b.rotation.y = (rnd() - 0.5) * 0.3;
    y += h;
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

export function tray(seed = 4): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, -0.06); shape.lineTo(0.16, -0.06); shape.lineTo(0.16, 0.06); shape.lineTo(-0.16, 0.06); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, rustyMetal(seed + 70, '#4e4a3e', 0.7, 0.8));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A metal tube bed frame / gurney silhouette for the background. */
export function bedFrame(seed = 5): THREE.Group {
  const g = new THREE.Group();
  const m = rustyMetal(seed + 80, '#5a5a50', 0.7, 0.7);
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.016) => {
    const len = a.distanceTo(b);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
    t.position.copy(a).add(b).multiplyScalar(0.5);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    t.castShadow = true;
    g.add(t);
  };
  const W = 0.9, L = 1.9, H = 0.55;
  for (const x of [-W / 2, W / 2]) for (const z of [0, L]) tube(new THREE.Vector3(x, 0, -z), new THREE.Vector3(x, z === 0 ? 1.1 : 0.85, -z));
  for (const z of [0, L]) {
    const top = z === 0 ? 1.1 : 0.85;
    tube(new THREE.Vector3(-W / 2, top, -z), new THREE.Vector3(W / 2, top, -z));
    for (let i = 1; i < 6; i++) { const x = -W / 2 + (i / 6) * W; tube(new THREE.Vector3(x, H, -z), new THREE.Vector3(x, top, -z), 0.008); }
    tube(new THREE.Vector3(-W / 2, H, -z), new THREE.Vector3(W / 2, H, -z));
  }
  for (const x of [-W / 2, W / 2]) tube(new THREE.Vector3(x, H, 0), new THREE.Vector3(x, H, -L));
  // stained mattress
  const mat = pbrMat(fabricTexture(90, '#5a5a44', 1.0));
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.12, L - 0.06), mat);
  mattress.position.set(0, H + 0.06, -L / 2);
  mattress.castShadow = mattress.receiveShadow = true;
  g.add(mattress);
  return g;
}

export function pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat);
  t.position.copy(a).add(b).multiplyScalar(0.5);
  t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  t.castShadow = true; t.receiveShadow = true;
  return t;
}

export function cabinet(seed = 6, w = 0.6, h = 1.8, d = 0.45, color = '#4a5048'): THREE.Group {
  const g = new THREE.Group();
  const m = rustyMetal(seed, color, 0.45, 0.6);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  body.position.y = h / 2;
  g.add(body);
  const hm = new THREE.MeshStandardMaterial({ color: '#8a8070', metalness: 0.9, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: '#111' }));
    seam.position.set(0, (h / 4) * (i + 1) - 0.02, d / 2 + 0.002);
    g.add(seam);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.02), hm);
    handle.position.set(0, (h / 4) * i + h / 8 + 0.05, d / 2 + 0.01);
    g.add(handle);
  }
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

/** Fake volumetric light shaft (additive, view-angle faded). */
export function lightShaft(length: number, r0: number, r1: number, color: string, strength: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r0, r1, length, 32, 1, true);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 }, uLen: { value: length } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uLen;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vW;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float along = clamp(-vY / uLen, 0.0, 1.0);
        float a = pow(facing, 3.0) * (1.0 - smoothstep(0.55, 1.0, along)) * smoothstep(0.0, 0.25, along);
        float flick = 0.92 + 0.08 * sin(uTime * 1.3 + vW.x * 7.0);
        gl_FragColor = vec4(uColor * a * uStrength * flick, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 5;
  return m;
}

/**
 * Dust motes: bounded particle system. Brightness is computed per-particle from its distance to the
 * key light's cone axis, so motes are only visible where the lamp catches them.
 */
export class Dust extends THREE.Points {
  constructor(count: number, center: THREE.Vector3, size: THREE.Vector3, light: { pos: THREE.Vector3; dir: THREE.Vector3; angle: number; color: THREE.Color }) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), s = new Float32Array(count);
    const rnd = mulberry32(99);
    for (let i = 0; i < count; i++) {
      p[i * 3] = center.x + (rnd() - 0.5) * size.x;
      p[i * 3 + 1] = center.y + (rnd() - 0.5) * size.y;
      p[i * 3 + 2] = center.z + (rnd() - 0.5) * size.z;
      s[i] = rnd();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uLightPos: { value: light.pos }, uLightDir: { value: light.dir }, uCos: { value: Math.cos(light.angle) },
        uColor: { value: light.color }, uCenter: { value: center }, uSize: { value: size }, uPx: { value: 1 }, uAmount: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime, uCos, uPx; uniform vec3 uLightPos, uLightDir, uCenter, uSize;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.006 + seed * 0.01);
          p += vec3(sin(t * 3.0 + seed * 40.0) * 0.03, -mod(t + seed, 1.0) * 0.0 + sin(t * 2.0 + seed * 9.0) * 0.02, cos(t * 2.3 + seed * 17.0) * 0.03);
          p = uCenter + mod(p - uCenter + uSize * 0.5, uSize) - uSize * 0.5;
          vec3 L = p - uLightPos;
          float d = length(L);
          float c = dot(L / d, uLightDir);
          float inCone = smoothstep(uCos, uCos + 0.15, c);
          vA = inCone / (1.0 + d * d * 4.0) * (0.4 + 0.6 * fract(seed * 13.7));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uPx * (0.6 + seed * 1.6) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAmount; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c)) * vA * uAmount;
          gl_FragColor = vec4(uColor * a * 3.0, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    super(geo, mat);
    this.frustumCulled = false;
    this.renderOrder = 6;
  }
  update(t: number, pxScale: number) {
    const m = this.material as THREE.ShaderMaterial;
    m.uniforms.uTime.value = t;
    m.uniforms.uPx.value = pxScale;
  }
}
