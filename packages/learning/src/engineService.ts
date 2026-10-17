import { ChessRules } from '@hc/shared';

/**
 * Engine service interface (Milestone 2: interface and parsing helpers only).
 *
 * Principle: engines calculate, agents explain. An EngineService returns numbers and principal variations; it never
 * decides legality (that is @hc/shared) and never writes prose (that is the agent/commentary layer).
 *
 * LICENSING: the real adapter (Milestone 5) will drive Stockfish, which is GPL-3.0. It MUST run as a separate OS
 * process spoken to over UCI on stdin/stdout (for example `child_process.spawn('stockfish')`). It must never be
 * linked, bundled or compiled into this package, the core, the server bundle or the UE5 binary. Shipping the binary
 * (server image, Windows build) means shipping its licence and offering the corresponding source, including the
 * NNUE network files. This file contains no engine code, only types and pure parsers of the public UCI text
 * protocol, so it carries no GPL obligation.
 */

/** Identity of the engine that produced an analysis. Stored with every evaluation so results stay reproducible. */
export interface EngineId {
  /** From `id name`, e.g. "Stockfish 17". */
  name: string;
  /** Version string parsed from the name, or "unknown". */
  version: string;
  /** From `id author`. */
  author?: string;
  /** Neural network file, from `info string NNUE evaluation using <file>`, when reported. */
  network?: string;
}

/**
 * A score. `cp` in centipawns. `mate` in moves (not plies): positive = the side to move (or White, for a
 * White-POV score) mates in N; negative = gets mated in N. `mate 0` means the side to move is already checkmated.
 */
export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; value: number };

/** UCI bound flag: a score from a fail-high/fail-low line is only a bound. */
export type ScoreBound = 'exact' | 'lower' | 'upper';

export interface PvLine {
  /** 1-based MultiPV index (1 = best line). */
  multipv: number;
  depth: number;
  seldepth: number | null;
  /** Score from the point of view of the side to move (raw UCI semantics). */
  scoreStm: Score;
  /** The same score from White's point of view (what storage, graphs and the analysis cart use). */
  scoreWhite: Score;
  bound: ScoreBound;
  /** Win/draw/loss per mille from the side to move, when the engine reports it (UCI_ShowWDL). */
  wdlStm: [win: number, draw: number, loss: number] | null;
  /** Principal variation in UCI long algebraic notation (e2e4, e7e8q, e1g1 for castling). */
  pv: string[];
  nodes: number | null;
  timeMs: number | null;
}

export interface EngineAnalysis {
  fen: string;
  engine: EngineId;
  /** Depth of the best line (lines[0]). */
  depth: number;
  nodes: number | null;
  timeMs: number | null;
  /** One entry per MultiPV line, sorted by `multipv`. Empty for a position with no legal moves. */
  lines: PvLine[];
  /** From `bestmove`; null for `bestmove (none)` (checkmate or stalemate). */
  bestMove: string | null;
  ponder: string | null;
}

export interface AnalyseOptions {
  /** Search depth in plies. */
  depth?: number;
  movetimeMs?: number;
  /** Hard node budget: the reproducible mode, independent of machine load. */
  nodes?: number;
  /** Number of principal variations (default 1). */
  multiPv?: number;
}

export interface BestMoveResult {
  move: string | null;
  ponder: string | null;
  analysis: EngineAnalysis;
}

/**
 * The engine service. Implementations: Milestone 5 `StockfishProcessService` (separate process, see the licensing
 * note above); tests use fakes that replay recorded UCI output through `collectAnalysis`.
 * At least one of depth / movetimeMs / nodes must be given; an implementation must reject unbounded searches.
 */
export interface EngineService {
  readonly id: EngineId;
  analyse(fen: string, opts: AnalyseOptions): Promise<EngineAnalysis>;
  bestMove(fen: string, opts: AnalyseOptions): Promise<BestMoveResult>;
  /** Stop any search and terminate the engine process. Idempotent. */
  close(): Promise<void>;
}

/** Parsed `info` line. Fields the line does not carry are absent. */
export interface UciInfo {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  score?: Score;
  bound?: ScoreBound;
  wdl?: [number, number, number];
  nodes?: number;
  nps?: number;
  hashfull?: number;
  tbhits?: number;
  timeMs?: number;
  pv?: string[];
  currmove?: string;
  currmovenumber?: number;
  /** `info string ...`: free text, everything after "string". */
  string?: string;
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
export const isUciMove = (s: string) => UCI_MOVE.test(s);

const INT_FIELDS: Record<string, keyof UciInfo> = {
  depth: 'depth', seldepth: 'seldepth', multipv: 'multipv', nodes: 'nodes', nps: 'nps', hashfull: 'hashfull',
  tbhits: 'tbhits', time: 'timeMs', currmovenumber: 'currmovenumber',
};

/**
 * Parse one UCI `info` line. Returns null for anything that is not an info line. Unknown tokens are skipped, as the
 * UCI spec requires. Never throws.
 */
export function parseInfoLine(line: string): UciInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  const out: UciInfo = {};
  for (let i = 1; i < t.length; i++) {
    const tok = t[i];
    if (tok === 'string') { out.string = t.slice(i + 1).join(' '); break; }
    if (tok in INT_FIELDS) {
      const n = Number(t[i + 1]);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[INT_FIELDS[tok]] = n;
      i++;
    } else if (tok === 'score') {
      const kind = t[i + 1];
      const v = Number(t[i + 2]);
      if ((kind === 'cp' || kind === 'mate') && Number.isFinite(v)) out.score = { kind, value: v };
      i += 2;
      out.bound = 'exact';
      if (t[i + 1] === 'lowerbound') { out.bound = 'lower'; i++; } else if (t[i + 1] === 'upperbound') { out.bound = 'upper'; i++; }
    } else if (tok === 'wdl') {
      const w = [Number(t[i + 1]), Number(t[i + 2]), Number(t[i + 3])];
      if (w.every(Number.isFinite)) out.wdl = w as [number, number, number];
      i += 3;
    } else if (tok === 'currmove') {
      out.currmove = t[++i];
    } else if (tok === 'pv') {
      const pv: string[] = [];
      while (i + 1 < t.length && isUciMove(t[i + 1])) pv.push(t[++i]);
      out.pv = pv;
    }
  }
  return out;
}

/** Parse `bestmove <m> [ponder <m>]`. `bestmove (none)` (no legal moves) gives move null. Null if not a bestmove line. */
export function parseBestMove(line: string): { move: string | null; ponder: string | null } | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'bestmove' || t.length < 2) return null;
  const move = isUciMove(t[1]) ? t[1] : null;
  const ponder = t[2] === 'ponder' && t[3] && isUciMove(t[3]) ? t[3] : null;
  return { move, ponder };
}

/** Parse `id name ...` / `id author ...` lines into a partial EngineId. */
export function parseIdLine(line: string): Partial<EngineId> | null {
  const m = /^id\s+(name|author)\s+(.+)$/.exec(line.trim());
  if (!m) return null;
  if (m[1] === 'author') return { author: m[2] };
  const version = /(\d+(?:\.\d+)*(?:[-\w.]*)?)\s*$/.exec(m[2])?.[1] ?? 'unknown';
  return { name: m[2], version };
}

/** Convert a side-to-move score to White's point of view. */
export function toWhitePov(score: Score, sideToMove: 'w' | 'b'): Score {
  if (sideToMove === 'w') return { ...score };
  // mate 0 (side to move is mated) stays 0; its sign is carried by who is to move
  return { kind: score.kind, value: score.value === 0 ? 0 : -score.value };
}

/**
 * Fold the raw output of one search (every line after `go`, up to and including `bestmove`) into an EngineAnalysis.
 * For each MultiPV index the last info line carrying both a score and a pv wins (engines print deeper lines later).
 * Pure: the Milestone 5 process adapter collects lines and calls this; tests feed recorded output.
 */
export function collectAnalysis(fen: string, engine: EngineId, output: readonly string[]): EngineAnalysis {
  const stm = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const byPv = new Map<number, PvLine>();
  let best: { move: string | null; ponder: string | null } | null = null;
  let lastNodes: number | null = null;
  let lastTime: number | null = null;
  let network = engine.network;
  for (const line of output) {
    const bm = parseBestMove(line);
    if (bm) { best = bm; continue; }
    const info = parseInfoLine(line);
    if (!info) continue;
    if (info.string) {
      const net = /NNUE evaluation using (\S+)/.exec(info.string)?.[1];
      if (net) network = net;
      continue;
    }
    if (info.nodes !== undefined) lastNodes = info.nodes;
    if (info.timeMs !== undefined) lastTime = info.timeMs;
    if (!info.score || info.depth === undefined) continue;
    const k = info.multipv ?? 1;
    const prev = byPv.get(k);
    const bound = info.bound ?? 'exact';
    // an aspiration-window bound must not replace an exact line of the same or greater depth
    if (prev && bound !== 'exact' && prev.bound === 'exact' && prev.depth >= info.depth) continue;
    byPv.set(k, {
      multipv: k,
      depth: info.depth,
      seldepth: info.seldepth ?? null,
      scoreStm: info.score,
      scoreWhite: toWhitePov(info.score, stm),
      bound,
      wdlStm: info.wdl ?? null,
      pv: info.pv ?? prev?.pv ?? [],
      nodes: info.nodes ?? null,
      timeMs: info.timeMs ?? null,
    });
  }
  const lines = [...byPv.values()].filter((l) => l.pv.length > 0).sort((a, b) => a.multipv - b.multipv);
  return {
    fen,
    engine: network ? { ...engine, network } : engine,
    depth: lines[0]?.depth ?? 0,
    nodes: lastNodes,
    timeMs: lastTime,
    lines,
    bestMove: best?.move ?? null,
    ponder: best?.ponder ?? null,
  };
}

/**
 * Convert a UCI principal variation to SAN by replaying it through the authoritative rules (@hc/shared).
 * Stops at the first illegal move and reports it: an illegal PV means the engine and the core disagree about the
 * position (wrong FEN sent, or a stale search) and that analysis must be discarded, never "explained".
 */
export function pvToSan(fen: string, pv: readonly string[]): { san: string[]; illegalAt: number | null } {
  const r = new ChessRules(fen);
  const san: string[] = [];
  for (const [i, m] of pv.entries()) {
    const rec = isUciMove(m) ? r.tryMove({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: (m[4] as never) || undefined }) : null;
    if (!rec) return { san, illegalAt: i };
    san.push(rec.san);
  }
  return { san, illegalAt: null };
}

/** Commands an adapter sends for an analysis request (pure; the adapter writes them to the engine's stdin). */
export function goCommands(fen: string, opts: AnalyseOptions): string[] {
  if (opts.depth === undefined && opts.movetimeMs === undefined && opts.nodes === undefined) {
    throw new Error('unbounded search: give depth, movetimeMs or nodes');
  }
  const go = ['go'];
  if (opts.depth !== undefined) go.push('depth', String(opts.depth));
  if (opts.nodes !== undefined) go.push('nodes', String(opts.nodes));
  if (opts.movetimeMs !== undefined) go.push('movetime', String(opts.movetimeMs));
  return [`setoption name MultiPV value ${opts.multiPv ?? 1}`, `position fen ${fen}`, go.join(' ')];
}
