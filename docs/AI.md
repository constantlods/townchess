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
The server pool is what `CREATE_AI_GAME` and UE5 use. It never runs on a rendering or serving thread.

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

## Stockfish (Milestone 5, not started)

Planned: a server-side UCI service for analysis, move classification, the coach and stronger CPU levels.

Licensing: Stockfish is GPL-3.0.
- It will run as a **separate process** and is never linked into the UE binary or the core.
- Distributing it (server images, or the Windows build's bundled core) means shipping its licence and offering the
  corresponding source, including the NNUE network files.
- Running it only on our own server does not trigger distribution duties, but it is still documented.

## Commentary and characters

- **Format:** the commentary data format is in `content/characters/schema.md`.
- **First character:** "The Annotator", `content/characters/annotator.json`, with 69 lines keyed to the deterministic
  events in `packages/shared/src/events.ts`.
- **Selection:** line selection (conditions, priority, cooldowns, seeded choice) is specified there, and is planned
  to run in the core so every client says the same thing.
- **Engine-keyed lines:** lines for blunders and similar events activate only once Stockfish classification exists.
