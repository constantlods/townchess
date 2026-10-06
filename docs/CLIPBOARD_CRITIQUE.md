# Clipboard move record: hostile critique of the draft plan

Inputs: `reference-northstar.png` (main panel), `docs/screenshots/visual-loop/11-caged.png` and `12-annotator.png`,
`TCGame.cpp` (`ATCHUD::DrawGame`), `build_scene.py` (BS). Camera: eye `(-87, 0, top+42)`, pitch -15, 30 mm lens on a 36 mm
sensor, f/2.8 focused at 97 cm. **Focal length in pixels at 1080p = 30/36 x 1920 = 1600 px, so 1 cm at distance d cm = 1600/d px.**

## 0. Facts the plan ignores
- **The HUD has no move list today.** `DrawGame` draws only `OpeningEco + OpeningName` (line 519). `S.History[i].San` exists but nothing renders it, so this is new work, not a move.
- **The camera is fixed.** There is no mouse-look. `SetViewTargetWithBlend` only switches between the two seat cameras. A cart "just outside the frame" is never seen, and clicking it is impossible. `OnClick` only deprojects to the board plane (TCGame.cpp ~321).
- **A cart can't roll into frame.** At the eye's depth the half-FOV is 31 deg. At Y=+60 (beside the table) a cart is in frame only if X >= +15. That is the opponent's half of the room, about 130 cm from the eye (12 px/cm). The table blocks every closer path.
- **A paper prop is already in frame.** `binder_notebook` at `(-30,-40)` (BS) is the cream slab at lower-left. The earlier hostile review already flagged it as the brightest object, pinned to the frame edge. The plan adds a second paper prop without saying what happens to the first.
- **DOF will blur the text.** The DOF at f/2.8 focused at 97 cm runs from 89 to 107 cm. A sheet at 55 cm has a blur circle of 0.26 mm on the sensor, which is **about 14 px**. That is as tall as the letters.
- **The test screenshots hide the DOF problem.** `ShotCapture` is a SceneCapture2D, not the CineCamera, so it does not inherit the cine DOF. The near pieces in 11/12 look sharp when the real game would blur them. Acceptance shots must copy the camera's DOF and post settings into the capture, or they will pass text that players can't read.
- **The post settings are hostile to text at the edges.** Vignette 0.65 and scene fringe 0.15 both grow with radius. Chromatic fringing puts colour edges on 1-2 px pencil strokes. Fixed exposure (EV 8.5, min=max) helps, and `r.DefaultFeature.MotionBlur=False` helps. TSR (`r.AntiAliasingMethod=4`) does not.
- **Black's seat is mirrored.** Any prop that must stay at "the player's right" needs the `TC_SeatMirror` tag (BS `tag()`). Without it the clipboard sits on Black's left.

## 1. Readability (numbers)
- **Targets:** cap height >= 14 px for a clean monospace or print hand, and >= 18 px for cursive handwriting (don't use cursive). Row pitch >= 1.7 x cap, so 24 px. Ink/paper luma contrast >= 4.5:1 measured after tonemapping.
- **The rest state can't hold text.** Flat on the table at the binder's spot (82 cm, 31 deg elevation), 1 cm across is 19.6 px but 1 cm in depth is only about 10 px. A 14 px cap would need 1.4 cm letters. The resting prop is a "there is a record" cue, not a readout.
- **The raised state has to face the camera at about 57 cm (28 px/cm).** A 14 px cap is then 5 mm and a 24 px row is 8.5 mm.
- **About 40 plies:** use 2 columns x 15 rows = 30 moves (60 plies) per page. Sheet 16 x 18 cm on an 18 x 21 cm board, which is **about 508 x 593 px, or 26% of the width and 55% of the height**. A single column of 20 rows (40 plies) would need 24 cm of paper, about 680 px, which covers too much of the frame.
- **Column fit:** the worst cell is `exd8=Q+` (7 glyphs). In Patrick Hand at 14 px cap, the average advance is about 10 px, so 70 px fits a 2.8 cm (79 px) column. A typewriter face (0.6 em advance) does **not** fit 2 columns at this size. If the owner wants typewriter moves, drop to 1 column x 20 rows and accept the bigger sheet.
- **Long games:** move 31 starts page 2. The top sheet flips over the clip (0.3 s), and the header (players, opening, ECO) repeats on every page. The raised sheet always shows the page holding the current move. Mouse wheel / PgUp / PgDn browses earlier pages while raised, and the view snaps back on the next move. About 1 game in 3 at club level passes 30 moves, so this is core, not an edge case.
- **Opening name:** the ECO names run up to about 60 characters (e.g. "Queen's Gambit Declined: Semi-Slav Defense, Botvinnik System"). Split at the first `:`. Line 1 is the family at 6 mm cap, fitted to width and shrinking to 70% at most. Line 2 is the variation at 4 mm, with an ellipsis if it overflows. When the name changes, strike through the old one and write the new one beside it (in-fiction, and cheap). Freeze it after the game leaves book.

## 2. Placement and composition
- **The reference's layout:** player plates in the top corners; a left column of icon+label buttons (Offer Draw / Resign / Settings) on dark translucent plates at mid-height over the lamp base; the lamp at left; **stacked books and papers on the table's right**. The reference shows **no move list and no opening name** in the gameplay view. The record must be quieter than any of that.
- **So papers go right.** That balances the lamp and the button column on the left. This agrees with the owner's "right side" but not with the cart.
- **Free screen regions.** The board fills x 430-1530 (near edge) and 600-1330 (far edge), from y 650 down. The opponent fills x 740-1230, y 100-650. The right hand sits at x 1550-1900, y 880+. **The only clean slot is x 1380-1880, y 230-860**, over the dark wheelchair and bed. It sits just inside the area where vignette and fringe are still mild (sheet centre <= 0.75 of the half-width).
- **Verdict: toggled, not permanent.** A permanently readable sheet covers 14% of the frame next to the opponent. **At rest**, a small clipboard lies on the table's near-right corner, mirroring the binder at about `(-32,+42)`, yaw -12. It is dim and out of focus. **Raised**, it sits camera-relative at about (forward 51, right 21, down 0) cm in camera space, facing the eye with a 4 deg roll. Attach it to the active view target so both seats work without mirroring maths.
- **The cart becomes set dressing.** Put it beyond the table at the right, in the dark, with a kidney dish on it. It has no gameplay role. Cut it from the first pass.
- **Remove the left binder or age it to tint 0.5.** Two paper slabs mean two competing highlights.

## 3. Fonts (licensed, free)
| Use | Font | Licence | URL |
|---|---|---|---|
| Moves, names (hand print, very legible, clean O/0 and l/1) | Patrick Hand | SIL OFL 1.1 | https://fonts.google.com/specimen/Patrick+Hand |
| Alt. handwriting (less legible, use >= 16 px cap) | Caveat | SIL OFL 1.1 | https://fonts.google.com/specimen/Caveat |
| Typewriter form labels, moves if 1 column | Courier Prime | SIL OFL 1.1 | https://fonts.google.com/specimen/Courier+Prime |
| Distressed stencil header "WARD B - GAME RECORD" only (large sizes) | Special Elite | Apache 2.0 | https://fonts.google.com/specimen/Special+Elite |
| HUD fallback / reference-style thin caps | IBM Plex Mono (Light) | SIL OFL 1.1 | https://fonts.google.com/specimen/IBM+Plex+Mono |

Ship `OFL.txt` / `LICENSE` next to the `.ttf` under `ue5/TownChess/Content/Fonts/` and list the fonts in the third-party notices. Never use Special Elite for SAN, because its distressed glyphs blur `B/8` and `O/0` below 30 px. The current HUD uses `GEngine->GetMediumFont()` (Roboto), which matches nothing in the reference. Switch the button and plate text to Plex Mono Light caps in the same change.

## 4. Technical risks in UE
1. **Render path.** Write one function, `DrawScoreSheet(UCanvas*, FVector2D Size, const FTCGameState&)`, and use it twice. It paints a `UCanvasRenderTarget2D` (paper) on state change only, and it also draws the 2D fallback overlay in `ATCHUD`. One layout means the two can't drift apart. Reject the Text Render Component: no wrapping or pagination, one component per line, z-fighting with the paper at 0.05 cm offsets, and its own material, so the paper's lighting doesn't apply to it. A UMG WidgetComponent also works, but it adds UMG/Slate to `TownChess.Build.cs` and its render target has no mips.
2. **Render-target resolution and mips.** Use 1024 x 1152, R8 mask (ink coverage) with `bAutoGenerateMips=true`, trilinear filtering and 8x anisotropic. That gives about 2 texels per screen pixel when raised. Without mips, thin strokes shimmer under TSR and film grain. Verify that mips are regenerated after each repaint (it is a known trap). If they aren't, render at the 1:1 screen footprint. Colour the ink in the material, not in the render target, to avoid sRGB/linear stroke-weight errors.
3. **TSR.** Small high-contrast text smears under jitter, and smears badly below 100% screen percentage. Mark the paper material **Responsive AA** to cut ghosting when the sheet animates or a new move appears. Test at 67% screen percentage.
4. **DOF.** On raise, rack focus to 57 cm over 0.3 s and back on lower. The board softening while you read is a feature. Alternatively, keep f/2.8 and render the sheet as lit translucency in the After-DOF pass. That loses Lumen GI on the sheet, so it is the fallback option. Add a "Depth of field: off" accessibility option.
5. **Lighting and exposure.** The right side is outside the 65 deg `Lamp_Key` cone, so the sheet would be the darkest thing in frame. Add a small non-shadowing rect light "Clipboard_Read" (2400 K, about 40 lm, 60 cm attenuation radius) that turns on only in the raised pose. Also give the paper a 0.08 emissive floor taken from albedo, so it stays readable at `TC_EV` 8.0-9.5. Keep paper albedo at 0.55-0.62, aged yellow. White paper at 0.8 would clip and steal focus from the opponent, which is the binder problem again. Graphite with roughness < 0.5 glints and flips contrast at grazing angles, so keep it >= 0.65.
6. **Accessibility.** The toggle can't be the only way to see the moves. Add a setting, *Move record: Clipboard / Screen / Both*. The screen version is the same `DrawScoreSheet` on a dark translucent plate (reference style), under the left button column, with text scale 100 / 150 / 200%. Add "Copy PGN" (OS clipboard) and an optional spoken announcement of each move (see VOICE_OPTIONS.md). Make the key rebindable with a gamepad equivalent, offer hold-to-peek as an alternative to toggle, and let clicking the resting clipboard raise it (line trace before the board deprojection in `OnClick`). Raising must never block input: board clicks outside the sheet still work. A true screen reader needs Slate accessibility, which is Windows-only and immature, so PGN copy plus TTS is the practical answer.

## 5. What the reference implies that you missed
- **Hands are the interaction language** ("real hand animations"). The clipboard should be lifted by the right hand, not delivered by a self-driving cart.
- **The reference has no move list at all in the gameplay view.** The record is opt-in clutter, and its resting state must not draw the eye.
- **The UI lives on dark translucent plates in thin caps** (and the current HUD font does not). The fallback overlay must use that style, not paper.
- **The "WARD B" wall stencil** ties the form header to the room. Use the same lettering and add the plate names: `PATIENT_07 (W)` vs `MURKOFFGUEST (B)`.
- **Papers sit right, the lamp and buttons sit left.** Mood is warm amber everywhere, so paper is aged, never white.

## 6. Prioritised spec
**P0 (MVP)**
- **Prop:** masonite clipboard board 18 x 21 x 0.4 cm, steel spring clip 9 cm wide using the `mi_rust` variant, sheet 16 x 18 cm. Rest pose at `(-32, +42, top)`, yaw -12, tagged `TC_SeatMirror`. Remove or age the binder.
- **Raised pose:** camera-relative (51, 21, -0.4) cm, facing the eye, roll 4 deg. Screen bbox about x 1380-1880, y 240-850. Ease-out lift of 0.35 s from the rest pose, lower in 0.25 s.
- **Toggle:** Tab (rebindable), or a click on the clipboard. Hold-to-peek is optional. Starts lowered. **Auto-raise at game end** to show the final record with the result line `1-0  resigned`. Escape lowers it.
- **Layout (sheet, top to bottom):**
  - Header "WARD B - GAME RECORD" in Special Elite, 7 mm cap, plus "FORM 7-C" small.
  - Players line, 4 mm.
  - OPENING box, 14 x 2.4 cm: family 6 mm, variation 4 mm, ECO in a 1.8 cm box at right.
  - Move table: 2 columns x 15 rows, 8.5 mm pitch. Columns No 1.0 / White 2.8 / Black 2.8 cm, 0.6 cm gutter.
  - Ruled lines and printed labels in faded blue-grey at 30% contrast. Entries in Patrick Hand graphite, 5 mm cap. The newest ply gets a 0.2 s write-on wipe.
  - The opening name leaves the top HUD (delete line 519).
- **Materials:** paper albedo about sRGB (200,186,152), roughness 0.85. The existing grime params are masked to margins and folds, never over text rows. One tea ring on the header corner. Pencil albedo 0.06, roughness 0.7.
- **Rendering:** the shared `DrawScoreSheet`, a 1024 x 1152 mipped R8 render target repainted on `EventSeq` change, Responsive AA, rack focus on raise, and the "Clipboard_Read" light.
- **Fallback:** the screen overlay setting, the 150/200% text scale, and Copy PGN.

**P1:** page flip with PgUp/PgDn/wheel; strike-and-rewrite of the opening name; right-hand lift animation; the Annotator's pencil-scratch sound synced to the sheet update. The sheet then reads as his carbon copy, which answers "who is writing this?". Without him, the unexplained ghost-writing is fine and horror-appropriate.

**P2:** the cart as dark set dressing beyond the table; coffee and blood decals; a tear-off at the end of the game.

**Acceptance (all 1920x1080 via ShotCapture, with the cine DOF/post copied into the capture, run from both seats):**
1. **Readable:** a scripted 60-ply game, raised. OCR (tesseract) on the sheet crop matches >= 95% of SAN tokens and the opening family exactly. Measured "N" cap height >= 14 px. Ink/paper luma ratio >= 4.5:1.
2. **Robust:** test 1 still gets >= 90% at `TC_EV=8.0` and `9.5`, and at 67% screen percentage.
3. **Composition:** raised-minus-lowered pixel difference covers <= 2% of the board polygon and 0% of the opponent's head bbox.
4. **Quiet at rest:** lowered, no glyphs are detectable by OCR anywhere, the top band y<110 has no opening text, and the clipboard's mean luma is <= 0.8 x the opponent's lit face.
5. **Pagination:** at ply 61 the sheet's first row reads "31." and the header is unchanged.
6. **Responsive:** fully raised <= 0.4 s after the key press, and a board click during the raised state completes a move.
7. **Fallback:** with the clipboard disabled and Screen at 150%, test 1 passes on the overlay crop.
