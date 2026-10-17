# Learning: data model, privacy and pipeline

`packages/learning` (`@hc/learning`) is the foundation for learning from games. In Milestone 2 it contains
**interfaces and pure, deterministic functions only**: no storage, no engine binary, no network, and no machine
learning.

**No ML until data quality is proven.** No model is trained, and no learned weight influences anything, until:
- the ingestion pipeline has run on real TownChess games;
- the data-quality warnings are measured and understood;
- the provisional move-classification thresholds have been validated against labelled games.

Statistics (counts, results, engine evaluations) come first, because they are explainable and auditable. Learning
never modifies the rules (docs/ENGINE_AGENT.md).

## Pipeline

```
PLAYER GAMES            GameCore (authoritative) — finished games only
     │
     ▼
EVENTS                  deterministic per-move facts (events.ts), eventSeq
     │
     ▼
PGN / POSITIONS         ingestGame(): replay through ChessRules → GameRecord
     │                  (SAN + UCI, positionKey per ply, result, termination, time-control class, quality warnings)
     ▼
OPENING RECOGNITION     identifyOpening(): position-keyed Lichess CC0 book, transposition-aware
     │
     ▼
ENGINE ANALYSIS         EngineService (Milestone 5: Stockfish as a separate process) → evaluations + PVs,
     │                  every PV re-validated by ChessRules; classifyMove() with versioned thresholds
     ▼
PATTERNS                frequency / result / quality / novelty, kept separate (openingLearning.ts)
     │
     ▼
LEARNING DB             global aggregate (no profile ids)  |  per-profile repertoire (private)
     │                  (storage not built yet; Milestone 5+)
     ▼
REPERTOIRE              recurringOpenings(): "you reach French Defense: Advance Variation as Black in 80% of games"
```

The modules behind each step:

| Step | Module | Status |
| --- | --- | --- |
| Engine interface, UCI parsing | `src/engineService.ts` | Interface + parsers; process adapter in Milestone 5 |
| Move classification | `src/moveClassification.ts` | Thresholds as data, **provisional** |
| Ingestion | `src/ingest.ts` | Done |
| Opening statistics | `src/openingLearning.ts` | Done (in memory) |

## Data model

### GameRecord (`ingest.ts`, schema version 1)

| Field | Meaning |
| --- | --- |
| `gameId` | Opaque id supplied by the server |
| `source` | `townchess` or `pgn_import` |
| `white`, `black` | `{ profileId: opaque string or null, kind: human / engine / unknown }` |
| `startFen` | Start position |
| `moves[]` | `{ ply, san, uci, color }`, replayed through ChessRules, never copied from the source |
| `positionKeys[]` | `positionKey` of the start and of every ply (length = plies + 1) |
| `opening` | ECO, name, family, variation, ply reached, transposed |
| `result`, `termination` | The result is checked against the final position. Contradictions become warnings |
| `timeControl`, `timeControlClass` | Class uses the Lichess estimate (initial + 40 × increment): ultrabullet / bullet / blitz / rapid / classical / correspondence / untimed |
| `playedOn` | UTC **day** only, never a time of day |
| `rated` | Whether the game was rated |
| `quality.warnings` | `result_contradicts_*`, `result_unknown`, `termination_unknown`, `nonstandard_start`, `empty_game` |

Games with contradictory results, non-standard starts or no moves are excluded from statistics by
`isUsableForLearning`.

### Opening statistics (`openingLearning.ts`)

The statistics form a DAG of `PositionNode`s keyed by `positionKey`. Transpositions share nodes. Each node and edge
keeps four facets, deliberately separate:

| Facet | Where | Meaning |
| --- | --- | --- |
| Frequency | `count` | Games reaching the node, counted once per game; times a move was played (`MoveEdge.count`) |
| Result | `results` | White wins / draws / Black wins / unknown, White's point of view |
| Quality | `quality` | Engine evaluation slot (cp or mate, depth, engine identity, date), **null until Milestone 5** |
| Novelty | `detectNovelty()` | Per ply: `book` / `known` / `novelty` / `beyond_novelty`; `leftBookAtPly`, `noveltyAtPly` |

There are two scopes:
- **Global aggregate** (`aggregate`, `addGame`): contains no profile ids at all.
- **Per-profile repertoire** (`createRepertoire`, `addToRepertoire`):
  - one tree per colour played;
  - opening tallies from the profile's point of view (W/D/L);
  - `recurringOpenings` (thresholds `minGames` and `minShare`; granularity name / variation / family).

### Move classification (`moveClassification.ts`)

- Classification compares winning-chance loss bands of 0.1 / 0.2 / 0.3, which give inaccuracy / mistake / blunder.
  Winning chances come from the Lichess logistic, k = 0.00368208.
- The alternative basis is centipawn bands of 50 / 100 / 300, with evaluations clamped at ±1000.
- Mates are handled separately: mate lost, mate created, mate kept or delayed, and mate delivered.
- Every result carries `thresholdsVersion` and `provisional: true`.
- **These thresholds are borrowed, not validated.** Validation plan: label a set of games (human ?! / ? / ?? marks),
  run Milestone 5 Stockfish at a fixed node budget, and report agreement per band before any label is shown to
  players.

## Privacy

**What is stored:**
- Moves, positions, result, termination, time-control class and the UTC day.
- An opaque profile id for each human seat.

**What is never stored in learning data:**
- names or usernames;
- email addresses;
- IP addresses;
- ratings;
- chat;
- free-text PGN headers (`White`, `Black`, `Event`, `Site`, `Annotator`) and comments;
- times of day.

`assertOpaqueProfileId` rejects ids that look like an email, an IPv4 address or a name. It is a guard against
mistakes, not a proof of anonymity: the server must issue random ids that are not derived from the account.

**Why it is stored:**
- to show players their own repertoire and progress;
- to build the opening explorer and the coach;
- to validate engine-based classification.

Nothing is used for matchmaking, rating, or decisions about a player's account.

**Private vs aggregate:**
- A profile's repertoire and game list are visible **only to that profile** (and to operators under the access rule
  below).
- The global aggregate holds no ids. Before it is shown to anyone, `publicView(agg, k)` drops positions and moves seen
  in fewer than *k* games (default 5), so a rare line can't single out the one person who plays it.

**Retention (proposal, to be confirmed by the owner before storage is built):**

| Data | Retention |
| --- | --- |
| Per-profile records | Until the player deletes them or the account, then removed within 30 days |
| Global aggregate | Kept; it contains no personal data. Rebuildable from records, so deletions can be honoured by rebuilding |
| Engine evaluations | Kept per position; no personal data |

**Who can access it:**
- the player (their own data);
- the coach and agents acting for that player, read-only;
- operators, only for debugging, with access logged;
- nobody else.

Exports for research use the public view only.

## What happens in Milestone 5

1. The `StockfishProcessService` implements `EngineService` as a spawned process over UCI. It uses `collectAnalysis`
   for parsing and `goCommands` for bounded searches, with `Threads 1` and a fixed node budget for recorded
   evaluations.
2. A storage schema is built for GameRecord and the aggregates. Privacy and retention are confirmed first.
3. Evaluations are attached to the aggregate via `attachQuality`.
4. Classification thresholds are validated on labelled games, then `status: 'validated'` with a new version.
