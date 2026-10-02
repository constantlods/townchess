import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import { ChessRules } from '@hc/shared';
import { World } from './scene/world';
import { loadSettings } from './settings';
import { PlayerArms, animateMove } from './scene/choreo';
import { Opponent } from './scene/opponent';
import { preload } from './render/assets';
import { setTexScale } from './render/textures';
import { Board } from './scene/board';
import { makePieceMaterials, pieceGeometry } from './scene/pieces';
import { buildEnvironment, ENVIRONMENTS } from './scene/environment';
import { HandModel } from './scene/hands';

const settings = loadSettings();
const q = new URLSearchParams(location.search);
if (q.get('quality')) settings.quality = q.get('quality') as never;
if (q.get('env')) settings.environment = q.get('env') as never;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
document.body.style.margin = '0';
document.body.style.background = '#000';
document.body.style.overflow = 'hidden';
setTexScale(settings.quality === 'low' ? 0.5 : settings.quality === 'medium' ? 0.75 : 1);
const tp = performance.now();
await preload(() => {
  new Board({ highContrast: settings.highContrastPieces, blood: 1 });
  makePieceMaterials(settings.highContrastPieces);
  for (const t of ['p', 'n', 'b', 'r', 'q', 'k'] as const) pieceGeometry(t);
  buildEnvironment(ENVIRONMENTS.find((e) => e.id === settings.environment)!, { simplified: false, reducedHorror: false, dust: true });
  new HandModel('left', settings.cosmetics); new HandModel('right', settings.cosmetics);
  new Opponent({ reducedHorror: settings.reducedHorror });
}, (d, t) => console.log(`assets ${d}/${t}`));
console.log(`preload ${(performance.now() - tp).toFixed(0)}ms`);
const t0 = performance.now();
const world = new World(canvas, settings);
const cam = q.get('cam');
if (cam) {
  const [h, back, pitch, fov] = cam.split(',').map(Number);
  world.rig.override = { h, back, pitch, fov };
  world.rig.compose(innerWidth / innerHeight);
}
if (q.get('frames')) { world.maxFrames = Number(q.get('frames')); world.fixedDt = Number(q.get('dt') ?? 0.033); }
const rules = new ChessRules();
world.setPosition(rules.pieces());
const t1 = performance.now();
const arms = new PlayerArms(world, settings.cosmetics);
const t2 = performance.now();
const opp = new Opponent({ reducedHorror: settings.reducedHorror });
world.scene.add(opp);
const t3 = performance.now();
console.log(`build: world ${(t1 - t0).toFixed(0)}ms arms ${(t2 - t1).toFixed(0)}ms opponent ${(t3 - t2).toFixed(0)}ms`);
world.updatables.add({ update: (t, dt) => { arms.update(t, dt, 1); opp.update(t, dt, 1); } });
(window as any).__HC_DEBUG = async (cmd: string) => {
  const [c, a, b] = cmd.split(' ');
  if (c === 'move') {
    const rec = rules.tryMove({ from: a, to: b });
    if (rec) await animateMove(world, arms, { from: a, to: b, color: rec.color, capturedSquare: rec.captured ? b : undefined }, 1);
  }
  if (c === 'opp') {
    const rec = rules.tryMove({ from: a, to: b });
    if (rec) await animateMove(world, opp, { from: a, to: b, color: rec.color, capturedSquare: rec.captured ? b : undefined }, 1);
  }
  if (c === 'mode') opp.setMode(a as never, 0.01);
};
let frames = 0;
world.start(() => {
  frames++;
  if (frames === 3) (window as any).__HC_READY = true;
  (window as any).__HC_STATS = { fps: world.fps.toFixed(1), calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles };
});
