# Visual judge report (stage 2)

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
