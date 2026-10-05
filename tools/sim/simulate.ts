/**
 * TownChess game simulator and rules watchdog.
 *
 *   npx tsx tools/sim/simulate.ts [--games 40] [--seed 1] [--sf tools/.cache/stockfish/stockfish-linux-x86-64-universal]
 *                                 [--out tools/sim/out] [--classics-only]
 *
 * 1. Classics: famous public-domain games replayed move by move through GameCore; the final status must match the
 *    real result (e.g. the Opera Game must end in checkmate on move 17).
 * 2. Simulations: an opening from the TownChess book (CC0 lichess names), then CPU vs CPU to the end. Players are the
 *    house engine tiers and Stockfish at fixed UCI_Elo values (1350..2850): real Elo-graded opponents.
 *
 * Every ply is checked against an independent referee (Stockfish's own move generator, a separate program from
 * chess.js, which GameCore uses):
 *   - legal move set (GameCore vs Stockfish "go perft 1")
 *   - side to move in check / checkmate / stalemate (Stockfish "d")
 *   - mandatory draws: fivefold repetition and 75 moves (keys from Stockfish's normalised FEN, our own count)
 *   - insufficient material (our own count) vs GameCore's dead-position draw
 *   - eventSeq strictly increasing; engines never return an illegal move or nothing in a live position
 *   - journal restore at random plies reproduces FEN, status and history; PGN round-trips
 * Anomalies are written with a reproduction (start FEN + UCI moves) to <out>/report.json.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { GameCore, parsePgn, pgnFromHistory, resultToken, START_FEN, type Color } from '../../packages/shared/src/index.js';
import { search, seededRandom, type SearchOptions } from '../../packages/engine/src/index.js';
import book from '../../packages/shared/src/openings/book.json' with { type: 'json' };
import { CLASSICS } from './classics.js';
import { UciEngine } from './uci.js';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const GAMES = Number(arg('games', '40'));
const SEED = Number(arg('seed', '1'));
const SF_PATH = arg('sf', 'tools/.cache/stockfish/stockfish-linux-x86-64-universal');
const OUT = arg('out', 'tools/sim/out');
const MAX_PLIES = 400;
const rnd = seededRandom(SEED);

type Player = { id: string; kind: 'house'; opts: SearchOptions } | { id: string; kind: 'sf'; elo: number };
const HOUSE: Player[] = [
  { id: 'house-1 (depth 1, noisy)', kind: 'house', opts: { maxDepth: 1, timeMs: 200, noise: 120, nodeLimit: 4000 } },
  { id: 'house-2 (novice)', kind: 'house', opts: { maxDepth: 2, timeMs: 400, noise: 60, nodeLimit: 15000 } },
  { id: 'house-3 (patient)', kind: 'house', opts: { maxDepth: 3, timeMs: 400, noise: 25, nodeLimit: 12000 } },
  { id: 'house-4 (warden)', kind: 'house', opts: { maxDepth: 5, timeMs: 600, noise: 0, nodeLimit: 25000 } },  // sim budget: nodeLimit, not timeMs, bounds the house search (search.ts); the game's warden thinks longer
];
const SF_ELOS = [1350, 1600, 1900, 2200, 2500, 2850];

interface Anomaly { kind: string; game: string; ply: number; detail: string; startFen: string; moves: string[] }
const anomalies: Anomaly[] = [];
const results: Record<string, unknown>[] = [];

function insufficient(fen: string): boolean {
  const board = fen.split(' ')[0];
  const pieces = board.replace(/[\d/]/g, '');
  const minors = pieces.replace(/[kK]/g, '');
  if (minors === '') return true;
  if (/^[nNbB]$/.test(minors)) return true;
  if (/^[bB]+$/.test(minors)) {  // only bishops: dead if all on one square colour
    let colours = new Set<number>();
    board.split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else { if (ch === 'b' || ch === 'B') colours.add((r + f) % 2); f++; }
      }
    });
    return colours.size === 1;
  }
  return false;
}

async function playGame(label: string, players: Record<Color, Player>, startMoves: string[], ref: UciEngine | null,
                        engines: Map<number, UciEngine>, expect?: { status?: string; result?: string }) {
  const g = new GameCore({ timeControl: null, drawPolicy: 'claim' });
  g.start(0);
  const moves: string[] = [];
  const keys = new Map<string, number>();
  let lastSeq = g.eventSeq;
  const flag = (kind: string, detail: string) => anomalies.push({ kind, game: label, ply: moves.length, detail, startFen: START_FEN, moves: [...moves] });

  for (let ply = 0; ply < MAX_PLIES && g.status === 'active'; ply++) {
    const fen = g.fen;
    const mine = g.legalMovesUci().sort();
    if (ref) {
      const theirs = await ref.legalMoves(fen);
      if (mine.join() !== theirs.join()) {
        flag('legal-moves', `GameCore ${mine.length} vs Stockfish ${theirs.length}; only GameCore: ${mine.filter((m) => !theirs.includes(m))}; only SF: ${theirs.filter((m) => !mine.includes(m))}`);
      }
      const d = await ref.describe(fen);
      const key = d.fen.split(' ').slice(0, 4).join(' ');
      keys.set(key, (keys.get(key) ?? 0) + 1);
      if (theirs.length === 0) flag('missed-terminal', `Stockfish sees no legal move (${d.checkers.length ? 'checkmate' : 'stalemate'}) but GameCore is active`);
    }
    let uci: string | null;
    if (ply < startMoves.length) uci = startMoves[ply];
    else {
      const p = players[g.turn];
      if (p.kind === 'house') {
        const m = search(fen, { ...p.opts, seed: Math.floor(rnd() * 1e9) });
        uci = m ? m.from + m.to + (m.promotion ?? '') : null;
      } else {
        uci = await engines.get(p.elo)!.bestMove(fen, { movetime: 60 });
      }
      if (!uci) { flag('engine-no-move', `${p.id} returned no move in a live position`); break; }
      if (!mine.includes(uci)) { flag('engine-illegal', `${p.id} returned ${uci}, not legal`); break; }
    }
    const r = g.move(g.turn, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as 'q') || undefined }, ply);
    if (!r.ok) { flag(ply < startMoves.length ? 'book-move-rejected' : 'move-rejected', `${uci}: ${r.reason}`); break; }
    moves.push(uci);
    if (g.eventSeq <= lastSeq) flag('event-seq', `eventSeq ${g.eventSeq} after ${lastSeq}`);
    lastSeq = g.eventSeq;
    // mandatory draws the core must apply by itself (claim policy: threefold/fifty are claims, not automatic)
    const half = Number(g.fen.split(' ')[4]);
    const mated = ref ? (await ref.legalMoves(g.fen)).length === 0 && (await ref.describe(g.fen)).checkers.length > 0 : false;
    if (ref && !mated) {
      const d = await ref.describe(g.fen);
      const k = d.fen.split(' ').slice(0, 4).join(' ');
      const reps = (keys.get(k) ?? 0) + 1;
      if (reps >= 5 && g.status === 'active') flag('fivefold-missed', `position occurred ${reps} times, game still active`);
      if (half >= 150 && g.status === 'active') flag('seventyfive-missed', `halfmove clock ${half}, game still active`);
      if (g.status === 'draw_fivefold' && reps < 5) flag('fivefold-early', `ended fivefold after ${reps} occurrences`);
    }
    if (insufficient(g.fen) && g.status === 'active') flag('insufficient-missed', `dead material ${g.fen}`);
    if (g.status === 'draw_insufficient' && !insufficient(g.fen)) flag('insufficient-wrong', `declared dead: ${g.fen}`);
    // journal restore at random plies must reproduce the game
    if (moves.length % 17 === 0 || g.status !== 'active') {
      try {
        const rr = GameCore.restore({ timeControl: null, drawPolicy: 'claim', moves, clocks: null, eventSeq: g.eventSeq }, ply);
        if (rr.fen !== g.fen || rr.status !== g.status || rr.history.length !== g.history.length) flag('restore-mismatch', `restored ${rr.fen} ${rr.status} vs ${g.fen} ${g.status}`);
      } catch (e) { flag('restore-throws', String(e)); }
    }
  }
  if (g.status === 'active' && moves.length >= MAX_PLIES) { /* adjudicated: too long */ }
  // terminal verification against the referee
  if (ref && g.status !== 'active') {
    const lm = await ref.legalMoves(g.fen);
    const d = await ref.describe(g.fen);
    if (g.status === 'checkmate' && !(lm.length === 0 && d.checkers.length)) flag('false-checkmate', `GameCore checkmate, Stockfish: ${lm.length} moves, checkers ${d.checkers}`);
    if (g.status === 'stalemate' && !(lm.length === 0 && !d.checkers.length)) flag('false-stalemate', `GameCore stalemate, Stockfish: ${lm.length} moves, checkers ${d.checkers}`);
  }
  // PGN round trip
  try {
    const pgn = pgnFromHistory(g.history, { white: players.w.id, black: players.b.id, result: resultToken(g.status, g.winner, g.termination) });
    const back = parsePgn(pgn).moves.map((m) => m.from + m.to + (m.promotion ?? ''));
    if (back.join() !== moves.join()) flag('pgn-roundtrip', `PGN replays ${back.length} moves, game had ${moves.length}`);
  } catch (e) { flag('pgn-throws', String(e)); }
  if (expect?.status && g.status !== expect.status) flag('classic-result', `expected ${expect.status}, GameCore says ${g.status} after ${moves.length} plies`);
  const res = { game: label, white: players.w.id, black: players.b.id, plies: moves.length, status: g.status, termination: g.termination,
                winner: g.winner, result: resultToken(g.status, g.winner, g.termination), opening: g.snapshot(0).opening?.name ?? null };
  results.push(res);
  return res;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ref = existsSync(SF_PATH) ? await new UciEngine(SF_PATH).init({ Threads: 1, Hash: 16 }) : null;
  if (!ref) console.log('WARNING: Stockfish not found; legal-move and terminal cross-checks are skipped');
  const engines = new Map<number, UciEngine>();
  if (ref) for (const elo of SF_ELOS) engines.set(elo, await new UciEngine(SF_PATH).init({ Threads: 1, Hash: 16, UCI_LimitStrength: true, UCI_Elo: elo }));
  const t0 = Date.now();

  for (const c of CLASSICS) {
    const p = parsePgn(c.pgn);
    const uci = p.moves.map((m) => m.from + m.to + (m.promotion ?? ''));
    const none: Player = { id: 'replay', kind: 'house', opts: HOUSE[0].opts };
    const r = await playGame(`classic: ${c.name}`, { w: { ...none, id: p.headers.White ?? '?' }, b: { ...none, id: p.headers.Black ?? '?' } }, uci, ref, engines, { status: c.expect });
    console.log(`${r.game}: ${r.plies} plies, ${r.status} (${r.result})`);
  }
  if (process.argv.includes('--classics-only')) return finish(ref, engines, t0);

  const lines = Object.values(book as Record<string, [string, string, number, string]>).filter((v) => v[2] >= 6 && v[2] <= 16);
  const roster: Player[] = [...HOUSE, ...(ref ? SF_ELOS.map((elo): Player => ({ id: `stockfish-${elo}`, kind: 'sf', elo })) : [])];
  for (let i = 0; i < GAMES; i++) {
    const [eco, name, , movetext] = lines[Math.floor(rnd() * lines.length)];
    const p = parsePgn(movetext);
    const uci = p.moves.map((m) => m.from + m.to + (m.promotion ?? ''));
    const w = roster[Math.floor(rnd() * roster.length)];
    const b = roster[Math.floor(rnd() * roster.length)];
    for (const e of engines.values()) await e.newGame();
    const r = await playGame(`#${i + 1} ${eco} ${name}`, { w, b }, uci, ref, engines);
    console.log(`${r.game} | ${w.id} vs ${b.id}: ${r.plies} plies, ${r.status} ${r.result} | anomalies so far ${anomalies.length}`);
    writeReport(ref, t0);  // incremental, so a long run can be inspected (or killed) at any time
  }
  finish(ref, engines, t0);
}

function writeReport(ref: UciEngine | null, t0: number) {
  const byKind: Record<string, number> = {};
  for (const a of anomalies) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ when: new Date().toISOString(), seed: SEED, referee: ref?.name ?? null,
    seconds: Math.round((Date.now() - t0) / 1000), games: results.length, anomalies: anomalies.length, anomalyKinds: byKind,
    results, anomalyList: anomalies }, null, 2));
}

function finish(ref: UciEngine | null, engines: Map<number, UciEngine>, t0: number) {
  const byKind: Record<string, number> = {};
  for (const a of anomalies) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  const report = { when: new Date().toISOString(), seed: SEED, referee: ref?.name ?? null, seconds: Math.round((Date.now() - t0) / 1000),
                   games: results.length, anomalies: anomalies.length, anomalyKinds: byKind, results, anomalyList: anomalies };
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(`\n${results.length} games in ${report.seconds}s, ${anomalies.length} anomalies ${JSON.stringify(byKind)} -> ${OUT}/report.json`);
  ref?.quit();
  for (const e of engines.values()) e.quit();
  process.exitCode = anomalies.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
