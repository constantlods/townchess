import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { ClientMessage, ServerMessageSchema, aiLevelsOffered, moveBudgetMs, LEAGUE_LEVELS, AI_LEVEL_IDS, type ServerMessage } from '@hc/shared';
import { UciEngine, UciError, UciLeague, discoverUciEngine, leagueOptions, type UciCommand } from '../src/uciEngine';
import { Hub } from '../src/hub';
import { PlayerStore } from '../src/players';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-uci.mjs');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-uci-'));
/** Fake engine command; `log` receives every UCI command the engine reads. */
function fake(mode: string, dir = tmp()): UciCommand & { log: string; state: string } {
  const state = path.join(dir, 'state'), log = path.join(dir, 'log');
  return { path: process.execPath, args: [FAKE, mode, state, log], log, state };
}
const readLog = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : []);
const quiet = () => {};

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

describe('UCI engine adapter (fake engine)', () => {
  it('handshake reports the engine id; a bounded search returns its bestmove', async () => {
    const e = new UciEngine(fake('legal'));
    cleanups.push(() => e.quit());
    const id = await e.start();
    expect(id).toMatchObject({ name: 'FakeUCI 1.0', version: '1.0', author: 'TownChess tests' });
    expect(e.alive).toBe(true);
    expect(await e.bestMove(START, { movetimeMs: 50 })).toBe('a2a3');
    expect(await e.bestMove(START, { movetimeMs: 50 }, ['e2e4'])).toBe('a7a5');
  });

  it('sends only changed options, then isready; ucinewgame between games', async () => {
    const cmd = fake('legal');
    const e = new UciEngine(cmd);
    cleanups.push(() => e.quit());
    await e.start();
    await e.setOptions({ UCI_LimitStrength: true, UCI_Elo: 1600 });
    await e.setOptions({ UCI_LimitStrength: true, UCI_Elo: 1600 });
    await e.setOptions({ UCI_LimitStrength: true, UCI_Elo: 1900 });
    await e.newGame();
    expect(readLog(cmd.log)).toEqual(['uci', 'isready', 'setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1600', 'isready',
      'setoption name UCI_Elo value 1900', 'isready', 'ucinewgame', 'isready']);
  });

  it('refuses an unbounded search and returns null for bestmove (none)', async () => {
    const e = new UciEngine(fake('legal'));
    cleanups.push(() => e.quit());
    await e.start();
    await expect(e.bestMove(START, {})).rejects.toThrow(/unbounded/);
    expect(await e.bestMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', { movetimeMs: 20 })).toBeNull(); // stalemate
  });

  it('a crash during a search rejects with UciError(crashed) and leaves the instance dead', async () => {
    const e = new UciEngine(fake('crash-once'));
    await e.start();
    const err = await e.bestMove(START, { movetimeMs: 50 }).catch((x) => x);
    expect(err).toBeInstanceOf(UciError);
    expect(err.kind).toBe('crashed');
    expect(e.alive).toBe(false);
    await expect(e.bestMove(START, { movetimeMs: 50 })).rejects.toThrow(/not running/);
  });

  it('a process that dies before uciok fails start()', async () => {
    const e = new UciEngine(fake('no-start'), { handshakeTimeoutMs: 2000 });
    await expect(e.start()).rejects.toBeInstanceOf(UciError);
    expect(e.alive).toBe(false);
  });

  it('timeout: stop is sent; an engine that still does not answer is killed', async () => {
    const cmd = fake('hang');
    const e = new UciEngine(cmd, { searchGraceMs: 100, stopGraceMs: 150 });
    await e.start();
    const t0 = Date.now();
    const err = await e.bestMove(START, { movetimeMs: 50 }).catch((x) => x);
    expect(err).toBeInstanceOf(UciError);
    expect(err.kind).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(e.alive).toBe(false);
    expect(readLog(cmd.log)).toContain('stop');
  });

  it('timeout: an engine that answers stop still delivers its move', async () => {
    const e = new UciEngine(fake('stop-only'), { searchGraceMs: 50, stopGraceMs: 500 });
    cleanups.push(() => e.quit());
    await e.start();
    expect(await e.bestMove(START, { movetimeMs: 20 })).toBe('a2a3');
    expect(e.alive).toBe(true);
  });

  it('quit ends the process', async () => {
    const e = new UciEngine(fake('legal'));
    await e.start();
    const pid = e.pid!;
    await e.quit();
    expect(e.alive).toBe(false);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe('UCI league pool', () => {
  it('maps levels to UCI_LimitStrength / UCI_Elo; sfmax is full strength', () => {
    expect(leagueOptions('sf1600')).toEqual({ UCI_LimitStrength: true, UCI_Elo: 1600 });
    expect(leagueOptions('sfmax')).toEqual({ UCI_LimitStrength: false });
  });

  it('restarts a crashed engine and retries the request once', async () => {
    const cmd = fake('crash-once');
    const lg = new UciLeague(cmd, { log: quiet });
    cleanups.push(() => lg.close());
    expect(await lg.bestMove('R1', 'sf1350', START, 50)).toBe('a2a3');
    expect(lg.restarts).toBe(1);
    expect(lg.processes).toBe(1);
    expect(readLog(cmd.log).filter((l) => l === 'uci')).toHaveLength(2);
  });

  it('a finished game hands its process back; the next game gets ucinewgame on the same process', async () => {
    const cmd = fake('legal');
    const lg = new UciLeague(cmd, { log: quiet });
    cleanups.push(() => lg.close());
    await lg.bestMove('R1', 'sf1600', START, 20);
    const pid = lg.engineOf('R1')!.pid;
    lg.release('R1');
    expect(lg.engineOf('R1')).toBeNull();
    await lg.bestMove('R2', 'sfmax', START, 20);
    expect(lg.engineOf('R2')!.pid).toBe(pid);
    const log = readLog(cmd.log);
    expect(log.filter((l) => l === 'ucinewgame')).toHaveLength(2);
    expect(log).toContain('setoption name UCI_Elo value 1600');
    expect(log).toContain('setoption name UCI_LimitStrength value false');
    expect(log).toContain('setoption name Threads value 1');
  });

  // BUG-007 (docs/KNOWN_LIMITATIONS.md): the crash-retry path re-acquires an engine for a room that was released while
  // the request was in flight (game over by resign/flag/abort during the engine's think). The fresh process stays bound
  // to the finished room forever; four such leaks fill maxEngines and every league move silently falls back to the house engine.
  it('BUG-007: a game released mid-request is not re-bound by the crash retry (no leaked process)', async () => {
    const lg = new UciLeague(fake('crash-once'), { log: quiet });
    cleanups.push(() => lg.close());
    const pending = lg.bestMove('R1', 'sf1350', START, 50); // binds R1 synchronously, then the first `go` crashes
    lg.release('R1');                                        // the game ends while the engine is starting / thinking
    await pending;
    expect(lg.engineOf('R1')).toBeNull();                    // nothing stays bound to the finished game
    expect(lg.processes).toBeLessThanOrEqual(1);             // at most one healthy process, back in the idle pool
    // the slot is reusable: the next game gets an engine and processes do not pile up (the leak filled maxEngines)
    await lg.bestMove('R2', 'sf1350', START, 50);
    expect(lg.engineOf('R1')).toBeNull();
    expect(lg.processes).toBeLessThanOrEqual(1);
  });

  it('BUG-007 control: release without a crash leaves no binding and at most one idle process', async () => {
    const lg = new UciLeague(fake('legal'), { log: quiet });
    cleanups.push(() => lg.close());
    const pending = lg.bestMove('R1', 'sf1350', START, 50);
    lg.release('R1');
    await pending;
    expect(lg.engineOf('R1')).toBeNull();
    expect(lg.processes).toBeLessThanOrEqual(1);
  });

  it('caps the number of processes; a game over the cap gets null (caller falls back)', async () => {
    const lg = new UciLeague(fake('legal'), { maxEngines: 1, log: quiet });
    cleanups.push(() => lg.close());
    expect(await lg.bestMove('R1', 'sf1350', START, 20)).toBe('a2a3');
    expect(await lg.bestMove('R2', 'sf1350', START, 20)).toBeNull();
  });

  it('an engine that never starts disables the league after repeated failures; nothing throws', async () => {
    const lg = new UciLeague(fake('no-start'), { maxStartFailures: 2, log: quiet });
    expect(lg.available).toBe(true);
    expect(await lg.bestMove('R1', 'sf1350', START, 20)).toBeNull();
    expect(await lg.bestMove('R1', 'sf1350', START, 20)).toBeNull();
    expect(lg.available).toBe(false);
    expect(await lg.bestMove('R1', 'sf1350', START, 20)).toBeNull();
    expect(new UciLeague(null).available).toBe(false);
  });
});

describe('engine discovery', () => {
  const exe = (f: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '#!/bin/sh\n'); fs.chmodSync(f, 0o755); return f; };

  it('TC_STOCKFISH first, then <data>/engines, then engines/ next to the core', () => {
    const d = tmp();
    const envBin = exe(path.join(d, 'custom/sf'));
    const dataBin = exe(path.join(d, 'data/engines/stockfish'));
    const coreBin = exe(path.join(d, 'core/engines/stockfish'));
    const o = { dataDir: path.join(d, 'data'), coreDir: path.join(d, 'core'), platform: 'linux' as const };
    expect(discoverUciEngine({ ...o, env: { TC_STOCKFISH: envBin } })?.path).toBe(envBin);
    expect(discoverUciEngine({ ...o, env: {} })?.path).toBe(dataBin);
    expect(discoverUciEngine({ ...o, dataDir: null, env: {} })?.path).toBe(coreBin);
  });

  it('a missing TC_STOCKFISH falls through; upstream file names are accepted; licence files are not engines', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'core/engines'), { recursive: true });
    fs.writeFileSync(path.join(d, 'core/engines/stockfish-Copying.txt'), 'GPL');
    const bin = exe(path.join(d, 'core/engines/stockfish-linux-x86-64-avx2'));
    const env = { TC_STOCKFISH: path.join(d, 'nope') };
    const err = console.error; console.error = quiet;
    try { expect(discoverUciEngine({ env, coreDir: path.join(d, 'core'), platform: 'linux' })?.path).toBe(bin); } finally { console.error = err; }
  });

  it('nothing found (or not executable) = null', () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'engines'));
    fs.writeFileSync(path.join(d, 'engines/stockfish'), 'not executable');
    expect(discoverUciEngine({ env: {}, dataDir: d, coreDir: path.join(d, 'missing'), platform: 'linux' })).toBeNull();
    expect(discoverUciEngine({ env: {} })).toBeNull();
  });
});

describe('league levels in the protocol', () => {
  it('CREATE_AI_GAME accepts every house and league level, nothing else', () => {
    for (const level of AI_LEVEL_IDS) expect(ClientMessage.safeParse({ type: 'CREATE_AI_GAME', level, color: 'w', timeControl: '5+0' }).success).toBe(true);
    expect(AI_LEVEL_IDS).toEqual(['novice', 'patient', 'warden', 'sf1350', 'sf1600', 'sf1900', 'sf2200', 'sf2500', 'sfmax']);
    expect(ClientMessage.safeParse({ type: 'CREATE_AI_GAME', level: 'sf3000', color: 'w', timeControl: '5+0' }).success).toBe(false);
  });

  it('offered levels: house only without an engine; league labels carry the UCI_Elo setting', () => {
    expect(aiLevelsOffered(false).map((l) => l.id)).toEqual(['novice', 'patient', 'warden']);
    const all = aiLevelsOffered(true);
    expect(all).toHaveLength(9);
    expect(all.find((l) => l.id === 'sf1600')).toEqual({ id: 'sf1600', label: 'Stockfish (UCI_Elo 1600)', engine: 'uci', uciElo: 1600 });
    expect(all.filter((l) => l.engine === 'house').every((l) => l.uciElo === null)).toBe(true);
  });

  it('move budget: level cap untimed; a fraction of the clock plus increment when timed; never below 50 ms', () => {
    expect(moveBudgetMs(1000, null)).toBe(1000);
    expect(moveBudgetMs(1000, 300_000)).toBe(1000);
    expect(moveBudgetMs(1000, 9_000)).toBe(300);
    expect(moveBudgetMs(1000, 9_000, 2_000)).toBe(1000);
    expect(moveBudgetMs(1000, 3_100, 0, 100)).toBe(100);
    expect(moveBudgetMs(1000, 500, 0, 100)).toBe(50);
    for (const l of Object.values(LEAGUE_LEVELS)) expect(l.movetimeMs).toBeLessThanOrEqual(2000);
  });
});

// ── through a real room ──
class Client {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      const v = ServerMessageSchema.safeParse(m);
      if (!v.success) throw new Error(`schema violation in ${m.type}`);
      this.inbox.push(m);
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  async next<T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 8000) {
    const t0 = Date.now();
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && pred(m as never));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + type);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

async function startHub(uciEngine: UciCommand | null, league = {}) {
  const server = http.createServer();
  const hub = new Hub(server, new PlayerStore(null), '/ws', { uciEngine, league: { log: quiet, ...league } });
  hub.aiMinThinkMs = 0;
  await new Promise<void>((r) => server.listen(0, r));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  const c = new Client(url);
  await c.open();
  cleanups.push(() => { c.ws.close(); hub.close(); server.close(); });
  c.send({ type: 'HELLO', username: 'LEAGUE' });
  const welcome = await c.next('WELCOME');
  return { hub, c, welcome };
}

/** Human (white) plays e2e4; returns black's reply as UCI. */
async function humanE4(c: Client, level: string, timeControl = 'untimed') {
  c.send({ type: 'CREATE_AI_GAME', level, color: 'w', timeControl });
  const j = await c.next('GAME_JOINED');
  c.send({ type: 'MOVE', gameId: j.state.id, seq: 1, from: 'e2', to: 'e4', ply: 0 });
  const u = await c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 2);
  const r = u.state.moveHistory[1];
  return { gameId: j.state.id, reply: r.from + r.to + (r.promotion ?? '') };
}

describe('league levels through a room (fake engine)', () => {
  it('WELCOME lists league levels only when an engine is present; an unavailable level is refused', async () => {
    const withEngine = await startHub(fake('legal'));
    expect(withEngine.welcome.aiLevels?.map((l) => l.id)).toEqual([...AI_LEVEL_IDS]);
    const without = await startHub(null);
    expect(without.welcome.aiLevels?.map((l) => l.id)).toEqual(['novice', 'patient', 'warden']);
    without.c.send({ type: 'CREATE_AI_GAME', level: 'sf1600', color: 'w', timeControl: 'untimed' });
    expect((await without.c.next('ERROR')).code).toBe('engine_unavailable');
  });

  it('the engine move is applied through GameCore at the requested UCI_Elo, with ucinewgame first', async () => {
    const cmd = fake('legal');
    const { c, hub } = await startHub(cmd);
    const { reply } = await humanE4(c, 'sf1600', '5+0');
    expect(hub.leagueFallbacks).toBe(0);
    expect(reply).toBe('a7a5'); // the fake engine's choice: first legal move in sorted UCI order
    const log = readLog(cmd.log);
    expect(log).toContain('setoption name UCI_Elo value 1600');
    expect(log).toContain(`position fen ${START} moves e2e4`); // full game history: the engine sees repetitions
    expect(log.indexOf('ucinewgame')).toBeLessThan(log.findIndex((l) => l.startsWith('go ')));
    const movetime = Number(log.find((l) => l.startsWith('go movetime'))!.split(' ')[2]);
    expect(movetime).toBeLessThanOrEqual(LEAGUE_LEVELS.sf1600.movetimeMs);
  });

  it('an illegal engine move is rejected by GameCore and the house engine moves instead', async () => {
    const { c, hub } = await startHub(fake('illegal'));
    const { reply } = await humanE4(c, 'sf2200');
    expect(hub.leagueFallbacks).toBe(1);
    expect(reply).not.toBe('e7e4');
    expect(reply).toMatch(/^[a-h][1-8][a-h][1-8]$/);
  });

  it('an engine crash mid-game is survived: the process is restarted and the game continues', async () => {
    const { c, hub } = await startHub(fake('crash-once'));
    const { reply } = await humanE4(c, 'sf1900');
    expect(reply).toBe('a7a5');
    expect(hub.league.restarts).toBe(1);
  });

  it('a hung engine times out and is killed; the house engine moves instead', async () => {
    const { c, hub } = await startHub(fake('hang'), { searchGraceMs: 100, stopGraceMs: 100 });
    const { reply } = await humanE4(c, 'sf2500');
    expect(reply).toMatch(/^[a-h][1-8][a-h][1-8]$/);
    expect(hub.league.processes).toBe(0);
  });

  it('the engine is never asked to move in a finished game, and its process is released', async () => {
    const { c, hub } = await startHub(fake('legal'));
    const { gameId } = await humanE4(c, 'sfmax');
    const room = hub.rooms.get(gameId)!;
    expect(hub.league.engineOf(gameId)).not.toBeNull();
    c.send({ type: 'RESIGN', gameId });
    await c.next('GAME_STATE_UPDATED', (m) => m.state.status === 'resigned');
    expect(hub.league.engineOf(gameId)).toBeNull();
    let asked = 0;
    const orig = hub.league.bestMove.bind(hub.league);
    hub.league.bestMove = (...a) => { asked++; return orig(...a); };
    hub.aiToMove(room);
    expect(asked).toBe(0);
  });
});

// Real engine: runs only when TC_STOCKFISH points at an executable (e.g. a Stockfish 19 release binary).
const REAL = process.env.TC_STOCKFISH && discoverUciEngine({ env: process.env, dataDir: null, coreDir: null });
describe.skipIf(!REAL)('league levels with a real Stockfish (TC_STOCKFISH)', () => {
  it('plays several moves at UCI_Elo 1350 through a real room, every one accepted by GameCore', async () => {
    const { c, hub } = await startHub(REAL as UciCommand);
    c.send({ type: 'CREATE_AI_GAME', level: 'sf1350', color: 'w', timeControl: '3+2' });
    const j = await c.next('GAME_JOINED');
    let state = j.state;
    for (let ply = 0; ply < 8; ply += 2) {
      const mv = state.legalMoves[0];
      c.send({ type: 'MOVE', gameId: state.id, seq: ply, from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4], ply });
      state = (await c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === ply + 2 || m.state.status !== 'active', 15_000)).state;
      if (state.status !== 'active') break;
    }
    expect(state.moveHistory.length).toBeGreaterThanOrEqual(8);
    expect(hub.league.engineId?.name).toMatch(/^Stockfish/);
    expect([hub.leagueFallbacks, hub.league.restarts]).toEqual([0, 0]); // every reply came from Stockfish itself
  }, 60_000);
});
