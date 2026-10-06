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
| G2 | Every input path works in the packaged game | UE autotests cpu, drag, keys, promo, rematch, reconnect all pass on the current code | met 2026-10-06 (strict run, fresh results only: docs/evidence/autotest-suite-2026-10-06.json): cpu 52/52, drag 8/8, keys 13/13, rematch 8/8, promo 8/8; reconnect 31/31 (docs/evidence/evidence-run-2026-10-06.json, own result folder). Note: an earlier "rematch 8/8" (lead run 7) read a stale result file (empty -Extra aborted the script); the strict run replaces it |
| G3 | Opponents at every level, incl. the Stockfish league | packaged smoke vs `sf1600` passes; levels novice..sfmax listed in the menu | met 2026-10-06: packaged `-tcsmoke=16 -tcauto=cpu:sf1600:w:untimed` vs the Annotator: 16/16 plies, 0 failures, no Stockfish process left |
| G4 | A full game from menu to checkmate/resignation/draw to rematch, with clocks | autotest cpu (full game) + rematch; end card shows the result | met: cpu full game 52/52 (to checkmate) + end card after resignation with Rematch/Leave and the record clipboard (docs/evidence/end-card.jpg) + rematch 8/8 |
| G5 | Game record on the clipboard (Tab), opening name | keys autotest (Tab) + screenshot | met |

## Stability and performance

| # | Criterion | Check | Status |
|---|---|---|---|
| S1 | Packaged build starts on a clean launch and plays | `test_package.ps1`: smoke 12/12, Job Object pass, Defender 0 | met |
| S2 | Long play without errors | 10 consecutive packaged CPU-vs-engine games (autoplay), 0 desyncs, 0 crashes, no leaked processes | met 2026-10-06: `beta_checks.ps1` 10/10 (9 checkmates, 1 threefold repetition), 0 failures, 0 leftover processes |
| S3 | Frame rate | packaged build at 2560x1440, Epic + hardware RT on the RTX 4070 Ti SUPER: average >= 60 fps, 1% low >= 45 over a 60 s game (`stat unit`/CSV profiler) | partial: offscreen measurement 2026-10-06 (2560x1440, Auto: avg 91.4, 1% low 81.2) has no present/vsync cost (oversight run 4); a presented run on the owner's display is still needed |
| S4 | Recovers from a core crash and from a restored game | reconnect test + smoke with a journal-restored game | met 2026-10-06: killed at ply 12 (TerminateProcess), no orphan core, restored at the same ply/FEN, played on to checkmate (100/100); packaged smoke resigns a restored game and plays its own |

## Look (measured against the reference's main gameplay panel)

| # | Criterion | Check | Status |
|---|---|---|---|
| V1 | Exposure and grade | default view: mean luminance 24-30 (ref 26.6), 95th percentile <= 105 (97), red/green 1.38-1.50 (1.44), green/blue 1.55-1.70 (1.62) | met (pass 58: mean 26.4, p95 102.3, r/g 1.46, g/b 1.65; `58-main.png`) |
| V2 | Detail and wear | fine detail (mean abs Laplacian at 1045 px) >= 11.5 (ref 12.9) | not met (11.4, pass 58) |
| V3 | Visual judge | every row of docs/pipeline/visual.md >= 6/10, average >= 7/10 | not met: judge run 4 average 5.2/10, 8 of 14 rows below 6 |
| V4 | Hands like the reference | player hands show veins, dirt, nails in a close-up; judge score >= 7 | not met: visual judge run 4 hands 5/10 (veins overdone, dirt only in a non-default skin, nails never visible) |
| V5 | No placeholder or broken asset in any view | judge finds none (floating props, world-grid materials, clipping) in the main view, Black seat, close-ups | not met: judge run 4 lists 9 defects (bare knees in hand close-ups, crude watch, brass corners read as paper, captured pawn under the fingers, jagged sheet edge, ...); no Black-seat screenshot |

## Content and UX

| # | Criterion | Check | Status |
|---|---|---|---|
| C1 | Two opponents with distinct designs | caged patient, the Annotator; menu switch | met |
| C2 | Hand customization (reference panel) | at least: bare, dirty, scarred, sleeves, watch, gloves; remembered | partial 2026-10-06: menu "Hands" switches bare / dirty / scarred skins (material swap, `59-skins-in-game.png`, log "player look: scarred ... skin scarred") and sleeves / watch; gloves and tattooed skin missing |
| C3 | Menu, settings and HUD like the reference | find-a-game, time control, strength, opponent, hands, quality preset, view height, volume; end card; promotion card | met: docs/evidence/settings-panel.jpg (Volume, Graphics, View height), menu-credits.jpg (FIND A GAME, options, Hands, Settings), end-card.jpg; promotion card in the promo test; keys 13/13 drives the settings panel |
| C4 | Sound | piece move/capture; ambience; end-of-game sting | met: own synthesis (clack.py, ambience.py: 29 s ward loop, 4 s sting), volume in Settings |
| C5 | Credits and licences in game and in docs | FREE_ASSETS.md complete; a credits line in the menu | met: credits line on the menu (docs/evidence/menu-credits.jpg); FREE_ASSETS.md lists every download and generator |

## Release

| # | Criterion | Check | Status |
|---|---|---|---|
| R1 | Install notes for a player | docs/INSTALL.md: requirements, VC++ runtime, launch, known issues | met (docs/INSTALL.md) |
| R2 | Known limitations current | KNOWN_LIMITATIONS.md has no stale entry; every open bug has a severity | partial |
| R3 | Beta build on the build PC | `C:\TownChess\builds\Development\Windows` passes S1 and the pipeline signs off; PR #1 body lists the beta status | not yet |

## Owner requests tracked beyond the beta list (oversight run 4)

| Request | Where it stands |
|---|---|
| Keep improving mouse/drag feel ("still work on improvements if they are there") | Drag/drop, 0.2 s moves, hover, snap-back done (owner: "way better"); legal-move markers already show while dragging and the carried piece lifts 2.5 cm; open ideas: a contact shadow under the carried piece, drag inertia |
| An online opponent sees the hands/character you chose | Not built: needs the chosen look in the protocol (PLAYER_LOOK) and a remote-player avatar; post-beta |
| The reference's BOARD ENVIRONMENTS panel (Institutional Oak, Basement Table, Examination Room, ...) | Not built: one room exists; post-beta (each environment is a level variant) |

Nothing is published or shipped outside the owner's PC and the GitHub branch without the owner's say-so.
