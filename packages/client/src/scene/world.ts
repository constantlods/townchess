import * as THREE from 'three';
import type { BoardPiece, Color, Square } from '@hc/shared';
import { PostFX, type Quality } from '../render/post';
import { CameraRig } from './cameraRig';
import { Board } from './board';
import { PieceMesh, makePieceMaterials, type PieceMaterials } from './pieces';
import { ENVIRONMENTS, buildEnvironment, TABLE_TOP, type BuiltEnvironment, type EnvId } from './environment';
import type { Settings } from '../settings';

export interface Updatable { update(t: number, dt: number): void }

/** Owns renderer, scene graph, and the per-frame loop. Pure presentation: holds no game authority. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  post!: PostFX;
  env!: BuiltEnvironment;
  readonly board: Board;
  pieceMats: PieceMaterials;
  /** Piece meshes currently on the board, keyed by square. */
  readonly pieces = new Map<Square, PieceMesh>();
  /** Pieces that have been captured and set aside on the table. */
  readonly captured: PieceMesh[] = [];
  readonly updatables = new Set<Updatable>();
  private clock = new THREE.Clock();
  private t = 0;
  private frameTimes: number[] = [];
  private envMapRT: THREE.WebGLRenderTarget | null = null;
  playerColor: Color = 'w';

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.setPixelRatio();
    this.rig = new CameraRig(innerWidth / innerHeight);
    this.board = new Board({ highContrast: settings.highContrastPieces, blood: settings.reducedHorror ? 0 : 1 });
    this.board.position.set(0, TABLE_TOP, 0);
    this.board.rotation.y = 0.012; // never perfectly square to the camera
    this.scene.add(this.board);
    this.pieceMats = makePieceMaterials(settings.highContrastPieces);
    this.setEnvironment(settings.environment);
    this.makePost(settings.quality);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private setPixelRatio() {
    const q = this.settings.quality;
    const cap = q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
  }

  makePost(q: Quality) {
    this.post?.dispose();
    this.renderer.shadowMap.type = q === 'low' ? THREE.PCFShadowMap : THREE.VSMShadowMap;
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, q, this.settings.depthOfField);
    this.applyGrade();
    this.resize();
  }

  applyGrade() {
    if (!this.post || !this.env) return;
    const g = this.env.preset.grade;
    const u = this.post.grade.uniforms;
    u.uShadowTint.value.set(...g.shadow);
    u.uHighTint.value.set(...g.high);
    u.uSaturation.value = g.sat;
    u.uGrain.value = this.settings.reducedHorror ? 0.02 : 0.035;
    u.uVignette.value = this.settings.reducedHorror ? 0.1 : 0.18;
  }

  setEnvironment(id: EnvId) {
    const preset = ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    this.env = buildEnvironment(preset, {
      simplified: this.settings.simplifiedEnvironment,
      reducedHorror: this.settings.reducedHorror,
      dust: !this.settings.simplifiedEnvironment && this.settings.quality !== 'low',
    });
    this.scene.add(this.env.group);
    this.scene.fog = new THREE.FogExp2(preset.fog, preset.fogDensity);
    this.scene.background = new THREE.Color(preset.fog);
    this.env.key.shadow.mapSize.setScalar(this.settings.quality === 'low' ? 1024 : 2048);
    this.buildEnvMap();
    this.applyGrade();
  }

  /** Reflection probe: a PMREM of the room (without the board/pieces) gives believable specular. */
  private buildEnvMap() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const probe = new THREE.Scene();
    probe.background = new THREE.Color('#050504');
    // Simple emissive stand-ins for the key lamp and the cold window/tube.
    const warm = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.env.preset.keyColor).multiplyScalar(6) }));
    warm.position.copy(this.env.keyPos).sub(new THREE.Vector3(0, TABLE_TOP, 0)).multiplyScalar(3).add(new THREE.Vector3(0, 0.6, 0));
    const coldM = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.env.preset.coldColor).multiplyScalar(1.2), side: THREE.DoubleSide }));
    coldM.position.set(0.3, 3, -2.5); coldM.rotation.x = Math.PI / 2;
    const roomBox = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 8), new THREE.MeshBasicMaterial({ color: '#16130e', side: THREE.BackSide }));
    probe.add(warm, coldM, roomBox);
    this.envMapRT?.dispose();
    this.envMapRT = pm.fromScene(probe, 0.03);
    this.scene.environment = this.envMapRT.texture;
    this.scene.environmentIntensity = 0.35;
    pm.dispose();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.setPixelRatio();
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.rig.compose(w / h);
    const pr = this.renderer.getPixelRatio();
    this.post?.setSize(w * pr, h * pr);
  }

  /** Place all piece meshes to match a position (no animation). */
  setPosition(pieces: BoardPiece[]) {
    for (const m of this.pieces.values()) this.board.remove(m);
    for (const m of this.captured) m.parent?.remove(m);
    this.pieces.clear();
    this.captured.length = 0;
    let i = 0;
    for (const p of pieces) {
      const m = new PieceMesh(p.type, p.color, this.pieceMats, i++);
      this.placeOn(m, p.square);
      this.board.add(m);
      this.pieces.set(p.square, m);
    }
  }

  placeOn(m: PieceMesh, sq: Square) {
    const l = this.board.squareLocal(sq);
    const j = m.userData.jitter;
    m.position.set(l.x + j.dx, l.y, l.z + j.dz);
  }

  rebuildPieceMaterials() {
    this.pieceMats = makePieceMaterials(this.settings.highContrastPieces);
    for (const m of [...this.pieces.values(), ...this.captured]) m.material = this.pieceMats[m.color][0];
  }

  /** Where a captured piece of `color` should be set down on the table (beside the board). */
  capturedSpot(color: Color): THREE.Vector3 {
    const n = this.captured.filter((c) => c.color === color).length;
    // pieces you capture go to your right; pieces you lose go to your opponent's right
    const mine = color !== this.playerColor;
    const side = mine ? 1 : -1;
    const row = Math.floor(n / 8), col = n % 8;
    return new THREE.Vector3(side * (0.29 + row * 0.045), TABLE_TOP, side * (0.17 - col * 0.048));
  }

  /** Stop rendering after this many frames (headless capture). 0 = run forever. */
  maxFrames = 0;
  /** Fixed timestep (s) for deterministic capture; 0 = real time. */
  fixedDt = 0;
  private frameCount = 0;

  start(onFrame: (t: number, dt: number) => void) {
    const loop = () => {
      const dt = this.fixedDt || Math.min(0.05, this.clock.getDelta());
      this.frameCount++;
      this.t += dt;
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
      onFrame(this.t, dt);
      for (const u of this.updatables) u.update(this.t, dt);
      this.rig.update(this.t, dt);
      this.env.flicker(this.t);
      this.env.dust?.update(this.t, this.renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.0016);
      this.post.setFocus(this.rig.camera.position.distanceTo(this.board.position));
      this.post.render(this.t);
      if (this.maxFrames && this.frameCount >= this.maxFrames) { (window as any).__HC_DONE = true; return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get fps(): number {
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    return avg > 0 ? 1 / avg : 0;
  }

  get time() { return this.t; }
}
