# Engines, AI and LLMs

**Principle:** deterministic code decides, engines calculate, LLMs explain.
- Legality, state, clocks and events are deterministic (`packages/shared`).
- Evaluation and move search come from chess engines.
- LLMs and agents may only interpret engine output: coaching, critique, dialogue and summaries.

## House engine (`packages/engine`)

This is the small alpha-beta engine from the original prototype, now its own package:
- negamax with alpha-beta pruning and iterative deepening;
- MVV-LVA move ordering, so the most promising captures are searched first;
- capture-only quiescence search;
- tapered piece-square tables.

The same code runs in the browser's Web Worker (offline play in the tab) and in the server's `AiPool` worker threads.
The server pool is what `CREATE_AI_GAME` with a house level and UE5 use. It never runs on a rendering or serving
thread.

| Level | Depth | Time budget | Noise (cp) | What it means |
| --- | --- | --- | --- | --- |
| Novice | 2 | 400 ms | 60 | Often picks a weaker move |
| Patient | 3 | 1200 ms | 25 | Occasional imprecision |
| Warden | 5 | 2500 ms | 0 | Always its best move |

**No Elo is claimed.** The prototype displayed 850 / 1187 / 1550 as ratings; those were invented and are gone. Engine
seats send `rating: null`. Strength labels can only become ratings after a calibration run against rated engines (an
agent-lab task in Milestone 8).

### Determinism

- **Default behaviour:** the time budget and `Math.random` noise make engine strength depend on machine load. That's
  fine for casual play.
- **Reproducible mode:** `SearchOptions.nodeLimit` (a hard node budget, with no time dependence) and
  `SearchOptions.seed` (a seeded PRNG for the noise choice). Same position + node limit + seed = same move. The agent
  lab must use this mode.

## Stockfish league levels (CPU opponents)

Stockfish, or any UCI engine that supports `UCI_LimitStrength` / `UCI_Elo`, is offered as a second family of CPU
opponents next to the house levels. Analysis, move classification and the coach (the rest of Milestone 5) are not
built yet; this is the play side only.

| Level id | UCI options | Max think time per move | Menu label |
| --- | --- | --- | --- |
| `sf1350` | `UCI_LimitStrength true`, `UCI_Elo 1350` | 600 ms | Stockfish (UCI_Elo 1350) |
| `sf1600` | `UCI_LimitStrength true`, `UCI_Elo 1600` | 700 ms | Stockfish (UCI_Elo 1600) |
| `sf1900` | `UCI_LimitStrength true`, `UCI_Elo 1900` | 800 ms | Stockfish (UCI_Elo 1900) |
| `sf2200` | `UCI_LimitStrength true`, `UCI_Elo 2200` | 1000 ms | Stockfish (UCI_Elo 2200) |
| `sf2500` | `UCI_LimitStrength true`, `UCI_Elo 2500` | 1200 ms | Stockfish (UCI_Elo 2500) |
| `sfmax` | `UCI_LimitStrength false` (full strength) | 1500 ms | Stockfish (full strength) |

All levels also set `Threads 1` and `Hash 16` (the core shares the machine with the renderer).

**About the numbers.** The labels name the engine's own `UCI_Elo` setting. That is Stockfish's calibrated scale (the
Stockfish 19 wiki, UCI_Elo: "calibrated at a time control of 120s+1s and anchored to CCRL 40/4"), not a TownChess measurement, and our think
times differ from that calibration, so treat it as "Stockfish set to 1600", not "you beat a 1600 player". The house
engine still carries **no** Elo. The ladder lives in `packages/shared/src/aiLevels.ts` (`LEAGUE_LEVELS`).

How it runs (`packages/server/src/uciEngine.ts`, Node only; the browser bundle never imports it):
- **Separate process.** `UciEngine` spawns the binary and speaks UCI on stdin/stdout: `uci`/`uciok`, `isready`/
  `readyok`, `setoption` (only changed options), `ucinewgame`, `position fen <start> moves ...` (the whole game, so the engine
  sees repetitions), `go movetime`, `bestmove`. The UCI
  text parsers are the ones in `packages/learning/src/engineService.ts`.
- **One process per game in progress** (`UciLeague`, at most 4). A finished game hands its process back; the next
  game gets `ucinewgame` first. `CREATE_AI_GAME` with a league level is refused with `ERROR busy` when all are taken.
- **Clock-aware.** Think time is the level's cap, lowered to about remaining/30 + 0.75 × increment in timed games
  (`moveBudgetMs`, floor 50 ms); the minimum "thinking" display delay also shrinks on a low clock. The same budget now
  also caps the house engine in timed games.
- **Legality stays in GameCore.** The engine's `bestmove` is submitted through `GameRoom.move` like a human move. If
  GameCore rejects it, the house engine (Warden) plays that move instead and the incident is logged
  (`[hub] league engine move ... rejected by GameCore`). The engine is never asked about a finished position.
- **Failures never stall a game.** No `bestmove` within movetime + 1.5 s: `stop`; still nothing after 0.5 s: the
  process is killed. A crash is detected on process exit; the process is replaced and the request retried once.
  Either way, if no move comes back the house engine moves. Three failed starts in a row disable the league levels
  for new games. Every engine gets `quit` on core shutdown (and exits on stdin EOF if the core dies).

### Where the core finds the engine

1. `TC_STOCKFISH`: path to the binary.
2. `<core data dir>/engines/` (the sidecar's `--data` directory, i.e. `<Saved>/TownChess/core/engines/` in UE builds).
3. `engines/` next to the running core (`townchess-core.mjs` in packaged builds).

In an engines directory the canonical name is `stockfish` (`stockfish.exe` on Windows); otherwise the first
executable whose name starts with `stockfish` is used, so the upstream `stockfish-windows-x86-64-avx2.exe` works
unrenamed. Nothing found: the league levels are simply not listed in `WELCOME.aiLevels` and are refused with
`ERROR engine_unavailable`. The standalone server (`npm run start:server`) uses `TC_STOCKFISH` only.

### Licensing and shipping the binary

Stockfish is GPL-3.0. It runs only as a separate OS process over UCI and is never linked, bundled into JavaScript or
compiled into the core, the server bundle or the UE binary. `npm run bundle:core` does **not** include it. To ship it
with the Windows build, put these three files in `Content/TownChessCore/engines/` (next to `townchess-core.mjs`):

| File | Source |
| --- | --- |
| `stockfish-windows-x86-64-avx2.exe` | the `sf_19` release, asset `stockfish-windows-x86-64-avx2.zip` (the .exe inside) |
| `Copying.txt` | the GPL-3.0 text from the same zip |
| `SOURCE.txt` | the upstream source: `https://github.com/official-stockfish/Stockfish/releases/tag/sf_19` (tag `sf_19`) and the source archive `https://github.com/official-stockfish/Stockfish/archive/refs/tags/sf_19.tar.gz`; the NNUE network it embeds is named in `src/evaluate.h` of that tag (`EvalFileDefaultName`, `nn-1a298aa575a0.nnue` in sf_19) and is downloadable from `https://tests.stockfishchess.org/nns` |

The AVX2 build needs a 2013+ x86-64 CPU; ship `stockfish-windows-x86-64-sse41-popcnt.exe` as well (or instead) for
older machines (with two candidates present, name the one to use `stockfish.exe`). This step is not automated yet
(`ue5/tools/win/package.ps1` is owned by the UE lead).

Running it only on our own server does not trigger distribution duties, but the same rules are followed.

Tests: `packages/server/test/uci.test.ts` drives a fake UCI engine (`test/fixtures/fake-uci.mjs`) through handshake,
moves, an illegal move, a crash and restart, a hang/timeout, process reuse with `ucinewgame`, discovery and a real
room. One test plays a real Stockfish through a room and runs only when `TC_STOCKFISH` points at a binary:
`TC_STOCKFISH=/path/to/stockfish npx vitest run packages/server/test/uci.test.ts`.
`packages/server/test/sidecar.test.ts` checks `<data>/engines/stockfish` discovery and `quit` on core exit.

## Commentary and characters

- **Format:** the commentary data format is in `content/characters/schema.md`.
- **First character:** "The Annotator", `content/characters/annotator.json`, with 69 lines keyed to the deterministic
  events in `packages/shared/src/events.ts`.
- **Selection:** line selection (conditions, priority, cooldowns, seeded choice) is specified there, and is planned
  to run in the core so every client says the same thing.
- **Engine-keyed lines:** lines for blunders and similar events activate only once Stockfish classification exists.
