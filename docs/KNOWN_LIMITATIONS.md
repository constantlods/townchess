# Known limitations and open chess bugs

This is the registry of everything TownChess's chess core is known to get wrong, or deliberately does differently
from FIDE. The rule is that **an entry is never deleted**. When an item is solved, its status changes to
`resolved (date, change)` and its test is flipped. That way the history of a problem stays readable.

Every entry has:
- an id;
- what is wrong;
- the FIDE reference;
- a reproduction: a FEN plus moves;
- the test that pins it;
- why it is still open;
- the plan to resolve it.

How tests pin an entry:
- **Bugs** (`BUG-*`) are `it.fails` tests in `packages/shared/test/regressions.test.ts` or
  `packages/engine/test/search.test.ts`. Each one asserts the *correct* behaviour, so it fails today and the suite
  stays green. Once the fix lands, vitest reports the test as unexpectedly passing. Flip it to `it`.
- **Limitations** (`LIM-*`) are plain tests in `packages/shared/test/limitations.test.ts`, or the `KNOWN_LIMITATIONS`
  map in `fide-cases.core.test.ts`. These pin today's behaviour, so changing that behaviour is a visible decision.

The workflow behind this file is in [ENGINE_AGENT.md](ENGINE_AGENT.md).

| Id | Area | Severity | Status |
| --- | --- | --- | --- |
| [LIM-001](#lim-001) | Dead positions from locked pawns | Medium (wrong result in rare endgames) | Open, tracked until really solved |
| [LIM-002](#lim-002) | FIDE 9.5.3 incorrect claim | Low (deliberate deviation) | Open, by design |
| [LIM-003](#lim-003) | Multi-piece material classes not proven | Low | Open |
| [LIM-004](#lim-004) | No lag compensation on flag fall | Medium (online fairness) | Open, Milestone 6 decision |
| [LIM-005](#lim-005) | chess.js en passant repetition hash | High if used, so it is never used | Worked around |
| [LIM-006](#lim-006) | Claims about a position after the opponent's reply | Informational | Not planned |
| [LIM-007](#lim-007) | Cost of verbose move generation | Performance | Open |
| [BUG-001](#bug-001) | Castling rights from a start FEN not checked against the rooks | Medium (illegal castling) | **Fixed 2026-10-03** (regression test now a normal passing test) |
| [BUG-002](#bug-002) | Promotion piece accepted on a non-promotion move | Low | **Fixed 2026-10-03** (regression test now a normal passing test) |
| [BUG-003](#bug-003) | Start FEN already past 75 moves is not ended | Low | **Fixed 2026-10-03** (regression test now a normal passing test) |
| [BUG-004](#bug-004) | House engine noise picks among fail-low bounds | Medium (Novice/Patient hang mate in one) | **Fixed 2026-10-03** (regression test now a normal passing test) |
| [BUG-005](#bug-005) | `eventSeq` goes backwards across a journal restore | Medium (clients drop real events after a restart) | Fixed |
| [BUG-006](#bug-006) | Restored history carries fabricated `clockAfterMs` | Low (wrong clock annotations) | Fixed |
| [LIM-008](#lim-008) | Lenient FEN castling field (X-FEN/Shredder letters ignored) | Low | Open, documented |
| [LIM-009](#lim-009) | What a journal restore does not bring back | Low/informational | Open, documented |
| [LIM-010](#lim-010) | League (Stockfish) opponents: strength labels and fallbacks | Low/informational | Open, documented |
| [LIM-011](#lim-011) | Annotator's oversleeves do not render; all characters share one MetaHuman (Walter) | Low (visual) | Open |
| [BUG-007](#bug-007) | League crash retry re-binds an engine to a finished game | Low (engine slot leak; league can silently degrade to Warden) | Fixed |
| [BUG-008](#bug-008) | UE board: a pawn dragged to the last rank stays where it was dropped if the promotion is cancelled | Low (shown board differs from the authority; rules unaffected) | Open (found by code review, not yet reproduced in UE) |

---

## LIM-001

**Dead positions caused by pawn structure are not detected.**

- **FIDE:** 5.2.2 (dead position) and 6.9 (flag fall when the opponent cannot mate by any series of legal moves).
- **What happens:** `isDeadByMaterial` and `canPossiblyMate` decide by material class only.
  - A fully locked pawn wall with no possible capture is a dead position, but GameCore plays on.
  - On flag fall in such a position GameCore scores a **win** where FIDE gives a **draw**.

**Reproduction.** Three fixture cases, with no setup moves:

| Fixture | FEN | Expected |
| --- | --- | --- |
| `dead-locked-pawn-wall` | `4k3/8/8/1p1p1p1p/pPpPpPpP/P1P1P1P1/8/4K3 w - - 0 1` | dead position |
| `dead-locked-wall-with-trapped-bishop` | `4k3/8/8/1p1p1p1p/pPpPpPpP/P1P1P1P1/8/2B1K3 w - - 0 1` | dead (the bishop is shut in) |
| `timeout-locked-wall-draw` | the first FEN, Black flags | draw, not a loss |

- **Pinned by:** `KNOWN_LIMITATIONS` in `packages/shared/test/fide-cases.core.test.ts`. That test fails if these cases
  start passing, or if they fail for any other reason.
- **Why it's unresolved:**
  - Proving deadness needs a search over reachable positions. The rules agent's prototype takes up to about 2 s,
    which is too slow for the server's move path.
  - The search must also be **deterministic** (node-capped, never time-capped), or two clients could disagree.
- **Plan:**
  1. Write a cheap precondition: no capture is possible for either side in any reachable pawn configuration, and
     every pawn is blocked. This rejects almost every real position in microseconds.
  2. When the precondition holds, run a node-capped reachability search on the engine worker pool. It returns
     `dead`, `alive` or `unknown`. Only `dead` changes the result.
  3. Feed the answer to GameCore through an injected, deterministic oracle. The rules keep one code path, and an
     `unknown` keeps today's behaviour.
  4. Flip the three fixtures. Add the prototype's hardest positions as new fixtures.

## LIM-002

**An incorrect draw claim with an intended move is simply rejected.**

- **FIDE:** 9.5.3. An incorrect claim makes the intended move compulsory and gives the opponent 2 extra minutes.
- **Reproduction:**
  - Start position, `drawPolicy: 'claim'`, 3+0, with no first-move window.
  - Play 1.Nf3 Nf6.
  - White then claims with the intended move `f3g1`.
  - The result is `'no draw to claim'`. Board, history and clocks are unchanged, and the game continues.
- **Pinned by:** `LIM-002` in `packages/shared/test/limitations.test.ts`.
- **Why it's unresolved:** this is a deliberate online simplification. Forcing a written move and adjusting the clock
  only makes sense with an arbiter, and online play has none. It is documented in docs/CHESS.md.
- **Plan:** none for online play. If an over-the-board / arbiter mode is ever built, implement 9.5.3 behind
  `drawPolicy: 'claim'` and update the test.

## LIM-003

**Multi-piece material classes are decided by class, not proven by enumeration.**

- **FIDE:** 6.9 and 5.2.2 ("cannot checkmate by any possible series of legal moves").
- **What happens:** `canPossiblyMate` uses the lichess/scalachess material classes.
  - Single-piece cases are proven by exhaustive enumeration: no mate exists for N vs Q, B vs R or B vs Q.
  - Combinations with more pieces follow the same classes, but nobody has enumerated them.
- **Reproduction:** each line is a material set, the side asked about, and today's answer.

| Material | Side | Answer today |
| --- | --- | --- |
| `wke1 wbc1 bke8 bra8 brh8` (B vs R+R) | White | cannot mate |
| `wke1 wbc1 bke8 bqd8 bra8` (B vs Q+R) | White | cannot mate |
| `wke1 wnb1 bke8 bqd8 bqa8` (N vs Q+Q) | White | cannot mate |
| `wke1 wbc1 wbe3 bke8 bra8` (same-coloured B+B vs R) | White | cannot mate |
| `wke1 wnb1 bke8 bqd8 bra8` (N vs Q+R) | White | **can** mate (the rook can block) |

- **Pinned by:** `LIM-003` in `packages/shared/test/limitations.test.ts`. Today's answers are pinned, so any change
  to them is deliberate.
- **Why it's unresolved:** the five-man and six-man enumerations (about 10⁹ placements) are offline jobs, not unit
  tests.
- **Plan:**
  1. Build an offline native enumerator in `tools/`. For each multi-piece class, search for any checkmate position
     with that material.
  2. Commit its results as fixtures with the counts.
  3. Every class with no mate position is then proven. Any class where a mate exists becomes a new BUG entry.

## LIM-004

**There is no lag compensation on flag fall.**

- **FIDE:** 6.9, which assumes a physical clock with no network in between.
- **Reproduction:**
  - Use a 10+0 clock with no first-move window.
  - Play 1.f3 e5 2.g4, all at t=0.
  - Black plays 2...Qh4# at t=10 001 ms.
  - The move is rejected and Black loses on time, although the move is checkmate.
- **Pinned by:** `LIM-004` in `packages/shared/test/limitations.test.ts`.
- **Why it's unresolved:** compensation is a fairness policy, not a rule. Possible approaches are a per-move lag
  allowance, client-reported think time bounded by the server, or a quota like lichess has. Each one needs telemetry
  on real latency first.
- **Plan:** Milestone 6 decision (docs/NETWORKING.md).
  - Whatever is chosen stays inside GameCore's injected time, so it remains deterministic and testable.
  - When it lands, this test changes to assert the new allowance.

## LIM-005

**chess.js counts an impossible en passant in its repetition hash.**

- **FIDE:** 9.2.3. Positions are the same if the same moves are possible; an en passant right counts only if the
  capture is legal.
- **What happens:** chess.js 1.4 hashes the ep square whenever an enemy pawn merely stands next to the pushed pawn,
  even when the capture is illegal (for example, the capturing pawn is pinned). So `isThreefoldRepetition()` misses
  real threefolds.
- **Reproduction:** `3r2nk/2p5/8/3P4/8/8/8/3K2N1 b - - 0 1` followed by
  `c7c5 g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8`. This is threefold, but chess.js says no.
- **Pinned by:** the fixture `repetition-illegal-ep-does-not-differ`, which runs against both chess.js and GameCore.
- **Status:** worked around.
  - GameCore never uses chess.js repetition detection; it counts `positionKey`s itself.
  - The entry stays open because a chess.js upgrade must be re-checked against the fixture.
- **Note:** the house engine's search calls `chess.isDraw()`, which uses that hash. That only affects engine
  evaluation, never the rules, but Layer B audits should know about it.
- **Plan:** keep the work-around. On any chess.js upgrade, run the fixture and the perft suite first.

## LIM-006

**Claims about a position that would arise after the opponent's reply are not modelled.**

- **FIDE:** 9.2.1 only allows the current position, or the one after the claimant's own intended move. Our
  behaviour therefore matches FIDE; this entry is listed because docs/CHESS.md mentions it.
- **Pinned by:** none. There is no FIDE requirement to pin.
- **Plan:** none.

## LIM-007

**Verbose move generation is expensive.**

This is a performance limitation, not a correctness one.

- **What happens:** `chess.moves({ verbose: true })` costs about **0.8 ms** per call in the start position. The plain
  form costs about **0.065 ms**, roughly 12 times less. The difference is that each verbose Move carries before/after
  FENs.
- **Where it costs:**
  - `GameCore.legalMovesUci()` on every snapshot and broadcast.
  - `positionKey` when an ep square is present.
  - `isPromotionMove`, which runs twice per `GameCore.move`.
  - The house engine, which runs at only about **1–2 thousand nodes per second**.
- **Measured on:** the audit run on 2026-10-03, which took about 3.7 ms per ply through GameCore.
- **Pinned by:** none (performance). The perft and property test budgets document the cost.
- **Plan:**
  - Cache the legal-move list per position inside ChessRules, invalidated on move or undo.
  - Derive UCI from the non-verbose generator, or from chess.js internals behind the wrapper.
  - The engine should not use verbose moves in its inner loop.
  - Re-run perft after any change: this is exactly the kind of change perft exists to catch.

---

## BUG-001

**Castling rights in a start FEN are not checked against the king and rooks.**

- **FIDE:** 3.8.2. Castling needs a king and rook that have not moved, so a right without its rook does not exist.
- **What happens:** chess.js 1.4 trusts the FEN castling field.
  - With `K` and no rook on h1, it still generates O-O.
  - With a **bishop** on h1, it "castles" and carries the bishop to f1, while our `effects` describe a rook move.
  - Impossible rights also become part of `positionKey`. A start position with bogus `KQkq` therefore never matches
    the same position later, and repetition is under-counted.
- **Reproduction:**

| Test | FEN | Moves | Result |
| --- | --- | --- | --- |
| 001a | `4k3/p7/8/8/8/8/8/4K3 w K - 0 1` | none | `e1g1` is legal |
| 001b | `4k3/p7/8/8/8/8/8/4K2B w K - 0 1` | none | `e1g1` is legal and moves the bishop |
| 001c | `4k3/p7/8/8/8/8/P7/R3K2R w KQkq - 0 1` | 1.a3 | Black may play `e8c8` with no rook on a8 |
| 001d | `4k3/p7/8/8/8/8/P7/4K3 w KQkq - 0 1` | `e1d1 e8d8 d1e1 d8e8`, twice | the third occurrence is not threefold under the automatic policy |

- **Reach:**
  - Any custom `startFen`: LocalSession offline play today, and later puzzles and PGN import with `[SetUp "1"]`
    (`parsePgn`, and `ingestGame` in @hc/learning).
  - The server does not accept a custom start FEN today.
- **Pinned by:** `BUG-001a`–`d` (`it.fails`), plus a control test showing that legitimate rights must keep working.
  All are in `packages/shared/test/regressions.test.ts`.
- **Fix (for the lead):** in `ChessRules`' constructor, either:
  - reject the FEN; or
  - strip every castling right whose king is not on e1/e8 or whose rook is not on the matching corner square, then
    reload.

  Either fix flips the tests. Stripping is friendlier for imported PGNs.

## BUG-002

**A promotion piece on a non-promotion move is silently accepted.**

- **FIDE:** 3.7(e) by analogy. The authority should accept exactly the legal moves it advertises.
- **What happens:**
  - `GameCore.move('w', { from: 'e2', to: 'e4', promotion: 'q' })` succeeds and plays e2-e4, although `e2e4q` is not
    in `legalMovesUci()`.
  - The same happens with `ChessRules.tryMove({ from: 'g1', to: 'f3', promotion: 'n' })`.
  - The cause is that chess.js 1.4 ignores `promotion` when the matched move is not a promotion.
  - The protocol's zod schema allows `promotion` on any MOVE, so a client can send this.
- **Reproduction:** start position, then `move('w', e2e4 + promotion q)`. The result is `ok: true`.
- **Impact:** the board is unharmed, because the record carries no promotion. But the authority is lenient where it
  should be strict, and replays of client input could disagree with what `legalMoves` said.
- **Pinned by:** `BUG-002a` and `BUG-002b` (`it.fails`), plus a control test.
- **Fix (for the lead):** in `ChessRules.tryMove`, reject the move when `input.promotion` is set and the move is not
  a promotion.

## BUG-003

**A start FEN whose halfmove clock is already 150 is not ended at the start.**

- **FIDE:** 9.6.2.
- **What happens:** `GameCore.start()` ends a custom start position that is checkmate, stalemate or dead by material,
  but it doesn't apply the halfmove-clock rules.
  - The 75-move draw happens only if the first move is quiet.
  - If the first move is a pawn move or capture, the clock resets and the draw is lost.
  - The same gap exists for the automatic fifty-move draw at a clock of 100 or more.
- **Reproduction:** `4k3/p7/8/8/8/8/P7/R3K3 w - - 150 200`. After `start()` the status is `active`. After 1.a3 it is
  still `active`.
- **Pinned by:** `BUG-003a` (`it.fails`), plus a control test showing today's after-move behaviour.
- **Fix (for the lead):** in `start()`, after the dead-material check:
  - finish as `draw_seventyfive` when the clock is 150 or more;
  - under the automatic policy, finish as `draw_fifty` when the clock is 100 or more.

## BUG-004

**The house engine's noise window picks among fail-low bounds.**

This is in the engine (Layer B), not in the rules.

- **What happens:**
  - `packages/engine/src/search.ts` scores root moves with a narrowed window,
    `-negamax(d-1, -Infinity, -alpha + 1)`, and the quiescence search is fail-hard.
  - Every root move worse than the current best therefore comes back as about `alpha - 1`: an upper bound, not its
    value.
  - The noise filter, `s.v >= scored[0].v - noise`, then keeps nearly **every** move.
  - Novice (noise 60) and Patient (noise 25) choose uniformly among them, including moves that hang mate in one.
- **Reproduction:** after 1.e4 e5 2.Qh5 Nc6 3.Bc4, FEN
  `r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3`, using
  `search(fen, { ...AI_LEVELS.patient, nodeLimit: 20000, seed })` for seeds 1–40:
  - Black allowed Qxf7# in **26 of 40** games, with 19 different replies.
  - Novice produced the identical distribution.
  - Warden (noise 0) played 3...g6 in all 40.
- **Pinned by:** `BUG-004` (`it.fails`) in `packages/engine/test/search.test.ts`. It uses seeds 1–4 at
  `nodeLimit: 2048`.
- **Fix (for the lead or the engine owner):** when `noise > 0`, give each root move an exact score before applying
  the window. The usual approach is a full-window re-search of each candidate, or MultiPV-style search of the top N.
  The alternative is to apply noise to the evaluation rather than to the selection. Strength labels must be re-checked
  afterwards (docs/AI.md).

## BUG-005

**`eventSeq` goes backwards when the server restores a game from its journal.**

- **Contract:** `GameStateDTO.eventSeq` (types.ts): "a client must act on lastEvents only when eventSeq is new to it".
- **What happens:** `RoomRecord` does not store `eventSeq`, and `GameCore.restore` re-derives it from the replayed
  moves only. Every non-move `setEvents` (draw offer, decline) is lost. After a restart the sequence is lower than what
  the clients saw, and the next real events reuse numbers the clients treat as already processed.
- **Reproduction (untimed room, automatic policy):** 1.e4 (seq 1), Black offers a draw (seq 2), White declines (seq 3),
  `record()` → JSON → `fromRecord()`: seq is **1**. Then 1...e5 gets seq **2**, which is below 3.
- **Pinned by:** `BUG-005a` and `BUG-005b` (`it.fails`) in `packages/server/test/journal.test.ts`. A control checks
  that the original sequence is 3.
- **Fixed:** `RoomRecord.eventSeq` (optional, absent in older journals) is saved and `GameCore.restore` takes the max of
  it and the replayed value. BUG-005a/b are now normal tests.

## BUG-006

**A restored history carries fabricated `clockAfterMs` values.**

- **What happens:** `restore` replays on a synthetic timeline (`now` = ply index in ms). Every replayed `MoveRecord`
  gets `clockAfterMs` = initial + increments − about 1 ms, instead of the time the player really had. These values reach
  clients in `moveHistory`. A restored list that ends the game also leaves the synthetic clocks in place.
- **Reproduction:** a 60+1 game, `firstMoveMs: null`, 1.e4 at 5 s, 1...e5 at 12 s, 2.Nf3 at 20 s, 2...Nc6 at 41 s.
  The live history clocks are `[56000, 54000, 49000, 34000]`. After restore, ply 1 is **61000**.
- **Pinned by:** `BUG-006a` (`it.fails`, plus a control) in `packages/shared/test/regressions.test.ts`.
- **Fixed:** `restore` clears `clockAfterMs` on replayed moves (the journal has no per-move clocks; storing them is a
  possible later improvement). BUG-006a is now a normal test.

## LIM-008

**The FEN castling field is parsed leniently.**

`sanitizeCastling` keeps only the letters `KQkq` whose king and rook are on their home squares, and chess.js 1.4.0
normalises the order. Pinned in `regressions.test.ts` ("sanitizeCastling FEN edge cases"):
- Any order is accepted: `qK` becomes `Kq` and `kqKQ` becomes `KQkq`. Duplicates collapse (`KK` becomes `K`).
- Invalid characters are **dropped, not rejected**: `KQx` becomes `KQ`, and `KQkq3` becomes `KQkq`.
- **X-FEN/Shredder letters (`HAha`, `AHah`, `Hh`) are ignored**, so every castling right is silently lost. A
  Chess960-style FEN imported from another tool would play without castling.
- En passant: a square with no capturing pawn becomes `-`. A capturable one is kept and playable. A square on the
  wrong rank for the side to move throws.
- Extra whitespace and missing clock fields are tolerated.
- **Plan:** a decision for the lead. Either reject unknown letters (constructor throws), or map `H`/`A` to `K`/`Q`
  when the rook is on h/a. In either case, flip the LIM-008 pin.

## LIM-009

**What a journal restore does not bring back.** Pinned in `packages/server/test/journal.test.ts`:
- A pending draw offer is dropped.
- A draw that was claimed is not in the move list. This is harmless: the room is then finished and is not restored.
- An `active` record whose moves already end the game comes back finished. `hub.restoreJournal` then deletes the file
  without recording the result or the rating. This is reachable only if the final journal write was lost.
- Time between the last journal write and the crash is given back to the side to move (clocks come from `record()`).
- Resolved by e819a2a: the first-move window is now restored when fewer than two moves were played. This is pinned
  as a control.

## LIM-010

**League (Stockfish) opponents: what the labels and the fallbacks mean.** Pinned in `packages/server/test/uci.test.ts`.
- **Strength labels are the engine's setting, not a measurement.** `sf1600` means Stockfish with `UCI_LimitStrength`
  and `UCI_Elo 1600`. Stockfish calibrates that scale at 120s+1s against CCRL 40/4; TownChess plays it with 0.6 to
  1.5 s per move (less on a low clock), so real strength can differ from the number. No TownChess calibration exists.
  The house levels still claim no Elo at all.
- **A failed engine move is replaced silently for the player.** On a timeout, crash, missing reply or a move GameCore
  rejects, the house engine (Warden) plays that one move, which is weaker than the chosen level. It is logged on the
  core (`[hub] league engine ...`) and counted in `Hub.leagueFallbacks`, but not shown to the client.
- **Restarts lose engine state.** A crashed engine, or a journal-restored game after a core restart, gets a fresh
  process (empty hash, `ucinewgame`). Positions are always sent as start FEN plus every move, so the engine still
  sees the whole game, including repetitions.
- **Capacity.** At most 4 engine processes per core; a fifth league game is refused with `ERROR busy`.
- **Availability is decided by file discovery.** A binary that exists but cannot start is only detected on first
  use; after three failed starts in a row the league levels stop being offered (until the core restarts).

## BUG-007

**The league's crash retry re-binds an engine process to a game that has already ended.** Fixed: `release()` bumps a per-game generation; a request started before the release never re-binds (the BUG-007 test is now a normal test).

- **Where:** `UciLeague.bestMove` in `packages/server/src/uciEngine.ts` (commit 27d4d00).
- **What happens:** `Hub.finished` calls `league.release(roomId)` when a game ends, which can happen while an engine
  request is in flight (resign, flag fall or abort during the engine's think, or during the first move's process
  start). If that request then hits a crash, the retry loop calls `acquire(roomId)` again for the released room and
  starts a fresh process bound to it. Nothing ever releases it: `finished` has already run. The process stays alive
  and counts towards `maxEngines` (4); after four such leaks `acquire` returns null for every game, so every league
  move silently falls back to the house engine (Warden) until the core restarts. The hub discards the retried move
  (`room.status !== 'active'`), so the game itself is not affected.
- **Reproduction:** `new UciLeague(fake('crash-once'))`; `p = lg.bestMove('R1', 'sf1350', START, 50)`;
  `lg.release('R1')`; `await p` -> `lg.engineOf('R1')` is a live engine and `lg.processes` is 1 (expected null / 0).
- **Pinned by:** `BUG-007` in `packages/server/test/uci.test.ts`, now a normal test (fixed in 7cdc067): no binding to the finished game and the slot is reused.
- **Fix idea (for the lead):** remember released room ids (or a per-request generation) and do not retry, or release
  again, when the room was released during the request.


## LIM-011

**Character art gaps (visual, not rules).** The Annotator's Blender oversleeves are attached to the forearm bones but
do not show in captures (the seated pose puts the elbows below the table top; under investigation). The caged
patient, the Annotator and the player's own first-person arms all use the same MetaHuman (Epic's Walter preset), and
the player's arms wear the patient's shirt. The generated hand vein/dirt decals (`ue5/tools/textures/hands.py`) are off by default: in pipeline run 2 they were
bisected as the cause of a 2x exposure jump (frame mean 39 -> 85) and looked weak on curved skin; hand veins wait for the
MetaHuman 8K skin textures (an owner action in the editor). Each character needs its own MetaHuman (one cloud auto-rig per character
in the owner's editor) before player character/hands selection can ship.

## BUG-008

**UE client: cancelling the promotion picker after a drag leaves the pawn floating on the promotion square.**
Found by the chess guardian (run 3) by reading the code; not reproduced in Unreal (the pipeline host cannot run it).

- **Where:** `ATCBoard::EndDrag` and `ATCBoard::ChoosePromotion` in
  `ue5/TownChess/Source/TownChess/Private/TCBoard.cpp` (drag-and-drop, commit 5213cea).
- **What happens:** `EndDrag` snaps the piece back for every result except `Submitted` and `NeedsPromotion`. For
  `NeedsPromotion` the pawn stays at the drop point while the picker is shown, and `DroppedFrom` is not set.
  - Escape (or `promo_` with an empty piece) calls `ChoosePromotion("")`, which clears `PromotionFrom/To` and the
    selection but never moves the pawn back. It is drawn on the 8th rank while the authority has it on the 7th.
  - `IsInSync()` compares piece codes per square, not positions, so the end-of-animation resync does not repair it.
  - If the promotion is confirmed instead, the move animation starts at `LocalOf(From)` (no `DroppedFrom`), so the
    pawn jumps back to the 7th rank and flies forward again.
- **Reproduction (UE):** play to a position with a pawn on the 7th rank, drag it to the 8th, press Escape at the
  picker; the pawn stays on the 8th rank. Press Q instead: the pawn visibly jumps back before the move plays.
- **Pinned by:** nothing yet. `ue5/TownChess/Scripts/autotest.py` calls `board.choose_promotion` directly and never
  drives a drag to the last rank, keys or a cancel. Fix idea: on `NeedsPromotion` set `DroppedFrom = From`; on a
  cancelled promotion call `SnapBack(PromotionFrom)` before clearing it; add a `drag` autotest step for both paths.
