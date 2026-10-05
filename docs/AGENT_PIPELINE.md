# Agent pipeline

Four helper agents check the work after every milestone, in this order. Each stage reads the reports of the stages
before it, so problems flow into one place and nothing is pushed unchecked. Definitions: `.claude/agents/`.

| # | Agent | Watches | Output |
|---|---|---|---|
| 1 | `tc-chess-guardian` | Rules, GameCore, protocol, house engine and Stockfish: tests, typecheck, simulator batch with the Stockfish referee, recent rules/engine commits. Bugs become pinned regression tests | `docs/pipeline/chess.md` |
| 2 | `tc-visual-judge` | The game's screenshots against the owner's reference image: characters, hands, board, pieces, blood, lighting, camera, room, UI. Scores and top fixes | `docs/pipeline/visual.md` |
| 3 | `tc-oversight` | The whole chat history, GitHub and the docs: every request done or tracked, evidence that can fail, project rules (free assets, licences, security, test count), on task | `docs/PROJECT_AUDIT.md` |
| 4 | `tc-github-keeper` | Pull, verify (tests green, no secrets or large binaries), push, update the PR from the reports | `docs/pipeline/github.md` |

Stages 1-3 commit but never push; stage 4 is the only one that pushes. The lead reads the reports, fixes, and the next
milestone runs the pipeline again.

## Evidence rules (from oversight run 1)

- Test counts are quoted for both runs: with `TC_STOCKFISH` (all tests) and without it (the live-engine test is skipped).
- Commit messages describe what a screenshot shows, not what was intended (a "dark iron" change that still renders
  copper is reported as such).
- Screenshots: only the passes worth keeping are committed (main view plus the close-ups that changed); scratch
  captures stay on the build PC (`C:\TownChess\shots`), to keep the repository from growing ~12 MB per pass.
