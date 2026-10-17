import {
  ChessRules, START_FEN, identifyOpening, isDeadByMaterial, parsePgn, positionKey,
  type MoveRecord, type Termination, type TimeControl,
} from '@hc/shared';

/**
 * Game ingestion: PGN text or a GameCore move history in, a normalized GameRecord out.
 *
 * Every move is replayed through the authoritative rules (@hc/shared ChessRules). Nothing is trusted from the
 * source except the moves themselves and a whitelist of metadata. Data quality problems are reported in
 * `quality.warnings` instead of being silently "fixed", so the learning layer can filter on them.
 *
 * PRIVACY: a GameRecord never holds a player's name, username, e-mail, IP address, rating or free text from PGN
 * headers. Players are referenced only by an opaque profile id that the caller supplies (a random id issued by the
 * server, not derived from the account). PGN [White]/[Black]/[Site]/[Event]/[Annotator] and comments are dropped.
 * See docs/LEARNING.md "Privacy".
 */

export const GAME_RECORD_SCHEMA_VERSION = 1;

export type ResultToken = '1-0' | '0-1' | '1/2-1/2' | '*';
export type TimeControlClass = 'ultrabullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence' | 'untimed' | 'unknown';
export type GameSource = 'townchess' | 'pgn_import';
export type SeatKind = 'human' | 'engine' | 'unknown';

export interface Seat {
  /** Opaque profile id, or null for an anonymous / engine / imported seat. Never a name or contact detail. */
  profileId: string | null;
  kind: SeatKind;
}

export interface GameRecordMove {
  /** 1-based ply. */
  ply: number;
  san: string;
  uci: string;
  color: 'w' | 'b';
}

export interface GameRecord {
  schemaVersion: typeof GAME_RECORD_SCHEMA_VERSION;
  /** Opaque game id supplied by the caller. */
  gameId: string;
  source: GameSource;
  white: Seat;
  black: Seat;
  startFen: string;
  moves: GameRecordMove[];
  /**
   * positionKeys[0] is the start position, positionKeys[i] the position after ply i (length = plies + 1). Keys are
   * @hc/shared positionKey (placement, side, castling, legal-only ep): transposition-aware and repetition-exact.
   */
  positionKeys: string[];
  plies: number;
  opening: { eco: string; name: string; family: string; variation: string | null; ply: number; transposed: boolean } | null;
  result: ResultToken;
  termination: Termination | null;
  timeControl: TimeControl | null;
  timeControlClass: TimeControlClass;
  /** UTC calendar day (YYYY-MM-DD) only: no time of day is stored. */
  playedOn: string | null;
  rated: boolean;
  quality: { warnings: QualityWarning[] };
}

export type QualityWarning =
  | 'result_contradicts_checkmate' | 'result_contradicts_stalemate' | 'result_contradicts_dead_position'
  | 'result_unknown' | 'termination_unknown' | 'nonstandard_start' | 'empty_game';

export interface IngestMeta {
  gameId: string;
  source: GameSource;
  white?: Partial<Seat>;
  black?: Partial<Seat>;
  /** Overrides the PGN [Result] (required for a move-history input, else '*'). */
  result?: ResultToken;
  termination?: Termination | null;
  /** TimeControl object, or a PGN-style "300+2" string; "-" or null = untimed. */
  timeControl?: TimeControl | string | null;
  /** Date or ISO string; reduced to the UTC day. */
  playedAt?: Date | string | null;
  rated?: boolean;
  /** Start position for a move-history input (default the standard start). */
  startFen?: string;
}

export class IngestError extends Error {}

/** Move-history input: GameCore MoveRecords, {from,to,promotion} objects or UCI strings. */
export type MoveHistoryInput = ReadonlyArray<MoveRecord | { from: string; to: string; promotion?: string } | string>;

const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const EMAIL = /@/;
const IPV4 = /^\d{1,3}([._-]\d{1,3}){3}$/;

/**
 * Reject anything that does not look like an opaque id: e-mail addresses, IPv4 addresses, ids with spaces (names)
 * or too short to be random. This is a guard against mistakes, not proof of anonymity: ids must be issued opaque.
 */
export function assertOpaqueProfileId(id: string): void {
  if (!OPAQUE_ID.test(id) || EMAIL.test(id) || IPV4.test(id)) throw new IngestError(`profile id is not an opaque id: rejected`);
}

/** Lichess-style estimate: initial seconds + 40 x increment seconds. */
export function timeControlClass(tc: TimeControl | null | undefined): TimeControlClass {
  if (tc === undefined) return 'unknown';
  if (tc === null) return 'untimed';
  const est = tc.initialMs / 1000 + 40 * (tc.incrementMs / 1000);
  if (est >= 24 * 3600) return 'correspondence';
  if (est < 30) return 'ultrabullet';
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

/** Parse "300+2" (seconds + increment seconds, PGN spec 9.6.1). "-" = untimed (null); unparseable = undefined. */
export function parseTimeControl(v: TimeControl | string | null | undefined): TimeControl | null | undefined {
  if (v === undefined || v === null) return v;
  if (typeof v !== 'string') return v;
  if (v === '-') return null;
  const m = /^(\d+)(?:\+(\d+))?$/.exec(v.trim());
  if (!m) return undefined;
  return { initialMs: Number(m[1]) * 1000, incrementMs: Number(m[2] ?? 0) * 1000 };
}

const PGN_TERMINATION_IN: Record<string, Termination> = { 'time forfeit': 'timeout', abandoned: 'abandoned' };

function utcDay(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string') {
    const pgnDate = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(v);
    if (pgnDate) return `${pgnDate[1]}-${pgnDate[2]}-${pgnDate[3]}`;
    if (/\?/.test(v)) return null;
  }
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function seat(s: Partial<Seat> | undefined): Seat {
  const profileId = s?.profileId ?? null;
  if (profileId !== null) assertOpaqueProfileId(profileId);
  return { profileId, kind: s?.kind ?? 'unknown' };
}

const toInput = (m: MoveHistoryInput[number]) => {
  if (typeof m === 'string') {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) throw new IngestError(`not a UCI move: ${m}`);
    return { from: m.slice(0, 2), to: m.slice(2, 4), promotion: (m[4] as never) || undefined };
  }
  return { from: m.from, to: m.to, promotion: (m.promotion as never) || undefined };
};

/** Ingest one game. Throws IngestError on an illegal move or a non-opaque profile id. */
export function ingestGame(input: string | MoveHistoryInput, meta: IngestMeta): GameRecord {
  if (!meta.gameId) throw new IngestError('gameId required');
  let startFen = meta.startFen ?? START_FEN;
  let moves: { from: string; to: string; promotion?: never }[];
  let headers: Record<string, string> = {};
  if (typeof input === 'string') {
    let parsed: ReturnType<typeof parsePgn>;
    try { parsed = parsePgn(input); } catch (e) { throw new IngestError(`PGN rejected: ${(e as Error).message}`); }
    headers = parsed.headers;
    startFen = parsed.startFen;
    moves = parsed.moves.map((m) => ({ from: m.from, to: m.to, promotion: (m.promotion as never) || undefined }));
  } else {
    moves = input.map(toInput);
  }

  const rules = new ChessRules(startFen);
  const positionKeys = [positionKey(rules.fen)];
  const out: GameRecordMove[] = [];
  moves.forEach((m, i) => {
    const color = rules.turn;
    const rec = rules.tryMove(m);
    if (!rec) throw new IngestError(`illegal move at ply ${i + 1}: ${m.from}${m.to}${m.promotion ?? ''}`);
    out.push({ ply: i + 1, san: rec.san, uci: rec.from + rec.to + (rec.promotion ?? ''), color });
    positionKeys.push(positionKey(rec.fenAfter));
  });

  const warnings: QualityWarning[] = [];
  if (startFen !== START_FEN) warnings.push('nonstandard_start');
  if (out.length === 0) warnings.push('empty_game');

  const headerResult = headers.Result as ResultToken | undefined;
  const result: ResultToken = meta.result ?? (headerResult && ['1-0', '0-1', '1/2-1/2', '*'].includes(headerResult) ? headerResult : '*');
  if (result === '*') warnings.push('result_unknown');

  // what the final position itself proves
  const final = rules.chessView;
  let proven: { termination: Termination; result: ResultToken } | null = null;
  if (final.isCheckmate()) proven = { termination: 'checkmate', result: rules.turn === 'w' ? '0-1' : '1-0' };
  else if (final.isStalemate()) proven = { termination: 'stalemate', result: '1/2-1/2' };
  else if (isDeadByMaterial(rules.pieces())) proven = { termination: 'insufficient_material', result: '1/2-1/2' };
  if (proven && result !== '*' && result !== proven.result) {
    warnings.push(proven.termination === 'checkmate' ? 'result_contradicts_checkmate'
      : proven.termination === 'stalemate' ? 'result_contradicts_stalemate' : 'result_contradicts_dead_position');
  }

  let termination: Termination | null = meta.termination ?? null;
  if (termination === null && proven) termination = proven.termination;
  if (termination === null && headers.Termination && PGN_TERMINATION_IN[headers.Termination.toLowerCase()]) {
    termination = PGN_TERMINATION_IN[headers.Termination.toLowerCase()];
  }
  if (termination === null && result !== '*') warnings.push('termination_unknown');

  const tc = parseTimeControl(meta.timeControl !== undefined ? meta.timeControl : headers.TimeControl);
  const id = identifyOpening(out.map((m) => m.uci), startFen);
  const o = id.opening;

  return {
    schemaVersion: GAME_RECORD_SCHEMA_VERSION,
    gameId: meta.gameId,
    source: meta.source,
    white: seat(meta.white),
    black: seat(meta.black),
    startFen,
    moves: out,
    positionKeys,
    plies: out.length,
    opening: o ? { eco: o.eco, name: o.name, family: o.family, variation: o.variation, ply: o.ply, transposed: o.transposed } : null,
    result,
    termination,
    timeControl: tc ?? null,
    timeControlClass: timeControlClass(tc),
    playedOn: utcDay(meta.playedAt ?? headers.Date ?? null),
    rated: meta.rated ?? false,
    quality: { warnings },
  };
}

/** Score of a result for `color`: 1 win, 0.5 draw, 0 loss, null unknown. */
export function scoreFor(result: ResultToken, color: 'w' | 'b'): number | null {
  if (result === '*') return null;
  if (result === '1/2-1/2') return 0.5;
  return (result === '1-0') === (color === 'w') ? 1 : 0;
}
