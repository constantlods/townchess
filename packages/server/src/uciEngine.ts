/**
 * UCI engine adapter for the core (Node only; nothing in the browser bundle imports this file).
 *
 * LICENSING: Stockfish is GPL-3.0. It runs here strictly as a separate OS process spoken to over the public UCI text
 * protocol on stdin/stdout (child_process.spawn). It is never linked, bundled into JavaScript or compiled into the
 * core, the server bundle or the UE5 binary. Shipping the binary next to the packaged core means shipping its licence
 * (Copying.txt) and a SOURCE.txt naming the exact upstream release (docs/AI.md "Stockfish league levels").
 *
 * Legality: the engine only proposes a move. The hub submits it through GameRoom -> GameCore like any human move, and
 * an illegal proposal is rejected there (then the house engine moves instead and the incident is logged).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUE_LEVELS, type LeagueLevelId } from '@hc/shared';
import { parseBestMove, parseIdLine, type EngineId } from '@hc/learning';

/** How to start an engine process. */
export interface UciCommand { path: string; args?: string[] }

export class UciError extends Error {
  constructor(readonly kind: 'timeout' | 'crashed' | 'not_started', message: string) { super(message); }
}

export interface UciEngineOptions {
  /** Max time for `uci`->`uciok` and `isready`->`readyok`. */
  handshakeTimeoutMs?: number;
  /** Extra time past the requested movetime before `stop` is sent. */
  searchGraceMs?: number;
  /** After `stop`, how long to wait for `bestmove` before the process is killed. */
  stopGraceMs?: number;
}

type Waiter = { test: (line: string) => boolean; lines: string[]; resolve: (lines: string[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout | null };

/**
 * One engine process. Commands are serialised (one outstanding request at a time). Any crash or timeout leaves the
 * instance dead (`alive === false`); the owner starts a fresh one.
 */
export class UciEngine {
  private p: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private waiter: Waiter | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private options = new Map<string, string>();
  alive = false;
  id: EngineId = { name: 'unknown', version: 'unknown' };
  /** Raw stderr tail, for diagnostics in logs. */
  stderrTail = '';
  readonly handshakeTimeoutMs: number;
  readonly searchGraceMs: number;
  readonly stopGraceMs: number;

  constructor(readonly cmd: UciCommand, o: UciEngineOptions = {}) {
    this.handshakeTimeoutMs = o.handshakeTimeoutMs ?? 10_000;
    this.searchGraceMs = o.searchGraceMs ?? 1500;
    this.stopGraceMs = o.stopGraceMs ?? 500;
  }

  /** Spawn the process and complete the uci / isready handshake. Rejects (and kills the process) on failure. */
  start(): Promise<EngineId> {
    return this.serial(async () => {
      if (this.p) throw new Error('already started');
      const p = spawn(this.cmd.path, this.cmd.args ?? [], { stdio: 'pipe', windowsHide: true });
      this.p = p;
      this.alive = true;
      p.stdout.setEncoding('utf8');
      p.stderr.setEncoding('utf8');
      p.stdout.on('data', (d: string) => this.onData(d));
      p.stderr.on('data', (d: string) => { this.stderrTail = (this.stderrTail + d).slice(-500); });
      p.stdin.on('error', () => { /* EPIPE after a crash: reported through 'exit' */ });
      const died = (why: string) => {
        if (!this.alive) return;
        this.alive = false;
        const w = this.waiter;
        this.waiter = null;
        if (w) { if (w.timer) clearTimeout(w.timer); w.reject(new UciError('crashed', `engine process ${why}`)); }
      };
      p.on('error', (e) => died(`error: ${e.message}`));
      p.on('exit', (code, sig) => died(`exited (code ${code}, signal ${sig})`));
      try {
        const lines = await this.until((l) => l === 'uciok', 'uci', this.handshakeTimeoutMs);
        let id: Partial<EngineId> = {};
        for (const l of lines) { const x = parseIdLine(l); if (x) id = { ...id, ...x }; }
        this.id = { name: id.name ?? 'unknown', version: id.version ?? 'unknown', ...(id.author ? { author: id.author } : {}) };
        await this.until((l) => l === 'readyok', 'isready', this.handshakeTimeoutMs);
        return this.id;
      } catch (e) {
        this.kill();
        throw e;
      }
    });
  }

  /** Send only the options that changed since the last call, then wait for readyok. */
  setOptions(opts: Record<string, string | number | boolean>): Promise<void> {
    return this.serial(async () => {
      this.ensureAlive();
      let changed = false;
      for (const [k, v] of Object.entries(opts)) {
        if (this.options.get(k) === String(v)) continue;
        this.options.set(k, String(v));
        this.send(`setoption name ${k} value ${v}`);
        changed = true;
      }
      if (changed) await this.until((l) => l === 'readyok', 'isready', this.handshakeTimeoutMs);
    });
  }

  /** `ucinewgame` + `isready`: called before the first move of every game. */
  newGame(): Promise<void> {
    return this.serial(async () => {
      this.ensureAlive();
      this.send('ucinewgame');
      await this.until((l) => l === 'readyok', 'isready', this.handshakeTimeoutMs);
    });
  }

  /**
   * Best move (UCI long algebraic) for `fen` after `moves` (the game's start position plus its moves, so the engine
   * sees the repetition history), or null for `bestmove (none)` / an unparsable reply.
   * Bounded search only. Past movetime + searchGraceMs the engine is told to `stop`; if it still does not answer
   * within stopGraceMs the process is killed and a UciError('timeout') is thrown.
   */
  bestMove(fen: string, opts: { movetimeMs?: number; nodes?: number }, moves: readonly string[] = []): Promise<string | null> {
    return this.serial(async () => {
      this.ensureAlive();
      if (opts.movetimeMs === undefined && opts.nodes === undefined) throw new Error('unbounded search: give movetimeMs or nodes');
      this.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
      const go = opts.nodes !== undefined ? `go nodes ${opts.nodes}` : `go movetime ${Math.max(1, Math.round(opts.movetimeMs!))}`;
      const isBest = (l: string) => l.startsWith('bestmove');
      const budget = (opts.movetimeMs ?? 5000) + this.searchGraceMs;
      let lines: string[];
      try {
        lines = await this.until(isBest, go, budget);
      } catch (e) {
        if (!(e instanceof UciError) || e.kind !== 'timeout' || !this.alive) throw e;
        try {
          lines = await this.until(isBest, 'stop', this.stopGraceMs);
        } catch {
          this.kill();
          throw new UciError('timeout', `no bestmove ${budget + this.stopGraceMs} ms after go (stop ignored); process killed`);
        }
      }
      return parseBestMove(lines[lines.length - 1])?.move ?? null;
    });
  }

  /** Polite shutdown: `quit`, then kill if the process is still there after a moment. Idempotent. */
  quit(graceMs = 500): Promise<void> {
    const p = this.p;
    if (!p || !this.alive) { this.kill(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.kill(); resolve(); }, graceMs);
      t.unref?.();
      p.once('exit', () => { clearTimeout(t); this.alive = false; resolve(); });
      try { p.stdin.write('quit\n'); } catch { /* gone */ }
    });
  }

  kill() {
    this.alive = false;
    const w = this.waiter;
    this.waiter = null;
    if (w) { if (w.timer) clearTimeout(w.timer); w.reject(new UciError('crashed', 'engine process killed')); }
    try { this.p?.kill('SIGKILL'); } catch { /* gone */ }
  }

  get pid() { return this.p?.pid ?? null; }

  // ── internals ──
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private ensureAlive() {
    if (!this.p) throw new UciError('not_started', 'engine not started');
    if (!this.alive) throw new UciError('crashed', 'engine process is not running');
  }

  private send(cmd: string) { this.p!.stdin.write(cmd + '\n'); }

  private onData(d: string) {
    this.buf += d;
    if (this.buf.length > 1 << 20) this.buf = this.buf.slice(-4096); // a runaway engine must not eat memory
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      const w = this.waiter;
      if (!w) continue;
      if (w.lines.length < 2000) w.lines.push(line);
      if (w.test(line)) {
        this.waiter = null;
        if (w.timer) clearTimeout(w.timer);
        w.resolve(w.lines);
      }
    }
  }

  private until(test: (line: string) => boolean, cmd: string, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const w: Waiter = { test, lines: [], resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        if (this.waiter === w) this.waiter = null;
        reject(new UciError('timeout', `no reply to "${cmd}" within ${timeoutMs} ms`));
      }, timeoutMs);
      w.timer.unref?.();
      this.waiter = w;
      this.send(cmd);
    });
  }
}

/** UCI options for a league level. Single thread and a small hash: the core shares the machine with the game. */
export function leagueOptions(level: LeagueLevelId): Record<string, string | number | boolean> {
  const elo = LEAGUE_LEVELS[level].uciElo;
  return elo === null ? { UCI_LimitStrength: false } : { UCI_LimitStrength: true, UCI_Elo: elo };
}
const BASE_OPTIONS = { Threads: 1, Hash: 16 };

export interface LeagueOptions extends UciEngineOptions {
  /** Max engine processes alive at once (one per game in progress). */
  maxEngines?: number;
  /** Consecutive failed starts after which the league is marked unavailable for new games. */
  maxStartFailures?: number;
  log?: (msg: string) => void;
}

/**
 * The league: a small pool of UCI engine processes, one bound to each game in progress. A game gets an idle process
 * (after `ucinewgame`) or a new one; finished games hand theirs back. A crashed or hung process is discarded and a
 * fresh one started on the next request. Every failure resolves to null so the caller can fall back to the house
 * engine; nothing here throws into the hub.
 */
export class UciLeague {
  private byRoom = new Map<string, UciEngine>();
  private idle: UciEngine[] = [];
  private startFailures = 0;
  private closed = false;
  readonly maxEngines: number;
  private readonly maxStartFailures: number;
  private readonly log: (msg: string) => void;
  /** Identity reported by the last successful handshake. */
  engineId: EngineId | null = null;

  constructor(readonly cmd: UciCommand | null, private o: LeagueOptions = {}) {
    this.maxEngines = o.maxEngines ?? 4;
    this.maxStartFailures = o.maxStartFailures ?? 3;
    this.log = o.log ?? ((m) => console.error(`[uci] ${m}`));
  }

  /** League levels can be offered: an engine was found and it has not failed to start repeatedly. */
  get available() { return !!this.cmd && !this.closed && this.startFailures < this.maxStartFailures; }
  /** Engine processes currently alive (bound or idle). */
  get processes() { return [...this.byRoom.values(), ...this.idle].filter((e) => e.alive).length; }
  /** Process bound to a game, for diagnostics and tests. */
  engineOf(roomId: string) { return this.byRoom.get(roomId) ?? null; }

  /** Best move for `roomId`'s position (start FEN + moves) at `level`, or null on any failure (caller falls back). */
  async bestMove(roomId: string, level: LeagueLevelId, fen: string, movetimeMs: number, moves: readonly string[] = []): Promise<string | null> {
    // A crashed process is replaced and the request retried once; a timeout is not retried (the clock is running).
    // A game released while this request is in flight (resign/flag/abort during the think) is never re-bound (BUG-007).
    const gen = this.gens.get(roomId) ?? 0;
    const stale = () => (this.gens.get(roomId) ?? 0) !== gen;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!this.available || stale()) return null;
      let eng: UciEngine | null = null;
      try {
        eng = await this.acquire(roomId);
        if (!eng) { this.log(`no engine process free for ${roomId} (max ${this.maxEngines})`); return null; }
        if (stale()) { this.unbind(roomId, eng); return null; }
        await eng.setOptions({ ...BASE_OPTIONS, ...leagueOptions(level) });
        return await eng.bestMove(fen, { movetimeMs }, moves);
      } catch (e) {
        this.log(`${roomId}: ${(e as Error).message}${eng?.stderrTail ? ` | stderr: ${eng.stderrTail.trim().slice(-200)}` : ''}`);
        if (eng && !eng.alive && this.byRoom.get(roomId) === eng) this.byRoom.delete(roomId); // next request restarts
        this.restarts += eng && !eng.alive ? 1 : 0;
        if (!(e instanceof UciError) || e.kind !== 'crashed') return null;
      }
    }
    return null;
  }

  /** Engine processes lost (crash, hang) and replaced since start; for diagnostics and tests. */
  restarts = 0;

  /** The game is over: its process goes back to the idle list (it gets `ucinewgame` before its next game). */
  release(roomId: string) {
    this.gens.set(roomId, (this.gens.get(roomId) ?? 0) + 1); // in-flight requests for this game must not re-bind it
    const e = this.byRoom.get(roomId);
    if (e) this.unbind(roomId, e);
  }

  /** Per-game release counter: a request started before a release is stale (BUG-007). */
  private gens = new Map<string, number>();

  private unbind(roomId: string, e: UciEngine) {
    if (this.byRoom.get(roomId) === e) this.byRoom.delete(roomId);
    if (e.alive && !this.closed) { if (!this.idle.includes(e)) this.idle.push(e); } else void e.quit();
  }

  /** Quit every engine process (`quit`, then kill). Idempotent: later calls return the same promise. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const all = [...this.byRoom.values(), ...this.idle];
    this.byRoom.clear();
    this.idle = [];
    this.closing = Promise.all(all.map((e) => e.quit())).then(() => undefined);
    return this.closing;
  }
  private closing: Promise<void> | null = null;

  private async acquire(roomId: string): Promise<UciEngine | null> {
    const bound = this.byRoom.get(roomId);
    if (bound?.alive) return bound;
    if (bound) this.byRoom.delete(roomId);
    this.idle = this.idle.filter((e) => e.alive);
    let eng = this.idle.shift() ?? null;
    if (eng) {
      this.byRoom.set(roomId, eng);
      await eng.newGame();
      return eng;
    }
    if (this.processes >= this.maxEngines) return null;
    eng = new UciEngine(this.cmd!, this.o);
    this.byRoom.set(roomId, eng); // reserve the slot while starting
    try {
      this.engineId = await eng.start();
      this.startFailures = 0;
    } catch (e) {
      this.byRoom.delete(roomId);
      this.startFailures++;
      if (!this.available) this.log(`engine failed to start ${this.startFailures} times in a row; league levels disabled`);
      throw e;
    }
    await eng.newGame();
    return eng;
  }
}

/**
 * Find a UCI engine binary. Order:
 *   1. env TC_STOCKFISH (path to the binary);
 *   2. `<dataDir>/engines/` (the core's data directory);
 *   3. `<coreDir>/engines/` (next to the packaged townchess-core.mjs).
 * In an engines directory the canonical name is `stockfish` (`stockfish.exe` on Windows); otherwise the first file
 * whose name starts with "stockfish" and is executable (e.g. the upstream `stockfish-windows-x86-64-avx2.exe`).
 * Returns null when nothing usable exists; league levels are then not offered.
 */
export function discoverUciEngine(o: { env?: NodeJS.ProcessEnv; dataDir?: string | null; coreDir?: string | null; platform?: NodeJS.Platform } = {}): UciCommand | null {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const usable = (f: string) => {
    try {
      if (!fs.statSync(f).isFile()) return false;
      if (platform !== 'win32') fs.accessSync(f, fs.constants.X_OK);
      return true;
    } catch { return false; }
  };
  const fromEnv = env.TC_STOCKFISH?.trim();
  if (fromEnv) {
    if (usable(fromEnv)) return { path: path.resolve(fromEnv) };
    console.error(`[uci] TC_STOCKFISH=${fromEnv} is not an executable file; looking in the engines directories`);
  }
  const canonical = platform === 'win32' ? 'stockfish.exe' : 'stockfish';
  for (const base of [o.dataDir, o.coreDir]) {
    if (!base) continue;
    const dir = path.join(base, 'engines');
    if (usable(path.join(dir, canonical))) return { path: path.join(dir, canonical) };
    let names: string[] = [];
    try { names = fs.readdirSync(dir).sort(); } catch { continue; }
    const pick = names.find((n) => /^stockfish/i.test(n) && !/\.(txt|md|nnue|zip|tar|gz)$/i.test(n) && (platform !== 'win32' || /\.exe$/i.test(n)) && usable(path.join(dir, n)));
    if (pick) return { path: path.join(dir, pick) };
  }
  return null;
}
