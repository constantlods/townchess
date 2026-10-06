# Beta criteria

The owner asked for the build to be carried "all the way till the build is in beta phase". Beta means: a complete,
stable game a stranger could install and play, that looks like the reference image (docs/reference/concept-reference.jpg)
in its main view, with no known bug that breaks a game. Every item below has a check that can fail; an item counts as
met only with the evidence named in its row (a test result, a measurement, or a screenshot the visual judge scored).

Status is kept in the table; the lead updates it after each milestone and the oversight stage audits it.

## Gameplay and rules

| # | Criterion | Check | Status |
|---|---|---|---|
| G1 | Rules engine complete and the only authority | `npm test` with TC_STOCKFISH: all pass, count never drops; chess guardian run without open rules bugs | met (479/479) |
| G2 | Every input path works in the packaged game | UE autotests cpu, drag, keys, promo, rematch, reconnect all pass on the current code | partial (reconnect not re-run since the HUD rewrite) |
| G3 | Opponents at every level, incl. the Stockfish league | packaged smoke vs `sf1600` passes; levels novice..sfmax listed in the menu | met (earlier run; re-run at beta) |
| G4 | A full game from menu to checkmate/resignation/draw to rematch, with clocks | autotest cpu (full game) + rematch; end card shows the result | met |
| G5 | Game record on the clipboard (Tab), opening name | keys autotest (Tab) + screenshot | met |

## Stability and performance

| # | Criterion | Check | Status |
|---|---|---|---|
| S1 | Packaged build starts on a clean launch and plays | `test_package.ps1`: smoke 12/12, Job Object pass, Defender 0 | met |
| S2 | Long play without errors | 10 consecutive packaged CPU-vs-engine games (autoplay), 0 desyncs, 0 crashes, no leaked processes | met 2026-10-06: `beta_checks.ps1` 10/10 (9 checkmates, 1 threefold repetition), 0 failures, 0 leftover processes |
| S3 | Frame rate | packaged build at 2560x1440, Epic + hardware RT on the RTX 4070 Ti SUPER: average >= 60 fps, 1% low >= 45 over a 60 s game (`stat unit`/CSV profiler) | met 2026-10-06: 2560x1440, Auto (Epic + HW RT): avg 91.4 fps, 1% low 81.2 over a full game (smoke frame times after a 10 s warm-up; offscreen, so no present/vsync cost) |
| S4 | Recovers from a core crash and from a restored game | reconnect test + smoke with a journal-restored game | met (earlier), re-run at beta |

## Look (measured against the reference's main gameplay panel)

| # | Criterion | Check | Status |
|---|---|---|---|
| V1 | Exposure and grade | default view: mean luminance 24-30 (ref 26.6), 95th percentile <= 105 (97), red/green 1.38-1.50 (1.44), green/blue 1.55-1.70 (1.62) | partial (p95 118, r/g 1.54) |
| V2 | Detail and wear | fine detail (mean abs Laplacian at 1045 px) >= 11.5 (ref 12.9) | not met (9.9) |
| V3 | Visual judge | every row of docs/pipeline/visual.md >= 6/10, average >= 7/10 | not met |
| V4 | Hands like the reference | player hands show veins, dirt, nails in a close-up; judge score >= 7 | partial (pass 53: veins and tendons in the main view and close-ups; dirt light; not judged) |
| V5 | No placeholder or broken asset in any view | judge finds none (floating props, world-grid materials, clipping) in the main view, Black seat, close-ups | partial |

## Content and UX

| # | Criterion | Check | Status |
|---|---|---|---|
| C1 | Two opponents with distinct designs | caged patient, the Annotator; menu switch | met |
| C2 | Hand customization (reference panel) | at least: bare, dirty, scarred, sleeves, watch, gloves; remembered | partial (bare, sleeves, watch) |
| C3 | Menu, settings and HUD like the reference | find-a-game, time control, strength, opponent, hands, quality preset, view height, volume; end card; promotion card | met 2026-10-06: menu, Settings panel (volume, graphics, view height; keys autotest 13/13), end card, promotion card, portraits on the player cards (screenshots hud_caged/annotator) |
| C4 | Sound | piece move/capture; ambience; end-of-game sting | met: own synthesis (clack.py, ambience.py: 29 s ward loop, 4 s sting), volume in Settings |
| C5 | Credits and licences in game and in docs | FREE_ASSETS.md complete; a credits line in the menu | met: credits line on the menu; FREE_ASSETS rows for every generator and download |

## Release

| # | Criterion | Check | Status |
|---|---|---|---|
| R1 | Install notes for a player | docs/INSTALL.md: requirements, VC++ runtime, launch, known issues | met (docs/INSTALL.md) |
| R2 | Known limitations current | KNOWN_LIMITATIONS.md has no stale entry; every open bug has a severity | partial |
| R3 | Beta build on the build PC | `C:\TownChess\builds\Development\Windows` passes S1 and the pipeline signs off; PR #1 body lists the beta status | not yet |

Nothing is published or shipped outside the owner's PC and the GitHub branch without the owner's say-so.
