# Chess rules in TownChess

All chess decisions live in `packages/shared` and run identically everywhere: on the server, in the browser's
offline mode, and later in the local core used by the UE5 client.

- `ChessRules` (`rules.ts`) is a thin wrapper over chess.js 1.4.0. It handles move generation and legality, check,
  mate, stalemate, and the per-move `effects`.
- `GameCore` (`game.ts`) is the single game-flow state machine. It owns moves, clocks, the first-move window, draws,
  claims, resignation, timeouts, abandonment and results.
- Presentation code (the browser renderer and UE5) never decides anything about chess. UE5 receives the legal moves,
  effects and events from the core.

## Rules coverage

Every rule below is backed by tests. **123 FIDE fixture cases** live in `packages/shared/test/fixtures/fide-cases.json`.
They cite FIDE Laws of Chess articles and were written and checked independently of our code by a dedicated rules
agent. They run twice:
- against chess.js directly (`fide-cases.validate.test.ts`), which proves the fixtures themselves are right;
- against `GameCore` (`fide-cases.core.test.ts`), which proves our implementation.

| Rule | FIDE | Where | Notes |
| --- | --- | --- | --- |
| Piece movement, captures, pins, check, double/discovered check, king safety | 3.1–3.9 | chess.js | 16 castling, 12 en passant, 13 promotion, 7 check, 5 pin cases |
| Castling restrictions (through/out of/into check, moved king/rook, captured rook, blocked) | 3.8.2 | chess.js | Queenside with b1/b8 attacked is legal (tested) |
| En passant, including illegal ep that would expose the king | 3.7(d) | chess.js | |
| Promotion to Q/R/B/N; **a piece must be named** (no silent queen) | 3.7(e) | `ChessRules.tryMove`, `GameCore.move` | `'promotion piece required'` |
| Checkmate, stalemate | 5.1.1, 5.2.1 | `GameCore` | Also detected when a custom start FEN is already finished |
| Dead position by material | 5.2.2 | `material.ts` `isDeadByMaterial` | Ends the game immediately (`draw_insufficient` / `insufficient_material`) |
| Draw by agreement | 9.1 | `GameCore.offerDraw/acceptDraw` | An offer is allowed at any time (online convention, more permissive than 9.1.2.1) |
| Threefold repetition | 9.2 | `GameCore` + `positionKey` | Policy `automatic` (default) or `claim` |
| Claim with an intended move | 9.2.1.1, 9.3.1 | `GameCore.claimDraw(color, now, intended)` | The intended move is not played |
| Fifty-move rule | 9.3 | `GameCore` | Same policy as threefold |
| Fivefold repetition, seventy-five moves | 9.6.1, 9.6.2 | `GameCore` | Always automatic. Checkmate on the 150th half-move takes precedence |
| Flag fall | 6.9 | `GameCore.checkFlag` + `canPossiblyMate` | Loss, unless the opponent cannot mate by any legal sequence → draw (`timeout_vs_insufficient`) |
| Abandonment | — (6.9 analogue) | `GameCore.abandon` | Same material rule (`abandoned_vs_insufficient`) |
| Resignation | 5.1.2 | `GameCore.resign` | |

### Position identity (repetition)

`positionKey()` is built from piece placement, side to move, castling rights and the en passant square. The en passant
square counts **only if an en passant capture is actually legal** (FIDE 9.2.3: same possible moves).

The rules agent found and pinned down a chess.js deviation. Its internal repetition hash counts an en passant right even
when the capturing pawn is pinned, so `isThreefoldRepetition()` misses a real threefold (case
`repetition-illegal-ep-does-not-differ`). TownChess therefore never uses chess.js repetition detection; `GameCore`
counts `positionKey`s itself.

### Who can still mate (6.9 and 5.2.2)

`canPossiblyMate(pieces, color)` decides by material class, the same classes as lichess/scalachess:

- A bare king never can. Any pawn, rook or queen always can.
- Two knights, knight plus bishop, or bishops on both square colours can.
- A single knight can only if the opponent owns a pawn, knight, bishop or rook. **It can't against K+Q.**
- Bishops all on one colour can only if the opponent owns a pawn, a knight, or a bishop on the other colour. **They
  can't against K+R or K+Q.**

The bold exclusions come from exhaustive enumeration of every K+X vs K+Y placement. No mate exists for N vs Q
(1.13M positions), B vs R or B vs Q (1.90M each).

### Draw policy

| Policy | Threefold / fifty-move | Fivefold / seventy-five |
| --- | --- | --- |
| `automatic` (default: online convention, what players expect from chess sites) | Ends the game | Ends the game |
| `claim` (FIDE over-the-board behaviour) | `draw_claimable` event; side to move sends `CLAIM_DRAW` | Ends the game |

### Clocks

- **Time source.** Time is injected everywhere. The server uses a monotonic clock, so a wall-clock (NTP) step cannot
  flag anyone.
- **First-move window** (timed games, 30 s on the server). No clock runs until both sides have made their first move,
  and those moves get no increment. If the side to move doesn't move inside the window, the game is `aborted`: no
  result, never rated. This keeps intro sequences in UE5 from burning White's time.
- **Flag fall.** The flag is checked when a move arrives and by a server timer. **A move that arrives after the flag
  has fallen loses, even if it would have been mate.** There is no lag compensation yet; that's a Milestone 6 decision.

## Known limitations (honest list)

- **Dead positions from pawn structure** are not detected: a locked pawn wall with no possible mate, with or without
  shut-in bishops (fixtures `dead-locked-*` and `timeout-locked-wall-draw`). Detecting them needs a reachability
  search. The rules agent's prototype takes up to about 2 s, which can't run on the server's move path. These three
  cases are listed as `KNOWN_LIMITATIONS` in the core fixture test; the test fails if one starts passing, so the list
  can't go stale. Plan: run a capped search on the engine worker pool when the cheap precondition holds.
- **Claims of a position that would arise after the opponent's reply** are not modelled. Only the current position,
  or one produced by the claimant's own intended move, can be claimed.
- **Chess960 and other variants:** out of scope.

## Opening recognition

- **Data:** Lichess `chess-openings` (**CC0**), commit `c67912b`, vendored in `packages/shared/data/openings/` with its
  licence. It has 3,815 named lines covering every ECO code.
- **Index:** `npm run build:openings` replays every line and writes a position-keyed index (`openings/book.json`,
  653 KB). In the current data no two names share a position.
- **Recognition is by position, not move order**, so transpositions are recognised.
  - Example: 1.Nf3 Nf6 2.c4 e6 3.d4 reaches the same named position as 1.d4 Nf6 2.c4 e6 3.Nf3.
  - `transposed: true` marks a game that reached the position by a different move order.
- **What's reported:** the deepest named position the game has reached. It stays named after the game leaves book, and
  `inBook` says whether the current position is itself in the book.
- **Name splitting:** names split into `family` / `variation` / `subvariation` ("Sicilian Defense" / "Najdorf
  Variation" / "English Attack").
- **Gambits:** the name contains "Gambit". That produces a `gambit_offered` event when the game first enters a gambit
  family.

## Game record

`toPgn` / `pgnFromHistory` export PGN:
- the Seven Tag Roster first;
- then ECO, Opening, TimeControl and Termination, mapped to the PGN-spec values "normal", "time forfeit" and so on;
- SetUp/FEN for custom starts;
- movetext wrapped at 80 characters.

`parsePgn` imports PGN through chess.js. The import → export round trip is tested.

## Events

`events.ts` derives deterministic per-move facts, with no engine involved:

- **Moves and captures:** `move`, `capture`, `en_passant`, `castle_kingside`, `castle_queenside`, `promotion`.
- **Check and endings:** `check`, `double_check`, `discovered_check`, `checkmate`, `stalemate`.
- **Openings:** `opening_identified`, `gambit_offered`.
- **Material:** `material_swing`, a change of 3 or more over two plies.
- **Draws:** `draw_offered`, `draw_claimable`, and every termination.

Commentary (`content/characters/*.json`), the analysis cart and agents consume these.

Engine judgements (`blunder`, `brilliant` and so on) are a separate later layer (Milestone 5).
