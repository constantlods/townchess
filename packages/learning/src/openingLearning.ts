import { lookupPosition } from '@hc/shared';
import type { EngineId } from './engineService.js';
import { scoreFor, type GameRecord, type ResultToken } from './ingest.js';

/**
 * Opening statistics: data model and pure aggregation functions.
 *
 * Four facets are kept SEPARATE on purpose, because they answer different questions and have different quality:
 *  - frequency: how often a position / a move from it was played (counts only);
 *  - result:    what happened in those games (W/D/L, always from White's point of view in the aggregate);
 *  - quality:   what an engine thinks of the position (nullable until Milestone 5 wires the EngineService);
 *  - novelty:   whether a move leaves the named book, or was never seen in the aggregate before.
 * A popular move is not a good move, and a move that scored well in 12 club games is not a sound move: mixing the
 * facets into one number is what this model avoids.
 *
 * Everything is keyed by @hc/shared positionKey, so transpositions merge: 1.d4 Nf6 2.c4 e6 and 1.c4 e6 2.d4 Nf6
 * update the same position node.
 *
 * Two scopes:
 *  - the GLOBAL aggregate holds no profile ids at all (it can be shown to anyone after `publicView` suppression);
 *  - a PROFILE repertoire is per opaque profile id, split by the colour that profile played, with results from
 *    that profile's point of view. It is private to that profile (docs/LEARNING.md "Privacy").
 *
 * The builder functions mutate only the accumulator they are given (no I/O, no clock, no randomness): the same
 * games in the same order always give the same aggregate.
 */

export interface ResultTally { whiteWins: number; draws: number; blackWins: number; unknown: number }

/** Engine evaluation slot for a position. Null until Milestone 5. */
export interface QualitySlot {
  /** White point of view. Exactly one of cp / mate is non-null. */
  cp: number | null;
  mate: number | null;
  depth: number;
  engine: EngineId;
  /** ISO date of the analysis (analyses go stale when the engine version changes). */
  analysedOn: string;
}

export interface MoveEdge {
  uci: string;
  san: string;
  /** frequency */
  count: number;
  /** result, White POV */
  results: ResultTally;
  /** Key of the position the move leads to (edges form a DAG; transpositions share child nodes). */
  to: string;
}

export interface PositionNode {
  key: string;
  /** frequency: games that reached this position (counted once per game, even if repeated within it) */
  count: number;
  /** result, White POV */
  results: ResultTally;
  moves: Record<string, MoveEdge>;
  /** Named book position (Lichess chess-openings), if any. */
  book: { eco: string; name: string } | null;
  /** quality: null until an engine evaluation is attached. */
  quality: QualitySlot | null;
}

export interface OpeningAggregate {
  /** Plies per game that are aggregated (openings only; default 24). */
  maxPly: number;
  games: number;
  nodes: Record<string, PositionNode>;
}

const emptyTally = (): ResultTally => ({ whiteWins: 0, draws: 0, blackWins: 0, unknown: 0 });

function tally(t: ResultTally, r: ResultToken) {
  if (r === '1-0') t.whiteWins++;
  else if (r === '0-1') t.blackWins++;
  else if (r === '1/2-1/2') t.draws++;
  else t.unknown++;
}

export type BookLookup = (key: string) => { eco: string; name: string } | null;
const defaultBook: BookLookup = (key) => {
  const hit = lookupPosition(key);
  return hit ? { eco: hit.eco, name: hit.name } : null;
};

export function createAggregate(maxPly = 24): OpeningAggregate {
  return { maxPly, games: 0, nodes: {} };
}

/** Which games may enter the learning data at all (data quality first). */
export function isUsableForLearning(r: GameRecord): boolean {
  const bad = r.quality.warnings.filter((w) => w.startsWith('result_contradicts') || w === 'nonstandard_start' || w === 'empty_game');
  return bad.length === 0;
}

function node(agg: OpeningAggregate, key: string, book: BookLookup): PositionNode {
  return (agg.nodes[key] ??= { key, count: 0, results: emptyTally(), moves: {}, book: book(key), quality: null });
}

/**
 * Add one game to an aggregate (mutates `agg`, returns it). Games that fail `isUsableForLearning` are ignored and
 * reported by returning false in `accepted`.
 */
export function addGame(agg: OpeningAggregate, r: GameRecord, book: BookLookup = defaultBook): { agg: OpeningAggregate; accepted: boolean } {
  if (!isUsableForLearning(r)) return { agg, accepted: false };
  agg.games++;
  const plies = Math.min(r.plies, agg.maxPly);
  const counted = new Set<string>();
  for (let i = 0; i <= plies; i++) {
    const key = r.positionKeys[i];
    const n = node(agg, key, book);
    if (!counted.has(key)) { counted.add(key); n.count++; tally(n.results, r.result); }
    if (i === plies) break;
    const mv = r.moves[i];
    const e = (n.moves[mv.uci] ??= { uci: mv.uci, san: mv.san, count: 0, results: emptyTally(), to: r.positionKeys[i + 1] });
    e.count++;
    tally(e.results, r.result);
  }
  return { agg, accepted: true };
}

export function aggregate(records: readonly GameRecord[], maxPly = 24, book: BookLookup = defaultBook): OpeningAggregate {
  const agg = createAggregate(maxPly);
  for (const r of records) addGame(agg, r, book);
  return agg;
}

/** Attach an engine evaluation to a position (quality facet). Returns false if the position is not in the aggregate. */
export function attachQuality(agg: OpeningAggregate, key: string, q: QualitySlot): boolean {
  const n = agg.nodes[key];
  if (!n) return false;
  if ((q.cp === null) === (q.mate === null)) throw new Error('quality: exactly one of cp / mate');
  n.quality = q;
  return true;
}

/** Expected score for White (draws half) over known results, or null with no known results. */
export function whiteScore(t: ResultTally): number | null {
  const known = t.whiteWins + t.draws + t.blackWins;
  return known === 0 ? null : (t.whiteWins + t.draws / 2) / known;
}

/**
 * Privacy for the global aggregate shown to players: drop positions and moves reached by fewer than `minGames`
 * games, so a rare line cannot single out the one person who plays it.
 */
export function publicView(agg: OpeningAggregate, minGames = 5): OpeningAggregate {
  const nodes: Record<string, PositionNode> = {};
  for (const [k, n] of Object.entries(agg.nodes)) {
    if (n.count < minGames) continue;
    const moves: Record<string, MoveEdge> = {};
    for (const [u, e] of Object.entries(n.moves)) if (e.count >= minGames) moves[u] = { ...e, results: { ...e.results } };
    nodes[k] = { ...n, results: { ...n.results }, moves };
  }
  return { maxPly: agg.maxPly, games: agg.games, nodes };
}

// ---------------------------------------------------------------------------------------------------------------
// Novelty

export type PlyNovelty = 'book' | 'known' | 'novelty' | 'beyond_novelty';

export interface NoveltyReport {
  /** Per ply (index 0 = ply 1), up to the aggregate's maxPly. */
  perPly: PlyNovelty[];
  /** First ply whose resulting position is not a named book position, after the game was in book. null = never left. */
  leftBookAtPly: number | null;
  /** First ply whose move was never seen from that position in the aggregate. null = none. */
  noveltyAtPly: number | null;
}

/**
 * Novelty of a game against an aggregate. Call it BEFORE adding the game to that aggregate.
 * - 'book': the position after the move is a named book position;
 * - 'known': not in book, but the move was seen from this position in the aggregate;
 * - 'novelty': the first move never seen from its position (only one per game);
 * - 'beyond_novelty': every later ply (the aggregate has no information there).
 */
export function detectNovelty(r: GameRecord, agg: OpeningAggregate, book: BookLookup = defaultBook): NoveltyReport {
  const perPly: PlyNovelty[] = [];
  let leftBookAtPly: number | null = null;
  let noveltyAtPly: number | null = null;
  let everInBook = false;
  const plies = Math.min(r.plies, agg.maxPly);
  for (let i = 0; i < plies; i++) {
    const inBook = !!book(r.positionKeys[i + 1]);
    if (inBook) everInBook = true;
    else if (everInBook && leftBookAtPly === null) leftBookAtPly = i + 1;
    if (noveltyAtPly !== null) { perPly.push('beyond_novelty'); continue; }
    const seen = !!agg.nodes[r.positionKeys[i]]?.moves[r.moves[i].uci];
    if (!seen) { noveltyAtPly = i + 1; perPly.push('novelty'); continue; }
    perPly.push(inBook ? 'book' : 'known');
  }
  return { perPly, leftBookAtPly, noveltyAtPly };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-profile repertoire

export interface ProfileTally { wins: number; draws: number; losses: number; unknown: number }

export interface RepertoireOpening {
  eco: string;
  name: string;
  color: 'w' | 'b';
  games: number;
  /** Results from the PROFILE's point of view. */
  results: ProfileTally;
  /** Latest UTC day seen (no time of day). */
  lastPlayedOn: string | null;
}

export interface ProfileRepertoire {
  profileId: string;
  games: { w: number; b: number };
  /** Position trees per colour played, results White POV as in any aggregate. */
  trees: { w: OpeningAggregate; b: OpeningAggregate };
  /** Keyed by `${color}|${opening name}`. */
  openings: Record<string, RepertoireOpening>;
}

export function createRepertoire(profileId: string, maxPly = 24): ProfileRepertoire {
  return { profileId, games: { w: 0, b: 0 }, trees: { w: createAggregate(maxPly), b: createAggregate(maxPly) }, openings: {} };
}

/** Add a game to a profile's repertoire if that profile played in it. Returns the colour played, or null. */
export function addToRepertoire(rep: ProfileRepertoire, r: GameRecord, book: BookLookup = defaultBook): 'w' | 'b' | null {
  const color = r.white.profileId === rep.profileId ? 'w' : r.black.profileId === rep.profileId ? 'b' : null;
  if (!color || !isUsableForLearning(r)) return null;
  rep.games[color]++;
  addGame(rep.trees[color], r, book);
  if (r.opening) {
    const k = `${color}|${r.opening.name}`;
    const o = (rep.openings[k] ??= { eco: r.opening.eco, name: r.opening.name, color, games: 0, results: { wins: 0, draws: 0, losses: 0, unknown: 0 }, lastPlayedOn: null });
    o.games++;
    const s = scoreFor(r.result, color);
    if (s === null) o.results.unknown++;
    else if (s === 1) o.results.wins++;
    else if (s === 0) o.results.losses++;
    else o.results.draws++;
    if (r.playedOn && (!o.lastPlayedOn || r.playedOn > o.lastPlayedOn)) o.lastPlayedOn = r.playedOn;
  }
  return color;
}

export interface RecurringOpening extends RepertoireOpening {
  /** Share of this profile's games with this colour. */
  share: number;
}

/**
 * Detect a recurring repertoire: openings a profile reaches at least `minGames` times AND in at least `minShare`
 * of its games with that colour. Matching is by the named position the game reached (so transpositions count).
 * `level` sets the granularity: 'name' = the full name ("French Defense: Advance Variation, Nimzowitsch System"),
 * 'variation' (default) = family + variation ("French Defense: Advance Variation", which groups its
 * sub-variations), 'family' = "French Defense".
 * Sorted by games, then name, for deterministic output.
 */
export function recurringOpenings(
  rep: ProfileRepertoire,
  opts: { minGames?: number; minShare?: number; level?: 'name' | 'variation' | 'family' } = {},
): RecurringOpening[] {
  const minGames = opts.minGames ?? 3;
  const minShare = opts.minShare ?? 0.25;
  const groups = new Map<string, RepertoireOpening>();
  for (const o of Object.values(rep.openings)) {
    const level = opts.level ?? 'variation';
    const name = level === 'family' ? o.name.split(':')[0] : level === 'variation' ? o.name.split(',')[0] : o.name;
    const k = `${o.color}|${name}`;
    const g = groups.get(k);
    if (!g) { groups.set(k, { ...o, name, results: { ...o.results } }); continue; }
    g.games += o.games;
    g.results.wins += o.results.wins; g.results.draws += o.results.draws;
    g.results.losses += o.results.losses; g.results.unknown += o.results.unknown;
    if (o.lastPlayedOn && (!g.lastPlayedOn || o.lastPlayedOn > g.lastPlayedOn)) g.lastPlayedOn = o.lastPlayedOn;
    if (o.eco < g.eco) g.eco = o.eco;
  }
  const out: RecurringOpening[] = [];
  for (const g of groups.values()) {
    const total = rep.games[g.color];
    const share = total ? g.games / total : 0;
    if (g.games >= minGames && share >= minShare) out.push({ ...g, share });
  }
  return out.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name) || a.color.localeCompare(b.color));
}
