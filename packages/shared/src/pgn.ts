import { Chess } from 'chess.js';
import { START_FEN } from './rules.js';
import type { Color, GameStatus, MoveRecord, Termination } from './types.js';

export interface PgnGame {
  white: string;
  black: string;
  /** PGN result token. */
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  moves: string[]; // SAN
  startFen?: string;
  date?: Date;
  event?: string;
  site?: string;
  round?: string;
  eco?: string;
  opening?: string;
  termination?: Termination | null;
  /** e.g. "300+0" (seconds+increment) */
  timeControl?: string;
}

export function resultToken(status: GameStatus, winner: Color | null): PgnGame['result'] {
  if (status === 'waiting' || status === 'active' || status === 'aborted') return '*';
  if (winner === 'w') return '1-0';
  if (winner === 'b') return '0-1';
  return '1/2-1/2';
}

/** PGN [Termination] values (PGN spec 9.8.1) mapped from TownChess terminations. */
const PGN_TERMINATION: Record<Termination, string> = {
  checkmate: 'normal', stalemate: 'normal', insufficient_material: 'normal', threefold_repetition: 'normal',
  fivefold_repetition: 'normal', fifty_move: 'normal', seventy_five_move: 'normal', agreement: 'normal',
  resignation: 'normal', timeout: 'time forfeit', timeout_vs_insufficient: 'time forfeit', abandoned: 'abandoned',
  abandoned_vs_insufficient: 'abandoned', aborted: 'unterminated',
};

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const pad = (n: number) => String(n).padStart(2, '0');

/** Export PGN with the Seven Tag Roster first (PGN spec 8.1.1), then optional tags, then movetext wrapped at 80. */
export function toPgn(g: PgnGame): string {
  const d = g.date ?? new Date();
  const tags: [string, string][] = [
    ['Event', g.event ?? 'TownChess game'],
    ['Site', g.site ?? 'TownChess'],
    ['Date', `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`],
    ['Round', g.round ?? '-'],
    ['White', g.white],
    ['Black', g.black],
    ['Result', g.result],
  ];
  if (g.eco) tags.push(['ECO', g.eco]);
  if (g.opening) tags.push(['Opening', g.opening]);
  if (g.timeControl) tags.push(['TimeControl', g.timeControl]);
  if (g.termination) tags.push(['Termination', PGN_TERMINATION[g.termination]]);
  if (g.startFen && g.startFen !== START_FEN) tags.push(['SetUp', '1'], ['FEN', g.startFen]);

  const startMoveNo = g.startFen ? Number(g.startFen.split(' ')[5] ?? 1) : 1;
  const blackFirst = g.startFen ? g.startFen.split(' ')[1] === 'b' : false;
  const tokens: string[] = [];
  g.moves.forEach((san, i) => {
    const absolute = i + (blackFirst ? 1 : 0);
    const moveNo = startMoveNo + Math.floor(absolute / 2);
    if (absolute % 2 === 0) tokens.push(`${moveNo}.`);
    else if (i === 0) tokens.push(`${moveNo}...`);
    tokens.push(san);
  });
  tokens.push(g.result);
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > 80) { lines.push(line); line = t; } else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return `${tags.map(([k, v]) => `[${k} "${esc(v)}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
}

export function pgnFromHistory(history: readonly MoveRecord[], meta: Omit<PgnGame, 'moves'>): string {
  return toPgn({ ...meta, moves: history.map((m) => m.san) });
}

/** Import PGN movetext (comments, variations and NAGs are ignored by chess.js). Throws on illegal moves. */
export function parsePgn(pgn: string): { headers: Record<string, string>; moves: { from: string; to: string; promotion?: string; san: string }[]; startFen: string } {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders() as Record<string, string>;
  const moves = chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion, san: m.san }));
  return { headers, moves, startFen: headers.FEN ?? START_FEN };
}
