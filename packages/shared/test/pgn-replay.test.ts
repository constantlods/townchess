import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { GameCore, identifyOpening, parsePgn, pgnFromHistory, resultToken } from '../src/index.js';

/**
 * Layer A correctness audit: replay complete, well-known master games (public-domain historical scores, typed from
 * the published game scores and verified to replay legally with chess.js) through GameCore.
 *
 * For each game: every move is accepted by GameCore with the same SAN; the final status agrees with the PGN result
 * where it is decidable from the position (checkmate), and the game is still active where the real game ended by
 * resignation or agreement (not decidable from the board); the opening name comes from the position-keyed book;
 * and export -> import reproduces the move list.
 *
 * Opening names are pinned to the vendored Lichess chess-openings data (commit c67912b). If that data is updated and
 * a name changes, update the table deliberately: it is a data change, not a rules change.
 */
interface Expected { result: '1-0' | '0-1' | '1/2-1/2'; plies: number; ending: 'checkmate' | 'resignation' | 'agreement'; eco: string; opening: string }

const GAMES: Record<string, Expected> = {
  'opera-game.pgn': { result: '1-0', plies: 33, ending: 'checkmate', eco: 'C41', opening: 'Philidor Defense' },
  'immortal-game.pgn': { result: '1-0', plies: 45, ending: 'checkmate', eco: 'C33', opening: "King's Gambit Accepted: Bishop's Gambit, Bryan Countergambit" },
  'evergreen-game.pgn': { result: '1-0', plies: 47, ending: 'checkmate', eco: 'C52', opening: 'Italian Game: Evans Gambit, Dufresne Defense' },
  'game-of-the-century.pgn': { result: '0-1', plies: 82, ending: 'checkmate', eco: 'A15', opening: "English Opening: Anglo-Indian Defense, King's Indian Formation" },
  'deep-blue-kasparov-1997-g6.pgn': { result: '1-0', plies: 37, ending: 'resignation', eco: 'B17', opening: 'Caro-Kann Defense: Karpov Variation, Modern Variation' },
  'kasparov-topalov-1999.pgn': { result: '1-0', plies: 87, ending: 'resignation', eco: 'B07', opening: 'Pirc Defense' },
  'fischer-spassky-1972-g6.pgn': { result: '1-0', plies: 81, ending: 'resignation', eco: 'D59', opening: "Queen's Gambit Declined: Tartakower Defense" },
  'reti-tartakower-1910.pgn': { result: '1-0', plies: 21, ending: 'checkmate', eco: 'B15', opening: 'Caro-Kann Defense: Main Line' },
  'lasker-thomas-1912.pgn': { result: '1-0', plies: 35, ending: 'checkmate', eco: 'A40', opening: 'Horwitz Defense' },
  'legal-mate-1750.pgn': { result: '1-0', plies: 13, ending: 'checkmate', eco: 'C41', opening: 'Philidor Defense' },
  'short-timman-1991.pgn': { result: '1-0', plies: 67, ending: 'resignation', eco: 'B04', opening: 'Alekhine Defense: Modern Variation, Alburt Variation' },
  'steinitz-bardeleben-1895.pgn': { result: '1-0', plies: 49, ending: 'resignation', eco: 'C54', opening: "Italian Game: Giuoco Piano, Greco's Attack" },
  'rotlewi-rubinstein-1907.pgn': { result: '0-1', plies: 50, ending: 'resignation', eco: 'D32', opening: 'Tarrasch Defense: Symmetrical Variation' },
  'gibaud-lazard-1924.pgn': { result: '0-1', plies: 8, ending: 'resignation', eco: 'A45', opening: 'Indian Defense: Lazard Gambit' },
  'botvinnik-capablanca-1938.pgn': { result: '1-0', plies: 81, ending: 'resignation', eco: 'E40', opening: 'Nimzo-Indian Defense: Rubinstein System' },
  'hamppe-meitner-1872.pgn': { result: '1/2-1/2', plies: 36, ending: 'agreement', eco: 'C25', opening: 'Vienna Game: Hamppe-Meitner Variation' },
};

const DIR = new URL('./fixtures/pgn/', import.meta.url);

describe('PGN replay of master games through GameCore', () => {
  it('every fixture file has an expectation and vice versa', () => {
    expect(fs.readdirSync(DIR).filter((f) => f.endsWith('.pgn')).sort()).toEqual(Object.keys(GAMES).sort());
  });

  for (const [file, exp] of Object.entries(GAMES)) {
    it(`${file}: ${exp.opening}, ${exp.result} by ${exp.ending}`, () => {
      const pgn = fs.readFileSync(new URL(file, DIR), 'utf8');
      const parsed = parsePgn(pgn);
      expect(parsed.headers.Result).toBe(exp.result);
      expect(parsed.moves).toHaveLength(exp.plies);

      const g = new GameCore({ timeControl: null, drawPolicy: 'automatic' });
      g.start(0);
      parsed.moves.forEach((m, i) => {
        const r = g.move(g.turn, { from: m.from, to: m.to, promotion: m.promotion as never }, i + 1);
        expect(r.ok ? r.record.san : r.reason, `ply ${i + 1} ${m.san}`).toBe(m.san);
      });

      // final state, where the position decides it
      if (exp.ending === 'checkmate') {
        expect(g.status).toBe('checkmate');
        expect(resultToken(g.status, g.winner, g.termination)).toBe(exp.result);
        expect(g.lastEvents.some((e) => e.type === 'checkmate')).toBe(true);
      } else {
        // resignation / agreement: the position itself is not terminal, so the core must still be playing
        expect(g.status).toBe('active');
        expect(g.legalMovesUci().length).toBeGreaterThan(0);
      }

      // opening recognition: GameCore's incremental tracking and the whole-history lookup agree
      expect(g.opening?.eco).toBe(exp.eco);
      expect(g.opening?.name).toBe(exp.opening);
      expect(identifyOpening(parsed.moves).opening?.name).toBe(exp.opening);

      // export -> import round-trip
      const out = pgnFromHistory(g.history, { white: parsed.headers.White, black: parsed.headers.Black, result: exp.result, date: new Date(0) });
      expect(parsePgn(out).moves.map((m) => m.san)).toEqual(parsed.moves.map((m) => m.san));
    });
  }

  it('the agreed draw can be completed through GameCore (offer + accept)', () => {
    const parsed = parsePgn(fs.readFileSync(new URL('hamppe-meitner-1872.pgn', DIR), 'utf8'));
    const g = new GameCore({ timeControl: null });
    g.start(0);
    for (const m of parsed.moves) expect(g.move(g.turn, { from: m.from, to: m.to }, 1).ok).toBe(true);
    expect(g.offerDraw('w', 2)).toBe('offered');
    expect(g.acceptDraw('b', 3)).toBe(true);
    expect(resultToken(g.status, g.winner, g.termination)).toBe('1/2-1/2');
  });
});
