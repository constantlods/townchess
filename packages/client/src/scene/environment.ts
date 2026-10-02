import * as THREE from 'three';
import {
  tableTexture, tileTexture, plasterTexture, floorTexture, brickTexture, wallpaperTexture, panelTexture,
  concreteTexture, signTexture, type PBRSet, type TableOpts,
} from '../render/textures';
import {
  pbrMat, rustyMetal, industrialLamp, tinMug, metalBowl, paperSheet, bookStack, tray, bedFrame, pipe, cabinet,
  lightShaft, Dust,
} from './props';

export type EnvId = 'institutional' | 'basement' | 'examination' | 'office' | 'prison' | 'hotel';

export interface EnvPreset {
  id: EnvId;
  name: string;
  description: string;
  table: TableOpts;
  lampStyle: 'industrial' | 'exam' | 'banker' | 'bulb' | 'candle';
  keyColor: string; // ~2700-3300K
  keyIntensity: number;
  coldColor: string; // ~4000-5000K fluorescent
  coldIntensity: number;
  fog: string;
  fogDensity: number;
  grade: { shadow: [number, number, number]; high: [number, number, number]; sat: number };
  sign?: [string, string];
}

export const ENVIRONMENTS: EnvPreset[] = [
  {
    id: 'institutional', name: 'Institutional Oak', description: 'Ward B day room. A lamp, a board, and the smell of old disinfectant.',
    table: { seed: 11, base: '#59402b', dark: '#241812', light: '#76583b', blood: 0.7, planks: 5 },
    lampStyle: 'industrial', keyColor: '#ffb46b', keyIntensity: 9, coldColor: '#c9dccb', coldIntensity: 2.2,
    fog: '#0d0f0b', fogDensity: 0.32, grade: { shadow: [0.9, 1.0, 0.96], high: [1.05, 0.98, 0.86], sat: 0.78 }, sign: ['WARD', 'B'],
  },
  {
    id: 'basement', name: 'Basement Table', description: 'Brick, pipes and a single bare bulb. Something drips behind you.',
    table: { seed: 12, base: '#4a3424', dark: '#1c120c', light: '#6a4e34', blood: 0.5, planks: 4 },
    lampStyle: 'bulb', keyColor: '#ffaa5e', keyIntensity: 8, coldColor: '#9fb2a8', coldIntensity: 0.8,
    fog: '#0b0907', fogDensity: 0.38, grade: { shadow: [0.95, 0.97, 0.95], high: [1.08, 0.97, 0.84], sat: 0.74 },
  },
  {
    id: 'examination', name: 'Examination Room', description: 'Cold tile and a surgical lamp. Everything is wiped, nothing is clean.',
    table: { seed: 13, base: '#5e4a36', dark: '#2a1e14', light: '#7e6448', blood: 0.9, planks: 6 },
    lampStyle: 'exam', keyColor: '#ffc283', keyIntensity: 9, coldColor: '#d6e6dc', coldIntensity: 3.4,
    fog: '#0e1210', fogDensity: 0.26, grade: { shadow: [0.88, 1.0, 1.0], high: [1.02, 1.0, 0.92], sat: 0.72 }, sign: ['EXAM', '3'],
  },
  {
    id: 'office', name: 'Abandoned Office', description: "A director's desk lamp still works. The files do not want to be read.",
    table: { seed: 14, base: '#4e3020', dark: '#1e120a', light: '#6e4a30', blood: 0.25, planks: 3 },
    lampStyle: 'banker', keyColor: '#ffb066', keyIntensity: 8.5, coldColor: '#b4c4c0', coldIntensity: 1.0,
    fog: '#0c0a08', fogDensity: 0.3, grade: { shadow: [0.94, 0.98, 0.96], high: [1.06, 0.98, 0.86], sat: 0.8 },
  },
  {
    id: 'prison', name: 'Prison Cell', description: 'Bars behind your opponent. Moonlight through a slot in the concrete.',
    table: { seed: 15, base: '#4c4030', dark: '#201a12', light: '#6a5a44', blood: 0.6, planks: 4 },
    lampStyle: 'industrial', keyColor: '#ffb870', keyIntensity: 8, coldColor: '#b8cbd6', coldIntensity: 2.8,
    fog: '#0a0d0e', fogDensity: 0.3, grade: { shadow: [0.88, 0.98, 1.02], high: [1.03, 0.99, 0.9], sat: 0.7 },
  },
  {
    id: 'hotel', name: 'Old Hotel', description: 'Peeling damask and a candle. Room 9 was never checked out.',
    table: { seed: 16, base: '#5a3220', dark: '#22120a', light: '#7a4a2e', blood: 0.35, planks: 3 },
    lampStyle: 'candle', keyColor: '#ff9e50', keyIntensity: 7, coldColor: '#a8b4ac', coldIntensity: 0.6,
    fog: '#0d0906', fogDensity: 0.34, grade: { shadow: [0.96, 0.96, 0.94], high: [1.1, 0.96, 0.82], sat: 0.82 },
  },
];

export const TABLE_TOP = 0.76;

export interface BuiltEnvironment {
  group: THREE.Group;
  key: THREE.SpotLight;
  keyPos: THREE.Vector3;
  bulb: THREE.Mesh | null;
  cold: THREE.Light[];
  dust: Dust | null;
  shafts: THREE.Mesh[];
  flicker: (t: number) => void;
  preset: EnvPreset;
}

function wallMat(t: PBRSet, repeat: [number, number], color = '#ffffff') {
  const m = pbrMat(t, { color });
  for (const tex of [m.map!, m.normalMap!, m.roughnessMap!]) { tex.repeat.set(repeat[0], repeat[1]); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  return m;
}

/** Clone texture set so different surfaces can use different repeats. */
function rep(t: PBRSet, x: number, y: number): PBRSet {
  const c = (tx: THREE.Texture) => { const n = tx.clone(); n.repeat.set(x, y); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.needsUpdate = true; return n; };
  return { map: c(t.map), normalMap: c(t.normalMap), roughnessMap: c(t.roughnessMap) };
}

export function buildEnvironment(p: EnvPreset, opts: { simplified: boolean; reducedHorror: boolean; dust: boolean }): BuiltEnvironment {
  const g = new THREE.Group();
  const W = 5.2, D = 5.0, H = 3.1; // room
  const backZ = -2.1, frontZ = 2.4, leftX = -2.4, rightX = 2.8;
  const blood = opts.reducedHorror ? 0 : 1;

  // ── Room shell ───────────────────────────────────────────
  let lower: PBRSet, upper: PBRSet, floor: PBRSet;
  switch (p.id) {
    case 'basement': lower = brickTexture(31); upper = brickTexture(31); floor = concreteTexture(33, '#4a463c'); break;
    case 'examination': lower = tileTexture({ seed: 34, tile: '#9aa69a', grout: '#3a3e36', dirt: 0.8, cols: 8, rows: 8 }); upper = plasterTexture({ seed: 35, color: '#8a9086', stain: '#4a4a3a', dirt: 0.8 }); floor = floorTexture(36, '#6a6e64', '#3a3c34'); break;
    case 'office': lower = panelTexture(37); upper = plasterTexture({ seed: 38, color: '#6e6450', stain: '#3a3020', dirt: 0.9 }); floor = floorTexture(39, '#4a3a2a', '#3a2c20'); break;
    case 'prison': lower = concreteTexture(40, '#5a5c58'); upper = concreteTexture(41, '#4e504c'); floor = concreteTexture(42, '#3e3e38'); break;
    case 'hotel': lower = panelTexture(43); upper = wallpaperTexture(44); floor = floorTexture(45, '#3a2418', '#2a1810'); break;
    default: lower = tileTexture({ seed: 30, tile: '#7f8a72', grout: '#2e3226', dirt: 1.0, cols: 8, rows: 8 }); upper = plasterTexture({ seed: 32, color: '#6e705e', stain: '#3a3826', dirt: 1.0 }); floor = floorTexture(46, '#4e4c40', '#2e2c24');
  }
  const wainscot = p.id === 'prison' || p.id === 'basement' ? H : 1.45;
  const addWall = (w: number, pos: THREE.Vector3, rotY: number) => {
    const low = new THREE.Mesh(new THREE.PlaneGeometry(w, wainscot), wallMat(rep(lower, w / 1.2, wainscot / 1.2), [1, 1]));
    low.position.copy(pos).setY(wainscot / 2);
    low.rotation.y = rotY;
    low.receiveShadow = true;
    g.add(low);
    if (wainscot < H) {
      const up = new THREE.Mesh(new THREE.PlaneGeometry(w, H - wainscot), wallMat(rep(upper, w / 2, (H - wainscot) / 2), [1, 1]));
      up.position.copy(pos).setY(wainscot + (H - wainscot) / 2);
      up.rotation.y = rotY;
      up.receiveShadow = true;
      g.add(up);
      // dado rail
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.03), rustyMetal(47, '#3a3a30', 0.5, 0.3));
      rail.position.copy(pos).setY(wainscot);
      rail.rotation.y = rotY;
      g.add(rail);
    }
  };
  addWall(W + 0.4, new THREE.Vector3((leftX + rightX) / 2, 0, backZ), 0);
  addWall(D + 0.5, new THREE.Vector3(leftX, 0, (backZ + frontZ) / 2), Math.PI / 2);
  addWall(D + 0.5, new THREE.Vector3(rightX, 0, (backZ + frontZ) / 2), -Math.PI / 2);
  addWall(W + 0.4, new THREE.Vector3((leftX + rightX) / 2, 0, frontZ), Math.PI);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, D + 0.5), wallMat(rep(floor, 3, 3), [1, 1]));
  fl.rotation.x = -Math.PI / 2;
  fl.position.set((leftX + rightX) / 2, 0, (backZ + frontZ) / 2);
  fl.receiveShadow = true;
  g.add(fl);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, D + 0.5), wallMat(rep(plasterTexture({ seed: 48, color: '#4a4a40', stain: '#2a281e', dirt: 1 }), 2, 2), [1, 1]));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set((leftX + rightX) / 2, H, (backZ + frontZ) / 2);
  g.add(ceil);

  // ── Table ────────────────────────────────────────────────
  const tt = tableTexture({ ...p.table, blood: p.table.blood * blood });
  const tableMat = new THREE.MeshPhysicalMaterial({
    map: tt.map, normalMap: tt.normalMap, roughnessMap: tt.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(1, 1),
    clearcoat: 0.08, clearcoatRoughness: 0.7, envMapIntensity: 0.4,
  });
  const tableW = 1.75, tableD = 1.15, tableT = 0.05;
  const topGeo = new THREE.BoxGeometry(tableW, tableT, tableD, 1, 1, 1);
  // map UVs of the top face to the full texture
  const top = new THREE.Mesh(topGeo, tableMat);
  top.position.set(0, TABLE_TOP - tableT / 2, -0.08);
  top.receiveShadow = true; top.castShadow = true;
  g.add(top);
  const legMat = pbrMat(rep(tt, 0.2, 1));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, TABLE_TOP - tableT, 0.07), legMat);
    leg.position.set(x * (tableW / 2 - 0.08), (TABLE_TOP - tableT) / 2, -0.08 + z * (tableD / 2 - 0.08));
    leg.castShadow = true;
    g.add(leg);
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(tableW - 0.1, 0.1, tableD - 0.1), legMat);
  apron.position.set(0, TABLE_TOP - tableT - 0.05, -0.08);
  g.add(apron);

  // ── Key light (lamp on the left) ────────────────────────
  const keyColor = new THREE.Color(p.keyColor);
  const key = new THREE.SpotLight(keyColor, p.keyIntensity, 6, 0.95, 0.75, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 6;
  key.shadow.blurSamples = 16;
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = 4;
  let bulb: THREE.Mesh | null = null;
  const keyPos = new THREE.Vector3();
  const lampX = -0.78, lampZ = -0.42;
  if (p.lampStyle === 'industrial' || p.lampStyle === 'exam' || p.lampStyle === 'banker') {
    const lamp = industrialLamp(p.lampStyle);
    lamp.group.position.set(lampX, TABLE_TOP, lampZ);
    lamp.group.rotation.y = -0.2;
    g.add(lamp.group);
    lamp.group.updateMatrixWorld(true);
    keyPos.copy(lamp.bulb).applyMatrix4(lamp.group.matrixWorld);
    bulb = lamp.bulbMesh;
    (bulb.material as THREE.MeshStandardMaterial).emissive.set(keyColor);
  } else if (p.lampStyle === 'bulb') {
    keyPos.set(-0.35, TABLE_TOP + 0.75, -0.1);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, H - keyPos.y), new THREE.MeshStandardMaterial({ color: '#111' }));
    cord.position.set(keyPos.x, (H + keyPos.y) / 2, keyPos.z);
    g.add(cord);
    bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), new THREE.MeshStandardMaterial({ color: '#fff', emissive: keyColor, emissiveIntensity: 16 }));
    bulb.position.copy(keyPos);
    g.add(bulb);
  } else {
    // candle in a tarnished holder
    keyPos.set(-0.5, TABLE_TOP + 0.24, -0.15);
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.02, 24), rustyMetal(49, '#6a5030', 0.4, 0.9));
    holder.position.set(keyPos.x, TABLE_TOP + 0.01, keyPos.z);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.19, 18), new THREE.MeshPhysicalMaterial({ color: '#d8c8a0', roughness: 0.5, transmission: 0.0, sheen: 0.5 }));
    wax.position.set(keyPos.x, TABLE_TOP + 0.115, keyPos.z);
    bulb = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), new THREE.MeshStandardMaterial({ color: '#fff', emissive: keyColor, emissiveIntensity: 30 }));
    bulb.scale.set(0.7, 1.6, 0.7);
    bulb.position.copy(keyPos);
    g.add(holder, wax, bulb);
    holder.castShadow = wax.castShadow = true;
  }
  key.position.copy(keyPos);
  key.target.position.set(-0.02, TABLE_TOP, 0.05);
  g.add(key, key.target);
  // the lamp also catches the opponent's mask (weak, no shadow) — the reference lights the face from upper left
  const face = new THREE.SpotLight(keyColor, p.keyIntensity * 0.22, 3, 0.22, 0.9, 1.5);
  face.position.copy(keyPos);
  face.target.position.set(0, TABLE_TOP + 0.42, -0.5);
  g.add(face, face.target);
  // soft local glow so the lamp body/shade read
  const glow = new THREE.PointLight(keyColor, p.keyIntensity * 0.012, 0.6, 2);
  glow.position.copy(keyPos).add(new THREE.Vector3(0.04, -0.09, 0.02));
  g.add(glow);

  // ── Cold environment light(s) ───────────────────────────
  const cold: THREE.Light[] = [];
  const coldC = new THREE.Color(p.coldColor);
  const hemi = new THREE.HemisphereLight(coldC, new THREE.Color('#1a120a'), 0.12);
  g.add(hemi);
  cold.push(hemi);
  // fluorescent fixture above and behind the opponent
  const fx = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.22), rustyMetal(50, '#5a5a50', 0.6, 0.6));
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#dfe8e0', emissive: coldC, emissiveIntensity: 3 });
  const tube1 = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.12, 12), tubeMat);
  tube1.rotation.z = Math.PI / 2; tube1.position.set(0, -0.04, 0.05);
  const tube2 = tube1.clone(); tube2.position.z = -0.05;
  fx.add(housing, tube1, tube2);
  fx.position.set(0.3, H - 0.08, -1.25);
  g.add(fx);
  const fluo = new THREE.SpotLight(coldC, p.coldIntensity, 5, 1.1, 0.9, 1.5);
  fluo.position.set(0.3, H - 0.15, -1.25);
  fluo.target.position.set(0.0, 0.6, -1.0);
  fluo.castShadow = false;
  g.add(fluo, fluo.target);
  cold.push(fluo);
  // faint cold rim behind the opponent so their silhouette separates from the wall
  const rim = new THREE.SpotLight(coldC, p.coldIntensity * 0.9, 4, 0.6, 0.8, 1.5);
  rim.position.set(0.9, 2.1, -1.9);
  rim.target.position.set(0, 1.15, -0.45);
  g.add(rim, rim.target);
  cold.push(rim);

  const shafts: THREE.Mesh[] = [];
  // ── Environment-specific dressing ──────────────────────
  if (!opts.simplified) {
    const pipeMat = rustyMetal(51, '#4a4a40', 0.75, 0.75);
    // pipes along the back wall
    g.add(pipe(new THREE.Vector3(leftX, 2.55, backZ + 0.12), new THREE.Vector3(rightX, 2.55, backZ + 0.12), 0.05, pipeMat));
    g.add(pipe(new THREE.Vector3(leftX, 2.38, backZ + 0.1), new THREE.Vector3(rightX, 2.38, backZ + 0.1), 0.025, pipeMat));
    g.add(pipe(new THREE.Vector3(1.6, 0, backZ + 0.12), new THREE.Vector3(1.6, 2.55, backZ + 0.12), 0.04, pipeMat));
    for (const x of [-1.6, -0.4, 0.8, 2.0]) {
      const bracket = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 6, 16), pipeMat);
      bracket.position.set(x, 2.55, backZ + 0.12);
      bracket.rotation.y = Math.PI / 2;
      g.add(bracket);
    }
    if (p.sign) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: signTexture(p.sign[0], p.sign[1]), transparent: true, roughness: 0.95, depthWrite: false }));
      sign.position.set(0.95, 1.85, backZ + 0.01);
      g.add(sign);
    }
    if (p.id === 'institutional' || p.id === 'examination' || p.id === 'prison') {
      // barred window, back-left, with cold light coming through dirty glass
      const win = new THREE.Group();
      const frame = rustyMetal(52, '#2a2c26', 0.7, 0.6);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0), new THREE.MeshStandardMaterial({ color: '#2a3430', emissive: coldC, emissiveIntensity: p.id === 'prison' ? 0.1 : 0.045, roughness: 0.8 }));
      win.add(glass);
      for (let i = -3; i <= 3; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.05, 8), frame);
        bar.position.set(i * 0.1, 0, 0.04);
        win.add(bar);
      }
      for (const y of [-0.5, 0, 0.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.03, 0.03), frame);
        rail.position.set(0, y, 0.04);
        win.add(rail);
      }
      win.position.set(-1.25, 1.75, backZ + 0.02);
      g.add(win);
      const shaft = lightShaft(2.4, 0.35, 0.8, p.coldColor, opts.reducedHorror ? 0.03 : 0.045);
      shaft.position.set(-1.25, 2.1, backZ + 0.15);
      shaft.rotation.x = -0.75;
      g.add(shaft);
      shafts.push(shaft);
    }
    if (p.id === 'institutional' || p.id === 'examination') {
      const bed = bedFrame(53);
      bed.position.set(1.65, 0, -0.6);
      bed.rotation.y = -0.08;
      g.add(bed);
      const cab = cabinet(54, 0.55, 1.75, 0.45);
      cab.position.set(-1.95, 0, -1.7);
      cab.rotation.y = 0.5;
      g.add(cab);
    }
    if (p.id === 'prison') {
      const barMat = rustyMetal(55, '#3e403a', 0.6, 0.8);
      for (let i = -14; i <= 14; i++) g.add(pipe(new THREE.Vector3(i * 0.13, 0, -1.55), new THREE.Vector3(i * 0.13, 2.6, -1.55), 0.013, barMat));
      for (const y of [0.1, 1.2, 2.5]) g.add(pipe(new THREE.Vector3(-1.9, y, -1.55), new THREE.Vector3(1.9, y, -1.55), 0.02, barMat));
      const cot = bedFrame(56);
      cot.scale.set(0.9, 0.7, 0.9);
      cot.position.set(-1.6, 0, 1.2);
      g.add(cot);
    }
    if (p.id === 'basement') {
      for (let i = 0; i < 4; i++) g.add(pipe(new THREE.Vector3(-2.3 + i * 0.12, H, -1.5), new THREE.Vector3(-2.3 + i * 0.12, 0, -1.5), 0.03, pipeMat));
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), pbrMat(rep(tt, 0.4, 0.4)));
      crate.position.set(1.7, 0.25, -1.4); crate.rotation.y = 0.4; g.add(crate);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 24), rustyMetal(57, '#3a4030', 0.8, 0.7));
      drum.position.set(-1.6, 0.44, -1.5); g.add(drum);
    }
    if (p.id === 'office') {
      for (let i = 0; i < 3; i++) { const c = cabinet(58 + i, 0.5, 1.35, 0.6, '#4a463a'); c.position.set(-1.6 + i * 0.55, 0, -1.75); g.add(c); }
      const blinds = new THREE.Group();
      for (let i = 0; i < 20; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.004, 0.04), new THREE.MeshStandardMaterial({ color: '#8a826a', roughness: 0.8 }));
        slat.position.y = i * 0.05; slat.rotation.x = 0.6; blinds.add(slat);
      }
      blinds.position.set(1.1, 1.2, backZ + 0.05);
      const winGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.0), new THREE.MeshStandardMaterial({ color: '#202826', emissive: coldC, emissiveIntensity: 0.3 }));
      winGlow.position.set(1.1, 1.67, backZ + 0.02);
      g.add(winGlow, blinds);
    }
    if (p.id === 'examination') {
      const tray2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.35), rustyMetal(59, '#8a8a80', 0.3, 0.9));
      tray2.position.set(-1.6, 1.0, -0.9);
      const stand = pipe(new THREE.Vector3(-1.6, 0, -0.9), new THREE.Vector3(-1.6, 1.0, -0.9), 0.015, rustyMetal(60, '#8a8a80', 0.3, 0.9));
      g.add(tray2, stand);
    }
    if (p.id === 'hotel') {
      const bed = bedFrame(61); bed.position.set(1.6, 0, -0.4); g.add(bed);
      const frameMat = rustyMetal(62, '#6a5030', 0.3, 0.9);
      const pic = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.03), frameMat);
      pic.position.set(-0.9, 1.8, backZ + 0.03);
      const canvasM = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ color: '#1e1610', roughness: 0.8 }));
      canvasM.position.set(-0.9, 1.8, backZ + 0.05);
      g.add(pic, canvasM);
    }

    // ── Table dressing (shared, slightly varied) ──────────
    const mug = tinMug(1);
    mug.position.set(0.42, TABLE_TOP, -0.36);
    mug.rotation.y = 2.2;
    g.add(mug);
    if (p.lampStyle !== 'candle') {
      const bowl = metalBowl(2);
      bowl.position.set(-0.6, TABLE_TOP, -0.38);
      g.add(bowl);
    }
    const books = bookStack(3, p.id === 'office' ? 5 : 3);
    books.position.set(0.6, TABLE_TOP, -0.1);
    books.rotation.y = 0.35;
    g.add(books);
    const tr = tray(4);
    tr.position.set(-0.05, TABLE_TOP + 0.002, -0.4);
    g.add(tr);
    for (let i = 0; i < 4; i++) {
      const sh = paperSheet(200 + i);
      sh.position.set([0.52, 0.6, -0.5, 0.36][i], TABLE_TOP + 0.001 + i * 0.0006, [0.1, -0.22, 0.22, -0.32][i]);
      sh.rotation.y = [0.4, -0.3, 0.9, 0.2][i];
      g.add(sh);
    }
  }

  // ── Dust motes in the lamp cone ─────────────────────────
  let dust: Dust | null = null;
  if (opts.dust) {
    const dir = key.target.position.clone().sub(key.position).normalize();
    dust = new Dust(380, new THREE.Vector3(-0.25, TABLE_TOP + 0.35, -0.05), new THREE.Vector3(0.9, 0.7, 0.9), { pos: keyPos.clone(), dir, angle: 0.8, color: keyColor.clone().multiplyScalar(0.6) });
    g.add(dust);
  }

  // very slow, rare fluorescent instability — never aggressive flashing
  const baseCold = fluo.intensity, baseTube = tubeMat.emissiveIntensity;
  const flicker = (t: number) => {
    const blip = Math.sin(t * 0.37) > 0.995 ? 0.6 + 0.4 * Math.sin(t * 40) : 1;
    fluo.intensity = baseCold * blip;
    tubeMat.emissiveIntensity = baseTube * blip;
    for (const s of shafts) (s.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  };

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m.material as THREE.Material).transparent) m.receiveShadow = true;
  });

  return { group: g, key, keyPos, bulb, cold, dust, shafts, flicker, preset: p };
}
