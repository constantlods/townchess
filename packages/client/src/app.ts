import * as THREE from 'three';
import { ChessRules, type Color, type Cosmetics, TIME_CONTROLS } from '@hc/shared';
import { World } from './scene/world';
import { loadSettings, saveSettings, type Settings } from './settings';
import { PlayerArms } from './scene/choreo';
import { Opponent } from './scene/opponent';
import { preload } from './render/assets';
import { setTexScale, getTexScale, tableTexture } from './render/textures';
import { Board } from './scene/board';
import { makePieceMaterials, pieceGeometry } from './scene/pieces';
import { buildEnvironment, ENVIRONMENTS, TABLE_TOP, type EnvId } from './scene/environment';
import { HandModel, POSES } from './scene/hands';
import { AudioEngine } from './audio/audio';
import { Presenter } from './game/presenter';
import { LocalSession } from './game/localSession';
import type { Session } from './game/session';
import { Hud } from './ui/hud';
import { Lobby, type PlayMode } from './ui/lobby';
import { Customize } from './ui/customize';
import { EnvironmentPicker } from './ui/environments';
import { SettingsPanel } from './ui/settingsPanel';
import { h } from './ui/dom';
import type { AiLevel } from './game/aiClient';
import { NetClient } from './net/netClient';

type Screen = 'lobby' | 'game' | 'customize' | 'environments';

const qualityScale = (q: Settings['quality']) => (q === 'low' ? 0.5 : q === 'medium' ? 0.75 : 1);

export class App {
  settings: Settings = loadSettings();
  world!: World;
  arms!: PlayerArms;
  opp!: Opponent;
  audio = new AudioEngine();
  presenter!: Presenter;
  hud!: Hud;
  lobby!: Lobby;
  customize!: Customize;
  envPicker!: EnvironmentPicker;
  settingsPanel!: SettingsPanel;
  net: NetClient | null = null;
  screen: Screen = 'lobby';
  private ui = document.getElementById('ui')!;
  private lastGame: { color: Color; tc: string; level: AiLevel } | null = null;
  private thumbCache = new Map<string, string>();
  private studio: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

  constructor(private params: URLSearchParams) {
    const q = params.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') this.settings.quality = q;
    const env = params.get('env');
    if (env && ENVIRONMENTS.some((e) => e.id === env)) this.settings.environment = env as EnvId;
  }

  async boot() {
    const loading = h('div', { class: 'loading' }, h('div', { class: 'inner' },
      h('div', { class: 't' }, 'PREPARING THE ROOM'), h('div', { class: 'bar' }, h('i')), h('div', { class: 's' }, 'Generating materials…')));
    this.ui.append(loading);
    const bar = loading.querySelector('i') as HTMLElement, sub = loading.querySelector('.s') as HTMLElement;
    setTexScale(qualityScale(this.settings.quality));
    const s = this.settings;
    await preload(() => {
      new Board({ highContrast: s.highContrastPieces, blood: s.reducedHorror ? 0 : 1 });
      makePieceMaterials(s.highContrastPieces);
      for (const t of ['p', 'n', 'b', 'r', 'q', 'k'] as const) pieceGeometry(t);
      buildEnvironment(this.envPreset(s.environment), this.envOpts());
      new HandModel('left', s.cosmetics); new HandModel('right', s.cosmetics);
      new Opponent({ reducedHorror: s.reducedHorror });
    }, (d, t) => { bar.style.width = `${t ? (d / t) * 100 : 100}%`; sub.textContent = `Generating materials… ${d}/${t}`; });
    sub.textContent = 'Setting the table…';
    await new Promise((r) => setTimeout(r, 0));

    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.world = new World(canvas, s);
    this.applyCameraOverride();
    this.world.setPosition(new ChessRules().pieces());
    this.arms = new PlayerArms(this.world, s.cosmetics);
    this.arms.layout(innerWidth / innerHeight);
    addEventListener('resize', () => { if (this.screen !== 'customize') this.arms.layout(innerWidth / innerHeight); });
    this.opp = new Opponent({ reducedHorror: s.reducedHorror });
    this.world.scene.add(this.opp);
    this.applyMotion();

    this.hud = new Hud(this.ui, {
      offerDraw: () => this.presenter.session?.offerDraw(),
      resign: () => this.presenter.session?.resign(),
      settings: () => this.settingsPanel.show(true),
      rematch: () => this.rematch(),
      lobby: () => this.toLobby(),
      click: () => this.audio.play('button'),
    });
    this.presenter = new Presenter(this.world, this.arms, this.opp, this.audio, s, this.hud);
    this.lobby = new Lobby(this.ui, {
      play: (mode, tc, o) => this.play(mode, tc, o),
      cancel: () => this.cancelSearch(),
      customize: () => this.go('customize'),
      environments: () => this.go('environments'),
      settings: () => this.settingsPanel.show(true),
      click: () => this.audio.play('button'),
    });
    this.customize = new Customize(this.ui, {
      select: (c) => void this.setCosmetics(c),
      preview: (c) => this.handPreview(c),
      back: () => this.go(this.presenter.session ? 'game' : 'lobby'),
      click: () => this.audio.play('button'),
    });
    this.envPicker = new EnvironmentPicker(this.ui, {
      select: (id) => void this.setEnvironment(id),
      thumbnail: (id) => this.envThumbnail(id),
      back: () => this.go(this.presenter.session ? 'game' : 'lobby'),
      click: () => this.audio.play('button'),
    });
    this.settingsPanel = new SettingsPanel(this.ui, s, {
      change: (ns, key) => void this.onSettings(ns, key),
      close: () => this.settingsPanel.show(false),
      click: () => this.audio.play('button'),
    });
    this.settingsPanel.show(false);
    this.audio.setVolumes(s.sfxVolume, s.ambienceVolume, s.musicVolume);
    this.audio.reducedHorror = s.reducedHorror;

    // audio needs a user gesture
    const unlock = () => { void this.audio.start(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);

    this.world.updatables.add({
      update: (t, dt) => {
        const motion = this.settings.reducedMotion ? 0.3 : 1;
        this.arms.update(t, dt, motion);
        this.opp.update(t, dt, this.settings.reducedMotion ? 0.3 : 1);
        this.presenter.update(t, dt);
        if (this.hud.tickClocks(performance.now())) this.audio.play('clock');
      },
    });

    const frames = Number(this.params.get('frames') ?? 0);
    if (frames) { this.world.maxFrames = frames; this.world.fixedDt = Number(this.params.get('dt') ?? 0.033); }
    let n = 0;
    this.world.start(() => {
      if (++n === 3) { loading.classList.add('done'); setTimeout(() => loading.remove(), 1300); (window as unknown as Record<string, unknown>).__HC_READY = true; }
      (window as unknown as Record<string, unknown>).__HC_STATS = { fps: this.world.fps.toFixed(1), calls: this.world.renderer.info.render.calls };
    });
    this.go('lobby');
    if (this.params.get('autostart')) this.play('ai', '5+0', { aiLevel: 'patient', color: 'w' });
    this.installDebug();
  }

  private envPreset(id: EnvId) { return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0]; }
  private envOpts() {
    const s = this.settings;
    return { simplified: s.simplifiedEnvironment, reducedHorror: s.reducedHorror, dust: !s.simplifiedEnvironment && s.quality !== 'low' };
  }

  private applyCameraOverride() {
    const cam = this.params.get('cam');
    if (!cam) return;
    const [hh, back, pitch, fov] = cam.split(',').map(Number);
    this.world.rig.override = { h: hh, back, pitch, fov };
    this.world.rig.compose(innerWidth / innerHeight);
  }

  private applyMotion() {
    const s = this.settings;
    this.world.rig.motionScale = s.reducedCamera ? 0 : s.reducedMotion ? 0.35 : 1;
    this.world.rig.largerBoard = s.largerBoard;
    this.world.rig.compose(innerWidth / innerHeight);
  }

  go(screen: Screen) {
    this.screen = screen;
    const inGame = !!this.presenter.session;
    this.lobby.show(screen === 'lobby');
    this.hud.show(screen === 'game' || (inGame && screen === 'environments'));
    this.customize.show(screen === 'customize', this.settings.cosmetics);
    this.envPicker.show(screen === 'environments', this.settings.environment);
    this.presenter.enabled = screen === 'game';
    this.world.rig.view = screen === 'lobby' ? 'lobby' : screen === 'customize' ? 'hands' : 'play';
    const armsVisible = screen !== 'lobby';
    this.arms.handL.visible = this.arms.handR.visible = armsVisible;
    if (screen === 'customize') {
      // present the hands toward the centre of the table, palms down, so both are in view
      const T = TABLE_TOP;
      void this.arms.armL.to({ wrist: new THREE.Vector3(-0.15, T + 0.032, 0.36), quat: this.arms.restL.quat, pose: POSES.restTap }, 0.7);
      void this.arms.armR.to({ wrist: new THREE.Vector3(0.19, T + 0.032, 0.36), quat: this.arms.restR.quat, pose: POSES.restTap }, 0.7);
    } else if (this.arms.armL.state.wrist.distanceTo(this.arms.restL.wrist) > 0.01) {
      void this.arms.armL.to(this.arms.restL, 0.6);
      void this.arms.armR.to(this.arms.restR, 0.6);
    }
  }

  // ── games ──────────────────────────────────────────
  private me() {
    return { id: 'local', username: this.settings.username, rating: Number(localStorage.getItem('hc.localRating') ?? 1204), cosmetics: this.settings.cosmetics };
  }

  play(mode: PlayMode, tc: string, o: { aiLevel: AiLevel; color: 'w' | 'b' | 'random'; joinCode?: string }) {
    if (mode === 'ai') {
      const color: Color = o.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : o.color;
      this.startLocal(color, tc, o.aiLevel);
      return;
    }
    void this.startOnline(mode, tc, o.joinCode);
  }

  private startLocal(color: Color, tc: string, level: AiLevel, fen?: string) {
    this.lastGame = { color, tc, level };
    const session = new LocalSession(color, TIME_CONTROLS[tc] ?? TIME_CONTROLS['5+0'], level, this.me(), fen);
    session.pondering = this.settings.animationMode === 'competitive' ? 0.3 : 1;
    this.attach(session);
    session.start();
  }

  private attach(session: Session) {
    this.presenter.attach(session);
    this.go('game');
  }

  private rematch() {
    const s = this.presenter.session;
    if (s?.kind === 'network') { s.rematch(); this.hud.toast('Rematch offered.'); return; }
    if (!this.lastGame) return this.toLobby();
    const color: Color = this.lastGame.color === 'w' ? 'b' : 'w';
    this.startLocal(color, this.lastGame.tc, this.lastGame.level);
  }

  toLobby() {
    if (this.presenter.session?.kind === 'network') this.net?.leave();
    this.presenter.detach();
    this.world.board.clearMarks();
    this.world.rig.clearFocus();
    this.world.post.grade.uniforms.uMate.value = 0;
    this.world.post.grade.uniforms.uCheck.value = 0;
    this.audio.setDuck(1);
    this.hud.hideGameOver();
    this.world.board.flipped = false;
    this.world.setPosition(new ChessRules().pieces());
    void this.opp.setMode('think', 1);
    this.go('lobby');
  }

  private async startOnline(mode: PlayMode, tc: string, joinCode?: string) {
    this.net ??= new NetClient(this.settings, {
      onSession: (session) => { this.lobby.setSearching(false); this.attach(session); },
      onStatus: (text) => this.lobby.setMessage(text),
      onQueued: (text) => this.lobby.setSearching(true, text),
    });
    try {
      await this.net.connect();
    } catch {
      this.lobby.setSearching(false);
      this.lobby.setMessage('Cannot reach the game server. Start it with <code>npm run dev:server</code>, or play vs AI.');
      return;
    }
    if (mode === 'private') {
      if (joinCode) this.net.joinGame(joinCode); else this.net.createPrivate(tc);
    } else this.net.findMatch(tc, mode === 'rated');
  }

  private cancelSearch() {
    this.net?.cancel();
    this.lobby.setSearching(false, 'Search cancelled.');
  }

  // ── cosmetics / environments ───────────────────────
  private async setCosmetics(c: Cosmetics) {
    await preload(() => { new HandModel('left', c); new HandModel('right', c); });
    this.settings.cosmetics = c;
    saveSettings(this.settings);
    this.arms.setCosmetics(c);
    this.net?.setCosmetics(c);
  }

  private async handPreview(c: Cosmetics): Promise<string> {
    const key = JSON.stringify(c);
    const hit = this.thumbCache.get(key);
    if (hit) return hit;
    await preload(() => new HandModel('right', c));
    if (!this.studio) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0b0a08');
      const t = tableTexture(this.envPreset('institutional').table);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.8 }));
      ground.position.y = -0.024; ground.receiveShadow = true;
      const key = new THREE.SpotLight('#ffbc80', 0.32, 2, 0.8, 0.7, 1.5);
      key.position.set(-0.2, 0.45, 0.18); key.target.position.set(0.05, 0, 0); key.castShadow = true;
      scene.add(ground, key, key.target, new THREE.HemisphereLight('#a8b8a8', '#20160e', 0.12));
      scene.environment = this.world.scene.environment;
      const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 5);
      camera.position.set(-0.07, 0.2, 0.15);
      camera.lookAt(0.035, -0.005, 0.0);
      this.studio = { scene, camera };
    }
    const studio = this.studio;
    const url = await this.world.thumbnail(() => {
      const hand = new HandModel('right', c);
      hand.applyPose(POSES.rest);
      hand.rotation.y = 0.25;
      studio.scene.add(hand);
      return { scene: studio.scene, camera: studio.camera, cleanup: () => studio.scene.remove(hand) };
    }, 200, 200);
    this.thumbCache.set(key, url);
    return url;
  }

  private async envThumbnail(id: EnvId): Promise<string> {
    const key = 'env:' + id;
    const hit = this.thumbCache.get(key) ?? sessionStorage.getItem('hc.thumb.' + id);
    if (hit) return hit;
    const prevScale = getTexScale();
    setTexScale(0.3);
    const preset = this.envPreset(id);
    await preload(() => buildEnvironment(preset, { simplified: false, reducedHorror: this.settings.reducedHorror, dust: false }));
    const env = buildEnvironment(preset, { simplified: false, reducedHorror: this.settings.reducedHorror, dust: false });
    setTexScale(prevScale);
    const url = await this.world.thumbnail(() => {
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(preset.fog, preset.fogDensity * 0.45);
      scene.background = new THREE.Color(preset.fog);
      scene.environment = this.world.scene.environment;
      const board = this.world.board, opp = this.opp;
      const bParent = board.parent!, oParent = opp.parent!;
      scene.add(env.group, board, opp);
      const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.02, 30);
      cam.position.set(0.55, TABLE_TOP + 0.75, 1.45);
      cam.lookAt(-0.15, TABLE_TOP + 0.3, -0.9);
      return { scene, camera: cam, cleanup: () => { bParent.add(board); oParent.add(opp); } };
    }, 320, 180);
    this.thumbCache.set(key, url);
    try { sessionStorage.setItem('hc.thumb.' + id, url); } catch { /* full */ }
    return url;
  }

  private async setEnvironment(id: EnvId) {
    this.envPicker.setCurrent(id);
    this.envPicker.setStatus('Preparing the room…');
    await preload(() => buildEnvironment(this.envPreset(id), this.envOpts()));
    this.settings.environment = id;
    saveSettings(this.settings);
    this.world.setEnvironment(id);
    this.envPicker.setStatus('');
  }

  private async onSettings(s: Settings, key: keyof Settings) {
    saveSettings(s);
    switch (key) {
      case 'sfxVolume': case 'ambienceVolume': case 'musicVolume':
        this.audio.setVolumes(s.sfxVolume, s.ambienceVolume, s.musicVolume); break;
      case 'reducedMotion': case 'reducedCamera': case 'largerBoard':
        this.applyMotion(); break;
      case 'highContrastPieces':
        await preload(() => { new Board({ highContrast: s.highContrastPieces, blood: s.reducedHorror ? 0 : 1 }); makePieceMaterials(s.highContrastPieces); });
        this.world.rebuildBoard(); this.world.rebuildPieceMaterials(); break;
      case 'reducedHorror': case 'simplifiedEnvironment':
        this.audio.reducedHorror = s.reducedHorror;
        await preload(() => buildEnvironment(this.envPreset(s.environment), this.envOpts()));
        this.world.setEnvironment(s.environment); break;
      case 'quality': case 'depthOfField':
        this.world.makePost(s.quality);
        if (key === 'quality') this.hud.toast('Texture detail changes on next launch.');
        break;
      case 'animationMode':
        if (this.presenter.session instanceof LocalSession) this.presenter.session.pondering = s.animationMode === 'competitive' ? 0.3 : 1;
        break;
      default: break;
    }
  }

  /** Hooks for the headless screenshot tool (tools/screenshots.mjs). */
  private installDebug() {
    (window as unknown as Record<string, unknown>).__HC_INFO = () => {
      const s = this.presenter.session;
      return { screen: this.screen, kind: s?.kind ?? null, color: s?.color ?? null, id: s?.state.id ?? null, fen: s?.state.fen ?? null, moves: s?.state.history.map((m) => m.san) ?? [], status: s?.state.status ?? null, lobbyMsg: document.querySelector('.lobby .msg')?.textContent ?? '' };
    };
    (window as unknown as Record<string, unknown>).__HC_DEBUG = async (cmd: string) => {
      const [c, a, b] = cmd.split(' ');
      const s = this.presenter.session;
      switch (c) {
        case 'play': this.play('ai', a ?? '5+0', { aiLevel: (b as AiLevel) ?? 'patient', color: 'w' }); break;
        case 'fen': this.startLocal('w', '5+0', 'patient', cmd.slice(4)); break;
        case 'online': this.play(a as PlayMode, b ?? '5+0', { aiLevel: 'patient', color: 'w', joinCode: cmd.split(' ')[3] }); break;
        case 'move': s?.submitMove(a, b); break;
        case 'screen': this.go(a as Screen); break;
        case 'settings': this.settingsPanel.show(a !== 'off'); break;
        case 'env': await this.setEnvironment(a as EnvId); break;
        case 'resign': s?.resign(); break;
        case 'set': (this.settings as unknown as Record<string, unknown>)[a] = b === 'true' ? true : b === 'false' ? false : b; await this.onSettings(this.settings, a as keyof Settings); break;
      }
    };
  }
}
