# Chess guardian report (stage 1)

## Run 4: 2026-10-06, base `d466ca1` (BETA focus: G1 + the test-only start position)

### Test counts (G1)
| Check | Result |
|---|---|
| `npm test` with TC_STOCKFISH (`tools/.cache/stockfish/stockfish-linux-x86-64-universal`) | **479 passed / 479**, 19 files (floor 475: met) |
| `npm test` without TC_STOCKFISH | **478 passed + 1 skipped (479)**, 19 files (floor met) |
| `npm run typecheck` (shared, engine, server, client, learning) | clean, 0 errors |

+4 tests since run 3 (server.test.ts: 3 startFen tests; journal.test.ts: 1 restore-from-startFen). Floor for run 5: 479.
No `it.fails` pins are open; BUG-001..008 are fixed and their tests pass in both runs. BETA G1 "met (479/479)": confirmed.

### Commit review (de4a920..d466ca1 touching packages/ and tools/: one commit, 8a3f90e)
**Test-only start position (`CREATE_AI_GAME.startFen`) cannot be used on a normal server: verified.**
- `HubOptions.allowCustomStart` defaults to false (`hub.ts:67`, `opts.allowCustomStart ?? false`). The public server
  (`packages/server/src/index.ts:27`, `new Hub(server, players)`) passes no options, so it is always off there.
- The only place that sets it is the sidecar (`sidecar.ts:62-63`): `allowCustomStart: process.env.TC_ALLOW_START_FEN === '1'`.
  The sidecar listens on `127.0.0.1` only (`sidecar.ts:80`) and needs the per-launch secret.
- The check runs before the FEN is parsed and before any room exists (`hub.ts:294-297`): disabled -> ERROR
  `start_fen_disabled`, invalid -> `bad_fen`, both with `hub.rooms.size === 0` asserted. The schema caps the field at
  100 chars (`protocol.ts:55`). The "refused" test uses a fresh `new Hub(server, players)` per test (beforeEach), so it
  checks the real default, not a flag left on by an earlier test.
- Only `CREATE_AI_GAME` accepts it (AI games are unrated: `createRoom(tc, false, ...)`), and the opening book is only
  used from the standard start (`game.ts:192`). Journal records keep `startFen`, and restore replays from it.
- Rules authority is unchanged: the FEN only seeds `GameCore`; every move still goes through `GameCore`.

#### F1 (Low, UE client, no rules impact): the packaged game honours `-tcallowstartfen`
`TCLocalCore.cpp:94` sets `TC_ALLOW_START_FEN=1` from the command line in every build configuration, including
Shipping, and it sets it process-wide. Two lines above, the comment says "Nothing goes through the environment
(it is process-wide and inherited by every child ...)". A player can only start their own local AI game from a set
position (unrated, loopback core), so this is not a fairness hole. Still, it contradicts the file's own rule.
Suggested: wrap it in `#if !UE_BUILD_SHIPPING` and pass `--allow-start-fen` as a sidecar argument instead of using the
environment. Not pinned: no test harness for the UE client runs on this host.

### Simulator batch (seed 104, `--games 8`, Stockfish referee per ply)
**13 games in 544 s, 0 anomalies.** First batch that draws house-3 and house-4 (the run-3 gap).

| Game | White | Black | Plies | Result |
|---|---|---|---|---|
| 5 classics (Fool's, Legall, Opera, Immortal, Evergreen) | replay | replay | 4/13/33/45/47 | checkmate (expected) |
| #1 C37 King's Gambit, Kotov | stockfish-2850 | stockfish-2200 | 99 | checkmate 1-0 |
| #2 B58 Sicilian Classical | stockfish-1350 | house-1 | 51 | checkmate 1-0 |
| #3 C34 KGA Gianutio | house-2 | stockfish-1900 | 60 | checkmate 0-1 |
| #4 D35 QGD Exchange, Saemisch | house-2 | house-1 | 245 | checkmate 1-0 |
| #5 E34 Nimzo Classical, Belyavsky | house-3 | stockfish-1900 | 42 | checkmate 0-1 |
| #6 B07 Lion, Bayonet | stockfish-1900 | house-3 | 61 | checkmate 1-0 |
| #7 A98 Dutch Ilyin-Zhenevsky | stockfish-2500 | stockfish-2500 | 90 | checkmate 0-1 |
| #8 C27 Vienna Frankenstein-Dracula | house-4 | stockfish-2850 | 50 | checkmate 0-1 |

Game #4 (245 plies, house vs house) ran long without reaching the 75-move rule. No sim has produced a stalemate,
repetition or 75-move ending yet; unit tests cover all three. Running total: 86 games, 0 anomalies.

### Regression tests added
None. No new rules bug was found. F1 is a client hardening item, and the lead fixes it (product code).

---


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

## Run 2: 2026-10-04, base `be79b31`, condensed
475/475 with TC_STOCKFISH, 474 + 1 skipped without; BUG-007 fix (7cdc067) reviewed correct; sim seed 41: 9 games, 0 anomalies.

## Run 1 (base `340cdfc`), condensed
- Tests went from 473 to 475 (BUG-007 pinned as `it.fails`; fixed in 7cdc067, see run 2). Typecheck clean.
- F1 BUG-007: the league's crash retry re-bound an engine to a finished game. Fixed.
- F2: the sim ignored house `timeMs` whenever `nodeLimit` was set (`search.ts:79`). Addressed by node budgets (f895b14).
- Sim seed 37: 13 games in 4193 s, 0 anomalies, all mates.
