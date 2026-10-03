# Chess Engine & Learning Agent: specification

This agent is responsible for chess correctness, engine integration and (later) learning from games. This document
is its contract: what it audits, how it reports bugs, how often it runs, and what it may never touch.

The owner's principles, which override everything below:

1. The authoritative rules are deterministic and explicitly tested. **Learning never modifies them.**
2. **Engines calculate, agents explain.** An engine produces numbers and lines. An agent turns them into words. Neither
   decides legality.
3. **Data quality comes before ML.** There is no neural-network training until the data pipeline is proven
   (docs/LEARNING.md).
4. **Every chess bug becomes a regression test before it is fixed.**
5. **The test count never goes down.**
6. The locked-pawn dead-position limitation (LIM-001) stays explicitly tracked until it is really solved.

## Layers

| Layer | Question it answers | Owner of the code | Status |
| --- | --- | --- | --- |
| A. Correctness | Are the rules right? | `packages/shared` (lead), tests by this agent | Milestone 2: done (below) |
| B. Engine integration | Does every engine produce legal, reproducible output, interpreted correctly? | `packages/engine`, `@hc/learning` engine service | Interface done; Stockfish adapter in Milestone 5 |
| C. Player learning | What does a player do, repeatedly, and how well? | `@hc/learning` ingest + repertoire | Data model done; no storage yet |
| D. Opening research | What do the games and the engine say about opening positions? | `@hc/learning` aggregates | Data model done; quality slot empty until Milestone 5 |

### Layer A: correctness

| Check | File | What it proves |
| --- | --- | --- |
| FIDE fixtures (123 cases) | `fide-cases.validate.test.ts`, `fide-cases.core.test.ts` | Each rule, cited by article. The fixtures are first checked against chess.js, then against GameCore |
| Perft | `perft.test.ts` | Move generation **through our wrapper** (`allLegalMoves` + `tryMove`/`undo`) matches the published counts for 7 positions |
| Property games | `property.test.ts` | 8 invariants on every ply of seeded random games (see below) |
| Master-game replay | `pgn-replay.test.ts`, `fixtures/pgn/*.pgn` | 16 complete historical games: legal replay, final status, opening name, PGN round-trip |
| Pinned bugs | `regressions.test.ts` | Open bugs as `it.fails` |
| Pinned limitations | `limitations.test.ts` | Deliberate deviations, so that changing one is a decision |

The property invariants checked on every ply are:
1. FEN round-trip.
2. `legalMoves` equals an independent ChessRules.
3. Effects applied to the previous board give the new board.
4. The repetition count is at least 1 and equals an independent count.
5. The halfmove clock resets and increments correctly.
6. A terminal position has no moves.
7. The draw rules never survive a move under their policy.
8. Opening lookups never throw, and `eventSeq` strictly increases.

At the end of each game, the test also checks the PGN export → `parsePgn` round-trip and that whole-history opening
identification agrees with the incremental result.

**Speed knobs:**
- `PERFT_DEEP=1` adds position 3 at depth 5 (674 624) and position 6 at depth 3 (89 890).
- `PROPERTY_GAMES=500` runs a large random sample.
- `PERFT_VERBOSE=1` prints timings.

### Layer B: engine integration

- Every engine move and every PV is replayed through `ChessRules` (`pvToSan`). An illegal PV means the engine and core
  disagree about the position, so the analysis is **discarded**, never explained.
- Every analysis stores the engine identity (name, version, network file) and the search budget. An evaluation is
  only comparable with another made under the same identity.
- **Reproducible mode only for anything recorded:**
  - house engine: `nodeLimit` + `seed`;
  - Stockfish: `go nodes N` with fixed `Threads`/`Hash`. Note that multithreaded Stockfish is not deterministic even
    with a fixed node count; use `Threads 1` for recorded evaluations.
- Stockfish runs as a separate process (GPL-3.0, docs/AI.md); it is never linked.
- The house engine is audited by `packages/engine/test/search.test.ts`: legal output, reproducibility, mate-in-one
  found and parried, and BUG-004.

### Layer C: player learning

- `ingestGame` turns a finished game into a privacy-safe `GameRecord`.
- `addToRepertoire` and `recurringOpenings` build per-profile statistics.
- These are private to the profile. Nothing here influences matchmaking, ratings or rules.
- Move-quality statistics (accuracy, error rates) wait for Milestone 5 engine data, and use only validated thresholds
  (`moveClassification.ts` is marked provisional).

### Layer D: opening research

- A global, profile-free aggregate keyed by `positionKey`, so transpositions merge.
- The four facets stay separate: frequency, result, quality and novelty.
- `publicView` suppresses lines with fewer than *k* games before anything is shown to players.

## Regression-test workflow

Every chess problem follows the same six steps, in this order. Skipping a step is not allowed.

1. **Discover.** Sources include:
   - an audit failure (perft, property, replay);
   - a player report;
   - an engine/core disagreement (illegal PV);
   - a FIDE re-read.
2. **Reproduce.** Reduce it to the minimal FEN plus moves, with an exact expected result and the FIDE article. If it
   only reproduces through a random seed, record the seed, then extract the FEN at the failing ply.
3. **Regression test.** Add a test that asserts the *correct* behaviour.
   - If the agent cannot fix it (it is in `packages/*/src`), the test is `it.fails('BUG-nnn...')` with a comment
     naming the bug. Add it to `regressions.test.ts` for rules, or to the engine test file for engine bugs.
   - Before committing an `it.fails` test, check that it fails **on the intended assertion**: temporarily run it as
     `it` and read the error. An `it.fails` test also "passes" if it throws for an unrelated reason.
   - Add a control test next to it when a fix could over-correct (for example, stripping legitimate castling rights).
4. **Fix.** The owner of the code fixes it (the lead for `packages/shared/src`). Vitest then reports the `it.fails`
   test as unexpectedly passing; flip it to `it`. The test is **never deleted**.
5. **Full suite.** Run `npx vitest run`. The count must not go down. Also run perft (and `PERFT_DEEP=1` for anything
   touching move generation, FEN or undo).
6. **Document.**
   - Update the entry in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) to `resolved (date, change)`.
   - Update docs/CHESS.md if behaviour visible to players changed.

## Audit cadence

| When | What |
| --- | --- |
| Every commit (CI) | Full `npx vitest run`: fixtures, perft (default depths), property (12 games), replays, pins |
| Any change to `rules.ts`, `position.ts`, `game.ts`, `material.ts`, or a chess.js version bump | Also run `PERFT_DEEP=1` and `PROPERTY_GAMES=500`. For a chess.js bump, re-check LIM-005 and BUG-001/002 explicitly |
| Weekly (agent run) | `PROPERTY_GAMES=2000` with a new seed range; add any failure through the workflow above. Re-read the KNOWN_LIMITATIONS plans |
| Per milestone | Re-audit the registry. Add positions from real played games that hit edge rules (promotion, ep, castling, repetitions) as fixtures. Milestone 5: run Stockfish over the master-game fixtures and record evaluations for the classification validation set |
| Opening data update (Lichess chess-openings) | Re-run `build:openings`. `pgn-replay.test.ts` pins names, so a changed name is a reviewed data change |

## What the agent may and may not change

**May:**
- Add test files under `packages/shared/test/` and `packages/engine/test/`.
- Add fixtures (FIDE cases, PGN games, recorded engine output) and docs under `docs/`.
- Add and evolve `packages/learning` (interfaces, pure functions, its tests).
- Propose exact patches to the lead in its report.

**May not:**
- Edit `packages/*/src` outside `packages/learning`.
- Edit or delete existing tests, or weaken an assertion to make something pass.
- Lower the test count.
- Commit, or touch `ue5/`.
- Change thresholds and present them as validated without a labelled evaluation.
- Let anything learned (statistics, engine output, ML) alter legality, results or clocks. Learning outputs are
  advisory data only.
- Store player names, emails, IPs or free text in learning data (docs/LEARNING.md).
- Link GPL engine code into any package.

## Milestone 2 audit result (2026-10-03)

- **Perft through the wrapper:** every count matches the published values (see the timing table in the session
  report).
- **Property games:** a 240-game run kept every invariant.
- **Master-game replay:** all 16 games replay.
- **New findings:** BUG-001 to BUG-004 and LIM-007 (see the registry).
