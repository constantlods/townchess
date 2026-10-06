# Project audit (oversight agent, stage 3, 2026-10-05 pipeline run 3)

Scope:
- Milestone: "gameplay feel + reference HUD + packaged build". Audited at `de4a920`, the base of this run: 23 commits
  since the last audit (`d6f577c`).
- Since then the lead pushed 3 more commits (`d97fa14`, `c14e510`, `c160e11`: capture log, blackened-iron cage,
  relaxed fingers). They are noted, not judged; there are no screenshots of them yet.
- Inputs:
  - all 60 owner messages in the transcript, including the continuation summaries;
  - the lead's chat claims after 2026-10-05 07:58Z;
  - chess.md and visual.md from this run;
  - ROADMAP, VISUAL_REBUILD_ROADMAP, WINDOWS_SETUP and FREE_ASSETS;
  - PR #1;
  - read-only checks on townchess-win: the autotest `result.json` files, `logs\pkg-smoke.log` and the
    `test_package` output.

Labels: **done-verified** (re-checked here), **done-unverified** (claimed, no independent evidence), **in progress**,
**not started**, **blocked (owner)**, **dropped**.

Tests (stage 1, re-run): **475/475 with `TC_STOCKFISH`**, and **474 + 1 skipped** without it. Typecheck is clean and
the floor of 475 is met. The sim batch (seed 73) found 0 anomalies in 13 games, including the first
insufficient-material draw.

## 1. Milestone claims vs evidence

| Claim | Verdict | Evidence |
|---|---|---|
| Autotests cpu 68/68, rematch 8/8, drag 8/8 | **done-verified, but stale** | `C:\TownChess\autotest\{cpu,rematch,drag}\result.json`: 68/68, 8/8, 8/8, written 03:45-03:48 local. HUD commit `2071f72` is 03:59, so none of them ran on the HUD code |
| Packaged smoke 12/12, Job Object, Defender 0 | **done-verified** | `pkg-smoke.log` 08:37Z: `smoke test PASS (plies reached, 12 plies, 0 failures)`; test_package: `jobObject: PASS core terminated with the game`, `defenderDetections: 0`, D3D12. This build contains the HUD |
| Epic + HW ray tracing on RTX | **done-verified (runs), visual effect unproven** | Same log: `quality: epic (level 3), hardware ray tracing on`. No screenshot shows it: `capture.py` has forced cinematic + HWRT since eebb6d6 (visual.md F1) |
| OptiXDenoise disabled (packaged crash) | done-verified | `TownChess.uproject` lists `"OptiXDenoise", "Enabled": false`; the later package starts. WINDOWS_SETUP change 14 recorded with undo |
| Smoke TryAutoStart fix | done-verified | TCGame.cpp:203 (`LeaveGame`, then `TryAutoStart`); the smoke passed after it |
| Reference-style HUD | **in progress** | `41-hud.png`: the layout matches. Typography, portraits, icons and the Settings row do not (visual.md, HUD 5/10). "Reads like the reference's thin typewriter UI" (pass-40 note) overstates it |
| Key handler restored after `2071f72` | **done-verified, untested** | `OnKey` at `de4a920` is byte-identical to `2071f72~1` (32 lines). 2071f72 could not have compiled. **No autotest sends Tab, Q/R/B/N, Escape or join-code keys** (`autotest.py` calls `choose_promotion` directly) |
| Drag, 0.2 s ease-out, parallel captures, snap-back, hover, sounds | done-verified (code + drag 8/8) | TCBoard.cpp: `MoveSeconds 0.2`, cubic ease-out, captures in the mover's group with `Delay = 0.8 x MoveSeconds`. Sounds are generated in-repo (`clack.py`). Chat says captured pieces leave "while the attacker is still moving"; they start at 80 % of the move |

## 2. New findings (newest first)

- **F1 BUG-008 (from stage 1): drag-to-promotion has two visual bugs**, found by code review.
  - Cancelling the picker leaves the pawn drawn on the 8th rank.
  - Confirming makes the pawn jump back one rank before it flies.
  - The cause is `EndDrag`'s `NeedsPromotion` branch: no `DroppedFrom`, and no `SnapBack` on cancel. `IsInSync()`
    checks codes, not positions, so nothing repairs it.
  - This is exactly the "pieces move worse than chess.com" area the owner complained about. Fix it and add a drag
    autotest step for both paths.
- **F2 The HUD shipped without a key or HUD-button regression run.** The packaged smoke drives the board's click
  path only. Since 2071f72 nothing has run `draw`, `rematch` or `drag` on the new HUD code, and no scenario has ever
  covered keys.
  - The 2071f72 slip was caught only because the code did not compile. A slip that compiles (a wrong key name, or
    a button id typo in `PressButton`) would reach the owner.
  - Add a `keys` scenario (Tab toggles the clipboard; Q at a pending promotion; Escape cancels) and rerun
    `draw/rematch/drag` on HEAD.
- **F3 The lead told the owner "maximum graphics settings with ray tracing ... on your RTX card".** The log confirms
  that the preset runs; the claim as such is honest. The pass-40 log and the PR, however, imply a visible gain, and
  no image shows one. Capture the game camera at high vs epic, or drop the implication.
- **F4 Stale docs.**
  - ROADMAP's evidence table (lines 238-265) has no rows for drag (8/8), the gameplay feel, the quality preset, the
    HUD restyle, the OptiXDenoise crash or the cpu count of 68 (it still says 28/28).
  - FREE_ASSETS does not list the synthesised `S_TC_Move/Capture.wav` (own work; record it as generated by
    `ue5/tools/audio/clack.py`). Courier Prime is listed for the clipboard only, but it now also draws the HUD.
- **F5 Repo hygiene.**
  - `40-main.png` and `40-opponent-closeup.png` were committed in cca78d3, 10 min after the strip commit, and still
    carry 244 KB and 613 KB of stale bytes after `IEND`. They were captured outside `capture.ps1`, which deletes
    first. All other 60 PNGs are clean.
  - Tracked screenshots: 62 files, 105 MB.
  - The largest file is 8.3 MB (under 10 MB).
  - Besides this run's own worktree, `.claude/worktrees/` holds three agent worktrees. One is on the deleted
    `agents/rules-audit-2`, and that local branch still exists; the other two may belong to active agents.
    The remote now has only `main` and the feature branch (owner request 24 is done).
- **F6 The visual side of the milestone is HUD-only.** The scene in `40-main`/`41-hud` is pixel-close to pass 39
  (visual.md F6). The run-2 visual fixes are still open: hands (fist), cage tan, Annotator plate, poses, clutter,
  lamp pool. The lead is now on cage and hands (02:20Z), which is on task.
- Checked and clean:
  - Secrets: diff `d6f577c..origin` grepped for password/token/AUTH_/PRIVATE KEY/ssh keys/ghp_/github_pat. The only
    hit is prose in WINDOWS_SETUP change 14, which says the Android block's local token was *not* committed.
    `git grep` finds no AndroidFileServer or SecurityToken in `ue5/`.
  - GameCore authority: no `packages/` change.
  - Windows work stayed in `C:\TownChess`, and this audit only read files there.
  - All commits are by constantlods.
  - The previous audit's F1 overclaims were corrected in chat (the 08:38Z message lists the fist, the bronze cage,
    the sleeves, and the veins as unchecked).

## 3. Owner requests

| # | Request | Status | Evidence | Gap |
|---|---|---|---|---|
| 0 | Latest: "okay continue with the build" (10-06 02:12Z) | **followed** | cage/bars/fingers commits c14e510, c160e11 | not yet screenshotted |
| 0a | "pieces in chess.com move better ... mouse movement is bad ... looks worse than roblox" (10-05 07:37Z) | **in progress** | drag/ease/sounds (5213cea..559558e), drag 8/8, packaged build ready | owner has not played it yet; BUG-008; HUD 5/10 |
| 1 | Native UE5 game, Windows first | done-verified | packaged build 08:37Z | - |
| 2 | GameCore sole chess authority | done-verified | chess.md run 3 | - |
| 3 | Regression test per chess bug; count never drops | done-verified | 475 (floor met) | BUG-008 is UE-side and has no harness here |
| 7 | Owner plays a full game with the mouse | **pending (owner)**, asked again 08:38Z | ROADMAP line 265 | - |
| 8 | Windows PC rules + change log | done-verified | change 14 (OptiXDenoise) recorded | stray `ue5\TownChess 5.8*` folders await the owner's OK |
| 9/10 | No secrets, no large binaries | done-verified | grep + size scan | F5 |
| 11 | Critique -> render -> compare loop | in progress | visual.md run 3, passes 40-41 logged | - |
| 12 | MetaHuman opponent in the cage mask | done-verified | 40-opponent-closeup | cage still tan (fix pending in c14e510) |
| 13/20 | Four-stage pipeline | run 3 in progress | this file | - |
| 14a | Player picks character/hands | not started, tracked | ROADMAP, LIM-011 | - |
| 14b | Board flips between games | done-verified (autotest) | rematch 8/8 (03:45) | no Black-seat screenshot |
| 14c/d | Clipboard cart, Tab toggle | done-verified (visual), **key path untested** | 13-clipboard-raised | F2 |
| 14e | Simulated classics / CPU vs CPU by Elo | done-verified | 73 games, 0 anomalies; first draw path | not in CI |
| 14f | Stockfish league | done-verified | packaged sf1600 16/16 (ROADMAP) | - |
| 15 | Caged patient + Annotator | in progress | 39-annotator | plate tan, shared pose, LIM-011 |
| 18 | AAA realism: blood on the board, hand veins | in progress | visual.md: board 5, blood 4, hands 3 | no hand close-up since the 8K skin |
| 19 | Free assets only | done-verified | Courier Prime OFL; sounds generated | FREE_ASSETS rows missing (F4) |
| 22 | DLSS if needed | **blocked (owner)** | plugin not installed, told 07:59Z | - |
| 23 | 8K skin for veins | owner part done; **verification pending** | BuiltCine 8192 textures (chat) | no close-up |
| 24 | Delete merged branches | **done-verified** | `git ls-remote`: only main and the feature branch | local `agents/rules-audit-2` |

## 4. Wrong or risky (carried over)

- **R3** The cage mask's likeness to a famous film character. Re-check it once the iron cage lands.
- **R5** `docs/reference/concept-reference.jpg` is public with no recorded source or licence. It is the north star
  image itself (pixel-identical to `reference-northstar.png` up to JPEG noise).
- **R7** There is no branch protection on `main`.

## 5. Next actions (priority order)

1. **Fix BUG-008** (snap back on a cancelled promotion; set `DroppedFrom` on `NeedsPromotion`). Add a `keys` autotest,
   then rerun `cpu/draw/rematch/drag/keys` on HEAD before the next owner build.
2. **Owner play test:** get the owner's verdict on how moving pieces feels. Keep the mouse game on the owner list.
3. **HUD to the reference:** a sans face for plates and buttons, portraits, icons, equal plates, a Settings row (or
   remove it from the plan), and quieter move markers (visual.md fixes 2-5).
4. **Visual scene:** screenshot the iron cage and relaxed fingers (c14e510, c160e11); do the hand close-up for the
   8K skin; get the lamp and its pool into shot.
5. **Evidence:** one game-camera capture at high vs epic, or stop implying a visible gain. Also add a Black-seat
   screenshot.
6. **Docs:** ROADMAP rows (drag, preset, HUD, OptiXDenoise, cpu 68). FREE_ASSETS rows for the sounds and the HUD
   font.
7. **Housekeeping:** re-encode the two 40-* PNGs, remove the stale worktrees and the local `agents/rules-audit-2`
   branch, and ask the owner about the `ue5\TownChess 5.8*` folders.
