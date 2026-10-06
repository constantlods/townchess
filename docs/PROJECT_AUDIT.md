# Project audit (oversight agent, stage 3, 2026-10-06 pipeline run 4, BETA focus)

Scope:
- `docs/BETA.md`, audited row by row at `origin/feature/photorealistic-renderer` = `2cab890`: 52 commits since the
  run-3 base `de4a920`.
- Inputs:
  - all 49 owner messages in the newest transcript, including the continuation summaries;
  - chess.md and visual.md from this run;
  - PR #1;
  - read-only file reads on townchess-win: `logs\beta-checks.json`, `logs\beta-game*.log`, `logs\pkg-smoke.log`,
    `logs\test-package-Development.json`, `autotest\*\result.json`, and the packaged `Saved\Logs\TownChess.log`.
- The build lock is held by another session, so no build, test or capture was run on the PC.
- V1/V2 were re-measured here from the committed PNG, with the method in tc-render-artist.md (crop of the reference
  panel, ours resized to 1045x588).

Tests (stage 1, re-run here): **479/479 with `TC_STOCKFISH`**, and **478 + 1 skipped** without it. Typecheck is
clean, and the floor is now 479. Sim seed 104: 13 games, 0 anomalies.

## 1. BETA rows vs evidence

Verdicts: **confirmed** (re-checked here), **overstated** (the status claims more than its evidence shows),
**evidence missing** (nothing that could fail is in the repo or on the PC), **agree** (not met / partial is right).

| # | BETA status | Verdict | Evidence found / gap |
|---|---|---|---|
| G1 | met (479/479) | **confirmed** | Re-run: 479/479 with TC_STOCKFISH, 478+1 skipped without. No open rules bug |
| G2 | met "on the current code": cpu 72/72, drag 8/8, keys 13/13, promo 8/8, rematch 8/8, reconnect 100/100 | **overstated** | `autotest\rematch\result.json` dates from 03:22. That is before a08af2a (03:59: Settings panel, HUD) and 3929ca8/d466ca1 (TCGame.cpp at 05:33). `cpu\result.json` (05:07) is now the reconnect test's kill phase: 23/23 checks, `pass` empty, `killed_at_ply`. The 72/72 full game is overwritten and can no longer be checked. drag (04:44), promo (05:03) and reconnect (05:08) predate d466ca1, a C++ change. Only keys (05:37) can be on the current code. No count is quoted in a commit message (969d5f9 says only "all autotests on the current code") |
| G3 | met: packaged sf1600 16/16 | **confirmed (perishable)** | Packaged `Saved\Logs\TownChess.log` 04:45: `league engine: ...\engines\stockfish.exe`, `smoke test PASS (plies reached, 16 plies, 0 failures)`. The next packaged run overwrites it. No screenshot shows the menu listing novice..sfmax |
| G4 | met | **evidence missing** | It rests on the cpu full game (overwritten, see G2) and on rematch (stale, 03:22). No end-card screenshot or log is cited |
| G5 | met | agree | keys 13/13 (05:37) includes Tab. The clipboard screenshot is pass 13 (old scene) |
| S1 | met | **confirmed** | `test-package-Development.json` 05:39 on the build packaged at 05:38: smoke 12/12, Job Object PASS, Defender 0 |
| S2 | met: 10/10 | **confirmed from the logs; summary broken** | `beta-game1..10.log` (04:14-04:18): 9 checkmates + 1 draw_repetition, all PASS. But `beta-checks.json` now reads `"games": [], "s2": "PASS 0/0"`: a perf-only run overwrote it, and `beta_checks.ps1:30` reports PASS for zero games. That check cannot fail |
| S3 | met: avg 91.4, 1% low 81.2 at 2560x1440 | **overstated** | The numbers match beta-checks.json, but the run was offscreen (no present/vsync, as the row admits). It is a 46-ply smoke rather than "a 60 s game", and it uses smoke frame times, not `stat unit`/CSV as the check asks. Needs one windowed or fullscreen run |
| S4 | met | **confirmed (reconnect); second half unverified** | `reconnect\result.json` 05:08: 100/100. "Smoke resigns a restored game" is documented in the ROADMAP (sf1600 row), but no log line was found for it |
| V1 | met (pass 58) | **confirmed** | Re-measured `58-main.png`: mean 26.4, p95 102.3, r/g 1.46, g/b 1.65 (reference 26.6/96.9/1.45/1.64). The measuring script is not in the repo; commit it so the check can be re-run |
| V2 | not met (11.4) | agree | Re-measured: 11.4 (reference 13.0 by this method; BETA says 12.9) |
| V3 | not met | agree | Visual judge run 4: **average 5.2**; 8 of 14 rows are below 6 |
| V4 | partial | **overstated: not met** | Judge: 5/10. Nails are never visible. Dirt only shows in the non-default skin. Veins are exaggerated |
| V5 | partial | **overstated: not met** | Judge lists 9 items. Bare knees in every close-up (LIM-014 says only "no seat view shows them", but V5 includes close-ups). Placeholder-grade watch. Brass corners that read as paper. Captured pawn under the fingers. Jagged sheet edge. No Black-seat screenshot exists, so V5 cannot be met yet |
| C1 | met | agree | `54-hud-portraits`, `58-main`, menu switch |
| C2 | partial | agree | `59-skins-in-game.png`. Gloves and tattoo are missing. "Remembered" is not evidenced |
| C3 | met | **overstated / evidence missing** | It cites screenshots `hud_caged/annotator`, which are not in the repo; the nearest is `54-hud-portraits`. No committed screenshot of the Settings panel, end card or promotion card for the current HUD. The judge has the HUD at 6/10: no row icons, and a monogram for the human |
| C4 | met | agree | `ue5/tools/audio/ambience.py`, `clack.py`. Volume is in the keys autotest |
| C5 | met | **evidence missing** | No screenshot shows the credits line: `52-menu-hands` (02:56) predates a08af2a (03:59). FREE_ASSETS rows exist |
| R1 | met | agree | docs/INSTALL.md |
| R2 | partial | agree | LIM-012..016 added with severities |
| R3 | not yet | agree | - |

Net, over the 15 rows marked met:

| Outcome | Rows |
|---|---|
| Confirmed as stated | G1, S1, V1 |
| Confirmed, but the evidence will be overwritten | G3, S2 |
| Agreed, not re-checked in depth | G5, C1, C4, R1 |
| Half confirmed | S4 |
| Overstated | G2, S3, C3 |
| No evidence | G4, C5 |

V4 and V5, marked partial, are not met.

## 2. New findings (newest first)

- **F1 Build-PC evidence is perishable and overwritten.** result.json, beta-checks.json and TownChess.log are
  replaced on every run. The reconnect test even writes into `autotest\cpu`. BETA rows cite counts that nothing in
  the repo records.
  - Fix: write each run to a dated file; copy the summary JSON (counts, commit SHA, build time) into
    `docs/pipeline/evidence/`; put the commit SHA into result.json (the `build`/`commit` fields are empty today).
- **F2 `beta_checks.ps1` passes vacuously:** `$res.s2 = ... "PASS $Games/$Games"` gives "PASS 0/0" for a perf-only
  run. Make S2 FAIL when `$Games -lt 10`, and keep perf in its own file.
- **F3 Screenshot growth is against the evidence rule.** There are 81 tracked screenshots, 144 MB (run 3: 62 files,
  105 MB): +39 MB in a day. AGENT_PIPELINE asks for the main view plus changed close-ups only. Passes 53-59 alone
  added 7 multi-panel PNGs. Use JPEG q90 for close-ups, or keep scratch captures on the PC.
- **F4 Chess guardian F1 (Low):** `TCLocalCore.cpp:94` honours `-tcallowstartfen` in Shipping builds via a
  process-wide environment variable. That contradicts the comment two lines above. Not a fairness hole (local,
  unrated), but guard it with `!UE_BUILD_SHIPPING`.
- **F5 The visual judge found new V5 items that are not in KNOWN_LIMITATIONS:** the watch model, the brass corner
  plates, the captured pawn under the fingers, the jagged record sheet, and the Annotator's checker eye. LIM-014
  (legs) understates the problem: the knees show in every committed hand close-up (53, 57, 59, 52-watch).
- Checked and clean:
  - Secrets: diff `de4a920..2cab890` grepped for password/token/AUTH_/PRIVATE KEY/ssh-rsa/ed25519/ghp_/github_pat/AKIA.
    The only hits are audit prose and WINDOWS_SETUP change 15 (AndroidFileServer disabled because it wrote a
    *local* token into DefaultEngine.ini; that token was not committed).
  - The largest tracked file is 8.3 MB (`T_HandlingGrime_Normal.png`); nothing is over 10 MB.
  - GameCore authority: the only `packages/` change is 8a3f90e (startFen opt-in, verified by stage 1).
  - Free assets: the new sounds and portraits are own work and recorded in FREE_ASSETS (5b40049). Player skins are
    derived from MetaHuman textures and kept out of the repo (`TC_SKIN_DIR`).
  - All commits are by constantlods.

## 3. Owner requests

| # | Request | Status | Evidence | Gap |
|---|---|---|---|---|
| 0 | Latest (10-06 07:55Z): "continue ... all the way to the end ... deploy agents (critique, rendering, github, review vs picture) ... till the build is in beta phase" | **in progress** | BETA.md, tc-render-artist, pipeline run 4 | BETA: V2, V3, V4, V5, C2, R2 and R3 open; 5 met rows disputed (G2, G4, S3, C3, C5) |
| 0a | 10-06 03:13Z: "mouse movement way better, still work on improvements"; "pieces still hide behind each other"; "still extremely low quality" | in progress | seat view on the wheel (145821c, `47-view-heights`); V3 5.2 | **No open item tracks further mouse/drag feel work.** Add one, or ask the owner what still feels off |
| 1-3 | Native UE5, GameCore authority, a regression test per bug | done-verified | chess.md run 4 | - |
| 7 | Owner plays a full game with the mouse | done (owner played: 10-06 03:13Z feedback) | owner message | - |
| 14a | Player picks character/hands; "so can his opponent" | **partial** | Hands menu: bare/dirty/scarred/sleeves/watch; opponent choice in the menu | **Not tracked:** an online opponent seeing the other player's chosen hands/character. LIM-013 covers only the missing server |
| 14b | Board flips between games | done (stale) | rematch 8/8 (03:22) | No Black-seat screenshot, which V5 also needs |
| 14c/d | Clipboard cart, Tab toggle | done-verified | keys 13/13 | - |
| 14e/f | Simulated classics, CPU by Elo, Stockfish league | done-verified | 86 sim games, 0 anomalies; packaged sf1600 16/16 | - |
| 15 | Caged patient + Annotator | done | C1 | The Annotator plate is flat and bright (visual.md) |
| 18 | "blood on the board, veins in the hands ... extremely detailed" | in progress | V2 11.4/11.5, V4 5/10 | visual.md top 8 |
| 19 | Free assets only | done-verified | FREE_ASSETS | - |
| 22 | DLSS if needed | tracked (LIM-012) | plugin not installed | owner action |
| - | Reference panels: BOARD ENVIRONMENTS (6 rooms), tattooed hands, gloves, Rated queue, row icons | **partly untracked** | gloves/tattoo in LIM-016; environments only as ROADMAP phase 9 | **Environments are not in BETA.md:** ask the owner whether beta needs them |

## 4. Wrong or risky (carried over)

- **R3** The cage mask's likeness to a famous film character (unchanged).
- **R5** `docs/reference/concept-reference.jpg` is public with no recorded source or licence.
- **R7** There is no branch protection on `main`.

## 5. Next actions (priority order)

1. **Make the BETA evidence durable** (F1, F2). Rerun cpu, drag, promo, rematch and reconnect on HEAD once, with
   dated results and SHAs, then correct G2, G4 and S2.
2. **Correct the BETA statuses:** V4 and V5 "not met". S3 "met offscreen; windowed run pending". C3 and C5 need a
   current menu/Settings/end-card screenshot.
3. **Visual top 8 (visual.md):** legs (LIM-014 widened), both hands in view, dirty skin by default, the patient's
   jacket, brass corners, watch, lamp, table detail. Capture a Black-seat view.
4. Guard `-tcallowstartfen` in Shipping (F4). Commit the V1/V2 measuring script.
5. Screenshot budget (F3). Ask the owner about environments for beta and about online hand visibility.
