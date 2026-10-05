# Project audit (oversight agent, stage 3, 2026-10-04 run 2)

Scope: every owner message in the session transcript (chat, queued messages, earlier-session summary), checked against
`feature/photorealistic-renderer` at `f895b14` (3 commits ahead of GitHub, unpushed), the docs, the stage 1/2 reports
and GitHub. 64 commits since the last audit (`b818c9e`). Status: **done-verified** (re-checked here),
**done-unverified** (claimed, no independent evidence), **in progress**, **not started**, **dropped**.

Test suite re-run by this audit: **475/475 with `TC_STOCKFISH` set**, 474 + 1 skipped without it (the real-Stockfish
`describe.skipIf(!REAL)` block). Floor for the next run: 475. "475/475" is only true with the engine present.

## 1. New findings (newest first)

- **F1 The owner's top ask (veins, blood) is still mostly open.** In `31-main.png` the hands show faint tendons but no
  veins, dirt, nail grime or blood; the left hand is still a fist by the lamp base (visual judge fix 4 not done: no
  `hands.py`, no player skin override, no cuff/sleeve). Blood on the board still includes a straight-edged red band
  across rank 6 (fix 3 only partly done: edge fade and darken, no relief, no joints/studs/pieces).
- **F2 A commit message overstates the result.** `5c1df9d` "dark iron with patchy rust": the only geometry change is
  wire 2.8 -> 4.2 mm (still flat strips, no rivets/brow band), and in `31-opponent-closeup.png` the cage still reads
  as even copper-orange. Judge it under neutral light or fix the material; do not log it as done.
- **F3 Opponent pose not fixed.** `88b8093`/`a497008` claim a forward lean with clasped hands; in 31-main the arms are
  still crossed flat on the table, far from the chin. Visual judge fix 5 is open.
- **F4 One MetaHuman for everyone.** `build_scene.py` ~1383-1420 spawns the caged patient, the player's arms and the
  Annotator from the same `mhn` (Walter). The player even wears the patient's shirt material (`mi_gown_early`). This
  blocks "player picks character/hands" (14a) and the Annotator's own identity (15).
- **F5 Black seat changed without visual proof.** `6f6cff1` turns the board 180 for Black. The autotest checks are
  falsifiable (a1 side, first rank nearest, `is_in_sync`), but no run log or Black-seat screenshot after the change is
  recorded, and world-placed blood decals/clipboard are not shown to follow the turned board.
- **F6 DLSS is untracked and contradicted by the docs.** The owner allowed DLSS (2026-10-04 08:05); the lead said it
  needs the owner to add NVIDIA's free DLSS plugin from Fab. RENDERING.md still says "No DLSS" twice and no roadmap
  row exists. Record: real plugin only, RTX preset only, TSR stays the default for the RX 6650 XT (the original
  "no fake DLSS" rule still applies).
- **F7 Stale docs.** VISUAL_REBUILD_ROADMAP stops at pass 10 (`b65c658`); passes 11-31 (clipboard, blood, board,
  cinematic MetaHuman, judge fixes) are unlogged and its gap list is obsolete. ROADMAP has no rows for the clipboard
  (built), the roster (built), player hands selection, DLSS or the agent pipeline. KNOWN_LIMITATIONS line 372 still
  says BUG-007 is pinned as `it.fails` (it is now a normal test). The visual judge's capture-dithering finding
  (`SCS_FINAL_TONE_CURVE_HDR` 8-bit readback, build_scene.py:1533) is unaddressed, so skin detail can't be judged.
- **F8 Process.** Merge `9d10a31` is authored `root@Fpc.pve2` again (second time). Remote branch `agents/stockfish-league`
  is merged but not deleted; `claude/horror-chess-prototype` (= main) remains; three local agent worktrees are stale.
  Tracked screenshots are 84 MB (4 MB PNGs, ~12 MB per pass); switch to JPEG or LFS before this grows further.

## 2. Owner requests

| # | Request | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | Native UE5 game first, Windows first | done-verified | `ue5/TownChess` | none |
| 2 | GameCore sole chess authority | done-verified | league moves go through `room.move` (chess.md) | none |
| 3 | Regression test per chess bug; count never drops | done-verified | BUG-007 pinned `c791d46`, fixed `7cdc067`; 446 -> 475 | KNOWN_LIMITATIONS wording (F7) |
| 5 | M2 gameplay DoD | done-verified (Linux) | ROADMAP 5b | - |
| 6 | Windows sidecar proofs | done-verified (scripted) | ROADMAP 5b, packaged game vs bundled Stockfish 16/16 | crash recovery and correlated logs still not scripted |
| 7 | Owner plays a full game with the mouse | **not verified** | ROADMAP 5b "Pending" | unchanged since last audit |
| 8 | Windows PC rules + change log | done-verified | WINDOWS_SETUP rows 9-13 + incident note | No new breach found in this period (tool calls scanned). Pre-audit read of `%LOCALAPPDATA%\EpicGamesLauncher\...\EpicGamesLauncher.log` (04:47Z) is not in the incident note |
| 9 | No secrets committed | done-verified | tree + new history grep: no keys, tokens, signed URLs, Windows user | `192.168.0.208` in PERFORMANCE.md (LAN, low) |
| 10 | No large binaries | done-verified | largest file 8 MB (grime normal PNG); `tools/sim/out*/` ignored | screenshot growth (F8) |
| 11 | Critique -> render -> compare loop, documented | in progress | stage 2 report, passes 23-31 | loop log stale (F7) |
| 12 | MetaHuman opponent in the cage mask | done-verified | `31-main.png`, `31-opponent-closeup.png` | pose (F3), cage material (F2), clean T-shirt |
| 13 | Helper agents (critique, GitHub, rules, oversight) | done | `.claude/agents/*`, docs/AGENT_PIPELINE.md | - |
| 14a | Player picks own character/hands; opponent choice | opponent picker done (`672864c`); **player side not started, not tracked** | - | blocked by F4 |
| 14b | Board flips by itself between games | done-unverified | `3ff9de2`, `6f6cff1` | F5 |
| 14c/d | Clipboard cart with moves + opening, toggle; critique first | done-verified (screenshot) | `4093007`, `13-clipboard-raised.png`, CLIPBOARD_CRITIQUE.md | covers h-file edge; no settings toggle for the on-screen copy; not in ROADMAP |
| 14e | Simulations: classic games, CPU vs CPU by Elo, bug-watching agent | done-verified | chess.md: 51 games, 0 anomalies, Stockfish referee | not in CI; no draw-path coverage (all games mated) |
| 14f | Stockfish/league engines in the game | done-verified | `27d4d00`, sf1350..sfmax, bundled with GPL text (`e5f361d`) | other engines (Lc0) not evaluated |
| 15 | Keep caged patient, add the Annotator | in progress | roster `0afe50a`, `12-annotator.png` | no fresh capture; oversleeves don't read (visual.md); shares Walter MetaHuman (F4); not in KNOWN_LIMITATIONS |
| 16 | Voice/animation pipeline | research only | VOICE_OPTIONS.md | - |
| 17 | Physical interaction (M3) | not started | ROADMAP M3 | - |
| 18 | AAA realism matching the reference: blood on the board, veins in the hands | in progress | passes 27-31; stage 2 scores 2-6/10 | F1, F2, F3 |
| 19 | Free assets only, code alternatives | done-verified | FREE_ASSETS.md (all CC0/OFL/MetaHuman/GPL recorded), generators `blood.py`, `board.py`, `props.py` | `docs/reference/concept-reference.jpg` source still unrecorded (R5) |
| 20 | Four-stage pipeline (critic, visual judge, GitHub keeper) | done, run 1 in progress | `340cdfc`, chess.md, visual.md, this file | stage 4 not yet run |
| 21 | Chess agent for rules and engines | done-verified | chess.md found a real bug (BUG-007) and the sim F2; both fixed (`7cdc067`, `f895b14`) | - |
| 22 | DLSS if needed | **blocked on owner** (Fab download), **not tracked** | lead's message 08:49Z | F6 |

## 3. Wrong or risky (carried over, still open)

- **R3** Character direction: owner decided "keep caged patient and add annotator too". Resolved as a roster; the
  cage-mask likeness risk to a famous film character remains and should be re-checked as the patient gets more detail.
- **R5** `docs/reference/concept-reference.jpg` is public with no source/licence recorded.
- **R7** Stale branches (F8). No branch protection on `main`.

## 4. Next actions (priority order)

1. **Hands (owner's top ask):** fix the capture's 8-bit readback first, then a vein/dirt/nail/blood skin override for
   the player only, the left hand on the frame, a cuff and sleeve; capture a hands close-up as evidence.
2. **Blood:** remove the straight-edged band, add relief, joint/stud/edge decals and blood on 3-4 pieces; board
   close-up as evidence.
3. **Opponent:** real lean + chin clasp, cage material that reads as iron, canvas shirt; recapture the Annotator.
4. **Separate MetaHumans** for player arms, patient and Annotator (free presets), then player character/hands
   selection (14a) into ROADMAP.
5. Black-seat autotest run log + screenshot (F5); state the result in ROADMAP 5b.
6. Docs: log passes 11-31 and new gaps in VISUAL_REBUILD_ROADMAP; ROADMAP rows for clipboard, roster, 14a, DLSS,
   pipeline; RENDERING.md DLSS decision; KNOWN_LIMITATIONS BUG-007 wording.
7. Owner: add NVIDIA DLSS from Fab (then wire it to the RTX preset only); play one full game with the mouse (item 7).
8. Housekeeping: delete merged `agents/stockfish-league` (owner OK), set the git identity for merges, JPEG screenshots.
