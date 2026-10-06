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

## Working agents and the build-PC lock (2026-10-06, owner: "deploy agents ... till the build is in beta phase")

Besides the four review stages, a working agent improves the game continuously:

| Agent | Owns | Definition |
|---|---|---|
| `tc-render-artist` | The look: scene code (build_scene.py), Blender props, texture generators, materials, lighting, characters, hands; measured against the reference until docs/BETA.md V1-V5 and C2 are met | `.claude/agents/tc-render-artist.md` |
| lead (main session) | Gameplay, rules, protocol, HUD, settings, sound, packaging, stability/performance criteria, merges the reports | — |

The target is docs/BETA.md: every row has a check that can fail. The Windows build PC is shared, so every builder
takes `ue5/tools/win/lock.ps1 -Action acquire -Owner <name>` before a build/test/capture cycle and releases it after
(a lock older than 3 h counts as stale). Overlapping runs contaminated results before.

## Evidence rules (from oversight run 1)

- Test counts are quoted for both runs: with `TC_STOCKFISH` (all tests) and without it (the live-engine test is skipped).
- Commit messages describe what a screenshot shows, not what was intended (a "dark iron" change that still renders
  copper is reported as such).
- Screenshots: only the passes worth keeping are committed (main view plus the close-ups that changed); scratch
  captures stay on the build PC (`C:\TownChess\shots`), to keep the repository from growing ~12 MB per pass.
