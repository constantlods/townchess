# Visual judge report (stage 2)

Latest: **run 7 (2026-10-16, base `b847d2d`), at the end of this file**: average 6.27; V3, V4 and V5 not met.
Previous: run 6 (2026-10-15, base `da356aa`): average 6.00.

Date: 2026-10-13. Run "baseline 2026-10-13" (independent judge, role 15), base `a82c55d`. Reference:
`docs/reference/concept-reference.jpg`, main panel (top-left, 0..1045 x 0..685) plus the HAND CUSTOMIZATION panel.
Judged: `docs/graphics/baseline/base_main.jpg`, `base_black.jpg`, `base_hands.jpg`, `base_opponent.jpg` (all 1920x1080)
and `metrics.json`. The specialists' Phase A outputs were not read. Previous run: run 4 (2026-10-06, base `d466ca1`).

## Findings first (evidence)

1. **The hand close-up shows a broken asset** (`base_hands`). It is the worst image in the set.
   - The hand mesh is deformed: the fingers are stretched, and the finger silhouettes double over each other
     (x 0-500, y 380-480). The fingers slide into the palm.
   - The hand clips through the white pieces: a pawn (x 330, y 520) and a knight (x 280-430, y 560-900) pass through the
     fingers.
   - The dirt is stamped dark blotches of one size, like decals. The veins are even-width tubes. No nails are visible.
   - The watch dial is printed upside down or mirrored: "12" sits near the 6 o'clock position and "3" sits on the left
     (x 1470-1700, y 280-360). The strap is a flat, untextured box with blocky lugs.
   - The sleeve shows stair-step banding along its edge (x 1550-1920), and its fabric is untextured.
2. **Grading does the work, not the assets** (see "Post-processing hiding weak assets" below).
   - `metrics.json`: rg 1.44 / gb 1.64 match the reference (1.44 / 1.62) exactly, and the mean is 25.6 vs 26.6.
   - Fine detail is 11.19 against 12.94 (`base_black` 10.6), even with film grain 0.5 adding noise.
   - The colour match comes from the global desaturation and the warm grade (build_scene.py ~1965-1980). Every material
     collapses to one brown.
3. **The lamp is dead as a light source** (`base_main` x 230-640, y 0-200). The shade is a dull dented dome with no
   lit rim, no glow and no hot pool under it. The brightest thing above the board is the opponent's bald orange
   scalp (p95 102 vs 97). In the reference, the lamp is the key: a hot cone on the left of the board, with the room
   falling off to black.
4. **The table texture looks procedural** (`base_main` x 1300-1900, y 600-1000 and x 0-650, y 600-760).
   - The "knife scars" are hundreds of straight, uniform hairlines, like scattered pine needles. They are not gouges.
   - Between them, the wood is a flat dark brown. The reference has peeling varnish, pale worn patches and grime.
   - Source: `Scratch` decals (build_scene.py ~1484) using the stains.py `scratch` texture.
5. **The main view now frames hands, board and opponent like the reference** (better than run 4).
   - The left hand has a wrist, sleeve and watch, and the dirt reads.
   - The right hand is a cropped, shadowed fist at the bottom-right, with no wrist (x 1350-1650, y 870-1080).
6. **The opponent's face is good in the close-up** (`base_opponent`). The MetaHuman skin, eyes and wrinkles are the
   best asset in the build. But it is clean and dry: no sweat, grime or blood. The cage is clean, smooth bronze with
   one rivet. The reference shows a heavier, riveted, rusted iron cage helmet.
   - The gown is a long-sleeved olive/beige garment with a pale bib panel, and is far less filthy than the
     reference's stained canvas jacket. The round dark buckle disc still sits at mid-chest (`base_main` x 990, y 435).
7. **The Black seat works** (`base_black`). The board is flipped correctly (black pieces near), and the HUD swaps
   colours. It inherits every main-view defect. Fine detail is lower (10.6).

## Scores (0-10 vs the reference)

| Element | Run 4 | Baseline 10-13 | Change | Note |
|---|---|---|---|---|
| Opponent: face | 5 | 6 | better | Strong MetaHuman close-up. Clean, dry and orange-lit, with a bald scalp as the hottest highlight |
| Opponent: body/pose | 6 | 6 | same | Folded arms, upright and stiff. The hands sit over the black back rank |
| Opponent: clothing | 4 | 5 | better | Long sleeves now. Clean olive cloth, a pale bib, a chest disc |
| Mask | 5 | 6 | better | The cage reads clearly. Too clean and smooth, no rust or rivets |
| Player hands | 4 | 5 | better | Two hands in the main view, dirt by default, a watch. The close-up is broken (finding 1) |
| Pieces | 6 | 6 | same | Good Staunton shapes. A plastic ivory sheen, white speckle noise on the rook crowns, no chips or blood |
| Board | 6 | 6 | same | Frame and grime are fine, and the corner plates no longer read as paper. The squares look printed and flat |
| Blood / wear | 5 | 5 | same | 4-5 splats on the squares. None on the pieces, hands or table edge at gameplay scale |
| Table | 4 | 4 | same | Needle-like straight scratches over flat brown (finding 4) |
| Props / clutter | 5 | 5 | same | The books, mug and pill bottle are OK. The tape roll is a white blob. The clipboard is a pale tilted slab (right) |
| Environment | 5 | 5 | same | Bed springs are a glowing blue-white grid, and the wheelchair helps. No WARD B sign, no window, no wall texture |
| Lighting | 6 | 5 | worse | The lamp emits nothing visible and the board is evenly lit. The scalp is the key highlight (finding 3) |
| Camera / composition | 6 | 7 | better | Hands + board + opponent, like the reference. The right hand is cropped |
| UI / HUD | 6 | 6 | same | Clean cards. The player portrait is an unreadable skin smear. No row icons, plain timers |
| Black-seat view | n/a | 6 | new | Correct flip. Same defects as the main view |
| **Average** | 5.2 (14 rows) | **5.53** (15 rows; 5.50 on the 14 comparable rows) | +0.3 | **Not at BETA** (needs 7). 6 of 15 rows are 5 or lower |

**V4 (hands: veins, dirt, nails; >= 7): 5/10, not met.** The dirt reads at gameplay distance. Up close, the veins are
tubes and the dirt is blotch decals. No nails are visible in any image, and the close-up mesh is deformed and clips.

**V5 (placeholder/broken/clipping): not met.** Every defect seen:
1. Hand mesh deformation: stretched, overlapping fingers (`base_hands` x 0-500, y 380-480).
2. The hand clips through a white pawn and knight (`base_hands` x 280-430, y 500-900).
3. The watch dial is upside down or mirrored (`base_hands`). The strap is an untextured flat box.
4. Stair-step banding on the player sleeve edge, and the fabric is untextured (`base_hands` x 1550-1920).
5. The opponent's hands/fingers overlap the black king/queen tops on the back rank (`base_main` x 880-1000, y 520-560).
   This needs a close-up to confirm whether it is clipping or occlusion.
6. The clipboard sheet is a pale tilted slab with a blank grid, and reads as untextured (`base_main` x 1680-1920,
   y 540-720).
7. The tape roll is an untextured white blob (`base_main` x 1490-1560, y 670-730).
8. White firefly speckles on the near rook crowns, a denoiser artefact (`base_main` x 580-620, y 870-900).
9. The bed springs render as an emissive-looking blue-white wire grid (`base_main` x 120-690, y 230-400).
10. The HUD player portrait is an unreadable smear (top-left card).
No default world-grid materials were seen.

## Post-processing hiding weak assets
- **Saturation 0.72 + warm grade**: the colour metrics match by grading, and every material ends up the same brown.
  Wood, cloth, brass and skin have no hue separation. Check the scene with the grade off: if the materials only
  match through the LUT, the grade is hiding them.
- **Film grain 0.5 + vignette 0.65**: the grain masks the low texture resolution on the pieces, the gown and the
  table. The vignette crushes the frame corners, which hide an empty room (left and right are black).
- **Detail metric**: 11.19 counts that grain as detail. The real asset detail is lower than the number says.

## Three largest remaining weaknesses
1. **Player hands as an asset** (deformation, clipping, decal dirt, no nails, watch dial/strap, sleeve).
2. **The lighting has no motivated key.** The lamp is dark, there is no pool on the board, and the scalp is the
   highlight.
3. **Material quality on large surfaces** (the table's needle scratches, flat brown wood, clean gown, clean cage).
   This is masked by the grade.

## Top 8 fixes (payoff per effort, cause in code)
1. Hand pose/skin weights in the close-up: check the `player:` IK targets and finger curls in
   `build_seated_pose(..., "player")`. Add collision offsets so the fingers rest beside the pieces, not through them.
2. Watch dial: flip the U/V in props.py `wristwatch()` (~902) or in textures/watch.py. Bevel and texture the strap
   (`MI_WatchStrap`, build_scene.py ~1790).
3. Lamp: raise the `M_TC_Bulb` emissive and the key spot intensity, tighten the cone onto the board's left half
   (build_scene.py ~1405, ~1891), and light the inside of the shade.
4. Table: replace the stains.py `scratch` hairlines with a few deep, wide gouges. Swap `wood_table_worn` for a CC0
   worn/peeling-varnish set (ambientCG).
5. Grime pass on the patient: dirty gown (`MI_PatientShirt`), rust/edge wear on the cage, and a sweat/roughness mask
   on the face.
6. Sleeve: add cloth normal/albedo to `MI_PlayerSleeve` (CC0 fabric), and smooth the normals on props.py `sleeve()`.
7. Pieces: chips, blood and less specular sheen. Raise the denoiser/spp, or clamp emissive fireflies on the rook crowns.
8. Clipboard sheet and tape roll: texture them, or darken the sheet; dim the bed-spring material.

## Character design
- **Caged patient**: the silhouette is right (hunched, caged, folded arms). The face is the best asset, but it is
  clean. The reference reads as a filthy, wet patient in a stained jacket; ours reads as a clean orderly.
- **The Annotator**: not in this baseline set, so not judged.

---

# Run 6 (2026-10-15): judge re-score after C2.3-C6

Base `da356aa` (upstream; includes C2.3 lighting, C3 materials, C4/C4.1 board/props/room, C5 hands round 2, C6
materials). Build PC: lock `judge` 07:46-08:07 PC time; `git pull` to da356aa, L_Table rebuilt with `setup_content.ps1`
(BUILD OK, 169 actors); no C++ change since the PC's last build. Captures: `capture.ps1 -Preset epic 1920x1080
-WarmSec 22`, benchmark cameras (benchmark.ps1: main, black, hands, opponent) plus close-ups. Evidence (downscaled):
`docs/graphics/judge/run6-*.jpg`; `run6-crops.jpg` = main-view crops at 2-6x (row 1: HUD portrait + lamp, right
white rook crown, left white knight; row 2: watch dial rotated 180 deg, table near edge, table left of the board).
Coordinates below are in the 1920x1080 originals (close-ups: their own 1920x1080 frame). Specialists' reports were
not used for scoring; only the images.

V1 check on the main/Black captures (1045 px, Rec.709): main mean 29.4, p95 96, r/g 1.484, g/b 1.696; Black 27.8 /
92 / 1.497 / 1.696. Inside the V1 bounds in both seats; g/b sits 0.004 under its limit.

## Findings first (evidence)

1. **The hands are no longer broken** (`run6-hands`, `run6-hand-seat-left/right`, `run6-nails`). Fingertips rest on
   the board frame and table, no finger enters a piece, and the stretched, doubled fingers are gone. The skin is the
   weak part: one waxy orange-brown tone, sausage-smooth fingertips, no wet sheen or roughness change, no scars.
2. **The opponent's pose now matches the reference** (`run6-main` x 840-1000, y 240-480): steepled hands raised to the
   caged face. The cage is dark, pitted, hammered iron with a brow band and nose strap (`run6-opponent`). The gown is
   still a clean, smooth beige cloth, and the face and hands are clean and dry. The bald scalp is still the hottest
   orange highlight above the board (x 830-950, y 60-130).
3. **The lamp is in frame but is not a light source** (`run6-lamp`, main x 340-615, y 0-195). The dome reads as worn
   metal. Its mouth is a flat pale grey band with no glow, and there is no bulb and no hot core. The board pool and the
   long piece shadows now read as lamp light, which is the biggest lighting gain since the baseline.
4. **Shadow noise shows on large surfaces.** There is a dithered, salt-and-pepper pattern in the shadowed gown (main
   x 1050-1150, y 380-560; Black seat the same) and dark grain inside the right white rook's crown (main x 1385-1420,
   y 710-725). The white firefly specks of the baseline are gone.
5. **The table still looks procedural.** The C6 "deep gouges" render as pale dashed lines inside a halo of hairline
   scratches (`run6-table-edge` x 600-1900, y 300-560). At seat distance they read as chalk "W" strokes (main x 270-350,
   y 630-700). The near-edge face has decal streaks stretched into a fur-like texture (`run6-table-edge` y 550-1000).
   A hard-edged rectangular red decal sits on that edge (`run6-table-edge` x 1370-1560, y 480-690; main x 995-1050,
   y 1025-1070).
6. **The props are real objects now** (`run6-clipboard`, `run6-tape`, `run6-beds`). The clipboard holds a stained,
   handwritten record, the tape is a roll with a core, and the bed springs are dark wire. One new defect: the record's
   header is printed twice over itself ("WARD - BATIENTRECORD", `run6-clipboard` x 1080-1560, y 650-830).

## Scores (0-10 vs the reference)

| Element | Baseline 10-13 | Run 6 | Change | Evidence |
|---|---|---|---|---|
| Opponent: face | 6 | 6 | same | `run6-opponent`: strong MetaHuman skin and eyes. Clean and dry, and the scalp is the hot highlight (main x 830-950, y 60-130) |
| Opponent: body/pose | 6 | 7 | better | Steepled hands at the mask, as in the reference (main x 840-1000, y 240-480). Upright, does not lean in on the elbows |
| Opponent: clothing | 5 | 5 | same | Clean, smooth beige gown with no stains. Dither noise in its shadows (main x 1050-1150, y 380-560) |
| Mask | 6 | 7 | better | Dark hammered iron, pits, brow band and nose strap (`run6-opponent`, `run6-cage-side`). A thin wire basket, not a heavy riveted helmet. No rust |
| Player hands | 5 | 6 | better | No deformation or clipping. Veins and crease dirt read. Uniform waxy skin; nails weak from the seat (V4) |
| Pieces | 6 | 6 | same | Fireflies gone, AO in the cavities (`run6-rook`). Matte beige "plastic", faceted silhouettes up close (`run6-nails` knight x 830-890), no chips or blood. Black pieces look like bronze in `run6-opponent-hands` |
| Board | 6 | 6 | same | Mottled squares, blood, brass pins. A regular grid of pin-prick dots on the squares (`run6-rook`, `run6-rook-seat` x 0-600, y 0-400) |
| Blood / wear | 5 | 5 | same | Splats on squares, a flat red smear on the table (main x 1700-1900, y 780-860), a rectangular decal on the edge. None on pieces or hands |
| Table | 4 | 5 | better | Fewer needle lines in the main view. Dashed "gouges", chalk strokes, fur-like edge (finding 5). No peeling varnish or pale worn patches |
| Props / clutter | 5 | 6 | better | Real clipboard record, tape roll, lamp dome, mug, pill bottle, books on the cart. Double-printed header. The record is upside down from the seat |
| Environment | 5 | 6 | better | Dark bed wires, brick and plaster wall, cell bars, tiled floor, wheelchair. A stretched, streaky lit panel behind the lamp (main x 370-460, y 180-560; `run6-beds` x 740-1200). No WARD B sign, no window or cold accent |
| Lighting | 5 | 6 | better | Board pool and long lamp shadows; the room is legible. The lamp mouth is a flat grey band, the scalp out-shines it, no cold back light, shadow noise |
| Camera / composition | 7 | 7 | same | Both hands at the lower corners on the frame, board centred, opponent top centre, lamp top left: close to the reference. The wrists are cut by the bottom edge |
| UI / HUD | 6 | 6 | same | Same cards and plain timers, no row icons. The player portrait is a dim, cluttered hand crop (`run6-crops` row 1) |
| Black-seat view | 6 | 6 | same | Correct flip and HUD swap, and a captured piece stands beside the board (x 450-510, y 490-610). Same defects and noise as the main view |
| **Average** | **5.53** | **6.00** (15 rows) | +0.47 | 3 rows below 6 (clothing, blood/wear, table) |

**V3 (every row >= 6, average >= 7): not met.** The average is 6.00, and 3 rows are at 5.

**V4 (hands >= 7: veins, dirt, nails): 6/10, not met.**
- Veins: they read. The back of the hand shows raised veins and tendons (`run6-hand-seat-left` x 400-1000, y 300-500),
  slightly lumpy and worm-like.
- Dirt: it reads in the knuckle creases and as specks (`run6-hand-seat-right` x 640-760, y 300-400), and as smears on
  the fingers (`run6-nails` x 820-1050, y 0-450). It is sparse; the reference's hands are filthy and wet.
- Nails: visible in close-ups (`run6-nails` x 1200-1360, y 560-700; `run6-hand-seat-right` little finger x 575-660,
  y 770-870). From the seat they are faint on the little finger and absent on the index and middle fingertips, which
  render as smooth rounded caps.
- Still missing: skin tone and roughness variation (waxy, uniform orange), a wet sheen, and scars.

**V5 (no placeholder, broken or clipping asset): not met.** 13 defects, listed below.

Baseline defects:

| # | Baseline defect | Run 6 |
|---|---|---|
| 1 | Stretched, overlapping fingers | fixed (`run6-hands`, `run6-hand-seat-left/right`) |
| 2 | Hand through a pawn and a knight | fixed: fingertips on the frame (`run6-hands`, `run6-nails`) |
| 3 | Mirrored dial, flat strap | dial: **retracted, not a defect**. Rotated 180 deg, the dial reads normally, with 3 toward the hand (`run6-watch-dial`, `run6-crops`). The baseline misread the viewing angle; the dial asset did not change. Strap: fixed, now curved and scuffed with a keeper (`run6-watch-strap`). See new #13 |
| 4 | Banded, untextured sleeve | fixed: canvas weave, no stair-steps (`run6-sleeve-watch`). See new #12 |
| 5 | Opponent's fingers over the black back rank | fixed: the hands are raised to the mask |
| 6 | Clipboard slab | fixed: a textured record. See new #7 |
| 7 | Tape roll blob | fixed: a roll with a core (`run6-tape`). It is plain |
| 8 | Rook-crown specks | partly fixed: the white fireflies are gone; dark grain remains in one crown (new #2) |
| 9 | Glowing bed springs | fixed: dark wire (`run6-beds`) |
| 10 | Smeared HUD player portrait | still present, weaker: it reads as a hand only at 2x zoom (`run6-crops`, main x 35-100, y 28-90) |

New list. Main view and Black seat:
1. Dithered shadow noise on the opponent's gown, in both seats (main x 1050-1150, y 380-560).
2. Dark grain in the right white rook's crown (main x 1385-1420, y 710-725).
3. A hard-edged rectangular red decal on the table's near edge (main x 995-1050, y 1025-1070; `run6-table-edge`
   x 1370-1560, y 480-690).
4. Decal streaks stretched over the near-edge face of the table, so it reads as fur (`run6-table-edge` y 550-1000).
5. A stretched, streaky texture on the lit wall panel behind the lamp (main x 370-460, y 180-560; `run6-lamp`
   x 910-1150, y 560-1080; `run6-beds` x 740-1200, y 0-830).
6. The lamp mouth is a flat pale grey band that reads as unlit plastic (`run6-lamp` x 610-1390, y 450-700).
7. The clipboard header is printed twice over itself (`run6-clipboard` x 1080-1560, y 650-830).
8. A faint pale rectangle on the left white knight's neck (main x 630-640, y 766-780; `run6-crops`). Low confidence.

Close-ups:

9. A regular pin-prick dot grid on the board squares (`run6-rook`, `run6-rook-seat`).
10. The table gouges are dashed pale lines with a halo of hairline scratches (`run6-table-edge` x 600-1900,
    y 300-560).
11. Faceted, low-poly silhouettes: the knight (`run6-nails` x 830-890) and the watch bezel (`run6-watch-dial`).
12. The sleeve's grime band has a hard straight vertical edge (`run6-sleeve-watch` x 1580-1650), and the weave
    stretches along the cuff roll (`run6-watch-strap` x 700-1000, y 300-850).
13. From the side, the strap end is a flat blocky tab (`run6-sleeve-watch` x 120-350, y 620-1000).

Checked and not found: no world-grid materials, no floating props. There is no hand-piece or hand-hand clipping in
the idle pose. The opponent's fingertips touch the front of the cage; no penetration is visible in `run6-main`,
`run6-opponent` or `run6-cage-side`.

## Top 5 remaining gaps to the reference (ranked by payoff)

1. **The lamp is not the visible key, and the shadows are noisy.** The mouth is a flat grey band, there is no hot core
   or glow, the scalp out-shines the lamp, and there is no cold back accent. Dither and grain in the shadows (V5 #1,
   #2, #6). Owner: rendering architect (C7), with board/environment for the lamp-mouth material.
2. **The hand skin does not match the reference.** It is a waxy, uniform albedo with no roughness or wetness driven by
   the dirt. Nails do not read from the seat, the fingertips are smooth caps, and there are no scars (V4). Owner:
   hands/character, with materials for skin roughness from dirt (open since C6).
3. **The opponent is clean.** A smooth beige gown with no stains, and clean, dry skin; the reference shows a filthy,
   stained canvas jacket and a wet face. The scalp is a hot orange highlight. Owner: materials (gown and skin grime),
   with hands/character for the jacket asset.
4. **Large wood surfaces look procedural.** Dashed gouges, chalk strokes, a fur-like near edge, a rectangular decal,
   a pin-prick dot grid on the squares, and no peeling varnish or worn patches (V5 #3, #4, #9, #10). Owner: materials,
   with board/environment for decal placement and projection.
5. **The room has no story props, and its surfaces are stretched.** No WARD B sign in frame, no window or cold
   source. A streaky wall panel behind the lamp, and a double-printed clipboard header (V5 #5, #7). Owner:
   board/environment.

---

# Run 7 (2026-10-16): judge re-score after C7, C8b, C9, C8m and the watch fix

Base `b847d2d` (upstream; contains 5473d2d: C7 lighting, C8b board/environment, C9 window, C8m materials, 25a2edf watch
bezel). Build PC: lock `judge` 18:22-18:38 PC time (after the lead's gallery hold); `git pull` (already at b847d2d),
L_Table rebuilt with `setup_content.ps1` (BUILD OK, 170 actors). Captures: the run 6 driver unchanged
(`C:\TownChess\judge\judge_capture7.ps1` = `judge_capture.ps1` with an `r7_` prefix), `capture.ps1 -Preset epic
1920x1080 -WarmSec 22`, the same 19 cameras as run 6, plus main and Black seat again with `-TCGamePath=1` (Epic 83 %
screen percentage + TSR, what the player sees). Evidence (1280x720): `docs/graphics/judge/run7-*.jpg`, same names as
run 6; `run7-main-gamepath.jpg` and `run7-black-gamepath.jpg` are the scored main/Black frames; `run7-crops.jpg` =
game-path crops at 1x (row 1: lamp + wall + window, window + WARD B, opponent torso; row 2: left hand, right hand,
clipboard/right table). Coordinates are in the 1920x1080 originals. Specialists' reports were not used for scoring.

V1/V2 (1045 px, Rec.709; the script reproduces the reference at 26.62 / 97.1 / 1.443 / 1.619 / 12.94):

| Frame | Mean | p95 | r/g | g/b | Detail (V2) | Median | < luma 8 |
|---|---|---|---|---|---|---|---|
| Main, full res | 28.99 | 97.1 | 1.472 | 1.661 | 11.48 | 15.1 | 38.3 % |
| Main, game path | 28.98 | 96.7 | 1.472 | 1.657 | 11.14 | 15.3 | 38.0 % |
| Black, full res | 27.25 | 90.9 | 1.484 | 1.656 | 11.08 | 14.1 | 38.8 % |
| Black, game path | 27.60 | 92.2 | 1.479 | 1.650 | 10.81 | 14.3 | 38.7 % |

V1 met in all four. V2 not met (main full res 0.02 under 11.5; the game path loses ~0.35 to TSR upscaling).
Region luma (main, both paths within 1 %): lamp mouth p95 215 (art direction >= 200: met), scalp p95 103 (<= 90: not
met), window p95 135 (cold accent <= 50: not met), board mean 59 (40-50: hot), left hand mean 33 (22-35: met).

## Findings first (evidence)

1. **The lamp is now the key.** The mouth is a warm, glowing enamel band with a brass rim and is the brightest thing in
   frame (p95 215; `run7-lamp`; main x 340-620, y 110-200). No bulb or hot core is visible, but it reads as a light.
2. **The room has its story props.** A cold barred window between the lamp and the head (main x 650-760, y 20-250),
   WARD B with an arrow on the back wall (x 1140-1280, y 30-200), the wood cabinet behind the lamp. Weak points: the
   panes are a flat, uniform blue-grey "lightbox" and its bars look bent; the sign is half hidden by cell bars and the head.
3. **New: dashed specular sparkle on the vertical bars** in front of the window and lamp (main x 560-940, y 0-300), in
   both paths (stronger on the game path). It reads as a dotted line of white pixels, not lit metal.
4. **The opponent is still the clean, hot figure.** The bald scalp is the second-brightest region (p95 103). C8m grime
   shows on the sleeves and as a faint red stain on the left shoulder (`run7-crops` row 1 right), but the chest is pale,
   smooth beige and the face is clean; the reference is a filthy, dark stained jacket. The face now has a wet sheen
   (`run7-cage-side`), which helps.
5. **Wood is still procedural.** The C8m gouges are continuous, but read as pale paired "claw swoosh" strokes drawn on
   the surface (main x 0-260, y 815-875; x 1670-1920, y 780-890 over a red smear). The near-edge face is still fuzzy
   streaks (`run7-table-edge` y 450-840), and a hard-edged red rectangle remains on the table (`run7-table-edge`
   x 1380-1490, y 375-495). The board's pit grid is gone (`run7-rook`).
6. **The game path costs little.** Side by side, the game-path frames are slightly softer (detail -0.34) and show the
   same defects; no row scores differently between the paths.

## Scores (0-10 vs the reference; main and Black rows from the game-path frames)

| Element | Run 6 | Run 7 | Change | Evidence |
|---|---|---|---|---|
| Opponent: face | 6 | 6 | same | Wet sheen now (`run7-cage-side`); clean skin; scalp p95 103 is the hottest highlight after the lamp |
| Opponent: body/pose | 7 | 7 | same | Steepled hands at the cage, unchanged (`run7-main-gamepath` x 840-1000, y 240-480) |
| Opponent: clothing | 5 | 6 | better | Grimed sleeves, a shoulder stain, weave dither mostly gone. The chest is still pale clean beige; far from the reference jacket |
| Mask | 7 | 7 | same | Hammered iron, brow band, nose strap (`run7-opponent`). Wire basket, no rust |
| Player hands | 6 | 6 | same | Veins and specks read; some sheen variation. Index/middle tips are smooth caps; blotchy dirt up close (V4) |
| Pieces | 6 | 6 | same | Matte beige, few dents; faceted knight; pale patch on the left knight's neck; black set reads as bronze (`run7-opponent-hands`) |
| Board | 6 | 7 | better | Pit grid gone; mottled grimy squares, brass pins, dark frame (`run7-rook`, `run7-hands`) |
| Blood / wear | 5 | 5 | same | Vivid saturated red, brighter than the wood (`run7-rook` x 600-1200, y 120-300), against VISUAL_ART_DIRECTION 5. A red rectangle on the table. None on pieces or hands |
| Table | 5 | 5 | same | Continuous gouges, but drawn-looking claw strokes, a fuzzy near edge, no peeling varnish or worn patches (finding 5) |
| Props / clutter | 6 | 6 | same | Single clipboard header (`run7-clipboard`), lamp better. The record is upside down from the seat and its lines smear into horizontal streaks (main x 1430-1900, y 590-720); the right cabinet top is a pale untextured slab (x 1720-1920, y 490-690) |
| Environment | 6 | 7 | better | Window, WARD B sign, cabinet, cell bars, beds: the reference's depth cues are in frame. Lightbox window, half-hidden sign |
| Lighting | 6 | 7 | better | Visible lamp key (p95 215), board pool, a cold back source. Scalp p95 103, window too bright (135), board mean 59, bar sparkle |
| Camera / composition | 7 | 7 | same | Unchanged; close to the reference. Wrists cut by the bottom edge |
| UI / HUD | 6 | 6 | same | Unchanged cards and timers; the player portrait is still a smear (main x 35-100, y 28-90) |
| Black-seat view | 6 | 6 | same | Correct flip and HUD swap (`run7-black-gamepath`). Carries the main view's gains and defects; lowest detail (10.81) |
| **Average** | **6.00** | **6.27** (15 rows) | +0.27 | 2 rows at 5 (blood/wear, table); 5 rows at 7 |

The full-res frames score the same on every row, so run 6 stays comparable (6.27 either way).

**V3 (every row >= 6, average >= 7): not met.** Average 6.27; blood/wear and table at 5.

**V4 (hands >= 7: veins, dirt, nails): 6/10, not met.**
- Veins: read from the seat (`run7-hand-seat-left` x 300-1000, y 250-600); still lumpy and worm-like.
- Dirt: reads from the seat as crease specks and smudges (`run7-hand-seat-right` x 900-1200, y 300-500); up close it
  is a leopard-blotch pattern on the fingers (`run7-nails` x 780-1400, y 0-500). In the main view it barely reads.
- Nails: the right thumbnail reads (`run7-hand-seat-right` x 570-650, y 780-870). The left index and middle tips are
  smooth rounded caps with no nail (`run7-hand-seat-left` x 1230-1410, y 180-600). No nail reads in the main view.
- Skin: some roughness variation on the knuckles now (C8m), still a uniform orange albedo, no scars.

**V5 (no placeholder, broken or clipping asset): not met.**

| # | Run 6 defect | Run 7 |
|---|---|---|
| 1 | Gown shadow dither | partly fixed: mostly gone; a mild stipple remains in the shoulder shadow (main x 1000-1150, y 380-560) |
| 2 | Dark grain in the right white rook's crown | still present, minor (main x 1385-1420, y 710-725); C7 attributes it to crenel shadows |
| 3 | Rectangular red decal on the near edge | partly fixed: gone from the edge in the main view; a hard-edged red rectangle remains on the table (`run7-table-edge` x 1380-1490, y 375-495) |
| 4 | Fur-like streaks on the near-edge face | still present (`run7-table-edge` y 450-840, `run7-hands` y 650-1080) |
| 5 | Streaky wall panel behind the lamp | partly fixed: now a wood cabinet face (`run7-beds`); from the seat still a bright gridded panel (main x 360-500, y 170-500) |
| 6 | Lamp mouth a flat grey band | fixed: warm glowing enamel + brass rim (`run7-lamp`) |
| 7 | Double clipboard header | fixed (`run7-clipboard`) |
| 8 | Pale rectangle on the left knight's neck | still present, now confirmed (main x 625-645, y 765-780) |
| 9 | Pin-prick dot grid on the squares | fixed (`run7-rook`, `run7-rook-seat`) |
| 10 | Dashed gouges with a hairline halo | partly fixed: continuous, no halo, but they read as drawn claw strokes |
| 11 | Faceted knight and watch bezel | bezel fixed (`run7-watch-dial`); knight still faceted (`run7-nails` x 0-900) |
| 12 | Sleeve grime band edge, cuff weave stretch | partly fixed: softer band (`run7-sleeve-watch`); the weave still stretches on the cuff roll (`run7-watch-strap`) |
| 13 | Blocky strap tab | still present (`run7-watch-strap` x 1490-1920, y 480-910) |
| base 10 | HUD player portrait smear | still present |

New defects:
1. Dashed white specular sparkle along the cell bars and window bars, both paths (main x 560-940, y 0-300).
2. The window is a flat, uniform blue-grey panel with bent-looking bars, too bright for a cold accent (p95 135).
3. Saturated blood brighter than the wood around it (`run7-rook`; `run7-hands` x 0-90, y 510-630).
4. The clipboard record's lines smear into horizontal streaks from the seat, both paths (main x 1430-1900, y 590-720).
5. The right cabinet top reads as a pale untextured slab (main x 1720-1920, y 490-690; present in run 6, not listed).

Checked and not found: no world-grid materials, no floating props, no hand-piece or finger-cage penetration; the
captured white piece on the table left of the board stands upright.

## Top 5 remaining gaps (ranked by payoff)

1. **Table and blood (the two rows that block V3).** Drawn claw strokes, a fuzzy near edge, a red rectangle, no varnish
   wear; blood saturated and brighter than the wood. Owner: materials (wood and blood shaders: oxidised dark blood,
   grain-aligned wear), with board/environment for decal shapes and placement.
2. **The opponent reads clean and hot.** Scalp p95 103, a pale clean chest, a clean face. Owner: materials (scalp and
   gown grime, darker gown albedo), with the rendering architect (`Lamp_Opponent` aim off the scalp).
3. **Hand skin (V4).** Nails on index/middle, fingertip shape, cavity-driven dirt instead of blotches, albedo
   variation. Owner: hands/character (mesh, nails), with materials (skin textures).
4. **Pieces.** Matte beige "plastic", a faceted knight with a pale neck patch, a bronze-looking black set, no chips or
   blood. Owner: materials (ivory/ebony varnish, chips, the knight's texture patch), board/environment (knight mesh).
5. **Background accents.** Bar sparkle, the lightbox window, a half-hidden WARD B, the white cabinet slab, the HUD
   portrait. Owner: rendering architect (bar specular/shadow aliasing, window intensity), board/environment (window
   glass, sign placement, cabinet material), lead (HUD portrait).
