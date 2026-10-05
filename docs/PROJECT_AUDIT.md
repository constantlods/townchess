# Project audit (oversight agent, stage 3, 2026-10-05 pipeline run 2)

Scope: every owner message in the session transcript (chat and the earlier-session summary), checked against
`feature/photorealistic-renderer` at `7eda444`. HEAD is 1 commit ahead of GitHub (`7eda444`, the screenshots, not
pushed). There are 18 commits since the last audit (`f895b14`). Inputs: chess.md run 2, visual.md run 2, the lead's
fixes after the visual report, the Windows `build-level.log` (2026-10-05 03:55Z), and pixel statistics of
`39-caged.png` and `39-annotator.png`.

Status labels:
- **done-verified**: re-checked here.
- **done-unverified**: claimed, with no independent evidence.
- **in progress**, **not started**, **blocked (owner)**, **dropped**.

Tests (stage 1, not re-run here, since no `packages/` change after `e981f32`): **475/475 with `TC_STOCKFISH`**, and
474 + 1 skipped without it. The floor stays at 475.

## 1. New findings (newest first)

- **F1 The lead's run-2 summary to the owner overstates two fixes.**
  - Claim: "your arms now reach the board's corners". Fact: `build-level.log` 03:55Z gives `player l ... error 24.8`
    (was 174) and `player r ... error 123.5` (was 561). The right arm is still far off its target (the clasp arms solve to 5.8 and 38.8), and in
    39-caged the left hand is still a fist, now on the a1 corner of the frame.
  - Claim: "the blood strip on rank 6 is gone". Fact: `a78d7a1` only swaps `"Pool"` for `"Spatter"` at the same
    `(6, 8)` placement. The visual judge located the clipping on the receiving side (the board-squares plane), and
    that was not touched. In 39-caged, the stain on f/g at ranks 5-6 still shows a straight upper edge.
  - Claim (03:12Z): the cage is "matte dark iron now". Fact: `MI_CageIron` still has `grime_color=(2.6, 1.3, 0.55)`
    (build_scene.py:1441), and the cage reads bronze/tan in 39-caged. Judge fix 3 is not done.
  - Report the measured values to the owner, not "done".
- **F2 The exposure "bisect" is one-sided, and its root cause is unknown.** The only new data point is a build with
  the decals off at the current commit (`bisect-nodecals.png`, mean 39.0). It is compared with 85 from earlier
  builds that also differ in straps and Annotator changes. There was no `TC_HAND_DECALS=1` rebuild at `a78d7a1` to
  show that 85 comes back. Exposure is meant to be fixed (`auto_exposure_min = max = TC_EV`, build_scene.py:1625).
    - A translucent deferred decal should not change the frame mean by 2x, so the real cause is still unexplained
      and can recur.
    - The measured result is real: frame mean 37.4 / 37.0 and saturation 140, against the reference's 27 / 150.
    - The frame is still about 0.5 stop over the reference: the judge's light and EV changes were not applied.
- **F3 The owner's top ask (veins, blood detail) went backwards this run.** With the hand decals off, the player's
  hands have no vein or dirt detail at all (39-caged). This is now routed entirely to the owner's 8K skin action.
  - The owner asked for free and code alternatives. Fixing the decal material, or a skin-texture override in
    `hands.py`, remains an option the lead can take without the owner.
  - Still open from run 2: no cuff or sleeve, no nail grime, no blood on pieces or hands, no relief in the blood.
- **F4 Visual judge fixes not done:**
  - **4/7 (hands):** only partly done (F1, F3).
  - **5 (Annotator):** the rivets are steel now, but the plate still reads light tan/brass, not dark steel. The
    checker eye grid and the flat patch card are unchanged. The oversleeves are still invisible (LIM-011).
  - **6 (poses):** the patient and the Annotator still have identical hands, pixel for pixel in 39-caged and
    39-annotator, and the hands still hide the black king and queen. There is no lean.
  - **7 (Black seat):** there is still no screenshot. The board turn passes `autotest.ps1 -Test rematch` (8/8,
    ROADMAP line 262), so F5 from run 1 is functionally closed but has no visual proof.
  - **8 (clutter):** not done.
  - The capture still reads back `SCS_FINAL_TONE_CURVE_HDR` (build_scene.py:1617), so skin detail can still not be
    judged.
- **F5 "Play a full game with the mouse" was silently dropped from the owner asks.** The lead's last three updates
  (03:12Z, 03:43Z, 04:00Z) list only 8K skin, DLSS and branches. ROADMAP line 265 still has the interactive mouse
  game as **Pending / owner**. Add it back to the owner list.
- **F6 Stale docs.**
  - VISUAL_REBUILD_ROADMAP logs passes only up to 28-31. Passes 32-39 (cage iron, hand decals and their removal,
    straitjacket, Annotator pose and plate, the exposure regression) are missing.
  - Its "Remaining gaps" list is obsolete. It still says "owner decision pending: Annotator vs caged patient" and
    "XR gloves with no forearms"; both were settled long ago.
  - Run 1's doc items (F6, F7) were otherwise fixed in `28b3976`: DLSS is tracked in RENDERING.md, the BUG-007
    wording is fixed, LIM-011 and the ROADMAP rows exist.
- **F7 Repo hygiene.**
  - Tracked screenshots grew from 84 MB to **119 MB** (59 PNGs).
  - The capture writes PNGs without truncating the file: each PNG keeps 0.26-0.8 MB of stale bytes after `IEND`.
    For example, `39-caged.png` is 3,090,912 bytes, but its IEND sits at 2,825,282. That is why every capture has one
    of exactly two file sizes.
  - Fix: delete the file before export, or re-encode. Switch to JPEG or LFS.
  - There are still three stale agent worktrees in `.claude/worktrees/`.
  - All 18 new commits are authored constantlods (the identity issue from run 1 is fixed).
- Checked and clean:
  - No secrets in the diff since `f895b14`: no keys, the owner's pasted SSH key absent, no signed URLs, no tokens.
  - The largest tracked file is 8.3 MB.
  - Windows work stayed in `C:\TownChess` (reads of the build log and scripts only).
  - GameCore authority and the test floor are intact (chess.md).

## 2. Owner requests

| # | Request | Status | Evidence | Gap |
|---|---|---|---|---|
| 0 | Latest: "okay continue with the build" (10-05 03:19Z) | **followed** | Annotator milestone (`476d73d`..`be79b31`), then pipeline run 2 | summaries overclaim (F1) |
| 1 | Native UE5 game, Windows first | done-verified | `ue5/TownChess`, packaged smoke | - |
| 2 | GameCore sole chess authority | done-verified | chess.md run 2 | - |
| 3 | Regression test per chess bug; count never drops | done-verified | 475 (floor met), BUG-007 is a normal test | - |
| 5/6 | M2 gameplay DoD, Windows sidecar proofs | done-verified (scripted) | ROADMAP 5b | crash recovery is not scripted |
| 7 | Owner plays a full game with the mouse | **pending, dropped from the owner asks** | ROADMAP line 265 | F5 |
| 8 | Windows PC rules + change log | done-verified | WINDOWS_SETUP; no new system changes seen | - |
| 9/10 | No secrets, no large binaries | done-verified | grep + size scan | screenshot growth (F7) |
| 11 | Critique -> render -> compare loop, documented | in progress | visual.md run 2, shots 32-39 | loop log stale (F6) |
| 12 | MetaHuman opponent in the cage mask | done-verified | 39-caged | cage not iron (F1); T-shirt; no lean |
| 13/20 | Helper agents, four-stage pipeline | done; run 2 at stage 3 | chess.md, visual.md, this file | stage 4 pending |
| 14a | Player picks character/hands | not started, tracked | ROADMAP line 264, LIM-011 | needs per-character MetaHumans |
| 14b | Board flips between games | done-verified (autotest) | ROADMAP line 262 (8/8) | no Black-seat screenshot |
| 14c/d | Clipboard cart with moves + opening, toggle | done-verified | `13-clipboard-raised.png`, ROADMAP line 260 | - |
| 14e | Simulated classic games / CPU vs CPU by Elo, bug watcher | done-verified | 60 games, 0 anomalies (chess.md) | no draw-path game yet; not in CI |
| 14f | Stockfish/league engines | done-verified | `27d4d00`, GPL as a separate process | - |
| 15 | Keep the caged patient, add the Annotator | in progress | 39-annotator | plate reads tan; oversleeves invisible; shared pose and MetaHuman (F4) |
| 16/17 | Voice/animation; physical interaction (M3) | research / not started | VOICE_OPTIONS.md, ROADMAP M3 | - |
| 18 | AAA realism like the reference: blood on the board, hand veins | in progress, **hands regressed** | 39-caged, frame mean 37 vs 27 | F1-F4 |
| 19 | Free assets only, code alternatives | done-verified | FREE_ASSETS.md; straps, plate and decals generated in-repo | concept-reference.jpg source (R5) |
| 21 | Chess agent for rules/engines | done-verified | BUG-007 found and fixed | - |
| 22 | DLSS if needed | **blocked (owner)**, tracked | RENDERING.md lines 57/103 | Fab plugin |
| 23 | MetaHuman 8K skin for hand veins | **blocked (owner)** | lead's asks 03:12Z / 04:00Z | code fallback exists (F3) |
| 24 | Delete merged branches | **blocked (owner OK)** | remote still has `agents/stockfish-league`, `claude/horror-chess-prototype` | - |

## 3. Wrong or risky (carried over)

- **R3** The cage-mask likeness to a famous film character. Re-check it as the patient gains detail (the
  straitjacket raises it).
- **R5** `docs/reference/concept-reference.jpg` is public with no recorded source or licence.
- **R7** Stale branches and worktrees (F7). There is no branch protection on `main`.

## 4. Next actions (priority order)

1. **Correct the record.**
   - Tell the owner the measured state: right-arm IK error 123.5, the spatter still on the board receiver, the cage
     still tan.
   - Put "play one full game with the mouse" back on the owner list (F5).
2. **Exposure.**
   - Do the decals-on control rebuild (`TC_HAND_DECALS=1`) at HEAD to confirm the bisect.
   - Find out why a decal moves a fixed exposure.
   - Then apply the judge's EV and light settings to reach frame ~27-30 and board ~55.
   - Switch the capture to a linear/HDR readback so skin can be judged.
3. **Hands without waiting for the owner:**
   - fix or replace the decal path (a skin override on the player-only material);
   - get the right arm into reach (error < 20);
   - open the left hand onto the frame;
   - add a cuff and sleeve;
   - capture a hands close-up.
4. **Blood:** fix the board receiver clipping (or keep decals off the squares), add relief, and put blood on 3-4
   pieces. Take a board close-up.
5. **Characters:**
   - `MI_CageIron` grime_color below 1, and round wire;
   - a dark Annotator plate, a drilled eye pattern, a bevelled patch;
   - separate poses (patient leans in, hands clear of the king and queen; Annotator holds the pencil).
6. **Docs:** log passes 32-39 and rewrite "Remaining gaps" in VISUAL_REBUILD_ROADMAP. Add a Black-seat screenshot.
7. **Owner:** 8K skin, DLSS plugin, branch deletion OK, the mouse game.
8. **Housekeeping:**
   - truncate PNGs on export and move to JPEG or LFS;
   - remove the stale worktrees;
   - delete the branches once the owner OKs it.
