# Chess guardian report (stage 1)

Run: 2026-10-04, branch `feature/photorealistic-renderer`, base `340cdfc`. First run of this stage (no earlier report).

## Test counts

| Check | Result |
|---|---|
| `npm test` (TC_STOCKFISH set, live-engine test runs) before this run | 473 passed / 473 |
| `npm test` after this run | **474 passed + 1 expected fail (475)**, 19 files |
| `npm run typecheck` (shared, engine, server, client, learning) | clean, 0 errors |

Floor for the next run: 475 tests (474 passing + BUG-007 pinned as `it.fails`).

## Findings (newest first)

### F1: BUG-007 (Low, open): the league's crash retry re-binds an engine process to a finished game
- `UciLeague.bestMove` (`packages/server/src/uciEngine.ts`, 27d4d00) retries once after a crash by calling
  `acquire(roomId)` again. If `Hub.finished` already called `league.release(roomId)` while the request was in flight
  (resign, flag or abort while the engine thinks or starts), the retry starts a fresh process bound to the finished room.
  Nothing releases it again. Four such leaks fill `maxEngines` (4), and from then on every league move silently falls
  back to Warden until the core restarts. The game result is not affected: the hub drops the move (`status !== 'active'`).
- Evidence: the new test fails with `expected UciEngine{...} to be null` on `lg.engineOf('R1')` after
  `p = lg.bestMove('R1', ...)` (crash-once fake engine), `lg.release('R1')`, `await p`. The no-crash control passes.
- Pinned: `BUG-007` `it.fails` plus a control in `packages/server/test/uci.test.ts`. Documented in docs/KNOWN_LIMITATIONS.md.

### F2: the simulator ignores its "bounded house think-time" (tooling, not a product bug)
- `search()` sets `deadline = opt.nodeLimit ? Infinity : now + timeMs` (`packages/engine/src/search.ts:79`). Every
  house player in `tools/sim/simulate.ts` sets `nodeLimit`, so the `timeMs` values that 594559b lowered
  ("sim: bounded house think-time") have no effect. Only the node caps (4k/15k/40k/80k) apply.
- Evidence: game #4 (house-4 vs house-3, 145 plies) took about 50 min of this batch's 70 min. A CDP stack sample of the
  running sim showed it inside `search -> negamax -> quiesce -> chess.js _moves`, with Stockfish idle.
  Run 2 (seed 23) took 5993 s for 19 games for the same reason.
- Product impact: none. No code in `packages/*/src` passes `nodeLimit`; the hub's house levels use `timeMs`
  (capped by `moveBudgetMs`). Suggestion for the lead: lower the sim node caps, or let `search` honour both limits.

### Commit review (packages/, tools/sim since the start of the branch's chess work)
- 27d4d00 / 7bc5874 (Stockfish league): rules authority stays in GameCore. `leagueMove` only gets a UCI string from
  the engine and submits it through `room.move(aiId, ..., ply)`. A rejected or missing move falls back to the house
  engine, the ply guard drops late replies, and finished positions are never sent (`legalMovesUci().length === 0`).
  Positions go as start FEN plus every move (the engine sees repetitions). UCI_Elo values 1350..2500 are inside
  Stockfish's 1320..3190 range. Timeouts use stop, then kill. The only defect found is F1.
- b072814 (BUG-005/006 fixes): `eventSeq` is persisted and restored with max(). Replayed `clockAfterMs` values are
  cleared. Correct, and covered by the now-passing BUG-005a/b and BUG-006a.
- c0a4784 (rules audit 2 tests) and 594559b (sim): tests only, plus F2.
- Noted, not a bug: a journal record has no start FEN (restore assumes the standard start). That is fine while every
  room starts from the standard position.

## Simulator batch (seed 37, `--games 8`, Stockfish 19 referee per ply)

Total: 13 games in 4193 s, **0 anomalies** (legal-move sets, check/mate/stalemate, fivefold/75-move, insufficient
material, eventSeq, journal restore, PGN round-trip, engine legality).

| Game | White | Black | Plies | Result |
|---|---|---|---|---|
| Fool's Mate | replay | replay | 4 | checkmate 0-1 (expected) |
| Legall's mate | replay | replay | 13 | checkmate 1-0 (expected) |
| Opera Game | replay | replay | 33 | checkmate 1-0 (expected) |
| Immortal Game | replay | replay | 45 | checkmate 1-0 (expected) |
| Evergreen Game | replay | replay | 47 | checkmate 1-0 (expected) |
| #1 A43 Benoni | stockfish-2850 | house-1 | 37 | checkmate 1-0 |
| #2 D83 Grünfeld | stockfish-2200 | house-2 | 101 | checkmate 1-0 |
| #3 B90 Najdorf | stockfish-1350 | house-4 | 44 | checkmate 0-1 |
| #4 D01 Richter-Veresov | house-4 | house-3 | 145 | checkmate 1-0 |
| #5 B06 Modern | house-4 | house-1 | 65 | checkmate 1-0 |
| #6 C60 Ruy Lopez | stockfish-2850 | stockfish-1350 | 55 | checkmate 1-0 |
| #7 D66 QGD Orthodox | stockfish-1900 | house-3 | 49 | checkmate 1-0 |
| #8 C32 KGD Falkbeer | stockfish-1350 | stockfish-1350 | 83 | checkmate 1-0 |

Combined with earlier batches (seed 11: 19 games, seed 23: 19 games): 51 games, 0 anomalies. Every game ended in mate,
so the draw paths (fivefold, 75 moves, dead material) were only checked as "not missed" this time.

## Regression tests added
- `BUG-007: a game released mid-request is not re-bound by the crash retry (no leaked process)`: `it.fails`.
- `BUG-007 control: release without a crash leaves no binding and at most one idle process`: passes.

## Tracked limitations (unchanged, still open)
LIM-001 (dead positions from locked pawns, pinned in fide-cases.core.test.ts), LIM-002..LIM-010 as listed in
docs/KNOWN_LIMITATIONS.md.
