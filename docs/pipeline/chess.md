# Chess guardian report (stage 1)

## Run 3: 2026-10-05, base `de4a920` (milestone "gameplay feel + reference HUD + packaged build")

### Test counts
| Check | Result |
|---|---|
| `npm test` with TC_STOCKFISH (live-engine test runs) | **475 passed / 475**, 19 files (floor 475: met) |
| `npm test` without TC_STOCKFISH | **474 passed + 1 skipped (475)**, 19 files (floor met) |
| `npm run typecheck` (shared, engine, server, client, learning) | clean, 0 errors |

Floor for run 4: 475. No tests were added or removed this run (the new bug lives in the UE client, see F1).

### Commit review
- `git log be79b31..de4a920 -- packages tools` is **empty**: the 23 commits since run 2 touch only `ue5/` and
  `docs/`. GameCore, the protocol, the house engine and the league are unchanged, so rules authority is unchanged.
- The UE client still submits every move through the core: `ATCBoard::ClickSquare`, `EndDrag` and
  `ChoosePromotion` call `UTCCoreClient::SubmitMove`. The new drag code only moves meshes locally until the core
  answers (`DroppedFrom`, `SnapBack`), and `IsInSync()` still rebuilds from the authoritative FEN after animations.
- The smoke fix (TCGame.cpp:203: `LeaveGame` then `TryAutoStart` when a restored game refused the auto-start) is a
  client flow change. It does not touch rules.

### Simulator batch (seed 73, `--games 8`, Stockfish referee per ply)
**13 games in 142 s (wall 2 min 26 s), 0 anomalies.** First non-mate ending since run 1.

| Game | White | Black | Plies | Result |
|---|---|---|---|---|
| 5 classics (Fool's, Legall, Opera, Immortal, Evergreen) | replay | replay | 4/13/33/45/47 | checkmate (expected) |
| #1 A57 Benko, Zaitsev | stockfish-2500 | stockfish-2850 | 84 | checkmate 0-1 |
| #2 B44 Sicilian Taimanov | stockfish-2500 | house-1 | 59 | checkmate 1-0 |
| #3 B28 Sicilian O'Kelly | stockfish-1600 | stockfish-2200 | 114 | checkmate 0-1 |
| #4 A00 Grob, Romford | stockfish-2850 | stockfish-2850 | 112 | checkmate 0-1 |
| #5 C40 Damiano Gambit | stockfish-2200 | stockfish-2200 | 59 | checkmate 1-0 |
| #6 E80 KID Saemisch | house-2 | stockfish-1350 | 178 | checkmate 0-1 |
| #7 B90 Najdorf, Adams | house-1 | stockfish-1900 | 86 | checkmate 0-1 |
| #8 C10 French, Marshall Gambit | stockfish-2200 | stockfish-2200 | 146 | **draw_insufficient** 1/2-1/2 |

Game #8 runs the insufficient-material path end to end, and GameCore and the referee agree on it. Still no house-3
or house-4 player drawn, and no stalemate, repetition or 75-move ending. Running total: 73 games, 0 anomalies.

### Findings
#### F1: BUG-008 (Low, open, UE client): cancelling a drag-to-promotion leaves the pawn on the promotion square
- `ATCBoard::EndDrag` (TCBoard.cpp ~506) snaps the piece back on every result except `Submitted` and
  `NeedsPromotion`. On `NeedsPromotion` the pawn stays where it was dropped, and `DroppedFrom` is not set.
- `ChoosePromotion("")` (Escape) clears the picker state but never calls `SnapBack`. `IsInSync()` compares the codes
  on each square, not mesh positions, so the resync does not repair it.
- On a confirmed promotion the flight starts from `LocalOf(From)`, so the pawn visibly jumps back one rank first.
- Rules are unaffected, because the core never saw a move. Found by code review only. It was not reproduced, because
  Unreal cannot run here.
- Not pinned: no test harness for the UE client runs on this host. `autotest.py` calls `board.choose_promotion`
  directly (~406) and never drags to the last rank, presses Q/R/B/N/Escape or cancels. Documented in
  docs/KNOWN_LIMITATIONS.md with a fix idea and the autotest step that would catch it.

#### F2: the key handler slip of 2071f72 is repaired, but nothing would catch it again
- `ATCPlayerController::OnKey` at de4a920 is byte-identical to 2071f72~1 (32 lines). In 2071f72 its body had been
  replaced by the promotion-picker drawing code. That code uses `Canvas`, `U2` and `Plate`, which the controller does
  not have, so 2071f72 could not compile (its message says "not yet compiled"). 7374e09 restored the handler.
- No autotest drives keys: `autotest.py` has no Tab, promotion-key or join-code typing step. The cpu, rematch and
  drag autotest counts quoted for this milestone were run before the HUD commits. Suggested: a `keys` scenario
  that sends Tab, Escape and Q through `InputKey`, then checks the clipboard and the promotion result.

LIM-001..LIM-011 are unchanged. BUG-001..007 stay fixed, and their tests pass in both runs.

---

## Run 2: 2026-10-04, base `be79b31` (light run: only the commits since run 1, c791d46)

### Test counts
| Check | Result |
|---|---|
| `npm test` with TC_STOCKFISH (live-engine test runs) | **475 passed / 475**, 19 files (floor 475: met) |
| `npm test` without TC_STOCKFISH | **474 passed + 1 skipped (475)**, 19 files (floor met) |
| `npm run typecheck` (5 packages) | clean, 0 errors |

BUG-007 is now a normal passing test (was `it.fails`), so the count stays 475. Floor for run 3: 475.

### Commit review
- **7cdc067 (BUG-007 fix, `packages/server/src/uciEngine.ts`)**: correct. `release()` bumps a per-room generation;
  `bestMove` captures it up front and returns null when it changed, both before each attempt (so the crash retry no
  longer re-acquires) and right after `acquire` (if the release landed during `newGame`, the engine is unbound and
  returned to idle). `unbind` only deletes the room binding if it still points at that engine and guards against a
  duplicate idle entry (release and the stale path can both unbind the same engine). A release during the think puts
  a still-busy engine on the idle list, but `UciEngine` serialises commands (`serial()`), so the next game's
  `ucinewgame` waits for the pending `bestmove`; no protocol interleaving. Rules authority is untouched: the league
  still only returns a UCI string to the hub, which submits it through GameCore.
  The test now asserts no binding for R1, at most 1 process, and that R2 can get an engine afterwards.
  Nit (no finding): `gens` is never pruned, one number per room id ever released. Negligible unless room ids are
  unbounded over a very long uptime.
- **f895b14 (sim node budgets)**: house-3 40k -> 12k nodes, house-4 80k -> 25k. Tooling only; addresses run 1's F2.
  The `timeMs` values are still dead in the sim (`search.ts:79` ignores them whenever `nodeLimit` is set); the comment
  now says so. No product code changed.

### Simulator batch (seed 41, `--games 4`, Stockfish referee per ply)
**9 games in 27 s (wall 32.8 s incl. startup), 0 anomalies.** Run 1 took 4193 s for 13 games.

| Game | White | Black | Plies | Result |
|---|---|---|---|---|
| 5 classics (Fool's, Legall, Opera, Immortal, Evergreen) | replay | replay | 4/13/33/45/47 | checkmate (expected) |
| #1 C41 Philidor, Exchange | stockfish-1600 | stockfish-1900 | 68 | checkmate 0-1 |
| #2 C40 Latvian Gambit Accepted | stockfish-2500 | stockfish-1350 | 31 | checkmate 1-0 |
| #3 D31 QGD Janowski | stockfish-1350 | house-1 | 49 | checkmate 1-0 |
| #4 B21 Smith-Morra, Siberian | stockfish-1900 | stockfish-1350 | 103 | checkmate 1-0 |

Caveat: this seed drew no house-3 or house-4 player, so the speed-up of the new node budgets is not measured
directly here; most of the gain is that no long house-vs-house game was drawn. Running totals: 60 games, 0 anomalies.
Again every game ended in mate, so the draw paths were only checked as "not missed".

### Findings
None new. BUG-007 is fixed (verified by review and the passing test). F2 from run 1 is addressed in the sim.
No regression tests added this run. LIM-001..LIM-010 unchanged.

---

## Run 1 (base `340cdfc`), condensed
- Tests went from 473 to 475 (BUG-007 pinned as `it.fails`; fixed in 7cdc067, see run 2). Typecheck clean.
- F1 BUG-007: the league's crash retry re-bound an engine to a finished game. Fixed.
- F2: the sim ignored house `timeMs` whenever `nodeLimit` was set (`search.ts:79`). Addressed by node budgets (f895b14).
- Sim seed 37: 13 games in 4193 s, 0 anomalies, all mates.
